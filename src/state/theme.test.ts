import { describe, it, expect } from 'vitest';
import { themeColors } from './theme';

describe('themeColors', () => {
  it('light mode: near-white canvas, dark labels, white underlay', () => {
    const c = themeColors(false);
    expect(c.canvasBg).toBe('#fafafa');
    expect(c.label).toBe('#111111');
    expect(c.underlay).toBe('#ffffff');
    expect(c.editorBg).toBe('#ffffff');
  });

  it('dark mode: black canvas, white labels, black underlay (gaps read as empty canvas)', () => {
    const c = themeColors(true);
    expect(c.canvasBg).toBe('#000000');
    expect(c.label).toBe('#ffffff');
    expect(c.underlay).toBe('#000000');
    expect(c.editorBg).toBe('#000000');
  });

  it('returns a stable reference per mode (cheap to use as a memo input)', () => {
    expect(themeColors(true)).toBe(themeColors(true));
    expect(themeColors(false)).toBe(themeColors(false));
  });
});
