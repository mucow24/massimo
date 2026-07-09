import type { Pt } from './polygonUnion';
import type { Polygon, RouteBullet, Station, StationId, SvgImage, TextLabel } from '../model/types';
import { STOP_SIZE, localToWorld, rotRad, stopCenterAt } from './orientation';
import { rotateAround, rotatedRectCorners } from './vec';
import { svgImageCorners } from './svgImage';
import {
  DEFAULT_LABEL_STYLE,
  DEFAULT_STOP_HALF,
  labelLayoutLocal,
  type LabelStyle,
  type StopHalfFn,
} from './labelLayout';
import { normalizeAABB, rectIntersectsPolygon, type AABB } from './rectPolygon';
import { measureTextLabel } from './textMeasure';
import { effectiveStationLabelStyle } from '../model/transforms';

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
    // The two grid axes are independent: stopCenterAt's x depends only on col,
    // its y only on row. So the dummy `0` for the unused axis is safe on each.
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
 *
 * `style.weight` is the *doc-default* label weight; each station's own bold
 * flag is folded in per-station via `effectiveStationLabelStyle`, so a bold
 * station's label rect is measured at the same (heavier, wider) weight it is
 * actually painted at — otherwise its marquee hit rect would be narrower than
 * the visible label.
 *
 * `includeLocked` (here and in the other *ForRect fns) is the alt-marquee
 * recovery path: locked items are click-through on the canvas, so an
 * alt-marquee is how a locked item gets re-selected (to reach its unlock
 * toggle). A plain marquee keeps excluding them.
 */
export function stationsForRect(
  stations: Record<StationId, Station>,
  rect: AABB,
  style: LabelStyle = DEFAULT_LABEL_STYLE,
  stopHalf: StopHalfFn = DEFAULT_STOP_HALF,
  includeLocked = false,
): StationId[] {
  const hits: StationId[] = [];
  for (const id of Object.keys(stations)) {
    const st = stations[id];
    // Locked stations are excluded from marquee selection (mirrors polygons).
    if (st.locked && !includeLocked) continue;
    const b = stationBoundaryRectsLocal(st, effectiveStationLabelStyle(st, style), stopHalf);
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
 * The 4 world-space corners of a TextLabel's rotated bbox, clockwise from the
 * unrotated top-left ([TL, TR, BR, BL]). The label is a rectangle centered on
 * (x, y) with size (measuredWidth + 2*pad, measuredHeight + 2*pad) in its own
 * unrotated frame, rotated by `rotation * 45°` clockwise (the `Rotation`
 * semantics). `pad` grows the box outward on every side; it defaults to 0 (the
 * tight visible bbox) — hit-testing passes TEXT_LABEL_HIT_PAD. Routes through
 * `rotatedRectCorners`, the single home for rotated-rectangle corners.
 */
export function textLabelCorners(label: TextLabel, pad = 0): Pt[] {
  const m = measureTextLabel(label);
  return rotatedRectCorners(
    { x: label.x, y: label.y },
    m.width / 2 + pad,
    m.height / 2 + pad,
    rotRad(label.rotation),
  );
}

/**
 * The 4 corners of a TextLabel's hit polygon in world coords — the visible
 * bbox grown by TEXT_LABEL_HIT_PAD so marquee hits match the dashed ring the
 * user sees.
 */
export function textLabelHitPolygon(label: TextLabel): Pt[] {
  return textLabelCorners(label, TEXT_LABEL_HIT_PAD);
}

/**
 * Ids of every TextLabel whose rotated hit polygon overlaps `rect` (world
 * coords). Empty-text labels still have a small hit polygon from the padding,
 * so a freshly-placed "New Label" can still be selected.
 */
export function textLabelsForRect(
  labels: Record<string, TextLabel>,
  rect: AABB,
  includeLocked = false,
): string[] {
  const hits: string[] = [];
  for (const id of Object.keys(labels)) {
    const label = labels[id];
    // Locked labels are excluded from marquee selection.
    if (label.locked && !includeLocked) continue;
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
export function polygonsForRect(
  polygons: Record<string, Polygon>,
  rect: AABB,
  includeLocked = false,
): string[] {
  const hits: string[] = [];
  for (const id of Object.keys(polygons)) {
    const poly = polygons[id];
    // Locked polygons are excluded from marquee selection.
    if (poly.locked && !includeLocked) continue;
    if (rectIntersectsPolygon(rect, poly.vertices, poly.closed !== false)) hits.push(id);
  }
  return hits;
}

/**
 * Ids of every svg image whose (rotated) footprint overlaps `rect` (world
 * coords). The four world corners form a closed quad, so the rect/quad overlap
 * test is direct. Locked images are excluded from marquee selection.
 */
export function svgImagesForRect(
  svgImages: Record<string, SvgImage>,
  rect: AABB,
  includeLocked = false,
): string[] {
  const hits: string[] = [];
  for (const id of Object.keys(svgImages)) {
    const im = svgImages[id];
    if (im.locked && !includeLocked) continue;
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
export function routeBulletsForRect(
  bullets: Record<string, RouteBullet>,
  rect: AABB,
  includeLocked = false,
): string[] {
  const { xLo, xHi, yLo, yHi } = normalizeAABB(rect);
  const hits: string[] = [];
  for (const id of Object.keys(bullets)) {
    const b = bullets[id];
    // Locked bullets are excluded from marquee selection.
    if (b.locked && !includeLocked) continue;
    if (b.x + b.size < xLo || b.x - b.size > xHi) continue;
    if (b.y + b.size < yLo || b.y - b.size > yHi) continue;
    hits.push(id);
  }
  return hits;
}
