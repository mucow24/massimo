import { describe, it, expect } from 'vitest';
import {
  advance,
  advanceHeld,
  bodyToWorld,
  DEFAULT_PARAMS,
  driveSwing,
  grabAt,
  grabReach,
  growRadius,
  kick,
  makeBall,
  makeDrop,
  release,
  velocityFromSamples,
  type BallParams,
  type Bounds,
} from './ballPhysics';

const BOX: Bounds = { width: 800, height: 600 };
const P: BallParams = DEFAULT_PARAMS;

/** Run `seconds` of simulation in frame-sized bites. */
const run = (s: Parameters<typeof advance>[0], seconds: number, p: BallParams = P) => {
  for (let t = 0; t < seconds; t += 1 / 60) advance(s, p, BOX, 1 / 60);
};

describe('ball physics', () => {
  it('rolls rather than skates: a sliding ball spins up until the contact point is still', () => {
    // Dropped flat on the floor with pure sideways speed and no spin. Friction
    // at the contact should convert that slide into a roll, which is the whole
    // reason the M reads as a ball instead of a sticker.
    const s = makeBall(400, BOX.height - P.radius);
    s.vx = 400;
    run(s, 2);
    // omega = vx / r is rolling without slipping, clockwise for rightward
    // travel. The steady state settles a hair UNDER it — rolling resistance
    // brakes the spin every substep and friction re-couples it — so this is a
    // relative bound, not an equality.
    expect(s.vx).toBeGreaterThan(0);
    const noSlip = s.vx / P.radius;
    expect(Math.abs(s.omega - noSlip) / noSlip).toBeLessThan(0.02);
    expect(s.angle).toBeGreaterThan(1);
  });

  it('loses energy on every bounce and never escapes the box', () => {
    const s = makeBall(400, 40);
    s.vx = 900;
    s.vy = -600;
    let apex = Infinity;
    for (let i = 0; i < 60 * 8; i++) {
      advance(s, P, BOX, 1 / 60);
      expect(s.x).toBeGreaterThanOrEqual(P.radius - 0.001);
      expect(s.x).toBeLessThanOrEqual(BOX.width - P.radius + 0.001);
      expect(s.y).toBeGreaterThanOrEqual(P.radius - 0.001);
      expect(s.y).toBeLessThanOrEqual(BOX.height - P.radius + 0.001);
      apex = Math.min(apex, s.y);
    }
    // It started near the ceiling; by the end it should be down on the floor.
    expect(apex).toBeLessThan(100);
    expect(s.y).toBeGreaterThan(BOX.height - 60);
  });

  it('comes fully to rest on the floor instead of buzzing or creeping', () => {
    const s = makeBall(400, 50);
    run(s, 12);
    expect(s.y).toBeCloseTo(BOX.height - P.radius, 3);
    expect(s.vx).toBe(0);
    expect(s.vy).toBe(0);
    expect(s.omega).toBe(0);
  });

  it('still settles when gravity is cranked past the resting threshold', () => {
    // The restitution cutoff has to track gravity, not just settleSpeed, or a
    // heavy ball reflects its own weight forever. Guards the tuning slider.
    const heavy: BallParams = { ...DEFAULT_PARAMS, gravity: 12000 };
    const s = makeBall(400, 50);
    run(s, 12, heavy);
    expect(s.vy).toBe(0);
    expect(s.y).toBeCloseTo(BOX.height - heavy.radius, 3);
  });

  it('drops with a nudge sideways and a little spin, not dead vertical', () => {
    const s = makeDrop(20, 20, P);
    expect(s.vx).toBe(P.dropVx);
    expect(s.omega).toBe(P.dropSpin);
    run(s, 0.25);
    expect(s.x).toBeGreaterThan(20); // drifted out of the corner
    expect(s.y).toBeGreaterThan(20); // and fell
  });

  it('grows from the badge size to the playing size over the fade', () => {
    const seed = 9;
    expect(growRadius(P, seed, 0)).toBe(seed);
    expect(growRadius(P, seed, P.dimMs)).toBe(P.radius);
    // Clamped, not extrapolated — the loop keeps calling this forever after.
    expect(growRadius(P, seed, P.dimMs * 10)).toBe(P.radius);
    // Eased out, so it's more than half grown at the halfway mark.
    const half = growRadius(P, seed, P.dimMs / 2);
    expect(half).toBeGreaterThan((seed + P.radius) / 2);
    expect(half).toBeLessThan(P.radius);
  });

  it('grows the COLLISION radius, so the walls ease the ball into view', () => {
    // Dropped in the top-left corner, where a ball already at full size would be
    // shoved clear of the toolbar on frame one — the teleport this animation
    // exists to avoid. It should start overlapping the corner and be pushed out
    // only as it swells.
    const seed = 9;
    const s = makeBall(20, 26);
    const small: BallParams = { ...P, radius: growRadius(P, seed, 0), gravity: 0 };
    advance(s, small, BOX, 1 / 60);
    expect(s.x).toBeCloseTo(20, 1); // still fits: nothing to push against
    const grown: BallParams = { ...P, radius: growRadius(P, seed, P.dimMs), gravity: 0 };
    advance(s, grown, BOX, 1 / 60);
    expect(s.x).toBeCloseTo(P.radius, 1); // now too big for the corner
  });

  it('never lets the grab reach shrink below the visible ball', () => {
    // The slider bottoms out under the ball's own radius; the disc you can see
    // has to stay grabbable whatever it's set to.
    expect(grabReach({ ...P, radius: 40, grabRadius: 6 })).toBe(40);
    expect(grabReach({ ...P, radius: 9, grabRadius: 60 })).toBe(60);
  });

  it('kicks the ball away from the pointer, spinning it forward', () => {
    const s = makeBall(400, 300);
    kick(s, P, 400 + P.radius, 300); // struck on its right side
    expect(s.vx).toBeCloseTo(-P.kickStrength, 5);
    // Travelling left, so it should roll left: counterclockwise on screen.
    expect(s.omega).toBeLessThan(0);
  });

  it('hangs from an off-center grip and swings down under it', () => {
    // Pinned at the rim, held out level to the LEFT of the grip: the center has
    // a lever arm, so it should fall and end up hanging below the pointer.
    const pin = { x: 400, y: 300 };
    const s = makeBall(pin.x - P.radius, pin.y);
    const grabLocal = { x: P.radius, y: 0 };
    advanceHeld(s, P, pin, grabLocal, 1 / 60);
    expect(s.omega).toBeLessThan(0); // swinging left-to-below is counterclockwise
    // Underdamped at the default, so the amplitude decays as exp(-swingDamp*t/2)
    // — it takes a good few seconds of rocking to actually come to rest.
    for (let i = 0; i < 60 * 12; i++) advanceHeld(s, P, pin, grabLocal, 1 / 60);
    // At rest the grip is straight up from the center, so the center hangs a
    // full radius below the pointer.
    expect(s.x).toBeCloseTo(pin.x, 1);
    expect(s.y).toBeCloseTo(pin.y + P.radius, 1);
    expect(s.omega).toBeCloseTo(0, 2);
  });

  it('whips the ball around the grip when the hand yanks the pin', () => {
    // Hanging dead still from a rim grip directly above its center. The hand
    // then accelerates RIGHT; the center should lag left, which about a grip
    // above it is a clockwise swing. Gravity alone can do none of this — the
    // ball is already at its resting angle.
    const s = makeBall(400, 300);
    const grabLocal = { x: 0, y: -P.radius };
    driveSwing(s, P, grabLocal, { x: 300, y: 0 });
    expect(s.omega).toBeGreaterThan(0);

    // Halting the hand swings it back the other way, which is why the pin gets
    // sampled every frame rather than every pointer event.
    const stopping = makeBall(400, 300);
    driveSwing(stopping, P, grabLocal, { x: -300, y: 0 });
    expect(stopping.omega).toBeLessThan(0);
  });

  it('leaves the swing to gravity alone when the whip is dialled out', () => {
    const s = makeBall(400, 300);
    driveSwing(s, { ...P, swingDrive: 0 }, { x: 0, y: -P.radius }, { x: 300, y: 0 });
    expect(s.omega).toBe(0);
  });

  it('whips a rim grip less than a centered one, by parallel axis', () => {
    // Same yank, same lever arm, but the rim grip carries r^2/2 + d^2 of
    // inertia against the near-center grip's r^2/2 + a bit.
    const rim = makeBall(400, 300);
    const near = makeBall(400, 300);
    driveSwing(rim, P, { x: 0, y: -P.radius }, { x: 300, y: 0 });
    driveSwing(near, P, { x: 0, y: -P.radius / 2 }, { x: 300, y: 0 });
    expect(Math.abs(rim.omega)).toBeLessThan(Math.abs(near.omega) * 2);
    expect(rim.omega).toBeGreaterThan(0);
  });

  it('does not swing when grabbed exactly through the center of mass', () => {
    // No lever arm, no torque — and it falls out of the same expression rather
    // than needing a special case.
    const pin = { x: 400, y: 300 };
    const s = makeBall(pin.x, pin.y);
    for (let i = 0; i < 60; i++) advanceHeld(s, P, pin, { x: 0, y: 0 }, 1 / 60);
    expect(s.omega).toBe(0);
    expect(s.angle).toBe(0);
    expect(s.x).toBe(pin.x);
    expect(s.y).toBe(pin.y);
  });

  it('grips the rim and snaps the ball out when caught in the reach ring', () => {
    // Clear of the rim to the right, so nothing of the body is under the
    // pointer: the grip is taken where the center-to-pointer line crosses the
    // rim and the ball comes to the cursor. Offsets are radius-relative, since
    // the tuned radius is feel and moves around.
    const outside = 400 + P.radius + 20;
    const s = makeBall(400, 300);
    const { local, snapped } = grabAt(s, P, outside, 300);
    expect(local).toEqual({ x: P.radius, y: 0 });
    expect(snapped.x).toBeCloseTo(outside - P.radius, 5);
    expect(snapped.y).toBeCloseTo(300, 5);

    // A press that lands ON the disc grips where it landed, and stays put.
    const inside = makeBall(400, 300);
    const hit = grabAt(inside, P, 400 + P.radius / 2, 300);
    expect(hit.local.x).toBeCloseTo(P.radius / 2, 5);
    expect(hit.snapped).toEqual({ x: 400, y: 300 });
  });

  it('takes the grip as a material point, so it turns with the ball', () => {
    // Same rim press on a ball already a quarter turn round: the world-space
    // grip is still to the pointer's side, but in BODY coordinates it has moved,
    // which is what keeps the pin from sliding over the surface as it swings.
    const s = makeBall(400, 300);
    s.angle = Math.PI / 2;
    const { local } = grabAt(s, P, 400 + P.radius + 20, 300);
    expect(local.x).toBeCloseTo(0, 5);
    expect(local.y).toBeCloseTo(-P.radius, 5);
    // Rotating it back out by the body angle lands on the world grip again.
    const world = bodyToWorld(local, s.angle);
    expect(world.x).toBeCloseTo(P.radius, 5);
    expect(world.y).toBeCloseTo(0, 5);
  });

  it('carries the swing into the throw: the center keeps orbiting the grip', () => {
    // Held at the rim directly ABOVE the center and swinging clockwise, the
    // center is at 6 o'clock and so is travelling left — even from a still hand.
    const s = makeBall(400, 300);
    s.omega = 4;
    release(s, P, { x: 0, y: -P.radius }, 0, 0);
    expect(s.vx).toBeCloseTo(4 * -P.radius, 5);
    expect(s.vy).toBeCloseTo(0, 5);
  });

  it('spins a throw from the lever arm of an off-center grip', () => {
    // Pins the flick-torque MECHANISM, so it dials throwSpin in explicitly — the
    // tuned default has it at zero, which is a preference about feel and not a
    // statement that the term should stop working.
    const flicky: BallParams = { ...P, throwSpin: 1 };
    // Held at the bottom and flicked right, a real disc tumbles backward.
    const s = makeBall(400, 300);
    release(s, flicky, { x: 0, y: P.radius }, 500, 0);
    expect(s.vx).toBeCloseTo(500 * flicky.throwScale, 5);
    expect(s.omega).toBeLessThan(0);

    // A grip dead on the center is a pure translation, no torque available.
    const center = makeBall(400, 300);
    release(center, flicky, { x: 0, y: 0 }, 500, 0);
    expect(center.omega).toBe(0);
  });

  it('measures throw speed from the flick, not the whole drag path', () => {
    // A slow haul across the window that ends in a fast flick should throw at
    // flick speed. Samples are ms/px.
    const samples = [
      { t: 0, x: 0, y: 0 },
      { t: 500, x: 100, y: 0 }, // 200 px/s of dawdling
      { t: 550, x: 150, y: 0 }, // 1000 px/s over the last 50ms
    ];
    expect(velocityFromSamples(samples, 70).vx).toBeCloseTo(1000, 5);
    // Nothing to measure is a drop, not a throw.
    expect(velocityFromSamples([{ t: 0, x: 0, y: 0 }], 70)).toEqual({ vx: 0, vy: 0 });
  });
});
