import { RefObject, useRef, useState } from 'react';
import { useDoc, useSelection } from '../../state/store';
import { useViewportStore } from '../../state/viewportStore';
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
import { kindVisibleNow } from '../../state/visibility';
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
  if (!kindVisibleNow('showAnchors')) return [];
  return transferAnchorsForRect(doc.transferAnchors, rect);
}

export interface RectSelectRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Everything one marquee rect sweeps up, per kind. */
interface RectHits {
  stations: StationId[];
  bullets: string[];
  labels: string[];
  polygons: string[];
  svgImages: string[];
  anchors: string[];
  lineCircles: string[];
}

/**
 * The kinds a rect sweeps up, with every hidden one left out.
 *
 * Hits are geometric — straight off the doc — so hiding a kind does NOT take it
 * out of a marquee by itself: without this, a band thrown around the background
 * art the View menu just exposed would also grab the layers it crossed, an
 * invisible selection that then answers Delete and the nudge keys. Hiding stays
 * a PEEK: an already-selected item is not deselected, only kept out of NEW
 * marquees.
 *
 * ONE function for both the per-frame preview and the commit on release. They
 * ran as two copies of the same seven calls, which is two places for a gate to
 * be added to only one of — and a gate the preview honours but the commit does
 * not looks right for the whole drag and selects the invisible thing anyway.
 */
function hitsForRect(
  doc: Parameters<typeof stationsForRectVisible>[0] &
    Pick<
      MapDoc,
      'routeBullets' | 'textLabels' | 'polygons' | 'svgImages' | 'transferAnchors' | 'lineCircles'
    >,
  rect: RectSelectRect,
  includeLocked: boolean,
): RectHits {
  // Through `kindVisibleNow`, not the raw flags: a kind its placing mode has
  // REVEALED is on the canvas, so a marquee has to be able to sweep it up.
  return {
    stations: stationsForRectVisible(doc, rect, includeLocked),
    bullets: kindVisibleNow('showRouteBullets')
      ? routeBulletsForRect(doc.routeBullets, rect, includeLocked)
      : [],
    labels: kindVisibleNow('showTextLabels')
      ? textLabelsForRect(doc.textLabels, rect, includeLocked)
      : [],
    polygons: kindVisibleNow('showPolygons')
      ? polygonsForRect(doc.polygons, rect, includeLocked)
      : [],
    svgImages: kindVisibleNow('showSvgImages')
      ? svgImagesForRect(doc.svgImages, rect, includeLocked)
      : [],
    anchors: anchorsForRectVisible(doc, rect),
    lineCircles: kindVisibleNow('showLineCircles')
      ? lineCirclesForRect(doc.lineCircles, rect, includeLocked)
      : [],
  };
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
 * Every marquee-selectable item type participates — stations, route bullets,
 * text labels, polygons, svg images, free transfer anchors and line circles
 * (see `hitsForRect`) — and the same mode applies independently to each.
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

  // Clear the rendered marquee + every selection preview (shared by the
  // no-move click, the commit, and the cancel paths). One line per sweepable
  // kind, so it has to grow with the preview list above — guides are the one
  // absentee, and deliberately so (see the commit path).
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
    const sel = useSelection.getState();
    const mode = modeFromEvent(e);
    const hits = hitsForRect(useDoc.getState(), nextRect, e.altKey);
    setPreviewStationIds(applyMode(sel.selectedStationIds, hits.stations, mode));
    setPreviewBulletIds(applyMode(sel.selectedRouteBulletIds, hits.bullets, mode));
    setPreviewLabelIds(applyMode(sel.selectedLabelIds, hits.labels, mode));
    setPreviewPolygonIds(applyMode(sel.selectedPolygonIds, hits.polygons, mode));
    setPreviewSvgImageIds(applyMode(sel.selectedSvgImageIds, hits.svgImages, mode));
    setPreviewAnchorIds(applyMode(sel.selectedAnchorIds, hits.anchors, mode));
    setPreviewLineCircleIds(applyMode(sel.selectedLineCircleIds, hits.lineCircles, mode));
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

    const hits = hitsForRect(useDoc.getState(), finalRect, e.altKey);
    const sel = useSelection.getState();
    const mode = modeFromEvent(e);
    if (mode === 'xor') {
      sel.xorStationsToSelection(hits.stations);
      sel.xorRouteBulletsToSelection(hits.bullets);
      sel.xorLabelsToSelection(hits.labels);
      sel.xorPolygonsToSelection(hits.polygons);
      sel.xorSvgImagesToSelection(hits.svgImages);
      sel.xorAnchorsToSelection(hits.anchors);
      sel.xorLineCirclesToSelection(hits.lineCircles);
    } else if (mode === 'add') {
      sel.addStationsToSelection(hits.stations);
      sel.addRouteBulletsToSelection(hits.bullets);
      sel.addLabelsToSelection(hits.labels);
      sel.addPolygonsToSelection(hits.polygons);
      sel.addSvgImagesToSelection(hits.svgImages);
      sel.addAnchorsToSelection(hits.anchors);
      sel.addLineCirclesToSelection(hits.lineCircles);
    } else {
      sel.setStationSelection(hits.stations);
      sel.setRouteBulletSelection(hits.bullets);
      sel.setLabelSelection(hits.labels);
      sel.setPolygonSelection(hits.polygons);
      sel.setSvgImageSelection(hits.svgImages);
      sel.setAnchorSelection(hits.anchors);
      sel.setLineCircleSelection(hits.lineCircles);
      // Alignment guides aren't marquee-sweepable — a rect can neither hit one
      // nor miss one — but set-mode means REPLACE, and none of the seven above
      // touches the guide list. Without this a guide selected just before the
      // drag rides into the new selection: Delete takes it out with the rest,
      // a group drag tows it, and the sole-selection popover never opens.
      // Add/xor leave it alone on purpose — those modes are additive.
      sel.setGuideSelection([]);
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
