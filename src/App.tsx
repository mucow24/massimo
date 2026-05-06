import { useEffect } from 'react';
import { Toolbar } from './components/Toolbar';
import { Sidebar } from './components/Sidebar';
import { MapCanvas } from './components/MapCanvas';
import { useDoc, useSelection } from './state/store';

export default function App() {
  const setAppending = useSelection((s) => s.setAppending);
  const setPlacingStation = useSelection((s) => s.setPlacingStation);
  const setCreatingLineTag = useSelection((s) => s.setCreatingLineTag);
  const setCreatingRouteBullet = useSelection((s) => s.setCreatingRouteBullet);
  const selectLineTag = useSelection((s) => s.selectLineTag);
  const selectRouteBullet = useSelection((s) => s.selectRouteBullet);
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
        setAppending(null);
        setPlacingStation(false);
        setCreatingLineTag(false);
        setCreatingRouteBullet(false);
        selectLineTag(null);
        selectRouteBullet(null);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !inForm) {
        const sel = useSelection.getState();
        const bulletId = sel.selectedRouteBulletId;
        if (bulletId) {
          e.preventDefault();
          sel.selectRouteBullet(null);
          useDoc.getState().deleteRouteBullet(bulletId);
          return;
        }
        const tagId = sel.selectedLineTagId;
        if (tagId) {
          e.preventDefault();
          sel.selectLineTag(null);
          useDoc.getState().deleteLineTag(tagId);
          return;
        }
        const stationId = sel.selectedStationId;
        if (stationId) {
          e.preventDefault();
          // Clear selection first so the inspector doesn't briefly show a
          // dangling reference, then delete.
          sel.selectStation(null);
          useDoc.getState().deleteStation(stationId);
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
    setAppending,
    setPlacingStation,
    setCreatingLineTag,
    setCreatingRouteBullet,
    selectLineTag,
    selectRouteBullet,
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
        sel.creatingRouteBullet
      ) {
        e.preventDefault();
        e.stopPropagation();
        sel.setPlacingStation(false);
        sel.setCreatingLineTag(false);
        sel.setAppending(null);
        sel.setCreatingRouteBullet(false);
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
