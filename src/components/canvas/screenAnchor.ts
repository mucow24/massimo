import { clamp } from '../../util/grid';

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
 * Full inverse of {@link projectToScreen}: the world point sitting under a
 * canvas-host-relative screen pixel. Used once at popover spawn to dissolve
 * the screen-space placement (visual gap + edge clamp) into a plain world
 * point — from then on the popover is a pure canvas object.
 */
export function screenToWorldPoint(
  pt: { x: number; y: number },
  v: ViewportProjection,
): { x: number; y: number } {
  return {
    x: v.vbX + (pt.x / v.size.w) * v.vbW,
    y: v.vbY + (pt.y / v.size.h) * v.vbH,
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

// Fallback popover footprint for hosts where the shell can't be measured
// (jsdom tests; a pathological zero-size layout). Real spawns measure the
// rendered shell, so this only has to be a plausible stand-in.
export const POPOVER_NOMINAL = 248;
// Visual gap between the anchored item's screen rect and the popover.
export const POPOVER_GAP = 14;
const CLAMP_MARGIN = 8;

const clampAxis = (v: number, extent: number, popExtent: number) =>
  clamp(v, CLAMP_MARGIN, extent - popExtent - CLAMP_MARGIN);

/**
 * Choose a popover's spawn position (top-left, host-relative screen px) next
 * to the item's screen rect. Fully-on-screen wins over not-overlapping: the
 * anchor is always clamped so the popover fits inside the host (pinning to
 * the top-left margin when the host is too small to fit it at all — the
 * header/close corner is the part worth showing), and among the fitting
 * spots the first side that clears the item rect is picked. When no side
 * clears it (item fills the view), the popover overlaps — that's the
 * documented "can't always avoid the item" concession.
 *
 * Spawn-time heuristic only: the caller dissolves the result into a world
 * point (see useDraggablePopover) and no screen-space term survives.
 */
export function choosePopoverSpawn(
  item: { x0: number; y0: number; x1: number; y1: number },
  pop: { w: number; h: number },
  host: { w: number; h: number },
): { x: number; y: number } {
  // Diagonally below-right of the item first — the legacy spawn's shape, and
  // deliberately so: a panel top-aligned beside a station would sit exactly
  // over the neighboring stations on its (usually horizontal) line, swallowing
  // the next click. Then right (top-aligned), below (left-aligned), left,
  // above. Clamping can slide a candidate along its free axis (or, when the
  // host is too small, off its side entirely) — the overlap check judges the
  // candidate where it actually lands. A degenerate point rect makes the
  // diagonal exactly the historical point+gap spawn.
  const candidates = [
    { x: item.x1 + POPOVER_GAP, y: item.y1 + POPOVER_GAP },
    { x: item.x1 + POPOVER_GAP, y: item.y0 },
    { x: item.x0, y: item.y1 + POPOVER_GAP },
    { x: item.x0 - POPOVER_GAP - pop.w, y: item.y0 },
    { x: item.x0, y: item.y0 - POPOVER_GAP - pop.h },
  ];
  let fallback: { x: number; y: number } | null = null;
  for (const c of candidates) {
    const p = { x: clampAxis(c.x, host.w, pop.w), y: clampAxis(c.y, host.h, pop.h) };
    const overlaps =
      p.x < item.x1 && p.x + pop.w > item.x0 && p.y < item.y1 && p.y + pop.h > item.y0;
    if (!overlaps) return p;
    fallback ??= p;
  }
  return fallback as { x: number; y: number };
}
