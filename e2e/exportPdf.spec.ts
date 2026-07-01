/**
 * PDF export regression. Seeds a map that exercises what the PDF pipeline has to
 * get right — selectable text in embedded Helvetica Neue, a hatched line segment
 * (baked to stripe geometry), an embedded SVG image, and a logo whose casing is a
 * hard feDropShadow (baked to an offset silhouette) — then drives
 * Canvas → Export → PDF and asserts on the downloaded bytes.
 *
 * The decisive guard is `/FontFile2` + `/Type0`: the original failure mode was
 * jsPDF silently falling back to the standard (non-embedded) Helvetica because
 * it can't embed the PostScript-outline fonts. With the fonts shipped as TTF
 * those markers are present; if a regression reintroduced the OTF path they'd
 * vanish.
 */
import { test, expect, type Page, type Download } from '@playwright/test';
import { readFileSync } from 'node:fs';

// A small self-contained SVG, embedded as the "Add SVG…" feature would store
// it: an opaque data:image/svg+xml;base64 URI.
const embeddedSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80">
  <rect x="3" y="3" width="114" height="74" rx="10" fill="#1aa64b" stroke="#0b5d2a" stroke-width="3"/>
  <circle cx="34" cy="40" r="20" fill="#ff8a00"/>
</svg>`;
const embeddedHref =
  'data:image/svg+xml;base64,' + Buffer.from(embeddedSvg, 'utf-8').toString('base64');

// A logo whose casing is a hard feDropShadow (the shape we can't render through
// svg2pdf's filter-less image path). It must be baked into an offset silhouette
// during export — this exercises that path end-to-end without crashing.
const shadowLogo = `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60"><defs><filter id="fx-test" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow in="SourceGraphic" dx="-3" dy="0" stdDeviation="0" flood-color="#ffffff" flood-opacity="1"/></filter></defs><g filter="url(#fx-test)"><path d="M20 10L30 10L25 50Z" fill="#d92626"/></g></svg>`;
const shadowHref =
  'data:image/svg+xml;base64,' + Buffer.from(shadowLogo, 'utf-8').toString('base64');

const station = (id: string, x: number) => ({
  id,
  name: id,
  x,
  y: 0,
  rotation: 0,
  stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' }],
  label: { row: 0, col: -1, rotation: 0, offset: 0, align: 'auto', valign: 'middle' },
});

// Current persist version → no migration; the seeded state merges over
// DEFAULT_DOC (which backfills labelWeight, palettes, transfers, etc.).
const persisted = {
  version: 7,
  state: {
    stations: { A: station('A', -150), B: station('B', 150) },
    lines: {
      L1: {
        id: 'L1',
        service: '1',
        name: '1 line',
        color: '#0039a6',
        stations: ['A', 'B'],
        width: 22,
        segmentStyles: { 'A|B': 'hatched' }, // pairKeyOf('A','B') === 'A|B'
      },
    },
    lineOrder: ['L1'],
    curveRadius: 24,
    lineCounter: 1,
    lineTags: {},
    routeBullets: {},
    transfers: {},
    textLabels: {
      gReg: { id: 'gReg', x: -150, y: 160, rotation: 0, text: 'Regular', fontSize: 22, weight: 400, italic: false, align: 'left' },
      gBold: { id: 'gBold', x: -150, y: 210, rotation: 0, text: 'Bold', fontSize: 22, weight: 700, italic: false, align: 'left' },
      // ✈ (U+2708) and ↔ (U+2194) are not in Helvetica Neue — exercises the
      // glyph-outline fallback (opentype + DejaVu Sans) without crashing.
      gSym: { id: 'gSym', x: -150, y: 260, rotation: 0, text: '✈ Gate \u{2194}', fontSize: 22, weight: 700, italic: false, align: 'left' },
    },
    polygons: {},
    polygonOrder: [],
    svgImages: {
      img1: { id: 'img1', x: 120, y: 180, width: 120, height: 80, rotation: 0, href: embeddedHref },
      img2: { id: 'img2', x: 120, y: 320, width: 60, height: 60, rotation: 0, href: shadowHref },
    },
    svgImageOrder: ['img1', 'img2'],
  },
};

async function seed(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(
    ([k, v, vk, vp]) => {
      localStorage.setItem(k, v);
      localStorage.setItem(vk, vp);
    },
    [
      'vignelli-map-doc-v1',
      JSON.stringify(persisted),
      'massimo-viewport',
      JSON.stringify({ state: { x: 0, y: 0, zoom: 1 }, version: 0 }),
    ],
  );
  await page.reload();
  await page.waitForSelector('.canvas-host svg');
  await page.evaluate(() => document.fonts.ready);
}

async function exportPdf(page: Page): Promise<Download> {
  await page.getByRole('button', { name: 'Canvas' }).click();
  await page.getByRole('menuitem', { name: 'Export' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'PDF', exact: true }).click();
  return downloadPromise;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('vignelli-map-doc-v1'));
});

test('exports a vector PDF with embedded fonts from a hatch + text + image map', async ({
  page,
}) => {
  await seed(page);
  // Sanity: the hatched band and both images actually rendered before we export.
  await expect(page.locator('[data-svg-image-id="img1"]')).toHaveCount(1);
  await expect(page.locator('[data-svg-image-id="img2"]')).toHaveCount(1); // drop-shadow logo
  await expect(page.locator('[data-band-stripe][data-line-id="L1"]')).not.toHaveCount(0);

  const download = await exportPdf(page);
  // Default (unnamed) map → basename is the "Untitled map" default + date.
  expect(download.suggestedFilename()).toMatch(/^Untitled map - \d{4}-\d{2}-\d{2}\.pdf$/);

  const path = await download.path();
  expect(path).toBeTruthy();
  const bytes = readFileSync(path!);
  const raw = bytes.toString('latin1');

  // Valid, non-trivial PDF.
  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  expect(bytes.length).toBeGreaterThan(20_000); // embedded font payload dominates

  // Decisive font-embedding guard: real Helvetica Neue is embedded as a
  // TrueType CID font, NOT the standard non-embedded Helvetica fallback.
  expect(raw).toContain('/FontFile2'); // an embedded TrueType outline
  expect(raw).toContain('/Type0'); // composite (CID) font — how jsPDF embeds TTF
  expect(raw).toContain('Helvetica Neue'); // registered family, not bare /Helvetica
});
