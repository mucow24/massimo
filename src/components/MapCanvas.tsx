import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { dragState, exitLineEditorOnItemClick, useDoc, useSelection } from '../state/store';
import { useSnapPrefs } from '../state/snapPrefs';
import { useViewportStore } from '../state/viewportStore';
import { useThemeColors } from '../state/theme';
import type { SnapGuide } from '../geometry/snap';
import {
  assignLinePriorities,
  buildBandGeometry,
  buildOrderedRenderables,
  buildStopMarkers,
  SegmentBandSpec,
} from '../geometry/interlining';
import { effectivePolygonOrder, effectiveSvgImageOrder, type ItemRef } from '../model/transforms';
import { rotateItemOnContextMenu } from './canvas/groupRotate';
import { legibleTextOn } from '../util/color';
import { BandWarning, SegmentBand } from './SegmentBand';
import { HatchPatterns } from './HatchPatterns';
import { StopMarker } from './StopMarker';
import { StationView } from './StationView';
import { useViewport } from './canvas/useViewport';
import { overdrawnViewBox } from './canvas/viewportMath';
import { useStationDrag } from './canvas/useStationDrag';
import { useStationLayoutDrag } from './canvas/useStationLayoutDrag';
import { StationLayoutEditor } from './canvas/StationLayoutEditor';
import { GhostLattice } from './canvas/GhostLattice';
import { STOP_SIZE } from '../geometry/orientation';
import { lineWidthOf } from '../model/lineWidth';
import { useRectSelect } from './canvas/useRectSelect';
import {
  currentHitEntity,
  LOCKED_HIT_PAD_PX,
  lockedDispatchTarget,
  lockedHitsAt,
  mergeLockedIntoStack,
  nextInStack,
  resolveHitStack,
  type HitEntry,
} from './canvas/hitStack';
import { Grid } from './canvas/Grid';
import { WarningToasts } from './canvas/WarningToasts';
import { EditingBanner } from './canvas/EditingBanner';
import { SnapGuides } from './canvas/SnapGuides';
import { useItemDrag } from './canvas/useItemDrag';
import { usePolygonDrag } from './canvas/usePolygonDrag';
import { useSvgImageDrag } from './canvas/useSvgImageDrag';
import { LineTagsLayer } from './canvas/LineTagsLayer';
import { LayeringDashedOutlines, LayeringHoverOutline } from './canvas/LayeringOutlines';
import { LayerNumberLabels } from './canvas/LayerNumberLabels';
import { StationPlacingPreview } from './canvas/StationPlacingPreview';
import { PolygonPlacingPreview } from './canvas/PolygonPlacingPreview';
import { SvgImagePlacingPreview } from './canvas/SvgImagePlacingPreview';
import { RouteBulletPlacingPreview } from './canvas/RouteBulletPlacingPreview';
import { HighlightedLineLayer } from './canvas/HighlightedLineLayer';
import { LabelPlacingPreview } from './canvas/LabelPlacingPreview';
import { RouteBulletView } from './RouteBulletView';
import { LabelView } from './LabelView';
import { PolygonView } from './PolygonView';
import { SvgImageView } from './SvgImageView';
import { ItemPopovers } from './canvas/ItemPopovers';
import { snapPlacement, usePlacementDispatch } from './canvas/usePlacementDispatch';
import { TransferLayer, transferEndWorld } from './TransferLayer';
import {
  anchorFromArcLen,
  closestParamOnOffsetPath,
  LINE_TAG_SNAP_TOLERANCE,
  lineTraversesForwardCanon,
  offsetPathLength,
  sampleOffsetPath,
  snapNeighborTag,
} from '../geometry/lineTagGeometry';
import type { LineId } from '../model/types';
import { findMatchingStations } from '../model/matching';
import { desaturateColor } from '../util/color';

// 1 = full color, 0 = greyscale.
const OTHER_LINE_SATURATION = 0.5;
// Annotations (station labels, route bullets, text labels, line tags) drop to
// this opacity while layering mode is on, so the focus is on the band layers
// + their outlines. Transfers stay at full opacity (they're part of the
// route-network reading, not background annotation).
const LAYERING_FADE_OPACITY = 0.25;

// Click / context-menu are intentionally inert on the drag proxies: the SVG's
// onClickCapture/onContextMenuCapture intercept those events (rerouteProxyEvent-
// Beneath) and re-dispatch them to the real element beneath, so selection
// follows normal layer order. Stable identity so the (memoized) proxy views
// don't re-render on pan.
const proxyClickNoop = () => {};

// Shared empty set for polygons with no selected vertices, so unselected
// polygons don't each allocate one every render.
const NO_VERTEX_INDICES: ReadonlySet<number> = new Set();

export function MapCanvas() {
  const stations = useDoc((s) => s.stations);
  const lines = useDoc((s) => s.lines);
  const curveRadius = useDoc((s) => s.curveRadius);
  const lineOrder = useDoc((s) => s.lineOrder);
  const addLineTag = useDoc((s) => s.addLineTag);
  const cycleSegmentLayer = useDoc((s) => s.cycleSegmentLayer);
  const routeBullets = useDoc((s) => s.routeBullets);
  const rotateRouteBullet = useDoc((s) => s.rotateRouteBullet);
  const transfers = useDoc((s) => s.transfers);
  const transferColor = useDoc((s) => s.transferColor);
  const transferThickness = useDoc((s) => s.transferThickness);
  const transferStrokeColor = useDoc((s) => s.transferStrokeColor);
  const transferStrokeWidth = useDoc((s) => s.transferStrokeWidth);
  const textLabels = useDoc((s) => s.textLabels);
  const rotateTextLabel = useDoc((s) => s.rotateTextLabel);
  const polygons = useDoc((s) => s.polygons);
  const polygonOrder = useDoc((s) => s.polygonOrder);
  const rotatePolygon = useDoc((s) => s.rotatePolygon);
  const svgImages = useDoc((s) => s.svgImages);
  const svgImageOrder = useDoc((s) => s.svgImageOrder);
  const rotateSvgImage45 = useDoc((s) => s.rotateSvgImage45);
  const selection = useSelection();
  const snapModes = useSnapPrefs((s) => s.modes);
  const gridVisible = useViewportStore((s) => s.gridVisible);
  const gridSize = useViewportStore((s) => s.gridSize);
  const theme = useThemeColors();
  // Gap/underlay color for dashed + hatched styles: matches the canvas
  // background so the "off" stripes read as empty canvas, not stale white.
  const underlayColor = theme.underlay;
  const highlightLineId = selection.selectedLineId;

  const svgRef = useRef<SVGSVGElement | null>(null);
  // The selected-item drag-proxy layer. Proxies sit on top so a SELECTED item
  // wins the DRAG over anything stacked above it. A click / right-click on a
  // proxy is re-routed to the real element beneath (rerouteProxyEventBeneath),
  // so SELECTION still follows normal layer order — only dragging gets
  // selected-item priority. The ref is used to scope "is this event on a proxy?"
  // and to momentarily hide the layer for the beneath hit-test.
  const proxyLayerRef = useRef<SVGGElement | null>(null);
  const view = useViewport(svgRef);
  // Full-viewport overlays (background, grid, dim wash) are drawn at this
  // overdrawn extent so an imperative-viewBox pan/zoom can't reveal a bare strip
  // before the gesture commits and re-renders them. See overdrawnViewBox.
  const overdrawn = overdrawnViewBox(view);
  const placement = usePlacementDispatch(view);
  const drag = useStationDrag(svgRef, view.viewport.zoom);
  const rectSelect = useRectSelect(svgRef, view.screenToWorld);
  // While a rect-select drag is in flight, render selection visuals
  // (station wash/stroke and bullet ring) over the previewed result
  // instead of the live selection so the user sees exactly what'll be
  // selected on release.
  const washIds = rectSelect.previewStationIds ?? selection.selectedStationIds;
  const bulletSelectedIds = rectSelect.previewBulletIds ?? selection.selectedRouteBulletIds;
  const labelSelectedIds = rectSelect.previewLabelIds ?? selection.selectedLabelIds;
  const polygonSelectedIds = rectSelect.previewPolygonIds ?? selection.selectedPolygonIds;
  const svgImageSelectedIds = rectSelect.previewSvgImageIds ?? selection.selectedSvgImageIds;
  // Paint order for polygon bodies (later = on top, among polygons only).
  const polygonRenderOrder = useMemo(
    () => effectivePolygonOrder(polygons, polygonOrder),
    [polygons, polygonOrder],
  );
  // Paint order for svg images — same band as polygons; later = on top.
  const svgImageRenderOrder = useMemo(
    () => effectiveSvgImageOrder(svgImages, svgImageOrder),
    [svgImages, svgImageOrder],
  );
  // While a click-to-place tool is active (any non-idle mode), polygon bodies
  // ignore pointer events so a canvas click places the item over them instead
  // of selecting the polygon.
  const polygonsInteractive = selection.uiMode.kind === 'idle';

  // Geometry hash for buildBandGeometry's inputs (stations + line topology +
  // segmentStyles + per-line width). EXCLUDES segmentLayers so layer cycles
  // don't churn the geometry — `bandsGeometry`'s reference stays stable
  // across them, which is what the layering-mode memos rely on. Color is
  // also intentionally absent: a color edit must repaint WITHOUT a geometry
  // rebuild (stripes resolve color live). Width, by contrast, IS geometry —
  // it moves the baked paths and changes band merging — so it must be in
  // the hash or width edits never repaint. The hash itself runs once per
  // render but is cheap (a string of stable shapes).
  const linesGeometrySig = useMemo(() => {
    const parts: string[] = [];
    for (const id of Object.keys(lines)) {
      const ln = lines[id];
      parts.push(
        id,
        ln.stations.join('.'),
        Object.keys(ln.segmentStyles ?? {}).join('.'),
        String(ln.width ?? ''),
      );
    }
    return parts.join('|');
  }, [lines]);

  // Stations-side twin of linesGeometrySig: hashes exactly the station
  // fields buildBandGeometry / buildStopMarkers read — anchor (x, y),
  // rotation, and each stop's lineId/row/col/orientation. EXCLUDES the
  // label block and per-stop dotStyle/dotSize (presentation, resolved live
  // at render). Label edits are the high-frequency writers here: an Alt
  // fine-drag streams setLabelOffset/setLabelOffsetPerp per pointermove,
  // which must repaint the label WITHOUT re-running band routing.
  const stationsGeometrySig = useMemo(() => {
    const parts: string[] = [];
    for (const id of Object.keys(stations)) {
      const st = stations[id];
      parts.push(id, String(st.x), String(st.y), String(st.rotation));
      for (const c of st.stops) parts.push(c.lineId, String(c.row), String(c.col), c.orientation);
    }
    return parts.join('|');
  }, [stations]);

  const bandsGeometry = useMemo(
    () => buildBandGeometry(stations, lines, curveRadius),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stationsGeometrySig, linesGeometrySig, curveRadius],
  );

  const bands = useMemo(() => {
    // assignLinePriorities mutates in place; clone so memoized priorities
    // don't leak between the two memo levels (matters once a future caller
    // wants the geometry array without priorities — for layering-mode
    // outlines we pass `bandsGeometry` directly). The spec is presentation-
    // free, so color/style aren't carried here — stripe consumers resolve
    // them live from `lines`, which is why a color/style edit repaints
    // without the (intentionally presentation-blind) geometry memo
    // rebuilding. Per-stripe widths/offsets ARE on the spec — width is
    // geometry (it shapes `paths`), so width edits flow through the
    // geometry rebuild instead.
    const out = bandsGeometry.map((b) => ({ ...b }));
    assignLinePriorities(out, lines, lineOrder);
    return out;
  }, [bandsGeometry, lines, lineOrder]);

  // When mirror-matching mode is on for the selected station, highlight the
  // stations sharing a line whose layouts render identically (whole line,
  // not adjacency). Mirror mode only applies to single-selection.
  const soloSelectedId =
    selection.selectedStationIds.length === 1 ? selection.selectedStationIds[0] : null;
  const matchingIds = useMemo(() => {
    if (!selection.mirrorMatching || !soloSelectedId) return [];
    return findMatchingStations({ stations, lines }, soloSelectedId).map((m) => m.id);
  }, [selection.mirrorMatching, soloSelectedId, stations, lines]);
  // Color override map for non-selected lines while a line is being edited.
  // Selected line keeps its true color; others get desaturated toward greyscale.
  const colorMap = useMemo(() => {
    if (!highlightLineId || OTHER_LINE_SATURATION >= 1) return undefined;
    const map: Record<string, string> = {};
    for (const ln of Object.values(lines)) {
      if (ln.id === highlightLineId) continue;
      map[ln.id] = desaturateColor(ln.color, OTHER_LINE_SATURATION);
    }
    return map;
  }, [highlightLineId, lines]);

  // Distinct colors of any line that has at least one hatched segment (in
  // either direction). Drives <pattern> emission in <defs>; each color gets
  // both hatch patterns (+45° and -45°) so SegmentBand can reference whichever
  // variant a stripe needs via hatchPatternId(color, variant).
  const hatchedColors = useMemo(() => {
    const seen = new Set<string>();
    for (const ln of Object.values(lines)) {
      if (!ln.segmentStyles) continue;
      const hasHatch = Object.values(ln.segmentStyles).some(
        (s) => s === 'hatched' || s === 'hatched-mirror',
      );
      if (!hasHatch) continue;
      const effective = colorMap?.[ln.id] ?? ln.color;
      seen.add(effective);
    }
    return Array.from(seen);
  }, [lines, colorMap]);

  // Band stripes, band warnings, and stop markers merged into one pass and
  // sorted back-to-front by per-stripe z-priority. Each stripe in an
  // interlined band paints at its own line's lineOrder index, so a
  // perpendicular line whose layer falls between two interlined lines
  // renders between their stripes (not behind the whole band). Per-line
  // casing rails need no entries of their own — they paint inside their
  // body within SegmentBand/StopMarker.
  const renderables = useMemo(() => {
    const markers = buildStopMarkers(stations, lines, lineOrder, bands);
    return buildOrderedRenderables(bands, markers);
    // buildStopMarkers reads the same station fields the signature hashes,
    // so keying on it (not the stations reference) lets label/dot edits
    // skip the marker rebuild + priority sort along with band routing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bands, stationsGeometrySig, lines, lineOrder]);

  const inHandMode = selection.toolMode === 'hand' || selection.spaceHeld;

  const itemDrag = useItemDrag(svgRef, view.viewport.zoom, inHandMode);
  const polyDrag = usePolygonDrag(svgRef, view.viewport.zoom, inHandMode);
  const svgDrag = useSvgImageDrag(svgRef, view.viewport.zoom, inHandMode, view.screenToWorld);
  const layoutDrag = useStationLayoutDrag(svgRef, view.screenToWorld);
  // The station being layout-edited in place, if the mode is active. If the
  // station vanishes under the mode (deleted from the sidebar), exit to idle
  // rather than leaving a mode whose payload points at nothing.
  const layoutEditStationId =
    selection.uiMode.kind === 'editing-station-layout' ? selection.uiMode.stationId : null;
  const layoutEditStation = layoutEditStationId ? stations[layoutEditStationId] : undefined;
  const setUiModeAction = selection.setUiMode;
  useEffect(() => {
    if (layoutEditStationId && !stations[layoutEditStationId]) {
      setUiModeAction({ kind: 'idle' });
    }
  }, [layoutEditStationId, stations, setUiModeAction]);
  // Entering layout-edit for an off-screen or too-tiny station commits ONE
  // camera write framing it — the sidebar list can start the mode on a
  // station far outside the view, which would otherwise open with nothing
  // to grab. Deliberately keyed on the station id only: mid-mode pans and
  // zooms must not re-frame.
  useEffect(() => {
    if (!layoutEditStationId) return;
    const st = useDoc.getState().stations[layoutEditStationId];
    if (!st) return;
    const margin = 40 / view.viewport.zoom; // ~40 screen px, in world units
    const visible =
      st.x > view.vbX + margin &&
      st.x < view.vbX + view.vbW - margin &&
      st.y > view.vbY + margin &&
      st.y < view.vbY + view.vbH - margin;
    if (visible && view.viewport.zoom >= 0.5) return;
    useViewportStore
      .getState()
      .setViewport({ x: st.x, y: st.y, zoom: Math.max(view.viewport.zoom, 1) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutEditStationId]);
  // Cursor position in world coords — drives the in-progress transfer line
  // from the anchor dot to the cursor, and the station-placing-mode ghost
  // that follows the cursor before each click.
  const [cursorWorld, setCursorWorld] = useState<{ x: number; y: number } | null>(null);
  // Guides emitted by the placement-preview snap (same snapPlacement call the
  // drop makes), rendered through the shared SnapGuides overlay.
  const [placementGuides, setPlacementGuides] = useState<SnapGuide[]>([]);

  // Hovered stripe in layering mode: (bandKey, lineId) of the band stripe the
  // pointer is currently over. Drives the lightened-color preview + the small
  // layer-number text rendered at the stripe's midpoint. Cleared whenever we
  // leave layering mode (via the render-pattern below).
  const [hoveredLayerStripe, setHoveredLayerStripe] = useState<{
    bandKey: string;
    lineId: LineId;
  } | null>(null);
  const inLayeringMode = selection.uiMode.kind === 'layering';
  const [prevLayering, setPrevLayering] = useState(inLayeringMode);
  if (inLayeringMode !== prevLayering) {
    setPrevLayering(inLayeringMode);
    if (!inLayeringMode && hoveredLayerStripe) setHoveredLayerStripe(null);
  }

  // Stable click handler for selecting a line by clicking its stripe. Passed to
  // every (memoized) SegmentBand, so it must keep a constant identity across a
  // pan; selection.selectLine is a stable Zustand action.
  const selectLine = selection.selectLine;
  const handleLineSelect = useCallback(
    (lineId: LineId, e: React.MouseEvent<SVGPathElement>) => {
      e.stopPropagation();
      selectLine(lineId);
    },
    [selectLine],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    // Middle-button drag pans regardless of tool mode.
    if (e.button === 1) {
      e.preventDefault();
      view.startPan(e);
      return;
    }
    if (inHandMode) {
      view.startPan(e);
      return;
    }
    // Arrow mode: a left-button pointerdown on background may begin a
    // rect-select. The hook self-gates on background hit + active mode.
    rectSelect.onPointerDown(e);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    view.onPointerMove(e);
    drag.onPointerMove(e);
    rectSelect.onPointerMove(e);
    const mode = selection.uiMode;
    const wantsCursorTrack =
      (mode.kind === 'creating-transfer' && mode.anchor !== null) ||
      mode.kind === 'placing-station' ||
      mode.kind === 'creating-route-bullet' ||
      mode.kind === 'placing-label' ||
      mode.kind === 'creating-polygon' ||
      mode.kind === 'placing-svg';
    if (wantsCursorTrack) {
      const raw = view.screenToWorld(e.clientX, e.clientY);
      if (mode.kind === 'creating-transfer') {
        // Transfer rubber-band tracks the raw cursor; endpoints are picked by
        // clicking dots, not by position snapping.
        setCursorWorld(raw);
        if (placementGuides.length > 0) setPlacementGuides([]);
      } else {
        // Snap the placement preview exactly like the drop will (same
        // snapPlacement call), so the ghost always shows where — and why —
        // the item will land. Shift bypasses.
        const snap = snapPlacement(mode, raw, e.shiftKey, snapModes, gridSize, view.viewport.zoom);
        setCursorWorld({ x: snap.x, y: snap.y });
        setPlacementGuides(snap.guides);
      }
    } else {
      if (cursorWorld) setCursorWorld(null);
      if (placementGuides.length > 0) setPlacementGuides([]);
    }
    itemDrag.onPointerMove(e);
    polyDrag.onPointerMove(e);
    svgDrag.onPointerMove(e);
    layoutDrag.onPointerMove(e);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    view.onPointerUp(e);
    drag.onPointerUp(e);
    rectSelect.onPointerUp(e);
    itemDrag.onPointerUp(e);
    polyDrag.onPointerUp(e);
    svgDrag.onPointerUp(e);
    layoutDrag.onPointerUp(e);
  };
  // A browser pointercancel (pen palm rejection, window switch, capture loss)
  // voids an in-flight gesture with no matching pointerup. Fan it out to every
  // drag hook so each disarms its ref and rolls back its live writes instead of
  // leaving the drag stranded — armed for a later stray move to resume, or for
  // an unrelated pointerup to commit a move the user never made, with history
  // recording paused the whole time. Pan + rect-select are intentionally
  // omitted: neither opens a history group or mutates the doc. The line-tag
  // drag is window-wired, so it hooks window 'pointercancel' itself instead
  // of appearing here.
  const onPointerCancel = () => {
    drag.onPointerCancel();
    itemDrag.onPointerCancel();
    polyDrag.onPointerCancel();
    svgDrag.onPointerCancel();
    layoutDrag.onPointerCancel();
  };

  // A plain click / right-click that lands on a selected item's drag proxy must
  // select by NORMAL layer order, not act on the proxy's item. Intercept in the
  // capture phase (before the proxy's own handler), suppress it, and re-dispatch
  // the event to the topmost REAL element beneath (proxies hidden only for that
  // instantaneous hit-test) so that element's own handler runs. Drag is
  // untouched — it's driven by pointer events, not click. After a drag,
  // suppressClick is set, so we consume the trailing click without re-routing.
  const rerouteProxyEventBeneath = (type: 'click' | 'contextmenu', e: React.MouseEvent) => {
    const layer = proxyLayerRef.current;
    if (!layer || !layer.contains(e.target as Node)) return;
    // The press landed on a proxy. Stop the proxy's own click/contextmenu (and
    // the canvas handler) from firing.
    e.stopPropagation();
    if (type === 'contextmenu') e.preventDefault();
    if (dragState.suppressClick) return; // a drag just ended — no selection click
    const prev = layer.style.display;
    layer.style.display = 'none';
    const beneath = document.elementFromPoint(e.clientX, e.clientY);
    layer.style.display = prev;
    if (!beneath || beneath === svgRef.current) return;
    beneath.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: e.clientX,
        clientY: e.clientY,
        shiftKey: e.shiftKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        button: type === 'contextmenu' ? 2 : 0,
      }),
    );
  };

  // Alt+click deep-pick: cycle the selection through the stack of selectable
  // elements under the cursor, topmost first — the way to reach an element
  // buried under other hit surfaces (a line under a station's hit rect, a
  // polygon under a label, ...). The current sole selection is the cursor
  // into the stack: alt+click selects the entry AFTER it (wrapping past the
  // bottom), or the topmost when nothing — or a multi-selection — is
  // current. The chosen element receives a synthetic plain click, so its own
  // handler runs and every existing selection semantic (exclusivity,
  // popovers, shift-toggle) applies unchanged. Alt is stripped from the
  // re-dispatch (no recursion); shift is preserved (multi-select toggle);
  // ctrl/meta are dropped (station redistribute must not fire from a
  // deep-pick). The proxy layer is hidden during the elementsFromPoint
  // snapshot, mirroring rerouteProxyEventBeneath. Returns true when the
  // click was handled (callers skip the normal capture path).
  const deepPickAltClick = (e: React.MouseEvent): boolean => {
    if (!e.altKey) return false;
    if (inHandMode || selection.uiMode.kind !== 'idle') return false;
    // The inline rename editor is a foreignObject INSIDE the svg while uiMode
    // stays idle — an alt+click landing on (or near) it must not re-select
    // things beneath the open editor.
    if (selection.editingStationId) return false;
    if (dragState.suppressClick) return false; // post-drag click: the normal path consumes it
    const layer = proxyLayerRef.current;
    const prevDisplay = layer ? layer.style.display : '';
    if (layer) layer.style.display = 'none';
    const els = document.elementsFromPoint(e.clientX, e.clientY);
    if (layer) layer.style.display = prevDisplay;
    // Locked, unselected items are click-through (pointer-events: none), so
    // elementsFromPoint never reports them. Point-test them geometrically and
    // append below the live stack — locked reads as background, so cycling
    // reaches them last. Their body handlers stay wired, so the synthetic
    // dispatch selects them like anything else.
    const world = view.screenToWorld(e.clientX, e.clientY);
    const lockedEntries: HitEntry[] = [];
    for (const ref of lockedHitsAt(
      world,
      useDoc.getState(),
      LOCKED_HIT_PAD_PX / view.viewport.zoom,
    )) {
      const element = lockedDispatchTarget(ref);
      if (element) lockedEntries.push({ ...ref, element });
    }
    const stack = mergeLockedIntoStack(resolveHitStack(els), lockedEntries);
    const next = nextInStack(stack, currentHitEntity(useSelection.getState()));
    if (!next) return false; // nothing selectable here — behave as a plain background click
    e.stopPropagation();
    // "Click off the line exits the editor without selecting" must not eat a
    // deep-pick — the user explicitly asked for the next item — so exit the
    // line editor BEFORE dispatching (exitLineEditorOnItemClick then no-ops).
    if (useSelection.getState().selectedLineId) selectLine(null);
    next.element.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        clientX: e.clientX,
        clientY: e.clientY,
        shiftKey: e.shiftKey,
        button: 0,
      }),
    );
    return true;
  };

  // The four free-item types (bullets, labels, polygons, svg images) share
  // one click / right-click contract, mirroring station shift-click:
  // Shift-click toggles multi-selection membership — but ONLY without
  // Ctrl/Cmd, which is reserved (stations use Ctrl+Shift for path-extend).
  // Plain click replaces the whole selection with this item, which also
  // opens its popover (ItemPopovers gates on `soleSelection` — exactly one
  // item selected across every type).
  // Right-click rotates, group-aware via rotateItemOnContextMenu.
  const makeItemClickHandlers = (
    type: ItemRef['type'],
    opts: {
      select: (id: string) => void;
      toggle: (id: string) => void;
      rotate: (id: string) => void;
      /** Runs before the toggle/select resolves (polygon vertex un-pick). */
      beforeSelect?: () => void;
    },
  ) => ({
    onClick: (id: string, e: React.MouseEvent) => {
      if (dragState.suppressClick) return;
      if (inHandMode) return;
      e.stopPropagation();
      // Line editor open: this is a click off the line to exit — deselect the
      // line and don't select the item under the cursor.
      if (exitLineEditorOnItemClick()) return;
      opts.beforeSelect?.();
      if (e.shiftKey && !(e.ctrlKey || e.metaKey)) {
        opts.toggle(id);
        return;
      }
      opts.select(id);
    },
    onContextMenu: (id: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      rotateItemOnContextMenu({ type, id }, () => opts.rotate(id));
    },
  });

  const { onClick: onBulletClick, onContextMenu: onBulletContextMenu } = makeItemClickHandlers(
    'bullet',
    {
      select: selection.selectRouteBullet,
      toggle: selection.toggleRouteBulletSelection,
      rotate: rotateRouteBullet,
    },
  );
  const { onClick: onLabelClick, onContextMenu: onLabelContextMenu } = makeItemClickHandlers(
    'label',
    {
      select: selection.selectLabel,
      toggle: selection.toggleLabelSelection,
      rotate: rotateTextLabel,
    },
  );
  const { onClick: onPolygonClick, onContextMenu: onPolygonContextMenu } = makeItemClickHandlers(
    'polygon',
    {
      select: selection.selectPolygon,
      toggle: selection.togglePolygonSelection,
      rotate: rotatePolygon,
      // Clicking the body clears any active vertex selection so the handles
      // un-highlight.
      beforeSelect: () => selection.selectVertices(null),
    },
  );
  const { onClick: onSvgImageClick, onContextMenu: onSvgImageContextMenu } = makeItemClickHandlers(
    'svgImage',
    {
      select: selection.selectSvgImage,
      toggle: selection.toggleSvgImageSelection,
      rotate: rotateSvgImage45,
    },
  );
  const onVertexClick = (id: string, index: number, e: React.MouseEvent) => {
    if (dragState.suppressClick) return;
    if (inHandMode) return;
    e.stopPropagation();
    // Keep the polygon selected (popover stays open) and mark the vertex/vertices
    // so Delete/nudge/drag act on them. Shift toggles this vertex in/out of the
    // set (matching the item shift-click); a plain click selects just it.
    if (e.shiftKey) selection.toggleVertexSelection({ polygonId: id, index });
    else selection.selectVertices({ polygonId: id, indices: [index] });
  };
  // Which of a polygon's vertex handles to highlight: the selected set when the
  // active vertex selection is on THIS polygon, else none. Vertex editing is
  // single-polygon, so at most one polygon ever gets a non-empty set.
  const vertexIndicesFor = (pid: string): ReadonlySet<number> =>
    selection.selectedVertices?.polygonId === pid
      ? new Set(selection.selectedVertices.indices)
      : NO_VERTEX_INDICES;
  const onCanvasClick = (e: React.MouseEvent) => {
    if (inHandMode) return;
    const onBackground =
      e.target === svgRef.current || (e.target as Element).hasAttribute('data-bg');
    if (!onBackground) return;
    if (dragState.suppressClick) return;
    // A click-to-place tool / active mode consumes the background click (drop an
    // item or exit the mode); only a plain idle click falls through to deselect.
    if (placement.handleCanvasPlace(e)) return;
    selection.selectStation(null);
    selection.selectLineTag(null);
    selection.selectRouteBullet(null);
    selection.selectTransfer(null);
    selection.selectLabel(null);
    selection.selectPolygon(null);
    selection.selectVertices(null);
  };

  // Hover/click handlers passed to SegmentBand when in add-line-tag mode.
  // Each band's renderer captures its own spec via closure.
  const makeBandHandlers = (spec: SegmentBandSpec) => {
    // Placement parity with the tag drag: the hover ghost and the click both
    // apply the same gated neighbor snap, so the preview always matches the
    // dropped tag. Gated on "Snap to all"; Shift bypasses.
    const snapTagT = (t: number, shiftKey: boolean): number => {
      if (snapModes.all === 'off' || shiftKey) return t;
      return snapNeighborTag({
        candCanonT: t,
        candPairKey: spec.pairKey,
        selfTagId: '', // a tag being placed has no id yet
        bandCenterline: spec.centerline,
        curveRadius: spec.radius,
        lineStripeOffset: (lid) => {
          const idx = spec.lines.findIndex((l) => l.id === lid);
          return idx < 0 ? null : spec.stripeOffsets[idx];
        },
        lineTags: useDoc.getState().lineTags,
        tol: LINE_TAG_SNAP_TOLERANCE / view.viewport.zoom,
      }).canonT;
    };
    return {
      onLineHover: (lineId: LineId, e: React.PointerEvent) => {
        const line = lines[lineId];
        if (!line) return;
        // Find this stripe's baked offset within the band.
        const k = spec.lines.findIndex((l) => l.id === lineId);
        const offset = spec.stripeOffsets[k];
        const world = view.screenToWorld(e.clientX, e.clientY);
        const closest = closestParamOnOffsetPath(spec.centerline, spec.radius, offset, world);
        const t = snapTagT(closest.t, e.shiftKey);
        const sample = sampleOffsetPath(spec.centerline, spec.radius, offset, t);
        // Determine canon vs line-traversal: the band's pairKey is canonical.
        // For this band's stations, fromCanon < toCanon. The line traverses
        // forward-canon iff line.stations contains (fromCanon, toCanon) as a
        // consecutive pair.
        const [fromCanon, toCanon] = spec.pairKey.split('|');
        const forward = lineTraversesForwardCanon(line, fromCanon, toCanon);
        selection.setLineTagHoverPreview({
          lineId,
          service: line.service,
          fromStationId: fromCanon,
          toStationId: toCanon,
          t,
          p: sample.p,
          tangent: sample.tangent,
          lineForwardMatchesCanon: forward,
        });
      },
      onLineLeave: () => {
        selection.setLineTagHoverPreview(null);
      },
      onLineClick: (lineId: LineId, e: React.MouseEvent) => {
        e.stopPropagation();
        const line = lines[lineId];
        if (!line) return;
        const k = spec.lines.findIndex((l) => l.id === lineId);
        const offset = spec.stripeOffsets[k];
        const world = view.screenToWorld(e.clientX, e.clientY);
        const closest = closestParamOnOffsetPath(spec.centerline, spec.radius, offset, world);
        const t = snapTagT(closest.t, e.shiftKey);
        const [fromCanon, toCanon] = spec.pairKey.split('|');
        const stripeTotal = offsetPathLength(spec.centerline, spec.radius, offset);
        // Anchor to whichever endpoint is nearer at insertion time.
        const { anchorEnd, distance } = anchorFromArcLen(t * stripeTotal, stripeTotal);
        addLineTag(lineId, fromCanon, toCanon, anchorEnd, distance, 0);
        // Stay in mode (matches + Station behavior).
      },
    };
  };

  // Hover/click handlers for layering mode. Hovering a stripe records the
  // (band, line) pair so the renderer can draw the layer-number overlay +
  // black outline; left-click bumps the per-segment layer up by 1 (down with
  // shift), right-click bumps it down by 1.
  const makeLayerHandlers = (spec: SegmentBandSpec) => ({
    onLineHover: (lineId: LineId) => {
      setHoveredLayerStripe((cur) =>
        cur && cur.bandKey === spec.bandKey && cur.lineId === lineId
          ? cur
          : { bandKey: spec.bandKey, lineId },
      );
    },
    onLineLeave: (lineId: LineId) => {
      setHoveredLayerStripe((cur) =>
        cur && cur.bandKey === spec.bandKey && cur.lineId === lineId ? null : cur,
      );
    },
    onLineClick: (lineId: LineId, e: React.MouseEvent) => {
      e.stopPropagation();
      const [fromCanon, toCanon] = spec.pairKey.split('|');
      cycleSegmentLayer(lineId, fromCanon, toCanon, e.shiftKey ? -1 : 1);
    },
    onLineContextMenu: (lineId: LineId, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const [fromCanon, toCanon] = spec.pairKey.split('|');
      cycleSegmentLayer(lineId, fromCanon, toCanon, -1);
    },
  });

  return (
    <div className="canvas-host" data-uimode={selection.uiMode.kind}>
      <EditingBanner />
      <svg
        ref={svgRef}
        viewBox={`${view.vbX} ${view.vbY} ${view.vbW} ${view.vbH}`}
        className={(inHandMode ? 'tool-hand' : 'tool-arrow') + (view.panning ? ' panning' : '')}
        // Wheel zoom is bound as a non-passive native listener inside useViewport
        // (React's onWheel is passive, so its preventDefault would warn + no-op).
        // Self-heal a stranded click-suppress flag at the start of every fresh
        // gesture. A drag cancelled without a pointerup (lost capture,
        // pointercancel) would otherwise leave dragState.suppressClick = true
        // and silently swallow the next click. Capture phase so it runs before
        // any child's stopPropagation; the drag re-sets the flag on first move.
        onPointerDownCapture={() => {
          dragState.suppressClick = false;
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={() => {
          if (cursorWorld) setCursorWorld(null);
        }}
        // Alt+click deep-picks through the under-cursor stack; otherwise
        // re-route a click/right-click on a selected item's drag proxy to the
        // real element beneath, so selection always follows normal layer order
        // (only DRAG gets selected-item priority). Capture phase so both run
        // before the target's own handler and the canvas click handler.
        onClickCapture={(e) => {
          if (deepPickAltClick(e)) return;
          rerouteProxyEventBeneath('click', e);
        }}
        // Two rapid alt+clicks (deep-pick cycling) also synthesize a native
        // dblclick on the topmost element — which would open the station
        // rename editor and clobber the deep-picked selection. Swallow
        // alt-dblclicks; plain double-click rename is untouched.
        onDoubleClickCapture={(e) => {
          if (e.altKey) e.stopPropagation();
        }}
        onContextMenuCapture={(e) => rerouteProxyEventBeneath('contextmenu', e)}
        onClick={onCanvasClick}
        onContextMenu={(e) => e.preventDefault()}
        onDragStart={(e) => e.preventDefault()}
      >
        <defs>
          <HatchPatterns colors={hatchedColors} underlayColor={underlayColor} />
        </defs>

        {/* Background hit target for panning. Overdrawn one viewport-width in
            every direction so an imperative-viewBox pan (which moves the viewBox
            without re-rendering this rect until pointer-up) never reveals a bare
            edge before it reprojects. */}
        <rect
          data-bg="1"
          x={overdrawn.vbX}
          y={overdrawn.vbY}
          width={overdrawn.vbW}
          height={overdrawn.vbH}
          fill={theme.canvasBg}
        />

        {gridVisible && (
          <g data-export-exclude="1">
            {/* Overdrawn one viewport in each direction (like the background
                rect) so an imperative-viewBox pan doesn't run past the drawn
                grid before pointer-up reprojects it. Off-screen lines are
                clipped by the browser, so this adds no per-frame raster cost. */}
            <Grid
              vbX={overdrawn.vbX}
              vbY={overdrawn.vbY}
              vbW={overdrawn.vbW}
              vbH={overdrawn.vbH}
              zoom={view.viewport.zoom}
              gridSize={gridSize}
            />
          </g>
        )}

        {/* Polygon bodies: painted just above the grid and below ALL map
            content (bands, stations, dots, labels) so background shapes like
            rivers/lakes always sit underneath everything else. Their selection
            handles + "+" buttons render in a separate top overlay pass below. */}
        {polygonRenderOrder.map((pid) => {
          const poly = polygons[pid];
          return (
            <PolygonView
              key={pid}
              polygon={poly}
              layer="body"
              selected={polygonSelectedIds.includes(pid)}
              selectedVertexIndices={vertexIndicesFor(pid)}
              interactive={polygonsInteractive}
              inHandMode={inHandMode}
              onPointerDown={polyDrag.onPolygonPointerDown}
              onClick={onPolygonClick}
              onContextMenu={onPolygonContextMenu}
              onVertexPointerDown={polyDrag.onVertexPointerDown}
              onVertexClick={onVertexClick}
              onEdgeAddPointerDown={polyDrag.onEdgeAddPointerDown}
            />
          );
        })}

        {/* Svg-image bodies: same band as polygons (above the grid, below ALL
            map content), painted just on top of polygon bodies since an
            imported graphic is usually a deliberate foreground. Their transform
            handles render in the top overlay pass below. */}
        {svgImageRenderOrder.map((iid) => {
          const im = svgImages[iid];
          return (
            <SvgImageView
              key={iid}
              image={im}
              layer="body"
              selected={svgImageSelectedIds.includes(iid)}
              interactive={polygonsInteractive}
              inHandMode={inHandMode}
              onPointerDown={svgDrag.onSvgImagePointerDown}
              onClick={onSvgImageClick}
              onContextMenu={onSvgImageContextMenu}
              onCornerPointerDown={svgDrag.onSvgCornerPointerDown}
              onEdgePointerDown={svgDrag.onSvgEdgePointerDown}
              onRotatePointerDown={svgDrag.onSvgRotatePointerDown}
            />
          );
        })}

        {/* selection wash: painted before bands so the wash sits behind
            line segments, markers, dots, and labels — all the way in the
            background. One per selected station (or per previewed station
            during a rect-select drag). */}
        <g data-export-exclude="1">
          {washIds.map(
            (sid) =>
              stations[sid] && (
                <StationView
                  key={sid + ':wash'}
                  station={stations[sid]}
                  lines={lines}
                  zoom={view.viewport.zoom}
                  onStartDrag={drag.onStartDrag}
                  layer="wash"
                />
              ),
          )}
        </g>

        {/* band stripes, warnings, and stop squares interleaved by per-stripe z-priority */}
        {renderables.map((r) => {
          if (r.kind === 'stripe') {
            const stripeLineId = r.band.lines[r.stripeIndex].id;
            return (
              <SegmentBand
                key={'s:' + r.band.bandKey + ':' + stripeLineId}
                spec={r.band}
                stripeIndex={r.stripeIndex}
                interactive={selection.uiMode.kind === 'creating-line-tag' || inLayeringMode}
                lines={lines}
                colorMap={colorMap}
                underlayColor={underlayColor}
                onLineSelect={inHandMode ? undefined : handleLineSelect}
                {...(selection.uiMode.kind === 'creating-line-tag'
                  ? makeBandHandlers(r.band)
                  : inLayeringMode
                    ? makeLayerHandlers(r.band)
                    : {})}
              />
            );
          }
          const effectiveColor =
            colorMap && r.spec.lineId !== highlightLineId
              ? (colorMap[r.spec.lineId] ?? r.spec.color)
              : r.spec.color;
          return (
            <StopMarker
              key={'m:' + r.spec.stationId + ':' + r.spec.lineId}
              spec={r.spec}
              effectiveColor={effectiveColor}
              underlayColor={underlayColor}
              lines={lines}
            />
          );
        })}

        {/* station backgrounds: hit areas, names, colored stop squares */}
        {Object.values(stations).map((st) => (
          <StationView
            key={st.id + ':bg'}
            station={st}
            lines={lines}
            zoom={view.viewport.zoom}
            onStartDrag={drag.onStartDrag}
            layer="bg"
          />
        ))}

        {/* station labels: rendered after bg/wash so a selected station's
            accent wash never paints over a neighbor's label. Faded in
            layering mode so the focus stays on the band layers. The
            layout-edited station's label is NOT special-cased here — it (name
            and any inline route bullets) fades under the focus dim with every
            other label; only its dots + editor chrome are lifted above the
            dim. */}
        <g opacity={inLayeringMode ? LAYERING_FADE_OPACITY : 1}>
          {Object.values(stations).map((st) => (
            <StationView
              key={st.id + ':label'}
              station={st}
              lines={lines}
              zoom={view.viewport.zoom}
              onStartDrag={drag.onStartDrag}
              layer="label"
            />
          ))}
        </g>

        {/* Layering-mode dashed outlines: a soft 1.5px dashed footprint per
            non-hovered band stripe, painted ABOVE the colored bands but
            BELOW transfers + station dots so those keep their visual
            primacy. The hovered solid outline + the layer-number labels
            still paint at the very end so they stay on top. */}
        {inLayeringMode && (
          <g data-export-exclude="1">
            <LayeringDashedOutlines
              bands={bandsGeometry}
              lines={lines}
              hovered={hoveredLayerStripe}
            />
          </g>
        )}

        {/* Transfers: user-styled lines connecting two dots. Rendered BEFORE
            the station dots so the dots paint on top — a transfer never
            obscures the dot it's connecting. Stay at full opacity in
            layering mode (they ride between line stops so they're part of
            the route-network reading, not background annotation). */}
        <TransferLayer
          transfers={transfers}
          stations={stations}
          defaults={{
            color: transferColor,
            thickness: transferThickness,
            strokeColor: transferStrokeColor,
            strokeWidth: transferStrokeWidth,
          }}
          selectedId={selection.selectedTransferId}
          onSelect={(id) => {
            if (exitLineEditorOnItemClick()) return;
            selection.selectTransfer(id);
          }}
        />

        {/* In-progress transfer preview line: from the anchor dot to the
            cursor while waiting for the second click. Dashed + translucent so
            it reads as provisional rather than an already-placed transfer;
            renders below the dots for the same reason as the real ones. */}
        {selection.uiMode.kind === 'creating-transfer' &&
          selection.uiMode.anchor &&
          cursorWorld &&
          stations[selection.uiMode.anchor.stationId] &&
          (() => {
            const anchor = selection.uiMode.anchor;
            if (!anchor) return null;
            const anchorWorld = transferEndWorld(stations[anchor.stationId], anchor.lineId);
            return (
              <line
                data-export-exclude="1"
                data-transfer-preview="1"
                x1={anchorWorld.x}
                y1={anchorWorld.y}
                x2={cursorWorld.x}
                y2={cursorWorld.y}
                stroke={transferColor}
                strokeWidth={transferThickness}
                strokeLinecap="round"
                strokeDasharray="6 4"
                opacity={0.6}
                pointerEvents="none"
              />
            );
          })()}

        {/* station dots: above the transfer layer so a dot click routes to
            the station, not the transfer (overlays below — previews, labels,
            snap guides — still paint over the dots) */}
        {Object.values(stations).map((st) =>
          // The layout-edited station is painted above the focus dim instead,
          // so it stays bright and its dots keep their true colors; skip it here.
          st.id === layoutEditStationId ? null : (
            <StationView
              key={st.id + ':dots'}
              station={st}
              lines={lines}
              zoom={view.viewport.zoom}
              onStartDrag={drag.onStartDrag}
              layer="dots"
            />
          ),
        )}

        {/* Station-placing-mode ghost: a faint dot + name following the
            cursor before each click, so the user can see where (and what
            name) the next placement will land. */}
        <g data-export-exclude="1">
          <StationPlacingPreview
            world={selection.uiMode.kind === 'placing-station' ? cursorWorld : null}
            name={placement.previewName}
            lines={lines}
          />
          {/* Label-placing-mode ghost: a faint "New Label" following the cursor
              before the click. Single-shot placement, so it disappears as soon
              as the user clicks (the click handler exits placing-label). */}
          <LabelPlacingPreview
            world={selection.uiMode.kind === 'placing-label' ? cursorWorld : null}
          />
          {/* Polygon-placing-mode ghost: a faint starter square following the
              cursor before the click, matching the shape that will drop. */}
          <PolygonPlacingPreview
            world={selection.uiMode.kind === 'creating-polygon' ? cursorWorld : null}
          />
          {/* Svg-image-placing ghost: the imported graphic at 50% opacity
              following the cursor, centered, until the click drops it. */}
          <SvgImagePlacingPreview
            world={selection.uiMode.kind === 'placing-svg' ? cursorWorld : null}
            image={selection.uiMode.kind === 'placing-svg' ? selection.uiMode.image : null}
          />
          {/* Route-bullet-placing ghost: the default bullet following the
              cursor, matching the badge the click will drop. */}
          <RouteBulletPlacingPreview
            world={selection.uiMode.kind === 'creating-route-bullet' ? cursorWorld : null}
            lines={lines}
            lineOrder={lineOrder}
          />
        </g>

        {/* Route bullets: rendered before the dim so they fade with the
            rest of the map when a line is selected. Faded in layering mode. */}
        <g opacity={inLayeringMode ? LAYERING_FADE_OPACITY : 1}>
          {Object.values(routeBullets).map((b) => (
            <RouteBulletView
              key={b.id}
              bullet={b}
              lines={lines}
              selected={bulletSelectedIds.includes(b.id)}
              inHandMode={inHandMode}
              onPointerDown={itemDrag.onBulletPointerDown}
              onClick={onBulletClick}
              onContextMenu={onBulletContextMenu}
            />
          ))}
        </g>

        {/* Text labels: free-floating annotations on top of stations + bullets
            but beneath the selection stroke ring. Dimmed alongside the rest
            of the map when a line is selected. Faded in layering mode. */}
        <g opacity={inLayeringMode ? LAYERING_FADE_OPACITY : 1}>
          {Object.values(textLabels).map((g) => (
            <LabelView
              key={g.id}
              label={g}
              selected={labelSelectedIds.includes(g.id)}
              layer="bg"
              inHandMode={inHandMode}
              onPointerDown={itemDrag.onLabelPointerDown}
              onClick={onLabelClick}
              onContextMenu={onLabelContextMenu}
            />
          ))}
        </g>

        {/* Line-selection highlight: dim wash + re-painted selected line on
            top. Painted after dots so other lines' stop dots can't punch
            through the selected line's outline. */}
        {highlightLineId && (
          <g data-export-exclude="1">
            <HighlightedLineLayer
              highlightLineId={highlightLineId}
              lines={lines}
              stations={stations}
              renderables={renderables}
              underlayColor={underlayColor}
              hoveredInspectorSegment={selection.hoveredInspectorSegment}
              uiMode={selection.uiMode}
              zoom={view.viewport.zoom}
              onStartDrag={drag.onStartDrag}
              vbX={overdrawn.vbX}
              vbY={overdrawn.vbY}
              vbW={overdrawn.vbW}
              vbH={overdrawn.vbH}
            />
          </g>
        )}

        {/* Line tags: in-band labels that ride each line's stripe. Faded
            in layering mode so the tag text doesn't compete with the
            outline + layer-number overlays. */}
        <g opacity={inLayeringMode ? LAYERING_FADE_OPACITY : 1}>
          <LineTagsLayer bands={bands} zoom={view.viewport.zoom} svgRef={svgRef} />
        </g>

        {/* Match-stroke: gray outline on each station whose layout matches
            the selected station while mirror mode is on. Drawn beneath the
            selection stroke so the selected station's black outline still
            stands out. */}
        <g data-export-exclude="1">
          {matchingIds.map(
            (sid) =>
              stations[sid] && (
                <StationView
                  key={sid + ':match-stroke'}
                  station={stations[sid]}
                  lines={lines}
                  zoom={view.viewport.zoom}
                  onStartDrag={drag.onStartDrag}
                  layer="match-stroke"
                />
              ),
          )}
        </g>

        {/* selection stroke: 2px black ring around the merged silhouette,
            painted on top of everything so the outline is never occluded.
            One per selected station (or per previewed station during a
            rect-select drag). The layout-edited station is skipped — it gets a
            white border painted above the focus dim, in the block below. */}
        <g data-export-exclude="1">
          {washIds.map(
            (sid) =>
              stations[sid] &&
              sid !== layoutEditStationId && (
                <StationView
                  key={sid + ':stroke'}
                  station={stations[sid]}
                  lines={lines}
                  zoom={view.viewport.zoom}
                  onStartDrag={drag.onStartDrag}
                  layer="stroke"
                />
              ),
          )}
        </g>

        {/* Selection stroke for text labels: dashed black ring around each
            selected label's rotated bbox. Painted in this pass so it sits
            above the dim overlay and on top of the network — matching how
            stations and bullets handle their outlines. */}
        <g data-export-exclude="1">
          {labelSelectedIds.map(
            (gid) =>
              textLabels[gid] && (
                <LabelView key={gid + ':stroke'} label={textLabels[gid]} selected layer="stroke" />
              ),
          )}
        </g>

        {/* Selected-item drag proxies: a transparent hit target per selected,
            unlocked item, painted ABOVE all map content so a selected item wins
            the DRAG over whatever is stacked above it — a selected polygon under
            a station drags the polygon, not the station. onPointerDown routes to
            the item's body drag handler. CLICK / right-click do NOT act on the
            proxy: the SVG's onClickCapture/onContextMenuCapture intercept them and
            re-dispatch to the real element beneath, so SELECTION follows normal
            layer order (see rerouteProxyEventBeneath). That capture-phase
            stopPropagation also means the proxies' own onClick/onContextMenu never
            fire — hence the no-ops. Emitted in body paint order (polygon → svg
            image → station → bullet → label) so when two SELECTED items overlap,
            the one painted higher still wins its grab. The polygon/svg-image
            MANIPULATION handle passes come AFTER this layer in the SVG (they
            paint on top and win hit-testing), so a selected item's own
            corner/vertex handles still beat its body proxy. These iterate the
            same preview-aware id lists as the handle overlays, harmless
            mid-marquee since useRectSelect captures the pointer on first move.
            Excluded from export — pure interaction chrome. */}
        <g ref={proxyLayerRef} data-export-exclude="1">
          {polygonSelectedIds.map((pid) =>
            polygons[pid] ? (
              <PolygonView
                key={pid + ':hit'}
                polygon={polygons[pid]}
                layer="hit"
                selected
                selectedVertexIndices={NO_VERTEX_INDICES}
                interactive={polygonsInteractive}
                inHandMode={inHandMode}
                onPointerDown={polyDrag.onPolygonPointerDown}
                onClick={proxyClickNoop}
                onContextMenu={proxyClickNoop}
                onVertexPointerDown={polyDrag.onVertexPointerDown}
                onVertexClick={onVertexClick}
                onEdgeAddPointerDown={polyDrag.onEdgeAddPointerDown}
              />
            ) : null,
          )}
          {svgImageSelectedIds.map((iid) =>
            svgImages[iid] ? (
              <SvgImageView
                key={iid + ':hit'}
                image={svgImages[iid]}
                layer="hit"
                selected
                interactive={polygonsInteractive}
                inHandMode={inHandMode}
                onPointerDown={svgDrag.onSvgImagePointerDown}
                onClick={proxyClickNoop}
                onContextMenu={proxyClickNoop}
                onCornerPointerDown={svgDrag.onSvgCornerPointerDown}
                onEdgePointerDown={svgDrag.onSvgEdgePointerDown}
                onRotatePointerDown={svgDrag.onSvgRotatePointerDown}
              />
            ) : null,
          )}
          {washIds.map((sid) =>
            stations[sid] && !stations[sid].locked ? (
              <StationView
                key={sid + ':hit'}
                station={stations[sid]}
                lines={lines}
                zoom={view.viewport.zoom}
                onStartDrag={drag.onStartDrag}
                layer="hit"
              />
            ) : null,
          )}
          {bulletSelectedIds.map((id) =>
            routeBullets[id] ? (
              <RouteBulletView
                key={id + ':hit'}
                bullet={routeBullets[id]}
                lines={lines}
                selected
                layer="hit"
                inHandMode={inHandMode}
                onPointerDown={itemDrag.onBulletPointerDown}
                onClick={proxyClickNoop}
                onContextMenu={proxyClickNoop}
              />
            ) : null,
          )}
          {labelSelectedIds.map((id) =>
            textLabels[id] ? (
              <LabelView
                key={id + ':hit'}
                label={textLabels[id]}
                selected
                layer="hit"
                inHandMode={inHandMode}
                onPointerDown={itemDrag.onLabelPointerDown}
                onClick={proxyClickNoop}
                onContextMenu={proxyClickNoop}
              />
            ) : null,
          )}
        </g>

        {/* Polygon selection overlay: dashed outline, vertex handles, and edge
            "+" buttons. Painted in this top pass so the handles stay clickable
            above all map content. Only selected polygons render here. Excluded
            from image export — it's selection chrome, not map content (the
            polygon bodies above ARE exported). */}
        <g data-export-exclude="1">
          {polygonSelectedIds.map(
            (pid) =>
              polygons[pid] && (
                <PolygonView
                  key={pid + ':overlay'}
                  polygon={polygons[pid]}
                  layer="overlay"
                  selected
                  selectedVertexIndices={vertexIndicesFor(pid)}
                  interactive={polygonsInteractive}
                  onPointerDown={polyDrag.onPolygonPointerDown}
                  onClick={onPolygonClick}
                  onContextMenu={onPolygonContextMenu}
                  onVertexPointerDown={polyDrag.onVertexPointerDown}
                  onVertexClick={onVertexClick}
                  onEdgeAddPointerDown={polyDrag.onEdgeAddPointerDown}
                />
              ),
          )}
        </g>

        {/* Svg-image transform handles (corners, edges, rotation knob). Top
            pass so they stay clickable above all content; only selected images
            render here. Excluded from image export — selection chrome, not map
            content (the image bodies above ARE exported). */}
        <g data-export-exclude="1">
          {svgImageSelectedIds.map(
            (iid) =>
              svgImages[iid] && (
                <SvgImageView
                  key={iid + ':overlay'}
                  image={svgImages[iid]}
                  layer="overlay"
                  selected
                  interactive={polygonsInteractive}
                  inHandMode={inHandMode}
                  onPointerDown={svgDrag.onSvgImagePointerDown}
                  onClick={onSvgImageClick}
                  onContextMenu={onSvgImageContextMenu}
                  onCornerPointerDown={svgDrag.onSvgCornerPointerDown}
                  onEdgePointerDown={svgDrag.onSvgEdgePointerDown}
                  onRotatePointerDown={svgDrag.onSvgRotatePointerDown}
                />
              ),
          )}
        </g>

        {/* Rubber-band rect for the rect-select gesture. World coords; the
            stroke width compensates for zoom so the dashed line stays a
            consistent screen weight. */}
        {rectSelect.rect && (
          <rect
            data-export-exclude="1"
            x={Math.min(rectSelect.rect.x0, rectSelect.rect.x1)}
            y={Math.min(rectSelect.rect.y0, rectSelect.rect.y1)}
            width={Math.abs(rectSelect.rect.x1 - rectSelect.rect.x0)}
            height={Math.abs(rectSelect.rect.y1 - rectSelect.rect.y0)}
            fill={theme.accentWash}
            stroke={theme.accent}
            strokeWidth={1.5 / view.viewport.zoom}
            strokeDasharray={`${4 / view.viewport.zoom} ${3 / view.viewport.zoom}`}
            pointerEvents="none"
          />
        )}

        {/* Snap guides: rendered last so the dotted lines + measurement
            labels sit on top of line tags and everything else. */}
        <g data-export-exclude="1">
          <SnapGuides
            guides={[
              ...drag.snapGuides,
              ...itemDrag.itemSnapGuides,
              ...polyDrag.polygonSnapGuides,
              ...svgDrag.svgImageSnapGuides,
              ...placementGuides,
            ]}
            zoom={view.viewport.zoom}
          />
        </g>

        {/* Station-layout-editor focus dim (editing-station-layout mode):
            mutes the whole map so the mode is unmistakable and the overlays
            read. The edited station's own content (white border, dots, label,
            grab rings + direction arrows) is painted at the very END of the
            SVG, AFTER the routing-warning markers, so those markers can never
            cover its click targets. Same focus language as the line-selection
            highlight; chrome, excluded from export. */}
        {layoutEditStation && theme.dimOpacity > 0 && (
          <rect
            data-export-exclude="1"
            data-dim="1"
            x={overdrawn.vbX}
            y={overdrawn.vbY}
            width={overdrawn.vbW}
            height={overdrawn.vbH}
            fill={theme.dim}
            fillOpacity={theme.dimOpacity}
            pointerEvents="none"
          />
        )}

        {/* Layering-mode top overlays: the hovered-stripe solid outline +
            small layer-number labels. Painted at the very end of the SVG
            so they stay on top of station dots, transfers, and every other
            line — the click target and the layer number stay readable
            regardless of how busy the canvas is underneath. The dashed
            footprint is rendered earlier (above) so dots and transfers
            paint over it. */}
        {inLayeringMode && (
          <g data-export-exclude="1">
            <LayeringHoverOutline
              bands={bandsGeometry}
              lines={lines}
              hovered={hoveredLayerStripe}
            />
            <LayerNumberLabels bands={bandsGeometry} lines={lines} hovered={hoveredLayerStripe} />
          </g>
        )}

        {/* Routing warnings: a red+white frame around each unrouteable band's
            crude straight segment plus a ⚠ over its center. Painted at the
            very end of the SVG so the marker draws on top of every stripe,
            dot, and label and is never occluded. The ⚠ takes whichever of
            black/white is legible against the stripe under its center. */}
        <g data-export-exclude="1" data-band-warnings="1">
          {bands.map((b) => {
            if (!b.warning) return null;
            // Color under the glyph = the band's center stripe, resolved the
            // same way SegmentBand paints it (desaturation override, else live).
            const centerId = b.lines[Math.floor(b.lines.length / 2)]?.id;
            const centerColor = centerId
              ? (colorMap?.[centerId] ?? lines[centerId]?.color)
              : undefined;
            const iconColor = centerColor ? legibleTextOn(centerColor) : '#000';
            return <BandWarning key={'w:' + b.bandKey} spec={b} iconColor={iconColor} />;
          })}
        </g>

        {/* Layout-editor focus content, painted at the very END of the SVG so
            it sits ABOVE the routing-warning markers, which would otherwise
            cover the edited station's dots + direction arrows (the click
            targets you reach for exactly when a routing warning appears). The
            dim is painted much earlier, below the warnings, so the warnings
            stay visible beneath this content. */}
        {layoutEditStation && (
          <>
            {/* White selection border, above the dim. The base stroke pass
                skips this station's themed (black) border; white reads on the
                darkened backdrop in both themes. */}
            <g data-export-exclude="1">
              <StationView
                station={layoutEditStation}
                lines={lines}
                zoom={view.viewport.zoom}
                onStartDrag={drag.onStartDrag}
                layer="stroke"
                strokeColor="#ffffff"
              />
            </g>
            {/* Stop dots at full strength — the thing you're editing. Skipped
                in the base dots pass, so this is a move, not a duplicate: one
                hit-seam per dot. Real map content, so NOT export-excluded. The
                label is intentionally NOT re-painted here; it fades under the
                dim in the base pass. */}
            <g pointerEvents="none">
              <StationView
                station={layoutEditStation}
                lines={lines}
                zoom={view.viewport.zoom}
                onStartDrag={drag.onStartDrag}
                layer="dots"
              />
            </g>
            {/* Grab rings + direction arrows on top (interactive chrome). */}
            <g data-export-exclude="1">
              <StationLayoutEditor
                station={layoutEditStation}
                lines={lines}
                zoom={view.viewport.zoom}
                onStartNodeDrag={layoutDrag.onStartNodeDrag}
                swapTarget={
                  layoutDrag.overlay?.over?.kind === 'stop' ? layoutDrag.overlay.over : null
                }
              />
            </g>
            {/* Ghost lattice during a layout drag, above the dots so drop
                targets stay readable. */}
            {layoutDrag.overlay && stations[layoutDrag.overlay.stationId] && (
              <g data-export-exclude="1">
                <GhostLattice
                  ghosts={layoutDrag.overlay.ghosts}
                  over={layoutDrag.overlay.over?.kind === 'ghost' ? layoutDrag.overlay.over : null}
                  station={stations[layoutDrag.overlay.stationId]}
                  zoom={view.viewport.zoom}
                  dropR={
                    layoutDrag.overlay.source.kind === 'stop'
                      ? lineWidthOf(lines[layoutDrag.overlay.source.lineId]) / 2
                      : STOP_SIZE / 2
                  }
                />
              </g>
            )}
          </>
        )}
      </svg>

      <ItemPopovers view={view} />

      <WarningToasts bands={bands} />
    </div>
  );
}
