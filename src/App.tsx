import { useEffect } from 'react';
import { Toolbar } from './components/Toolbar';
import { Sidebar } from './components/Sidebar';
import { MapCanvas } from './components/MapCanvas';
import { useSelection } from './state/store';

export default function App() {
  const setAppending = useSelection((s) => s.setAppending);
  const setPlacingStation = useSelection((s) => s.setPlacingStation);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAppending(null);
        setPlacingStation(false);
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
