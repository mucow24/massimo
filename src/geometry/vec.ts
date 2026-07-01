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

// Unsigned angle in radians ([0, π]) between two UNIT vectors, via their
// clamped dot product (the clamp guards acos against FP drift past ±1). Callers
// pass unit tangents/directions; this does NOT normalize its inputs.
export const angleBetween = (a: Vec2, b: Vec2): number =>
  Math.acos(Math.max(-1, Math.min(1, dot(a, b))));

// Half-angle tangent tan(θ/2) — the fillet / corner tangent-length factor.
export const tanHalf = (theta: number): number => Math.tan(theta / 2);

// Direction angle of a vector in DEGREES, measured from +x toward +y. Matches
// the SVG `rotate(deg)` convention, so it feeds straight into a transform.
export const angleDeg = (a: Vec2): number => (Math.atan2(a.y, a.x) * 180) / Math.PI;

// Component of a unit vector along a 45° diagonal: √2/2 = 1/√2 ≈ 0.7071.
// The single home for this constant; octolinear direction tables and snap
// axes all reference it.
export const SQRT2_2 = Math.SQRT1_2;
