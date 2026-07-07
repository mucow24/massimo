import type { Vec2 } from './vec';
import { add, scale, sub, dot, cross } from './vec';
import {
  axesForAllSnap,
  GRID_INTERVAL,
  reconcileCorner,
  reconcileLockWithGrid,
  snapPointToGrid,
  SNAP_PERP_TOLERANCE,
  type GridSnap,
  type SnapGuide,
  type SnapModes,
} from './snap';

export interface PolygonSnapInput {
  /** The point being dragged — a vertex, or a whole-polygon's snap anchor. */
  proposed: Vec2;
  /** Targets for "Snap to line": the current polygon's other vertices. Aligned
   *  along all four axis families (horizontal, vertical, both diagonals). */
  lineTargets: Vec2[];
  /** Targets for "Snap to all": every station stop-center + every polygon
   *  vertex (assembled by the caller). Aligned along `axesForAllSnap(modes.all)`. */
  allTargets: Vec2[];
  modes: SnapModes;
  /** Perpendicular tolerance in world units. Defaults to {@link SNAP_PERP_TOLERANCE}. */
  tolerance?: number;
  /** Grid cell size in world units. Defaults to {@link GRID_INTERVAL} (10); the
   *  toolbar threads the active size (5, 10, or 20). */
  gridInterval?: number;
  /** Single-DOF consumers (edge resizes): only snaps that move this world
   *  axis are considered — vertical alignments + X grid for 'x', horizontal
   *  alignments + Y grid for 'y'; diagonals are excluded. Prevents guides
   *  for snaps the caller would discard. */
  constrain?: 'x' | 'y';
}

export interface PolygonSnapResult {
  x: number;
  y: number;
  guides: SnapGuide[];
}

// All four axis directions (unit vectors): horizontal, vertical, and the two
// 45° diagonals. Used for "Snap to line" (current polygon only).
const ALL_AXES = axesForAllSnap('all');

type Candidate = { target: Vec2; axis: Vec2 };

// Project P onto the line through `t` with unit direction `a`; return the foot
// and the perpendicular distance.
function projectOntoAxis(p: Vec2, t: Vec2, a: Vec2): { foot: Vec2; perpDist: number } {
  const rel = sub(p, t);
  const foot = add(t, scale(a, dot(rel, a)));
  return { foot, perpDist: Math.abs(cross(rel, a)) };
}

/**
 * Snap a polygon point (a dragged vertex, or a whole-polygon drag anchor) to
 * its targets along the active snap axes, then to the grid.
 *
 * Decomposed — no 2×2 solver: a *vertical* axis snaps X, a *horizontal* axis
 * snaps Y (the two compose into a corner snap for free), and a *diagonal* axis
 * projects onto the ±45° line. When a diagonal competes with the V/H combo, the
 * smaller displacement wins. Grid is a **hard constraint**: when on, the result
 * is always on the grid, and a chosen alignment engages only when it can be
 * reconciled with the grid (otherwise it yields to a plain grid snap, no guide)
 * — see {@link reconcileLockWithGrid}/{@link reconcileCorner}. Pure — no React,
 * no DOM.
 */
export function snapPolygonPoint(input: PolygonSnapInput): PolygonSnapResult {
  const { proposed, lineTargets, allTargets, modes, constrain } = input;
  const tol = input.tolerance ?? SNAP_PERP_TOLERANCE;
  const gridInterval = input.gridInterval ?? GRID_INTERVAL;

  // Single-DOF constraint: a vertical alignment axis locks X, a horizontal
  // one locks Y; diagonals move both, so a constrained caller gets neither.
  const axisAllowed = (a: Vec2): boolean =>
    !constrain || (constrain === 'x' ? a.x === 0 : a.y === 0);
  // Grid narrows to the constrained axis the same way ('x' keeps vertical
  // grid lines, which lock X).
  const gridMode: GridSnap = !constrain
    ? modes.grid
    : constrain === 'x'
      ? modes.grid === 'both' || modes.grid === 'vertical'
        ? 'vertical'
        : 'off'
      : modes.grid === 'both' || modes.grid === 'horizontal'
        ? 'horizontal'
        : 'off';

  const candidates: Candidate[] = [];
  if (modes.line) {
    for (const t of lineTargets)
      for (const axis of ALL_AXES) if (axisAllowed(axis)) candidates.push({ target: t, axis });
  }
  if (modes.all !== 'off') {
    const axes = axesForAllSnap(modes.all).filter(axisAllowed);
    for (const t of allTargets) for (const axis of axes) candidates.push({ target: t, axis });
  }

  // Best vertical (snaps X), best horizontal (snaps Y), best diagonal (projects).
  let bestV: { value: number; perp: number; target: Vec2 } | null = null;
  let bestH: { value: number; perp: number; target: Vec2 } | null = null;
  let bestD: { foot: Vec2; perp: number; target: Vec2; axis: Vec2 } | null = null;

  for (const { target, axis } of candidates) {
    const { foot, perpDist } = projectOntoAxis(proposed, target, axis);
    if (perpDist > tol) continue;
    if (axis.x === 0) {
      // vertical line -> aligns X
      const d = Math.abs(proposed.x - target.x);
      if (!bestV || d < bestV.perp) bestV = { value: target.x, perp: d, target };
    } else if (axis.y === 0) {
      // horizontal line -> aligns Y
      const d = Math.abs(proposed.y - target.y);
      if (!bestH || d < bestH.perp) bestH = { value: target.y, perp: d, target };
    } else if (!bestD || perpDist < bestD.perp) {
      bestD = { foot, perp: perpDist, target, axis };
    }
  }

  const gridOn = gridMode !== 'off';
  // Grid is a hard constraint: when an alignment can't be reconciled with the
  // grid it yields entirely and we snap purely to grid (no guide).
  const plainGrid = (): PolygonSnapResult => {
    if (!gridOn) return { x: proposed.x, y: proposed.y, guides: [] };
    const g = snapPointToGrid(proposed.x, proposed.y, gridMode, gridInterval);
    return { x: g.x, y: g.y, guides: [] };
  };
  // Same rounded-distance readout as the station engine's guides, so every
  // alignment guide in the app carries a measurement label.
  const guideTo = (target: Vec2, p: Vec2): SnapGuide => ({
    from: { ...target },
    to: { ...p },
    label: Math.round(Math.hypot(p.x - target.x, p.y - target.y)).toString(),
  });

  // A corner — both X and Y lock onto a target — is the strongest snap: take it
  // outright (snapping to the V×H intersection), even over a diagonal that
  // happens to pass through the proposed point with zero displacement.
  if (bestV && bestH) {
    const cornerX = bestV.value;
    const cornerY = bestH.value;
    if (!gridOn) {
      const p: Vec2 = { x: cornerX, y: cornerY };
      return { x: p.x, y: p.y, guides: [guideTo(bestV.target, p), guideTo(bestH.target, p)] };
    }
    // Reconcile the corner with the grid. V is a vertical lock (perp X), H a
    // horizontal lock (perp Y); prefer the better-aligned axis as primary.
    const vIsPrimary = bestV.perp <= bestH.perp;
    const vLock = { q: { x: cornerX, y: proposed.y }, axis: { x: 0, y: 1 } };
    const hLock = { q: { x: proposed.x, y: cornerY }, axis: { x: 1, y: 0 } };
    const r = reconcileCorner(
      cornerX,
      cornerY,
      vIsPrimary ? vLock : hLock,
      vIsPrimary ? hLock : vLock,
      proposed,
      gridMode,
      gridInterval,
    );
    if (r.kept === 'none') return plainGrid();
    const p: Vec2 = { x: r.x, y: r.y };
    if (r.kept === 'both') {
      return { x: p.x, y: p.y, guides: [guideTo(bestV.target, p), guideTo(bestH.target, p)] };
    }
    const keptIsV = r.kept === 'primary' ? vIsPrimary : !vIsPrimary;
    return { x: p.x, y: p.y, guides: [guideTo(keptIsV ? bestV.target : bestH.target, p)] };
  }

  // Single-axis alignment vs. a diagonal: the smaller displacement wins.
  const singleAxis = bestV ?? bestH;
  if (singleAxis) {
    const combo: Vec2 = {
      x: bestV ? bestV.value : proposed.x,
      y: bestH ? bestH.value : proposed.y,
    };
    const comboDisp = Math.hypot(combo.x - proposed.x, combo.y - proposed.y);
    if (!bestD || comboDisp <= bestD.perp) {
      if (!gridOn) {
        return { x: combo.x, y: combo.y, guides: [guideTo(singleAxis.target, combo)] };
      }
      const lock = bestV
        ? { q: { x: bestV.value, y: proposed.y }, axis: { x: 0, y: 1 } }
        : { q: { x: proposed.x, y: bestH!.value }, axis: { x: 1, y: 0 } };
      const r = reconcileLockWithGrid(lock.q, lock.axis, proposed, gridMode, gridInterval);
      if (!r.engaged) return plainGrid();
      const p: Vec2 = { x: r.x, y: r.y };
      return { x: p.x, y: p.y, guides: [guideTo(singleAxis.target, p)] };
    }
  }
  if (bestD) {
    if (!gridOn) {
      return { x: bestD.foot.x, y: bestD.foot.y, guides: [guideTo(bestD.target, bestD.foot)] };
    }
    const r = reconcileLockWithGrid(bestD.target, bestD.axis, proposed, gridMode, gridInterval);
    if (!r.engaged) return plainGrid();
    const p: Vec2 = { x: r.x, y: r.y };
    return { x: p.x, y: p.y, guides: [guideTo(bestD.target, p)] };
  }

  // No alignment engaged — grid is the only thing that can move the point.
  return plainGrid();
}
