import { RefObject, useRef, useState } from 'react';
import { dragState, useDoc, useSelection } from '../../state/store';
import { stationsForRect } from '../../geometry/stationBoundary';
import type { Pt } from '../../geometry/polygonUnion';

export interface RectSelectRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface RectSelectApi {
  /** Active rubber-band rect in world coords, or null if not dragging. */
  rect: RectSelectRect | null;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
}

/**
 * Rubber-band rectangle selection on the canvas background. Mirrors the
 * `useStationDrag` / `useViewport` hook shape so the canvas can compose all
 * three onto each pointer event.
 *
 * Activation requirements (in `onPointerDown`):
 *   - Left button.
 *   - Pointer landed on the SVG itself or a `data-bg` element.
 *   - Arrow tool, no space held, no active special mode (placing,
 *     creating tag, creating bullet, creating transfer, appending to line).
 *
 * Modifier semantics on `onPointerUp`:
 *   - none           → replace selection with rect hits
 *   - shift          → add rect hits to selection
 *   - ctrl+shift     → toggle (xor) rect hits with selection
 */
export function useRectSelect(
  svgRef: RefObject<SVGSVGElement | null>,
  screenToWorld: (mx: number, my: number) => Pt,
): RectSelectApi {
  const dragRef = useRef<{
    startWorld: Pt;
    startMX: number;
    startMY: number;
    moved: boolean;
  } | null>(null);
  const [rect, setRect] = useState<RectSelectRect | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const sel = useSelection.getState();
    if (sel.toolMode === 'hand' || sel.spaceHeld) return;
    if (
      sel.placingStation ||
      sel.creatingLineTag ||
      sel.creatingRouteBullet ||
      sel.creatingTransfer ||
      sel.appendingToLineId !== null
    )
      return;
    const target = e.target as Element | null;
    const onBackground = target === svgRef.current || (target?.hasAttribute('data-bg') ?? false);
    if (!onBackground) return;
    dragRef.current = {
      startWorld: screenToWorld(e.clientX, e.clientY),
      startMX: e.clientX,
      startMY: e.clientY,
      moved: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const ds = dragRef.current;
    if (!ds) return;
    const dxScreen = e.clientX - ds.startMX;
    const dyScreen = e.clientY - ds.startMY;
    if (!ds.moved && Math.hypot(dxScreen, dyScreen) > 4) {
      ds.moved = true;
      // Suppress the synthesized click on pointerup so onCanvasClick
      // doesn't immediately deselect what the rect just selected.
      dragState.suppressClick = true;
      svgRef.current?.setPointerCapture(e.pointerId);
    }
    if (!ds.moved) return;
    const cur = screenToWorld(e.clientX, e.clientY);
    setRect({ x0: ds.startWorld.x, y0: ds.startWorld.y, x1: cur.x, y1: cur.y });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const ds = dragRef.current;
    if (!ds) return;
    const wasMoved = ds.moved;
    dragRef.current = null;
    if (!wasMoved) {
      setRect(null);
      return;
    }
    const end = screenToWorld(e.clientX, e.clientY);
    const finalRect: RectSelectRect = {
      x0: ds.startWorld.x,
      y0: ds.startWorld.y,
      x1: end.x,
      y1: end.y,
    };
    setRect(null);

    const stations = useDoc.getState().stations;
    const hits = stationsForRect(stations, finalRect);

    const sel = useSelection.getState();
    const xor = e.shiftKey && (e.ctrlKey || e.metaKey);
    const add = e.shiftKey && !(e.ctrlKey || e.metaKey);
    if (xor) sel.xorStationsToSelection(hits);
    else if (add) sel.addStationsToSelection(hits);
    else sel.setStationSelection(hits);

    try {
      svgRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      // pointer may not have been captured
    }
    setTimeout(() => {
      dragState.suppressClick = false;
    }, 0);
  };

  return { rect, onPointerDown, onPointerMove, onPointerUp };
}
