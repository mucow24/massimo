import { useRef, useState } from 'react';
import {
  clampPopoverAnchor,
  projectToScreen,
  screenDeltaToWorld,
  screenToWorldPoint,
  type ViewportProjection,
} from './screenAnchor';

// Fixed visual gap between the anchored item and the popover's top-left,
// applied once when choosing the spawn position.
const POPOVER_GAP = 14;

export interface DraggablePopover {
  // Screen-pixel position for the popover's top-left; callers use it as
  // left/top directly. Once spawned this is exactly projectToScreen(spawn
  // world point + accumulated drag, live view) — the corner is glued to a
  // fixed canvas point through any pan/zoom.
  anchor: { x: number; y: number };
  // Spread onto the popover's drag handle (header). Pointer capture keeps the
  // drag alive when the cursor leaves the small header strip.
  headerHandlers: {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
    onPointerCancel: (e: React.PointerEvent<HTMLDivElement>) => void;
  };
}

// A zero-size host (first paint, before the ResizeObserver measures) has no
// screen↔world mapping: projecting through it flattens to 0 and inverting it
// divides by zero. Spawning must wait for a real box.
const hasMapping = (v: ViewportProjection) => v.size.w > 0 && v.size.h > 0;

/**
 * Choose the popover's spawn position — the item's projection plus the visual
 * gap, clamped so the panel opens inside the host box (the host is
 * overflow:hidden; an unclamped spawn near an edge crops the panel or hides it
 * entirely) — and dissolve that screen position into a WORLD point. The
 * returned point is what the popover's top-left is glued to for the rest of
 * its life; the gap and clamp are spawn-time placement heuristics that leave
 * no screen-space residue behind.
 *
 * That last property is load-bearing and has regressed repeatedly (the
 * "wandering popovers" bug). Both tempting alternatives are wrong:
 * - Keeping the gap (or clamp) as a per-render screen offset added AFTER
 *   projection detaches the corner from its canvas point by offset·(z/z₀−1)
 *   px — 14px of gap becomes a 150px slide after a deep zoom-in.
 * - Baking the clamp as a world DELTA relative to the item (the old
 *   clampedFreeze) is equivalent for the corner but was paired with the
 *   per-render gap above; and holding the clamp as a permanent screen offset
 *   instead makes the popover track the ITEM plus an arbitrary constant, so an
 *   edge-spawned panel parks ~250px off in a corner forever.
 * Canvas-locked means: one stored world point, one projection, nothing added
 * after it. See popoverCanvasLock.test.tsx.
 */
function spawnWorldPoint(
  world: { x: number; y: number },
  view: ViewportProjection,
): { x: number; y: number } {
  const p = projectToScreen(world, view);
  const spawn = { x: p.x + POPOVER_GAP, y: p.y + POPOVER_GAP };
  return screenToWorldPoint(clampPopoverAnchor(spawn, view.size), view);
}

/**
 * Frozen-anchor + header-drag mechanism shared by the canvas item popovers
 * (route bullet, text label, polygon, svg image, station). Freezes the spawn
 * position at first display so the popover doesn't slide when the underlying
 * item resizes or moves — which would also let a size slider feed its own
 * position change back into itself. Re-freezes (and drops any drag) when `id`
 * changes, because MapCanvas reuses one popover instance across selections
 * with no per-item key.
 *
 * The freeze is DEFERRED while `hidden` or while the host is unmeasured: a
 * popover that mounts hidden (station selected during a placement mode) must
 * spawn against the view it first appears in, not wherever the camera was at
 * mount. Once frozen, hiding does not re-freeze — the panel returns to the
 * same canvas point.
 *
 * The user's drag is accumulated in WORLD space (not screen pixels): the
 * header pointer delta is converted via screenDeltaToWorld, so the moved
 * popover stays pinned to the canvas through pan/zoom.
 */
export function useDraggablePopover(
  id: string,
  world: { x: number; y: number },
  view: ViewportProjection,
  hidden = false,
): DraggablePopover {
  const canSpawn = !hidden && hasMapping(view);
  const [frozenWorld, setFrozenWorld] = useState(() =>
    canSpawn ? spawnWorldPoint(world, view) : null,
  );
  const [dragWorld, setDragWorld] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [prevId, setPrevId] = useState(id);
  if (prevId !== id) {
    setPrevId(id);
    setFrozenWorld(canSpawn ? spawnWorldPoint(world, view) : null);
    setDragWorld({ x: 0, y: 0 });
  } else if (frozenWorld === null && canSpawn) {
    // Deferred spawn: first shown-and-measured render.
    setFrozenWorld(spawnWorldPoint(world, view));
  }

  // One projection, nothing added after it (see spawnWorldPoint). The unfrozen
  // fallback renders the unclamped legacy position — it is only ever reachable
  // hidden or in a zero-size host, i.e. never actually visible.
  let anchor: { x: number; y: number };
  if (frozenWorld) {
    anchor = projectToScreen(
      { x: frozenWorld.x + dragWorld.x, y: frozenWorld.y + dragWorld.y },
      view,
    );
  } else {
    const p = projectToScreen(world, view);
    anchor = { x: p.x + POPOVER_GAP, y: p.y + POPOVER_GAP };
  }

  const dragStart = useRef<{ mouseX: number; mouseY: number; offX: number; offY: number } | null>(
    null,
  );
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // No dragging before the spawn froze (hidden / unmeasured host): there is
    // nothing visible to drag, and the delta conversion needs a real mapping.
    if (!frozenWorld) return;
    e.preventDefault();
    e.stopPropagation();
    dragStart.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      offX: dragWorld.x,
      offY: dragWorld.y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = dragStart.current;
    if (!s) return;
    // Convert the screen-pixel pointer delta to world units before storing, so
    // the offset scales with zoom like the anchor.
    const dw = screenDeltaToWorld({ x: e.clientX - s.mouseX, y: e.clientY - s.mouseY }, view);
    setDragWorld({ x: s.offX + dw.x, y: s.offY + dw.y });
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    dragStart.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  return {
    anchor,
    headerHandlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
  };
}
