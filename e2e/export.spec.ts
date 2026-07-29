import { test, expect, type Page, type Download } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  seedAndOpen,
  stationCenter,
  fourInLine,
  fourInLineWithBulletsAndLabel,
  type Seed,
} from './fixtures';

// Two separate horizontal lines with distinct colors. Selecting one desaturates
// the other on the live canvas (the selected-line highlight), so it exercises
// whether that transient recoloring leaks into an export.
const twoLines: Seed = {
  stations: [
    { id: 'A', name: 'A', x: -200, y: 0, stops: [{ lineId: 'L1', row: 0, col: 0 }] },
    { id: 'B', name: 'B', x: 200, y: 0, stops: [{ lineId: 'L1', row: 0, col: 0 }] },
    { id: 'C', name: 'C', x: -200, y: 150, stops: [{ lineId: 'L2', row: 0, col: 0 }] },
    { id: 'D', name: 'D', x: 200, y: 150, stops: [{ lineId: 'L2', row: 0, col: 0 }] },
  ],
  lines: [
    { id: 'L1', service: '1', color: '#0039A6', stations: ['A', 'B'] },
    { id: 'L2', service: '2', color: '#EE352E', stations: ['C', 'D'] },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('vignelli-map-doc-v1'));
});

/** Drive Canvas → Export → <kind> and return the captured download. */
async function exportVia(page: Page, kind: 'PNG' | 'SVG'): Promise<Download> {
  await page.getByRole('button', { name: 'Canvas' }).click();
  await page.getByRole('menuitem', { name: 'Export' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: kind, exact: true }).click();
  return downloadPromise;
}

function readDownload(d: Download): Promise<Buffer> {
  return d.path().then((p) => {
    if (!p) throw new Error('download has no path');
    return readFileSync(p);
  });
}

test.describe('Canvas export', () => {
  test('SVG export is clean, content-framed, and embeds fonts', async ({ page }) => {
    await seedAndOpen(page, fourInLineWithBulletsAndLabel);

    const screenViewBox = await page
      .locator('.canvas-host .canvas-pan-layer > svg')
      .getAttribute('viewBox');

    const download = await exportVia(page, 'SVG');
    // Default (unnamed) map → basename is the "Untitled map" default + date.
    expect(download.suggestedFilename()).toMatch(/^Untitled map - \d{4}-\d{2}-\d{2}\.svg$/);

    const svg = (await readDownload(download)).toString('utf-8');

    // Content is present.
    expect(svg).toContain('Midtown');
    // Fonts embedded as data URIs.
    expect(svg).toContain('@font-face');
    expect(svg).toContain('base64,');
    // …and actually referenced: the map's <text> inherits its family from page
    // CSS, which is absent in a standalone SVG. The root <svg> must carry an
    // explicit Helvetica Neue font-family (NOT just the @font-face descriptor)
    // or the text falls back to serif. Match the opening <svg …> tag only.
    const svgOpenTag = /<svg\b[^>]*>/.exec(svg)?.[0] ?? '';
    expect(svgOpenTag).toMatch(/font-family="[^"]*Helvetica Neue/i);
    // Decisive "clean" oracle: every editing-only layer is tagged
    // data-export-exclude and stripped, so none survive serialization.
    expect(svg).not.toContain('data-export-exclude');
    // Reframed to content bounds, not the on-screen viewport.
    const exportViewBox = /viewBox="([^"]+)"/.exec(svg)?.[1];
    expect(exportViewBox).toBeTruthy();
    expect(exportViewBox).not.toBe(screenViewBox);
  });

  test('SVG export stays clean with a selection and the grid showing', async ({ page }) => {
    await seedAndOpen(page, fourInLineWithBulletsAndLabel);

    // Select a station (adds wash + selection-stroke layers) — grid is on by default.
    const a = await stationCenter(page, 'A');
    await page.mouse.click(a.x, a.y);

    const svg = (await readDownload(await exportVia(page, 'SVG'))).toString('utf-8');
    expect(svg).toContain('Midtown');
    expect(svg).not.toContain('data-export-exclude');
  });

  test('export ignores the selected-line desaturation of other lines', async ({ page }) => {
    await seedAndOpen(page, twoLines);

    // Select L1 → the live canvas desaturates L2 (the non-selected line).
    await page.locator('[data-band-stripe][data-line-id="L1"]').first().click({ force: true });
    await page.locator('.inspector').waitFor();

    const svg = (await readDownload(await exportVia(page, 'SVG'))).toString('utf-8');
    // L2 keeps its true color in the export, not the desaturated variant.
    expect(svg).toMatch(/#EE352E/i);
  });

  test('a revealed waypoint is never baked into an export (Show-waypoints is a view aid)', async ({
    page,
  }) => {
    await seedAndOpen(page, fourInLine);

    // Mark B a waypoint, then reveal all waypoints from the toolbar.
    const b = await stationCenter(page, 'B');
    await page.mouse.click(b.x, b.y);
    await page.getByRole('button', { name: 'Waypoint', exact: true }).click();
    await page.getByRole('button', { name: 'Toggle waypoints' }).click();

    // Sanity: the overlay is genuinely showing B's chrome on the live canvas.
    await expect(page.locator('[data-waypoint-lozenge]')).toHaveCount(1);
    await expect(
      page.locator('[data-stop-station="B"][data-stop-shape="circle"]'),
    ).toBeVisible();

    const svg = (await readDownload(await exportVia(page, 'SVG'))).toString('utf-8');
    // The revealed waypoint's dot and "WP" lozenge are stripped from the export…
    expect(svg).not.toContain('data-waypoint-lozenge');
    expect(svg).not.toContain('data-stop-station="B"');
    // …while ordinary stations' dots (real map content) survive.
    expect(svg).toContain('data-stop-station="A"');
  });

  test('PNG export renders at 4× the SVG’s natural size', async ({ page }) => {
    await seedAndOpen(page, fourInLineWithBulletsAndLabel);

    const svg = (await readDownload(await exportVia(page, 'SVG'))).toString('utf-8');
    const svgW = Number(/<svg[^>]*\swidth="([\d.]+)"/.exec(svg)?.[1]);
    const svgH = Number(/<svg[^>]*\sheight="([\d.]+)"/.exec(svg)?.[1]);
    expect(svgW).toBeGreaterThan(0);
    expect(svgH).toBeGreaterThan(0);

    const png = await readDownload(await exportVia(page, 'PNG'));
    // PNG signature.
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    // IHDR width/height (big-endian) live at byte offsets 16 and 20.
    const pngW = png.readUInt32BE(16);
    const pngH = png.readUInt32BE(20);
    expect(Math.abs(pngW - svgW * 4)).toBeLessThanOrEqual(2);
    expect(Math.abs(pngH - svgH * 4)).toBeLessThanOrEqual(2);
  });
});
