import { describe, it, expect, beforeEach } from 'vitest';
import { textLabelAlignRectLocal } from './stationBoundary';
import { _clearTextMeasureCache } from './textMeasure';
import { stubTextMetrics, type FakeTextMetrics } from '../test/textMetrics';
import { makeTextLabel } from '../test/fixtures';
import type { TextLabelAlign } from '../model/types';

// Fixed-width glyphs whose ink is INSET from the pen box at both ends — the
// left-side-bearing every real glyph has. Lines are POSITIONED by pen advance
// (the even-edge doctrine, see LabelView.lineCursorX), so a box that spans the
// pen extent shows a proportional empty strip before the first glyph's ink.
// The alignment box must span the INK instead.
const CHAR = 10;
const INSET = 2;
const AT_SIZE = 16; // the labels below measure at fontSize 16
const insetMetrics = (s: string, fontPx: number): FakeTextMetrics => {
  const f = fontPx / AT_SIZE;
  const advance = s.length * CHAR * f;
  const hasInk = s.trim().length > 0;
  return {
    width: advance,
    // Negative actualBoundingBoxLeft ⇒ ink starts RIGHT of the pen origin.
    actualBoundingBoxLeft: hasInk ? -INSET * f : 0,
    actualBoundingBoxRight: hasInk ? advance - INSET * f : 0,
  };
};
stubTextMetrics(insetMetrics);
beforeEach(() => _clearTextMeasureCache());

const rectOf = (text: string, align: TextLabelAlign) =>
  textLabelAlignRectLocal(makeTextLabel({ id: 'g', text, align, fontSize: 16 }));

describe('textLabelAlignRectLocal — horizontal extent is ink, not the pen box', () => {
  // 'Hi': advance 20, ink [2, 18] relative to the pen origin → inkWidth 16,
  // halfW 8. The pen box is [-8, 8]; the ink sits 2 further right.
  it('left align: the box starts at the first glyph ink, not the pen origin', () => {
    const r = rectOf('Hi', 'left');
    expect(r.x0).toBeCloseTo(-8 + INSET, 5);
    expect(r.x1).toBeCloseTo(-8 + 18, 5);
  });

  it('right align: the box ends at the last glyph ink', () => {
    // Pen start = halfW - advance = -12; ink spans [-10, 6].
    const r = rectOf('Hi', 'right');
    expect(r.x0).toBeCloseTo(-10, 5);
    expect(r.x1).toBeCloseTo(8 - INSET, 5);
  });

  it('center align: symmetric insets cancel', () => {
    const r = rectOf('Hi', 'center');
    expect(r.x0).toBeCloseTo(-8, 5);
    expect(r.x1).toBeCloseTo(8, 5);
  });

  it('multi-line: the block extent is the min/max over the rendered lines', () => {
    // 'Hi' (advance 20) over 'Hiii' (advance 40): m.width = max inkWidth = 36,
    // halfW 18, both pens start at -18. Line 1 ink [-16, 0], line 2 [-16, 20].
    const r = rectOf('Hi\nHiii', 'left');
    expect(r.x0).toBeCloseTo(-16, 5);
    expect(r.x1).toBeCloseTo(20, 5);
  });

  it('column mode: the left edge hugs ink, the right edge shows the authored width', () => {
    // 'Hi' (ink [2, 18] pen-relative) in an 80-wide column, left-aligned:
    // pen at -40, ink starts at -38 — the box must start AT the ink (no
    // side-bearing strip), while the right edge reaches the wrap width.
    const r = textLabelAlignRectLocal(
      makeTextLabel({ id: 'g', text: 'Hi', align: 'left', fontSize: 16, width: 80 }),
    );
    expect(r.x0).toBeCloseTo(-40 + INSET, 5);
    expect(r.x1).toBeCloseTo(40, 5);
  });

  it('justify: a stretched interior line is pen-flush to both edges, ink inset', () => {
    // 'a b' (advance 30, ink [2, 28]) stretches to fill the box; 'Hi' is the
    // ragged last line (left-flush). m.width = 26, halfW = 13. Stretched line
    // ink: [-13 + 2, 13 - 2]; last line ink: [-11, 5]. The block's right edge
    // comes from the STRETCHED line's end inset, not its unstretched advance.
    const r = rectOf('a b\nHi', 'justify');
    expect(r.x0).toBeCloseTo(-11, 5);
    expect(r.x1).toBeCloseTo(11, 5);
  });
});
