import { describe, it, expect } from 'vitest';
import { maybeSnapToGrid, snapDraggedStation, snapPointToGrid, type SnapModes } from './snap';
import { makeStation, makeStop } from '../test/fixtures';
import type { Line, LineId, Station, StationId, StopCell } from '../model/types';

// Local fixture helpers — same shape as snap.test.ts so the two suites read
// the same. Kept local so this file stays self-contained.
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
const stations = (...sts: Station[]): Record<StationId, Station> => {
  const m: Record<StationId, Station> = {};
  for (const s of sts) m[s.id] = s;
  return m;
};

const NO_MODES: SnapModes = {
  line: false,
  equidistant: false,
  tens: false,
  all: false,
  grid: false,
};
const LINE_ONLY: SnapModes = {
  line: true,
  equidistant: false,
  tens: false,
  all: false,
  grid: false,
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
      modes: { ...LINE_ONLY, tens: true },
    });
    expect(r.x).toBeCloseTo(40, 5);
    expect(r.y).toBeCloseTo(0, 5);
  });

  it('does not refine outside the along-axis tolerance window', () => {
    const a = makeStation({ id: 'a', x: 0, y: 0, stops: [horizontalStop('L1')] });
    const b = makeStation({ id: 'b', x: 35, y: 0, stops: [horizontalStop('L1')] });
    const r = snapDraggedStation({
      draggedId: 'b',
      proposedX: 35,
      proposedY: 0,
      draggedRotation: 0,
      draggedStops: b.stops,
      stations: stations(a, b),
      lines: linesOf(lineOf('L1', ['a', 'b'])),
      modes: { ...LINE_ONLY, tens: true },
      tolerance: 10,
    });
    // 35 is 5 from both 30 and 40 — both are within tolerance, but tens
    // ties to 40 (Math.round). Use 35.5 vs 35 to disambiguate.
    expect(r.y).toBeCloseTo(0, 5);
    // Position is on the line (snap-to-line projects onto y=0).
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
      modes: { ...NO_MODES, tens: true },
    });
    expect(r.x).toBe(47);
    expect(r.y).toBe(0.5);
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
      modes: { line: true, equidistant: true, tens: true, all: false, grid: false },
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
      modes: { line: true, equidistant: true, tens: true, all: false, grid: false },
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
      modes: { line: false, equidistant: false, tens: false, all: true, grid: false },
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
      modes: { line: false, equidistant: false, tens: false, all: true, grid: false },
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
      modes: { line: false, equidistant: false, tens: false, all: true, grid: false },
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
      modes: { line: false, equidistant: false, tens: false, all: true, grid: false },
    });
    expect(r.x).toBeCloseTo(50.5, 3);
    expect(r.y).toBeCloseTo(-50.5, 3);
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
      modes: { line: true, equidistant: false, tens: false, all: true, grid: false },
    });
    expect(r.x).toBeCloseTo(100, 3);
    expect(r.y).toBeCloseTo(100, 3);
  });
});

describe('snapDraggedStation: refinement uses compressed stop positions', () => {
  // For diagonal interline groups, each stop's RENDERED world position
  // differs from its cell-grid world position by the compression shift. The
  // equidistant + tens refinement passes (refineAlongAxis) call stopWorldFor
  // for prev/next anchors; those should return RENDERED positions so the
  // refinement snaps to what the user sees, not the underlying logical cells.

  // Each station seeds a 2-stop auto-ne-sw diagonal interline group, so its
  // L1 stop is shifted ~(2.05, 2.05) toward L2's cell during compression.
  const SHIFT = (14 * (Math.SQRT2 - 1)) / 2; // perp delta per stop in a 2-pair
  const dx = SHIFT * Math.SQRT1_2;
  const dy = SHIFT * Math.SQRT1_2;

  // L2 at cell (1, 1) makes the pair perp-adjacent for an auto-ne-sw band
  // (perp axis NW-SE; world delta (STOP_SIZE, STOP_SIZE) along it).
  const diagonalPair = (lineId: LineId) => [
    makeStop(lineId, { row: 0, col: 0, orientation: 'auto-ne-sw' }),
    makeStop('PAD', { row: 1, col: 1, orientation: 'auto-ne-sw' }),
  ];

  it('equidistant snaps to the midpoint of RENDERED prev/next L1 positions, not cell positions', () => {
    // A, B, C on a NE-SW line. A and C have diagonal interline groups
    // (compressed); B has a singleton auto-ne-sw stop (no compression).
    // Cell-grid midpoint of A.L1 + C.L1 = (0, 0); rendered midpoint =
    // (2·dx, 2·dy)/2 = (dx, dy).
    const a = makeStation({
      id: 'a',
      x: -100,
      y: 100,
      rotation: 0,
      stops: diagonalPair('L1'),
    });
    const b = makeStation({
      id: 'b',
      x: 0,
      y: 0,
      rotation: 0,
      stops: [makeStop('L1', { row: 0, col: 0, orientation: 'auto-ne-sw' })],
    });
    const c = makeStation({
      id: 'c',
      x: 100,
      y: -100,
      rotation: 0,
      stops: diagonalPair('L1'),
    });
    const r = snapDraggedStation({
      draggedId: 'b',
      // Propose just off the rendered axis line (x + y = 2·dx + 2·dy ≈ 4.1).
      proposedX: 3,
      proposedY: 0.3,
      draggedRotation: 0,
      draggedStops: b.stops,
      stations: stations(a, b, c),
      lines: linesOf(lineOf('L1', ['a', 'b', 'c'])),
      modes: { ...LINE_ONLY, equidistant: true },
    });
    // Line snap + equidistant should land at (dx, dy) — the midpoint of the
    // RENDERED L1 positions. Cell-position math would have produced (0, 0).
    expect(r.x).toBeCloseTo(dx, 2);
    expect(r.y).toBeCloseTo(dy, 2);
  });

  it('tens anchors at the RENDERED prev L1 position, not the cell position', () => {
    // A's L1 cell = (-100, 100); rendered = (-100 + dx, 100 + dy). With tens
    // active, dragging B should snap to a multiple of 10 from A.rendered.L1
    // along the line axis (NE direction).
    const a = makeStation({
      id: 'a',
      x: -100,
      y: 100,
      rotation: 0,
      stops: diagonalPair('L1'),
    });
    const b = makeStation({
      id: 'b',
      x: 0,
      y: 0,
      rotation: 0,
      stops: [makeStop('L1', { row: 0, col: 0, orientation: 'auto-ne-sw' })],
    });
    // A.rendered.L1 = (-100 + dx, 100 + dy). Multiples of 10 along NE from
    // there: anchorX + k·(√2/2)·10, anchorY + k·(−√2/2)·10. For k = 14, the
    // along distance is 140 (≈|A → B| = 100·√2 ≈ 141.4 → nearest 10 = 140).
    const r = snapDraggedStation({
      draggedId: 'b',
      proposedX: 1,
      proposedY: -0.5,
      draggedRotation: 0,
      draggedStops: b.stops,
      stations: stations(a, b),
      lines: linesOf(lineOf('L1', ['a', 'b'])),
      modes: { ...LINE_ONLY, tens: true },
    });
    // The snapped B.anchor must lie on A.rendered.L1's axis line — a known
    // SHIFT offset from the cell-axis line. Project the snapped position
    // onto the line normal (1, 1)/√2 and assert it's at the *rendered*
    // offset (2·SHIFT·√2/2 = SHIFT·√2 = dx + dy).
    const normalProj = (r.x + r.y) * Math.SQRT1_2;
    // Rendered line: x + y = 2·dx; projection on (1,1)/√2 = 2·dx · √2/2 = dx·√2.
    expect(normalProj).toBeCloseTo(dx * Math.SQRT2, 2);
    // Along-axis distance from A.rendered.L1 is a multiple of 10.
    const arenX = -100 + dx;
    const arenY = 100 + dy;
    const along = (r.x - arenX) * Math.SQRT1_2 + (r.y - arenY) * -Math.SQRT1_2;
    expect(along % 10).toBeCloseTo(0, 4);
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
      bulletLineId: 'L1',
      modes: { line: true, equidistant: true, tens: false, all: false, grid: false },
    });
    const baseline = snapDraggedStation({
      proposedX: 5,
      proposedY: 50,
      stations: stations(a, b),
      lines: linesOf(lineOf('L1', ['a', 'b'])),
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
      bulletLineId: 'L1',
      modes: { line: true, equidistant: false, tens: true, all: false, grid: false },
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
      bulletLineId: 'L1',
      // Line off so the bullet can't latch onto a's vertical axis at x=0;
      // the only thing that can engage is all-mode horizontal alignment.
      modes: { line: false, equidistant: false, tens: false, all: true, grid: false },
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
});

describe('maybeSnapToGrid', () => {
  const ALL_OFF: SnapModes = {
    line: false,
    equidistant: false,
    tens: false,
    all: false,
    grid: false,
  };
  it('returns the input unchanged when grid mode is off', () => {
    expect(maybeSnapToGrid({ x: 27, y: 43 }, ALL_OFF)).toEqual({ x: 27, y: 43 });
  });
  it('snaps to the nearest grid point when grid mode is on', () => {
    expect(maybeSnapToGrid({ x: 27, y: 43 }, { ...ALL_OFF, grid: true })).toEqual({
      x: 30,
      y: 40,
    });
  });
  it('passes null through unchanged', () => {
    expect(maybeSnapToGrid(null, { ...ALL_OFF, grid: true })).toBeNull();
    expect(maybeSnapToGrid(null, ALL_OFF)).toBeNull();
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
      modes: { line: false, equidistant: false, tens: false, all: false, grid: true },
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
      modes: NO_MODES,
    });
    expect(r.x).toBe(27);
    expect(r.y).toBe(43);
  });

  it('line-mode snap wins over grid when an alignment engages', () => {
    // Two stations on a horizontal corridor — line snap should pull y onto
    // the axis (y=0) even though grid would round y to 0/10. The engine
    // doesn't snap along-axis here (no tens/equidistant), so x stays at the
    // proposed value (27) — NOT grid-rounded to 30.
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
      modes: { line: true, equidistant: false, tens: false, all: false, grid: true },
    });
    expect(r.y).toBeCloseTo(0, 5);
    expect(r.x).toBeCloseTo(27, 5);
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
      modes: { line: true, equidistant: false, tens: false, all: false, grid: true },
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
      bulletLineId: 'L1',
      modes: { line: true, equidistant: false, tens: false, all: false, grid: true },
    });
    expect(r.x).toBe(30);
    expect(r.y).toBe(40);
  });
});
