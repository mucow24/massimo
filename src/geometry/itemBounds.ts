// World-space axis-aligned bounds of a single canvas item, one helper per
// item type — each a thin min/max fold over the type's existing boundary
// geometry (station silhouette rects, text-label corners, polygon vertices,
// svg-image corners, route-bullet square). Folded together by the whole-map
// content bounds (contentBounds.ts), so "how big is this item" can never
// drift between the camera fit and the item's own boundary geometry.
//
// All results are NORMALIZED (x0 ≤ x1, y0 ≤ y1), unlike the general AABB
// type whose corners may sit in any diagonal order.
import type { Pt } from './polygonUnion';
import type { RouteBullet, Station, TextLabel, TransferAnchor } from '../model/types';
import type { AABB } from './rectPolygon';
import {
  stationBoundaryRectsLocal,
  stationLocalToWorld,
  textLabelCorners,
} from './stationBoundary';
import { svgImageCorners, type SvgImageGeom } from './svgImage';
import { ANCHOR_HALF } from './orientation';
import {
  DEFAULT_LABEL_STYLE,
  DEFAULT_STOP_METRICS,
  type LabelStyle,
  type StopMetricsFn,
} from './labelLayout';

function aabbOfPoints(pts: Iterable<Pt>): AABB {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1 };
}

/**
 * World AABB of a station's selection silhouette: the rotated cells rect
 * plus (for non-waypoints) the rotated name-label rect. Pass the same
 * per-station style (`effectiveStationLabelStyle`) and `metrics` the
 * renderer uses, or the label half drifts from the painted text.
 */
export function stationWorldAABB(
  station: Station,
  // The line circle the station is bound to, or null — the frame its cells (and
  // its name) resolve through. Required, like `stationLocalToWorld`'s copy.
  circle: { x: number; y: number } | null,
  style: LabelStyle = DEFAULT_LABEL_STYLE,
  metrics: StopMetricsFn = DEFAULT_STOP_METRICS,
): AABB {
  const b = stationBoundaryRectsLocal(station, style, metrics, false);
  const pts = b.cells.concat(b.label ?? []).map((p) => stationLocalToWorld(station, p, circle));
  return aabbOfPoints(pts);
}

/**
 * World AABB of a text label's rotated bbox. `pad` grows the box on every
 * side before rotating (0 = tight visible bbox; TEXT_LABEL_HIT_PAD = the
 * dashed-ring hit bbox).
 */
export function textLabelAABB(label: TextLabel, pad = 0): AABB {
  return aabbOfPoints(textLabelCorners(label, pad));
}

/**
 * World AABB of a polygon's vertices. Stroke ink extends half the stroke
 * width beyond this (matching every other vertex-derived consumer).
 * Precondition: at least one vertex.
 */
export function polygonAABB(vertices: readonly Pt[]): AABB {
  return aabbOfPoints(vertices);
}

/** World AABB of an svg image's rotated rect. */
export function svgImageAABB(img: SvgImageGeom): AABB {
  return aabbOfPoints(svgImageCorners(img));
}

/**
 * World AABB of a route bullet: the size-half-extent square around its
 * center, rotation ignored — the same box the selection ring and content
 * bounds use (over-estimates circles slightly).
 */
export function routeBulletAABB(b: Pick<RouteBullet, 'x' | 'y' | 'size'>): AABB {
  return { x0: b.x - b.size, y0: b.y - b.size, x1: b.x + b.size, y1: b.y + b.size };
}

/**
 * World AABB of a FREE transfer anchor: the one-cell footprint `ANCHOR_HALF`
 * defines (which is wider than the painted disc — see that constant). Hosted
 * anchors get none: they're chrome on a station the hull already spans, and are
 * normally within its footprint. `stationWorldAABB` does NOT literally enclose
 * an anchor cell parked outside the stops+label box; framing may clip such an
 * outlier, which is acceptable for chrome.
 */
export function transferAnchorAABB(a: Pick<TransferAnchor, 'x' | 'y'>, r = ANCHOR_HALF): AABB {
  return { x0: a.x - r, y0: a.y - r, x1: a.x + r, y1: a.y + r };
}
