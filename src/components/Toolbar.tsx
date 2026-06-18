import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { pickDocSnapshot, useDoc, useSelection, type UiMode } from '../state/store';
import { useViewportStore } from '../state/viewportStore';
import { parse, serialize } from '../model/serialize';
import { DEFAULT_DOC } from '../model/transforms';
import { themeColors } from '../state/theme';
import {
  downloadBlob,
  exportCanvasPng,
  exportCanvasSvg,
  getCanvasSvg,
  mapFileBasename,
} from '../export/exportCanvas';
import { Menu, MenuItem, MenuSeparator, SubMenu } from './Menu';
import {
  CursorArrowIcon,
  FrameIcon,
  HandIcon,
  LayersIcon,
  MoonIcon,
  SunIcon,
} from '@radix-ui/react-icons';
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
  const gridSize = useViewportStore((s) => s.gridSize);
  const setGridSize = useViewportStore((s) => s.setGridSize);
  const darkMode = useViewportStore((s) => s.darkMode);
  const setDarkMode = useViewportStore((s) => s.setDarkMode);
  const clearAll = useDoc((s) => s.clearAll);
  const addLine = useDoc((s) => s.addLine);
  const selection = useSelection();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [menuError, setMenuError] = useState<string | null>(null);

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
  const onAddPolygon = () => toggleMode('creating-polygon');
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
    // Serialize the canonical doc slice (DOC_FIELDS) so the save never drifts
    // from the model when a field is added.
    const json = serialize(pickDocSnapshot(useDoc.getState()));
    const blob = new Blob([json], { type: 'application/json' });
    downloadBlob(blob, `${mapFileBasename()}.massimo.json`);
  };

  // Export the rendered map as an image. Both share the live canvas SVG and the
  // active theme's background; failures surface in the toolbar alert.
  const runExport = async (fn: (svg: SVGSVGElement, bg: string) => Promise<void>) => {
    const svg = getCanvasSvg();
    if (!svg) {
      setMenuError('Canvas not ready to export yet.');
      return;
    }
    // A selected line desaturates the others on the live canvas; that recoloring
    // would bake into the clone. Drop the line selection for the capture and
    // restore it afterward so the export shows the finished map in full color
    // regardless of what's selected. flushSync commits the repaint to the DOM
    // synchronously, so the clone we read is guaranteed clean — no frame-timing
    // race.
    const prevLineId = useSelection.getState().selectedLineId;
    try {
      setMenuError(null);
      if (prevLineId) flushSync(() => useSelection.getState().selectLine(null));
      await fn(svg, themeColors(darkMode).canvasBg);
    } catch (err) {
      setMenuError(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      if (prevLineId) flushSync(() => useSelection.getState().selectLine(prevLineId));
    }
  };
  const onExportPng = () => void runExport(exportCanvasPng);
  const onExportSvg = () => void runExport(exportCanvasSvg);

  const onLoadClick = () => fileInputRef.current?.click();

  const onFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!f) return;
    const text = await f.text();
    const result = parse(text);
    if (!result.ok) {
      setMenuError(result.error);
      return;
    }
    setMenuError(null);
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
        <SubMenu label="Export">
          <MenuItem onClick={onExportPng}>PNG</MenuItem>
          <MenuItem onClick={onExportSvg}>SVG</MenuItem>
        </SubMenu>
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
        <MenuItem onClick={onAddPolygon}>Polygon</MenuItem>
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
          className="tool-btn tool-btn-text"
          title={`Grid: ${gridSize}px — click for ${gridSize === 10 ? 5 : 10}px`}
          aria-label="Toggle grid size"
          data-grid-size={gridSize}
          onClick={() => setGridSize(gridSize === 10 ? 5 : 10)}
        >
          {gridSize}
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
        <button
          type="button"
          className={'tool-btn' + (darkMode ? ' active' : '')}
          title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label="Toggle dark mode"
          aria-pressed={darkMode}
          onClick={() => setDarkMode(!darkMode)}
        >
          {darkMode ? <SunIcon /> : <MoonIcon />}
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
      {menuError && (
        <span
          role="alert"
          style={{ color: '#a22', marginLeft: 8 }}
          onClick={() => setMenuError(null)}
          title="Click to dismiss"
        >
          ⚠ {menuError}
        </span>
      )}
    </div>
  );
}
