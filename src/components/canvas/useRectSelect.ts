import { RefObject, useRef, useState } from 'react';
import { useDoc, useSelection } from '../../state/store';
import { useViewportStore } from '../../state/viewportStore';
import { anchorsVisibleNow } from '../../state/anchorVisibility';
import { pointerLost, releaseDragCapture, trackDragMove } from './dragGesture';
import {
  polygonsForRect,
  routeBulletsForRect,
  stationsForRect,
  svgImagesForRect,
  transferAnchorsForRect,
  textLabelsForRect,
} from '../../geometry/stationBoundary';
import { lineCirclesForRect } from '../../geometry/lineCircle';
import { stopMetricsOf } from '../../model/stopMetrics';
import type { MapDoc, StationId } from '../../model/types';
import type { Pt } from '../../geometry/polygonUnion';

/**
 * Stations swept up by the rect — none while the lines/stations toggle hides
 * them. Hits are geometric (straight off the doc), so hiding the network does
 * NOT take stations out of a marquee on its own: without this, a band thrown
 * around the background art the toggle just exposed would also select every
 * station it crossed, invisibly — and that selection answers Delete.
 */
function stationsForRectVisible(
  doc: Pick<MapDoc, 'stations' | 'lines' | 'transfers' | 'lineCircles'>,
  rect: RectSelectRect,
  includeLocked: boolean,
): StationId[] {
  if (!useViewportStore.getState().showNetwork) return [];
  return stationsForRect(doc.stations, rect, doc.lineCircles, stopMetricsOf(doc), includeLocked);
}

/**
 * FREE transfer anchors swept up by the rect — none while either toggle that
 * hides them is off. Same rule and same reason as stationsForRectVisible: hits
 * are geometric, so an invisible anchor would otherwise join a selection that
 * answers Delete. Hiding stays a PEEK though — an already-selected anchor is
 * not deselected by the toggle, only kept out of NEW marquees.
 */
function anchorsForRectVisible(
  doc: Pick<MapDoc, 'transferAnchors'>,
  rect: RectSelectRect,
): string[] {
  if (!anchorsVisibleNow()) return [];
  return transferAnchorsForRect(doc.transferAnchors, rect);
}

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
  previewAnchorIds: string[] | null;
  /** Text labels the selection WILL contain on release. Null when not dragging. */
  previewLabelIds: string[] | null;
  /** Polygons the selection WILL contain on release. Null when not dragging. */
  previewPolygonIds: string[] | null;
  /** Svg images the selection WILL contain on release. Null when not dragging. */
  previewSvgImageIds: string[] | null;
  /** Line circles the selection WILL contain on release. Null when not dragging. */
  previewLineCircleIds: string[] | null;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: () => void;
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
 *   - Pointer landed on the SVG itself, a `data-bg` element, or a
 *     `data-locked` element (locked items can't be dragged, so a drag
 *     starting on one rubber-bands instead).
 *   - Arrow tool, no space held, uiMode idle — except `placing-label`,
 *     which is a one-shot click and doesn't conflict with a drag.
 *
 * Modifier semantics on `onPointerUp`:
 *   - none           → replace selection with rect hits
 *   - shift          → add rect hits to selection
 *   - ctrl+shift     → toggle (xor) rect hits with selection
 *   - alt            → rect hits also include LOCKED items (composes with the
 *                      above). Locked items are click-through on the canvas,
 *                      so the alt-marquee is how one gets re-selected to
 *                      reach its popover's unlock toggle.
 *
 * All five selectable item types (stations, route bullets, text labels,
 * polygons, svg images) participate; the same mode applies independently
 * to each type.
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
  const [previewAnchorIds, setPreviewAnchorIds] = useState<string[] | null>(null);
  const [previewLineCircleIds, setPreviewLineCircleIds] = useState<string[] | null>(null);

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

  // Clear the rendered marquee + the five selection previews (shared by the
  // no-move click, the commit, and the cancel paths).
  const clearOverlay = () => {
    setRect(null);
    setPreviewStationIds(null);
    setPreviewBulletIds(null);
    setPreviewLabelIds(null);
    setPreviewPolygonIds(null);
    setPreviewSvgImageIds(null);
    setPreviewAnchorIds(null);
    setPreviewLineCircleIds(null);
  };

  // A browser pointercancel voids the marquee with no pointerup: disarm and
  // clear the overlay. Without this the armed rect follows every hover move
  // and a later unrelated pointerup COMMITS it — replacing the selection with
  // whatever the phantom rect swept. (No history group to roll back: the
  // marquee only writes selection state — which is exactly why it still needs
  // a cancel path.)
  const onPointerCancel = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    clearOverlay();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const ds = dragRef.current;
    if (!ds) return;
    // A lost pointerup (alt-tab mid-press, or a sub-threshold release over
    // sibling HTML chrome the svg never hears about) surfaces as a
    // button-less move.
    if (pointerLost(e)) return onPointerCancel();
    // Shared threshold/capture/suppress-click bookkeeping (suppressing the
    // synthesized click on pointerup so onCanvasClick doesn't immediately
    // deselect what the rect just selected).
    const { moved } = trackDragMove(ds, e, svgRef);
    if (!moved) return;
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
    // from this pointer event, so changing shift/ctrl/alt mid-drag updates
    // the preview on the next move. Alt = include locked items (they're
    // click-through on the canvas, so this marquee is their recovery path).
    const doc = useDoc.getState();
    const sel = useSelection.getState();
    const mode = modeFromEvent(e);
    const includeLocked = e.altKey;
    const stationHits = stationsForRectVisible(doc, nextRect, includeLocked);
    const bulletHits = routeBulletsForRect(doc.routeBullets, nextRect, includeLocked);
    const labelHits = textLabelsForRect(doc.textLabels, nextRect, includeLocked);
    const polygonHits = polygonsForRect(doc.polygons, nextRect, includeLocked);
    const svgImageHits = svgImagesForRect(doc.svgImages, nextRect, includeLocked);
    setPreviewStationIds(applyMode(sel.selectedStationIds, stationHits, mode));
    setPreviewBulletIds(applyMode(sel.selectedRouteBulletIds, bulletHits, mode));
    setPreviewLabelIds(applyMode(sel.selectedLabelIds, labelHits, mode));
    setPreviewPolygonIds(applyMode(sel.selectedPolygonIds, polygonHits, mode));
    setPreviewSvgImageIds(applyMode(sel.selectedSvgImageIds, svgImageHits, mode));
    setPreviewAnchorIds(
      applyMode(sel.selectedAnchorIds, anchorsForRectVisible(doc, nextRect), mode),
    );
    setPreviewLineCircleIds(
      applyMode(
        sel.selectedLineCircleIds,
        lineCirclesForRect(doc.lineCircles, nextRect, includeLocked),
        mode,
      ),
    );
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const ds = dragRef.current;
    if (!ds) return;
    const wasMoved = ds.moved;
    dragRef.current = null;
    if (!wasMoved) {
      clearOverlay();
      return;
    }
    const end = screenToWorld(e.clientX, e.clientY);
    const finalRect: RectSelectRect = {
      x0: ds.startWorld.x,
      y0: ds.startWorld.y,
      x1: end.x,
      y1: end.y,
    };
    clearOverlay();

    const doc = useDoc.getState();
    const includeLocked = e.altKey;
    const stationHits = stationsForRectVisible(doc, finalRect, includeLocked);
    const bulletHits = routeBulletsForRect(doc.routeBullets, finalRect, includeLocked);
    const labelHits = textLabelsForRect(doc.textLabels, finalRect, includeLocked);
    const polygonHits = polygonsForRect(doc.polygons, finalRect, includeLocked);
    const svgImageHits = svgImagesForRect(doc.svgImages, finalRect, includeLocked);
    const anchorHits = anchorsForRectVisible(doc, finalRect);
    const lineCircleHits = lineCirclesForRect(doc.lineCircles, finalRect, includeLocked);

    const sel = useSelection.getState();
    const mode = modeFromEvent(e);
    if (mode === 'xor') {
      sel.xorStationsToSelection(stationHits);
      sel.xorRouteBulletsToSelection(bulletHits);
      sel.xorLabelsToSelection(labelHits);
      sel.xorPolygonsToSelection(polygonHits);
      sel.xorSvgImagesToSelection(svgImageHits);
      sel.xorAnchorsToSelection(anchorHits);
      sel.xorLineCirclesToSelection(lineCircleHits);
    } else if (mode === 'add') {
      sel.addStationsToSelection(stationHits);
      sel.addRouteBulletsToSelection(bulletHits);
      sel.addLabelsToSelection(labelHits);
      sel.addPolygonsToSelection(polygonHits);
      sel.addSvgImagesToSelection(svgImageHits);
      sel.addAnchorsToSelection(anchorHits);
      sel.addLineCirclesToSelection(lineCircleHits);
    } else {
      sel.setStationSelection(stationHits);
      sel.setRouteBulletSelection(bulletHits);
      sel.setLabelSelection(labelHits);
      sel.setPolygonSelection(polygonHits);
      sel.setSvgImageSelection(svgImageHits);
      sel.setAnchorSelection(anchorHits);
      sel.setLineCircleSelection(lineCircleHits);
    }

    releaseDragCapture(e, svgRef);
  };

  return {
    rect,
    previewStationIds,
    previewBulletIds,
    previewAnchorIds,
    previewLabelIds,
    previewPolygonIds,
    previewSvgImageIds,
    previewLineCircleIds,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
  };
}
