import { describe, it, expect } from 'vitest';
import { snapBullet } from './snapBullet';
import { makeStation, makeStop } from '../test/fixtures';
import type { Line, Station, StationId } from '../model/types';

const lineFor = (id: string, ...stationIds: string[]): Line => ({
  id,
  service: id,
  color: '#000',
  stations: stationIds,
});

const stationsFor = (...sts: Station[]): Record<StationId, Station> => {
  const m: Record<StationId, Station> = {};
  for (const s of sts) m[s.id] = s;
  return m;
};

describe('snapBullet', () => {
  // Vertical line: stations a (0, 0) and b (0, 100), both with a stop on L1.
  // The line's stripe runs along x = 0, y ∈ [0, 100].
  const vertical = () => ({
    line: lineFor('L1', 'a', 'b'),
    stations: stationsFor(
      makeStation({ id: 'a', x: 0, y: 0, stops: [makeStop('L1')] }),
      makeStation({ id: 'b', x: 0, y: 100, stops: [makeStop('L1')] }),
    ),
  });

  // Horizontal line: stations c (0, 0) and d (100, 0), oriented so each
  // stop's travel direction is horizontal.
  const horizontal = () => ({
    line: lineFor('L1', 'c', 'd'),
    stations: stationsFor(
      makeStation({
        id: 'c',
        x: 0,
        y: 0,
        rotation: 2,
        stops: [makeStop('L1', { row: 0, col: 0 })],
      }),
      makeStation({
        id: 'd',
        x: 100,
        y: 0,
        rotation: 2,
        stops: [makeStop('L1', { row: 0, col: 0 })],
      }),
    ),
  });

  it('snaps a bullet near a vertical line: x is pinned, y is preserved', () => {
    // Bullet near the line at perpDist=4 — well within tolerance.
    const { line, stations } = vertical();
    const r = snapBullet({ x: 4, y: 50, line, stations, tolerance: 10 });
    expect(r.x).toBeCloseTo(0, 5);
    expect(r.y).toBeCloseTo(50, 5);
    expect(r.guides).toHaveLength(2);
  });

  it('snaps when the bullet sits BEYOND the line endpoints', () => {
    // Past the first station (y < 0). The bullet should still snap on x and
    // keep its negative y — bullets are typically placed alongside or just
    // past the end of a line.
    const { line, stations } = vertical();
    const r = snapBullet({ x: 6, y: -40, line, stations, tolerance: 10 });
    expect(r.x).toBeCloseTo(0, 5);
    expect(r.y).toBeCloseTo(-40, 5);
  });

  it('does NOT snap when the bullet is beyond perpendicular tolerance', () => {
    const { line, stations } = vertical();
    const r = snapBullet({ x: 50, y: 50, line, stations, tolerance: 10 });
    expect(r.x).toBe(50);
    expect(r.y).toBe(50);
    expect(r.guides).toEqual([]);
  });

  it('snaps a bullet near a horizontal line: y pinned, x preserved', () => {
    const { line, stations } = horizontal();
    const r = snapBullet({ x: 50, y: 4, line, stations, tolerance: 10 });
    expect(r.x).toBeCloseTo(50, 5);
    expect(r.y).toBeCloseTo(0, 5);
  });

  it('emits two guides labeled with distances to each segment endpoint', () => {
    const { line, stations } = vertical();
    const r = snapBullet({ x: 3, y: 30, line, stations, tolerance: 10 });
    // After snap, bullet is at (0, 30). Distances are 30 (to a at y=0) and
    // 70 (to b at y=100).
    expect(r.guides).toHaveLength(2);
    const labels = r.guides.map((g) => g.label).sort();
    expect(labels).toEqual(['30', '70']);
  });

  it('prefers the segment that contains the bullet over a parallel-but-distant one', () => {
    // L1: a (0, 0) — b (0, 100) — c (0, 200). Three stations on a single
    // vertical chain. Bullet at (3, 150) is between b and c — guides should
    // go to those, not to a + b.
    const line = lineFor('L1', 'a', 'b', 'c');
    const stations = stationsFor(
      makeStation({ id: 'a', x: 0, y: 0, stops: [makeStop('L1')] }),
      makeStation({ id: 'b', x: 0, y: 100, stops: [makeStop('L1')] }),
      makeStation({ id: 'c', x: 0, y: 200, stops: [makeStop('L1')] }),
    );
    const r = snapBullet({ x: 3, y: 150, line, stations, tolerance: 10 });
    expect(r.x).toBeCloseTo(0, 5);
    expect(r.y).toBeCloseTo(150, 5);
    const labels = r.guides.map((g) => g.label).sort();
    expect(labels).toEqual(['50', '50']);
  });
});
