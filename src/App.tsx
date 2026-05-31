import { useEffect } from 'react';
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
import { readClipboard, routeBulletPayload, writeClipboard } from './model/clipboard';
import { useViewportStore } from './state/viewportStore';
import { redo, undo } from './state/history';

export default function App() {
  const darkMode = useViewportStore((s) => s.darkMode);
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
        // Mixed station + bullet + label multi-selection takes priority over
        // the single-element delete paths below; one history entry covers
        // every removed item so a single Ctrl-Z reverts the lot.
        const stationIds = sel.selectedStationIds;
        const bulletIds = sel.selectedRouteBulletIds;
        const labelIds = sel.selectedLabelIds;
        if (stationIds.length + bulletIds.length + labelIds.length > 0) {
          e.preventDefault();
          sel.selectStation(null);
          sel.selectRouteBullet(null);
          sel.selectLabel(null);
          const group = beginHistoryGroup();
          const doc = useDoc.getState();
          for (const id of stationIds) doc.deleteStation(id);
          for (const id of bulletIds) doc.deleteRouteBullet(id);
          for (const id of labelIds) doc.deleteTextLabel(id);
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
      // Copy / paste / duplicate for a single selected route bullet (the
      // shortcut only fires when exactly one bullet is the current
      // selection, matching the existing single-bullet UX). Stay out of
      // form fields so native text-editing shortcuts keep working.
      if (mod && !inForm && (e.key === 'c' || e.key === 'C')) {
        const sel = useSelection.getState();
        const bullets = sel.selectedRouteBulletIds;
        if (bullets.length !== 1 || sel.selectedStationIds.length > 0) return;
        const b = useDoc.getState().routeBullets[bullets[0]];
        if (!b) return;
        navigator.clipboard?.writeText(writeClipboard(routeBulletPayload(b))).catch(() => {});
        e.preventDefault();
        return;
      }
      if (mod && !inForm && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault();
        navigator.clipboard
          ?.readText()
          .then((text) => {
            const payload = readClipboard(text);
            if (!payload || payload.kind !== 'route-bullet') return;
            const newId = useDoc.getState().pasteRouteBullet(payload.data);
            useSelection.getState().selectRouteBullet(newId);
          })
          .catch(() => {});
        return;
      }
      if (mod && !inForm && (e.key === 'd' || e.key === 'D')) {
        const sel = useSelection.getState();
        const bullets = sel.selectedRouteBulletIds;
        if (bullets.length !== 1 || sel.selectedStationIds.length > 0) return;
        e.preventDefault();
        const newId = useDoc.getState().duplicateRouteBullet(bullets[0]);
        if (newId) useSelection.getState().selectRouteBullet(newId);
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
