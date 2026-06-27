import { describe, it, expect } from 'vitest';
import { angleDeg, v } from './vec';

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
