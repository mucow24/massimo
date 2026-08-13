import { describe, it, expect } from 'vitest';
import {
  LINE_STROKE_WIDTH_DEFAULT,
  LINE_STROKE_WIDTH_MIN,
  LINE_STROKE_WIDTH_MAX,
  LINE_STROKE_STEP,
  LINE_STROKE_COLOR_DEFAULT,
  canonicalStrokeWidth,
  canonicalStrokeColor,
  LINE_OWN_COLOR,
  lineStrokeWidthOf,
  lineStrokeColorStored,
  lineStrokeColorsEqual,
  lineCasingColor,
  lineStrokeRailWidth,
} from './lineStroke';

describe('line stroke constants', () => {
  it('defaults to no casing in white; slider range is 0..10 in 0.25 steps', () => {
    expect(LINE_STROKE_WIDTH_DEFAULT).toBe(0);
    expect(LINE_STROKE_WIDTH_MIN).toBe(0);
    expect(LINE_STROKE_WIDTH_MAX).toBe(10);
    expect(LINE_STROKE_STEP).toBe(0.25);
    // White in BOTH themes — the historical single-color look, so converting an
    // old save changes nothing on either canvas.
    expect(LINE_STROKE_COLOR_DEFAULT).toEqual({ day: '#ffffff', night: '#ffffff' });
  });
});

describe('canonicalStrokeWidth', () => {
  it('keeps the width it is given — LINE_STROKE_STEP is the control, not a filter', () => {
    expect(canonicalStrokeWidth(2.1)).toBe(2.1);
    expect(canonicalStrokeWidth(2.25)).toBe(2.25);
    expect(canonicalStrokeWidth(0.32455)).toBe(0.32455);
  });

  it('collapses the default (0 = no casing) to undefined, including clamped negatives', () => {
    // The floor and the default coincide at 0, so anything at/below the floor
    // becomes the default and drops.
    expect(LINE_STROKE_WIDTH_MIN).toBe(LINE_STROKE_WIDTH_DEFAULT);
    expect(canonicalStrokeWidth(-1)).toBeUndefined();
    expect(canonicalStrokeWidth(0)).toBeUndefined();
    // 0.1 is a real hairline casing now, not something rounded away to "off".
    expect(canonicalStrokeWidth(0.1)).toBe(0.1);
    expect(canonicalStrokeWidth(1.5)).toBe(1.5);
  });
});

describe('canonicalStrokeColor', () => {
  it('lowercases both halves of the pair', () => {
    expect(canonicalStrokeColor({ day: '#AABBCC', night: '#DDEEFF' })).toEqual({
      day: '#aabbcc',
      night: '#ddeeff',
    });
  });

  it('collapses the white default to undefined so it is never stored', () => {
    expect(canonicalStrokeColor({ day: '#FFFFFF', night: '#FFFFFF' })).toBeUndefined();
    expect(canonicalStrokeColor({ day: '#ffffff', night: '#ffffff' })).toBeUndefined();
    expect(canonicalStrokeColor({ day: '#000000', night: '#000000' })).toEqual({
      day: '#000000',
      night: '#000000',
    });
  });

  it('keeps a pair that matches the default on ONE half only', () => {
    // The collapse is all-or-nothing (the transfer colors' rule): a white day
    // casing over a black night one is a real override.
    expect(canonicalStrokeColor({ day: '#ffffff', night: '#000000' })).toEqual({
      day: '#ffffff',
      night: '#000000',
    });
  });
});

describe('lineStrokeWidthOf / lineStrokeColorStored', () => {
  it('read the stored values when present', () => {
    expect(lineStrokeWidthOf({ strokeWidth: 1.5 })).toBe(1.5);
    expect(lineStrokeColorStored({ strokeColor: { day: '#ff0000', night: '#00ff00' } })).toEqual({
      day: '#ff0000',
      night: '#00ff00',
    });
  });

  it('fall back to the defaults for a bare line, null, and undefined', () => {
    expect(lineStrokeWidthOf({})).toBe(LINE_STROKE_WIDTH_DEFAULT);
    expect(lineStrokeWidthOf(null)).toBe(LINE_STROKE_WIDTH_DEFAULT);
    expect(lineStrokeWidthOf(undefined)).toBe(LINE_STROKE_WIDTH_DEFAULT);
    expect(lineStrokeColorStored({})).toBe(LINE_STROKE_COLOR_DEFAULT);
    expect(lineStrokeColorStored(null)).toBe(LINE_STROKE_COLOR_DEFAULT);
    expect(lineStrokeColorStored(undefined)).toBe(LINE_STROKE_COLOR_DEFAULT);
  });
});

describe('lineCasingColor — the theme-aware casing', () => {
  const pair = { day: '#00ff00', night: '#0000ff' };

  it('paints the day half in light mode and the night half in dark', () => {
    expect(lineCasingColor({ strokeColor: pair }, '#c60c30', false)).toBe('#00ff00');
    expect(lineCasingColor({ strokeColor: pair }, '#c60c30', true)).toBe('#0000ff');
  });

  it('resolves an unset casing to white in both themes', () => {
    expect(lineCasingColor({}, '#c60c30', false)).toBe('#ffffff');
    expect(lineCasingColor(null, '#c60c30', true)).toBe('#ffffff');
  });
});

describe("the 'line' sentinel (casing painted in the line's own color)", () => {
  it('resolves the casing to the line color in BOTH themes', () => {
    // A line's body color is theme-blind, so a casing following it is too.
    expect(lineCasingColor({ strokeColor: LINE_OWN_COLOR }, '#c60c30', false)).toBe('#c60c30');
    expect(lineCasingColor({ strokeColor: LINE_OWN_COLOR }, '#c60c30', true)).toBe('#c60c30');
  });

  it('falls back to the casing default when a caller has no line color to give', () => {
    // Picker-less callers (DashGlyph without a line) pass undefined; a sentinel
    // must never reach an SVG paint attribute as the literal word.
    expect(lineCasingColor({ strokeColor: LINE_OWN_COLOR }, undefined, false)).toBe('#ffffff');
    expect(lineCasingColor({ strokeColor: LINE_OWN_COLOR }, undefined, true)).toBe('#ffffff');
  });

  it('keeps the STORED accessor raw, so capture-by-example preserves the sentinel', () => {
    expect(lineStrokeColorStored({ strokeColor: LINE_OWN_COLOR })).toBe(LINE_OWN_COLOR);
  });

  it('survives canonicalization — the sentinel is storable', () => {
    expect(canonicalStrokeColor(LINE_OWN_COLOR)).toBe(LINE_OWN_COLOR);
  });
});

describe('lineStrokeColorsEqual', () => {
  it('matches a sentinel only against the identical sentinel', () => {
    expect(lineStrokeColorsEqual(LINE_OWN_COLOR, LINE_OWN_COLOR)).toBe(true);
    expect(lineStrokeColorsEqual(LINE_OWN_COLOR, { day: '#ffffff', night: '#ffffff' })).toBe(false);
  });

  it('compares two pairs structurally, not by reference', () => {
    expect(
      lineStrokeColorsEqual(
        { day: '#ff0000', night: '#00ff00' },
        { day: '#ff0000', night: '#00ff00' },
      ),
    ).toBe(true);
    expect(
      lineStrokeColorsEqual(
        { day: '#ff0000', night: '#00ff00' },
        { day: '#ff0000', night: '#0000ff' },
      ),
    ).toBe(false);
  });
});

describe('lineStrokeRailWidth', () => {
  it('passes small strokes through and clamps at the stripe width', () => {
    expect(lineStrokeRailWidth(1.5, 14)).toBe(1.5);
    expect(lineStrokeRailWidth(14, 14)).toBe(14);
    // Past the body width the centered rails would cross — render-time clamp.
    expect(lineStrokeRailWidth(30, 14)).toBe(14);
    expect(lineStrokeRailWidth(0, 14)).toBe(0);
  });
});
