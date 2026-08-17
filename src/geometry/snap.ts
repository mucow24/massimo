import type {
  GuideOrientation,
  Line,
  LineCircle,
  LineId,
  Station,
  StationId,
  StopCell,
} from '../model/types';
import type { Vec2 } from './vec';
import { cross, SQRT2_2 } from './vec';
import { rotateBy, stationDirToWorld, stopCenterAt, travelDirLocal } from './orientation';
import type { Rotation } from './orientation';
import { stopPosWorld } from './interlining';
import { stationCircle } from './lineCircle';
import { lineHasEdge, neighborsOf, shortestPathOnLine } from '../model/lineTopology';

/**
 * Default perpendicular tolerance for engaging a snap, in world units — this is
 * the value at zoom 1. Callers reach it through {@link snapToleranceAt}, never
 * raw, so the engage radius stays constant in *screen* pixels.
 */
export const SNAP_PERP_TOLERANCE = 10;

/**
 * The engage tolerance at a given camera zoom, in world units. THE one home for
 * the divide: the radius must be a constant number of SCREEN pixels at every
 * zoom, so zooming in shrinks the world-space radius and allows finer
 * positioning before a snap takes effect. Every snap site — both engines, both
 * drags and the placement path — asks here rather than restating it, because a
 * site that passed the raw world-unit constant would silently snap from twice
 * as far out at 2× zoom. (Grid snap is a hard constraint and unaffected.)
 */
export const snapToleranceAt = (zoom: number): number => SNAP_PERP_TOLERANCE / zoom;

/**
 * Tighter tolerance used to detect a *third* station that is also already
 * aligned with the primary snap axis. Shows the in-line opposite-direction
 * indicator without claiming the third station as another snap target.
 */
export const TIGHT_PERP_TOLERANCE = 0.5;

/** Default "snap to grid" cell size, in world units. The toolbar cycles the
 *  active size through 5, 10, and 20 and threads it into the snap calls. Also
 *  the default cadence for "Snap to grid length" (the `tens` mode), which
 *  notches to whole multiples of the *active* grid size. */
export const GRID_INTERVAL = 10;

// Both gate on |cross(unitAxisA, unitAxisB)| = |sin(angle between the axes)|,
// at two different scales. PARALLEL_SIN_EPS treats two axes as parallel (a true
// degeneracy check). SECONDARY_AXIS_SIN_GATE is the looser "different enough"
// bar a candidate secondary axis must clear so the two-constraint snap solve is
// well-conditioned (well above the parallel epsilon).
const PARALLEL_SIN_EPS = 1e-3;
const SECONDARY_AXIS_SIN_GATE = 0.1;

/**
 * Snap an arbitrary (x, y) point to the nearest grid intersection. Pure and
 * stateless — used both by the snap engine's grid mode and by the label drag
 * path, which doesn't go through the engine.
 *
 * `mode` selects which axes are constrained. Per the toolbar semantics,
 * "horizontal" snaps onto horizontal grid lines (locks Y, free X) and
 * "vertical" snaps onto vertical grid lines (locks X, free Y). Defaults to
 * 'both' so existing callers keep the full two-axis snap.
 *
 * `gridInterval` is the grid cell size; defaults to {@link GRID_INTERVAL} (10)
 * so existing callers keep the standard grid. The toolbar threads the active
 * size (5, 10, or 20) here so snapping tracks the visible grid.
 */
export function snapPointToGrid(
  x: number,
  y: number,
  mode: GridSnap = 'both',
  gridInterval: number = GRID_INTERVAL,
): { x: number; y: number } {
  const snapX = mode === 'vertical' || mode === 'both';
  const snapY = mode === 'horizontal' || mode === 'both';
  // `+ 0` normalizes -0 → 0 so callers don't see signed-zero leakage from
  // Math.round on small negative inputs.
  return {
    x: snapX ? Math.round(x / gridInterval) * gridInterval + 0 : x,
    y: snapY ? Math.round(y / gridInterval) * gridInterval + 0 : y,
  };
}

/**
 * Gate for grid snap at a placement site. Returns the world point snapped
 * to the grid when `modes.grid` is on (any direction); otherwise the point
 * unchanged. Null passes through so callers can pipe a cursor that may be
 * unset.
 */
export function maybeSnapToGrid<T extends { x: number; y: number } | null>(
  world: T,
  modes: SnapModes,
  gridInterval: number = GRID_INTERVAL,
): T {
  if (!world || modes.grid === 'off') return world;
  return snapPointToGrid(world.x, world.y, modes.grid, gridInterval) as T;
}

/**
 * Directional state for "Snap to all". The button cycles through these:
 * off → horizontal-only → vertical-only → diagonal-only → all. Each value
 * selects which world axes the alignment may engage (see {@link axesForAllSnap}).
 */
export type AllSnap = 'off' | 'horizontal' | 'vertical' | 'diagonal' | 'all';

/**
 * Directional state for "Snap to grid". The button cycles through these:
 * off → horizontal → vertical → both. "horizontal" locks Y (snaps onto
 * horizontal grid lines), "vertical" locks X, "both" snaps both axes.
 */
export type GridSnap = 'off' | 'horizontal' | 'vertical' | 'both';

/**
 * The one degree of freedom a single-DOF snap caller has left — an edge resize's
 * axis, or a guide's offset. 'x'/'y' name the world axis the point may move
 * along; the two diagonal values are a diagonal guide's own drag, which can only
 * slide its intercept.
 */
export type SnapConstraint = 'x' | 'y' | 'diagonal-down' | 'diagonal-up';

/**
 * What the directional grid means for that one DOF: the modes that constrain an
 * axis the caller cannot move are no constraint at all, and drop to 'off'. A
 * diagonal DOF keeps only the full lattice — its crossings are the discrete
 * intercepts, and a single-axis grid has none to offer. The one home for the
 * narrowing, so the point snapper and a caller deciding whether the grid already
 * owns its DOF (see {@link guideTensOffset}) cannot answer it differently.
 */
export function constrainedGridMode(mode: GridSnap, constrain?: SnapConstraint): GridSnap {
  if (!constrain) return mode;
  switch (constrain) {
    case 'x':
      return mode === 'both' || mode === 'vertical' ? 'vertical' : 'off';
    case 'y':
      return mode === 'both' || mode === 'horizontal' ? 'horizontal' : 'off';
    default:
      return mode === 'both' ? 'both' : 'off';
  }
}

/**
 * User-toggleable snap modes. `line`, `equidistant`, and `tens` are boolean
 * flags (the latter two are no-ops unless `line` is also true); `all` and
 * `grid` are directional cycles.
 */
export interface SnapModes {
  /** Today's "lock to line direction" snap (project onto the axis defined by
   *  line-adjacent neighbors with parallel travel directions). */
  line: boolean;
  /** Along the line axis, snap the dragged stop to the midpoint between the
   *  same-line prev and next neighbors when their axes through the dragged
   *  are parallel. Gated on `line`. */
  equidistant: boolean;
  /** "Snap to grid length": along the line axis, snap the dragged stop to a
   *  multiple of the active grid size (`gridInterval`) measured from the
   *  prev-in-line-ordering neighbor. For stations/bullets this is gated on
   *  `line` (the engine only refines a line-mode primary). The point snapper
   *  (`snapPolygonPoint`) reuses the same flag to notch other objects a whole
   *  grid length from whatever they snap to, and a guide's own drag to step its
   *  offset off its nearest parallel guide ({@link guideTensOffset}). */
  tens: boolean;
  /** Snap when the dragged stop is aligned with any other stop along the
   *  selected axis family (vertical, horizontal, and/or diagonal; line
   *  membership and travel direction ignored). Composes with `line` via the
   *  existing 2-axis solver. `'off'` disables it. */
  all: AllSnap;
  /** Snap the dragged anchor to the nearest grid-interval multiple along the
   *  selected axes (the active grid size — see the `gridInterval` params). A
   *  **hard constraint**: when grid is on, the result is
   *  always on the grid. The other modes only narrow *which* grid point is
   *  chosen, and engage only when their target is itself grid-valid — when a
   *  line/all/corner/cadence alignment can't be reconciled with the grid it
   *  simply doesn't fire (no guide). `'off'` disables it. */
  grid: GridSnap;
  /** Also snap a station seating on a line circle to the nearest of the ring's
   *  eight CARDINAL points, and paint their tick marks. Read by the interaction
   *  layer only (`snapPointToCircle`), never by the engine below: line circles
   *  are a constraint outside both snappers. There is deliberately no "circle
   *  off" state — a ring always captures, and Shift is how you decline. */
  circle: boolean;
}

export const DEFAULT_SNAP_MODES: SnapModes = {
  line: true,
  equidistant: false,
  tens: false,
  all: 'off',
  grid: 'off',
  circle: false,
};

export interface SnapGuide {
  from: Vec2;
  to: Vec2;
  /** Optional label to render above the guide. Used for the per-drag
   *  measurement readout: distance for a regular snap, station-to-station
   *  spacing for a Ctrl-drag. Formatted with {@link formatMeasurement}. */
  label?: string;
  /** Set when this entry marks an engaged ALIGNMENT GUIDE rather than a
   *  drawable segment. `SnapGuides` never draws it as a plain line — the
   *  canvas resolves the id back to the guide and paints the full snap chrome
   *  ON the guide itself (halo + dashed span + snap-point ring + coordinate
   *  chip; see EngagedGuideChrome) plus the guide's accent recolor.
   *  `from`/`to` both carry the LANDED point — the ring's position. */
  alignGuideId?: string;
  /** Set on an AMBIENT measurement: a span that rides every frame of a gesture
   *  whether or not anything engaged, rather than the feedback for a snap that
   *  locked. `SnapGuides` paints it in a quieter register — no halo pass, no
   *  endpoint rings, a thinner line and a smaller chip — because such a span
   *  measures FROM the thing being dragged and must not outshout it. The guide
   *  drag's spacing readout is the one source (see {@link
   *  guideNeighbourReadout}). */
  quiet?: boolean;
}

/** How every live readout renders a world-unit measurement: one decimal place.
 *  Whole numbers keep the trailing ".0" — the fixed width is the point, so a
 *  number doesn't change shape as a drag crosses a unit boundary, and a readout
 *  that stalls on a fractional nudge is visibly still moving. The one home for
 *  the format: drag distances, redistribute spacing, the circle-diameter chip,
 *  and the engaged guide's coordinate chip all speak it.
 *
 *  Every caller but that last one passes a hypot/abs distance, so the sign can
 *  only ever arrive from a guide's offset — and a guide a hair above y=0 must
 *  not read "-0.0". */
export function formatMeasurement(value: number): string {
  const text = value.toFixed(1);
  return text === '-0.0' ? '0.0' : text;
}

/** An alignment guide as a snap target: a horizontal (constant-Y), vertical
 *  (constant-X), or 45° (constant-intercept) line at `offset`, infinite unless
 *  a bounded `extent` narrows it to a span (see AlignmentGuide.extent — same
 *  shape, same along-axis units). `AlignmentGuide` is structurally assignable;
 *  callers pass the visibility-gated, exclusion-filtered pool. */
export interface GuideTarget {
  id: string;
  orientation: GuideOrientation;
  offset: number;
  extent?: { center: number; halfLength: number };
}

// ---------- Guide-line geometry ----------
//
// The one home for "which line is a guide of orientation o at offset c":
// both snappers, the drag hook, the nudge, the group tow, and the two
// renderers (GuideView + the engaged chrome) all key off these five, so the
// diagonal intercept convention (offset = Y at x 0; see GuideOrientation)
// lives in exactly one place.

/** The unit direction a guide of the given orientation runs along. */
export function guideAxis(orientation: GuideOrientation): Vec2 {
  switch (orientation) {
    case 'horizontal':
      return { x: 1, y: 0 };
    case 'vertical':
      return { x: 0, y: 1 };
    case 'diagonal-down':
      return { x: SQRT2_2, y: SQRT2_2 };
    case 'diagonal-up':
      return { x: SQRT2_2, y: -SQRT2_2 };
  }
}

/** The offset a guide of this orientation would need to pass through `p` —
 *  p.y / p.x for horizontal/vertical, the Y-intercept (y − x / y + x) for the
 *  diagonals. */
export function guideOffsetOf(orientation: GuideOrientation, p: Vec2): number {
  switch (orientation) {
    case 'horizontal':
      return p.y;
    case 'vertical':
      return p.x;
    case 'diagonal-down':
      return p.y - p.x;
    case 'diagonal-up':
      return p.y + p.x;
  }
}

/** A guide's one degree of freedom, as the snappers' constraint: it may only
 *  move perpendicular to itself, which for a strip is a single world axis and
 *  for a diagonal is its own 45° family. */
export function guideConstraint(orientation: GuideOrientation): SnapConstraint {
  switch (orientation) {
    case 'horizontal':
      return 'y';
    case 'vertical':
      return 'x';
    default:
      return orientation;
  }
}

/** True perpendicular distance from `p` to the guide line, in world units —
 *  what an engage tolerance compares against. A diagonal's intercept delta
 *  overstates the miss by √2, hence the divide. */
export function guidePerpDist(orientation: GuideOrientation, offset: number, p: Vec2): number {
  const d = Math.abs(guideOffsetOf(orientation, p) - offset);
  return orientation === 'diagonal-down' || orientation === 'diagonal-up' ? d / Math.SQRT2 : d;
}

/** The foot of `p` on the guide line — the nearest point ON the guide. */
export function guideFoot(orientation: GuideOrientation, offset: number, p: Vec2): Vec2 {
  switch (orientation) {
    case 'horizontal':
      return { x: p.x, y: offset };
    case 'vertical':
      return { x: offset, y: p.y };
    case 'diagonal-down': {
      const e = (offset - (p.y - p.x)) / 2;
      return { x: p.x - e, y: p.y + e };
    }
    case 'diagonal-up': {
      const e = (offset - (p.y + p.x)) / 2;
      return { x: p.x + e, y: p.y + e };
    }
  }
}

/** The single-scalar offset change a translation (dx, dy) carries for this
 *  orientation — the tow/nudge projection. Cross-axis motion contributes
 *  nothing: dy for horizontal, dx for vertical, dy − dx / dy + dx for the
 *  diagonals. Inverse of {@link guideMoveVector}. */
export function guideNudgeDelta(orientation: GuideOrientation, dx: number, dy: number): number {
  switch (orientation) {
    case 'horizontal':
      return dy;
    case 'vertical':
      return dx;
    case 'diagonal-down':
      return dy - dx;
    case 'diagonal-up':
      return dy + dx;
  }
}

/** The perpendicular world translation that changes a guide's offset by `d` —
 *  how a guide MASTER tows its group rigidly. Round-trips through
 *  {@link guideNudgeDelta}. */
export function guideMoveVector(orientation: GuideOrientation, d: number): Vec2 {
  switch (orientation) {
    case 'horizontal':
      return { x: 0, y: d };
    case 'vertical':
      return { x: d, y: 0 };
    case 'diagonal-down':
      return { x: -d / 2, y: d / 2 };
    case 'diagonal-up':
      return { x: d / 2, y: d / 2 };
  }
}

/** The along-axis parameter of `p` for this orientation — its signed distance
 *  along {@link guideAxis} from the t = 0 anchor (the world origin's foot), in
 *  TRUE world units: x for horizontal, y for vertical, (x ± y)/√2 for the
 *  diagonals. The coordinate `AlignmentGuide.extent` speaks. */
export function guideAlongOf(orientation: GuideOrientation, p: Vec2): number {
  const a = guideAxis(orientation);
  return p.x * a.x + p.y * a.y;
}

/** The point at along-parameter `t` on the guide line — the inverse of
 *  {@link guideAlongOf} restricted to the line. The t = 0 anchor is the world
 *  origin's foot, for every orientation alike. */
export function guidePointAt(orientation: GuideOrientation, offset: number, t: number): Vec2 {
  const anchor = guideFoot(orientation, offset, { x: 0, y: 0 });
  const a = guideAxis(orientation);
  return { x: anchor.x + t * a.x, y: anchor.y + t * a.y };
}

/** Does a snap FOOT on this guide's line land inside its span? Bounded guides
 *  exist only where this is true — the edge is inclusive and hard (past the
 *  tip is exactly where a bounded guide must let go; no grace margin). An
 *  unbounded guide admits everything. The one gate every extent consumer
 *  shares: both snappers, the spacing readout and grid-length cadence below,
 *  and the locked deep-pick's point test (hitStack). Structural on purpose —
 *  readout/cadence pool entries carry no id. */
export function guideAdmitsFoot(
  g: { orientation: GuideOrientation; extent?: { center: number; halfLength: number } },
  foot: Vec2,
): boolean {
  if (!g.extent) return true;
  return Math.abs(guideAlongOf(g.orientation, foot) - g.extent.center) <= g.extent.halfLength;
}

/** The guide's drawable segment clipped to a box (the overdrawn viewBox —
 *  painting past it is ink overflow, which costs the composited pan layer)
 *  and, when the guide is bounded, to its extent — the single choke point that
 *  keeps GuideView and the engaged snap chrome drawing the same span.
 *  Horizontal/vertical guides span the full box edge-to-edge even when their
 *  offset lies outside it (the layer draws them regardless, matching the
 *  pre-diagonal behavior); a diagonal that misses the box entirely — or an
 *  extent that misses it — returns null: there is no finite segment to draw. */
export function guideSegmentInBox(
  orientation: GuideOrientation,
  offset: number,
  vbX: number,
  vbY: number,
  vbW: number,
  vbH: number,
  extent?: { center: number; halfLength: number },
): { x1: number; y1: number; x2: number; y2: number } | null {
  const seg = ((): { x1: number; y1: number; x2: number; y2: number } | null => {
    switch (orientation) {
      case 'horizontal':
        return { x1: vbX, y1: offset, x2: vbX + vbW, y2: offset };
      case 'vertical':
        return { x1: offset, y1: vbY, x2: offset, y2: vbY + vbH };
      case 'diagonal-down': {
        // y = x + offset: clip the x-range to where y stays inside the box.
        const x1 = Math.max(vbX, vbY - offset);
        const x2 = Math.min(vbX + vbW, vbY + vbH - offset);
        if (x1 > x2) return null;
        return { x1, y1: x1 + offset, x2, y2: x2 + offset };
      }
      case 'diagonal-up': {
        // y = offset − x.
        const x1 = Math.max(vbX, offset - (vbY + vbH));
        const x2 = Math.min(vbX + vbW, offset - vbY);
        if (x1 > x2) return null;
        return { x1, y1: offset - x1, x2, y2: offset - x2 };
      }
    }
  })();
  if (!seg || !extent) return seg;
  // Every arm above emits its endpoints t-ascending, so the extent is a plain
  // interval intersection in the along parameter.
  const lo = Math.max(
    guideAlongOf(orientation, { x: seg.x1, y: seg.y1 }),
    extent.center - extent.halfLength,
  );
  const hi = Math.min(
    guideAlongOf(orientation, { x: seg.x2, y: seg.y2 }),
    extent.center + extent.halfLength,
  );
  if (lo > hi) return null;
  const a = guidePointAt(orientation, offset, lo);
  const b = guidePointAt(orientation, offset, hi);
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
}

/**
 * The spacing readout for a guide gesture: the perpendicular span from the
 * dragged guide to the nearest PARALLEL guide on each side, as labeled
 * `SnapGuide` segments.
 *
 * It is a measurement, not a snap: guides never snap to each other (stacking
 * two is meaningless), so nothing here engages anything, and it is emitted on
 * every frame of the gesture rather than only when something locks. Shift
 * declines snapping, not measuring. Hence `quiet` on every span — a station
 * drag's neighbour chrome is the feedback for something that LOCKED and reads
 * as loud as it likes, while these ride the whole gesture and measure from the
 * guide the user is moving: at full chrome, two stationary spans out-shout the
 * hairline that is actually under the cursor.
 *
 * `at` is the live cursor; the spans anchor at its FOOT on the dragged guide,
 * so they land by the pointer instead of at a fixed spot along an infinite
 * line. The label is the TRUE perpendicular distance (`guidePerpDist` — a
 * diagonal's intercept delta overstates it by √2), which is exactly the length
 * of the segment drawn, so the number and the ink agree.
 *
 * Only guides of the same ORIENTATION can be neighbours: any other crosses the
 * dragged guide, so the distance between the two is zero somewhere and there is
 * no one gap to name. And a BOUNDED parallel is a neighbour only where its span
 * covers the cursor's along-position (`guideAdmitsFoot` at its foot): past its
 * tip there is no ink to measure to, and a labeled segment ending in blank
 * canvas claims a neighbour that visibly isn't there. `others` must therefore
 * be every parallel guide on the
 * canvas — not the snap pool, which drops the guides MOVING with the drag. A
 * missing one doesn't just go unmeasured: the span reaches past it to the next
 * one out and is drawn straight through it, claiming a "nearest" neighbour with
 * a guide visibly crossing the line. The caller re-derives a towed guide's live
 * offset rather than excluding it (see useGuideDrag; those towed entries carry
 * no extent on purpose — never drawing through a sibling dominates).
 *
 * A COINCIDENT parallel guide (one at this very offset — reachable whenever
 * both are grid-snapped) silences the readout instead: the nearest neighbour is
 * then zero away on both sides, so no gap is left to report, and a span to
 * anything further would start out of a guide it never named.
 */
export function guideNeighbourReadout(
  orientation: GuideOrientation,
  offset: number,
  at: Vec2,
  others: readonly {
    orientation: GuideOrientation;
    offset: number;
    extent?: { center: number; halfLength: number };
  }[],
): SnapGuide[] {
  const from = guideFoot(orientation, offset, at);
  let below: number | null = null;
  let above: number | null = null;
  for (const o of others) {
    if (o.orientation !== orientation) continue;
    // A bounded parallel with no ink at this along-position is not there.
    if (!guideAdmitsFoot(o, guideFoot(orientation, o.offset, from))) continue;
    // GRID_EPS as the "same coordinate" bar: two grid-snapped guides land on
    // bit-equal offsets, and a hair of FP drift below this is not a gap.
    if (Math.abs(o.offset - offset) < GRID_EPS) return [];
    if (o.offset < offset) {
      if (below === null || o.offset > below) below = o.offset;
    } else if (above === null || o.offset < above) above = o.offset;
  }
  const out: SnapGuide[] = [];
  for (const n of [below, above]) {
    if (n === null) continue;
    out.push({
      from,
      to: guideFoot(orientation, n, from),
      label: formatMeasurement(guidePerpDist(orientation, n, from)),
      quiet: true,
    });
  }
  return out;
}

/**
 * "Snap to grid length" (the `tens` mode) on a guide's one degree of freedom:
 * `offset` notched to a whole multiple of `gridInterval` measured from the
 * NEAREST parallel guide, or null when nothing anchors it — no parallel guide
 * on the canvas, or the nearest notch further than `tolerance` off.
 *
 * It is the terminal station's cadence, transplanted: a station at the end of a
 * line takes its step from its one neighbour, and a guide has exactly one
 * neighbour worth measuring to either side. Which is also why `others` is the
 * pool the caller may not move — a cadence measured off something towed by the
 * same grab never changes (the station engine spells the same rule
 * `excludedIds`), so the drag hook passes its snap pool here, not the wider one
 * the readout measures against. `at` is the live cursor, the readout's
 * convention: a BOUNDED parallel anchors only where its span covers the
 * cursor's along-position (`guideAdmitsFoot` at its foot) — past its tip there
 * is no ink to step from, and a cadence off invisible ink is a snap the user
 * cannot see the reason for.
 *
 * The step is a DISTANCE, not an intercept: a diagonal's offsets are Y-
 * intercepts, √2 apart for every world unit of true gap (`guidePerpDist`), so
 * both the notch and the tolerance run through that scale.
 *
 * The spacing readout is then the feedback for free — the gap it labels is the
 * whole grid multiple this landed on. With one exception, from the pool split
 * above: in a group drag whose towed sibling sits BETWEEN the guide and its
 * anchor, the readout names that sibling's constant gap and the notch goes
 * unlabelled. The cadence is right there, just unannounced.
 */
export function guideTensOffset(
  orientation: GuideOrientation,
  offset: number,
  at: Vec2,
  others: readonly {
    orientation: GuideOrientation;
    offset: number;
    extent?: { center: number; halfLength: number };
  }[],
  gridInterval: number,
  tolerance: number,
): number | null {
  const from = guideFoot(orientation, offset, at);
  let anchor: number | null = null;
  for (const o of others) {
    if (o.orientation !== orientation) continue;
    // A bounded parallel with no ink at this along-position anchors nothing.
    if (!guideAdmitsFoot(o, guideFoot(orientation, o.offset, from))) continue;
    if (anchor === null || Math.abs(o.offset - offset) < Math.abs(anchor - offset))
      anchor = o.offset;
  }
  if (anchor === null) return null;
  const offsetPerUnit =
    orientation === 'diagonal-down' || orientation === 'diagonal-up' ? Math.SQRT2 : 1;
  const step = gridInterval * offsetPerUnit;
  const steps = Math.round((offset - anchor) / step);
  // Inside half a step the only whole multiple on offer is zero, and a cadence
  // of zero steps is a STACK — the one thing guides never do (see the readout,
  // which likewise refuses to name a gap of nothing). Standing down there is
  // the honest answer: the guide moves freely through that band. Clamping to
  // one step instead would fling it a whole interval off the pointer.
  if (steps === 0) return null;
  const notched = anchor + steps * step;
  return Math.abs(notched - offset) / offsetPerUnit <= tolerance ? notched : null;
}

export interface SnapResult {
  x: number;
  y: number;
  guides: SnapGuide[];
}

/**
 * Value equality for guide lists. Drag hooks use it in a functional state
 * update so a move that reproduces the previous guides — including the common
 * no-guides ⇒ no-guides case — keeps the same array reference and React can
 * bail instead of re-rendering.
 */
export function snapGuidesEqual(a: SnapGuide[], b: SnapGuide[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ga = a[i];
    const gb = b[i];
    if (ga.from.x !== gb.from.x || ga.from.y !== gb.from.y) return false;
    if (ga.to.x !== gb.to.x || ga.to.y !== gb.to.y) return false;
    if (ga.label !== gb.label) return false;
    if (ga.alignGuideId !== gb.alignGuideId) return false;
    if (ga.quiet !== gb.quiet) return false;
  }
  return true;
}

export interface SnapInput {
  /** Station drag mode: required when no `bulletLineId`. */
  draggedId?: StationId;
  proposedX: number;
  proposedY: number;
  /** Station drag mode: required when no `bulletLineId`. */
  draggedRotation?: Rotation;
  /** Station drag mode: the dragged station's stops. */
  draggedStops?: StopCell[];
  stations: Record<StationId, Station>;
  /** Required for line-adjacency filtering — only line-adjacent stations on
   *  a shared line emit a snap pair. */
  lines: Record<LineId, Line>;
  /** The doc's line circles. A bound station resolves its stop cells through
   *  the RING frame (see `stationFrameRad`), so a snapper that skipped them
   *  would aim at a stop position nothing actually paints. */
  lineCircles: Record<string, LineCircle>;
  /** World-units perpendicular tolerance for engaging a snap. */
  tolerance?: number;
  /** Ctrl-drag (redistribute) mode: the fixed end of the redistribute. Line
   *  mode snaps exclusively to this station — the intermediates between it and
   *  the grab are moving targets and make poor line candidates, so the anchor
   *  is the single fixed point on the line. Adjacency on each shared line is
   *  bypassed here — the anchor qualifies regardless of how many stops sit
   *  between. Snap-to-all is NOT narrowed this way: it keeps every station the
   *  redistribute isn't moving (see {@link redistributeMovingIds}). */
  redistributeAnchor?: StationId;
  /** Bullet mode: snap a free-floating element (no stops of its own) to
   *  align with any station's stop on this line. The bullet anchors at
   *  (proposedX, proposedY) — its own stop offset is zero — and projects
   *  onto each target stop's axis line. Line adjacency doesn't apply. */
  bulletLineId?: LineId;
  /** Group-drag: stations to skip when picking snap candidates. Includes
   *  every other station moving with the group, so they don't act as
   *  (themselves-moving) snap targets for the grabbed station. The dragged
   *  station is always implicitly excluded; this set augments that. */
  excludedIds?: ReadonlySet<StationId>;
  /** Alignment guides in play, ALWAYS-ON targets independent of every mode
   *  toggle (Shift bypasses at the call sites, like all snapping). The caller
   *  passes the visibility-gated pool minus anything moving with the drag. */
  guideTargets?: readonly GuideTarget[];
  /** Which snap modes are active. Defaults to {@link DEFAULT_SNAP_MODES}
   *  (line on, others off) so existing call sites preserve current behavior. */
  modes?: SnapModes;
  /** Grid cell size in world units for the grid hard-constraint. Defaults to
   *  {@link GRID_INTERVAL} (10); the toolbar threads the active size (5, 10, or 20). */
  gridInterval?: number;
}

/**
 * Compute the snapped world position for a dragged station, plus any guides
 * to render. Pure function — no React, no DOM.
 *
 * Single-axis snap: the dragged station's stop is projected onto the target's
 * axis line. Two-axis snap (e.g. dragging onto a transfer station): solves a
 * 2x2 system to put the drag at the unique intersection of two non-parallel
 * axes. Multiple lines that share a target+axis (interlined bands) are
 * consolidated to a single snap candidate using their median offset (a real
 * stripe, not an averaged gap), so the user feels one band-wide click instead
 * of N individual line clicks.
 */
export function snapDraggedStation(input: SnapInput): SnapResult {
  const {
    draggedId,
    proposedX,
    proposedY,
    draggedRotation,
    draggedStops,
    stations,
    lines,
    lineCircles,
    excludedIds,
    tolerance = SNAP_PERP_TOLERANCE,
    redistributeAnchor,
    bulletLineId,
    modes = DEFAULT_SNAP_MODES,
    gridInterval = GRID_INTERVAL,
  } = input;

  type Cand = {
    /** Null for an alignment-guide candidate — a guide has no station. */
    target: Station | null;
    /** Set for alignment-guide candidates; drives the marker emission. */
    guideId?: string;
    dOff: Vec2;
    tOff: Vec2;
    axis: Vec2;
    perpDist: number;
    targetStopX: number;
    targetStopY: number;
    /** Which snap mode produced this candidate. Used to gate the phase-3
     *  along-axis refinement (only fires when the primary came from line). */
    kind: 'line' | 'all' | 'guide';
  };
  // Consolidation/opposite-guide grouping key: a station's id, or the guide's.
  const targetKeyOf = (c: Cand): string => (c.guideId ? 'guide:' + c.guideId : c.target!.id);

  // Collect every alignment pair within perp tolerance.
  const all: Cand[] = [];
  const excluded = excludedIds;
  const requireAdjacency = !redistributeAnchor;
  // Redistribute (Ctrl-drag) is treated like a line-mode operation regardless
  // of the user's `modes.line` toggle — it's an explicit, modal interaction.
  const lineModeOn = modes.line || !!redistributeAnchor;
  const allModeOn = modes.all !== 'off';

  // Line-mode candidate narrowing for the plain drag (no bullet, no
  // redistribute): a target can only ever emit a line pair when it is an
  // edge-neighbour of the dragged station on one of its stop lines — for any
  // other target every `alignmentPairs` iteration finds no tCell, no line, or
  // fails its `lineHasEdge` check and returns []. The one adjacency-free case,
  // the stopless↔stopless anchor fallback, is preserved by the stops-length
  // arm of `lineTargetEligible`. Bullet mode (adjacency doesn't apply) and
  // redistribute (adjacency deliberately bypassed) keep their full pools.
  const plainLineMode = lineModeOn && !bulletLineId && !redistributeAnchor;
  const dStops = draggedStops ?? [];
  const dragNeighborIds: ReadonlySet<StationId> | null =
    plainLineMode && dStops.length > 0
      ? new Set(
          dStops.flatMap((c) =>
            lines[c.lineId] ? neighborsOf(lines[c.lineId], draggedId as StationId) : [],
          ),
        )
      : null;
  const lineTargetEligible = (t: Station): boolean =>
    !plainLineMode || (dragNeighborIds ? dragNeighborIds.has(t.id) : t.stops.length === 0);

  // Line mode's target pool. During a redistribute the anchor is the ONLY
  // line-mode candidate: the intermediates are moving with the drag, and
  // aligning to them would fight the redistribute itself.
  const lineTargets = bulletLineId
    ? Object.values(stations).filter((t) => !excluded || !excluded.has(t.id))
    : redistributeAnchor
      ? stations[redistributeAnchor]
        ? [stations[redistributeAnchor]]
        : []
      : Object.values(stations).filter(
          (t) => t.id !== draggedId && (!excluded || !excluded.has(t.id)),
        );
  // Snap-to-all keeps the whole map in play during a redistribute — only the
  // stations the redistribute is actively pushing around are unstable targets,
  // not everything that isn't the anchor. Outside a redistribute the two pools
  // are the same set.
  const moving =
    redistributeAnchor && draggedId
      ? redistributeMovingIds(lines, draggedId, redistributeAnchor)
      : null;
  const allTargets = !allModeOn
    ? []
    : moving
      ? Object.values(stations).filter(
          (t) => t.id !== draggedId && !moving.has(t.id) && (!excluded || !excluded.has(t.id)),
        )
      : lineTargets;

  const lineTargetIds = new Set(lineTargets.map((t) => t.id));
  const allTargetIds = new Set(allTargets.map((t) => t.id));
  const targets =
    allTargets.length === 0
      ? lineTargets
      : [...allTargets, ...lineTargets.filter((t) => !allTargetIds.has(t.id))];

  for (const t of targets) {
    const linePairs: AlignmentPair[] =
      lineModeOn && lineTargetIds.has(t.id) && lineTargetEligible(t)
        ? bulletLineId
          ? bulletAlignmentPairs(t, bulletLineId, lineCircles)
          : alignmentPairs(
              draggedId as StationId,
              draggedRotation as Rotation,
              dStops,
              t,
              lines,
              lineCircles,
              requireAdjacency,
            )
        : [];
    const allPairs: AlignmentPair[] = allTargetIds.has(t.id)
      ? allAxesPairs(dStops, (draggedRotation ?? 0) as Rotation, t, lineCircles, modes.all)
      : [];
    type TaggedPair = AlignmentPair & { kind: 'line' | 'all' };
    const pairs: TaggedPair[] = [
      ...linePairs.map((p): TaggedPair => ({ ...p, kind: 'line' })),
      ...allPairs.map((p): TaggedPair => ({ ...p, kind: 'all' })),
    ];
    for (const pair of pairs) {
      const perpX = -pair.axis.y;
      const perpY = pair.axis.x;
      const tStopX = t.x + pair.tOff.x;
      const tStopY = t.y + pair.tOff.y;
      const dStopX = proposedX + pair.dOff.x;
      const dStopY = proposedY + pair.dOff.y;
      const dx = tStopX - dStopX;
      const dy = tStopY - dStopY;
      const perpDist = Math.abs(dx * perpX + dy * perpY);
      if (perpDist > tolerance) continue;
      all.push({
        target: t,
        dOff: pair.dOff,
        tOff: pair.tOff,
        axis: pair.axis,
        perpDist,
        targetStopX: tStopX,
        targetStopY: tStopY,
        kind: pair.kind,
      });
    }
  }

  // Alignment guides: always-on candidates, independent of every mode toggle.
  // A guide IS a ready-made alignment axis, so it needs no pair machinery: the
  // dragged reference is the station ANCHOR (dOff = 0 — the same reference
  // point the snapping contract names for grid), and the "target stop" is the
  // anchor's foot on the guide line, which gives the solver the constraint
  // `anchor · perp = offset` verbatim — for all four orientations alike.
  for (const g of input.guideTargets ?? []) {
    const anchor = { x: proposedX, y: proposedY };
    const perpDist = guidePerpDist(g.orientation, g.offset, anchor);
    if (perpDist > tolerance) continue;
    const foot = guideFoot(g.orientation, g.offset, anchor);
    // A bounded guide attracts only where the foot lands inside its span.
    if (!guideAdmitsFoot(g, foot)) continue;
    all.push({
      target: null,
      guideId: g.id,
      dOff: { x: 0, y: 0 },
      tOff: { x: 0, y: 0 },
      axis: guideAxis(g.orientation),
      perpDist,
      targetStopX: foot.x,
      targetStopY: foot.y,
      kind: 'guide',
    });
  }

  if (all.length === 0) {
    // No alignment engaged — fall through to grid snap if enabled. Grid is
    // a fallback so explicit alignments (line/equidistant/tens/all) always
    // win when they fire.
    if (modes.grid !== 'off') {
      const g = snapPointToGrid(proposedX, proposedY, modes.grid, gridInterval);
      return { x: g.x, y: g.y, guides: [] };
    }
    return { x: proposedX, y: proposedY, guides: [] };
  }

  // Consolidate interlined candidates: lines that share the same target
  // station AND the same axis (e.g. all the lines of an interlined band) get
  // merged into a single band-level candidate. Without this, each shared
  // line individually crosses the perp tolerance at a slightly different
  // drag position and the user sees several alignment "clicks" instead of
  // one band-wide snap. We pick the median band by perpendicular offset so
  // the visual guide lands on a real stripe — averaging the offsets puts
  // the guide between bands when the band count is even.
  const targetAxisGroups: Cand[][] = [];
  for (const c of all) {
    const g = targetAxisGroups.find(
      (grp) => targetKeyOf(grp[0]) === targetKeyOf(c) && parallel(grp[0].axis, c.axis),
    );
    if (g) g.push(c);
    else targetAxisGroups.push([c]);
  }
  const consolidated: Cand[] = targetAxisGroups.map((g) => {
    // If any candidate in this target+axis group came from line mode,
    // preserve the 'line' tag on the consolidated candidate — phase 3
    // refinement only fires off line-mode primaries. A guide group is always
    // pure (its key is unique), so 'guide' survives untouched.
    const kind: Cand['kind'] = g.some((c) => c.kind === 'line')
      ? 'line'
      : g[0].kind === 'guide'
        ? 'guide'
        : 'all';
    if (g.length === 1) return { ...g[0], kind };
    const axis = g[0].axis;
    const perpX = -axis.y;
    const perpY = axis.x;
    // Sort by the dragged-side perpendicular offset and take the MEDIAN (not
    // the mean) so the chosen representative is a real stripe. Sorting by the
    // dragged vs target side is immaterial for a genuine interline: its stripes
    // keep the same perpendicular order at both endpoints, so both keys produce
    // the same median pick. The median (vs an averaged offset) is what keeps the
    // guide on a real band instead of between two.
    const sorted = [...g].sort(
      (a, b) => a.dOff.x * perpX + a.dOff.y * perpY - (b.dOff.x * perpX + b.dOff.y * perpY),
    );
    return { ...sorted[Math.floor((sorted.length - 1) / 2)], kind };
  });

  // Group consolidated candidates by axis (parallel) and keep best per group.
  const groups: Cand[][] = [];
  for (const c of consolidated) {
    const g = groups.find((grp) => parallel(grp[0].axis, c.axis));
    if (g) g.push(c);
    else groups.push([c]);
  }
  // Per-axis primary candidate: every entry in `g` has already passed the
  // perpDist-within-tolerance filter, so they're all "aligned enough" along
  // this axis. Among the alignable ones, pick the candidate closest to
  // the dragged point — that's the meaningful neighbor — instead of the
  // smallest perpDist (which on bullet snap, where every stop on a line
  // is a candidate, could be a station way past the actual neighbors due
  // to sub-pixel perp differences). addOppositeGuide handles the other
  // side along the axis.
  //
  // GUIDES are the one exception to closest-wins: a guide's stand-in target
  // is the drag's own foot, so its distance IS its perpDist and it would beat
  // any real neighbor along the axis by construction — a parallel guide nine
  // units off would yank a station off a one-unit-perfect corridor alignment.
  // A guide contests its axis on ALIGNMENT QUALITY instead, the point
  // snapper's rule: it wins only when its perpendicular distance is smaller
  // than the best station candidate's.
  const distFromBullet = (c: Cand) =>
    Math.hypot(proposedX - c.targetStopX, proposedY - c.targetStopY);
  const bests = groups.map((g) => {
    let bestStation: Cand | null = null;
    let bestGuide: Cand | null = null;
    for (const c of g) {
      if (c.kind === 'guide') {
        if (!bestGuide || c.perpDist < bestGuide.perpDist) bestGuide = c;
      } else if (!bestStation || distFromBullet(c) < distFromBullet(bestStation)) {
        bestStation = c;
      }
    }
    if (!bestStation) return bestGuide!;
    if (!bestGuide) return bestStation;
    return bestGuide.perpDist < bestStation.perpDist ? bestGuide : bestStation;
  });
  // Across axes (for two-axis snap), the smallest perpDist still wins:
  // it picks the better-aligned axis as primary.
  bests.sort((a, b) => a.perpDist - b.perpDist);

  let primary = bests[0];
  // Find a non-parallel secondary (so the two constraints solve uniquely).
  let secondary: Cand | null = null;
  for (let i = 1; i < bests.length; i++) {
    const cz = cross(primary.axis, bests[i].axis);
    if (Math.abs(cz) > SECONDARY_AXIS_SIN_GATE) {
      secondary = bests[i];
      break;
    }
  }

  const gridOn = modes.grid !== 'off';
  let sx: number;
  let sy: number;

  if (secondary) {
    // Two-axis snap: solve the 2x2 system that puts the dragged stop on each
    // target axis line simultaneously. Each constraint is
    //   (anchor + dOff_i - targetStop_i) · perp_i = 0
    // ⇒  anchor · perp_i = (targetStop_i - dOff_i) · perp_i
    const p1 = { x: -primary.axis.y, y: primary.axis.x };
    const p2 = { x: -secondary.axis.y, y: secondary.axis.x };
    const k1 =
      (primary.targetStopX - primary.dOff.x) * p1.x + (primary.targetStopY - primary.dOff.y) * p1.y;
    const k2 =
      (secondary.targetStopX - secondary.dOff.x) * p2.x +
      (secondary.targetStopY - secondary.dOff.y) * p2.y;
    const det = p1.x * p2.y - p1.y * p2.x;
    sx = (k1 * p2.y - k2 * p1.y) / det;
    sy = (p1.x * k2 - p2.x * k1) / det;

    // Grid is a hard constraint: the corner can't slide, so keep it only when
    // it's grid-valid; otherwise degrade to whichever single lock can be
    // reconciled (or plain grid if neither can).
    if (gridOn) {
      const lockOf = (c: Cand): GridLock => ({
        q: { x: c.targetStopX - c.dOff.x, y: c.targetStopY - c.dOff.y },
        axis: c.axis,
      });
      const r = reconcileCorner(
        sx,
        sy,
        lockOf(primary),
        lockOf(secondary),
        { x: proposedX, y: proposedY },
        modes.grid,
        gridInterval,
      );
      if (r.kept === 'none') {
        const g = snapPointToGrid(proposedX, proposedY, modes.grid, gridInterval);
        return { x: g.x, y: g.y, guides: [] };
      }
      sx = r.x;
      sy = r.y;
      // Collapse to the surviving lock so guide-building emits the right
      // guide(s): 'primary' keeps primary only, 'secondary' promotes it to
      // primary, 'both' leaves the pair intact.
      if (r.kept === 'secondary') {
        primary = secondary;
        secondary = null;
      } else if (r.kept === 'primary') {
        secondary = null;
      }
    }
  } else {
    // Single-axis snap: project the dragged stop onto the primary's axis
    // line through its target stop.
    const c = primary;
    const proposedDStop = { x: proposedX + c.dOff.x, y: proposedY + c.dOff.y };
    const snapped = projectOntoAxis(proposedDStop, { x: c.targetStopX, y: c.targetStopY }, c.axis);
    sx = snapped.x - c.dOff.x;
    sy = snapped.y - c.dOff.y;

    // Grid as a hard constraint: reconcile the line lock with the grid. When
    // the lock can't be reconciled (off-grid perpendicular, or a diagonal that
    // misses the lattice), the alignment doesn't engage — fall back to a plain
    // grid snap with no guide.
    if (gridOn) {
      const q = { x: c.targetStopX - c.dOff.x, y: c.targetStopY - c.dOff.y };
      const r = reconcileLockWithGrid(
        q,
        c.axis,
        { x: proposedX, y: proposedY },
        modes.grid,
        gridInterval,
      );
      if (!r.engaged) {
        const g = snapPointToGrid(proposedX, proposedY, modes.grid, gridInterval);
        return { x: g.x, y: g.y, guides: [] };
      }
      sx = r.x;
      sy = r.y;
    }
  }

  // Phase 3: along-axis refinement (equidistant + tens). Runs for any
  // single-axis line-mode primary — both station drags and bullets. 2-axis
  // snaps are skipped (the corner is already locked) and `all`-mode
  // primaries are skipped (refining off them would silently slide the snap
  // to a line-mode anchor that wasn't part of the candidate pool).
  // Equidistant has no meaning for bullets (no A-B-C neighbors); the helper
  // gates that internally. Skipped when the grid pins the along-axis: there
  // the grid owns the along coordinate (an on-grid cadence anchor already
  // coincides with the grid; an off-grid one is dropped by design).
  const gridPinsAlong = gridOn && gridConstrainsAlong(primary.axis, modes.grid);
  let refinedSourceGuide: { from: Vec2; to: Vec2 } | undefined;
  if (
    !secondary &&
    primary.kind === 'line' &&
    (modes.equidistant || modes.tens) &&
    !gridPinsAlong
  ) {
    const refined = refineAlongAxis({
      sx,
      sy,
      axis: primary.axis,
      dOff: primary.dOff,
      draggedId,
      draggedRotation: (draggedRotation ?? 0) as Rotation,
      draggedStops: draggedStops ?? [],
      lines,
      stationsRec: stations,
      lineCircles,
      modes,
      tolerance,
      gridInterval,
      bulletLineId,
      redistributeAnchor,
      excludedIds: excluded,
    });
    if (refined) {
      sx = refined.sx;
      sy = refined.sy;
      refinedSourceGuide = refined.sourceGuide;
    }
  }

  // Compute the per-station spacing for the Ctrl-drag readout. Count
  // intermediates only on shared line(s) whose corridor is aligned with the
  // primary guide axis — a line on a different axis would report a spacing for
  // stops the guide isn't drawn through. Among the parallel lines the gap is
  // identical by construction, so Math.max is a safe conservative pick.
  //
  // Segments come from the line's EDGE graph (shortestPathOnLine), NOT a
  // `line.stations` index slice: membership order is creation order, not track
  // order, so `|indexOf(d) - indexOf(a)|` can miscount on loops/branches or any
  // out-of-order line. This mirrors redistributeBetween, which walks the same
  // graph — the readout must divide by the same segment count the redistribute
  // actually uses.
  const spacingDivisor = (() => {
    if (!redistributeAnchor) return 0;
    let segments = 0;
    if (!draggedId) return 0;
    for (const line of Object.values(lines)) {
      const path = shortestPathOnLine(line, draggedId, redistributeAnchor);
      if (!path) continue; // not both members, or unlinked on this line
      const dCell = (draggedStops ?? []).find((c) => c.lineId === line.id);
      if (!dCell) continue;
      const lineAxis = rotateBy(
        travelDirLocal(dCell.orientation),
        (draggedRotation ?? 0) as Rotation,
      );
      if (!parallel(lineAxis, primary.axis)) continue;
      segments = Math.max(segments, path.length);
    }
    return segments;
  })();

  const labelFor = (from: Vec2, to: Vec2, isAnchor: boolean): string => {
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    if (isAnchor && spacingDivisor > 0) {
      return formatMeasurement(dist / spacingDivisor);
    }
    return formatMeasurement(dist);
  };

  // Build guides for every active axis (so the user sees that both snaps
  // are engaged on a perpendicular transfer station, etc.).
  const guides: SnapGuide[] = [];
  const pushGuide = (c: Cand) => {
    const from = { x: sx + c.dOff.x, y: sy + c.dOff.y };
    if (c.guideId) {
      // An engaged alignment guide is a MARKER, not a drawable segment — the
      // guide is already on the canvas; recoloring it is the feedback.
      guides.push({ from, to: { ...from }, alignGuideId: c.guideId });
      return;
    }
    const to = { x: c.targetStopX, y: c.targetStopY };
    const isAnchor = !!redistributeAnchor && c.target!.id === redistributeAnchor;
    guides.push({ from, to, label: labelFor(from, to, isAnchor) });
  };
  pushGuide(primary);
  if (secondary) pushGuide(secondary);

  // Same-axis opposite-direction tight neighbor (the in-line third-station
  // indicator). Emitted per active axis; does nothing when no third station
  // is already aligned.
  const addOppositeGuide = (c: Cand) => {
    // A guide primary has no station neighbors to bracket the drag between.
    if (c.guideId) return;
    const px = -c.axis.y;
    const py = c.axis.x;
    const dStopX = sx + c.dOff.x;
    const dStopY = sy + c.dOff.y;
    const primaryAlong = (c.targetStopX - dStopX) * c.axis.x + (c.targetStopY - dStopY) * c.axis.y;
    // A sub-epsilon FP residual in primaryAlong (near-coincident stops along
    // the axis) would otherwise feed Math.sign an arbitrary ±1, flickering the
    // third-station indicator on/off. Treat within GRID_EPS as coincident — no
    // meaningful "primary side", so no opposite guide.
    if (Math.abs(primaryAlong) < GRID_EPS) return;
    const oppositeSign = -Math.sign(primaryAlong);
    let candidate: { from: Vec2; to: Vec2; alongAbs: number } | null = null;
    // Use consolidated (one entry per target+axis) so a third interlined
    // station doesn't get a separate guide per shared line.
    for (const o of consolidated) {
      // Guide entries never bracket: their "target stop" is the drag's own
      // foot, so the along-axis distance is ~0, not a third-station cue.
      if (o.guideId) continue;
      if (targetKeyOf(o) === targetKeyOf(c)) continue;
      if (!parallel(o.axis, c.axis)) continue;
      const oDStopX = sx + o.dOff.x;
      const oDStopY = sy + o.dOff.y;
      const ddx = o.targetStopX - oDStopX;
      const ddy = o.targetStopY - oDStopY;
      const perpDistOpp = Math.abs(ddx * px + ddy * py);
      if (perpDistOpp > TIGHT_PERP_TOLERANCE) continue;
      const alongFromD = ddx * c.axis.x + ddy * c.axis.y;
      if (Math.sign(alongFromD) !== oppositeSign) continue;
      const alongAbs = Math.abs(alongFromD);
      if (!candidate || alongAbs < candidate.alongAbs) {
        candidate = {
          from: { x: oDStopX, y: oDStopY },
          to: { x: o.targetStopX, y: o.targetStopY },
          alongAbs,
        };
      }
    }
    if (candidate) {
      guides.push({
        from: candidate.from,
        to: candidate.to,
        label: labelFor(candidate.from, candidate.to, false),
      });
    }
  };
  addOppositeGuide(primary);
  if (secondary) addOppositeGuide(secondary);

  // Source-cadence guide for terminus equidistant: shows the prev-prev →
  // prev (or next-next → next) segment whose distance was extrapolated.
  // Drawn as a regular alignment guide with a matching distance label, so
  // the user sees the same number on both sides of the snap point.
  if (refinedSourceGuide) {
    const { from, to } = refinedSourceGuide;
    guides.push({ from, to, label: labelFor(from, to, false) });
  }

  return { x: sx, y: sy, guides };
}

/**
 * The stations a Ctrl-drag redistribute is actively moving: the interior of
 * the shortest edge path between the anchor and the dragged station on every
 * line that links both — exactly the chain `redistributeBetween` rewrites on
 * each move. They're mid-flight for the whole gesture, so they make useless
 * snap targets. The anchor and the dragged station are endpoints, so neither
 * ends up in the set.
 */
function redistributeMovingIds(
  lines: Record<LineId, Line>,
  draggedId: StationId,
  anchorId: StationId,
): Set<StationId> {
  const moving = new Set<StationId>();
  for (const line of Object.values(lines)) {
    // `shortestPathOnLine` returns the tail — every station after the anchor,
    // ending at the dragged one. Drop that last entry to get the interior.
    const tail = shortestPathOnLine(line, anchorId, draggedId);
    if (!tail) continue;
    for (let i = 0; i < tail.length - 1; i++) moving.add(tail[i]);
  }
  return moving;
}

// ----- Internals (exported for testing) -----

/**
 * The world-frame "axis" a station's input/output line lies on for snapping
 * purposes when the station has no stops to consult. Two stations share an
 * axis iff their rotation values are equal mod 4.
 */
export function axisForRotation(rot: number): Vec2 {
  switch (rot % 4) {
    case 0:
      return { x: 0, y: 1 };
    case 1:
      return { x: SQRT2_2, y: -SQRT2_2 }; // NE–SW
    case 2:
      return { x: 1, y: 0 };
    default:
      return { x: SQRT2_2, y: SQRT2_2 }; // NW–SE
  }
}

export function parallel(a: Vec2, b: Vec2): boolean {
  return Math.abs(cross(a, b)) < PARALLEL_SIN_EPS;
}

/**
 * Project point `p` onto the infinite line through `anchor` with unit
 * direction `axis`. Used wherever a snap constrains a point to a line: the
 * single-axis line snap (drop the proposed stop onto the target's axis) and
 * the along-axis grid refinement (slide the grid-snapped anchor back onto the
 * locked axis so the perpendicular stays put).
 */
export function projectOntoAxis(p: Vec2, anchor: Vec2, axis: Vec2): Vec2 {
  const along = (p.x - anchor.x) * axis.x + (p.y - anchor.y) * axis.y;
  return { x: anchor.x + along * axis.x, y: anchor.y + along * axis.y };
}

/** Tolerance for "is this coordinate a grid multiple", in world units. Grid-
 *  placed coordinates are exact `round(v/interval)*interval`; line-locked
 *  anchors whose stop offsets cancel are exact too — so a tight, absolute
 *  epsilon is right at any grid interval. */
const GRID_EPS = 1e-6;

/** Which world axes the directional grid mode constrains. */
export function gridConstrains(mode: GridSnap): { gx: boolean; gy: boolean } {
  return {
    gx: mode === 'vertical' || mode === 'both',
    gy: mode === 'horizontal' || mode === 'both',
  };
}

/** True when `v` sits on a grid line (a multiple of `gridInterval`). `gridInterval`
 *  comes before `eps` so the common call site `isGridMultiple(v, interval)` reads
 *  naturally; both default so existing `isGridMultiple(v)` callers are unchanged. */
export function isGridMultiple(
  v: number,
  gridInterval: number = GRID_INTERVAL,
  eps: number = GRID_EPS,
): boolean {
  return Math.abs(v - Math.round(v / gridInterval) * gridInterval) < eps;
}

/** Does the grid constrain motion *along* this lock axis (vs only its
 *  perpendicular)? Used to decide whether grid pins the along-axis coordinate
 *  (skipping equidistant/tens) or leaves it free for cadence. */
function gridConstrainsAlong(axis: Vec2, mode: GridSnap): boolean {
  const { gx, gy } = gridConstrains(mode);
  return (gx && Math.abs(axis.x) > 1e-9) || (gy && Math.abs(axis.y) > 1e-9);
}

const snapToGridMultiple = (v: number, gridInterval: number = GRID_INTERVAL): number =>
  Math.round(v / gridInterval) * gridInterval + 0;

export interface LockGridResult {
  x: number;
  y: number;
  /** False when the lock cannot be reconciled with the grid (its grid-
   *  constrained perpendicular is off-grid, or a diagonal misses the lattice).
   *  The caller then falls back to a plain grid snap with no guide. */
  engaged: boolean;
}

/**
 * Reconcile a single line lock (anchor on the line through `q` with unit
 * direction `axis`) with the directional grid. Closed-form: every axis the
 * engine produces is horizontal, vertical, or exactly 45°.
 *
 * - Horizontal/vertical: the perpendicular is a single world axis. If grid
 *   constrains the perpendicular, engage only when the perp coordinate is on
 *   grid. The along-axis is snapped to grid when grid constrains it, else left
 *   at the proposed position (free for cadence).
 * - Diagonal (`y − σx = c`, `σ = sign(axis.x·axis.y)`): grid `both` engages
 *   only when `c` is a grid multiple (then every grid column meets the line at
 *   a grid point); single-axis grid pins the constrained coordinate and rides
 *   the line for the other.
 */
export function reconcileLockWithGrid(
  q: Vec2,
  axis: Vec2,
  proposed: Vec2,
  mode: GridSnap,
  gridInterval: number = GRID_INTERVAL,
): LockGridResult {
  const { gx, gy } = gridConstrains(mode);
  const m = (v: number) => snapToGridMultiple(v, gridInterval);

  if (Math.abs(axis.y) < 1e-9) {
    // Horizontal lock: along X, perp Y = q.y.
    if (gy && !isGridMultiple(q.y, gridInterval)) return { x: 0, y: 0, engaged: false };
    return { x: gx ? m(proposed.x) : proposed.x, y: q.y, engaged: true };
  }
  if (Math.abs(axis.x) < 1e-9) {
    // Vertical lock: along Y, perp X = q.x.
    if (gx && !isGridMultiple(q.x, gridInterval)) return { x: 0, y: 0, engaged: false };
    return { x: q.x, y: gy ? m(proposed.y) : proposed.y, engaged: true };
  }
  // Diagonal lock.
  const sigma = Math.sign(axis.x * axis.y);
  const c = q.y - sigma * q.x;
  if (gx && gy) {
    if (!isGridMultiple(c, gridInterval)) return { x: 0, y: 0, engaged: false };
    const foot = projectOntoAxis(proposed, q, axis);
    const x = m(foot.x);
    return { x, y: c + sigma * x, engaged: true };
  }
  if (gx) {
    const x = m(proposed.x);
    return { x, y: c + sigma * x, engaged: true };
  }
  const y = m(proposed.y);
  return { x: sigma * (y - c), y, engaged: true };
}

/** A single line lock, expressed for grid reconciliation: anchor on the line
 *  through `q` with unit direction `axis`. */
export interface GridLock {
  q: Vec2;
  axis: Vec2;
}

/**
 * Reconcile a 2-axis corner (the fixed intersection of two non-parallel locks)
 * with the grid. The corner can't slide, so keep both locks only when the
 * corner is already grid-valid. Otherwise degrade to a single lock — preferring
 * the (better-aligned) primary, but falling back to the secondary when the
 * primary can't be reconciled with the grid — so a grid-valid lock is never
 * dropped in favor of an off-grid one. `kept` says which lock(s) survived, so
 * the caller can emit the matching guide(s); `'none'` means neither could
 * engage → plain grid snap.
 */
export function reconcileCorner(
  cornerX: number,
  cornerY: number,
  primary: GridLock,
  secondary: GridLock,
  proposed: Vec2,
  mode: GridSnap,
  gridInterval: number = GRID_INTERVAL,
): { x: number; y: number; kept: 'both' | 'primary' | 'secondary' | 'none' } {
  const { gx, gy } = gridConstrains(mode);
  if (
    (!gx || isGridMultiple(cornerX, gridInterval)) &&
    (!gy || isGridMultiple(cornerY, gridInterval))
  ) {
    return { x: cornerX, y: cornerY, kept: 'both' };
  }
  const rp = reconcileLockWithGrid(primary.q, primary.axis, proposed, mode, gridInterval);
  if (rp.engaged) return { x: rp.x, y: rp.y, kept: 'primary' };
  const rs = reconcileLockWithGrid(secondary.q, secondary.axis, proposed, mode, gridInterval);
  if (rs.engaged) return { x: rs.x, y: rs.y, kept: 'secondary' };
  return { x: 0, y: 0, kept: 'none' };
}

export interface AlignmentPair {
  /** World-rotation offset from dragged station anchor to its stop center. */
  dOff: Vec2;
  /** World-rotation offset from target station anchor to its stop center. */
  tOff: Vec2;
  /** World unit vector along which the line through both stops runs. */
  axis: Vec2;
}

/**
 * Bullet-mode alignment pairs. The bullet has no stops of its own, so the
 * dragged-side offset is zero — it anchors at its own world position. For
 * each target station that has a stop on the chosen line, emit one pair
 * with that stop's tOff + world-frame travel direction. Line-topology
 * adjacency doesn't apply: a bullet labeling a line cares about every
 * stop on that line, not just neighbors.
 */
export function bulletAlignmentPairs(
  target: Station,
  lineId: LineId,
  lineCircles: Record<string, LineCircle>,
): AlignmentPair[] {
  const cell = target.stops.find((c) => c.lineId === lineId);
  if (!cell) return [];
  const tWorld = stopPosWorld(cell, target, lineCircles);
  return [
    {
      dOff: { x: 0, y: 0 },
      tOff: { x: tWorld.x - target.x, y: tWorld.y - target.y },
      axis: rotateBy(travelDirLocal(cell.orientation), target.rotation),
    },
  ];
}

/**
 * Snap-to-all alignment pairs. For every target stop × every dragged stop
 * (either side falls back to its anchor when it has no stops) × the four
 * world axes (horizontal,
 * vertical, and the two 45° diagonals), emit a candidate. Line membership,
 * adjacency, and stop orientation are all ignored — the user just wants to
 * snap when their stop visually lines up with anyone else's stop on a 4-axis
 * grid. The existing solver consolidates duplicates if a line-mode pair and
 * an all-mode pair happen to produce the same target+axis.
 */
const ALL_AXES: Vec2[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: SQRT2_2, y: SQRT2_2 },
  { x: SQRT2_2, y: -SQRT2_2 },
];

/**
 * The world axes a given "Snap to all" mode is allowed to align against.
 * `axis` is the direction the alignment line runs, so "horizontal" alignment
 * (two stops sharing a Y) is the {1,0} axis, "vertical" is {0,1}, and
 * "diagonal" covers both 45° families. `'off'` yields no axes.
 */
export function axesForAllSnap(mode: AllSnap): Vec2[] {
  switch (mode) {
    case 'horizontal':
      return [{ x: 1, y: 0 }];
    case 'vertical':
      return [{ x: 0, y: 1 }];
    case 'diagonal':
      return [
        { x: SQRT2_2, y: SQRT2_2 },
        { x: SQRT2_2, y: -SQRT2_2 },
      ];
    case 'all':
      return ALL_AXES;
    default:
      return [];
  }
}

/**
 * A TARGET stop's offset from its station anchor, resolved through that
 * station's frame — the ring's on a bound station, the octant otherwise (see
 * `stationFrameRad`). A snap promises "your stop will line up with THAT dot",
 * so it has to aim at where the dot actually paints. Re-deriving the offset as
 * `rotateBy(cell, rotation)` reads the octant position, which on a ring station
 * misses an outer lane by up to 5.46 world units; the dragged station then
 * lands that far off the axis, and an octolinear router with no notion of
 * "nearly aligned" has no route left to draw for a pair the user just snapped.
 *
 * Only the TARGET side goes through here. The dragged side keeps `rotateBy`:
 * unbound, that IS its frame, and bound it would be circular — the frame
 * depends on where the station lands on the ring, which is the very thing the
 * snap is solving for. A bound station's anchor is re-projected onto the rim by
 * `moveStation` afterwards regardless.
 */
function stopOffsetInFrame(
  cell: StopCell,
  station: Station,
  lineCircles: Record<string, LineCircle>,
): Vec2 {
  return stationDirToWorld(
    stopCenterAt(cell.row, cell.col),
    station,
    stationCircle(station, lineCircles),
  );
}

export function allAxesPairs(
  draggedStops: StopCell[],
  draggedRotation: Rotation,
  target: Station,
  lineCircles: Record<string, LineCircle>,
  mode: AllSnap = 'all',
): AlignmentPair[] {
  const axes = axesForAllSnap(mode);
  if (axes.length === 0) return [];
  // Either side without stops falls back to its anchor, so stopless stations
  // participate both as the dragged station and as a target.
  const dOffs: Vec2[] =
    draggedStops.length === 0
      ? [{ x: 0, y: 0 }]
      : draggedStops.map((c) => rotateBy(stopCenterAt(c.row, c.col), draggedRotation));
  const tOffs: Vec2[] =
    target.stops.length === 0
      ? [{ x: 0, y: 0 }]
      : target.stops.map((c) => stopOffsetInFrame(c, target, lineCircles));
  const out: AlignmentPair[] = [];
  for (const tOff of tOffs) {
    for (const dOff of dOffs) {
      for (const axis of axes) out.push({ dOff, tOff, axis });
    }
  }
  return out;
}

/**
 * Phase-3 along-axis refinement: equidistant + tens. Adjusts (sx, sy) along
 * `axis` to either an equidistant target (`equidistant`), or the nearest
 * multiple of the active grid size (`gridInterval`) measured from a stable
 * along-axis anchor (`tens`).
 *
 * Anchor selection for equidistant:
 *   - Interior: midpoint between same-line prev and next neighbors, when
 *     both have axis-parallel stops.
 *   - Terminus: extrapolate the line's last segment outward — on a line
 *     A-B-C-D, dragging D snaps to `C + (C - B)` along the drag axis (so
 *     D↔C matches B↔C). Mirrored for the start terminus. Requires the line
 *     to have ≥3 stations and the prev-prev/next-next stop to also be
 *     axis-parallel; a bend anywhere in the chain disables the snap.
 *   - Bullets: skipped — there's no A-B-C concept for a free-floating
 *     bullet.
 *
 * Anchor selection for tens:
 *   - Station drag: the dragged station's prev-in-line-ordering neighbor on
 *     the line. For termini at index 0, falls back to next so both ends of
 *     a line behave symmetrically.
 *   - Bullet drag: the line's first station's stop. Bullets aren't part of
 *     `line.stations`, so a stable line-anchored grid (every `gridInterval`
 *     from the start of the line) is the natural extension.
 *
 * When both modes apply, the candidate closest to the proposed position
 * wins; equidistant wins exact ties.
 *
 * Returns null if no refinement applies. Otherwise returns the refined
 * (sx, sy) plus an optional `sourceGuide` — set only when a terminus
 * equidistant candidate wins — describing the prev-prev → prev (or
 * next-next → next) segment whose cadence was extrapolated. The caller
 * rebuilds the regular alignment guides afterward and appends the source
 * guide so the user sees the matched cadence on both sides.
 */
function refineAlongAxis(args: {
  sx: number;
  sy: number;
  axis: Vec2;
  dOff: Vec2;
  draggedId: StationId | undefined;
  draggedRotation: Rotation;
  draggedStops: StopCell[];
  lines: Record<LineId, Line>;
  stationsRec: Record<StationId, Station>;
  lineCircles: Record<string, LineCircle>;
  modes: SnapModes;
  tolerance: number;
  /** Active grid size — the cadence "Snap to grid length" notches to. */
  gridInterval: number;
  /** Set in bullet mode. Selects the bullet-specific anchor logic and
   *  disables equidistant. */
  bulletLineId?: LineId;
  /** Set during Ctrl-drag (redistribute). Disables the terminus
   *  extrapolation branches of equidistant — they would otherwise fight
   *  the user's intent by pulling the terminus onto the local A↔B cadence
   *  instead of toward the chosen anchor. */
  redistributeAnchor?: StationId;
  /** Group-drag: stations moving with the grab. Already filtered out of the
   *  alignment-candidate pool by the caller; the refinement must skip them
   *  as cadence anchors too, or the snap chases moving targets. */
  excludedIds?: ReadonlySet<StationId>;
}): { sx: number; sy: number; sourceGuide?: { from: Vec2; to: Vec2 } } | null {
  const {
    sx,
    sy,
    axis,
    dOff,
    draggedId,
    draggedRotation,
    draggedStops,
    lines,
    stationsRec,
    modes,
    tolerance,
    gridInterval,
    bulletLineId,
    redistributeAnchor,
    excludedIds,
  } = args;
  if (!modes.equidistant && !modes.tens) return null;

  // A station moving with the group can't anchor a cadence.
  const anchorStationFor = (id: StationId | null | undefined): Station | null =>
    id && !excludedIds?.has(id) ? (stationsRec[id] ?? null) : null;

  const dStopX = sx + dOff.x;
  const dStopY = sy + dOff.y;

  const stopWorldFor = (
    st: Station,
    lineId: LineId,
  ): { x: number; y: number; axisOk: boolean } | null => {
    const cell = st.stops.find((c) => c.lineId === lineId);
    if (!cell) return null;
    const w = stopPosWorld(cell, st, args.lineCircles);
    const stopAxis = rotateBy(travelDirLocal(cell.orientation), st.rotation);
    return { x: w.x, y: w.y, axisOk: parallel(stopAxis, axis) };
  };

  type Refinement = {
    delta: number;
    kind: 'equidistant' | 'tens';
    /** Set only for terminus equidistant candidates — describes the
     *  prev-prev → prev (or next-next → next) segment whose cadence was
     *  extrapolated. The caller emits a second alignment guide for this
     *  segment so the user sees the matched cadence on both sides. */
    sourceGuide?: { from: Vec2; to: Vec2 };
  };
  const candidates: Refinement[] = [];

  // Bullet path: tens-only, anchored at the bound line's start stop.
  if (bulletLineId) {
    if (!modes.tens) return null;
    const line = lines[bulletLineId];
    if (!line || line.stations.length === 0) return null;
    const anchorStation = anchorStationFor(line.stations[0]);
    if (!anchorStation) return null;
    const anchor = stopWorldFor(anchorStation, bulletLineId);
    if (!anchor?.axisOk) return null;
    const dAlong = (dStopX - anchor.x) * axis.x + (dStopY - anchor.y) * axis.y;
    const tensAlong = Math.round(dAlong / gridInterval) * gridInterval;
    const delta = tensAlong - dAlong;
    if (Math.abs(delta) > tolerance) return null;
    return { sx: sx + delta * axis.x, sy: sy + delta * axis.y };
  }

  // Station path.
  if (draggedId === undefined) return null;
  for (const line of Object.values(lines)) {
    if (!line.stations.includes(draggedId)) continue;
    const dCell = draggedStops.find((c) => c.lineId === line.id);
    if (!dCell) continue;
    const lineAxis = rotateBy(travelDirLocal(dCell.orientation), draggedRotation);
    if (!parallel(lineAxis, axis)) continue;

    /**
     * The cadence neighbour of `fromId` on one side along `axis`.
     *
     * Neighbours come from the line's EDGE graph, never `line.stations` order:
     * membership order is DISPLAY ONLY since topology became an edge set, so a
     * spliced station's array neighbours are not its route neighbours and the
     * cadence would be measured against the wrong pair. Sides are decided by
     * which way along `axis` the neighbour lies, which is what prev/next mean
     * for an along-axis cadence — and stays well-defined at a branch, where the
     * nearest neighbour on that side is the one whose spacing a drag follows.
     */
    const cadenceNeighbor = (
      fromId: StationId,
      fromX: number,
      fromY: number,
      sign: 1 | -1,
      exclude: StationId | null,
    ): { id: StationId; x: number; y: number } | null => {
      let best: { id: StationId; x: number; y: number } | null = null;
      let bestDist = Infinity;
      for (const nid of neighborsOf(line, fromId)) {
        if (nid === exclude) continue;
        const st = anchorStationFor(nid);
        const s = st ? stopWorldFor(st, line.id) : null;
        if (!s?.axisOk) continue;
        const d = (s.x - fromX) * axis.x + (s.y - fromY) * axis.y;
        if (d * sign <= 0) continue;
        if (Math.abs(d) < bestDist) {
          bestDist = Math.abs(d);
          best = { id: nid, x: s.x, y: s.y };
        }
      }
      return best;
    };

    const prevStop = cadenceNeighbor(draggedId, dStopX, dStopY, -1, null);
    const nextStop = cadenceNeighbor(draggedId, dStopX, dStopY, 1, null);

    // Closure — parallels `pushGuide` in the caller. Pushes an equidistant
    // candidate iff the proposed dStop is within tolerance of (targetX,
    // targetY) measured along `axis`. `sourceGuide` is set only by the
    // terminus branches; it surfaces the cadence-source segment to the
    // caller for rendering.
    const pushEquiCandidate = (
      targetX: number,
      targetY: number,
      sourceGuide?: { from: Vec2; to: Vec2 },
    ) => {
      const along = (targetX - dStopX) * axis.x + (targetY - dStopY) * axis.y;
      if (Math.abs(along) <= tolerance) {
        candidates.push({ delta: along, kind: 'equidistant', sourceGuide });
      }
    };

    if (modes.equidistant) {
      if (prevStop && nextStop) {
        // Interior: midpoint of same-line prev/next.
        pushEquiCandidate((prevStop.x + nextStop.x) / 2, (prevStop.y + nextStop.y) / 2);
      } else if (!redistributeAnchor && !nextStop && prevStop) {
        // End terminus: extend the prev-prev → prev segment outward by its
        // along-axis length so terminus↔prev matches prev↔prev-prev.
        // Disabled during Ctrl-drag so we don't override the redistribute
        // anchor with the local A↔B cadence.
        const prevPrevStop = cadenceNeighbor(prevStop.id, prevStop.x, prevStop.y, -1, draggedId);
        if (prevPrevStop) {
          const ref =
            (prevStop.x - prevPrevStop.x) * axis.x + (prevStop.y - prevPrevStop.y) * axis.y;
          pushEquiCandidate(prevStop.x + ref * axis.x, prevStop.y + ref * axis.y, {
            from: { x: prevPrevStop.x, y: prevPrevStop.y },
            to: { x: prevStop.x, y: prevStop.y },
          });
        }
      } else if (!redistributeAnchor && !prevStop && nextStop) {
        // Start terminus: mirror of the end case. Same Ctrl-drag gate.
        const nextNextStop = cadenceNeighbor(nextStop.id, nextStop.x, nextStop.y, 1, draggedId);
        if (nextNextStop) {
          const ref =
            (nextNextStop.x - nextStop.x) * axis.x + (nextNextStop.y - nextStop.y) * axis.y;
          pushEquiCandidate(nextStop.x - ref * axis.x, nextStop.y - ref * axis.y, {
            from: { x: nextNextStop.x, y: nextNextStop.y },
            to: { x: nextStop.x, y: nextStop.y },
          });
        }
      }
    }

    if (modes.tens) {
      // Prefer the prev neighbor; fall back to next so termini at index 0
      // still get a tens anchor. Either side defines the same grid-length
      // cadence along the axis (a whole multiple of the active grid size —
      // gridInterval, 5/10/20 — just shifted by the segment length).
      const tensAnchor = prevStop ?? nextStop;
      if (tensAnchor) {
        const dAlong = (dStopX - tensAnchor.x) * axis.x + (dStopY - tensAnchor.y) * axis.y;
        const tensAlong = Math.round(dAlong / gridInterval) * gridInterval;
        const delta = tensAlong - dAlong;
        if (Math.abs(delta) <= tolerance) {
          candidates.push({ delta, kind: 'tens' });
        }
      }
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const da = Math.abs(a.delta);
    const db = Math.abs(b.delta);
    if (Math.abs(da - db) < 1e-6) {
      // Tie: equidistant wins.
      if (a.kind === b.kind) return 0;
      return a.kind === 'equidistant' ? -1 : 1;
    }
    return da - db;
  });

  const chosen = candidates[0];
  return {
    sx: sx + chosen.delta * axis.x,
    sy: sy + chosen.delta * axis.y,
    sourceGuide: chosen.sourceGuide,
  };
}

/**
 * Build alignment pairs between the dragged station and a target. For
 * shared-line pairs the axis is the world travel direction at that stop —
 * derived from per-stop orientation rotated by station rotation. A pair is
 * only emitted when (1) the two stops share a world axis (parallel travel
 * directions) and (2) the target is line-adjacent to the dragged station on
 * that line — i.e. the two stations are consecutive in `line.stations`.
 * Filtering by adjacency keeps the snap focused on a station's actual
 * neighbors instead of latching onto stations further along the same axis.
 *
 * When neither station has stops, fall back to anchor-to-anchor on the
 * dragged station's rotation axis (no line topology to consult).
 */
export function alignmentPairs(
  draggedId: StationId,
  draggedRotation: Rotation,
  draggedStops: StopCell[],
  target: Station,
  lines: Record<LineId, Line>,
  lineCircles: Record<string, LineCircle>,
  // When false, skip the line-adjacency check and emit a pair on every
  // shared line where the travel directions are parallel. Used by the
  // Ctrl-drag (redistribute) snap path to align with a non-adjacent anchor.
  requireAdjacency: boolean = true,
): AlignmentPair[] {
  if (draggedStops.length === 0 && target.stops.length === 0) {
    return [{ dOff: { x: 0, y: 0 }, tOff: { x: 0, y: 0 }, axis: axisForRotation(draggedRotation) }];
  }
  const out: AlignmentPair[] = [];
  for (const dCell of draggedStops) {
    const tCell = target.stops.find((c) => c.lineId === dCell.lineId);
    if (!tCell) continue;
    const line = lines[dCell.lineId];
    if (!line) continue;
    if (requireAdjacency) {
      // Aligned only when the two stations share a direct track segment. Reads
      // the edge set, so a loop's wrap corridor and a branch's legs count too
      // (identical to array-adjacency for a plain linear line).
      if (!lineHasEdge(line, draggedId, target.id)) continue;
    } else {
      // Still require both stations to be on the line.
      if (!line.stations.includes(draggedId) || !line.stations.includes(target.id)) continue;
    }
    const dWorldDir = rotateBy(travelDirLocal(dCell.orientation), draggedRotation);
    const tWorldDir = rotateBy(travelDirLocal(tCell.orientation), target.rotation);
    if (!parallel(dWorldDir, tWorldDir)) continue;
    const dOff: Vec2 = rotateBy(stopCenterAt(dCell.row, dCell.col), draggedRotation);
    const tOff: Vec2 = stopOffsetInFrame(tCell, target, lineCircles);
    out.push({ dOff, tOff, axis: dWorldDir });
  }
  return out;
}
