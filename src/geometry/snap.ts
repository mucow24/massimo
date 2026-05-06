import type { Line, LineId, Station, StationId, StopCell } from '../model/types';
import type { Vec2 } from './vec';
import { rotateBy, stopCenterAt, travelDirLocal } from './orientation';
import type { Rotation } from './orientation';

const SQRT2_2 = Math.SQRT2 / 2;

/** Default perpendicular tolerance for engaging a snap, in world units. */
export const SNAP_PERP_TOLERANCE = 10;

/**
 * Tighter tolerance used to detect a *third* station that is also already
 * aligned with the primary snap axis. Shows the in-line opposite-direction
 * indicator without claiming the third station as another snap target.
 */
export const TIGHT_PERP_TOLERANCE = 0.5;

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
}

/**
 * Compute the snapped world position for a dragged station, plus any guides
 * to render. Pure function — no React, no DOM.
 *
 * Single-axis snap: the dragged station's stop is projected onto the target's
 * axis line. Two-axis snap (e.g. dragging onto a transfer station): solves a
 * 2x2 system to put the drag at the unique intersection of two non-parallel
 * axes. Multiple lines that share a target+axis (interlined bands) are
 * consolidated to a single snap candidate using their mean offset, so the
 * user feels one band-wide click instead of N individual line clicks.
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
    tolerance = SNAP_PERP_TOLERANCE,
    redistributeAnchor,
    bulletLineId,
  } = input;

  type Cand = {
    target: Station;
    dOff: Vec2;
    tOff: Vec2;
    axis: Vec2;
    perpDist: number;
    targetStopX: number;
    targetStopY: number;
  };

  // Collect every alignment pair within perp tolerance.
  const all: Cand[] = [];
  // Pick the right pool of target stations for the active mode.
  const targets = bulletLineId
    ? Object.values(stations)
    : redistributeAnchor
      ? stations[redistributeAnchor]
        ? [stations[redistributeAnchor]]
        : []
      : Object.values(stations).filter((t) => t.id !== draggedId);
  const requireAdjacency = !redistributeAnchor;
  for (const t of targets) {
    const pairs = bulletLineId
      ? bulletAlignmentPairs(t, bulletLineId)
      : alignmentPairs(
          draggedId as StationId,
          draggedRotation as Rotation,
          draggedStops ?? [],
          t,
          lines,
          requireAdjacency,
        );
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
      });
    }
  }

  if (all.length === 0) {
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
    if (g.length === 1) return g[0];
    const axis = g[0].axis;
    const perpX = -axis.y;
    const perpY = axis.x;
    const sorted = [...g].sort(
      (a, b) =>
        a.dOff.x * perpX + a.dOff.y * perpY - (b.dOff.x * perpX + b.dOff.y * perpY),
    );
    return sorted[Math.floor((sorted.length - 1) / 2)];
  });

  // Group consolidated candidates by axis (parallel) and keep best per group.
  const groups: Cand[][] = [];
  for (const c of consolidated) {
    const g = groups.find((grp) => parallel(grp[0].axis, c.axis));
    if (g) g.push(c);
    else groups.push([c]);
  }
  // Pick the closest stop per axis. Primary criterion is perpendicular
  // distance (smaller = better-aligned). When perpDists tie — bullet snap
  // against a chain of collinear stops, for instance — break the tie by
  // total distance so the nearest station along the axis becomes primary
  // and the further ones fall to addOppositeGuide.
  const distFromBullet = (c: Cand) =>
    Math.hypot(proposedX - c.targetStopX, proposedY - c.targetStopY);
  const bests = groups.map((g) =>
    g.reduce((a, b) => {
      if (a.perpDist !== b.perpDist) return a.perpDist <= b.perpDist ? a : b;
      return distFromBullet(a) <= distFromBullet(b) ? a : b;
    }),
  );
  bests.sort((a, b) => a.perpDist - b.perpDist);

  const primary = bests[0];
  // Find a non-parallel secondary (so the two constraints solve uniquely).
  let secondary: Cand | null = null;
  for (let i = 1; i < bests.length; i++) {
    const cz = primary.axis.x * bests[i].axis.y - primary.axis.y * bests[i].axis.x;
    if (Math.abs(cz) > 0.1) {
      secondary = bests[i];
      break;
    }
  }

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
  } else {
    // Single-axis snap: project the dragged stop onto the primary's axis
    // line through its target stop.
    const c = primary;
    const proposedDStopX = proposedX + c.dOff.x;
    const proposedDStopY = proposedY + c.dOff.y;
    const dxp = proposedDStopX - c.targetStopX;
    const dyp = proposedDStopY - c.targetStopY;
    const along = dxp * c.axis.x + dyp * c.axis.y;
    const snappedDStopX = c.targetStopX + along * c.axis.x;
    const snappedDStopY = c.targetStopY + along * c.axis.y;
    sx = snappedDStopX - c.dOff.x;
    sy = snappedDStopY - c.dOff.y;
  }

  // Compute the per-station spacing for the Ctrl-drag readout. We use the
  // shared line where the dragged and anchor are furthest apart (most
  // intermediates → tightest spacing), divided into the guide's distance.
  const spacingDivisor = (() => {
    if (!redistributeAnchor) return 0;
    let segments = 0;
    if (!draggedId) return 0;
    for (const line of Object.values(lines)) {
      const dIdx = line.stations.indexOf(draggedId);
      const tIdx = line.stations.indexOf(redistributeAnchor);
      if (dIdx < 0 || tIdx < 0) continue;
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
    const oppositeSign = -Math.sign(primaryAlong) || 0;
    if (oppositeSign === 0) return;
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
  return Math.abs(a.x * b.y - a.y * b.x) < 1e-3;
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
  return [
    {
      dOff: { x: 0, y: 0 },
      tOff: rotateBy(stopCenterAt(cell.row, cell.col), target.rotation),
      axis: rotateBy(travelDirLocal(cell.orientation), target.rotation),
    },
  ];
}

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
    out.push({
      dOff: rotateBy(stopCenterAt(dCell.row, dCell.col), draggedRotation),
      tOff: rotateBy(stopCenterAt(tCell.row, tCell.col), target.rotation),
      axis: dWorldDir,
    });
  }
  return out;
}
