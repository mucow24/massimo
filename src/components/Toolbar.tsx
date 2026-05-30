import { useRef, useState } from 'react';
import { useDoc, useSelection, type UiMode } from '../state/store';
import { useViewportStore } from '../state/viewportStore';
import { parse, serialize } from '../model/serialize';
import { DEFAULT_DOC } from '../model/transforms';
import { Menu, MenuItem, MenuSeparator } from './Menu';
import { CursorArrowIcon, FrameIcon, HandIcon, LayersIcon } from '@radix-ui/react-icons';
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
  const gridVisible = useViewportStore((s) => s.gridVisible);
  const setGridVisible = useViewportStore((s) => s.setGridVisible);
  const clearAll = useDoc((s) => s.clearAll);
  const addLine = useDoc((s) => s.addLine);
  const selection = useSelection();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Each "Add X" menu item toggles the matching uiMode variant: clicking it
  // again (or while the variant is active) returns to idle.
  const toggleMode = (
    kind: Exclude<UiMode['kind'], 'idle' | 'appending-to-line' | 'creating-transfer'>,
  ) => {
    selection.setUiMode(selection.uiMode.kind === kind ? { kind: 'idle' } : { kind });
  };
  const onAddStation = () => toggleMode('placing-station');
  const onAddLineTag = () => toggleMode('creating-line-tag');
  const onAddRouteBullet = () => toggleMode('creating-route-bullet');
  const onAddTransfer = () => {
    selection.setUiMode(
      selection.uiMode.kind === 'creating-transfer'
        ? { kind: 'idle' }
        : { kind: 'creating-transfer', anchor: null },
    );
  };
  const onAddLabel = () => toggleMode('placing-label');
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
    selection.selectLabel(null);
    selection.setUiMode({ kind: 'idle' });
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
      textLabels: doc.textLabels,
      labelFontSize: doc.labelFontSize,
      labelWeight: doc.labelWeight,
      labelItalic: doc.labelItalic,
      activePalettes: doc.activePalettes,
      transferThickness: doc.transferThickness,
      transferColor: doc.transferColor,
      transferStrokeWidth: doc.transferStrokeWidth,
      transferStrokeColor: doc.transferStrokeColor,
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
    selection.setUiMode({ kind: 'idle' });
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
        <MenuItem onClick={onAddLabel}>Label</MenuItem>
      </Menu>
      <ToolButtons />
      <span className="tool-group-divider" aria-hidden="true" />
      <SnapToggleBar />
      <span className="tool-group-divider" aria-hidden="true" />
      <div className="tool-group">
        <OptionsPopover />
        <button
          type="button"
          className={'tool-btn' + (gridVisible ? ' active' : '')}
          title={gridVisible ? 'Hide grid' : 'Show grid'}
          aria-label="Toggle grid"
          aria-pressed={gridVisible}
          onClick={() => setGridVisible(!gridVisible)}
        >
          <FrameIcon />
        </button>
        <button
          type="button"
          className={'tool-btn' + (selection.uiMode.kind === 'layering' ? ' active' : '')}
          title={
            selection.uiMode.kind === 'layering'
              ? 'Exit layering mode (Esc)'
              : 'Layering mode: click segments to cycle layer (shift to decrement)'
          }
          aria-label="Toggle layering mode"
          aria-pressed={selection.uiMode.kind === 'layering'}
          onClick={() =>
            selection.setUiMode(
              selection.uiMode.kind === 'layering' ? { kind: 'idle' } : { kind: 'layering' },
            )
          }
        >
          <LayersIcon />
        </button>
      </div>
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
