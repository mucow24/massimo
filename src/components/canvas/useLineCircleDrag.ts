import { RefObject, useCallback, useRef, useState } from 'react';
import { beginHistoryGroup, useDoc } from '../../state/store';
import { useSelection } from '../../state/selection';
import { useSnapPrefs } from '../../state/snapPrefs';
import { useViewportStore } from '../../state/viewportStore';
import { snapToleranceAt, type SnapGuide, snapGuidesEqual } from '../../geometry/snap';
import { snapPolygonPoint } from '../../geometry/polygonSnap';
import { liveAlignTargets } from './snapTargets';
import { finishDrag, pointerLost, trackDragMove } from './dragGesture';
import type { LineCirclePart } from '../LineCircleView';

export interface LineCircleDragApi {
  snapGuides: SnapGuide[];
  // The circle whose radius is being knob-dragged right now (null otherwise) —
  // drives the diameter readout. State, not a ref: the label must re-render
  // with the gesture.
  resizingId: string | null;
  onStartDrag: (id: string, part: LineCirclePart, e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: () => void;
}

/**
 * Line-circle drags: grabbing the rim MOVES the circle (its bound stations
 * ride along rigidly inside moveLineCircle); grabbing the resize knob drags
 * the RADIUS (bound stations reproject radially). The center is the drag
 * reference point and snaps through the point snapper against the shared pool
 * (like an unbound bullet); the radius snaps only to its quarter-unit grid
 * (inside the transform). Shift bypasses snapping, matching every other drag.
 */
export function useLineCircleDrag(
  svgRef: RefObject<SVGSVGElement | null>,
  viewportZoom: number,
): LineCircleDragApi {
  const moveLineCircle = useDoc((s) => s.moveLineCircle);
  const setLineCircleRadius = useDoc((s) => s.setLineCircleRadius);
  const snapModes = useSnapPrefs((s) => s.modes);
  const gridSize = useViewportStore((s) => s.gridSize);
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);
  const [resizingId, setResizingId] = useState<string | null>(null);

  const dragRef = useRef<{
    id: string;
    part: LineCirclePart;
    startWX: number; // circle center at pointer-down
    startWY: number;
    startRadius: number;
    startMX: number;
    startMY: number;
    moved: boolean;
    history: ReturnType<typeof beginHistoryGroup>;
  } | null>(null);

  const onStartDrag = useCallback((id: string, part: LineCirclePart, e: React.PointerEvent) => {
    const circle = useDoc.getState().lineCircles[id];
    if (!circle || circle.locked) return;
    useSelection.getState().selectLineCircle(id);
    dragRef.current = {
      id,
      part,
      startWX: circle.x,
      startWY: circle.y,
      startRadius: circle.radius,
      startMX: e.clientX,
      startMY: e.clientY,
      moved: false,
      history: beginHistoryGroup({ deferPersist: true }),
    };
  }, []);

  const onPointerMove = (e: React.PointerEvent) => {
    const ds = dragRef.current;
    if (!ds) return;
    if (pointerLost(e)) return onPointerCancel();
    const { moved, dxScreen, dyScreen } = trackDragMove(ds, e, svgRef);
    if (!moved) return;
    const dx = dxScreen / viewportZoom;
    const dy = dyScreen / viewportZoom;
    if (ds.part === 'knob') {
      // The knob sits on the east point, so the radius follows the pointer's
      // horizontal world distance from the center. Quarter-grid + minimum are
      // the transform's clamp; nothing else to snap to. The diameter readout
      // arms on the first real move (not pointer-down, so a click shows none).
      if (resizingId !== ds.id) setResizingId(ds.id);
      setLineCircleRadius(ds.id, ds.startRadius + dx);
      return;
    }
    let nx = ds.startWX + dx;
    let ny = ds.startWY + dy;
    if (!e.shiftKey) {
      const snap = snapPolygonPoint({
        proposed: { x: nx, y: ny },
        lineTargets: [],
        allTargets: liveAlignTargets(),
        modes: snapModes,
        tolerance: snapToleranceAt(viewportZoom),
        gridInterval: gridSize,
      });
      nx = snap.x;
      ny = snap.y;
      setSnapGuides((prev) => (snapGuidesEqual(prev, snap.guides) ? prev : snap.guides));
    } else if (snapGuides.length > 0) {
      setSnapGuides([]);
    }
    moveLineCircle(ds.id, nx, ny);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const ds = dragRef.current;
    if (!ds) return;
    dragRef.current = null;
    setSnapGuides([]);
    setResizingId(null);
    finishDrag(ds, e, svgRef);
  };

  const onPointerCancel = () => {
    const ds = dragRef.current;
    if (!ds) return;
    dragRef.current = null;
    setSnapGuides([]);
    setResizingId(null);
    ds.history.rollback();
  };

  return { snapGuides, resizingId, onStartDrag, onPointerMove, onPointerUp, onPointerCancel };
}
