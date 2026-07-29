import { RefObject, useEffect, useRef, useState } from 'react';
import { dragState } from '../../state/store';
import { DRAG_MOVE_THRESHOLD, pointerLost } from './dragGesture';
import { useLiveViewportStore, useViewportStore } from '../../state/viewportStore';
import type { Viewport } from '../../model/types';
import {
  computeWheelZoom,
  panFromDelta,
  panSurfaceViewBox,
  screenToWorld as toWorld,
  viewBoxFor,
} from './viewportMath';

const viewBoxStr = (vb: { vbX: number; vbY: number; vbW: number; vbH: number }) =>
  `${vb.vbX} ${vb.vbY} ${vb.vbW} ${vb.vbH}`;

// Once a wheel gesture goes quiet for this long, commit the zoom to the store so
// React re-renders and reprojects zoom-dependent details (stroke widths, which
// transiently scale during the gesture, and the grid) crisply at the final zoom.
const ZOOM_SETTLE_MS = 90;

// Re-anchor a pan once its transform WOULD exceed this fraction of the
// viewport dimension. The pan surface paints exactly half a viewport of margin
// per side (panSurfaceViewBox), and an over-threshold transform is baked
// instead of written, so a translate can never reveal past the painted edge —
// while re-anchors stay rare (each costs one full repaint, the thing the
// transform pan exists to avoid).
const REANCHOR_FRAC = 0.45;

/** The wheel-event fields the zoom handler reads — satisfied by both a native
 *  WheelEvent and React's synthetic one. */
type WheelInput = Pick<WheelEvent, 'clientX' | 'clientY' | 'deltaY' | 'preventDefault'>;

export interface ViewportApi {
  size: { w: number; h: number };
  viewport: { x: number; y: number; zoom: number };
  vbX: number;
  vbY: number;
  vbW: number;
  vbH: number;
  panning: boolean;
  screenToWorld: (mx: number, my: number) => { x: number; y: number };
  onWheel: (e: WheelInput) => void;
  startPan: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  cancel: () => void;
}

/**
 * Owns viewport state, pan tracking, and wheel zoom. Returns viewBox coords,
 * a screenToWorld helper, and pointer/wheel handlers to wire onto the SVG.
 *
 * Both gestures stay out of React until they end (a store write per event
 * would re-render and reconcile the whole multi-thousand-node canvas every
 * frame), but they move the world by different mechanisms:
 *
 * - A PAN translates `panLayerRef` — the composited div wrapping the svg —
 *   by the gesture's screen-px delta. A translate on a composited HTML layer
 *   is compositor-only: no style recalc, no layout, no paint, no raster,
 *   whatever the map's complexity (Blink gives neither the svg element nor
 *   an inner <g> that fast path — a transform there re-rasters the world
 *   every frame, ~20fps on a large map on integrated graphics). The layer
 *   overhangs the host by half a viewport per side and the svg renders the
 *   matching 2× window (panSurfaceViewBox), so a translate reveals painted
 *   margin; before it could outrun that margin (REANCHOR_FRAC of the
 *   viewport) the gesture re-anchors — commits the camera and zeroes the
 *   transform in the same frame — so cost is one repaint per half-viewport
 *   of travel. Pointer-up commits and demotes the layer.
 *
 * - A wheel ZOOM writes the SVG viewBox imperatively per tick (a transform
 *   zoom would scale the rastered texture — blurry — and re-anchoring per
 *   tick would repaint anyway) and commits after a short settle. Stroke
 *   widths (k/zoom) scale transiently mid-gesture until that commit
 *   re-renders them screen-constant. Numeric core: viewportMath.ts.
 *
 * The handlers are panning-only — `useStationDrag`'s handlers handle the
 * station-drag side, and the shell composes both onto each pointer event.
 */
export function useViewport(
  svgRef: RefObject<SVGSVGElement | null>,
  panLayerRef: RefObject<HTMLDivElement | null>,
): ViewportApi {
  const x = useViewportStore((s) => s.x);
  const y = useViewportStore((s) => s.y);
  const zoom = useViewportStore((s) => s.zoom);
  const setViewport = useViewportStore((s) => s.setViewport);
  const viewport = { x, y, zoom };
  // The live-viewport setter, NOT subscribed (getState/stable ref): writing the
  // in-flight viewport here each gesture event must not re-render this hook (and
  // so the whole canvas) — only the popover overlay subscribes to its value.
  const setPending = useLiveViewportStore.getState().setPending;

  const [size, setSize] = useState({ w: 800, h: 600 });
  const [panning, setPanning] = useState(false);
  const panStartRef = useRef<{
    mx: number;
    my: number;
    vx: number;
    vy: number;
    zoom: number;
    /** The viewport the svg's viewBox attribute currently renders — the base
     *  the pan-layer translate is measured from. Re-anchoring resets it. */
    anchor: Viewport;
    moved: boolean;
    captured: boolean;
  } | null>(null);
  const zoomSettleRef = useRef<number | null>(null);

  // Size = the VISIBLE canvas box, so measure the host (.canvas-host), not the
  // svg's parent: that parent is the pan layer, which overhangs the host by
  // half a viewport per side. Tests without a pan layer fall back to the svg's
  // parent, which their fake sizes directly. The value-equal bailout is
  // load-bearing: an unstable ref identity re-runs this effect every render,
  // and an unconditional setSize (fresh object, same values) would re-render
  // in an infinite loop.
  useEffect(() => {
    const el = panLayerRef.current?.parentElement ?? svgRef.current?.parentElement;
    if (!el) return;
    const measure = () =>
      setSize((prev) =>
        prev.w === el.clientWidth && prev.h === el.clientHeight
          ? prev
          : { w: el.clientWidth, h: el.clientHeight },
      );
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [svgRef, panLayerRef]);

  // Don't leave a settle commit scheduled — or an in-flight gesture's live
  // viewport — dangling past unmount.
  useEffect(
    () => () => {
      if (zoomSettleRef.current != null) clearTimeout(zoomSettleRef.current);
      setPending(null);
    },
    [setPending],
  );

  // viewBox: world coords; center of screen = (viewport.x, viewport.y), zoom scales.
  const vb = viewBoxFor(viewport, size);
  const { vbX, vbY, vbW, vbH } = vb;

  // The STATIONARY canvas box — the pan layer's parent (.canvas-host), not the
  // svg: mid-pan the svg rides the layer's transform, and getBoundingClientRect
  // includes transforms, so measuring the svg would shift the mapping by the
  // very delta the live viewport already carries (double-counting the pan).
  // A degenerate (unlaid-out) host falls through to the svg — which is where
  // jsdom tests stub their rect — and a detached ref falls back to an origin
  // rect sized from `size`, so screenToWorld/onWheel stay total (unmount
  // mid-gesture, or a stale captured pointerup) instead of throwing.
  const hostRect = () => {
    const host = panLayerRef.current?.parentElement?.getBoundingClientRect();
    if (host && host.width > 0 && host.height > 0) return host;
    return (
      svgRef.current?.getBoundingClientRect() ?? { left: 0, top: 0, width: size.w, height: size.h }
    );
  };

  // The latest intended viewport, including the current gesture's un-committed
  // delta (falls back to the committed store value between gestures).
  const liveViewport = () => useLiveViewportStore.getState().pending ?? viewport;

  // Map through the LIVE viewBox, not the committed `vb`: during an imperative
  // pan/zoom the store hasn't been written yet, so a cursor-following overlay
  // (the placing-station ghost) reprojected via the stale `vb` would drift off
  // the cursor by the gesture delta. Between gestures liveViewport() === the
  // committed viewport, so this is identical to the old mapping then.
  const screenToWorld = (mx: number, my: number) => {
    const rect = hostRect();
    return toWorld({ x: mx, y: my }, viewBoxFor(liveViewport(), size), rect);
  };

  // WHEEL path: apply a viewport to the SVG viewBox now, without committing the
  // camera (no re-render of the canvas tree). Also publishes the live viewport
  // so overlays track the gesture; the gesture's end commits the camera. The
  // attribute gets the pan-surface window (2× the visible box) — the svg
  // element is oversized to match, so this is the same world-to-pixel mapping.
  const applyViewBox = (v: Viewport) => {
    setPending(v);
    svgRef.current?.setAttribute('viewBox', viewBoxStr(panSurfaceViewBox(viewBoxFor(v, size))));
  };

  // Retire the pan gesture's compositor state: transform gone, layer demoted.
  // Runs in the same synchronous handler as the camera commit, so the React
  // viewBox write and the transform reset land in one frame — no double-offset.
  const releasePanLayer = () => {
    const el = panLayerRef.current;
    if (!el) return;
    el.style.transform = '';
    el.style.willChange = '';
  };

  // PAN path: show viewport `v` by translating the composited pan layer by the
  // world delta from the gesture's anchor, in screen px — compositor-only, no
  // paint/raster whatever the map size (see the hook doc). Publishes the live
  // viewport exactly like the wheel path. Past the re-anchor threshold the
  // translate is baked instead: commit the camera (React re-renders the world
  // at `v`) and zero the transform, both in this same synchronous handler.
  const applyPan = (v: Viewport) => {
    setPending(v);
    const start = panStartRef.current;
    const el = panLayerRef.current;
    if (!start || !el) return;
    const tx = (start.anchor.x - v.x) * v.zoom;
    const ty = (start.anchor.y - v.y) * v.zoom;
    if (Math.abs(tx) > size.w * REANCHOR_FRAC || Math.abs(ty) > size.h * REANCHOR_FRAC) {
      el.style.transform = '';
      commitPending();
      start.anchor = v;
      return;
    }
    el.style.transform = `translate(${tx}px, ${ty}px)`;
  };

  // Commit the in-flight gesture to the store (re-render + reproject) and stop
  // any scheduled wheel-settle commit. Clearing `pending` last keeps the popover
  // on the live viewport right up to the commit, so it lands where it already
  // sat — no jump.
  const commitPending = () => {
    if (zoomSettleRef.current != null) {
      clearTimeout(zoomSettleRef.current);
      zoomSettleRef.current = null;
    }
    const pending = useLiveViewportStore.getState().pending;
    if (pending) {
      setViewport(pending);
      setPending(null);
    }
  };

  const onWheel = (e: WheelInput) => {
    e.preventDefault();
    // No zoom mid-pan: a viewBox write under a live pan transform would show a
    // double-offset frame and orphan the pan's anchor. (The old imperative pan
    // silently discarded a mid-pan zoom on the next move; now it's explicit.)
    if (panStartRef.current) return;
    const rect = hostRect();
    // Imperative viewBox zoom: smooth, no per-tick re-render. Based on the
    // live viewport so rapid ticks compound; committed once the wheel settles.
    applyViewBox(computeWheelZoom(liveViewport(), size, rect, e.clientX, e.clientY, e.deltaY));
    if (zoomSettleRef.current != null) clearTimeout(zoomSettleRef.current);
    zoomSettleRef.current = window.setTimeout(commitPending, ZOOM_SETTLE_MS);
  };

  // Bind the wheel handler as a NON-passive native listener. React's onWheel
  // prop registers a passive root listener, so preventDefault() there warns and
  // the page scrolls anyway. The ref keeps the native listener calling the
  // latest closure (fresh `size`) without rebinding each render.
  const onWheelRef = useRef(onWheel);
  useEffect(() => {
    onWheelRef.current = onWheel;
  });
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => onWheelRef.current(e);
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [svgRef]);

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
      // `base` is what the viewBox attribute shows right now — committed, or
      // an adopted in-flight wheel zoom's imperative write.
      anchor: base,
      moved: false,
      captured: false,
    };
    // Promote the pan layer at pointer-down: the one-off layerization raster
    // hides in the press, so the first move frame is already compositor-only.
    const layer = panLayerRef.current;
    if (layer) layer.style.willChange = 'transform';
    setPanning(true);
    svgRef.current?.setPointerCapture(e.pointerId);
    panStartRef.current.captured = true;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!panStartRef.current) return;
    // A lost pointerup (alt-tab mid-press) surfaces as a button-less move —
    // end the pan instead of gluing the map to the hovering cursor.
    if (pointerLost(e)) return cancel();
    const mxDelta = e.clientX - panStartRef.current.mx;
    const myDelta = e.clientY - panStartRef.current.my;
    // Mark the pan as a real drag once it crosses a small threshold so the
    // synthesized click on pointerup can be distinguished from a tap.
    if (!panStartRef.current.moved && Math.hypot(mxDelta, myDelta) > DRAG_MOVE_THRESHOLD) {
      panStartRef.current.moved = true;
    }
    // Compositor-only translate — no store commit (and so no React re-render),
    // no viewBox write (and so no layout/paint/raster) per move.
    applyPan(panFromDelta(panStartRef.current, e.clientX, e.clientY, panStartRef.current.zoom));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!panStartRef.current) return;
    // Commit the accumulated pan; React re-renders once here at the final
    // position (re-syncing grid + background extent), and the transform is
    // retired in the same frame.
    commitPending();
    releasePanLayer();
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

  // A browser pointercancel (or a button-less move — lost pointerup) ends the
  // pan with no pointerup. Commit the pan accumulated so far — the viewBox has
  // already visibly moved, so discarding would snap the map back — and disarm.
  // No pointer id here: after a real pointercancel the browser has already
  // released the capture.
  const cancel = () => {
    if (!panStartRef.current) return;
    commitPending();
    releasePanLayer();
    panStartRef.current = null;
    setPanning(false);
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
    cancel,
  };
}
