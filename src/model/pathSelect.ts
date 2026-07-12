import type { Line, LineId, MapDoc, StationId } from './types';
import { edgeNeighbors } from './lineTopology';

/**
 * Shortest hop path (BFS) over one line's EDGE graph from `fromId` to `toId`,
 * excluding `fromId`. Null if either isn't a member or they're not connected on
 * this line. For a plain linear line this is exactly the consecutive walk
 * between them; for a loop it takes the shorter arc, and for a branch it walks
 * the unique tree path.
 */
function shortestPathOnLine(line: Line, fromId: StationId, toId: StationId): StationId[] | null {
  if (!line.stations.includes(fromId) || !line.stations.includes(toId)) return null;
  const prev = new Map<StationId, StationId | null>([[fromId, null]]);
  const queue: StationId[] = [fromId];
  while (queue.length) {
    const cur = queue.shift() as StationId;
    if (cur === toId) {
      const path: StationId[] = [];
      for (let n: StationId | null = toId; n !== null; n = prev.get(n) ?? null) path.push(n);
      return path.reverse().slice(1); // from → to, excluding `fromId`
    }
    for (const nb of edgeNeighbors(line.edges, cur)) {
      if (!prev.has(nb)) {
        prev.set(nb, cur);
        queue.push(nb);
      }
    }
  }
  return null;
}

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
