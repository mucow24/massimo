import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type * as opentype from 'opentype.js';
import { bakeLetterSpacing, normalizeTextBaselines } from '../export/pdfText';
import { outlineUnsupportedText } from '../export/pdfGlyphs';

/**
 * PDF export drops tracking on a text run that shares its <text> with an
 * HN-uncovered glyph.
 *
 * Reachability: `<xfer>` expands to ↔ INSIDE the surrounding text buffer
 * (labelTokens.ts scanLine: `buffer += XFER_GLYPH`), and a tracked label emits
 * one <text> per styled run carrying `letter-spacing`
 * (stationLabelText.tsx:237 / LabelView.tsx:228). So "<xfer> Transfer here" with
 * tracking ≠ 0 is a single <text letter-spacing="…">↔ Transfer here</text>.
 *
 * jsdom has no SVG text layout, so the stubs below are a minimal but faithful
 * model of one: a uniform GLYPH_W advance per character, plus the browser rules
 * the two production passes rely on —
 *   • `letter-spacing` adds its gap after EVERY glyph (incl. the last), and
 *     getComputedTextLength folds that in (pinned by pdfText.test.ts:84-102);
 *   • `textLength` + `lengthAdjust="spacing"` spreads (textLength − natural)
 *     across the n−1 inter-glyph gaps.
 * Under bakeLetterSpacing's own formula (textLength = tracked − spacing) those
 * two produce IDENTICAL inter-glyph gaps, which is why char pen positions read
 * back tracked either way.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const ARROW = 0x2194; // ↔, the <xfer> glyph — not in Helvetica Neue (pdfGlyphs.test.ts:163)
const GLYPH_W = 6; // natural advance of every character in the model font
const SPACING = 1.8; // 0.15em tracking at font-size 12
const X0 = 100;
const BASELINE_Y = 50;
const CONTENT = '↔ Transfer here';
const COVERED = ' Transfer here'; // the run left after the arrow is outlined

const num = (el: Element, name: string, fallback = 0): number => {
  const v = el.getAttribute(name);
  const n = v === null ? NaN : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};
const naturalAdvance = (el: Element): number => (el.textContent ?? '').length * GLYPH_W;

/** Inter-glyph gap the browser would apply to this element right now. */
const gapOf = (el: Element): number => {
  const ls = el.getAttribute('letter-spacing');
  if (ls !== null) return parseFloat(ls) || 0;
  const tl = el.getAttribute('textLength');
  if (tl !== null && el.getAttribute('lengthAdjust') === 'spacing') {
    const n = (el.textContent ?? '').length;
    if (n > 1) return ((parseFloat(tl) || 0) - naturalAdvance(el)) / (n - 1);
  }
  return 0;
};

/** What svg2pdf will actually print this run at: textLength when set, else the
 * font's natural advance (it has no notion of letter-spacing). */
const pdfAdvance = (el: Element): number => {
  const tl = el.getAttribute('textLength');
  return tl !== null ? parseFloat(tl) || 0 : naturalAdvance(el);
};

type Stubbed = Record<string, unknown>;
const saved: Record<string, unknown> = {};
beforeAll(() => {
  const proto = SVGElement.prototype as unknown as Stubbed;
  for (const k of ['getComputedTextLength', 'getStartPositionOfChar', 'getBBox'])
    saved[k] = proto[k];
  proto.getComputedTextLength = function (this: Element): number {
    // With letter-spacing applied the browser reports natural + gap·n (a gap
    // after every glyph). With textLength applied it reports textLength.
    if (this.getAttribute('letter-spacing') !== null) {
      return naturalAdvance(this) + gapOf(this) * (this.textContent ?? '').length;
    }
    const tl = this.getAttribute('textLength');
    return tl !== null ? parseFloat(tl) || 0 : naturalAdvance(this);
  };
  proto.getStartPositionOfChar = function (this: Element, i: number) {
    return { x: num(this, 'x', X0) + i * (GLYPH_W + gapOf(this)), y: num(this, 'y', BASELINE_Y) };
  };
  proto.getBBox = function (this: Element) {
    // The fixture is already on the alphabetic baseline, so the box does not
    // move when normalizeTextBaselines forces dominant-baseline="alphabetic".
    return { x: num(this, 'x', X0), y: num(this, 'y', BASELINE_Y) - 9, width: 1, height: 12 };
  };
});
afterAll(() => {
  const proto = SVGElement.prototype as unknown as Stubbed;
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete proto[k];
    else proto[k] = v;
  }
});

/** Minimal opentype.Font stand-in (same shape pdfGlyphs.test.ts uses). */
const fakeFont = (covered: (cp: number) => boolean): opentype.Font =>
  ({
    charToGlyphIndex: (ch: string) => (covered(ch.codePointAt(0) ?? -1) ? 7 : 0),
    getPath: (_t: string, x: number, y: number) => ({
      commands: [{ type: 'M', x, y }, { type: 'L', x: x + 1, y: y - 1 }, { type: 'Z' }],
    }),
  }) as unknown as opentype.Font;

const fonts = {
  hn: fakeFont((cp) => cp !== ARROW),
  symbols: [fakeFont((cp) => cp === ARROW)],
};

describe('PDF export: tracking on a run that shares its <text> with an outlined glyph', () => {
  it('keeps the tracked advance on the covered run', () => {
    const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    const text = document.createElementNS(SVG_NS, 'text') as SVGTextElement;
    text.setAttribute('x', String(X0));
    text.setAttribute('y', String(BASELINE_Y));
    text.setAttribute('text-anchor', 'start');
    text.setAttribute('letter-spacing', String(SPACING));
    text.setAttribute('fill', '#111');
    text.textContent = CONTENT;
    svg.appendChild(text);
    document.body.appendChild(svg);

    try {
      // The shipped pass order. The tracking bake runs LAST, after glyph
      // outlining has split the mixed run — so both halves are still carrying
      // real `letter-spacing` when the outliner reads their char positions, and
      // the covered run it mints gets baked like any other tracked text.
      normalizeTextBaselines(svg);
      outlineUnsupportedText(svg, fonts);
      bakeLetterSpacing(svg);

      const runs = [...svg.querySelectorAll('text')];
      expect(runs).toHaveLength(1); // the arrow became a <path>; one covered run left
      const run = runs[0];
      expect(run.textContent).toBe(COVERED);

      // The arrow kept its tracked pen position: the run starts one tracked
      // advance to the right of the element origin.
      expect(parseFloat(run.getAttribute('x')!)).toBeCloseTo(X0 + (GLYPH_W + SPACING), 6);

      // …so the run must also print tracked, or the PDF shows a gap after the
      // arrow and visibly tighter type. Tracked width = natural + spacing per
      // inter-glyph gap (13 gaps over 14 characters).
      const tracked = COVERED.length * GLYPH_W + SPACING * (COVERED.length - 1);
      expect(pdfAdvance(run)).toBeCloseTo(tracked, 6);
    } finally {
      document.body.removeChild(svg);
    }
  });
});
