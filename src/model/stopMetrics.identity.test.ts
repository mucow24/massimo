import { describe, it, expect } from 'vitest';
import { stopMetricsOf } from './stopMetrics';
import { makeLine, makeStation, makeStop, makeTransfer } from '../test/fixtures';
import type { Line, Station, StationId, Transfer } from './types';

/**
 * `stopMetricsOf`'s result must be REFERENCE-STABLE while its observable
 * content is unchanged.
 *
 * Every canvas station component resolves its geometry through this lookup
 * (`useStopMetrics`), subscribing to `stations` to do it — so a fresh function
 * per frame re-renders every station's hit area, label and silhouette on every
 * pointermove, bypassing StationView's memo. But a station MOVE cannot change
 * what this function answers for anyone: the only things it reads out of
 * `stations` are stop CELLS (`bodyDir`, unchanged by a move) and the two
 * booleans of `continues`, which come from the SIGN of a neighbour projection
 * and essentially never flip mid-drag.
 *
 * So: same content ⇒ same function object, and zustand's own Object.is bail-out
 * does the rest. Sign flips and real edits must still mint a fresh one.
 */

// A -- B -- C on one line, horizontal. B is the interesting one: it continues
// in both directions, and pushing a neighbour past it flips a sign.
function scene(over: { bx?: number; by?: number; ax?: number; cx?: number } = {}) {
  const stations: Record<StationId, Station> = {
    A: makeStation({ id: 'A', x: over.ax ?? -100, y: 0, stops: [] }),
    B: makeStation({
      id: 'B',
      x: over.bx ?? 0,
      y: over.by ?? 0,
      stops: [makeStop('L1', { orientation: 'auto-horizontal' })],
    }),
    C: makeStation({ id: 'C', x: over.cx ?? 100, y: 0, stops: [] }),
  };
  const line = makeLine({ id: 'L1', stations: ['A', 'B', 'C'] });
  line.edges = ['A|B', 'B|C'];
  const lines: Record<string, Line> = { L1: line };
  return { stations, lines, transfers: {} as Record<string, Transfer> };
}

/** A station move: new record, new Station object, same stops array. */
const moved = (
  stations: Record<StationId, Station>,
  id: StationId,
  dx: number,
  dy: number,
): Record<StationId, Station> => ({
  ...stations,
  [id]: { ...stations[id], x: stations[id].x + dx, y: stations[id].y + dy },
});

describe('stopMetricsOf — reference stability', () => {
  it('hands back the SAME function when only station positions moved', () => {
    const src = scene();
    const first = stopMetricsOf(src);
    // Two frames of a drag: B slides, then slides again. Neither can change
    // any stop's metrics — B still continues both ways, no cells moved.
    const f2 = stopMetricsOf({ ...src, stations: moved(src.stations, 'B', 3, 2) });
    const f3 = stopMetricsOf({
      ...src,
      stations: moved(moved(src.stations, 'B', 3, 2), 'B', 3, 2),
    });
    expect(f2).toBe(first);
    expect(f3).toBe(first);
  });

  it('a neighbour moving far away, still on the same side, keeps the function', () => {
    const src = scene();
    const first = stopMetricsOf(src);
    // C slides right; it is still on B's plus side, so nothing B sees changes.
    expect(stopMetricsOf({ ...src, stations: moved(src.stations, 'C', 400, 0) })).toBe(first);
  });

  it('MINTS A FRESH function when a projection sign actually flips', () => {
    const src = scene();
    const first = stopMetricsOf(src);
    const before = first(src.stations.B, src.stations.B.stops[0]).continues;
    expect(before).toEqual({ plus: true, minus: true });

    // Drag C across B to its left: both neighbours are now on the minus side,
    // so B's plus half carries no body at all.
    const flipped = { ...src, stations: moved(src.stations, 'C', -300, 0) };
    const after = stopMetricsOf(flipped);
    expect(after).not.toBe(first);
    expect(after(flipped.stations.B, flipped.stations.B.stops[0]).continues).toEqual({
      plus: false,
      minus: true,
    });
  });

  it('MINTS A FRESH function when a stop cell moves (transfer body heading)', () => {
    const base = scene();
    const src = {
      ...base,
      stations: {
        ...base.stations,
        B: {
          ...base.stations.B,
          stops: [
            makeStop('L1', { orientation: 'auto-horizontal' }),
            makeStop('L2', { orientation: 'auto-horizontal', col: 1 }),
          ],
        },
      },
      lines: { ...base.lines, L2: makeLine({ id: 'L2', stations: ['B'] }) },
      transfers: {
        t1: makeTransfer({
          id: 't1',
          a: { stationId: 'B', lineId: 'L1' },
          b: { stationId: 'B', lineId: 'L2' },
        }),
      },
    };
    const first = stopMetricsOf(src);
    // Same station object identity would be a cheat; re-cell the second stop.
    const recelled = {
      ...src,
      stations: {
        ...src.stations,
        B: {
          ...src.stations.B,
          stops: [
            makeStop('L1', { orientation: 'auto-horizontal' }),
            makeStop('L2', { orientation: 'auto-horizontal', row: 1 }),
          ],
        },
      },
    };
    expect(stopMetricsOf(recelled)).not.toBe(first);
  });

  it('MINTS A FRESH function when lines or transfers change', () => {
    const src = scene();
    const first = stopMetricsOf(src);
    expect(stopMetricsOf({ ...src, lines: { L1: { ...src.lines.L1, width: 20 } } })).not.toBe(
      first,
    );
    expect(
      stopMetricsOf({
        ...src,
        transfers: {
          t: makeTransfer({
            id: 't',
            a: { stationId: 'B', lineId: 'L1' },
            b: { stationId: 'A', lineId: 'L1' },
          }),
        },
      }),
    ).not.toBe(first);
  });

  it('MINTS A FRESH function when a station appears or vanishes', () => {
    const src = scene();
    const first = stopMetricsOf(src);
    const { C: _dropped, ...rest } = src.stations;
    void _dropped;
    expect(stopMetricsOf({ ...src, stations: rest })).not.toBe(first);
  });

  it('the reused function still answers correctly for the moved station', () => {
    const src = scene();
    stopMetricsOf(src);
    const next = { ...src, stations: moved(src.stations, 'B', 7, 5) };
    const fn = stopMetricsOf(next);
    const m = fn(next.stations.B, next.stations.B.stops[0]);
    expect(m.continues).toEqual({ plus: true, minus: true });
    expect(m.half).toBe(stopMetricsOf(src)(src.stations.B, src.stations.B.stops[0]).half);
  });
});
