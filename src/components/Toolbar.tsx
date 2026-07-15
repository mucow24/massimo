import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { pickDocSnapshot, useDoc, useSelection, type UiMode } from '../state/store';
import type { MapDoc } from '../model/types';
import { useViewportStore, nextGridSize } from '../state/viewportStore';
import { parse, serialize } from '../model/serialize';
import { DEFAULT_DOC } from '../model/transforms';
import { computeContentBounds } from '../geometry/contentBounds';
import { fitViewport } from './canvas/viewportMath';
import { clearHistory } from '../state/history';
import { parseSvgIntrinsicSize, rasterFileToImage, svgTextToDataUri } from '../model/svgImport';
import { useCustomPalettes } from '../state/customPalettes';
import { themeColors } from '../state/theme';
import {
  captureThumbnail,
  downloadBlob,
  exportCanvasPng,
  exportCanvasSvg,
  getCanvasSvg,
  mapFileBasename,
} from '../export/exportCanvas';
import {
  getCurrentMapId,
  getPayload,
  newMapId,
  saveRevision,
  setCurrentMapId,
} from '../state/mapLibrary';
import { MapLibraryDialog } from './MapLibraryDialog';
import { Menu, MenuItem, MenuSeparator, SubMenu } from './Menu';
import {
  CheckCircledIcon,
  CursorArrowIcon,
  DoubleArrowLeftIcon,
  DoubleArrowRightIcon,
  ExclamationTriangleIcon,
  EyeNoneIcon,
  EyeOpenIcon,
  FrameIcon,
  HandIcon,
  LayersIcon,
  MoonIcon,
  SunIcon,
} from '@radix-ui/react-icons';
import { SnapToggleBar } from './SnapToggleBar';
import { OptionsPopover } from './OptionsPopover';
import { HelpPopover } from './HelpPopover';
import { MapNameField } from './MapNameField';

/**
 * The empty document, serialized. Byte-comparing against this IS the auto-save's
 * content gate: exact, and covering every DOC_FIELDS entry by construction — a
 * new doc field is gated the day it is added, with no edit here.
 *
 * Deliberately NOT `computeContentBounds` — that is a camera hull which reads
 * five of those fields and omits lines on purpose, so a map whose work lives
 * entirely in its lines reads as "empty", the auto-save writes nothing, and New
 * wipes it for good. One concept, not two.
 */
const EMPTY_DOC_JSON = serialize(pickDocSnapshot(DEFAULT_DOC));

/** A dismissible message in the toolbar: a failure, or a confirmation. */
type MenuStatus = { kind: 'error' | 'info'; text: string };

const errorText = (err: unknown, fallback: string): string =>
  err instanceof Error ? err.message : fallback;

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
  const darkMode = useDoc((s) => s.darkMode);
  const setDarkMode = useDoc((s) => s.setDarkMode);
  const showWaypoints = useViewportStore((s) => s.showWaypoints);
  const setShowWaypoints = useViewportStore((s) => s.setShowWaypoints);
  const showNetwork = useViewportStore((s) => s.showNetwork);
  const setShowNetwork = useViewportStore((s) => s.setShowNetwork);
  const clearAll = useDoc((s) => s.clearAll);
  const addLine = useDoc((s) => s.addLine);
  const selection = useSelection();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const [menuStatus, setMenuStatus] = useState<MenuStatus | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  /**
   * The bytes we last wrote to the library or adopted from one. The auto-save
   * skips when the doc still matches it — so browsing files deposits nothing,
   * and an unedited document is never copied.
   *
   * This is NOT a dirty flag. A flag answers "did anything touch the doc", which
   * is the wrong question (edit-then-undo), and a flag that resets on refresh
   * reads CLEAN — losing data. A null baseline reads dirty, which errs toward
   * one redundant revision instead of toward silence.
   */
  const baselineRef = useRef<string | null>(null);

  // Each "Add X" menu item toggles the matching uiMode variant: clicking it
  // again (or while the variant is active) returns to idle.
  const toggleMode = (
    kind: Exclude<
      UiMode['kind'],
      // placing-svg and editing-station-layout carry payloads, so they can't
      // be toggled into via a bare `{ kind }` — they're entered by the
      // file-import handler / the inspector's Edit-layout button instead.
      'idle' | 'appending-to-line' | 'creating-transfer' | 'placing-svg' | 'editing-station-layout'
    >,
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
    selection.startAppend(id);
  };
  // Point the camera at a doc's content: center it and zoom to fit, using the
  // live SVG's pixel size (content-independent, so no wait for a render).
  // Returns false — camera untouched — when the map is empty or the canvas
  // isn't mounted. Shared by file-load and Reset view.
  const fitCameraToDoc = (doc: MapDoc): boolean => {
    const bounds = computeContentBounds(doc);
    const svg = getCanvasSvg();
    if (!bounds || !svg) return false;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    setViewport(fitViewport(bounds, { w: rect.width, h: rect.height }));
    return true;
  };
  // Reset view = the same center+fit a fresh load gives; an empty map (or a
  // canvas that isn't mounted yet) falls back to the origin at 100%.
  const onResetView = () => {
    if (!fitCameraToDoc(useDoc.getState())) setViewport({ x: 0, y: 0, zoom: 1 });
  };
  const onClear = () => {
    selection.selectStation(null);
    selection.selectLine(null);
    selection.selectLineTag(null);
    selection.selectRouteBullet(null);
    selection.selectTransfer(null);
    selection.setUiMode({ kind: 'idle' });
    selection.setEditingStationId(null);
    // No clearHistory and no auto-save: Clear stays in the SAME document, so
    // Ctrl+Z is the backstop and undo has nothing to splice across.
    clearAll();
  };

  /**
   * Replace the live document. Shared by every path that swaps one doc for
   * another — file load, library load, New — so none of them can drift.
   */
  const adoptParsedDoc = (doc: MapDoc) => {
    selection.selectStation(null);
    selection.selectLine(null);
    selection.selectLineTag(null);
    selection.selectRouteBullet(null);
    selection.selectTransfer(null);
    selection.setUiMode({ kind: 'idle' });
    selection.setEditingStationId(null);
    useDoc.getState().loadDoc(doc);
    clearHistory(); // undo must not splice two different documents
    // The camera lives outside the doc (saved files are camera-agnostic), so a
    // switch would otherwise keep the old pan/zoom and could land on a blank
    // area. Falls back to the origin whenever the fit declines — empty content,
    // canvas unmounted, or a zero-size rect.
    if (!fitCameraToDoc(doc)) setViewport({ x: 0, y: 0, zoom: 1 });
    baselineRef.current = serialize(pickDocSnapshot(doc));
  };

  /**
   * Write an 'auto' revision of the live doc before something replaces it.
   * No-op when there is nothing to lose, or nothing has changed since the last
   * save or load.
   *
   * THROWS on a storage failure — every caller MUST abort its switch, or it
   * wipes a document it only thinks it saved.
   */
  const autoSaveCurrent = async (): Promise<void> => {
    const doc = useDoc.getState();
    const json = serialize(pickDocSnapshot(doc));
    if (json === EMPTY_DOC_JSON) return; // nothing to lose
    if (json === baselineRef.current) return; // already in the library, verbatim
    const thumb = await tryCaptureThumbnail();
    const id = getCurrentMapId() ?? newMapId();
    await saveRevision(id, doc.name, json, 'auto', thumb);
    baselineRef.current = json;
  };

  /**
   * A detached snapshot of the canvas as the export should see it: the finished
   * map, free of whatever transient view state the user happens to be working
   * in. Two such states would otherwise bake into the image — a selected line
   * desaturates every other line, and the lines/stations toggle takes the whole
   * network off the canvas. Neither is a decision about the map's content, so
   * neither belongs in the file.
   *
   * Apply, clone, revert — all inside ONE synchronous task. flushSync commits
   * each repaint to the DOM immediately, but the browser gets no frame in
   * between, so nothing the user set is ever visibly disturbed. That's the
   * whole point of snapshotting rather than holding the LIVE canvas in the
   * export state across `fn`: everything downstream (font embedding, PNG
   * rasterization, PDF generation) is async and can run for seconds, which
   * would flash a hidden network back on and drop the line highlight for the
   * duration.
   */
  const captureExportSnapshot = (svg: SVGSVGElement): SVGSVGElement => {
    const prevLineId = useSelection.getState().selectedLineId;
    // Clearing selectedLineId trips the sidebar's auto-reveal collapse (it keys
    // off exactly that), so the flag is saved and restored with the reselection.
    const prevAutoReveal = useSelection.getState().sidebarAutoRevealed;
    const prevShowNetwork = useViewportStore.getState().showNetwork;
    flushSync(() => {
      if (prevLineId) {
        useSelection.setState({ sidebarAutoRevealed: false });
        useSelection.getState().selectLine(null);
      }
      if (!prevShowNetwork) useViewportStore.getState().setShowNetwork(true);
    });
    try {
      return svg.cloneNode(true) as SVGSVGElement;
    } finally {
      flushSync(() => {
        if (prevLineId) {
          useSelection.getState().selectLine(prevLineId);
          useSelection.setState({ sidebarAutoRevealed: prevAutoReveal });
        }
        if (!prevShowNetwork) useViewportStore.getState().setShowNetwork(false);
      });
    }
  };

  /**
   * A thumbnail of the map as the export sees it, or undefined if one can't be
   * had. Shares captureExportSnapshot with the image exports, so a save made
   * with a line selected or the network hidden still pictures the finished map
   * rather than the view someone happened to be working in.
   *
   * An empty canvas throws (buildExportSvg has nothing to frame), as does any
   * rasterization failure. Neither should cost the user their save.
   */
  const tryCaptureThumbnail = async (): Promise<string | undefined> => {
    const svg = getCanvasSvg();
    if (!svg) return undefined;
    try {
      return await captureThumbnail(
        captureExportSnapshot(svg),
        themeColors(useDoc.getState().darkMode).canvasBg,
      );
    } catch {
      return undefined;
    }
  };

  // A downloaded file, which is what Export means here — saving now writes a
  // revision to the library instead.
  const onExportJson = () => {
    // Serialize the canonical doc slice (DOC_FIELDS) so the file never drifts
    // from the model when a field is added.
    const json = serialize(pickDocSnapshot(useDoc.getState()));
    const blob = new Blob([json], { type: 'application/json' });
    downloadBlob(blob, `${mapFileBasename(useDoc.getState().name)}.massimo.json`);
  };

  const onSaveToLibrary = async () => {
    const doc = useDoc.getState();
    const json = serialize(pickDocSnapshot(doc));
    try {
      const thumb = await tryCaptureThumbnail();
      // An explicit save is never deduped: asking for a checkpoint and getting
      // silence would be its own bug.
      const id = getCurrentMapId() ?? newMapId();
      await saveRevision(id, doc.name, json, 'user', thumb);
      setCurrentMapId(id);
      baselineRef.current = json;
      setMenuStatus({ kind: 'info', text: `Saved to library as “${doc.name}”` });
    } catch (err) {
      setMenuStatus({ kind: 'error', text: errorText(err, 'Could not save to the library.') });
    }
  };

  /** New = a different document, which is exactly when clearing undo is right. */
  const onNew = async () => {
    try {
      await autoSaveCurrent();
    } catch (err) {
      // The auto-save IS the backstop for a non-undoable wipe. If it failed,
      // there is nothing to fall back to — so don't wipe.
      setMenuStatus({ kind: 'error', text: errorText(err, 'Could not save to the library.') });
      return;
    }
    setMenuStatus(null);
    adoptParsedDoc(DEFAULT_DOC);
    setCurrentMapId(newMapId());
  };

  const onOpenLibrary = () => setLibraryOpen(true);

  /** Load a revision's payload over the live doc. Throws for the dialog to show. */
  const onOpenRevision = async (mapId: string, revisionId: number) => {
    await autoSaveCurrent();
    const json = await getPayload(revisionId);
    if (json === undefined) throw new Error('That revision is no longer in the library.');
    const result = parse(json, useCustomPalettes.getState().palettes);
    if (!result.ok) throw new Error(result.error);
    adoptParsedDoc(result.doc);
    setCurrentMapId(mapId);
    setLibraryOpen(false);
  };

  // Export the rendered map as an image. All three share the canvas snapshot,
  // the active theme's background, and the name-stamped basename; failures
  // surface in the toolbar alert.
  const runExport = async (
    fn: (svg: SVGSVGElement, bg: string, basename: string) => Promise<void>,
  ) => {
    const svg = getCanvasSvg();
    if (!svg) {
      setMenuStatus({ kind: 'error', text: 'Canvas not ready to export yet.' });
      return;
    }
    try {
      setMenuStatus(null);
      await fn(
        captureExportSnapshot(svg),
        themeColors(useDoc.getState().darkMode).canvasBg,
        mapFileBasename(useDoc.getState().name),
      );
    } catch (err) {
      setMenuStatus({ kind: 'error', text: errorText(err, 'Export failed.') });
    }
  };
  const onExportPng = () => void runExport(exportCanvasPng);
  const onExportSvg = () => void runExport(exportCanvasSvg);
  // Lazy-loaded: jsPDF + svg2pdf are heavy and only needed on PDF export, so
  // they stay out of the initial bundle (PNG/SVG don't pull them in).
  const onExportPdf = () =>
    void runExport(async (svg, bg, basename) => {
      const { exportCanvasPdf } = await import('../export/exportCanvasPdf');
      await exportCanvasPdf(svg, bg, basename);
    });

  const onLoadClick = () => fileInputRef.current?.click();

  const onFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!f) return;
    const text = await f.text();
    // Custom palettes (localStorage) let a loaded map keep its custom active ids
    // instead of dropping them as unknown.
    const result = parse(text, useCustomPalettes.getState().palettes);
    if (!result.ok) {
      setMenuStatus({ kind: 'error', text: result.error });
      return;
    }
    // After the parse, so a cancelled picker or an unreadable file writes
    // nothing; before the adopt, so a storage failure costs the load, not the
    // document.
    try {
      await autoSaveCurrent();
    } catch (err) {
      setMenuStatus({
        kind: 'error',
        text: errorText(err, 'Could not save the current map to the library.'),
      });
      return;
    }
    setMenuStatus(null);
    adoptParsedDoc(result.doc);
    // A file is not a library map: saving it makes a NEW one, the same way
    // re-uploading a downloaded doc gives you a new doc.
    setCurrentMapId(null);
  };

  // Add → Image…: read the file (svg text, or png/jpeg bytes), take its
  // intrinsic size, encode it as an opaque data URI, and enter placing-svg
  // mode so the next canvas click drops it. A raster that fails to decode is
  // skipped (it would render as nothing); a malformed svg keeps the existing
  // 200×200 fallback.
  const onAddImage = () => imageInputRef.current?.click();
  const onImageChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!f) return;
    let image: { href: string; width: number; height: number } | null;
    if (f.type === 'image/svg+xml' || /\.svg$/i.test(f.name)) {
      const text = await f.text();
      image = { href: svgTextToDataUri(text), ...parseSvgIntrinsicSize(text) };
    } else {
      image = await rasterFileToImage(f);
    }
    if (!image) return;
    selection.setUiMode({ kind: 'placing-svg', image });
  };

  return (
    <div className="toolbar">
      <strong>Massimo</strong>
      <span className="tool-group-divider" aria-hidden="true" />
      <MapNameField />
      <span className="tool-group-divider" aria-hidden="true" />
      <Menu label="Canvas">
        <MenuItem onClick={() => void onNew()}>New</MenuItem>
        <MenuSeparator />
        <MenuItem onClick={() => void onSaveToLibrary()}>Save revision</MenuItem>
        <SubMenu label="Load">
          <MenuItem onClick={onLoadClick}>JSON…</MenuItem>
          <MenuItem onClick={onOpenLibrary}>From library…</MenuItem>
        </SubMenu>
        <SubMenu label="Export">
          <MenuItem onClick={onExportPng}>PNG</MenuItem>
          <MenuItem onClick={onExportSvg}>SVG</MenuItem>
          <MenuItem onClick={onExportPdf}>PDF</MenuItem>
          <MenuItem onClick={onExportJson}>JSON</MenuItem>
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
        <MenuItem onClick={onAddImage}>Image / SVG…</MenuItem>
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
          title={`Grid: ${gridSize} world units — click for ${nextGridSize(gridSize)}`}
          aria-label="Cycle grid size"
          data-grid-size={gridSize}
          onClick={() => setGridSize(nextGridSize(gridSize))}
        >
          {gridSize}
        </button>
        <button
          type="button"
          className={'tool-btn' + (selection.uiMode.kind === 'layering' ? ' active' : '')}
          title={
            selection.uiMode.kind === 'layering'
              ? 'Exit layering mode (Esc)'
              : 'Layering mode: click overlaps to cycle which line shows on top'
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
        <button
          type="button"
          className={'tool-btn tool-btn-text' + (showWaypoints ? ' active' : '')}
          title={showWaypoints ? 'Hide waypoints' : 'Show waypoints'}
          aria-label="Toggle waypoints"
          aria-pressed={showWaypoints}
          onClick={() => setShowWaypoints(!showWaypoints)}
        >
          WP
        </button>
        <button
          type="button"
          className={'tool-btn' + (showNetwork ? ' active' : '')}
          title={
            showNetwork
              ? 'Hide lines & stations — work on the background beneath them'
              : 'Show lines & stations'
          }
          aria-label="Toggle lines and stations"
          aria-pressed={showNetwork}
          onClick={() => setShowNetwork(!showNetwork)}
        >
          {showNetwork ? <EyeOpenIcon /> : <EyeNoneIcon />}
        </button>
        <HelpPopover />
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.massimo,application/json"
        style={{ display: 'none' }}
        onChange={onFileChosen}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept=".svg,image/svg+xml,.png,image/png,.jpg,.jpeg,image/jpeg"
        aria-label="Import image file"
        style={{ display: 'none' }}
        onChange={onImageChosen}
      />
      <span className="spacer" />
      <label>
        Zoom
        <span style={{ width: 36 }}>{(zoom * 100).toFixed(0)}%</span>
      </label>
      <button onClick={onResetView}>Reset view</button>
      {menuStatus && (
        // One fixed role="alert" for both kinds. Not role="status": this span is
        // conditionally mounted, and inserting a polite live region with its text
        // already inside is the classic shape that never gets announced. alert is
        // special-cased to fire on insertion, so a success message spoken
        // assertively beats one not spoken at all. The CSS keys off the class.
        <span
          role="alert"
          className={menuStatus.kind === 'info' ? 'menu-status info' : 'menu-status'}
          onClick={() => setMenuStatus(null)}
          title="Click to dismiss"
        >
          {menuStatus.kind === 'info' ? (
            <CheckCircledIcon aria-hidden="true" />
          ) : (
            <ExclamationTriangleIcon aria-hidden="true" />
          )}{' '}
          {menuStatus.text}
        </span>
      )}
      <span className="tool-group-divider" aria-hidden="true" />
      <button
        type="button"
        className="tool-btn"
        title={selection.sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        aria-label="Toggle sidebar"
        aria-pressed={selection.sidebarOpen}
        onClick={() => selection.toggleSidebar()}
      >
        {selection.sidebarOpen ? <DoubleArrowRightIcon /> : <DoubleArrowLeftIcon />}
      </button>
      {libraryOpen && (
        <MapLibraryDialog onClose={() => setLibraryOpen(false)} onOpenRevision={onOpenRevision} />
      )}
    </div>
  );
}
