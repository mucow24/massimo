import type { Line, LineStyle, StationId } from './types';
import { edgeEndpoints, lineHasEdge } from './lineTopology';
import { pairKeyOf } from './pairKey';
import { resolveSegmentStyle } from '../geometry/interlining';

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

// The Edit Stops mouseover target: the station, segment, or FOREIGN line the
// pointer is currently over. Purely a hover-preview affordance ("what a click
// acts on"), separate from the CURSOR (the committed pen/armed edge). The
// 'line' kind marks a stripe of a line other than the edited one — clicking
// it switches the editor to that line, so the preview highlights the whole
// line. Ephemeral — set on pointer enter/move, cleared on leave and on mode
// exit.
export type AppendHover =
  | { kind: 'station'; stationId: StationId }
  | { kind: 'segment'; pairKey: string }
  | { kind: 'line'; lineId: string }
  | null;

/** True when two hover targets are the same (drives the store's no-churn set). */
export function sameAppendHover(a: AppendHover, b: AppendHover): boolean {
  if (a === b) return true;
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === 'station') return a.stationId === (b as { stationId: StationId }).stationId;
  if (a.kind === 'segment') return a.pairKey === (b as { pairKey: string }).pairKey;
  return a.lineId === (b as { lineId: string }).lineId;
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
  | { kind: 'cycle-style'; from: StationId; to: StationId }
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

/**
 * A click on a station (member or not) while editing the line's stops.
 *
 * With `shift`, the click's ONLY meaning is to cycle the ARMED segment's
 * pattern, and only when it lands over that segment — i.e. on one of its
 * endpoint stations. A short segment's band is occluded by its two endpoint
 * stations, so this endpoint click is how a sandwiched segment stays editable
 * (pair it with alt-click to arm the buried segment in the first place). Shift
 * NEVER seeds/connects/splices — an add-to-line on shift is exactly the trap
 * that made short segments uneditable.
 */
export function decideStationClick(
  line: Line,
  cursorIn: AppendCursor,
  stationId: StationId,
  shift = false,
): AppendDecision {
  if (shift) {
    const cursor = validCursor(line, cursorIn);
    if (cursor?.kind === 'edge' && (stationId === cursor.from || stationId === cursor.to))
      return { kind: 'cycle-style', from: cursor.from, to: cursor.to };
    return { kind: 'none' };
  }
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
 *
 * With `alt`, a click on the ALREADY-armed segment splices a new station into
 * it at the click point — the same create decideCanvasClick makes over empty
 * canvas, but reached by clicking the segment directly (the natural "drop a
 * stop mid-segment" gesture). Alt on a not-yet-armed segment still just arms
 * it, so the alt-pick can cycle onto a buried segment before a second alt-click
 * splices; and alt never disarms.
 */
export function decideSegmentClick(
  line: Line,
  cursorIn: AppendCursor,
  pairKey: string,
  click: { x: number; y: number } | null,
  stopPosOf: (sid: StationId) => { x: number; y: number } | null,
  alt = false,
): AppendDecision {
  if (!line.edges.includes(pairKey)) return { kind: 'none' };
  const cursor = validCursor(line, cursorIn);
  const [a, b] = edgeEndpoints(pairKey);
  // On the already-armed segment (whichever direction it stored): alt splices a
  // new station into it, preserving the armed direction so a click-click-click
  // run keeps marching; a plain re-click disarms.
  if (
    cursor?.kind === 'edge' &&
    ((cursor.from === a && cursor.to === b) || (cursor.from === b && cursor.to === a))
  )
    return alt
      ? { kind: 'create-splice', from: cursor.from, to: cursor.to }
      : { kind: 'cursor', cursor: null };
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

/**
 * The CSS cursor for a station while editing a line's stops, derived from the
 * click matrix above so the cursor never promises an action the click
 * wouldn't take: 'copy' (the OS arrow-with-plus) when the click would put the
 * station on the line (seed/connect/splice), 'pointer' when it would
 * arm/jump/disarm the pen, 'default' when the click means nothing. The
 * four-arrow 'move' never shows — stations don't drag in Edit Stops.
 */
export function appendStationCursor(
  line: Line,
  cursor: AppendCursor,
  stationId: StationId,
): 'copy' | 'pointer' | 'default' {
  switch (decideStationClick(line, cursor, stationId).kind) {
    case 'seed':
    case 'connect':
    case 'splice':
      return 'copy';
    case 'cursor':
      return 'pointer';
    default:
      return 'default';
  }
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

/**
 * The style a segment cycles TO: its current resolved style advanced one step
 * through {@link NEXT_STYLE}. The single composition of "what is this segment's
 * style now" (resolveSegmentStyle) + "what's next", shared by every place a
 * cycle fires — the shift-click on a stripe, the shift-click on an armed
 * segment's endpoint station, and the style-cycle chip — so the three can never
 * disagree about the cycle.
 */
export function nextSegmentStyle(line: Line, pairKey: string): LineStyle {
  return NEXT_STYLE[resolveSegmentStyle(line, pairKey)];
}
