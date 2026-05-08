import { useRef, useState } from 'react';
import { useDoc, useSelection } from '../state/store';
import { useViewportStore } from '../state/viewportStore';
import { parse, serialize } from '../model/serialize';
import { DEFAULT_DOC } from '../model/transforms';
import { Menu, MenuItem, MenuSeparator } from './Menu';
import { CursorArrowIcon, HandIcon } from '@radix-ui/react-icons';
import { SnapToggleBar } from './SnapToggleBar';
import { OptionsPopover } from './OptionsPopover';

function ToolButtons() {
  const toolMode = useSelection((s) => s.toolMode);
  const spaceHeld = useSelection((s) => s.spaceHeld);
  const setToolMode = useSelection((s) => s.setToolMode);
  const effective: 'arrow' | 'hand' = spaceHeld ? 'hand' : toolMode;
  return (
    <div className="tool-group">
      <button
        className={'tool-btn' + (effective === 'arrow' ? ' active' : '')}
        title="Arrow (A)"
        onClick={() => setToolMode('arrow')}
      >
        <CursorArrowIcon />
      </button>
      <button
        className={'tool-btn' + (effective === 'hand' ? ' active' : '')}
        title="Hand (H) — hold Space"
        onClick={() => setToolMode('hand')}
      >
        <HandIcon />
      </button>
    </div>
  );
}

export function Toolbar() {
  const zoom = useViewportStore((s) => s.zoom);
  const setViewport = useViewportStore((s) => s.setViewport);
  const clearAll = useDoc((s) => s.clearAll);
  const addLine = useDoc((s) => s.addLine);
  const selection = useSelection();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const onAddStation = () => {
    selection.setPlacingStation(!selection.placingStation);
  };
  const onAddLineTag = () => {
    selection.setCreatingLineTag(!selection.creatingLineTag);
  };
  const onAddRouteBullet = () => {
    selection.setCreatingRouteBullet(!selection.creatingRouteBullet);
  };
  const onAddTransfer = () => {
    selection.setCreatingTransfer(!selection.creatingTransfer);
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
    selection.selectRouteBullet(null);
    selection.selectTransfer(null);
    selection.setAppending(null);
    selection.setPlacingStation(false);
    selection.setCreatingLineTag(false);
    selection.setCreatingRouteBullet(false);
    selection.setCreatingTransfer(false);
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
      routeBullets: doc.routeBullets,
      transfers: doc.transfers,
      labelFontSize: doc.labelFontSize,
      labelBold: doc.labelBold,
      labelItalic: doc.labelItalic,
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
    selection.selectRouteBullet(null);
    selection.selectTransfer(null);
    selection.setAppending(null);
    selection.setPlacingStation(false);
    selection.setCreatingLineTag(false);
    selection.setCreatingRouteBullet(false);
    selection.setCreatingTransfer(false);
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
        <MenuItem onClick={onAddRouteBullet}>Route bullets</MenuItem>
        <MenuItem onClick={onAddTransfer}>Transfer</MenuItem>
      </Menu>
      <ToolButtons />
      <span className="tool-group-divider" aria-hidden="true" />
      <SnapToggleBar />
      <span className="tool-group-divider" aria-hidden="true" />
      <OptionsPopover />
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.massimo,application/json"
        style={{ display: 'none' }}
        onChange={onFileChosen}
      />
      <span className="spacer" />
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
