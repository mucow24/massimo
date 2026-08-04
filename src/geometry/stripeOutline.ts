import type { SegmentBandSpec } from './interlining';
import { emitOffsetSegments, offsetFilletPath, type OffsetPathSegment } from './router';
import { leftNormal, norm, sub, type Vec2 } from './vec';

/**
 * Build a single closed `M … Z` SVG path tracing a stripe's whole perimeter —
 * edge A forward, the end cap, edge B in reverse, the start cap (implicit via
 * `Z`). With `strokeLinejoin="round"` this joins every corner smoothly, and as
 * a FILLED shape it's a clip/hit region for the stripe's body corridor.
 *
 * Reversal rule: each arc keeps its radius but flips its sweep flag, and
 * `from`/`to` swap; line segments just swap `from`/`to`. Shared by the
 * layering-mode hovered outline.
 */
export function closedPerimeterPath(
  segsA: OffsetPathSegment[],
  segsB: OffsetPathSegment[],
): string {
  if (segsA.length === 0 || segsB.length === 0) return '';
  const fmt = (v: number) => v.toFixed(2);
  const cmdFwd = (s: OffsetPathSegment): string => {
    if (s.kind === 'line') return ` L ${fmt(s.to.x)} ${fmt(s.to.y)}`;
    const sweep = s.sign === 1 ? 1 : 0;
    return ` A ${fmt(s.r)} ${fmt(s.r)} 0 0 ${sweep} ${fmt(s.to.x)} ${fmt(s.to.y)}`;
  };
  const cmdRev = (s: OffsetPathSegment): string => {
    if (s.kind === 'line') return ` L ${fmt(s.from.x)} ${fmt(s.from.y)}`;
    const sweep = s.sign === 1 ? 0 : 1;
    return ` A ${fmt(s.r)} ${fmt(s.r)} 0 0 ${sweep} ${fmt(s.from.x)} ${fmt(s.from.y)}`;
  };
  const startA = segsA[0].from;
  let d = `M ${fmt(startA.x)} ${fmt(startA.y)}`;
  for (const s of segsA) d += cmdFwd(s);
  // Jump along the end cap to edge B's far end, then walk B back.
  const endB = segsB[segsB.length - 1].to;
  d += ` L ${fmt(endB.x)} ${fmt(endB.y)}`;
  for (let i = segsB.length - 1; i >= 0; i--) d += cmdRev(segsB[i]);
  return d + ' Z';
}

export interface StripeOutline {
  /** SVG `d` for the stripe's two long edges (offset ± width/2). */
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
  // Read the baked per-stripe geometry — re-deriving offsets here would
  // desync the outline from the painted paths the moment widths differ.
  const HALF = band.stripeWidths[stripeIndex] / 2;
  const offset = band.stripeOffsets[stripeIndex];
  const offsetA = offset + HALF;
  const offsetB = offset - HALF;

  const v0 = verts[0];
  const v1 = verts[1];
  const vN1 = verts[verts.length - 1];
  const vN2 = verts[verts.length - 2];

  // Slide v0 and vN1 along their incident-edge tangents per the requested
  // adjustments. Outward at v0 = away from v1 = -tangent; outward at vN1 =
  // away from vN2 = +tangent. Positive adjust = outward, negative = inward.
  const startAdj = adjust.start ?? 0;
  const endAdj = adjust.end ?? 0;
  const t0 = norm(sub(v1, v0));
  const tN = norm(sub(vN1, vN2));
  const adjV0: Vec2 = { x: v0.x - t0.x * startAdj, y: v0.y - t0.y * startAdj };
  const adjVN1: Vec2 = { x: vN1.x + tN.x * endAdj, y: vN1.y + tN.y * endAdj };
  const adjustedVerts =
    verts.length === 2 ? [adjV0, adjVN1] : [adjV0, ...verts.slice(1, -1), adjVN1];

  // Endpoint perpendiculars use the SAME leftNormal(norm(...)) that the
  // router's emitOffsetSegments applies at i=0 and i=last, so the cap lines
  // meet the long edges at exactly shared coordinates. Derived from the same
  // unit tangent as the slide above (which the colinear slide leaves unchanged).
  const p0 = leftNormal(t0);
  const pN = leftNormal(tN);

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
