import { test, expect } from '@playwright/test';
import { seedAndOpen, fourInLine, onSubstituteFaces } from './fixtures';

// The export tracer draws every glyph from the face's own outlines. So anything
// the BROWSER invents on top of a face — synthetic bold, synthetic oblique — is
// something the tracer cannot reproduce, and shows up as an export that does not
// match the screen.
//
// The fallback faces are where that bites. An `@font-face` with no weight
// descriptor registers at 400, and Chrome then emboldens it for any run at 600+
// — so a bold label containing ✈ would render a fattened plane on screen and a
// plain one in the PDF. Both fallback blocks therefore declare `font-weight: 100
// 900`, claiming the whole range so no synthesis is ever triggered.
//
// Only a real browser does font matching and synthesis, so this cannot live in
// the jsdom suite. It measures the rendered advance rather than reading the
// stylesheet, because the stylesheet text is not the thing that has to hold.
test.describe('fallback faces are never synthesized', () => {
  const AIR = '✈';

  /**
   * INK laid down by `text` at weight 400 and at 700, in the app's own font
   * stack — the count of pixels the browser actually painted.
   *
   * Ink, not advance width: Chrome's synthetic bold smears the glyph without
   * necessarily widening its advance, so `getComputedTextLength` can report the
   * two as identical while the screen shows a fattened plane the tracer has no
   * way to reproduce. Pixels are the thing that diverges, so pixels are what
   * this counts. Both renders happen in ONE evaluate, after the fonts settle —
   * split across round-trips they race the app's own reload paths.
   */
  async function ink(
    page: import('@playwright/test').Page,
    text: string,
  ): Promise<{ regular: number; bold: number }> {
    // Settle fonts BEFORE the evaluate: an evaluate awaiting a pending
    // in-page promise dies if Chromium recreates the page's JS context (it
    // can, shortly after first paint, with no navigation involved —
    // waitForFunction re-arms across that; see exportPdf's seed()). The
    // in-evaluate await below then resolves instantly. Bare status is
    // 'loaded' on a fresh document before any load begins, so also require
    // one face to have actually finished (the station labels force loads).
    await page.waitForFunction(
      () =>
        document.fonts.status === 'loaded' &&
        [...document.fonts].some((f) => f.status === 'loaded'),
    );
    return page.evaluate(async (t) => {
      await document.fonts.ready;
      // The canvas 2D `font` shorthand takes the same stack the map draws with.
      const stack = getComputedStyle(document.body).fontFamily;
      const paint = (weight: number): number => {
        const c = document.createElement('canvas');
        c.width = 200;
        c.height = 200;
        const ctx = c.getContext('2d')!;
        ctx.font = `${weight} 96px ${stack}`;
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#000';
        ctx.fillText(t, 20, 100);
        const px = ctx.getImageData(0, 0, 200, 200).data;
        let lit = 0;
        for (let i = 3; i < px.length; i += 4) if (px[i] > 8) lit++;
        return lit;
      };
      return { regular: paint(400), bold: paint(700) };
    }, text);
  }

  test('a bold ✈ paints exactly the same ink as a regular one', async ({ page }) => {
    await seedAndOpen(page, fourInLine);
    const { regular, bold } = await ink(page, AIR);

    // Sanity: the glyph is actually being drawn, not dropped.
    expect(regular).toBeGreaterThan(0);
    // The face claims 100–900, so 700 matches it as-is and paints the identical
    // outline. Any synthesis would thicken it and light up more pixels.
    expect(bold).toBe(regular);
  });

  test('the text face still bolds for real (the check above can fail)', async ({ page }) => {
    // Guards the test above from passing vacuously. Söhne ships a real 700, so
    // ordinary text MUST lay down more ink — if this ever stops being true, the
    // ✈ assertion is no longer evidence of anything.
    //
    // Only THIS half needs the real faces. `stageFonts.mjs` stands DejaVu Sans
    // in under all sixteen filenames, so the 700 face and the 400 face are the
    // same bytes and 'Hoboken' paints identical ink at both — a guard that can
    // only ever fail, on a fact about the staging rather than about the font.
    // The ✈ check above keeps running: it rides on Massimo Symbols and DejaVu,
    // which are committed and real wherever this runs.
    test.skip(onSubstituteFaces, 'the stand-in has no 700 distinct from its 400');
    await seedAndOpen(page, fourInLine);
    const { regular, bold } = await ink(page, 'Hoboken');
    expect(bold).toBeGreaterThan(regular);
  });
});
