import { describe, it, expect } from 'vitest';
import {
  alignmentPairs,
  snapDraggedStation,
  DEFAULT_SNAP_MODES,
  type SnapInput,
  type SnapModes,
} from './snap';
import { addEdge, edgesFromStations, neighborsOf } from '../model/lineTopology';
import { pairKeyOf } from '../model/pairKey';
import { makeLine, makeStation, makeStop, stationWithStop } from '../test/fixtures';
import type { Line, LineId, Station, StationId, StopOrientation } from '../model/types';
import type { Rotation } from './orientation';

// EQUIVALENCE PINS for the line-mode candidate narrowing: `snapDraggedStation`
// may skip a target only when the full scan provably contributed nothing for
// it. The randomized snapshot below was RECORDED against the pre-narrowing
// full-scan implementation, so it is the old path's output verbatim — the
// narrowed engine must reproduce it byte-for-byte. Do not update the snapshot
// to make a narrowing change pass; a diff here means the filter is not the
// same filter.

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

// Deterministic PRNG (mulberry32) so the scenarios — and the recorded oracle
// snapshot — are stable across runs and machines.
const mulberry32 = (seed: number) => {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
type Rnd = () => number;
const int = (rnd: Rnd, n: number) => Math.floor(rnd() * n);
const pick = <T>(rnd: Rnd, xs: readonly T[]): T => xs[int(rnd, xs.length)];

// A small random doc + drag: loops, branches, stopless members, stopless
// free-floating stations, group-drag exclusions, redistribute anchors, and a
// sprinkling of the other modes composing with line mode.
function makeScenario(seed: number): SnapInput {
  const rnd = mulberry32(seed);
  const n = 5 + int(rnd, 4); // 5..8 stations
  const ids = Array.from({ length: n }, (_, i) => `s${i}` as StationId);
  const stations = ids.map((id) =>
    makeStation({
      id,
      x: int(rnd, 5) * 40,
      y: int(rnd, 5) * 40,
      rotation: int(rnd, 2) as Rotation,
    }),
  );
  const byId = new Map(stations.map((s) => [s.id, s]));
  const orientations: readonly StopOrientation[] = ['auto-vertical', 'auto-horizontal'];

  const lines: Line[] = [];
  const lineCount = 1 + int(rnd, 3); // 1..3
  for (let li = 0; li < lineCount; li++) {
    const shuffled = [...ids];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = int(rnd, i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const members = shuffled.slice(0, 2 + int(rnd, n - 2));
    let edges = edgesFromStations(members);
    const kind = rnd();
    if (kind < 0.25 && members.length >= 3) {
      edges = addEdge(edges, members[0], members[members.length - 1]); // close a loop
    } else if (kind < 0.5 && members.length >= 4) {
      edges = addEdge(edges, members[1], members[members.length - 1]); // branch chord
    }
    const line = makeLine({ id: `L${li}` as LineId, stations: members, edges });
    lines.push(line);
    // Most members get a stop; some stay stopless (edge-connected but no
    // tCell — the missing-stop branch of alignmentPairs).
    for (const m of members) {
      if (rnd() < 0.85) {
        const st = byId.get(m) as Station;
        st.stops = [
          ...st.stops,
          makeStop(line.id, { col: st.stops.length, orientation: pick(rnd, orientations) }),
        ];
      }
    }
  }

  const dragged = pick(rnd, stations);
  const draggedStops = dragged.stops;

  let excludedIds: ReadonlySet<StationId> | undefined;
  if (rnd() < 0.25) {
    const other = pick(
      rnd,
      stations.filter((s) => s.id !== dragged.id),
    );
    excludedIds = new Set([other.id]);
  }

  let redistributeAnchor: StationId | undefined;
  if (rnd() < 0.2 && draggedStops.length > 0) {
    const line = lines.find((l) => l.id === draggedStops[0].lineId);
    const others = (line?.stations ?? []).filter((id) => id !== dragged.id);
    if (others.length > 0) redistributeAnchor = pick(rnd, others);
  }

  const modes: SnapModes = {
    ...DEFAULT_SNAP_MODES,
    all: rnd() < 0.25 ? 'all' : 'off',
    grid: rnd() < 0.2 ? 'both' : 'off',
    equidistant: rnd() < 0.2,
  };

  return {
    draggedId: dragged.id,
    proposedX: dragged.x + (rnd() * 24 - 12),
    proposedY: dragged.y + (rnd() * 24 - 12),
    draggedRotation: dragged.rotation,
    draggedStops,
    stations: stationsRec(...stations),
    lines: linesRec(...lines),
    lineCircles: {},
    excludedIds,
    redistributeAnchor,
    modes,
  };
}

const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);

describe('snapDraggedStation — narrowing equivalence against the full-scan oracle', () => {
  it('reproduces the recorded full-scan results over randomized docs', () => {
    const results = SEEDS.map((seed) => {
      const r = snapDraggedStation(makeScenario(seed));
      return { seed, x: r.x, y: r.y, guides: r.guides };
    });
    // Guard against a vacuous fixture: a healthy share of scenarios must have
    // actually snapped (guides emitted) for the comparison to mean anything.
    expect(results.filter((r) => r.guides.length > 0).length).toBeGreaterThan(10);
    expect(results).toMatchSnapshot();
  });

  it('skips only targets the full scan proves empty: every gated-out target yields zero pairs', () => {
    // THE narrowing premise, executed on real data: for a plain drag (no
    // bullet, no redistribute), any target that is not an edge-neighbour of
    // the dragged station on one of its stop lines (or, for a stopless drag,
    // any target WITH stops) makes alignmentPairs return [] under
    // requireAdjacency — so skipping it cannot change the result.
    let checked = 0;
    for (const seed of SEEDS) {
      const input = makeScenario(seed);
      if (input.redistributeAnchor) continue; // adjacency deliberately bypassed
      const dStops = input.draggedStops ?? [];
      const neighborIds = new Set(
        dStops.flatMap((c) =>
          input.lines[c.lineId]
            ? neighborsOf(input.lines[c.lineId], input.draggedId as StationId)
            : [],
        ),
      );
      for (const t of Object.values(input.stations)) {
        if (t.id === input.draggedId) continue;
        const gatedOut = dStops.length > 0 ? !neighborIds.has(t.id) : t.stops.length > 0;
        if (!gatedOut) continue;
        checked++;
        expect(
          alignmentPairs(
            input.draggedId as StationId,
            input.draggedRotation as Rotation,
            dStops,
            t,
            input.lines,
            {},
            true,
          ),
        ).toEqual([]);
      }
    }
    expect(checked).toBeGreaterThan(100); // the gate actually prunes plenty
  });
});

describe('snapDraggedStation — preserved corner cases of the line-mode pool', () => {
  it('anchor fallback: a stopless dragged station still snaps to a stopless station', () => {
    const d = makeStation({ id: 'd', x: 0, y: 0 });
    const t = makeStation({ id: 't', x: 100, y: 0 });
    const r = snapDraggedStation({
      draggedId: 'd' as StationId,
      proposedX: 97,
      proposedY: 50,
      draggedRotation: 0,
      draggedStops: [],
      stations: stationsRec(d, t),
      lines: {},
      lineCircles: {},
    });
    expect(r.x).toBeCloseTo(100, 5);
    expect(r.y).toBeCloseTo(50, 5);
    expect(r.guides.length).toBeGreaterThan(0);
  });

  it('a stopful dragged station gets no anchor fallback against a stopless station', () => {
    const d = stationWithStop('d' as StationId, 'L1', { x: 0, y: 0 });
    const t = makeStation({ id: 't', x: 100, y: 0 });
    const L1 = makeLine({ id: 'L1', stations: ['d'] });
    const r = snapDraggedStation({
      draggedId: 'd' as StationId,
      proposedX: 97,
      proposedY: 50,
      draggedRotation: 0,
      draggedStops: d.stops,
      stations: stationsRec(d, t),
      lines: linesRec(L1),
      lineCircles: {},
    });
    expect(r.x).toBeCloseTo(97, 5); // no snap
  });

  it('a loop wrap edge makes the far end a neighbour: the wrap target still snaps', () => {
    const a = stationWithStop('a' as StationId, 'L1', { x: 0, y: 0 });
    const b = stationWithStop('b' as StationId, 'L1', { x: 0, y: 100 });
    const c = stationWithStop('c' as StationId, 'L1', { x: 100, y: 100 });
    const dd = stationWithStop('d' as StationId, 'L1', { x: 100, y: 0 });
    const L1 = makeLine({
      id: 'L1',
      stations: ['a', 'b', 'c', 'd'],
      edges: [
        pairKeyOf('a', 'b'),
        pairKeyOf('b', 'c'),
        pairKeyOf('c', 'd'),
        pairKeyOf('a', 'd'), // the wrap corridor
      ],
    });
    const r = snapDraggedStation({
      draggedId: 'a' as StationId,
      proposedX: 97,
      proposedY: -40,
      draggedRotation: 0,
      draggedStops: a.stops,
      stations: stationsRec(a, b, c, dd),
      lines: linesRec(L1),
      lineCircles: {},
    });
    expect(r.x).toBeCloseTo(100, 5); // snapped onto d's axis via the wrap edge
  });

  it('a non-adjacent station on the same line is not a line-mode target', () => {
    const a = stationWithStop('a' as StationId, 'L1', { x: 0, y: 0 });
    const b = stationWithStop('b' as StationId, 'L1', { x: 0, y: 100 });
    const c = stationWithStop('c' as StationId, 'L1', { x: 100, y: 200 });
    const L1 = makeLine({ id: 'L1', stations: ['a', 'b', 'c'] });
    const r = snapDraggedStation({
      draggedId: 'a' as StationId,
      proposedX: 97, // 3 off c's x=100 axis, but a–c share no edge
      proposedY: 10,
      draggedRotation: 0,
      draggedStops: a.stops,
      stations: stationsRec(a, b, c),
      lines: linesRec(L1),
      lineCircles: {},
    });
    expect(r.x).toBeCloseTo(97, 5); // no snap
  });

  it('redistribute: the non-adjacent anchor still snaps (adjacency bypass preserved)', () => {
    const a = stationWithStop('a' as StationId, 'L1', { x: 100, y: 0 });
    const m = stationWithStop('m' as StationId, 'L1', { x: 50, y: 50 });
    const b = stationWithStop('b' as StationId, 'L1', { x: 0, y: 100 });
    const L1 = makeLine({ id: 'L1', stations: ['a', 'm', 'b'] });
    const r = snapDraggedStation({
      draggedId: 'b' as StationId,
      proposedX: 97, // 3 off the anchor's x=100 axis; a and b are NOT adjacent
      proposedY: 200,
      draggedRotation: 0,
      draggedStops: b.stops,
      stations: stationsRec(a, m, b),
      lines: linesRec(L1),
      lineCircles: {},
      redistributeAnchor: 'a' as StationId,
    });
    expect(r.x).toBeCloseTo(100, 5);
  });

  it('an excluded edge-neighbour is not a target; without the exclusion it snaps', () => {
    const a = stationWithStop('a' as StationId, 'L1', { x: 0, y: 0 });
    const b = stationWithStop('b' as StationId, 'L1', { x: 100, y: 0 });
    const L1 = makeLine({ id: 'L1', stations: ['a', 'b'] });
    const base = {
      draggedId: 'a' as StationId,
      proposedX: 96,
      proposedY: 50,
      draggedRotation: 0 as Rotation,
      draggedStops: a.stops,
      stations: stationsRec(a, b),
      lines: linesRec(L1),
      lineCircles: {},
    };
    expect(snapDraggedStation(base).x).toBeCloseTo(100, 5);
    expect(snapDraggedStation({ ...base, excludedIds: new Set(['b' as StationId]) }).x).toBeCloseTo(
      96,
      5,
    );
  });
});
