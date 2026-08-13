import { describe, it, expect } from 'vitest';
import {
  LINE_CURVE_RADIUS_DEFAULT,
  LINE_CURVE_RADIUS_MIN,
  canonicalLineCurveRadius,
  lineCurveRadiusOf,
} from './lineCurve';

describe('canonicalLineCurveRadius', () => {
  it('keeps the radius it is given — LINE_CURVE_RADIUS_STEP is the control, not a filter', () => {
    expect(canonicalLineCurveRadius(30.1)).toBe(30.1);
    expect(canonicalLineCurveRadius(30.25)).toBe(30.25);
    expect(canonicalLineCurveRadius(30.32455)).toBe(30.32455);
  });

  it('clamps below the floor up to LINE_CURVE_RADIUS_MIN', () => {
    expect(canonicalLineCurveRadius(0)).toBe(LINE_CURVE_RADIUS_MIN);
    expect(canonicalLineCurveRadius(-5)).toBe(LINE_CURVE_RADIUS_MIN);
  });

  it('collapses the default to undefined so it is never stored', () => {
    expect(canonicalLineCurveRadius(LINE_CURVE_RADIUS_DEFAULT)).toBeUndefined();
    // Only the default EXACTLY — a hair off it is a real, stored choice.
    expect(canonicalLineCurveRadius(LINE_CURVE_RADIUS_DEFAULT + 0.1)).toBe(
      LINE_CURVE_RADIUS_DEFAULT + 0.1,
    );
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
