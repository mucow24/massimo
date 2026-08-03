/**
 * Physics for the bouncing-"M" easter egg (see state/funMode.ts). A single
 * uniform disc in window space: CSS pixels, seconds, +x right, +y DOWN.
 *
 * Rotation follows the screen, so `angle`/`omega` are CLOCKWISE-positive, which
 * makes the velocity of a material point at offset (rx, ry) from the center:
 *
 *     v_point = (vx - omega * ry, vy + omega * rx)
 *
 * Check it against the bottom of the ball, offset (0, +r): spinning clockwise
 * sends that point LEFT, and the formula gives (vx - omega * r, vy). Rolling
 * right without slipping is therefore omega = vx / r — forward roll, as the eye
 * expects. Every impulse below is derived from that one relation.
 *
 * Mass is 1, so a uniform disc's moment of inertia is r^2 / 2 and an impulse J
 * applied at offset r contributes `2 * cross(r, J) / r^2` to omega.
 *
 * The whole module is deterministic and frame-rate independent (fixed substeps),
 * which is what makes it testable and what keeps the feel from drifting with
 * display refresh rate.
 */

export interface BallState {
  /** Center, window space. */
  x: number;
  y: number;
  /** Linear velocity, px/s. */
  vx: number;
  vy: number;
  /** Radians, clockwise-positive. */
  angle: number;
  /** Angular velocity, rad/s, clockwise-positive. */
  omega: number;
}

export interface Bounds {
  width: number;
  height: number;
}

export interface Vec {
  x: number;
  y: number;
}

export interface BallParams {
  /** Ball radius in px. 9 matches the toolbar badge it drops out of. */
  radius: number;
  /** How close the pointer has to be to grab the ball, in px from its center.
   *  Independent of `radius` because the badge is small and a 9px target is a
   *  nuisance to catch mid-bounce; never smaller than the ball itself. */
  grabRadius: number;
  /** Sideways speed the badge leaves the toolbar with, px/s. A dead-vertical
   *  drop reads as a falling sticker rather than a ball coming loose. */
  dropVx: number;
  /** Spin it leaves with, rad/s, clockwise-positive. */
  dropSpin: number;
  /** Downward acceleration, px/s^2. */
  gravity: number;
  /** Fraction of normal speed kept per bounce. */
  restitution: number;
  /** Linear velocity decay, per second (exponential). */
  airDrag: number;
  /** Spin decay in flight, per second (exponential). */
  spinDrag: number;
  /** Swing decay while held, per second (exponential). How many times the ball
   *  rocks past level before it hangs still under the cursor. */
  swingDamp: number;
  /** How hard yanking the cursor around whips the ball about the grip. 0 leaves
   *  gravity as the only thing that can start a swing. */
  swingDrive: number;
  /** Contact grip, 0 = frictionless slide, 1 = instant no-slip roll. The dial
   *  that decides whether the M rolls or skates. */
  friction: number;
  /** Extra spin decay while touching a surface, per second. Without it a rolling
   *  ball coasts forever, since no-slip contact is lossless. */
  rollingResistance: number;
  /** Speed imparted by a click on the ball, px/s. */
  kickStrength: number;
  /** Forward spin per unit of kick (see `kick`). */
  kickSpin: number;
  /** Multiplier on the pointer's velocity when a drag is released. */
  throwScale: number;
  /** Spin per unit of off-center flick (see `release`). */
  throwSpin: number;
  /** Below this speed a contact stops bouncing, and a ball on the floor stops
   *  entirely. Kills the jitter a resting ball would otherwise show. */
  settleSpeed: number;
  /** Scrim opacity over the dimmed map, 0..1. */
  dimOpacity: number;
  /** Crossfade duration for the dim and the badge handoff, ms. */
  dimMs: number;
}

/**
 * Tuned by hand against the running thing — these are feel, not derivation.
 *
 * Two of them are zero, and that is a result rather than an oversight: spin in
 * flight was better left undamped (the ball keeps turning until something it
 * touches slows it), and the extra flick-torque on release turned out to be
 * noise on top of the swing a held ball already carries. They stay as dials
 * because they are members of a coherent set — dropping just these two would
 * leave the odd question of why flight spin cannot decay when rolling spin can
 * — and because zero records that they were tried. The terms cost a multiply by
 * one. Tests that pin either MECHANISM dial it in explicitly rather than reading
 * these values.
 */
export const DEFAULT_PARAMS: BallParams = {
  radius: 50,
  grabRadius: 125,
  dropVx: 120,
  dropSpin: 5,
  gravity: 4000,
  restitution: 0.72,
  airDrag: 0.15,
  spinDrag: 0,
  swingDamp: 2,
  swingDrive: 1,
  friction: 1,
  rollingResistance: 2.5,
  kickStrength: 2500,
  kickSpin: 1,
  throwScale: 2,
  throwSpin: 0,
  settleSpeed: 5,
  dimOpacity: 0.8,
  dimMs: 450,
};

/** Simulation granularity. Small enough that a fast ball can't tunnel a wall at
 *  any plausible speed, and fixed so behavior doesn't change with frame rate. */
const SUBSTEP = 1 / 240;
/** Longest span one call will simulate. A backgrounded tab hands back a huge dt;
 *  without this the catch-up loop stalls the frame it returns on. */
const MAX_FRAME = 0.1;

export function makeBall(x: number, y: number): BallState {
  return { x, y, vx: 0, vy: 0, angle: 0, omega: 0 };
}

/**
 * The ball's radius partway through the drop, easing out from the toolbar
 * badge's own size to the full playing size over `dimMs` — the same beat the map
 * dims on, so the badge appears to swell as it comes loose rather than being
 * swapped for a much bigger object.
 *
 * This is the COLLISION radius, not just the drawn one. Growing only the picture
 * would have the ball colliding at full size from frame one, which shoves it
 * clear of the toolbar corner before it has visibly grown — a teleport. Growing
 * the real radius instead lets the walls ease it into view as it swells.
 */
export function growRadius(p: BallParams, from: number, elapsedMs: number): number {
  if (p.dimMs <= 0) return p.radius;
  const t = clamp01(elapsedMs / p.dimMs);
  // Ease out: fastest at the start, so it reads as a pop rather than a creep.
  return from + (p.radius - from) * (1 - (1 - t) * (1 - t));
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** The badge coming loose: it leaves with a nudge sideways and a little spin,
 *  so the first thing the eye sees is a ball, not a dropped sticker. */
export function makeDrop(x: number, y: number, p: BallParams): BallState {
  const s = makeBall(x, y);
  s.vx = p.dropVx;
  s.omega = p.dropSpin;
  return s;
}

/** The pointer's reach, which is the grab dial but never less than the ball —
 *  the visible disc is always grabbable no matter how the slider is set. */
export function grabReach(p: BallParams): number {
  return Math.max(p.radius, p.grabRadius);
}

/**
 * The speed below which a contact is treated as resting rather than colliding.
 * Gravity hands a grounded ball `gravity * SUBSTEP` of fresh normal speed every
 * substep, so the threshold has to clear that or a ball at rest reflects its own
 * weight forever and buzzes — which is why this tracks gravity instead of
 * trusting the dial alone.
 */
function quietSpeed(p: BallParams): number {
  return Math.max(p.settleSpeed, p.gravity * SUBSTEP * 2);
}

/** Integrate `dt` seconds of free flight, bouncing off all four window edges. */
export function advance(s: BallState, p: BallParams, b: Bounds, dt: number): void {
  let remaining = Math.min(dt, MAX_FRAME);
  while (remaining > 0) {
    const h = Math.min(SUBSTEP, remaining);
    substep(s, p, b, h);
    remaining -= h;
  }
}

/** Turn a body-local offset into a world one at the given body angle. Pass a
 *  negated angle to go the other way. */
export function bodyToWorld(v: Vec, angle: number): Vec {
  const c = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: v.x * c - v.y * sin, y: v.x * sin + v.y * c };
}

/** Rotational inertia about a grip `w` away from the center, by parallel axis.
 *  A rim grip resists turning three times as hard as one at the center. */
function pinInertia(p: BallParams, w: Vec): number {
  return (p.radius * p.radius) / 2 + (w.x * w.x + w.y * w.y);
}

/**
 * The hand yanking the pin around — which is what actually makes a held ball
 * swing, far more than gravity does.
 *
 * The pin is on a prescribed path rather than a free body, so its frame is an
 * accelerating one, and in it the center feels a pseudo-force of `-a` for a pin
 * acceleration `a`. That force has the same lever arm gravity does, so it
 * torques the body about the grip: whip the cursor left and the ball lags right
 * and swings, exactly as a weight on a string does.
 *
 * Takes the frame's CHANGE in pin velocity rather than an acceleration, because
 * that's the honest measurement — an angular impulse over the frame, with no
 * division by a frame time that a dropped frame would make a lie.
 */
export function driveSwing(s: BallState, p: BallParams, grabLocal: Vec, dv: Vec): void {
  const w = bodyToWorld(grabLocal, s.angle);
  s.omega += (p.swingDrive * (w.x * dv.y - w.y * dv.x)) / pinInertia(p, w);
}

/**
 * A held ball hangs from the grip rather than being carried rigidly: a physical
 * pendulum, pinned at `grabLocal` (a material point of the body, so it turns
 * with it) and weighted at the center.
 *
 * Gravity acts at the center of mass, which is `d` away from the pin, so it has
 * a lever arm — grab the badge off to one side and it swings down and past,
 * rocking until `swingDamp` bleeds it off. The inertia about the pin is the
 * parallel-axis sum, `r^2 / 2 + d^2`, which is what makes a grip near the rim
 * swing slower than one near the center. A grip exactly ON the center has no
 * lever and no swing, and that falls out of the same expression rather than
 * needing a special case.
 *
 * The pin is the pointer, so the drag still owns where the ball IS; the
 * pendulum only decides how it hangs.
 */
export function advanceHeld(
  s: BallState,
  p: BallParams,
  pin: Vec,
  grabLocal: Vec,
  dt: number,
): void {
  let remaining = Math.min(dt, MAX_FRAME);
  while (remaining > 0) {
    const h = Math.min(SUBSTEP, remaining);
    const g = bodyToWorld(grabLocal, s.angle);
    // Torque about the pin from a downward force at the center. With the center
    // at -g from the pin, `rx * Fy - ry * Fx` collapses to just -g.x * gravity:
    // only the HORIZONTAL offset of the grip does any turning, which is the
    // pendulum coming to rest hanging straight down.
    s.omega += ((-g.x * p.gravity) / pinInertia(p, g)) * h;
    s.omega *= Math.exp(-p.swingDamp * h);
    s.angle += s.omega * h;
    remaining -= h;
  }
  // The grip is pinned to the pointer; wherever that leaves the center is where
  // the center goes.
  const g = bodyToWorld(grabLocal, s.angle);
  s.x = pin.x - g.x;
  s.y = pin.y - g.y;
}

/**
 * Where a press lands on the body, given the pointer and the ball's state.
 *
 * A press inside the disc grips exactly where it landed. A press in the reach
 * ring OUTSIDE the disc has no material point under it, so the grip is taken
 * where the line from the center to the pointer crosses the rim, and the ball
 * snaps out to meet it — `snapped` is the center's new home. Either way the
 * offset comes back in BODY-LOCAL coordinates, ready to pin.
 */
export function grabAt(s: BallState, p: BallParams, px: number, py: number) {
  let dx = px - s.x;
  let dy = py - s.y;
  const dist = Math.hypot(dx, dy);
  let world: Vec;
  let snapped: Vec = { x: s.x, y: s.y };
  if (dist > p.radius) {
    if (dist < 1e-6) {
      // Degenerate only if the reach ring somehow starts at the center.
      dx = 0;
      dy = -1;
    } else {
      dx /= dist;
      dy /= dist;
    }
    world = { x: dx * p.radius, y: dy * p.radius };
    snapped = { x: px - world.x, y: py - world.y };
  } else {
    world = { x: dx, y: dy };
  }
  return { local: bodyToWorld(world, -s.angle), snapped };
}

function substep(s: BallState, p: BallParams, b: Bounds, h: number): void {
  s.vy += p.gravity * h;
  s.x += s.vx * h;
  s.y += s.vy * h;
  s.angle += s.omega * h;

  const linear = Math.exp(-p.airDrag * h);
  s.vx *= linear;
  s.vy *= linear;
  s.omega *= Math.exp(-p.spinDrag * h);

  const r = p.radius;
  // Inward normal per edge, paired with how far the ball has crossed it.
  contact(s, p, h, 0, -1, s.y + r - b.height); // floor
  contact(s, p, h, 0, 1, r - s.y); // ceiling
  contact(s, p, h, -1, 0, s.x + r - b.width); // right wall
  contact(s, p, h, 1, 0, r - s.x); // left wall

  // A ball that has run out of energy on the floor is put fully to sleep, so it
  // neither creeps nor shivers at rest.
  if (
    s.y + r >= b.height - 0.5 &&
    Math.abs(s.vx) < p.settleSpeed &&
    Math.abs(s.vy) < quietSpeed(p) &&
    Math.abs(s.omega * r) < p.settleSpeed
  ) {
    s.vx = 0;
    s.vy = 0;
    s.omega = 0;
  }
}

/**
 * Resolve one edge. `nx, ny` is the inward normal; `pen` is the penetration
 * depth, so a negative value means no contact. Runs every substep while the ball
 * rests against a surface, not just on impact — that continuous grip is what
 * turns a slide into a roll and eventually brings the ball to a stop.
 */
function contact(
  s: BallState,
  p: BallParams,
  h: number,
  nx: number,
  ny: number,
  pen: number,
): void {
  if (pen < 0) return;
  s.x += nx * pen;
  s.y += ny * pen;

  const vn = s.vx * nx + s.vy * ny;
  if (vn < 0) {
    // Slow contacts don't bounce: gravity re-injects a little normal speed every
    // substep, and reflecting that is exactly the resting-ball buzz. The floor
    // for "slow" tracks gravity as well as the dial, so cranking the gravity
    // slider can't push a resting ball back into shivering.
    const e = -vn > quietSpeed(p) ? p.restitution : 0;
    const dvn = -(1 + e) * vn;
    s.vx += nx * dvn;
    s.vy += ny * dvn;
  }

  // Contact point and surface tangent.
  const rx = -nx * p.radius;
  const ry = -ny * p.radius;
  const tx = -ny;
  const ty = nx;
  const vt = (s.vx - s.omega * ry) * tx + (s.vy + s.omega * rx) * ty;
  // A tangential impulse J moves the contact point by 3J: one part from the
  // center, two from the spin it induces (r^2/2 inertia). Full stick is
  // therefore J = -vt / 3, and `friction` scales between that and free slip.
  const j = (-p.friction * vt) / 3;
  s.vx += tx * j;
  s.vy += ty * j;
  s.omega += (2 * (rx * (ty * j) - ry * (tx * j))) / (p.radius * p.radius);

  s.omega *= Math.exp(-p.rollingResistance * h);
}

/**
 * A click on the ball shoves it away from the pointer.
 *
 * The spin is an honest cheat. A purely radial impulse passes through the center
 * and so cannot torque a free disc — real physics gives a punched ball no spin
 * at all. Instead the ball is spun as though it were rolling in the direction it
 * now travels, which is what the eye expects from a struck ball; `kickSpin` is
 * the dial, and 0 turns it off.
 */
export function kick(s: BallState, p: BallParams, px: number, py: number): void {
  let dx = s.x - px;
  let dy = s.y - py;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) {
    // Dead center: nothing to push away from, so pop it upward.
    dx = 0;
    dy = -1;
  } else {
    dx /= d;
    dy /= d;
  }
  s.vx += dx * p.kickStrength;
  s.vy += dy * p.kickStrength;
  s.omega += (p.kickSpin * dx * p.kickStrength) / p.radius;
}

/**
 * Let go, with the hand moving at (vx, vy) and the grip `grab` from the center.
 *
 * The center is orbiting the pinned grip at whatever rate the swing reached, so
 * it leaves with that orbital velocity on top of the hand's — release a ball
 * mid-swing and it carries on the way it was already going, rather than
 * inheriting the hand alone. The spin needs no help from the swing; it IS the
 * swing. `throwSpin` adds the extra torque of a flick, which a pinned pendulum
 * doesn't otherwise feel because this model moves the pin without accelerating
 * it.
 */
export function release(s: BallState, p: BallParams, grab: Vec, vx: number, vy: number): void {
  const hx = vx * p.throwScale;
  const hy = vy * p.throwScale;
  s.vx = hx + s.omega * grab.y;
  s.vy = hy - s.omega * grab.x;
  s.omega += (p.throwSpin * (grab.x * hy - grab.y * hx)) / (p.radius * p.radius);
}

export interface DragSample {
  t: number;
  x: number;
  y: number;
}

/**
 * Pointer velocity in px/s, measured across the last `windowMs` of samples so a
 * throw reads the flick rather than the whole drag path. Returns zero when
 * there's nothing to measure — a drag that ended stationary is a drop.
 */
export function velocityFromSamples(
  samples: DragSample[],
  windowMs: number,
): { vx: number; vy: number } {
  if (samples.length < 2) return { vx: 0, vy: 0 };
  const last = samples[samples.length - 1];
  let first = samples[samples.length - 1];
  for (let i = samples.length - 1; i >= 0; i--) {
    if (last.t - samples[i].t > windowMs) break;
    first = samples[i];
  }
  const dt = (last.t - first.t) / 1000;
  if (dt <= 0) return { vx: 0, vy: 0 };
  return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt };
}
