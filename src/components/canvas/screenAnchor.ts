// Minimal viewport slice needed to project world coords to screen pixels.
// A structural subset of useViewport's ViewportApi, so the live `view` object
// can be passed straight through.
export interface ViewportProjection {
  vbX: number;
  vbY: number;
  vbW: number;
  vbH: number;
  size: { w: number; h: number };
}

/**
 * Project a world-space point to canvas-host-relative pixel coords through the
 * given viewport. Re-running this every render with the *live* viewport is what
 * lets anchored overlays (e.g. the bullet/label popovers) track canvas pan and
 * zoom — the world point stays fixed while the viewport moves under it.
 */
export function projectToScreen(
  world: { x: number; y: number },
  v: ViewportProjection,
): { x: number; y: number } {
  return {
    x: ((world.x - v.vbX) / v.vbW) * v.size.w,
    y: ((world.y - v.vbY) / v.vbH) * v.size.h,
  };
}

/**
 * Convert a screen-pixel delta to a world-space delta through the given
 * viewport — the scaling inverse of {@link projectToScreen} (translation drops
 * out of a delta). Popovers store their header-drag offset in world space via
 * this so the moved offset scales with zoom exactly like the projected anchor;
 * a screen-pixel offset would stay a fixed size and slide the popover relative
 * to the canvas when zooming after a move.
 */
export function screenDeltaToWorld(
  delta: { x: number; y: number },
  v: ViewportProjection,
): { x: number; y: number } {
  return {
    x: (delta.x / v.size.w) * v.vbW,
    y: (delta.y / v.size.h) * v.vbH,
  };
}

// Item popovers are 240px wide plus a 3px border each side + the 1px outline;
// height varies per popover, so both axes clamp against the same nominal
// square footprint. The station popover is wider (320px, styles.css) but
// clamps against this same nominal — an accepted ~80px right-edge crop.
const POPOVER_NOMINAL = 248;
const CLAMP_MARGIN = 8;

/**
 * Clamp a popover's screen anchor (its top-left corner) so the nominal
 * popover footprint stays inside the host box. The canvas host is
 * overflow:hidden, so an unclamped spawn near an edge crops the panel or
 * hides it entirely. An axis whose extent can't fit the popover at all
 * (tiny window, or the zero-size first paint) passes through unchanged —
 * no placement would help there.
 */
export function clampPopoverAnchor(
  pt: { x: number; y: number },
  size: { w: number; h: number },
): { x: number; y: number } {
  const clampAxis = (v: number, extent: number) =>
    extent < POPOVER_NOMINAL + 2 * CLAMP_MARGIN
      ? v
      : Math.max(CLAMP_MARGIN, Math.min(v, extent - POPOVER_NOMINAL - CLAMP_MARGIN));
  return { x: clampAxis(pt.x, size.w), y: clampAxis(pt.y, size.h) };
}
