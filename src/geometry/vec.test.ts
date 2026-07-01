import { describe, it, expect } from 'vitest';
import { angleDeg, centroid, midpoint, rotateAround, v } from './vec';

describe('midpoint', () => {
  it('returns the component-wise average of two points', () => {
    expect(midpoint(v(0, 0), v(10, 4))).toEqual(v(5, 2));
    expect(midpoint(v(-3, 5), v(3, -5))).toEqual(v(0, 0));
  });
});

describe('angleDeg', () => {
  it('measures from +x toward +y (SVG rotate convention)', () => {
    expect(angleDeg(v(1, 0))).toBeCloseTo(0, 9);
    expect(angleDeg(v(0, 1))).toBeCloseTo(90, 9);
    expect(angleDeg(v(-1, 0))).toBeCloseTo(180, 9);
    expect(angleDeg(v(0, -1))).toBeCloseTo(-90, 9);
    expect(angleDeg(v(1, 1))).toBeCloseTo(45, 9);
  });

  it('is scale-invariant for a non-unit vector', () => {
    expect(angleDeg(v(3, 3))).toBeCloseTo(45, 9);
  });
});

describe('rotateAround', () => {
  it('leaves the pivot itself fixed', () => {
    expect(rotateAround(v(5, 5), v(5, 5), Math.PI / 3)).toEqual(v(5, 5));
  });

  it('rotates a point 90° CW about a pivot (y-down frame)', () => {
    // (10,5) is 5 to the right of pivot (5,5). A +90° rotation in the y-down
    // frame sends +x → +y, so it lands 5 BELOW the pivot: (5,10).
    const out = rotateAround(v(10, 5), v(5, 5), Math.PI / 2);
    expect(out.x).toBeCloseTo(5, 9);
    expect(out.y).toBeCloseTo(10, 9);
  });

  it('matches rotate-about-origin when the pivot is the origin', () => {
    const out = rotateAround(v(1, 0), v(0, 0), Math.PI);
    expect(out.x).toBeCloseTo(-1, 9);
    expect(out.y).toBeCloseTo(0, 9);
  });
});

describe('centroid', () => {
  it('averages the points component-wise', () => {
    expect(centroid([v(0, 0), v(10, 0), v(2, 6)])).toEqual(v(4, 2));
  });

  it('returns the point itself for a single input', () => {
    expect(centroid([v(3, 7)])).toEqual(v(3, 7));
  });

  it('returns the origin for empty input (guarded, not NaN)', () => {
    expect(centroid([])).toEqual(v(0, 0));
  });
});
