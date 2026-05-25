import { describe, it, expect } from 'vitest';
import { latticeOffsets, projectScreenToLocal, type RowCol } from './lattice';

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

describe('projectScreenToLocal', () => {
  it('is the identity at rotation 0', () => {
    const ps = latticeOffsets('orthogonal', 2);
    const out = projectScreenToLocal(ps, 0);
    expect(keys(out)).toEqual(keys(ps));
  });

  it('rotates orthogonal screen-east into local-NE at rotation 1 (45° CW)', () => {
    // Screen east is (row=0, col=1). To paint at screen-east inside a SVG
    // rotated by +45° CW, the local point must be the inverse: (-√2/2, +√2/2).
    const [out] = projectScreenToLocal([{ row: 0, col: 1 }], 1);
    expect(close(out.row, -HALF_SQRT2)).toBe(true);
    expect(close(out.col, HALF_SQRT2)).toBe(true);
  });

  it('rotates orthogonal screen-east into local-N at rotation 2 (90° CW)', () => {
    const [out] = projectScreenToLocal([{ row: 0, col: 1 }], 2);
    expect(close(out.row, -1)).toBe(true);
    expect(close(out.col, 0)).toBe(true);
  });

  it('preserves point count regardless of rotation', () => {
    const ps = latticeOffsets('orthogonal', 2);
    for (const r of [0, 1, 2, 3, 4, 5, 6, 7] as const) {
      expect(projectScreenToLocal(ps, r)).toHaveLength(ps.length);
    }
  });

  it('round-trips orthogonal screen lattice back to the local orthogonal lattice at rotation 4', () => {
    // 180° rotation: each (row, col) maps to (-row, -col), which is still in
    // the integer orthogonal lattice. The output set should equal the input
    // set point-for-point.
    const ps = latticeOffsets('orthogonal', 2);
    const out = projectScreenToLocal(ps, 4);
    expect(keys(out)).toEqual(keys(ps));
  });
});
