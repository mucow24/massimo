import { describe, it, expect } from 'vitest';
import { snapBullet } from './snapBullet';

// Build per-band polylines for a vertical chain of stations at x = 0.
const verticalChain = (...ys: number[]): { x: number; y: number }[][] => {
  const polys: { x: number; y: number }[][] = [];
  for (let i = 0; i < ys.length - 1; i++) {
    polys.push([
      { x: 0, y: ys[i] },
      { x: 0, y: ys[i + 1] },
    ]);
  }
  return polys;
};

const horizontalChain = (...xs: number[]): { x: number; y: number }[][] => {
  const polys: { x: number; y: number }[][] = [];
  for (let i = 0; i < xs.length - 1; i++) {
    polys.push([
      { x: xs[i], y: 0 },
      { x: xs[i + 1], y: 0 },
    ]);
  }
  return polys;
};

describe('snapBullet', () => {
  it('snaps a bullet near a vertical line: x is pinned, y is preserved', () => {
    const r = snapBullet({ x: 4, y: 50, polylines: verticalChain(0, 100), tolerance: 10 });
    expect(r.x).toBeCloseTo(0, 5);
    expect(r.y).toBeCloseTo(50, 5);
    expect(r.guides).toHaveLength(2);
  });

  it('snaps when the bullet sits BEYOND the line endpoints', () => {
    const r = snapBullet({ x: 6, y: -40, polylines: verticalChain(0, 100), tolerance: 10 });
    expect(r.x).toBeCloseTo(0, 5);
    expect(r.y).toBeCloseTo(-40, 5);
  });

  it('does NOT snap when the bullet is beyond perpendicular tolerance', () => {
    const r = snapBullet({ x: 50, y: 50, polylines: verticalChain(0, 100), tolerance: 10 });
    expect(r.x).toBe(50);
    expect(r.y).toBe(50);
    expect(r.guides).toEqual([]);
  });

  it('snaps a bullet near a horizontal line: y pinned, x preserved', () => {
    const r = snapBullet({ x: 50, y: 4, polylines: horizontalChain(0, 100), tolerance: 10 });
    expect(r.x).toBeCloseTo(50, 5);
    expect(r.y).toBeCloseTo(0, 5);
  });

  it('emits two guides labeled with distances to each polyline endpoint', () => {
    const r = snapBullet({ x: 3, y: 30, polylines: verticalChain(0, 100), tolerance: 10 });
    expect(r.guides).toHaveLength(2);
    const labels = r.guides.map((g) => g.label).sort();
    expect(labels).toEqual(['30', '70']);
  });

  it('prefers the polyline that contains the bullet over a parallel-but-distant one', () => {
    const r = snapBullet({ x: 3, y: 150, polylines: verticalChain(0, 100, 200), tolerance: 10 });
    expect(r.x).toBeCloseTo(0, 5);
    expect(r.y).toBeCloseTo(150, 5);
    const labels = r.guides.map((g) => g.label).sort();
    expect(labels).toEqual(['50', '50']);
  });

  it('highlights the closest pair of stations, not the first parallel polyline', () => {
    const r = snapBullet({ x: 3, y: 270, polylines: verticalChain(0, 100, 200, 300), tolerance: 10 });
    expect(r.y).toBeCloseTo(270, 5);
    const labels = r.guides.map((g) => g.label).sort();
    expect(labels).toEqual(['30', '70']);
  });

  it('beyond-the-end bullet emits a single guide to the nearest endpoint', () => {
    const r = snapBullet({ x: 3, y: 350, polylines: verticalChain(0, 100, 200, 300), tolerance: 10 });
    expect(r.guides).toHaveLength(1);
    expect(r.guides[0].label).toBe('50');
  });

  it('before-the-start bullet emits a single guide to the nearest endpoint', () => {
    const r = snapBullet({ x: 3, y: -40, polylines: verticalChain(0, 100, 200, 300), tolerance: 10 });
    expect(r.guides).toHaveLength(1);
    expect(r.guides[0].label).toBe('40');
  });

  it('respects a curved polyline: bullet past a station with a horizontal tangent snaps horizontal', () => {
    // Mimics the Embankment ↔ Fo Tan corridor: Embankment's tangent is
    // horizontal, then the band curves to meet Fo Tan slightly south. The
    // centerline polyline starts horizontally before bending. A bullet
    // placed alongside Embankment's horizontal section should snap onto
    // the horizontal — NOT to the straight-line direction between stops.
    const polyline: { x: number; y: number }[] = [
      { x: 100, y: 0 }, // Embankment stop
      { x: 130, y: 0 }, // tangent extension (horizontal)
      { x: 150, y: 5 }, // start of curve
      { x: 170, y: 14 }, // end of curve
      { x: 200, y: 14 }, // Fo Tan stop
    ];
    const r = snapBullet({ x: 50, y: 4, polylines: [polyline], tolerance: 10 });
    // The horizontal segment near Embankment dominates: snap pins y → 0.
    expect(r.y).toBeCloseTo(0, 5);
    expect(r.x).toBeCloseTo(50, 5);
  });
});
