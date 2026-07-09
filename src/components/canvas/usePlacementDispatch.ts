import { useState } from 'react';
import { cancelAppendMode, useDoc, useSelection, type UiMode } from '../../state/store';
import { useSnapPrefs } from '../../state/snapPrefs';
import { useViewportStore } from '../../state/viewportStore';
import { randomStationName } from '../../state/stationNames';
import {
  SNAP_PERP_TOLERANCE,
  snapDraggedStation,
  type SnapGuide,
  type SnapModes,
} from '../../geometry/snap';
import { snapPolygonPoint } from '../../geometry/polygonSnap';
import { polygonSnapAnchor } from '../../geometry/polygon';
import type { Vec2 } from '../../geometry/vec';
import type { LineId } from '../../model/types';
import { textLabelCorners } from '../../geometry/stationBoundary';
import { starterPolygonVertices, TEXT_LABEL_DEFAULTS } from '../../model/transforms';
import { alignTargets } from './snapTargets';
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
  const tolerance = SNAP_PERP_TOLERANCE / zoom;

  // Station engine: a new station has no stops yet, so line mode is naturally
  // inert (nothing shares a line) and "Snap to all" works via the anchor
  // fallback. Bullet mode aligns along every stop of the bound line.
  const viaEngine = (bulletLineId?: LineId): PlacementSnap => {
    const r = snapDraggedStation({
      proposedX: world.x,
      proposedY: world.y,
      draggedRotation: 0,
      draggedStops: [],
      stations: doc.stations,
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
      allTargets: alignTargets(doc),
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
      const anchor = polygonSnapAnchor(
        textLabelCorners({ id: 'preview', x: world.x, y: world.y, ...TEXT_LABEL_DEFAULTS }),
      );
      return viaPoint({ x: anchor.x - world.x, y: anchor.y - world.y });
    }
    case 'creating-polygon': {
      const anchor = polygonSnapAnchor(starterPolygonVertices(world.x, world.y));
      return viaPoint({ x: anchor.x - world.x, y: anchor.y - world.y });
    }
    case 'placing-svg':
      // Placement forces rotation 0, so the drag's rotated-corner anchor is
      // the plain top-left corner.
      return viaPoint({ x: -mode.image.width / 2, y: -mode.image.height / 2 });
    default:
      return raw;
  }
}

export interface PlacementDispatch {
  /**
   * Handle a background canvas click while a click-to-place / mode is active.
   * Returns true if the click was consumed (an item was placed or a mode
   * exited); false means the canvas should fall through to its deselect-all.
   */
  handleCanvasPlace: (e: React.MouseEvent) => boolean;
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
  const selectLabel = useSelection((s) => s.selectLabel);
  const selectPolygon = useSelection((s) => s.selectPolygon);
  const selectSvgImage = useSelection((s) => s.selectSvgImage);
  const addStation = useDoc((s) => s.addStation);
  const addRouteBullet = useDoc((s) => s.addRouteBullet);
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
      cancelAppendMode();
      return true;
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

  return { handleCanvasPlace, previewName };
}
