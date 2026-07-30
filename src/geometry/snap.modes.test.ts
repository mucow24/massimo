import { describe, it, expect } from 'vitest';
import {
  axesForAllSnap,
  maybeSnapToGrid,
  snapDraggedStation,
  snapPointToGrid,
  type SnapModes,
} from './snap';
import { makeLine, makeStation, makeStop } from '../test/fixtures';
import type { Line, LineId, Station, StationId, StopCell } from '../model/types';

// Local fixture helpers — same shape as snap.test.ts so the two suites read
// the same. Kept local so this file stays self-contained.
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
const stations = (...sts: Station[]): Record<StationId, Station> => {
  const m: Record<StationId, Station> = {};
  for (const s of sts) m[s.id] = s;
  return m;
};

const NO_MODES: SnapModes = {
  line: false,
  equidistant: false,
  tens: false,
  all: 'off',
  grid: 'off',
};
const LINE_ONLY: SnapModes = {
  line: true,
  equidistant: false,
  tens: false,
  all: 'off',
  grid: 'off',
};

// All horizontal-axis fixtures use auto-horizontal stops at rotation 0, so
// alignment-pair axis = world +x. Stations on a horizontal corridor at y=0.
const horizontalStop = (lineId: LineId): StopCell =>
  makeStop(lineId, { row: 0, col: 0, orientation: 'auto-horizontal' });

describe('snapDraggedStation: snap mode gating', () => {
  it('modes.line=false disables the existing line snap', () => {
    const target = makeStation({ id: 't', x: 100, y: 0, stops: [makeStop('L1')] });
    const dragged = makeStation({ id: 'd', x: 0, y: 0, stops: [makeStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: 105,
      proposedY: 50,
      draggedRotation: 0,
      draggedStops: dragged.stops,
      stations: stations(dragged, target),
      lines: linesOf(lineOf('L1', ['d', 't'])),
      lineCircles: {},
      modes: NO_MODES,
    });
    expect(r.x).toBe(105);
    expect(r.y).toBe(50);
    expect(r.guides).toEqual([]);
  });

  it("omitted modes preserves today's behavior (defaults to line on)", () => {
    // Same fixture as the existing single-axis test in snap.test.ts.
    const target = makeStation({ id: 't', x: 100, y: 0, stops: [makeStop('L1')] });
    const dragged = makeStation({ id: 'd', x: 0, y: 0, stops: [makeStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: 105,
      proposedY: 50,
      draggedRotation: 0,
      draggedStops: dragged.stops,
      stations: stations(dragged, target),
      lines: linesOf(lineOf('L1', ['d', 't'])),
      lineCircles: {},
      // modes intentionally omitted.
    });
    expect(r.x).toBeCloseTo(100, 5);
    expect(r.y).toBeCloseTo(50, 5);
    expect(r.guides).toHaveLength(1);
  });
});

describe('snapDraggedStation: equidistant mode', () => {
  // Line [A, B, C] all on a horizontal corridor, B is dragged.
  const fixture = (proposed: { x: number; y: number }, modes: SnapModes) => {
    const a = makeStation({ id: 'a', x: 0, y: 0, stops: [horizontalStop('L1')] });
    const b = makeStation({ id: 'b', x: 50, y: 0, stops: [horizontalStop('L1')] });
    const c = makeStation({ id: 'c', x: 100, y: 0, stops: [horizontalStop('L1')] });
    return snapDraggedStation({
      draggedId: 'b',
      proposedX: proposed.x,
      proposedY: proposed.y,
      draggedRotation: 0,
      draggedStops: b.stops,
      stations: stations(a, b, c),
      lines: linesOf(lineOf('L1', ['a', 'b', 'c'])),
      lineCircles: {},
      modes,
    });
  };

  it('snaps the dragged station to the midpoint between same-line prev and next', () => {
    const r = fixture({ x: 53, y: 0.5 }, { ...LINE_ONLY, equidistant: true });
    expect(r.x).toBeCloseTo(50, 5);
    expect(r.y).toBeCloseTo(0, 5);
    // The yellow tooltip should now read 50 (B is 50 from both A and C).
    const labels = r.guides.map((g) => g.label).filter(Boolean);
    expect(labels).toContain('50');
  });

  it('does nothing when modes.line is off (equidistant is gated on line)', () => {
    const r = fixture({ x: 53, y: 0.5 }, { ...NO_MODES, equidistant: true });
    expect(r.x).toBe(53);
    expect(r.y).toBe(0.5);
  });

  it('does nothing on a terminus when the line has fewer than 3 stations', () => {
    // Line is [A, B] only — B is the terminus, and there's no prev-prev
    // to extrapolate a cadence from. Equidistant must stay inert.
    const a = makeStation({ id: 'a', x: 0, y: 0, stops: [horizontalStop('L1')] });
    const b = makeStation({ id: 'b', x: 50, y: 0, stops: [horizontalStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'b',
      proposedX: 53,
      proposedY: 0.5,
      draggedRotation: 0,
      draggedStops: b.stops,
      stations: stations(a, b),
      lines: linesOf(lineOf('L1', ['a', 'b'])),
      lineCircles: {},
      modes: { ...LINE_ONLY, equidistant: true },
    });
    // Only line snap fires — projects onto y=0 through A's axis line.
    expect(r.x).toBeCloseTo(53, 5);
    expect(r.y).toBeCloseTo(0, 5);
  });

  it('skips when prev and next axes through the dragged station diverge (corner)', () => {
    // A on L1 with horizontal axis through B; C on L1 with vertical axis
    // through B. The line "bends" at B (different stop orientation on each
    // side); equidistant must NOT spatial-midpoint A and C.
    const a = makeStation({ id: 'a', x: 0, y: 0, stops: [horizontalStop('L1')] });
    const b = makeStation({
      id: 'b',
      x: 50,
      y: 0,
      // B has a horizontal stop on L1 — primary axis at B is +x.
      stops: [horizontalStop('L1')],
    });
    // C is on L1 too but its stop is vertical, so the alignment pair from C
    // wouldn't be parallel to B's axis; equidistant on this line must skip.
    const c = makeStation({
      id: 'c',
      x: 50,
      y: 100,
      stops: [makeStop('L1', { row: 0, col: 0, orientation: 'auto-vertical' })],
    });
    // Drag B near (24, 0.5); naive equidistant of A=(0,0) and C=(50,100)
    // would project the spatial midpoint (25, 50) onto axis +x → x=25.
    const r = snapDraggedStation({
      draggedId: 'b',
      proposedX: 24,
      proposedY: 0.5,
      draggedRotation: 0,
      draggedStops: b.stops,
      stations: stations(a, b, c),
      lines: linesOf(lineOf('L1', ['a', 'b', 'c'])),
      lineCircles: {},
      modes: { ...LINE_ONLY, equidistant: true },
    });
    // Just line snap to A's axis — equidistant must skip.
    expect(r.x).toBeCloseTo(24, 5);
    expect(r.y).toBeCloseTo(0, 5);
  });

  it('snaps the end terminus to extend the prev-prev → prev cadence', () => {
    // Line [A, B, C, D] with B↔C = 40. Dragging D near 118 should snap to
    // x=120 so D↔C = 40 = the prev-prev → prev cadence.
    const a = makeStation({ id: 'a', x: 0, y: 0, stops: [horizontalStop('L1')] });
    const b = makeStation({ id: 'b', x: 40, y: 0, stops: [horizontalStop('L1')] });
    const c = makeStation({ id: 'c', x: 80, y: 0, stops: [horizontalStop('L1')] });
    const d = makeStation({ id: 'd', x: 110, y: 0, stops: [horizontalStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: 118,
      proposedY: 0.5,
      draggedRotation: 0,
      draggedStops: d.stops,
      stations: stations(a, b, c, d),
      lines: linesOf(lineOf('L1', ['a', 'b', 'c', 'd'])),
      lineCircles: {},
      modes: { ...LINE_ONLY, equidistant: true },
    });
    expect(r.x).toBeCloseTo(120, 5);
    expect(r.y).toBeCloseTo(0, 5);
    // The yellow tooltip should reflect the matched cadence.
    const labels = r.guides.map((g) => g.label).filter(Boolean);
    expect(labels).toContain('40');
  });

  it('snaps the start terminus by mirroring the next → next-next cadence', () => {
    // Same line but A is dragged — A↔B should snap to B↔C = 40.
    const a = makeStation({ id: 'a', x: 5, y: 0, stops: [horizontalStop('L1')] });
    const b = makeStation({ id: 'b', x: 40, y: 0, stops: [horizontalStop('L1')] });
    const c = makeStation({ id: 'c', x: 80, y: 0, stops: [horizontalStop('L1')] });
    const d = makeStation({ id: 'd', x: 120, y: 0, stops: [horizontalStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'a',
      proposedX: 2,
      proposedY: 0.5,
      draggedRotation: 0,
      draggedStops: a.stops,
      stations: stations(a, b, c, d),
      lines: linesOf(lineOf('L1', ['a', 'b', 'c', 'd'])),
      lineCircles: {},
      modes: { ...LINE_ONLY, equidistant: true },
    });
    expect(r.x).toBeCloseTo(0, 5);
    expect(r.y).toBeCloseTo(0, 5);
    const labels = r.guides.map((g) => g.label).filter(Boolean);
    expect(labels).toContain('40');
  });

  it('fires on a 3-station line — the smallest case with a prev-prev', () => {
    // Minimum-length case: [A, B, C]. Dragging C, prev=B, prev-prev=A.
    const a = makeStation({ id: 'a', x: 0, y: 0, stops: [horizontalStop('L1')] });
    const b = makeStation({ id: 'b', x: 30, y: 0, stops: [horizontalStop('L1')] });
    const c = makeStation({ id: 'c', x: 55, y: 0, stops: [horizontalStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'c',
      proposedX: 58,
      proposedY: 0.5,
      draggedRotation: 0,
      draggedStops: c.stops,
      stations: stations(a, b, c),
      lines: linesOf(lineOf('L1', ['a', 'b', 'c'])),
      lineCircles: {},
      modes: { ...LINE_ONLY, equidistant: true },
    });
    // A↔B = 30, so C snaps to B + 30 = 60.
    expect(r.x).toBeCloseTo(60, 5);
    expect(r.y).toBeCloseTo(0, 5);
  });

  it('uses only the immediate prev-prev distance, not averaged spacing', () => {
    // [A, B, C, D] with A↔B = 40 but B↔C = 10. Dragging D, the new branch
    // must use the B↔C = 10 cadence (immediate prev-prev), NOT the A↔B = 40
    // cadence and NOT some average.
    const a = makeStation({ id: 'a', x: 0, y: 0, stops: [horizontalStop('L1')] });
    const b = makeStation({ id: 'b', x: 40, y: 0, stops: [horizontalStop('L1')] });
    const c = makeStation({ id: 'c', x: 50, y: 0, stops: [horizontalStop('L1')] });
    const d = makeStation({ id: 'd', x: 56, y: 0, stops: [horizontalStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: 58,
      proposedY: 0.5,
      draggedRotation: 0,
      draggedStops: d.stops,
      stations: stations(a, b, c, d),
      lines: linesOf(lineOf('L1', ['a', 'b', 'c', 'd'])),
      lineCircles: {},
      modes: { ...LINE_ONLY, equidistant: true },
    });
    expect(r.x).toBeCloseTo(60, 5);
    expect(r.y).toBeCloseTo(0, 5);
  });

  it('skips when the prev-prev stop is not parallel to the drag axis', () => {
    // [A, B, C, D] with B's stop vertical — the prev-prev for D's
    // extrapolation chain is B, and a vertical stop fails axisOk against
    // D's horizontal drag axis. The new branch must NOT push a candidate.
    const a = makeStation({ id: 'a', x: 0, y: 0, stops: [horizontalStop('L1')] });
    const b = makeStation({
      id: 'b',
      x: 40,
      y: 0,
      stops: [makeStop('L1', { row: 0, col: 0, orientation: 'auto-vertical' })],
    });
    const c = makeStation({ id: 'c', x: 80, y: 0, stops: [horizontalStop('L1')] });
    const d = makeStation({ id: 'd', x: 115, y: 0, stops: [horizontalStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: 118,
      proposedY: 0.5,
      draggedRotation: 0,
      draggedStops: d.stops,
      stations: stations(a, b, c, d),
      lines: linesOf(lineOf('L1', ['a', 'b', 'c', 'd'])),
      lineCircles: {},
      modes: { ...LINE_ONLY, equidistant: true },
    });
    // Only line snap fires — projects onto y=0 through C's horizontal axis.
    expect(r.x).toBeCloseTo(118, 5);
    expect(r.y).toBeCloseTo(0, 5);
  });

  it('terminus branch is inert during Ctrl-drag (redistributeAnchor)', () => {
    // Same [A(0), B(40), C(80), D] cadence-extrapolation setup, but the
    // user is Ctrl-dragging D toward anchor A. The new terminus branch
    // must NOT fire — it would fight the redistribute intent by pulling
    // D's along-axis position onto the local A↔B cadence.
    const a = makeStation({ id: 'a', x: 0, y: 0, stops: [horizontalStop('L1')] });
    const b = makeStation({ id: 'b', x: 40, y: 0, stops: [horizontalStop('L1')] });
    const c = makeStation({ id: 'c', x: 80, y: 0, stops: [horizontalStop('L1')] });
    const d = makeStation({ id: 'd', x: 200, y: 0, stops: [horizontalStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: 125,
      proposedY: 0.5,
      draggedRotation: 0,
      draggedStops: d.stops,
      stations: stations(a, b, c, d),
      lines: linesOf(lineOf('L1', ['a', 'b', 'c', 'd'])),
      lineCircles: {},
      // Ctrl-drag: snap exclusively to anchor A. The new branch would
      // otherwise pull x from 125 → 120 (extrapolated B↔C cadence).
      redistributeAnchor: 'a',
      modes: { ...LINE_ONLY, equidistant: true },
    });
    // Anchor axis pulls y back onto the line (perp dist 0.5 → 0). x stays
    // at 125 — terminus equidistant must NOT pull it to 120.
    expect(r.x).toBeCloseTo(125, 5);
    expect(r.y).toBeCloseTo(0, 5);
  });

  it('emits a source-cadence guide from prev-prev to prev on end terminus snap', () => {
    // [A(0), B(40), C(80), D] horizontal. Dragging D, the terminus branch
    // fires. Two guides expected: the primary D↔C alignment guide and a
    // new source guide showing the B→C segment whose cadence (40) we
    // extrapolated to position D at 120.
    const a = makeStation({ id: 'a', x: 0, y: 0, stops: [horizontalStop('L1')] });
    const b = makeStation({ id: 'b', x: 40, y: 0, stops: [horizontalStop('L1')] });
    const c = makeStation({ id: 'c', x: 80, y: 0, stops: [horizontalStop('L1')] });
    const d = makeStation({ id: 'd', x: 110, y: 0, stops: [horizontalStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: 118,
      proposedY: 0.5,
      draggedRotation: 0,
      draggedStops: d.stops,
      stations: stations(a, b, c, d),
      lines: linesOf(lineOf('L1', ['a', 'b', 'c', 'd'])),
      lineCircles: {},
      modes: { ...LINE_ONLY, equidistant: true },
    });
    expect(r.x).toBeCloseTo(120, 5);
    // Source guide: B(40,0) → C(80,0) — prev-prev → prev for terminus D.
    const sourceGuide = r.guides.find(
      (g) =>
        Math.abs(g.from.x - 40) < 1e-6 &&
        Math.abs(g.from.y - 0) < 1e-6 &&
        Math.abs(g.to.x - 80) < 1e-6 &&
        Math.abs(g.to.y - 0) < 1e-6,
    );
    expect(sourceGuide).toBeDefined();
    expect(sourceGuide?.label).toBe('40');
  });

  it('emits a source-cadence guide from next-next to next on start terminus snap', () => {
    // Mirror of the end terminus: [A, B(40), C(80), D(120)] with A
    // dragged. Source guide should go from C → B (next-next → next).
    const a = makeStation({ id: 'a', x: 5, y: 0, stops: [horizontalStop('L1')] });
    const b = makeStation({ id: 'b', x: 40, y: 0, stops: [horizontalStop('L1')] });
    const c = makeStation({ id: 'c', x: 80, y: 0, stops: [horizontalStop('L1')] });
    const d = makeStation({ id: 'd', x: 120, y: 0, stops: [horizontalStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'a',
      proposedX: 2,
      proposedY: 0.5,
      draggedRotation: 0,
      draggedStops: a.stops,
      stations: stations(a, b, c, d),
      lines: linesOf(lineOf('L1', ['a', 'b', 'c', 'd'])),
      lineCircles: {},
      modes: { ...LINE_ONLY, equidistant: true },
    });
    expect(r.x).toBeCloseTo(0, 5);
    // Source guide: C(80,0) → B(40,0).
    const sourceGuide = r.guides.find(
      (g) =>
        Math.abs(g.from.x - 80) < 1e-6 &&
        Math.abs(g.from.y - 0) < 1e-6 &&
        Math.abs(g.to.x - 40) < 1e-6 &&
        Math.abs(g.to.y - 0) < 1e-6,
    );
    expect(sourceGuide).toBeDefined();
    expect(sourceGuide?.label).toBe('40');
  });

  it('does not emit a source-cadence guide on the interior midpoint case', () => {
    // [A(0), B, C(100)] dragging B near the midpoint. Source guide is
    // a terminus-only concept — for interior equidistant the existing
    // alignment pairs and opposite-direction guide already convey the
    // midpoint snap. All guides should originate from the dragged stop
    // (pushGuide and addOppositeGuide both set from = dragged stop);
    // a source guide is the only kind whose `from` is at a non-dragged
    // station, so checking for that anomaly catches a regression.
    const a = makeStation({ id: 'a', x: 0, y: 0, stops: [horizontalStop('L1')] });
    const b = makeStation({ id: 'b', x: 50, y: 0, stops: [horizontalStop('L1')] });
    const c = makeStation({ id: 'c', x: 100, y: 0, stops: [horizontalStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'b',
      proposedX: 53,
      proposedY: 0.5,
      draggedRotation: 0,
      draggedStops: b.stops,
      stations: stations(a, b, c),
      lines: linesOf(lineOf('L1', ['a', 'b', 'c'])),
      lineCircles: {},
      modes: { ...LINE_ONLY, equidistant: true },
    });
    expect(r.x).toBeCloseTo(50, 5);
    // Snapped B's stop is at x=50, y=0. Every guide must originate there.
    for (const g of r.guides) {
      expect(g.from.x).toBeCloseTo(50, 5);
      expect(g.from.y).toBeCloseTo(0, 5);
    }
  });
});

describe('snapDraggedStation: excludedIds reach the along-axis refinement', () => {
  it('equidistant never anchors on an excluded (co-moving) neighbor', () => {
    // A—B—C on a horizontal corridor; A is excluded (co-selected in a group
    // drag, so it moves with the grab). The alignment pool already skips A;
    // the equidistant refinement must too — otherwise the snap chases a
    // moving cadence anchor.
    const a = makeStation({ id: 'a', x: 0, y: 0, stops: [horizontalStop('L1')] });
    const b = makeStation({ id: 'b', x: 40, y: 0, stops: [horizontalStop('L1')] });
    const c = makeStation({ id: 'c', x: 100, y: 0, stops: [horizontalStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'b',
      proposedX: 48,
      proposedY: 3,
      draggedRotation: 0,
      draggedStops: b.stops,
      stations: stations(a, b, c),
      lines: linesOf(lineOf('L1', ['a', 'b', 'c'])),
      lineCircles: {},
      excludedIds: new Set(['a']),
      modes: { line: true, equidistant: true, tens: false, all: 'off', grid: 'off' },
    });
    // Line snap holds y = 0; equidistant would pull x to the A↔C midpoint 50,
    // but A is excluded → x stays at the proposed 48.
    expect(r.y).toBeCloseTo(0, 5);
    expect(r.x).toBeCloseTo(48, 5);
  });

  it('bullet tens never anchors on an excluded line-start station', () => {
    // Bullet bound to L1 (stations A—B). Tens anchors at line.stations[0] = A;
    // with A excluded the cadence must not fire, though alignment to B's axis
    // still holds the perpendicular.
    const a = makeStation({ id: 'a', x: 0, y: 0, stops: [horizontalStop('L1')] });
    const b = makeStation({ id: 'b', x: 95, y: 0, stops: [horizontalStop('L1')] });
    const r = snapDraggedStation({
      proposedX: 47,
      proposedY: 3,
      stations: stations(a, b),
      lines: linesOf(lineOf('L1', ['a', 'b'])),
      lineCircles: {},
      bulletLineId: 'L1',
      excludedIds: new Set(['a']),
      modes: { line: true, equidistant: false, tens: true, all: 'off', grid: 'off' },
    });
    expect(r.y).toBeCloseTo(0, 5);
    // Without the exclusion guard, tens would round 47 → 50 from A's anchor.
    expect(r.x).toBeCloseTo(47, 5);
  });
});

describe('snapDraggedStation: tens mode', () => {
  it('snaps the along-axis distance from prev to a multiple of 10', () => {
    const a = makeStation({ id: 'a', x: 0, y: 0, stops: [horizontalStop('L1')] });
    const b = makeStation({ id: 'b', x: 50, y: 0, stops: [horizontalStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'b',
      proposedX: 47,
      proposedY: 0.5,
      draggedRotation: 0,
      draggedStops: b.stops,
      stations: stations(a, b),
      lines: linesOf(lineOf('L1', ['a', 'b'])),
      lineCircles: {},
      modes: { ...LINE_ONLY, tens: true },
    });
    expect(r.x).toBeCloseTo(50, 5);
    expect(r.y).toBeCloseTo(0, 5);
  });

  it('rounds toward the nearest 10', () => {
    const a = makeStation({ id: 'a', x: 0, y: 0, stops: [horizontalStop('L1')] });
    const b = makeStation({ id: 'b', x: 40, y: 0, stops: [horizontalStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'b',
      proposedX: 40.5,
      proposedY: 0,
      draggedRotation: 0,
      draggedStops: b.stops,
      stations: stations(a, b),
      lines: linesOf(lineOf('L1', ['a', 'b'])),
      lineCircles: {},
      modes: { ...LINE_ONLY, tens: true },
    });
    expect(r.x).toBeCloseTo(40, 5);
    expect(r.y).toBeCloseTo(0, 5);
  });

  it('refines to the nearest ten when the offset is within tolerance', () => {
    // proposedX 34 is 4 from the multiple of 10 at x=30 (anchored at a=0).
    // tolerance 5 admits that 4-unit pull, so tens snaps the stop to x=30.
    const a = makeStation({ id: 'a', x: 0, y: 0, stops: [horizontalStop('L1')] });
    const b = makeStation({ id: 'b', x: 34, y: 0, stops: [horizontalStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'b',
      proposedX: 34,
      proposedY: 0,
      draggedRotation: 0,
      draggedStops: b.stops,
      stations: stations(a, b),
      lines: linesOf(lineOf('L1', ['a', 'b'])),
      lineCircles: {},
      modes: { ...LINE_ONLY, tens: true },
      tolerance: 5,
    });
    expect(r.x).toBeCloseTo(30, 5);
    expect(r.y).toBeCloseTo(0, 5);
  });

  it('does not refine when the nearest ten is outside the tolerance window', () => {
    // Same proposed x=34 (4 from the ten at 30), but tolerance 3 rejects that
    // pull, so the stop keeps its projected-onto-line position at x=34.
    const a = makeStation({ id: 'a', x: 0, y: 0, stops: [horizontalStop('L1')] });
    const b = makeStation({ id: 'b', x: 34, y: 0, stops: [horizontalStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'b',
      proposedX: 34,
      proposedY: 0,
      draggedRotation: 0,
      draggedStops: b.stops,
      stations: stations(a, b),
      lines: linesOf(lineOf('L1', ['a', 'b'])),
      lineCircles: {},
      modes: { ...LINE_ONLY, tens: true },
      tolerance: 3,
    });
    expect(r.x).toBeCloseTo(34, 5);
    expect(r.y).toBeCloseTo(0, 5);
  });

  it('uses prev-in-line-ordering when both neighbors are present', () => {
    // Line [A, B, C]: B's prev = A (index 0). Tens anchors at A even though
    // C is also on the line (and same-axis).
    const a = makeStation({ id: 'a', x: 0, y: 0, stops: [horizontalStop('L1')] });
    const b = makeStation({ id: 'b', x: 50, y: 0, stops: [horizontalStop('L1')] });
    const c = makeStation({ id: 'c', x: 100, y: 0, stops: [horizontalStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'b',
      proposedX: 47,
      proposedY: 0.5,
      draggedRotation: 0,
      draggedStops: b.stops,
      stations: stations(a, b, c),
      lines: linesOf(lineOf('L1', ['a', 'b', 'c'])),
      lineCircles: {},
      modes: { ...LINE_ONLY, tens: true },
    });
    // Multiple of 10 from A=(0,0) closest to 47 is 50. (From C=(100,0) the
    // nearest would also be 50, so this single test alone doesn't prove the
    // prev-not-next selection — see next test for the disambiguator.)
    expect(r.x).toBeCloseTo(50, 5);
    expect(r.y).toBeCloseTo(0, 5);
  });

  it('falls back to the next neighbor when there is no prev (terminus at index 0)', () => {
    // Line is [B, C]: B at index 0 (terminus), no prev. Without the
    // fallback, the user sees asymmetric behavior — only one terminus on a
    // line gets tens snap. With fallback to next: B uses C as anchor.
    const b = makeStation({ id: 'b', x: 0, y: 0, stops: [horizontalStop('L1')] });
    const c = makeStation({ id: 'c', x: 100, y: 0, stops: [horizontalStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'b',
      proposedX: 7,
      proposedY: 0.5,
      draggedRotation: 0,
      draggedStops: b.stops,
      stations: stations(b, c),
      lines: linesOf(lineOf('L1', ['b', 'c'])),
      lineCircles: {},
      modes: { ...LINE_ONLY, tens: true },
    });
    // Anchor at C=(100, 0); 7 is 93 from C. Nearest multiple of 10 is 90,
    // i.e. world x = 10. Result: (10, 0).
    expect(r.x).toBeCloseTo(10, 5);
    expect(r.y).toBeCloseTo(0, 5);
  });

  it('also fires for the last terminus (line ordering already provides prev)', () => {
    // Line [A, B]: B at index 1, prev = A. Existing behavior — sanity-
    // check the symmetric case so a future regression on either side is
    // caught.
    const a = makeStation({ id: 'a', x: 0, y: 0, stops: [horizontalStop('L1')] });
    const b = makeStation({ id: 'b', x: 100, y: 0, stops: [horizontalStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'b',
      proposedX: 93,
      proposedY: 0.5,
      draggedRotation: 0,
      draggedStops: b.stops,
      stations: stations(a, b),
      lines: linesOf(lineOf('L1', ['a', 'b'])),
      lineCircles: {},
      modes: { ...LINE_ONLY, tens: true },
    });
    expect(r.x).toBeCloseTo(90, 5);
    expect(r.y).toBeCloseTo(0, 5);
  });

  it('does nothing when modes.line is off (tens is gated on line)', () => {
    const a = makeStation({ id: 'a', x: 0, y: 0, stops: [horizontalStop('L1')] });
    const b = makeStation({ id: 'b', x: 50, y: 0, stops: [horizontalStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'b',
      proposedX: 47,
      proposedY: 0.5,
      draggedRotation: 0,
      draggedStops: b.stops,
      stations: stations(a, b),
      lines: linesOf(lineOf('L1', ['a', 'b'])),
      lineCircles: {},
      modes: { ...NO_MODES, tens: true },
    });
    expect(r.x).toBe(47);
    expect(r.y).toBe(0.5);
  });
});

describe('snapDraggedStation: tens tracks the active grid interval', () => {
  it('notches the along-axis cadence to multiples of the grid size (5)', () => {
    // A=(0,0), dragging B along the horizontal line. Proposed x=13: the
    // nearest multiple of 5 is 15, but the nearest multiple of 10 is 10 — so
    // the interval must come from gridInterval, not a hardcoded 10.
    const a = makeStation({ id: 'a', x: 0, y: 0, stops: [horizontalStop('L1')] });
    const b = makeStation({ id: 'b', x: 50, y: 0, stops: [horizontalStop('L1')] });
    const input = {
      draggedId: 'b' as StationId,
      proposedX: 13,
      proposedY: 0.5,
      draggedRotation: 0 as const,
      draggedStops: b.stops,
      stations: stations(a, b),
      lines: linesOf(lineOf('L1', ['a', 'b'])),
      lineCircles: {},
      modes: { ...LINE_ONLY, tens: true },
    };
    expect(snapDraggedStation({ ...input, gridInterval: 5 }).x).toBeCloseTo(15, 5);
    // Default interval (10) lands on the nearest ten instead.
    expect(snapDraggedStation(input).x).toBeCloseTo(10, 5);
  });

  it('notches the along-axis cadence to multiples of the grid size (20)', () => {
    // Proposed x=26: nearest multiple of 20 is 20; nearest multiple of 10 is 30.
    const a = makeStation({ id: 'a', x: 0, y: 0, stops: [horizontalStop('L1')] });
    const b = makeStation({ id: 'b', x: 50, y: 0, stops: [horizontalStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'b',
      proposedX: 26,
      proposedY: 0.5,
      draggedRotation: 0,
      draggedStops: b.stops,
      stations: stations(a, b),
      lines: linesOf(lineOf('L1', ['a', 'b'])),
      lineCircles: {},
      modes: { ...LINE_ONLY, tens: true },
      gridInterval: 20,
    });
    expect(r.x).toBeCloseTo(20, 5);
    expect(r.y).toBeCloseTo(0, 5);
  });

  it("notches a bullet's cadence to multiples of the grid size (5)", () => {
    // Vertical line [A, B]; A=(0,0) is the bullet tens anchor. Proposed y=13:
    // nearest multiple of 5 is 15 (nearest ten would be 10).
    const a = makeStation({ id: 'a', x: 0, y: 0, stops: [makeStop('L1')] });
    const b = makeStation({ id: 'b', x: 0, y: 100, stops: [makeStop('L1')] });
    const r = snapDraggedStation({
      proposedX: 1,
      proposedY: 13,
      stations: stations(a, b),
      lines: linesOf(lineOf('L1', ['a', 'b'])),
      lineCircles: {},
      bulletLineId: 'L1',
      modes: { line: true, equidistant: false, tens: true, all: 'off', grid: 'off' },
      gridInterval: 5,
    });
    expect(r.x).toBeCloseTo(0, 5);
    expect(r.y).toBeCloseTo(15, 5);
  });
});

describe('snapDraggedStation: equidistant + tens together', () => {
  it('picks whichever along-axis target is closer to the proposed position', () => {
    // A=(0,0), C=(94,0). Equidistant midpoint = 47. Tens nearest = 50.
    // Proposed = (46, 0.3). |46-47|=1 < |46-50|=4, so equidistant wins.
    const a = makeStation({ id: 'a', x: 0, y: 0, stops: [horizontalStop('L1')] });
    const b = makeStation({ id: 'b', x: 47, y: 0, stops: [horizontalStop('L1')] });
    const c = makeStation({ id: 'c', x: 94, y: 0, stops: [horizontalStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'b',
      proposedX: 46,
      proposedY: 0.3,
      draggedRotation: 0,
      draggedStops: b.stops,
      stations: stations(a, b, c),
      lines: linesOf(lineOf('L1', ['a', 'b', 'c'])),
      lineCircles: {},
      modes: { line: true, equidistant: true, tens: true, all: 'off', grid: 'off' },
    });
    expect(r.x).toBeCloseTo(47, 5);
    expect(r.y).toBeCloseTo(0, 5);
  });

  it('on a terminus, equidistant target wins over tens when closer', () => {
    // [A(0), B(37), C(74), D] — non-uniform spacing chosen so the two
    // modes disagree: equidistant terminus target = C + 37 = 111;
    // tens-from-C nearest is 74 + 40 = 114. Proposed = 110 (1 from 111,
    // 4 from 114) → equidistant must win.
    const a = makeStation({ id: 'a', x: 0, y: 0, stops: [horizontalStop('L1')] });
    const b = makeStation({ id: 'b', x: 37, y: 0, stops: [horizontalStop('L1')] });
    const c = makeStation({ id: 'c', x: 74, y: 0, stops: [horizontalStop('L1')] });
    const d = makeStation({ id: 'd', x: 105, y: 0, stops: [horizontalStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: 110,
      proposedY: 0.5,
      draggedRotation: 0,
      draggedStops: d.stops,
      stations: stations(a, b, c, d),
      lines: linesOf(lineOf('L1', ['a', 'b', 'c', 'd'])),
      lineCircles: {},
      modes: { line: true, equidistant: true, tens: true, all: 'off', grid: 'off' },
    });
    expect(r.x).toBeCloseTo(111, 5);
    expect(r.y).toBeCloseTo(0, 5);
  });
});

describe('snapDraggedStation: snap-to-all mode', () => {
  it('snaps to vertical alignment with any other stop', () => {
    // A=(100, 0). Drag B vertically aligned (x≈100) far away (y=200).
    const a = makeStation({ id: 'a', x: 100, y: 0, stops: [makeStop('L1')] });
    const b = makeStation({ id: 'b', x: 0, y: 0, stops: [makeStop('L2')] });
    const r = snapDraggedStation({
      draggedId: 'b',
      proposedX: 101,
      proposedY: 200,
      draggedRotation: 0,
      draggedStops: b.stops,
      stations: stations(a, b),
      // Different lines so line mode wouldn't help here even if on.
      lines: linesOf(lineOf('L1', ['a']), lineOf('L2', ['b'])),
      lineCircles: {},
      modes: { line: false, equidistant: false, tens: false, all: 'all', grid: 'off' },
    });
    expect(r.x).toBeCloseTo(100, 5);
    expect(r.y).toBeCloseTo(200, 5);
  });

  it('snaps to horizontal alignment with any other stop', () => {
    const a = makeStation({ id: 'a', x: 0, y: 100, stops: [makeStop('L1')] });
    const b = makeStation({ id: 'b', x: 0, y: 0, stops: [makeStop('L2')] });
    const r = snapDraggedStation({
      draggedId: 'b',
      proposedX: 300,
      proposedY: 99,
      draggedRotation: 0,
      draggedStops: b.stops,
      stations: stations(a, b),
      lines: linesOf(lineOf('L1', ['a']), lineOf('L2', ['b'])),
      lineCircles: {},
      modes: { line: false, equidistant: false, tens: false, all: 'all', grid: 'off' },
    });
    expect(r.x).toBeCloseTo(300, 5);
    expect(r.y).toBeCloseTo(100, 5);
  });

  it('snaps to a +45° diagonal alignment with any other stop', () => {
    const a = makeStation({ id: 'a', x: 0, y: 0, stops: [makeStop('L1')] });
    const b = makeStation({ id: 'b', x: 0, y: 0, stops: [makeStop('L2')] });
    // Proposed (50, 51) projects onto y=x at (50.5, 50.5).
    const r = snapDraggedStation({
      draggedId: 'b',
      proposedX: 50,
      proposedY: 51,
      draggedRotation: 0,
      draggedStops: b.stops,
      stations: stations(a, b),
      lines: linesOf(lineOf('L1', ['a']), lineOf('L2', ['b'])),
      lineCircles: {},
      modes: { line: false, equidistant: false, tens: false, all: 'all', grid: 'off' },
    });
    expect(r.x).toBeCloseTo(50.5, 3);
    expect(r.y).toBeCloseTo(50.5, 3);
  });

  it('snaps to a -45° diagonal alignment with any other stop', () => {
    const a = makeStation({ id: 'a', x: 0, y: 0, stops: [makeStop('L1')] });
    const b = makeStation({ id: 'b', x: 0, y: 0, stops: [makeStop('L2')] });
    // Proposed (50, -51) projects onto y=-x at (50.5, -50.5).
    const r = snapDraggedStation({
      draggedId: 'b',
      proposedX: 50,
      proposedY: -51,
      draggedRotation: 0,
      draggedStops: b.stops,
      stations: stations(a, b),
      lines: linesOf(lineOf('L1', ['a']), lineOf('L2', ['b'])),
      lineCircles: {},
      modes: { line: false, equidistant: false, tens: false, all: 'all', grid: 'off' },
    });
    expect(r.x).toBeCloseTo(50.5, 3);
    expect(r.y).toBeCloseTo(-50.5, 3);
  });

  it("aligns a normal station to a STOPLESS station's anchor", () => {
    // Target t has no stops → its anchor (100, 0) is the alignment point.
    // Dragged b (one stop at cell 0,0 → zero stop offset) proposed at (104, 50)
    // is 4 from t's vertical axis → snaps to x=100. Mirrors the existing
    // dragged-side anchor fallback so stopless stations work on both sides.
    const t = makeStation({ id: 't', x: 100, y: 0 });
    const b = makeStation({ id: 'b', x: 0, y: 0, stops: [makeStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'b',
      proposedX: 104,
      proposedY: 50,
      draggedRotation: 0,
      draggedStops: b.stops,
      stations: stations(t, b),
      lines: linesOf(lineOf('L1', ['b'])),
      lineCircles: {},
      modes: { line: false, equidistant: false, tens: false, all: 'all', grid: 'off' },
    });
    expect(r.x).toBeCloseTo(100, 5);
    expect(r.y).toBeCloseTo(50, 5);
    expect(r.guides).toHaveLength(1);
  });

  it('composes with line mode into a 2-axis snap at the intersection', () => {
    // A on L1, line-adjacent to dragged B → axis +y through (100, 0).
    // C is unrelated; all-mode picks horizontal alignment through C's stop
    // at (0, 100) — axis +x through y=100.
    // Dragging B near (105, 105) → 2-axis snap to (100, 100).
    const a = makeStation({ id: 'a', x: 100, y: 0, stops: [makeStop('L1')] });
    const c = makeStation({ id: 'c', x: 0, y: 100, stops: [makeStop('L2')] });
    const b = makeStation({ id: 'b', x: 0, y: 0, stops: [makeStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'b',
      proposedX: 105,
      proposedY: 105,
      draggedRotation: 0,
      draggedStops: b.stops,
      stations: stations(a, b, c),
      lines: linesOf(lineOf('L1', ['a', 'b']), lineOf('L2', ['c'])),
      lineCircles: {},
      modes: { line: true, equidistant: false, tens: false, all: 'all', grid: 'off' },
    });
    expect(r.x).toBeCloseTo(100, 3);
    expect(r.y).toBeCloseTo(100, 3);
  });
});

describe('snapDraggedStation: snap-to-all during Ctrl-drag (redistribute)', () => {
  const ALL_ONLY: SnapModes = {
    line: true,
    equidistant: false,
    tens: false,
    all: 'all',
    grid: 'off',
  };

  it('aligns the dragged endpoint with an unrelated stationary station', () => {
    // L1 corridor a — m — d at y=0; Ctrl-drag d with a as the anchor. `u` is
    // an unrelated station on another line, sitting at x=300. Dragging d well
    // off the corridor (y=137, so the anchor's horizontal line snap can't
    // engage) to x=302 must still catch u's vertical alignment.
    const a = makeStation({ id: 'a', x: 0, y: 0, stops: [horizontalStop('L1')] });
    const m = makeStation({ id: 'm', x: 100, y: 0, stops: [horizontalStop('L1')] });
    const d = makeStation({ id: 'd', x: 200, y: 0, stops: [horizontalStop('L1')] });
    const u = makeStation({ id: 'u', x: 300, y: -200, stops: [makeStop('L2')] });
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: 302,
      proposedY: 137,
      draggedRotation: 0,
      draggedStops: d.stops,
      stations: stations(a, m, d, u),
      lines: linesOf(lineOf('L1', ['a', 'm', 'd']), lineOf('L2', ['u'])),
      lineCircles: {},
      redistributeAnchor: 'a',
      modes: ALL_ONLY,
    });
    expect(r.x).toBeCloseTo(300, 5);
    expect(r.y).toBeCloseTo(137, 5);
    expect(r.guides).toHaveLength(1);
  });

  it('aligns the dragged endpoint with the anchor off the line axis', () => {
    // a — d on a horizontal corridor. Dragged far off it (y=137), so the
    // line-mode anchor snap is out of tolerance — but snap-to-all should still
    // catch the anchor's own vertical axis at x=0.
    const a = makeStation({ id: 'a', x: 0, y: 0, stops: [horizontalStop('L1')] });
    const d = makeStation({ id: 'd', x: 200, y: 0, stops: [horizontalStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: 3,
      proposedY: 137,
      draggedRotation: 0,
      draggedStops: d.stops,
      stations: stations(a, d),
      lines: linesOf(lineOf('L1', ['a', 'd'])),
      lineCircles: {},
      redistributeAnchor: 'a',
      modes: ALL_ONLY,
    });
    expect(r.x).toBeCloseTo(0, 5);
    expect(r.y).toBeCloseTo(137, 5);
  });

  it('never targets an intermediate the redistribute is moving', () => {
    // a — m — d; m is mid-flight for the whole gesture, so its vertical axis
    // (x=50) must not capture the drag even at 2 world units away.
    const a = makeStation({ id: 'a', x: 0, y: 0, stops: [horizontalStop('L1')] });
    const m = makeStation({ id: 'm', x: 50, y: 0, stops: [horizontalStop('L1')] });
    const d = makeStation({ id: 'd', x: 100, y: 0, stops: [horizontalStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: 52,
      proposedY: 137,
      draggedRotation: 0,
      draggedStops: d.stops,
      stations: stations(a, m, d),
      lines: linesOf(lineOf('L1', ['a', 'm', 'd'])),
      lineCircles: {},
      redistributeAnchor: 'a',
      modes: ALL_ONLY,
    });
    expect(r.x).toBeCloseTo(52, 5);
    expect(r.y).toBeCloseTo(137, 5);
    expect(r.guides).toEqual([]);
  });

  it('targets a same-line station outside the redistributed chain', () => {
    // L1 runs u — a — m — d. Only m sits between the anchor and the grab, so
    // u stays put and is a legitimate all-axes target.
    const u = makeStation({ id: 'u', x: 300, y: -200, stops: [horizontalStop('L1')] });
    const a = makeStation({ id: 'a', x: 0, y: 0, stops: [horizontalStop('L1')] });
    const m = makeStation({ id: 'm', x: 100, y: 0, stops: [horizontalStop('L1')] });
    const d = makeStation({ id: 'd', x: 200, y: 0, stops: [horizontalStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: 302,
      proposedY: 137,
      draggedRotation: 0,
      draggedStops: d.stops,
      stations: stations(u, a, m, d),
      lines: linesOf(lineOf('L1', ['u', 'a', 'm', 'd'])),
      lineCircles: {},
      redistributeAnchor: 'a',
      modes: ALL_ONLY,
    });
    expect(r.x).toBeCloseTo(300, 5);
    expect(r.y).toBeCloseTo(137, 5);
  });

  it('stays off when snap-to-all is off', () => {
    const a = makeStation({ id: 'a', x: 0, y: 0, stops: [horizontalStop('L1')] });
    const d = makeStation({ id: 'd', x: 200, y: 0, stops: [horizontalStop('L1')] });
    const u = makeStation({ id: 'u', x: 300, y: -200, stops: [makeStop('L2')] });
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: 302,
      proposedY: 137,
      draggedRotation: 0,
      draggedStops: d.stops,
      stations: stations(a, d, u),
      lines: linesOf(lineOf('L1', ['a', 'd']), lineOf('L2', ['u'])),
      lineCircles: {},
      redistributeAnchor: 'a',
      modes: LINE_ONLY,
    });
    expect(r.x).toBe(302);
    expect(r.y).toBe(137);
    expect(r.guides).toEqual([]);
  });
});

describe('axesForAllSnap', () => {
  it('returns the axis family for each directional mode', () => {
    expect(axesForAllSnap('off')).toEqual([]);
    expect(axesForAllSnap('horizontal')).toEqual([{ x: 1, y: 0 }]);
    expect(axesForAllSnap('vertical')).toEqual([{ x: 0, y: 1 }]);
    expect(axesForAllSnap('diagonal')).toHaveLength(2);
    // Diagonal is the two 45° families, not the cardinals.
    for (const a of axesForAllSnap('diagonal')) {
      expect(Math.abs(a.x)).toBeCloseTo(Math.SQRT2 / 2, 5);
      expect(Math.abs(a.y)).toBeCloseTo(Math.SQRT2 / 2, 5);
    }
    expect(axesForAllSnap('all')).toHaveLength(4);
  });
});

describe('snapDraggedStation: directional snap-to-all', () => {
  // A vertically-aligned target (same x) at (100, 0) and a horizontally-
  // aligned target (same y) at (0, 100). Dragging B from origin toward the
  // corner (101, 99) — within tolerance of BOTH the vertical line x=100 and
  // the horizontal line y=100 — lets each directional mode prove it engages
  // only its own axis family.
  const vTarget = makeStation({ id: 'v', x: 100, y: 0, stops: [makeStop('L1')] });
  const hTarget = makeStation({ id: 'h', x: 0, y: 100, stops: [makeStop('L2')] });
  const dragB = makeStation({ id: 'b', x: 0, y: 0, stops: [makeStop('L3')] });
  const baseInput = {
    draggedId: 'b' as StationId,
    draggedRotation: 0 as const,
    draggedStops: dragB.stops,
    stations: stations(vTarget, hTarget, dragB),
    lines: linesOf(lineOf('L1', ['v']), lineOf('L2', ['h']), lineOf('L3', ['b'])),
    lineCircles: {},
  };

  it("'horizontal' snaps Y to a horizontal target and ignores the vertical one", () => {
    const r = snapDraggedStation({
      ...baseInput,
      proposedX: 101,
      proposedY: 99,
      modes: { line: false, equidistant: false, tens: false, all: 'horizontal', grid: 'off' },
    });
    // Y snaps onto the horizontal line through h (y=100); X stays free (101).
    expect(r.y).toBeCloseTo(100, 5);
    expect(r.x).toBeCloseTo(101, 5);
  });

  it("'vertical' snaps X to a vertical target and ignores the horizontal one", () => {
    const r = snapDraggedStation({
      ...baseInput,
      proposedX: 101,
      proposedY: 99,
      modes: { line: false, equidistant: false, tens: false, all: 'vertical', grid: 'off' },
    });
    // X snaps onto the vertical line through v (x=100); Y stays free (99).
    expect(r.x).toBeCloseTo(100, 5);
    expect(r.y).toBeCloseTo(99, 5);
  });

  it("'diagonal' ignores cardinal alignments, snaps a 45° one", () => {
    // Neither v nor h is diagonally aligned with the origin near (101, 99),
    // so diagonal mode leaves the cardinal-only corner alone.
    const cardinal = snapDraggedStation({
      ...baseInput,
      proposedX: 101,
      proposedY: 99,
      modes: { line: false, equidistant: false, tens: false, all: 'diagonal', grid: 'off' },
    });
    expect(cardinal.x).toBeCloseTo(101, 5);
    expect(cardinal.y).toBeCloseTo(99, 5);

    // But a stop on the y=x diagonal through the origin does engage. Use a
    // dedicated single target at the origin so the only candidate is the
    // +45° line through it (the v/h corridor fixture incidentally shares a
    // -45° diagonal, which is a separate case).
    const origin = makeStation({ id: 'o', x: 0, y: 0, stops: [makeStop('LO')] });
    const diag = snapDraggedStation({
      draggedId: 'b',
      draggedRotation: 0,
      draggedStops: dragB.stops,
      stations: stations(origin, dragB),
      lines: linesOf(lineOf('LO', ['o']), lineOf('L3', ['b'])),
      lineCircles: {},
      proposedX: 50,
      proposedY: 51,
      modes: { line: false, equidistant: false, tens: false, all: 'diagonal', grid: 'off' },
    });
    expect(diag.x).toBeCloseTo(50.5, 3);
    expect(diag.y).toBeCloseTo(50.5, 3);
  });

  it("'off' engages no alignment at all", () => {
    const r = snapDraggedStation({
      ...baseInput,
      proposedX: 101,
      proposedY: 99,
      modes: { line: false, equidistant: false, tens: false, all: 'off', grid: 'off' },
    });
    expect(r.x).toBeCloseTo(101, 5);
    expect(r.y).toBeCloseTo(99, 5);
    expect(r.guides).toEqual([]);
  });
});

describe('snapDraggedStation: bullet mode + snap modes', () => {
  it('modes.line=false disables bullet line snap', () => {
    const a = makeStation({ id: 'a', x: 0, y: 0, stops: [makeStop('L1')] });
    const b = makeStation({ id: 'b', x: 0, y: 100, stops: [makeStop('L1')] });
    const r = snapDraggedStation({
      proposedX: 5,
      proposedY: 50,
      stations: stations(a, b),
      lines: linesOf(lineOf('L1', ['a', 'b'])),
      lineCircles: {},
      bulletLineId: 'L1',
      modes: NO_MODES,
    });
    expect(r.x).toBe(5);
    expect(r.y).toBe(50);
    expect(r.guides).toEqual([]);
  });

  it('modes.equidistant is a no-op on bullets (no A-B-C semantics)', () => {
    // Bullets aren't in line.stations, so there's no prev/next pair to
    // average. Equidistant must not affect the bullet's snapped position.
    const a = makeStation({ id: 'a', x: 0, y: 0, stops: [makeStop('L1')] });
    const b = makeStation({ id: 'b', x: 0, y: 100, stops: [makeStop('L1')] });
    const withEqui = snapDraggedStation({
      proposedX: 5,
      proposedY: 50,
      stations: stations(a, b),
      lines: linesOf(lineOf('L1', ['a', 'b'])),
      lineCircles: {},
      bulletLineId: 'L1',
      modes: { line: true, equidistant: true, tens: false, all: 'off', grid: 'off' },
    });
    const baseline = snapDraggedStation({
      proposedX: 5,
      proposedY: 50,
      stations: stations(a, b),
      lines: linesOf(lineOf('L1', ['a', 'b'])),
      lineCircles: {},
      bulletLineId: 'L1',
      modes: LINE_ONLY,
    });
    expect(withEqui.x).toBeCloseTo(baseline.x, 5);
    expect(withEqui.y).toBeCloseTo(baseline.y, 5);
  });

  it("modes.tens snaps a bullet to multiples of 10 from the line's start stop", () => {
    // Line [A, B] vertical. A at (0,0) is the line's start stop and is the
    // tens anchor for bullets. Drag a bullet near (1, 47): line snap pulls
    // it onto the vertical axis through A (x=0); tens snaps along that
    // axis to multiples of 10 from A → y=50.
    const a = makeStation({ id: 'a', x: 0, y: 0, stops: [makeStop('L1')] });
    const b = makeStation({ id: 'b', x: 0, y: 100, stops: [makeStop('L1')] });
    const r = snapDraggedStation({
      proposedX: 1,
      proposedY: 47,
      stations: stations(a, b),
      lines: linesOf(lineOf('L1', ['a', 'b'])),
      lineCircles: {},
      bulletLineId: 'L1',
      modes: { line: true, equidistant: false, tens: true, all: 'off', grid: 'off' },
    });
    expect(r.x).toBeCloseTo(0, 5);
    expect(r.y).toBeCloseTo(50, 5);
  });

  it('modes.all snaps a bullet to a 4-axis grid through any stop', () => {
    // Bullet bound to L1, but the only L1 stop is at (0, 0); a station with
    // a stop on L2 sits at (200, 0). With modes.all, the bullet should
    // horizontally align with the L2 stop too.
    const a = makeStation({ id: 'a', x: 0, y: 0, stops: [makeStop('L1')] });
    const c = makeStation({ id: 'c', x: 200, y: 0, stops: [makeStop('L2')] });
    const r = snapDraggedStation({
      proposedX: 200,
      proposedY: 1,
      stations: stations(a, c),
      lines: linesOf(lineOf('L1', ['a']), lineOf('L2', ['c'])),
      lineCircles: {},
      bulletLineId: 'L1',
      // Line off so the bullet can't latch onto a's vertical axis at x=0;
      // the only thing that can engage is all-mode horizontal alignment.
      modes: { line: false, equidistant: false, tens: false, all: 'all', grid: 'off' },
    });
    expect(r.x).toBeCloseTo(200, 5);
    expect(r.y).toBeCloseTo(0, 5);
  });
});

describe('snapPointToGrid', () => {
  it('rounds to the nearest 10 in both axes', () => {
    expect(snapPointToGrid(0, 0)).toEqual({ x: 0, y: 0 });
    expect(snapPointToGrid(3, 7)).toEqual({ x: 0, y: 10 });
    expect(snapPointToGrid(14.6, 25.4)).toEqual({ x: 10, y: 30 });
    expect(snapPointToGrid(-3, -7)).toEqual({ x: 0, y: -10 });
    expect(snapPointToGrid(-14.6, -25.4)).toEqual({ x: -10, y: -30 });
  });

  it('treats exact halfway as a round-to-even-or-up (JS Math.round)', () => {
    // 5 → 10 (rounds up), 15 → 20, -5 → 0 (Math.round(-0.5) === 0).
    expect(snapPointToGrid(5, 15)).toEqual({ x: 10, y: 20 });
  });

  it("'horizontal' locks Y onto grid rows, leaves X free", () => {
    expect(snapPointToGrid(27, 43, 'horizontal')).toEqual({ x: 27, y: 40 });
  });

  it("'vertical' locks X onto grid columns, leaves Y free", () => {
    expect(snapPointToGrid(27, 43, 'vertical')).toEqual({ x: 30, y: 43 });
  });

  it("'off' returns the point unchanged", () => {
    expect(snapPointToGrid(27, 43, 'off')).toEqual({ x: 27, y: 43 });
  });
});

describe('grid interval: 5px grid', () => {
  it('snapPointToGrid rounds to the nearest 5 when gridInterval is 5', () => {
    // (7, 7) rounds to (5, 5) on a 5px grid but (10, 10) on a 10px grid — the
    // distinguishing case that proves the interval is actually honored.
    expect(snapPointToGrid(7, 7, 'both', 5)).toEqual({ x: 5, y: 5 });
    expect(snapPointToGrid(7, 7, 'both', 10)).toEqual({ x: 10, y: 10 });
    expect(snapPointToGrid(8, 12, 'both', 5)).toEqual({ x: 10, y: 10 });
    expect(snapPointToGrid(-7, -8, 'both', 5)).toEqual({ x: -5, y: -10 });
  });

  it('snapPointToGrid 5px respects the directional modes', () => {
    expect(snapPointToGrid(7, 8, 'horizontal', 5)).toEqual({ x: 7, y: 10 });
    expect(snapPointToGrid(7, 8, 'vertical', 5)).toEqual({ x: 5, y: 8 });
  });

  it('snapPointToGrid rounds to the nearest 20 when gridInterval is 20', () => {
    // (7,7), (13,13), (33,33) land differently on 20 vs 10 vs 5 grids.
    expect(snapPointToGrid(7, 7, 'both', 20)).toEqual({ x: 0, y: 0 });
    expect(snapPointToGrid(13, 13, 'both', 20)).toEqual({ x: 20, y: 20 });
    expect(snapPointToGrid(33, 33, 'both', 20)).toEqual({ x: 40, y: 40 });
  });

  it('maybeSnapToGrid threads the interval', () => {
    const modes: SnapModes = {
      line: false,
      equidistant: false,
      tens: false,
      all: 'off',
      grid: 'both',
    };
    expect(maybeSnapToGrid({ x: 7, y: 7 }, modes, 5)).toEqual({ x: 5, y: 5 });
  });

  it('snapDraggedStation grid fallback notches to 5 when gridInterval is 5', () => {
    const dragged = makeStation({ id: 'd', x: 0, y: 0, stops: [makeStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: 7,
      proposedY: 7,
      draggedRotation: 0,
      draggedStops: dragged.stops,
      stations: stations(dragged),
      lines: linesOf(lineOf('L1', ['d'])),
      lineCircles: {},
      modes: { line: false, equidistant: false, tens: false, all: 'off', grid: 'both' },
      gridInterval: 5,
    });
    expect(r.x).toBe(5);
    expect(r.y).toBe(5);
    expect(r.guides).toEqual([]);
  });

  it('line + 5px grid: perpendicular line-locks while the along-axis steps by 5', () => {
    // Horizontal corridor (line locks y=0); along-axis x=27 → 25 on a 5px grid
    // (vs 30 on a 10px grid).
    const target = makeStation({ id: 't', x: 100, y: 0, stops: [horizontalStop('L1')] });
    const dragged = makeStation({ id: 'd', x: 0, y: 0, stops: [horizontalStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: 27,
      proposedY: 3,
      draggedRotation: 0,
      draggedStops: dragged.stops,
      stations: stations(dragged, target),
      lines: linesOf(lineOf('L1', ['d', 't'])),
      lineCircles: {},
      modes: { line: true, equidistant: false, tens: false, all: 'off', grid: 'both' },
      gridInterval: 5,
    });
    expect(r.y).toBeCloseTo(0, 5);
    expect(r.x).toBeCloseTo(25, 5);
  });
});

describe('maybeSnapToGrid', () => {
  const ALL_OFF: SnapModes = {
    line: false,
    equidistant: false,
    tens: false,
    all: 'off',
    grid: 'off',
  };
  it('returns the input unchanged when grid mode is off', () => {
    expect(maybeSnapToGrid({ x: 27, y: 43 }, ALL_OFF)).toEqual({ x: 27, y: 43 });
  });
  it('snaps to the nearest grid point when grid mode is on', () => {
    expect(maybeSnapToGrid({ x: 27, y: 43 }, { ...ALL_OFF, grid: 'both' })).toEqual({
      x: 30,
      y: 40,
    });
  });
  it('passes null through unchanged', () => {
    expect(maybeSnapToGrid(null, { ...ALL_OFF, grid: 'both' })).toBeNull();
    expect(maybeSnapToGrid(null, ALL_OFF)).toBeNull();
  });
  it("directional grid snaps only the locked axis ('horizontal' → Y)", () => {
    expect(maybeSnapToGrid({ x: 27, y: 43 }, { ...ALL_OFF, grid: 'horizontal' })).toEqual({
      x: 27,
      y: 40,
    });
    expect(maybeSnapToGrid({ x: 27, y: 43 }, { ...ALL_OFF, grid: 'vertical' })).toEqual({
      x: 30,
      y: 43,
    });
  });
});

describe('snapDraggedStation: grid mode', () => {
  it('modes.grid alone snaps the proposed position to the nearest 10', () => {
    // No other stations to trigger line/all snap; only grid is on.
    const dragged = makeStation({ id: 'd', x: 0, y: 0, stops: [makeStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: 27,
      proposedY: 43,
      draggedRotation: 0,
      draggedStops: dragged.stops,
      stations: stations(dragged),
      lines: linesOf(lineOf('L1', ['d'])),
      lineCircles: {},
      modes: { line: false, equidistant: false, tens: false, all: 'off', grid: 'both' },
    });
    expect(r.x).toBe(30);
    expect(r.y).toBe(40);
    expect(r.guides).toEqual([]);
  });

  it('modes.grid off + no other modes leaves the proposed position alone', () => {
    const dragged = makeStation({ id: 'd', x: 0, y: 0, stops: [makeStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: 27,
      proposedY: 43,
      draggedRotation: 0,
      draggedStops: dragged.stops,
      stations: stations(dragged),
      lines: linesOf(lineOf('L1', ['d'])),
      lineCircles: {},
      modes: NO_MODES,
    });
    expect(r.x).toBe(27);
    expect(r.y).toBe(43);
  });

  it('line locks the perpendicular while grid snaps the along-axis position', () => {
    // Two stations on a horizontal corridor — line snap pulls y onto the
    // axis (y=0). With grid also on, the along-axis position (x) snaps to
    // the grid so the user can slide the station along the line in grid
    // increments: x 27 → 30, y stays line-locked at 0.
    const target = makeStation({ id: 't', x: 100, y: 0, stops: [horizontalStop('L1')] });
    const dragged = makeStation({ id: 'd', x: 0, y: 0, stops: [horizontalStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: 27,
      proposedY: 3,
      draggedRotation: 0,
      draggedStops: dragged.stops,
      stations: stations(dragged, target),
      lines: linesOf(lineOf('L1', ['d', 't'])),
      lineCircles: {},
      modes: { line: true, equidistant: false, tens: false, all: 'off', grid: 'both' },
    });
    expect(r.y).toBeCloseTo(0, 5);
    expect(r.x).toBeCloseTo(30, 5);
    expect(r.guides.length).toBeGreaterThan(0);
  });

  it('grid applies when line is on but no alignment engages', () => {
    // Dragged station has no neighbors on its line, so line mode has no
    // pairs to emit — grid should fill in.
    const dragged = makeStation({ id: 'd', x: 0, y: 0, stops: [makeStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: 27,
      proposedY: 43,
      draggedRotation: 0,
      draggedStops: dragged.stops,
      stations: stations(dragged),
      lines: linesOf(lineOf('L1', ['d'])),
      lineCircles: {},
      modes: { line: true, equidistant: false, tens: false, all: 'off', grid: 'both' },
    });
    expect(r.x).toBe(30);
    expect(r.y).toBe(40);
  });

  it('modes.grid works in bullet mode too', () => {
    // Bullet on L1 dragged to (27, 43) with no L1 stops to align to — grid
    // should snap it to (30, 40).
    const a = makeStation({ id: 'a', x: 500, y: 500, stops: [makeStop('L2')] });
    const r = snapDraggedStation({
      proposedX: 27,
      proposedY: 43,
      stations: stations(a),
      lines: linesOf(lineOf('L1', []), lineOf('L2', ['a'])),
      lineCircles: {},
      bulletLineId: 'L1',
      modes: { line: true, equidistant: false, tens: false, all: 'off', grid: 'both' },
    });
    expect(r.x).toBe(30);
    expect(r.y).toBe(40);
  });

  it('directional grid fallback locks only the chosen axis', () => {
    const dragged = makeStation({ id: 'd', x: 0, y: 0, stops: [makeStop('L1')] });
    const horizontal = snapDraggedStation({
      draggedId: 'd',
      proposedX: 27,
      proposedY: 43,
      draggedRotation: 0,
      draggedStops: dragged.stops,
      stations: stations(dragged),
      lines: linesOf(lineOf('L1', ['d'])),
      lineCircles: {},
      modes: { line: false, equidistant: false, tens: false, all: 'off', grid: 'horizontal' },
    });
    // 'horizontal' locks Y to 40, leaves X at 27.
    expect(horizontal.x).toBe(27);
    expect(horizontal.y).toBe(40);

    const vertical = snapDraggedStation({
      draggedId: 'd',
      proposedX: 27,
      proposedY: 43,
      draggedRotation: 0,
      draggedStops: dragged.stops,
      stations: stations(dragged),
      lines: linesOf(lineOf('L1', ['d'])),
      lineCircles: {},
      modes: { line: false, equidistant: false, tens: false, all: 'off', grid: 'vertical' },
    });
    expect(vertical.x).toBe(30);
    expect(vertical.y).toBe(43);
  });
});

describe('snapDraggedStation: line + grid compose along the axis', () => {
  // A vertical stop's world axis is +y; auto-vertical is the makeStop default.
  const verticalStop = (lineId: LineId): StopCell =>
    makeStop(lineId, { row: 0, col: 0, orientation: 'auto-vertical' });

  it('vertical grid slides the station along a horizontal line in grid steps', () => {
    // Horizontal corridor (axis +x). Line locks y=0; the cross-axis grid
    // ('vertical' locks X) snaps the free along-axis coordinate to the grid.
    const target = makeStation({ id: 't', x: 100, y: 0, stops: [horizontalStop('L1')] });
    const dragged = makeStation({ id: 'd', x: 0, y: 0, stops: [horizontalStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: 27,
      proposedY: 3,
      draggedRotation: 0,
      draggedStops: dragged.stops,
      stations: stations(dragged, target),
      lines: linesOf(lineOf('L1', ['d', 't'])),
      lineCircles: {},
      modes: { line: true, equidistant: false, tens: false, all: 'off', grid: 'vertical' },
    });
    expect(r.x).toBeCloseTo(30, 5);
    expect(r.y).toBeCloseTo(0, 5);
  });

  it('horizontal grid cannot slide a horizontal line (locks the perpendicular only)', () => {
    // 'horizontal' grid locks Y — but Y is the line-locked perpendicular on a
    // horizontal corridor, so there is no along-axis grid step to take. X is
    // left wherever the line snap put it (27).
    const target = makeStation({ id: 't', x: 100, y: 0, stops: [horizontalStop('L1')] });
    const dragged = makeStation({ id: 'd', x: 0, y: 0, stops: [horizontalStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: 27,
      proposedY: 3,
      draggedRotation: 0,
      draggedStops: dragged.stops,
      stations: stations(dragged, target),
      lines: linesOf(lineOf('L1', ['d', 't'])),
      lineCircles: {},
      modes: { line: true, equidistant: false, tens: false, all: 'off', grid: 'horizontal' },
    });
    expect(r.x).toBeCloseTo(27, 5);
    expect(r.y).toBeCloseTo(0, 5);
  });

  it('horizontal grid slides the station along a vertical line in grid steps', () => {
    // Vertical corridor (axis +y). Line locks x=0; the cross-axis grid
    // ('horizontal' locks Y) snaps the free along-axis coordinate to the grid.
    const target = makeStation({ id: 't', x: 0, y: 100, stops: [verticalStop('L1')] });
    const dragged = makeStation({ id: 'd', x: 0, y: 0, stops: [verticalStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: 3,
      proposedY: 27,
      draggedRotation: 0,
      draggedStops: dragged.stops,
      stations: stations(dragged, target),
      lines: linesOf(lineOf('L1', ['d', 't'])),
      lineCircles: {},
      modes: { line: true, equidistant: false, tens: false, all: 'off', grid: 'horizontal' },
    });
    expect(r.x).toBeCloseTo(0, 5);
    expect(r.y).toBeCloseTo(30, 5);
  });

  it('vertical grid cannot slide a vertical line (locks the perpendicular only)', () => {
    const target = makeStation({ id: 't', x: 0, y: 100, stops: [verticalStop('L1')] });
    const dragged = makeStation({ id: 'd', x: 0, y: 0, stops: [verticalStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: 3,
      proposedY: 27,
      draggedRotation: 0,
      draggedStops: dragged.stops,
      stations: stations(dragged, target),
      lines: linesOf(lineOf('L1', ['d', 't'])),
      lineCircles: {},
      modes: { line: true, equidistant: false, tens: false, all: 'off', grid: 'vertical' },
    });
    expect(r.x).toBeCloseTo(0, 5);
    expect(r.y).toBeCloseTo(27, 5);
  });

  it("grid 'both' drops a line lock to an off-grid neighbor → plain grid, no guide", () => {
    // Corridor at y=5 (not a grid row). Grid 'both' constrains Y too, so the
    // line lock can't be reconciled with the grid (the anchor would sit at
    // y=5, off-grid). The line yields entirely: snap purely to grid (30,10),
    // no alignment guide. This is the hard-constraint contract.
    const target = makeStation({ id: 't', x: 100, y: 5, stops: [horizontalStop('L1')] });
    const dragged = makeStation({ id: 'd', x: 0, y: 5, stops: [horizontalStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: 27,
      proposedY: 6,
      draggedRotation: 0,
      draggedStops: dragged.stops,
      stations: stations(dragged, target),
      lines: linesOf(lineOf('L1', ['d', 't'])),
      lineCircles: {},
      modes: { line: true, equidistant: false, tens: false, all: 'off', grid: 'both' },
    });
    expect(r.x).toBeCloseTo(30, 5);
    expect(r.y).toBeCloseTo(10, 5);
    expect(r.guides).toEqual([]);
  });

  it('grid overrides an off-grid tens cadence along the constrained axis', () => {
    // [A(3), B] horizontal. tens anchors at A → multiples of 10 from x=3
    // (…, 43, 53), all off-grid. Grid 'vertical' constrains the along-axis (X),
    // so grid wins: x snaps to 50, not the off-grid tens target 43.
    const a = makeStation({ id: 'a', x: 3, y: 0, stops: [horizontalStop('L1')] });
    const b = makeStation({ id: 'b', x: 47, y: 0, stops: [horizontalStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'b',
      proposedX: 47,
      proposedY: 0.5,
      draggedRotation: 0,
      draggedStops: b.stops,
      stations: stations(a, b),
      lines: linesOf(lineOf('L1', ['a', 'b'])),
      lineCircles: {},
      modes: { line: true, equidistant: false, tens: true, all: 'off', grid: 'vertical' },
    });
    expect(r.x).toBeCloseTo(50, 5);
    expect(r.y).toBeCloseTo(0, 5);
  });

  it('notches the dragged endpoint to grid during Ctrl-drag (redistributeAnchor)', () => {
    // [A(0), B, C, D] horizontal, Ctrl-dragging D toward anchor A. The anchor
    // alignment locks y=0; grid 'vertical' now notches D's x to 130 (the hard-
    // grid rule applies to the dragged endpoint — intermediates are gridded
    // separately by redistributeBetween).
    const a = makeStation({ id: 'a', x: 0, y: 0, stops: [horizontalStop('L1')] });
    const b = makeStation({ id: 'b', x: 50, y: 0, stops: [horizontalStop('L1')] });
    const c = makeStation({ id: 'c', x: 100, y: 0, stops: [horizontalStop('L1')] });
    const d = makeStation({ id: 'd', x: 150, y: 0, stops: [horizontalStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: 125,
      proposedY: 0.5,
      draggedRotation: 0,
      draggedStops: d.stops,
      stations: stations(a, b, c, d),
      lines: linesOf(lineOf('L1', ['a', 'b', 'c', 'd'])),
      lineCircles: {},
      redistributeAnchor: 'a',
      modes: { line: true, equidistant: false, tens: false, all: 'off', grid: 'vertical' },
    });
    expect(r.x).toBeCloseTo(130, 5);
    expect(r.y).toBeCloseTo(0, 5);
  });

  it('slides a bullet along its bound line in grid steps', () => {
    // Bullet bound to vertical line [A(0,0), B(0,100)]. Line snap locks the
    // bullet onto the axis x=0; 'horizontal' grid snaps the free along-axis
    // y to the grid (47 → 50). No bulletLineId guard — grid composes for
    // bullets the same as for stations.
    const a = makeStation({ id: 'a', x: 0, y: 0, stops: [verticalStop('L1')] });
    const b = makeStation({ id: 'b', x: 0, y: 100, stops: [verticalStop('L1')] });
    const r = snapDraggedStation({
      proposedX: 1,
      proposedY: 47,
      stations: stations(a, b),
      lines: linesOf(lineOf('L1', ['a', 'b'])),
      lineCircles: {},
      bulletLineId: 'L1',
      modes: { line: true, equidistant: false, tens: false, all: 'off', grid: 'horizontal' },
    });
    expect(r.x).toBeCloseTo(0, 5);
    expect(r.y).toBeCloseTo(50, 5);
  });

  it('composes snap-to-all with grid along the engaged axis', () => {
    // Vertical all-alignment with a stop at (100, 0) locks x=100; the
    // cross-axis grid ('horizontal' locks Y) snaps the along-axis y to 50.
    const a = makeStation({ id: 'a', x: 100, y: 0, stops: [makeStop('L1')] });
    const b = makeStation({ id: 'b', x: 0, y: 0, stops: [makeStop('L2')] });
    const r = snapDraggedStation({
      draggedId: 'b',
      proposedX: 101,
      proposedY: 47,
      draggedRotation: 0,
      draggedStops: b.stops,
      stations: stations(a, b),
      lines: linesOf(lineOf('L1', ['a']), lineOf('L2', ['b'])),
      lineCircles: {},
      modes: { line: false, equidistant: false, tens: false, all: 'vertical', grid: 'horizontal' },
    });
    expect(r.x).toBeCloseTo(100, 5);
    expect(r.y).toBeCloseTo(50, 5);
  });

  it('grid vertical still line-locks an off-grid horizontal neighbor (perp Y free)', () => {
    // Corridor at y=5 (off-grid). Grid 'vertical' constrains only X, so the
    // perpendicular Y is free to ride the off-grid neighbor: X notches to 30,
    // Y stays on the line at 5. The headline "off-grid neighbor" user case.
    const target = makeStation({ id: 't', x: 100, y: 5, stops: [horizontalStop('L1')] });
    const dragged = makeStation({ id: 'd', x: 0, y: 5, stops: [horizontalStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: 27,
      proposedY: 6,
      draggedRotation: 0,
      draggedStops: dragged.stops,
      stations: stations(dragged, target),
      lines: linesOf(lineOf('L1', ['d', 't'])),
      lineCircles: {},
      modes: { line: true, equidistant: false, tens: false, all: 'off', grid: 'vertical' },
    });
    expect(r.x).toBeCloseTo(30, 5);
    expect(r.y).toBeCloseTo(5, 5);
    expect(r.guides).toHaveLength(1);
  });

  it("grid 'both' slides along an on-grid horizontal line in grid steps", () => {
    const target = makeStation({ id: 't', x: 100, y: 0, stops: [horizontalStop('L1')] });
    const dragged = makeStation({ id: 'd', x: 0, y: 0, stops: [horizontalStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: 27,
      proposedY: 3,
      draggedRotation: 0,
      draggedStops: dragged.stops,
      stations: stations(dragged, target),
      lines: linesOf(lineOf('L1', ['d', 't'])),
      lineCircles: {},
      modes: { line: true, equidistant: false, tens: false, all: 'off', grid: 'both' },
    });
    expect(r.x).toBeCloseTo(30, 5);
    expect(r.y).toBeCloseTo(0, 5);
    expect(r.guides).toHaveLength(1);
  });

  it("grid 'both' slides along an on-grid vertical line in grid steps", () => {
    const target = makeStation({ id: 't', x: 0, y: 100, stops: [verticalStop('L1')] });
    const dragged = makeStation({ id: 'd', x: 0, y: 0, stops: [verticalStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: 3,
      proposedY: 27,
      draggedRotation: 0,
      draggedStops: dragged.stops,
      stations: stations(dragged, target),
      lines: linesOf(lineOf('L1', ['d', 't'])),
      lineCircles: {},
      modes: { line: true, equidistant: false, tens: false, all: 'off', grid: 'both' },
    });
    expect(r.x).toBeCloseTo(0, 5);
    expect(r.y).toBeCloseTo(30, 5);
    expect(r.guides).toHaveLength(1);
  });

  it('grid vertical drops a line lock to an off-grid vertical neighbor (perp X on grid)', () => {
    // Vertical corridor at x=5 (off-grid). Grid 'vertical' constrains X — which
    // is the perpendicular here — so the lock can't be reconciled: plain grid.
    const target = makeStation({ id: 't', x: 5, y: 100, stops: [verticalStop('L1')] });
    const dragged = makeStation({ id: 'd', x: 5, y: 0, stops: [verticalStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: 6,
      proposedY: 27,
      draggedRotation: 0,
      draggedStops: dragged.stops,
      stations: stations(dragged, target),
      lines: linesOf(lineOf('L1', ['d', 't'])),
      lineCircles: {},
      modes: { line: true, equidistant: false, tens: false, all: 'off', grid: 'vertical' },
    });
    expect(r.x).toBeCloseTo(10, 5);
    expect(r.y).toBeCloseTo(27, 5);
    expect(r.guides).toEqual([]);
  });

  it('grid horizontal (perp-only) lets an on-grid tens cadence survive along X', () => {
    // [A(3), B] horizontal line at y=0. Grid 'horizontal' constrains Y (the
    // perpendicular), leaving the along-axis X free — so tens still fires → 43.
    const a = makeStation({ id: 'a', x: 3, y: 0, stops: [horizontalStop('L1')] });
    const b = makeStation({ id: 'b', x: 47, y: 0, stops: [horizontalStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'b',
      proposedX: 47,
      proposedY: 0.5,
      draggedRotation: 0,
      draggedStops: b.stops,
      stations: stations(a, b),
      lines: linesOf(lineOf('L1', ['a', 'b'])),
      lineCircles: {},
      modes: { line: true, equidistant: false, tens: true, all: 'off', grid: 'horizontal' },
    });
    expect(r.x).toBeCloseTo(43, 5);
    expect(r.y).toBeCloseTo(0, 5);
  });

  it("grid 'both' keeps an on-grid 2-axis corner", () => {
    // Vertical line x=10 (on grid) ∩ horizontal line y=0 (on grid) → corner
    // (10,0) is grid-valid, so the corner is kept.
    const t1 = makeStation({ id: 't1', x: 10, y: 0, stops: [verticalStop('L1')] });
    const t2 = makeStation({
      id: 't2',
      x: 0,
      y: 0,
      rotation: 2,
      stops: [makeStop('L2', { row: 0, col: 0, orientation: 'auto-vertical' })],
    });
    const dragged = makeStation({
      id: 'd',
      x: 0,
      y: 0,
      stops: [
        makeStop('L1', { row: 0, col: 0, orientation: 'auto-vertical' }),
        makeStop('L2', { row: 0, col: 1, orientation: 'auto-horizontal' }),
      ],
    });
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: 12,
      proposedY: 2,
      draggedRotation: 0,
      draggedStops: dragged.stops,
      stations: stations(dragged, t1, t2),
      lines: linesOf(lineOf('L1', ['d', 't1']), lineOf('L2', ['d', 't2'])),
      lineCircles: {},
      modes: { line: true, equidistant: false, tens: false, all: 'off', grid: 'both' },
    });
    expect(r.x).toBeCloseTo(10, 3);
    expect(r.y).toBeCloseTo(0, 3);
    expect(r.guides.length).toBeGreaterThanOrEqual(2);
  });

  it("grid 'both' degrades an off-grid 2-axis corner to the primary axis", () => {
    // Vertical line x=5 (off grid) ∩ horizontal line y=0 (on grid). Corner
    // (5,0) is off-grid; the horizontal lock is the better-aligned primary
    // (proposed is nearer y=0). Degrade → primary only: X notches to grid (10),
    // Y stays on the on-grid line → (10,0) with a single guide.
    const t1 = makeStation({ id: 't1', x: 5, y: 0, stops: [verticalStop('L1')] });
    const t2 = makeStation({
      id: 't2',
      x: 0,
      y: 0,
      rotation: 2,
      stops: [makeStop('L2', { row: 0, col: 0, orientation: 'auto-vertical' })],
    });
    const dragged = makeStation({
      id: 'd',
      x: 0,
      y: 0,
      stops: [
        makeStop('L1', { row: 0, col: 0, orientation: 'auto-vertical' }),
        makeStop('L2', { row: 0, col: 1, orientation: 'auto-horizontal' }),
      ],
    });
    const r = snapDraggedStation({
      draggedId: 'd',
      proposedX: 8,
      proposedY: 1,
      draggedRotation: 0,
      draggedStops: dragged.stops,
      stations: stations(dragged, t1, t2),
      lines: linesOf(lineOf('L1', ['d', 't1']), lineOf('L2', ['d', 't2'])),
      lineCircles: {},
      modes: { line: true, equidistant: false, tens: false, all: 'off', grid: 'both' },
    });
    expect(r.x).toBeCloseTo(10, 3);
    expect(r.y).toBeCloseTo(0, 3);
    expect(r.guides).toHaveLength(1);
  });

  it("drops a bullet's line lock to an off-grid line under grid 'both'", () => {
    // Bullet bound to vertical line at x=5 (off grid). Grid 'both' constrains
    // X (the perpendicular) → lock rejected → plain grid (10,50), no guide.
    const a = makeStation({ id: 'a', x: 5, y: 0, stops: [verticalStop('L1')] });
    const b = makeStation({ id: 'b', x: 5, y: 100, stops: [verticalStop('L1')] });
    const r = snapDraggedStation({
      proposedX: 6,
      proposedY: 47,
      stations: stations(a, b),
      lines: linesOf(lineOf('L1', ['a', 'b'])),
      lineCircles: {},
      bulletLineId: 'L1',
      modes: { line: true, equidistant: false, tens: false, all: 'off', grid: 'both' },
    });
    expect(r.x).toBeCloseTo(10, 5);
    expect(r.y).toBeCloseTo(50, 5);
    expect(r.guides).toEqual([]);
  });
});
