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
 * Is this end bound to a station-HOSTED anchor — the middle arm, the one that
 * carries BOTH a stationId and an anchorId?
 *
 * This exists because `'stationId' in end` is the single easiest thing to get
 * wrong about this union: a stop end carries a stationId too, so that test
 * alone answers "hosted" for a plain stop dot. Callers that had already
 * excluded the stop arm were writing the bare `in` check inline and were
 * correct only because of where they sat in an if-chain — a fragile thing to
 * re-derive at four call sites. Ask here instead; the guard is total.
 */
export function isHostedAnchorEnd(end: TransferEnd): end is HostedAnchorEnd {
  return 'anchorId' in end && 'stationId' in end;
}

/** Is this end bound to a FREE anchor — the arm with an anchorId and no station?
 *  The complement of {@link isHostedAnchorEnd} within the two anchor arms, and
 *  the test for "is this the selectable, draggable kind". */
export function isFreeAnchorEnd(end: TransferEnd): end is FreeAnchorEnd {
  return 'anchorId' in end && !('stationId' in end);
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

/** A station's hosted anchor cell by id, or undefined. */
export function stationAnchorCell(
  station: Pick<Station, 'transferAnchors'> | undefined,
  anchorId: string,
): AnchorCell | undefined {
  return station?.transferAnchors?.find((a) => a.id === anchorId);
}

/**
 * Does this end still resolve in `doc`? Used by the selection reconcile (to tell
 * a temporarily-dormant end from a genuinely broken one) and by `addTransfer`'s
 * guard (both ends must resolve for a transfer to be created). A transfer whose
 * end dangles renders nothing anyway — the resolver returns null and the layer
 * drops it — so this is about hygiene, not crash-safety.
 */
export function transferEndResolves(
  doc: Pick<MapDoc, 'stations' | 'transferAnchors'>,
  end: TransferEnd,
): boolean {
  if (isStopEnd(end)) return !!doc.stations[end.stationId];
  if (isHostedAnchorEnd(end)) return !!stationAnchorCell(doc.stations[end.stationId], end.anchorId);
  return !!doc.transferAnchors[end.anchorId];
}
