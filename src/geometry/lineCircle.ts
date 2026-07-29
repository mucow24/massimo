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
