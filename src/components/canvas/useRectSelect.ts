import { RefObject, useRef, useState } from 'react';
import { dragState, useDoc, useSelection } from '../../state/store';
import { stationsForRect } from '../../geometry/stationBoundary';
import type { Pt } from '../../geometry/polygonUnion';
import type { StationId } from '../../model/types';

export interface RectSelectRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface RectSelectApi {
  /** Active rubber-band rect in world coords, or null if not dragging. */
  rect: RectSelectRect | null;
  /** While dragging, the station ids the selection WILL contain on
   *  release, given the current rect + modifier state. Null when not
   *  dragging — callers should fall back to the live selection store. */
  previewIds: StationId[] | null;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
}

type RectSelectMode = 'set' | 'add' | 'xor';

function modeFromEvent(e: React.PointerEvent): RectSelectMode {
  if (e.shiftKey && (e.ctrlKey || e.metaKey)) return 'xor';
  if (e.shiftKey) return 'add';
  return 'set';
}

function applyMode(
  current: readonly StationId[],
  hits: readonly StationId[],
  mode: RectSelectMode,
): StationId[] {
  if (mode === 'set') return [...hits];
  const have = new Set(current);
  if (mode === 'add') {
    const novel = hits.filter((id) => !have.has(id));
    return novel.length === 0 ? [...current] : [...current, ...novel];
  }
  // xor: drop hits already in the selection, append novel hits.
  const removeSet = new Set(hits.filter((id) => have.has(id)));
  const novel = hits.filter((id) => !have.has(id));
  return current.filter((id) => !removeSet.has(id)).concat(novel);
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
  const [previewIds, setPreviewIds] = useState<StationId[] | null>(null);

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
    const nextRect: RectSelectRect = {
      x0: ds.startWorld.x,
      y0: ds.startWorld.y,
      x1: cur.x,
      y1: cur.y,
    };
    setRect(nextRect);

    // Per-frame preview of the resulting selection. Reads stations + the
    // current selection straight from the stores so we don't carry stale
    // copies through the closure. Modifiers come from this pointer event,
    // so changing shift/ctrl mid-drag updates the preview on the next move.
    const stations = useDoc.getState().stations;
    const hits = stationsForRect(stations, nextRect);
    const current = useSelection.getState().selectedStationIds;
    setPreviewIds(applyMode(current, hits, modeFromEvent(e)));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const ds = dragRef.current;
    if (!ds) return;
    const wasMoved = ds.moved;
    dragRef.current = null;
    if (!wasMoved) {
      setRect(null);
      setPreviewIds(null);
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
    setPreviewIds(null);

    const stations = useDoc.getState().stations;
    const hits = stationsForRect(stations, finalRect);

    const sel = useSelection.getState();
    const mode = modeFromEvent(e);
    if (mode === 'xor') sel.xorStationsToSelection(hits);
    else if (mode === 'add') sel.addStationsToSelection(hits);
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

  return { rect, previewIds, onPointerDown, onPointerMove, onPointerUp };
}
