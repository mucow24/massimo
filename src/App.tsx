import { useEffect } from 'react';
import { Toolbar } from './components/Toolbar';
import { Sidebar } from './components/Sidebar';
import { MapCanvas } from './components/MapCanvas';
import { useDoc, useSelection } from './state/store';

export default function App() {
  const setAppending = useSelection((s) => s.setAppending);
  const setPlacingStation = useSelection((s) => s.setPlacingStation);
  const setCreatingLineTag = useSelection((s) => s.setCreatingLineTag);
  const selectLineTag = useSelection((s) => s.selectLineTag);

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
        selectLineTag(null);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !inForm) {
        const sel = useSelection.getState();
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
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setAppending, setPlacingStation, setCreatingLineTag, selectLineTag]);

  return (
    <div className="app">
      <Toolbar />
      <MapCanvas />
      <Sidebar />
    </div>
  );
}
