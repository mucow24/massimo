import type { SegmentBandSpec } from './interlining';
import { STOP_SIZE, stripeOffset } from './orientation';
import { emitOffsetSegments, offsetFilletPath, type OffsetPathSegment } from './router';
import type { Vec2 } from './vec';

export interface StripeOutline {
  /** SVG `d` for the +HALF / -HALF offset edges of the stripe. */
  edgeAPath: string;
  edgeBPath: string;
  /**
   * Endpoints of the perpendicular cap line at each band end. `(x1,y1)` is
   * the edge-A endpoint, `(x2,y2)` is the edge-B endpoint, so each cap line
   * and its adjacent long edges meet exactly at shared coordinates.
   */
  capStart: { x1: number; y1: number; x2: number; y2: number };
  capEnd: { x1: number; y1: number; x2: number; y2: number };
  /**
   * The raw offset-path segments at each edge, in canonical forward order.
   * Exposed so callers (e.g. the hovered solid outline) can build a single
   * closed traversal without recomputing the offsets.
   */
  segsA: OffsetPathSegment[];
  segsB: OffsetPathSegment[];
}

/**
 * Optional per-endpoint adjustments to the outline. Each value is the
 * world-unit distance along the outward tangent at that endpoint:
 *
 * - Positive  → extend the outline OUTWARD past the station, so the stop-dot
 *               square at that end sits fully inside the outline (the
 *               "winning" segment case at a non-tie endpoint).
 * - Negative  → retreat the outline INWARD before the station, so the dot
 *               sits fully outside (the "losing" segment case).
 * - 0 / unset → cap at the station center as before (the "tie" case).
 *
 * Because the adjustment slides along the existing first/last edge tangent,
 * no new corner is introduced — `offsetFilletPath` and `emitOffsetSegments`
 * just see a slightly longer / shorter straight section at the affected end.
 */
export interface StripeOutlineAdjust {
  start?: number;
  end?: number;
}

/**
 * Compute the outline geometry for stripe `stripeIndex` of `band`. The four
 * pieces (two long edges + two cap lines) join cleanly at shared
 * coordinates, and matching `segsA` / `segsB` are returned for callers that
 * want to build the perimeter as a single closed path. Returns null when
 * the band centerline is degenerate (< 2 vertices).
 */
export function computeStripeOutline(
  band: SegmentBandSpec,
  stripeIndex: number,
  adjust: StripeOutlineAdjust = {},
): StripeOutline | null {
  const verts = band.centerline;
  if (verts.length < 2) return null;
  const HALF = STOP_SIZE / 2;
  const n = band.lines.length;
  const offset = stripeOffset(stripeIndex, n);
  const offsetA = offset + HALF;
  const offsetB = offset - HALF;

  const v0 = verts[0];
  const v1 = verts[1];
  const vN1 = verts[verts.length - 1];
  const vN2 = verts[verts.length - 2];

  // Slide v0 and vN1 along their incident-edge tangents per the requested
  // adjustments. Outward at v0 = away from v1 = -tangent; outward at vN1 =
  // away from vN2 = +tangent. Positive adjust = outward, negative = inward.
  const tangentUnit = (a: Vec2, b: Vec2) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const ln = Math.hypot(dx, dy) || 1;
    return { x: dx / ln, y: dy / ln };
  };
  const startAdj = adjust.start ?? 0;
  const endAdj = adjust.end ?? 0;
  const t0 = tangentUnit(v0, v1);
  const tN = tangentUnit(vN2, vN1);
  const adjV0: Vec2 = { x: v0.x - t0.x * startAdj, y: v0.y - t0.y * startAdj };
  const adjVN1: Vec2 = { x: vN1.x + tN.x * endAdj, y: vN1.y + tN.y * endAdj };
  const adjustedVerts =
    verts.length === 2 ? [adjV0, adjVN1] : [adjV0, ...verts.slice(1, -1), adjVN1];

  // Endpoint perpendiculars match the leftOf(norm(...)) convention used by
  // emitOffsetSegments at i=0 and i=last so the cap lines meet the long
  // edges at exactly shared coordinates. The perpendicular direction at
  // each end is unchanged by the colinear slide above.
  const perpUnit = (a: Vec2, b: Vec2) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const ln = Math.hypot(dx, dy) || 1;
    return { x: dy / ln, y: -dx / ln };
  };
  const p0 = perpUnit(v0, v1);
  const pN = perpUnit(vN2, vN1);

  return {
    edgeAPath: offsetFilletPath(adjustedVerts, band.radius, offsetA),
    edgeBPath: offsetFilletPath(adjustedVerts, band.radius, offsetB),
    capStart: {
      x1: adjV0.x + p0.x * offsetA,
      y1: adjV0.y + p0.y * offsetA,
      x2: adjV0.x + p0.x * offsetB,
      y2: adjV0.y + p0.y * offsetB,
    },
    capEnd: {
      x1: adjVN1.x + pN.x * offsetA,
      y1: adjVN1.y + pN.y * offsetA,
      x2: adjVN1.x + pN.x * offsetB,
      y2: adjVN1.y + pN.y * offsetB,
    },
    segsA: emitOffsetSegments(adjustedVerts, band.radius, offsetA),
    segsB: emitOffsetSegments(adjustedVerts, band.radius, offsetB),
  };
}
