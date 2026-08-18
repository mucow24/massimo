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

  it('merges two squares that only touch along a shared edge', () => {
    // Edge-to-edge contact with no overlapping area: the shared edge is
    // INTERIOR to the union, so both inputs must give it up and the result is
    // the single 20x10 rectangle. (A label rect whose edge lands exactly on
    // the cells rect's edge hits this.)
    const A: Pt[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const B: Pt[] = [
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
      { x: 10, y: 10 },
    ];
    const result = unionConvex(A, B);
    expect(result.length).toBe(1);
    expect(vertexSet(result[0])).toEqual(new Set(['0,0', '20,0', '20,10', '0,10']));
    expect(insideOrOn({ x: 5, y: 5 }, result[0])).toBe(true); // only in A
    expect(insideOrOn({ x: 15, y: 5 }, result[0])).toBe(true); // only in B
  });

  it('merges squares that overlap along part of a shared edge', () => {
    // A's right edge and B's left edge are collinear but only overlap on
    // y in [5, 10]; the union is an 8-corner staircase.
    const A: Pt[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const B: Pt[] = [
      { x: 10, y: 5 },
      { x: 20, y: 5 },
      { x: 20, y: 15 },
      { x: 10, y: 15 },
    ];
    const result = unionConvex(A, B);
    expect(result.length).toBe(1);
    expect(vertexSet(result[0])).toEqual(
      new Set(['0,0', '10,0', '10,5', '20,5', '20,15', '10,15', '10,10', '0,10']),
    );
    expect(insideOrOn({ x: 5, y: 2 }, result[0])).toBe(true); // only in A
    expect(insideOrOn({ x: 15, y: 12 }, result[0])).toBe(true); // only in B
  });

  it('keeps both squares when they nearly touch but do not', () => {
    // Disjoint by less than the across-edge PROBE (1e-3), with overlapping
    // spans so no stitch glue and no crossings exist. The touch-merge probe
    // must not fire here: A's near edge is NOT on B's boundary, so dropping it
    // strands the rest of A as an open chain and A silently vanishes — a label
    // rect passing within a hair of the cells rect mid-drag hits this.
    const A: Pt[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const B: Pt[] = [
      { x: 10.0005, y: 1 },
      { x: 20, y: 1 },
      { x: 20, y: 11 },
      { x: 10.0005, y: 11 },
    ];
    const result = unionConvex(A, B);
    expect(result.length).toBe(2);
    expect(result.some((p) => insideOrOn({ x: 5, y: 5 }, p))).toBe(true); // A survives
    expect(result.some((p) => insideOrOn({ x: 15, y: 6 }, p))).toBe(true); // B survives
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
