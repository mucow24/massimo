import { describe, it, expect } from 'vitest';
import { latticeOffsets, localLatticeOffsets, type RowCol } from './lattice';

const HALF_SQRT2 = Math.SQRT1_2;

// Stable string key for set/array comparison that tolerates float drift.
// Math.sin(Math.PI) is ~1e-16, not 0, so 180° rotations produce -0 which
// stringifies as "-0.0000" via toFixed — snap small magnitudes to +0 first.
const fmtN = (n: number) => (Math.abs(n) < 1e-10 ? 0 : n);
const key = (p: RowCol) => `${fmtN(p.row).toFixed(4)},${fmtN(p.col).toFixed(4)}`;
const keys = (ps: RowCol[]) => ps.map(key).sort();

const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;
const includesClose = (ps: RowCol[], target: RowCol, eps = 1e-9) =>
  ps.some((p) => close(p.row, target.row, eps) && close(p.col, target.col, eps));

describe('latticeOffsets', () => {
  it('omits the origin and emits (2·radius+1)² − 1 points', () => {
    for (const radius of [1, 2, 3]) {
      const ortho = latticeOffsets('orthogonal', radius);
      const diag = latticeOffsets('diagonal', radius);
      const expected = (2 * radius + 1) ** 2 - 1;
      expect(ortho).toHaveLength(expected);
      expect(diag).toHaveLength(expected);
      expect(ortho.some((p) => p.row === 0 && p.col === 0)).toBe(false);
      expect(diag.some((p) => p.row === 0 && p.col === 0)).toBe(false);
    }
  });

  describe('orthogonal basis', () => {
    it('includes integer cardinals at distance 1', () => {
      const ps = latticeOffsets('orthogonal', 2);
      expect(includesClose(ps, { row: 0, col: 1 })).toBe(true); // E
      expect(includesClose(ps, { row: 0, col: -1 })).toBe(true); // W
      expect(includesClose(ps, { row: 1, col: 0 })).toBe(true); // S
      expect(includesClose(ps, { row: -1, col: 0 })).toBe(true); // N
    });

    it('includes integer diagonals at distance √2 (corner-touching with a gap)', () => {
      const ps = latticeOffsets('orthogonal', 2);
      expect(includesClose(ps, { row: 1, col: 1 })).toBe(true); // SE
      expect(includesClose(ps, { row: -1, col: 1 })).toBe(true); // NE
      expect(includesClose(ps, { row: 1, col: -1 })).toBe(true); // SW
      expect(includesClose(ps, { row: -1, col: -1 })).toBe(true); // NW
    });

    it('extends out to ±radius in each axis', () => {
      const ps = latticeOffsets('orthogonal', 2);
      expect(includesClose(ps, { row: 0, col: 2 })).toBe(true);
      expect(includesClose(ps, { row: 2, col: 2 })).toBe(true);
      expect(includesClose(ps, { row: -2, col: -2 })).toBe(true);
    });
  });

  describe('diagonal basis', () => {
    it('includes tangent diagonals at distance 1', () => {
      const ps = latticeOffsets('diagonal', 2);
      // NE = (-√2/2, +√2/2), SE = (+√2/2, +√2/2), etc.
      expect(includesClose(ps, { row: -HALF_SQRT2, col: HALF_SQRT2 })).toBe(true); // NE
      expect(includesClose(ps, { row: HALF_SQRT2, col: HALF_SQRT2 })).toBe(true); // SE
      expect(includesClose(ps, { row: HALF_SQRT2, col: -HALF_SQRT2 })).toBe(true); // SW
      expect(includesClose(ps, { row: -HALF_SQRT2, col: -HALF_SQRT2 })).toBe(true); // NW
    });

    it('includes "purely cardinal" composite positions at distance √2', () => {
      // NE + SE = (0, √2): east at distance √2.
      const ps = latticeOffsets('diagonal', 2);
      expect(includesClose(ps, { row: 0, col: Math.SQRT2 })).toBe(true);
      expect(includesClose(ps, { row: 0, col: -Math.SQRT2 })).toBe(true);
      expect(includesClose(ps, { row: Math.SQRT2, col: 0 })).toBe(true);
      expect(includesClose(ps, { row: -Math.SQRT2, col: 0 })).toBe(true);
    });

    it('is disjoint from the orthogonal lattice (except at the origin)', () => {
      // Both lattices generated at the same radius — the disjointness claim
      // is the whole point of offering both as complementary placement sets.
      const ortho = new Set(keys(latticeOffsets('orthogonal', 3)));
      const diag = new Set(keys(latticeOffsets('diagonal', 3)));
      for (const k of diag) {
        expect(ortho.has(k)).toBe(false);
      }
    });
  });
});

describe('localLatticeOffsets', () => {
  const ROTATIONS = [0, 1, 2, 3, 4, 5, 6, 7] as const;
  const BASES = ['orthogonal', 'diagonal'] as const;

  it('is the identity at rotation 0', () => {
    for (const basis of BASES) {
      expect(keys(localLatticeOffsets(basis, 2, 0))).toEqual(keys(latticeOffsets(basis, 2)));
    }
  });

  it('preserves point count regardless of rotation', () => {
    for (const basis of BASES) {
      for (const r of ROTATIONS) {
        expect(localLatticeOffsets(basis, 2, r)).toHaveLength(latticeOffsets(basis, 2).length);
      }
    }
  });

  it('leaves the slot set unchanged at the quarter turns', () => {
    // A 90° turn permutes a lattice onto itself, so the reachable slots at
    // rotation 2/4/6 are the very same cells as at rotation 0. Only the
    // arrow→slot mapping turns with the station, and that lives in nudgeTarget.
    for (const basis of BASES) {
      for (const r of [0, 2, 4, 6] as const) {
        expect(keys(localLatticeOffsets(basis, 2, r))).toEqual(keys(latticeOffsets(basis, 2)));
      }
    }
  });

  it('swaps the two bases at the eighth turns', () => {
    // The design fact behind the non-integer cells a rotated station records: a
    // screen-orthogonal lattice seen from a 45°-rotated local frame IS the
    // diagonal lattice, so those ±√2/2 cells are the same ones Shift-drag
    // already writes at rotation 0 — not a third, irrational family. And a
    // screen-DIAGONAL choice comes back on the integer lattice.
    for (const r of [1, 3, 5, 7] as const) {
      expect(keys(localLatticeOffsets('orthogonal', 2, r))).toEqual(
        keys(latticeOffsets('diagonal', 2)),
      );
      expect(keys(localLatticeOffsets('diagonal', 2, r))).toEqual(
        keys(latticeOffsets('orthogonal', 2)),
      );
    }
  });

  it('offers exactly the slots the trig projection did', () => {
    // These offsets are added to a station's anchor cell and the sum is saved,
    // so the basis-picking form had to reproduce the rotation it replaced —
    // this is the pin that it changed only the drift, never a slot position.
    const trigProjected = (offsets: RowCol[], rotation: number): RowCol[] => {
      const rad = (((8 - rotation) % 8) * Math.PI) / 4;
      const c = Math.cos(rad);
      const s = Math.sin(rad);
      // The old body: rotateBy({ x: col, y: row }, inv), read back as (y, x).
      return offsets.map((o) => ({ row: o.col * s + o.row * c, col: o.col * c - o.row * s }));
    };
    for (const basis of BASES) {
      for (const r of ROTATIONS) {
        const want = trigProjected(latticeOffsets(basis, 2), r);
        const got = localLatticeOffsets(basis, 2, r);
        expect(got).toHaveLength(want.length);
        for (const w of want) expect(includesClose(got, w)).toBe(true);
      }
    }
  });

  // Exactness is the point of the rewrite: the offsets land on a cell the doc
  // can hold, not 1.0000000000000002 cells away from one.
  it('lands on values that are exactly integer or exactly k·√2/2', () => {
    const exact = (v: number) =>
      !Object.is(v, -0) && (Number.isInteger(v) || Number.isInteger(v / HALF_SQRT2));
    for (const basis of BASES) {
      for (const r of ROTATIONS) {
        for (const o of localLatticeOffsets(basis, 2, r)) {
          expect(exact(o.row)).toBe(true);
          expect(exact(o.col)).toBe(true);
        }
      }
    }
  });
});
