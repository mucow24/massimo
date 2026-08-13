import { clamp } from '../util/grid';

export type Vec2 = { x: number; y: number };

export const v = (x: number, y: number): Vec2 => ({ x, y });

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const norm = (a: Vec2): Vec2 => {
  const L = len(a) || 1;
  return { x: a.x / L, y: a.y / L };
};
export const perp = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });
export const midpoint = (a: Vec2, b: Vec2): Vec2 => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});
// 90° normal to the LEFT of travel direction `a` in the y-DOWN screen frame
// (a = east → north). The band/stripe offset convention used by the router and
// interlining. Intentionally the negation of `perp` (which uses the math y-up
// convention) — keep the two distinct.
export const leftNormal = (a: Vec2): Vec2 => ({ x: a.y, y: -a.x });
export const eq = (a: Vec2, b: Vec2, eps = 1e-6) =>
  Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;

export const rotate = (a: Vec2, rad: number): Vec2 => {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
};

// Rotate `a` about `pivot` by `rad` — the pivoted form of `rotate` (same
// y-down / clockwise convention). The single home for "rotate a point around
// another point", used by station-label and polygon geometry.
export const rotateAround = (a: Vec2, pivot: Vec2, rad: number): Vec2 =>
  add(rotate(sub(a, pivot), rad), pivot);

// The four corners of an axis-aligned rectangle of half-extents (halfW, halfH)
// centered at `center`, then rotated by `rad` about that center. Returned
// clockwise from the (unrotated) top-left: [TL, TR, BR, BL], matching the SVG
// render transform (`translate(center) rotate`; positive `rotate` is clockwise
// in the y-down frame). The one home for "corners of a rotated rectangle",
// shared by svg-image, text-label, and stop-marker geometry.
export const rotatedRectCorners = (
  center: Vec2,
  halfW: number,
  halfH: number,
  rad: number,
): [Vec2, Vec2, Vec2, Vec2] => {
  const at = (sx: number, sy: number): Vec2 =>
    add(center, rotate({ x: sx * halfW, y: sy * halfH }, rad));
  return [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)];
};

// Arithmetic mean of the points (vertex centroid, NOT area-weighted). Empty
// input returns the origin (the `|| 1` guard) rather than NaN.
export const centroid = (points: readonly Vec2[]): Vec2 => {
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
  }
  const n = points.length || 1;
  return { x: sx / n, y: sy / n };
};

// The part of segment a→b that lies inside an axis-aligned rect, or null when
// none of it does. Liang–Barsky: walk the four edges as parametric half-planes,
// tightening the surviving [t0, t1] window on the segment. A degenerate segment
// (a === b) is a point test — itself when inside, null when out.
//
// Used to keep a measurement label on screen: the midpoint of a span whose far
// end is several viewports away is off screen too, so the label rides the
// midpoint of the CLIPPED span instead (see SnapGuides).
export const clipSegmentToRect = (
  a: Vec2,
  b: Vec2,
  rect: { x: number; y: number; w: number; h: number },
): { a: Vec2; b: Vec2 } | null => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  // [direction into the half-plane, signed distance from `a` to that edge].
  const edges: [number, number][] = [
    [-dx, a.x - rect.x],
    [dx, rect.x + rect.w - a.x],
    [-dy, a.y - rect.y],
    [dy, rect.y + rect.h - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      // Parallel to this edge: no crossing to solve for, so it either lies
      // inside the half-plane for its whole length or misses entirely.
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  return {
    a: { x: a.x + t0 * dx, y: a.y + t0 * dy },
    b: { x: a.x + t1 * dx, y: a.y + t1 * dy },
  };
};

// Unsigned angle in radians ([0, π]) between two UNIT vectors, via their
// clamped dot product (the clamp guards acos against FP drift past ±1). Callers
// pass unit tangents/directions; this does NOT normalize its inputs.
export const angleBetween = (a: Vec2, b: Vec2): number => Math.acos(clamp(dot(a, b), -1, 1));

// Half-angle tangent tan(θ/2) — the fillet / corner tangent-length factor.
export const tanHalf = (theta: number): number => Math.tan(theta / 2);

// Direction angle of a vector in DEGREES, measured from +x toward +y. Matches
// the SVG `rotate(deg)` convention, so it feeds straight into a transform.
export const angleDeg = (a: Vec2): number => (Math.atan2(a.y, a.x) * 180) / Math.PI;

// Component of a unit vector along a 45° diagonal: √2/2 = 1/√2 ≈ 0.7071.
// The single home for this constant; octolinear direction tables and snap
// axes all reference it.
export const SQRT2_2 = Math.SQRT1_2;

// A full turn in radians (2π). The single home for the constant every angle
// wrap and full-circle sweep references.
export const TAU = Math.PI * 2;
