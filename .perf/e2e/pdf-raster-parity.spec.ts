/**
 * Rasterizes the exported PDF itself and checks it.
 *
 * The SVG parity harness (pdf-glyph-parity.spec.ts) proves the outlined SVG is
 * right. This one goes a step further down the pipe: it renders the finished PDF
 * with pdf.js and dumps the pixels, so a fault introduced by svg2pdf's Form
 * XObject path — glyphs misplaced by the `cm` matrix, clipped by a form /BBox,
 * printed in the wrong colour, or missing entirely — is visible.
 *
 * pdf.js is loaded from node_modules as a blob-URL ES module (installed with
 * --no-save; it is NOT a project dependency). Run once per code version with
 * PDFRASTER_TAG=before / after and diff the raw buffers.
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
const ROOT = path.resolve(PERF_DIR, '..');
const TAG = process.env.PDFRASTER_TAG ?? 'run';

/** Longest edge of the parity raster — matches the SVG harness. */
const RASTER_MAX = 2000;

const PDFJS = path.join(ROOT, 'node_modules/pdfjs-dist/build/pdf.min.mjs');
const PDFJS_WORKER = path.join(ROOT, 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs');

const MAPS: { name: string; file: string }[] = [
  { name: 'mta', file: 'mta-v67d.massimo.json' },
  { name: 'furta', file: 'furta-v34.massimo.json' },
];

async function exportPdf(page: Page): Promise<Download> {
  await page.getByRole('button', { name: 'Canvas' }).click();
  await page.getByRole('menuitem', { name: 'Export' }).click();
  const downloadPromise = page.waitForEvent('download', { timeout: 300_000 });
  await page.getByRole('menuitem', { name: 'PDF', exact: true }).click();
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

  test(`${name} — rasterize the exported PDF`, async ({ page }) => {
    test.skip(!existsSync(srcPath), `${file} not present in .perf/`);
    test.skip(!existsSync(PDFJS), 'pdfjs-dist not installed (npm i --no-save pdfjs-dist)');
    test.setTimeout(900_000);

    const stations = Object.keys(JSON.parse(readFileSync(srcPath, 'utf8')).doc.stations ?? {})
      .length;
    await loadMapFile(page, srcPath, stations);

    const downloadPath = await (await exportPdf(page)).path();
    if (!downloadPath) throw new Error('download has no path');
    const pdfBytes = readFileSync(downloadPath);

    const raster = await page.evaluate(
      async ([libSrc, workerSrc, pdfB64, maxEdge]) => {
        const libUrl = URL.createObjectURL(
          new Blob([libSrc as string], { type: 'text/javascript' }),
        );
        const workerUrl = URL.createObjectURL(
          new Blob([workerSrc as string], { type: 'text/javascript' }),
        );
        try {
          const lib = await import(/* @vite-ignore */ libUrl);
          lib.GlobalWorkerOptions.workerSrc = workerUrl;

          const bin = atob(pdfB64 as string);
          const data = Uint8Array.from(bin, (c) => c.charCodeAt(0));
          const doc = await lib.getDocument({ data }).promise;
          const pageCount = doc.numPages;
          const pdfPage = await doc.getPage(1);

          const base = pdfPage.getViewport({ scale: 1 });
          const scale = (maxEdge as number) / Math.max(base.width, base.height);
          const viewport = pdfPage.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(viewport.width);
          canvas.height = Math.round(viewport.height);
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('no 2d context');
          // The map's own background rect covers the page, but paint white first
          // so an empty PDF reads as blank rather than transparent-black.
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          await pdfPage.render({ canvasContext: ctx, viewport, canvas }).promise;

          const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          let ink = 0;
          for (let i = 0; i < px.length; i += 4) {
            if (px[i] !== 255 || px[i + 1] !== 255 || px[i + 2] !== 255) ink++;
          }
          let binary = '';
          const chunk = 0x8000;
          for (let i = 0; i < px.length; i += chunk) {
            binary += String.fromCharCode(...px.subarray(i, i + chunk));
          }
          return { w: canvas.width, h: canvas.height, ink, pageCount, b64: btoa(binary) };
        } finally {
          URL.revokeObjectURL(libUrl);
          URL.revokeObjectURL(workerUrl);
        }
      },
      [
        readFileSync(PDFJS, 'utf8'),
        readFileSync(PDFJS_WORKER, 'utf8'),
        pdfBytes.toString('base64'),
        RASTER_MAX,
      ] as const,
    );

    // Sanity, each independently failable.
    expect(raster.pageCount, 'a map export is a single page').toBe(1);
    expect(raster.ink, 'the rendered PDF must contain ink, not a blank page').toBeGreaterThan(
      10_000,
    );

    writeFileSync(
      path.join(PERF_DIR, `pdfraster-${TAG}-${name}.local.raw`),
      Buffer.from(raster.b64, 'base64'),
    );
    writeFileSync(
      path.join(PERF_DIR, `pdfraster-${TAG}-${name}.local.json`),
      JSON.stringify(
        { w: raster.w, h: raster.h, ink: raster.ink, pdfBytes: pdfBytes.length },
        null,
        2,
      ),
    );
  });
}
