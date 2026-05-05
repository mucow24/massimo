import { describe, it, expect } from 'vitest';
import { legibleTextOn } from './color';
import { MTA_PALETTE } from '../state/store';

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

  it('returns either #000 or #fff for every MTA palette color', () => {
    for (const p of MTA_PALETTE) {
      const out = legibleTextOn(p.color);
      expect(['#000', '#fff']).toContain(out);
    }
  });
});
