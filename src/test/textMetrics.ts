// Shared canvas-metrics stubs for the label-measuring tests.
//
// `measureTextLabel` reaches for an offscreen 2D context, and jsdom ships no
// canvas backend — left alone it falls back to a length-based estimate, which
// hides every bug about ink bearings. So each of these tests installs a fake
// context whose `measureText` reports metrics a real font would.
//
// The METRIC MODEL is the interesting part and differs per test; installing it
// does not, and neither do the two models more than one file needs. Both live
// here so a file cannot quietly grow a third variant of "10px glyphs, ink box
// excludes the spaces" that disagrees with the other two.

import { afterEach, beforeEach } from 'vitest';

/** The three `measureText` fields `textMeasure` reads. */
export interface FakeTextMetrics {
  width: number;
  actualBoundingBoxLeft: number;
  actualBoundingBoxRight: number;
}

/**
 * Hand `ctx` to every `canvas.getContext()` for this file's tests.
 *
 * Call at module scope. Patches in `beforeEach` and restores in `afterEach`
 * (not `beforeAll`/`afterAll`) for the reason `stubCanvasHostSize` does: a file
 * that throws mid-test cannot then leave a patched prototype standing for the
 * rest of the run.
 *
 * `ctx` is handed over as-is, so a stub carrying mutable state — a per-character
 * advance a test swaps mid-run, a `letterSpacing` accessor — keeps working: the
 * context object is read at call time, not copied here.
 */
export function stubCanvas2d(ctx: object): void {
  let original: typeof HTMLCanvasElement.prototype.getContext;
  beforeEach(() => {
    original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function () {
      return ctx as CanvasRenderingContext2D;
    } as unknown as typeof HTMLCanvasElement.prototype.getContext;
  });
  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = original;
  });
}

/** `stubCanvas2d` for a context whose only behaviour is `measureText`. */
export function stubTextMetrics(measureText: (s: string) => FakeTextMetrics): void {
  stubCanvas2d({ font: '', measureText });
}

/**
 * Fixed-width glyphs whose ink box excludes leading/trailing whitespace — the
 * asymmetry a real canvas has and the one several bugs hinge on: `width`
 * (advance) counts typed spaces, `actualBoundingBox*` (ink) does not.
 *
 * Bearings are measured from the pen origin and `actualBoundingBoxLeft` is
 * positive going LEFT, so ink pushed right by leading spaces reads negative.
 */
export function whitespaceAwareMetrics(char: number) {
  return (s: string): FakeTextMetrics => {
    const advance = s.length * char;
    const lead = (/^\s*/.exec(s)?.[0].length ?? 0) * char;
    const trail = (/\s*$/.exec(s)?.[0].length ?? 0) * char;
    const hasInk = s.trim().length > 0;
    return {
      width: advance,
      actualBoundingBoxLeft: hasInk ? -lead : 0,
      actualBoundingBoxRight: hasInk ? advance - trail : 0,
    };
  };
}

/**
 * Fixed-width glyphs whose ink OVERHANGS the pen box at the ends: an 'f'-initial
 * word hooks 3px left of the pen origin, a 'j'-final word tails 3px right of its
 * advance, everything else sits flush inside its advance.
 *
 * This is the shape that proves multi-line labels flush by pen advance (an even
 * edge) rather than by raw ink (ragged), so the station and free-label renderers
 * are both held to it — and to the same numbers, since the whole point is that
 * the two agree.
 */
export function inkOverhangMetrics(char: number, overhang = 3) {
  return (s: string): FakeTextMetrics => {
    const advance = s.length * char;
    const hasInk = s.trim().length > 0;
    const leftOver = hasInk && s.trimStart().startsWith('f') ? overhang : 0;
    const rightOver = hasInk && s.trimEnd().endsWith('j') ? overhang : 0;
    return {
      width: advance,
      // +ve actualBoundingBoxLeft ⇒ ink extends LEFT of the pen origin.
      actualBoundingBoxLeft: leftOver,
      actualBoundingBoxRight: hasInk ? advance + rightOver : 0,
    };
  };
}
