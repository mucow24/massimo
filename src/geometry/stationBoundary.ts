import type { Pt } from './polygonUnion';
import type { Station, StationId } from '../model/types';
import { DIR_8, STOP_SIZE, stopCenterAt } from './orientation';
import { rectIntersectsPolygon, type AABB } from './rectPolygon';

const HALF = STOP_SIZE / 2;
const HIT_PAD = 2;
const LABEL_GAP = 5;

/**
 * The two rectangular components of a station's selection silhouette in
 * **station-local** coords: the cells AABB and the (rotated) label rect.
 * Both are 4-vertex polygons. Their union is what the yellow wash and black
 * stroke render; for hit-testing it's cheaper (and equivalent) to test against
 * each rect separately.
 */
export interface StationBoundaryRects {
  cells: Pt[];
  label: Pt[];
}

export function stationBoundaryRectsLocal(station: Station): StationBoundaryRects {
  const stops = station.stops;
  const label = station.label;
  const phantomDot = stops.length === 0 ? { row: label.row, col: label.col + 1 } : null;

  const allCells: { row: number; col: number }[] = [...stops, label];
  if (phantomDot) allCells.push(phantomDot);
  const minRow = Math.min(...allCells.map((c) => c.row));
  const maxRow = Math.max(...allCells.map((c) => c.row));
  const minCol = Math.min(...allCells.map((c) => c.col));
  const maxCol = Math.max(...allCells.map((c) => c.col));

  const isAdjacent = (row: number, col: number) => {
    if (stops.some((s) => s.row === row && s.col === col)) return true;
    if (phantomDot && phantomDot.row === row && phantomDot.col === col) return true;
    return false;
  };

  // Mirrors StationView label-anchor math so the hit/wash polygons agree
  // exactly with what's painted.
  const labelCenter = stopCenterAt(label.row, label.col);
  const dirPlus = DIR_8[label.rotation];
  const dirMinus = DIR_8[(label.rotation + 4) % 8];
  const adjPlus = isAdjacent(label.row + dirPlus.dRow, label.col + dirPlus.dCol);
  const adjMinus = isAdjacent(label.row + dirMinus.dRow, label.col + dirMinus.dCol);
  let labelTextAnchor: 'start' | 'middle' | 'end' = 'middle';
  let labelAnchorX = labelCenter.x;
  let labelAnchorY = labelCenter.y;
  const readAngle = (label.rotation * Math.PI) / 4;
  const readCos = Math.cos(readAngle);
  const readSin = Math.sin(readAngle);
  if (adjPlus) {
    labelTextAnchor = 'end';
    labelAnchorX = labelCenter.x + dirPlus.anchor.x - LABEL_GAP * readCos;
    labelAnchorY = labelCenter.y + dirPlus.anchor.y - LABEL_GAP * readSin;
  } else if (adjMinus) {
    labelTextAnchor = 'start';
    labelAnchorX = labelCenter.x + dirMinus.anchor.x + LABEL_GAP * readCos;
    labelAnchorY = labelCenter.y + dirMinus.anchor.y + LABEL_GAP * readSin;
  }
  if (label.offset) {
    labelAnchorX += label.offset * readCos;
    labelAnchorY += label.offset * readSin;
  }

  const cellsHitX = stopCenterAt(0, minCol).x - HALF - HIT_PAD;
  const cellsHitY = stopCenterAt(minRow, 0).y - HALF - HIT_PAD;
  const cellsHitW = stopCenterAt(0, maxCol).x + HALF + HIT_PAD - cellsHitX;
  const cellsHitH = stopCenterAt(maxRow, 0).y + HALF + HIT_PAD - cellsHitY;
  const textW = Math.max(20, station.name.length * 7);
  const textHalfH = 7;
  let textXMin: number;
  if (labelTextAnchor === 'start') textXMin = labelAnchorX;
  else if (labelTextAnchor === 'end') textXMin = labelAnchorX - textW;
  else textXMin = labelAnchorX - textW / 2;
  const labelHitX = textXMin - HIT_PAD;
  const labelHitY = labelAnchorY - textHalfH - HIT_PAD;
  const labelHitW = textW + 2 * HIT_PAD;
  const labelHitH = 2 * textHalfH + 2 * HIT_PAD;

  const cells: Pt[] = [
    { x: cellsHitX, y: cellsHitY },
    { x: cellsHitX + cellsHitW, y: cellsHitY },
    { x: cellsHitX + cellsHitW, y: cellsHitY + cellsHitH },
    { x: cellsHitX, y: cellsHitY + cellsHitH },
  ];

  const labelAng = (label.rotation * Math.PI) / 4;
  const cosL = Math.cos(labelAng);
  const sinL = Math.sin(labelAng);
  const rotateLabelCorner = (px: number, py: number): Pt => {
    const dx = px - labelAnchorX;
    const dy = py - labelAnchorY;
    return {
      x: labelAnchorX + dx * cosL - dy * sinL,
      y: labelAnchorY + dx * sinL + dy * cosL,
    };
  };
  const labelPoly: Pt[] = [
    rotateLabelCorner(labelHitX, labelHitY),
    rotateLabelCorner(labelHitX + labelHitW, labelHitY),
    rotateLabelCorner(labelHitX + labelHitW, labelHitY + labelHitH),
    rotateLabelCorner(labelHitX, labelHitY + labelHitH),
  ];

  return { cells, label: labelPoly };
}

/** Apply the station's rotation+translation to a local-frame point. */
export function stationLocalToWorld(station: Station, p: Pt): Pt {
  const a = (station.rotation * Math.PI) / 4;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return {
    x: station.x + p.x * c - p.y * s,
    y: station.y + p.x * s + p.y * c,
  };
}

/**
 * Ids of every station whose selection boundary overlaps `rect` (world coords).
 * A station is a hit if either its cells rect or its (rotated) label rect
 * intersects the rect.
 */
export function stationsForRect(stations: Record<StationId, Station>, rect: AABB): StationId[] {
  const hits: StationId[] = [];
  for (const id of Object.keys(stations)) {
    const st = stations[id];
    const b = stationBoundaryRectsLocal(st);
    const cellsWorld = b.cells.map((p) => stationLocalToWorld(st, p));
    const labelWorld = b.label.map((p) => stationLocalToWorld(st, p));
    if (rectIntersectsPolygon(rect, cellsWorld) || rectIntersectsPolygon(rect, labelWorld)) {
      hits.push(id);
    }
  }
  return hits;
}
