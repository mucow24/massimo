import { RefObject, useEffect, useRef, useState } from 'react';
import { dragState } from '../../state/store';
import { useViewportStore } from '../../state/viewportStore';

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
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
}

/**
 * Owns viewport state, pan tracking, and wheel zoom. Returns viewBox coords,
 * a screenToWorld helper, and pointer/wheel handlers to wire onto the SVG.
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
    moved: boolean;
  } | null>(null);

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

  // viewBox: world coords; center of screen = (viewport.x, viewport.y), zoom scales.
  const vbW = size.w / viewport.zoom;
  const vbH = size.h / viewport.zoom;
  const vbX = viewport.x - vbW / 2;
  const vbY = viewport.y - vbH / 2;

  const screenToWorld = (mx: number, my: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const relX = (mx - rect.left) / rect.width;
    const relY = (my - rect.top) / rect.height;
    return { x: vbX + relX * vbW, y: vbY + relY * vbH };
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const before = screenToWorld(e.clientX, e.clientY);
    const factor = Math.exp(-e.deltaY * 0.0015);
    const newZoom = Math.max(0.1, Math.min(8, viewport.zoom * factor));
    // adjust viewport so cursor stays at same world point
    const rect = svgRef.current!.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width;
    const relY = (e.clientY - rect.top) / rect.height;
    const newVbW = size.w / newZoom;
    const newVbH = size.h / newZoom;
    const newVbX = before.x - relX * newVbW;
    const newVbY = before.y - relY * newVbH;
    setViewport({
      x: newVbX + newVbW / 2,
      y: newVbY + newVbH / 2,
      zoom: newZoom,
    });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (
      e.target === svgRef.current ||
      ((e.target as Element).tagName === 'rect' && (e.target as Element).hasAttribute('data-bg'))
    ) {
      // Start panning. Even in place-station mode — a tap still places (the
      // pan-moved suppression on pointerup keeps drags from placing), but a
      // real drag pans the canvas instead.
      panStartRef.current = {
        mx: e.clientX,
        my: e.clientY,
        vx: viewport.x,
        vy: viewport.y,
        moved: false,
      };
      setPanning(true);
      svgRef.current?.setPointerCapture(e.pointerId);
    }
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
    const dx = mxDelta / viewport.zoom;
    const dy = myDelta / viewport.zoom;
    setViewport({
      x: panStartRef.current.vx - dx,
      y: panStartRef.current.vy - dy,
      zoom: viewport.zoom,
    });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!panStartRef.current) return;
    const panMoved = panStartRef.current.moved;
    panStartRef.current = null;
    setPanning(false);
    svgRef.current?.releasePointerCapture(e.pointerId);
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
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };
}
