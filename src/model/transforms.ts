import { autoOrientLineStops } from './autoOrient';
import { effectiveLineOrder } from './lineOrder';
import { pairKeyOf } from './pairKey';
import { rotateBy, stopCenterAt } from '../geometry/orientation';
import { measureTextLabel } from '../geometry/textMeasure';
import { PALETTES, type PaletteId } from './palettes';
import type {
  DotShape,
  LabelAlign,
  LabelValign,
  Line,
  LineId,
  LineStyle,
  LineTag,
  MapDoc,
  Rotation,
  RouteBullet,
  Station,
  StationId,
  StopCell,
  StopOrientation,
  TextLabel,
  TextLabelWeight,
  Transfer,
} from './types';

export const LABEL_FONT_SIZE_MIN = 2;
export const LABEL_FONT_SIZE_MAX = 24;
export const LABEL_FONT_SIZE_DEFAULT = 12;

export const TRANSFER_THICKNESS_MIN = 1;
export const TRANSFER_THICKNESS_MAX = 14;
export const TRANSFER_THICKNESS_DEFAULT = 2;
export const TRANSFER_COLOR_DEFAULT = '#000000';

export const TRANSFER_STROKE_WIDTH_MIN = 0;
export const TRANSFER_STROKE_WIDTH_MAX = 5;
export const TRANSFER_STROKE_WIDTH_DEFAULT = 0;
export const TRANSFER_STROKE_COLOR_DEFAULT = '#ffffff';

// Helvetica Neue weights we ship in /public/fonts/. No 600 — we don't have a
// SemiBold face. Single source of truth for both the text-label popover and
// the station-label settings dropdown.
export const LABEL_WEIGHT_VALUES: readonly TextLabelWeight[] = [
  100, 200, 300, 400, 500, 700, 800, 900,
] as const;

export const LABEL_WEIGHT_NAMES: readonly { value: TextLabelWeight; name: string }[] = [
  { value: 100, name: 'UltraLight' },
  { value: 200, name: 'Thin' },
  { value: 300, name: 'Light' },
  { value: 400, name: 'Roman' },
  { value: 500, name: 'Medium' },
  { value: 700, name: 'Bold' },
  { value: 800, name: 'Heavy' },
  { value: 900, name: 'Black' },
] as const;

export const LABEL_WEIGHT_DEFAULT: TextLabelWeight = 400;

export const DEFAULT_DOC: MapDoc = {
  stations: {},
  lines: {},
  lineOrder: [],
  curveRadius: 24,
  lineCounter: 0,
  lineTags: {},
  routeBullets: {},
  transfers: {},
  textLabels: {},
  labelFontSize: LABEL_FONT_SIZE_DEFAULT,
  labelWeight: LABEL_WEIGHT_DEFAULT,
  labelItalic: false,
  activePalettes: ['mta'],
  transferThickness: TRANSFER_THICKNESS_DEFAULT,
  transferColor: TRANSFER_COLOR_DEFAULT,
  transferStrokeWidth: TRANSFER_STROKE_WIDTH_DEFAULT,
  transferStrokeColor: TRANSFER_STROKE_COLOR_DEFAULT,
};

/**
 * Shift a weight `delta` positions along LABEL_WEIGHT_VALUES (clamped at the
 * ends). Used by the per-station bold flag (+2) and the hover bump (+2 from
 * whatever the station currently resolves to).
 *
 * Unknown weights pass through unchanged — keeps the function tolerant if a
 * file ever lands with an out-of-band value.
 */
export function bumpWeightByIndex(weight: TextLabelWeight, delta: number): TextLabelWeight {
  const i = LABEL_WEIGHT_VALUES.indexOf(weight);
  if (i < 0) return weight;
  const next = Math.max(0, Math.min(LABEL_WEIGHT_VALUES.length - 1, i + delta));
  return LABEL_WEIGHT_VALUES[next];
}

/**
 * Resolve the rendered weight for a station label, given the doc default and
 * the station's per-station bold flag. `stationBold` true bumps two indices
 * heavier (Regular → Bold), saturating at Black.
 */
export function resolveStationLabelWeight(
  defaultWeight: TextLabelWeight,
  stationBold: boolean | undefined,
): TextLabelWeight {
  return stationBold ? bumpWeightByIndex(defaultWeight, 2) : defaultWeight;
}

// TextLabel constants and defaults — exported so the popover, placement
// preview, and tests share a single source of truth.
export const TEXT_LABEL_FONT_SIZE_MIN = 1;
export const TEXT_LABEL_FONT_SIZE_MAX = 96;
export const TEXT_LABEL_DEFAULTS: Omit<TextLabel, 'id' | 'x' | 'y'> = {
  rotation: 0,
  text: 'New Label',
  fontSize: 16,
  weight: 400,
  italic: false,
  align: 'left',
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
    label: {
      row: 0,
      col: -1,
      rotation: 0,
      offset: 0,
      offsetPerp: 0,
      align: 'auto',
      valign: 'auto-down',
    },
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

/**
 * Resolve the glyph for a stop: explicit per-stop `dotShape` wins, else the
 * line's `defaultDotShape`, else the historical `'filled-black'` default.
 */
export function resolveDotShape(line: Line | undefined, stop: StopCell | undefined): DotShape {
  return stop?.dotShape ?? line?.defaultDotShape ?? 'filled-black';
}

export function setDotShape(
  doc: MapDoc,
  stationId: StationId,
  lineId: LineId,
  shape: DotShape,
): MapDoc {
  const cur = doc.stations[stationId];
  if (!cur) return doc;
  // Picking the line's effective default for a stop clears the per-stop
  // override so the stop tracks the default going forward (and so persisted
  // state stays clean — same pattern as `segmentStyles` + 'solid').
  const lineDefault = doc.lines[lineId]?.defaultDotShape ?? 'filled-black';
  const targetShape: DotShape | undefined = shape === lineDefault ? undefined : shape;
  let changed = false;
  const stops = cur.stops.map((s) => {
    if (s.lineId !== lineId) return s;
    if (s.dotShape === targetShape) return s;
    changed = true;
    if (targetShape === undefined) {
      const { dotShape: _gone, ...rest } = s;
      return rest;
    }
    return { ...s, dotShape: targetShape };
  });
  if (!changed) return doc;
  return { ...doc, stations: { ...doc.stations, [stationId]: { ...cur, stops } } };
}

export function setLineDefaultDotShape(doc: MapDoc, id: LineId, shape: DotShape): MapDoc {
  const cur = doc.lines[id];
  if (!cur) return doc;
  // `'filled-black'` is the historical default; omit the field so persisted
  // state stays clean (mirrors `setLineSegmentStyle` + 'solid').
  let nextLine: Line;
  if (shape === 'filled-black') {
    if (cur.defaultDotShape === undefined) return doc;
    const { defaultDotShape: _gone, ...rest } = cur;
    nextLine = rest;
  } else {
    if (cur.defaultDotShape === shape) return doc;
    nextLine = { ...cur, defaultDotShape: shape };
  }
  // Any per-stop override on this line that matches the NEW default is now
  // redundant — drop it so the stop tracks the default going forward.
  let stations = doc.stations;
  for (const sid of Object.keys(stations)) {
    const st = stations[sid];
    let stopsChanged = false;
    const stops = st.stops.map((s) => {
      if (s.lineId !== id || s.dotShape !== shape) return s;
      stopsChanged = true;
      const { dotShape: _gone, ...rest } = s;
      return rest;
    });
    if (stopsChanged) stations = { ...stations, [sid]: { ...st, stops } };
  }
  return { ...doc, lines: { ...doc.lines, [id]: nextLine }, stations };
}

export function setStationWaypoint(doc: MapDoc, stationId: StationId, isWaypoint: boolean): MapDoc {
  const cur = doc.stations[stationId];
  if (!cur) return doc;
  if (!!cur.isWaypoint === isWaypoint) return doc;
  return {
    ...doc,
    stations: { ...doc.stations, [stationId]: { ...cur, isWaypoint } },
  };
}

// For every line that contains both startId and endId, evenly redistribute
// the intervening stops by arc length along the existing polyline through
// those stops. If a station is intervening on multiple matching lines (its
// new position would be ambiguous), it is left untouched.
export type RedistributeMode =
  // Arc length along the existing polyline; corner stations are treated as
  // additional anchors. Used for ctrl-click (one-shot).
  | 'arc-bends'
  // Straight-line interpolation between A and B's stop positions. Used for
  // ctrl-drag — gives predictable, wiggle-free even spacing as B moves.
  | 'straight';

export function redistributeBetween(
  doc: MapDoc,
  startId: StationId,
  endId: StationId,
  mode: RedistributeMode = 'arc-bends',
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
    const stopPts = sts.map((st, i) => ({
      x: st.x + stopOffsets[i].x,
      y: st.y + stopOffsets[i].y,
    }));

    // Build the list of anchor indices (positions whose stop is fixed).
    // Always anchor the endpoints; arc-bends mode also anchors any intervening
    // station that sits at a real bend in the existing polyline.
    const anchors: number[] = [0];
    if (mode === 'arc-bends') {
      const ANGLE_THRESHOLD = (5 * Math.PI) / 180;
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
    }
    anchors.push(stopPts.length - 1);

    // Redistribute within each anchor-to-anchor sub-chain.
    for (let a = 0; a < anchors.length - 1; a++) {
      const from = anchors[a];
      const to = anchors[a + 1];
      const subN = to - from - 1;
      if (subN < 1) continue;

      // Compute the target stop position for each non-anchor station k.
      const targets: { x: number; y: number }[] = [];
      if (mode === 'straight') {
        // Straight-line interpolation between the anchor endpoints.
        const ax = stopPts[from].x;
        const ay = stopPts[from].y;
        const bx = stopPts[to].x;
        const by = stopPts[to].y;
        for (let k = 1; k <= subN; k++) {
          const t = k / (subN + 1);
          targets.push({ x: ax + t * (bx - ax), y: ay + t * (by - ay) });
        }
      } else {
        // Arc length along the existing sub-polyline.
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
          let sx = stopPts[from].x;
          let sy = stopPts[from].y;
          for (let i = 0; i < subSegLens.length; i++) {
            if (acc + subSegLens[i] >= target) {
              const t = subSegLens[i] === 0 ? 0 : (target - acc) / subSegLens[i];
              sx = stopPts[from + i].x + t * (stopPts[from + i + 1].x - stopPts[from + i].x);
              sy = stopPts[from + i].y + t * (stopPts[from + i + 1].y - stopPts[from + i].y);
              break;
            }
            acc += subSegLens[i];
          }
          targets.push({ x: sx, y: sy });
        }
      }

      for (let k = 1; k <= subN; k++) {
        const idx = from + k;
        const t = targets[k - 1];
        const px = t.x - stopOffsets[idx].x;
        const py = t.y - stopOffsets[idx].y;
        const cur = sts[idx];
        // In arc modes, skip sub-pixel drift to avoid breaking perfect snap
        // alignments via floating-point error. Straight-line is exact by
        // construction — and in drag mode tiny per-frame shifts must apply
        // or stations near the anchor lag behind and wobble off the line.
        if (mode !== 'straight' && Math.hypot(px - cur.x, py - cur.y) < 1) continue;
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
 * Rotate a group of stations 45° clockwise around a pivot. Each station's
 * own rotation field advances by one step (matching the single-station
 * `rotateStation` behavior), so each station's stops/label rotate in place
 * as if right-clicked individually. In addition, every non-pivot station's
 * world position is rotated 45° around the pivot's center, preserving the
 * group's relative geometry as a rigid body.
 */
export function rotateStationsAround(doc: MapDoc, pivotId: StationId, ids: StationId[]): MapDoc {
  const pivot = doc.stations[pivotId];
  if (!pivot) return doc;
  const ang = Math.PI / 4;
  const cs = Math.cos(ang);
  const sn = Math.sin(ang);
  let stations = doc.stations;
  for (const id of ids) {
    const cur = stations[id];
    if (!cur) continue;
    const nextRot = ((cur.rotation + 1) % 8) as Rotation;
    let nx = cur.x;
    let ny = cur.y;
    if (id !== pivotId) {
      const dx = cur.x - pivot.x;
      const dy = cur.y - pivot.y;
      nx = pivot.x + dx * cs - dy * sn;
      ny = pivot.y + dx * sn + dy * cs;
    }
    stations = { ...stations, [id]: { ...cur, rotation: nextRot, x: nx, y: ny } };
  }
  return { ...doc, stations };
}

/**
 * Reference to a member of a station+bullet+label multi-selection. Used by
 * `rotateItemsAround` to identify which doc collection each member lives
 * in without requiring callers to pre-split by type.
 */
export interface ItemRef {
  type: 'station' | 'bullet' | 'label';
  id: string;
}

/**
 * Generalized version of `rotateStationsAround` that handles a mixed
 * station+bullet+label selection. Pivot can be any of the three types. Each
 * member's own rotation steps by one; non-pivot members orbit 45° clockwise
 * around the pivot's world position. Members whose ids are missing from the
 * doc are silently skipped — selection state can outlive a doc edit (undo).
 */
export function rotateItemsAround(doc: MapDoc, pivot: ItemRef, members: ItemRef[]): MapDoc {
  const pivotItem =
    pivot.type === 'station'
      ? doc.stations[pivot.id]
      : pivot.type === 'bullet'
        ? doc.routeBullets[pivot.id]
        : doc.textLabels[pivot.id];
  if (!pivotItem) return doc;
  const px = pivotItem.x;
  const py = pivotItem.y;
  const ang = Math.PI / 4;
  const cs = Math.cos(ang);
  const sn = Math.sin(ang);

  let stations = doc.stations;
  let routeBullets = doc.routeBullets;
  let textLabels = doc.textLabels;

  for (const m of members) {
    const isPivot = m.type === pivot.type && m.id === pivot.id;
    if (m.type === 'station') {
      const cur = stations[m.id];
      if (!cur) continue;
      const nextRot = ((cur.rotation + 1) % 8) as Rotation;
      let nx = cur.x;
      let ny = cur.y;
      if (!isPivot) {
        const dx = cur.x - px;
        const dy = cur.y - py;
        nx = px + dx * cs - dy * sn;
        ny = py + dx * sn + dy * cs;
      }
      stations = { ...stations, [m.id]: { ...cur, rotation: nextRot, x: nx, y: ny } };
    } else if (m.type === 'bullet') {
      const cur = routeBullets[m.id];
      if (!cur) continue;
      const nextRot = ((cur.rotation + 1) % 8) as Rotation;
      let nx = cur.x;
      let ny = cur.y;
      if (!isPivot) {
        const dx = cur.x - px;
        const dy = cur.y - py;
        nx = px + dx * cs - dy * sn;
        ny = py + dx * sn + dy * cs;
      }
      routeBullets = {
        ...routeBullets,
        [m.id]: { ...cur, rotation: nextRot, x: nx, y: ny },
      };
    } else {
      const cur = textLabels[m.id];
      if (!cur) continue;
      const nextRot = ((cur.rotation + 1) % 8) as Rotation;
      let nx = cur.x;
      let ny = cur.y;
      if (!isPivot) {
        const dx = cur.x - px;
        const dy = cur.y - py;
        nx = px + dx * cs - dy * sn;
        ny = py + dx * sn + dy * cs;
      }
      textLabels = {
        ...textLabels,
        [m.id]: { ...cur, rotation: nextRot, x: nx, y: ny },
      };
    }
  }
  return { ...doc, stations, routeBullets, textLabels };
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
 * Pure helper: rotate the layout (col/row of every stop + label) 90° while
 * rotating the station the OPPOSITE way, so world appearance stays the same
 * but the editor view of the unrotated grid is reoriented. Stop orientations
 * and label rotation are transformed in lockstep so world tangent directions
 * stay invariant too.
 *
 * dir = +1: layout rotates clockwise; station rotates CCW (rotation += 6).
 * dir = -1: layout rotates CCW; station rotates CW (rotation += 2).
 *
 * Exported so that `matching.ts` can use the same transform to canonicalize
 * a station's structural identity across the 4-fold mirror symmetry.
 */
export function rotateStationLayoutBy90(station: Station, dir: -1 | 1): Station {
  const stationStep = dir === 1 ? 6 : 2; // CCW for R+, CW for R-
  const nextRot = ((station.rotation + stationStep) % 8) as Rotation;
  const rotateGrid = (col: number, row: number) =>
    dir === 1 ? { col: -row, row: col } : { col: row, row: -col };
  // Orientation maps so that the WORLD tangent direction is preserved across
  // the change in station rotation. A ±90° rotation swaps each axis with its
  // perpendicular partner: N/S ↔ E/W, NE/SW ↔ NW/SE.
  const rotOrient = (o: StopOrientation): StopOrientation => {
    if (o === 'auto-vertical') return 'auto-horizontal';
    if (o === 'auto-horizontal') return 'auto-vertical';
    if (o === 'auto-ne-sw') return 'auto-nw-se';
    return 'auto-ne-sw';
  };
  const stops = station.stops.map((c) => {
    const r = rotateGrid(c.col, c.row);
    return { ...c, col: r.col, row: r.row, orientation: rotOrient(c.orientation) };
  });
  const lr = rotateGrid(station.label.col, station.label.row);
  // Label rotation is in the unrotated local frame; to keep its world
  // orientation, advance it the inverse of the station's step.
  const labelStep = dir === 1 ? 2 : 6;
  const labelRot = ((station.label.rotation + labelStep) % 8) as Rotation;
  const label = { ...station.label, col: lr.col, row: lr.row, rotation: labelRot };
  return { ...station, rotation: nextRot, stops, label };
}

export function rotateStationAndLayout(doc: MapDoc, id: StationId, dir: -1 | 1): MapDoc {
  const cur = doc.stations[id];
  if (!cur) return doc;
  return {
    ...doc,
    stations: { ...doc.stations, [id]: rotateStationLayoutBy90(cur, dir) },
  };
}

export function deleteStation(doc: MapDoc, id: StationId): MapDoc {
  const { [id]: _gone, ...rest } = doc.stations;
  const lines: Record<LineId, Line> = {};
  for (const lid of Object.keys(doc.lines)) {
    const ln = doc.lines[lid];
    lines[lid] = { ...ln, stations: ln.stations.filter((x) => x !== id) };
  }
  // Cascade-delete transfers that referenced the removed station.
  const transfers: Record<string, Transfer> = {};
  for (const xid of Object.keys(doc.transfers)) {
    const t = doc.transfers[xid];
    if (t.a.stationId !== id && t.b.stationId !== id) transfers[xid] = t;
  }
  return pruneOrphanLineTags({ ...doc, stations: rest, lines, transfers });
}

// ---------- Stops ----------

// Float-tolerant "same cell" — row/col are no longer constrained to integers
// (diagonal moves use ±√2/2), so equality must allow small drift.
const CELL_EPS = 1e-4;
const sameCell = (a: { row: number; col: number }, b: { row: number; col: number }): boolean =>
  Math.abs(a.row - b.row) < CELL_EPS && Math.abs(a.col - b.col) < CELL_EPS;

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
  const target = { row: newRow, col: newCol };
  // Stops can swap with another stop, but cannot enter the label cell.
  if (sameCell(st.label, target)) return doc;
  const j = st.stops.findIndex((c) => sameCell(c, target));
  const newStops = st.stops.slice();
  if (j >= 0 && j !== i) {
    newStops[j] = { ...newStops[j], row: cell.row, col: cell.col };
  }
  newStops[i] = { ...cell, row: newRow, col: newCol };
  return { ...doc, stations: { ...doc.stations, [stationId]: { ...st, stops: newStops } } };
}

const AXIS_CYCLE: StopOrientation[] = [
  'auto-vertical', // 0 — N/S
  'auto-ne-sw', // 1 — NE/SW
  'auto-horizontal', // 2 — E/W
  'auto-nw-se', // 3 — NW/SE
];

export function rotateStop(doc: MapDoc, stationId: StationId, lineId: LineId): MapDoc {
  const st = doc.stations[stationId];
  if (!st) return doc;
  const i = st.stops.findIndex((c) => c.lineId === lineId);
  if (i < 0) return doc;
  const cur = st.stops[i];
  const idx = AXIS_CYCLE.indexOf(cur.orientation);
  const next = AXIS_CYCLE[(idx + 1) % 4];
  if (next === cur.orientation) return doc;
  const newStops = st.stops.slice();
  newStops[i] = { ...cur, orientation: next };
  return { ...doc, stations: { ...doc.stations, [stationId]: { ...st, stops: newStops } } };
}

// ---------- Label ----------

export function moveLabel(doc: MapDoc, stationId: StationId, dRow: number, dCol: number): MapDoc {
  const st = doc.stations[stationId];
  if (!st) return doc;
  if (Math.abs(dRow) < CELL_EPS && Math.abs(dCol) < CELL_EPS) return doc;
  // Step in the requested direction; if a stop occupies the destination, keep
  // stepping until we land on an empty cell. So [Label] O O O + → ends up
  // O O O [Label]. Bounded by stop count so a degenerate step (all zeros)
  // can't spin — already guarded above, but belt + suspenders.
  let newRow = st.label.row + dRow;
  let newCol = st.label.col + dCol;
  for (let safety = 0; safety < st.stops.length + 1; safety++) {
    if (!st.stops.some((c) => sameCell(c, { row: newRow, col: newCol }))) break;
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
    const beyond = proj(newRow, newCol) > maxProj + CELL_EPS;
    const empty = !st.stops.some((c) => sameCell(c, { row: newRow, col: newCol }));
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

export function setLabelOffsetPerp(doc: MapDoc, stationId: StationId, offsetPerp: number): MapDoc {
  const st = doc.stations[stationId];
  if (!st) return doc;
  if ((st.label.offsetPerp ?? 0) === offsetPerp) return doc;
  return {
    ...doc,
    stations: {
      ...doc.stations,
      [stationId]: { ...st, label: { ...st.label, offsetPerp } },
    },
  };
}

const ALIGN_CYCLE: LabelAlign[] = ['auto', 'start', 'middle', 'end'];

export function cycleLabelAlign(doc: MapDoc, stationId: StationId): MapDoc {
  const st = doc.stations[stationId];
  if (!st) return doc;
  const cur = st.label.align;
  const i = ALIGN_CYCLE.indexOf(cur);
  const next = ALIGN_CYCLE[(i + 1) % ALIGN_CYCLE.length];
  return {
    ...doc,
    stations: {
      ...doc.stations,
      [stationId]: { ...st, label: { ...st.label, align: next } },
    },
  };
}

export function setLabelAlign(doc: MapDoc, stationId: StationId, align: LabelAlign): MapDoc {
  const st = doc.stations[stationId];
  if (!st) return doc;
  if (st.label.align === align) return doc;
  return {
    ...doc,
    stations: {
      ...doc.stations,
      [stationId]: { ...st, label: { ...st.label, align } },
    },
  };
}

// 'auto-down' leads the cycle so the (new) default sits at index 0 —
// advancing forward from a freshly created station immediately moves through
// the classic block-aligned options. The cycle order is geometrically
// symmetric: auto-down (block top pinned, grows down) → top → middle → bottom
// → auto-up (block bottom pinned, grows up) → back to auto-down.
const VALIGN_CYCLE: LabelValign[] = ['auto-down', 'top', 'middle', 'bottom', 'auto-up'];

export function cycleLabelValign(doc: MapDoc, stationId: StationId): MapDoc {
  const st = doc.stations[stationId];
  if (!st) return doc;
  const cur = st.label.valign;
  const i = VALIGN_CYCLE.indexOf(cur);
  const next = VALIGN_CYCLE[(i + 1) % VALIGN_CYCLE.length];
  return {
    ...doc,
    stations: {
      ...doc.stations,
      [stationId]: { ...st, label: { ...st.label, valign: next } },
    },
  };
}

export function setLabelValign(doc: MapDoc, stationId: StationId, valign: LabelValign): MapDoc {
  const st = doc.stations[stationId];
  if (!st) return doc;
  if (st.label.valign === valign) return doc;
  return {
    ...doc,
    stations: {
      ...doc.stations,
      [stationId]: { ...st, label: { ...st.label, valign } },
    },
  };
}

// ---------- Lines ----------

export function addLine(doc: MapDoc, id: LineId, service: string, color: string): MapDoc {
  const line: Line = { id, service, name: `${service} line`, color, stations: [] };
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
  patch: Partial<Pick<Line, 'service' | 'name' | 'color' | 'stations'>>,
): MapDoc {
  const cur = doc.lines[id];
  if (!cur) return doc;
  const nextLine = { ...cur, ...patch };
  const lines = { ...doc.lines, [id]: nextLine };
  if (patch.service === undefined || patch.service === cur.service) {
    return { ...doc, lines };
  }
  // Service code changed — rewrite any `<oldService>` inline-bullet tokens in
  // station names and text labels to `<newService>` so bullet glyphs keep
  // referring to the same line. Match is exact-substring on the literal
  // bullet form: per parseLabelLine the bullet code can't contain `<` or `>`,
  // so a `<code>` substring is always parsed as a bullet — no false hits.
  const oldToken = `<${cur.service}>`;
  const newToken = `<${nextLine.service}>`;
  const rewrite = (s: string): string =>
    s.includes(oldToken) ? s.split(oldToken).join(newToken) : s;
  const stations = mapRecord(doc.stations, (st) => {
    const name = rewrite(st.name);
    return name === st.name ? st : { ...st, name };
  });
  const textLabels = mapRecord(doc.textLabels, (lbl) => {
    const text = rewrite(lbl.text);
    return text === lbl.text ? lbl : { ...lbl, text };
  });
  return { ...doc, lines, stations, textLabels };
}

function mapRecord<T>(rec: Record<string, T>, f: (v: T) => T): Record<string, T> {
  let changed = false;
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(rec)) {
    const nv = f(v);
    if (nv !== v) changed = true;
    out[k] = nv;
  }
  return changed ? out : rec;
}

export function setLineSegmentStyle(
  doc: MapDoc,
  id: LineId,
  fromStationId: StationId,
  toStationId: StationId,
  style: LineStyle,
): MapDoc {
  const cur = doc.lines[id];
  if (!cur) return doc;
  const key = pairKeyOf(fromStationId, toStationId);
  const prev = cur.segmentStyles ?? {};
  let next: Record<string, LineStyle>;
  if (style === 'solid') {
    if (!(key in prev)) return doc;
    const { [key]: _gone, ...rest } = prev;
    next = rest;
  } else {
    if (prev[key] === style) return doc;
    next = { ...prev, [key]: style };
  }
  return { ...doc, lines: { ...doc.lines, [id]: { ...cur, segmentStyles: next } } };
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
  // Spawn one column east of the rightmost existing stop (or at (0, 0) when
  // empty). Anchoring on a real stop — not the bounding-box corner — keeps
  // the new cell 8-adjacent to that stop, so the layout never gains an
  // orphan even when existing stops sit at non-zero rows.
  const hasCell = st.stops.some((c) => c.lineId === lineId);
  let newStops = st.stops;
  let newLabel = st.label;
  if (!hasCell) {
    const anchor =
      st.stops.length === 0
        ? null
        : st.stops.reduce((best, c) => (c.col > best.col ? c : best), st.stops[0]);
    const newRow = anchor ? anchor.row : 0;
    const newCol = anchor ? anchor.col + 1 : 0;
    const newCell: StopCell = {
      lineId,
      row: newRow,
      col: newCol,
      orientation: 'auto-vertical',
    };
    newStops = [...st.stops, newCell];
    // If the auto-placed label sits exactly where the new stop is landing,
    // step it past the stop block so the new line doesn't paint over it.
    // We only nudge auto labels — manual alignments are user-pinned and
    // shouldn't move out from under the user.
    if (st.label.align === 'auto' && sameCell(st.label, { row: newRow, col: newCol })) {
      let lc = newCol;
      while (newStops.some((c) => sameCell(c, { row: newRow, col: lc }))) lc += 1;
      newLabel = { ...st.label, row: newRow, col: lc };
    }
  }
  const stationsAfter = {
    ...doc.stations,
    [stationId]: { ...st, stops: newStops, label: newLabel },
  };
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
  const updatedLine = pruneOrphanSegmentStyles({ ...ln, stations: newStations });
  return pruneOrphanLineTags({
    ...doc,
    lines: { ...doc.lines, [lineId]: updatedLine },
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
  // Null out any route bullets that referenced this line; the bullet stays
  // on the canvas but reverts to "unset" until the user picks a new line.
  const routeBullets: Record<string, RouteBullet> = {};
  for (const bid of Object.keys(doc.routeBullets)) {
    const b = doc.routeBullets[bid];
    routeBullets[bid] = b.lineId === id ? { ...b, lineId: null } : b;
  }
  // Null out lineId on transfer endpoints that pointed at this line; the
  // transfer stays in place, just falls back to the station anchor.
  const transfers: Record<string, Transfer> = {};
  for (const xid of Object.keys(doc.transfers)) {
    const t = doc.transfers[xid];
    const a = t.a.lineId === id ? { ...t.a, lineId: null } : t.a;
    const b = t.b.lineId === id ? { ...t.b, lineId: null } : t.b;
    transfers[xid] = a === t.a && b === t.b ? t : { ...t, a, b };
  }
  return { ...doc, lines: rest, stations, lineOrder: order, lineTags, routeBullets, transfers };
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

export function setLabelFontSize(doc: MapDoc, n: number): MapDoc {
  const clamped = Math.max(LABEL_FONT_SIZE_MIN, Math.min(LABEL_FONT_SIZE_MAX, Math.round(n)));
  if (clamped === doc.labelFontSize) return doc;
  return { ...doc, labelFontSize: clamped };
}

// Clamps at the bottom (MIN) so 0/negative are never persisted, but does NOT
// clamp at the top — the textbox lets users enter arbitrary thicknesses
// outside the slider's range. TRANSFER_THICKNESS_MAX constrains the slider
// only.
export function setTransferThickness(doc: MapDoc, n: number): MapDoc {
  if (!Number.isFinite(n)) return doc;
  const clamped = Math.max(TRANSFER_THICKNESS_MIN, Math.round(n));
  if (clamped === doc.transferThickness) return doc;
  return { ...doc, transferThickness: clamped };
}

export function setTransferColor(doc: MapDoc, c: string): MapDoc {
  if (c === doc.transferColor) return doc;
  return { ...doc, transferColor: c };
}

// Always-on outline around the colored body. Unlike thickness, this clamps
// on BOTH ends: the slider's [0, 5] range is the meaningful design space
// for a halo, and unbounded values would let users hide the body entirely
// under a massive stroke.
export function setTransferStrokeWidth(doc: MapDoc, n: number): MapDoc {
  if (!Number.isFinite(n)) return doc;
  const clamped = Math.max(
    TRANSFER_STROKE_WIDTH_MIN,
    Math.min(TRANSFER_STROKE_WIDTH_MAX, Math.round(n)),
  );
  if (clamped === doc.transferStrokeWidth) return doc;
  return { ...doc, transferStrokeWidth: clamped };
}

export function setTransferStrokeColor(doc: MapDoc, c: string): MapDoc {
  if (c === doc.transferStrokeColor) return doc;
  return { ...doc, transferStrokeColor: c };
}

export function setLabelWeight(doc: MapDoc, w: TextLabelWeight): MapDoc {
  if (w === doc.labelWeight) return doc;
  return { ...doc, labelWeight: w };
}

export function setStationLabelBold(doc: MapDoc, stationId: StationId, bold: boolean): MapDoc {
  const cur = doc.stations[stationId];
  if (!cur) return doc;
  if (!!cur.labelBold === bold) return doc;
  if (bold) {
    return { ...doc, stations: { ...doc.stations, [stationId]: { ...cur, labelBold: true } } };
  }
  // `false` is the default; omit the field so persisted state stays clean.
  const { labelBold: _gone, ...rest } = cur;
  return { ...doc, stations: { ...doc.stations, [stationId]: rest } };
}

export function setLabelItalic(doc: MapDoc, i: boolean): MapDoc {
  if (i === doc.labelItalic) return doc;
  return { ...doc, labelItalic: i };
}

const PALETTE_DECLARATION_ORDER: PaletteId[] = PALETTES.map((p) => p.id);
const KNOWN_PALETTE_IDS = new Set<PaletteId>(PALETTE_DECLARATION_ORDER);

function normalizePaletteIds(ids: readonly PaletteId[]): PaletteId[] {
  const set = new Set(ids.filter((id) => KNOWN_PALETTE_IDS.has(id)));
  return PALETTE_DECLARATION_ORDER.filter((id) => set.has(id));
}

function arraysEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Replace the active palette set. Empty input (or input containing only
 * unknown ids) is rejected — the doc must always have at least one active
 * palette. Input is deduplicated and normalised to PALETTES declaration order.
 */
export function setActivePalettes(doc: MapDoc, ids: readonly PaletteId[]): MapDoc {
  const next = normalizePaletteIds(ids);
  if (next.length === 0) return doc;
  if (arraysEqual(next, doc.activePalettes)) return doc;
  return { ...doc, activePalettes: next };
}

/**
 * Toggle a single palette in/out of the active set. Refuses to remove the
 * last active palette (returns input doc unchanged), preserving the
 * "non-empty" invariant in one place.
 */
export function togglePalette(doc: MapDoc, id: PaletteId): MapDoc {
  const present = doc.activePalettes.includes(id);
  const next = present ? doc.activePalettes.filter((x) => x !== id) : [...doc.activePalettes, id];
  return setActivePalettes(doc, next);
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

// ---------- Route bullets ----------

export function addRouteBullet(
  doc: MapDoc,
  id: string,
  x: number,
  y: number,
  lineId: LineId | null,
): MapDoc {
  const bullet: RouteBullet = {
    id,
    x,
    y,
    rotation: 0,
    lineId,
    shape: 'circle',
    size: 14,
  };
  return { ...doc, routeBullets: { ...doc.routeBullets, [id]: bullet } };
}

// Insert a fully-specified bullet (used by duplicate + paste).
export function addRouteBulletWith(
  doc: MapDoc,
  id: string,
  fields: Omit<RouteBullet, 'id'>,
): MapDoc {
  const bullet: RouteBullet = { id, ...fields };
  return { ...doc, routeBullets: { ...doc.routeBullets, [id]: bullet } };
}

export function moveRouteBullet(doc: MapDoc, id: string, x: number, y: number): MapDoc {
  const cur = doc.routeBullets[id];
  if (!cur) return doc;
  return { ...doc, routeBullets: { ...doc.routeBullets, [id]: { ...cur, x, y } } };
}

export function rotateRouteBullet(doc: MapDoc, id: string): MapDoc {
  const cur = doc.routeBullets[id];
  if (!cur) return doc;
  const next = ((cur.rotation + 1) % 8) as Rotation;
  return {
    ...doc,
    routeBullets: { ...doc.routeBullets, [id]: { ...cur, rotation: next } },
  };
}

export function updateRouteBullet(
  doc: MapDoc,
  id: string,
  patch: Partial<Pick<RouteBullet, 'lineId' | 'shape' | 'size'>>,
): MapDoc {
  const cur = doc.routeBullets[id];
  if (!cur) return doc;
  return { ...doc, routeBullets: { ...doc.routeBullets, [id]: { ...cur, ...patch } } };
}

export function deleteRouteBullet(doc: MapDoc, id: string): MapDoc {
  if (!doc.routeBullets[id]) return doc;
  const { [id]: _gone, ...rest } = doc.routeBullets;
  return { ...doc, routeBullets: rest };
}

// ---------- Text labels ----------

export function addTextLabel(doc: MapDoc, id: string, x: number, y: number): MapDoc {
  const label: TextLabel = { id, x, y, ...TEXT_LABEL_DEFAULTS };
  return { ...doc, textLabels: { ...doc.textLabels, [id]: label } };
}

// Insert a fully-specified label (used by duplicate + paste).
export function addTextLabelWith(doc: MapDoc, id: string, fields: Omit<TextLabel, 'id'>): MapDoc {
  const label: TextLabel = { id, ...fields };
  return { ...doc, textLabels: { ...doc.textLabels, [id]: label } };
}

export function moveTextLabel(doc: MapDoc, id: string, x: number, y: number): MapDoc {
  const cur = doc.textLabels[id];
  if (!cur) return doc;
  return { ...doc, textLabels: { ...doc.textLabels, [id]: { ...cur, x, y } } };
}

export function rotateTextLabel(doc: MapDoc, id: string): MapDoc {
  const cur = doc.textLabels[id];
  if (!cur) return doc;
  const next = ((cur.rotation + 1) % 8) as Rotation;
  return {
    ...doc,
    textLabels: { ...doc.textLabels, [id]: { ...cur, rotation: next } },
  };
}

export function updateTextLabel(
  doc: MapDoc,
  id: string,
  patch: Partial<Omit<TextLabel, 'id'>>,
): MapDoc {
  const cur = doc.textLabels[id];
  if (!cur) return doc;
  // Clamp font size to the allowed range so callers (slider, spinbutton,
  // paste) can't push us out of band. Mirrors `setLabelFontSize`.
  let nextPatch = patch;
  if (typeof patch.fontSize === 'number') {
    const clamped = Math.max(
      TEXT_LABEL_FONT_SIZE_MIN,
      Math.min(TEXT_LABEL_FONT_SIZE_MAX, Math.round(patch.fontSize)),
    );
    nextPatch = { ...patch, fontSize: clamped };
  }
  let next = { ...cur, ...nextPatch };
  // Re-anchor on the upper-left bbox corner whenever a resize-affecting
  // property changes — text content, font size, weight, or italic. The
  // label's (x, y) is the bbox center, so without this the visible top-
  // left would drift on every edit. Skipped when the caller explicitly
  // sets x or y (e.g. a drag): then the move is intentional.
  const resizes =
    nextPatch.text !== undefined ||
    nextPatch.fontSize !== undefined ||
    nextPatch.weight !== undefined ||
    nextPatch.italic !== undefined;
  const movedExplicitly = nextPatch.x !== undefined || nextPatch.y !== undefined;
  if (resizes && !movedExplicitly) {
    const before = measureTextLabel(cur);
    const after = measureTextLabel(next);
    next = {
      ...next,
      x: cur.x + (after.width - before.width) / 2,
      y: cur.y + (after.height - before.height) / 2,
    };
  }
  return { ...doc, textLabels: { ...doc.textLabels, [id]: next } };
}

export function deleteTextLabel(doc: MapDoc, id: string): MapDoc {
  if (!doc.textLabels[id]) return doc;
  const { [id]: _gone, ...rest } = doc.textLabels;
  return { ...doc, textLabels: rest };
}

// ---------- Transfers ----------

export function addTransfer(
  doc: MapDoc,
  id: string,
  a: { stationId: StationId; lineId: LineId | null },
  b: { stationId: StationId; lineId: LineId | null },
): MapDoc {
  // Same station + same lineId is a self-transfer (zero-length); reject.
  // Same station + DIFFERENT lineIds is fine — a short transfer between
  // two dots of an interlined station is a valid use case.
  if (a.stationId === b.stationId && a.lineId === b.lineId) return doc;
  if (!doc.stations[a.stationId] || !doc.stations[b.stationId]) return doc;
  const transfer: Transfer = {
    id,
    a: { stationId: a.stationId, lineId: a.lineId },
    b: { stationId: b.stationId, lineId: b.lineId },
  };
  return { ...doc, transfers: { ...doc.transfers, [id]: transfer } };
}

export function deleteTransfer(doc: MapDoc, id: string): MapDoc {
  if (!doc.transfers[id]) return doc;
  const { [id]: _gone, ...rest } = doc.transfers;
  return { ...doc, transfers: rest };
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

// Drop entries from `line.segmentStyles` whose pair-key no longer corresponds
// to a station-pair adjacency on this line. Returns the input line unchanged
// if `segmentStyles` is missing/empty or every key still maps to a real edge.
function pruneOrphanSegmentStyles(line: Line): Line {
  const styles = line.segmentStyles;
  if (!styles) return line;
  const validKeys = new Set<string>();
  for (let i = 0; i < line.stations.length - 1; i++) {
    validKeys.add(pairKeyOf(line.stations[i], line.stations[i + 1]));
  }
  let changed = false;
  const next: Record<string, LineStyle> = {};
  for (const key of Object.keys(styles)) {
    if (validKeys.has(key)) {
      next[key] = styles[key];
    } else {
      changed = true;
    }
  }
  return changed ? { ...line, segmentStyles: next } : line;
}

function isLineEdge(line: Line, a: StationId, b: StationId): boolean {
  for (let i = 0; i < line.stations.length - 1; i++) {
    const x = line.stations[i];
    const y = line.stations[i + 1];
    if ((x === a && y === b) || (x === b && y === a)) return true;
  }
  return false;
}
