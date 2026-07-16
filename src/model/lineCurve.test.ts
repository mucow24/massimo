import { describe, it, expect } from 'vitest';
import {
  LINE_CURVE_RADIUS_DEFAULT,
  LINE_CURVE_RADIUS_MIN,
  canonicalLineCurveRadius,
  lineCurveRadiusOf,
} from './lineCurve';

describe('canonicalLineCurveRadius', () => {
  it('rounds to the quarter grid, preserving quarter values', () => {
    expect(canonicalLineCurveRadius(30.1)).toBe(30);
    expect(canonicalLineCurveRadius(30.4)).toBe(30.5);
    // A quarter value survives instead of being rounded off to an integer.
    expect(canonicalLineCurveRadius(30.25)).toBe(30.25);
  });

  it('clamps below the floor up to LINE_CURVE_RADIUS_MIN', () => {
    expect(canonicalLineCurveRadius(0)).toBe(LINE_CURVE_RADIUS_MIN);
    expect(canonicalLineCurveRadius(-5)).toBe(LINE_CURVE_RADIUS_MIN);
  });

  it('collapses the default to undefined so it is never stored', () => {
    expect(canonicalLineCurveRadius(LINE_CURVE_RADIUS_DEFAULT)).toBeUndefined();
    // Within a quarter of the default still lands on it.
    expect(canonicalLineCurveRadius(LINE_CURVE_RADIUS_DEFAULT + 0.1)).toBeUndefined();
  });
});

describe('lineCurveRadiusOf', () => {
  it('reads the stored radius, or falls back to the default', () => {
    expect(lineCurveRadiusOf({ curveRadius: 30 })).toBe(30);
    expect(lineCurveRadiusOf({})).toBe(LINE_CURVE_RADIUS_DEFAULT);
    expect(lineCurveRadiusOf(null)).toBe(LINE_CURVE_RADIUS_DEFAULT);
    expect(lineCurveRadiusOf(undefined)).toBe(LINE_CURVE_RADIUS_DEFAULT);
  });
});
