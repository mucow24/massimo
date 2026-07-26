// Transfer anchors: the two homes, and the narrowing guards for the
// `TransferEnd` union. Pure — no React, no store, no geometry.
//
// An anchor exists ONLY so a transfer end can bind to it. Two anchors (or one
// anchor plus a station stop) let a transfer turn a corner, which is the whole
// point: a 90° transfer is two segments meeting at an anchor.
//
// The two homes are deliberate, not an accident of history:
//   - FREE anchors are `MapDoc.transferAnchors` — a homogeneous `{id, x, y}`
//     record, so every consumer that treats one like a route bullet (group
//     drag, group rotate, the align pool, the camera hull) needs no narrowing.
//   - HOSTED anchors are `Station.transferAnchors` — cells in the station's own
//     (row, col) grid, so every station-layout transform carries them for free.
//     Chief among them `rotateStationLayoutBy90`, which rewrites stops and the
//     label cell through a local `rotateGrid`: an anchor held in a doc-level
//     collection would sit still while the layout turned 90° around it, tearing
//     apart the elbow the anchor was placed to make.
//
// Anchor ids are minted from one factory (`IdFactory.anchorId`) and are unique
// across BOTH homes, so a selection id or a transfer end never has to say which
// home it means beyond what its own shape already says.
import type { AnchorCell, LineId, MapDoc, Station, StationId, TransferEnd } from './types';

/** A transfer end bound to a station STOP (the historical shape). */
export type StopEnd = { stationId: StationId; lineId: LineId | null };

/** A transfer end bound to a station-hosted anchor cell. */
export type HostedAnchorEnd = { stationId: StationId; anchorId: string };

/** A transfer end bound to a free anchor. */
export type FreeAnchorEnd = { anchorId: string };

/**
 * Is this end bound to an anchor (either home) rather than a stop?
 *
 * Test this FIRST when narrowing: two of the three arms carry a `stationId`, so
 * `'stationId' in end` alone does NOT separate a stop from a hosted anchor.
 */
export function isAnchorEnd(end: TransferEnd): end is HostedAnchorEnd | FreeAnchorEnd {
  return 'anchorId' in end;
}

/** Is this end bound to a station stop (the arm every legacy save carries)? */
export function isStopEnd(end: TransferEnd): end is StopEnd {
  return !('anchorId' in end);
}

/**
 * The station this end resolves against, or null for a free anchor. Both the
 * stop arm and the hosted-anchor arm are station-keyed, which is what lets the
 * delete cascades orphan a station's stops AND its hosted anchors with the one
 * predicate `endStationId(end) === id`.
 */
export function endStationId(end: TransferEnd): StationId | null {
  return 'stationId' in end ? end.stationId : null;
}

/** The anchor id this end binds to, or null when it binds a stop. */
export function endAnchorId(end: TransferEnd): string | null {
  return 'anchorId' in end ? end.anchorId : null;
}

/** The line whose dot this end picks, or null when it isn't a stop end. */
export function endLineId(end: TransferEnd): LineId | null {
  return isStopEnd(end) ? end.lineId : null;
}

/** A station's hosted anchor cell by id, or undefined. */
export function stationAnchorCell(
  station: Pick<Station, 'transferAnchors'> | undefined,
  anchorId: string,
): AnchorCell | undefined {
  return station?.transferAnchors?.find((a) => a.id === anchorId);
}

/**
 * Does this end still resolve in `doc`? Used by the selection reconcile and by
 * the parse-time hygiene pass — a transfer whose end dangles renders nothing
 * (the resolver returns null and the layer drops it), so this is about telling
 * "temporarily dormant" from "genuinely broken", not about crash-safety.
 */
export function transferEndResolves(
  doc: Pick<MapDoc, 'stations' | 'transferAnchors'>,
  end: TransferEnd,
): boolean {
  if (isStopEnd(end)) return !!doc.stations[end.stationId];
  if ('stationId' in end) return !!stationAnchorCell(doc.stations[end.stationId], end.anchorId);
  return !!doc.transferAnchors[end.anchorId];
}
