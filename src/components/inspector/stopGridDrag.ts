// Pure helpers and constants for the stop/label lattice editing logic — kept
// out of the components so they can be unit-tested without React Testing
// Library, and consumed by Playwright e2e helpers without pulling in React.
// Shared by the keyboard nudge (App.tsx) and the on-canvas station editing
// surfaces (useStationLayoutDrag / StationLayoutEditor).
import {
  localLatticeOffsets,
  sameCell,
  CELL_EPS,
  type LatticeBasis,
  type RowCol,
} from '../../geometry/lattice';
import {
  rotateBy,
  stationDirToLocal,
  tangentGap,
  STOP_SIZE,
  type Rotation,
} from '../../geometry/orientation';
import { lineInterlineGapOf, lineWidthOf } from '../../model/lineWidth';
import type { Line, Station, StopOrientation } from '../../model/types';
import type { Vec2 } from '../../geometry/vec';
export { sameCell, CELL_EPS } from '../../geometry/lattice';

// Snap rules shared by every ghost-lattice drag surface: the cursor→ghost snap
// radius and the candidate-lattice extent, both in (row, col) units.
//
// The lattice window is a (2·r+1)² block of slots. A DRAG windows it on the
// CURSOR (dragLattice) at DRAG_GRID_RADIUS — the 5×5 grid the editor shows — so
// the slots surround the pointer and a move of any length lands in one gesture;
// a small radius suffices because the window already sits where the pointer is.
// A keyboard NUDGE (nudgeTarget) and a fresh anchor SPAWN (spawnAnchorCell) have
// no pointer, so they window on a fixed cell at the wider GRID_RADIUS — the
// reach one press or placement can search, which has to clear a run of packed
// neighbors (a label hops past two tangent stops to the free slot beyond).
export const GHOST_SNAP_RADIUS = 1.0;
export const GRID_RADIUS = 4;
export const DRAG_GRID_RADIUS = 2;

const dist = (a: RowCol, b: RowCol): number => Math.hypot(a.row - b.row, a.col - b.col);

/** The station-local (row, col) cell under a world-space point: the world
 *  delta rotated into the station's frame, scaled by the stop pitch. `circle`
 *  is the ring the station is bound to, or null — reading a cell back has to
 *  undo exactly what placed it, so it goes through the same frame
 *  (`stationDirToLocal`) rather than the rounded octant. */
export function cursorCellAt(
  station: Pick<Station, 'x' | 'y' | 'rotation'>,
  world: Vec2,
  circle: { x: number; y: number } | null,
): RowCol {
  const local = stationDirToLocal(
    { x: world.x - station.x, y: world.y - station.y },
    station,
    circle,
  );
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

export type DragSourceKind = 'stop' | 'label' | 'anchor';
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

/** Human-readable axis names for a stop's four orientations (accessible labels
 *  + tooltips on the inspector's orientation cycle button). The rotation that
 *  DRAWS each axis is `ORIENTATION_ANGLE`, in geometry/orientation beside the
 *  travel direction it has to agree with. */
export const ORIENTATION_NAME: Record<StopOrientation, string> = {
  'auto-vertical': 'vertical',
  'auto-ne-sw': 'NE–SW',
  'auto-horizontal': 'horizontal',
  'auto-nw-se': 'NW–SE',
};

/** A stop/label node with its effective width in world units (a stop's is
 *  its line's width; the label cell is unit-sized = STOP_SIZE). `isPoint`
 *  marks a BODY-LESS node — the label cell or a hosted transfer anchor: it
 *  occupies a lattice cell but has no ink on the rendered map, so the overlap
 *  filter treats it as a point (width 0) — only its nominal `w` still sets the
 *  lattice pitch when it serves as anchor. (Named `isLabel` until anchors
 *  became its second user, matching the srcIsLabel → srcIsPoint rename.)
 *  `g` is the line's interline gap (absent ⇒ 0): it widens the lattice
 *  pitch (packed spacing, max-of-pair) but not the overlap clearance —
 *  bodies don't grow with the gap. */
export type WidthNode = RowCol & { w: number; g?: number; isPoint?: boolean };

/** A station lattice node: width-annotated cell + which line owns it
 *  (null = the label cell). */
export type LayoutNode = WidthNode & { lineId: string | null };

export type LayoutSource =
  | { kind: 'stop'; lineId: string }
  | { kind: 'label' }
  // A station-hosted transfer anchor. Deliberately NOT a LayoutNode: this
  // module's node identity is `lineId: string | null`, where null means "the
  // label" — an anchor node would be indistinguishable from it in
  // `otherLayoutNodes`, and lacking `isPoint` it would become a lattice ORIGIN
  // in `anchorPool`, producing exactly the incommensurate-pitch kink that
  // function exists to forbid. Anchors ride the lattice as passengers instead.
  | { kind: 'anchor'; anchorId: string };

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
      g: lineInterlineGapOf(lines[s.lineId]),
      lineId: s.lineId as string | null,
    })),
    { row: station.label.row, col: station.label.col, w: STOP_SIZE, isPoint: true, lineId: null },
  ];
}

/** The non-source nodes for a drag/nudge: anchor candidates + overlap filter. */
export function otherLayoutNodes(nodes: readonly LayoutNode[], source: LayoutSource): LayoutNode[] {
  // An anchor is not in `nodes` at all, so nothing needs filtering out for it —
  // every stop AND the label stay available as lattice anchors and blockers.
  if (source.kind === 'anchor') return [...nodes];
  return nodes.filter((n) =>
    source.kind === 'label' ? n.lineId !== null : n.lineId !== source.lineId,
  );
}

/** The dragged/nudged node's own cell, or null when it no longer exists. */
export function sourceCellOf(
  station: Pick<Station, 'stops' | 'label' | 'transferAnchors'>,
  source: LayoutSource,
): RowCol | null {
  if (source.kind === 'label') return { row: station.label.row, col: station.label.col };
  if (source.kind === 'anchor') {
    const a = station.transferAnchors?.find((x) => x.id === source.anchorId);
    return a ? { row: a.row, col: a.col } : null;
  }
  const cell = station.stops.find((s) => s.lineId === source.lineId);
  return cell ? { row: cell.row, col: cell.col } : null;
}

/**
 * A station's transfer anchors as width-0 point nodes, for the OVERLAP filter
 * only. Appended to `otherNodes` by the drag and nudge paths so a stop or the
 * label can't be dropped straight on top of an anchor — the repulsion an
 * anchor would have exerted had it been a real LayoutNode, without giving it
 * the node identity that breaks `otherLayoutNodes` and `anchorPool`.
 *
 * `isPoint: true` is the "point, not a body" flag, and `lineId: null` keeps
 * them out of `anchorPool` (which filters on isPoint) — they can block a slot
 * but never originate the lattice.
 */
export function anchorBlockerNodes(
  station: Pick<Station, 'transferAnchors'>,
  exclude?: string,
): LayoutNode[] {
  return (station.transferAnchors ?? [])
    .filter((a) => a.id !== exclude)
    .map((a) => ({ row: a.row, col: a.col, w: STOP_SIZE, isPoint: true, lineId: null }));
}

export interface GhostSpec {
  /** The dragged/nudged node's own effective width. */
  wSrc: number;
  /** The dragged/nudged node's line interline gap (absent ⇒ 0). Widens the
   *  ring-1 packed pitch against the anchor (max-of-pair), so a dropped
   *  stop lands where the band merge gate expects it. */
  gSrc?: number;
  /** The dragged/nudged node is POINT-like — the label cell, or a transfer
   *  anchor. Its handle is editor chrome, not map ink, so it has no body for
   *  overlap purposes: slots are only dropped where a dot's body would cover
   *  the point itself. (Named srcIsLabel until anchors became the second
   *  source with exactly these mechanics.) */
  srcIsPoint?: boolean;
  /** Anchor node the candidate lattice hangs off (typically the nearest
   *  non-source node). */
  anchor: WidthNode;
  /** Every non-source node, anchor included — a ghost slot that would
   *  visually overlap one of these once dropped is filtered out. */
  otherNodes: readonly WidthNode[];
  basis: LatticeBasis;
  stationRotation: Rotation;
  /** Lattice reach, in rings, from `center` (or from the anchor without one). */
  gridRadius: number;
  /**
   * Where the window of slots is centered — snapped to the nearest lattice
   * point, then that block of rings is offered. A DRAG passes the CURSOR (so
   * slots follow the pointer); a keyboard NUDGE passes the moving node's own
   * cell. Omit when there is nothing to center on (spawnAnchorCell placing a
   * brand-new anchor), and the window hangs on the anchor itself.
   */
  center?: RowCol;
}

/**
 * Candidate drop slots on `anchor`'s lattice, windowed around `center`: the
 * unit lattice scaled by the drag-pair tangency factor — ring-1 ghosts land
 * where the source's body exactly touches the anchor's (1 for two
 * default-width nodes, e.g. 1.5 for a width-28 stop against a default one;
 * farther rings scale uniformly).
 * The basis is chosen in SCREEN terms and read back in the station's unrotated
 * local frame (`localLatticeOffsets`), so the user-facing slot directions are
 * identical at any station rotation. Slots closer to another node than their
 * mutual tangency distance are dropped (tangent is allowed) — with the label counting as a
 * width-0 point on either side of that check, since it has no body on the
 * rendered map: a slot is only "occupied" for a label where a dot would
 * cover its anchor point, and a dot may approach a label cell until its own
 * edge reaches that point.
 */
export function computeGhosts(spec: GhostSpec): RowCol[] {
  const { wSrc, gSrc, srcIsPoint, anchor, otherNodes, basis, stationRotation, gridRadius, center } =
    spec;
  const t = tangentGap(wSrc, anchor.w, gSrc ?? 0, anchor.g ?? 0) / STOP_SIZE;
  // The window of rings rides on `center` while the lattice keeps hanging off
  // `anchor` — same pitch, same phase, so ring-1 tangency and the anchor's
  // axes survive; what changes is that a node walked out to the rim gets a
  // fresh `gridRadius` of reach next time it's grabbed, instead of being stuck
  // inside one window nailed to the cluster. Offsets are scaled by `t` below,
  // so the anchor-relative delta is divided by it here.
  const localOffsets = localLatticeOffsets(
    basis,
    gridRadius,
    stationRotation,
    center && { row: (center.row - anchor.row) / t, col: (center.col - anchor.col) / t },
  );
  const ghosts: RowCol[] = [];
  for (const o of localOffsets) {
    const g = { row: anchor.row + o.row * t, col: anchor.col + o.col * t };
    let overlap = false;
    for (const n of otherNodes) {
      if (sameCell(n, anchor)) continue;
      // Clearance stays WIDTH-ONLY (gaps 0/0): it guards visual body
      // overlap, and plain tangency is a legitimate spacing for neighbors
      // that aren't meant to interline — only the packed pitch above grows
      // with the gap.
      //
      // A body-less node (the label, or a hosted anchor) reads as width 0 to a
      // BODY source — a dot may approach it until its own edge reaches the
      // point. But to a POINT source (another anchor, or the label being
      // dragged) two body-less nodes have no clearance at all and would stack;
      // there it presents its nominal cell width instead, so an anchor can't
      // land on the label or on another anchor (spawnAnchorCell's invariant).
      const nBody = n.isPoint ? (srcIsPoint ? n.w : 0) : n.w;
      const clearance = tangentGap(srcIsPoint ? 0 : wSrc, nBody, 0, 0) / STOP_SIZE;
      if (Math.hypot(g.row - n.row, g.col - n.col) < clearance - CELL_EPS) {
        overlap = true;
        break;
      }
    }
    if (!overlap) ghosts.push(g);
  }
  return ghosts;
}

/**
 * Nodes a drag/nudge may hang its candidate lattice off: the stops. The
 * label is an annotation point, not part of the stop packing — its tangency
 * pitch against a stop (unit body vs stop width, e.g. 13/14 for width-12
 * lines) is incommensurate with the stop-to-stop lattice (12/14), so slots
 * hung off the label sit ~a world unit off the line axes; dropping a stop
 * there kinks the line and splits its band. The label still blocks overlaps
 * (computeGhosts) — it just can't be the lattice origin. A station whose
 * only other node IS the label keeps it as last-resort anchor so a lone
 * stop stays movable.
 */
export function anchorPool<T extends WidthNode>(nodes: readonly T[]): readonly T[] {
  const stops = nodes.filter((n) => !n.isPoint);
  return stops.length > 0 ? stops : nodes;
}

/**
 * The in-flight drag's candidate lattice: anchor = nearest anchorable node to
 * the CURSOR (pitch, phase and axes hang off it), ghosts = computeGhosts on
 * that lattice, windowed on the CURSOR so the slots always surround the pointer
 * and a move of any length lands in one gesture. Returns the anchor too, so the
 * editor can highlight the node the grid is projected from. Pure core of the
 * drag hook's per-frame step (useStationLayoutDrag), kept here so the
 * reachable-slot rule stays unit-testable.
 */
export function dragLattice(spec: {
  cursor: RowCol;
  wSrc: number;
  /** See GhostSpec.gSrc. */
  gSrc?: number;
  /** See GhostSpec.srcIsPoint. */
  srcIsPoint?: boolean;
  otherNodes: readonly WidthNode[];
  basis: LatticeBasis;
  stationRotation: Rotation;
}): { anchor: WidthNode | null; ghosts: RowCol[] } {
  const { cursor, wSrc, gSrc, srcIsPoint, otherNodes, basis, stationRotation } = spec;
  const anchor = nearestNode(cursor, anchorPool(otherNodes));
  if (!anchor) return { anchor: null, ghosts: [] };
  const ghosts = computeGhosts({
    wSrc,
    gSrc,
    srcIsPoint,
    anchor,
    otherNodes,
    basis,
    stationRotation,
    gridRadius: DRAG_GRID_RADIUS,
    center: cursor,
  });
  return { anchor, ghosts };
}

/**
 * Keyboard-nudge slot resolution: the ghost slot the `source` node should
 * hop to for a SCREEN-direction arrow press (row +1 = down, col +1 = right).
 * Anchor = nearest anchorPool node to the source (deterministic, cursor-free),
 * candidates = the same computeGhosts lattice at the same GRID_RADIUS, but
 * windowed on `source` — a keypress has no pointer to follow, so it reaches one
 * radius out from the node it carries (the drag windows on the cursor instead).
 *
 * Selection: candidates within ±67.5° of the arrow (so a diagonal slot still
 * answers a cardinal press when nothing straighter survives the overlap
 * filter), ranked by direction alignment first, then distance, then (row,
 * col) order as a deterministic tie-break. Null when no slot qualifies.
 */
export function nudgeTarget(spec: {
  source: RowCol;
  wSrc: number;
  /** See GhostSpec.gSrc. */
  gSrc?: number;
  /** See GhostSpec.srcIsPoint. */
  srcIsPoint?: boolean;
  otherNodes: readonly WidthNode[];
  basis: LatticeBasis;
  stationRotation: Rotation;
  /** Screen-frame arrow direction: one of (±1, 0) / (0, ±1). */
  arrow: RowCol;
}): RowCol | null {
  const { source, wSrc, gSrc, srcIsPoint, otherNodes, basis, stationRotation, arrow } = spec;
  const anchor = nearestNode(source, anchorPool(otherNodes));
  if (!anchor) return null;
  const ghosts = computeGhosts({
    wSrc,
    gSrc,
    srcIsPoint,
    anchor,
    otherNodes,
    basis,
    stationRotation,
    gridRadius: GRID_RADIUS,
    center: source,
  });

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

/**
 * Where a newly added transfer anchor lands in a station's grid.
 *
 * `spawnStopCellAt` is deliberately NOT reused: it needs a lineId twice (once
 * for the new node's width, once to stamp onto the returned StopCell), anchors
 * on the rightmost STOP only, and ignores the label cell entirely — an anchor
 * has no line and must not land on the label.
 *
 * Instead it reuses the lattice the DRAG would offer: ghosts around the nearest
 * anchorable node, computed with the label's point-like parameters, minus any
 * slot an existing anchor already holds. Picks the free slot CLOSEST to a
 * station node (row, col as deterministic tie-breaks): a new anchor must sit
 * visibly against the station it belongs to — spawned at the lattice's far
 * corner it reads as a stray map object, not a station cell. Repeated clicks
 * still walk outward, one ring at a time. Falls back to one cell right of the
 * label when the overlap filter leaves nothing.
 */
export function spawnAnchorCell(
  station: Pick<Station, 'stops' | 'label' | 'transferAnchors'>,
  lines: Record<string, Line>,
): [row: number, col: number] {
  const nodes = stationLayoutNodes(station, lines);
  const anchor = anchorPool(nodes)[0];
  const taken = station.transferAnchors ?? [];
  const fallback: [number, number] = [station.label.row, station.label.col + 1];
  if (!anchor) return fallback;
  const ghosts = computeGhosts({
    wSrc: STOP_SIZE,
    gSrc: 0,
    srcIsPoint: true,
    anchor,
    otherNodes: [...nodes, ...anchorBlockerNodes(station)],
    basis: 'orthogonal',
    stationRotation: 0,
    gridRadius: GRID_RADIUS,
  }).filter((g) => !taken.some((a) => sameCell(a, g)));
  const nearestNodeDist = (g: RowCol) =>
    Math.min(...nodes.map((n) => Math.hypot(g.row - n.row, g.col - n.col)));
  ghosts.sort((a, b) => nearestNodeDist(a) - nearestNodeDist(b) || a.row - b.row || a.col - b.col);
  const pick = ghosts[0];
  return pick ? [pick.row, pick.col] : fallback;
}
