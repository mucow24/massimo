import type { Pt } from './polygonUnion';
import type {
  AnchorCell,
  Polygon,
  RouteBullet,
  Station,
  StationId,
  SvgImage,
  TextLabel,
  TransferAnchor,
} from '../model/types';
import { ANCHOR_HALF, STOP_SIZE, rotRad, stationCellToWorld, stopCenterAt } from './orientation';
import { stationCircle, type CircleSpec } from './lineCircle';
import { rotateAround, rotatedRectCorners } from './vec';
import { svgImageCorners } from './svgImage';
import {
  DEFAULT_LABEL_STYLE,
  DEFAULT_STOP_METRICS,
  labelLayoutLocal,
  type LabelStyle,
  type StopMetricsFn,
} from './labelLayout';
import { normalizeAABB, rectIntersectsPolygon, type AABB } from './rectPolygon';
import { blockInkExtentX, CAP_FRACTION, measureTextLabel } from './textMeasure';
import { waypointLabelRectLocal } from './waypointLozenge';
import { effectiveStationLabelStyle } from '../model/transforms';

const HALF = STOP_SIZE / 2;
const HIT_PAD = 2;

/**
 * The two rectangular components of a station's selection silhouette in
 * **station-local** coords: the cells AABB and the (rotated) label rect.
 * Both are 4-vertex polygons. Their union is what the yellow wash and black
 * stroke render; for hit-testing it's cheaper (and equivalent) to test against
 * each rect separately. A hidden waypoint omits the label rect (no painted
 * name → nothing to silhouette); a revealed one (`revealWaypoint`) gets it back.
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
 * width via `metrics`; the label cell and phantom dot stay STOP_SIZE/2), so
 * the extents are per-cell min/max — the dominating edge can come from a
 * wide stop whose CENTER is not extremal.
 *
 * Deliberately the STRIPE half only, not the wider of stripe and dot: a dot
 * bigger than its line would poke past this box, but growing it here would move
 * marquee hits, selection washes and Reset-view framing, which is a different
 * change from where the label parks.
 */
export function cellsAABBLocal(
  station: Station,
  metrics: StopMetricsFn = DEFAULT_STOP_METRICS,
  // A revealed waypoint (Show-waypoints overlay on) is treated like a regular
  // station: its label cell + empty-station phantom count toward the box, so
  // its hit/selection footprint matches a normal station's. Off by default so
  // marquee-select and camera-fit bounds never shift with the view toggle.
  revealWaypoint = false,
): AABBRect {
  const stops = station.stops;
  const label = station.label;
  const labeled = !station.isWaypoint || revealWaypoint;
  const phantomDot = labeled && stops.length === 0 ? { row: label.row, col: label.col + 1 } : null;
  // A hidden waypoint excludes the label cell so the silhouette hugs only the
  // visible stop positions.
  const allCells: { row: number; col: number; half: number }[] = stops.map((s) => ({
    row: s.row,
    col: s.col,
    half: metrics(station, s).half,
  }));
  if (labeled) allCells.push({ row: label.row, col: label.col, half: HALF });
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

/**
 * How far the farthest transfer-anchor CELL CENTRE sits outside `box` — 0 when
 * every one is inside it. Both in station-local coords.
 *
 * The layout editor's shield pad grows by this so its halo still swallows a
 * near-miss right-click beside an anchor parked off the cells box.
 *
 * Measured against the box's EDGES, not its half-extent: the cells box is not
 * centred on the local origin (the label cell alone pushes it off, and any
 * off-origin stop moves it further), so `|centre| − w/2` compares a distance
 * from the origin against a distance from the box's own centre. A merely WIDE
 * box then reads an anchor as inside no matter how far past the near edge it
 * actually sits.
 */
export function anchorOvershootLocal(box: AABBRect, anchors: readonly AnchorCell[] = []): number {
  let out = 0;
  for (const a of anchors) {
    const c = stopCenterAt(a.row, a.col);
    out = Math.max(out, box.x - c.x, c.x - (box.x + box.w), box.y - c.y, c.y - (box.y + box.h));
  }
  return out;
}

export function stationBoundaryRectsLocal(
  station: Station,
  style: LabelStyle = DEFAULT_LABEL_STYLE,
  // Per-stop metrics — pass `stopMetricsOf({ lines, transfers, stations })`, the same one
  // the renderer uses, or the label rect drifts off the painted name (see
  // StopMetrics).
  metrics: StopMetricsFn = DEFAULT_STOP_METRICS,
  // See cellsAABBLocal: a revealed waypoint gets its label rect back, so its
  // selection silhouette wraps the (now painted) name. Defaulted off.
  revealWaypoint = false,
): StationBoundaryRects {
  const label = station.label;
  const labeled = !station.isWaypoint || revealWaypoint;
  const { x, y, w, h } = cellsAABBLocal(station, metrics, revealWaypoint);
  const cells: Pt[] = [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];

  if (!labeled) return { cells };

  // Label rect — same layout the renderer uses (including the same per-stop
  // width lookup, so label snapping agrees), then rotated about the anchor
  // so the polygon aligns with the painted label.
  const lay = labelLayoutLocal(station, style, undefined, metrics);
  const labelAnchor = { x: lay.anchorX, y: lay.anchorY };
  const rotateLabelCorner = (px: number, py: number): Pt =>
    rotateAround({ x: px, y: py }, labelAnchor, rotRad(label.rotation));
  // A revealed waypoint's label IS the WP lozenge, so silhouette the pill's box;
  // a regular station silhouettes its name's box. (Only revealed waypoints reach
  // here — a hidden one returned above via `!labeled`.)
  const box = station.isWaypoint
    ? waypointLabelRectLocal(lay, style.fontSize)
    : { x: lay.hitX, y: lay.hitY, w: lay.hitW, h: lay.hitH };
  const labelPoly: Pt[] = [
    rotateLabelCorner(box.x, box.y),
    rotateLabelCorner(box.x + box.w, box.y),
    rotateLabelCorner(box.x + box.w, box.y + box.h),
    rotateLabelCorner(box.x, box.y + box.h),
  ];

  return { cells, label: labelPoly };
}

/**
 * Apply the station's frame+translation to a local-frame point. `circle` is the
 * line circle the station is bound to, or null — REQUIRED, the `stopPosWorld`
 * idiom: a caller that skipped it would put a bound station's cells (and the
 * name that shares their lattice) a lane off the arc they belong to.
 */
export function stationLocalToWorld(
  station: Station,
  p: Pt,
  circle: { x: number; y: number } | null,
): Pt {
  return stationCellToWorld(p, station, circle);
}

/**
 * Ids of every station whose selection boundary overlaps `rect` (world coords).
 * A station is a hit if either its cells rect or its (rotated) label rect
 * intersects the rect.
 *
 * Each station's label rect is measured at its OWN effective typography
 * (`effectiveStationLabelStyle`), so a station's marquee hit rect always
 * matches the (weight/size/spacing) it is actually painted at.
 *
 * `includeLocked` (here and in the other *ForRect fns) is the alt-marquee
 * recovery path: locked items are click-through on the canvas, so an
 * alt-marquee is how a locked item gets re-selected (to reach its unlock
 * toggle). A plain marquee keeps excluding them.
 */
export function stationsForRect(
  stations: Record<StationId, Station>,
  rect: AABB,
  // The doc's line circles, for the frame a bound station's cells resolve
  // through — required for the same reason `stopPosWorld`'s copy is (see
  // `stationLocalToWorld`): a marquee that framed the octant ghost of a ring
  // station's name would miss the name the user is dragging over.
  lineCircles: Record<string, CircleSpec>,
  metrics: StopMetricsFn = DEFAULT_STOP_METRICS,
  includeLocked = false,
): StationId[] {
  const hits: StationId[] = [];
  for (const id of Object.keys(stations)) {
    const st = stations[id];
    // Locked stations are excluded from marquee selection (mirrors polygons).
    if (st.locked && !includeLocked) continue;
    const circle = stationCircle(st, lineCircles);
    const b = stationBoundaryRectsLocal(st, effectiveStationLabelStyle(st), metrics, false);
    const cellsWorld = b.cells.map((p) => stationLocalToWorld(st, p, circle));
    if (rectIntersectsPolygon(rect, cellsWorld)) {
      hits.push(id);
      continue;
    }
    if (b.label) {
      const labelWorld = b.label.map((p) => stationLocalToWorld(st, p, circle));
      if (rectIntersectsPolygon(rect, labelWorld)) hits.push(id);
    }
  }
  return hits;
}

// Minimal chrome footprint for a ZERO-INK label: an empty label's alignment
// box is width-0, so the chrome rect grows by this much on every side to keep
// a blank label visible and clickable. Inked labels get no padding — their
// ring and hit rect are tight to the alignment box.
export const TEXT_LABEL_HIT_PAD = 4;

/**
 * The 4 world-space corners of a TextLabel's leaded LINE BOX, clockwise from
 * the unrotated top-left ([TL, TR, BR, BL]) — the ENVELOPE that always
 * contains the ink, leading and descenders included, which is what the camera
 * hull folds (contentBounds, which passes TEXT_LABEL_HIT_PAD as breathing
 * room via `pad`). Selection chrome, hit-testing and snapping ride the
 * ALIGNMENT box instead (textLabelAlignCorners below). The label is a
 * rectangle centered on (x, y) with size (measuredWidth + 2*pad,
 * measuredHeight + 2*pad) in its own unrotated frame, rotated by
 * `rotation * 45°` clockwise (the `Rotation` semantics). Routes through
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
 * The label's ALIGNMENT box in its own unrotated frame, relative to the label
 * center: the block's true ink extent horizontally (per-line pen placement
 * plus bearings — see blockInkExtentX; the pen box alone leaves a
 * proportional side-bearing strip before the first glyph), first line's cap
 * line down to the last line's baseline — the Core Type Area, the same
 * font-model box autoAlign aligns station names by. The line box's leading
 * and any descender live OUTSIDE this box on purpose: two labels snapped to
 * the same guide share a baseline or cap line regardless of which glyphs they
 * contain. Selection chrome, hit-testing and every label snap point derive
 * from this box; the full leaded line box (textLabelCorners) stays the
 * envelope for camera fit.
 */
export function textLabelAlignRectLocal(label: TextLabel): AABB {
  const m = measureTextLabel(label);
  const first = m.lines[0];
  const last = m.lines[m.lines.length - 1];
  // No ink at all (empty or all-whitespace) leaves the pen box standing in —
  // which in column mode IS the authored column, so an empty column keeps its
  // width instead of collapsing.
  const ink = blockInkExtentX(m, label.align);
  const left = ink ? ink.left : -m.width / 2;
  const right = ink ? ink.right : m.width / 2;
  // A fixed-width COLUMN is authored geometry, so its wrap edge must stay
  // visible: the RIGHT edge reaches at least the column's right (m.width is
  // pinned to it; further if an unbreakable word overflows the wrap). The
  // LEFT edge stays on the ink like every other label — a column must not
  // reintroduce the side-bearing strip the alignment box exists to remove.
  const column = (label.width ?? 0) > 0;
  return {
    x0: left,
    y0: -m.height / 2 + first.baselineFromTop - CAP_FRACTION * first.maxFontSize,
    x1: column ? Math.max(right, m.width / 2) : right,
    y1: -m.height / 2 + last.baselineFromTop,
  };
}

/**
 * The rect the label's chrome (dashed ring, hit rect, marquee) draws: the
 * alignment box, floored to a TEXT_LABEL_HIT_PAD footprint when the label has
 * no ink so a blank label stays visible and clickable.
 */
export function textLabelChromeRectLocal(label: TextLabel): AABB {
  const r = textLabelAlignRectLocal(label);
  if (r.x1 - r.x0 > 0) return r;
  return {
    x0: r.x0 - TEXT_LABEL_HIT_PAD,
    y0: r.y0 - TEXT_LABEL_HIT_PAD,
    x1: r.x1 + TEXT_LABEL_HIT_PAD,
    y1: r.y1 + TEXT_LABEL_HIT_PAD,
  };
}

// A label-local rect (relative to the label center) to world corners,
// clockwise from the unrotated top-left, rotated about the center like
// everything else label-shaped.
function labelRectCornersWorld(label: TextLabel, r: AABB): Pt[] {
  const c = { x: label.x, y: label.y };
  const rad = rotRad(label.rotation);
  const corners: Pt[] = [
    { x: r.x0, y: r.y0 },
    { x: r.x1, y: r.y0 },
    { x: r.x1, y: r.y1 },
    { x: r.x0, y: r.y1 },
  ];
  return corners.map((p) => rotateAround({ x: c.x + p.x, y: c.y + p.y }, c, rad));
}

/**
 * The 4 world-space corners of the alignment box ([TL, TR, BR, BL] unrotated
 * order) — what label drags snap BY and what other drags snap TO.
 */
export function textLabelAlignCorners(label: TextLabel): Pt[] {
  return labelRectCornersWorld(label, textLabelAlignRectLocal(label));
}

/**
 * The 4 corners of a TextLabel's hit polygon in world coords — tight to the
 * alignment box (floored for zero-ink labels), matching the dashed ring the
 * user sees.
 */
export function textLabelHitPolygon(label: TextLabel): Pt[] {
  return labelRectCornersWorld(label, textLabelChromeRectLocal(label));
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

/**
 * FREE transfer anchors swept up by the rect, over the same one-cell footprint
 * content bounds reserve for them (`ANCHOR_HALF` — which is WIDER than the
 * painted disc, so a marquee that grazes the mark still grabs it). Sharing the
 * constant is the point: an anchor framed by Reset view and an anchor caught by
 * a marquee must be the same square. No `includeLocked` twin of the bullet
 * guard above — anchors have no lock, so every one inside the rect is a hit.
 * Hosted anchors are station internals and are never marquee-selectable; their
 * station answers the marquee instead.
 */
export function transferAnchorsForRect(
  anchors: Record<string, TransferAnchor>,
  rect: AABB,
  half = ANCHOR_HALF,
): string[] {
  const { xLo, xHi, yLo, yHi } = normalizeAABB(rect);
  const hits: string[] = [];
  for (const id of Object.keys(anchors)) {
    const a = anchors[id];
    if (a.x + half < xLo || a.x - half > xHi) continue;
    if (a.y + half < yLo || a.y - half > yHi) continue;
    hits.push(id);
  }
  return hits;
}
