import type { MapDoc, Station, StationId, StopCell } from './types';

type MatchingScope = Pick<MapDoc, 'stations' | 'lines'>;

/**
 * Find all stations whose unrotated stop layout AND rotation are identical
 * to `selectedId`'s, AND who appear on at least one of the same lines as
 * `selectedId`.
 *
 * "Whole line, not adjacency": for each line that contains the selected
 * station, every other station on that line is a candidate; intervening
 * non-matching stations don't break the chain. The intent is mass-editing
 * structurally-similar stations along a line.
 *
 * Layout match = same set of {lineId, row, col, orientation}, order-independent.
 * Station rotation IS compared so that the highlight reads as "looks like
 * this one in the world", not just "internally identical." Position, name,
 * and label are still ignored.
 *
 * Stops whose lineId no longer exists in `doc.lines` are ignored — they
 * don't render, so they shouldn't make two visually-identical stations
 * fail to match.
 *
 * Excludes the selected station itself.
 */
export function findMatchingStations(doc: MatchingScope, selectedId: StationId): StationId[] {
  const sel = doc.stations[selectedId];
  if (!sel) return [];
  const selKey = stopsKey(sel, doc.lines);
  const candidates = new Set<StationId>();
  for (const lineId of Object.keys(doc.lines)) {
    const line = doc.lines[lineId];
    if (!line.stations.includes(selectedId)) continue;
    for (const sid of line.stations) candidates.add(sid);
  }
  candidates.delete(selectedId);
  const out: StationId[] = [];
  for (const sid of candidates) {
    const st = doc.stations[sid];
    if (!st) continue;
    if (stopsKey(st, doc.lines) === selKey) out.push(sid);
  }
  return out;
}

/**
 * Canonical string key for a station's structural identity: rotation, the
 * sorted stop set (filtered to lines that still exist), and the label's
 * cell + rotation. `label.offset` is deliberately excluded — it's a small
 * per-station nudge, and stations that are otherwise identical but have
 * slightly different offsets are still "the same kind of station" for
 * mass-editing purposes.
 */
function stopsKey(st: Station, lines: MatchingScope['lines']): string {
  const parts: string[] = [];
  for (const c of st.stops) {
    if (!lines[c.lineId]) continue;
    parts.push(stopKey(c));
  }
  parts.sort();
  const lab = st.label;
  return `r${st.rotation}|L${lab.row},${lab.col},${lab.rotation}|${parts.join('|')}`;
}

function stopKey(c: StopCell): string {
  return `${c.lineId}:${c.row},${c.col}:${c.orientation}`;
}
