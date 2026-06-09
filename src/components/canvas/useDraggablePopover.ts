import { useRef, useState } from 'react';
import { projectToScreen, screenDeltaToWorld, type ViewportProjection } from './screenAnchor';

export interface DraggablePopover {
  // Screen-pixel anchor: the frozen world point PLUS the user's world-space
  // drag, projected through the LIVE viewport. Already includes the move, so
  // the caller just adds its fixed visual gap (e.g. `anchor.x + 14`).
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

/**
 * Frozen-anchor + header-drag mechanism shared by the canvas item popovers
 * (text label, polygon). Freezes `world` at mount so the popover doesn't slide
 * when the underlying item resizes or moves — which would also let a size
 * slider feed its own position change back into itself. Re-freezes (and drops
 * any drag) when `id` changes, because MapCanvas reuses one popover instance
 * across selections with no per-item key.
 *
 * The user's drag is accumulated in WORLD space (not screen pixels): the header
 * pointer delta is converted via screenDeltaToWorld, and `frozenWorld + dragWorld`
 * is projected through the live viewport. Storing the move in world units keeps
 * it pinned to the canvas through pan/zoom — a screen-pixel offset would slide
 * the popover relative to the map when zooming after a move.
 */
export function useDraggablePopover(
  id: string,
  world: { x: number; y: number },
  view: ViewportProjection,
): DraggablePopover {
  const [frozenWorld, setFrozenWorld] = useState(world);
  const [dragWorld, setDragWorld] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [prevId, setPrevId] = useState(id);
  if (prevId !== id) {
    setPrevId(id);
    setFrozenWorld(world);
    setDragWorld({ x: 0, y: 0 });
  }
  const anchor = projectToScreen(
    { x: frozenWorld.x + dragWorld.x, y: frozenWorld.y + dragWorld.y },
    view,
  );

  const dragStart = useRef<{ mouseX: number; mouseY: number; offX: number; offY: number } | null>(
    null,
  );
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
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
