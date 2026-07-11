import { useLayoutEffect, useRef, useState } from 'react';
import type { AABB } from '../../geometry/rectPolygon';
import {
  choosePopoverSpawn,
  POPOVER_GAP,
  POPOVER_NOMINAL,
  projectToScreen,
  screenDeltaToWorld,
  screenToWorldPoint,
  type ViewportProjection,
} from './screenAnchor';

export interface DraggablePopover {
  // Screen-pixel position for the popover's top-left; callers use it as
  // left/top directly. Once spawned this is exactly projectToScreen(spawn
  // world point + accumulated drag, live view) — the corner is glued to a
  // fixed canvas point through any pan/zoom.
  anchor: { x: number; y: number };
  // True until the spawn placement froze: the shell is in its measuring
  // commit (rendered so offsetWidth/Height are real, but not yet placed).
  // The shell hides itself (visibility) while this is set — the pre-paint
  // placeholder position must never reach the screen.
  measuring: boolean;
  // Attach to the shell's root so the measuring commit can read the actual
  // popover footprint before choosing the spawn spot. (MutableRefObject, not
  // RefObject: TS compares RefObject<T> variantly and rejects the T|null form
  // as a JSX ref.)
  shellRef: React.MutableRefObject<HTMLDivElement | null>;
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
 * Choose the popover's spawn position — beside the item's projected screen
 * rect (choosePopoverSpawn: fully inside the host box, off the item when a
 * side fits) — and dissolve that screen position into a WORLD point. The
 * returned point is what the popover's top-left is glued to for the rest of
 * its life; the side choice, gap and clamp are spawn-time placement
 * heuristics that leave no screen-space residue behind.
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
  rect: AABB,
  pop: { w: number; h: number },
  view: ViewportProjection,
  spawnBox: { w: number; h: number },
): { x: number; y: number } {
  const a = projectToScreen({ x: rect.x0, y: rect.y0 }, view);
  const b = projectToScreen({ x: rect.x1, y: rect.y1 }, view);
  // Projection preserves axis order (positive scale), but normalize anyway so
  // an unordered input rect can't flip the sides.
  const item = {
    x0: Math.min(a.x, b.x),
    y0: Math.min(a.y, b.y),
    x1: Math.max(a.x, b.x),
    y1: Math.max(a.y, b.y),
  };
  return screenToWorldPoint(choosePopoverSpawn(item, pop, spawnBox), view);
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
 * `worldRect` is the item's world AABB (see geometry/itemBounds): the spawn
 * placement puts the popover beside it rather than on top of it. It is a
 * spawn hint only — after the freeze the rect is ignored.
 *
 * The freeze happens in a LAYOUT EFFECT, not during render: the first
 * shown-and-measured commit renders the shell invisibly (measuring=true) so
 * its real footprint can be read back, then the placement is chosen and
 * frozen before the browser paints. jsdom (offsetWidth 0) falls back to the
 * POPOVER_NOMINAL square, keeping test arithmetic exact.
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
  worldRect: AABB,
  view: ViewportProjection,
  hidden = false,
  // The box the spawn placement may use, when smaller than the host (the open
  // sidebar overlays — and paints ABOVE — the host's right strip; a spawn
  // clamped "fully on-screen" under it would be invisible). Projection always
  // uses the real view; this only bounds choosePopoverSpawn.
  spawnBox?: { w: number; h: number },
): DraggablePopover {
  const canSpawn = !hidden && hasMapping(view);
  const [frozenWorld, setFrozenWorld] = useState<{ x: number; y: number } | null>(null);
  const [dragWorld, setDragWorld] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [prevId, setPrevId] = useState(id);
  const dragStart = useRef<{ mouseX: number; mouseY: number; offX: number; offY: number } | null>(
    null,
  );
  if (prevId !== id) {
    setPrevId(id);
    // Back to the measuring state: the new item's popover content (and thus
    // footprint) renders in this same commit, and the effect below re-places
    // against it before paint.
    setFrozenWorld(null);
    setDragWorld({ x: 0, y: 0 });
  }

  const shellRef = useRef<HTMLDivElement | null>(null);
  // Measure-then-freeze. Runs after every commit and no-ops once frozen (or
  // while hidden/unmeasured — the deferred spawn). Safe under StrictMode's
  // mount double-invoke: both invocations run the mount render's closure
  // (frozenWorld still null), so the second recomputes the SAME spawn from
  // the same render-captured inputs and unchanged DOM — the double
  // setFrozenWorld is value-identical. The guard only no-ops later commits.
  // Keep the spawn inputs render-captured (props, not live store reads) or
  // this stops being true.
  useLayoutEffect(() => {
    if (frozenWorld !== null || !canSpawn) return;
    // A fresh spawn abandons any in-flight header drag (an id switch can land
    // mid-drag with the pointer still captured): its stale offset must not
    // re-apply to the new item's spawn on the next pointermove. onPointerMove
    // also ignores moves while unfrozen, closing the hidden/deferred window
    // this effect doesn't reach.
    dragStart.current = null;
    const el = shellRef.current;
    const pop = {
      w: el && el.offsetWidth > 0 ? el.offsetWidth : POPOVER_NOMINAL,
      h: el && el.offsetHeight > 0 ? el.offsetHeight : POPOVER_NOMINAL,
    };
    setFrozenWorld(spawnWorldPoint(worldRect, pop, view, spawnBox ?? view.size));
    // worldRect/view/spawnBox are fresh objects most renders, so this runs
    // after nearly every commit — the frozenWorld guard makes that a no-op
    // once placed.
  }, [frozenWorld, canSpawn, worldRect, view, spawnBox]);

  // One projection, nothing added after it (see spawnWorldPoint). The
  // unfrozen branch is the measuring/hidden placeholder — never painted
  // (measuring shells are visibility:hidden; hidden ones display:none).
  let anchor: { x: number; y: number };
  if (frozenWorld) {
    anchor = projectToScreen(
      { x: frozenWorld.x + dragWorld.x, y: frozenWorld.y + dragWorld.y },
      view,
    );
  } else {
    const p = projectToScreen({ x: worldRect.x0, y: worldRect.y0 }, view);
    anchor = { x: p.x + POPOVER_GAP, y: p.y + POPOVER_GAP };
  }

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
    // No drag processing while unfrozen: a fresh spawn is pending and a
    // captured pointer's stale offsets belong to the previous item.
    if (!s || !frozenWorld) return;
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
    measuring: frozenWorld === null,
    shellRef,
    headerHandlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
  };
}
