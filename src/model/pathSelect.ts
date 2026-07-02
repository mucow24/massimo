import type { Line, LineId, MapDoc, StationId } from './types';

/**
 * For a pair of stations that share at least one line, return the sequence
 * of stations between them along the shortest shared line, **excluding**
 * `fromId`. Returns `null` if no line contains both ids, or if
 * `fromId === toId`.
 *
 * Direction matters: if A is before B on the line, the slice walks forward
 * (`(A, B]`). If A is after B, it walks backward (also `(A, B]` when read
 * as "stations between A and B with B included"). The caller's expected
 * UX is "toggle every station on the path from the anchor toward `toId`,
 * landing on `toId` itself".
 *
 * Tie-break (multiple lines with equal-length slices): lowest `lineId`
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
    const iFrom = line.stations.indexOf(fromId);
    if (iFrom < 0) continue;
    const iTo = line.stations.indexOf(toId);
    if (iTo < 0) continue;

    let slice: StationId[];
    if (iTo > iFrom) {
      slice = line.stations.slice(iFrom + 1, iTo + 1);
    } else {
      // Walk backward toward `toId`: slice `[iTo, iFrom)` — the exclusive end
      // bound leaves `fromId` out — then reverse so the path runs from → to.
      const forward = line.stations.slice(iTo, iFrom);
      slice = forward.reverse();
    }
    if (slice.length === 0) continue;

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
