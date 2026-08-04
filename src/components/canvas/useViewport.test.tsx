import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useViewport, type ViewportApi } from './useViewport';
import { useLiveViewportStore, useViewportStore } from '../../state/viewportStore';
import { dragState } from '../../state/store';
import { fakeSvgRef, pointerEvent, wheelEvent } from '../../test/interaction';

type Result = { current: ViewportApi };

const down = (r: Result, e: React.PointerEvent) => act(() => r.current.startPan(e));
const move = (r: Result, e: React.PointerEvent) => act(() => r.current.onPointerMove(e));
const up = (r: Result, e: React.PointerEvent) => act(() => r.current.onPointerUp(e));
const wheel = (r: Result, e: React.WheelEvent) => act(() => r.current.onWheel(e));

beforeEach(() => {
  useViewportStore.setState({ x: 0, y: 0, zoom: 1 });
  useLiveViewportStore.setState({ pending: null });
  dragState.suppressClick = false;
});

// 800×600 canvas at the top-left of the screen; the effect reads the size off
// the fake parentElement on mount.
function render() {
  const { ref, svg, panLayerRef, panLayer } = fakeSvgRef({ width: 800, height: 600 });
  const { result } = renderHook(() => useViewport(ref, panLayerRef));
  return { result, ref, svg, panLayer };
}

describe('useViewport — sizing + screenToWorld', () => {
  it('initializes size from the parent element on mount', () => {
    const { result } = render();
    expect(result.current.size).toEqual({ w: 800, h: 600 });
  });

  it('maps the screen center to the viewport center', () => {
    const { result } = render();
    // zoom 1, centered on world origin → screen (400,300) is world (0,0).
    expect(result.current.screenToWorld(400, 300)).toEqual({ x: 0, y: 0 });
  });

  it('accounts for zoom in screenToWorld', () => {
    useViewportStore.setState({ x: 0, y: 0, zoom: 2 });
    const { result } = render();
    // vbW = 800/2 = 400; relX=600/800=0.75 → x = -200 + 0.75*400 = 100.
    // vbH = 600/2 = 300; relY=300/600=0.5 → y = -150 + 0.5*300 = 0.
    expect(result.current.screenToWorld(600, 300)).toEqual({ x: 100, y: 0 });
  });
});

describe('useViewport — null ref safety', () => {
  // screenToWorld / onWheel used `svgRef.current!.getBoundingClientRect()`, which
  // throws if a pointer/wheel event ever fires with a detached ref. They now
  // fall back to a size-derived origin rect instead.
  it('screenToWorld does not throw with a null ref', () => {
    const { result } = renderHook(() => useViewport({ current: null }, { current: null }));
    expect(() => result.current.screenToWorld(400, 300)).not.toThrow();
  });

  it('onWheel does not throw with a null ref', () => {
    const { result } = renderHook(() => useViewport({ current: null }, { current: null }));
    expect(() =>
      wheel(result as Result, wheelEvent({ clientX: 400, clientY: 300, deltaY: -100 })),
    ).not.toThrow();
  });

  it('a pan move does not throw with a null pan-layer ref', () => {
    const { ref } = fakeSvgRef({ width: 800, height: 600 });
    const { result } = renderHook(() => useViewport(ref, { current: null }));
    down(result as Result, pointerEvent({ clientX: 100, clientY: 100, button: 0 }));
    expect(() =>
      move(result as Result, pointerEvent({ clientX: 150, clientY: 130 })),
    ).not.toThrow();
  });
});

describe('useViewport — wheel zoom', () => {
  it('writes the zoomed viewBox imperatively and defers the store commit', () => {
    const { result, svg } = render();
    const vbBefore = svg.getAttribute('viewBox');
    wheel(result, wheelEvent({ clientX: 400, clientY: 300, deltaY: -100 }));
    // viewBox reflects the zoom immediately...
    expect(svg.getAttribute('viewBox')).not.toBe(vbBefore);
    // ...but the store waits for the gesture to settle (no per-tick re-render).
    expect(result.current.viewport.zoom).toBe(1);
  });

  it('writes the pan-surface window (2× the visible box), matching the oversized svg', () => {
    // The svg element is 2× the host per axis (.canvas-pan-layer{inset:-50%}),
    // and React's JSX binding renders panSurfaceViewBox — the imperative wheel
    // write must produce the SAME framing or every tick would jump the world.
    const { result, svg } = render();
    wheel(result, wheelEvent({ clientX: 400, clientY: 300, deltaY: -100 }));
    const zoom = Math.exp(0.15);
    const [vbX, vbY, vbW, vbH] = svg.getAttribute('viewBox')!.split(' ').map(Number);
    // Visible window at the zoomed viewport: centered on (0,0), 800/zoom wide.
    // The surface doubles it about the same center.
    expect(vbW).toBeCloseTo((800 / zoom) * 2, 9);
    expect(vbH).toBeCloseTo((600 / zoom) * 2, 9);
    expect(vbX).toBeCloseTo(-800 / zoom, 9);
    expect(vbY).toBeCloseTo(-600 / zoom, 9);
    expect(result.current.viewport.zoom).toBe(1); // still uncommitted
  });

  it('commits the zoom by exp(-deltaY*0.0015) once the wheel settles', () => {
    vi.useFakeTimers();
    try {
      const { result } = render();
      wheel(result, wheelEvent({ clientX: 400, clientY: 300, deltaY: -100 }));
      expect(result.current.viewport.zoom).toBe(1); // not yet
      act(() => vi.runAllTimers());
      expect(result.current.viewport.zoom).toBeCloseTo(Math.exp(0.15), 5);
    } finally {
      vi.useRealTimers();
    }
  });

  it('an external camera jump inside the settle window is not clobbered by the stale commit', () => {
    // Reset view / sidebar centering / the warning-toast jump call the store's
    // setViewport directly. If a wheel settle is still scheduled, its stale
    // pre-jump pending must not re-commit and snap the camera back.
    vi.useFakeTimers();
    try {
      const { result } = render();
      wheel(result, wheelEvent({ clientX: 400, clientY: 300, deltaY: -100 }));
      act(() => useViewportStore.getState().setViewport({ x: 123, y: 45, zoom: 3 }));
      act(() => vi.runAllTimers());
      expect(result.current.viewport).toEqual({ x: 123, y: 45, zoom: 3 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('compounds rapid ticks against the live zoom before committing', () => {
    vi.useFakeTimers();
    try {
      const { result } = render();
      wheel(result, wheelEvent({ clientX: 400, clientY: 300, deltaY: -100 }));
      wheel(result, wheelEvent({ clientX: 400, clientY: 300, deltaY: -100 }));
      act(() => vi.runAllTimers());
      // Two ticks compound: exp(0.15)^2 = exp(0.30), not exp(0.15).
      expect(result.current.viewport.zoom).toBeCloseTo(Math.exp(0.3), 5);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the world point under the cursor fixed once the zoom settles', () => {
    vi.useFakeTimers();
    try {
      const { result } = render();
      const cx = 600;
      const cy = 200;
      const before = result.current.screenToWorld(cx, cy);
      wheel(result, wheelEvent({ clientX: cx, clientY: cy, deltaY: -120 }));
      act(() => vi.runAllTimers());
      const after = result.current.screenToWorld(cx, cy);
      expect(after.x).toBeCloseTo(before.x, 5);
      expect(after.y).toBeCloseTo(before.y, 5);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the cursor world point fixed when the host is NOT at screen origin', () => {
    // Every other test pins the host at (0,0), so a "forgot to subtract
    // rect.left/top" bug is invisible. With the svg at (left:100, top:60), the
    // zoom-about-cursor invariant only holds if onWheel and screenToWorld both
    // subtract the host offset. (viewportMath covers the pure fn with a
    // non-origin rect; this closes the hook-level wiring.)
    vi.useFakeTimers();
    try {
      const { ref, panLayerRef } = fakeSvgRef({ width: 800, height: 600, left: 100, top: 60 });
      const { result } = renderHook(() => useViewport(ref, panLayerRef));
      const cx = 600;
      const cy = 200;
      const before = result.current.screenToWorld(cx, cy);
      wheel(result, wheelEvent({ clientX: cx, clientY: cy, deltaY: -120 }));
      act(() => vi.runAllTimers());
      const after = result.current.screenToWorld(cx, cy);
      expect(after.x).toBeCloseTo(before.x, 5);
      expect(after.y).toBeCloseTo(before.y, 5);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clamps zoom to a max of 64', () => {
    vi.useFakeTimers();
    try {
      const { result } = render();
      wheel(result, wheelEvent({ clientX: 400, clientY: 300, deltaY: -100000 }));
      act(() => vi.runAllTimers());
      expect(result.current.viewport.zoom).toBe(64);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clamps zoom to a min of 0.1', () => {
    vi.useFakeTimers();
    try {
      const { result } = render();
      wheel(result, wheelEvent({ clientX: 400, clientY: 300, deltaY: 100000 }));
      act(() => vi.runAllTimers());
      expect(result.current.viewport.zoom).toBe(0.1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('binds the wheel handler as a NON-passive native listener that preventDefaults', () => {
    // React registers its onWheel prop as a PASSIVE root listener, so
    // preventDefault() inside it warns and the page scrolls anyway. The hook
    // must bind its own non-passive wheel listener on the <svg> instead.
    const { svg } = render();
    const entry = svg.eventListener('wheel');
    expect(entry).toBeDefined();
    // Non-passive is the whole point — a passive listener cannot preventDefault.
    expect((entry!.options as { passive?: boolean }).passive).toBe(false);
    // Invoking it cancels the page scroll and runs the imperative zoom.
    const before = svg.getAttribute('viewBox');
    const preventDefault = vi.fn();
    entry!.listener({ clientX: 400, clientY: 300, deltaY: -100, preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(svg.getAttribute('viewBox')).not.toBe(before);
  });

  it('removes the wheel listener on unmount', () => {
    const { ref, svg, panLayerRef } = fakeSvgRef({ width: 800, height: 600 });
    const { unmount } = renderHook(() => useViewport(ref, panLayerRef));
    expect(svg.eventListener('wheel')).toBeDefined();
    unmount();
    expect(svg.eventListener('wheel')).toBeUndefined();
  });
});

describe('useViewport — cancelled / dead pan gestures disarm', () => {
  // Pan is a capture-holding gesture like the item drags, so it needs the same
  // two escape hatches: an explicit cancel (MapCanvas's pointercancel fan-out)
  // and the buttons === 0 lost-pointerup detection. Unlike the doc-mutating
  // drags there is nothing to roll back — the accumulated pan COMMITS, since
  // the viewBox has already visibly moved and snapping back would be jarring.
  it('a move with no buttons (lost pointerup) ends the pan instead of gluing the map to the cursor', () => {
    const { result, panLayer } = render();
    down(result, pointerEvent({ clientX: 100, clientY: 100, button: 0 }));
    move(result, pointerEvent({ clientX: 150, clientY: 130 }));
    expect(panLayer.style.transform).toBe('translate(50px, 30px)');

    // First hover move after focus returns: no buttons held.
    move(result, pointerEvent({ clientX: 300, clientY: 300, buttons: 0 }));

    expect(result.current.panning).toBe(false);
    expect(result.current.viewport.x).toBe(-50);
    expect(result.current.viewport.y).toBe(-30);
    // The composited layer is retired along with the gesture.
    expect(panLayer.style.transform).toBe('');
    // Disarmed: further moves no longer pan.
    move(result, pointerEvent({ clientX: 400, clientY: 400 }));
    expect(result.current.viewport.x).toBe(-50);
    expect(panLayer.style.transform).toBe('');
  });

  it('cancel() disarms an armed pan, resolves the live viewport, and clears the transform', () => {
    const { result, panLayer } = render();
    down(result, pointerEvent({ clientX: 100, clientY: 100, button: 0 }));
    move(result, pointerEvent({ clientX: 150, clientY: 130 }));

    act(() => result.current.cancel());

    expect(result.current.panning).toBe(false);
    expect(result.current.viewport.x).toBe(-50);
    // The live slot is resolved — no dangling pending for overlays.
    expect(useLiveViewportStore.getState().pending).toBeNull();
    expect(panLayer.style.transform).toBe('');
    expect(panLayer.style.willChange).toBe('');
    move(result, pointerEvent({ clientX: 400, clientY: 400 }));
    expect(result.current.viewport.x).toBe(-50);
  });
});

describe('useViewport — panning', () => {
  it('starts a pan on the left button and captures the pointer', () => {
    const { result, svg } = render();
    down(result, pointerEvent({ clientX: 100, clientY: 100, button: 0 }));
    expect(result.current.panning).toBe(true);
    expect(svg.hasPointerCapture(1)).toBe(true);
  });

  it('ignores non-left/middle buttons', () => {
    const { result } = render();
    down(result, pointerEvent({ clientX: 100, clientY: 100, button: 2 }));
    expect(result.current.panning).toBe(false);
  });

  it('translates the viewport by the screen delta divided by zoom (committed on pointer-up)', () => {
    const { result } = render();
    down(result, pointerEvent({ clientX: 100, clientY: 100, button: 0 }));
    move(result, pointerEvent({ clientX: 150, clientY: 130 }));
    up(result, pointerEvent({ clientX: 150, clientY: 130 }));
    // dx = 50/1, dy = 30/1 → viewport center moves opposite the drag.
    expect(result.current.viewport.x).toBe(-50);
    expect(result.current.viewport.y).toBe(-30);
  });

  it('moves the composited pan layer during a move — no viewBox write, no store commit', () => {
    // The load-bearing perf invariant: a pan move must not touch the viewBox
    // (a viewBox write re-lays-out, re-paints, and re-rasters the whole SVG
    // every frame — ~20fps on a big map on integrated graphics). The move
    // translates the composited pan-layer div instead, which the compositor
    // slides without any paint or raster work.
    const { result, svg, panLayer } = render();
    down(result, pointerEvent({ clientX: 100, clientY: 100, button: 0 }));
    move(result, pointerEvent({ clientX: 150, clientY: 130 }));
    // The pan layer carries the gesture: screen-px delta from the pan start.
    expect(panLayer.style.transform).toBe('translate(50px, 30px)');
    // The viewBox is untouched (only React's committed render writes it).
    expect(svg.getAttribute('viewBox')).toBeNull();
    // ...and the store stays put until pointer-up (no per-move re-render).
    expect(result.current.viewport.x).toBe(0);
    expect(result.current.viewport.y).toBe(0);
    up(result, pointerEvent({ clientX: 150, clientY: 130 }));
    expect(result.current.viewport.x).toBe(-50);
    // Commit retires the transform in the same frame React re-renders the
    // committed viewBox — the two swap atomically, no double-offset frame.
    expect(panLayer.style.transform).toBe('');
  });

  it('anchors screenToWorld to the STATIONARY host mid-pan, not the moving svg', () => {
    // hostRect() measures the pan layer's parent (.canvas-host) rather than the
    // svg, because mid-pan the svg rides the layer's composited transform and
    // getBoundingClientRect() reports it moved. Measuring the svg would shift
    // the mapping by the very delta liveViewport already carries — the pan gets
    // counted twice and any cursor-following overlay drifts off the pointer.
    const { result, svg, panLayer } = render();
    down(result, pointerEvent({ clientX: 100, clientY: 100, button: 0 }));
    move(result, pointerEvent({ clientX: 150, clientY: 130 }));

    // Precondition: the two rects genuinely differ, or this test proves nothing.
    expect(panLayer.style.transform).toBe('translate(50px, 30px)');
    expect(panLayer.parentElement.getBoundingClientRect().left).toBe(0);
    expect(svg.getBoundingClientRect().left).toBe(50);
    expect(svg.getBoundingClientRect().top).toBe(30);

    // Screen centre through the live viewBox (pending centre = -50, -30).
    // Anchored on the stationary host that is exactly the pending centre;
    // anchored on the shifted svg it would come back (-100, -60).
    expect(result.current.screenToWorld(400, 300)).toEqual({ x: -50, y: -30 });
  });

  it('promotes the pan layer on pan start and demotes it when the gesture ends', () => {
    // will-change is gesture-scoped: promotion happens at pointer-down (the
    // one-off layerization raster hides in the press), and the layer is
    // demoted on commit so idle rendering is exactly what it was before.
    const { result, panLayer } = render();
    down(result, pointerEvent({ clientX: 100, clientY: 100, button: 0 }));
    expect(panLayer.style.willChange).toBe('transform');
    up(result, pointerEvent({ clientX: 100, clientY: 100 }));
    expect(panLayer.style.willChange).toBe('');
    expect(panLayer.style.transform).toBe('');
  });

  it('re-anchors a long pan mid-gesture: commits the camera, zeroes the transform, keeps panning', () => {
    // The revealed-edge margin (the 3×3 overdrawn bg/grid and the svg's ink
    // overflow) only covers about a viewport of travel. Once the transform
    // exceeds 45% of the viewport dimension the gesture re-anchors: one
    // commit re-renders the world at the current camera and the transform
    // restarts from zero — one repaint per half-viewport instead of per frame.
    const { result, panLayer } = render();
    down(result, pointerEvent({ clientX: 100, clientY: 100, button: 0 }));
    // 800px-wide host → threshold 360px. A 400px drag crosses it.
    move(result, pointerEvent({ clientX: 500, clientY: 100 }));
    // Mid-gesture commit: camera moved by the full delta, transform reset.
    expect(result.current.viewport.x).toBe(-400);
    expect(panLayer.style.transform).toBe('');
    expect(result.current.panning).toBe(true);
    // The gesture continues seamlessly from the new anchor…
    move(result, pointerEvent({ clientX: 550, clientY: 100 }));
    expect(panLayer.style.transform).toBe('translate(50px, 0px)');
    // …and the final commit lands on start + total client delta.
    up(result, pointerEvent({ clientX: 550, clientY: 100 }));
    expect(result.current.viewport.x).toBe(-450);
    expect(result.current.viewport.y).toBe(0);
    expect(panLayer.style.transform).toBe('');
  });

  it('ignores wheel zoom while a pan is active', () => {
    // A wheel tick mid-pan would have to write the viewBox under a live
    // transform — a double-offset frame and a corrupted anchor. (The old
    // imperative pan silently discarded the zoom on the next move anyway.)
    const { result, svg, panLayer } = render();
    down(result, pointerEvent({ clientX: 100, clientY: 100, button: 1 }));
    move(result, pointerEvent({ clientX: 150, clientY: 100 }));
    wheel(result, wheelEvent({ clientX: 400, clientY: 300, deltaY: -100 }));
    expect(svg.getAttribute('viewBox')).toBeNull();
    expect(panLayer.style.transform).toBe('translate(50px, 0px)');
    up(result, pointerEvent({ clientX: 150, clientY: 100 }));
    expect(result.current.viewport.zoom).toBe(1);
  });

  it('publishes the in-flight viewport to the live store for overlays, and clears it on commit', () => {
    // The popover overlay tracks a pan by subscribing to the live viewport
    // store (the pan layer translates imperatively without a re-render, so a
    // committed-only overlay would sit still and jump at commit). A move
    // publishes the live viewport; pointer-up commits it and clears the live
    // slot so the overlay falls back to the committed prop.
    const { result } = render();
    down(result, pointerEvent({ clientX: 100, clientY: 100, button: 1 }));
    move(result, pointerEvent({ clientX: 150, clientY: 130 }));
    expect(useLiveViewportStore.getState().pending).toEqual({ x: -50, y: -30, zoom: 1 });
    up(result, pointerEvent({ clientX: 150, clientY: 130 }));
    expect(useLiveViewportStore.getState().pending).toBeNull();
    // The committed camera now equals where the live viewport last sat — no jump.
    expect(result.current.viewport).toEqual({ x: -50, y: -30, zoom: 1 });
  });

  it('clears the live viewport on unmount so an abandoned gesture leaks nothing', () => {
    const { ref, panLayerRef } = fakeSvgRef({ width: 800, height: 600 });
    const { result, unmount } = renderHook(() => useViewport(ref, panLayerRef));
    act(() => result.current.startPan(pointerEvent({ clientX: 100, clientY: 100, button: 1 })));
    act(() => result.current.onPointerMove(pointerEvent({ clientX: 150, clientY: 130 })));
    expect(useLiveViewportStore.getState().pending).not.toBeNull();
    unmount();
    expect(useLiveViewportStore.getState().pending).toBeNull();
  });

  it('adopts an un-committed wheel zoom as the pan base (zoom, then pan before settle)', () => {
    const { result } = render();
    // Zoom in — pending, not yet committed to the store.
    wheel(result, wheelEvent({ clientX: 400, clientY: 300, deltaY: -100 }));
    expect(result.current.viewport.zoom).toBe(1);
    // Grab-pan before the settle fires.
    down(result, pointerEvent({ clientX: 100, clientY: 100, button: 0 }));
    move(result, pointerEvent({ clientX: 150, clientY: 100 }));
    up(result, pointerEvent({ clientX: 150, clientY: 100 }));
    // The commit carries BOTH the zoom (not lost) and a pan scaled by that zoom.
    expect(result.current.viewport.zoom).toBeCloseTo(Math.exp(0.15), 5);
    expect(result.current.viewport.x).toBeCloseTo(-50 / Math.exp(0.15), 5);
  });

  it('keeps the grabbed world point under the cursor mid-pan', () => {
    // A cursor-following overlay (e.g. the placing-station ghost) reprojects the
    // cursor each move via screenToWorld. Because a pan moves the world
    // imperatively WITHOUT committing to the store, screenToWorld must read the
    // live (pending) viewport — otherwise the overlay drifts off the cursor by
    // the full pan delta. Invariant: a grab-pan keeps the grabbed world point
    // pinned under the cursor, so screenToWorld at the moving cursor returns the
    // same world point it did at grab time.
    const { result } = render();
    const grabbed = result.current.screenToWorld(100, 100);
    down(result, pointerEvent({ clientX: 100, clientY: 100, button: 1 }));
    move(result, pointerEvent({ clientX: 250, clientY: 180 }));
    const underCursor = result.current.screenToWorld(250, 180);
    expect(underCursor.x).toBeCloseTo(grabbed.x, 5);
    expect(underCursor.y).toBeCloseTo(grabbed.y, 5);
  });

  it('binds the returned viewBox to the committed viewport, not the in-flight pan', () => {
    // Load-bearing partner to the test above: screenToWorld reads the LIVE
    // viewport, but the returned vb* fields (which the SVG's JSX viewBox binds
    // to, via panSurfaceViewBox) must stay COMMITTED. Mid-pan the attribute
    // must not move at all (the transform carries the gesture), and mid-wheel
    // it moves imperatively; either way a mid-gesture re-render (the
    // cursor-track setState fires one every move) must NOT write a
    // live-derived viewBox. React only skips that DOM write because the bound
    // prop string is unchanged — which holds only while these fields track the
    // committed viewport. If they ever tracked liveViewport() the clobber (and
    // the drift) would return.
    const { ref, panLayerRef } = fakeSvgRef({ width: 800, height: 600 });
    const { result, rerender } = renderHook(() => useViewport(ref, panLayerRef));
    down(result as Result, pointerEvent({ clientX: 100, clientY: 100, button: 1 }));
    move(result as Result, pointerEvent({ clientX: 250, clientY: 180 }));
    // Force the kind of re-render the cursor-track setState triggers mid-pan.
    act(() => rerender());
    // Committed store viewport is still {0,0,1} → vb stays {-400,-300,800,600},
    // NOT the panned {-550,-380,...} that liveViewport() would produce.
    expect(result.current.vbX).toBe(-400);
    expect(result.current.vbY).toBe(-300);
  });

  it('does not suppress the click for a sub-threshold pan', () => {
    const { result } = render();
    down(result, pointerEvent({ clientX: 100, clientY: 100, button: 0 }));
    move(result, pointerEvent({ clientX: 102, clientY: 102 })); // ~2.8px
    up(result, pointerEvent({ clientX: 102, clientY: 102 }));
    expect(dragState.suppressClick).toBe(false);
  });

  it('suppresses the click and releases capture after a real pan', () => {
    const { result, svg } = render();
    down(result, pointerEvent({ clientX: 100, clientY: 100, button: 0 }));
    move(result, pointerEvent({ clientX: 200, clientY: 100 }));
    up(result, pointerEvent({ clientX: 200, clientY: 100 }));
    expect(dragState.suppressClick).toBe(true);
    expect(result.current.panning).toBe(false);
    expect(svg.hasPointerCapture(1)).toBe(false);
  });
});
