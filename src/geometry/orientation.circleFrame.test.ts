import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  STOP_SIZE,
  localToWorld,
  radialLocalTurn,
  rotRad,
  rotateBy,
  stationCellToWorld,
  stationDirToLocal,
  stationDirToWorld,
  stationFrameDeg,
  stationFrameRad,
  stopCenterAt,
  worldDirToLocal,
} from './orientation';
import { pointAtAngle, tangentAtAngle, wrapAngleToPi } from './lineCircle';
import { uprightTangentRotation } from '../model/autoOrient';
import type { Rotation } from '../model/types';

/**
 * The station FRAME family, tested at its owner. Every consumer surface —
 * stops, the name, the silhouette, the ghost lattice, the cursor read-back —
 * has its own line-circle test, but the primitives those all resolve through
 * had none, and `stationDirToWorld` / `stationDirToLocal` (the inverse pair)
 * were reached by no test at all. The invariants below are the ones the rest
 * of the ring geometry is entitled to assume.
 */

const CX = 100;
const CY = 100;
const R = 70;
const circle = { x: CX, y: CY, radius: R };

/** A station seated on the ring at polar angle `theta`, posed exactly as
 *  `circleSeat` poses one: on the circumference, at the upright tangent
 *  octant. */
const seatAt = (theta: number, labelRotation: Rotation = 0) => {
  const p = pointAtAngle(circle, theta);
  const t = tangentAtAngle(theta);
  return { x: p.x, y: p.y, rotation: uprightTangentRotation(t.x, t.y, labelRotation, theta) };
};

/** Seat angles that are NOT multiples of 45°, where the ring frame and the
 *  rounded octant genuinely disagree. Everything asserted at an octant seat
 *  passes for free, so the interesting cases have to be named. */
const OFF_OCTANT = [
  Math.PI / 8, // 22.5° — the worst case, exactly between two octants
  0.3,
  1.1,
  2.4,
  -0.7,
  -2.9,
  Math.PI / 8 + Math.PI, // the far side, where the uprightness flip has fired
];

const OCTANT_ANGLES = Array.from({ length: 8 }, (_, k) => (k * Math.PI) / 4);

describe('stationFrameRad', () => {
  it('off a ring is the octant, to the bit', () => {
    for (let r = 0; r < 8; r++) {
      const st = { x: 5, y: -9, rotation: r as Rotation };
      expect(Object.is(stationFrameRad(st, null), rotRad(r as Rotation))).toBe(true);
    }
  });

  it('on a ring AT an octant angle points along the octant, inside the exactness gate', () => {
    // A ring built on the axes must render byte-identically to what it did
    // before the frame existed. The ANGLE is not required to be bit-equal —
    // `radial + k·90°` goes through atan2 and a full-turn subtraction — only
    // to land inside the 1e-12 gate `stationDirToWorld` opens, which is what
    // routes an octant seat down the exact `rotateBy` path. That the path is
    // actually taken is pinned below, on the vectors themselves.
    for (const theta of OCTANT_ANGLES) {
      const st = seatAt(theta);
      const off = Math.abs(wrapAngleToPi(stationFrameRad(st, circle) - rotRad(st.rotation)));
      expect(off).toBeLessThan(1e-12);
    }
  });

  it('returns an UNWRAPPED angle — compare it through wrapAngleToPi, never raw', () => {
    // The candidates are `radial + k·90°` off a radial that may be negative,
    // so the winner can sit a full turn from the octant naming the same
    // direction. Every consumer in the module already wraps before comparing
    // (`stationDirToWorld`'s exactness gate, `radialLocalTurn`'s quarter-turn
    // count); a new one that reaches for `=== rotRad(rotation)` would be
    // wrong at a quarter of the ring, and silently so.
    const st = seatAt(Math.PI); // due west, where the winding shows
    expect(stationFrameRad(st, circle) - rotRad(st.rotation)).toBeCloseTo(2 * Math.PI, 12);
    expect(wrapAngleToPi(stationFrameRad(st, circle) - rotRad(st.rotation))).toBeCloseTo(0, 12);
  });

  it('off the octants is a quarter-turn of the RADIAL, not the rounded octant', () => {
    for (const theta of OFF_OCTANT) {
      const st = seatAt(theta);
      const frame = stationFrameRad(st, circle);
      const radial = Math.atan2(st.y - CY, st.x - CX);
      // A multiple of 90° off the true radial...
      const offRadial = wrapAngleToPi(frame - radial);
      expect(
        Math.abs(offRadial / (Math.PI / 2) - Math.round(offRadial / (Math.PI / 2))),
      ).toBeLessThan(1e-12);
      // ...and NOT the octant it rounds to.
      expect(Math.abs(wrapAngleToPi(frame - rotRad(st.rotation)))).toBeGreaterThan(1e-6);
    }
  });

  it('picks the quarter-turn NEAREST the octant — never more than 45° away', () => {
    fc.assert(
      fc.property(fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }), (theta) => {
        const st = seatAt(theta);
        const off = Math.abs(wrapAngleToPi(stationFrameRad(st, circle) - rotRad(st.rotation)));
        // A quarter-turn lattice can always be brought within 45°; a seat is
        // within 22.5° of its tangent, so in practice this is much tighter.
        expect(off).toBeLessThanOrEqual(Math.PI / 4 + 1e-12);
      }),
    );
  });

  it('a station AT the centre has no radial, and falls back to the octant', () => {
    const st = { x: CX, y: CY, rotation: 3 as Rotation };
    expect(Object.is(stationFrameRad(st, circle), rotRad(3))).toBe(true);
  });
});

describe('stationFrameDeg', () => {
  it('is stationFrameRad in degrees', () => {
    for (const theta of OFF_OCTANT) {
      const st = seatAt(theta);
      expect(stationFrameDeg(st, circle)).toBeCloseTo(
        (stationFrameRad(st, circle) * 180) / Math.PI,
        12,
      );
    }
  });
});

describe('stationCellToWorld', () => {
  it('puts lane k at exactly R + k·pitch, at every angle around the ring', () => {
    // THE invariant the frame exists for. Both concentric-arc gates compare
    // these radii against BAND_MERGE_TOL (0.5), so a lane that foreshortens
    // with the seat angle stops interlining — or stops arcing — depending on
    // where the stations happen to sit.
    for (const theta of [...OFF_OCTANT, ...OCTANT_ANGLES]) {
      const st = seatAt(theta);
      const out = radialLocalTurn(st, circle);
      for (const k of [0, 1, 2, 3]) {
        // Step k cells along whichever local axis points radially out.
        const local =
          out % 2 === 0 ? stopCenterAt(0, out === 0 ? k : -k) : stopCenterAt(out === 1 ? k : -k, 0);
        const p = stationCellToWorld(local, st, circle);
        expect(Math.hypot(p.x - CX, p.y - CY)).toBeCloseTo(R + k * STOP_SIZE, 9);
      }
    }
  });

  it('the ROUNDED octant does not — which is what the frame is for', () => {
    // The control for the test above: resolve the same cell through
    // `localToWorld` (rotation · 45°) and lane 3 lands well outside the
    // 0.5-unit tolerance the arc gates allow.
    const st = seatAt(Math.PI / 8);
    const out = radialLocalTurn(st, circle);
    const local =
      out % 2 === 0 ? stopCenterAt(0, out === 0 ? 3 : -3) : stopCenterAt(out === 1 ? 3 : -3, 0);
    const p = localToWorld(local, st);
    expect(Math.abs(Math.hypot(p.x - CX, p.y - CY) - (R + 3 * STOP_SIZE))).toBeGreaterThan(0.5);
  });

  it('off a ring is bit-identical to localToWorld', () => {
    for (let r = 0; r < 8; r++) {
      const st = { x: 12, y: -30, rotation: r as Rotation };
      for (const cell of [stopCenterAt(0, 0), stopCenterAt(1, -2), stopCenterAt(-3, 4)]) {
        const viaFrame = stationCellToWorld(cell, st, null);
        const direct = localToWorld(cell, st);
        expect(Object.is(viaFrame.x, direct.x)).toBe(true);
        expect(Object.is(viaFrame.y, direct.y)).toBe(true);
      }
    }
  });
});

describe('stationDirToWorld / stationDirToLocal', () => {
  it('are exact inverses on a ring', () => {
    // The read-back frame has to undo exactly what the placing frame did, or
    // a drag over a ring station's own dot resolves to a cell that dot is
    // not in.
    for (const theta of OFF_OCTANT) {
      const st = seatAt(theta);
      for (const v of [
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: 3, y: -5 },
        { x: -14, y: 28 },
      ]) {
        const back = stationDirToLocal(stationDirToWorld(v, st, circle), st, circle);
        expect(back.x).toBeCloseTo(v.x, 10);
        expect(back.y).toBeCloseTo(v.y, 10);
      }
    }
  });

  it('take the bit-exact rotateBy path off a ring', () => {
    // Not merely close: a trig rotation leaves a quarter turn of an integer
    // vector at (1, 6.1e-17), and that drift reached the DOCUMENT once — see
    // `rotateBy`. Nothing off a ring may pick it up.
    for (let r = 0; r < 8; r++) {
      const st = { x: 4, y: 7, rotation: r as Rotation };
      const v = { x: 3, y: -5 };
      const w = stationDirToWorld(v, st, null);
      const exact = rotateBy(v, r as Rotation);
      expect(Object.is(w.x, exact.x)).toBe(true);
      expect(Object.is(w.y, exact.y)).toBe(true);

      const l = stationDirToLocal(v, st, null);
      const exactInv = worldDirToLocal(v, r as Rotation);
      expect(Object.is(l.x, exactInv.x)).toBe(true);
      expect(Object.is(l.y, exactInv.y)).toBe(true);
    }
  });

  it('take it ON a ring too, when the seat sits at an octant angle', () => {
    for (const theta of OCTANT_ANGLES) {
      const st = seatAt(theta);
      const v = { x: 0, y: 14 };
      const w = stationDirToWorld(v, st, circle);
      const exact = rotateBy(v, st.rotation);
      expect(Object.is(w.x, exact.x)).toBe(true);
      expect(Object.is(w.y, exact.y)).toBe(true);
    }
  });

  it('stationDirToWorld is stationCellToWorld without the translation', () => {
    const st = seatAt(Math.PI / 8);
    const cell = stopCenterAt(1, 2);
    const p = stationCellToWorld(cell, st, circle);
    const d = stationDirToWorld(cell, st, circle);
    expect(d.x).toBeCloseTo(p.x - st.x, 10);
    expect(d.y).toBeCloseTo(p.y - st.y, 10);
  });
});

describe('radialLocalTurn', () => {
  it('names the local axis that points radially OUT', () => {
    for (const theta of [...OFF_OCTANT, ...OCTANT_ANGLES]) {
      const st = seatAt(theta);
      const axes = [
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: -1, y: 0 },
        { x: 0, y: -1 },
      ];
      const w = stationDirToWorld(axes[radialLocalTurn(st, circle)], st, circle);
      const radial = { x: (st.x - CX) / R, y: (st.y - CY) / R };
      expect(w.x * radial.x + w.y * radial.y).toBeCloseTo(1, 9);
    }
  });

  it('only ever flips between one pair of OPPOSITES around a whole ring', () => {
    // What `reseatCircleLayout` rests on: a seat puts local ±x on the radial,
    // so re-seating can turn the frame 180° (the label-uprightness flip) but
    // never a quarter — a seat can't leave a layout a quarter-turn out.
    const turns = new Set<number>();
    for (let i = 0; i < 720; i++) turns.add(radialLocalTurn(seatAt((i * Math.PI) / 360), circle));
    expect([...turns].sort()).toEqual([0, 2]);
  });

  it('the flip is what makes a lane change sides — hence the cell negation', () => {
    // Two seats a half-ring apart read the same `col: 1` cell as opposite
    // radial directions. Pinned here because it is the precondition for
    // `reseatCircleLayout`, which is tested from the transform side.
    const a = seatAt(Math.PI / 8);
    const b = seatAt(Math.PI / 8 + Math.PI);
    expect(radialLocalTurn(a, circle)).not.toBe(radialLocalTurn(b, circle));

    const rOf = (st: { x: number; y: number; rotation: Rotation }) => {
      const p = stationCellToWorld(stopCenterAt(0, 1), st, circle);
      return Math.hypot(p.x - CX, p.y - CY);
    };
    expect(rOf(a) - R).toBeCloseTo(-(rOf(b) - R), 9);
  });
});
