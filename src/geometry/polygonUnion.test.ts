import { describe, it, expect } from 'vitest';
import { unionConvex, type Pt } from './polygonUnion';

// A ring's vertices as a canonical set of "x,y" strings (order-independent,
// rounded to absorb fp drift from intersection points).
const vertexSet = (ring: Pt[]): Set<string> =>
  new Set(ring.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`));

// Winding-number point-in-polygon (boundary counts as inside). Used to verify
// that a probe known to be inside one input also lies inside the union ring.
const insideOrOn = (p: Pt, ring: Pt[]): boolean => {
  // Ray cast to +x; even-odd. Treat near-boundary as inside.
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = ring[i];
    const b = ring[j];
    const intersect =
      a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
    if (intersect) inside = !inside;
  }
  return inside;
};

describe('unionConvex', () => {
  it('merges two half-overlapping axis-aligned squares into one L-shaped ring', () => {
    // A = [-10,-10]..[10,10]; B shifted (+10,+10) => [0,0]..[20,20].
    // They overlap on [0,10]x[0,10]; the union is an 8-corner L.
    const A: Pt[] = [
      { x: -10, y: -10 },
      { x: 10, y: -10 },
      { x: 10, y: 10 },
      { x: -10, y: 10 },
    ];
    const B: Pt[] = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ];
    const result = unionConvex(A, B);
    expect(result.length).toBe(1);

    // Hand-computed outer boundary of the union (the L / octagon corners).
    const expected = new Set([
      '-10,-10',
      '10,-10',
      '10,0',
      '20,0',
      '20,20',
      '0,20',
      '0,10',
      '-10,10',
    ]);
    expect(vertexSet(result[0])).toEqual(expected);

    // A point inside only-A and a point inside only-B both fall inside the
    // merged ring (the union really covers both inputs).
    expect(insideOrOn({ x: -8, y: -8 }, result[0])).toBe(true); // only in A
    expect(insideOrOn({ x: 18, y: 18 }, result[0])).toBe(true); // only in B
  });

  it('returns both inputs as separate rings when the squares are disjoint', () => {
    const A: Pt[] = [
      { x: -10, y: -10 },
      { x: 10, y: -10 },
      { x: 10, y: 10 },
      { x: -10, y: 10 },
    ];
    const B: Pt[] = [
      { x: 100, y: 100 },
      { x: 120, y: 100 },
      { x: 120, y: 120 },
      { x: 100, y: 120 },
    ];
    const result = unionConvex(A, B);
    // No crossings => no stitched segments => the [A, B] fallback.
    expect(result.length).toBe(2);
  });

  it('returns the outer square when one square is strictly nested in the other', () => {
    const A: Pt[] = [
      { x: -20, y: -20 },
      { x: 20, y: -20 },
      { x: 20, y: 20 },
      { x: -20, y: 20 },
    ];
    const B: Pt[] = [
      { x: -5, y: -5 },
      { x: 5, y: -5 },
      { x: 5, y: 5 },
      { x: -5, y: 5 },
    ];
    const result = unionConvex(A, B);
    expect(result.length).toBe(1);
    // The merged outline is exactly the outer square A's corners.
    expect(vertexSet(result[0])).toEqual(new Set(['-20,-20', '20,-20', '20,20', '-20,20']));
  });
});
