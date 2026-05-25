import { rotateStationLayoutBy90 } from './transforms';
import type { MapDoc, Station, StationId, StopCell } from './types';

type MatchingScope = Pick<MapDoc, 'stations' | 'lines'>;

/**
 * Layout-rotation difference between a source and a matching station, in 90°
 * steps that match `rotateStationLayoutBy90(_, +1)` (one step rotates the
 * unrotated grid CW while compensating station rotation CCW). 0 = identical
 * layout; 2 = 180° mirror. Callers that propagate local-frame edits across
 * the match (moveStop / moveLabel) must rotate (dRow, dCol) by this many
 * 90° steps to preserve world appearance.
 */
export type LayoutOffset = 0 | 1 | 2 | 3;

export interface StationMatch {
  id: StationId;
  layoutOffset: LayoutOffset;
}

/**
 * Find all stations that render IDENTICALLY to `selectedId` (modulo
 * translation), AND who appear on at least one of the same lines as
 * `selectedId`.
 *
 * "Whole line, not adjacency": for each line that contains the selected
 * station, every other station on that line is a candidate; intervening
 * non-matching stations don't break the chain.
 *
 * Visual identity is invariant under the 4-fold mirror symmetry: rotating
 * the layout by k·90° while compensating `station.rotation` by −2k preserves
 * world appearance. Each candidate's `layoutOffset` reports the k value that
 * aligns its layout to the selected station's, so callers can rotate
 * grid-frame edits accordingly.
 *
 * Stops whose lineId no longer exists in `doc.lines` are ignored — they
 * don't render, so they shouldn't make two visually-identical stations
 * fail to match.
 *
 * Excludes the selected station itself.
 */
export function findMatchingStations(doc: MatchingScope, selectedId: StationId): StationMatch[] {
  const sel = doc.stations[selectedId];
  if (!sel) return [];
  // Compute the source's structural keys at all 4 rotations once.
  const selKeys = rotatedKeys(sel, doc.lines);
  const selCanonical = canonicalOf(selKeys);

  const candidates = new Set<StationId>();
  for (const lineId of Object.keys(doc.lines)) {
    const line = doc.lines[lineId];
    if (!line.stations.includes(selectedId)) continue;
    for (const sid of line.stations) candidates.add(sid);
  }
  candidates.delete(selectedId);

  const out: StationMatch[] = [];
  for (const sid of candidates) {
    const st = doc.stations[sid];
    if (!st) continue;
    const candKeys = rotatedKeys(st, doc.lines);
    if (canonicalOf(candKeys) !== selCanonical) continue;
    // Find k such that rotating the candidate's layout k 90°-steps yields
    // the same structural key as the source — that's how much (dRow, dCol)
    // edits must be rotated when broadcast to this match.
    const k = layoutOffsetOf(selKeys[0], candKeys);
    out.push({ id: sid, layoutOffset: k });
  }
  return out;
}

/**
 * Structural keys for a station at all 4 layout rotations (k = 0..3).
 * Index k is the key after rotating the layout k 90°-steps via
 * `rotateStationLayoutBy90(_, +1)` while compensating `station.rotation`.
 */
function rotatedKeys(st: Station, lines: MatchingScope['lines']): [string, string, string, string] {
  const k0 = stopsKey(st, lines);
  const s1 = rotateStationLayoutBy90(st, 1);
  const k1 = stopsKey(s1, lines);
  const s2 = rotateStationLayoutBy90(s1, 1);
  const k2 = stopsKey(s2, lines);
  const s3 = rotateStationLayoutBy90(s2, 1);
  const k3 = stopsKey(s3, lines);
  return [k0, k1, k2, k3];
}

/** Lex-min over the 4 rotation keys — the canonical form of the layout. */
function canonicalOf(keys: readonly string[]): string {
  let best = keys[0];
  for (let i = 1; i < keys.length; i++) {
    if (keys[i] < best) best = keys[i];
  }
  return best;
}

/**
 * Smallest k ∈ {0,1,2,3} such that the candidate's k-rotated structural key
 * matches the source's k=0 key. Caller has already verified the canonical
 * keys match, so a k always exists. If multiple k's match (a rotationally
 * symmetric layout), the smallest is fine — all produce equivalent edits.
 */
function layoutOffsetOf(srcKey: string, candKeys: readonly string[]): LayoutOffset {
  for (let k = 0; k < 4; k++) {
    if (candKeys[k] === srcKey) return k as LayoutOffset;
  }
  return 0;
}

/**
 * Canonical string key for a station at its current layout rotation:
 * rotation, the sorted stop set (filtered to lines that still exist), and
 * the label's cell + rotation. `label.offset` is deliberately excluded —
 * stations that are otherwise identical but have slightly different offsets
 * are still "the same kind of station" for mass-editing purposes.
 */
// Round row/col to a stable string at 4 dp so float drift from diagonal
// (±√2/2) arithmetic doesn't fragment otherwise-identical layouts. 4 dp is
// well below the 1-unit cell pitch and well above any plausible cumulative
// rounding error.
const q = (n: number): string => n.toFixed(4);

function stopsKey(st: Station, lines: MatchingScope['lines']): string {
  const parts: string[] = [];
  for (const c of st.stops) {
    if (!lines[c.lineId]) continue;
    parts.push(stopKey(c));
  }
  parts.sort();
  const lab = st.label;
  return `r${st.rotation}|L${q(lab.row)},${q(lab.col)},${lab.rotation}|${parts.join('|')}`;
}

function stopKey(c: StopCell): string {
  return `${c.lineId}:${q(c.row)},${q(c.col)}:${c.orientation}`;
}
