import type { Vec2 } from './vec';
import { add, scale, sub, dot, cross } from './vec';
import {
  axesForAllSnap,
  snapPointToGrid,
  SNAP_PERP_TOLERANCE,
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
 * smaller displacement wins. An explicit alignment overrides grid (so the user
 * never sees grid fighting an alignment); grid only applies when nothing aligns.
 * Pure — no React, no DOM.
 */
export function snapPolygonPoint(input: PolygonSnapInput): PolygonSnapResult {
  const { proposed, lineTargets, allTargets, modes } = input;
  const tol = input.tolerance ?? SNAP_PERP_TOLERANCE;

  const candidates: Candidate[] = [];
  if (modes.line) {
    for (const t of lineTargets) for (const axis of ALL_AXES) candidates.push({ target: t, axis });
  }
  if (modes.all !== 'off') {
    const axes = axesForAllSnap(modes.all);
    for (const t of allTargets) for (const axis of axes) candidates.push({ target: t, axis });
  }

  // Best vertical (snaps X), best horizontal (snaps Y), best diagonal (projects).
  let bestV: { value: number; perp: number; target: Vec2 } | null = null;
  let bestH: { value: number; perp: number; target: Vec2 } | null = null;
  let bestD: { foot: Vec2; perp: number; target: Vec2 } | null = null;

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
      bestD = { foot, perp: perpDist, target };
    }
  }

  // A corner — both X and Y lock onto a target — is the strongest snap: take it
  // outright (snapping to the V×H intersection), even over a diagonal that
  // happens to pass through the proposed point with zero displacement.
  if (bestV && bestH) {
    const p: Vec2 = { x: bestV.value, y: bestH.value };
    return {
      x: p.x,
      y: p.y,
      guides: [
        { from: { ...bestV.target }, to: { ...p } },
        { from: { ...bestH.target }, to: { ...p } },
      ],
    };
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
      return {
        x: combo.x,
        y: combo.y,
        guides: [{ from: { ...singleAxis.target }, to: { ...combo } }],
      };
    }
  }
  if (bestD) {
    return {
      x: bestD.foot.x,
      y: bestD.foot.y,
      guides: [{ from: { ...bestD.target }, to: { ...bestD.foot } }],
    };
  }

  // No alignment engaged — grid is the only thing that can move the point.
  if (modes.grid !== 'off') {
    const g = snapPointToGrid(proposed.x, proposed.y, modes.grid);
    return { x: g.x, y: g.y, guides: [] };
  }
  return { x: proposed.x, y: proposed.y, guides: [] };
}
