import { describe, it, expect, beforeEach } from 'vitest';
import { measureAdvance, measureTextLabel, _clearTextMeasureCache } from './textMeasure';
import { stubTextMetrics } from '../test/textMetrics';
import { makeTextLabel } from '../test/fixtures';

// Chrome quantizes `actualBoundingBox*` to WHOLE PIXELS at the measured font
// size, and the measurer measures at fontSize-as-px — so ink bounds carry up
// to ~a whole world unit of slop at any size, which the alignment box shows
// as a ring-vs-ink sliver at high zoom. This stub reproduces that rounding at
// whatever size it is asked to measure; the sub-pixel truth (a 1.5-unit ink
// inset) is only recoverable by measuring at a large multiple and scaling
// down, which is exactly what `measureTextSegment` must do for bearings.
const AT_SIZE = 16;
const CHAR = 10;
const INSET = 1.5; // true ink inset from the pen box, NOT integer at 1x
const measuredPx: number[] = []; // every font px size a measure ran at
stubTextMetrics((s: string, fontPx: number) => {
  measuredPx.push(fontPx);
  const f = fontPx / AT_SIZE;
  const advance = s.length * CHAR * f; // advances are floats, not quantized
  const hasInk = s.trim().length > 0;
  return {
    width: advance,
    actualBoundingBoxLeft: hasInk ? Math.round(-INSET * f) : 0,
    actualBoundingBoxRight: hasInk ? Math.round((s.length * CHAR - INSET) * f) : 0,
  };
});
beforeEach(() => {
  _clearTextMeasureCache();
  measuredPx.length = 0;
});

describe('measureTextLabel — ink bearings survive the browser px quantization', () => {
  it('recovers the sub-pixel ink inset a base-size measure rounds away', () => {
    const m = measureTextLabel(makeTextLabel({ id: 'g', text: 'Hi', fontSize: AT_SIZE }));
    // bearingLeft = -inkLeft. A base-size-only measure reads round(-1.5) = -1
    // and reports -1; the hi-res re-measure recovers the true -1.5.
    expect(m.lines[0].bearingLeft).toBeCloseTo(-INSET, 5);
    expect(m.lines[0].bearingRight).toBeCloseTo(2 * CHAR - INSET, 5);
  });

  it('advances stay on the base-size measure (layout must not shift)', () => {
    const m = measureTextLabel(makeTextLabel({ id: 'g', text: 'Hi', fontSize: AT_SIZE }));
    expect(m.lines[0].advanceWidth).toBeCloseTo(2 * CHAR, 5);
  });

  it('measureAdvance skips the bearing ladder entirely (advance-only, hot paths)', () => {
    // measureAdvance reads only the pen advance, and it is UNCACHED on
    // per-frame paths (justify positions every word/space per render). It
    // must run exactly one base-size measure — no 64x re-measure, no raster
    // probe work.
    const adv = measureAdvance('Hi', AT_SIZE, 400, false);
    expect(adv).toBeCloseTo(2 * CHAR, 5);
    expect(measuredPx).toEqual([AT_SIZE]);
  });
});
