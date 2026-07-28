// World positions for the three shapes a transfer end can take.
//
// This lived inside TransferLayer.tsx as a private `endpointWorld` plus an
// exported `transferEndWorld`, which meant a component owned the geometry and
// two other modules imported it back out of the render layer. It is pure
// world-coordinate math over the doc, so it belongs here — and its call sites
// (the transfer bodies pass, the selection outline, and the in-progress
// creation preview) must all resolve an end identically or a transfer would
// render somewhere its own outline isn't.
import { stopPosWorld } from './interlining';
import { localToWorld, stopCenterAt } from './orientation';
import type { Vec2 } from './vec';
import { isHostedAnchorEnd, isStopEnd, stationAnchorCell } from '../model/transferAnchors';
import type { LineId, Station, StationId, TransferAnchor, TransferEnd } from '../model/types';

/**
 * World position of a station's specific stop dot. Falls back to the station's
 * own anchor point when no lineId is given or that line isn't on this station
 * (e.g. after the line was deleted).
 */
export function stopWorld(station: Station, lineId: LineId | null): Vec2 {
  if (!lineId) return { x: station.x, y: station.y };
  const cell = station.stops.find((c) => c.lineId === lineId);
  if (!cell) return { x: station.x, y: station.y };
  return stopPosWorld(cell, station);
}

/** World position of a station-hosted anchor cell, in the station's frame. */
export function stationAnchorWorld(station: Station, cell: { row: number; col: number }): Vec2 {
  return localToWorld(stopCenterAt(cell.row, cell.col), station);
}

/**
 * World position of a transfer end, or null when it no longer resolves — a
 * deleted station, a hosted anchor whose station lost it, or a free anchor that
 * was removed. Callers drop the whole transfer on null (both ends must resolve
 * for there to be a segment to draw), which is also what makes a dangling end
 * degrade quietly instead of needing a parse-time sanitizer.
 */
export function transferEndWorld(
  end: TransferEnd,
  stations: Record<StationId, Station>,
  transferAnchors: Record<string, TransferAnchor>,
): Vec2 | null {
  if (isStopEnd(end)) {
    const st = stations[end.stationId];
    return st ? stopWorld(st, end.lineId) : null;
  }
  if (isHostedAnchorEnd(end)) {
    const st = stations[end.stationId];
    const cell = stationAnchorCell(st, end.anchorId);
    return st && cell ? stationAnchorWorld(st, cell) : null;
  }
  const free = transferAnchors[end.anchorId];
  return free ? { x: free.x, y: free.y } : null;
}
