import { describe, it, expect } from 'vitest';
import {
  unionAll,
  intersect,
  subtract,
  offsetOpenPath,
  offsetClosed,
  offsetNormalized,
  splitIntoFaces,
  pointInFace,
  faceArea,
  interiorPoint,
} from './clip';
import type { Vec2 } from './vec';

/** Axis-aligned square ring, consistent winding for all test shapes. */
const sq = (cx: number, cy: number, half: number): Vec2[] => [
  { x: cx - half, y: cy - half },
  { x: cx + half, y: cy - half },
  { x: cx + half, y: cy + half },
  { x: cx - half, y: cy + half },
];

const totalArea = (rings: Vec2[][]): number =>
  splitIntoFaces(rings).reduce((s, f) => s + faceArea(f), 0);

describe('unionAll', () => {
  it('merges two overlapping squares into one ring with the combined area', () => {
    // [-10,10]² and [-2,18]×[-10,10]: overlap 12×20 = 240 → 400+400-240 = 560.
    const out = unionAll([sq(0, 0, 10), sq(8, 0, 10)]);
    const faces = splitIntoFaces(out);
    expect(faces).toHaveLength(1);
    expect(faces[0].length).toBe(1); // no holes
    expect(faceArea(faces[0])).toBeCloseTo(560, 0);
  });

  it('keeps disjoint squares as separate faces', () => {
    const out = unionAll([sq(0, 0, 10), sq(100, 0, 10)]);
    expect(splitIntoFaces(out)).toHaveLength(2);
    expect(totalArea(out)).toBeCloseTo(800, 0);
  });

  it('merges exactly edge-tangent squares into one face without slivers', () => {
    // Squares sharing the full edge x=10.
    const out = unionAll([sq(0, 0, 10), sq(20, 0, 10)]);
    const faces = splitIntoFaces(out);
    expect(faces).toHaveLength(1);
    expect(faceArea(faces[0])).toBeCloseTo(800, 0);
  });

  it('unions exactly coincident squares to a single square', () => {
    const out = unionAll([sq(0, 0, 10), sq(0, 0, 10)]);
    expect(totalArea(out)).toBeCloseTo(400, 0);
  });

  it('keeps same-winding overlap solid (NonZero fill, not EvenOdd)', () => {
    // Two same-winding overlapping rings: winding number 2 in the overlap.
    // EvenOdd would punch the overlap out as a hole; NonZero must keep it solid.
    const out = unionAll([sq(0, 0, 10), sq(8, 0, 10)]);
    const faces = splitIntoFaces(out);
    expect(faces).toHaveLength(1);
    expect(faces[0].length).toBe(1); // no hole where the rings overlap
    expect(faceArea(faces[0])).toBeCloseTo(560, 0);
  });
});

describe('intersect', () => {
  it('returns the shared rect of two overlapping squares', () => {
    const out = intersect([sq(0, 0, 10)], [sq(8, 0, 10)]);
    expect(totalArea(out)).toBeCloseTo(240, 0);
  });

  it('returns the full square for exactly coincident inputs', () => {
    const out = intersect([sq(0, 0, 10)], [sq(0, 0, 10)]);
    expect(totalArea(out)).toBeCloseTo(400, 0);
  });

  it('returns nothing for edge-tangent squares (no sliver faces)', () => {
    const out = intersect([sq(0, 0, 10)], [sq(20, 0, 10)]);
    expect(totalArea(out)).toBeCloseTo(0, 3);
  });
});

describe('subtract', () => {
  it('punches a hole: big square minus centered small square', () => {
    const out = subtract([sq(0, 0, 10)], [sq(0, 0, 2)]);
    const faces = splitIntoFaces(out);
    expect(faces).toHaveLength(1);
    expect(faces[0].length).toBe(2); // outer + one hole
    expect(faceArea(faces[0])).toBeCloseTo(400 - 16, 0);
  });

  it('leaves the subject unchanged when the clip is disjoint', () => {
    const out = subtract([sq(0, 0, 10)], [sq(100, 0, 10)]);
    expect(totalArea(out)).toBeCloseTo(400, 0);
  });
});

describe('offsetOpenPath', () => {
  it('strokes a straight segment into a butt-capped rectangle', () => {
    const out = offsetOpenPath(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      7,
    );
    expect(totalArea(out)).toBeCloseTo(1400, -1);
    const faces = splitIntoFaces(out);
    expect(pointInFace({ x: 50, y: 6.5 }, faces[0])).toBe(true);
    expect(pointInFace({ x: 50, y: -6.5 }, faces[0])).toBe(true);
    // Butt cap: nothing beyond the endpoints.
    expect(pointInFace({ x: -1, y: 0 }, faces[0])).toBe(false);
    expect(pointInFace({ x: 101, y: 0 }, faces[0])).toBe(false);
    expect(pointInFace({ x: 50, y: 7.5 }, faces[0])).toBe(false);
  });

  it('rounds the outer side of a corner (round join, not miter or square)', () => {
    // Right-angle path: +x then +y (screen y-down), corner at (100, 0).
    const out = offsetOpenPath(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      7,
    );
    const faces = splitIntoFaces(out);
    expect(faces).toHaveLength(1);
    const face = faces[0];
    // Inside the round join wedge (r ≈ 5.9 < 7 from the corner) but beyond the
    // square-join chord x - y = 107 → excluded by a square join.
    expect(pointInFace({ x: 104.2, y: -4.2 }, face)).toBe(true);
    // Beyond the arc (r ≈ 7.8 > 7) but inside the miter wedge → excluded by round.
    expect(pointInFace({ x: 105.5, y: -5.5 }, face)).toBe(false);
    // Union area: 1400 + 1400 − 49 (inner overlap) + 49π/4 (round join wedge).
    const expected = 1400 + 1400 - 49 + (49 * Math.PI) / 4;
    expect(totalArea(out)).toBeGreaterThan(expected - 5);
    expect(totalArea(out)).toBeLessThan(expected + 5);
  });
});

describe('offsetClosed', () => {
  it('erodes a square inward', () => {
    const out = offsetClosed([sq(0, 0, 10)], -3);
    expect(totalArea(out)).toBeCloseTo(196, 0);
  });

  it('erodes a hairline sliver to nothing', () => {
    const sliver: Vec2[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 0.2 },
      { x: 0, y: 0.2 },
    ];
    expect(totalArea(offsetClosed([sliver], -0.15))).toBeCloseTo(0, 3);
  });

  it('dilates a square outward (rounded corners)', () => {
    const out = offsetClosed([sq(0, 0, 10)], 2);
    // 400 + perimeter·δ + π·δ² = 400 + 160 + 4π ≈ 572.6
    expect(totalArea(out)).toBeGreaterThan(565);
    expect(totalArea(out)).toBeLessThan(575);
  });
});

describe('splitIntoFaces / pointInFace / interiorPoint', () => {
  it('rejects points inside a hole and accepts points in the solid ring', () => {
    const faces = splitIntoFaces(subtract([sq(0, 0, 10)], [sq(0, 0, 2)]));
    const face = faces[0];
    expect(pointInFace({ x: 0, y: 0 }, face)).toBe(false); // in the hole
    expect(pointInFace({ x: 0, y: 6 }, face)).toBe(true); // in the ring solid
    expect(pointInFace({ x: 0, y: 12 }, face)).toBe(false); // outside
  });

  it('finds an interior point of a crescent whose bbox center is outside', () => {
    // C-shape: big square minus a bite covering its center and right side.
    const rings = subtract(
      [sq(0, 0, 10)],
      [
        [
          { x: -6, y: -6 },
          { x: 14, y: -6 },
          { x: 14, y: 6 },
          { x: -6, y: 6 },
        ],
      ],
    );
    const faces = splitIntoFaces(rings);
    expect(faces).toHaveLength(1);
    const face = faces[0];
    // bbox center of the C is (0, 0)-ish, which is inside the bite (excluded).
    expect(pointInFace({ x: 0, y: 0 }, face)).toBe(false);
    const p = interiorPoint(face);
    expect(p).not.toBeNull();
    expect(pointInFace(p!, face)).toBe(true);
  });

  it('finds an interior point of an annulus (never inside the hole)', () => {
    const faces = splitIntoFaces(subtract([sq(0, 0, 10)], [sq(0, 0, 6)]));
    const face = faces[0];
    const p = interiorPoint(face);
    expect(p).not.toBeNull();
    expect(pointInFace(p!, face)).toBe(true);
  });
});

describe('offsetNormalized', () => {
  it('matches offsetClosed exactly on engine-output faces with holes, both delta signs', () => {
    // A square with a square hole, produced BY the engine (subtract), so its
    // winding is the engine's own convention — the input contract of
    // offsetNormalized. If the skipped normalization were load-bearing here,
    // the negative delta would grow the hole instead of shrinking the face.
    const donut = subtract([sq(0, 0, 20)], [sq(0, 0, 8)]);
    const face = splitIntoFaces(donut)[0];
    expect(face.length).toBe(2); // outer + hole — the orientation-sensitive case
    for (const delta of [3, -3]) {
      for (const join of ['round', 'miter'] as const) {
        expect(offsetNormalized(face, delta, join)).toEqual(offsetClosed(face, delta, join));
      }
    }
  });

  it('matches offsetClosed on multi-face boolean output', () => {
    const two = unionAll([sq(0, 0, 10), sq(100, 0, 10)]);
    expect(offsetNormalized(two, 2)).toEqual(offsetClosed(two, 2));
    expect(offsetNormalized(two, -2)).toEqual(offsetClosed(two, -2));
  });
});
