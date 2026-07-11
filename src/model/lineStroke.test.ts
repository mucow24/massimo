import { describe, it, expect } from 'vitest';
import {
  LINE_STROKE_WIDTH_DEFAULT,
  LINE_STROKE_WIDTH_MIN,
  LINE_STROKE_WIDTH_MAX,
  LINE_STROKE_STEP,
  LINE_STROKE_COLOR_DEFAULT,
  canonicalStrokeWidth,
  canonicalStrokeColor,
  lineStrokeWidthOf,
  lineStrokeColorOf,
  lineStrokeRailWidth,
} from './lineStroke';

describe('line stroke constants', () => {
  it('defaults to no casing in white; slider range is 0..10 in 0.5 steps', () => {
    expect(LINE_STROKE_WIDTH_DEFAULT).toBe(0);
    expect(LINE_STROKE_WIDTH_MIN).toBe(0);
    expect(LINE_STROKE_WIDTH_MAX).toBe(10);
    expect(LINE_STROKE_STEP).toBe(0.5);
    expect(LINE_STROKE_COLOR_DEFAULT).toBe('#ffffff');
  });
});

describe('canonicalStrokeWidth', () => {
  it('rounds to the half-pixel grid', () => {
    expect(canonicalStrokeWidth(2.24)).toBe(2);
    expect(canonicalStrokeWidth(2.25)).toBe(2.5);
    expect(canonicalStrokeWidth(2.74)).toBe(2.5);
  });

  it('collapses the default (0 = no casing) to undefined, including clamped negatives', () => {
    // The floor and the default coincide at 0, so anything at/below the floor
    // becomes the default and drops.
    expect(LINE_STROKE_WIDTH_MIN).toBe(LINE_STROKE_WIDTH_DEFAULT);
    expect(canonicalStrokeWidth(-1)).toBeUndefined();
    expect(canonicalStrokeWidth(0)).toBeUndefined();
    expect(canonicalStrokeWidth(0.2)).toBeUndefined();
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

describe('lineStrokeWidthOf / lineStrokeColorOf', () => {
  it('read the stored values when present', () => {
    expect(lineStrokeWidthOf({ strokeWidth: 1.5 })).toBe(1.5);
    expect(lineStrokeColorOf({ strokeColor: '#ff0000' })).toBe('#ff0000');
  });

  it('fall back to the defaults for a bare line, null, and undefined', () => {
    expect(lineStrokeWidthOf({})).toBe(LINE_STROKE_WIDTH_DEFAULT);
    expect(lineStrokeWidthOf(null)).toBe(LINE_STROKE_WIDTH_DEFAULT);
    expect(lineStrokeWidthOf(undefined)).toBe(LINE_STROKE_WIDTH_DEFAULT);
    expect(lineStrokeColorOf({})).toBe(LINE_STROKE_COLOR_DEFAULT);
    expect(lineStrokeColorOf(null)).toBe(LINE_STROKE_COLOR_DEFAULT);
    expect(lineStrokeColorOf(undefined)).toBe(LINE_STROKE_COLOR_DEFAULT);
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
