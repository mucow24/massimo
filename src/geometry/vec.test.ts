import { describe, it, expect } from 'vitest';
import { angleDeg, midpoint, v } from './vec';

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
