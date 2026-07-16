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
  dayNightColorsEqual,
  legacyColorToDayNight,
  resolveDayNight,
  resolveTransferStyle,
} from './transferStyle';

describe('transfer style constants', () => {
  it('pins the thickness bounds and the legacy 2px default', () => {
    expect(TRANSFER_THICKNESS_MIN).toBe(1);
    expect(TRANSFER_THICKNESS_MAX).toBe(14);
    expect(TRANSFER_THICKNESS_DEFAULT).toBe(2);
  });

  it('pins the stroke bounds (0 = no outline) and the day/night default colors', () => {
    expect(TRANSFER_STROKE_WIDTH_MIN).toBe(0);
    expect(TRANSFER_STROKE_WIDTH_MAX).toBe(5);
    expect(TRANSFER_STROKE_WIDTH_DEFAULT).toBe(0);
    // Black in both themes for the body, white in both for the outline — the
    // legacy look, theme-blind (day === night) so old maps read unchanged.
    expect(TRANSFER_COLOR_DEFAULT).toEqual({ day: '#000000', night: '#000000' });
    expect(TRANSFER_STROKE_COLOR_DEFAULT).toEqual({ day: '#ffffff', night: '#ffffff' });
  });
});

describe('dayNightColorsEqual', () => {
  it('is true only when both halves match', () => {
    expect(
      dayNightColorsEqual({ day: '#111', night: '#222' }, { day: '#111', night: '#222' }),
    ).toBe(true);
    expect(
      dayNightColorsEqual({ day: '#111', night: '#222' }, { day: '#111', night: '#999' }),
    ).toBe(false);
    expect(
      dayNightColorsEqual({ day: '#111', night: '#222' }, { day: '#999', night: '#222' }),
    ).toBe(false);
  });
});

describe('resolveDayNight', () => {
  it('picks night in dark mode, day otherwise', () => {
    const c = { day: '#ff0000', night: '#00ff00' };
    expect(resolveDayNight(c, false)).toBe('#ff0000');
    expect(resolveDayNight(c, true)).toBe('#00ff00');
  });
});

describe('legacyColorToDayNight', () => {
  it('wraps a legacy single color into both halves (old colors are day colors)', () => {
    expect(legacyColorToDayNight('#ff0080')).toEqual({ day: '#ff0080', night: '#ff0080' });
  });

  it('preserves the exact legacy string, casing included', () => {
    expect(legacyColorToDayNight('#FF0080')).toEqual({ day: '#FF0080', night: '#FF0080' });
  });

  it('passes an already-resolved day/night color through (idempotent)', () => {
    const dn = { day: '#111111', night: '#222222' };
    expect(legacyColorToDayNight(dn)).toEqual(dn);
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
  it('rounds to the quarter grid and clamps to the floor TRANSFER_STROKE_WIDTH_MIN (0 is legal)', () => {
    expect(canonicalTransferStrokeWidth(2.7, 0)).toBe(2.75);
    // A quarter value survives instead of being rounded off to an integer.
    expect(canonicalTransferStrokeWidth(2.75, 0)).toBe(2.75);
    expect(canonicalTransferStrokeWidth(-2, 1)).toBe(TRANSFER_STROKE_WIDTH_MIN);
  });

  it('collapses to undefined at the doc setting', () => {
    expect(canonicalTransferStrokeWidth(0, 0)).toBeUndefined();
    expect(canonicalTransferStrokeWidth(3, 3)).toBeUndefined();
    expect(canonicalTransferStrokeWidth(3, 0)).toBe(3);
  });
});

describe('canonicalTransferColor', () => {
  it('collapses to undefined at the default, comparing BOTH halves', () => {
    const black = { day: '#000000', night: '#000000' };
    expect(canonicalTransferColor(black, TRANSFER_COLOR_DEFAULT)).toBeUndefined();
    // Either half diverging from the default keeps the whole override.
    expect(canonicalTransferColor({ day: '#ff0080', night: '#000000' }, black)).toEqual({
      day: '#ff0080',
      night: '#000000',
    });
    expect(canonicalTransferColor({ day: '#000000', night: '#ff0080' }, black)).toEqual({
      day: '#000000',
      night: '#ff0080',
    });
  });
});

describe('resolveTransferStyle', () => {
  const defaults = {
    thickness: 2,
    color: { day: '#000000', night: '#000000' },
    strokeWidth: 0,
    strokeColor: { day: '#ffffff', night: '#ffffff' },
  };

  it('prefers each override over the default, per field independently', () => {
    expect(
      resolveTransferStyle(
        { thickness: 6, strokeColor: { day: '#123456', night: '#654321' } },
        defaults,
      ),
    ).toEqual({
      thickness: 6,
      color: { day: '#000000', night: '#000000' },
      strokeWidth: 0,
      strokeColor: { day: '#123456', night: '#654321' },
    });
  });

  it('returns the defaults for a fully-tracking transfer', () => {
    expect(resolveTransferStyle({}, defaults)).toEqual(defaults);
  });

  it('a strokeWidth 0 override suppresses a nonzero default outline (?? — 0 is a real override)', () => {
    // strokeWidth is the one field with a meaningful falsy value: a `||`
    // fallback would silently re-grow the default's halo on this transfer.
    expect(resolveTransferStyle({ strokeWidth: 0 }, { ...defaults, strokeWidth: 3 })).toEqual({
      ...defaults,
      strokeWidth: 0,
    });
  });
});
