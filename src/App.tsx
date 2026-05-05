import { useEffect } from 'react';
import { Toolbar } from './components/Toolbar';
import { Sidebar } from './components/Sidebar';
import { MapCanvas } from './components/MapCanvas';
import { useDoc, useSelection } from './state/store';

export default function App() {
  const setAppending = useSelection((s) => s.setAppending);
  const setPlacingStation = useSelection((s) => s.setPlacingStation);

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
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !inForm) {
        const sel = useSelection.getState();
        const stationId = sel.selectedStationId;
        if (stationId) {
          e.preventDefault();
          // Clear selection first so the inspector doesn't briefly show a
          // dangling reference, then delete.
          sel.selectStation(null);
          useDoc.getState().deleteStation(stationId);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setAppending, setPlacingStation]);

  return (
    <div className="app">
      <Toolbar />
      <MapCanvas />
      <Sidebar />
    </div>
  );
}
