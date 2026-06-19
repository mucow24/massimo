import { RefObject, useEffect, useRef, useState } from 'react';
import { dragState } from '../../state/store';
import { useViewportStore } from '../../state/viewportStore';
import type { Viewport } from '../../model/types';
import {
  computeWheelZoom,
  panFromDelta,
  screenToWorld as toWorld,
  viewBoxFor,
} from './viewportMath';

const viewBoxStr = (vb: { vbX: number; vbY: number; vbW: number; vbH: number }) =>
  `${vb.vbX} ${vb.vbY} ${vb.vbW} ${vb.vbH}`;

// Once a wheel gesture goes quiet for this long, commit the zoom to the store so
// React re-renders and reprojects zoom-dependent details (stroke widths, which
// transiently scale during the gesture, and the grid) crisply at the final zoom.
const ZOOM_SETTLE_MS = 90;

export interface ViewportApi {
  size: { w: number; h: number };
  viewport: { x: number; y: number; zoom: number };
  vbX: number;
  vbY: number;
  vbW: number;
  vbH: number;
  panning: boolean;
  screenToWorld: (mx: number, my: number) => { x: number; y: number };
  onWheel: (e: React.WheelEvent) => void;
  startPan: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
}

/**
 * Owns viewport state, pan tracking, and wheel zoom. Returns viewBox coords,
 * a screenToWorld helper, and pointer/wheel handlers to wire onto the SVG.
 *
 * Pan and zoom both write the SVG viewBox imperatively on each event and commit
 * to the store once the gesture ends — pointer-up for a pan, a short settle
 * timer for a wheel. A store write per event would re-render and reconcile the
 * entire ~2.7k-node canvas every frame (~12ms), whereas the browser re-rasters
 * the new viewBox region on its own far more cheaply (~8ms). It's synchronous,
 * so the viewBox tracks the cursor with zero added latency. The trade-off for
 * zoom: stroke widths (k/zoom) scale transiently mid-gesture until the settle
 * commit re-renders them screen-constant. Numeric core: viewportMath.ts.
 *
 * The handlers are panning-only — `useStationDrag`'s handlers handle the
 * station-drag side, and the shell composes both onto each pointer event.
 */
export function useViewport(svgRef: RefObject<SVGSVGElement | null>): ViewportApi {
  const x = useViewportStore((s) => s.x);
  const y = useViewportStore((s) => s.y);
  const zoom = useViewportStore((s) => s.zoom);
  const setViewport = useViewportStore((s) => s.setViewport);
  const viewport = { x, y, zoom };

  const [size, setSize] = useState({ w: 800, h: 600 });
  const [panning, setPanning] = useState(false);
  const panStartRef = useRef<{
    mx: number;
    my: number;
    vx: number;
    vy: number;
    zoom: number;
    moved: boolean;
    captured: boolean;
  } | null>(null);
  // Live un-committed viewport during an in-flight gesture (pan or wheel zoom):
  // written to the SVG viewBox imperatively each event so the gesture stays
  // smooth without re-rendering the ~2.7k-node tree, then committed to the store
  // once the gesture ends.
  const pendingRef = useRef<Viewport | null>(null);
  const zoomSettleRef = useRef<number | null>(null);

  useEffect(() => {
    const el = svgRef.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [svgRef]);

  // Don't leave a settle commit scheduled past unmount.
  useEffect(
    () => () => {
      if (zoomSettleRef.current != null) clearTimeout(zoomSettleRef.current);
    },
    [],
  );

  // viewBox: world coords; center of screen = (viewport.x, viewport.y), zoom scales.
  const vb = viewBoxFor(viewport, size);
  const { vbX, vbY, vbW, vbH } = vb;

  // getBoundingClientRect needs the live <svg>; fall back to an origin rect
  // sized from `size` so screenToWorld/onWheel stay total if a pointer or wheel
  // event ever fires with a detached ref (unmount mid-gesture, or a stale
  // captured pointerup) instead of throwing on `svgRef.current!`.
  const hostRect = () =>
    svgRef.current?.getBoundingClientRect() ?? { left: 0, top: 0, width: size.w, height: size.h };

  const screenToWorld = (mx: number, my: number) => {
    const rect = hostRect();
    return toWorld({ x: mx, y: my }, vb, rect);
  };

  // The latest intended viewport, including the current gesture's un-committed
  // delta (falls back to the committed store value between gestures).
  const liveViewport = () => pendingRef.current ?? viewport;

  // Apply a viewport to the SVG viewBox now, without a store write (no React
  // re-render); the gesture's end commits it.
  const applyViewBox = (v: Viewport) => {
    pendingRef.current = v;
    svgRef.current?.setAttribute('viewBox', viewBoxStr(viewBoxFor(v, size)));
  };

  // Commit the in-flight gesture to the store (re-render + reproject) and stop
  // any scheduled wheel-settle commit.
  const commitPending = () => {
    if (zoomSettleRef.current != null) {
      clearTimeout(zoomSettleRef.current);
      zoomSettleRef.current = null;
    }
    if (pendingRef.current) {
      setViewport(pendingRef.current);
      pendingRef.current = null;
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = hostRect();
    // Imperative viewBox zoom (like pan): smooth, no per-tick re-render. Based on
    // the live viewport so rapid ticks compound; committed once the wheel settles.
    applyViewBox(computeWheelZoom(liveViewport(), size, rect, e.clientX, e.clientY, e.deltaY));
    if (zoomSettleRef.current != null) clearTimeout(zoomSettleRef.current);
    zoomSettleRef.current = window.setTimeout(commitPending, ZOOM_SETTLE_MS);
  };

  // Pan starts only when the parent (MapCanvas) calls startPan (hand mode
  // left-button, or middle-button anywhere).
  const startPan = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    // Adopt any in-flight wheel zoom as the pan's base and cancel its settle —
    // the pan commits on pointer-up instead.
    if (zoomSettleRef.current != null) {
      clearTimeout(zoomSettleRef.current);
      zoomSettleRef.current = null;
    }
    const base = liveViewport();
    panStartRef.current = {
      mx: e.clientX,
      my: e.clientY,
      vx: base.x,
      vy: base.y,
      zoom: base.zoom,
      moved: false,
      captured: false,
    };
    setPanning(true);
    svgRef.current?.setPointerCapture(e.pointerId);
    panStartRef.current.captured = true;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!panStartRef.current) return;
    const mxDelta = e.clientX - panStartRef.current.mx;
    const myDelta = e.clientY - panStartRef.current.my;
    // Mark the pan as a real drag once it crosses a small threshold so the
    // synthesized click on pointerup can be distinguished from a tap.
    if (!panStartRef.current.moved && Math.hypot(mxDelta, myDelta) > 4) {
      panStartRef.current.moved = true;
    }
    // Imperative viewBox write — no store commit (and so no React re-render) per
    // move; the browser re-rasters the new region itself.
    applyViewBox(panFromDelta(panStartRef.current, e.clientX, e.clientY, panStartRef.current.zoom));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!panStartRef.current) return;
    // Commit the pan accumulated via imperative viewBox writes; React re-renders
    // once here at the final position (re-syncing grid + background extent).
    commitPending();
    const panMoved = panStartRef.current.moved;
    const wasCaptured = panStartRef.current.captured;
    panStartRef.current = null;
    setPanning(false);
    if (wasCaptured) {
      try {
        svgRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        // ignore — already released
      }
    }
    if (panMoved) {
      // Suppress the click that fires after pointerup so it doesn't
      // collapse the open station/line editor.
      dragState.suppressClick = true;
      setTimeout(() => {
        dragState.suppressClick = false;
      }, 0);
    }
  };

  return {
    size,
    viewport,
    vbX,
    vbY,
    vbW,
    vbH,
    panning,
    screenToWorld,
    onWheel,
    startPan,
    onPointerMove,
    onPointerUp,
  };
}
