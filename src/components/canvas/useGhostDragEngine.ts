import { RefObject, useEffect, useRef, useState } from 'react';
import type { beginHistoryGroup } from '../../state/store';
import type { Vec2 } from '../../geometry/vec';
import { pointerLost, trackDragMove } from './dragGesture';

type ScreenToWorld = (mx: number, my: number) => Vec2;

export interface DragModifiers {
  altKey: boolean;
  shiftKey: boolean;
}

// The drag-state fields the engine itself touches: the dragGesture threshold
// trio, the latest pointer position (stationary modifier presses recompute
// from it), and the history group rolled back on pointercancel. Each hook
// extends this with its gesture-specific payload.
export interface GhostDragCore {
  startMX: number;
  startMY: number;
  moved: boolean;
  lastMX: number;
  lastMY: number;
  history: ReturnType<typeof beginHistoryGroup>;
}

/**
 * Lifecycle scaffolding for the ghost-lattice drag hook (useStationLayoutDrag;
 * once shared with the retired on-canvas label drag, kept factored out as
 * reusable ghost-drag plumbing). Owns the mechanics it should not
 * re-implement inline:
 *
 *  - Overlay state plus a ref mirror: the pointerup commit must read the
 *    overlay through `overlayRef`, not the state — React 18 batches the last
 *    set, so on a fast move→up the closure state can lag one move behind the
 *    true snapped slot.
 *  - `screenToWorldRef`: screenToWorld is a FRESH closure every render (it
 *    closes over that render's committed viewport). The []-stable start
 *    handlers and the window key listeners read the projection through this
 *    ref — capturing the prop directly would freeze the mount-time camera and
 *    teleport the dragged node after any pan/zoom.
 *  - Stationary modifier tracking: Shift re-runs the hook's per-frame
 *    computation the moment the key changes, without waiting for the next
 *    pointermove (parity with the old StopGrid's useShiftHeld). The hook
 *    assigns that computation to `updateRef` in an effect — writing a ref
 *    during render trips react-hooks/refs.
 *  - onPointerMove: dragGesture threshold tracking, then the update.
 *  - onPointerCancel (browser-initiated: pen palm rejection, window switch,
 *    capture loss): disarm the drag, clear the overlay, and roll the doc back
 *    to its pre-drag snapshot instead of committing a drop — a no-op for
 *    hooks that only write on drop. See useStationDrag for the full
 *    rationale.
 *
 * The hook keeps ownership of the gesture semantics: arming `dragRef` on
 * start, the per-frame update math, and the pointerup commit.
 */
export function useGhostDragEngine<TDrag extends GhostDragCore, TOverlay>(
  svgRef: RefObject<SVGSVGElement | null>,
  screenToWorld: ScreenToWorld,
) {
  const [overlay, setOverlayState] = useState<TOverlay | null>(null);
  const overlayRef = useRef<TOverlay | null>(null);
  const setOverlay = (v: TOverlay | null) => {
    overlayRef.current = v;
    setOverlayState(v);
  };

  const screenToWorldRef = useRef(screenToWorld);
  useEffect(() => {
    screenToWorldRef.current = screenToWorld;
  }, [screenToWorld]);

  const dragRef = useRef<TDrag | null>(null);
  const updateRef = useRef<(x: number, y: number, mods: DragModifiers) => void>(() => {});

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Shift') return;
      // Ignore OS key-repeat: holding Shift fires keydown continuously, and each
      // one would recompute + publish a fresh overlay, re-rendering the whole
      // map for an unchanged result — a storm that drops a heavy map to
      // seconds-per-frame. Only the leading press and the release (never a
      // repeat) actually change the basis; the held middle is a no-op.
      if (e.repeat) return;
      const ds = dragRef.current;
      if (!ds || !ds.moved) return;
      updateRef.current(ds.lastMX, ds.lastMY, { altKey: e.altKey, shiftKey: e.shiftKey });
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, []);

  const onPointerMove = (e: React.PointerEvent) => {
    const ds = dragRef.current;
    if (!ds) return;
    // A lost pointerup (alt-tab mid-press) surfaces as a button-less move.
    if (pointerLost(e)) return onPointerCancel();
    const { moved } = trackDragMove(ds, e, svgRef);
    if (!moved) return;
    updateRef.current(e.clientX, e.clientY, { altKey: e.altKey, shiftKey: e.shiftKey });
  };

  const onPointerCancel = () => {
    const ds = dragRef.current;
    if (!ds) return;
    dragRef.current = null;
    setOverlay(null);
    ds.history.rollback();
  };

  return {
    overlay,
    overlayRef,
    setOverlay,
    dragRef,
    screenToWorldRef,
    updateRef,
    onPointerMove,
    onPointerCancel,
  };
}
