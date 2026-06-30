/**
 * Text-baseline correction for the PDF export.
 *
 * svg2pdf ignores `dominant-baseline` entirely — it only consults
 * `vertical-align` / `alignment-baseline` and otherwise places every glyph on
 * the **alphabetic** baseline. The app positions virtually all text with
 * `dominant-baseline` (`central` for bullets / line tags / station names,
 * `hanging` for free labels, `text-before/after-edge` for some labels), so in
 * the PDF every run lands too high.
 *
 * Rather than reimplement per-mode baseline math, we measure: for each `<text>`
 * compare its rendered box (browser, with the original baseline applied) to its
 * alphabetic box, and shift `y` by the difference. The browser's own layout is
 * the source of truth, so the result is exact for every baseline mode and font
 * without knowing any font metrics. We then leave the element on the alphabetic
 * baseline — the one svg2pdf actually honors.
 */

export interface CharPos {
  cp: number;
  x: number;
  y: number;
}

export type TextRunPiece =
  | { kind: 'text'; x: number; y: number; text: string }
  | { kind: 'glyph'; x: number; y: number; cp: number };

/**
 * Split a positioned character sequence into renderable pieces: maximal runs of
 * covered characters (kept as selectable text, each carrying its start point)
 * and individual uncovered characters (to be drawn as outline glyphs). A covered
 * run is also broken whenever the baseline `y` jumps by more than `lineEps`, so
 * a multi-line text element yields one run per line. Each piece carries an
 * absolute position, so the caller can place them independently and the absence
 * of the uncovered glyphs never reflows the covered text.
 */
export function partitionRuns(
  chars: CharPos[],
  isCovered: (cp: number) => boolean,
  lineEps = 0.5,
): TextRunPiece[] {
  const pieces: TextRunPiece[] = [];
  let run: { x: number; y: number; text: string } | null = null;
  const flush = () => {
    if (run && run.text) pieces.push({ kind: 'text', ...run });
    run = null;
  };
  for (const c of chars) {
    if (!isCovered(c.cp)) {
      flush();
      pieces.push({ kind: 'glyph', x: c.x, y: c.y, cp: c.cp });
      continue;
    }
    if (run && Math.abs(c.y - run.y) > lineEps) flush(); // new line
    if (!run) run = { x: c.x, y: c.y, text: '' };
    run.text += String.fromCodePoint(c.cp);
  }
  flush();
  return pieces;
}

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
