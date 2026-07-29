import { describe, it, expect } from 'vitest';
import { snapDraggedStation, DEFAULT_SNAP_MODES, type SnapModes } from '../geometry/snap';
import { makeDoc, makeLine, makeStation, makeStop } from '../test/fixtures';
import { spliceStationIntoEdge } from '../model/transforms';
import { pairKeyOf } from '../model/pairKey';
import { neighborsOf } from '../model/lineTopology';
import type { Line, LineId, Station, StationId } from '../model/types';

const stationsRec = (...ss: Station[]): Record<StationId, Station> => {
  const m: Record<StationId, Station> = {};
  for (const s of ss) m[s.id] = s;
  return m;
};
const linesRec = (...ls: Line[]): Record<LineId, Line> => {
  const m: Record<LineId, Line> = {};
  for (const l of ls) m[l.id] = l;
  return m;
};

const equidistantOnly: SnapModes = { ...DEFAULT_SNAP_MODES, line: true, equidistant: true };

describe('refineAlongAxis equidistant: neighbours must come from the edge graph', () => {
  // Vertical corridor (default `auto-vertical` stops), x = 0 for every station.
  //
  // TRACK order (the edge set)          a(0) — d(20) — b(?) — c(200)
  // MEMBERSHIP order (`line.stations`)  ['a', 'b', 'c', 'd']
  //
  // That divergence is exactly what `spliceStationIntoEdge` produces (it
  // APPENDS the spliced station to `stations` while wiring it into the MIDDLE
  // of `edges`) — see the reachability test below.
  //
  // b is being dragged to y = 108.
  //   • Correct equidistant target = midpoint of b's real neighbours d(20)
  //     and c(200) = 110. Distance from the drag: 2 (well inside tolerance 10).
  //   • Array-order target = midpoint of stations[0]=a(0) and stations[2]=c(200)
  //     = 100. Distance from the drag: 8 (also inside tolerance).
  // Current source reads the array, so the drag is pulled to 100 — 10 units
  // PAST the correct cadence point, onto a midpoint of two stations that are
  // not both b's neighbours.
  it('snaps b to the midpoint of its EDGE neighbours (d, c), not its array neighbours (a, c)', () => {
    const a = makeStation({ id: 'a', x: 0, y: 0, stops: [makeStop('L1')] });
    const b = makeStation({ id: 'b', x: 0, y: 108, stops: [makeStop('L1')] });
    const c = makeStation({ id: 'c', x: 0, y: 200, stops: [makeStop('L1')] });
    const d = makeStation({ id: 'd', x: 0, y: 20, stops: [makeStop('L1')] });
    const l1 = makeLine({
      id: 'L1',
      service: 'L1',
      stations: ['a', 'b', 'c', 'd'],
      edges: [pairKeyOf('a', 'd'), pairKeyOf('d', 'b'), pairKeyOf('b', 'c')],
    });

    // Sanity: the edge graph really does say b's neighbours are d and c.
    // (Copy before sorting — the helper hands back a shared cached array.)
    expect([...neighborsOf(l1, 'b')].sort()).toEqual(['c', 'd']);

    const r = snapDraggedStation({
      draggedId: 'b',
      proposedX: 0.3,
      proposedY: 108,
      draggedRotation: 0,
      draggedStops: b.stops,
      stations: stationsRec(a, b, c, d),
      lines: linesRec(l1),
      modes: equidistantOnly,
    });

    expect(r.x).toBeCloseTo(0, 5);
    expect(r.y).toBeCloseTo(110, 5);
  });

  // Control: identical geometry, but the membership array is already in track
  // order. This one passes on current source and proves the ONLY difference is
  // which list the neighbour lookup reads.
  it('control: same geometry with membership order == track order snaps to 110', () => {
    const a = makeStation({ id: 'a', x: 0, y: 0, stops: [makeStop('L1')] });
    const b = makeStation({ id: 'b', x: 0, y: 108, stops: [makeStop('L1')] });
    const c = makeStation({ id: 'c', x: 0, y: 200, stops: [makeStop('L1')] });
    const d = makeStation({ id: 'd', x: 0, y: 20, stops: [makeStop('L1')] });
    const l1 = makeLine({
      id: 'L1',
      service: 'L1',
      stations: ['a', 'd', 'b', 'c'],
      edges: [pairKeyOf('a', 'd'), pairKeyOf('d', 'b'), pairKeyOf('b', 'c')],
    });

    const r = snapDraggedStation({
      draggedId: 'b',
      proposedX: 0.3,
      proposedY: 108,
      draggedRotation: 0,
      draggedStops: b.stops,
      stations: stationsRec(a, b, c, d),
      lines: linesRec(l1),
      modes: equidistantOnly,
    });

    expect(r.y).toBeCloseTo(110, 5);
  });

  // Reachability: the real Edit-Stops splice transform is what creates the
  // divergent state above. No hand-authored fixture required.
  it('reachability: spliceStationIntoEdge appends to stations while wiring the middle of edges', () => {
    const doc = makeDoc({
      stations: [
        makeStation({ id: 'a', x: 0, y: 0, stops: [makeStop('L1')] }),
        makeStation({ id: 'b', x: 0, y: 108, stops: [makeStop('L1')] }),
        makeStation({ id: 'c', x: 0, y: 200, stops: [makeStop('L1')] }),
        makeStation({ id: 'd', x: 0, y: 20 }),
      ],
      lines: [makeLine({ id: 'L1', service: 'L1', stations: ['a', 'b', 'c'] })],
    });

    const after = spliceStationIntoEdge(doc, 'L1', 'a', 'b', 'd');
    const l1 = after.lines['L1'];

    expect(l1.stations).toEqual(['a', 'b', 'c', 'd']);
    expect([...l1.edges].sort()).toEqual(
      [pairKeyOf('a', 'd'), pairKeyOf('d', 'b'), pairKeyOf('b', 'c')].sort(),
    );
    // Array neighbours of b are a and c; edge neighbours are d and c.
    expect([...neighborsOf(l1, 'b')].sort()).toEqual(['c', 'd']);
  });
});
