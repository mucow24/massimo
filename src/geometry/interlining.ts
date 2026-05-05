import { Line, LineId, Station, StationId, StopCell } from '../model/types';
import { Vec2 } from './vec';
import { route } from './router';
import { rotateBy, STOP_SIZE, stopCenterAt, travelDirLocal } from './orientation';
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
  // Canonical (alphabetic): fromId < toId always. Both fromCell and toCell are
  // this line's stops at canonFrom and canonTo. So segs from different lines
  // through the same station-pair share a coordinate basis when bucketed.
  fromId: StationId;
  toId: StationId;
  fromCell: StopCell;
  toCell: StopCell;
  lineId: LineId;
  color: string;
  // Unit world vector along this LINE'S travel direction at this segment
  // (line.stations[i] → line.stations[i+1]). Drives auto-axis orientation
  // resolution. Not necessarily canonFrom→canonTo — a line traversing the
  // pair in reverse alphabetic order has worldHint pointing canonTo→canonFrom.
  worldHint: Vec2;
}

// Stop center in WORLD coords (anchor + cell offset rotated by station rotation).
function stopPosWorld(cell: StopCell, station: Station): Vec2 {
  const local = stopCenterAt(cell.row, cell.col);
  const a = (station.rotation * Math.PI) / 4;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return {
    x: station.x + local.x * c - local.y * s,
    y: station.y + local.x * s + local.y * c,
  };
}

// Rotate a world-frame vector into the unrotated station-local frame so that
// `travelDirLocal` can decide which way an auto-axis stop should travel.
function worldToStationLocal(v: Vec2, station: Station): Vec2 {
  const a = -(station.rotation * Math.PI) / 4;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

function travelDirWorld(cell: StopCell, station: Station, worldHint: Vec2 | null): Vec2 {
  const localHint = worldHint ? worldToStationLocal(worldHint, station) : null;
  return rotateBy(travelDirLocal(cell.orientation, localHint), station.rotation);
}

// Quantize a unit vector to one of 8 compass directions.
function dirIndex8(v: Vec2): number {
  const a = Math.atan2(v.y, v.x);
  return ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
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
      // Line direction at this segment, regardless of canonical ordering.
      const dxLine = sb.x - sa.x;
      const dyLine = sb.y - sa.y;
      const lineLen = Math.hypot(dxLine, dyLine) || 1;
      (groups[key] ||= []).push({
        fromId: forward ? a : b,
        toId: forward ? b : a,
        fromCell: forward ? fromCell : toCell,
        toCell: forward ? toCell : fromCell,
        lineId,
        color: line.color,
        worldHint: { x: dxLine / lineLen, y: dyLine / lineLen },
      });
    }
  }

  // 2. Build interlined runs within each group.
  const bands: SegmentBandSpec[] = [];

  for (const [pairKey, segs] of Object.entries(groups)) {
    // Bucket by world travel AXIS at each end (mod 4). Two lines on the same
    // station-pair that share an axis can render as a single band — even if
    // they traverse the corridor in opposite directions. Their stops are at
    // the same world positions either way; the band's flow direction is
    // metadata that doesn't affect the rendered shape.
    const buckets: Record<string, SegInfo[]> = {};
    for (const s of segs) {
      const fromS = stations[s.fromId];
      const toS = stations[s.toId];
      if (!fromS || !toS) continue;
      const fAxis = dirIndex8(travelDirWorld(s.fromCell, fromS, s.worldHint)) % 4;
      const tAxis = dirIndex8(travelDirWorld(s.toCell, toS, s.worldHint)) % 4;
      const key = `${fAxis}|${tAxis}`;
      (buckets[key] ||= []).push(s);
    }

    for (const bucket of Object.values(buckets)) {
      if (bucket.length === 0) continue;
      // Reference travel directions / perpendicular axes from the first segment.
      const sample = bucket[0];
      const fromS = stations[sample.fromId];
      const toS = stations[sample.toId];
      // Resolve sample's tangent (gives us the AXIS), then sign-flip if
      // needed so the band's flow points canonFrom → canonTo. Without this,
      // if `bucket[0]` happens to be a line traversing the corridor in
      // reverse alphabetic order, the router gets a U-turn input.
      const sampleFDir = travelDirWorld(sample.fromCell, fromS, sample.worldHint);
      const sampleTDir = travelDirWorld(sample.toCell, toS, sample.worldHint);
      const canonDx = toS.x - fromS.x;
      const canonDy = toS.y - fromS.y;
      const fSign = sampleFDir.x * canonDx + sampleFDir.y * canonDy >= 0 ? 1 : -1;
      const tSign = sampleTDir.x * canonDx + sampleTDir.y * canonDy >= 0 ? 1 : -1;
      const fDir: Vec2 = { x: sampleFDir.x * fSign, y: sampleFDir.y * fSign };
      const tDir: Vec2 = { x: sampleTDir.x * tSign, y: sampleTDir.y * tSign };
      // leftOf(motion) — must match the perpendicular convention used by
      // offsetFilletPath. With this, sorting ascending by perp-projection
      // assigns lower-k indices to lines on the negative-offset (right of
      // motion) side — exactly what `(k − (n−1)/2) * STOP_SIZE` produces.
      const fPerp: Vec2 = { x: fDir.y, y: -fDir.x };
      const tPerp: Vec2 = { x: tDir.y, y: -tDir.x };

      // Enrich with world perp/parallel positions at each end for sorting and
      // adjacency comparison.
      type Enriched = {
        seg: SegInfo;
        fPerpPos: number;
        fParPos: number;
        tPerpPos: number;
        tParPos: number;
      };
      const enriched: Enriched[] = bucket.map((s) => {
        const fp = stopPosWorld(s.fromCell, stations[s.fromId]);
        const tp = stopPosWorld(s.toCell, stations[s.toId]);
        return {
          seg: s,
          fPerpPos: fp.x * fPerp.x + fp.y * fPerp.y,
          fParPos: fp.x * fDir.x + fp.y * fDir.y,
          tPerpPos: tp.x * tPerp.x + tp.y * tPerp.y,
          tParPos: tp.x * tDir.x + tp.y * tDir.y,
        };
      });
      enriched.sort((a, b) => a.fPerpPos - b.fPerpPos);

      // Greedily merge contiguous perp-adjacency in WORLD coords (≈ STOP_SIZE
      // step) at both ends, with matching parallel position at both ends.
      let group: Enriched[] = [];
      const flush = () => {
        if (group.length === 0) return;
        bands.push(
          buildBandSpec(
            group.map((e) => e.seg),
            stations,
            curveRadius,
            pairKey,
            fDir,
            tDir,
          ),
        );
        group = [];
      };
      const TOL = 0.5;
      for (const e of enriched) {
        if (group.length === 0) {
          group.push(e);
          continue;
        }
        const prev = group[group.length - 1];
        const dFromPerp = e.fPerpPos - prev.fPerpPos;
        const dToPerp = e.tPerpPos - prev.tPerpPos;
        const sameParA = Math.abs(e.fParPos - prev.fParPos) < TOL;
        const sameParB = Math.abs(e.tParPos - prev.tParPos) < TOL;
        if (
          Math.abs(dFromPerp - STOP_SIZE) < TOL &&
          Math.abs(dToPerp - STOP_SIZE) < TOL &&
          sameParA &&
          sameParB
        ) {
          group.push(e);
        } else {
          flush();
          group.push(e);
        }
      }
      flush();
    }
  }

  // 3. Tag each band with its z-priority (min lineIndex of any contained
  // line). The actual sort happens in the renderer, where bands and stop
  // markers are merged into one pass.
  const lineIndex = buildLineIndex(lineOrder, lines);
  const fallback = Object.keys(lineIndex).length;
  for (const band of bands) {
    band.priority = Math.min(...band.lines.map((l) => lineIndex[l.id] ?? fallback));
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
  // The band's canonical-direction tangents (signed canonFrom→canonTo). Must
  // be the same fDir/tDir the bucket loop used for sorting/grouping so the
  // router and the merge basis agree.
  fromDir: Vec2,
  toDir: Vec2,
): SegmentBandSpec {
  const fromStation = stations[group[0].fromId];
  const toStation = stations[group[0].toId];

  // Centerline endpoints are the mean of the band's per-line stop centers in
  // WORLD coords. Travel directions also come from world (per-stop orientation
  // rotated by station rotation), so a band can span stations whose local
  // orientations differ as long as the world tangent matches.
  const fromWorlds = group.map((g) => stopPosWorld(g.fromCell, fromStation));
  const toWorlds = group.map((g) => stopPosWorld(g.toCell, toStation));
  const meanVec = (vs: Vec2[]): Vec2 => ({
    x: vs.reduce((a, p) => a + p.x, 0) / vs.length,
    y: vs.reduce((a, p) => a + p.y, 0) / vs.length,
  });
  const fromMeanWorld = meanVec(fromWorlds);
  const toMeanWorld = meanVec(toWorlds);

  const result = route(fromMeanWorld, fromDir, toMeanWorld, toDir, R);

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
