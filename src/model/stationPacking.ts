// Tangency-preserving station repack for line-width edits.
//
// The interlining merge gate treats two stops as stripes of one band only
// when their centers sit EXACTLY tangentGap(wA, wB) = (wA + wB) / 2 apart
// along the perpendicular of their shared travel axis, within TOL = 0.5
// world units (see buildBandGeometry). Widths live on lines while stop cells
// live on a fixed-pitch lattice, so a bare width edit strands every packed
// layout at its old spacing and un-merges its bands. `setLineWidth` calls
// {@link repackStationForWidth} to rewrite the affected chains instead:
//
//   - stops are grouped by travel axis (their orientation), partitioned into
//     parallel-position clusters (stops from another corridor along the same
//     axis must not sever a chain they could never merge with), and chained
//     where consecutive perp-neighbors are tangent under the OLD widths with
//     equal parallel positions — the same relation the merge gate keys on;
//   - each chain containing the edited line is rewritten to the NEW
//     cumulative tangent gaps, preserving the chain's centroid: the band
//     centerline is the stop centroid, so corridors stay put and stripes
//     tighten (or fatten) in place;
//   - everything else — parallel coordinates, other-axis stops, deliberately
//     non-tangent spacing — never moves;
//   - the station label rides along with its nearest stop, and additionally
//     CARRIES with the edited stop's EDGE when it is attached to one (see
//     labelCarryDelta below) — a parked label stays parked at any width.
//
// Chains that span multiple corridors (a trunk flanked by a differently-
// routed neighbor) can shift a corridor's stop-subset centroid by a few
// world units — the price of keeping the station block packed. That is
// bounded, only occurs at branch/trunk stations, and is fixed by nudging the
// station; the alternative (per-corridor centroids) is over-constrained.
import { CELL_EPS, sameCell } from '../geometry/lattice';
import {
  BAND_MERGE_TOL,
  labelAdjacencyGate,
  STOP_SIZE,
  tangentGap,
  travelDirLocal,
} from '../geometry/orientation';
import { DIRS_8, dirIndex } from '../geometry/router';
import { leftNormal } from '../geometry/vec';
import { lineWidthOf } from './lineWidth';
import type { Line, LineId, Station, StopCell, StopOrientation } from './types';

/** Chain-recognition tolerance, world units — the shared band-merge tolerance
 *  (BAND_MERGE_TOL). Repack must recognize exactly the layouts the renderer
 *  merges; sharing the constant is what keeps the two from drifting. Applied
 *  per-station here (one-sided), which is deliberately a little more generous
 *  than the merge gate's both-ends rule. */
const REPACK_TOL = BAND_MERGE_TOL;

/** Below this perp movement (world units) a stop is considered unmoved, so a
 *  degenerate rewrite can't churn references. */
const MOVE_EPS = 1e-9;

/**
 * Re-pack `station`'s tangent stop chains for a width change on `lineId`
 * (oldWidth → newWidth, both EFFECTIVE widths in world units). Returns the
 * station unchanged (same reference) when nothing needs to move: no stop of
 * the line, no tangent chain containing it, or a no-op width.
 *
 * Pure and station-local: positions are handled in the unrotated local frame
 * (cell × STOP_SIZE), where tangency distances equal their world-frame
 * counterparts because rotation preserves lengths.
 */
export function repackStationForWidth(
  station: Station,
  lines: Record<LineId, Line>,
  lineId: LineId,
  oldWidth: number,
  newWidth: number,
): Station {
  if (oldWidth === newWidth) return station;
  if (!station.stops.some((c) => c.lineId === lineId)) return station;

  // Per-stop movement in cell units, keyed by index into station.stops.
  const deltas = new Map<number, { dRow: number; dCol: number }>();

  // Group stops by travel axis. Each orientation IS one axis; the hint-free
  // travelDirLocal sign is immaterial because only the axis direction is
  // used, and a flipped perp merely reverses the sort order of a chain.
  const byAxis = new Map<StopOrientation, number[]>();
  station.stops.forEach((c, i) => {
    const arr = byAxis.get(c.orientation);
    if (arr) arr.push(i);
    else byAxis.set(c.orientation, [i]);
  });

  for (const [orientation, idxs] of byAxis) {
    if (idxs.length < 2) continue;
    const travel = travelDirLocal(orientation);
    const perpAxis = leftNormal(travel);
    const nodes = idxs.map((i) => {
      const c = station.stops[i];
      const x = c.col * STOP_SIZE;
      const y = c.row * STOP_SIZE;
      const edited = c.lineId === lineId;
      const w = edited ? oldWidth : lineWidthOf(lines[c.lineId]);
      return {
        i,
        edited,
        par: x * travel.x + y * travel.y,
        perp: x * perpAxis.x + y * perpAxis.y,
        w,
        wNew: edited ? newWidth : w,
      };
    });
    // Partition into PARALLEL-position clusters first. The merge gate groups
    // stops per station-pair before comparing them, so a same-axis stop from
    // ANOTHER corridor — a different along-travel position — can never block
    // a merge; letting it interleave the perp sort here would sever a chain
    // it could never belong to (and un-merge the very band this module
    // exists to preserve). Clusters split where the par-sorted values jump
    // by ≥ REPACK_TOL; the per-link par check below stays as the exact
    // consecutive-pair mirror of the merge gate.
    nodes.sort((a, b) => a.par - b.par || a.perp - b.perp || a.i - b.i);
    const clusters: (typeof nodes)[] = [];
    for (const n of nodes) {
      const cur = clusters[clusters.length - 1];
      if (cur && n.par - cur[cur.length - 1].par < REPACK_TOL) cur.push(n);
      else clusters.push([n]);
    }

    for (const cluster of clusters) {
      if (cluster.length < 2) continue;
      cluster.sort((a, b) => a.perp - b.perp || a.par - b.par || a.i - b.i);

      // Walk maximal tangent chains: consecutive perp-neighbors at the old
      // tangent gap with matching parallel positions.
      let start = 0;
      for (let k = 1; k <= cluster.length; k++) {
        const linked =
          k < cluster.length &&
          Math.abs(cluster[k].par - cluster[k - 1].par) < REPACK_TOL &&
          Math.abs(
            cluster[k].perp - cluster[k - 1].perp - tangentGap(cluster[k - 1].w, cluster[k].w),
          ) < REPACK_TOL;
        if (linked) continue;
        const chain = cluster.slice(start, k);
        start = k;
        // Only the chain holding the edited stop is rewritten — unrelated
        // chains have unchanged gaps, and canonicalizing their within-TOL slop
        // as a side effect of an unrelated width edit would surprise.
        if (chain.length < 2 || !chain.some((n) => n.edited)) continue;
        // New perp positions: cumulative NEW tangent gaps, mean-centered onto
        // the chain's old centroid (least total movement — the exact analogue
        // of stripeOffsetsForWidths' mean-centering).
        const cum = [0];
        for (let j = 1; j < chain.length; j++)
          cum.push(cum[j - 1] + tangentGap(chain[j - 1].wNew, chain[j].wNew));
        const oldMean = chain.reduce((s, n) => s + n.perp, 0) / chain.length;
        const cumMean = cum.reduce((s, v) => s + v, 0) / cum.length;
        chain.forEach((n, j) => {
          const dPerp = oldMean + cum[j] - cumMean - n.perp;
          if (Math.abs(dPerp) < MOVE_EPS) return;
          deltas.set(n.i, {
            dRow: (dPerp * perpAxis.y) / STOP_SIZE,
            dCol: (dPerp * perpAxis.x) / STOP_SIZE,
          });
        });
      }
    }
  }

  // Edge-carry: a label ATTACHED to a stop of the edited line — within the
  // shared labelAdjacencyGate under the OLD widths, the same gate the
  // renderer's snap/autoAlign use — tracks the stop's EDGE, not its center.
  // The rendered pin sits at (support · half + gap) along the approach
  // octant, so the width edit moves it by Δhalf · support; carrying the cell
  // the same way keeps a tangency-parked label parked (and inside the gate)
  // at ANY width instead of stranding it at the old width's tangency.
  const carry = labelCarryDelta(station, lines, lineId, oldWidth, newWidth);

  if (deltas.size === 0 && !carry) return station;

  const stops =
    deltas.size === 0
      ? station.stops
      : station.stops.map((c, i) => {
          const d = deltas.get(i);
          return d ? { ...c, row: c.row + d.dRow, col: c.col + d.dCol } : c;
        });

  // The label follows its nearest stop (old positions; ties resolve to the
  // first stop in array order), keeping the name glued to the cluster edge.
  // The ride (the stop's own movement) and the carry (its edge's movement
  // relative to its center) compose into the full edge displacement.
  let label = station.label;
  let nearest = -1;
  let bestDist = Infinity;
  station.stops.forEach((c, i) => {
    const d = Math.hypot(c.row - label.row, c.col - label.col);
    if (d < bestDist) {
      bestDist = d;
      nearest = i;
    }
  });
  const ride = nearest >= 0 ? deltas.get(nearest) : undefined;
  const dRow = (ride?.dRow ?? 0) + (carry?.dRow ?? 0);
  const dCol = (ride?.dCol ?? 0) + (carry?.dCol ?? 0);
  const labelDelta =
    Math.abs(dRow) + Math.abs(dCol) > MOVE_EPS / STOP_SIZE ? { dRow, dCol } : undefined;
  if (labelDelta) {
    label = { ...label, row: label.row + labelDelta.dRow, col: label.col + labelDelta.dCol };
  }

  // Integer-multiple gaps produce whole-cell deltas, so a rewritten stop can
  // land EXACTLY on the label's cell (or the riding label on a stop) — a
  // state every other mutator forbids (moveStop blocks entering the label
  // cell; spawnStopCell nudges the label out). Shove the label along its
  // push direction — its own follow delta, else the colliding stop's — one
  // cell at a time past any occupied cell, moveLabel-style. A coincidence
  // with no movement involved is pre-existing and left alone.
  const hitIdx = stops.findIndex((c) => sameCell(c, label));
  const push = hitIdx >= 0 ? (labelDelta ?? deltas.get(hitIdx)) : undefined;
  if (push) {
    const ar = Math.abs(push.dRow);
    const ac = Math.abs(push.dCol);
    const step =
      ar > ac + CELL_EPS
        ? { dRow: Math.sign(push.dRow), dCol: 0 }
        : ac > ar + CELL_EPS
          ? { dRow: 0, dCol: Math.sign(push.dCol) }
          : { dRow: Math.sign(push.dRow), dCol: Math.sign(push.dCol) };
    for (let guard = 0; guard <= stops.length; guard++) {
      if (!stops.some((c) => sameCell(c, label))) break;
      label = { ...label, row: label.row + step.dRow, col: label.col + step.dCol };
    }
  }

  return { ...station, stops, label };
}

/**
 * The label's edge-carry for a width edit on `lineId`: when the label is
 * attached to a stop of the edited line, return the cell delta that keeps it
 * at the same distance from that stop's EDGE; null otherwise.
 *
 * The reference stop mirrors autoAlignInfo's pick (labelLayout.ts): the
 * nearest stop within the shared labelAdjacencyGate under the OLD widths,
 * ties preferring the stop below the reading direction. The movement is the
 * pin's: the marker square's support along the approach octant scales the
 * half-width change (a cardinal approach onto the square moves by Δhalf, a
 * diagonal one by Δhalf·√2 along the diagonal — Δhalf per axis). Dash ticks
 * are deliberately ignored: a dash stop's derived tick also scales with
 * width, but the painted pin is stop-relative either way, so the carried
 * cell merely sits a whisker off the tick's tangency — still inside the gate.
 */
function labelCarryDelta(
  station: Station,
  lines: Record<LineId, Line>,
  lineId: LineId,
  oldWidth: number,
  newWidth: number,
): { dRow: number; dCol: number } | null {
  const label = station.label;
  const readAngle = (label.rotation * Math.PI) / 4;
  const readCos = Math.cos(readAngle);
  const readSin = Math.sin(readAngle);
  let ref: StopCell | null = null;
  let refD2 = Infinity;
  let refPerp = -Infinity;
  for (const c of station.stops) {
    const dRow = c.row - label.row;
    const dCol = c.col - label.col;
    const cheb = Math.max(Math.abs(dRow), Math.abs(dCol));
    if (cheb < 1e-6) continue; // a stop on the label cell has no direction
    const half = (c.lineId === lineId ? oldWidth : lineWidthOf(lines[c.lineId])) / 2;
    if (cheb > labelAdjacencyGate(half)) continue;
    const d2 = dRow * dRow + dCol * dCol;
    const perp = dCol * -readSin + dRow * readCos;
    if (ref === null || d2 < refD2 - 1e-9 || (d2 < refD2 + 1e-9 && perp > refPerp)) {
      ref = c;
      refD2 = Math.min(refD2, d2);
      refPerp = perp;
    }
  }
  if (!ref || ref.lineId !== lineId) return null;
  // Approach octant stop → label, and the marker square's support along it —
  // the same extent math the renderer's pin uses (labelLayout.autoAlignInfo).
  const o = dirIndex({ x: label.col - ref.col, y: label.row - ref.row });
  const u = DIRS_8[o];
  const axis = travelDirLocal(ref.orientation);
  const support = Math.abs(u.x * axis.x + u.y * axis.y) + Math.abs(u.x * -axis.y + u.y * axis.x);
  const dExtent = ((newWidth - oldWidth) / 2) * support;
  if (Math.abs(dExtent) < MOVE_EPS) return null;
  return { dRow: (dExtent * u.y) / STOP_SIZE, dCol: (dExtent * u.x) / STOP_SIZE };
}
