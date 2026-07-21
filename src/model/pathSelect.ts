import type { Line, LineId, MapDoc, StationId } from './types';
import { shortestPathOnLine } from './lineTopology';

/**
 * For a pair of stations that share at least one line, return the sequence of
 * stations between them along the shortest shared line, **excluding** `fromId`
 * (so the caller can "toggle every station from the anchor toward `toId`,
 * landing on `toId`"). Returns `null` if no line connects both, or if
 * `fromId === toId`.
 *
 * Tie-break (multiple lines with equal-length paths): lowest `lineId`
 * lexicographically, so the result is deterministic.
 */
export function pathBetweenStations(
  doc: Pick<MapDoc, 'lines'>,
  fromId: StationId,
  toId: StationId,
): StationId[] | null {
  if (fromId === toId) return null;

  let best: { lineId: LineId; slice: StationId[] } | null = null;

  for (const line of Object.values(doc.lines) as Line[]) {
    const slice = shortestPathOnLine(line, fromId, toId);
    if (!slice || slice.length === 0) continue;

    if (
      !best ||
      slice.length < best.slice.length ||
      (slice.length === best.slice.length && line.id < best.lineId)
    ) {
      best = { lineId: line.id, slice };
    }
  }

  return best ? best.slice : null;
}
