import { useRef, useState } from 'react';
import { useDoc, useSelection } from '../state/store';
import { useViewportStore } from '../state/viewportStore';
import { parse, serialize } from '../model/serialize';
import { DEFAULT_DOC } from '../model/transforms';
import { useFieldHistory } from './useFieldHistory';
import { Menu, MenuItem, MenuSeparator } from './Menu';

export function Toolbar() {
  const curveRadius = useDoc((s) => s.curveRadius);
  const setCurveRadius = useDoc((s) => s.setCurveRadius);
  const zoom = useViewportStore((s) => s.zoom);
  const setViewport = useViewportStore((s) => s.setViewport);
  const clearAll = useDoc((s) => s.clearAll);
  const addLine = useDoc((s) => s.addLine);
  const selection = useSelection();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const curveField = useFieldHistory();

  const onAddStation = () => {
    selection.setPlacingStation(!selection.placingStation);
  };
  const onAddLineTag = () => {
    selection.setCreatingLineTag(!selection.creatingLineTag);
  };
  const onAddLine = () => {
    const id = addLine();
    selection.startAppendAt(id, -1);
  };
  const onResetView = () => setViewport({ x: 0, y: 0, zoom: 1 });
  const onClear = () => {
    selection.selectStation(null);
    selection.selectLine(null);
    selection.selectLineTag(null);
    selection.setAppending(null);
    selection.setPlacingStation(false);
    selection.setCreatingLineTag(false);
    selection.setEditingStationId(null);
    clearAll();
  };

  const onSave = () => {
    const doc = useDoc.getState();
    const json = serialize({
      stations: doc.stations,
      lines: doc.lines,
      lineOrder: doc.lineOrder,
      curveRadius: doc.curveRadius,
      lineCounter: doc.lineCounter,
      lineTags: doc.lineTags,
    });
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `map-${date}.massimo.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const onLoadClick = () => fileInputRef.current?.click();

  const onFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!f) return;
    const text = await f.text();
    const result = parse(text);
    if (!result.ok) {
      setLoadError(result.error);
      return;
    }
    setLoadError(null);
    selection.selectStation(null);
    selection.selectLine(null);
    selection.selectLineTag(null);
    selection.setAppending(null);
    selection.setPlacingStation(false);
    selection.setCreatingLineTag(false);
    selection.setEditingStationId(null);
    // Replace doc state, preserving the mutator method references via merge.
    useDoc.setState({ ...DEFAULT_DOC, ...result.doc });
    useDoc.temporal.getState().clear();
  };

  return (
    <div className="toolbar">
      <strong>Massimo</strong>
      <Menu label="Canvas">
        <MenuItem onClick={onSave}>Save</MenuItem>
        <MenuItem onClick={onLoadClick}>Load…</MenuItem>
        <MenuSeparator />
        <MenuItem onClick={onClear}>Clear</MenuItem>
      </Menu>
      <Menu label="Add">
        <MenuItem onClick={onAddStation}>Stations</MenuItem>
        <MenuItem onClick={onAddLine}>Line</MenuItem>
        <MenuItem onClick={onAddLineTag}>Line tags</MenuItem>
      </Menu>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.massimo,application/json"
        style={{ display: 'none' }}
        onChange={onFileChosen}
      />
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
          {...curveField}
        />
        <span style={{ width: 24 }}>{curveRadius}</span>
      </label>
      <label>
        Zoom
        <span style={{ width: 36 }}>{(zoom * 100).toFixed(0)}%</span>
      </label>
      <button onClick={onResetView}>Reset view</button>
      {loadError && (
        <span
          role="alert"
          style={{ color: '#a22', marginLeft: 8 }}
          onClick={() => setLoadError(null)}
          title="Click to dismiss"
        >
          ⚠ {loadError}
        </span>
      )}
    </div>
  );
}
