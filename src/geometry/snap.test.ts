import { describe, it, expect } from 'vitest';
import {
  alignmentPairs,
  axisForRotation,
  gridConstrains,
  isGridMultiple,
  parallel,
  reconcileCorner,
  reconcileLockWithGrid,
  snapDraggedStation,
  SNAP_PERP_TOLERANCE,
  snapToleranceAt,
} from './snap';
import { makeLine, makeStation, makeStop } from '../test/fixtures';
import { pairKeyOf } from '../model/pairKey';
import type { Line, LineId, Station, StationId, StopCell } from '../model/types';

// Helper: build a line whose stations array forms a chain. Adjacency in
// `line.stations` is what alignmentPairs filters by.
const lineOf = (id: LineId, stationIds: StationId[]): Line =>
  makeLine({
    id,
    service: id,
    name: `${id} line`,
    color: '#000',
    stations: stationIds,
  });
const linesOf = (...ls: Line[]): Record<LineId, Line> => {
  const m: Record<LineId, Line> = {};
  for (const l of ls) m[l.id] = l;
  return m;
};

describe('parallel', () => {
  it('flags vectors with the same direction', () => {
    expect(parallel({ x: 1, y: 0 }, { x: 1, y: 0 })).toBe(true);
  });
  it('flags anti-parallel vectors', () => {
    expect(parallel({ x: 1, y: 0 }, { x: -1, y: 0 })).toBe(true);
  });
  it('rejects perpendicular vectors', () => {
    expect(parallel({ x: 1, y: 0 }, { x: 0, y: 1 })).toBe(false);
  });
});

describe('axisForRotation', () => {
  it('returns +y axis for rotation 0', () => {
    expect(axisForRotation(0)).toEqual({ x: 0, y: 1 });
  });
  it('returns +x axis for rotation 2', () => {
    expect(axisForRotation(2)).toEqual({ x: 1, y: 0 });
  });
  it('cycles every 4 rotations', () => {
    expect(axisForRotation(4)).toEqual(axisForRotation(0));
    expect(axisForRotation(5)).toEqual(axisForRotation(1));
  });
});

describe('alignmentPairs', () => {
  it('returns the rotation-axis fallback when neither side has stops', () => {
    const target = makeStation({ id: 't', x: 0, y: 0 });
    const pairs = alignmentPairs('d', 0, [], target, {}, {});
    expect(pairs).toHaveLength(1);
    expect(pairs[0].axis).toEqual({ x: 0, y: 1 });
  });

  it('emits a pair for each shared line where the two stations are adjacent', () => {
    const target = makeStation({
      id: 't',
      x: 0,
      y: 100,
      stops: [makeStop('L1', { row: 0, col: 0 }), makeStop('L2', { row: 0, col: 1 })],
    });
    const draggedStops: StopCell[] = [
      makeStop('L1', { row: 0, col: 0 }),
      makeStop('L2', { row: 0, col: 1 }),
    ];
    const lines = linesOf(lineOf('L1', ['d', 't']), lineOf('L2', ['d', 't']));
    const pairs = alignmentPairs('d', 0, draggedStops, target, lines, {});
    expect(pairs).toHaveLength(2);
  });

  it('emits no pairs when no line is shared with the target', () => {
    const target = makeStation({
      id: 't',
      x: 0,
      y: 100,
      stops: [makeStop('LX', { row: 0, col: 0 })],
    });
    const draggedStops: StopCell[] = [makeStop('LY', { row: 0, col: 0 })];
    expect(
      alignmentPairs(
        'd',
        0,
        draggedStops,
        target,
        linesOf(lineOf('LX', ['t']), lineOf('LY', ['d'])),
        {},
      ),
    ).toEqual([]);
  });

  it('emits no pair when stations are on the same line but not adjacent', () => {
    // Line L1: d → x → t (an intervening station between dragged and target).
    const target = makeStation({
      id: 't',
      x: 0,
      y: 200,
      stops: [makeStop('L1', { row: 0, col: 0 })],
    });
    const draggedStops: StopCell[] = [makeStop('L1', { row: 0, col: 0 })];
    const lines = linesOf(lineOf('L1', ['d', 'x', 't']));
    expect(alignmentPairs('d', 0, draggedStops, target, lines, {})).toEqual([]);
  });

  it('emits a NE-SW diagonal axis for an auto-ne-sw target stop', () => {
    const SQRT2_2 = Math.SQRT1_2;
    const target = makeStation({
      id: 't',
      x: 100,
      y: -100,
      rotation: 0,
      stops: [makeStop('L1', { row: 0, col: 0, orientation: 'auto-ne-sw' })],
    });
    const draggedStops: StopCell[] = [
      makeStop('L1', { row: 0, col: 0, orientation: 'auto-ne-sw' }),
    ];
    const lines = linesOf(lineOf('L1', ['d', 't']));
    const pairs = alignmentPairs('d', 0, draggedStops, target, lines, {});
    expect(pairs).toHaveLength(1);
    expect(parallel(pairs[0].axis, { x: SQRT2_2, y: -SQRT2_2 })).toBe(true);
  });

  it('per-line adjacency: emit a pair only on lines where the stations are adjacent', () => {
    // L1: d → t (adjacent). L2: d → x → t (not adjacent).
    const target = makeStation({
      id: 't',
      x: 0,
      y: 100,
      stops: [makeStop('L1', { row: 0, col: 0 }), makeStop('L2', { row: 0, col: 1 })],
    });
    const draggedStops: StopCell[] = [
      makeStop('L1', { row: 0, col: 0 }),
      makeStop('L2', { row: 0, col: 1 }),
    ];
    const lines = linesOf(lineOf('L1', ['d', 't']), lineOf('L2', ['d', 'x', 't']));
    const pairs = alignmentPairs('d', 0, draggedStops, target, lines, {});
    expect(pairs).toHaveLength(1);
  });
});

describe('snapDraggedStation', () => {
  const stations = (...sts: Station[]): Record<StationId, Station> => {
    const m: Record<StationId, Station> = {};
    for (const s of sts) m[s.id] = s;
    return m;
  };

  it('passes through unchanged when no snap candidates exist', () => {
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: 50,
      proposedY: 50,
      draggedRotation: 0,
      draggedStops: [makeStop('L1')],
      stations: stations(makeStation({ id: 'd', x: 0, y: 0 })),
      lines: linesOf(lineOf('L1', ['d'])),
      lineCircles: {},
    });
    expect(r.x).toBe(50);
    expect(r.y).toBe(50);
    expect(r.guides).toEqual([]);
  });

  it('excludedIds skips listed stations as snap candidates', () => {
    // Same setup as the basic single-axis snap test below — target T at
    // (100, 0). Without exclusion, dragging near (105, 50) snaps x to 100.
    // With T excluded, no candidate remains and the drag passes through.
    const target = makeStation({
      id: 't',
      x: 100,
      y: 0,
      stops: [makeStop('L1', { row: 0, col: 0 })],
    });
    const dragged = makeStation({
      id: 'd',
      x: 0,
      y: 0,
      stops: [makeStop('L1', { row: 0, col: 0 })],
    });
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: 105,
      proposedY: 50,
      draggedRotation: 0,
      draggedStops: dragged.stops,
      stations: stations(dragged, target),
      lines: linesOf(lineOf('L1', ['d', 't'])),
      lineCircles: {},
      excludedIds: new Set(['t']),
    });
    expect(r.x).toBe(105);
    expect(r.y).toBe(50);
    expect(r.guides).toEqual([]);
  });

  it('snaps the dragged stop onto a target whose stop is in a diagonal interline group', () => {
    // Target station has two perp-adjacent auto-ne-sw stops at diagonal-
    // basis cells. The L1 stop sits at (0, 0); snap aligns the dragged
    // station's L1 with that literal cell-grid position — no neighbor-aware
    // shift applies.
    const target = makeStation({
      id: 't',
      x: 0,
      y: 0,
      rotation: 0,
      stops: [
        makeStop('L1', { row: 0, col: 0, orientation: 'auto-ne-sw' }),
        makeStop('L2', { row: Math.SQRT1_2, col: Math.SQRT1_2, orientation: 'auto-ne-sw' }),
      ],
    });
    const dragged = makeStation({
      id: 'd',
      x: 0,
      y: 0,
      stops: [makeStop('L1', { row: 0, col: 0, orientation: 'auto-ne-sw' })],
    });
    const targetL1 = { x: 0, y: 0 };
    // Drag near the target L1 position; snap should land the dragged
    // anchor directly on it (single-stop dragged has zero stop offset).
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: targetL1.x + 4,
      proposedY: targetL1.y + 4,
      draggedRotation: 0,
      draggedStops: dragged.stops,
      stations: stations(dragged, target),
      lines: linesOf(lineOf('L1', ['d', 't'])),
      lineCircles: {},
    });
    expect(r.x).toBeCloseTo(targetL1.x, 4);
    expect(r.y).toBeCloseTo(targetL1.y, 4);
  });

  it('single-axis snap projects the dragged stop onto the target axis line', () => {
    // Target at world (100, 0) with one stop on L1 (auto-vertical, axis +y).
    // Dragging dragged station near (105, 50): it should snap to x=100.
    const target = makeStation({
      id: 't',
      x: 100,
      y: 0,
      stops: [makeStop('L1', { row: 0, col: 0 })],
    });
    const dragged = makeStation({
      id: 'd',
      x: 0,
      y: 0,
      stops: [makeStop('L1', { row: 0, col: 0 })],
    });
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: 105,
      proposedY: 50,
      draggedRotation: 0,
      draggedStops: dragged.stops,
      stations: stations(dragged, target),
      lines: linesOf(lineOf('L1', ['d', 't'])),
      lineCircles: {},
    });
    expect(r.x).toBeCloseTo(100, 5);
    expect(r.y).toBeCloseTo(50, 5);
    expect(r.guides).toHaveLength(1);
  });

  it('two-axis snap places drag at the unique intersection', () => {
    // Target T1 at (100, 0) provides a vertical (axis +y) line through x=100.
    // Target T2 at (0, 200) provides a horizontal (axis +x) line through
    // y=200. A station with stops on both should snap to (100, 200).
    const t1 = makeStation({
      id: 't1',
      x: 100,
      y: 0,
      stops: [makeStop('L1', { row: 0, col: 0, orientation: 'auto-vertical' })],
    });
    const t2 = makeStation({
      id: 't2',
      x: 0,
      y: 200,
      // rotation=2 turns local +y into world +x → 'auto-vertical' becomes
      // a horizontal axis in world coords.
      rotation: 2,
      stops: [makeStop('L2', { row: 0, col: 0, orientation: 'auto-vertical' })],
    });
    const dragged = makeStation({
      id: 'd',
      x: 0,
      y: 0,
      stops: [
        makeStop('L1', { row: 0, col: 0, orientation: 'auto-vertical' }),
        // L2 stop must produce a HORIZONTAL world axis, matching t2 — set
        // orientation to auto-horizontal at rotation 0.
        makeStop('L2', { row: 0, col: 1, orientation: 'auto-horizontal' }),
      ],
    });
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: 102,
      proposedY: 198,
      draggedRotation: 0,
      draggedStops: dragged.stops,
      stations: stations(dragged, t1, t2),
      lines: linesOf(lineOf('L1', ['d', 't1']), lineOf('L2', ['d', 't2'])),
      lineCircles: {},
    });
    expect(r.x).toBeCloseTo(100, 3);
    expect(r.y).toBeCloseTo(200, 3);
    expect(r.guides.length).toBeGreaterThanOrEqual(2);
  });

  it('shifts within tolerance, leaves alone beyond it', () => {
    const target = makeStation({
      id: 't',
      x: 100,
      y: 0,
      stops: [makeStop('L1')],
    });
    const dragged = makeStation({
      id: 'd',
      x: 0,
      y: 0,
      stops: [makeStop('L1')],
    });
    const lines = linesOf(lineOf('L1', ['d', 't']));
    // Within tolerance: snaps.
    const inTol = snapDraggedStation({
      draggedId: 'd',
      proposedX: 105,
      proposedY: 50,
      draggedRotation: 0,
      draggedStops: dragged.stops,
      stations: stations(dragged, target),
      lines,
      lineCircles: {},
      tolerance: 10,
    });
    expect(inTol.guides).toHaveLength(1);
    // Beyond tolerance: no snap.
    const outTol = snapDraggedStation({
      draggedId: 'd',
      proposedX: 200,
      proposedY: 50,
      draggedRotation: 0,
      draggedStops: dragged.stops,
      stations: stations(dragged, target),
      lines,
      lineCircles: {},
      tolerance: 10,
    });
    expect(outTol.guides).toEqual([]);
    expect(outTol.x).toBe(200);
  });

  it('consolidates an interlined band so only one snap engages, not N', () => {
    // 3 lines on a shared corridor → 1 guide, not 3.
    const target = makeStation({
      id: 't',
      x: 100,
      y: 0,
      stops: [makeStop('L1', { col: 0 }), makeStop('L2', { col: 1 }), makeStop('L3', { col: 2 })],
    });
    const dragged = makeStation({
      id: 'd',
      x: 0,
      y: 0,
      stops: [makeStop('L1', { col: 0 }), makeStop('L2', { col: 1 }), makeStop('L3', { col: 2 })],
    });
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: 102,
      proposedY: 50,
      draggedRotation: 0,
      draggedStops: dragged.stops,
      stations: stations(dragged, target),
      lines: linesOf(lineOf('L1', ['d', 't']), lineOf('L2', ['d', 't']), lineOf('L3', ['d', 't'])),
      lineCircles: {},
    });
    expect(r.guides).toHaveLength(1);
  });

  it('falls back to anchor-to-anchor when neither side has stops', () => {
    // No stops on either station: snap engages on the dragged station's
    // rotation axis (rotation 0 → +y axis). Drag near the target's column
    // → snaps to that column.
    const target = makeStation({ id: 't', x: 100, y: 0, rotation: 0 });
    const dragged = makeStation({ id: 'd', x: 0, y: 0, rotation: 0 });
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: 102,
      proposedY: 50,
      draggedRotation: 0,
      draggedStops: dragged.stops,
      stations: stations(dragged, target),
      lines: {},
      lineCircles: {},
    });
    expect(r.x).toBeCloseTo(100, 3);
    expect(r.y).toBeCloseTo(50, 3);
  });

  it('bulletLineId: snaps a free-floating bullet to a station stop on the line', () => {
    // Two stations, both with a stop on L1 (auto-vertical → vertical world
    // axis). A bullet (no stops, no draggedId) hovering near x=0 snaps
    // perpendicular onto the vertical axis through the stops.
    const a = makeStation({
      id: 'a',
      x: 0,
      y: 0,
      stops: [makeStop('L1')],
    });
    const b = makeStation({
      id: 'b',
      x: 0,
      y: 100,
      stops: [makeStop('L1')],
    });
    const r = snapDraggedStation({
      proposedX: 5,
      proposedY: 50,
      stations: stations(a, b),
      lines: linesOf(lineOf('L1', ['a', 'b'])),
      lineCircles: {},
      bulletLineId: 'L1',
    });
    expect(r.x).toBeCloseTo(0, 5);
    expect(r.y).toBeCloseTo(50, 5);
    // Primary guide to the closer stop, plus opposite-direction guide to
    // the third in-line station — same behavior the station-drag path
    // emits when a third station shares the snap axis.
    expect(r.guides.length).toBeGreaterThanOrEqual(1);
  });

  it('bulletLineId: ignores stations with no stop on the chosen line', () => {
    // L1 covers `a` (x=0); L2 covers `b` (x=5, sitting right under the
    // dragged bullet). A bullet bound to L1 must NOT consider `b`. The
    // fixture is discriminating: if `b` were wrongly included, its x=5 axis
    // is a perfect (0px) match and would pin the bullet at x=5; correct
    // exclusion leaves only `a`, whose x=0 axis pulls the bullet from 5→0.
    const a = makeStation({
      id: 'a',
      x: 0,
      y: 0,
      stops: [makeStop('L1')],
    });
    const b = makeStation({
      id: 'b',
      x: 5,
      y: 200,
      stops: [makeStop('L2')],
    });
    const r = snapDraggedStation({
      proposedX: 5,
      proposedY: 200,
      stations: stations(a, b),
      lines: linesOf(lineOf('L1', ['a']), lineOf('L2', ['b'])),
      lineCircles: {},
      bulletLineId: 'L1',
    });
    // Snap engages only via `a`: x snaps onto a's vertical axis (0), not b's.
    expect(r.x).toBeCloseTo(0, 5);
    expect(r.y).toBeCloseTo(200, 5);
  });

  it('bulletLineId: snaps to the CLOSEST stops on the chosen line, not iteration order', () => {
    // Four stations on a single vertical chain at x=0. Bullet at (5, 250)
    // is nearest C (y=200) and D (y=300). The snap engine must pick those
    // as the primary + opposite guides, NOT A or B just because they came
    // first in iteration order. Regression: bullet snap was using
    // perpDist as the sole tiebreaker and falling back to insertion order
    // when all stops were collinear (same perpDist), so a bullet near the
    // terminus would draw guides to the far end of the line.
    const a = makeStation({ id: 'a', x: 0, y: 0, stops: [makeStop('L1')] });
    const b = makeStation({ id: 'b', x: 0, y: 100, stops: [makeStop('L1')] });
    const c = makeStation({ id: 'c', x: 0, y: 200, stops: [makeStop('L1')] });
    const d = makeStation({ id: 'd', x: 0, y: 300, stops: [makeStop('L1')] });
    const r = snapDraggedStation({
      proposedX: 5,
      proposedY: 250,
      stations: stations(a, b, c, d),
      lines: linesOf(lineOf('L1', ['a', 'b', 'c', 'd'])),
      lineCircles: {},
      bulletLineId: 'L1',
    });
    // Snap pins x to 0; y preserved.
    expect(r.x).toBeCloseTo(0, 5);
    expect(r.y).toBeCloseTo(250, 5);
    // Two guides — to c (50 above) and d (50 below). Neither is to a (250)
    // or b (150) — those are further on the same axis line.
    const guideTargets = r.guides.map((g) => `${g.to.x.toFixed(0)},${g.to.y.toFixed(0)}`).sort();
    expect(guideTargets).toEqual(['0,200', '0,300']);
  });

  it('bulletLineId: rejects bullets too far from any matching stop axis', () => {
    const a = makeStation({
      id: 'a',
      x: 0,
      y: 0,
      stops: [makeStop('L1')],
    });
    const r = snapDraggedStation({
      proposedX: 50,
      proposedY: 50,
      stations: stations(a),
      lines: linesOf(lineOf('L1', ['a'])),
      lineCircles: {},
      bulletLineId: 'L1',
      tolerance: 10,
    });
    expect(r.x).toBe(50);
    expect(r.y).toBe(50);
    expect(r.guides).toEqual([]);
  });

  it('redistributeAnchor: snaps exclusively to the anchor, ignoring adjacency', () => {
    // Line: a — x — d. Anchor a is two steps from dragged d, so the regular
    // adjacency filter would skip it. With redistributeAnchor=a the anchor
    // qualifies anyway and is the only candidate.
    const a = makeStation({ id: 'a', x: 100, y: 0, stops: [makeStop('L1')] });
    const x = makeStation({ id: 'x', x: 100, y: 100, stops: [makeStop('L1')] });
    const d = makeStation({ id: 'd', x: 0, y: 200, stops: [makeStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: 105,
      proposedY: 200,
      draggedRotation: 0,
      draggedStops: d.stops,
      stations: stations(d, a, x),
      lines: linesOf(lineOf('L1', ['a', 'x', 'd'])),
      lineCircles: {},
      redistributeAnchor: 'a',
    });
    expect(r.x).toBeCloseTo(100, 5);
    expect(r.y).toBeCloseTo(200, 5);
    // Exactly one guide, to the anchor — x (an adjacent intermediate) is
    // ignored even though it's also on the same axis.
    expect(r.guides).toHaveLength(1);
  });

  it('redistribute readout: spacing divisor follows the primary guide line, not a cross-axis line', () => {
    // d and a share TWO lines with different gaps AND different axes:
    //   L1 (vertical):   a — d            gap 1
    //   L2 (horizontal): a — x — y — d    gap 3
    // Dragging d onto a's vertical axis makes the primary guide vertical (L1),
    // so the per-station readout must divide the 90px span by L1's gap (1 →
    // "90"), not the larger cross-axis L2 gap (3 → "30") the old max-over-all-
    // lines code used.
    const a = makeStation({
      id: 'a',
      x: 100,
      y: 0,
      stops: [makeStop('L1'), makeStop('L2', { orientation: 'auto-horizontal' })],
    });
    const x = makeStation({
      id: 'x',
      x: 140,
      y: 40,
      stops: [makeStop('L2', { orientation: 'auto-horizontal' })],
    });
    const y = makeStation({
      id: 'y',
      x: 180,
      y: 80,
      stops: [makeStop('L2', { orientation: 'auto-horizontal' })],
    });
    const d = makeStation({
      id: 'd',
      x: 0,
      y: 0,
      stops: [makeStop('L1'), makeStop('L2', { orientation: 'auto-horizontal' })],
    });
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: 100,
      proposedY: 90,
      draggedRotation: 0,
      draggedStops: d.stops,
      stations: stations(d, a, x, y),
      lines: linesOf(lineOf('L1', ['a', 'd']), lineOf('L2', ['a', 'x', 'y', 'd'])),
      lineCircles: {},
      redistributeAnchor: 'a',
    });
    // Snaps onto a's vertical axis (x=100); the anchor guide spans 90px.
    expect(r.x).toBeCloseTo(100, 5);
    expect(r.guides[0].label).toBe('90.0');
  });

  it('redistribute readout: counts segments over the edge graph, not membership order', () => {
    // L1's membership order (['a','d','m']) disagrees with its track order:
    // the edges wire it a—m—d, so two segments separate the dragged station d
    // from the anchor a. The readout must divide the 90px span by 2 ("45"),
    // matching what redistributeBetween actually does (it walks the edge graph
    // via shortestPathOnLine). The old index-slice `|indexOf(d)-indexOf(a)|`
    // sees only one segment and misreports "90.0".
    const a = makeStation({ id: 'a', x: 100, y: 0, stops: [makeStop('L1')] });
    const d = makeStation({ id: 'd', x: 0, y: 0, stops: [makeStop('L1')] });
    const m = makeStation({ id: 'm', x: 100, y: 300, stops: [makeStop('L1')] });
    const l1 = makeLine({
      id: 'L1',
      service: 'L1',
      stations: ['a', 'd', 'm'],
      edges: [pairKeyOf('a', 'm'), pairKeyOf('m', 'd')],
    });
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: 100,
      proposedY: 90,
      draggedRotation: 0,
      draggedStops: d.stops,
      stations: stations(d, a, m),
      lines: linesOf(l1),
      lineCircles: {},
      redistributeAnchor: 'a',
    });
    expect(r.x).toBeCloseTo(100, 5);
    expect(r.guides[0].label).toBe('45.0');
  });

  it('emits an opposite-direction guide when a third in-line station exists', () => {
    // Three stations on a vertical corridor: target above (100, 0), third
    // below (100, 200), drag near (102, 100). Should emit a primary guide
    // up to target and an opposite-direction guide down to the third.
    const target = makeStation({
      id: 'a',
      x: 100,
      y: 0,
      stops: [makeStop('L1')],
    });
    const third = makeStation({
      id: 'c',
      x: 100,
      y: 200,
      stops: [makeStop('L1')],
    });
    const dragged = makeStation({
      id: 'd',
      x: 0,
      y: 0,
      stops: [makeStop('L1')],
    });
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: 102,
      proposedY: 100,
      draggedRotation: 0,
      draggedStops: dragged.stops,
      stations: stations(dragged, target, third),
      // d is line-adjacent to both a and c on L1: a — d — c.
      lines: linesOf(lineOf('L1', ['a', 'd', 'c'])),
      lineCircles: {},
    });
    // 1 primary guide + 1 opposite-direction guide.
    expect(r.guides.length).toBeGreaterThanOrEqual(2);
  });

  it('suppresses the opposite-direction guide when the dragged stop coincides with the target', () => {
    // Drag d so its stop lands exactly on a's along the axis (proposedY === a.y
    // === 0): primaryAlong is 0, so there's no meaningful "primary side" and no
    // well-defined opposite side — only the primary guide fires. Pins the
    // coincident → no-opposite-guide invariant the GRID_EPS band guards. (The
    // sub-epsilon FP *flicker* the band hardens against isn't deterministically
    // reproducible through this black-box API.)
    const target = makeStation({ id: 'a', x: 100, y: 0, stops: [makeStop('L1')] });
    const third = makeStation({ id: 'c', x: 100, y: 200, stops: [makeStop('L1')] });
    const dragged = makeStation({ id: 'd', x: 0, y: 0, stops: [makeStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: 98,
      proposedY: 0,
      draggedRotation: 0,
      draggedStops: dragged.stops,
      lines: linesOf(lineOf('L1', ['a', 'd', 'c'])),
      lineCircles: {},
      stations: stations(dragged, target, third),
    });
    expect(r.x).toBeCloseTo(100, 5);
    expect(r.y).toBeCloseTo(0, 5);
    // Only the primary guide to a — no opposite guide toward c.
    expect(r.guides).toHaveLength(1);
  });
});

describe('gridConstrains', () => {
  it('maps each directional grid mode to the axes it constrains', () => {
    expect(gridConstrains('off')).toEqual({ gx: false, gy: false });
    expect(gridConstrains('vertical')).toEqual({ gx: true, gy: false });
    expect(gridConstrains('horizontal')).toEqual({ gx: false, gy: true });
    expect(gridConstrains('both')).toEqual({ gx: true, gy: true });
  });
});

describe('isGridMultiple', () => {
  it('accepts exact multiples (and zero) and rejects off-grid values', () => {
    expect(isGridMultiple(0)).toBe(true);
    expect(isGridMultiple(10)).toBe(true);
    expect(isGridMultiple(-30)).toBe(true);
    expect(isGridMultiple(5)).toBe(false);
    expect(isGridMultiple(30.001)).toBe(false);
  });
  it('tolerates sub-epsilon float drift', () => {
    expect(isGridMultiple(30 + 1e-9)).toBe(true);
  });

  it('honors a custom grid interval', () => {
    // 5 is off a 10px grid but on a 5px grid.
    expect(isGridMultiple(5, 5)).toBe(true);
    expect(isGridMultiple(5, 10)).toBe(false);
    expect(isGridMultiple(7, 5)).toBe(false);
    expect(isGridMultiple(-15, 5)).toBe(true);
  });

  it('keeps the default epsilon when an interval is passed (param-order guard)', () => {
    // gridInterval is the 2nd param, eps the 3rd — passing only the interval
    // must still apply the tight default eps, not treat 5 as the tolerance.
    expect(isGridMultiple(5 + 1e-9, 5)).toBe(true);
    expect(isGridMultiple(5.01, 5)).toBe(false);
  });
});

describe('reconcileLockWithGrid', () => {
  const H = { x: 1, y: 0 }; // horizontal lock (perp Y)
  const V = { x: 0, y: 1 }; // vertical lock (perp X)
  // NE-SW diagonal, σ = sign(x*y) = -1, line y + x = c.
  const D = { x: Math.SQRT1_2, y: -Math.SQRT1_2 };

  it('horizontal lock, grid vertical: notches along-X, perp Y rides off-grid neighbor', () => {
    const r = reconcileLockWithGrid({ x: 0, y: 5 }, H, { x: 27, y: 6 }, 'vertical');
    expect(r.engaged).toBe(true);
    expect(r.x).toBeCloseTo(30, 5);
    expect(r.y).toBeCloseTo(5, 5);
  });

  it('horizontal lock, grid both: rejects an off-grid perpendicular', () => {
    expect(reconcileLockWithGrid({ x: 0, y: 5 }, H, { x: 27, y: 6 }, 'both').engaged).toBe(false);
    expect(reconcileLockWithGrid({ x: 0, y: 5 }, H, { x: 27, y: 6 }, 'horizontal').engaged).toBe(
      false,
    );
  });

  it('horizontal lock, grid horizontal: engages on-grid perp, leaves along-X free', () => {
    const r = reconcileLockWithGrid({ x: 0, y: 0 }, H, { x: 27, y: 3 }, 'horizontal');
    expect(r).toMatchObject({ engaged: true });
    expect(r.x).toBeCloseTo(27, 5); // along free
    expect(r.y).toBeCloseTo(0, 5);
  });

  it('vertical lock, grid vertical: rejects an off-grid perpendicular X', () => {
    expect(reconcileLockWithGrid({ x: 5, y: 0 }, V, { x: 6, y: 27 }, 'vertical').engaged).toBe(
      false,
    );
  });

  it('vertical lock, grid horizontal: notches along-Y, perp X free', () => {
    const r = reconcileLockWithGrid({ x: 5, y: 0 }, V, { x: 6, y: 27 }, 'horizontal');
    expect(r.engaged).toBe(true);
    expect(r.x).toBeCloseTo(5, 5);
    expect(r.y).toBeCloseTo(30, 5);
  });

  it('diagonal lock, grid both: engages on the lattice and rejects off it', () => {
    // c = q.y + q.x. q=(0,0) → c=0 (on lattice): snap along the line in grid
    // steps. proposed on the line y=-x at (23,-23) → nearest lattice (20,-20).
    const on = reconcileLockWithGrid({ x: 0, y: 0 }, D, { x: 23, y: -23 }, 'both');
    expect(on.engaged).toBe(true);
    expect(on.x).toBeCloseTo(20, 5);
    expect(on.y).toBeCloseTo(-20, 5);
    // q=(5,0) → c=5, not a grid multiple → no lattice points on the line.
    expect(reconcileLockWithGrid({ x: 5, y: 0 }, D, { x: 23, y: -23 }, 'both').engaged).toBe(false);
  });

  it('diagonal lock, single-axis grid: intersects the grid line with the diagonal', () => {
    // grid vertical pins X; Y follows y = c - x (c=0). proposed.x=23 → x=20, y=-20.
    const gv = reconcileLockWithGrid({ x: 0, y: 0 }, D, { x: 23, y: -50 }, 'vertical');
    expect(gv.engaged).toBe(true);
    expect(gv.x).toBeCloseTo(20, 5);
    expect(gv.y).toBeCloseTo(-20, 5);
    // grid horizontal pins Y; X follows. proposed.y=-23 → y=-20, x=20.
    const gh = reconcileLockWithGrid({ x: 0, y: 0 }, D, { x: 50, y: -23 }, 'horizontal');
    expect(gh.engaged).toBe(true);
    expect(gh.x).toBeCloseTo(20, 5);
    expect(gh.y).toBeCloseTo(-20, 5);
  });
});

describe('reconcileCorner', () => {
  const H = { x: 1, y: 0 }; // horizontal lock (perp Y)
  const V = { x: 0, y: 1 }; // vertical lock (perp X)
  it('keeps a grid-valid corner', () => {
    const r = reconcileCorner(
      10,
      20,
      { q: { x: 10, y: 0 }, axis: V },
      { q: { x: 0, y: 20 }, axis: H },
      { x: 12, y: 22 },
      'both',
    );
    expect(r.kept).toBe('both');
    expect(r.x).toBeCloseTo(10, 5);
    expect(r.y).toBeCloseTo(20, 5);
  });
  it('degrades an off-grid corner to the primary when it can engage', () => {
    // Corner (5,20): primary horizontal lock (perp Y=0 on grid) engages → X
    // notches to 10. (X=5 from the vertical lock is off-grid and dropped.)
    const r = reconcileCorner(
      5,
      20,
      { q: { x: 0, y: 0 }, axis: H },
      { q: { x: 5, y: 0 }, axis: V },
      { x: 8, y: 1 },
      'both',
    );
    expect(r.kept).toBe('primary');
    expect(r.x).toBeCloseTo(10, 5);
    expect(r.y).toBeCloseTo(0, 5);
  });
  it('falls back to the secondary when the primary cannot satisfy the grid', () => {
    // Primary vertical lock has an off-grid perp X=5 → can't engage under grid
    // 'both'; the secondary horizontal lock (perp Y=0 on grid) does.
    const r = reconcileCorner(
      5,
      0,
      { q: { x: 5, y: 0 }, axis: V },
      { q: { x: 0, y: 0 }, axis: H },
      { x: 6, y: 1 },
      'both',
    );
    expect(r.kept).toBe('secondary');
    expect(r.x).toBeCloseTo(10, 5);
    expect(r.y).toBeCloseTo(0, 5);
  });
  it('reports none when neither lock can satisfy the grid', () => {
    // Both perpendiculars off-grid under grid 'both'.
    const r = reconcileCorner(
      5,
      5,
      { q: { x: 5, y: 0 }, axis: V },
      { q: { x: 0, y: 5 }, axis: H },
      { x: 6, y: 6 },
      'both',
    );
    expect(r.kept).toBe('none');
  });
});

describe('grid reconciliation: 5px grid interval', () => {
  const H = { x: 1, y: 0 };
  const V = { x: 0, y: 1 };

  it('reconcileLockWithGrid engages a perp of 5 (on the 5px lattice) and notches along by 5', () => {
    // perp Y=5 is rejected on a 10px grid (see reconcileLockWithGrid suite) but
    // accepted on a 5px grid; along-X then steps by 5 (27 → 25).
    expect(reconcileLockWithGrid({ x: 0, y: 5 }, H, { x: 27, y: 6 }, 'both', 10).engaged).toBe(
      false,
    );
    const r = reconcileLockWithGrid({ x: 0, y: 5 }, H, { x: 27, y: 6 }, 'both', 5);
    expect(r.engaged).toBe(true);
    expect(r.x).toBeCloseTo(25, 5);
    expect(r.y).toBeCloseTo(5, 5);
  });

  it('reconcileCorner keeps a corner that is valid on the 5px lattice but not the 10px one', () => {
    const locks = {
      primary: { q: { x: 5, y: 0 }, axis: V },
      secondary: { q: { x: 0, y: 20 }, axis: H },
      proposed: { x: 6, y: 21 },
    } as const;
    // (5, 20): x=5 is off a 10px grid → corner degrades to a single lock.
    expect(
      reconcileCorner(5, 20, locks.primary, locks.secondary, locks.proposed, 'both', 10).kept,
    ).not.toBe('both');
    // On a 5px grid both coords are valid → the full corner is kept.
    const r = reconcileCorner(5, 20, locks.primary, locks.secondary, locks.proposed, 'both', 5);
    expect(r.kept).toBe('both');
    expect(r.x).toBeCloseTo(5, 5);
    expect(r.y).toBeCloseTo(20, 5);
  });
});

describe('snapToleranceAt', () => {
  // The engage radius is specified in SCREEN pixels, not world units — that is
  // the whole reason every snap site converts rather than passing the constant.
  it('holds the engage radius constant in screen pixels across zooms', () => {
    for (const zoom of [0.1, 0.5, 1, 2, 8, 64]) {
      expect(snapToleranceAt(zoom) * zoom).toBeCloseTo(SNAP_PERP_TOLERANCE, 9);
    }
  });

  it('shrinks the world-space radius as you zoom in, so fine positioning wins', () => {
    expect(snapToleranceAt(4)).toBeLessThan(snapToleranceAt(1));
    expect(snapToleranceAt(0.25)).toBeGreaterThan(snapToleranceAt(1));
  });
});
