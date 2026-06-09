import { useRef, useState } from 'react';
import { projectToScreen, type ViewportProjection } from './screenAnchor';

export interface DraggablePopover {
  // Screen-pixel anchor: the frozen world point projected through the LIVE
  // viewport. Caller positions the popover at `anchor + base offset + dragOffset`.
  anchor: { x: number; y: number };
  dragOffset: { x: number; y: number };
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
 * across selections with no per-item key. The frozen point is projected through
 * the LIVE viewport every render so the popover still tracks canvas pan/zoom;
 * the header handlers accumulate a user drag offset on top.
 */
export function useDraggablePopover(
  id: string,
  world: { x: number; y: number },
  view: ViewportProjection,
): DraggablePopover {
  const [frozenWorld, setFrozenWorld] = useState(world);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [prevId, setPrevId] = useState(id);
  if (prevId !== id) {
    setPrevId(id);
    setFrozenWorld(world);
    setDragOffset({ x: 0, y: 0 });
  }
  const anchor = projectToScreen(frozenWorld, view);

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
      offX: dragOffset.x,
      offY: dragOffset.y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = dragStart.current;
    if (!s) return;
    setDragOffset({ x: s.offX + (e.clientX - s.mouseX), y: s.offY + (e.clientY - s.mouseY) });
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
    dragOffset,
    headerHandlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
  };
}
