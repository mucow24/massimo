import { centroid, midpoint, type Vec2 } from './vec';
import { openPolylinePath, polygonsToPath } from './polygonUnion';

/**
 * The drag-snap anchor for a whole-polygon move: the **highest, then leftmost**
 * vertex (minimum y, ties broken by minimum x). The whole polygon translates by
 * the delta needed to snap this single point, so its relative shape is preserved.
 *
 * Pure; assumes `vertices.length >= 1` (polygons always have >= 3).
 */
export function polygonSnapAnchor(vertices: Vec2[]): Vec2 {
  let best = vertices[0];
  for (const v of vertices) {
    if (v.y < best.y || (v.y === best.y && v.x < best.x)) best = v;
  }
  return { x: best.x, y: best.y };
}

/**
 * Centroid as the mean of the vertices (vertex centroid, not area centroid).
 * Used as the rotation pivot for a single polygon and as the popover anchor.
 */
export function polygonCentroid(vertices: Vec2[]): Vec2 {
  return centroid(vertices);
}

/**
 * Midpoint of the edge from vertex `edgeIndex` to `(edgeIndex + 1) % n` (wraps
 * the last vertex back to the first). Used when splitting an edge via the "+".
 */
export function edgeMidpoint(vertices: Vec2[], edgeIndex: number): Vec2 {
  const n = vertices.length;
  const a = vertices[edgeIndex % n];
  const b = vertices[(edgeIndex + 1) % n];
  return midpoint(a, b);
}

/**
 * SVG path `d` for a single polygon. When `radius > 0`, every corner is rounded
 * with a quadratic Bézier whose trim is clamped per-corner to half the shorter
 * adjacent edge (so a large radius never overshoots); `radius <= 0` yields
 * straight edges (`M`/`L`/…/`Z`). Delegates to the shared rounding routine in
 * {@link polygonsToPath} rather than duplicating the Bézier math.
 *
 * `closed = false` renders the OPEN variant instead: the stroke follows the
 * vertex chain with no closing edge (no `Z`), rounding only the interior
 * vertices — the endpoints stay exact.
 */
export function polygonPathData(vertices: Vec2[], radius = 0, closed = true): string {
  return closed ? polygonsToPath([vertices], radius) : openPolylinePath(vertices, radius);
}
