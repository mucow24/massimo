import { describe, it, expect } from 'vitest';
import {
  DIR_8,
  STOP_SIZE,
  inputEdgeOffsetLocal,
  outputEdgeOffsetLocal,
  rotateBy,
  rotateGridDelta,
  segmentEndpoints,
  stopCenterAt,
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

describe('inputEdgeOffsetLocal / outputEdgeOffsetLocal', () => {
  const orientations: StopOrientation[] = [
    'auto-vertical',
    'auto-horizontal',
    'auto-ne-sw',
    'auto-nw-se',
  ];

  it('input offset is opposite to output offset for every orientation', () => {
    for (const o of orientations) {
      const i = inputEdgeOffsetLocal(o);
      const out = outputEdgeOffsetLocal(o);
      expect(i.x).toBeCloseTo(-out.x, 10);
      expect(i.y).toBeCloseTo(-out.y, 10);
    }
  });

  it('output offset has magnitude STOP_SIZE / 2', () => {
    for (const o of orientations) {
      const out = outputEdgeOffsetLocal(o);
      expect(Math.hypot(out.x, out.y)).toBeCloseTo(STOP_SIZE / 2, 10);
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

describe('segmentEndpoints', () => {
  it('with rotation-0 stations returns the local point as-is', () => {
    const e = segmentEndpoints(
      { x: 0, y: 0, rotation: 0 },
      { x: 10, y: 0 },
      'auto-vertical',
      { x: 100, y: 100, rotation: 0 },
      { x: 10, y: 0 },
      'auto-vertical',
    );
    expect(e.start).toEqual({ x: 10, y: 0 });
    expect(e.end).toEqual({ x: 110, y: 100 });
    expect(e.startDir).toEqual({ x: 0, y: 1 });
    expect(e.endDir).toEqual({ x: 0, y: 1 });
  });

  it('rotates local point and direction by the station rotation', () => {
    // Station at origin, rotation=2 (90° CW in screen-y-down). A local point
    // (10, 0) maps to world (0, 10); auto-vertical +y direction maps to (-1, 0).
    const e = segmentEndpoints(
      { x: 0, y: 0, rotation: 2 },
      { x: 10, y: 0 },
      'auto-vertical',
      { x: 0, y: 0, rotation: 0 },
      { x: 0, y: 0 },
      'auto-vertical',
    );
    expect(e.start.x).toBeCloseTo(0, 5);
    expect(e.start.y).toBeCloseTo(10, 5);
    expect(e.startDir.x).toBeCloseTo(-1, 5);
    expect(e.startDir.y).toBeCloseTo(0, 5);
  });

  it('uses the world travel hint to resolve auto-* orientations', () => {
    // auto-vertical at rotation 0, hint pointing up (-y world).
    const e = segmentEndpoints(
      { x: 0, y: 0, rotation: 0 },
      { x: 0, y: 0 },
      'auto-vertical',
      { x: 0, y: 0, rotation: 0 },
      { x: 0, y: 0 },
      'auto-vertical',
      { x: 0, y: -1 },
    );
    expect(e.startDir.y).toBe(-1);
    expect(e.endDir.y).toBe(-1);
  });

  it('resolves auto-ne-sw to the NE/SW unit vector matching the world hint', () => {
    // Two stations both rotation 0, both auto-ne-sw, world hint pointing NE.
    const e = segmentEndpoints(
      { x: 0, y: 0, rotation: 0 },
      { x: 0, y: 0 },
      'auto-ne-sw',
      { x: 100, y: -100, rotation: 0 },
      { x: 0, y: 0 },
      'auto-ne-sw',
      { x: SQRT2_2, y: -SQRT2_2 },
    );
    expect(e.startDir.x).toBeCloseTo(SQRT2_2, 10);
    expect(e.startDir.y).toBeCloseTo(-SQRT2_2, 10);
    expect(e.endDir.x).toBeCloseTo(SQRT2_2, 10);
    expect(e.endDir.y).toBeCloseTo(-SQRT2_2, 10);
  });

  it('resolves auto-nw-se to the NW/SE unit vector matching the world hint', () => {
    const e = segmentEndpoints(
      { x: 0, y: 0, rotation: 0 },
      { x: 0, y: 0 },
      'auto-nw-se',
      { x: 100, y: 100, rotation: 0 },
      { x: 0, y: 0 },
      'auto-nw-se',
      { x: SQRT2_2, y: SQRT2_2 },
    );
    expect(e.startDir.x).toBeCloseTo(SQRT2_2, 10);
    expect(e.startDir.y).toBeCloseTo(SQRT2_2, 10);
    expect(e.endDir.x).toBeCloseTo(SQRT2_2, 10);
    expect(e.endDir.y).toBeCloseTo(SQRT2_2, 10);
  });
});

describe('rotateGridDelta', () => {
  // Mirrors the per-step transform in `rotateStationLayoutBy90(_, +1)`:
  //   (col, row) → (-row, col)
  // i.e. (dRow, dCol) → (dCol, -dRow). Applied k times. Used by mirror-
  // matching mass-edits to keep moveStop/moveLabel deltas visually consistent
  // across stations whose layouts differ by a 90°·k rotation.

  it('k = 0 is identity', () => {
    expect(rotateGridDelta(1, 0, 0)).toEqual({ dRow: 1, dCol: 0 });
    expect(rotateGridDelta(0, 1, 0)).toEqual({ dRow: 0, dCol: 1 });
    expect(rotateGridDelta(-1, 2, 0)).toEqual({ dRow: -1, dCol: 2 });
  });

  it('k = 1 rotates one 90°-step CW in screen coords', () => {
    // Matches the layout step in rotateStationLayoutBy90: (1, 0) → (0, -1).
    expect(rotateGridDelta(1, 0, 1)).toEqual({ dRow: 0, dCol: -1 });
    expect(rotateGridDelta(0, 1, 1)).toEqual({ dRow: 1, dCol: 0 });
    expect(rotateGridDelta(-1, 0, 1)).toEqual({ dRow: 0, dCol: 1 });
  });

  it('k = 2 negates both components (180°)', () => {
    expect(rotateGridDelta(1, 0, 2)).toEqual({ dRow: -1, dCol: 0 });
    expect(rotateGridDelta(0, 1, 2)).toEqual({ dRow: 0, dCol: -1 });
    expect(rotateGridDelta(2, -3, 2)).toEqual({ dRow: -2, dCol: 3 });
  });

  it('k = 3 is the inverse of k = 1', () => {
    // (1, 0) → (0, 1).
    expect(rotateGridDelta(1, 0, 3)).toEqual({ dRow: 0, dCol: 1 });
    expect(rotateGridDelta(0, 1, 3)).toEqual({ dRow: -1, dCol: 0 });
  });

  it('applying k=1 four times returns to the identity', () => {
    let r = 3;
    let c = -2;
    for (let i = 0; i < 4; i++) {
      const out = rotateGridDelta(r, c, 1);
      r = out.dRow;
      c = out.dCol;
    }
    expect({ dRow: r, dCol: c }).toEqual({ dRow: 3, dCol: -2 });
  });
});
