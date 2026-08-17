import { describe, it, expect } from 'vitest';
import { isSwatchRef, resolveLineSwatchRef, swatchRefsEqual } from './swatchRef';
import type { Palette } from './palettes';

const REF = { palette: 'inks', swatch: 'Border' };

describe('swatchRefsEqual', () => {
  it('absent equals absent, and never equals a present ref', () => {
    expect(swatchRefsEqual(undefined, undefined)).toBe(true);
    expect(swatchRefsEqual(REF, undefined)).toBe(false);
    expect(swatchRefsEqual(undefined, REF)).toBe(false);
  });

  it('compares by both names, never by object identity', () => {
    expect(swatchRefsEqual(REF, { ...REF })).toBe(true);
    expect(swatchRefsEqual(REF, { palette: 'inks', swatch: 'Wash' })).toBe(false);
    expect(swatchRefsEqual(REF, { palette: 'other', swatch: 'Border' })).toBe(false);
  });
});

describe('isSwatchRef', () => {
  it('accepts exactly a {palette, swatch} of non-empty strings', () => {
    expect(isSwatchRef(REF)).toBe(true);
    for (const bad of [null, 'x', 7, {}, { palette: 'p' }, { palette: 'p', swatch: 7 }]) {
      expect(isSwatchRef(bad)).toBe(false);
    }
  });
});

describe('resolveLineSwatchRef', () => {
  const palettes: Palette[] = [
    { name: 'inks', swatches: [{ name: 'Red', color: '#c1272d' }] },
    {
      name: 'grays',
      kind: 'design',
      swatches: [{ name: 'Border', color: '#333333', night: '#bbbbbb' }],
    },
  ];

  it('resolves a ref into a LINE palette swatch', () => {
    expect(resolveLineSwatchRef(palettes, { palette: 'inks', swatch: 'Red' })).toEqual({
      name: 'Red',
      color: '#c1272d',
    });
  });

  it('an unknown palette or swatch resolves to nothing', () => {
    expect(resolveLineSwatchRef(palettes, { palette: 'nope', swatch: 'Red' })).toBeUndefined();
    expect(resolveLineSwatchRef(palettes, { palette: 'inks', swatch: 'nope' })).toBeUndefined();
  });

  // A line ref pointing into a design palette is a kind mismatch — dangling,
  // exactly as if the palette were gone.
  it('never resolves into a design palette', () => {
    expect(resolveLineSwatchRef(palettes, { palette: 'grays', swatch: 'Border' })).toBeUndefined();
  });
});
