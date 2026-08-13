import { describe, it, expect, beforeEach } from 'vitest';
import { measureTextLabel, _clearTextMeasureCache } from './textMeasure';
import { stubTextMetrics, whitespaceAwareMetrics } from '../test/textMetrics';

// Fixed-width glyph stub (every char = CHAR px, ignoring font size) so wrap
// points are exactly predictable: a line's ink width === its length * CHAR.
const CHAR = 10;
stubTextMetrics(whitespaceAwareMetrics(CHAR, 10));

beforeEach(() => {
  _clearTextMeasureCache();
});

const styled = (text: string, width?: number) => ({
  text,
  fontSize: 10,
  weight: 400 as const,
  italic: false,
  width,
});

describe('measureTextLabel — Auto mode (width 0) exposes raw + endsParagraph', () => {
  it('splits on newlines; only the final line ends a paragraph', () => {
    const m = measureTextLabel(styled('a\nbb\nccc'));
    expect(m.lineCount).toBe(3);
    expect(m.lines.map((l) => l.raw)).toEqual(['a', 'bb', 'ccc']);
    expect(m.lines.map((l) => l.endsParagraph)).toEqual([false, false, true]);
    // Box still hugs the widest line's ink (ccc = 3 * CHAR).
    expect(m.width).toBe(30);
  });
});

describe('measureTextLabel — column wrapping (width > 0)', () => {
  it('greedily word-wraps a paragraph to the column width', () => {
    const m = measureTextLabel(styled('aa bb cc dd', 50));
    expect(m.lineCount).toBe(2);
    expect(m.lines.map((l) => l.raw)).toEqual(['aa bb', 'cc dd']);
    // Box width is pinned to the column, not the widest ink.
    expect(m.width).toBe(50);
    // Height follows the wrapped line count (2 lines * 10 * 1.2).
    expect(m.height).toBeCloseTo(24, 5);
  });

  it('justify group is per-paragraph: each wrapped paragraph ends ragged only on its last line', () => {
    const m = measureTextLabel(styled('aa bb cc dd', 50));
    expect(m.lines.map((l) => l.endsParagraph)).toEqual([false, true]);
  });

  it("treats a manual '\\n' as a hard paragraph break", () => {
    const m = measureTextLabel(styled('aa bb\ncc dd', 50));
    expect(m.lines.map((l) => l.raw)).toEqual(['aa bb', 'cc dd']);
    // Both are the last line of their own paragraph → both ragged.
    expect(m.lines.map((l) => l.endsParagraph)).toEqual([true, true]);
  });

  it('puts a word wider than the column on its own line (no mid-word split)', () => {
    const m = measureTextLabel(styled('aa bbbbbbbb cc', 30));
    expect(m.lines.map((l) => l.raw)).toEqual(['aa', 'bbbbbbbb', 'cc']);
    expect(m.lineCount).toBe(3);
    // The box stays at the column width even though the long word overflows it.
    expect(m.width).toBe(30);
  });

  it('preserves a blank line between paragraphs', () => {
    const m = measureTextLabel(styled('aa\n\nbb', 50));
    expect(m.lines.map((l) => l.raw)).toEqual(['aa', '', 'bb']);
    expect(m.lineCount).toBe(3);
    expect(m.lines.map((l) => l.endsParagraph)).toEqual([true, true, true]);
  });

  it("preserves a paragraph's LEADING whitespace on its first wrapped line", () => {
    // The author typed an indent; word-wrap must not eat it. It rides the
    // first word — continuation lines start at the pen origin as usual.
    const m = measureTextLabel(styled('  aa bb', 50));
    expect(m.lines.map((l) => l.raw)).toEqual(['  aa', 'bb']);
  });

  it('the indent counts toward the wrap width', () => {
    // '  aa' is 40 ink-px (spaces count); adding ' bb' (70) overflows 50, so
    // the break lands after 'aa' — the indent consumed room like real text.
    const m = measureTextLabel(styled('  aa bb', 70));
    expect(m.lines.map((l) => l.raw)).toEqual(['  aa bb']);
  });

  it("every source line's indent survives, not just the first paragraph's", () => {
    const m = measureTextLabel(styled('x\n  y', 50));
    expect(m.lines.map((l) => l.raw)).toEqual(['x', '  y']);
  });

  it('interior whitespace runs still collapse to single-space gaps', () => {
    const m = measureTextLabel(styled('aa    bb', 50));
    expect(m.lines.map((l) => l.raw)).toEqual(['aa bb']);
  });
});
