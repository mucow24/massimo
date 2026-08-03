import {
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useFunMode } from '../state/funMode';
import { BRAND_BULLET_SIZE, BrandBullet } from './BrandBullet';
import { clamp } from '../util/grid';
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
  type BallState,
  type Bounds,
  type DragSample,
  type Vec,
} from '../fun/ballPhysics';

/** Only the flick counts toward a throw, not the whole drag path. */
const THROW_WINDOW_MS = 70;
/** A press that travels less than this is a click (kick), not a drag (throw). */
const CLICK_SLOP = 4;

/** The tuned feel, fixed. Was a live slider panel while the numbers were being
 *  found; they're found, so the ball just reads them. */
const P = DEFAULT_PARAMS;
/** The ball grows into its playing size from the badge's own, so the drop reads
 *  as the badge swelling rather than a swap. */
const SEED_RADIUS = BRAND_BULLET_SIZE / 2;
/** The grab circle, which is wider than even the grown ball and so never moves —
 *  the ball's element can keep one size for the whole session. */
const REACH = grabReach(P);

interface Drag {
  pointerId: number;
  /** The grip, in BODY-LOCAL coordinates: a material point of the ball, so it
   *  turns with it and the pendulum has something fixed to hang from. */
  grabLocal: Vec;
  /** Latest pointer position — the pin. Held here because the frame loop runs
   *  far more often than pointermove and needs somewhere to read it from. */
  pin: Vec;
  /** Last frame's pin velocity, so the loop can difference it into the angular
   *  impulse that whips the ball around. */
  lastV: Vec;
  /** Total POINTER path length, to tell a click from a drag. Measured on the
   *  hand, not the ball, which swings and snaps under it. */
  travel: number;
  samples: DragSample[];
}

/**
 * The bouncing "M" (see state/funMode.ts): a modal overlay that dims the app,
 * drops the toolbar badge out of the bar under gravity, and lets it be kicked,
 * dragged, and thrown around the window until a click on the map puts it back.
 *
 * Mounted unconditionally so the hooks keep a stable identity; renders nothing
 * while the phase is 'off'. Per-frame the loop writes `transform` straight to
 * the ball's node, so React renders only on a phase change, never on a frame.
 */
export function BouncingBullet() {
  const phase = useFunMode((s) => s.phase);
  const origin = useFunMode((s) => s.origin);
  const beginExit = useFunMode((s) => s.beginExit);
  const finishExit = useFunMode((s) => s.finishExit);

  const ball = useRef<BallState>(makeBall(0, 0));
  const ballEl = useRef<HTMLDivElement | null>(null);
  const growEl = useRef<HTMLDivElement | null>(null);
  const rootEl = useRef<HTMLDivElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const bounds = useRef<Bounds>({ width: 0, height: 0 });
  /** When the badge came loose, so the frame loop knows how far into the grow-in
   *  it is. */
  const droppedAt = useRef(0);
  /** The tuned params with the CURRENT radius patched in — one object reused
   *  every frame rather than a fresh spread 60 times a second. Everything that
   *  takes params reads this, so the growing ball collides at the size it looks.
   */
  const live = useRef<BallParams>({ ...P });

  /**
   * Where the walls are. Measured off the overlay root, NOT `window.innerWidth`
   * / `innerHeight`: those count the classic scrollbars, so the floor they
   * describe sits below the visible bottom and the ball rolls away underneath a
   * horizontal scrollbar. The root is `position: fixed; inset: 0`, which is both
   * scrollbar-free and the very box the ball is positioned inside — so the walls
   * are guaranteed to agree with what's on screen. `documentElement` is the
   * stand-in for the beat before the overlay mounts.
   */
  const measure = () => {
    const el = rootEl.current ?? document.documentElement;
    bounds.current = { width: el.clientWidth, height: el.clientHeight };
    const r = live.current.radius;
    const s = ball.current;
    s.x = clamp(s.x, r, Math.max(r, bounds.current.width - r));
    s.y = clamp(s.y, r, Math.max(r, bounds.current.height - r));
  };

  // A resize mid-bounce must not strand the ball outside the new walls.
  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // The ball's transform is written imperatively, never through the style prop —
  // React patches only the keys it manages, so per-frame writes survive a
  // re-render.
  const paint = () => {
    const el = ballEl.current;
    if (!el) return;
    const s = ball.current;
    // The node is the GRAB circle, with the visible badge centered in it, so it
    // offsets by the reach rather than the ball's own radius.
    el.style.transform = `translate(${s.x - REACH}px, ${s.y - REACH}px) rotate(${(s.angle * 180) / Math.PI}deg)`;
    // The grow-in scales an INNER wrapper rather than joining the transform
    // above, so the grab circle stays its full size throughout: the ball is at
    // its most fiddly to catch exactly while it's still small.
    if (growEl.current) {
      growEl.current.style.transform = `scale(${live.current.radius / P.radius})`;
    }
  };

  // Fresh drop from wherever the badge sits, at rest — gravity does the rest.
  // Painted before the browser sees the frame, or the ball shows up in the
  // window's top-left corner for one tick on its way to the toolbar.
  useLayoutEffect(() => {
    if (phase !== 'live') return;
    droppedAt.current = performance.now();
    live.current.radius = SEED_RADIUS;
    // First chance to read the real walls: the root is mounted by now, so this
    // is the measurement that beats window.innerHeight's scrollbar.
    measure();
    ball.current = makeDrop(origin.x, origin.y, P);
    drag.current = null;
    paint();
  }, [phase, origin]);

  // The crossfade out is pure CSS (see .fun-root[data-phase='exiting']); this
  // only retires the mode once it has played, which is what hands the toolbar
  // badge back its slot.
  useEffect(() => {
    if (phase !== 'exiting') return;
    const t = setTimeout(finishExit, P.dimMs);
    return () => clearTimeout(t);
  }, [phase, finishExit]);

  // Escape is the keyboard way out. Registered here rather than in App's global
  // handler, which is inert for the whole modal stretch.
  useEffect(() => {
    if (phase !== 'live') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      beginExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, beginExit]);

  useEffect(() => {
    if (phase === 'off') return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const s = ball.current;
      const d = drag.current;
      // Swelling from the badge's size into the playing size. Patched into the
      // shared params first, so everything below collides and grips at the size
      // actually on screen.
      const p = live.current;
      p.radius = growRadius(P, SEED_RADIUS, now - droppedAt.current);
      if (d) {
        // Sample the pin HERE rather than in pointermove: a cursor that has
        // stopped fires no events, so an event-driven buffer would report the
        // last speed forever and the ball would never feel you halt. Half the
        // swing lives in the stop.
        d.samples.push({ t: now, x: d.pin.x, y: d.pin.y });
        while (d.samples.length > 2 && now - d.samples[1].t > THROW_WINDOW_MS) {
          d.samples.shift();
        }
        const v = velocityFromSamples(d.samples, THROW_WINDOW_MS);
        driveSwing(s, p, d.grabLocal, { x: v.vx - d.lastV.x, y: v.vy - d.lastV.y });
        d.lastV = { x: v.vx, y: v.vy };
        advanceHeld(s, p, d.pin, d.grabLocal, dt);
      } else advance(s, p, bounds.current, dt);
      paint();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  if (phase === 'off') return null;

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (phase !== 'live' || e.button !== 0) return;
    // Keep it off the scrim behind, which would dismiss the mode.
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const s = ball.current;
    // A press in the reach ring has no ball under it, so grabAt takes the grip
    // at the rim and snaps the ball out to meet the cursor.
    const { local, snapped } = grabAt(s, live.current, e.clientX, e.clientY);
    s.x = snapped.x;
    s.y = snapped.y;
    // Linear velocity is derived from the pin while held; any spin it arrived
    // with is kept, and simply becomes the swing's opening rate.
    s.vx = 0;
    s.vy = 0;
    drag.current = {
      pointerId: e.pointerId,
      grabLocal: local,
      pin: { x: e.clientX, y: e.clientY },
      lastV: { x: 0, y: 0 },
      travel: 0,
      // Left for the frame loop to fill, so every sample carries one clock.
      samples: [],
    };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    // A move with no buttons down is a lost pointer, same as a cancel.
    if (e.buttons === 0) {
      drag.current = null;
      return;
    }
    // Only the pin moves here — the frame loop does the sampling and swings the
    // ball from it. The walls stay out of it, since a ball you're holding at the
    // window's edge should hang past it rather than fight your hand.
    d.travel += Math.hypot(e.clientX - d.pin.x, e.clientY - d.pin.y);
    d.pin = { x: e.clientX, y: e.clientY };
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    e.stopPropagation();
    const s = ball.current;
    if (d.travel < CLICK_SLOP) {
      kick(s, live.current, e.clientX, e.clientY);
      return;
    }
    const v = velocityFromSamples(d.samples, THROW_WINDOW_MS);
    // The grip has been turning with the ball all along; the throw needs it back
    // in world space to know which way the center is orbiting.
    release(s, live.current, bodyToWorld(d.grabLocal, s.angle), v.vx, v.vy);
  };

  return (
    // Both crossfades live in CSS, reading the dim and its duration off these
    // custom properties so the params stay the one place those are set.
    <div
      className="fun-root"
      ref={rootEl}
      data-phase={phase}
      style={{ '--fun-dim': P.dimOpacity, '--fun-ms': `${P.dimMs}ms` } as CSSProperties}
    >
      {/* The dimmer, and the way out: anything that isn't the ball ends it. */}
      <div className="fun-scrim" onPointerDown={beginExit} />
      {/* The node IS the grab circle — a transparent disc of REACH centered on
          the ball, with the visible badge centered inside it. Making the hit
          target the element itself keeps one transform driving both, and a
          circle is rotation-invariant so the spin costs it nothing. */}
      <div
        className="fun-ball"
        ref={ballEl}
        style={{ width: REACH * 2, height: REACH * 2 }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <div className="fun-ball-grow" ref={growEl}>
          <BrandBullet size={P.radius * 2} decorative />
        </div>
      </div>
    </div>
  );
}
