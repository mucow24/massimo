import { describe, it, expect } from 'vitest';
import {
  DIR_8,
  STOP_SIZE,
  inputEdgeOffsetLocal,
  isVerticalAxis,
  outputEdgeOffsetLocal,
  rotateBy,
  segmentEndpoints,
  stopCenterAt,
  travelDirLocal,
} from './orientation';
import type { Rotation, StopOrientation } from '../model/types';

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
  it('returns the named axis for explicit orientations', () => {
    expect(travelDirLocal('up')).toEqual({ x: 0, y: -1 });
    expect(travelDirLocal('down')).toEqual({ x: 0, y: 1 });
    expect(travelDirLocal('left')).toEqual({ x: -1, y: 0 });
    expect(travelDirLocal('right')).toEqual({ x: 1, y: 0 });
  });

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
});

describe('inputEdgeOffsetLocal / outputEdgeOffsetLocal', () => {
  const orientations: StopOrientation[] = [
    'up',
    'down',
    'left',
    'right',
    'auto-vertical',
    'auto-horizontal',
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

describe('isVerticalAxis', () => {
  it('flags up/down/auto-vertical as vertical', () => {
    expect(isVerticalAxis('up')).toBe(true);
    expect(isVerticalAxis('down')).toBe(true);
    expect(isVerticalAxis('auto-vertical')).toBe(true);
  });

  it('flags left/right/auto-horizontal as not vertical', () => {
    expect(isVerticalAxis('left')).toBe(false);
    expect(isVerticalAxis('right')).toBe(false);
    expect(isVerticalAxis('auto-horizontal')).toBe(false);
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
      'down',
      { x: 100, y: 100, rotation: 0 },
      { x: 10, y: 0 },
      'down',
    );
    expect(e.start).toEqual({ x: 10, y: 0 });
    expect(e.end).toEqual({ x: 110, y: 100 });
    expect(e.startDir).toEqual({ x: 0, y: 1 });
    expect(e.endDir).toEqual({ x: 0, y: 1 });
  });

  it('rotates local point and direction by the station rotation', () => {
    // Station at origin, rotation=2 (90° CW in screen-y-down). A local point
    // (10, 0) maps to world (0, 10); 'down' direction (0, 1) maps to (-1, 0).
    const e = segmentEndpoints(
      { x: 0, y: 0, rotation: 2 },
      { x: 10, y: 0 },
      'down',
      { x: 0, y: 0, rotation: 0 },
      { x: 0, y: 0 },
      'down',
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
});
