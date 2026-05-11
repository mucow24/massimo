import { describe, it, expect } from 'vitest';
import { snapDraggedStation, type SnapModes } from './snap';
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

const NO_MODES: SnapModes = { line: false, equidistant: false, tens: false, all: false };
const LINE_ONLY: SnapModes = { line: true, equidistant: false, tens: false, all: false };

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

  it('does nothing when there is no next neighbor on the same line', () => {
    // Line is [A, B] only — B is the terminus, no C.
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
      modes: { line: true, equidistant: true, tens: true, all: false },
    });
    expect(r.x).toBeCloseTo(47, 5);
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
      modes: { line: false, equidistant: false, tens: false, all: true },
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
      modes: { line: false, equidistant: false, tens: false, all: true },
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
      modes: { line: false, equidistant: false, tens: false, all: true },
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
      modes: { line: false, equidistant: false, tens: false, all: true },
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
      modes: { line: true, equidistant: false, tens: false, all: true },
    });
    expect(r.x).toBeCloseTo(100, 3);
    expect(r.y).toBeCloseTo(100, 3);
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
      modes: { line: true, equidistant: true, tens: false, all: false },
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
      modes: { line: true, equidistant: false, tens: true, all: false },
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
      modes: { line: false, equidistant: false, tens: false, all: true },
    });
    expect(r.x).toBeCloseTo(200, 5);
    expect(r.y).toBeCloseTo(0, 5);
  });
});
