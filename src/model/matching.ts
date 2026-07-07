import { rotateStationLayoutBy45, rotateStationLayoutBy90 } from './transforms';
import type { MapDoc, Station, StationId, StopCell } from './types';

type MatchingScope = Pick<MapDoc, 'stations' | 'lines'>;

/**
 * Layout-rotation difference between a source and a matching station, in 45°
 * steps: two steps match `rotateStationLayoutBy90(_, +1)` (rotate the
 * unrotated grid CW while compensating station rotation CCW), one step is
 * the `rotateStationLayoutBy45` half-step that maps between the orthogonal
 * and diagonal (±√2/2) lattices. 0 = identical layout; 4 = 180° mirror; odd
 * = opposite lattice parity. Directed SOURCE → CANDIDATE: callers that
 * propagate local-frame edits across the match (moveStop / moveLabel) rotate
 * the source's (dRow, dCol) by this many 45° steps (`rotateGridDelta`) to
 * get the candidate-frame delta that preserves world appearance. (The
 * direction matters: a 180° rotation is self-inverse and masks a flipped
 * convention, but elsewhere the inverse would broadcast a world-WRONG edit.)
 */
export type LayoutOffset = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

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
 * Visual identity is invariant under the full 8-fold symmetry: rotating the
 * layout by k·45° while compensating `station.rotation` by −k preserves
 * world appearance (odd k maps the orthogonal cell lattice onto the diagonal
 * ±√2/2 lattice — the "pressed R once and re-arranged onto diagonal cells"
 * twin). Each candidate's `layoutOffset` reports the source→candidate delta
 * rotation, so callers can rotate grid-frame edits accordingly.
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
    // The source→candidate delta rotation: how much (dRow, dCol) edits must
    // be rotated when broadcast to this match.
    const k = layoutOffsetOf(selKeys[0], candKeys);
    out.push({ id: sid, layoutOffset: k });
  }
  return out;
}

/**
 * Structural keys for a station at all 8 layout rotations (k = 0..7).
 * Index k is the key after rotating the layout k 45°-steps while
 * compensating `station.rotation`. Even indices come from the integer-exact
 * 90° chain; each odd index is a single 45° half-step off the preceding
 * even station, so no key accumulates more than one irrational multiply
 * (the 4dp quantizer in `q` absorbs the ulp).
 */
function rotatedKeys(st: Station, lines: MatchingScope['lines']): string[] {
  const e0 = st;
  const e2 = rotateStationLayoutBy90(e0, 1);
  const e4 = rotateStationLayoutBy90(e2, 1);
  const e6 = rotateStationLayoutBy90(e4, 1);
  return [
    e0,
    rotateStationLayoutBy45(e0, 1),
    e2,
    rotateStationLayoutBy45(e2, 1),
    e4,
    rotateStationLayoutBy45(e4, 1),
    e6,
    rotateStationLayoutBy45(e6, 1),
  ].map((s) => stopsKey(s, lines));
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
 * The SOURCE → CANDIDATE delta rotation. rotatedKeys aligns the CANDIDATE
 * onto the source: the k with candKeys[k] === srcKey satisfies S^k(cand) =
 * src (S = one 45° layout step). A source-frame edit d therefore lands in
 * the candidate's frame as S^(8−k)(d) — the inverse — so return (8 − k) % 8,
 * matching LayoutOffset's directed contract (callers apply
 * `rotateGridDelta(d, layoutOffset)` as-is). Caller has already verified the
 * canonical keys match, so a k always exists. If multiple k's match (a
 * rotationally symmetric layout), any is fine — all produce equivalent
 * edits.
 */
function layoutOffsetOf(srcKey: string, candKeys: readonly string[]): LayoutOffset {
  for (let k = 0; k < 8; k++) {
    if (candKeys[k] === srcKey) return ((8 - k) % 8) as LayoutOffset;
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
// rounding error. Normalize the "-0.0000" that toFixed produces for
// negative-ulp drift — it must key identically to exact zero.
const q = (n: number): string => {
  const s = n.toFixed(4);
  return s === '-0.0000' ? '0.0000' : s;
};

// Rotations render mod 8 (SVG rotate is periodic); in-app mutators wrap, but
// hand-edited/persisted docs can carry 8 or −1, which must key like 0 and 7.
const rot8 = (n: number): number => ((n % 8) + 8) % 8;

function stopsKey(st: Station, lines: MatchingScope['lines']): string {
  const parts: string[] = [];
  for (const c of st.stops) {
    if (!lines[c.lineId]) continue;
    parts.push(stopKey(c));
  }
  parts.sort();
  // A waypoint renders no name and no dots — visually it is only the line
  // routing through its stop cells. Its (invisible) label geometry is not
  // part of its identity, and it can never look like a fully-rendered
  // station, so the label slot doubles as the waypoint marker.
  const lab = st.label;
  const labelPart = st.isWaypoint ? 'wp' : `L${q(lab.row)},${q(lab.col)},${rot8(lab.rotation)}`;
  return `r${rot8(st.rotation)}|${labelPart}|${parts.join('|')}`;
}

function stopKey(c: StopCell): string {
  return `${c.lineId}:${q(c.row)},${q(c.col)}:${c.orientation}`;
}
