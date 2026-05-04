import { useDoc, useSelection } from '../state/store';

export function Toolbar() {
  const curveRadius = useDoc((s) => s.curveRadius);
  const setCurveRadius = useDoc((s) => s.setCurveRadius);
  const viewport = useDoc((s) => s.viewport);
  const setViewport = useDoc((s) => s.setViewport);
  const addLine = useDoc((s) => s.addLine);
  const clearAll = useDoc((s) => s.clearAll);
  const selection = useSelection();

  const onAddStation = () => {
    selection.setPlacingStation(!selection.placingStation);
  };
  const onAddLine = () => {
    const id = addLine();
    selection.startAppendAt(id, -1);
  };
  const onResetView = () => setViewport({ x: 0, y: 0, zoom: 1 });
  const onClear = () => {
    selection.selectStation(null);
    selection.selectLine(null);
    selection.setAppending(null);
    selection.setPlacingStation(false);
    selection.setEditingStationId(null);
    clearAll();
  };

  return (
    <div className="toolbar">
      <strong>Massimo</strong>
      <button
        onClick={onAddStation}
        style={
          selection.placingStation
            ? { background: '#1a4ea8', color: '#fff', borderColor: '#1a4ea8' }
            : undefined
        }
      >
        + Station
      </button>
      <button onClick={onAddLine}>+ Line</button>
      <button onClick={onClear} title="Clear the entire map and start fresh">
        Clear
      </button>
      <span className="spacer" />
      <label>
        Curve r
        <input
          type="range"
          min={4}
          max={80}
          step={1}
          value={curveRadius}
          onChange={(e) => setCurveRadius(Number(e.target.value))}
        />
        <span style={{ width: 24 }}>{curveRadius}</span>
      </label>
      <label>
        Zoom
        <span style={{ width: 36 }}>{(viewport.zoom * 100).toFixed(0)}%</span>
      </label>
      <button onClick={onResetView}>Reset view</button>
    </div>
  );
}
