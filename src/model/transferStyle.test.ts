import { describe, it, expect } from 'vitest';
import {
  TRANSFER_THICKNESS_MIN,
  TRANSFER_THICKNESS_MAX,
  TRANSFER_THICKNESS_DEFAULT,
  TRANSFER_COLOR_DEFAULT,
  TRANSFER_STROKE_WIDTH_MIN,
  TRANSFER_STROKE_WIDTH_MAX,
  TRANSFER_STROKE_WIDTH_DEFAULT,
  TRANSFER_STROKE_COLOR_DEFAULT,
  canonicalTransferThickness,
  canonicalTransferStrokeWidth,
  canonicalTransferColor,
  resolveTransferStyle,
} from './transferStyle';

describe('transfer style constants', () => {
  it('pins the thickness bounds and the legacy 2px default', () => {
    expect(TRANSFER_THICKNESS_MIN).toBe(1);
    expect(TRANSFER_THICKNESS_MAX).toBe(14);
    expect(TRANSFER_THICKNESS_DEFAULT).toBe(2);
  });

  it('pins the stroke bounds (0 = no outline) and the classic colors', () => {
    expect(TRANSFER_STROKE_WIDTH_MIN).toBe(0);
    expect(TRANSFER_STROKE_WIDTH_MAX).toBe(5);
    expect(TRANSFER_STROKE_WIDTH_DEFAULT).toBe(0);
    expect(TRANSFER_COLOR_DEFAULT).toBe('#000000');
    expect(TRANSFER_STROKE_COLOR_DEFAULT).toBe('#ffffff');
  });
});

describe('canonicalTransferThickness', () => {
  it('rounds and clamps to the floor TRANSFER_THICKNESS_MIN', () => {
    expect(canonicalTransferThickness(4.6, 2)).toBe(5);
    expect(canonicalTransferThickness(4.4, 2)).toBe(4);
    expect(canonicalTransferThickness(0, 2)).toBe(TRANSFER_THICKNESS_MIN);
    expect(canonicalTransferThickness(-3, 2)).toBe(TRANSFER_THICKNESS_MIN);
  });

  it('does not clamp above the slider max (textbox accepts arbitrary)', () => {
    expect(canonicalTransferThickness(25, 2)).toBe(25);
  });

  it('collapses to undefined at the doc setting, including after rounding/clamping', () => {
    expect(canonicalTransferThickness(5, 5)).toBeUndefined();
    expect(canonicalTransferThickness(5.4, 5)).toBeUndefined();
    // Clamping can land ON the setting: 2px default, junk input below the floor.
    expect(canonicalTransferThickness(-1, TRANSFER_THICKNESS_MIN)).toBeUndefined();
    // ...but the same value is kept when the setting differs.
    expect(canonicalTransferThickness(5, 2)).toBe(5);
  });
});

describe('canonicalTransferStrokeWidth', () => {
  it('rounds and clamps to the floor TRANSFER_STROKE_WIDTH_MIN (0 is legal)', () => {
    expect(canonicalTransferStrokeWidth(2.7, 0)).toBe(3);
    expect(canonicalTransferStrokeWidth(-2, 1)).toBe(TRANSFER_STROKE_WIDTH_MIN);
  });

  it('collapses to undefined at the doc setting', () => {
    expect(canonicalTransferStrokeWidth(0, 0)).toBeUndefined();
    expect(canonicalTransferStrokeWidth(3, 3)).toBeUndefined();
    expect(canonicalTransferStrokeWidth(3, 0)).toBe(3);
  });
});

describe('canonicalTransferColor', () => {
  it('collapses to undefined at the doc setting, exact-match like the doc setters', () => {
    expect(canonicalTransferColor('#000000', '#000000')).toBeUndefined();
    expect(canonicalTransferColor('#ff0080', '#000000')).toBe('#ff0080');
    // Exact string comparison — the doc setters don't normalize case either.
    expect(canonicalTransferColor('#FF0080', '#ff0080')).toBe('#FF0080');
  });
});

describe('resolveTransferStyle', () => {
  const defaults = { thickness: 2, color: '#000000', strokeWidth: 0, strokeColor: '#ffffff' };

  it('prefers each override over the doc setting, per field independently', () => {
    expect(resolveTransferStyle({ thickness: 6, strokeColor: '#123456' }, defaults)).toEqual({
      thickness: 6,
      color: '#000000',
      strokeWidth: 0,
      strokeColor: '#123456',
    });
  });

  it('returns the doc settings for a fully-tracking transfer', () => {
    expect(resolveTransferStyle({}, defaults)).toEqual(defaults);
  });

  it('a strokeWidth 0 override suppresses a nonzero doc outline (?? — 0 is a real override)', () => {
    // strokeWidth is the one field with a meaningful falsy value: a `||`
    // fallback would silently re-grow the doc's halo on this transfer.
    expect(resolveTransferStyle({ strokeWidth: 0 }, { ...defaults, strokeWidth: 3 })).toEqual({
      ...defaults,
      strokeWidth: 0,
    });
  });
});
