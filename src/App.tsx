import { useEffect, useState } from 'react';
import { Toolbar } from './components/Toolbar';
import { Sidebar } from './components/Sidebar';
import { MapCanvas } from './components/MapCanvas';
import {
  beginHistoryGroup,
  cancelAppendMode,
  RIGHT_CLICK_PASSTHROUGH_MODES,
  useDoc,
  useSelection,
} from './state/store';
import {
  readClipboard,
  routeBulletPayload,
  textLabelPayload,
  polygonPayload,
  writeClipboard,
  type ClipPayload,
} from './model/clipboard';
import { _clearTextMeasureCache } from './geometry/textMeasure';
import { useViewportStore } from './state/viewportStore';
import { redo, undo } from './state/history';

export default function App() {
  const darkMode = useViewportStore((s) => s.darkMode);
  // Force a re-measure + re-render once the web fonts finish loading. Label
  // geometry is measured against the canvas and cached by text+style; the very
  // first paint runs before Helvetica Neue is ready, so those measurements use
  // the fallback font (whose side bearings differ by a pixel or two) and get
  // cached. Without invalidation the labels stay a hair off until the next edit
  // re-measures them — which looked like a line "shifting" when you edited a
  // sibling line. Dropping the stale cache and bumping this counter on font
  // load lets every label settle at its real metrics up front.
  const [, setFontEpoch] = useState(0);
  useEffect(() => {
    const fonts = document.fonts;
    if (!fonts) return;
    let cancelled = false;
    const refresh = () => {
      if (cancelled) return;
      _clearTextMeasureCache();
      setFontEpoch((e) => e + 1);
    };
    // `ready` covers the fonts in use at first paint; `loadingdone` covers
    // weights that load later (e.g. switching a label to a weight not yet
    // fetched), so those re-measure too.
    fonts.ready.then(refresh);
    fonts.addEventListener('loadingdone', refresh);
    return () => {
      cancelled = true;
      fonts.removeEventListener('loadingdone', refresh);
    };
  }, []);
  const setUiMode = useSelection((s) => s.setUiMode);
  const selectLineTag = useSelection((s) => s.selectLineTag);
  const selectRouteBullet = useSelection((s) => s.selectRouteBullet);
  const selectTransfer = useSelection((s) => s.selectTransfer);
  const selectLabel = useSelection((s) => s.selectLabel);
  const setToolMode = useSelection((s) => s.setToolMode);
  const setSpaceHeld = useSelection((s) => s.setSpaceHeld);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignore keystrokes in form fields so deleting text doesn't nuke
      // the station you're renaming. Range sliders and color pickers have
      // no native keystroke behavior to preserve, so they fall through to
      // global shortcuts — otherwise Ctrl+Z is swallowed mid-slider-drag.
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const inputType = tag === 'INPUT' ? (target as HTMLInputElement).type : '';
      const inForm =
        (tag === 'INPUT' && inputType !== 'range' && inputType !== 'color') ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        target?.isContentEditable;

      if (e.key === 'Escape') {
        // cancelAppendMode runs first so a freshly-created empty line gets
        // garbage-collected before setUiMode flips the variant.
        cancelAppendMode();
        setUiMode({ kind: 'idle' });
        selectLineTag(null);
        selectRouteBullet(null);
        selectTransfer(null);
        selectLabel(null);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !inForm) {
        const sel = useSelection.getState();
        // A selected polygon vertex takes top priority: remove just that vertex
        // (the transform no-ops at the 3-vertex floor) and keep the polygon
        // selected so the user can keep editing.
        if (sel.selectedVertex) {
          const { polygonId, index } = sel.selectedVertex;
          // Locked polygons can't be edited; ignore the vertex delete.
          if (!useDoc.getState().polygons[polygonId]?.locked) {
            e.preventDefault();
            sel.selectVertex(null);
            useDoc.getState().deleteVertex(polygonId, index);
            return;
          }
        }
        // Mixed station + bullet + label + polygon multi-selection takes
        // priority over the single-element delete paths below; one history
        // entry covers every removed item so a single Ctrl-Z reverts the lot.
        const stationIds = sel.selectedStationIds;
        const bulletIds = sel.selectedRouteBulletIds;
        const labelIds = sel.selectedLabelIds;
        // Locked polygons are protected from deletion.
        const polygonIds = sel.selectedPolygonIds.filter(
          (id) => !useDoc.getState().polygons[id]?.locked,
        );
        if (stationIds.length + bulletIds.length + labelIds.length + polygonIds.length > 0) {
          e.preventDefault();
          sel.selectStation(null);
          sel.selectRouteBullet(null);
          sel.selectLabel(null);
          sel.selectPolygon(null);
          const group = beginHistoryGroup();
          const doc = useDoc.getState();
          for (const id of stationIds) doc.deleteStation(id);
          for (const id of bulletIds) doc.deleteRouteBullet(id);
          for (const id of labelIds) doc.deleteTextLabel(id);
          for (const id of polygonIds) doc.deletePolygon(id);
          group.commit();
          return;
        }
        const transferId = sel.selectedTransferId;
        if (transferId) {
          e.preventDefault();
          sel.selectTransfer(null);
          useDoc.getState().deleteTransfer(transferId);
          return;
        }
        const tagId = sel.selectedLineTagId;
        if (tagId) {
          e.preventDefault();
          sel.selectLineTag(null);
          useDoc.getState().deleteLineTag(tagId);
          return;
        }
      }
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !inForm && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        // Blur first so any open useFieldHistory group (slider mid-drag,
        // etc.) commits its entry to the past stack — otherwise undo
        // would skip the in-progress edit and revert the action before it.
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && !inForm && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        redo();
        return;
      }
      // Copy / paste / duplicate for the current selection — any mix of route
      // bullets, text labels, and polygons. Stations (and other primaries) are
      // ignored. Stay out of form fields so native text-editing shortcuts keep
      // working; when nothing copyable is selected we fall through WITHOUT
      // preventDefault so native copy/paste still works.
      if (mod && !inForm && (e.key === 'c' || e.key === 'C')) {
        const sel = useSelection.getState();
        const doc = useDoc.getState();
        const items: ClipPayload[] = [];
        for (const id of sel.selectedRouteBulletIds) {
          const b = doc.routeBullets[id];
          if (b) items.push(routeBulletPayload(b));
        }
        for (const id of sel.selectedLabelIds) {
          const l = doc.textLabels[id];
          if (l) items.push(textLabelPayload(l));
        }
        for (const id of sel.selectedPolygonIds) {
          const p = doc.polygons[id];
          if (p) items.push(polygonPayload(p));
        }
        if (items.length === 0) return;
        navigator.clipboard?.writeText(writeClipboard(items)).catch(() => {});
        e.preventDefault();
        return;
      }
      if (mod && !inForm && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault();
        navigator.clipboard
          ?.readText()
          .then((text) => {
            const items = readClipboard(text);
            if (!items) return;
            const doc = useDoc.getState();
            const bullets: string[] = [];
            const labels: string[] = [];
            const polygons: string[] = [];
            const group = beginHistoryGroup();
            for (const item of items) {
              if (item.kind === 'route-bullet') bullets.push(doc.pasteRouteBullet(item.data));
              else if (item.kind === 'text-label') labels.push(doc.pasteTextLabel(item.data));
              else if (item.kind === 'polygon') polygons.push(doc.pastePolygon(item.data));
            }
            group.commit();
            useSelection.getState().setMixedSelection({ bullets, labels, polygons });
          })
          .catch(() => {});
        return;
      }
      if (mod && !inForm && (e.key === 'd' || e.key === 'D')) {
        const sel = useSelection.getState();
        const bulletIds = sel.selectedRouteBulletIds;
        const labelIds = sel.selectedLabelIds;
        const polygonIds = sel.selectedPolygonIds;
        if (bulletIds.length + labelIds.length + polygonIds.length === 0) return;
        e.preventDefault();
        const doc = useDoc.getState();
        const group = beginHistoryGroup();
        const bullets = bulletIds
          .map((id) => doc.duplicateRouteBullet(id))
          .filter((id): id is string => id != null);
        const labels = labelIds
          .map((id) => doc.duplicateTextLabel(id))
          .filter((id): id is string => id != null);
        const polygons = polygonIds
          .map((id) => doc.duplicatePolygon(id))
          .filter((id): id is string => id != null);
        group.commit();
        useSelection.getState().setMixedSelection({ bullets, labels, polygons });
        return;
      }
      if (!inForm && !mod && (e.key === 'a' || e.key === 'A')) {
        setToolMode('arrow');
        return;
      }
      if (!inForm && !mod && (e.key === 'h' || e.key === 'H')) {
        setToolMode('hand');
        return;
      }
      if (!inForm && !mod && (e.key === 'l' || e.key === 'L')) {
        const cur = useSelection.getState().uiMode;
        setUiMode(cur.kind === 'layering' ? { kind: 'idle' } : { kind: 'layering' });
        return;
      }
      if (!inForm && !mod && (e.key === 't' || e.key === 'T')) {
        const cur = useSelection.getState().uiMode;
        setUiMode(
          cur.kind === 'creating-transfer'
            ? { kind: 'idle' }
            : { kind: 'creating-transfer', anchor: null },
        );
        return;
      }
      if (!inForm && e.key === ' ' && !e.repeat) {
        e.preventDefault();
        setSpaceHeld(true);
        return;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') setSpaceHeld(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [
    setUiMode,
    selectLineTag,
    selectRouteBullet,
    selectTransfer,
    selectLabel,
    setToolMode,
    setSpaceHeld,
  ]);

  // Right-click anywhere cancels an active mode. Capture phase + stopPropagation
  // so we beat element-level context menus (station rotate, tag flip): they
  // shouldn't fire when the user is trying to back out of a mode.
  useEffect(() => {
    const onContextMenu = (e: globalThis.MouseEvent) => {
      const sel = useSelection.getState();
      // Modes in RIGHT_CLICK_PASSTHROUGH_MODES own the right-click gesture
      // (layering uses it to decrement a segment's layer); everything else
      // exits on right-click. The set lives next to UiMode in the store so
      // a new variant declares its right-click policy in one place.
      if (RIGHT_CLICK_PASSTHROUGH_MODES.has(sel.uiMode.kind)) return;
      e.preventDefault();
      e.stopPropagation();
      cancelAppendMode();
      sel.setUiMode({ kind: 'idle' });
    };
    document.addEventListener('contextmenu', onContextMenu, true);
    return () => document.removeEventListener('contextmenu', onContextMenu, true);
  }, []);

  return (
    <div className="app" data-theme={darkMode ? 'dark' : undefined}>
      <Toolbar />
      <MapCanvas />
      <Sidebar />
    </div>
  );
}
