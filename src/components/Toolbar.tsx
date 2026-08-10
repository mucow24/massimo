import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  pickDocSnapshot,
  startNewLineAppend,
  useDoc,
  useSelection,
  type UiMode,
} from '../state/store';
import type { MapDoc } from '../model/types';
import { useViewportStore, nextGridSize } from '../state/viewportStore';
import { exportVisibilityOverrides } from '../state/visibility';
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
import { getPayload, newMapId, saveVersion, type VersionMeta } from '../state/mapLibrary';
import {
  EMPTY_DOC_JSON,
  markAdopted,
  markSaved,
  saveStatusOf,
  useCanRevert,
  useSaveBaseline,
  useSaveStatus,
} from '../state/saveBaseline';
import { useLibraryPointer } from '../state/libraryPointer';
import { MapLibraryDialog } from './MapLibraryDialog';
import { Menu, MenuCheckboxItem, MenuItem, MenuSeparator, SubMenu } from './Menu';
import {
  CursorArrowIcon,
  DoubleArrowLeftIcon,
  DoubleArrowRightIcon,
  FrameIcon,
  HandIcon,
  LayersIcon,
  MoonIcon,
  SunIcon,
} from '@radix-ui/react-icons';
import { SnapToggleBar } from './SnapToggleBar';
import { PaletteGlyph } from './PaletteGlyph';
import { PalettesDialog } from './PalettesDialog';
import { ViewPopover } from './ViewPopover';
import { HelpPopover } from './HelpPopover';
import { PerfPopover } from './PerfPopover';
import { MapNameField } from './MapNameField';
import { MapVersionPill } from './MapVersionPill';
import { pushToast } from '../state/toastStore';
import { auditExportDoc } from '../state/exportAudit';
import { BrandBullet } from './BrandBullet';
import { isFunModeActive, useFunMode } from '../state/funMode';

const errorText = (err: unknown, fallback: string): string =>
  err instanceof Error ? err.message : fallback;

/**
 * The wordmark badge, plus its one secret: alt-click knocks it loose and it
 * bounces around the window until you click the map (see funMode / BouncingBullet).
 * `data-away` empties the slot without collapsing it — the badge keeps its
 * layout box, so the bar doesn't shift left as the ball falls, and the opacity
 * transition crossfades it back in on the way out.
 */
function BrandBadge() {
  const phase = useFunMode((s) => s.phase);
  const enterFunMode = useFunMode((s) => s.enter);
  return (
    <BrandBullet
      data-away={phase === 'live' || undefined}
      // pointerdown, not click: it fires before the browser can start its own
      // alt-drag, and preventDefault keeps the badge from being dragged as an image.
      onPointerDown={(e) => {
        if (!e.altKey || e.button !== 0) return;
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        enterFunMode({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
      }}
    />
  );
}

function ToolButtons() {
  const toolMode = useSelection((s) => s.toolMode);
  const spaceHeld = useSelection((s) => s.spaceHeld);
  const setToolMode = useSelection((s) => s.setToolMode);
  const effective: 'arrow' | 'hand' = spaceHeld ? 'hand' : toolMode;
  return (
    <div className="tool-group">
      <button
        className={'tool-btn' + (effective === 'arrow' ? ' active' : '')}
        title="Arrow (V)"
        onClick={() => setToolMode('arrow')}
      >
        <CursorArrowIcon />
      </button>
      <button
        className={'tool-btn' + (effective === 'hand' ? ' active' : '')}
        title="Hand (hold Space, H to toggle)"
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
  const setDayCanvasColor = useViewportStore((s) => s.setDayCanvasColor);
  const darkUiInDay = useViewportStore((s) => s.darkUiInDay);
  const setDarkUiInDay = useViewportStore((s) => s.setDarkUiInDay);
  const clearAll = useDoc((s) => s.clearAll);
  const selection = useSelection();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [palettesOpen, setPalettesOpen] = useState(false);
  /**
   * The tri-state save signal (saveBaseline.ts). 'clean' greys out Save
   * version — the doc byte-for-byte matches a library version, so a save
   * could only mint a duplicate. 'dirty' and 'unsaved' both arm it: edits to
   * checkpoint, or clean bytes the library holds no copy of (a loaded file, a
   * fresh New) that a save imports.
   */
  const saveStatus = useSaveStatus();
  /**
   * Whether Revert has anything to discard — a baseline exists and the doc has
   * diverged from it. Distinct from `saveStatus`: a doc with no baseline reads
   * dirty (save-armed) yet has nothing to revert (saveBaseline.ts).
   */
  const canRevert = useCanRevert();

  // Each "Add X" menu item toggles the matching uiMode variant: clicking it
  // again (or while the variant is active) returns to idle.
  const toggleMode = (
    kind: Exclude<
      UiMode['kind'],
      // Modes that carry payloads can't be toggled into via a bare `{ kind }` —
      // they get dedicated handlers (transfer / line circle below; placing-svg
      // via the file-import handler; layout edit via the inspector's button).
      | 'idle'
      | 'appending-to-line'
      | 'creating-transfer'
      | 'placing-svg'
      | 'editing-station-layout'
      | 'placing-line-circle'
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
        : { kind: 'creating-transfer', firstEnd: null },
    );
  };
  const onAddLabel = () => toggleMode('placing-label');
  const onAddAnchor = () => toggleMode('placing-anchor');
  const onAddPolygon = () => toggleMode('creating-polygon');
  const onAddLineCircle = () => {
    // Carries the two-click payload, so it can't go through the bare-{kind}
    // toggle above (same shape as onAddTransfer).
    selection.setUiMode(
      selection.uiMode.kind === 'placing-line-circle'
        ? { kind: 'idle' }
        : { kind: 'placing-line-circle', center: null },
    );
  };
  // Creating the placeholder line and opening Edit Stops on it is one operation
  // owned by store.ts, which also collects the placeholder again — the ordering
  // its lineCounter rollback depends on belongs next to the GC, not here.
  const onAddLine = () => startNewLineAppend();
  // Point the camera at a doc's content: center it and zoom to fit, using the
  // live SVG's pixel size (content-independent, so no wait for a render).
  // Returns false — camera untouched — when the map is empty or the canvas
  // isn't mounted. Shared by file-load and Reset view.
  const fitCameraToDoc = (doc: MapDoc): boolean => {
    const bounds = computeContentBounds(doc);
    const svg = getCanvasSvg();
    if (!bounds || !svg) return false;
    // Fit to the VISIBLE canvas: the host box, not the svg — the svg is the
    // oversized pan surface (2× per axis; see panSurfaceViewBox). A detached
    // svg (tests) has no host and keeps its own rect.
    const rect = (svg.closest('.canvas-host') ?? svg).getBoundingClientRect();
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
    selection.clearAllSelections();
    selection.setUiMode({ kind: 'idle' });
    // No clearHistory and no auto-save: Clear stays in the SAME document, so
    // Ctrl+Z is the backstop and undo has nothing to splice across.
    clearAll();
  };

  /**
   * Revert — discard every unsaved change, restoring the document to the bytes
   * last saved to the library or loaded. Like Clear, it stays in the SAME
   * document: a normal undoable edit with no auto-save, so Ctrl+Z brings the
   * discarded work back. The save baseline is left untouched — after the load
   * the doc fields ARE the baseline's references again, so the status signal
   * reads clean on its own. The selection is reconciled against the restored
   * doc exactly as undo/redo do (keep what still exists, prune what doesn't).
   * Guarded on a real baseline (the menu item is disabled without one), so a
   * doc with no saved state to return to is a no-op rather than a wipe.
   */
  const onRevert = () => {
    const baseline = useSaveBaseline.getState().baselineSnap;
    if (!baseline) return;
    useDoc.getState().loadDoc(baseline);
    selection.reconcileWithDoc(useDoc.getState());
  };

  /**
   * Replace the live document. Shared by every path that swaps one doc for
   * another — file load, library load, New — so none of them can drift.
   *
   * `backed` says whether the incoming bytes exist as a library version
   * (opening one) or not (a JSON file, New) — the difference between the doc
   * starting out clean and starting out unsaved-but-armed.
   */
  const adoptParsedDoc = (doc: MapDoc, backed: boolean) => {
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
    // Anchor the baseline to the POST-load store state: those are the exact
    // references the reactive status signal will compare against.
    const snap = pickDocSnapshot(useDoc.getState());
    (backed ? markSaved : markAdopted)(serialize(snap), snap);
  };

  /**
   * Write an 'auto' version of the live doc before something replaces it.
   * No-op when there is nothing to lose, or nothing has changed since the last
   * save or load.
   *
   * Deliberately does NOT move the pointer. This runs while a document is on
   * its way out, and the caller sets the pointer to whatever is coming in; the
   * map written here keeps its history and stays reachable from the library
   * dialog, which is the whole job.
   *
   * THROWS on a storage failure — every caller MUST abort its switch, or it
   * wipes a document it only thinks it saved.
   */
  const autoSaveCurrent = async (): Promise<void> => {
    const doc = useDoc.getState();
    const snap = pickDocSnapshot(doc);
    const json = serialize(snap);
    if (json === EMPTY_DOC_JSON) return; // nothing to lose
    if (json === useSaveBaseline.getState().baselineJson) return; // already saved/loaded, verbatim
    auditExportDoc(snap); // bytes are leaving for the library — audit at the door
    const thumb = await tryCaptureThumbnail();
    const id = useLibraryPointer.getState().mapId ?? newMapId();
    await saveVersion(id, doc.name, json, 'auto', thumb);
    markSaved(json, snap);
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
    // Every View-menu layer that gates EXPORTED ink goes on for the capture: an
    // export renders the finished map, never the view someone happened to be
    // working in. Derived from the registry rather than written out per flag —
    // the hand-written version silently shipped a map missing whatever layer a
    // later toggle added (see state/visibility.ts).
    const visibility = exportVisibilityOverrides(useViewportStore.getState());
    // Layering mode fades labels, bullets and line tags to 25% to focus the
    // bands. That fade is an `opacity` on content groups, not chrome carrying
    // data-export-exclude, so it CLONES — every export and every library
    // thumbnail taken while the mode is up comes out quarter-strength. Drop it
    // for the capture like the selected-line dim.
    const prevUiMode = useSelection.getState().uiMode;
    const wasLayering = prevUiMode.kind === 'layering';
    flushSync(() => {
      // The gentle null-clear: drops the id (and thus the dim) without
      // touching uiMode, so an in-progress Edit Stops session survives the
      // capture. The restore is a bare setState for the same reason — the
      // selectLine ACTION would kick the mode back to idle.
      if (prevLineId) useSelection.getState().selectLine(null);
      if (wasLayering) useSelection.setState({ uiMode: { kind: 'idle' } });
      useViewportStore.setState(visibility.apply);
    });
    try {
      return svg.cloneNode(true) as SVGSVGElement;
    } finally {
      flushSync(() => {
        if (prevLineId) useSelection.setState({ selectedLineId: prevLineId });
        // Bare setState again: setUiMode would wipe the selection on the way
        // back in, so the user's layering session must be restored, not re-entered.
        if (wasLayering) useSelection.setState({ uiMode: prevUiMode });
        useViewportStore.setState(visibility.restore);
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

  // The export basename stamps the map's version and whether it's diverged from
  // it — "Foo map - v23" clean, "Foo map - v23d" dirty. A map with no library
  // version (fresh New, loaded JSON) falls back to a date stamp.
  const currentBasename = () =>
    mapFileBasename(
      useDoc.getState().name,
      useLibraryPointer.getState().version,
      saveStatusOf(useDoc.getState(), useSaveBaseline.getState()) !== 'clean',
    );

  // A downloaded file, which is what Export means here — saving now writes a
  // version to the library instead.
  const onExportJson = () => {
    // Serialize the canonical doc slice (DOC_FIELDS) so the file never drifts
    // from the model when a field is added.
    const snap = pickDocSnapshot(useDoc.getState());
    auditExportDoc(snap);
    const json = serialize(snap);
    const blob = new Blob([json], { type: 'application/json' });
    downloadBlob(blob, `${currentBasename()}.massimo.json`);
  };

  const onSaveToLibrary = async () => {
    // Gated by the menu item's disabled state, not a check here: when the doc
    // is clean this handler is simply unreachable. Snapshot and bytes are
    // captured together BEFORE the awaits, so an edit that lands while the
    // save is in flight is not vouched for — the doc stays dirty.
    const doc = useDoc.getState();
    const snap = pickDocSnapshot(doc);
    auditExportDoc(snap);
    const json = serialize(snap);
    try {
      const thumb = await tryCaptureThumbnail();
      const id = useLibraryPointer.getState().mapId ?? newMapId();
      const saved = await saveVersion(id, doc.name, json, 'user', thumb);
      useLibraryPointer.getState().setPointer(id, saved.version);
      markSaved(json, snap);
      pushToast('info', `Saved “${doc.name}” as v${saved.version}`);
    } catch (err) {
      pushToast('error', errorText(err, 'Could not save to the library.'));
    }
  };

  // Ctrl/Cmd+S is the keyboard accelerator for Canvas ▸ Save version. Always
  // preventDefault so the browser's Save-page dialog never opens, and it is a
  // library save — never the JSON export. Blur first so an in-progress rename
  // in the map-name field (which commits on blur) lands in the doc before it is
  // serialized, exactly as App's undo handler does; then honour the same
  // clean-state gate the menu item's disabled state enforces — a clean doc
  // already matches a library version, so a save could only mint a duplicate.
  // Lives here, beside the save action, rather than in App's global key
  // handler. A ref keeps the listener stable while
  // always calling the latest closure (refreshed in its own effect, never
  // written during render).
  const saveToLibraryRef = useRef(onSaveToLibrary);
  useEffect(() => {
    saveToLibraryRef.current = onSaveToLibrary;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Inert while the easter egg holds the window, like App's global handler:
      // the map is dimmed and unreachable, so saving a version of it behind the
      // scrim would be the one thing that could still surprise you.
      if (isFunModeActive()) return;
      if (!(e.metaKey || e.ctrlKey) || (e.key !== 's' && e.key !== 'S')) return;
      e.preventDefault();
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      if (saveStatusOf(useDoc.getState(), useSaveBaseline.getState()) === 'clean') return;
      void saveToLibraryRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** New = a different document, which is exactly when clearing undo is right. */
  const onNew = async () => {
    try {
      await autoSaveCurrent();
    } catch (err) {
      // The auto-save IS the backstop for a non-undoable wipe. If it failed,
      // there is nothing to fall back to — so don't wipe.
      pushToast('error', errorText(err, 'Could not save to the library.'));
      return;
    }
    adoptParsedDoc(DEFAULT_DOC, false);
    // A fresh map: it has an id to save under, but nothing saved under it yet,
    // so there is no version to show until the first save.
    useLibraryPointer.getState().setPointer(newMapId(), null);
  };

  /**
   * Make a copy — Google Docs semantics: mint a NEW library map from the live
   * doc, named "Copy of X", with a version history of its own. Versions are
   * keyed by map id, so saving under a fresh id is what guarantees the copy
   * inherits none of the source's revisions. The canvas continues
   * uninterrupted — same content, same camera, same undo stack — it just
   * belongs to the copy now.
   */
  const onMakeCopy = async () => {
    // Checkpoint a dirty source under its OWN id first, so the state at the
    // fork point lands in the source's history rather than existing only in
    // the copy's line. A doc with no library identity (a loaded file) has no
    // history to update — and the copy itself preserves the bytes — so no
    // orphan map is minted for it.
    if (useLibraryPointer.getState().mapId !== null) {
      try {
        await autoSaveCurrent();
      } catch (err) {
        pushToast('error', errorText(err, 'Could not save to the library.'));
        return;
      }
    }
    // Snapshot and bytes captured BEFORE the awaits, already wearing the
    // copy's name: an edit that lands mid-save is not vouched for, and a
    // failed save leaves the live doc untouched — still the source map.
    const copyName = `Copy of ${useDoc.getState().name}`;
    const snap = { ...pickDocSnapshot(useDoc.getState()), name: copyName };
    auditExportDoc(snap);
    const json = serialize(snap);
    try {
      const thumb = await tryCaptureThumbnail();
      const id = newMapId();
      const saved = await saveVersion(id, copyName, json, 'user', thumb);
      useDoc.getState().setDocName(copyName);
      useLibraryPointer.getState().setPointer(id, saved.version);
      markSaved(json, snap);
      pushToast('info', `Created “${copyName}” as v${saved.version}`);
    } catch (err) {
      pushToast('error', errorText(err, 'Could not save to the library.'));
    }
  };

  const onOpenLibrary = () => setLibraryOpen(true);

  /**
   * Load a version's payload over the live doc. Throws for the dialog to show.
   *
   * Read and parse BEFORE the auto-save, exactly as the file-load path does.
   * The auto-save writes an 'auto' under this same map and prunes it in the same
   * transaction — and a map that has been open a while sits at exactly
   * AUTO_VERSION_LIMIT prunable autos, so the 51st prunes the oldest, which is
   * the row at the bottom of the list the user just clicked Open on. Fetching
   * first means the bytes are already in hand and the prune cannot take them.
   * The save still lands before the adopt, so a storage failure costs the open
   * rather than the document.
   */
  const onOpenVersion = async (version: VersionMeta) => {
    const json = await getPayload(version.id);
    if (json === undefined) throw new Error('That version is no longer in the library.');
    const result = parse(json, useCustomPalettes.getState().palettes);
    if (!result.ok) throw new Error(result.error);
    await autoSaveCurrent();
    adoptParsedDoc(result.doc, true); // straight from the library: clean
    useLibraryPointer.getState().setPointer(version.mapId, version.version);
    setLibraryOpen(false);
  };

  // Export the rendered map as an image. All three share the canvas snapshot,
  // the active theme's background, and the name-stamped basename; failures
  // surface as a status toast.
  const runExport = async (
    fn: (svg: SVGSVGElement, bg: string, basename: string) => Promise<void>,
  ) => {
    const svg = getCanvasSvg();
    if (!svg) {
      pushToast('error', 'Canvas not ready to export yet.');
      return;
    }
    try {
      await fn(
        captureExportSnapshot(svg),
        themeColors(useDoc.getState().darkMode).canvasBg,
        currentBasename(),
      );
    } catch (err) {
      pushToast('error', errorText(err, 'Export failed.'));
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
      pushToast('error', result.error);
      return;
    }
    // After the parse, so a cancelled picker or an unreadable file writes
    // nothing; before the adopt, so a storage failure costs the load, not the
    // document.
    try {
      await autoSaveCurrent();
    } catch (err) {
      pushToast('error', errorText(err, 'Could not save the current map to the library.'));
      return;
    }
    // A file is not a library map: it adopts as unsaved (Save stays armed to
    // import it), and saving it makes a NEW map, the same way re-uploading a
    // downloaded doc gives you a new doc. No id and no version — the pill has
    // nothing true to show until that first save.
    adoptParsedDoc(result.doc, false);
    useLibraryPointer.getState().setPointer(null, null);
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
      <BrandBadge />
      <span className="tool-group-divider" aria-hidden="true" />
      <MapNameField />
      <MapVersionPill />
      <span className="tool-group-divider" aria-hidden="true" />
      <Menu label="Map">
        <MenuItem onClick={() => void onNew()}>New</MenuItem>
        <MenuItem onClick={() => void onMakeCopy()}>Make a copy</MenuItem>
        <MenuSeparator />
        {/* Greyed out when clean: the doc already matches a library version,
            so a save could only mint a duplicate. */}
        <MenuItem
          onClick={() => void onSaveToLibrary()}
          disabled={saveStatus === 'clean'}
          shortcut="Ctrl+S"
        >
          Save version
        </MenuItem>
        {/* Discard unsaved changes, back to the last save/load. Greyed out when
            there's nothing to discard: a clean/unsaved doc already matches its
            baseline, and a doc with no baseline has no saved state to revert to. */}
        <MenuItem onClick={onRevert} disabled={!canRevert}>
          Revert
        </MenuItem>
        <SubMenu label="Load">
          <MenuItem onClick={onOpenLibrary}>From library…</MenuItem>
          <MenuItem onClick={onLoadClick}>JSON…</MenuItem>
        </SubMenu>
        <SubMenu label="Export">
          <MenuItem onClick={onExportPng}>PNG</MenuItem>
          <MenuItem onClick={onExportSvg}>SVG</MenuItem>
          <MenuItem onClick={onExportPdf}>PDF</MenuItem>
          <MenuItem onClick={onExportJson}>JSON</MenuItem>
        </SubMenu>
        <MenuSeparator />
        {/* Local viewing preference: darken only the chrome, leaving the map a
            day map. Distinct from the moon toggle's night mode (which repaints
            the canvas and saves to the doc). Persisted, never touches the doc. */}
        <MenuCheckboxItem checked={darkUiInDay} onCheckedChange={setDarkUiInDay}>
          Dark UI in day
        </MenuCheckboxItem>
        {/* Local viewing preference: dim the day-mode paper to cut glare
            without switching to night mode. Persisted, never touches the doc. */}
        <SubMenu label="Day canvas color">
          <MenuItem onClick={() => setDayCanvasColor('white')}>White</MenuItem>
          <MenuItem onClick={() => setDayCanvasColor('gray')}>Gray</MenuItem>
          <MenuItem onClick={() => setDayCanvasColor('black')}>Black</MenuItem>
        </SubMenu>
        <MenuItem onClick={onClear}>Clear</MenuItem>
      </Menu>
      <Menu label="Add">
        <MenuItem onClick={onAddStation}>Stations</MenuItem>
        <MenuItem onClick={onAddLine}>Line</MenuItem>
        <MenuItem onClick={onAddLineTag}>Line tags / chevrons</MenuItem>
        <MenuItem onClick={onAddRouteBullet}>Route bullets</MenuItem>
        <MenuItem onClick={onAddTransfer}>Transfer</MenuItem>
        <MenuItem onClick={onAddAnchor}>Transfer anchor</MenuItem>
        <MenuItem onClick={onAddLabel}>Label</MenuItem>
        <MenuItem onClick={onAddPolygon}>Polygon</MenuItem>
        <MenuItem onClick={onAddLineCircle}>Line circle</MenuItem>
        <MenuItem onClick={onAddImage}>Image / SVG…</MenuItem>
      </Menu>
      <ToolButtons />
      <span className="tool-group-divider" aria-hidden="true" />
      <SnapToggleBar />
      <span className="tool-group-divider" aria-hidden="true" />
      <div className="tool-group">
        <button
          type="button"
          className={'tool-btn' + (palettesOpen ? ' active' : '')}
          title="Manage palettes"
          aria-label="Manage palettes"
          aria-haspopup="dialog"
          aria-expanded={palettesOpen}
          onClick={() => setPalettesOpen(true)}
        >
          <PaletteGlyph />
        </button>
        <button
          type="button"
          className={'tool-btn' + (gridVisible ? ' active' : '')}
          title={gridVisible ? 'Hide grid (G)' : 'Show grid (G)'}
          aria-label="Toggle grid"
          aria-pressed={gridVisible}
          onClick={() => setGridVisible(!gridVisible)}
        >
          <FrameIcon />
        </button>
        <button
          type="button"
          className="tool-btn tool-btn-text"
          title={`Grid: ${gridSize} world units — click for ${nextGridSize(gridSize)} (Shift+G)`}
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
              : 'Layering mode (L) — modify line layering'
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
        <ViewPopover />
        <PerfPopover />
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
        <MapLibraryDialog onClose={() => setLibraryOpen(false)} onOpenVersion={onOpenVersion} />
      )}
      {palettesOpen && <PalettesDialog onClose={() => setPalettesOpen(false)} />}
    </div>
  );
}
