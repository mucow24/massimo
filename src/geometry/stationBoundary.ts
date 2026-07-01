import type { Pt } from './polygonUnion';
import type { Polygon, RouteBullet, Station, StationId, SvgImage, TextLabel } from '../model/types';
import { STOP_SIZE, localToWorld, rotRad, stopCenterAt } from './orientation';
import { rotateAround } from './vec';
import { svgImageCorners } from './svgImage';
import {
  DEFAULT_LABEL_STYLE,
  DEFAULT_STOP_HALF,
  labelLayoutLocal,
  type LabelStyle,
  type StopHalfFn,
} from './labelLayout';
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

export interface AABBRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Axis-aligned bounding box (station-local) around a station's stop cells —
 * plus the label cell for a regular station, plus a phantom dot for an empty
 * one — padded by HIT_PAD. The "cells" half of the selection silhouette / hit
 * rect. Shared with StationView's bg hit rect so the two can never drift.
 *
 * Each cell contributes its OWN half-extent (a stop's is half its line's
 * width via `stopHalf`; the label cell and phantom dot stay STOP_SIZE/2), so
 * the extents are per-cell min/max — the dominating edge can come from a
 * wide stop whose CENTER is not extremal.
 */
export function cellsAABBLocal(
  station: Station,
  stopHalf: StopHalfFn = DEFAULT_STOP_HALF,
): AABBRect {
  const stops = station.stops;
  const label = station.label;
  const isWp = !!station.isWaypoint;
  const phantomDot = !isWp && stops.length === 0 ? { row: label.row, col: label.col + 1 } : null;
  // Waypoints exclude the label cell so the silhouette hugs only the visible
  // stop positions.
  const allCells: { row: number; col: number; half: number }[] = stops.map((s) => ({
    row: s.row,
    col: s.col,
    half: stopHalf(s.lineId),
  }));
  if (!isWp) allCells.push({ row: label.row, col: label.col, half: HALF });
  if (phantomDot) allCells.push({ ...phantomDot, half: HALF });
  if (allCells.length === 0) allCells.push({ row: label.row, col: label.col, half: HALF }); // empty-waypoint fallback
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const c of allCells) {
    const cx = stopCenterAt(0, c.col).x;
    const cy = stopCenterAt(c.row, 0).y;
    minX = Math.min(minX, cx - c.half);
    maxX = Math.max(maxX, cx + c.half);
    minY = Math.min(minY, cy - c.half);
    maxY = Math.max(maxY, cy + c.half);
  }
  const x = minX - HIT_PAD;
  const y = minY - HIT_PAD;
  return { x, y, w: maxX + HIT_PAD - x, h: maxY + HIT_PAD - y };
}

export function stationBoundaryRectsLocal(
  station: Station,
  style: LabelStyle = DEFAULT_LABEL_STYLE,
  stopHalf: StopHalfFn = DEFAULT_STOP_HALF,
): StationBoundaryRects {
  const label = station.label;
  const isWp = !!station.isWaypoint;
  const { x, y, w, h } = cellsAABBLocal(station, stopHalf);
  const cells: Pt[] = [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];

  if (isWp) return { cells };

  // Label rect — same layout the renderer uses (including the same per-stop
  // width lookup, so label snapping agrees), then rotated about the anchor
  // so the polygon aligns with the painted text.
  const lay = labelLayoutLocal(station, style, undefined, stopHalf);
  const labelAnchor = { x: lay.anchorX, y: lay.anchorY };
  const rotateLabelCorner = (px: number, py: number): Pt =>
    rotateAround({ x: px, y: py }, labelAnchor, rotRad(label.rotation));
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
  stopHalf: StopHalfFn = DEFAULT_STOP_HALF,
): StationId[] {
  const hits: StationId[] = [];
  for (const id of Object.keys(stations)) {
    const st = stations[id];
    // Locked stations are excluded from marquee selection (mirrors polygons).
    if (st.locked) continue;
    const b = stationBoundaryRectsLocal(st, style, stopHalf);
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
    const label = labels[id];
    // Locked labels are excluded from marquee selection.
    if (label.locked) continue;
    const poly = textLabelHitPolygon(label);
    if (rectIntersectsPolygon(rect, poly)) hits.push(id);
  }
  return hits;
}

/**
 * Ids of every polygon whose filled body overlaps `rect` (world coords). The
 * polygon's own vertices are already world-space, so the rect/polygon overlap
 * test is direct — dragging a rubber band over any part of a polygon selects
 * it. Open polygons have no filled body, so only the stroke chain counts —
 * a marquee fully inside an open polygon's vertex loop selects nothing.
 */
export function polygonsForRect(polygons: Record<string, Polygon>, rect: AABB): string[] {
  const hits: string[] = [];
  for (const id of Object.keys(polygons)) {
    const poly = polygons[id];
    // Locked polygons are excluded from marquee selection.
    if (poly.locked) continue;
    if (rectIntersectsPolygon(rect, poly.vertices, poly.closed !== false)) hits.push(id);
  }
  return hits;
}

/**
 * Ids of every svg image whose (rotated) footprint overlaps `rect` (world
 * coords). The four world corners form a closed quad, so the rect/quad overlap
 * test is direct. Locked images are excluded from marquee selection.
 */
export function svgImagesForRect(svgImages: Record<string, SvgImage>, rect: AABB): string[] {
  const hits: string[] = [];
  for (const id of Object.keys(svgImages)) {
    const im = svgImages[id];
    if (im.locked) continue;
    if (rectIntersectsPolygon(rect, svgImageCorners(im))) hits.push(id);
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
    // Locked bullets are excluded from marquee selection.
    if (b.locked) continue;
    if (b.x + b.size < xLo || b.x - b.size > xHi) continue;
    if (b.y + b.size < yLo || b.y - b.size > yHi) continue;
    hits.push(id);
  }
  return hits;
}
