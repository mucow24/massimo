/**
 * Text-baseline normalization for the exports.
 *
 * The glyph tracer reads pen positions with `getStartPositionOfChar`, which
 * reports them on the **alphabetic** baseline — the one `opentype`'s `getPath`
 * also draws from. The app positions virtually all text with
 * `dominant-baseline` instead (`central` for bullets / line tags / station
 * names, `hanging` for free labels, `text-before/after-edge` for some), so every
 * run has to be re-expressed on the alphabetic baseline before it is traced or
 * the outlines land too high.
 *
 * Rather than reimplement per-mode baseline math, we measure: for each `<text>`
 * compare its rendered box (browser, with the original baseline applied) to its
 * alphabetic box, and shift `y` by the difference. The browser's own layout is
 * the source of truth, so the result is exact for every baseline mode and font
 * without knowing any font metrics.
 */

/** Shift a `<text>` element's vertical position by `dy` (its `y`, defaulting to
 * 0, plus any descendant `<tspan>` carrying an absolute `y`; relative `dy`
 * tspans ride along unchanged). No-op when `dy` is 0. */
export function shiftTextY(text: SVGTextElement, dy: number): void {
  if (dy === 0) return;
  const y = parseFloat(text.getAttribute('y') ?? '0') || 0;
  text.setAttribute('y', String(y + dy));
  for (const tspan of text.querySelectorAll('tspan')) {
    const ty = tspan.getAttribute('y');
    if (ty !== null) tspan.setAttribute('y', String((parseFloat(ty) || 0) + dy));
  }
}

/**
 * Re-baseline every `<text>` in the (offscreen, attached) export clone so
 * svg2pdf's alphabetic-only placement reproduces the browser's rendering.
 *
 * For each text: measure its current box, force `dominant-baseline="alphabetic"`
 * (dropping any `alignment-baseline`), measure again, and shift `y` by the
 * delta. Texts already on the alphabetic baseline measure equal → no shift.
 * Must run while the SVG is in the document so `getBBox` resolves.
 */
export function normalizeTextBaselines(svg: SVGSVGElement): void {
  for (const text of svg.querySelectorAll('text')) {
    let currentTop: number;
    try {
      const box = text.getBBox();
      if (!(box.height > 0)) continue; // empty / unmeasurable run
      currentTop = box.y;
    } catch {
      continue;
    }
    // Force the baseline svg2pdf assumes, then measure where the glyphs land.
    text.setAttribute('dominant-baseline', 'alphabetic');
    text.removeAttribute('alignment-baseline');
    let alphabeticTop: number;
    try {
      alphabeticTop = text.getBBox().y;
    } catch {
      continue;
    }
    shiftTextY(text, currentTop - alphabeticTop);
  }
}
