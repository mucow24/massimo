// Pure helpers and constants for the stop/label lattice editing logic — kept
// out of the components so they can be unit-tested without React Testing
// Library, and consumed by Playwright e2e helpers without pulling in React.
// Shared by the StopGrid mini-canvas, the keyboard nudge (App.tsx), and the
// on-canvas station editing overlays.
import {
  latticeOffsets,
  projectScreenToLocal,
  sameCell,
  CELL_EPS,
  type LatticeBasis,
  type RowCol,
} from '../../geometry/lattice';
import { rotateBy, tangentGap, STOP_SIZE, type Rotation } from '../../geometry/orientation';
export { sameCell, CELL_EPS } from '../../geometry/lattice';

/** Inspector-local pixels per unit in row/col space. A default-width node's
 *  circle radius = PITCH/2, so two default-width nodes at unit distance are
 *  tangent in the editor; non-default-width nodes scale their radius (and
 *  their tangency distance) by width/STOP_SIZE. */
export const PITCH = 22;

const dist = (a: RowCol, b: RowCol): number => Math.hypot(a.row - b.row, a.col - b.col);

/** Closest node to the cursor by Euclidean distance in (row, col) space.
 *  Returns null for an empty input. */
export function nearestNode<T extends RowCol>(cursor: RowCol, nodes: readonly T[]): T | null {
  let best: T | null = null;
  let bestDist = Infinity;
  for (const n of nodes) {
    const d = dist(cursor, n);
    if (d < bestDist) {
      bestDist = d;
      best = n;
    }
  }
  return best;
}

export type DragSourceKind = 'stop' | 'label';
export type DropTarget =
  | { kind: 'ghost'; row: number; col: number }
  | { kind: 'stop'; row: number; col: number; lineId: string };

export interface DropOptions {
  /** Cursor distance below which a non-source stop becomes a swap target. */
  swapRadius: number;
  /** Cursor distance below which the nearest ghost becomes the snap target. */
  snapRadius: number;
  /**
   * Per-stop override of `swapRadius` — a wide line's node draws bigger in
   * the editor, so "physically on the circle" scales with it. Falls back to
   * the flat `swapRadius` when absent.
   */
  swapRadiusFor?: (stop: RowCol & { lineId: string }) => number;
}

/**
 * Two-tier snap rule:
 *
 *   1. If the source is a stop and the cursor lies INSIDE a non-source
 *      stop's circle (distance < its swap radius), that stop wins as a swap
 *      target. Labels never swap.
 *   2. Otherwise, the nearest ghost within snapRadius wins.
 *   3. Otherwise, no target.
 */
export function findDropTarget<S extends RowCol & { lineId: string }>(
  cursor: RowCol,
  source: { kind: DragSourceKind; lineId?: string },
  stops: readonly S[],
  ghosts: readonly RowCol[],
  opts: DropOptions,
): DropTarget | null {
  if (source.kind === 'stop') {
    for (const s of stops) {
      if (s.lineId === source.lineId) continue;
      if (dist(cursor, s) < (opts.swapRadiusFor?.(s) ?? opts.swapRadius)) {
        return { kind: 'stop', row: s.row, col: s.col, lineId: s.lineId };
      }
    }
  }
  const nearest = nearestNode(cursor, ghosts);
  if (!nearest) return null;
  if (dist(cursor, nearest) >= opts.snapRadius) return null;
  return { kind: 'ghost', row: nearest.row, col: nearest.col };
}

/** Screen-true axis glyph for a stop's orientation, shown on the stop's
 *  editor handle (both the StopGrid and the on-canvas layout editor render
 *  it inside the station-rotated frame, so it always reads world-true). */
export const ORIENTATION_GLYPH: Record<
  'auto-vertical' | 'auto-ne-sw' | 'auto-horizontal' | 'auto-nw-se',
  string
> = {
  'auto-vertical': '↕',
  'auto-ne-sw': '⤢',
  'auto-horizontal': '↔',
  'auto-nw-se': '⤡',
};

/** A stop/label node with its effective width in world units (a stop's is
 *  its line's width; the label cell is unit-sized = STOP_SIZE). */
export type WidthNode = RowCol & { w: number };

export interface GhostSpec {
  /** The dragged/nudged node's own effective width. */
  wSrc: number;
  /** Anchor node the candidate lattice hangs off (typically the nearest
   *  non-source node). */
  anchor: WidthNode;
  /** Every non-source node, anchor included — a ghost slot that would
   *  visually overlap one of these once dropped is filtered out. */
  otherNodes: readonly WidthNode[];
  basis: LatticeBasis;
  stationRotation: Rotation;
  /** Lattice reach from the anchor, in rings. */
  gridRadius: number;
}

/**
 * Candidate drop slots around `anchor`: the unit lattice scaled by the
 * drag-pair tangency factor — ring-1 ghosts land where the source's body
 * exactly touches the anchor's (1 for two default-width nodes, e.g. 1.5 for
 * a width-28 stop against a default one; farther rings scale uniformly).
 * Generated in the SCREEN frame and projected into the station's unrotated
 * local frame, so the user-facing slot directions are identical at any
 * station rotation. Slots closer to another node than their mutual tangency
 * distance are dropped (tangent is allowed).
 */
export function computeGhosts(spec: GhostSpec): RowCol[] {
  const { wSrc, anchor, otherNodes, basis, stationRotation, gridRadius } = spec;
  const t = tangentGap(wSrc, anchor.w) / STOP_SIZE;
  const localOffsets = projectScreenToLocal(latticeOffsets(basis, gridRadius), stationRotation);
  const ghosts: RowCol[] = [];
  for (const o of localOffsets) {
    const g = { row: anchor.row + o.row * t, col: anchor.col + o.col * t };
    let overlap = false;
    for (const n of otherNodes) {
      if (sameCell(n, anchor)) continue;
      if (Math.hypot(g.row - n.row, g.col - n.col) < tangentGap(wSrc, n.w) / STOP_SIZE - CELL_EPS) {
        overlap = true;
        break;
      }
    }
    if (!overlap) ghosts.push(g);
  }
  return ghosts;
}

/**
 * Keyboard-nudge slot resolution: the ghost slot the `source` node should
 * hop to for a SCREEN-direction arrow press (row +1 = down, col +1 = right).
 * Anchor = nearest non-source node (deterministic, cursor-free twin of the
 * drag flow), candidates = the same computeGhosts lattice — so keyboard
 * positions are exactly the positions a drag could reach.
 *
 * Selection: candidates within ±67.5° of the arrow (so a diagonal slot still
 * answers a cardinal press when nothing straighter survives the overlap
 * filter), ranked by direction alignment first, then distance, then (row,
 * col) order as a deterministic tie-break. Null when no slot qualifies.
 */
export function nudgeTarget(spec: {
  source: RowCol;
  wSrc: number;
  otherNodes: readonly WidthNode[];
  basis: LatticeBasis;
  stationRotation: Rotation;
  /** Screen-frame arrow direction: one of (±1, 0) / (0, ±1). */
  arrow: RowCol;
}): RowCol | null {
  const { source, wSrc, otherNodes, basis, stationRotation, arrow } = spec;
  const anchor = nearestNode(source, otherNodes);
  if (!anchor) return null;
  const ghosts = computeGhosts({ wSrc, anchor, otherNodes, basis, stationRotation, gridRadius: 2 });

  // Accept candidates within ±67.5° of the arrow: strictly wider than the
  // 45° lattice diagonals (kept as fallbacks) but rejecting perpendicular
  // slots. cos(67.5°) ≈ 0.3827.
  const MIN_DOT = Math.cos((67.5 * Math.PI) / 180) + CELL_EPS;

  let best: RowCol | null = null;
  let bestDot = 0;
  let bestDist = Infinity;
  for (const g of ghosts) {
    if (sameCell(g, source)) continue;
    // Slot direction from the source, projected back into the SCREEN frame
    // (rotateBy is the inverse of the projectScreenToLocal used above;
    // x = col, y = row).
    const p = rotateBy({ x: g.col - source.col, y: g.row - source.row }, stationRotation);
    const d = Math.hypot(p.x, p.y);
    if (d < CELL_EPS) continue;
    const dot = (p.x * arrow.col + p.y * arrow.row) / d;
    if (dot < MIN_DOT) continue;
    let better: boolean;
    if (best === null) better = true;
    else if (Math.abs(dot - bestDot) > CELL_EPS) better = dot > bestDot;
    else if (Math.abs(d - bestDist) > CELL_EPS) better = d < bestDist;
    else if (Math.abs(g.row - best.row) > CELL_EPS) better = g.row < best.row;
    else better = g.col < best.col;
    if (better) {
      best = g;
      bestDot = dot;
      bestDist = d;
    }
  }
  return best;
}
