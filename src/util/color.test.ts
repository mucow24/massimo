import { describe, it, expect } from 'vitest';
import { legibleTextOn, withAlpha, blendOver, desaturateColor } from './color';
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

describe('withAlpha', () => {
  it('formats a 6-char hex as rgba()', () => {
    expect(withAlpha('#112233', 0.5)).toBe('rgba(17, 34, 51, 0.5)');
  });

  it('expands 3-char hex shorthand before formatting', () => {
    // #abc → #aabbcc → (170, 187, 204)
    expect(withAlpha('#abc', 1)).toBe('rgba(170, 187, 204, 1)');
    expect(withAlpha('#abc', 0.25)).toBe(withAlpha('#aabbcc', 0.25));
  });

  it('passes the alpha through verbatim (no clamping)', () => {
    expect(withAlpha('#000000', 0)).toBe('rgba(0, 0, 0, 0)');
    expect(withAlpha('#ffffff', 1)).toBe('rgba(255, 255, 255, 1)');
  });
});

describe('blendOver', () => {
  it('returns the foreground unchanged at alpha 1', () => {
    expect(blendOver('#3a7bd5', 1)).toBe('#3a7bd5');
  });

  it('returns the background (white by default) at alpha 0', () => {
    expect(blendOver('#3a7bd5', 0)).toBe('#ffffff');
  });

  it('honors a custom background', () => {
    expect(blendOver('#ffffff', 0, '#000000')).toBe('#000000');
    // Half-blend of white over black → mid grey (128 after rounding).
    expect(blendOver('#ffffff', 0.5, '#000000')).toBe('#808080');
  });

  it('clamps alpha below 0 to fully transparent (returns bg)', () => {
    expect(blendOver('#3a7bd5', -1)).toBe('#ffffff');
  });

  it('clamps alpha above 1 to fully opaque (returns fg)', () => {
    expect(blendOver('#3a7bd5', 2)).toBe('#3a7bd5');
  });

  it('rounds each channel of the blended result', () => {
    // fg #010101 at 0.5 over #000000 → 0.5 per channel → rounds to 1 → #010101.
    expect(blendOver('#010101', 0.5, '#000000')).toBe('#010101');
  });
});

describe('desaturateColor', () => {
  it('returns the input unchanged when amount >= 1', () => {
    expect(desaturateColor('#3a7bd5', 1)).toBe('#3a7bd5');
    expect(desaturateColor('#3a7bd5', 2)).toBe('#3a7bd5');
  });

  it('collapses to per-pixel luma greyscale at amount 0', () => {
    // Pure red #ff0000 → luma 0.2126*255 ≈ 54 → #363636.
    expect(desaturateColor('#ff0000', 0)).toBe('#363636');
  });

  it('leaves greys unchanged regardless of amount (luma == channel)', () => {
    expect(desaturateColor('#808080', 0)).toBe('#808080');
    expect(desaturateColor('#000000', 0)).toBe('#000000');
    expect(desaturateColor('#ffffff', 0)).toBe('#ffffff');
  });

  it('clamps negative amounts to full greyscale', () => {
    expect(desaturateColor('#ff0000', -1)).toBe(desaturateColor('#ff0000', 0));
  });

  it('mixes toward grey at a fractional amount', () => {
    // Halfway between the original red (255) and its luma (54) on the R channel.
    const out = desaturateColor('#ff0000', 0.5);
    const r = parseInt(out.slice(1, 3), 16);
    expect(r).toBeGreaterThan(54);
    expect(r).toBeLessThan(255);
  });
});

describe('parseHex robustness (malformed / alpha input)', () => {
  it('ignores the alpha channel in 8-digit hex (#rrggbbaa)', () => {
    expect(withAlpha('#ff000080', 0.5)).toBe('rgba(255, 0, 0, 0.5)');
  });

  it('ignores the alpha nibble in 4-digit shorthand (#rgba)', () => {
    expect(withAlpha('#f008', 0.5)).toBe('rgba(255, 0, 0, 0.5)');
  });

  it('falls back to black for non-hex input instead of producing NaN', () => {
    // The bug: any input that wasn't 3 or 6 hex digits took the 6-digit slice
    // path and returned NaN channels, poisoning rgba()/luminance downstream.
    // Reachable via a hand-edited map file whose colors aren't #rrggbb.
    expect(withAlpha('rgb(1, 2, 3)', 1)).toBe('rgba(0, 0, 0, 1)');
    expect(withAlpha('red', 1)).toBe('rgba(0, 0, 0, 1)');
    expect(withAlpha('', 1)).toBe('rgba(0, 0, 0, 1)');
    expect(withAlpha('#xyz', 1)).toBe('rgba(0, 0, 0, 1)');
    // A 7-hex-digit string (invalid length) is the discriminating case: the old
    // slice path silently mis-parsed it as #abcdef → rgba(171, 205, 239, 1);
    // the new code rejects the bad length and falls back to black.
    expect(withAlpha('#abcdef0', 1)).toBe('rgba(0, 0, 0, 1)');
  });

  it('legibleTextOn returns a real color (not NaN-driven) for malformed input', () => {
    // Black fallback → dark background → white text.
    expect(legibleTextOn('not-a-color')).toBe('#fff');
  });

  it('blendOver and desaturateColor stay valid hex for malformed input', () => {
    expect(blendOver('bogus', 0.5)).toMatch(/^#[0-9a-f]{6}$/);
    expect(desaturateColor('bogus', 0.5)).toMatch(/^#[0-9a-f]{6}$/);
  });
});
