import { RefObject } from 'react';
import { dragState } from '../../state/store';

// Screen-space distance (px) a press must travel before it counts as a drag.
// Constant across zoom (snap radii divide by zoom; this doesn't). One home so
// every drag hook agrees on the click-vs-drag boundary.
export const DRAG_MOVE_THRESHOLD = 4;

// Both React.PointerEvent and the native PointerEvent (used by the window-level
// line-tag drag) satisfy this, so the same helpers back every drag hook.
interface PointerLike {
  clientX: number;
  clientY: number;
  pointerId: number;
}

export interface DragThreshold {
  startMX: number;
  startMY: number;
  moved: boolean;
}

/**
 * Per-move bookkeeping shared by every drag hook: compute the screen delta and,
 * on the first move past DRAG_MOVE_THRESHOLD, flip `moved`, set the global
 * click-suppression flag, and capture the pointer (so the gesture survives the
 * cursor leaving the element). Mutates `state.moved`; returns the live delta.
 */
export function trackDragMove(
  state: DragThreshold,
  e: PointerLike,
  svgRef: RefObject<SVGSVGElement | null>,
): { moved: boolean; dxScreen: number; dyScreen: number } {
  const dxScreen = e.clientX - state.startMX;
  const dyScreen = e.clientY - state.startMY;
  if (!state.moved && Math.hypot(dxScreen, dyScreen) > DRAG_MOVE_THRESHOLD) {
    state.moved = true;
    dragState.suppressClick = true;
    try {
      svgRef.current?.setPointerCapture(e.pointerId);
    } catch {
      // pointer may not be capturable
    }
  }
  return { moved: state.moved, dxScreen, dyScreen };
}

export interface DragCommit {
  moved: boolean;
  // Force a commit even without movement — the polygon edge-add gesture inserts
  // a vertex on pointerdown, which is a real change worth one history entry.
  forceCommit?: boolean;
  history: { commit: () => void; cancel: () => void };
}

/**
 * Release pointer capture and clear the click-suppression flag. The clear is
 * deferred a macrotask on purpose: the browser dispatches the synthesized
 * `click` after `pointerup`, so a synchronous clear would let that trailing
 * click through (e.g. deselecting what the gesture just selected). Shared by
 * finishDrag and the history-less gestures (rect select) that end the same way.
 */
export function releaseDragCapture(
  e: { pointerId: number },
  svgRef: RefObject<SVGSVGElement | null>,
): void {
  try {
    svgRef.current?.releasePointerCapture(e.pointerId);
  } catch {
    // pointer may not have been captured
  }
  setTimeout(() => {
    dragState.suppressClick = false;
  }, 0);
}

/**
 * End-of-gesture bookkeeping shared by every drag hook: commit the single
 * grouped history entry — and release capture + clear click-suppression on the
 * next tick — when the gesture moved (or was force-committed); otherwise cancel
 * it (a pure click recorded nothing). Returns whether it committed.
 */
export function finishDrag(
  state: DragCommit,
  e: { pointerId: number },
  svgRef: RefObject<SVGSVGElement | null>,
): boolean {
  const committed = state.moved || state.forceCommit === true;
  if (committed) {
    state.history.commit();
    releaseDragCapture(e, svgRef);
  } else {
    // no suppressClick reset here on purpose: a gesture reaching this branch
    // never moved, so trackDragMove never set the flag. cross-gesture stranding
    // (a drag that moved then died without a pointerup) is cleared by the
    // capture-phase self-heal on the MapCanvas svg (onPointerDownCapture), not
    // here — finishDrag is not the safety net for that.
    state.history.cancel();
  }
  return committed;
}
