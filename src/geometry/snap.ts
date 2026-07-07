import type { Line, LineId, Station, StationId, StopCell } from '../model/types';
import type { Vec2 } from './vec';
import { cross, SQRT2_2 } from './vec';
import { rotateBy, stopCenterAt, travelDirLocal } from './orientation';
import type { Rotation } from './orientation';
import { stopPosWorld } from './interlining';

/**
 * Default perpendicular tolerance for engaging a snap, in world units — this is
 * the value at zoom 1. Drag handlers pass `SNAP_PERP_TOLERANCE / zoom` so the
 * engage radius stays constant in *screen* pixels: zooming in shrinks the
 * world-space radius, allowing finer positioning before a snap takes effect.
 */
export const SNAP_PERP_TOLERANCE = 10;

/**
 * Tighter tolerance used to detect a *third* station that is also already
 * aligned with the primary snap axis. Shows the in-line opposite-direction
 * indicator without claiming the third station as another snap target.
 */
export const TIGHT_PERP_TOLERANCE = 0.5;

/** "Snap to 10's" interval, in world units. */
export const TENS_INTERVAL = 10;

/** Default "snap to grid" cell size, in world units. The toolbar cycles the
 *  active size through 5, 10, and 20 and threads it into the snap calls. */
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
 * Grid-snap a text label registered by its upper-left bbox corner.
 *
 * Labels are positioned by their bbox center (label.x, label.y) — but for
 * grid snapping the natural reference point is the visual upper-left, so
 * each label's top edge lands on a grid row and its left edge on a grid
 * column. Returns the new center such that center − (width/2, height/2)
 * is grid-aligned. Rotation is ignored (the upper-left is taken in the
 * label's unrotated local frame).
 */
export function snapLabelToGrid(
  center: { x: number; y: number },
  width: number,
  height: number,
  mode: GridSnap = 'both',
  gridInterval: number = GRID_INTERVAL,
): { x: number; y: number } {
  const halfW = width / 2;
  const halfH = height / 2;
  const ul = snapPointToGrid(center.x - halfW, center.y - halfH, mode, gridInterval);
  return { x: ul.x + halfW, y: ul.y + halfH };
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
  /** Along the line axis, snap the dragged stop to a multiple of TENS_INTERVAL
   *  measured from the prev-in-line-ordering neighbor. Gated on `line`. */
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
}

export const DEFAULT_SNAP_MODES: SnapModes = {
  line: true,
  equidistant: false,
  tens: false,
  all: 'off',
  grid: 'off',
};

export interface SnapGuide {
  from: Vec2;
  to: Vec2;
  /** Optional label to render above the guide. Used for the per-drag
   *  measurement readout: distance for a regular snap, station-to-station
   *  spacing for a Ctrl-drag. */
  label?: string;
}

export interface SnapResult {
  x: number;
  y: number;
  guides: SnapGuide[];
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
  /** World-units perpendicular tolerance for engaging a snap. */
  tolerance?: number;
  /** Ctrl-drag (redistribute) mode: snap exclusively to this station. The
   *  intermediates between dragged and anchor are moving targets during the
   *  redistribute and make poor snap candidates; the anchor is the single
   *  fixed point on the line. Adjacency on each shared line is bypassed
   *  here — the anchor qualifies regardless of how many stops sit between. */
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
    excludedIds,
    tolerance = SNAP_PERP_TOLERANCE,
    redistributeAnchor,
    bulletLineId,
    modes = DEFAULT_SNAP_MODES,
    gridInterval = GRID_INTERVAL,
  } = input;

  type Cand = {
    target: Station;
    dOff: Vec2;
    tOff: Vec2;
    axis: Vec2;
    perpDist: number;
    targetStopX: number;
    targetStopY: number;
    /** Which snap mode produced this candidate. Used to gate the phase-3
     *  along-axis refinement (only fires when the primary came from line). */
    kind: 'line' | 'all';
  };

  // Collect every alignment pair within perp tolerance.
  const all: Cand[] = [];
  // Pick the right pool of target stations for the active mode.
  const excluded = excludedIds;
  const targets = bulletLineId
    ? Object.values(stations).filter((t) => !excluded || !excluded.has(t.id))
    : redistributeAnchor
      ? stations[redistributeAnchor]
        ? [stations[redistributeAnchor]]
        : []
      : Object.values(stations).filter(
          (t) => t.id !== draggedId && (!excluded || !excluded.has(t.id)),
        );
  const requireAdjacency = !redistributeAnchor;
  // Redistribute (Ctrl-drag) is treated like a line-mode operation regardless
  // of the user's `modes.line` toggle — it's an explicit, modal interaction.
  const lineModeOn = modes.line || !!redistributeAnchor;
  const allModeOn = modes.all !== 'off' && !redistributeAnchor;
  for (const t of targets) {
    const linePairs: AlignmentPair[] = lineModeOn
      ? bulletLineId
        ? bulletAlignmentPairs(t, bulletLineId)
        : alignmentPairs(
            draggedId as StationId,
            draggedRotation as Rotation,
            draggedStops ?? [],
            t,
            lines,
            requireAdjacency,
          )
      : [];
    const allPairs: AlignmentPair[] = allModeOn
      ? allAxesPairs(draggedStops ?? [], (draggedRotation ?? 0) as Rotation, t, modes.all)
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
      (grp) => grp[0].target.id === c.target.id && parallel(grp[0].axis, c.axis),
    );
    if (g) g.push(c);
    else targetAxisGroups.push([c]);
  }
  const consolidated: Cand[] = targetAxisGroups.map((g) => {
    // If any candidate in this target+axis group came from line mode,
    // preserve the 'line' tag on the consolidated candidate — phase 3
    // refinement only fires off line-mode primaries.
    const kind: 'line' | 'all' = g.some((c) => c.kind === 'line') ? 'line' : 'all';
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
  const distFromBullet = (c: Cand) =>
    Math.hypot(proposedX - c.targetStopX, proposedY - c.targetStopY);
  const bests = groups.map((g) =>
    g.reduce((a, b) => (distFromBullet(a) <= distFromBullet(b) ? a : b)),
  );
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
      modes,
      tolerance,
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
  const spacingDivisor = (() => {
    if (!redistributeAnchor) return 0;
    let segments = 0;
    if (!draggedId) return 0;
    for (const line of Object.values(lines)) {
      const dIdx = line.stations.indexOf(draggedId);
      const tIdx = line.stations.indexOf(redistributeAnchor);
      if (dIdx < 0 || tIdx < 0) continue;
      const dCell = (draggedStops ?? []).find((c) => c.lineId === line.id);
      if (!dCell) continue;
      const lineAxis = rotateBy(
        travelDirLocal(dCell.orientation),
        (draggedRotation ?? 0) as Rotation,
      );
      if (!parallel(lineAxis, primary.axis)) continue;
      segments = Math.max(segments, Math.abs(dIdx - tIdx));
    }
    return segments;
  })();

  const labelFor = (from: Vec2, to: Vec2, isAnchor: boolean): string => {
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    if (isAnchor && spacingDivisor > 0) {
      return Math.round(dist / spacingDivisor).toString();
    }
    return Math.round(dist).toString();
  };

  // Build guides for every active axis (so the user sees that both snaps
  // are engaged on a perpendicular transfer station, etc.).
  const guides: SnapGuide[] = [];
  const pushGuide = (c: Cand) => {
    const from = { x: sx + c.dOff.x, y: sy + c.dOff.y };
    const to = { x: c.targetStopX, y: c.targetStopY };
    const isAnchor = !!redistributeAnchor && c.target.id === redistributeAnchor;
    guides.push({ from, to, label: labelFor(from, to, isAnchor) });
  };
  pushGuide(primary);
  if (secondary) pushGuide(secondary);

  // Same-axis opposite-direction tight neighbor (the in-line third-station
  // indicator). Emitted per active axis; does nothing when no third station
  // is already aligned.
  const addOppositeGuide = (c: Cand) => {
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
      if (o.target.id === c.target.id) continue;
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
export function bulletAlignmentPairs(target: Station, lineId: LineId): AlignmentPair[] {
  const cell = target.stops.find((c) => c.lineId === lineId);
  if (!cell) return [];
  const tWorld = stopPosWorld(cell, target);
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

export function allAxesPairs(
  draggedStops: StopCell[],
  draggedRotation: Rotation,
  target: Station,
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
      : target.stops.map((c) => rotateBy(stopCenterAt(c.row, c.col), target.rotation));
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
 * multiple of `TENS_INTERVAL` measured from a stable along-axis anchor
 * (`tens`).
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
 *     `line.stations`, so a stable line-anchored grid (every 10 from the
 *     start of the line) is the natural extension.
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
  modes: SnapModes;
  tolerance: number;
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
    const w = stopPosWorld(cell, st);
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
    const tensAlong = Math.round(dAlong / TENS_INTERVAL) * TENS_INTERVAL;
    const delta = tensAlong - dAlong;
    if (Math.abs(delta) > tolerance) return null;
    return { sx: sx + delta * axis.x, sy: sy + delta * axis.y };
  }

  // Station path.
  if (draggedId === undefined) return null;
  for (const line of Object.values(lines)) {
    const dIdx = line.stations.indexOf(draggedId);
    if (dIdx < 0) continue;
    const dCell = draggedStops.find((c) => c.lineId === line.id);
    if (!dCell) continue;
    const lineAxis = rotateBy(travelDirLocal(dCell.orientation), draggedRotation);
    if (!parallel(lineAxis, axis)) continue;

    const prevId = dIdx > 0 ? line.stations[dIdx - 1] : null;
    const nextId = dIdx < line.stations.length - 1 ? line.stations[dIdx + 1] : null;
    const prev = anchorStationFor(prevId);
    const next = anchorStationFor(nextId);
    const prevStop = prev ? stopWorldFor(prev, line.id) : null;
    const nextStop = next ? stopWorldFor(next, line.id) : null;

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
      if (prevStop?.axisOk && nextStop?.axisOk) {
        // Interior: midpoint of same-line prev/next.
        pushEquiCandidate((prevStop.x + nextStop.x) / 2, (prevStop.y + nextStop.y) / 2);
      } else if (!redistributeAnchor && nextId === null && prevStop?.axisOk && dIdx >= 2) {
        // End terminus: extend the prev-prev → prev segment outward by its
        // along-axis length so terminus↔prev matches prev↔prev-prev.
        // Disabled during Ctrl-drag so we don't override the redistribute
        // anchor with the local A↔B cadence.
        const prevPrev = anchorStationFor(line.stations[dIdx - 2]);
        const prevPrevStop = prevPrev ? stopWorldFor(prevPrev, line.id) : null;
        if (prevPrevStop?.axisOk) {
          const ref =
            (prevStop.x - prevPrevStop.x) * axis.x + (prevStop.y - prevPrevStop.y) * axis.y;
          pushEquiCandidate(prevStop.x + ref * axis.x, prevStop.y + ref * axis.y, {
            from: { x: prevPrevStop.x, y: prevPrevStop.y },
            to: { x: prevStop.x, y: prevStop.y },
          });
        }
      } else if (
        !redistributeAnchor &&
        prevId === null &&
        nextStop?.axisOk &&
        dIdx + 2 < line.stations.length
      ) {
        // Start terminus: mirror of the end case. Same Ctrl-drag gate.
        const nextNext = anchorStationFor(line.stations[dIdx + 2]);
        const nextNextStop = nextNext ? stopWorldFor(nextNext, line.id) : null;
        if (nextNextStop?.axisOk) {
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
      // still get a tens anchor. Either side defines the same multiple-of-
      // 10 grid along the axis (just shifted by the segment length).
      const tensAnchor = prevStop?.axisOk ? prevStop : nextStop?.axisOk ? nextStop : null;
      if (tensAnchor) {
        const dAlong = (dStopX - tensAnchor.x) * axis.x + (dStopY - tensAnchor.y) * axis.y;
        const tensAlong = Math.round(dAlong / TENS_INTERVAL) * TENS_INTERVAL;
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
      const dIdx = line.stations.indexOf(draggedId);
      const tIdx = line.stations.indexOf(target.id);
      if (dIdx < 0 || tIdx < 0 || Math.abs(dIdx - tIdx) !== 1) continue;
    } else {
      // Still require both stations to be on the line.
      if (!line.stations.includes(draggedId) || !line.stations.includes(target.id)) continue;
    }
    const dWorldDir = rotateBy(travelDirLocal(dCell.orientation), draggedRotation);
    const tWorldDir = rotateBy(travelDirLocal(tCell.orientation), target.rotation);
    if (!parallel(dWorldDir, tWorldDir)) continue;
    const dOff: Vec2 = rotateBy(stopCenterAt(dCell.row, dCell.col), draggedRotation);
    const tOff: Vec2 = rotateBy(stopCenterAt(tCell.row, tCell.col), target.rotation);
    out.push({ dOff, tOff, axis: dWorldDir });
  }
  return out;
}
