import { describe, it, expect } from 'vitest';
import { normalizeAABB, rectIntersectsPolygon } from './rectPolygon';

describe('normalizeAABB', () => {
  it('passes through an already-normalized rect', () => {
    expect(normalizeAABB({ x0: -3, y0: -4, x1: 5, y1: 6 })).toEqual({
      xLo: -3,
      xHi: 5,
      yLo: -4,
      yHi: 6,
    });
  });

  it('sorts each axis so Lo <= Hi regardless of corner order', () => {
    // x0>x1 and y0>y1: the rect is given "bottom-right to top-left".
    expect(normalizeAABB({ x0: 5, y0: 6, x1: -3, y1: -4 })).toEqual({
      xLo: -3,
      xHi: 5,
      yLo: -4,
      yHi: 6,
    });
  });
});

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

describe('rectIntersectsPolygon (open chains, closed = false)', () => {
  it('a rect fully inside the vertex loop hits a closed polygon but not an open chain', () => {
    const rect = { x0: -1, y0: -1, x1: 1, y1: 1 };
    expect(rectIntersectsPolygon(rect, square(0, 0, 100), true)).toBe(true);
    expect(rectIntersectsPolygon(rect, square(0, 0, 100), false)).toBe(false);
  });

  it('crossing only the closing edge (last → first) counts only when closed', () => {
    // square()'s closing edge is the left side x = -10. This rect straddles
    // that edge mid-height: no vertex inside, no other edge near it.
    const rect = { x0: -12, y0: -2, x1: -8, y1: 2 };
    expect(rectIntersectsPolygon(rect, square(0, 0, 10), true)).toBe(true);
    expect(rectIntersectsPolygon(rect, square(0, 0, 10), false)).toBe(false);
  });

  it('still hits an open chain when a vertex lies inside the rect', () => {
    const rect = { x0: -15, y0: -15, x1: -5, y1: -5 }; // contains vertex (-10,-10)
    expect(rectIntersectsPolygon(rect, square(0, 0, 10), false)).toBe(true);
  });

  it('still hits an open chain when a non-closing edge crosses the rect', () => {
    // The top edge y = -10 passes through with both endpoints outside.
    const rect = { x0: -5, y0: -12, x1: 5, y1: -8 };
    expect(rectIntersectsPolygon(rect, square(0, 0, 10), false)).toBe(true);
  });
});
