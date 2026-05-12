import { describe, it, expect } from 'vitest';
import { alignmentPairs, axisForRotation, parallel, snapDraggedStation } from './snap';
import { makeStation, makeStop } from '../test/fixtures';
import type { Line, LineId, Station, StationId, StopCell } from '../model/types';

// Helper: build a line whose stations array forms a chain. Adjacency in
// `line.stations` is what alignmentPairs filters by.
const lineOf = (id: LineId, stationIds: StationId[]): Line => ({
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
    const pairs = alignmentPairs('d', 0, [], target, {});
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
    const pairs = alignmentPairs('d', 0, draggedStops, target, lines);
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
    expect(alignmentPairs('d', 0, draggedStops, target, lines)).toEqual([]);
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
    const pairs = alignmentPairs('d', 0, draggedStops, target, lines);
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
    const pairs = alignmentPairs('d', 0, draggedStops, target, lines);
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
      excludedIds: new Set(['t']),
    });
    expect(r.x).toBe(105);
    expect(r.y).toBe(50);
    expect(r.guides).toEqual([]);
  });

  it('snaps the dragged stop onto a target whose stop is in a diagonal interline group', () => {
    // Target station has two auto-ne-sw stops at cells (0,0) and (1,1) — a
    // diagonal interline group. The L1 stop's cell position is (0, 0); but
    // after compression it sits halfway between, on the band centerline.
    // The dragged station should snap so its L1 stop lines up with the
    // *compressed* target position, not the literal cell position.
    const STOP_SIZE = 14;
    const target = makeStation({
      id: 't',
      x: 0,
      y: 0,
      rotation: 0,
      stops: [
        makeStop('L1', { row: 0, col: 0, orientation: 'auto-ne-sw' }),
        makeStop('L2', { row: 1, col: 1, orientation: 'auto-ne-sw' }),
      ],
    });
    const dragged = makeStation({
      id: 'd',
      x: 0,
      y: 0,
      stops: [makeStop('L1', { row: 0, col: 0, orientation: 'auto-ne-sw' })],
    });
    // Compressed target L1 position: cell (0,0) shifted +STOP_SIZE·(√2-1)/2
    // along the NW-SE perp axis (toward the centroid of the group).
    const shift = (STOP_SIZE * (Math.SQRT2 - 1)) / 2;
    const compressedTL1 = {
      x: shift * Math.SQRT1_2,
      y: shift * Math.SQRT1_2,
    };
    // Drag the dragged station near the compressed L1 position. Snap should
    // land it exactly on the compressed position.
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: compressedTL1.x + 4, // off-axis nudge to force a snap projection
      proposedY: compressedTL1.y + 4,
      draggedRotation: 0,
      draggedStops: dragged.stops,
      stations: stations(dragged, target),
      lines: linesOf(lineOf('L1', ['d', 't'])),
    });
    // After snap, dragged anchor + L1 cell offset = compressed target L1.
    // Dragged station has no compression (single stop), so its rendered L1 = anchor.
    expect(r.x).toBeCloseTo(compressedTL1.x, 4);
    expect(r.y).toBeCloseTo(compressedTL1.y, 4);
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
    // L1 covers `a`; L2 covers `b`. A bullet bound to L1 must NOT snap to
    // `b` even though they share an axis — `b` has no stop on L1.
    const a = makeStation({
      id: 'a',
      x: 0,
      y: 0,
      stops: [makeStop('L1')],
    });
    const b = makeStation({
      id: 'b',
      x: 0,
      y: 200,
      stops: [makeStop('L2')],
    });
    const r = snapDraggedStation({
      proposedX: 5,
      proposedY: 200,
      stations: stations(a, b),
      lines: linesOf(lineOf('L1', ['a']), lineOf('L2', ['b'])),
      bulletLineId: 'L1',
    });
    // Snap should engage only via `a` — for a bullet near `b`'s y, x snaps
    // onto a's vertical axis line.
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
      redistributeAnchor: 'a',
    });
    expect(r.x).toBeCloseTo(100, 5);
    expect(r.y).toBeCloseTo(200, 5);
    // Exactly one guide, to the anchor — x (an adjacent intermediate) is
    // ignored even though it's also on the same axis.
    expect(r.guides).toHaveLength(1);
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
    });
    // 1 primary guide + 1 opposite-direction guide.
    expect(r.guides.length).toBeGreaterThanOrEqual(2);
  });
});
