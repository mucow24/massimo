// The canvas-lock invariant for item popovers, exercised end-to-end: once a
// popover has spawned, its top-left corner is glued to ONE world point — for
// any sequence of wheel ticks, pending publishes, settle commits, pans,
// committed jumps, and resizes, the corner renders at exactly
// projectToScreen(that point, current view). No screen-space term (gap, clamp)
// may survive spawn, and nothing may re-run the spawn placement while the
// popover lives. This invariant has regressed repeatedly (the "wandering
// popovers" bug); every scenario here drives the stores the way the app does
// (per-tick setPending like applyViewBox, then useViewport.commitPending's
// setViewport + setPending(null)) so a regression anywhere in the chain fails.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StrictMode } from 'react';
import { act, render, fireEvent } from '@testing-library/react';
import { ItemPopovers } from './ItemPopovers';
import { useDoc } from '../../state/store';
import { useSelection } from '../../state/selection';
import { useLiveViewportStore, useViewportStore } from '../../state/viewportStore';
import { DEFAULT_DOC } from '../../model/transforms';
import { makeLine } from '../../test/fixtures';
import {
  computeWheelZoom,
  fitViewport,
  liveProjection,
  panFromDelta,
  viewBoxFor,
} from './viewportMath';
import {
  choosePopoverSpawn,
  POPOVER_NOMINAL,
  projectToScreen,
  screenToWorldPoint,
  type ViewportProjection,
} from './screenAnchor';
import { stationWorldAABB } from '../../geometry/itemBounds';
import { stopHalfOf } from '../../model/lineWidth';
import { effectiveStationLabelStyle } from '../../model/transforms';
import type { RouteBullet, Station } from '../../model/types';

const SIZE = { w: 800, h: 600 };
// Float slack for a corner that is exactly canvas-locked: repeated projections
// accumulate ~1e-10 px. Anything visible is orders of magnitude above this.
const EPS = 1e-6;

// ---- app-faithful plumbing ---------------------------------------------------

// MapCanvas equivalent: subscribes to the COMMITTED viewport store and derives
// the view prop, so a settle commit re-renders ItemPopovers with a fresh view
// object exactly like the real canvas.
function Harness({ size = SIZE }: { size?: { w: number; h: number } }) {
  const x = useViewportStore((s) => s.x);
  const y = useViewportStore((s) => s.y);
  const zoom = useViewportStore((s) => s.zoom);
  return <ItemPopovers view={{ ...viewBoxFor({ x, y, zoom }, size), size }} />;
}

const rectFor = (size: { w: number; h: number }) => ({
  left: 0,
  top: 0,
  width: size.w,
  height: size.h,
});

const committedViewport = () => {
  const s = useViewportStore.getState();
  return { x: s.x, y: s.y, zoom: s.zoom };
};

// useViewport.liveViewport(): the in-flight gesture viewport, else committed.
const liveViewport = () => useLiveViewportStore.getState().pending ?? committedViewport();

// The exact projection ItemPopovers renders with this instant (committed view
// re-projected through pending — see useLiveView/liveProjection).
const currentView = (size = SIZE): ViewportProjection =>
  liveProjection(
    { ...viewBoxFor(committedViewport(), size), size },
    useLiveViewportStore.getState().pending,
  );

// One wheel tick, app-style: computeWheelZoom from the LIVE viewport, publish
// as pending (applyViewBox). No commit — that's the settle timer's job.
function wheelTick(clientX: number, clientY: number, deltaY: number, size = SIZE) {
  act(() => {
    useLiveViewportStore
      .getState()
      .setPending(computeWheelZoom(liveViewport(), size, rectFor(size), clientX, clientY, deltaY));
  });
}

// useViewport.commitPending(), verbatim order: setViewport(pending) THEN
// setPending(null).
function settleCommit() {
  act(() => {
    const pending = useLiveViewportStore.getState().pending;
    if (pending) {
      useViewportStore.getState().setViewport(pending);
      useLiveViewportStore.getState().setPending(null);
    }
  });
}

// ---- measurement --------------------------------------------------------------

function cornerPx(sel: string): { x: number; y: number } {
  const el = document.querySelector(sel) as HTMLElement | null;
  if (!el) throw new Error('popover not rendered: ' + sel);
  return { x: parseFloat(el.style.left), y: parseFloat(el.style.top) };
}

const worldUnder = (pt: { x: number; y: number }, v: ViewportProjection) => ({
  x: v.vbX + (pt.x / v.size.w) * v.vbW,
  y: v.vbY + (pt.y / v.size.h) * v.vbH,
});

// Records the world point under the popover corner at construction; sample()
// returns how far (screen px) the corner has strayed from that point's
// projection through the CURRENT view. Canvas-locked ⇒ every sample ≈ 0.
class Tracker {
  Q: { x: number; y: number };
  maxDrift = 0;
  size: { w: number; h: number };
  constructor(
    public sel: string,
    size = SIZE,
  ) {
    this.size = size;
    this.Q = worldUnder(cornerPx(sel), currentView(size));
  }
  sample(size?: { w: number; h: number }) {
    if (size) this.size = size;
    const c = cornerPx(this.sel);
    const p = projectToScreen(this.Q, currentView(this.size));
    const drift = Math.hypot(c.x - p.x, c.y - p.y);
    this.maxDrift = Math.max(this.maxDrift, drift);
    return drift;
  }
}

// Wheel-zoom from the current zoom in tick/commit cycles, sampling the tracker
// after every tick and every commit. deltaY +120 zooms out, -120 zooms in.
function zoomCycles(
  t: Tracker,
  cursor: { x: number; y: number },
  deltaY: number,
  cycles = 3,
  ticks = 5,
) {
  for (let c = 0; c < cycles; c++) {
    for (let i = 0; i < ticks; i++) {
      wheelTick(cursor.x, cursor.y, deltaY, t.size);
      t.sample();
    }
    settleCommit();
    t.sample();
  }
}

// ---- fixtures -------------------------------------------------------------------

const bulletAt = (x: number, y: number): RouteBullet => ({
  id: 'b1',
  x,
  y,
  rotation: 0,
  lineId: null,
  shape: 'circle',
  size: 10,
});

function seedBullet(x: number, y: number) {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC, routeBullets: { b1: bulletAt(x, y) } });
  useSelection.getState().selectRouteBullet('b1');
}

const stationRecord = (id: string, x: number, y: number): Station => ({
  id,
  name: id,
  x,
  y,
  rotation: 0,
  stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' as const }],
  label: {
    row: 0,
    col: -1,
    rotation: 0,
    offset: 0,
    align: 'auto' as const,
    valign: 'middle' as const,
  },
});

function seedStations(defs: Array<{ id: string; x: number; y: number }>, select: string) {
  useDoc.setState({
    ...useDoc.getState(),
    ...DEFAULT_DOC,
    stations: Object.fromEntries(defs.map((d) => [d.id, stationRecord(d.id, d.x, d.y)])),
    lines: {
      L1: makeLine({
        id: 'L1',
        service: '1',
        name: '1 line',
        color: '#111111',
        stations: defs.map((d) => d.id),
      }),
    },
    lineOrder: ['L1'],
  });
  useSelection.getState().selectStation(select);
}

function seedStation(x: number, y: number) {
  seedStations([{ id: 'a', x, y }], 'a');
}

const SEL = '.bullet-popover';

// The spawn ItemPopovers computes for a station against view `v` (jsdom shell
// measurement is 0, so the placement falls back to the POPOVER_NOMINAL
// square). Used by the deferral tests to derive the exact expected corner
// without hand-computing the measured-text label rect.
function stationSpawnAt(id: string, v: ViewportProjection): { x: number; y: number } {
  const doc = useDoc.getState();
  const st = doc.stations[id];
  const style = effectiveStationLabelStyle(st);
  const r = stationWorldAABB(st, style, stopHalfOf(doc.lines));
  const p0 = projectToScreen({ x: r.x0, y: r.y0 }, v);
  const p1 = projectToScreen({ x: r.x1, y: r.y1 }, v);
  return choosePopoverSpawn(
    { x0: p0.x, y0: p0.y, x1: p1.x, y1: p1.y },
    { w: POPOVER_NOMINAL, h: POPOVER_NOMINAL },
    v.size,
  );
}

beforeEach(() => {
  useViewportStore.setState({ x: 0, y: 0, zoom: 1 });
  useLiveViewportStore.setState({ pending: null });
  // Keep spawn arithmetic in the plain 800×600 box: the open sidebar
  // (default) would subtract its 320px strip from the placement box.
  useSelection.setState({ ...useSelection.getState(), sidebarOpen: false });
});

afterEach(() => {
  useLiveViewportStore.setState({ pending: null });
  useSelection.getState().selectRouteBullet(null);
  useSelection.getState().selectStation(null);
  useSelection.getState().setUiMode({ kind: 'idle' });
});

describe('popover canvas lock — the corner stays glued to its spawn world point', () => {
  it('plain on-screen spawn, wheel-zoom-out to ZOOM_MIN with settle commits', () => {
    // Bullet rect (±10 world) spans screen (390,290)–(410,310); spawn opens
    // gap-diagonal below-left of it: (390−14−248, 310+14), unclamped.
    seedBullet(0, 0);
    render(<Harness />);
    expect(cornerPx(SEL).x).toBeCloseTo(128, 9);
    expect(cornerPx(SEL).y).toBeCloseTo(324, 9);
    const t = new Tracker(SEL);
    zoomCycles(t, { x: 250, y: 200 }, 120, 3, 5); // ends clamped at ZOOM_MIN=0.1
    expect(t.maxDrift).toBeLessThanOrEqual(EPS);
  });

  it('StrictMode double-invoked layout effects: same spawn, still locked', () => {
    // The app runs under StrictMode in dev; the measure-then-freeze layout
    // effect is double-invoked on mount. Both invocations recompute the same
    // spawn from the same render-captured inputs, so the corner must land on
    // the plain (128,324) spawn and stay canvas-locked.
    seedBullet(0, 0);
    render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    );
    expect(cornerPx(SEL).x).toBeCloseTo(128, 9);
    expect(cornerPx(SEL).y).toBeCloseTo(324, 9);
    const t = new Tracker(SEL);
    zoomCycles(t, { x: 250, y: 200 }, 120, 1, 5);
    expect(t.maxDrift).toBeLessThanOrEqual(EPS);
  });

  it('measured shell footprint drives the placement (not the nominal square)', () => {
    // jsdom's zero offsetWidth/Height normally routes every test through the
    // POPOVER_NOMINAL fallback — stub layout-aware getters (zero under
    // display:none, like a real browser) so this test exercises the measured
    // path end-to-end: a 320×560 shell beside the (390,290)–(410,310) bullet
    // rect puts the diagonal x at 390−14−320 = 56 and clamps y to
    // 600−560−8 = 32. A dropped shellRef, transposed w/h, or a display:none
    // measuring frame would all land elsewhere ((128,324) / the right side /
    // (128,324)).
    const origW = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')!;
    const origH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return this.style.display === 'none' ? 0 : 320;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return this.style.display === 'none' ? 0 : 560;
      },
    });
    try {
      seedBullet(0, 0);
      render(<Harness />);
      expect(cornerPx(SEL).x).toBeCloseTo(56, 9);
      expect(cornerPx(SEL).y).toBeCloseTo(32, 9);
      // The measured spawn dissolves into a frozen world point like any other.
      const t = new Tracker(SEL);
      zoomCycles(t, { x: 250, y: 200 }, 120, 1, 5);
      expect(t.maxDrift).toBeLessThanOrEqual(EPS);
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', origW);
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', origH);
    }
  });

  it('clamped spawn (item near bottom-right), same zoom-out', () => {
    // Bullet rect spans screen (770,570)–(790,590): the below-left diagonal
    // x = 770−14−248 = 508 clears the rect on its own; y clamps to
    // 600−248−8 = 344.
    seedBullet(380, 280);
    render(<Harness />);
    expect(cornerPx(SEL).x).toBeCloseTo(508, 9);
    expect(cornerPx(SEL).y).toBeCloseTo(344, 9);
    const t = new Tracker(SEL);
    zoomCycles(t, { x: 250, y: 200 }, 120, 3, 5);
    expect(t.maxDrift).toBeLessThanOrEqual(EPS);
  });

  it('clamped spawn, zoom IN at the item: corner stays put on the canvas', () => {
    // The clamp dissolves into the spawn point: zooming in, the corner must
    // stay glued to the map spot where the panel visibly opened (the item
    // recedes from it as the map stretches — that is canvas-locking, not
    // wander). The world-baked-offset regression showed up here as the corner
    // drifting off its spawn point.
    seedBullet(380, 280);
    render(<Harness />);
    const t = new Tracker(SEL);
    zoomCycles(t, { x: 780, y: 580 }, -120, 3, 4);
    expect(t.maxDrift).toBeLessThanOrEqual(EPS);
  });

  it('off-screen item: clamp yanks the spawn in, then zoom-out + pan + fit-all', () => {
    seedBullet(5000, 0); // projects at screen x 5400 — spawn fully off-host
    render(<Harness />);
    const c = cornerPx(SEL);
    expect(c.x).toBeGreaterThanOrEqual(0);
    expect(c.x).toBeLessThanOrEqual(SIZE.w);
    const t = new Tracker(SEL);
    zoomCycles(t, { x: 400, y: 300 }, 120, 3, 5); // to zoom 0.1
    // Pan gesture, app-style (panFromDelta ticks into pending, commit at up).
    const base = liveViewport();
    const start = { mx: 400, my: 300, vx: base.x, vy: base.y };
    for (let i = 1; i <= 4; i++) {
      act(() => {
        useLiveViewportStore
          .getState()
          .setPending(panFromDelta(start, 400 - 75 * i, 300, base.zoom));
      });
      t.sample();
    }
    settleCommit();
    t.sample();
    // Fit-all: the committed-jump path (no pending at all).
    act(() => {
      useViewportStore.getState().setViewport(fitViewport({ x: 0, y: 0, w: 5000, h: 10 }, SIZE));
    });
    t.sample();
    expect(t.maxDrift).toBeLessThanOrEqual(EPS);
  });

  it('interleaved zoom out/in ending at the start viewport: exact round-trip', () => {
    seedBullet(0, 0);
    render(<Harness />);
    const spawn = cornerPx(SEL);
    const t = new Tracker(SEL);
    const cursor = { x: 250, y: 200 };
    for (const dy of [120, 120, 120, -120, 120, -120]) {
      wheelTick(cursor.x, cursor.y, dy, t.size);
      t.sample();
    }
    settleCommit();
    t.sample();
    for (const dy of [-120, -120, 120, -120]) {
      wheelTick(cursor.x, cursor.y, dy, t.size);
      t.sample();
    }
    settleCommit();
    t.sample();
    expect(committedViewport().zoom).toBeCloseTo(1, 6);
    const back = cornerPx(SEL);
    expect(Math.hypot(back.x - spawn.x, back.y - spawn.y)).toBeLessThanOrEqual(EPS);
    expect(t.maxDrift).toBeLessThanOrEqual(EPS);
  });

  it('header drag then zoom-out: locked to the post-drag canvas point', () => {
    seedBullet(0, 0);
    render(<Harness />);
    const header = document.querySelector(`${SEL} .header`) as HTMLElement;
    if (!header.setPointerCapture) {
      (header as unknown as Record<string, unknown>).setPointerCapture = () => {};
      (header as unknown as Record<string, unknown>).releasePointerCapture = () => {};
    }
    fireEvent.pointerDown(header, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerMove(header, { clientX: 160, clientY: 140 });
    fireEvent.pointerUp(header, { clientX: 160, clientY: 140 });
    expect(cornerPx(SEL).x).toBeCloseTo(128 + 60, 9);
    expect(cornerPx(SEL).y).toBeCloseTo(324 + 40, 9);
    const t = new Tracker(SEL); // baseline = post-drag canvas point
    zoomCycles(t, { x: 250, y: 200 }, 120, 3, 5);
    expect(t.maxDrift).toBeLessThanOrEqual(EPS);
  });

  it('item moves with the popover open (id unchanged) then zoom: frozen, no jump', () => {
    seedBullet(0, 0);
    render(<Harness />);
    const t = new Tracker(SEL);
    act(() => {
      useDoc.getState().moveRouteBullet('b1', 300, 200);
    });
    expect(t.sample()).toBeLessThanOrEqual(EPS); // corner did not move at all
    act(() => {
      useDoc.getState().moveRouteBullet('b1', 5000, 5000);
    });
    t.sample();
    zoomCycles(t, { x: 250, y: 200 }, 120, 2, 5);
    expect(t.maxDrift).toBeLessThanOrEqual(EPS);
  });

  it('view size change mid-life (window resize): corner tracks the canvas point', () => {
    seedBullet(0, 0);
    const { rerender } = render(<Harness />);
    const t = new Tracker(SEL);
    const big = { w: 1200, h: 900 };
    rerender(<Harness size={big} />);
    t.sample(big);
    zoomCycles(t, { x: 300, y: 250 }, 120, 2, 5);
    const small = { w: 500, h: 400 };
    rerender(<Harness size={small} />);
    t.sample(small);
    expect(t.maxDrift).toBeLessThanOrEqual(EPS);
  });

  it('never remounts across pending ticks and settle commits', () => {
    seedBullet(380, 280); // clamped spawn — a remount would visibly re-clamp
    render(<Harness />);
    const el0 = document.querySelector(SEL);
    const t = new Tracker(SEL);
    for (let c = 0; c < 3; c++) {
      for (let i = 0; i < 5; i++) {
        wheelTick(250, 200, 120);
        expect(document.querySelector(SEL)).toBe(el0);
        t.sample();
      }
      settleCommit();
      expect(document.querySelector(SEL)).toBe(el0);
      t.sample();
    }
    expect(t.maxDrift).toBeLessThanOrEqual(EPS);
  });

  it('spawn mid-gesture, gesture cancelled without commit: still locked', () => {
    seedBullet(380, 280); // clamp engages against the pending view
    act(() => {
      useLiveViewportStore.getState().setPending({ x: 100, y: 50, zoom: 2.5 });
    });
    render(<Harness />);
    const t = new Tracker(SEL);
    act(() => {
      useLiveViewportStore.getState().setPending(null); // cancel, never committed
    });
    t.sample();
    zoomCycles(t, { x: 250, y: 200 }, 120, 2, 5);
    expect(t.maxDrift).toBeLessThanOrEqual(EPS);
  });

  it('transient vanish + return re-spawns fresh at the item (intended, documented)', () => {
    // A record that leaves the doc unmounts its popover; when it returns, the
    // popover legitimately re-spawns — placed like any new selection: beside
    // the item's projected rect, inside the CURRENT view. (Only the station
    // uiMode excursion below must NOT behave like this.)
    seedBullet(380, 280);
    render(<Harness />);
    zoomCycles(new Tracker(SEL), { x: 250, y: 200 }, 120, 2, 5);
    const b = useDoc.getState().routeBullets['b1'];
    act(() => {
      useDoc.setState({ ...useDoc.getState(), routeBullets: {} });
    });
    expect(document.querySelector(SEL)).toBeNull();
    act(() => {
      useDoc.setState({ ...useDoc.getState(), routeBullets: { b1: b } });
    });
    const v = currentView();
    const pMin = projectToScreen({ x: 370, y: 270 }, v); // bullet rect min corner
    const pMax = projectToScreen({ x: 390, y: 290 }, v); // bullet rect max corner
    const c = cornerPx(SEL);
    // Fresh spawn = gap-diagonal below-left of the rect (unclamped here: the
    // item projects mid-host at this zoom).
    expect(c.x).toBeCloseTo(pMin.x - 14 - POPOVER_NOMINAL, 6);
    expect(c.y).toBeCloseTo(pMax.y + 14, 6);
    const t = new Tracker(SEL);
    zoomCycles(t, { x: 250, y: 200 }, 120, 1, 5);
    expect(t.maxDrift).toBeLessThanOrEqual(EPS);
  });
});

describe('popover canvas lock — station uiMode excursions', () => {
  const STATION_SEL = '.station-popover';

  it('hides (not unmounts) during a mode excursion and returns to the same canvas point', () => {
    seedStation(100, 50);
    render(<Harness />);
    const t = new Tracker(STATION_SEL);
    // Excursion: enter sticky placing-station (popover must not show), pan the
    // camera meanwhile, then return to idle.
    act(() => {
      useSelection.getState().setUiMode({ kind: 'placing-station' });
      useSelection.setState({ ...useSelection.getState(), selectedStationIds: ['a'] });
    });
    const hiddenEl = document.querySelector(STATION_SEL) as HTMLElement;
    expect(hiddenEl).not.toBeNull(); // still mounted…
    expect(hiddenEl).not.toBeVisible(); // …but not showing
    act(() => {
      useViewportStore.setState({ x: -200, y: -150, zoom: 1 }); // pan mid-excursion
    });
    act(() => {
      useSelection.getState().setUiMode({ kind: 'idle' });
    });
    expect(document.querySelector(STATION_SEL)).toBeVisible();
    // The popover comes back where it was on the CANVAS — projected through the
    // new camera, not re-clamped against it.
    expect(t.sample()).toBeLessThanOrEqual(EPS);
  });

  it('selected while hidden: spawn defers to the first shown render', () => {
    // Sticky placing-station selects an existing station without showing the
    // editor. The spawn must NOT freeze at that hidden mount — panning before
    // returning to idle would leave the popover anchored off-screen. It spawns
    // when first shown, clamped into the then-current view.
    act(() => {
      useSelection.getState().setUiMode({ kind: 'placing-station' });
    });
    seedStation(380, 280); // seeding also selects — while hidden
    render(<Harness />);
    expect(document.querySelector(STATION_SEL)).not.toBeVisible();
    act(() => {
      useViewportStore.setState({ x: -200, y: -150, zoom: 1 }); // pan while hidden
    });
    act(() => {
      useSelection.getState().setUiMode({ kind: 'idle' });
    });
    const el = document.querySelector(STATION_SEL) as HTMLElement;
    expect(el).toBeVisible();
    // Spawned against the CURRENT (reveal) view, exactly. An eager freeze at
    // the hidden mount (camera 0,0) would put the corner somewhere else after
    // the pan — the reveal-vs-eager discrimination is what pins the deferral.
    const revealView = currentView();
    const mountView = { ...viewBoxFor({ x: 0, y: 0, zoom: 1 }, SIZE), size: SIZE };
    const want = stationSpawnAt('a', revealView);
    const eagerCorner = projectToScreen(
      screenToWorldPoint(stationSpawnAt('a', mountView), mountView),
      revealView,
    );
    expect(Math.hypot(want.x - eagerCorner.x, want.y - eagerCorner.y)).toBeGreaterThan(10);
    const c = cornerPx(STATION_SEL);
    expect(c.x).toBeCloseTo(want.x, 6);
    expect(c.y).toBeCloseTo(want.y, 6);
    // And locked from there on.
    const t = new Tracker(STATION_SEL);
    zoomCycles(t, { x: 250, y: 200 }, 120, 1, 5);
    expect(t.maxDrift).toBeLessThanOrEqual(EPS);
  });

  it('re-selection while hidden also defers: the NEW id spawns against the reveal view', () => {
    // Sticky placing-station keeps the popover hidden while clicks can still
    // re-select a different existing station (an id change). The id-change
    // re-freeze must ALSO defer while hidden — an eager re-freeze would anchor
    // the new station's panel against whatever camera the excursion happens to
    // be at, the same wandering class the deferral exists to prevent.
    seedStations(
      [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 380, y: 280 },
      ],
      'a',
    );
    render(<Harness />); // visible spawn for 'a' at idle
    act(() => {
      useSelection.getState().setUiMode({ kind: 'placing-station' });
      useSelection.setState({ ...useSelection.getState(), selectedStationIds: ['a'] });
    });
    expect(document.querySelector(STATION_SEL)).not.toBeVisible();
    act(() => {
      // Re-select 'b' while hidden — the id change must reset to an unfrozen,
      // deferred spawn, not freeze now against camera (0,0).
      useSelection.setState({ ...useSelection.getState(), selectedStationIds: ['b'] });
    });
    act(() => {
      useViewportStore.setState({ x: -200, y: -150, zoom: 1 }); // pan while hidden
    });
    act(() => {
      useSelection.getState().setUiMode({ kind: 'idle' });
    });
    expect(document.querySelector(STATION_SEL)).toBeVisible();
    // Same arithmetic as above: deferred spawn for 'b' against the reveal
    // camera; an eager id-change freeze at camera (0,0) would land elsewhere.
    const revealView = currentView();
    const mountView = { ...viewBoxFor({ x: 0, y: 0, zoom: 1 }, SIZE), size: SIZE };
    const want = stationSpawnAt('b', revealView);
    const eagerCorner = projectToScreen(
      screenToWorldPoint(stationSpawnAt('b', mountView), mountView),
      revealView,
    );
    expect(Math.hypot(want.x - eagerCorner.x, want.y - eagerCorner.y)).toBeGreaterThan(10);
    const c = cornerPx(STATION_SEL);
    expect(c.x).toBeCloseTo(want.x, 6);
    expect(c.y).toBeCloseTo(want.y, 6);
    const t = new Tracker(STATION_SEL);
    zoomCycles(t, { x: 250, y: 200 }, 120, 1, 5);
    expect(t.maxDrift).toBeLessThanOrEqual(EPS);
  });
});
