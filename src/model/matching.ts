import { rotateStationLayoutBy90 } from './transforms';
import type { MapDoc, Station, StationId, StopCell } from './types';
import { rot8 } from '../util/grid';
import { stationCircle } from '../geometry/lineCircle';
import { stationFrameDeg } from '../geometry/orientation';

/**
 * `lineCircles` is optional only so a caller with no rings in hand still
 * type-checks; supply it whenever you have it. Without it a CIRCLE-BOUND
 * station reads as unbound, and its key claims the octant frame it does not
 * actually paint in (see `frameKey`).
 */
type MatchingScope = Pick<MapDoc, 'stations' | 'lines'> & Partial<Pick<MapDoc, 'lineCircles'>>;

/**
 * Layout-rotation difference between a source and a matching station, in 90°
 * steps that match `rotateStationLayoutBy90(_, +1)` (one step rotates the
 * unrotated grid CW while compensating station rotation CCW). 0 = identical
 * layout; 2 = 180° mirror. Directed SOURCE → CANDIDATE: callers that
 * propagate local-frame edits across the match (moveStop / moveLabel) rotate
 * the source's (dRow, dCol) by this many 90° steps (`rotateGridDelta`) to
 * get the candidate-frame delta that preserves world appearance. (The
 * direction matters: R² = −I, so the even offsets are self-inverse and mask
 * a flipped convention, but at odd offsets the inverse would broadcast the
 * world-OPPOSITE edit.)
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
 * A station bound to a line circle paints in the RING's frame rather than its
 * octant `rotation`, so it only matches something painted at the same angle —
 * see `frameKey`.
 *
 * Excludes the selected station itself.
 */
export function findMatchingStations(doc: MatchingScope, selectedId: StationId): StationMatch[] {
  const sel = doc.stations[selectedId];
  if (!sel) return [];
  const circles = doc.lineCircles ?? {};
  // Compute the source's structural keys at all 4 rotations once.
  const selKeys = rotatedKeys(sel, doc.lines, circles);
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
    const candKeys = rotatedKeys(st, doc.lines, circles);
    if (canonicalOf(candKeys) !== selCanonical) continue;
    // The source→candidate delta rotation: how much (dRow, dCol) edits must
    // be rotated when broadcast to this match.
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
function rotatedKeys(
  st: Station,
  lines: MatchingScope['lines'],
  circles: MapDoc['lineCircles'],
): [string, string, string, string] {
  const k0 = stopsKey(st, lines, circles);
  const s1 = rotateStationLayoutBy90(st, 1);
  const k1 = stopsKey(s1, lines, circles);
  const s2 = rotateStationLayoutBy90(s1, 1);
  const k2 = stopsKey(s2, lines, circles);
  const s3 = rotateStationLayoutBy90(s2, 1);
  const k3 = stopsKey(s3, lines, circles);
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
 * The SOURCE → CANDIDATE delta rotation. rotatedKeys aligns the CANDIDATE
 * onto the source: the k with candKeys[k] === srcKey satisfies R^k(cand) =
 * src. A source-frame edit d therefore lands in the candidate's frame as
 * R^(4−k)(d) — the inverse — so return (4 − k) % 4, matching LayoutOffset's
 * directed contract (callers apply `rotateGridDelta(d, layoutOffset)`
 * as-is). Caller has already verified the canonical keys match, so a k
 * always exists. If multiple k's match (a rotationally symmetric layout),
 * any is fine — all produce equivalent edits.
 */
function layoutOffsetOf(srcKey: string, candKeys: readonly string[]): LayoutOffset {
  for (let k = 0; k < 4; k++) {
    if (candKeys[k] === srcKey) return ((4 - k) % 4) as LayoutOffset;
  }
  return 0;
}

/**
 * Canonical string key for a station at its current layout rotation:
 * the painted frame angle, the sorted stop set (filtered to lines that still
 * exist), and the label's cell + rotation — every cell taken RELATIVE to the
 * layout's own corner, so where the layout sits in the grid doesn't enter its
 * identity.
 * `label.offset` is deliberately excluded — stations that are otherwise
 * identical but have slightly different offsets are still "the same kind of
 * station" for mass-editing purposes.
 */
// Round row/col to a stable string at 4 dp so float drift from diagonal
// (±√2/2) arithmetic doesn't fragment otherwise-identical layouts. 4 dp is
// well below the 1-unit cell pitch and well above any plausible cumulative
// rounding error. No sign to normalize: every value reaching here is
// `v − min(set)` with the min a member of that same set, so it is +0 or
// greater — a negative-ulp "-0.0000" can't arise.
const q = (n: number): string => n.toFixed(4);

/**
 * The angle the station's whole picture is painted at, as an integer count of
 * ten-thousandths of a degree wrapped into [0, 360).
 *
 * NOT `station.rotation`: that is the quantized octant, and a CIRCLE-BOUND
 * station resolves its cells and its label through the RING frame instead — up
 * to 22.5° away (see `stationFrameRad`). Keying on the octant lets a bound
 * station match a free one that visibly paints askew of it, which the "renders
 * IDENTICALLY" contract above forbids; worse, a mirrored rotate then re-picks
 * the bound station's nearest quarter-turn and leaves its picture where it was
 * while the source turns 45°. For an unbound station the frame IS the octant,
 * so this says exactly what `rotation` said. Integers, and wrapped after
 * rounding, so 360° and 0° cannot key apart; the 4-dp tolerance matches `q`.
 */
const frameKey = (st: Station, circles: MapDoc['lineCircles']): string => {
  const ticks = Math.round(stationFrameDeg(st, stationCircle(st, circles)) * 1e4);
  return String(((ticks % 3_600_000) + 3_600_000) % 3_600_000);
};

function stopsKey(
  st: Station,
  lines: MatchingScope['lines'],
  circles: MapDoc['lineCircles'],
): string {
  const cells = st.stops.filter((c) => lines[c.lineId]);
  const lab = st.label;
  // A waypoint renders no name and no dots — visually it is only the line
  // routing through its stop cells. Its (invisible) label geometry is not
  // part of its identity, and it can never look like a fully-rendered
  // station, so the label slot doubles as the waypoint marker.
  const wp = !!st.isWaypoint;
  // Cell (0,0) is the station's own anchor point, and it paints NOTHING: a
  // layout parked a column over renders the same picture, with the station's
  // x/y absorbing the shift. So the key is taken against the layout's own
  // top-left corner, not the origin. Per-axis min is the right anchor because
  // it is translation-EQUIVARIANT (min(v + t) = min(v) + t) — which is also
  // why it survives the 4-fold canonicalization above: rotating about the
  // origin turns a translation t into R(t), and normalizing subtracts it
  // again. Only the cells the key actually names take part: a waypoint's
  // stale label cell must not drag the anchor around and refragment the
  // waypoints the rule above just unified.
  const anchored = wp ? cells : [...cells, lab];
  const oRow = anchored.length ? Math.min(...anchored.map((c) => c.row)) : 0;
  const oCol = anchored.length ? Math.min(...anchored.map((c) => c.col)) : 0;
  const parts = cells.map((c) => stopKey(c, oRow, oCol)).sort();
  const labelPart = wp ? 'wp' : `L${q(lab.row - oRow)},${q(lab.col - oCol)},${rot8(lab.rotation)}`;
  return `r${frameKey(st, circles)}|${labelPart}|${parts.join('|')}`;
}

function stopKey(c: StopCell, oRow: number, oCol: number): string {
  return `${c.lineId}:${q(c.row - oRow)},${q(c.col - oCol)}:${c.orientation}`;
}
