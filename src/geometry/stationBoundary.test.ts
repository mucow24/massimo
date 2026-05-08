import { describe, it, expect } from 'vitest';
import {
  routeBulletsForRect,
  stationBoundaryRectsLocal,
  stationLocalToWorld,
  stationsForRect,
} from './stationBoundary';
import { makeStation, makeStop, stationWithStop } from '../test/fixtures';
import { STOP_SIZE } from './orientation';
import type { RouteBullet } from '../model/types';

const makeBullet = (id: string, x: number, y: number, size = 12): RouteBullet => ({
  id,
  x,
  y,
  rotation: 0,
  lineId: null,
  shape: 'circle',
  size,
});

describe('stationBoundaryRectsLocal', () => {
  it('returns two 4-vertex rects (cells + label) in local coords', () => {
    const st = stationWithStop('A', 'L1', { x: 100, y: 100 });
    const { cells, label } = stationBoundaryRectsLocal(st);
    expect(cells).toHaveLength(4);
    expect(label).toHaveLength(4);
  });

  it('cells rect tightly bounds the stop cell with HIT_PAD', () => {
    // One stop at (row 0, col 0). Cells rect should be centered on origin
    // with size STOP_SIZE + 2*HIT_PAD. HIT_PAD is 2 in StationView.
    const st = makeStation({
      id: 'A',
      stops: [makeStop('L1', { row: 0, col: 0 })],
      // Push label far away so it doesn't overlap or extend the cells AABB
      // (cells AABB includes the label cell when both are at the same row/col
      // group — see allCells in StationView).
      label: { row: 0, col: 0, rotation: 0, offset: 0, align: 'auto', valign: 'middle' },
    });
    const { cells } = stationBoundaryRectsLocal(st);
    const xs = cells.map((p) => p.x);
    const ys = cells.map((p) => p.y);
    const HALF = STOP_SIZE / 2;
    const PAD = 2;
    expect(Math.min(...xs)).toBeCloseTo(-HALF - PAD, 5);
    expect(Math.max(...xs)).toBeCloseTo(HALF + PAD, 5);
    expect(Math.min(...ys)).toBeCloseTo(-HALF - PAD, 5);
    expect(Math.max(...ys)).toBeCloseTo(HALF + PAD, 5);
  });

  it('label rect rotates about the label anchor when label.rotation is non-zero', () => {
    const stUpright = stationWithStop('A', 'L1', { x: 0, y: 0 });
    const stDiag = makeStation({
      id: 'A',
      x: 0,
      y: 0,
      rotation: 0,
      stops: [makeStop('L1', { row: 0, col: 0 })],
      label: { row: 0, col: -1, rotation: 1, offset: 0, align: 'auto', valign: 'middle' }, // 45°
    });
    const upright = stationBoundaryRectsLocal(stUpright).label;
    const diag = stationBoundaryRectsLocal(stDiag).label;
    // The 45° label should not have axis-aligned vertices.
    const isAxisAligned = (poly: { x: number; y: number }[]) => {
      const xs = new Set(poly.map((p) => Math.round(p.x * 100) / 100));
      const ys = new Set(poly.map((p) => Math.round(p.y * 100) / 100));
      return xs.size === 2 && ys.size === 2;
    };
    expect(isAxisAligned(upright)).toBe(true);
    expect(isAxisAligned(diag)).toBe(false);
  });
});

describe('stationLocalToWorld', () => {
  it('translates by station.x/y when rotation is 0', () => {
    const st = makeStation({ id: 'A', x: 100, y: 50, rotation: 0 });
    expect(stationLocalToWorld(st, { x: 5, y: 7 })).toEqual({ x: 105, y: 57 });
  });

  it('rotates about station origin then translates for rotation=2 (90°)', () => {
    // Rotation index 2 = 90° clockwise (rotation*45° = 90°).
    const st = makeStation({ id: 'A', x: 0, y: 0, rotation: 2 });
    const out = stationLocalToWorld(st, { x: 10, y: 0 });
    expect(out.x).toBeCloseTo(0, 5);
    expect(out.y).toBeCloseTo(10, 5);
  });

  it('combines rotation and translation', () => {
    const st = makeStation({ id: 'A', x: 100, y: 50, rotation: 2 });
    const out = stationLocalToWorld(st, { x: 10, y: 0 });
    expect(out.x).toBeCloseTo(100, 5);
    expect(out.y).toBeCloseTo(60, 5);
  });
});

describe('stationsForRect', () => {
  it('returns ids of stations whose boundary overlaps the rect', () => {
    const a = stationWithStop('A', 'L1', { x: 0, y: 0 });
    const b = stationWithStop('B', 'L1', { x: 1000, y: 1000 });
    const stations = { A: a, B: b };
    const rect = { x0: -100, y0: -100, x1: 100, y1: 100 };
    expect(stationsForRect(stations, rect)).toEqual(['A']);
  });

  it('detects a station via its label rect when the rect only covers the label', () => {
    // Default label sits at col=-1 (left of the stop cell). A rect placed
    // a little left of the station origin should hit the label rect even if
    // it misses the cells rect.
    const st = stationWithStop('A', 'L1', { x: 0, y: 0 });
    const stations = { A: st };
    // Rect over the label only: x in [-30, -10], y in [-7, 7].
    const rect = { x0: -30, y0: -7, x1: -10, y1: 7 };
    expect(stationsForRect(stations, rect)).toEqual(['A']);
  });

  it('returns empty when no station overlaps', () => {
    const a = stationWithStop('A', 'L1', { x: 0, y: 0 });
    const stations = { A: a };
    const rect = { x0: 1000, y0: 1000, x1: 2000, y1: 2000 };
    expect(stationsForRect(stations, rect)).toEqual([]);
  });
});

describe('routeBulletsForRect', () => {
  it('returns ids of bullets whose square footprint overlaps the rect', () => {
    const b1 = makeBullet('b1', 0, 0, 12);
    const b2 = makeBullet('b2', 1000, 1000, 12);
    const bullets = { b1, b2 };
    const rect = { x0: -50, y0: -50, x1: 50, y1: 50 };
    expect(routeBulletsForRect(bullets, rect)).toEqual(['b1']);
  });

  it('detects a bullet whose footprint just barely intrudes the rect', () => {
    // Bullet centered at (60, 0) with size 12 → footprint x ∈ [48, 72].
    // Rect x ∈ [50, 70] → footprint overlaps in [50, 70]. Should hit.
    const b = makeBullet('b', 60, 0, 12);
    const rect = { x0: 50, y0: -10, x1: 70, y1: 10 };
    expect(routeBulletsForRect({ b }, rect)).toEqual(['b']);
  });

  it('returns empty when bullets are entirely outside the rect', () => {
    const b = makeBullet('b', 100, 100, 12);
    const rect = { x0: -10, y0: -10, x1: 10, y1: 10 };
    expect(routeBulletsForRect({ b }, rect)).toEqual([]);
  });

  it('handles inverted rect coords (negative width/height)', () => {
    const b = makeBullet('b', 0, 0, 12);
    // Rect from (50, 50) to (-50, -50) — same area, inverted endpoints.
    const rect = { x0: 50, y0: 50, x1: -50, y1: -50 };
    expect(routeBulletsForRect({ b }, rect)).toEqual(['b']);
  });
});
