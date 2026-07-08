// Pure helpers and constants for the stop/label lattice editing logic — kept
// out of the components so they can be unit-tested without React Testing
// Library, and consumed by Playwright e2e helpers without pulling in React.
// Shared by the keyboard nudge (App.tsx) and the on-canvas station editing
// surfaces (useStationLayoutDrag / StationLayoutEditor).
import {
  latticeOffsets,
  projectScreenToLocal,
  sameCell,
  CELL_EPS,
  type LatticeBasis,
  type RowCol,
} from '../../geometry/lattice';
import {
  rotateBy,
  tangentGap,
  worldDirToLocal,
  STOP_SIZE,
  type Rotation,
} from '../../geometry/orientation';
import { lineWidthOf } from '../../model/lineWidth';
import type { Line, Station } from '../../model/types';
import type { Vec2 } from '../../geometry/vec';
export { sameCell, CELL_EPS } from '../../geometry/lattice';

// Snap rules shared by every ghost-lattice drag surface — same numbers as the
// old StopGrid: the cursor→ghost snap radius and the candidate-lattice extent,
// both in (row, col) units.
export const GHOST_SNAP_RADIUS = 1.0;
export const GRID_RADIUS = 2;

const dist = (a: RowCol, b: RowCol): number => Math.hypot(a.row - b.row, a.col - b.col);

/** The station-local (row, col) cell under a world-space point: the world
 *  delta rotated into the station's frame, scaled by the stop pitch. */
export function cursorCellAt(
  station: Pick<Station, 'x' | 'y'>,
  rotation: Rotation,
  world: Vec2,
): RowCol {
  const local = worldDirToLocal({ x: world.x - station.x, y: world.y - station.y }, rotation);
  return { row: local.y / STOP_SIZE, col: local.x / STOP_SIZE };
}

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
 *  editor handle (the on-canvas layout editor renders it inside the
 *  station-rotated frame, so it always reads world-true). */
export const ORIENTATION_GLYPH: Record<
  'auto-vertical' | 'auto-ne-sw' | 'auto-horizontal' | 'auto-nw-se',
  string
> = {
  'auto-vertical': '↕',
  'auto-ne-sw': '⤢',
  'auto-horizontal': '↔',
  'auto-nw-se': '⤡',
};

/** Human-readable axis names for the same orientations (accessible labels +
 *  tooltips on the inspector's orientation cycle button). */
export const ORIENTATION_NAME: Record<keyof typeof ORIENTATION_GLYPH, string> = {
  'auto-vertical': 'vertical',
  'auto-ne-sw': 'NE–SW',
  'auto-horizontal': 'horizontal',
  'auto-nw-se': 'NW–SE',
};

/** A stop/label node with its effective width in world units (a stop's is
 *  its line's width; the label cell is unit-sized = STOP_SIZE). */
export type WidthNode = RowCol & { w: number };

/** A station lattice node: width-annotated cell + which line owns it
 *  (null = the label cell). */
export type LayoutNode = WidthNode & { lineId: string | null };

export type LayoutSource = { kind: 'stop'; lineId: string } | { kind: 'label' };

/**
 * Every lattice node of a station with its effective width: one per stop
 * (the line's width) plus the label cell (unit width). The single source of
 * truth for "what can a stop/label be tangent to" — the drag hooks and the
 * keyboard nudge must all build their node lists here so their reachable
 * slots can never diverge.
 */
export function stationLayoutNodes(
  station: Pick<Station, 'stops' | 'label'>,
  lines: Record<string, Line>,
): LayoutNode[] {
  return [
    ...station.stops.map((s) => ({
      row: s.row,
      col: s.col,
      w: lineWidthOf(lines[s.lineId]),
      lineId: s.lineId as string | null,
    })),
    { row: station.label.row, col: station.label.col, w: STOP_SIZE, lineId: null },
  ];
}

/** The non-source nodes for a drag/nudge: anchor candidates + overlap filter. */
export function otherLayoutNodes(nodes: readonly LayoutNode[], source: LayoutSource): LayoutNode[] {
  return nodes.filter((n) =>
    source.kind === 'label' ? n.lineId !== null : n.lineId !== source.lineId,
  );
}

/** The dragged/nudged node's own cell, or null when it no longer exists. */
export function sourceCellOf(
  station: Pick<Station, 'stops' | 'label'>,
  source: LayoutSource,
): RowCol | null {
  if (source.kind === 'label') return { row: station.label.row, col: station.label.col };
  const cell = station.stops.find((s) => s.lineId === source.lineId);
  return cell ? { row: cell.row, col: cell.col } : null;
}

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
