import { describe, it, expect } from 'vitest';
import { cellsAABBLocal, stationBoundaryRectsLocal } from './stationBoundary';
import { makeStation, makeStop } from '../test/fixtures';

// A waypoint with a single stop and its label one cell to the left (the
// fixture default). The label cell is at col -1, the stop at col 0, so
// including the label cell widens the box leftward.
const waypoint = () =>
  makeStation({ id: 'wp', isWaypoint: true, stops: [makeStop('L1', { row: 0, col: 0 })] });
const normal = () => makeStation({ id: 's1', stops: [makeStop('L1', { row: 0, col: 0 })] });

describe('stationBoundary — revealWaypoint flag', () => {
  it('omits the label rect for a hidden waypoint (default), keeps it for a normal station', () => {
    expect(stationBoundaryRectsLocal(waypoint()).label).toBeUndefined();
    expect(stationBoundaryRectsLocal(normal()).label).toBeDefined();
  });

  it('restores the label rect when the waypoint is revealed', () => {
    const rects = stationBoundaryRectsLocal(waypoint(), undefined, undefined, true);
    expect(rects.label).toBeDefined();
    expect(rects.label!.length).toBe(4); // a 4-vertex polygon like a normal label rect
  });

  it('is inert for a normal station regardless of the flag', () => {
    const off = stationBoundaryRectsLocal(normal(), undefined, undefined, false);
    const on = stationBoundaryRectsLocal(normal(), undefined, undefined, true);
    expect(on).toEqual(off);
  });

  it('widens the cells box to include the label cell only when revealed', () => {
    const hidden = cellsAABBLocal(waypoint());
    const revealed = cellsAABBLocal(waypoint(), undefined, true);
    // Revealing pulls the label cell (to the left) into the box, so it grows
    // leftward and gets wider.
    expect(revealed.w).toBeGreaterThan(hidden.w);
    expect(revealed.x).toBeLessThan(hidden.x);
  });

  it('leaves a normal station cells box unchanged by the flag', () => {
    expect(cellsAABBLocal(normal(), undefined, true)).toEqual(cellsAABBLocal(normal()));
  });
});
