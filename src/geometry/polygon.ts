import type { Vec2 } from './vec';

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
  let sx = 0;
  let sy = 0;
  for (const v of vertices) {
    sx += v.x;
    sy += v.y;
  }
  const n = vertices.length || 1;
  return { x: sx / n, y: sy / n };
}

/**
 * Midpoint of the edge from vertex `edgeIndex` to `(edgeIndex + 1) % n` (wraps
 * the last vertex back to the first). Used when splitting an edge via the "+".
 */
export function edgeMidpoint(vertices: Vec2[], edgeIndex: number): Vec2 {
  const n = vertices.length;
  const a = vertices[edgeIndex % n];
  const b = vertices[(edgeIndex + 1) % n];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
