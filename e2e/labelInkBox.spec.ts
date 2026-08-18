import { test, expect } from '@playwright/test';
import { seedAndOpen } from './fixtures';

// The label alignment box hugs the PAINTED ink, not the font's conservative
// outline bounds: `measureText`'s actualBoundingBox* converges (at any
// measuring size) to the outline bounding box, curve control points included,
// which for Söhne's heavy cuts sits visibly outside the rasterized glyph. The
// measurer refines those bounds with an offscreen raster probe — a path only
// a real browser can exercise (jsdom has no rasterizer; the unit suites pin
// the measureText fallback arm), which is why this lives in e2e.
//
// The truth here is an INDEPENDENT in-page raster of the same string (same
// Skia rasterizer that paints the SVG), deliberately not the app's own probe.
test('the selection ring sits on rasterized ink, not the conservative font bounds', async ({
  page,
}) => {
  await seedAndOpen(page, {
    stations: [],
    lines: [],
    textLabels: [{ id: 'g1', x: 0, y: 0, text: 'FURTA', fontSize: 40, weight: 900 }],
  });
  // waitForFunction, not `evaluate(() => document.fonts.ready)`: an evaluate
  // awaiting a pending in-page promise dies if Chromium recreates the page's
  // JS context, which it can shortly after first paint with no navigation
  // involved (see fallbackSynthesis's ink(), exportPdf's seed()).
  // waitForFunction re-arms across that. The window is widest when the faces
  // are big — DejaVu stand-ins are 12 MB across the sixteen filenames against
  // Söhne's 1.6 — which is where this actually went red.
  await page.waitForFunction(
    () =>
      document.fonts.status === 'loaded' && [...document.fonts].some((f) => f.status === 'loaded'),
  );
  await page.evaluate(() => {
    const w = window as unknown as {
      __massimo: { stores: { selection: { getState(): { selectLabel(id: string): void } } } };
    };
    w.__massimo.stores.selection.getState().selectLabel('g1');
  });
  const ring = page.locator('[data-text-label-stroke="g1"] rect').first();
  await ring.waitFor();

  const truth = await page.evaluate(() => {
    // The font the SVG actually renders with — fallback included, so the
    // comparison stays honest even if the web font failed to arrive.
    const textEl = document.querySelector('[data-text-label-id="g1"] text')!;
    const family = getComputedStyle(textEl).fontFamily;
    const size = 40;
    const weight = 900;
    const text = 'FURTA';
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.font = `${weight} ${size * 64}px ${family}`;
    const hi = ctx.measureText(text);
    const consLeft = -hi.actualBoundingBoxLeft / 64;
    const consRight = hi.actualBoundingBoxRight / 64;
    const S = 16;
    ctx.font = `${weight} ${size}px ${family}`;
    const adv = ctx.measureText(text).width;
    c.width = Math.ceil((adv + size) * S);
    c.height = Math.ceil(size * 1.7 * S);
    // Draw at the scaled FONT size directly — the same convention the app's
    // probe rasters under, NOT a base-size draw scaled by the CTM. The two are
    // identical on Windows/mac, but FreeType (the Linux CI runner) rasters
    // them differently by up to ~0.4 units on this glyph's terminals; the
    // scaled-font draw is the zoom-independent outline-faithful one, so both
    // instruments measure it. Still an independent reimplementation — full
    // string, own scan — of what the probe measures strip-wise.
    ctx.font = `${weight} ${size * S}px ${family}`;
    ctx.fillText(text, (size / 2) * S, size * 1.2 * S);
    const img = ctx.getImageData(0, 0, c.width, c.height).data;
    const inked = (x: number): boolean => {
      for (let y = 0; y < c.height; y++) if (img[(y * c.width + x) * 4 + 3] > 32) return true;
      return false;
    };
    let left = -1;
    let right = -1;
    for (let x = 0; x < c.width; x++)
      if (inked(x)) {
        left = x;
        break;
      }
    for (let x = c.width - 1; x >= 0; x--)
      if (inked(x)) {
        right = x + 1;
        break;
      }
    const rasterLeft = left / S - size / 2;
    const rasterRight = right / S - size / 2;
    const rasterWidth = rasterRight - rasterLeft;
    return {
      rasterWidth,
      consWidth: consRight - consLeft,
      // Left-aligned single line: the box left edge is the leftmost ink,
      // which sits at (pen-relative inkLeft) − inkWidth/2 of the label center.
      expectedX0: rasterLeft - rasterWidth / 2,
    };
  });

  // Anti-vacuous precondition: for this font/weight/string the conservative
  // bounds really ARE wider than the painted ink, so the assertions below can
  // tell the two instruments apart. If a font swap ever collapses that gap,
  // fail loudly here instead of passing vacuously below.
  expect(truth.consWidth - truth.rasterWidth).toBeGreaterThan(0.5);

  // Poll: the ring settles on probe-refined metrics once the font-load
  // re-measure has run (App clears the measure cache on `loadingdone`).
  await expect
    .poll(async () => Math.abs(parseFloat((await ring.getAttribute('width'))!) - truth.rasterWidth))
    .toBeLessThanOrEqual(0.25);
  const x0 = parseFloat((await ring.getAttribute('x'))!);
  expect(Math.abs(x0 - truth.expectedX0)).toBeLessThanOrEqual(0.25);
});
