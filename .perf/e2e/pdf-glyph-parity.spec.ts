/**
 * Pixel parity for the glyph-outlining change.
 *
 * The unit tests drive `outlineAllText` with a stub tracer and stub pen
 * positions, so they pin the STRUCTURE (one prototype per glyph, a <use> per
 * occurrence, transform shape) but cannot catch the failure that actually
 * matters: real glyphs landing in the wrong place or at the wrong size, because
 * the em-space scale or the translate/scale order is wrong.
 *
 * So rasterize the real export. Load a real map, export its SVG through the real
 * menu, draw it to a canvas at a fixed size, and dump the raw RGBA buffer. Run
 * this once per code version (PARITY_TAG=before / after) and diff the buffers
 * byte-for-byte: identical rasters mean every glyph is exactly where it was.
 *
 * Inputs and outputs live in .perf/ — NEVER test-results/, which Playwright
 * wipes before every run.
 */
import { test, expect, type Page, type Download } from '@playwright/test';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PERF_DIR = path.resolve(__dirname, '..');
const TAG = process.env.PARITY_TAG ?? 'run';

/** Longest edge of the parity raster. Big enough that 8pt labels resolve. */
const RASTER_MAX = 2000;

const MAPS: { name: string; file: string }[] = [
  { name: 'mta', file: 'mta-v67d.massimo.json' },
  { name: 'furta', file: 'furta-v34.massimo.json' },
];

async function exportSvg(page: Page): Promise<Download> {
  await page.getByRole('button', { name: 'Canvas' }).click();
  await page.getByRole('menuitem', { name: 'Export' }).click();
  const downloadPromise = page.waitForEvent('download', { timeout: 300_000 });
  await page.getByRole('menuitem', { name: 'SVG', exact: true }).click();
  return downloadPromise;
}

async function loadMapFile(page: Page, filePath: string, expectedStations: number) {
  await page.goto('/');
  await page.locator('input[accept*="massimo"]').setInputFiles({
    name: path.basename(filePath),
    mimeType: 'application/json',
    buffer: readFileSync(filePath),
  });
  await page.waitForSelector('.canvas-host svg', { timeout: 60_000 });
  await expect(page.locator('[data-station-id]')).toHaveCount(expectedStations, {
    timeout: 60_000,
  });
  await page.evaluate(() => document.fonts.ready);
}

for (const { name, file } of MAPS) {
  const srcPath = path.join(PERF_DIR, file);

  test(`${name} — rasterize the exported SVG`, async ({ page }) => {
    test.skip(!existsSync(srcPath), `${file} not present in .perf/`);
    test.setTimeout(600_000);

    const stations = Object.keys(JSON.parse(readFileSync(srcPath, 'utf8')).doc.stations ?? {})
      .length;
    await loadMapFile(page, srcPath, stations);

    const download = await exportSvg(page);
    const downloadPath = await download.path();
    if (!downloadPath) throw new Error('download has no path');
    const svgText = readFileSync(downloadPath, 'utf8');

    // Rasterize in the page: an <img> of the SVG drawn onto a fixed-size canvas.
    // The SVG is self-contained (outlines, no font), so this is a faithful,
    // font-independent raster of exactly what the export contains.
    const raster = await page.evaluate(
      async ([svg, maxEdge]) => {
        const blob = new Blob([svg as string], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        try {
          const img = new Image();
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error('SVG failed to rasterize'));
            img.src = url;
          });
          const scale = (maxEdge as number) / Math.max(img.width, img.height);
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('no 2d context');
          ctx.drawImage(img, 0, 0, w, h);
          const data = ctx.getImageData(0, 0, w, h).data;
          // Sum the channels so an all-blank raster is detectable downstream.
          let ink = 0;
          for (let i = 0; i < data.length; i += 4) {
            if (data[i] !== 255 || data[i + 1] !== 255 || data[i + 2] !== 255) ink++;
          }
          let binary = '';
          const chunk = 0x8000;
          for (let i = 0; i < data.length; i += chunk) {
            binary += String.fromCharCode(...data.subarray(i, i + chunk));
          }
          return { w, h, ink, b64: btoa(binary) };
        } finally {
          URL.revokeObjectURL(url);
        }
      },
      [svgText, RASTER_MAX] as const,
    );

    // A blank raster would make any later comparison vacuously equal.
    expect(raster.ink, 'raster must actually contain ink').toBeGreaterThan(10_000);

    writeFileSync(
      path.join(PERF_DIR, `parity-${TAG}-${name}.local.raw`),
      Buffer.from(raster.b64, 'base64'),
    );
    writeFileSync(
      path.join(PERF_DIR, `parity-${TAG}-${name}.local.json`),
      JSON.stringify({ w: raster.w, h: raster.h, ink: raster.ink }, null, 2),
    );
  });
}
