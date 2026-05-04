import { Line, LineId, Station, StationId, StopCell } from '../state/types';
import { Vec2 } from './vec';
import { route } from './router';
import { segmentEndpoints, STOP_SIZE, stopCenterAt } from './orientation';
import { offsetFilletPath } from './router';

export interface SegmentBandSpec {
  pairKey: string;
  fromId: StationId;
  toId: StationId;
  // Lines in this band, in render order (perpendicular to direction of travel).
  lines: { id: LineId; color: string }[];
  paths: string[];
  warning: boolean;
  centerline: Vec2[];
  // Z-priority: smallest = front-most. min over the band's lines' positions
  // in lineOrder (or fallback = lineOrder.length when missing).
  priority: number;
}

// A single colored stop square for one line at one station, with its
// per-line priority. Rendered alongside bands so that a back-stack line's
// stop square doesn't paint over a front-stack line's band passing through.
export interface StopMarkerSpec {
  cx: number;
  cy: number;
  color: string;
  rotationDeg: number; // station rotation in degrees CW
  priority: number;
}

const pairKeyOf = (a: StationId, b: StationId) => (a < b ? `${a}|${b}` : `${b}|${a}`);

interface SegInfo {
  fromId: StationId;
  toId: StationId;
  fromCell: StopCell;
  toCell: StopCell;
  forward: boolean;
  lineId: LineId;
  color: string;
}

/**
 * Build all colored bands for the map. A "band" is one or more lines that
 * share a station-pair and pass through it with matching stop orientations
 * AND grid-adjacent cells along the perpendicular-to-travel axis at both
 * stations. Bands render with stroke-width = STOP_SIZE per line, perpendicular
 * offsets `(k − (n−1)/2) * STOP_SIZE`.
 */
export function buildBands(
  stations: Record<StationId, Station>,
  lines: Record<LineId, Line>,
  curveRadius: number,
  lineOrder: LineId[] = [],
): SegmentBandSpec[] {
  // 1. Collect per-line segments keyed by sorted station pair, with stop cells.
  const groups: Record<string, SegInfo[]> = {};

  for (const lineId of Object.keys(lines)) {
    const line = lines[lineId];
    for (let i = 0; i < line.stations.length - 1; i++) {
      const a = line.stations[i];
      const b = line.stations[i + 1];
      const sa = stations[a];
      const sb = stations[b];
      if (!sa || !sb) continue;
      const fromCell = sa.stops.find((c) => c.lineId === lineId);
      const toCell = sb.stops.find((c) => c.lineId === lineId);
      if (!fromCell || !toCell) continue;
      const key = pairKeyOf(a, b);
      const forward = a < b;
      (groups[key] ||= []).push({
        fromId: a,
        toId: b,
        fromCell,
        toCell,
        forward,
        lineId,
        color: line.color,
      });
    }
  }

  // 2. Build interlined runs within each group.
  const bands: SegmentBandSpec[] = [];

  for (const [pairKey, segs] of Object.entries(groups)) {
    const byDir: Record<string, SegInfo[]> = { fwd: [], rev: [] };
    for (const s of segs) byDir[s.forward ? 'fwd' : 'rev'].push(s);

    for (const dirKey of ['fwd', 'rev']) {
      const list = byDir[dirKey];
      if (list.length === 0) continue;
      // Bucket by shared orientation. Two lines with mismatched orientations
      // at A or B are guaranteed to be in different buckets, hence different
      // bands (which is what we want).
      const buckets: Record<string, SegInfo[]> = {};
      for (const s of list) {
        if (s.fromCell.orientation !== s.toCell.orientation) {
          // Mismatched orientation across the segment is its own solo band —
          // it can't interline with anything because the band can't reconcile
          // two orientations across a perpendicular spread.
          buckets[`solo:${s.lineId}`] = [s];
        } else {
          (buckets[s.fromCell.orientation] ||= []).push(s);
        }
      }
      for (const bucket of Object.values(buckets)) {
        // For the matched-orientation buckets the from and to orientations
        // are identical. For solo buckets they may differ; perpAxis only
        // governs grouping within a bucket and a solo bucket has one segment.
        const orientation = bucket[0].fromCell.orientation;
        const perpAxis: 'col' | 'row' = orientation === 'vertical' ? 'col' : 'row';
        const sortedBucket = bucket.slice().sort((a, b) => {
          const va = a.fromCell[perpAxis];
          const vb = b.fromCell[perpAxis];
          return va - vb;
        });

        // Greedily merge into runs where each successive line is one step
        // further along perpAxis at BOTH endpoints in the same direction.
        let group: SegInfo[] = [];
        const flush = () => {
          if (group.length === 0) return;
          bands.push(buildBandSpec(group, stations, curveRadius, pairKey));
          group = [];
        };
        for (const s of sortedBucket) {
          if (group.length === 0) {
            group.push(s);
            continue;
          }
          const prev = group[group.length - 1];
          const dFrom = s.fromCell[perpAxis] - prev.fromCell[perpAxis];
          const dTo = s.toCell[perpAxis] - prev.toCell[perpAxis];
          // Must also stay on the same parallel axis (same row for vertical
          // bands, same col for horizontal) at each station.
          const parAxis: 'col' | 'row' = perpAxis === 'col' ? 'row' : 'col';
          const sameParA = s.fromCell[parAxis] === prev.fromCell[parAxis];
          const sameParB = s.toCell[parAxis] === prev.toCell[parAxis];
          if (dFrom === 1 && dTo === 1 && sameParA && sameParB) {
            group.push(s);
          } else {
            flush();
            group.push(s);
          }
        }
        flush();
      }
    }
  }

  // 3. Tag each band with its z-priority (min lineIndex of any contained
  // line). The actual sort happens in the renderer, where bands and stop
  // markers are merged into one pass.
  const lineIndex = buildLineIndex(lineOrder, lines);
  const fallback = Object.keys(lineIndex).length;
  for (const band of bands) {
    band.priority = Math.min(
      ...band.lines.map((l) => lineIndex[l.id] ?? fallback),
    );
  }

  return bands;
}

// Reconcile persisted lineOrder against the lines dict (filter dead IDs,
// append any missing). Returns a {lineId: index} map. Index 0 = front-most.
export function buildLineIndex(
  lineOrder: LineId[],
  lines: Record<LineId, Line>,
): Record<LineId, number> {
  const present = lineOrder.filter((id) => lines[id]);
  const seen = new Set(present);
  const reconciled = present.slice();
  for (const id of Object.keys(lines)) if (!seen.has(id)) reconciled.push(id);
  const idx: Record<LineId, number> = {};
  reconciled.forEach((id, i) => (idx[id] = i));
  return idx;
}

// One stop marker per (station, line stop) pair, in world coords, with the
// line's per-line z-priority. Rendered interleaved with bands.
export function buildStopMarkers(
  stations: Record<StationId, Station>,
  lines: Record<LineId, Line>,
  lineOrder: LineId[],
): StopMarkerSpec[] {
  const lineIndex = buildLineIndex(lineOrder, lines);
  const fallback = Object.keys(lineIndex).length;
  const markers: StopMarkerSpec[] = [];
  for (const station of Object.values(stations)) {
    for (const cell of station.stops) {
      const line = lines[cell.lineId];
      if (!line) continue;
      const local = stopCenterAt(cell.row, cell.col);
      // Apply station rotation to local point to get world center.
      const a = (station.rotation * Math.PI) / 4;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const cx = station.x + local.x * c - local.y * s;
      const cy = station.y + local.x * s + local.y * c;
      markers.push({
        cx,
        cy,
        color: line.color,
        rotationDeg: station.rotation * 45,
        priority: lineIndex[cell.lineId] ?? fallback,
      });
    }
  }
  return markers;
}

function buildBandSpec(
  group: SegInfo[],
  stations: Record<StationId, Station>,
  R: number,
  pairKey: string,
): SegmentBandSpec {
  // Centerline anchor at each end is the mean of the band's endpoint cells.
  const meanCell = (cells: StopCell[]): { row: number; col: number } => {
    const row = cells.reduce((a, c) => a + c.row, 0) / cells.length;
    const col = cells.reduce((a, c) => a + c.col, 0) / cells.length;
    return { row, col };
  };
  const fromCells = group.map((g) => g.fromCell);
  const toCells = group.map((g) => g.toCell);
  const fromMean = meanCell(fromCells);
  const toMean = meanCell(toCells);
  // Endpoint orientation is taken from each end's actual cells. Within an
  // interlined bucket they all match; for a solo band they may differ, and
  // the segment's two tangents need to come from each end independently.
  const fromOrientation = group[0].fromCell.orientation;
  const toOrientation = group[0].toCell.orientation;

  const fromStation = stations[group[0].fromId];
  const toStation = stations[group[0].toId];

  const ep = segmentEndpoints(
    fromStation,
    stopCenterAt(fromMean.row, fromMean.col),
    fromOrientation,
    toStation,
    stopCenterAt(toMean.row, toMean.col),
    toOrientation,
  );
  const result = route(ep.start, ep.startDir, ep.end, ep.endDir, R);

  const n = group.length;
  const paths: string[] = [];
  const linesArr = group.map((g) => ({ id: g.lineId, color: g.color }));
  for (let k = 0; k < n; k++) {
    const offset = (k - (n - 1) / 2) * STOP_SIZE;
    paths.push(offsetFilletPath(result.vertices, R, offset));
  }

  return {
    pairKey,
    fromId: group[0].fromId,
    toId: group[0].toId,
    lines: linesArr,
    paths,
    warning: result.warning,
    centerline: result.vertices,
    priority: 0, // overwritten in buildBands' final pass
  };
}
