import { autoOrientLineStops } from './autoOrient';
import { effectiveLineOrder } from './lineOrder';
import type {
  Line,
  LineId,
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
};

// ---------- Stations ----------

export function addStation(
  doc: MapDoc,
  x: number,
  y: number,
  id: StationId,
  name: string,
): MapDoc {
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
  return { ...doc, stations: rest, lines };
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
  // Cycle: auto-vertical → up → down → auto-horizontal → left → right
  const cycle: StopOrientation[] = [
    'auto-vertical',
    'up',
    'down',
    'auto-horizontal',
    'left',
    'right',
  ];
  const idx = cycle.indexOf(cur.orientation);
  const next = cycle[(idx + 1) % cycle.length];
  const newStops = st.stops.slice();
  newStops[i] = { ...cur, orientation: next };
  return { ...doc, stations: { ...doc.stations, [stationId]: { ...st, stops: newStops } } };
}

// ---------- Label ----------

export function moveLabel(
  doc: MapDoc,
  stationId: StationId,
  dRow: number,
  dCol: number,
): MapDoc {
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
  const maxProj = st.stops.reduce(
    (m, cell) => Math.max(m, proj(cell.row, cell.col)),
    -Infinity,
  );
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

export function addLine(
  doc: MapDoc,
  id: LineId,
  service: string,
  color: string,
): MapDoc {
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
  return {
    ...doc,
    lines: { ...doc.lines, [lineId]: { ...ln, stations: newStations } },
    stations: autoOrientLineStops(stations, lineId, newStations),
  };
}

export function reorderLineStations(
  doc: MapDoc,
  lineId: LineId,
  stations: StationId[],
): MapDoc {
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
  return { ...doc, lines: rest, stations, lineOrder: order };
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
  return { ...DEFAULT_DOC };
}
