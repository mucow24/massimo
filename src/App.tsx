import { useEffect } from 'react';
import { Toolbar } from './components/Toolbar';
import { Sidebar } from './components/Sidebar';
import { MapCanvas } from './components/MapCanvas';
import { beginHistoryGroup, cancelAppendMode, useDoc, useSelection } from './state/store';
import { readClipboard, writeClipboard } from './model/clipboard';

export default function App() {
  const setPlacingStation = useSelection((s) => s.setPlacingStation);
  const setCreatingLineTag = useSelection((s) => s.setCreatingLineTag);
  const setCreatingRouteBullet = useSelection((s) => s.setCreatingRouteBullet);
  const setCreatingTransfer = useSelection((s) => s.setCreatingTransfer);
  const setPlacingLabel = useSelection((s) => s.setPlacingLabel);
  const selectLineTag = useSelection((s) => s.selectLineTag);
  const selectRouteBullet = useSelection((s) => s.selectRouteBullet);
  const selectTransfer = useSelection((s) => s.selectTransfer);
  const selectLabel = useSelection((s) => s.selectLabel);
  const setToolMode = useSelection((s) => s.setToolMode);
  const setSpaceHeld = useSelection((s) => s.setSpaceHeld);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignore keystrokes in form fields so deleting text doesn't nuke
      // the station you're renaming.
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const inForm =
        tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable;

      if (e.key === 'Escape') {
        cancelAppendMode();
        setPlacingStation(false);
        setCreatingLineTag(false);
        setCreatingRouteBullet(false);
        setCreatingTransfer(false);
        setPlacingLabel(false);
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
        const temporal = useDoc.temporal.getState();
        if (e.shiftKey) temporal.redo();
        else temporal.undo();
        return;
      }
      if (mod && !inForm && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        useDoc.temporal.getState().redo();
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
        const bid = bullets[0];
        const b = useDoc.getState().routeBullets[bid];
        if (!b) return;
        const text = writeClipboard({
          kind: 'route-bullet',
          data: {
            x: b.x,
            y: b.y,
            rotation: b.rotation,
            lineId: b.lineId,
            shape: b.shape,
            size: b.size,
          },
        });
        navigator.clipboard?.writeText(text).catch(() => {});
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
            const d = payload.data;
            const newId = useDoc.getState().addRouteBulletWith({
              x: d.x + 15,
              y: d.y + 15,
              rotation: d.rotation,
              lineId: d.lineId,
              shape: d.shape,
              size: d.size,
            });
            useSelection.getState().selectRouteBullet(newId);
          })
          .catch(() => {});
        return;
      }
      if (mod && !inForm && (e.key === 'd' || e.key === 'D')) {
        const sel = useSelection.getState();
        const bullets = sel.selectedRouteBulletIds;
        if (bullets.length !== 1 || sel.selectedStationIds.length > 0) return;
        const bid = bullets[0];
        const b = useDoc.getState().routeBullets[bid];
        if (!b) return;
        e.preventDefault();
        const newId = useDoc.getState().addRouteBulletWith({
          x: b.x + 15,
          y: b.y + 15,
          rotation: b.rotation,
          lineId: b.lineId,
          shape: b.shape,
          size: b.size,
        });
        useSelection.getState().selectRouteBullet(newId);
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
    setPlacingStation,
    setCreatingLineTag,
    setCreatingRouteBullet,
    setCreatingTransfer,
    setPlacingLabel,
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
      if (
        sel.placingStation ||
        sel.creatingLineTag ||
        sel.appendingToLineId ||
        sel.creatingRouteBullet ||
        sel.creatingTransfer ||
        sel.placingLabel
      ) {
        e.preventDefault();
        e.stopPropagation();
        sel.setPlacingStation(false);
        sel.setCreatingLineTag(false);
        cancelAppendMode();
        sel.setCreatingRouteBullet(false);
        sel.setCreatingTransfer(false);
        sel.setPlacingLabel(false);
      }
    };
    document.addEventListener('contextmenu', onContextMenu, true);
    return () => document.removeEventListener('contextmenu', onContextMenu, true);
  }, []);

  return (
    <div className="app">
      <Toolbar />
      <MapCanvas />
      <Sidebar />
    </div>
  );
}
