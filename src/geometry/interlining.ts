import { Line, LineId, Station, StationId } from '../state/types';
import { Vec2 } from './vec';
import { route } from './router';
import { segmentEndpoints, STOP_SIZE } from './orientation';
import { offsetFilletPath } from './router';

export interface SegmentBandSpec {
  // unique key per (stationA,stationB) pair (sorted)
  pairKey: string;
  fromId: StationId;
  toId: StationId;
  // Lines in this band, in render order (perpendicular to direction of travel).
  lines: { id: LineId; color: string }[];
  // SVG path strings, one per line, in same order.
  paths: string[];
  warning: boolean;
  centerline: Vec2[];
}

const pairKeyOf = (a: StationId, b: StationId) => (a < b ? `${a}|${b}` : `${b}|${a}`);

interface SegInfo {
  fromId: StationId;
  toId: StationId;
  fromIndex: number; // stop index at fromStation
  toIndex: number; // stop index at toStation
  forward: boolean; // true if (fromId,toId) order matches sorted pair order
  lineId: LineId;
  color: string;
}

/**
 * For each adjacent station pair on each line, group the lines by the
 * (sorted) pair key, then split groups into contiguous-stop-index bands.
 * Returns one SegmentBandSpec per band.
 */
export function buildBands(
  stations: Record<StationId, Station>,
  lines: Record<LineId, Line>,
  curveRadius: number,
): SegmentBandSpec[] {
  // 1. Collect all per-line segments keyed by sorted station pair.
  const groups: Record<string, SegInfo[]> = {};

  for (const lineId of Object.keys(lines)) {
    const line = lines[lineId];
    for (let i = 0; i < line.stations.length - 1; i++) {
      const a = line.stations[i];
      const b = line.stations[i + 1];
      const sa = stations[a];
      const sb = stations[b];
      if (!sa || !sb) continue;
      const fromIndex = sa.stopOrder.indexOf(lineId);
      const toIndex = sb.stopOrder.indexOf(lineId);
      if (fromIndex < 0 || toIndex < 0) continue;
      const key = pairKeyOf(a, b);
      const forward = a < b;
      (groups[key] ||= []).push({
        fromId: a,
        toId: b,
        fromIndex,
        toIndex,
        forward,
        lineId,
        color: line.color,
      });
    }
  }

  // 2. For each pair group, determine contiguous bands.
  // Two lines interline if:
  //  - same direction (forward flag)
  //  - their stop-index pairs at A and B are adjacent (differ by 1)
  //    AND the "shape" between them is monotonic (either both +1 or both -1).
  // We greedily merge sorted-by-fromIndex.
  const bands: SegmentBandSpec[] = [];

  for (const [pairKey, segs] of Object.entries(groups)) {
    // Split by direction first — segments with different `forward` orientation are
    // running opposite ways through the pair; treat as separate bands (in v1).
    const byDir: Record<string, SegInfo[]> = { fwd: [], rev: [] };
    for (const s of segs) byDir[s.forward ? 'fwd' : 'rev'].push(s);

    for (const dirKey of ['fwd', 'rev']) {
      const list = byDir[dirKey];
      if (list.length === 0) continue;
      list.sort((a, b) => a.fromIndex - b.fromIndex);

      // Group: consecutive entries whose (fromIndex, toIndex) both increase by 1.
      let group: SegInfo[] = [];
      const flush = () => {
        if (group.length === 0) return;
        bands.push(buildBandSpec(group, stations, curveRadius, pairKey));
        group = [];
      };
      for (const s of list) {
        if (group.length === 0) {
          group.push(s);
        } else {
          const prev = group[group.length - 1];
          if (s.fromIndex === prev.fromIndex + 1 && s.toIndex === prev.toIndex + 1) {
            group.push(s);
          } else {
            flush();
            group.push(s);
          }
        }
      }
      flush();
    }
  }

  return bands;
}

function buildBandSpec(
  group: SegInfo[],
  stations: Record<StationId, Station>,
  R: number,
  pairKey: string,
): SegmentBandSpec {
  // The band's centerline runs from the midpoint of the band's stop range
  // at the from-station to the midpoint at the to-station.
  const first = group[0];
  const last = group[group.length - 1];
  const fromMidIdx = (first.fromIndex + last.fromIndex) / 2;
  const toMidIdx = (first.toIndex + last.toIndex) / 2;

  const fromStation = stations[first.fromId];
  const toStation = stations[first.toId];

  const ep = segmentEndpoints(fromStation, fromMidIdx, toStation, toMidIdx);
  const result = route(ep.start, ep.startDir, ep.end, ep.endDir, R);

  // For each line in the band, render one path offset perpendicular to centerline.
  // Offsets: line at position k (0-indexed in group) sits at offset (k - (n-1)/2) * STOP_SIZE.
  const n = group.length;
  const paths: string[] = [];
  const linesArr = group.map((g) => ({ id: g.lineId, color: g.color }));
  for (let k = 0; k < n; k++) {
    const offset = (k - (n - 1) / 2) * STOP_SIZE;
    paths.push(offsetFilletPath(result.vertices, R, offset));
  }

  return {
    pairKey,
    fromId: first.fromId,
    toId: first.toId,
    lines: linesArr,
    paths,
    warning: result.warning,
    centerline: result.vertices,
  };
}
