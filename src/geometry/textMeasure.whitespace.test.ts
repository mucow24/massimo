import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { measureTextLabel, _clearTextMeasureCache } from './textMeasure';

// A faithful-enough stand-in for a real browser 2D context. The point of the
// stub is the asymmetry that the production bug hinges on:
//   - `width` (advance) INCLUDES whitespace, but
//   - `actualBoundingBox*` (ink box) EXCLUDES leading/trailing whitespace.
// jsdom ships no canvas backend, so without this stub measureTextLabel falls
// back to a length-based estimate that happens to count spaces — which hides
// the bug. With a real canvas (the actual app), typed leading/trailing spaces
// are dropped from the measured width.
const CHAR = 10;
function fakeMeasureText(s: string) {
  const advance = s.length * CHAR;
  const lead = (/^\s*/.exec(s)?.[0].length ?? 0) * CHAR;
  const trail = (/\s*$/.exec(s)?.[0].length ?? 0) * CHAR;
  const hasInk = s.trim().length > 0;
  // Ink box spans [lead, advance - trail]. Bearings are measured from the pen
  // origin (x = 0); `actualBoundingBoxLeft` is positive going LEFT, so ink
  // sitting to the right of the origin (leading spaces) yields a negative
  // left bearing.
  return {
    width: advance,
    actualBoundingBoxLeft: hasInk ? -lead : 0,
    actualBoundingBoxRight: hasInk ? advance - trail : 0,
  };
}

let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;

beforeAll(() => {
  originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function () {
    return { font: '', measureText: fakeMeasureText } as unknown as CanvasRenderingContext2D;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
});

afterAll(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});

beforeEach(() => {
  _clearTextMeasureCache();
});

const styled = (text: string) => ({ text, fontSize: 12, weight: 400, italic: false });

describe('measureTextLabel — whitespace is not collapsed', () => {
  it('counts leading whitespace toward the measured width', () => {
    const plain = measureTextLabel(styled('Foo'));
    const lead = measureTextLabel(styled('     Foo'));
    expect(lead.width).toBeCloseTo(plain.width + 5 * CHAR, 5);
  });

  it('counts trailing whitespace toward the measured width', () => {
    const plain = measureTextLabel(styled('Foo'));
    const trail = measureTextLabel(styled('Foo     '));
    expect(trail.width).toBeCloseTo(plain.width + 5 * CHAR, 5);
  });

  it('counts whitespace on both sides of the ink', () => {
    const plain = measureTextLabel(styled('Foo'));
    const padded = measureTextLabel(styled('  Foo   '));
    expect(padded.width).toBeCloseTo(plain.width + 5 * CHAR, 5);
  });

  it('leading whitespace shifts the line ink-start to the pen origin', () => {
    // The bullet-render path positions each line by its ink bearings; if the
    // leading whitespace is dropped, the visible glyphs render where they'd
    // sit with no spaces at all (the collapse the user sees). Once preserved,
    // the line's left ink edge sits at the pen origin (bearingLeft === 0).
    const lead = measureTextLabel(styled('     Foo'));
    expect(lead.lines[0].bearingLeft).toBeCloseTo(0, 5);
  });
});
