import type { Pt } from './polygonUnion';

export interface AABB {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Sort an AABB's endpoints onto Lo/Hi bounds so callers don't have to assume a
 * corner order. `{x0,y0}`/`{x1,y1}` may be given in any diagonal (a drag rect
 * runs from wherever the pointer started to wherever it is now).
 */
export function normalizeAABB(rect: AABB): {
  xLo: number;
  xHi: number;
  yLo: number;
  yHi: number;
} {
  return {
    xLo: Math.min(rect.x0, rect.x1),
    xHi: Math.max(rect.x0, rect.x1),
    yLo: Math.min(rect.y0, rect.y1),
    yHi: Math.max(rect.y0, rect.y1),
  };
}

/**
 * True iff the AABB rect overlaps the (convex or non-convex) polygon.
 *
 * Three cases cover all overlaps:
 *   1. Any polygon vertex lies inside the rect.
 *   2. Any rect corner lies inside the polygon.
 *   3. Any polygon edge crosses any rect edge.
 *
 * `closed = false` tests an OPEN vertex chain instead: there is no interior
 * (case 2 is skipped) and no closing edge (the last→first segment is excluded
 * from case 3), so only contact with the stroke chain counts as overlap.
 *
 * Touch-only contact (shared edge or single point) usually registers as
 * overlap: the vertex-in-rect test and segmentsIntersect's t-range are both
 * inclusive (no epsilon). The exception is a collinear shared edge with no
 * vertex inside the rect — parallel segments never count as crossing. Callers
 * that want touch to NOT count should shrink the rect.
 */
export function rectIntersectsPolygon(rect: AABB, poly: Pt[], closed: boolean = true): boolean {
  if (poly.length < (closed ? 3 : 2)) return false;

  const { xLo, xHi, yLo, yHi } = normalizeAABB(rect);

  for (const p of poly) {
    if (p.x >= xLo && p.x <= xHi && p.y >= yLo && p.y <= yHi) return true;
  }

  const corners: Pt[] = [
    { x: xLo, y: yLo },
    { x: xHi, y: yLo },
    { x: xHi, y: yHi },
    { x: xLo, y: yHi },
  ];
  if (closed) {
    for (const c of corners) {
      if (pointInPolygon(c, poly)) return true;
    }
  }

  const edgeCount = closed ? poly.length : poly.length - 1;
  for (let i = 0; i < edgeCount; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    for (let j = 0; j < 4; j++) {
      const c = corners[j];
      const d = corners[(j + 1) % 4];
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }

  return false;
}

function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    const intersects =
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y || Number.EPSILON) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function segmentsIntersect(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (denom === 0) return false;
  const t1 = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  const t2 = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;
  return t1 >= 0 && t1 <= 1 && t2 >= 0 && t2 <= 1;
}
