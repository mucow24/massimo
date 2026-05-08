import { describe, it, expect } from 'vitest';
import { legibleTextOn } from './color';
import { PALETTES } from '../model/palettes';

describe('legibleTextOn', () => {
  it('returns white text on pure black', () => {
    expect(legibleTextOn('#000000')).toBe('#fff');
    expect(legibleTextOn('#000')).toBe('#fff');
  });

  it('returns black text on pure white', () => {
    expect(legibleTextOn('#ffffff')).toBe('#000');
    expect(legibleTextOn('#fff')).toBe('#000');
  });

  it('handles 3-character hex shorthand', () => {
    // #abc expands to #aabbcc.
    expect(legibleTextOn('#abc')).toBe(legibleTextOn('#aabbcc'));
  });

  it('picks white text on the dark MTA blue', () => {
    expect(legibleTextOn('#0039A6')).toBe('#fff');
  });

  it('picks black text on the bright MTA yellow', () => {
    expect(legibleTextOn('#FCCC0A')).toBe('#000');
  });

  it('returns either #000 or #fff for every swatch in every palette', () => {
    for (const palette of PALETTES) {
      for (const s of palette.swatches) {
        const out = legibleTextOn(s.color);
        expect(['#000', '#fff']).toContain(out);
      }
    }
  });
});
