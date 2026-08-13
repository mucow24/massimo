/**
 * PDF export regression. Seeds a map that exercises what the PDF pipeline has to
 * get right — text outlined to vector paths (no font embedded), a hatched line
 * segment (baked to stripe geometry), an embedded SVG image, a logo whose casing
 * is a hard feDropShadow (baked to an offset silhouette), and a graphic with an
 * alpha `<mask>` (rasterized to a PNG, since svg2pdf has no mask support) — then
 * drives Map → Export → PDF and asserts on the downloaded bytes.
 *
 * The decisive font guard is now the INVERSE of what it once was: text is
 * outlined before svg2pdf sees it, so the PDF must carry NO embedded font —
 * no `/FontFile2`, no `/Type0` — and instead be dominated by vector path
 * operators. The licence permits the font in output only when the end user
 * can't edit it, and outlines satisfy that.
 */
import { test, expect, type Page, type Download } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { openMapMenu, openWithRawDoc, seedAndOpen, fourInLineWithBulletsAndLabel } from './fixtures';

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

// A graphic with a circular hole punched by an alpha <mask> — the shape svg2pdf
// re-vectorizes with no mask support, so it would export as a solid square. The
// pipeline must rasterize it to a PNG (browser applies the mask), embedded in the
// PDF as an image XObject whose transparent hole becomes a soft mask (/SMask).
// Deliberately has width/height but NO viewBox (a common export shape): exercises
// the sizeSvgRoot viewBox-injection path, without which it would rasterize tiny.
const maskedLogo = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><defs><mask id="mk-test"><rect x="0" y="0" width="80" height="80" fill="#fff"/><circle cx="40" cy="40" r="20" fill="#000"/></mask></defs><rect x="0" y="0" width="80" height="80" fill="#c020a0" mask="url(#mk-test)"/></svg>`;
const maskedHref =
  'data:image/svg+xml;base64,' + Buffer.from(maskedLogo, 'utf-8').toString('base64');

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
      // Söhne covers ↔ itself but has no dingbats, so ✈ (U+2708) crosses into
      // the symbol fallback chain — exercising the glyph-outline tracer over two
      // different faces in one label. At weight 700 on purpose: the fallback
      // faces declare a full weight range so the browser can't synthesize a bold
      // the tracer would have no way to reproduce.
      gSym: { id: 'gSym', x: -150, y: 260, rotation: 0, text: '✈ Gate \u{2194}', fontSize: 22, weight: 700, italic: false, align: 'left' },
    },
    polygons: {},
    polygonOrder: [],
    svgImages: {
      img1: { id: 'img1', x: 120, y: 180, width: 120, height: 80, rotation: 0, href: embeddedHref },
      img2: { id: 'img2', x: 120, y: 320, width: 60, height: 60, rotation: 0, href: shadowHref },
      img3: { id: 'img3', x: 120, y: 440, width: 80, height: 80, rotation: 0, href: maskedHref },
    },
    svgImageOrder: ['img1', 'img2', 'img3'],
  },
};

async function seed(page: Page): Promise<void> {
  await openWithRawDoc(page, persisted);
  // Fonts must be DONE loading before the export asserts on outlined glyph
  // bytes. waitForFunction, not `evaluate(() => document.fonts.ready)`:
  // shortly after the first paint Chromium can tear down and RECREATE the
  // page's JS context without any navigation (probed: window state survives
  // and no second navigation entry appears), which kills an evaluate that is
  // sitting on a pending in-page promise. waitForFunction re-arms across
  // context recreation. The old double-boot seeding masked this — fonts were
  // warm by the second boot, so the promise never pended.
  await page.waitForFunction(() => document.fonts.status === 'loaded');
}

async function exportPdf(page: Page): Promise<Download> {
  await openMapMenu(page);
  await page.getByRole('menuitem', { name: 'Export' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'PDF', exact: true }).click();
  return downloadPromise;
}

test('exports a vector PDF with outlined text from a hatch + text + image map', async ({
  page,
}) => {
  await seed(page);
  // Sanity: the hatched band and both images actually rendered before we export.
  await expect(page.locator('[data-svg-image-id="img1"]')).toHaveCount(1);
  await expect(page.locator('[data-svg-image-id="img2"]')).toHaveCount(1); // drop-shadow logo
  await expect(page.locator('[data-svg-image-id="img3"]')).toHaveCount(1); // masked graphic
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
  expect(bytes.length).toBeGreaterThan(5_000); // outlined glyph paths + a rasterized image

  // Decisive font guard, INVERTED: text is outlined to vector paths before
  // svg2pdf sees it, so the PDF embeds no font at all. A regression that went
  // back to embedding a font (or fell back to a built-in one) would bring these
  // markers back.
  expect(raw).not.toContain('/FontFile2'); // no embedded TrueType outline
  expect(raw).not.toContain('/Type0'); // no composite (CID) font — svg2pdf drew no text
  // (jsPDF always lists its built-in standard-14 /BaseFont /Helvetica in the
  // resources whether or not anything uses it, so its presence proves nothing —
  // the /FontFile2 + /Type0 absence above is what proves no font was embedded.)

  // Glyphs reach the page as Form XObjects: each distinct outline is one shared
  // content stream, invoked per occurrence. The `Do` differential in the next
  // test proves the invocations happen; this proves the shared objects exist at
  // all. Inlining every glyph again would leave the PDF with no /Form in it.
  expect(raw).toMatch(/\/Subtype\s*\/Form/);

  // Mask guard: the masked graphic (img3) can't survive svg2pdf's mask-less
  // re-vectorizing, so the pipeline rasterizes it — landing in the PDF as an
  // embedded image XObject. The rest of the map is pure vector, so this marker
  // only appears once the masked image is rasterized.
  expect(raw).toMatch(/\/Subtype\s*\/Image/);

  // Decisive: the mask actually survived. Its transparent circular hole makes the
  // rasterized PNG carry an alpha channel, so jsPDF emits a soft mask (/SMask). A
  // regression that dropped the mask would produce a solid, opaque square — no
  // alpha, no /SMask — so this fails loudly instead of silently shipping an
  // unmasked graphic.
  expect(raw).toContain('/SMask');
});

/**
 * The positive oracle. Every assertion above is satisfied by a PDF containing no
 * glyphs at all: `/FontFile2` and `/Type0` are absent precisely BECAUSE nothing
 * embeds a font, and a byte-size floor is cleared by the line geometry alone. So
 * prove the glyphs really are in there.
 *
 * `compress: true` Flate-encodes the content streams, so operators can't be
 * grepped from the raw bytes — inflate first. Then apply the same differential
 * the SVG spec uses: a label with ten more characters must DRAW ten more glyphs,
 * and a tracer that emitted nothing would produce identical streams.
 *
 * Each glyph reaches the page as a Form XObject invocation (`Do`) rather than a
 * fresh outline, so the drawing delta lives in the `Do` count. The `f` count is
 * the other half of the claim: the ten added characters are the same character,
 * so they share ONE form — its outline is filled once, inside the form's own
 * stream, no matter how many times it is invoked. A regression that inlined
 * every glyph again would move the delta back onto `f` and fail here.
 */
test('outlined glyphs actually reach the PDF, once each as a form object', async ({ page }) => {
  /** Inflate every Flate content stream and concatenate the operators. */
  const operators = (pdf: Buffer): string => {
    // Walked by index, not by regex: the payloads are binary.
    const open = Buffer.from('stream');
    const close = Buffer.from('endstream');
    let out = '';
    for (let i = pdf.indexOf(open); i !== -1; i = pdf.indexOf(open, i + 1)) {
      if (pdf.subarray(i - 3, i).toString('latin1') === 'end') continue; // 'endstream'
      let start = i + open.length;
      if (pdf[start] === 0x0d) start++; // CR
      if (pdf[start] === 0x0a) start++; // LF
      const end = pdf.indexOf(close, start);
      if (end === -1) continue;
      try {
        out += inflateSync(pdf.subarray(start, end)).toString('latin1');
      } catch {
        // Not a Flate stream (an image XObject, say) — skip it.
      }
    }
    return out;
  };
  // Count whole operator tokens: `f` is the fill operator and `Do` invokes an
  // XObject. Substring matching would count the `f` in a hex colour or a name.
  const tokens = (ops: string, op: string): number => {
    let n = 0;
    for (const t of ops.split(/\s+/)) if (t === op) n++;
    return n;
  };

  const exportWithLabel = async (text: string): Promise<{ draws: number; fills: number }> => {
    await seedAndOpen(page, {
      ...fourInLineWithBulletsAndLabel,
      textLabels: [{ id: 'g1', x: 0, y: 200, text, fontSize: 20, weight: 700 }],
    });
    const path = await (await exportPdf(page)).path();
    if (!path) throw new Error('download has no path');
    const ops = operators(readFileSync(path));
    expect(ops.length, 'content streams should inflate').toBeGreaterThan(0);
    return { draws: tokens(ops, 'Do'), fills: tokens(ops, 'f') };
  };

  const base = await exportWithLabel('Midtown');
  const grown = await exportWithLabel('MidtownXXXXXXXXXX'); // +10 glyph occurrences

  expect(base.draws).toBeGreaterThan(0);
  expect(grown.draws - base.draws).toBe(10);
  // Ten more occurrences of ONE glyph fill at most one more outline.
  expect(grown.fills - base.fills).toBeLessThanOrEqual(1);
});


