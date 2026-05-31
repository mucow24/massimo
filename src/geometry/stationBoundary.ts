import type { Pt } from './polygonUnion';
import type { RouteBullet, Station, StationId, TextLabel } from '../model/types';
import { STOP_SIZE, localToWorld, stopCenterAt } from './orientation';
import { DEFAULT_LABEL_STYLE, labelLayoutLocal, type LabelStyle } from './labelLayout';
import { rectIntersectsPolygon, type AABB } from './rectPolygon';
import { measureTextLabel } from './textMeasure';

const HALF = STOP_SIZE / 2;
const HIT_PAD = 2;

/**
 * The two rectangular components of a station's selection silhouette in
 * **station-local** coords: the cells AABB and the (rotated) label rect.
 * Both are 4-vertex polygons. Their union is what the yellow wash and black
 * stroke render; for hit-testing it's cheaper (and equivalent) to test against
 * each rect separately. For a waypoint station the label rect is omitted
 * entirely (no painted name → nothing to silhouette).
 */
export interface StationBoundaryRects {
  cells: Pt[];
  label?: Pt[];
}

export function stationBoundaryRectsLocal(
  station: Station,
  style: LabelStyle = DEFAULT_LABEL_STYLE,
): StationBoundaryRects {
  const stops = station.stops;
  const label = station.label;
  const isWp = !!station.isWaypoint;
  const phantomDot = !isWp && stops.length === 0 ? { row: label.row, col: label.col + 1 } : null;

  // Waypoints exclude the label cell so the wash/stroke silhouette hugs
  // only the visible stop positions.
  const allCells: { row: number; col: number }[] = isWp ? [...stops] : [...stops, label];
  if (phantomDot) allCells.push(phantomDot);
  if (allCells.length === 0) allCells.push(label); // empty-waypoint fallback
  const minRow = Math.min(...allCells.map((c) => c.row));
  const maxRow = Math.max(...allCells.map((c) => c.row));
  const minCol = Math.min(...allCells.map((c) => c.col));
  const maxCol = Math.max(...allCells.map((c) => c.col));

  const cellsHitX = stopCenterAt(0, minCol).x - HALF - HIT_PAD;
  const cellsHitY = stopCenterAt(minRow, 0).y - HALF - HIT_PAD;
  const cellsHitW = stopCenterAt(0, maxCol).x + HALF + HIT_PAD - cellsHitX;
  const cellsHitH = stopCenterAt(maxRow, 0).y + HALF + HIT_PAD - cellsHitY;

  const cells: Pt[] = [
    { x: cellsHitX, y: cellsHitY },
    { x: cellsHitX + cellsHitW, y: cellsHitY },
    { x: cellsHitX + cellsHitW, y: cellsHitY + cellsHitH },
    { x: cellsHitX, y: cellsHitY + cellsHitH },
  ];

  if (isWp) return { cells };

  // Label rect — same layout the renderer uses, then rotated about the
  // anchor so the polygon aligns with the painted text.
  const lay = labelLayoutLocal(station, style);
  const labelAng = (label.rotation * Math.PI) / 4;
  const cosL = Math.cos(labelAng);
  const sinL = Math.sin(labelAng);
  const rotateLabelCorner = (px: number, py: number): Pt => {
    const dx = px - lay.anchorX;
    const dy = py - lay.anchorY;
    return {
      x: lay.anchorX + dx * cosL - dy * sinL,
      y: lay.anchorY + dx * sinL + dy * cosL,
    };
  };
  const labelPoly: Pt[] = [
    rotateLabelCorner(lay.hitX, lay.hitY),
    rotateLabelCorner(lay.hitX + lay.hitW, lay.hitY),
    rotateLabelCorner(lay.hitX + lay.hitW, lay.hitY + lay.hitH),
    rotateLabelCorner(lay.hitX, lay.hitY + lay.hitH),
  ];

  return { cells, label: labelPoly };
}

/** Apply the station's rotation+translation to a local-frame point. */
export function stationLocalToWorld(station: Station, p: Pt): Pt {
  return localToWorld(p, station);
}

/**
 * Ids of every station whose selection boundary overlaps `rect` (world coords).
 * A station is a hit if either its cells rect or its (rotated) label rect
 * intersects the rect.
 */
export function stationsForRect(
  stations: Record<StationId, Station>,
  rect: AABB,
  style: LabelStyle = DEFAULT_LABEL_STYLE,
): StationId[] {
  const hits: StationId[] = [];
  for (const id of Object.keys(stations)) {
    const st = stations[id];
    const b = stationBoundaryRectsLocal(st, style);
    const cellsWorld = b.cells.map((p) => stationLocalToWorld(st, p));
    if (rectIntersectsPolygon(rect, cellsWorld)) {
      hits.push(id);
      continue;
    }
    if (b.label) {
      const labelWorld = b.label.map((p) => stationLocalToWorld(st, p));
      if (rectIntersectsPolygon(rect, labelWorld)) hits.push(id);
    }
  }
  return hits;
}

// Visual padding around the measured text bbox — matches the dashed ring's
// outer offset in LabelView so marquee hits reflect what the user can see.
export const TEXT_LABEL_HIT_PAD = 4;

/**
 * The 4 corners of a TextLabel's hit polygon in world coords. The label is
 * a rectangle centered on (x, y) with size (measuredWidth + 2*PAD,
 * measuredHeight + 2*PAD) in its own unrotated frame, rotated by
 * `rotation * 45°` clockwise (matching the existing `Rotation` semantics).
 */
export function textLabelHitPolygon(label: TextLabel): Pt[] {
  const m = measureTextLabel(label);
  const halfW = m.width / 2 + TEXT_LABEL_HIT_PAD;
  const halfH = m.height / 2 + TEXT_LABEL_HIT_PAD;
  const corners: Pt[] = [
    { x: -halfW, y: -halfH },
    { x: halfW, y: -halfH },
    { x: halfW, y: halfH },
    { x: -halfW, y: halfH },
  ];
  return corners.map((p) => localToWorld(p, label));
}

/**
 * Ids of every TextLabel whose rotated hit polygon overlaps `rect` (world
 * coords). Empty-text labels still have a small hit polygon from the padding,
 * so a freshly-placed "New Label" can still be selected.
 */
export function textLabelsForRect(labels: Record<string, TextLabel>, rect: AABB): string[] {
  const hits: string[] = [];
  for (const id of Object.keys(labels)) {
    const poly = textLabelHitPolygon(labels[id]);
    if (rectIntersectsPolygon(rect, poly)) hits.push(id);
  }
  return hits;
}

/**
 * Ids of every route bullet whose footprint overlaps `rect` (world coords).
 * Each bullet's hit shape is a `size × size`-half-extent square centered on
 * its position — a slight over-estimate for circle bullets, but it lines up
 * with the dashed selection ring's bounding box, which is what the user
 * sees as "the selectable footprint".
 */
export function routeBulletsForRect(bullets: Record<string, RouteBullet>, rect: AABB): string[] {
  const xLo = Math.min(rect.x0, rect.x1);
  const xHi = Math.max(rect.x0, rect.x1);
  const yLo = Math.min(rect.y0, rect.y1);
  const yHi = Math.max(rect.y0, rect.y1);
  const hits: string[] = [];
  for (const id of Object.keys(bullets)) {
    const b = bullets[id];
    if (b.x + b.size < xLo || b.x - b.size > xHi) continue;
    if (b.y + b.size < yLo || b.y - b.size > yHi) continue;
    hits.push(id);
  }
  return hits;
}
