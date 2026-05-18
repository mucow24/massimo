import { describe, it, expect, beforeEach } from 'vitest';
import { LINE_HEIGHT, _clearTextMeasureCache, measureTextLabel } from './textMeasure';
import { makeTextLabel } from '../test/fixtures';

describe('measureTextLabel', () => {
  beforeEach(() => {
    _clearTextMeasureCache();
  });

  it('reports one line for a single-line label', () => {
    const m = measureTextLabel(makeTextLabel({ id: 'g', text: 'Hello' }));
    expect(m.lineCount).toBe(1);
    expect(m.lineWidths).toHaveLength(1);
  });

  it('counts every newline-separated line', () => {
    const m = measureTextLabel(makeTextLabel({ id: 'g', text: 'a\nbb\nccc' }));
    expect(m.lineCount).toBe(3);
    expect(m.lineWidths).toHaveLength(3);
  });

  it('treats empty text as a single empty line', () => {
    const m = measureTextLabel(makeTextLabel({ id: 'g', text: '' }));
    expect(m.lineCount).toBe(1);
    expect(m.width).toBe(0);
  });

  it('height = lineCount * fontSize * LINE_HEIGHT', () => {
    const m = measureTextLabel(makeTextLabel({ id: 'g', text: 'a\nb\nc', fontSize: 20 }));
    expect(m.height).toBeCloseTo(3 * 20 * LINE_HEIGHT, 5);
  });

  it('width grows with longer text at the same font size', () => {
    const small = measureTextLabel(makeTextLabel({ id: 'g', text: 'A', fontSize: 16 }));
    const big = measureTextLabel(makeTextLabel({ id: 'g', text: 'AAAAAAAAAA', fontSize: 16 }));
    expect(big.width).toBeGreaterThan(small.width);
  });

  it('width grows with larger font size for the same text', () => {
    const small = measureTextLabel(makeTextLabel({ id: 'g', text: 'Hello', fontSize: 12 }));
    const big = measureTextLabel(makeTextLabel({ id: 'g', text: 'Hello', fontSize: 48 }));
    expect(big.width).toBeGreaterThan(small.width);
  });

  it('returns the cached entry for repeated calls', () => {
    const label = makeTextLabel({ id: 'g', text: 'Cached' });
    const a = measureTextLabel(label);
    const b = measureTextLabel(label);
    expect(b).toBe(a);
  });

  it('treats different weights as distinct cache entries', () => {
    const a = measureTextLabel(makeTextLabel({ id: 'g', text: 'X', weight: 100 }));
    const b = measureTextLabel(makeTextLabel({ id: 'g', text: 'X', weight: 900 }));
    // Same id, same text, different weight → cache misses must not collide.
    // We can't assert exact widths (jsdom or browser canvas vary), but the
    // returned objects must be independent measurements.
    expect(a).not.toBe(b);
  });

  it('returns per-line ink metrics (bearingLeft, bearingRight, inkWidth)', () => {
    const m = measureTextLabel(makeTextLabel({ id: 'g', text: 'Hello\nWorld' }));
    expect(m.lines).toHaveLength(2);
    for (const ln of m.lines) {
      expect(typeof ln.bearingLeft).toBe('number');
      expect(typeof ln.bearingRight).toBe('number');
      expect(typeof ln.inkWidth).toBe('number');
      // The ink span is bearingLeft + bearingRight.
      expect(ln.inkWidth).toBeCloseTo(ln.bearingLeft + ln.bearingRight, 5);
    }
  });

  it('bbox width is the max ink width across lines', () => {
    const m = measureTextLabel(
      makeTextLabel({ id: 'g', text: 'short\nmuchlonger', fontSize: 16 }),
    );
    expect(m.width).toBe(Math.max(m.lines[0].inkWidth, m.lines[1].inkWidth));
  });

  it('empty line has zero ink width and zero bearings', () => {
    const m = measureTextLabel(makeTextLabel({ id: 'g', text: 'a\n\nb' }));
    expect(m.lines[1].inkWidth).toBe(0);
    expect(m.lines[1].bearingLeft).toBe(0);
    expect(m.lines[1].bearingRight).toBe(0);
  });
});
