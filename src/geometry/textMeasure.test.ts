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
    const m = measureTextLabel(makeTextLabel({ id: 'g', text: 'short\nmuchlonger', fontSize: 16 }));
    expect(m.width).toBe(Math.max(m.lines[0].inkWidth, m.lines[1].inkWidth));
  });

  it('empty line has zero ink width and zero bearings', () => {
    const m = measureTextLabel(makeTextLabel({ id: 'g', text: 'a\n\nb' }));
    expect(m.lines[1].inkWidth).toBe(0);
    expect(m.lines[1].bearingLeft).toBe(0);
    expect(m.lines[1].bearingRight).toBe(0);
  });

  it('exposes parsed segments per line', () => {
    const m = measureTextLabel(makeTextLabel({ id: 'g', text: 'Take |A1| uptown\nstraight' }));
    expect(m.lines[0].segments.map((s) => s.kind)).toEqual(['text', 'bullet', 'text']);
    expect(m.lines[1].segments.map((s) => s.kind)).toEqual(['text']);
  });

  it('threads bullet shape and fill through segment metrics', () => {
    const m = measureTextLabel(makeTextLabel({ id: 'g', text: '[A1] ||B2||' }));
    const bullets = m.lines[0].segments.filter((s) => s.kind === 'bullet');
    expect(bullets).toMatchObject([
      { code: 'A1', shape: 'square', filled: true },
      { code: 'B2', shape: 'circle', filled: false },
    ]);
  });

  it('bullet segment width scales with fontSize', () => {
    const small = measureTextLabel(makeTextLabel({ id: 'g', text: '|A1|', fontSize: 12 }));
    const big = measureTextLabel(makeTextLabel({ id: 'g', text: '|A1|', fontSize: 48 }));
    expect(big.lines[0].inkWidth).toBeGreaterThan(small.lines[0].inkWidth);
  });

  it('bullet diameter is less than fontSize (shorter than the font height)', () => {
    const fontSize = 16;
    const m = measureTextLabel(makeTextLabel({ id: 'g', text: '|A1|', fontSize }));
    expect(m.lines[0].inkWidth).toBeLessThan(fontSize);
    expect(m.lines[0].inkWidth).toBeGreaterThan(fontSize * 0.5);
  });
});

describe('measureTextLabel — formatting tags', () => {
  beforeEach(() => {
    _clearTextMeasureCache();
  });

  it('parses tags and attaches styles to text segments', () => {
    const m = measureTextLabel(makeTextLabel({ id: 'g', text: '<b>Bold</b> plain' }));
    const segs = m.lines[0].segments;
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ kind: 'text', value: 'Bold', style: { bold: true } });
    expect(segs[1]).toMatchObject({ kind: 'text', value: ' plain' });
    expect((segs[1] as { style?: unknown }).style).toBeUndefined();
  });

  it('excludes tag characters from the measured width', () => {
    // Formatted parsing drops the tag delimiters, so the bold "ab" is far
    // narrower than the raw "<b>ab</b>" text the edit-mode (literalBullets)
    // measurement keeps.
    const tagged = measureTextLabel(makeTextLabel({ id: 'g', text: '<b>ab</b>' }));
    const literal = measureTextLabel({
      text: '<b>ab</b>',
      fontSize: 16,
      weight: 400,
      italic: false,
      literalBullets: true,
    });
    expect(tagged.width).toBeLessThan(literal.width);
  });

  it('substitutes <air>/<xfer> glyphs', () => {
    const m = measureTextLabel(makeTextLabel({ id: 'g', text: '<air>' }));
    expect(m.lines[0].segments).toEqual([expect.objectContaining({ kind: 'text', value: '✈' })]);
  });

  it('carries an open tag across newlines and exposes per-line entry state', () => {
    const m = measureTextLabel(makeTextLabel({ id: 'g', text: '<b>a\nb</b>c' }));
    expect(m.lines[0].segments[0]).toMatchObject({ value: 'a', style: { bold: true } });
    expect(m.lines[1].segments[0]).toMatchObject({ value: 'b', style: { bold: true } });
    expect(m.lines[1].segments[1]).toMatchObject({ value: 'c' });
    expect(m.lines[0].entryStyle?.bold).toBe(0);
    expect(m.lines[1].entryStyle?.bold).toBe(1);
  });

  it('carries an open tag across column-mode word wraps', () => {
    // jsdom has no canvas: widths fall back to len * fontSize * 0.55.
    // fontSize 10 → 5.5/char; 'aa bb' = 27.5 > 20 → wraps after 'aa'.
    const m = measureTextLabel({
      text: '<b>aa bb</b>',
      fontSize: 10,
      weight: 400,
      italic: false,
      width: 20,
    });
    expect(m.lineCount).toBe(2);
    expect(m.lines[0].segments[0]).toMatchObject({ value: 'aa', style: { bold: true } });
    expect(m.lines[1].segments[0]).toMatchObject({ value: 'bb', style: { bold: true } });
  });
});

describe('measureTextLabel — leading and tracking', () => {
  beforeEach(() => {
    _clearTextMeasureCache();
  });

  it('leading scales the space between lines but not a single line', () => {
    const three = measureTextLabel(
      makeTextLabel({ id: 'g', text: 'a\nb\nc', fontSize: 20, leading: 0.5 }),
    );
    // One full line height plus two half-spacings.
    expect(three.height).toBeCloseTo(20 * LINE_HEIGHT * (1 + 2 * 0.5), 5);
    const one = measureTextLabel(makeTextLabel({ id: 'g', text: 'a', fontSize: 20, leading: 0.5 }));
    expect(one.height).toBeCloseTo(20 * LINE_HEIGHT, 5);
  });

  it('tracking widens text lines', () => {
    const plain = measureTextLabel(makeTextLabel({ id: 'g', text: 'Hello', fontSize: 10 }));
    const tracked = measureTextLabel(
      makeTextLabel({ id: 'g', text: 'Hello', fontSize: 10, tracking: 0.2 }),
    );
    expect(tracked.width).toBeGreaterThan(plain.width);
  });

  it('keeps different leading/tracking values in distinct cache entries', () => {
    const a = measureTextLabel(makeTextLabel({ id: 'g', text: 'X' }));
    const b = measureTextLabel(makeTextLabel({ id: 'g', text: 'X', tracking: 0.3 }));
    const c = measureTextLabel(makeTextLabel({ id: 'g', text: 'X', leading: 1.5 }));
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('measureTextLabel — literalBullets (edit-mode measurement)', () => {
  beforeEach(() => {
    _clearTextMeasureCache();
  });

  it('measures |CODE| tokens as their literal glyphs, not a collapsed bullet', () => {
    const styled = { text: 'Hub |A1| |B2|', fontSize: 12, weight: 400, italic: false };
    const collapsed = measureTextLabel(styled);
    const literal = measureTextLabel({ ...styled, literalBullets: true });
    // The raw "|A1|" string is wider than the bullet it collapses to, so the
    // literal measurement (what the textarea shows in edit mode) is wider.
    expect(literal.width).toBeGreaterThan(collapsed.width);
    // Literal path emits no bullet segments — the line is plain text.
    expect(literal.lines[0].segments.every((s) => s.kind === 'text')).toBe(true);
    expect(collapsed.lines[0].segments.some((s) => s.kind === 'bullet')).toBe(true);
  });

  it('keeps literal vs collapsed measurements in distinct cache entries', () => {
    const styled = { text: 'Hub |A1|', fontSize: 12, weight: 400, italic: false };
    const collapsed = measureTextLabel(styled);
    const literal = measureTextLabel({ ...styled, literalBullets: true });
    expect(literal).not.toBe(collapsed);
  });

  it('is a no-op for names without tokens (plain text measures the same)', () => {
    const styled = { text: 'Plain Name', fontSize: 12, weight: 400, italic: false };
    const collapsed = measureTextLabel(styled);
    _clearTextMeasureCache();
    const literal = measureTextLabel({ ...styled, literalBullets: true });
    expect(literal.width).toBeCloseTo(collapsed.width, 5);
  });
});
