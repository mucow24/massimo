import { describe, it, expect } from 'vitest';
import { patternRotation, ribbonFromCenterline, hatchStripeRects } from './pdfHatch';

describe('patternRotation', () => {
  it('reads the rotate() angle from a patternTransform', () => {
    expect(patternRotation('rotate(45)')).toBe(45);
    expect(patternRotation('rotate(-45)')).toBe(-45);
    expect(patternRotation('rotate( -45 )')).toBe(-45);
    // rotate need not be the only / first transform token.
    expect(patternRotation('translate(2 3) rotate(45)')).toBe(45);
  });

  it('returns 0 when there is no rotate', () => {
    expect(patternRotation(null)).toBe(0);
    expect(patternRotation('')).toBe(0);
    expect(patternRotation('translate(1,2)')).toBe(0);
  });
});

describe('ribbonFromCenterline', () => {
  it('offsets a straight horizontal centerline by ±width/2 into a band rectangle', () => {
    const ribbon = ribbonFromCenterline(
      [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 10, y: 0 },
      ],
      4,
    );
    expect(ribbon).not.toBeNull();
    expect(ribbon!.bounds).toEqual({ minX: 0, minY: -2, maxX: 10, maxY: 2 });
    // 3 samples → 6 ring vertices (one per side), closed polygon.
    expect(ribbon!.points.trim().split(/\s+/)).toHaveLength(6);
  });

  it('offsets a vertical centerline across the perpendicular (x) axis', () => {
    const ribbon = ribbonFromCenterline(
      [
        { x: 0, y: 0 },
        { x: 0, y: 10 },
      ],
      6,
    );
    expect(ribbon!.bounds).toEqual({ minX: -3, minY: 0, maxX: 3, maxY: 10 });
  });

  it('returns null for a degenerate centerline or non-positive width', () => {
    expect(ribbonFromCenterline([{ x: 0, y: 0 }], 4)).toBeNull();
    expect(
      ribbonFromCenterline(
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
        0,
      ),
    ).toBeNull();
  });
});

describe('hatchStripeRects', () => {
  it('lays vertical stripes phased from the origin at the tile pitch (angle 0)', () => {
    const rects = hatchStripeRects({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 0, 2, 2);
    // tile = 4 → columns at x = 0,4,8,12 covering [0,10].
    expect(rects.map((r) => r.x)).toEqual([0, 4, 8, 12]);
    expect(rects[0]).toEqual({ x: 0, y: -4, width: 2, height: 18 });
    // Every stripe sits on a tile boundary from the world origin (so a band and
    // the stop marker on it share phase and read continuous).
    for (const r of rects) expect(r.x % 4).toBe(0);
  });

  it('projects the bbox into the rotated frame to choose stripe columns (angle 45)', () => {
    const rects = hatchStripeRects({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 45, 2, 2);
    // Rotated-frame x' of the corners spans [0, ~14.14] → columns 0..16.
    expect(rects.map((r) => r.x)).toEqual([0, 4, 8, 12, 16]);
    for (const r of rects) expect(r.x % 4).toBe(0);
  });

  it('keeps origin phase regardless of where the region sits', () => {
    // A region offset far from the origin still gets stripes on the global grid.
    const rects = hatchStripeRects({ minX: 100, minY: 0, maxX: 108, maxY: 8 }, 0, 2, 2);
    for (const r of rects) expect(r.x % 4).toBe(0);
    expect(rects.map((r) => r.x)).toEqual([100, 104, 108]);
  });
});
