import { test, expect, type Page, type Download } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  seedAndOpen,
  stationCenter,
  fourInLine,
  fourInLineWithBulletsAndLabel,
  toggleViewLayer,
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
  test('SVG export is clean, content-framed, and outlines text to paths', async ({ page }) => {
    await seedAndOpen(page, fourInLineWithBulletsAndLabel);

    const screenViewBox = await page
      .locator('.canvas-host .canvas-pan-layer > svg')
      .getAttribute('viewBox');

    const download = await exportVia(page, 'SVG');
    // Default (unnamed) map → basename is the "Untitled map" default + date.
    expect(download.suggestedFilename()).toMatch(/^Untitled map - \d{4}-\d{2}-\d{2}\.svg$/);

    const svg = (await readDownload(download)).toString('utf-8');

    // Text is outlined, not embedded: no font data, no live <text>, only paths.
    // The label "Midtown" survives as glyph outlines, so its letters are gone as
    // text — the licence permits the font in output only when it can't be edited.
    expect(svg).not.toContain('@font-face');
    expect(svg).not.toContain('base64,');
    expect(svg).not.toContain('<text');
    expect(svg).not.toContain('Midtown');
    expect(svg).toContain('<path');
    // Decisive "clean" oracle: every editing-only layer is tagged
    // data-export-exclude and stripped, so none survive serialization.
    expect(svg).not.toContain('data-export-exclude');
    // Reframed to content bounds, not the on-screen viewport.
    const exportViewBox = /viewBox="([^"]+)"/.exec(svg)?.[1];
    expect(exportViewBox).toBeTruthy();
    expect(exportViewBox).not.toBe(screenViewBox);
  });

  /**
   * The positive oracle for outlining, and for the deduplication underneath it.
   * Every other assertion in this file is satisfied by an export containing ZERO
   * glyphs — "no <text>" and "some <path>" are both true of a map whose fonts
   * failed to load, and that is exactly the vacuous green this guards against.
   *
   * Same map twice, the label differing by a known glyph count. Outlining emits
   * one <use> per glyph OCCURRENCE, so the instance delta must equal the
   * characters added — a tracer producing nothing gives 0 and fails. And because
   * those ten characters are the SAME character, they must share one traced
   * outline: the prototype delta is at most 1 (0 if the base map already used an
   * X). Counting instances alone would still pass if every occurrence carried
   * its own copy of the outline again.
   */
  test('one <use> per glyph, one outline per distinct glyph', async ({ page }) => {
    const count = (svg: string, tag: string) => svg.split(tag).length - 1;
    const exportCounts = async (seed: Parameters<typeof seedAndOpen>[1]) => {
      await seedAndOpen(page, seed);
      const svg = (await readDownload(await exportVia(page, 'SVG'))).toString('utf-8');
      return { uses: count(svg, '<use'), paths: count(svg, '<path') };
    };

    const base = await exportCounts(fourInLineWithBulletsAndLabel);
    const EXTRA = 'XXXXXXXXXX'; // 10 more glyph occurrences, all the same glyph
    const grown = await exportCounts({
      ...fourInLineWithBulletsAndLabel,
      textLabels: [{ id: 'g1', x: 0, y: 200, text: `Midtown${EXTRA}`, fontSize: 20, weight: 700 }],
    });

    expect(grown.uses - base.uses).toBe(EXTRA.length);
    expect(base.uses).toBeGreaterThan(EXTRA.length); // the base map really does have glyphs
    // Ten more occurrences of one glyph cost at most one more outline.
    expect(grown.paths - base.paths).toBeLessThanOrEqual(1);
  });

  test('SVG export stays clean with a selection and the grid showing', async ({ page }) => {
    await seedAndOpen(page, fourInLineWithBulletsAndLabel);

    // Select a station (adds wash + selection-stroke layers) — grid is on by default.
    const a = await stationCenter(page, 'A');
    await page.mouse.click(a.x, a.y);

    const svg = (await readDownload(await exportVia(page, 'SVG'))).toString('utf-8');
    // Content survives (outlined to paths, no live text), selection chrome doesn't.
    expect(svg).toContain('<path');
    expect(svg).not.toContain('<text');
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
    await toggleViewLayer(page, 'Waypoints');

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
