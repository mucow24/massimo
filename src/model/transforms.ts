import { autoOrientLineStops } from './autoOrient';
import { effectiveLineOrder } from './lineOrder';
import { rotateBy, stopCenterAt } from '../geometry/orientation';
import type {
  Line,
  LineId,
  LineTag,
  MapDoc,
  Rotation,
  Station,
  StationId,
  StopCell,
  StopOrientation,
} from './types';

export const DEFAULT_DOC: MapDoc = {
  stations: {},
  lines: {},
  lineOrder: [],
  curveRadius: 24,
  lineCounter: 0,
  lineTags: {},
};

// ---------- Stations ----------

export function addStation(doc: MapDoc, x: number, y: number, id: StationId, name: string): MapDoc {
  const station: Station = {
    id,
    name,
    x,
    y,
    rotation: 0,
    stops: [],
    label: { row: 0, col: -1, rotation: 0, offset: 0 },
  };
  return { ...doc, stations: { ...doc.stations, [id]: station } };
}

export function renameStation(doc: MapDoc, id: StationId, name: string): MapDoc {
  const cur = doc.stations[id];
  if (!cur) return doc;
  return { ...doc, stations: { ...doc.stations, [id]: { ...cur, name } } };
}

export function moveStation(doc: MapDoc, id: StationId, x: number, y: number): MapDoc {
  const cur = doc.stations[id];
  if (!cur) return doc;
  return { ...doc, stations: { ...doc.stations, [id]: { ...cur, x, y } } };
}

// For every line that contains both startId and endId, evenly redistribute
// the intervening stops by arc length along the existing polyline through
// those stops. If a station is intervening on multiple matching lines (its
// new position would be ambiguous), it is left untouched.
export function redistributeBetween(
  doc: MapDoc,
  startId: StationId,
  endId: StationId,
): MapDoc {
  if (startId === endId) return doc;
  if (!doc.stations[startId] || !doc.stations[endId]) return doc;

  const proposals = new Map<StationId, { x: number; y: number }>();
  const conflicted = new Set<StationId>();

  for (const line of Object.values(doc.lines)) {
    const iStart = line.stations.indexOf(startId);
    const iEnd = line.stations.indexOf(endId);
    if (iStart < 0 || iEnd < 0) continue;

    const iLow = Math.min(iStart, iEnd);
    const iHigh = Math.max(iStart, iEnd);
    const n = iHigh - iLow - 1;
    if (n < 1) continue;

    const ids = line.stations.slice(iLow, iHigh + 1);
    const sts = ids.map((id) => doc.stations[id]);
    if (sts.some((p) => !p)) continue;

    // The visible route runs through this line's STOPS, not station centers.
    // At interlined stations the stop is offset from the center, so a polyline
    // through centers can zigzag even when the stops are perfectly aligned.
    // Use stop world positions to drive the redistribution, then derive each
    // new station center from the new stop position.
    const stopOffsets = sts.map((st) => {
      const cell = st.stops.find((c) => c.lineId === line.id);
      if (!cell) return { x: 0, y: 0 };
      return rotateBy(stopCenterAt(cell.row, cell.col), st.rotation);
    });
    const stopPts = sts.map((st, i) => ({ x: st.x + stopOffsets[i].x, y: st.y + stopOffsets[i].y }));

    // Treat any intervening station that sits at a real bend in the polyline
    // as an additional anchor. Without this, the redistribute drags corner
    // stations along the straight-line shortcut between their neighbors,
    // breaking the corner geometry and the routing of any other line that
    // crosses through.
    const ANGLE_THRESHOLD = (5 * Math.PI) / 180;
    const anchors: number[] = [0];
    for (let k = 1; k < stopPts.length - 1; k++) {
      const ax = stopPts[k].x - stopPts[k - 1].x;
      const ay = stopPts[k].y - stopPts[k - 1].y;
      const bx = stopPts[k + 1].x - stopPts[k].x;
      const by = stopPts[k + 1].y - stopPts[k].y;
      const aLen = Math.hypot(ax, ay);
      const bLen = Math.hypot(bx, by);
      if (aLen === 0 || bLen === 0) continue;
      const cosA = (ax * bx + ay * by) / (aLen * bLen);
      const angle = Math.acos(Math.max(-1, Math.min(1, cosA)));
      if (angle > ANGLE_THRESHOLD) anchors.push(k);
    }
    anchors.push(stopPts.length - 1);

    // Redistribute within each anchor-to-anchor sub-chain independently.
    for (let a = 0; a < anchors.length - 1; a++) {
      const from = anchors[a];
      const to = anchors[a + 1];
      const subN = to - from - 1;
      if (subN < 1) continue;

      const subSegLens: number[] = [];
      for (let i = from; i < to; i++) {
        subSegLens.push(
          Math.hypot(stopPts[i + 1].x - stopPts[i].x, stopPts[i + 1].y - stopPts[i].y),
        );
      }
      const subTotal = subSegLens.reduce((s, v) => s + v, 0);
      if (subTotal === 0) continue;

      for (let k = 1; k <= subN; k++) {
        const target = (k * subTotal) / (subN + 1);
        let acc = 0;
        let stopX = stopPts[from].x;
        let stopY = stopPts[from].y;
        for (let i = 0; i < subSegLens.length; i++) {
          if (acc + subSegLens[i] >= target) {
            const t = subSegLens[i] === 0 ? 0 : (target - acc) / subSegLens[i];
            stopX = stopPts[from + i].x + t * (stopPts[from + i + 1].x - stopPts[from + i].x);
            stopY = stopPts[from + i].y + t * (stopPts[from + i + 1].y - stopPts[from + i].y);
            break;
          }
          acc += subSegLens[i];
        }
        const idx = from + k;
        const px = stopX - stopOffsets[idx].x;
        const py = stopY - stopOffsets[idx].y;
        const cur = sts[idx];
        // Skip sub-pixel drift to avoid breaking perfect snap alignments via
        // floating-point error.
        if (Math.hypot(px - cur.x, py - cur.y) < 1) continue;
        const stationId = ids[idx];
        const existing = proposals.get(stationId);
        if (existing) {
          if (Math.hypot(existing.x - px, existing.y - py) > 0.5) {
            conflicted.add(stationId);
          }
        } else {
          proposals.set(stationId, { x: px, y: py });
        }
      }
    }
  }

  for (const id of conflicted) proposals.delete(id);
  if (proposals.size === 0) return doc;

  let stations = doc.stations;
  for (const [id, p] of proposals) {
    const cur = stations[id];
    if (!cur) continue;
    stations = { ...stations, [id]: { ...cur, x: p.x, y: p.y } };
  }
  return { ...doc, stations };
}

export function rotateStation(doc: MapDoc, id: StationId): MapDoc {
  const cur = doc.stations[id];
  if (!cur) return doc;
  const next = ((cur.rotation + 1) % 8) as Rotation;
  return { ...doc, stations: { ...doc.stations, [id]: { ...cur, rotation: next } } };
}

/**
 * Rotate the station 180° and mirror the label so it stays on the same world
 * side as before.
 */
export function flipStation(doc: MapDoc, id: StationId): MapDoc {
  let next = doc;
  for (let i = 0; i < 4; i++) next = rotateStation(next, id);
  return mirrorLabel(next, id);
}

/**
 * Rotate the layout (col/row of every stop + label) 90° while rotating the
 * station the OPPOSITE way, so the world appearance stays the same but the
 * editor view of the unrotated grid is reoriented. Stop orientations and
 * label rotation are transformed in lockstep so world tangent directions
 * stay invariant too.
 *
 * dir = +1: layout rotates clockwise; station rotates CCW (rotation += 6).
 * dir = -1: layout rotates CCW; station rotates CW (rotation += 2).
 */
export function rotateStationAndLayout(doc: MapDoc, id: StationId, dir: -1 | 1): MapDoc {
  const cur = doc.stations[id];
  if (!cur) return doc;
  const stationStep = dir === 1 ? 6 : 2; // CCW for R+, CW for R-
  const nextRot = ((cur.rotation + stationStep) % 8) as Rotation;
  const rotateGrid = (col: number, row: number) =>
    dir === 1 ? { col: -row, row: col } : { col: row, row: -col };
  // Orientation maps so that the WORLD tangent direction is preserved across
  // the change in station rotation.
  // R+ (station CCW 90°): up→right, right→down, down→left, left→up.
  // R− (station CW 90°): up→left, left→down, down→right, right→up.
  const rotOrient = (o: StopOrientation): StopOrientation => {
    if (o === 'auto-vertical') return 'auto-horizontal';
    if (o === 'auto-horizontal') return 'auto-vertical';
    if (dir === 1) {
      if (o === 'up') return 'right';
      if (o === 'right') return 'down';
      if (o === 'down') return 'left';
      return 'up'; // o === 'left'
    } else {
      if (o === 'up') return 'left';
      if (o === 'left') return 'down';
      if (o === 'down') return 'right';
      return 'up'; // o === 'right'
    }
  };
  const stops = cur.stops.map((c) => {
    const r = rotateGrid(c.col, c.row);
    return { ...c, col: r.col, row: r.row, orientation: rotOrient(c.orientation) };
  });
  const lr = rotateGrid(cur.label.col, cur.label.row);
  // Label rotation is in the unrotated local frame; to keep its world
  // orientation, advance it the inverse of the station's step.
  const labelStep = dir === 1 ? 2 : 6;
  const labelRot = ((cur.label.rotation + labelStep) % 8) as Rotation;
  const label = { ...cur.label, col: lr.col, row: lr.row, rotation: labelRot };
  return {
    ...doc,
    stations: { ...doc.stations, [id]: { ...cur, rotation: nextRot, stops, label } },
  };
}

export function deleteStation(doc: MapDoc, id: StationId): MapDoc {
  const { [id]: _gone, ...rest } = doc.stations;
  const lines: Record<LineId, Line> = {};
  for (const lid of Object.keys(doc.lines)) {
    const ln = doc.lines[lid];
    lines[lid] = { ...ln, stations: ln.stations.filter((x) => x !== id) };
  }
  return pruneOrphanLineTags({ ...doc, stations: rest, lines });
}

// ---------- Stops ----------

export function moveStop(
  doc: MapDoc,
  stationId: StationId,
  lineId: LineId,
  dRow: number,
  dCol: number,
): MapDoc {
  const st = doc.stations[stationId];
  if (!st) return doc;
  const i = st.stops.findIndex((c) => c.lineId === lineId);
  if (i < 0) return doc;
  const cell = st.stops[i];
  const newRow = cell.row + dRow;
  const newCol = cell.col + dCol;
  // Stops can swap with another stop, but cannot enter the label cell.
  if (st.label.row === newRow && st.label.col === newCol) return doc;
  const j = st.stops.findIndex((c) => c.row === newRow && c.col === newCol);
  const newStops = st.stops.slice();
  if (j >= 0 && j !== i) {
    newStops[j] = { ...newStops[j], row: cell.row, col: cell.col };
  }
  newStops[i] = { ...cell, row: newRow, col: newCol };
  return { ...doc, stations: { ...doc.stations, [stationId]: { ...st, stops: newStops } } };
}

export function rotateStop(doc: MapDoc, stationId: StationId, lineId: LineId): MapDoc {
  const st = doc.stations[stationId];
  if (!st) return doc;
  const i = st.stops.findIndex((c) => c.lineId === lineId);
  if (i < 0) return doc;
  const cur = st.stops[i];
  // The UI exposes only the two auto-axis orientations; this toggles between
  // them. Explicit `up`/`down`/`left`/`right` remain valid in the model (and
  // in persisted docs), but rotating from one of those collapses to the auto
  // orientation on the opposite axis.
  const wasVertical =
    cur.orientation === 'auto-vertical' || cur.orientation === 'up' || cur.orientation === 'down';
  const next: StopOrientation = wasVertical ? 'auto-horizontal' : 'auto-vertical';
  if (next === cur.orientation) return doc;
  const newStops = st.stops.slice();
  newStops[i] = { ...cur, orientation: next };
  return { ...doc, stations: { ...doc.stations, [stationId]: { ...st, stops: newStops } } };
}

// ---------- Label ----------

export function moveLabel(doc: MapDoc, stationId: StationId, dRow: number, dCol: number): MapDoc {
  const st = doc.stations[stationId];
  if (!st) return doc;
  if (dRow === 0 && dCol === 0) return doc;
  // Step in the requested direction; if a stop occupies the destination, keep
  // stepping until we land on an empty cell. So [Label] O O O + → ends up
  // O O O [Label].
  let newRow = st.label.row + dRow;
  let newCol = st.label.col + dCol;
  while (st.stops.some((c) => c.row === newRow && c.col === newCol)) {
    newRow += dRow;
    newCol += dCol;
  }
  return {
    ...doc,
    stations: {
      ...doc.stations,
      [stationId]: { ...st, label: { ...st.label, row: newRow, col: newCol } },
    },
  };
}

export function rotateLabel(doc: MapDoc, stationId: StationId): MapDoc {
  const st = doc.stations[stationId];
  if (!st) return doc;
  const next = ((st.label.rotation + 1) % 8) as Rotation;
  return {
    ...doc,
    stations: {
      ...doc.stations,
      [stationId]: { ...st, label: { ...st.label, rotation: next } },
    },
  };
}

export function flipLabel(doc: MapDoc, stationId: StationId): MapDoc {
  const st = doc.stations[stationId];
  if (!st) return doc;
  const next = ((st.label.rotation + 4) % 8) as Rotation;
  return {
    ...doc,
    stations: {
      ...doc.stations,
      [stationId]: { ...st, label: { ...st.label, rotation: next } },
    },
  };
}

export function mirrorLabel(doc: MapDoc, stationId: StationId): MapDoc {
  const st = doc.stations[stationId];
  if (!st) return doc;
  if (st.stops.length === 0) {
    // Just flip the rotation; nothing to mirror around.
    const next = ((st.label.rotation + 4) % 8) as Rotation;
    return {
      ...doc,
      stations: {
        ...doc.stations,
        [stationId]: { ...st, label: { ...st.label, rotation: next } },
      },
    };
  }
  // Direction from the label to the stops' centroid (quantized to a single
  // dominant cardinal axis). The mirrored label sits one step past the
  // FURTHEST stop along that direction (and any stops beyond), so a label on
  // one side ends up on the opposite side of the entire footprint.
  const cx = st.stops.reduce((a, c) => a + c.col, 0) / st.stops.length;
  const cy = st.stops.reduce((a, c) => a + c.row, 0) / st.stops.length;
  const drRaw = cy - st.label.row;
  const dcRaw = cx - st.label.col;
  let dRow = 0;
  let dCol = 0;
  if (Math.abs(drRaw) > Math.abs(dcRaw)) dRow = Math.sign(drRaw) || 1;
  else dCol = Math.sign(dcRaw) || 1;
  // Furthest stop along (dRow, dCol).
  const proj = (r: number, c: number) => r * dRow + c * dCol;
  const maxProj = st.stops.reduce((m, cell) => Math.max(m, proj(cell.row, cell.col)), -Infinity);
  // Step past the max-projected stop (and any other stops at the same
  // projection level beyond) until we land on an empty cell. Safety bound.
  let newRow = st.label.row;
  let newCol = st.label.col;
  for (let k = 0; k < 1000; k++) {
    newRow += dRow;
    newCol += dCol;
    const beyond = proj(newRow, newCol) > maxProj;
    const empty = !st.stops.some((c) => c.row === newRow && c.col === newCol);
    if (beyond && empty) break;
  }
  const next = ((st.label.rotation + 4) % 8) as Rotation;
  return {
    ...doc,
    stations: {
      ...doc.stations,
      [stationId]: {
        ...st,
        label: { ...st.label, row: newRow, col: newCol, rotation: next },
      },
    },
  };
}

export function setLabelOffset(doc: MapDoc, stationId: StationId, offset: number): MapDoc {
  const st = doc.stations[stationId];
  if (!st) return doc;
  return {
    ...doc,
    stations: {
      ...doc.stations,
      [stationId]: { ...st, label: { ...st.label, offset } },
    },
  };
}

// ---------- Lines ----------

export function addLine(doc: MapDoc, id: LineId, service: string, color: string): MapDoc {
  const line: Line = { id, service, color, stations: [] };
  // New line goes on top of the layer stack (front-most).
  const order = effectiveLineOrder(doc.lineOrder, doc.lines);
  return {
    ...doc,
    lines: { ...doc.lines, [id]: line },
    lineOrder: [id, ...order],
    lineCounter: doc.lineCounter + 1,
  };
}

export function updateLine(
  doc: MapDoc,
  id: LineId,
  patch: Partial<Pick<Line, 'service' | 'color' | 'stations'>>,
): MapDoc {
  const cur = doc.lines[id];
  if (!cur) return doc;
  return { ...doc, lines: { ...doc.lines, [id]: { ...cur, ...patch } } };
}

export function toggleStationOnLine(
  doc: MapDoc,
  lineId: LineId,
  stationId: StationId,
  insertAfterIndex?: number,
): MapDoc {
  const ln = doc.lines[lineId];
  const st = doc.stations[stationId];
  if (!ln || !st) return doc;
  const inLine = ln.stations.includes(stationId);
  if (inLine) {
    // remove (all occurrences)
    const newStations = ln.stations.filter((x) => x !== stationId);
    const stillStops = newStations.includes(stationId);
    const newStops = stillStops ? st.stops : st.stops.filter((c) => c.lineId !== lineId);
    const stationsAfter = { ...doc.stations, [stationId]: { ...st, stops: newStops } };
    return {
      ...doc,
      lines: { ...doc.lines, [lineId]: { ...ln, stations: newStations } },
      stations: autoOrientLineStops(stationsAfter, lineId, newStations),
    };
  }
  const idx =
    insertAfterIndex === undefined
      ? ln.stations.length
      : Math.min(ln.stations.length, Math.max(0, insertAfterIndex + 1));
  const newStations = [...ln.stations.slice(0, idx), stationId, ...ln.stations.slice(idx)];
  // Add a stop cell if this line doesn't yet have one at the station.
  // Spawn at (0, maxCol+1) of existing footprint; (0, 0) when empty.
  const hasCell = st.stops.some((c) => c.lineId === lineId);
  let newStops = st.stops;
  if (!hasCell) {
    const maxCol =
      st.stops.length === 0 ? -1 : st.stops.reduce((m, c) => (c.col > m ? c.col : m), -Infinity);
    const newCell: StopCell = {
      lineId,
      row: 0,
      col: maxCol + 1,
      orientation: 'auto-vertical',
    };
    newStops = [...st.stops, newCell];
  }
  const stationsAfter = { ...doc.stations, [stationId]: { ...st, stops: newStops } };
  return {
    ...doc,
    lines: { ...doc.lines, [lineId]: { ...ln, stations: newStations } },
    stations: autoOrientLineStops(stationsAfter, lineId, newStations),
  };
}

export function removeStationFromLine(doc: MapDoc, lineId: LineId, idx: number): MapDoc {
  const ln = doc.lines[lineId];
  if (!ln) return doc;
  const removedStationId = ln.stations[idx];
  const newStations = [...ln.stations.slice(0, idx), ...ln.stations.slice(idx + 1)];
  // If the station is no longer on the line at all, drop its stop cell.
  const stillStops = newStations.includes(removedStationId);
  let stations = doc.stations;
  if (!stillStops && stations[removedStationId]) {
    const st = stations[removedStationId];
    stations = {
      ...stations,
      [removedStationId]: { ...st, stops: st.stops.filter((c) => c.lineId !== lineId) },
    };
  }
  return pruneOrphanLineTags({
    ...doc,
    lines: { ...doc.lines, [lineId]: { ...ln, stations: newStations } },
    stations: autoOrientLineStops(stations, lineId, newStations),
  });
}

export function reorderLineStations(doc: MapDoc, lineId: LineId, stations: StationId[]): MapDoc {
  const ln = doc.lines[lineId];
  if (!ln) return doc;
  return {
    ...doc,
    lines: { ...doc.lines, [lineId]: { ...ln, stations } },
    stations: autoOrientLineStops(doc.stations, lineId, stations),
  };
}

export function deleteLine(doc: MapDoc, id: LineId): MapDoc {
  const { [id]: _gone, ...rest } = doc.lines;
  const stations: Record<StationId, Station> = {};
  for (const sid of Object.keys(doc.stations)) {
    const st = doc.stations[sid];
    stations[sid] = { ...st, stops: st.stops.filter((c) => c.lineId !== id) };
  }
  const order = effectiveLineOrder(doc.lineOrder, doc.lines).filter((x) => x !== id);
  // Drop tags whose lineId matches; the rest are valid by construction.
  const lineTags: Record<string, LineTag> = {};
  for (const tid of Object.keys(doc.lineTags)) {
    if (doc.lineTags[tid].lineId !== id) lineTags[tid] = doc.lineTags[tid];
  }
  return { ...doc, lines: rest, stations, lineOrder: order, lineTags };
}

export function moveLineInOrder(doc: MapDoc, id: LineId, dir: -1 | 1): MapDoc {
  const order = effectiveLineOrder(doc.lineOrder, doc.lines).slice();
  const i = order.indexOf(id);
  if (i < 0) return doc;
  const j = i + dir;
  if (j < 0 || j >= order.length) return doc;
  [order[i], order[j]] = [order[j], order[i]];
  return { ...doc, lineOrder: order };
}

// ---------- Misc ----------

export function setCurveRadius(doc: MapDoc, r: number): MapDoc {
  return { ...doc, curveRadius: r };
}

export function clearAll(_doc: MapDoc): MapDoc {
  return { ...DEFAULT_DOC, lineTags: {} };
}

// ---------- Line tags ----------

export function addLineTag(
  doc: MapDoc,
  id: string,
  lineId: LineId,
  fromStationId: StationId,
  toStationId: StationId,
  anchorEnd: 'from' | 'to',
  distance: number,
  orientation: 0 | 1 | 2 | 3,
): MapDoc {
  const tag: LineTag = {
    id,
    lineId,
    fromStationId,
    toStationId,
    anchorEnd,
    distance,
    orientation,
  };
  return { ...doc, lineTags: { ...doc.lineTags, [id]: tag } };
}

export function moveLineTag(
  doc: MapDoc,
  id: string,
  fromStationId: StationId,
  toStationId: StationId,
  anchorEnd: 'from' | 'to',
  distance: number,
): MapDoc {
  const cur = doc.lineTags[id];
  if (!cur) return doc;
  return {
    ...doc,
    lineTags: {
      ...doc.lineTags,
      [id]: { ...cur, fromStationId, toStationId, anchorEnd, distance },
    },
  };
}

export function cycleLineTagOrientation(doc: MapDoc, id: string): MapDoc {
  const cur = doc.lineTags[id];
  if (!cur) return doc;
  const next = ((cur.orientation + 1) % 4) as 0 | 1 | 2 | 3;
  return { ...doc, lineTags: { ...doc.lineTags, [id]: { ...cur, orientation: next } } };
}

export function deleteLineTag(doc: MapDoc, id: string): MapDoc {
  if (!doc.lineTags[id]) return doc;
  const { [id]: _gone, ...rest } = doc.lineTags;
  return { ...doc, lineTags: rest };
}

/**
 * Drop any line tag whose corridor (fromStationId, toStationId) is no longer
 * a connected edge on the tag's line. Called after structural edits that
 * could orphan a tag — deleting a station, removing one from a line, etc.
 */
function pruneOrphanLineTags(doc: MapDoc): MapDoc {
  const next: Record<string, LineTag> = {};
  let changed = false;
  for (const tid of Object.keys(doc.lineTags)) {
    const tag = doc.lineTags[tid];
    const ln = doc.lines[tag.lineId];
    if (!ln || !isLineEdge(ln, tag.fromStationId, tag.toStationId)) {
      changed = true;
      continue;
    }
    next[tid] = tag;
  }
  return changed ? { ...doc, lineTags: next } : doc;
}

function isLineEdge(line: Line, a: StationId, b: StationId): boolean {
  for (let i = 0; i < line.stations.length - 1; i++) {
    const x = line.stations[i];
    const y = line.stations[i + 1];
    if ((x === a && y === b) || (x === b && y === a)) return true;
  }
  return false;
}
