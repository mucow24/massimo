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
  lineCasingColor,
  lineStrokeRailWidth,
} from './lineStroke';

describe('line stroke constants', () => {
  it('defaults to no casing in white; slider range is 0..10 in 0.25 steps', () => {
    expect(LINE_STROKE_WIDTH_DEFAULT).toBe(0);
    expect(LINE_STROKE_WIDTH_MIN).toBe(0);
    expect(LINE_STROKE_WIDTH_MAX).toBe(10);
    expect(LINE_STROKE_STEP).toBe(0.25);
    expect(LINE_STROKE_COLOR_DEFAULT).toBe('#ffffff');
  });
});

describe('canonicalStrokeWidth', () => {
  it('rounds to the quarter grid, preserving quarter values', () => {
    expect(canonicalStrokeWidth(2.1)).toBe(2);
    expect(canonicalStrokeWidth(2.4)).toBe(2.5);
    // A quarter value survives instead of snapping to a half.
    expect(canonicalStrokeWidth(2.25)).toBe(2.25);
  });

  it('collapses the default (0 = no casing) to undefined, including clamped negatives', () => {
    // The floor and the default coincide at 0, so anything at/below the floor
    // becomes the default and drops.
    expect(LINE_STROKE_WIDTH_MIN).toBe(LINE_STROKE_WIDTH_DEFAULT);
    expect(canonicalStrokeWidth(-1)).toBeUndefined();
    expect(canonicalStrokeWidth(0)).toBeUndefined();
    expect(canonicalStrokeWidth(0.1)).toBeUndefined();
    expect(canonicalStrokeWidth(1.5)).toBe(1.5);
  });
});

describe('canonicalStrokeColor', () => {
  it('lowercases the color', () => {
    expect(canonicalStrokeColor('#AABBCC')).toBe('#aabbcc');
  });

  it('collapses the white default to undefined so it is never stored', () => {
    expect(canonicalStrokeColor('#FFFFFF')).toBeUndefined();
    expect(canonicalStrokeColor('#ffffff')).toBeUndefined();
    expect(canonicalStrokeColor('#000000')).toBe('#000000');
  });
});

describe('lineStrokeWidthOf / lineStrokeColorStored', () => {
  it('read the stored values when present', () => {
    expect(lineStrokeWidthOf({ strokeWidth: 1.5 })).toBe(1.5);
    expect(lineStrokeColorStored({ strokeColor: '#ff0000' })).toBe('#ff0000');
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

describe("the 'line' sentinel (casing painted in the line's own color)", () => {
  it('resolves the casing to the line color, passing a hex through untouched', () => {
    expect(lineCasingColor({ strokeColor: LINE_OWN_COLOR }, '#c60c30')).toBe('#c60c30');
    expect(lineCasingColor({ strokeColor: '#00ff00' }, '#c60c30')).toBe('#00ff00');
    // Unset is still the white default, not the line color.
    expect(lineCasingColor({}, '#c60c30')).toBe(LINE_STROKE_COLOR_DEFAULT);
    expect(lineCasingColor(null, '#c60c30')).toBe(LINE_STROKE_COLOR_DEFAULT);
  });

  it('falls back to the casing default when a caller has no line color to give', () => {
    // Picker-less callers (DashGlyph without a line) pass undefined; a sentinel
    // must never reach an SVG paint attribute as the literal word.
    expect(lineCasingColor({ strokeColor: LINE_OWN_COLOR }, undefined)).toBe(
      LINE_STROKE_COLOR_DEFAULT,
    );
  });

  it('keeps the STORED accessor raw, so capture-by-example preserves the sentinel', () => {
    expect(lineStrokeColorStored({ strokeColor: LINE_OWN_COLOR })).toBe(LINE_OWN_COLOR);
  });

  it('survives canonicalization — the sentinel is storable', () => {
    expect(canonicalStrokeColor(LINE_OWN_COLOR)).toBe(LINE_OWN_COLOR);
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
