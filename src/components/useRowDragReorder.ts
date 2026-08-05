import { useEffect, useRef, useState } from 'react';
import { DRAG_MOVE_THRESHOLD, pointerLost } from './canvas/dragGesture';

/**
 * The mid-drag row offsets: the ridden row tracks the pointer raw, rows it has
 * passed step one slot the other way — the array itself reorders only at the
 * drop, so cancel costs nothing. Shared by every list the hook drives.
 */
export function rowShiftStyle(
  drag: RowDragState | null,
  i: number,
  rowHeight: number,
): React.CSSProperties | undefined {
  if (!drag) return undefined;
  if (i === drag.from) return { transform: `translateY(${drag.dy}px)` };
  if (drag.from < drag.to && i > drag.from && i <= drag.to)
    return { transform: `translateY(${-rowHeight}px)` };
  if (drag.to < drag.from && i >= drag.to && i < drag.from)
    return { transform: `translateY(${rowHeight}px)` };
  return undefined;
}

export interface RowDragState {
  /** The row the handle belongs to. */
  from: number;
  /** Where it would land if released now. */
  to: number;
  /** Live pointer offset from the press, for the dragged row's translate. */
  dy: number;
}

/**
 * Drag-to-reorder for a fixed-height row list — the palette editor's swatch
 * rows. The house drag discipline, transplanted from the canvas hooks to DOM
 * rows: a press arms silently, `DRAG_MOVE_THRESHOLD` turns it into a drag,
 * `pointerLost` / pointercancel / Escape abandon it, and the ONLY store write
 * is a single `onCommit(from, to)` at pointerup — the preview in between is
 * pure local state, so cancelling is free.
 *
 * `rowHeight` is passed in rather than measured: rows are CSS-fixed, and jsdom
 * can't measure anyway. `to` is the index the dragged row would land on,
 * clamped to the list.
 */
export function useRowDragReorder({
  count,
  rowHeight,
  onCommit,
}: {
  count: number;
  rowHeight: number;
  onCommit: (from: number, to: number) => void;
}): {
  drag: RowDragState | null;
  handleProps: (index: number) => {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerCancel: () => void;
  };
} {
  const [drag, setDrag] = useState<RowDragState | null>(null);
  // The armed gesture; `moved` flips once past the threshold (mirrors
  // DragThreshold in the canvas hooks).
  const gesture = useRef<{ index: number; startY: number; moved: boolean } | null>(null);

  const reset = () => {
    gesture.current = null;
    setDrag(null);
  };

  const landing = (from: number, dy: number) =>
    Math.min(count - 1, Math.max(0, from + Math.round(dy / rowHeight)));

  // While a drag is live, Escape abandons it — window capture phase, so the
  // dialog underneath never reads the keypress as "close".
  const active = drag !== null;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      gesture.current = null;
      setDrag(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active]);

  const handleProps = (index: number) => ({
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      // Primary button only — a right-button press must not arm (its buttons
      // bit never trips pointerLost, so it would drive the drag under the
      // context menu).
      if (e.button !== 0) return;
      gesture.current = { index, startY: e.clientY, moved: false };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // pointer may not be capturable
      }
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const g = gesture.current;
      if (!g) return;
      if (pointerLost(e)) {
        reset();
        return;
      }
      const dy = e.clientY - g.startY;
      if (!g.moved && Math.abs(dy) <= DRAG_MOVE_THRESHOLD) return;
      g.moved = true;
      setDrag({ from: g.index, to: landing(g.index, dy), dy });
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
      const g = gesture.current;
      if (!g) return;
      if (g.moved) {
        const to = landing(g.index, e.clientY - g.startY);
        if (to !== g.index) onCommit(g.index, to);
      }
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // pointer may not have been captured
      }
      reset();
    },
    onPointerCancel: reset,
  });

  return { drag, handleProps };
}
