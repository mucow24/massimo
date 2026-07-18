import type { Line, LineStyle, StationId } from '../../model/types';
import { edgeEndpoints, lineHasEdge } from '../../model/lineTopology';
import { pairKeyOf } from '../../model/pairKey';

// The Edit Stops gesture model, as pure decision functions: (line, cursor,
// target) → decision. All behavioral rules of canvas line editing live here,
// where they are unit-tested; useStationInteraction / MapCanvas /
// usePlacementDispatch are thin dispatch layers over these.
//
// The CURSOR is the whole mode state:
//   • station cursor — the "pen": station clicks CONNECT from it and advance;
//   • edge cursor    — armed insertion: station clicks SPLICE into the edge.
//     Ordered (from → to): new stops enter at the end nearest the arming
//     click and march toward `to` — each splice advances `from` to the stop
//     just added so a click-click-click run subdivides one corridor. The
//     direction is fixed once, at the arming click, because a per-splice
//     "farther endpoint" re-pick flips direction as soon as a stop lands past
//     the remaining span's midpoint.
//   • null — nothing pending; a member click arms, Esc/canvas-click exits.

export type AppendCursor =
  | { kind: 'station'; stationId: StationId }
  | { kind: 'edge'; from: StationId; to: StationId }
  | null;

// The Edit Stops mouseover target: the station or segment the pointer is
// currently over. Purely a hover-preview affordance ("what a click acts on"),
// separate from the CURSOR (the committed pen/armed edge). Ephemeral — set on
// pointer enter/move, cleared on leave and on mode exit.
export type AppendHover =
  | { kind: 'station'; stationId: StationId }
  | { kind: 'segment'; pairKey: string }
  | null;

/** True when two hover targets are the same (drives the store's no-churn set). */
export function sameAppendHover(a: AppendHover, b: AppendHover): boolean {
  if (a === b) return true;
  if (!a || !b || a.kind !== b.kind) return false;
  return a.kind === 'station'
    ? a.stationId === (b as { stationId: StationId }).stationId
    : a.pairKey === (b as { pairKey: string }).pairKey;
}

// What a gesture means. `cursor` on the mutating kinds is the follow-up cursor
// the wiring must set AFTER dispatching the store action. The create-* kinds
// need a station that doesn't exist yet, so the wiring creates it and derives
// the follow-up cursor from the fresh id (seed/connect → station cursor,
// splice → edge cursor toward `to`).
export type AppendDecision =
  | { kind: 'none' }
  | { kind: 'exit' }
  | { kind: 'cursor'; cursor: AppendCursor }
  | { kind: 'seed'; stationId: StationId; cursor: AppendCursor }
  | { kind: 'connect'; from: StationId; to: StationId; cursor: AppendCursor }
  | { kind: 'splice'; from: StationId; to: StationId; stationId: StationId; cursor: AppendCursor }
  | { kind: 'create-seed' }
  | { kind: 'create-connect'; from: StationId }
  | { kind: 'create-splice'; from: StationId; to: StationId };

/**
 * Degrade a stale cursor to null: undo, right-click removal, or any other
 * edit can strip the cursor's station from the line or delete its edge out
 * from under it. Every decision validates through here first.
 */
export function validCursor(line: Line, cursor: AppendCursor): AppendCursor {
  if (!cursor) return null;
  if (cursor.kind === 'station') return line.stations.includes(cursor.stationId) ? cursor : null;
  return lineHasEdge(line, cursor.from, cursor.to) ? cursor : null;
}

/** A click on a station (member or not) while editing the line's stops. */
export function decideStationClick(
  line: Line,
  cursorIn: AppendCursor,
  stationId: StationId,
): AppendDecision {
  if (line.stations.length === 0)
    return { kind: 'seed', stationId, cursor: { kind: 'station', stationId } };
  const cursor = validCursor(line, cursorIn);
  if (!cursor) {
    return line.stations.includes(stationId)
      ? { kind: 'cursor', cursor: { kind: 'station', stationId } }
      : { kind: 'none' };
  }
  if (cursor.kind === 'station') {
    if (cursor.stationId === stationId) return { kind: 'cursor', cursor: null };
    return {
      kind: 'connect',
      from: cursor.stationId,
      to: stationId,
      cursor: { kind: 'station', stationId },
    };
  }
  // Edge cursor: endpoints jump the cursor (splicing an endpoint into its own
  // edge is meaningless); anything else subdivides and keeps marching.
  if (stationId === cursor.from || stationId === cursor.to)
    return { kind: 'cursor', cursor: { kind: 'station', stationId } };
  return {
    kind: 'splice',
    from: cursor.from,
    to: cursor.to,
    stationId,
    cursor: { kind: 'edge', from: stationId, to: cursor.to },
  };
}

/**
 * A click on a segment of the edited line. `pairKey` is the corridor's
 * canonical station-pair key; `click` is the world-space click point and
 * `stopPosOf` resolves a member's stop position (both may be unavailable, in
 * which case the edge arms in canonical order).
 */
export function decideSegmentClick(
  line: Line,
  cursorIn: AppendCursor,
  pairKey: string,
  click: { x: number; y: number } | null,
  stopPosOf: (sid: StationId) => { x: number; y: number } | null,
): AppendDecision {
  if (!line.edges.includes(pairKey)) return { kind: 'none' };
  const cursor = validCursor(line, cursorIn);
  const [a, b] = edgeEndpoints(pairKey);
  // Re-clicking the armed segment disarms it, whichever direction it stored.
  if (
    cursor?.kind === 'edge' &&
    ((cursor.from === a && cursor.to === b) || (cursor.from === b && cursor.to === a))
  )
    return { kind: 'cursor', cursor: null };
  let from = a;
  let to = b;
  const pa = stopPosOf(a);
  const pb = stopPosOf(b);
  if (click && pa && pb) {
    const da = Math.hypot(click.x - pa.x, click.y - pa.y);
    const db = Math.hypot(click.x - pb.x, click.y - pb.y);
    if (db < da) {
      from = b;
      to = a;
    }
  }
  return { kind: 'cursor', cursor: { kind: 'edge', from, to } };
}

/**
 * A click on empty canvas. Plain click backs out one level (drop the cursor,
 * else exit the mode). Alt-click creates a station as the second click of the
 * pending action — never as a first click, so it can't strand an orphan.
 */
export function decideCanvasClick(
  line: Line,
  cursorIn: AppendCursor,
  alt: boolean,
): AppendDecision {
  const cursor = validCursor(line, cursorIn);
  if (!alt) return cursor ? { kind: 'cursor', cursor: null } : { kind: 'exit' };
  // Alt: the empty-line seed is the one allowed "first click" creation.
  if (line.stations.length === 0) return { kind: 'create-seed' };
  if (!cursor) return { kind: 'none' };
  if (cursor.kind === 'station') return { kind: 'create-connect', from: cursor.stationId };
  return { kind: 'create-splice', from: cursor.from, to: cursor.to };
}

/**
 * Delete/Backspace while editing: remove whatever the cursor has armed — the
 * cursor station leaves the line, the armed edge is cut. Nothing armed (or a
 * stale cursor) is a no-op.
 */
export function decideDeleteKey(
  line: Line,
  cursorIn: AppendCursor,
):
  | { kind: 'none' }
  | { kind: 'remove-station'; stationId: StationId }
  | { kind: 'remove-edge'; from: StationId; to: StationId } {
  const cursor = validCursor(line, cursorIn);
  if (!cursor) return { kind: 'none' };
  if (cursor.kind === 'station') return { kind: 'remove-station', stationId: cursor.stationId };
  return { kind: 'remove-edge', from: cursor.from, to: cursor.to };
}

// ----- Hover previews (Edit Stops) --------------------------------------
//
// The mouseover affordance: while editing a line's stops, the station or
// segment under the cursor previews the chrome a click would produce, so it's
// always visually obvious what the next click acts on. These decide WHETHER a
// preview shows; its position/paint lives in HighlightedLineLayer. Both mirror
// the click matrix above so the preview can never promise an action the click
// wouldn't take.

/**
 * Show a hover ring on the station under the cursor? True whenever a click on
 * it would do something — connect / splice / seed / arm / jump — i.e. the
 * gesture matrix doesn't return 'none'. Suppressed on the armed station cursor
 * itself, which already wears the full (non-preview) ring.
 */
export function appendStationHoverPreview(
  line: Line,
  cursor: AppendCursor,
  stationId: StationId,
): boolean {
  const c = validCursor(line, cursor);
  if (c?.kind === 'station' && c.stationId === stationId) return false;
  return decideStationClick(line, cursor, stationId).kind !== 'none';
}

/**
 * Show a hover halo on the segment under the cursor? True for any corridor the
 * edited line actually runs, except the already-armed edge (which wears the
 * full halo). A foreign corridor — not one of this line's edges — previews
 * nothing, since clicking it switches lines, a different gesture.
 */
export function appendSegmentHoverPreview(
  line: Line,
  cursor: AppendCursor,
  pairKey: string,
): boolean {
  if (!line.edges.includes(pairKey)) return false;
  const c = validCursor(line, cursor);
  if (c?.kind === 'edge' && pairKeyOf(c.from, c.to) === pairKey) return false;
  return true;
}

// Segment style cycle order (shift-click a segment). Moved from the old line
// editor tree; the full cycle must visit every LineStyle exactly once.
export const NEXT_STYLE: Record<LineStyle, LineStyle> = {
  solid: 'dashed',
  dashed: 'hatched',
  hatched: 'hatched-mirror',
  'hatched-mirror': 'dotted',
  dotted: 'dashed-open',
  'dashed-open': 'solid',
};
