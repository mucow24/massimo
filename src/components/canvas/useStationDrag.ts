import { RefObject, useRef, useState } from 'react';
import { beginHistoryGroup, dragState, useDoc } from '../../state/store';
import type { StationId } from '../../model/types';
import { Rotation } from '../../geometry/orientation';
import { snapDraggedStation, SnapGuide, SNAP_PERP_TOLERANCE } from '../../geometry/snap';

export interface StationDragApi {
  snapGuides: SnapGuide[];
  onStartDrag: (id: StationId, e: React.PointerEvent, redistributeAnchor?: StationId) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
}

/**
 * Owns station-drag state: tracks the in-flight drag, runs the snap engine,
 * and commits position updates via `moveStation`. Returns the active snap
 * guides for rendering plus the pointer handlers to wire onto the SVG.
 *
 * The handlers are drag-only; pan handling lives in `useViewport`. The shell
 * composes both onto each pointer event.
 */
export function useStationDrag(
  svgRef: RefObject<SVGSVGElement | null>,
  viewportZoom: number,
): StationDragApi {
  const stations = useDoc((s) => s.stations);
  const moveStation = useDoc((s) => s.moveStation);
  const redistributeBetween = useDoc((s) => s.redistributeBetween);

  const dragStationRef = useRef<{
    id: StationId;
    startWX: number;
    startWY: number;
    startMX: number;
    startMY: number;
    moved: boolean;
    redistributeAnchor: StationId | null;
    history: ReturnType<typeof beginHistoryGroup>;
  } | null>(null);
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);

  const onStartDrag = (
    id: StationId,
    e: React.PointerEvent,
    redistributeAnchor?: StationId,
  ) => {
    const st = stations[id];
    if (!st) return;
    dragStationRef.current = {
      id,
      startWX: st.x,
      startWY: st.y,
      startMX: e.clientX,
      startMY: e.clientY,
      moved: false,
      redistributeAnchor: redistributeAnchor ?? null,
      // Snapshot the doc and pause history. If the gesture turns out to be
      // a drag, we'll commit one entry on pointerup; if it's just a click,
      // we cancel without recording anything.
      history: beginHistoryGroup(),
    };
    // Don't capture the pointer here — capture would redirect the synthesized
    // click event away from the station's rect to the SVG, breaking onClick.
    // We capture below on first significant movement (in onPointerMove) instead.
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragStationRef.current) return;
    const ds = dragStationRef.current;
    const dxScreen = e.clientX - ds.startMX;
    const dyScreen = e.clientY - ds.startMY;
    // Use a screen-space threshold so it's forgiving regardless of zoom.
    if (!ds.moved && Math.hypot(dxScreen, dyScreen) > 4) {
      ds.moved = true;
      dragState.suppressClick = true;
      // Capture the pointer now that we're sure it's a drag, so the user can
      // slide off the station/SVG without losing it.
      svgRef.current?.setPointerCapture(e.pointerId);
    }
    if (!ds.moved) return;
    const dx = dxScreen / viewportZoom;
    const dy = dyScreen / viewportZoom;
    let nx = ds.startWX + dx;
    let ny = ds.startWY + dy;
    const draggedSt = stations[ds.id];
    const draggedRot = (draggedSt?.rotation ?? 0) as Rotation;
    const draggedStops = draggedSt?.stops ?? [];
    // Snap is on by default; Shift bypasses it.
    const shouldSnap = !e.shiftKey;
    if (shouldSnap) {
      const snap = snapDraggedStation({
        draggedId: ds.id,
        proposedX: nx,
        proposedY: ny,
        draggedRotation: draggedRot,
        draggedStops,
        stations,
        tolerance: SNAP_PERP_TOLERANCE,
      });
      nx = snap.x;
      ny = snap.y;
      setSnapGuides(snap.guides);
    } else if (snapGuides.length > 0) {
      setSnapGuides([]);
    }
    moveStation(ds.id, nx, ny);
    if (ds.redistributeAnchor) {
      // Drag-mode redistribute uses straight-line interpolation between A
      // and B's stop positions so spacing stays predictable and intermediates
      // don't wobble off-axis as the polyline reshapes each frame.
      redistributeBetween(ds.redistributeAnchor, ds.id, 'straight');
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragStationRef.current) return;
    const ds = dragStationRef.current;
    const wasMoved = ds.moved;
    dragStationRef.current = null;
    setSnapGuides([]);
    if (!wasMoved) {
      // Pure click — no drag happened. Discard the captured snapshot.
      ds.history.cancel();
      return;
    }
    // Drag actually happened: push a single history entry covering the
    // full sequence of moveStation updates.
    ds.history.commit();
    try {
      svgRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      // pointer may not have been captured if release happened too early
    }
    // Suppress the click that fires after pointerup.
    setTimeout(() => {
      dragState.suppressClick = false;
    }, 0);
  };

  return { snapGuides, onStartDrag, onPointerMove, onPointerUp };
}
