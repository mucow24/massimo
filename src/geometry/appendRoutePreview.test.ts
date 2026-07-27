import { describe, it, expect } from 'vitest';
import { makeDoc, makeLine, makeStation, makeStop } from '../test/fixtures';
import { connectStationsOnLine, spliceStationIntoEdge } from '../model/transforms';
import { buildBandGeometry, stopPosWorld } from './interlining';
import { appendRoutePreviewStripes } from './appendRoutePreview';
import type { Line, Station, StationId } from '../model/types';
import type { AppendCursor } from '../model/appendGestures';

// The Edit Stops route preview must promise EXACTLY the corridors the click
// delivers — same routing, same stop-cell spawn, same auto-orientation. Every
// test here checks the preview against ground truth: run the real transform,
// rebuild the real bands, compare.

const stop = (lineId: string) => makeStop(lineId, { orientation: 'auto-horizontal' });
const at = (id: string, x: number, y: number, lineIds: string[] = ['L1']): Station =>
  makeStation({ id, x, y, stops: lineIds.map(stop) });

// L1 runs a–b horizontally; c is an INTERCHANGE carrying only L2's stop, so a
// connect/splice onto it must spawn L1's stop one tangent gap east of L2's —
// off the station anchor.
const world = () => {
  const lines: Record<string, Line> = {
    L1: makeLine({ id: 'L1', service: 'A', color: '#cc0000', stations: ['a', 'b'] }),
    L2: makeLine({ id: 'L2', service: 'B', color: '#0000cc', stations: ['c'] }),
  };
  const stations: Record<string, Station> = {
    a: at('a', 0, 0),
    b: at('b', 100, 0),
    c: at('c', 200, 0, ['L2']),
  };
  return { lines, stations };
};

const stationCursor = (stationId: StationId): AppendCursor => ({ kind: 'station', stationId });
const edgeCursor = (from: StationId, to: StationId): AppendCursor => ({ kind: 'edge', from, to });

// The real post-click band for one corridor of the edited line.
const truthBand = (
  next: ReturnType<typeof connectStationsOnLine>,
  pairKey: string,
  lineId = 'L1',
) =>
  buildBandGeometry(next.stations, next.lines).find(
    (band) => band.pairKey === pairKey && band.lines.some((l) => l.id === lineId),
  );

describe('appendRoutePreviewStripes', () => {
  it('previews the connect corridor exactly as the click will route it', () => {
    const { lines, stations } = world();
    const preview = appendRoutePreviewStripes(stations, lines, 'L1', stationCursor('b'), 'c');

    const doc = makeDoc({ lines: Object.values(lines), stations: Object.values(stations) });
    const next = connectStationsOnLine(doc, 'L1', 'b', 'c');
    // Not vacuous: the click really lands L1's stop OFF c's anchor (c already
    // carries L2), so a preview that skipped the stop spawn would find nothing.
    const landed = stopPosWorld(
      next.stations.c.stops.find((s) => s.lineId === 'L1')!,
      next.stations.c,
    );
    expect(landed.x).not.toBeCloseTo(200);

    expect(preview).toHaveLength(1);
    expect(preview[0].band).toEqual(truthBand(next, 'b|c'));
    expect(preview[0].band.lines[preview[0].stripeIndex].id).toBe('L1');
  });

  it('previews BOTH halves of a splice, and not the corridor it cuts', () => {
    const { lines, stations } = world();
    // Arm a–b, hover c: the click subdivides a–b into a–c and b–c.
    const preview = appendRoutePreviewStripes(stations, lines, 'L1', edgeCursor('a', 'b'), 'c');

    const doc = makeDoc({ lines: Object.values(lines), stations: Object.values(stations) });
    const next = spliceStationIntoEdge(doc, 'L1', 'a', 'b', 'c');

    expect(preview.map((s) => s.band.pairKey).sort()).toEqual(['a|c', 'b|c']);
    for (const s of preview) expect(s.band).toEqual(truthBand(next, s.band.pairKey));
  });

  it('previews nothing for a click that only moves the pen, or a dead click', () => {
    const { lines, stations } = world();
    expect(appendRoutePreviewStripes(stations, lines, 'L1', null, 'b')).toEqual([]); // arms
    expect(appendRoutePreviewStripes(stations, lines, 'L1', stationCursor('b'), 'b')).toEqual([]); // disarms
    expect(appendRoutePreviewStripes(stations, lines, 'L1', edgeCursor('a', 'b'), 'a')).toEqual([]); // jumps
    expect(appendRoutePreviewStripes(stations, lines, 'L1', null, 'c')).toEqual([]); // dead
  });

  it('carries the edited line only — not a co-corridor neighbour sharing the band', () => {
    // L2 already runs a–b interlined with nothing; connecting L1 over the SAME
    // corridor merges both into one band, so the preview must point at L1's
    // own stripe rather than blindly at stripe 0.
    const lines: Record<string, Line> = {
      L1: makeLine({ id: 'L1', service: 'A', color: '#cc0000', stations: ['x'] }),
      L2: makeLine({ id: 'L2', service: 'B', color: '#0000cc', stations: ['x', 'y'] }),
    };
    const stations: Record<string, Station> = {
      // x carries L2's stop at the anchor and L1's one gap east; y only L2's.
      x: makeStation({
        id: 'x',
        x: 0,
        y: 0,
        stops: [stop('L2'), makeStop('L1', { col: 1, orientation: 'auto-horizontal' })],
      }),
      y: at('y', 100, 0, ['L2']),
    };
    const preview = appendRoutePreviewStripes(stations, lines, 'L1', stationCursor('x'), 'y');
    expect(preview).toHaveLength(1);
    expect(preview[0].band.lines[preview[0].stripeIndex].id).toBe('L1');
  });

  it('previews nothing when the line is gone', () => {
    const { lines, stations } = world();
    expect(appendRoutePreviewStripes(stations, lines, 'nope', stationCursor('b'), 'c')).toEqual([]);
  });
});
