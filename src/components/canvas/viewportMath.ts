// Pure pan/zoom math for the canvas viewport — the numeric core of useViewport,
// lifted out so it's DOM-free and unit-testable (mirrors screenAnchor.ts). The
// hook stays a thin stateful wrapper that reads one getBoundingClientRect per
// gesture event and delegates the arithmetic here.
import type { Viewport } from '../../model/types';
import { clamp } from '../../util/grid';
import type { ViewportProjection } from './screenAnchor';

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

/**
 * The projection an anchored overlay (an item popover) should use this frame:
 * the committed `view` between gestures, or one reprojected through the live
 * `pending` viewport while a pan/zoom is in flight. During an imperative-viewBox
 * gesture the committed store hasn't been written yet, so a popover projected
 * via `view` alone would sit still until commit and then jump; reprojecting
 * through `pending` lets it track the canvas frame-for-frame. At the commit
 * instant `pending` equals the committed viewport, so the fallback is seamless.
 */
export function liveProjection(
  view: ViewportProjection,
  pending: Viewport | null,
): ViewportProjection {
  if (!pending) return view;
  return { ...viewBoxFor(pending, view.size), size: view.size };
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
  const zoom = clamp(v.zoom * factor, ZOOM_MIN, ZOOM_MAX);
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

export interface FitOptions {
  /** Empty margin left on EACH side, as a fraction of the viewport dimension. */
  marginFrac?: number;
  /** Never zoom IN past this on a fit (default 1 = natural scale). */
  maxZoom?: number;
}

/**
 * Camera that centers a world-space `bounds` box in a `size`-px viewport and
 * zooms so the whole box fits inside, minus a margin on every side. Zoom never
 * exceeds `maxZoom` (default 1: a small map shows at its natural scale rather
 * than ballooning to fill the screen — big maps still zoom OUT to fit) and is
 * clamped to the same pan/zoom limits as the wheel. A degenerate zero-size box
 * (single point / empty content) yields `maxZoom` centered on it. Pure — the
 * caller feeds it `computeContentBounds` output plus the live SVG's pixel size.
 */
export function fitViewport(
  bounds: { x: number; y: number; w: number; h: number },
  size: Size,
  opts?: FitOptions,
): Viewport {
  const marginFrac = opts?.marginFrac ?? 0.08;
  const maxZoom = opts?.maxZoom ?? 1;
  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;
  const usableW = size.w * (1 - 2 * marginFrac);
  const usableH = size.h * (1 - 2 * marginFrac);
  const zByW = bounds.w > 0 && usableW > 0 ? usableW / bounds.w : Infinity;
  const zByH = bounds.h > 0 && usableH > 0 ? usableH / bounds.h : Infinity;
  let zoom = Math.min(zByW, zByH, maxZoom);
  if (!Number.isFinite(zoom)) zoom = maxZoom; // zero-size box: nothing to fit
  zoom = clamp(zoom, ZOOM_MIN, ZOOM_MAX);
  return { x: cx, y: cy, zoom };
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
