import type { Vec2 } from './vec';

// Pure line-circle math, shared by the binding transforms, the drag
// constraint, and the arc-edge renderer. A circle is taken structurally
// ({x, y, radius}) so both the LineCircle entity and scratch specs fit.
export interface CircleSpec {
  x: number;
  y: number;
  radius: number;
}

/**
 * Polar angle of `p` as seen from the circle's center, in radians. Screen
 * y-down frame: angle 0 is EAST of center, increasing angles sweep
 * east → south → west → north (visually clockwise). A point AT the center has
 * no direction; it reads as angle 0, so the degenerate projection lands on
 * the circle's east point rather than exploding.
 */
export function circleAngleAt(c: CircleSpec, p: Vec2): number {
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  if (dx === 0 && dy === 0) return 0;
  return Math.atan2(dy, dx);
}

/** The circumference point at polar angle `theta` (see circleAngleAt). */
export function pointAtAngle(c: CircleSpec, theta: number): Vec2 {
  return { x: c.x + c.radius * Math.cos(theta), y: c.y + c.radius * Math.sin(theta) };
}

/** Nearest point on the circle's circumference to `p` (center ⇒ angle 0). */
export function projectToCircle(c: CircleSpec, p: Vec2): Vec2 {
  return pointAtAngle(c, circleAngleAt(c, p));
}

/**
 * Unit tangent of the circle at polar angle `theta` — the direction of travel
 * for increasing theta (visually clockwise in the y-down frame). Its sign is
 * immaterial to station orientation (a travel axis is symmetric under 180°);
 * the label-uprightness flip picks the readable one.
 */
export function tangentAtAngle(theta: number): Vec2 {
  return { x: -Math.sin(theta), y: Math.cos(theta) };
}

/**
 * Normalize an angle difference into (−π, π] — the SHORTER way around, with
 * the antipodal tie broken deterministically toward +π (increasing theta =
 * visually clockwise in the y-down frame). This is the whole "which arc?"
 * rule: an edge between two circle stops always takes `wrapAngleToPi(a1 − a0)`
 * of sweep; anything longer is expressed by splicing a bound waypoint onto the
 * circle, which splits the edge into two shorter arcs.
 */
export function wrapAngleToPi(d: number): number {
  const TAU = 2 * Math.PI;
  let out = d % TAU;
  if (out > Math.PI) out -= TAU;
  else if (out <= -Math.PI) out += TAU;
  return out;
}

/**
 * The tangent polygon of a circular arc: a polyline that the router's fillet
 * machinery (`filletPath` / `emitOffsetSegments` at radius `c.radius`) renders
 * as EXACTLY that arc. Endpoints sit ON the circle at `a0` and `a0 + delta`;
 * each interior vertex is the intersection of the tangent lines at its piece's
 * boundary angles, so the per-corner tangent budget consumes the whole edge
 * and the fillet IS the arc (to within the router's 1e-6 tangent epsilon).
 *
 * This is what lets a line-circle band be an ordinary SegmentBandSpec — same
 * centerline/radius/offsets contract, no new fields, every consumer (paint,
 * outlines, tag/hit sampling, region flattening, the incremental-region hash)
 * reproduces the arc through the code paths it already has.
 *
 * `delta` is the signed sweep in (−π, π] (see wrapAngleToPi); the arc is split
 * into ≤ 90° pieces so tangent intersections stay bounded (miter scale ≤ √2,
 * well under the router's 3× cap, keeping offset stripes exactly concentric).
 */
export function arcTangentPolygon(c: CircleSpec, a0: number, delta: number): Vec2[] {
  const abs = Math.abs(delta);
  const A = pointAtAngle(c, a0);
  const B = pointAtAngle(c, a0 + delta);
  if (abs < 1e-7) return [A, B];
  const pieces = Math.max(1, Math.ceil(abs / (Math.PI / 2)));
  const step = delta / pieces;
  // One interior vertex per piece: the tangent lines at the piece's boundary
  // angles meet at the mid-angle, r / cos(step/2) from the center.
  const miter = c.radius / Math.cos(step / 2);
  const verts: Vec2[] = [A];
  for (let i = 0; i < pieces; i++) {
    const mid = a0 + (i + 0.5) * step;
    verts.push({ x: c.x + miter * Math.cos(mid), y: c.y + miter * Math.sin(mid) });
  }
  verts.push(B);
  return verts;
}
