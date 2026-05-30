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
