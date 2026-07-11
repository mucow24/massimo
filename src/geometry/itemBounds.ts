// World-space axis-aligned bounds of a single canvas item, one helper per
// item type — each a thin min/max fold over the type's existing boundary
// geometry (station silhouette rects, text-label corners, polygon vertices,
// svg-image corners, route-bullet square). Shared by the whole-map content
// bounds and the popover spawn placement, so "how big is this item" can
// never drift between them.
//
// All results are NORMALIZED (x0 ≤ x1, y0 ≤ y1), unlike the general AABB
// type whose corners may sit in any diagonal order.
import type { Pt } from './polygonUnion';
import type { RouteBullet, Station, TextLabel } from '../model/types';
import type { AABB } from './rectPolygon';
import {
  stationBoundaryRectsLocal,
  stationLocalToWorld,
  textLabelCorners,
} from './stationBoundary';
import { svgImageCorners, type SvgImageGeom } from './svgImage';
import {
  DEFAULT_LABEL_STYLE,
  DEFAULT_STOP_HALF,
  type LabelStyle,
  type StopHalfFn,
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
 * per-station style (`effectiveStationLabelStyle`) and `stopHalf` the
 * renderer uses, or the label half drifts from the painted text.
 */
export function stationWorldAABB(
  station: Station,
  style: LabelStyle = DEFAULT_LABEL_STYLE,
  stopHalf: StopHalfFn = DEFAULT_STOP_HALF,
): AABB {
  const b = stationBoundaryRectsLocal(station, style, stopHalf);
  const pts = b.cells.concat(b.label ?? []).map((p) => stationLocalToWorld(station, p));
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
 * World AABB of a transfer's drawn capsule: the box spanned by its two
 * endpoint dots, grown by `halfExtent` (effective thickness/2 + stroke) on
 * every side. Exact for the round-capped stroke — each cap is a circle of
 * that radius centered on an endpoint. Endpoints are resolved by the caller
 * (transferEndWorld needs the stations record).
 */
export function transferAABB(a: Pt, b: Pt, halfExtent: number): AABB {
  const box = aabbOfPoints([a, b]);
  return {
    x0: box.x0 - halfExtent,
    y0: box.y0 - halfExtent,
    x1: box.x1 + halfExtent,
    y1: box.y1 + halfExtent,
  };
}
