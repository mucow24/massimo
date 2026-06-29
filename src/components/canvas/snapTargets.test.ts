import { describe, it, expect } from 'vitest';
import { stationStopCenters, allPolygonVertices } from './snapTargets';
import { stopPosWorld } from '../../geometry/interlining';
import { makeStation, makeStop, makePolygon } from '../../test/fixtures';

describe('stationStopCenters', () => {
  it('uses the bare anchor for a station with no stops', () => {
    const st = makeStation({ id: 's0', x: 12, y: -7 });
    expect(stationStopCenters({ s0: st })).toEqual([{ x: 12, y: -7 }]);
  });

  it('emits one stop center per stop (not the anchor) for a station with stops', () => {
    const st = makeStation({
      id: 's0',
      x: 100,
      y: 50,
      stops: [makeStop('L1', { row: 0, col: 0 }), makeStop('L1', { row: 1, col: 0 })],
    });
    const out = stationStopCenters({ s0: st });
    expect(out).toHaveLength(2);
    // Delegates to stopPosWorld for each stop, in stop order.
    expect(out).toEqual([stopPosWorld(st.stops[0], st), stopPosWorld(st.stops[1], st)]);
    // The two distinct cells must not collapse to a single point.
    expect(out[0]).not.toEqual(out[1]);
  });

  it('mixes anchored and stop-bearing stations across the whole record', () => {
    const bare = makeStation({ id: 'a', x: 1, y: 2 });
    const withStop = makeStation({ id: 'b', x: 9, y: 9, stops: [makeStop('L1')] });
    const out = stationStopCenters({ a: bare, b: withStop });
    expect(out).toHaveLength(2);
    expect(out).toContainEqual({ x: 1, y: 2 });
    expect(out).toContainEqual(stopPosWorld(withStop.stops[0], withStop));
  });
});

describe('allPolygonVertices', () => {
  const p0 = makePolygon({
    id: 'p0',
    vertices: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ],
  });
  const p1 = makePolygon({
    id: 'p1',
    vertices: [
      { x: 5, y: 5 },
      { x: 5, y: 15 },
    ],
  });

  it('flattens every vertex of every polygon', () => {
    expect(allPolygonVertices({ p0, p1 })).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 5 },
      { x: 5, y: 15 },
    ]);
  });

  it('omits the excluded polygon so a dragged shape never snaps to its own vertices', () => {
    expect(allPolygonVertices({ p0, p1 }, 'p1')).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
  });
});
