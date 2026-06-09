import { useState } from 'react';
import { cancelAppendMode, useDoc, useSelection } from '../../state/store';
import { useSnapPrefs } from '../../state/snapPrefs';
import { randomStationName } from '../../state/stationNames';
import { maybeSnapToGrid } from '../../geometry/snap';
import type { ViewportApi } from './useViewport';

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
  const addStation = useDoc((s) => s.addStation);
  const addRouteBullet = useDoc((s) => s.addRouteBullet);
  const addTextLabel = useDoc((s) => s.addTextLabel);
  const addPolygon = useDoc((s) => s.addPolygon);
  const lineOrder = useDoc((s) => s.lineOrder);
  const lines = useDoc((s) => s.lines);
  const snapModes = useSnapPrefs((s) => s.modes);

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
    if (mode.kind === 'placing-station') {
      const w = maybeSnapToGrid(view.screenToWorld(e.clientX, e.clientY), snapModes);
      addStation(w.x, w.y, previewName ?? undefined);
      setPreviewName(randomStationName());
      // Stay in place-station mode; user clicks again or hits Esc / the
      // toolbar button to exit. Don't auto-select the new station — that
      // would close the placing-mode banner via the inspector swap.
      return true;
    }
    if (mode.kind === 'creating-route-bullet') {
      const w = view.screenToWorld(e.clientX, e.clientY);
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
      const w = view.screenToWorld(e.clientX, e.clientY);
      const id = addTextLabel(w.x, w.y);
      setUiMode({ kind: 'idle' });
      selectLabel(id);
      return true;
    }
    if (mode.kind === 'creating-polygon') {
      // Single-shot like labels: drop a default square, exit placing mode, and
      // select it so the popover + vertex handles appear for immediate editing.
      const w = view.screenToWorld(e.clientX, e.clientY);
      const id = addPolygon(w.x, w.y);
      setUiMode({ kind: 'idle' });
      selectPolygon(id);
      return true;
    }
    return false;
  };

  return { handleCanvasPlace, previewName };
}
