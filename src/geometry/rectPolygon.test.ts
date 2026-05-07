import { describe, it, expect } from 'vitest';
import { rectIntersectsPolygon } from './rectPolygon';

const square = (cx: number, cy: number, half: number) => [
  { x: cx - half, y: cy - half },
  { x: cx + half, y: cy - half },
  { x: cx + half, y: cy + half },
  { x: cx - half, y: cy + half },
];

describe('rectIntersectsPolygon', () => {
  it('returns true when the polygon is entirely inside the rect', () => {
    const rect = { x0: -100, y0: -100, x1: 100, y1: 100 };
    expect(rectIntersectsPolygon(rect, square(0, 0, 5))).toBe(true);
  });

  it('returns true when the rect is entirely inside the polygon', () => {
    const rect = { x0: -1, y0: -1, x1: 1, y1: 1 };
    expect(rectIntersectsPolygon(rect, square(0, 0, 100))).toBe(true);
  });

  it('returns true on partial overlap (vertex inside rect)', () => {
    const rect = { x0: 0, y0: 0, x1: 10, y1: 10 };
    expect(rectIntersectsPolygon(rect, square(5, 5, 8))).toBe(true);
  });

  it('returns true when only edges cross (no vertex inside either)', () => {
    // A long, thin polygon that pokes through the rect with both endpoints
    // outside. Use a narrow diamond crossing horizontally.
    const rect = { x0: -10, y0: -10, x1: 10, y1: 10 };
    const poly = [
      { x: -50, y: 0 },
      { x: 0, y: -1 },
      { x: 50, y: 0 },
      { x: 0, y: 1 },
    ];
    expect(rectIntersectsPolygon(rect, poly)).toBe(true);
  });

  it('returns false when AABBs are disjoint', () => {
    const rect = { x0: 0, y0: 0, x1: 10, y1: 10 };
    expect(rectIntersectsPolygon(rect, square(100, 100, 5))).toBe(false);
  });

  it('returns false when polygon is adjacent but not touching', () => {
    const rect = { x0: 0, y0: 0, x1: 10, y1: 10 };
    expect(rectIntersectsPolygon(rect, square(20, 5, 5))).toBe(false);
  });
});
