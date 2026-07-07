import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  DIR_8,
  STOP_SIZE,
  rotateBy,
  rotateGridDelta,
  worldDirToLocal,
  stopCenterAt,
  stripeOffsetsForWidths,
  tangentGap,
  travelDirLocal,
} from './orientation';
import type { Rotation, StopOrientation } from '../model/types';

const SQRT2_2 = Math.SQRT1_2;

describe('rotateBy', () => {
  it('returns the input for rotation 0', () => {
    const r = rotateBy({ x: 3, y: 5 }, 0);
    expect(r.x).toBeCloseTo(3, 10);
    expect(r.y).toBeCloseTo(5, 10);
  });

  it('rotates +y by 90° (rotation 2) to +x in screen-y-down coords', () => {
    // Screen y-down rotation 2 (90°): (0,1) → (-1, 0).
    const r = rotateBy({ x: 0, y: 1 }, 2);
    expect(r.x).toBeCloseTo(-1, 10);
    expect(r.y).toBeCloseTo(0, 10);
  });

  it('rotates +y by 180° (rotation 4) to -y', () => {
    const r = rotateBy({ x: 0, y: 1 }, 4);
    expect(r.x).toBeCloseTo(0, 10);
    expect(r.y).toBeCloseTo(-1, 10);
  });

  it('preserves length under any rotation', () => {
    for (let r = 0; r < 8; r++) {
      const out = rotateBy({ x: 3, y: 4 }, r as Rotation);
      expect(Math.hypot(out.x, out.y)).toBeCloseTo(5, 10);
    }
  });
});

describe('worldDirToLocal', () => {
  it('is the exact inverse of rotateBy (the local→world dir rotation) for every rotation', () => {
    const world = { x: 3, y: -5 };
    for (let r = 0; r < 8; r++) {
      const local = worldDirToLocal(world, r as Rotation);
      const back = rotateBy(local, r as Rotation);
      expect(back.x).toBeCloseTo(world.x, 10);
      expect(back.y).toBeCloseTo(world.y, 10);
    }
  });

  it('undoes a 90° (rotation 2) station rotation', () => {
    // A station rotated by 2 maps local +x to world (0, 1) in screen-y-down;
    // so the inverse must map world (0, 1) back to local +x.
    const local = worldDirToLocal({ x: 0, y: 1 }, 2);
    expect(local.x).toBeCloseTo(1, 10);
    expect(local.y).toBeCloseTo(0, 10);
  });
});

describe('travelDirLocal', () => {
  it('auto-vertical defaults to +y when no hint is supplied', () => {
    expect(travelDirLocal('auto-vertical', null)).toEqual({ x: 0, y: 1 });
  });

  it('auto-vertical follows the sign of the hint y component', () => {
    expect(travelDirLocal('auto-vertical', { x: 0, y: 0.5 })).toEqual({ x: 0, y: 1 });
    expect(travelDirLocal('auto-vertical', { x: 0, y: -0.5 })).toEqual({ x: 0, y: -1 });
  });

  it('auto-horizontal defaults to +x when no hint is supplied', () => {
    expect(travelDirLocal('auto-horizontal', null)).toEqual({ x: 1, y: 0 });
  });

  it('auto-horizontal follows the sign of the hint x component', () => {
    expect(travelDirLocal('auto-horizontal', { x: 0.5, y: 0 })).toEqual({ x: 1, y: 0 });
    expect(travelDirLocal('auto-horizontal', { x: -0.5, y: 0 })).toEqual({ x: -1, y: 0 });
  });

  it('auto-ne-sw defaults to NE (+x, -y) when no hint is supplied', () => {
    const d = travelDirLocal('auto-ne-sw', null);
    expect(d.x).toBeCloseTo(SQRT2_2, 10);
    expect(d.y).toBeCloseTo(-SQRT2_2, 10);
  });

  it('auto-ne-sw follows the sign of (hint.x - hint.y)', () => {
    // hint pointing NE (e.g. +x, -y): (1) - (-1) = 2 > 0 → NE.
    const ne = travelDirLocal('auto-ne-sw', { x: 1, y: -1 });
    expect(ne.x).toBeCloseTo(SQRT2_2, 10);
    expect(ne.y).toBeCloseTo(-SQRT2_2, 10);
    // hint pointing SW (-x, +y): (-1) - (1) = -2 < 0 → SW.
    const sw = travelDirLocal('auto-ne-sw', { x: -1, y: 1 });
    expect(sw.x).toBeCloseTo(-SQRT2_2, 10);
    expect(sw.y).toBeCloseTo(SQRT2_2, 10);
  });

  it('auto-nw-se defaults to SE (+x, +y) when no hint is supplied', () => {
    const d = travelDirLocal('auto-nw-se', null);
    expect(d.x).toBeCloseTo(SQRT2_2, 10);
    expect(d.y).toBeCloseTo(SQRT2_2, 10);
  });

  it('auto-nw-se follows the sign of (hint.x + hint.y)', () => {
    // hint pointing SE (+x, +y): 1 + 1 = 2 > 0 → SE.
    const se = travelDirLocal('auto-nw-se', { x: 1, y: 1 });
    expect(se.x).toBeCloseTo(SQRT2_2, 10);
    expect(se.y).toBeCloseTo(SQRT2_2, 10);
    // hint pointing NW (-x, -y): -1 + -1 = -2 < 0 → NW.
    const nw = travelDirLocal('auto-nw-se', { x: -1, y: -1 });
    expect(nw.x).toBeCloseTo(-SQRT2_2, 10);
    expect(nw.y).toBeCloseTo(-SQRT2_2, 10);
  });

  it('returns a unit vector for every orientation', () => {
    const all: StopOrientation[] = ['auto-vertical', 'auto-horizontal', 'auto-ne-sw', 'auto-nw-se'];
    for (const o of all) {
      const d = travelDirLocal(o);
      expect(Math.hypot(d.x, d.y)).toBeCloseTo(1, 10);
    }
  });
});

describe('stopCenterAt', () => {
  it('places (0,0) at the local origin', () => {
    expect(stopCenterAt(0, 0)).toEqual({ x: 0, y: 0 });
  });

  it('scales by STOP_SIZE per cell step', () => {
    expect(stopCenterAt(0, 1)).toEqual({ x: STOP_SIZE, y: 0 });
    expect(stopCenterAt(1, 0)).toEqual({ x: 0, y: STOP_SIZE });
    expect(stopCenterAt(2, -1)).toEqual({ x: -STOP_SIZE, y: 2 * STOP_SIZE });
  });
});

describe('DIR_8', () => {
  it('has 8 entries each with a unit-or-√2-magnitude (dRow, dCol)', () => {
    expect(DIR_8).toHaveLength(8);
    for (const d of DIR_8) {
      const m2 = d.dRow * d.dRow + d.dCol * d.dCol;
      expect([1, 2]).toContain(m2);
    }
  });

  it('anchor sign matches (dRow, dCol) sign', () => {
    for (const d of DIR_8) {
      if (d.dCol > 0) expect(d.anchor.x).toBeGreaterThan(0);
      if (d.dCol < 0) expect(d.anchor.x).toBeLessThan(0);
      if (d.dCol === 0) expect(d.anchor.x).toBe(0);
      if (d.dRow > 0) expect(d.anchor.y).toBeGreaterThan(0);
      if (d.dRow < 0) expect(d.anchor.y).toBeLessThan(0);
      if (d.dRow === 0) expect(d.anchor.y).toBe(0);
    }
  });
});

describe('rotateGridDelta', () => {
  // k counts 45°-steps: even k mirrors the per-step transform in
  // `rotateStationLayoutBy90(_, +1)` — (col, row) → (-row, col), i.e.
  // (dRow, dCol) → (dCol, -dRow) per two steps, integer-exact — and odd k
  // adds the `rotateStationLayoutBy45(_, +1)` half-step onto the diagonal
  // (±√2/2) lattice. Used by mirror-matching mass-edits to keep
  // moveStop/moveLabel deltas visually consistent across stations whose
  // layouts differ by a 45°·k rotation.
  const h = Math.SQRT1_2;

  it('k = 0 is identity', () => {
    expect(rotateGridDelta(1, 0, 0)).toEqual({ dRow: 1, dCol: 0 });
    expect(rotateGridDelta(0, 1, 0)).toEqual({ dRow: 0, dCol: 1 });
    expect(rotateGridDelta(-1, 2, 0)).toEqual({ dRow: -1, dCol: 2 });
  });

  it('k = 2 rotates one 90°-step CW in screen coords, integer-exact', () => {
    // Matches the layout step in rotateStationLayoutBy90: (1, 0) → (0, -1).
    expect(rotateGridDelta(1, 0, 2)).toEqual({ dRow: 0, dCol: -1 });
    expect(rotateGridDelta(0, 1, 2)).toEqual({ dRow: 1, dCol: 0 });
    expect(rotateGridDelta(-1, 0, 2)).toEqual({ dRow: 0, dCol: 1 });
  });

  it('k = 4 negates both components (180°)', () => {
    expect(rotateGridDelta(1, 0, 4)).toEqual({ dRow: -1, dCol: 0 });
    expect(rotateGridDelta(0, 1, 4)).toEqual({ dRow: 0, dCol: -1 });
    expect(rotateGridDelta(2, -3, 4)).toEqual({ dRow: -2, dCol: 3 });
  });

  it('k = 6 is the inverse of k = 2', () => {
    // (1, 0) → (0, 1).
    expect(rotateGridDelta(1, 0, 6)).toEqual({ dRow: 0, dCol: 1 });
    expect(rotateGridDelta(0, 1, 6)).toEqual({ dRow: -1, dCol: 0 });
  });

  it('k = 1 maps an orthogonal delta onto the diagonal lattice (45° CW)', () => {
    // South (1, 0) → SW (h, -h); east (0, 1) → SE (h, h).
    const sw = rotateGridDelta(1, 0, 1);
    expect(sw.dRow).toBeCloseTo(h, 12);
    expect(sw.dCol).toBeCloseTo(-h, 12);
    const se = rotateGridDelta(0, 1, 1);
    expect(se.dRow).toBeCloseTo(h, 12);
    expect(se.dCol).toBeCloseTo(h, 12);
  });

  it('k = 7 is the inverse of k = 1', () => {
    const d = rotateGridDelta(1, 0, 7);
    expect(d.dRow).toBeCloseTo(h, 12);
    expect(d.dCol).toBeCloseTo(h, 12);
  });

  it('odd k maps a diagonal delta back onto the orthogonal lattice', () => {
    // SE (h, h) rotated one 45° step CW → south (1, 0), up to one ulp.
    const d = rotateGridDelta(h, h, 1);
    expect(d.dRow).toBeCloseTo(1, 12);
    expect(d.dCol).toBeCloseTo(0, 12);
  });

  it('applying k=2 four times returns to the identity', () => {
    let r = 3;
    let c = -2;
    for (let i = 0; i < 4; i++) {
      const out = rotateGridDelta(r, c, 2);
      r = out.dRow;
      c = out.dCol;
    }
    expect({ dRow: r, dCol: c }).toEqual({ dRow: 3, dCol: -2 });
  });
});

describe('tangentGap', () => {
  it('is the mean of the two widths (center distance at which stripes touch)', () => {
    expect(tangentGap(14, 14)).toBe(14);
    expect(tangentGap(14, 28)).toBe(21);
    expect(tangentGap(2, 28)).toBe(15);
  });
});

describe('stripeOffsetsForWidths', () => {
  it('reduces bit-exactly to the historical (k - (n-1)/2) * STOP_SIZE for uniform default widths', () => {
    for (let n = 1; n <= 6; n++) {
      const offsets = stripeOffsetsForWidths(Array(n).fill(STOP_SIZE));
      for (let k = 0; k < n; k++) {
        // Strict toBe, not closeTo: legacy docs must render byte-identically.
        expect(offsets[k]).toBe((k - (n - 1) / 2) * STOP_SIZE);
      }
    }
  });

  it('returns [] for no widths and [0] for a single stripe of any width', () => {
    expect(stripeOffsetsForWidths([])).toEqual([]);
    expect(stripeOffsetsForWidths([5])).toEqual([0]);
    expect(stripeOffsetsForWidths([28])).toEqual([0]);
  });

  it('handles the canonical mixed pair: [14, 28] -> [-10.5, +10.5]', () => {
    expect(stripeOffsetsForWidths([14, 28])).toEqual([-10.5, 10.5]);
  });

  it('consecutive PRE-CENTERED positions differ by exactly tangentGap (exact dyadic arithmetic)', () => {
    // The tangency recurrence p_k = p_{k-1} + (w_{k-1}+w_k)/2 is exact for
    // integer widths (halves are dyadic). Assert it on the offsets via
    // pairwise differences of RECONSTRUCTED positions: offsets differ from
    // positions by one shared mean, so consecutive deltas survive centering
    // up to float rounding -- pin the exact property on re-accumulated
    // positions instead of the centered values.
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 60 }), { minLength: 2, maxLength: 8 }),
        (widths) => {
          let p = 0;
          const positions = widths.map((w, k) => {
            if (k === 0) return 0;
            p += (widths[k - 1] + w) / 2;
            return p;
          });
          for (let k = 0; k + 1 < widths.length; k++) {
            expect(positions[k + 1] - positions[k]).toBe(tangentGap(widths[k], widths[k + 1]));
          }
          // And the centered offsets track those positions to float precision.
          const offsets = stripeOffsetsForWidths(widths);
          for (let k = 0; k + 1 < widths.length; k++) {
            expect(offsets[k + 1] - offsets[k]).toBeCloseTo(
              tangentGap(widths[k], widths[k + 1]),
              9,
            );
          }
        },
      ),
    );
  });

  it('offsets are mean-centered (sum ~ 0) and reverse-antisymmetric', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 60 }), { minLength: 1, maxLength: 8 }),
        (widths) => {
          const offsets = stripeOffsetsForWidths(widths);
          const sum = offsets.reduce((a, b) => a + b, 0);
          expect(Math.abs(sum)).toBeLessThan(1e-9 * Math.max(1, ...offsets.map(Math.abs)) + 1e-12);
          // Reversing the widths mirrors the offsets: offsets(reverse(w)) ===
          // reverse(-offsets(w)) up to float noise.
          const rev = stripeOffsetsForWidths([...widths].reverse());
          const mirrored = offsets.map((o) => -o).reverse();
          for (let k = 0; k < offsets.length; k++) {
            expect(rev[k]).toBeCloseTo(mirrored[k], 9);
          }
        },
      ),
    );
  });

  it('the band envelope spans exactly the summed widths', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 60 }), { minLength: 1, maxLength: 8 }),
        (widths) => {
          const offsets = stripeOffsetsForWidths(widths);
          const n = widths.length;
          const lo = offsets[0] - widths[0] / 2;
          const hi = offsets[n - 1] + widths[n - 1] / 2;
          const total = widths.reduce((a, b) => a + b, 0);
          expect(hi - lo).toBeCloseTo(total, 9);
        },
      ),
    );
  });
});
