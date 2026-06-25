import { RefObject, useRef, useState } from 'react';
import { dragState, useDoc, useSelection } from '../../state/store';
import { DRAG_MOVE_THRESHOLD } from './dragGesture';
import {
  polygonsForRect,
  routeBulletsForRect,
  stationsForRect,
  svgImagesForRect,
  textLabelsForRect,
} from '../../geometry/stationBoundary';
import { stopHalfOf } from '../../model/lineWidth';
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
  /** Stations the selection WILL contain on release, given the current
   *  rect + modifier state. Null when not dragging — callers should fall
   *  back to the live selection store. */
  previewStationIds: StationId[] | null;
  /** Bullets the selection WILL contain on release. Null when not dragging. */
  previewBulletIds: string[] | null;
  /** Text labels the selection WILL contain on release. Null when not dragging. */
  previewLabelIds: string[] | null;
  /** Polygons the selection WILL contain on release. Null when not dragging. */
  previewPolygonIds: string[] | null;
  /** Svg images the selection WILL contain on release. Null when not dragging. */
  previewSvgImageIds: string[] | null;
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
  current: readonly string[],
  hits: readonly string[],
  mode: RectSelectMode,
): string[] {
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
 *
 * Both stations and route bullets participate; the same mode applies
 * independently to each type.
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
  const [previewStationIds, setPreviewStationIds] = useState<StationId[] | null>(null);
  const [previewBulletIds, setPreviewBulletIds] = useState<string[] | null>(null);
  const [previewLabelIds, setPreviewLabelIds] = useState<string[] | null>(null);
  const [previewPolygonIds, setPreviewPolygonIds] = useState<string[] | null>(null);
  const [previewSvgImageIds, setPreviewSvgImageIds] = useState<string[] | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const sel = useSelection.getState();
    if (sel.toolMode === 'hand' || sel.spaceHeld) return;
    // Rectangle-select is disabled in every non-idle editor mode. placing-label
    // is excluded here because it's a one-shot click; the others stay sticky
    // and would conflict with the rect-select drag.
    if (sel.uiMode.kind !== 'idle' && sel.uiMode.kind !== 'placing-label') return;
    const target = e.target as Element | null;
    // A marquee begins on "empty" canvas — the svg itself or the data-bg rect —
    // OR over a locked element. Locked items (polygons, stations) can't be
    // dragged, so a drag starting on one should rubber-band rather than do
    // nothing; they carry `data-locked` for exactly this. A plain no-move
    // click still falls through to select the locked element.
    const onBackground =
      target === svgRef.current ||
      (target?.hasAttribute('data-bg') ?? false) ||
      target?.closest?.('[data-locked]') != null;
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
    if (!ds.moved && Math.hypot(dxScreen, dyScreen) > DRAG_MOVE_THRESHOLD) {
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

    // Per-frame preview of the resulting selection. Reads stations,
    // bullets, labels, and the current selection straight from the stores
    // so we don't carry stale copies through the closure. Modifiers come
    // from this pointer event, so changing shift/ctrl mid-drag updates the
    // preview on the next move.
    const doc = useDoc.getState();
    const sel = useSelection.getState();
    const mode = modeFromEvent(e);
    const stationHits = stationsForRect(
      doc.stations,
      nextRect,
      {
        fontSize: doc.labelFontSize,
        weight: doc.labelWeight,
        italic: doc.labelItalic,
      },
      stopHalfOf(doc.lines),
    );
    const bulletHits = routeBulletsForRect(doc.routeBullets, nextRect);
    const labelHits = textLabelsForRect(doc.textLabels, nextRect);
    const polygonHits = polygonsForRect(doc.polygons, nextRect);
    const svgImageHits = svgImagesForRect(doc.svgImages, nextRect);
    setPreviewStationIds(applyMode(sel.selectedStationIds, stationHits, mode));
    setPreviewBulletIds(applyMode(sel.selectedRouteBulletIds, bulletHits, mode));
    setPreviewLabelIds(applyMode(sel.selectedLabelIds, labelHits, mode));
    setPreviewPolygonIds(applyMode(sel.selectedPolygonIds, polygonHits, mode));
    setPreviewSvgImageIds(applyMode(sel.selectedSvgImageIds, svgImageHits, mode));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const ds = dragRef.current;
    if (!ds) return;
    const wasMoved = ds.moved;
    dragRef.current = null;
    if (!wasMoved) {
      setRect(null);
      setPreviewStationIds(null);
      setPreviewBulletIds(null);
      setPreviewLabelIds(null);
      setPreviewPolygonIds(null);
      setPreviewSvgImageIds(null);
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
    setPreviewStationIds(null);
    setPreviewBulletIds(null);
    setPreviewLabelIds(null);
    setPreviewPolygonIds(null);
    setPreviewSvgImageIds(null);

    const doc = useDoc.getState();
    const stationHits = stationsForRect(
      doc.stations,
      finalRect,
      {
        fontSize: doc.labelFontSize,
        weight: doc.labelWeight,
        italic: doc.labelItalic,
      },
      stopHalfOf(doc.lines),
    );
    const bulletHits = routeBulletsForRect(doc.routeBullets, finalRect);
    const labelHits = textLabelsForRect(doc.textLabels, finalRect);
    const polygonHits = polygonsForRect(doc.polygons, finalRect);
    const svgImageHits = svgImagesForRect(doc.svgImages, finalRect);

    const sel = useSelection.getState();
    const mode = modeFromEvent(e);
    if (mode === 'xor') {
      sel.xorStationsToSelection(stationHits);
      sel.xorRouteBulletsToSelection(bulletHits);
      sel.xorLabelsToSelection(labelHits);
      sel.xorPolygonsToSelection(polygonHits);
      sel.xorSvgImagesToSelection(svgImageHits);
    } else if (mode === 'add') {
      sel.addStationsToSelection(stationHits);
      sel.addRouteBulletsToSelection(bulletHits);
      sel.addLabelsToSelection(labelHits);
      sel.addPolygonsToSelection(polygonHits);
      sel.addSvgImagesToSelection(svgImageHits);
    } else {
      sel.setStationSelection(stationHits);
      sel.setRouteBulletSelection(bulletHits);
      sel.setLabelSelection(labelHits);
      sel.setPolygonSelection(polygonHits);
      sel.setSvgImageSelection(svgImageHits);
    }

    try {
      svgRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      // pointer may not have been captured
    }
    setTimeout(() => {
      dragState.suppressClick = false;
    }, 0);
  };

  return {
    rect,
    previewStationIds,
    previewBulletIds,
    previewLabelIds,
    previewPolygonIds,
    previewSvgImageIds,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };
}
