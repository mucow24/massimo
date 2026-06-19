// Pure pan/zoom math for the canvas viewport — the numeric core of useViewport,
// lifted out so it's DOM-free and unit-testable (mirrors screenAnchor.ts). The
// hook stays a thin stateful wrapper that reads one getBoundingClientRect per
// gesture event and delegates the arithmetic here.
import type { Viewport } from '../../model/types';

export interface Size {
  w: number;
  h: number;
}

export interface ViewBox {
  vbX: number;
  vbY: number;
  vbW: number;
  vbH: number;
}

// The subset of a DOMRect the screen↔world mapping needs.
export interface HostRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

// Zoom + wheel constants, kept identical to the previous inline useViewport math.
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 64;
const WHEEL_ZOOM_RATE = 0.0015;

/** viewBox for a viewport: world coords, centered on (x, y), scaled by 1/zoom. */
export function viewBoxFor(v: Viewport, size: Size): ViewBox {
  const vbW = size.w / v.zoom;
  const vbH = size.h / v.zoom;
  return { vbX: v.x - vbW / 2, vbY: v.y - vbH / 2, vbW, vbH };
}

/**
 * A viewBox grown one viewport-width/height in every direction — a 3×3 tile
 * centered on the original. Full-viewport overlays (the background fill, the
 * grid, and the line-highlight dim wash) are drawn at this extent so that an
 * imperative-viewBox pan or zoom — which moves/scales the live viewBox WITHOUT
 * re-rendering these elements until the gesture commits (see useViewport) —
 * can't run past their edge and reveal a bare strip mid-gesture.
 */
export function overdrawnViewBox(vb: ViewBox): ViewBox {
  return {
    vbX: vb.vbX - vb.vbW,
    vbY: vb.vbY - vb.vbH,
    vbW: vb.vbW * 3,
    vbH: vb.vbH * 3,
  };
}

/** Map a client-pixel point to world coords through a viewBox + host rect. */
export function screenToWorld(
  screen: { x: number; y: number },
  vb: ViewBox,
  rect: HostRect,
): { x: number; y: number } {
  const relX = (screen.x - rect.left) / rect.width;
  const relY = (screen.y - rect.top) / rect.height;
  return { x: vb.vbX + relX * vb.vbW, y: vb.vbY + relY * vb.vbH };
}

/**
 * New viewport for one wheel tick: scales zoom by exp(-deltaY*rate), clamped,
 * and re-centers so the world point under the cursor stays fixed. Takes a single
 * host rect (the caller reads getBoundingClientRect once) — both the pre-zoom
 * anchor and the cursor fraction come from it.
 */
export function computeWheelZoom(
  v: Viewport,
  size: Size,
  rect: HostRect,
  clientX: number,
  clientY: number,
  deltaY: number,
): Viewport {
  const before = screenToWorld({ x: clientX, y: clientY }, viewBoxFor(v, size), rect);
  const factor = Math.exp(-deltaY * WHEEL_ZOOM_RATE);
  const zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v.zoom * factor));
  const relX = (clientX - rect.left) / rect.width;
  const relY = (clientY - rect.top) / rect.height;
  const newVbW = size.w / zoom;
  const newVbH = size.h / zoom;
  const newVbX = before.x - relX * newVbW;
  const newVbY = before.y - relY * newVbH;
  return { x: newVbX + newVbW / 2, y: newVbY + newVbH / 2, zoom };
}

export interface PanStart {
  /** Pointer client coords where the pan began. */
  mx: number;
  my: number;
  /** Viewport center when the pan began. */
  vx: number;
  vy: number;
}

/** New viewport for an in-flight pan: center moves opposite the drag, /zoom. */
export function panFromDelta(
  start: PanStart,
  clientX: number,
  clientY: number,
  zoom: number,
): Viewport {
  const dx = (clientX - start.mx) / zoom;
  const dy = (clientY - start.my) / zoom;
  return { x: start.vx - dx, y: start.vy - dy, zoom };
}
