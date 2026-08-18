import { describe, it, expect, beforeEach } from 'vitest';
import { _clearTextMeasureCache, blockInkExtentX, measureTextLabel } from './textMeasure';
import { stubTextMetrics, type FakeTextMetrics } from '../test/textMetrics';

// The same inset-glyph model `stationBoundary.inkExtent.test.ts` uses: fixed
// advances with the ink held INSET from the pen box at both ends, so a box
// drawn on the pen extent and a box drawn on the ink are distinguishable.
const CHAR = 10;
const INSET = 2;
const AT_SIZE = 16;
const insetMetrics = (s: string, fontPx: number): FakeTextMetrics => {
  const f = fontPx / AT_SIZE;
  const advance = s.length * CHAR * f;
  const hasInk = s.trim().length > 0;
  return {
    width: advance,
    actualBoundingBoxLeft: hasInk ? -INSET * f : 0,
    actualBoundingBoxRight: hasInk ? advance - INSET * f : 0,
  };
};
stubTextMetrics(insetMetrics);
beforeEach(() => _clearTextMeasureCache());

const measure = (text: string, width?: number) =>
  measureTextLabel({ text, fontSize: AT_SIZE, weight: 400, italic: false, width });

describe('blockInkExtentX — justify', () => {
  it('a line justifyLine bailed on is boxed where it actually paints', () => {
    // Auto mode: `m.width` is the widest line's INK (26 for 'a b': advance 30,
    // ink [2, 28]) while justify measures its slack against the PEN advance, so
    // the widest line always has slack < 0 and LabelView left-flushes it. halfW
    // = 13, so line 0's pen sits at -13 and its ink runs to -13 + 28 = 15.
    const r = blockInkExtentX(measure('a b\nHi'), 'justify');
    expect(r).not.toBeNull();
    expect(r!.left).toBeCloseTo(-11, 5);
    expect(r!.right).toBeCloseTo(15, 5);
  });

  it('a line with real slack is still boxed pen-flush to both edges', () => {
    // Column mode, width 60: 'aa bb cc dd' wraps to 'aa bb' (advance 50, slack
    // 10 — genuinely stretched) over 'cc dd' (the ragged paragraph end).
    // Stretched: ink [-30 + 2, 30 - (50 - 48)]. Ragged: pen at -30, ink to 18.
    const r = blockInkExtentX(measure('aa bb cc dd', 60), 'justify');
    expect(r).not.toBeNull();
    expect(r!.left).toBeCloseTo(-28, 5);
    expect(r!.right).toBeCloseTo(28, 5);
  });
});
