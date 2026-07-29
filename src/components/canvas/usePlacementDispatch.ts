import { useState } from 'react';
import {
  beginHistoryGroup,
  cancelAppendMode,
  useDoc,
  useSelection,
  type UiMode,
} from '../../state/store';
import { decideCanvasClick, type AppendDecision } from '../../model/appendGestures';
import { useSnapPrefs } from '../../state/snapPrefs';
import { useViewportStore } from '../../state/viewportStore';
import { randomStationName } from '../../state/stationNames';
import {
  snapDraggedStation,
  snapToleranceAt,
  type SnapGuide,
  type SnapModes,
} from '../../geometry/snap';
import { snapPolygonPoint } from '../../geometry/polygonSnap';
import { polygonSnapAnchor } from '../../geometry/polygon';
import type { Vec2 } from '../../geometry/vec';
import type { LineId } from '../../model/types';
import { textLabelCorners } from '../../geometry/stationBoundary';
import { starterPolygonVertices } from '../../model/transforms';
import { defaultStyleProps } from '../../model/styles';
import { makePreviewTextLabel } from './LabelPlacingPreview';
import { liveAlignTargets, liveSnapStations } from './snapTargets';
import type { ViewportApi } from './useViewport';

export interface PlacementSnap {
  x: number;
  y: number;
  guides: SnapGuide[];
}

/**
 * Snap a placement point exactly like the new item's first drag would:
 * stations (and bullets bound to the default line) go through the station
 * engine; labels, polygons, svg images, and unbound bullets snap their drag
 * reference point through the point snapper against the shared pool. Shift
 * bypasses everything, matching the drag hooks. Shared by the cursor ghost
 * preview and the drop, so the preview always matches the placed position.
 */
export function snapPlacement(
  mode: UiMode,
  world: Vec2,
  shiftKey: boolean,
  modes: SnapModes,
  gridSize: number,
  zoom: number,
): PlacementSnap {
  const raw: PlacementSnap = { x: world.x, y: world.y, guides: [] };
  if (shiftKey) return raw;
  const doc = useDoc.getState();
  const tolerance = snapToleranceAt(zoom);

  // Station engine: a new station has no stops yet, so line mode is naturally
  // inert (nothing shares a line) and "Snap to all" works via the anchor
  // fallback. Bullet mode aligns along every stop of the bound line.
  const viaEngine = (bulletLineId?: LineId): PlacementSnap => {
    const r = snapDraggedStation({
      proposedX: world.x,
      proposedY: world.y,
      draggedRotation: 0,
      draggedStops: [],
      // Same visibility gate as the point-snapper pool: placing a bullet while
      // the network is hidden must not align to invisible stops.
      stations: liveSnapStations(doc.stations),
      lines: doc.lines,
      tolerance,
      bulletLineId,
      modes,
      gridInterval: gridSize,
    });
    return { x: r.x, y: r.y, guides: r.guides };
  };

  // Point snapper on the item's drag reference point (`anchorOff` from the
  // item position), against the shared pool. No exclusions: the new item
  // isn't in the doc yet.
  const viaPoint = (anchorOff: Vec2): PlacementSnap => {
    const snap = snapPolygonPoint({
      proposed: { x: world.x + anchorOff.x, y: world.y + anchorOff.y },
      lineTargets: [],
      allTargets: liveAlignTargets(),
      modes,
      tolerance,
      gridInterval: gridSize,
    });
    return { x: snap.x - anchorOff.x, y: snap.y - anchorOff.y, guides: snap.guides };
  };

  switch (mode.kind) {
    case 'placing-station':
      return viaEngine();
    case 'creating-route-bullet': {
      // Same default-line pick as the drop below, so the snap matches the
      // bullet the click will actually create.
      const lineId = doc.lineOrder.find((id) => doc.lines[id]) ?? null;
      return lineId ? viaEngine(lineId) : viaPoint({ x: 0, y: 0 });
    }
    case 'placing-label': {
      // Measure the label the DROP will actually create — the doc's designated
      // default label style included — not a factory-sized phantom. Sharing
      // makePreviewTextLabel with the ghost keeps preview, snap and drop on ONE
      // box; measuring the factory box instead offsets the snap by half the
      // size delta the moment the Default style is redefined.
      const anchor = polygonSnapAnchor(
        textLabelCorners(makePreviewTextLabel(world, defaultStyleProps(doc, 'textLabel'))),
      );
      return viaPoint({ x: anchor.x - world.x, y: anchor.y - world.y });
    }
    case 'placing-anchor':
      // A bare point with nothing to measure: snap the drop position itself
      // through the point snapper, exactly like an unbound bullet and like the
      // anchor's own drag (useItemDrag), so preview == drop == drag.
      return viaPoint({ x: 0, y: 0 });
    case 'creating-polygon': {
      const anchor = polygonSnapAnchor(starterPolygonVertices(world.x, world.y));
      return viaPoint({ x: anchor.x - world.x, y: anchor.y - world.y });
    }
    case 'placing-svg':
      // Placement forces rotation 0, so the drag's rotated-corner anchor is
      // the plain top-left corner.
      return viaPoint({ x: -mode.image.width / 2, y: -mode.image.height / 2 });
    case 'appending-to-line':
      // Alt-click station creation snaps exactly like placing-station.
      return viaEngine();
    default:
      return raw;
  }
}

/** The create-* subset of AppendDecision: an Edit Stops action that mints a
 *  new station (seed / connect / splice) as the second click of the gesture. */
export type AppendCreate = Extract<
  AppendDecision,
  { kind: 'create-seed' | 'create-connect' | 'create-splice' }
>;

export interface PlacementDispatch {
  /**
   * Handle a background canvas click while a click-to-place / mode is active.
   * Returns true if the click was consumed (an item was placed or a mode
   * exited); false means the canvas should fall through to its deselect-all.
   */
  handleCanvasPlace: (e: React.MouseEvent) => boolean;
  /**
   * Execute an Edit Stops create decision at the event's snapped point: mint
   * the station and wire it (seed / connect / splice) in ONE undo group, then
   * advance the append cursor. Shared by the empty-canvas alt-click
   * (handleCanvasPlace) and the alt-click directly on the armed segment
   * (MapCanvas appendDeepPick), so the two can never wire a splice differently.
   */
  runAppendCreate: (lineId: LineId, decision: AppendCreate, e: React.MouseEvent) => void;
  /**
   * The pre-rolled name for the next station drop in placing-station mode, so
   * the ghost preview shows the real name and the click commits the same one.
   */
  previewName: string | null;
}

/**
 * Owns the canvas placement-mode state machine: the per-mode click dispatch and
 * the placing-station preview name. Peeled out of MapCanvas so the canvas no
 * longer holds the 14-branch if-chain plus the add* mutators / lineOrder /
 * preview-name state those branches needed.
 */
export function usePlacementDispatch(view: ViewportApi): PlacementDispatch {
  const uiMode = useSelection((s) => s.uiMode);
  const setUiMode = useSelection((s) => s.setUiMode);
  const setAppendCursor = useSelection((s) => s.setAppendCursor);
  const selectLabel = useSelection((s) => s.selectLabel);
  const selectPolygon = useSelection((s) => s.selectPolygon);
  const selectSvgImage = useSelection((s) => s.selectSvgImage);
  const addStation = useDoc((s) => s.addStation);
  const addStationToLine = useDoc((s) => s.addStationToLine);
  const connectStationsOnLine = useDoc((s) => s.connectStationsOnLine);
  const spliceStationIntoEdge = useDoc((s) => s.spliceStationIntoEdge);
  const addRouteBullet = useDoc((s) => s.addRouteBullet);
  const addTransferAnchor = useDoc((s) => s.addTransferAnchor);
  const addTextLabel = useDoc((s) => s.addTextLabel);
  const addPolygon = useDoc((s) => s.addPolygon);
  const addSvgImage = useDoc((s) => s.addSvgImage);
  const lineOrder = useDoc((s) => s.lineOrder);
  const lines = useDoc((s) => s.lines);
  const snapModes = useSnapPrefs((s) => s.modes);
  const gridSize = useViewportStore((s) => s.gridSize);

  // Pre-roll the next station name when placing-station mode turns on, via the
  // "adjust state during render" pattern — see
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const placingStation = uiMode.kind === 'placing-station';
  const [previewName, setPreviewName] = useState<string | null>(() =>
    placingStation ? randomStationName() : null,
  );
  const [prevPlacing, setPrevPlacing] = useState(placingStation);
  if (placingStation !== prevPlacing) {
    setPrevPlacing(placingStation);
    setPreviewName(placingStation ? randomStationName() : null);
  }

  const runAppendCreate = (lineId: LineId, decision: AppendCreate, e: React.MouseEvent): void => {
    // Snap exactly like placing-station (the appending-to-line branch of
    // snapPlacement), so the drop matches the alt-ghost preview. The mode's
    // cursor is irrelevant to the snap, so a throwaway one keeps this decoupled
    // from the live uiMode.
    const w = snapPlacement(
      { kind: 'appending-to-line', lineId, cursor: null },
      view.screenToWorld(e.clientX, e.clientY),
      e.shiftKey,
      snapModes,
      gridSize,
      view.viewport.zoom,
    );
    // Grouped so one Ctrl+Z removes the station AND its wiring together.
    const group = beginHistoryGroup();
    const id = addStation(w.x, w.y);
    if (decision.kind === 'create-seed') {
      addStationToLine(lineId, id);
      setAppendCursor({ kind: 'station', stationId: id });
    } else if (decision.kind === 'create-connect') {
      connectStationsOnLine(lineId, decision.from, id);
      setAppendCursor({ kind: 'station', stationId: id });
    } else {
      spliceStationIntoEdge(lineId, decision.from, decision.to, id);
      setAppendCursor({ kind: 'edge', from: id, to: decision.to });
    }
    group.commit();
  };

  const handleCanvasPlace = (e: React.MouseEvent): boolean => {
    const mode = uiMode;
    // Same snap the ghost preview used for this frame, so drop == preview.
    const snappedWorld = () =>
      snapPlacement(
        mode,
        view.screenToWorld(e.clientX, e.clientY),
        e.shiftKey,
        snapModes,
        gridSize,
        view.viewport.zoom,
      );
    if (mode.kind === 'placing-station') {
      const w = snappedWorld();
      addStation(w.x, w.y, previewName ?? undefined);
      setPreviewName(randomStationName());
      // Stay in place-station mode; user clicks again or hits Esc / the
      // toolbar button to exit. Don't auto-select the new station — that
      // would close the placing-mode banner via the inspector swap.
      return true;
    }
    if (mode.kind === 'placing-anchor') {
      const w = snappedWorld();
      addTransferAnchor(w.x, w.y);
      // Sticky like stations and bullets: click-click-click drops a row of
      // them. Don't auto-select — that would close the placement banner.
      return true;
    }
    if (mode.kind === 'creating-route-bullet') {
      const w = snappedWorld();
      // Default new bullet to the first line in z-order so it has a
      // recognizable color/service immediately. User can change it via the
      // popover after exiting placement mode (Esc / right-click). Don't
      // auto-select — that would close the placement banner and break the
      // click-click-click drop pattern, like place-station mode.
      const defaultLineId = lineOrder.find((id) => lines[id]) ?? null;
      addRouteBullet(w.x, w.y, defaultLineId);
      return true;
    }
    if (mode.kind === 'creating-line-tag') {
      // Click on background while in tag mode = exit the mode.
      setUiMode({ kind: 'idle' });
      return true;
    }
    if (mode.kind === 'layering') {
      // Click on background while in layering mode = exit the mode.
      setUiMode({ kind: 'idle' });
      return true;
    }
    if (mode.kind === 'editing-station-layout') {
      // Click on empty canvas = done editing. Keep the station selected so
      // the inspector stays open (Esc behaves the same way).
      setUiMode({ kind: 'idle' });
      return true;
    }
    if (mode.kind === 'appending-to-line') {
      const line = lines[mode.lineId];
      if (!line) {
        cancelAppendMode();
        return true;
      }
      const decision = decideCanvasClick(line, mode.cursor, e.altKey);
      if (decision.kind === 'cursor') {
        // Back out one level: drop the pending cursor, stay in the editor.
        setAppendCursor(decision.cursor);
        return true;
      }
      if (decision.kind === 'exit') {
        cancelAppendMode();
        return true;
      }
      if (
        decision.kind === 'create-seed' ||
        decision.kind === 'create-connect' ||
        decision.kind === 'create-splice'
      ) {
        // Alt-click drops a new station at the snapped point and completes the
        // pending action with it.
        runAppendCreate(mode.lineId, decision, e);
      }
      return true; // consumed either way ('none' falls through to here)
    }
    if (mode.kind === 'creating-transfer') {
      // Click on background while picking transfer endpoints exits the mode.
      setUiMode({ kind: 'idle' });
      return true;
    }
    if (mode.kind === 'placing-label') {
      // Single-shot: place one label, exit placing mode, and auto-select the
      // new label so the popover opens. Different from station / bullet
      // placement, which stay in mode for rapid click-click-click drops —
      // labels are heavier (text edit) so the single-shot flow makes sense.
      const w = snappedWorld();
      const id = addTextLabel(w.x, w.y);
      setUiMode({ kind: 'idle' });
      selectLabel(id);
      return true;
    }
    if (mode.kind === 'creating-polygon') {
      // Single-shot like labels: drop a default square, exit placing mode, and
      // select it so the popover + vertex handles appear for immediate editing.
      const w = snappedWorld();
      const id = addPolygon(w.x, w.y);
      setUiMode({ kind: 'idle' });
      selectPolygon(id);
      return true;
    }
    if (mode.kind === 'placing-svg') {
      // Single-shot like labels/polygons: drop the imported image (snapped by
      // its top-left corner like a move would), exit, and select it so the
      // transform handles + popover appear for immediate manipulation.
      const w = snappedWorld();
      const id = addSvgImage({ ...mode.image, x: w.x, y: w.y, rotation: 0 });
      setUiMode({ kind: 'idle' });
      selectSvgImage(id);
      return true;
    }
    return false;
  };

  return { handleCanvasPlace, runAppendCreate, previewName };
}
