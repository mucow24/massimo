import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { cancelAppendMode, dragState, useDoc, useSelection } from '../state/store';
import { useRenderDoc } from '../state/renderDoc';
import { useDragFrame } from '../state/dragFrame';
import { reportSyncRegionCost } from '../worker/regionPipeline';
import { isHistoryGrouping } from '../state/history';
import { hoveredChrome, type HoverKind } from '../state/selection';
import { useSnapPrefs } from '../state/snapPrefs';
import { useFontEpochValue } from '../state/fontEpoch';
import { useViewportStore } from '../state/viewportStore';
import { useThemeColors } from '../state/theme';
import type { SnapGuide } from '../geometry/snap';
import {
  buildBandGeometry,
  buildOrderedRenderables,
  buildStopMarkers,
  stopPosWorld,
  withLinePriorities,
  SegmentBandSpec,
} from '../geometry/interlining';
import { edgeEndpoints } from '../model/lineTopology';
import { pairKeyOf } from '../model/pairKey';
import { decideCanvasClick, decideSegmentClick, nextSegmentStyle } from '../model/appendGestures';
import { effectiveBackgroundOrder, type ItemRef } from '../model/transforms';
import { TRANSFER_STYLE_DEFAULTS, resolveTransferStyle } from '../model/transferStyle';
import { resolveDayNight } from '../model/dayNightColor';
import { defaultStyleProps } from '../model/styles';
import { rotateItemOnContextMenu } from './canvas/groupRotate';
import { legibleTextOn } from '../util/color';
import { BandWarning, SegmentBand } from './SegmentBand';
import { RegionExcludeClips, regionExcludeClipId } from './canvas/RegionExcludeClips';
import { regionsFor } from '../geometry/regionCache';
import {
  armCoverId,
  buildExclusionHolesCached,
  edgeCoverId,
  regionClipBounds,
  regionPaintPlan,
  resolveRegionWinners,
} from '../geometry/lineRegions';
import { HatchPatterns } from './HatchPatterns';
import { StopMarker } from './StopMarker';
import { StopGlyph } from './StopGlyph';
import { resolveDotStyle } from '../model/dotStyle';
import { dotSizeOverride } from '../model/dotSize';
import { StationView } from './StationView';
import { useViewport } from './canvas/useViewport';
import { overdrawnViewBox, panSurfaceViewBox } from './canvas/viewportMath';
import { useStationDrag } from './canvas/useStationDrag';
import { useLineCircleDrag } from './canvas/useLineCircleDrag';
import { LineCircleView } from './LineCircleView';
import { useGuideDrag } from './canvas/useGuideDrag';
import { GuideView } from './GuideView';
import { GuideWells } from './canvas/GuideWells';
import { CircleDiameterLabel, LineCirclePlacingPreview } from './canvas/LineCirclePlacingPreview';
import { useStationLayoutDrag } from './canvas/useStationLayoutDrag';
import { StationLayoutEditor } from './canvas/StationLayoutEditor';
import { GhostLattice } from './canvas/GhostLattice';
import { SwapPreview } from './canvas/SwapPreview';
import { stationCircle } from '../geometry/lineCircle';
import { lineWidthOf } from '../model/lineWidth';
import { lineStrokeRailWidth, lineStrokeWidthOf } from '../model/lineStroke';
import { useRectSelect } from './canvas/useRectSelect';
import {
  appendCursorRef,
  currentHitEntity,
  LOCKED_HIT_PAD_PX,
  lockedDispatchTarget,
  lockedHitsAt,
  mergeLockedIntoStack,
  nextInStack,
  resolveAppendStack,
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
import { RegionModeOverlay } from './canvas/RegionModeOverlay';
import { StationPlacingPreview } from './canvas/StationPlacingPreview';
import { PolygonPlacingPreview } from './canvas/PolygonPlacingPreview';
import { SvgImagePlacingPreview } from './canvas/SvgImagePlacingPreview';
import { RouteBulletPlacingPreview } from './canvas/RouteBulletPlacingPreview';
import { AnchorPlacingPreview } from './canvas/AnchorPlacingPreview';
import { HighlightedLineLayer } from './canvas/HighlightedLineLayer';
import { LabelPlacingPreview } from './canvas/LabelPlacingPreview';
import { RouteBulletView, RouteBulletSelectionRing } from './RouteBulletView';
import { LabelView } from './LabelView';
import { PolygonView, PolygonSelectionOutline } from './PolygonView';
import { SvgImageView, SvgImageSelectionBox } from './SvgImageView';
import { ItemPopovers } from './canvas/ItemPopovers';
import { snapPlacement, usePlacementDispatch } from './canvas/usePlacementDispatch';
import { TransferLayer, TransferSelectionOutline } from './TransferLayer';
import { AnchorLayer } from './canvas/AnchorLayer';
import { pickTransferEnd } from '../state/transferPick';
import { revealedAnchorStations } from '../state/anchorVisibility';
import { kindVisible, type VisibilityKey } from '../state/visibility';
import { isFreeAnchorEnd } from '../model/transferAnchors';
import { transferEndWorld } from '../geometry/transferEnds';
import {
  anchorFromArcLen,
  closestParamOnOffsetPath,
  LINE_TAG_SNAP_TOLERANCE,
  lineTraversesForwardCanon,
  offsetPathLength,
  sampleOffsetPath,
  snapNeighborTag,
} from '../geometry/lineTagGeometry';
import type { LineId, StationId, Transfer, TransferDrawOrder, TransferEnd } from '../model/types';
import { findMatchingStations } from '../model/matching';
import { desaturateColor } from '../util/color';

// The dot stack, bottom-up: each sub-pass layer paired with the LIFTED transfer
// rung mounted immediately after it. Pairs rather than two arrays read by
// index, so a rung can't silently slide onto the wrong pass. The fourth rung,
// 'under', sits below the whole stack and is mounted on its own. See
// TransferDrawOrder.
const DOT_STACK: readonly (readonly [
  'dot-silhouettes' | 'dot-bodies' | 'dot-codes',
  TransferDrawOrder,
])[] = [
  ['dot-silhouettes', 'over-stroke'],
  ['dot-bodies', 'over-dot'],
  ['dot-codes', 'over-code'],
];

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

// Shared empty free-anchor map: the hover/selection reveal shows a station's
// own anchors only, so it hands AnchorLayer nothing for the free home.
const NO_FREE_ANCHORS: Record<string, never> = {};

// What a View-menu-hidden collection resolves to. One frozen instance so a
// hidden kind's `useMemo` deps (backgroundRenderOrder) stay reference-stable
// across renders instead of invalidating on every pan.
const EMPTY_RECORD: Record<string, never> = {};

export function MapCanvas() {
  // The seven collections a geometry gesture can move per frame read the
  // RENDER SOURCE, not the live doc: mid-drag the pipeline serves frame N-1
  // there while the doc runs ahead, and every painted surface derived from
  // these bindings lags coherently with it (see state/renderDoc.ts). At rest
  // the two stores are reference-identical. Everything that cannot change
  // mid-drag — lines, order, styles, transfers, assignments — and every
  // ACTION stays on useDoc.
  const stations = useRenderDoc((s) => s.stations);
  const lineCircles = useRenderDoc((s) => s.lineCircles);
  const guides = useRenderDoc((s) => s.guides);
  const routeBulletsAll = useRenderDoc((s) => s.routeBullets);
  const transferAnchors = useRenderDoc((s) => s.transferAnchors);
  const textLabelsAll = useRenderDoc((s) => s.textLabels);
  const polygonsAll = useRenderDoc((s) => s.polygons);
  const svgImagesAll = useRenderDoc((s) => s.svgImages);
  const lines = useDoc((s) => s.lines);
  const lineOrder = useDoc((s) => s.lineOrder);
  const rotateLineCircle = useDoc((s) => s.rotateLineCircle);
  const addLineTag = useDoc((s) => s.addLineTag);
  const assignRegions = useDoc((s) => s.assignRegions);
  const setLineSegmentStyle = useDoc((s) => s.setLineSegmentStyle);
  const toggleEdgeOnLine = useDoc((s) => s.toggleEdgeOnLine);
  const removeStationFromLine = useDoc((s) => s.removeStationFromLine);
  const rotateRouteBullet = useDoc((s) => s.rotateRouteBullet);
  const transfers = useDoc((s) => s.transfers);
  const styles = useDoc((s) => s.styles);
  const styleDefaults = useDoc((s) => s.styleDefaults);
  const rotateTextLabel = useDoc((s) => s.rotateTextLabel);
  const backgroundOrder = useDoc((s) => s.backgroundOrder);
  const rotatePolygon = useDoc((s) => s.rotatePolygon);
  const regionAssignments = useDoc((s) => s.regionAssignments);
  const rotateSvgImage45 = useDoc((s) => s.rotateSvgImage45);
  const selection = useSelection();
  const snapModes = useSnapPrefs((s) => s.modes);
  const gridVisible = useViewportStore((s) => s.gridVisible);
  const gridSize = useViewportStore((s) => s.gridSize);
  // Draw the line/station network at all? Off = only the background art
  // (polygons, images) and the grid, so buried art is clickable. Stations
  // self-gate inside StationView (one chokepoint for ~15 call sites); lines and
  // everything anchored to them are gated at the blocks below.
  const showNetwork = useViewportStore((s) => s.showNetwork);
  // The narrow View-menu toggles (state/visibility.ts). The four free-item kinds
  // are gated by EMPTYING their record here rather than at each paint: every one
  // of them renders across a body pass, a hover preview, a selection overlay and
  // a top-z drag proxy, and a gate written four times is a gate that gets missed
  // once. Emptying also takes the pointer surface with it, which is the point —
  // "hidden" has to mean click-through, not merely invisible.
  //
  // Only these four can be emptied. `lineCircles` and `transfers` feed GEOMETRY
  // (band routing and stop metrics respectively), so hiding either by emptying
  // would move ink that is still on screen; those two are gated at their paints.
  // `kindVisible` folds in the placing-mode reveal, so hiding a layer and then
  // reaching for its own tool still shows what the click drops — and the
  // nesting under `showNetwork`, so the kinds that ride with the stations go
  // when they do without a `showNetwork &&` written out at each of their sites.
  const shows = (key: VisibilityKey, flag: boolean) =>
    kindVisible(key, { flag, showNetwork, modeKind: selection.uiMode.kind });
  const showPolygons = shows(
    'showPolygons',
    useViewportStore((s) => s.showPolygons),
  );
  const showSvgImages = shows(
    'showSvgImages',
    useViewportStore((s) => s.showSvgImages),
  );
  const showTextLabels = shows(
    'showTextLabels',
    useViewportStore((s) => s.showTextLabels),
  );
  const showRouteBullets = shows(
    'showRouteBullets',
    useViewportStore((s) => s.showRouteBullets),
  );
  const showLineCircles = shows(
    'showLineCircles',
    useViewportStore((s) => s.showLineCircles),
  );
  const showGuides = shows(
    'showGuides',
    useViewportStore((s) => s.showGuides),
  );
  // Transfers and anchors ride with the network — a transfer runs between
  // stations and an anchor hangs off one — and `shows` carries that nesting, so
  // neither needs a `showNetwork &&` of its own here.
  const transfersVisible = shows(
    'showTransfers',
    useViewportStore((s) => s.showTransfers),
  );
  const anchorsVisible = shows(
    'showAnchors',
    useViewportStore((s) => s.showAnchors),
  );
  const polygons = showPolygons ? polygonsAll : EMPTY_RECORD;
  const svgImages = showSvgImages ? svgImagesAll : EMPTY_RECORD;
  const textLabels = showTextLabels ? textLabelsAll : EMPTY_RECORD;
  const routeBullets = showRouteBullets ? routeBulletsAll : EMPTY_RECORD;
  // Re-render (and therefore re-measure) the whole canvas when the web fonts
  // land. The epoch lives in a store rather than in App state so it can also
  // punch through StationView's memo; MapCanvas subscribes too so the layers it
  // renders DIRECTLY — free text labels, line tags, route bullets — re-measure
  // with it instead of riding on an App-level re-render.
  useFontEpochValue();
  // For resolving theme-aware (day/night) transfer colors on the creation preview.
  const darkMode = useDoc((s) => s.darkMode);
  const theme = useThemeColors();
  // Gap/underlay color for dashed + hatched styles: matches the canvas
  // background so the "off" stripes read as empty canvas, not stale white.
  const underlayColor = theme.underlay;
  const highlightLineId = selection.selectedLineId;
  // The line Edit Stops is editing, or null outside the mode. Always equals
  // highlightLineId while the mode runs (entering it selects the line), but the
  // MODE is what the editor's chrome and its lifted hit layer key off.
  const appendLineId =
    selection.uiMode.kind === 'appending-to-line' ? selection.uiMode.lineId : null;

  const svgRef = useRef<SVGSVGElement | null>(null);
  // The selected-item drag-proxy layer. Proxies sit on top so a SELECTED item
  // wins the DRAG over anything stacked above it. A click / right-click on a
  // proxy is re-routed to the real element beneath (rerouteProxyEventBeneath),
  // so SELECTION still follows normal layer order — only dragging gets
  // selected-item priority. The ref is used to scope "is this event on a proxy?"
  // and to momentarily hide the layer for the beneath hit-test.
  const proxyLayerRef = useRef<SVGGElement | null>(null);
  // The composited pan layer wrapping the svg. A pan translates THIS div —
  // compositor-only, no repaint — instead of rewriting the viewBox, which
  // re-lays-out/re-paints/re-rasters the whole svg every frame (Blink has no
  // fast path for svg-root or inner-<g> transforms). See useViewport.
  const panLayerRef = useRef<HTMLDivElement | null>(null);
  const view = useViewport(svgRef, panLayerRef);
  // Full-viewport overlays (background, grid, dim wash) are drawn at this
  // overdrawn extent so a mid-gesture camera (composited pan translate, or a
  // wheel zoom's imperative viewBox write) can't reveal a bare strip before
  // the gesture commits and re-renders them. See overdrawnViewBox.
  const overdrawn = overdrawnViewBox(view);
  // The window the (oversized) svg element actually renders: the visible box
  // grown half a viewport per side, matching .canvas-pan-layer{inset:-50%}.
  const surface = panSurfaceViewBox(view);
  const placement = usePlacementDispatch(view);
  const drag = useStationDrag(svgRef, view.viewport.zoom);
  const circleDrag = useLineCircleDrag(svgRef, view.viewport.zoom);
  const guideDrag = useGuideDrag(svgRef, view.viewport.zoom, view.screenToWorld);
  const rectSelect = useRectSelect(svgRef, view.screenToWorld);
  // While a rect-select drag is in flight, render selection visuals
  // (station wash/stroke and bullet ring) over the previewed result
  // instead of the live selection so the user sees exactly what'll be
  // selected on release.
  const washIds = rectSelect.previewStationIds ?? selection.selectedStationIds;
  // Canvas mouseover preview: the item under the pointer paints its selection
  // chrome at 50% opacity (a "clickable" affordance). The selector already
  // gates on idle-mode / not-panning / not-already-selected; each render block
  // below picks off the kind it draws. Line tags handle their own hover inside
  // LineTagsLayer (their chrome isn't reachable from here), and a line circle
  // paints its own in place: its chrome is a recolour of the guide, which must
  // stay down in the guide layer rather than surface over the map content.
  const hover = hoveredChrome(selection);
  const hoverStationId = hover?.kind === 'station' ? hover.id : null;
  const hoverTransferId = hover?.kind === 'transfer' ? hover.id : null;
  const hoverBulletId = hover?.kind === 'bullet' ? hover.id : null;
  const hoverLabelId = hover?.kind === 'label' ? hover.id : null;
  const hoverPolygonId = hover?.kind === 'polygon' ? hover.id : null;
  const hoverSvgImageId = hover?.kind === 'svgImage' ? hover.id : null;
  const hoverLineCircleId = hover?.kind === 'lineCircle' ? hover.id : null;
  const hoverGuideId = hover?.kind === 'guide' ? hover.id : null;
  // Small helper for the enter/leave handlers each item's body wires up: set on
  // enter, clear on leave only if THIS item is still the hovered one (fresh
  // read, so a fast cross to a neighbor can't wipe the neighbor).
  const setHover = selection.setHoveredCanvasItem;
  const clearHoverIf = (kind: HoverKind, id: string) => {
    const h = useSelection.getState().hoveredCanvasItem;
    if (h && h.kind === kind && h.id === id) setHover(null);
  };
  // Every transfer's rung resolved ONCE per render, into the four buckets the
  // four mounts below take verbatim. The alternative — each mount filtering the
  // whole collection — resolves a style object per transfer per rung, four
  // times over, on a per-frame path.
  const transfersByRung = useMemo(() => {
    const byRung: Record<TransferDrawOrder, Transfer[]> = {
      under: [],
      'over-stroke': [],
      'over-dot': [],
      'over-code': [],
    };
    for (const t of Object.values(transfers)) {
      // Resolved, not the raw override: an absent field means the default
      // rung, not "no rung".
      byRung[resolveTransferStyle(t, TRANSFER_STYLE_DEFAULTS).draw].push(t);
    }
    return byRung;
  }, [transfers]);
  // One draw rung's transfer bodies. Mounted four times below — once at each
  // slot in the stop-dot stack (see TransferDrawOrder) — so the whole
  // interleave stays one expression per rung and the four can't drift in how
  // they select or hover. Each mount renders nothing when its rung is empty,
  // which is every rung but 'under' on a map that never touched the axis.
  const transferRung = (draw: TransferDrawOrder) =>
    transfersVisible ? (
      <TransferLayer
        transfers={transfersByRung[draw]}
        stations={stations}
        transferAnchors={transferAnchors}
        defaults={TRANSFER_STYLE_DEFAULTS}
        onSelect={(id) => {
          // Same exit-then-select contract as the free items above.
          const sel = useSelection.getState();
          if (sel.uiMode.kind === 'appending-to-line') sel.setAppending(null);
          sel.selectTransfer(id);
        }}
        onHoverEnter={(id) => setHover({ kind: 'transfer', id })}
        onHoverLeave={(id) => clearHoverIf('transfer', id)}
      />
    ) : null;
  const bulletSelectedIds = rectSelect.previewBulletIds ?? selection.selectedRouteBulletIds;
  const labelSelectedIds = rectSelect.previewLabelIds ?? selection.selectedLabelIds;
  const polygonSelectedIds = rectSelect.previewPolygonIds ?? selection.selectedPolygonIds;
  const svgImageSelectedIds = rectSelect.previewSvgImageIds ?? selection.selectedSvgImageIds;
  const anchorSelectedIds = rectSelect.previewAnchorIds ?? selection.selectedAnchorIds;
  // Paint order for the background band: polygons and svg images share ONE
  // stack, so either kind can sit over the other. Later = on top.
  const backgroundRenderOrder = useMemo(
    () => effectiveBackgroundOrder(polygons, svgImages, backgroundOrder),
    [polygons, svgImages, backgroundOrder],
  );
  // While a click-to-place tool is active (any non-idle mode), polygon bodies
  // ignore pointer events so a canvas click places the item over them instead
  // of selecting the polygon.
  const polygonsInteractive = selection.uiMode.kind === 'idle';
  // Anchors stay live in ONE non-idle mode: picking transfer ends, which is the
  // entire reason they exist. Everywhere else they must read as background, or
  // an anchor painted over the drop point swallows the click that placement /
  // layering / Edit Stops / layout-edit modes use to place or to EXIT.
  // FREE anchors are live in idle (select/drag) and while picking transfer
  // ends. HOSTED anchors are live ONLY while picking: on the main map they are
  // station-grid cells, so outside that gesture they stay click-through and a
  // click lands on the station beneath, exactly as a stop dot does.
  const pickingTransferEnd = selection.uiMode.kind === 'creating-transfer';
  const freeAnchorsLive = selection.uiMode.kind === 'idle' || pickingTransferEnd;

  // Geometry hash for buildBandGeometry's inputs: line topology (the `edges`
  // SET) + per-line width + interline gap + curve radius. Topology is `edges`,
  // not the `stations` member list — buildBandGeometry iterates edges, and a
  // display-only reorder of `stations` must NOT churn geometry (so `edges`, not
  // `stations`, is hashed; adding/removing an edge — e.g. closing a loop or
  // branching — changes it and triggers the rebuild). EXCLUDES presentation-only
  // fields so repaints don't churn geometry — `bandsGeometry`'s reference stays
  // stable across them, which the layering-mode memos rely on. Color AND
  // per-segment style are intentionally absent: buildBandGeometry is
  // presentation-blind (stripes resolve both live from `lines`), so a color or
  // style edit repaints WITHOUT a geometry rebuild — and the stop markers, whose
  // footprint DOES depend on style, rebuild via the `renderables` memo's direct
  // `lines` dep. Width, by contrast, IS geometry — it moves the baked paths and
  // changes band merging — so it must be in the hash or width edits never
  // repaint. Curve radius is geometry for the same reason (it moves the baked
  // fillets), and the interline gap likewise (it feeds the merge gate and stripe
  // offsets; in practice every gap write also re-packs stops, which invalidates
  // the stations-side sig, but the hash must not rely on that coupling).
  const linesGeometrySig = useMemo(() => {
    const parts: string[] = [];
    for (const id of Object.keys(lines)) {
      const ln = lines[id];
      parts.push(
        id,
        ln.edges.join('.'),
        String(ln.width ?? ''),
        String(ln.interlineGap ?? ''),
        String(ln.curveRadius ?? ''),
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
      parts.push(id, String(st.x), String(st.y), String(st.rotation), st.circleId ?? '');
      for (const c of st.stops)
        parts.push(c.lineId, String(c.row), String(c.col), c.orientation, c.viaCircle ? '~' : '');
    }
    return parts.join('|');
  }, [stations]);

  // Line circles are geometry too: a viaCircle edge's arc reads the bound
  // circle's center + radius. (In practice every circle move/resize also moves
  // its bound stations, which changes the stations sig — but the hash must not
  // rely on that coupling, same rule as the interline gap above.)
  const circlesGeometrySig = useMemo(() => {
    const parts: string[] = [];
    for (const id of Object.keys(lineCircles)) {
      const c = lineCircles[id];
      parts.push(id, String(c.x), String(c.y), String(c.radius));
    }
    return parts.join('|');
  }, [lineCircles]);

  const bandsGeometry = useMemo(
    () => buildBandGeometry(stations, lines, lineCircles),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stationsGeometrySig, linesGeometrySig, circlesGeometrySig],
  );

  const bands = useMemo(() => {
    // Priorities go on CLONES (withLinePriorities), never on bandsGeometry's
    // own objects: the interlining reuse layer shares those pristine specs
    // across frames and callers (this is also why layering-mode outlines can
    // take `bandsGeometry` directly, without priorities). The clone cache
    // inside withLinePriorities keeps per-spec identity stable across drag
    // frames, so SegmentBand's memo bails out for corridors the drag didn't
    // touch. The spec is presentation-free, so color/style aren't carried
    // here — stripe consumers resolve them live from `lines`, which is why a
    // color/style edit repaints without the (intentionally presentation-
    // blind) geometry memo rebuilding. Per-stripe widths/offsets ARE on the
    // spec — width is geometry (it shapes `paths`), so width edits flow
    // through the geometry rebuild instead.
    return withLinePriorities(bandsGeometry, lines, lineOrder);
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
      // BOTH colors a hatched line can be painted in. The desaturated one is
      // what the main pass uses while a line is selected — but the Edit Stops
      // hover-lift overlay deliberately repaints the hovered foreign line at
      // its RAW color, so emitting only the desaturated pattern leaves that
      // overlay referencing a <pattern> id that is not in <defs> and its
      // hatched segments and stop markers paint nothing at all.
      seen.add(ln.color);
      const desaturated = colorMap?.[ln.id];
      if (desaturated) seen.add(desaturated);
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
  const stopMarkers = useMemo(
    () => buildStopMarkers(stations, lines, lineOrder, bands, lineCircles),
    // buildStopMarkers reads the same station fields the signature hashes,
    // so keying on it (not the stations reference) lets label/dot edits
    // skip the marker rebuild along with band routing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bands, stationsGeometrySig, circlesGeometrySig, lines, lineOrder],
  );
  const renderables = useMemo(
    () => buildOrderedRenderables(bands, stopMarkers, lines),
    [bands, stopMarkers, lines],
  );

  const inHandMode = selection.toolMode === 'hand' || selection.spaceHeld;

  // Region paint machinery: overlap faces + per-face winners + the exclusion
  // clips that realize overrides (see buildExclusionHoles — losers are
  // clipped, winners are never repainted). Computed only when it can matter
  // (layering mode active, stored assignments exist, or some line has
  // multiple ARMS — an unpainted branch mouth clips its through arm by
  // DEFAULT, with no assignment anywhere); regionsFor's
  // sig-keyed cache dedupes against the reconcile step's builds. SYNCHRONOUS
  // on purpose: the clips attach to the LIVE base strokes, so they must be
  // derived from the same geometry the strokes render — a deferred snapshot
  // would tear the clip holes off the moving bands mid-drag.
  // Nothing to reconcile against while the network isn't painted: the exclusion
  // clips attach to base strokes that don't exist, and the clickable faces would
  // float over bands the user can't see. Skipping also spares the app its most
  // expensive pure computation for the duration.
  const hasMultiArmLine = useMemo(
    () => bandsGeometry.some((b) => b.arms.some((a) => (a ?? 0) > 0)),
    [bandsGeometry],
  );
  const needRegions =
    showNetwork &&
    (selection.uiMode.kind === 'layering' ||
      Object.keys(regionAssignments).length > 0 ||
      hasMultiArmLine);
  // The prebuilt pair hands regionsFor this render's own bands + markers so a
  // cache miss doesn't rebuild them: bandsGeometry is the PRISTINE geometry
  // (not the priority-stamped clones), and the markers' stamped priorities are
  // invisible to region geometry (pinned by regionCache.prebuilt.test.ts).
  // Within one render the memos above have already refreshed both for the
  // current stations/lines, so the pair always matches the sig regionsFor
  // computes from them.
  // While the worker pipeline serves holes, the synchronous build stands down
  // entirely — that build is the exact work the pipeline moved off this
  // thread, and the inputs here are the FROZEN render-source slice, so the
  // memo would otherwise recompute it per landed frame. Its other consumers
  // are layering-mode-only (never concurrent with a drag) and tolerate null.
  const pipelineFrame = useDragFrame((s) => s.frame);
  const pipelineHoles = pipelineFrame?.holes ?? null;
  const regionGeom = useMemo(() => {
    if (!needRegions || pipelineHoles) return null;
    // Deliberate impurity: the pipeline's arming signal must measure THIS
    // build, which lives in this memo by design; the report defers its store
    // writes to a microtask, so render stays write-free.
    // eslint-disable-next-line react-hooks/purity
    const t0 = performance.now();
    const geom = regionsFor(
      { stations, lines, lineCircles },
      { bands: bandsGeometry, markers: stopMarkers },
      // Mid-gesture frames are never revisited, so the sig string and
      // LRU bookkeeping are pure waste there — and skipping the inserts
      // PRESERVES the pre-gesture entry for the commit reconcile's
      // old-geometry lookup instead of evicting it within four frames.
      { transient: isHistoryGrouping() },
    );
    // The pipeline's arming signal: a build this expensive during a gesture
    // is worth moving off-thread from the next frame on.
    // eslint-disable-next-line react-hooks/purity
    reportSyncRegionCost(performance.now() - t0);
    return geom;
  }, [needRegions, pipelineHoles, stations, lines, lineCircles, bandsGeometry, stopMarkers]);
  const regionWinners = useMemo(
    () =>
      regionGeom
        ? resolveRegionWinners(regionGeom.faces, regionAssignments, regionGeom.bands, lineOrder)
        : null,
    [regionGeom, regionAssignments, lineOrder],
  );
  // Mid-pipelined-drag the holes are the worker's answer for the armed slice;
  // otherwise the synchronous build, exactly as before.
  const regionExcludeHoles = useMemo(
    () =>
      pipelineHoles ??
      (regionGeom && regionWinners
        ? buildExclusionHolesCached(
            regionGeom.faces,
            regionWinners,
            lineOrder,
            regionGeom.bands,
            regionGeom.markers,
            (lineId) => {
              const line = lines[lineId];
              return line ? lineStrokeRailWidth(lineStrokeWidthOf(line), lineWidthOf(line)) : 0;
            },
            regionGeom.slivers,
            regionGeom.holeChain,
          )
        : null),
    [pipelineHoles, regionGeom, regionWinners, lineOrder, lines],
  );
  // Tight outer bounds for the exclude clips (see regionClipBounds — a huge
  // constant outer rect breaks GPU clip rasterization precision at deep zoom).
  // Computed from this render's own bands + markers (regionGeom holds the same
  // arrays via the prebuilt pair) so it exists while the pipeline serves the
  // holes and regionGeom stands down.
  const regionClipOuter = useMemo(
    () => (needRegions ? regionClipBounds(bandsGeometry, stopMarkers) : null),
    [needRegions, bandsGeometry, stopMarkers],
  );

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
  // A layout drag resolved onto another STOP is a swap, and a swap is its own
  // picture (SwapPreview): the candidate slots have already lost, so the ghost
  // lattice and the amber projection anchor both stand down.
  const layoutSwapTarget =
    layoutDrag.overlay?.over?.kind === 'stop' ? layoutDrag.overlay.over : null;
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
  const [hoveredRegionKey, setHoveredRegionKey] = useState<string | null>(null);
  const inLayeringMode = selection.uiMode.kind === 'layering';
  const [prevLayering, setPrevLayering] = useState(inLayeringMode);
  if (inLayeringMode !== prevLayering) {
    setPrevLayering(inLayeringMode);
    if (!inLayeringMode && hoveredRegionKey) setHoveredRegionKey(null);
  }

  // Stable click handler for a stripe click in idle: goes STRAIGHT into Edit
  // Stops (there is no "selected but not editing" state). Passed to every
  // (memoized) SegmentBand, so it must keep a constant identity across a pan;
  // selection.startAppend is a stable Zustand action.
  const startAppend = selection.startAppend;
  const handleLineSelect = useCallback(
    (lineId: LineId, e: React.MouseEvent<SVGPathElement>) => {
      e.stopPropagation();
      startAppend(lineId);
    },
    [startAppend],
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
      (mode.kind === 'creating-transfer' && mode.firstEnd !== null) ||
      mode.kind === 'placing-station' ||
      mode.kind === 'creating-route-bullet' ||
      mode.kind === 'placing-label' ||
      mode.kind === 'placing-anchor' ||
      mode.kind === 'creating-polygon' ||
      mode.kind === 'placing-line-circle' ||
      mode.kind === 'placing-svg' ||
      // Edit Stops tracks the cursor only while Alt is held (the create-ghost)
      // so the mode's ordinary pointer traffic never re-renders the canvas.
      (mode.kind === 'appending-to-line' && selection.altHeld);
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
    circleDrag.onPointerMove(e);
    guideDrag.onPointerMove(e);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    view.onPointerUp(e);
    drag.onPointerUp(e);
    rectSelect.onPointerUp(e);
    itemDrag.onPointerUp(e);
    polyDrag.onPointerUp(e);
    svgDrag.onPointerUp(e);
    layoutDrag.onPointerUp(e);
    circleDrag.onPointerUp(e);
    guideDrag.onPointerUp(e);
  };
  // A browser pointercancel (pen palm rejection, window switch, capture loss)
  // voids an in-flight gesture with no matching pointerup. Fan it out to every
  // gesture so each disarms its ref instead of leaving it stranded — armed for
  // a later stray move to resume, or for an unrelated pointerup to commit a
  // gesture the user never finished. The doc-mutating drags also roll their
  // live writes back; the pan commits its accumulated delta instead (the
  // viewBox has already visibly moved — snapping back would be jarring); the
  // marquee just clears (it mutates no doc, but its pointerup REPLACES the
  // selection, so a stranded rect must never survive to one). The line-tag
  // drag is window-wired, so it hooks window 'pointercancel' itself instead
  // of appearing here.
  const onPointerCancel = () => {
    view.cancel();
    drag.onPointerCancel();
    rectSelect.onPointerCancel();
    itemDrag.onPointerCancel();
    polyDrag.onPointerCancel();
    svgDrag.onPointerCancel();
    layoutDrag.onPointerCancel();
    circleDrag.onPointerCancel();
    guideDrag.onPointerCancel();
  };

  // Run a DOM hit-test (`element(s)FromPoint`) with the drag-proxy layer hidden,
  // so a selected item's proxy can't shadow the REAL element beneath it, then
  // restore the layer. Shared by every proxy-aware pick — the reroute below and
  // both alt deep-picks — so the hide/restore dance lives in one place.
  const hitTestBeneathProxies = <T,>(probe: () => T): T => {
    const layer = proxyLayerRef.current;
    const prev = layer ? layer.style.display : '';
    if (layer) layer.style.display = 'none';
    const result = probe();
    if (layer) layer.style.display = prev;
    return result;
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
    const beneath = hitTestBeneathProxies(() => document.elementFromPoint(e.clientX, e.clientY));
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
        // The click COUNT rides along: gestures that count clicks themselves
        // (the station's shift+double-click rename) see the second click as a
        // second click even though it landed on a proxy and arrives synthetic.
        detail: e.detail,
        button: type === 'contextmenu' ? 2 : 0,
      }),
    );
  };

  // A line member's stop position (what the user sees), for near/far endpoint
  // ordering when arming an edge cursor. Shared by the append band handlers and
  // the Edit Stops alt-pick.
  const stopPosOf = (lineId: LineId) => (sid: string) => {
    const st = stations[sid];
    const cell = st?.stops.find((c) => c.lineId === lineId);
    return st && cell ? stopPosWorld(cell, st, lineCircles) : null;
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
  // snapshot (via hitTestBeneathProxies). Returns true when the click was
  // handled (callers skip the normal capture path).
  const deepPickAltClick = (e: React.MouseEvent): boolean => {
    if (!e.altKey) return false;
    if (inHandMode || selection.uiMode.kind !== 'idle') return false;
    // The inline rename editor is a foreignObject INSIDE the svg while uiMode
    // stays idle — an alt+click landing on (or near) it must not re-select
    // things beneath the open editor.
    if (selection.editingStationId) return false;
    if (dragState.suppressClick) return false; // post-drag click: the normal path consumes it
    const els = hitTestBeneathProxies(() => document.elementsFromPoint(e.clientX, e.clientY));
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

  // Edit Stops alt-pick: alt-click cycles the overlapping items under the cursor
  // — the same convention as the idle deep-pick — through what the editor can
  // arm: stations (the pen) and the edited line's segments. This is how a short
  // segment buried under its endpoint stations is reached (elementsFromPoint
  // sees the stripe through the station rects). Unlike the idle deep-pick it
  // ARMS the cursor directly — re-dispatching a plain click would MUTATE
  // (connect/splice) in Edit Stops. Nothing to pick here means "let the normal
  // alt handling run" (e.g. alt-click on empty canvas creates a station).
  const appendDeepPick = (e: React.MouseEvent): boolean => {
    // `inHandMode` gate as in the idle sibling above: hand/pan makes every
    // canvas gesture inert, so Space+Alt+click must not splice a station (and
    // burn an undo entry) while nothing else on the canvas responds.
    if (!e.altKey || inHandMode || dragState.suppressClick) return false;
    const mode = selection.uiMode;
    if (mode.kind !== 'appending-to-line') return false;
    const line = lines[mode.lineId];
    if (!line) return false;
    const els = hitTestBeneathProxies(() => document.elementsFromPoint(e.clientX, e.clientY));
    // Only a line MEMBER can hold the cursor, so non-member stations under the
    // cursor drop out of the cycle (they'd arm a stale, immediately-degraded
    // station cursor).
    const members = line.stations as readonly string[];
    const stack = resolveAppendStack(els, mode.lineId).filter(
      (entry) => entry.kind === 'segment' || members.includes(entry.id),
    );
    const next = nextInStack(stack, appendCursorRef(mode.cursor));
    if (!next) return false; // nothing pickable here
    e.stopPropagation();
    if (next.kind === 'station') {
      selection.setAppendCursor({ kind: 'station', stationId: next.id as StationId });
    } else {
      const world = view.screenToWorld(e.clientX, e.clientY);
      // alt=true: an alt-click on the segment already armed is a SPLICE — a new
      // station dropped at the click point and wired into the edge, the same
      // create the alt-click over empty canvas makes. Alt-clicking (cycling
      // onto) a not-yet-armed segment still just arms it.
      const decision = decideSegmentClick(
        line,
        mode.cursor,
        next.id,
        world,
        stopPosOf(mode.lineId),
        true,
      );
      if (decision.kind === 'cursor') selection.setAppendCursor(decision.cursor);
      else if (decision.kind === 'create-splice')
        placement.runAppendCreate(mode.lineId, decision, e);
    }
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
      // Clicking a free item while editing a line's stops exits the editor
      // (back to the main view) AND selects the item — no intermediate state.
      const sel = useSelection.getState();
      if (sel.uiMode.kind === 'appending-to-line') sel.setAppending(null);
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

  // Anchors do NOT go through makeItemClickHandlers. Two reasons, both real:
  //   - its select() forces uiMode to idle, which would kill the very transfer
  //     pick an anchor click is FOR; and
  //   - its onContextMenu unconditionally stopPropagation()s, which would break
  //     the bubble-phase right-click that exits Edit Stops (the station layer
  //     solves the same problem by stripping its handler in that mode).
  // Anchors have nothing to rotate in place, so they get no context menu at
  // all — a co-selected anchor still orbits via rotateItemOnContextMenu when
  // some OTHER item is the right-clicked pivot.
  const onAnchorClick = (end: TransferEnd, e: React.MouseEvent) => {
    if (dragState.suppressClick) return;
    if (inHandMode) return;
    e.stopPropagation();
    const sel = useSelection.getState();
    if (sel.uiMode.kind === 'creating-transfer') {
      // Either home works here — an anchor's whole job is to be a transfer
      // endpoint, and the end carries which one it is.
      pickTransferEnd(end);
      return;
    }
    // Selection is a FREE-anchor concept; a hosted anchor never reaches this
    // line, because it takes no pointer events outside the pick gesture.
    if (isFreeAnchorEnd(end)) {
      if (e.shiftKey && !(e.ctrlKey || e.metaKey)) sel.toggleAnchorSelection(end.anchorId);
      else sel.selectAnchor(end.anchorId);
    }
  };

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
  // Line circles take the same contract as the four free kinds. Their rim also
  // selects at pointer-down (see useLineCircleDrag) — the click half still
  // matters: it carries the Shift-toggle, ignores the click synthesized after a
  // drag (which would otherwise collapse a group selection the drag just moved),
  // and is the deep-pick's way in.
  const { onClick: onLineCircleClick, onContextMenu: onLineCircleContextMenu } =
    makeItemClickHandlers('lineCircle', {
      select: selection.selectLineCircle,
      toggle: selection.toggleLineCircleSelection,
      rotate: rotateLineCircle,
    });
  // Guides carry the same click contract minus the right-click rotate (an
  // axis-aligned infinite line has nothing to rotate), so they skip
  // makeItemClickHandlers — its contextmenu half is the rotate gesture.
  const onGuideClick = (id: string, e: React.MouseEvent) => {
    if (dragState.suppressClick) return;
    if (inHandMode) return;
    e.stopPropagation();
    const sel = useSelection.getState();
    if (sel.uiMode.kind === 'appending-to-line') sel.setAppending(null);
    if (e.shiftKey && !(e.ctrlKey || e.metaKey)) {
      sel.toggleGuideSelection(id);
      return;
    }
    sel.selectGuide(id);
  };
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
    // Shift is additive in every other gesture (item toggle, station toggle,
    // marquee 'add'): a modifier click that MISSES an item is a failed
    // additive click, not a deselect-everything.
    if (e.shiftKey) return;
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
    // apply the same neighbor snap, so the preview always matches the dropped
    // tag. Always on (a tag lines up with its interlined siblings); Shift
    // bypasses. `offset` is the placing stripe's own offset — the alignment is
    // by cross-section, so it must know which stripe the tag lands on.
    const snapTagT = (t: number, offset: number, shiftKey: boolean): number => {
      if (shiftKey) return t;
      return snapNeighborTag({
        candCanonT: t,
        candOffset: offset,
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
        const t = snapTagT(closest.t, offset, e.shiftKey);
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
        const t = snapTagT(closest.t, offset, e.shiftKey);
        const [fromCanon, toCanon] = spec.pairKey.split('|');
        const stripeTotal = offsetPathLength(spec.centerline, spec.radius, offset);
        // Anchor to whichever endpoint is nearer at insertion time.
        const { anchorEnd, distance } = anchorFromArcLen(t * stripeTotal, stripeTotal);
        addLineTag(lineId, fromCanon, toCanon, anchorEnd, distance, 0);
        // Stay in mode (matches + Station behavior).
      },
    };
  };

  // Edit Stops: a stripe click/hover operates on the EDITED line's edge in this
  // band's corridor, and the target is the edited line's OWN stripe. Any OTHER
  // line's stripe — including a co-corridor interlined NEIGHBOR — is a
  // switch-to-that-line target, exactly like a stripe on a corridor the edited
  // line doesn't run. Scoping the segment to the edited line's own stripe (the
  // same key resolveHitStack/resolveAppendStack use for the alt-pick) keeps the
  // hit box symmetric about the highlighted line: bands are mean-centered, so
  // the edited stripe sits at one edge of an interlined band, and letting the
  // neighbor stripe target the segment too spilled a full stripe width of hit
  // area across the inner side only. Plain click arms / disarms the insertion
  // cursor (nearest endpoint first — see decideSegmentClick), shift-click cycles
  // the edge's style. No contextmenu handler on purpose: right-click bubbles to
  // the SVG root and exits the mode (edge removal is the × chip or the Delete
  // key).
  const makeAppendBandHandlers = (spec: SegmentBandSpec) => {
    // The edited line editing THIS corridor via its own stripe, or null (idle,
    // a different corridor, or a foreign/neighbor stripe). `lineId` is the
    // stripe the pointer is actually over — the segment is armed only from the
    // edited line's OWN stripe.
    const ownSegment = (lineId: LineId) => {
      const mode = selection.uiMode;
      if (mode.kind !== 'appending-to-line' || lineId !== mode.lineId) return null;
      const line = lines[mode.lineId];
      if (!line || !line.edges.includes(spec.pairKey)) return null;
      return { cursor: mode.cursor, line };
    };
    // A pointer over some OTHER real line's stripe (co-corridor neighbor or a
    // corridor the edited line doesn't run): the switch-to-that-line target.
    const foreignSwitch = (lineId: LineId): LineId | null => {
      const mode = selection.uiMode;
      return mode.kind === 'appending-to-line' &&
        lineId !== mode.lineId &&
        lines[lineId] !== undefined
        ? lineId
        : null;
    };
    return {
      // Mouseover: the edited line's own stripe previews the segment halo a
      // click would arm; any other line's stripe gently highlights ITS line —
      // clicking there switches the editor to it. The setter dedupes, so the
      // stripe's pointermove stream is a no-op until the target changes.
      onLineHover: (lineId: LineId) => {
        if (ownSegment(lineId)) {
          selection.setAppendHover({ kind: 'segment', pairKey: spec.pairKey });
          return;
        }
        const foreign = foreignSwitch(lineId);
        if (foreign) selection.setAppendHover({ kind: 'line', lineId: foreign });
      },
      onLineLeave: (lineId: LineId) => {
        const h = useSelection.getState().appendHover;
        if (h?.kind === 'segment' && h.pairKey === spec.pairKey) selection.setAppendHover(null);
        if (h?.kind === 'line' && h.lineId === lineId) selection.setAppendHover(null);
      },
      onLineClick: (lineId: LineId, e: React.MouseEvent) => {
        const ctx = ownSegment(lineId);
        if (!ctx) {
          // Another line's stripe (co-corridor neighbor or a corridor the
          // edited line doesn't run): switch the editor to it.
          const foreign = foreignSwitch(lineId);
          if (foreign) {
            e.stopPropagation();
            selection.setAppending(foreign);
          }
          return;
        }
        e.stopPropagation();
        const { cursor, line } = ctx;
        if (e.shiftKey) {
          const [a, b] = edgeEndpoints(spec.pairKey);
          setLineSegmentStyle(line.id, a, b, nextSegmentStyle(line, spec.pairKey));
          return;
        }
        const world = view.screenToWorld(e.clientX, e.clientY);
        const decision = decideSegmentClick(line, cursor, spec.pairKey, world, stopPosOf(line.id));
        if (decision.kind === 'cursor') selection.setAppendCursor(decision.cursor);
      },
    };
  };

  // Layering-mode click: cycle (or flood) which covering line paints the face.
  // The whole pure decision lives in regionPaintPlan; the store mints the ids
  // and records ONE undo entry. The face/winner set the user CLICKS is the one
  // being DISPLAYED (the deferred snapshot); assignments are read fresh by id.
  const handleRegionClick = (faceIndex: number, dir: 1 | -1, flood: boolean) => {
    if (!regionGeom || !regionWinners) return;
    const plan = regionPaintPlan({
      faces: regionGeom.faces,
      winners: regionWinners,
      assignments: useDoc.getState().regionAssignments,
      faceIndex,
      dir,
      flood,
      lineOrder,
      bands: regionGeom.bands,
    });
    if (plan.length) assignRegions(plan);
  };

  // Every hook's live snap guides plus the placement preview's — or, during a
  // pipelined drag, the landed frame's own cargo. ONE union feeds both
  // consumers: the SnapGuides overlay (which draws the labeled segments and
  // skips the markers) and the engaged-guide set below (which reads ONLY the
  // markers), so the two can never disagree about what is engaged.
  const allSnapGuides = pipelineFrame?.guides ?? [
    ...drag.snapGuides,
    ...itemDrag.itemSnapGuides,
    ...polyDrag.polygonSnapGuides,
    ...svgDrag.svgImageSnapGuides,
    ...circleDrag.snapGuides,
    ...guideDrag.snapGuides,
    ...placementGuides,
  ];
  // The alignment guides some in-flight drag or placement is snapped AGAINST
  // right now: they paint full accent (GuideView `engaged`) — the guide itself
  // is the feedback, no distance chip.
  const engagedGuideIds = new Set<string>();
  for (const g of allSnapGuides) if (g.alignGuideId) engagedGuideIds.add(g.alignGuideId);

  return (
    <div
      className="canvas-host"
      data-uimode={selection.uiMode.kind}
      // The host background is only a backstop behind the overdrawn SVG bg rect
      // (a pan can briefly outrun the rect's reproject). It tracks the MAP's
      // canvas color — not the chrome theme — so "Dark UI in day" darkens the
      // toolbar/sidebar without leaking a black frame around a light map.
      style={{ background: theme.canvasBg }}
    >
      <EditingBanner />
      {/* The pan layer holds ONLY the svg (overlays stay outside so a pan
          doesn't drag them). No inline style: useViewport writes the gesture
          transform imperatively, and React must never own — or clobber — it. */}
      <div className="canvas-pan-layer" ref={panLayerRef}>
        <svg
          ref={svgRef}
          viewBox={`${surface.vbX} ${surface.vbY} ${surface.vbW} ${surface.vbH}`}
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
            if (appendDeepPick(e)) return;
            if (deepPickAltClick(e)) return;
            rerouteProxyEventBeneath('click', e);
          }}
          // Two rapid alt+clicks (deep-pick cycling) also synthesize a native
          // dblclick on the topmost element — which would open the station
          // layout editor and clobber the deep-picked selection. Swallow
          // alt-dblclicks; the plain double-click is untouched.
          onDoubleClickCapture={(e) => {
            if (e.altKey) e.stopPropagation();
          }}
          onContextMenuCapture={(e) => rerouteProxyEventBeneath('contextmenu', e)}
          onClick={onCanvasClick}
          // Bubble-phase, so it only fires when no inner handler stopped
          // propagation. During Edit Stops every canvas right-click reaches here
          // (stations/segments deliberately leave contextmenu unwired in the
          // mode) and is the mouse-only exit — the same cancelAppendMode() path
          // Esc and the exit canvas-click take.
          onContextMenu={(e) => {
            e.preventDefault();
            if (useSelection.getState().uiMode.kind === 'appending-to-line') cancelAppendMode();
          }}
          onDragStart={(e) => e.preventDefault()}
        >
          <defs>
            <HatchPatterns colors={hatchedColors} underlayColor={underlayColor} />
            {regionExcludeHoles && regionClipOuter && (
              <RegionExcludeClips holes={regionExcludeHoles} bounds={regionClipOuter} />
            )}
          </defs>

          {/* Background hit target for panning. Overdrawn one viewport-width in
            every direction so a mid-gesture camera — the pan's composited
            translate, or a wheel zoom's imperative viewBox write, neither of
            which re-renders this rect before the commit — never reveals a
            bare edge. */}
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
                rect) so a mid-gesture pan translate or zoom write doesn't run
                past the drawn grid before the commit reprojects it. Off-screen
                lines are clipped by the browser, so this adds no per-frame
                raster cost. */}
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

          {/* Background band: polygon and svg-image bodies INTERLEAVED in one
            paint order, so a polygon can sit over an image or vice versa.
            Painted just above the grid and below ALL map content (bands,
            stations, dots, labels) so background shapes like rivers/lakes and
            imported graphics always sit underneath everything else. Selection
            handles, vertex/"+" buttons and image transform knobs render in a
            separate top overlay pass below. */}
          {backgroundRenderOrder.map((bid) => {
            const poly = polygons[bid];
            if (poly) {
              return (
                <PolygonView
                  key={bid}
                  polygon={poly}
                  layer="body"
                  selected={polygonSelectedIds.includes(bid)}
                  selectedVertexIndices={vertexIndicesFor(bid)}
                  interactive={polygonsInteractive}
                  inHandMode={inHandMode}
                  onPointerDown={polyDrag.onPolygonPointerDown}
                  onClick={onPolygonClick}
                  onContextMenu={onPolygonContextMenu}
                  onVertexPointerDown={polyDrag.onVertexPointerDown}
                  onVertexClick={onVertexClick}
                  onEdgeAddPointerDown={polyDrag.onEdgeAddPointerDown}
                  onHoverEnter={(id) => setHover({ kind: 'polygon', id })}
                  onHoverLeave={(id) => clearHoverIf('polygon', id)}
                />
              );
            }
            const im = svgImages[bid];
            return (
              <SvgImageView
                key={bid}
                image={im}
                layer="body"
                selected={svgImageSelectedIds.includes(bid)}
                interactive={polygonsInteractive}
                inHandMode={inHandMode}
                onPointerDown={svgDrag.onSvgImagePointerDown}
                onClick={onSvgImageClick}
                onContextMenu={onSvgImageContextMenu}
                onCornerPointerDown={svgDrag.onSvgCornerPointerDown}
                onEdgePointerDown={svgDrag.onSvgEdgePointerDown}
                onRotatePointerDown={svgDrag.onSvgRotatePointerDown}
                onHoverEnter={(id) => setHover({ kind: 'svgImage', id })}
                onHoverLeave={(id) => clearHoverIf('svgImage', id)}
              />
            );
          })}

          {/* Line circles: dashed guide rings stations bind to. Editor
            scaffolding, never map ink (export-excluded); painted above the
            background band so a polygon can't hide the guide, below all map
            content. Selection happens at pointer-down inside the drag hook.

            Gated on its OWN toggle and not on showNetwork: reaching a ring a
            line is sitting on means clearing the lines, so the master switch
            has to leave the guides standing. */}
          {showLineCircles && (
            <g data-export-exclude="1">
              {Object.keys(lineCircles).map((cid) => (
                <LineCircleView
                  key={cid}
                  circle={lineCircles[cid]}
                  zoom={view.viewport.zoom}
                  guideColor={theme.guide}
                  accentColor={theme.accent}
                  selected={(
                    rectSelect.previewLineCircleIds ?? selection.selectedLineCircleIds
                  ).includes(cid)}
                  hovered={hoverLineCircleId === cid}
                  interactive={polygonsInteractive}
                  inHandMode={inHandMode}
                  showCardinals={snapModes.circle}
                  onPointerDown={(e, id, part) => circleDrag.onStartDrag(id, part, e)}
                  onClick={onLineCircleClick}
                  onContextMenu={onLineCircleContextMenu}
                  onHoverEnter={(id) => setHover({ kind: 'lineCircle', id })}
                  onHoverLeave={(id) => clearHoverIf('lineCircle', id)}
                />
              ))}
            </g>
          )}

          {/* Alignment guides: the line circles' straight-line siblings, in the
            same scaffolding band (above the background art, below all map ink)
            and equally export-excluded. Spanning the OVERDRAWN box, like the
            Grid, so a mid-gesture camera can't reveal an end. A guide some
            drag is snap-engaged against paints full accent — the guide itself
            is the feedback (see engagedGuideIds). The pull-out ghost from the
            wells rides in the same band at placement-ghost opacity. */}
          {showGuides && (
            <g data-export-exclude="1">
              {Object.keys(guides).map((gid) => (
                <GuideView
                  key={gid}
                  guide={guides[gid]}
                  zoom={view.viewport.zoom}
                  vbX={overdrawn.vbX}
                  vbY={overdrawn.vbY}
                  vbW={overdrawn.vbW}
                  vbH={overdrawn.vbH}
                  guideColor={theme.guide}
                  accentColor={theme.accent}
                  selected={selection.selectedGuideIds.includes(gid)}
                  hovered={hoverGuideId === gid}
                  engaged={engagedGuideIds.has(gid)}
                  interactive={polygonsInteractive}
                  inHandMode={inHandMode}
                  onPointerDown={(e, id) => guideDrag.onStartDrag(id, e)}
                  onClick={onGuideClick}
                  onHoverEnter={(id) => setHover({ kind: 'guide', id })}
                  onHoverLeave={(id) => clearHoverIf('guide', id)}
                />
              ))}
              {guideDrag.pull && (
                <g opacity={0.5} pointerEvents="none">
                  <GuideView
                    guide={{ id: '__guide-pull', ...guideDrag.pull }}
                    zoom={view.viewport.zoom}
                    vbX={overdrawn.vbX}
                    vbY={overdrawn.vbY}
                    vbW={overdrawn.vbW}
                    vbH={overdrawn.vbH}
                    guideColor={theme.accent}
                    accentColor={theme.accent}
                    selected={false}
                    hovered={false}
                    engaged={false}
                    interactive={false}
                    inHandMode={inHandMode}
                  />
                </g>
              )}
            </g>
          )}

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

          {/* Mouseover preview — wash half: the hovered (unselected) station's
            accent fill at 50% of the selected strength, in the same back-of-
            stack band as the real wash so it reads identically, just fainter. */}
          {hoverStationId && stations[hoverStationId] && (
            <g data-export-exclude="1" opacity={0.5}>
              <StationView
                key={hoverStationId + ':hover-wash'}
                station={stations[hoverStationId]}
                lines={lines}
                zoom={view.viewport.zoom}
                onStartDrag={drag.onStartDrag}
                layer="wash"
                preview
              />
            </g>
          )}

          {/* band stripes, warnings, and stop squares interleaved by per-stripe
            z-priority. A line that LOSES an overridden overlap region renders
            through its exclusion clip (holes over the faces it loses), so the
            region's winner shows through as its own continuous base stroke —
            see buildExclusionHoles. The clip wrapper also removes the loser's
            pointer surface there, landing clicks on the visible winner. */}
          {showNetwork &&
            renderables.map((r) => {
              const lineId = r.kind === 'marker' ? r.spec.lineId : r.band.lines[r.stripeIndex].id;
              // A stripe that loses a face AS A SLICE references its slice's
              // def, finest spelling first — its band (a mid-edge crossing),
              // then its arm (a branch mouth) — each of which also carries
              // the line-level holes (see mergeArmHoleKeys). Markers always
              // take the line def: they are the line's shared paint, never
              // one slice's.
              const sliceKeys =
                r.kind === 'marker'
                  ? []
                  : [
                      edgeCoverId(lineId, r.band.pairKey),
                      armCoverId(lineId, r.band.arms[r.stripeIndex] ?? 0),
                    ];
              const clipKey =
                sliceKeys.find((k) => regionExcludeHoles?.has(k)) ??
                ((regionExcludeHoles?.has(lineId) ?? false) ? lineId : null);
              const withExcludeClip = (key: string, node: React.ReactNode) =>
                clipKey ? (
                  <g
                    key={key}
                    data-region-excluded={clipKey}
                    clipPath={`url(#${regionExcludeClipId(clipKey)})`}
                  >
                    {node}
                  </g>
                ) : (
                  node
                );
              if (r.kind === 'casing') {
                return withExcludeClip(
                  'c:' + r.band.bandKey + ':' + lineId,
                  <SegmentBand
                    key={'c:' + r.band.bandKey + ':' + lineId}
                    spec={r.band}
                    stripeIndex={r.stripeIndex}
                    pass="silhouette"
                    lines={lines}
                    colorMap={colorMap}
                    underlayColor={underlayColor}
                    darkMode={darkMode}
                  />,
                );
              }
              if (r.kind === 'stripe') {
                return withExcludeClip(
                  's:' + r.band.bandKey + ':' + lineId,
                  <SegmentBand
                    key={'s:' + r.band.bandKey + ':' + lineId}
                    spec={r.band}
                    stripeIndex={r.stripeIndex}
                    pass="body"
                    interactive={
                      selection.uiMode.kind === 'creating-line-tag' ||
                      selection.uiMode.kind === 'appending-to-line'
                    }
                    interactiveCursor={
                      selection.uiMode.kind === 'appending-to-line' ? 'pointer' : 'crosshair'
                    }
                    lines={lines}
                    colorMap={colorMap}
                    underlayColor={underlayColor}
                    darkMode={darkMode}
                    onLineSelect={inHandMode || inLayeringMode ? undefined : handleLineSelect}
                    {...(selection.uiMode.kind === 'creating-line-tag'
                      ? makeBandHandlers(r.band)
                      : {})}
                    {...(selection.uiMode.kind === 'appending-to-line'
                      ? makeAppendBandHandlers(r.band)
                      : {})}
                  />,
                );
              }
              const effectiveColor =
                colorMap && r.spec.lineId !== highlightLineId
                  ? (colorMap[r.spec.lineId] ?? r.spec.color)
                  : r.spec.color;
              return withExcludeClip(
                'm:' + r.spec.stationId + ':' + lineId,
                <StopMarker
                  key={'m:' + r.spec.stationId + ':' + lineId}
                  spec={r.spec}
                  effectiveColor={effectiveColor}
                  underlayColor={underlayColor}
                  lines={lines}
                  darkMode={darkMode}
                />,
              );
            })}

          {/* Edit Stops: the edited line's pointer surface, LIFTED above every
            band renderable. The mode dims the map and repaints this line on
            top of the dim, so its z-priority down in the band layer — and the
            region overrides that clip pieces of it away — are invisible to the
            user, yet they were what hit-testing followed: over a crossing
            where another line painted in front, hovering the line being
            edited highlighted THAT line and a click switched the editor to it.
            One transparent stroke per stripe at the full painted width
            (casing rim included, which the inset body never covered) makes
            every pixel the editor paints as this line answer as this line.
            Mounted BELOW the station hit areas, so the pen still wins on a
            stop and a buried segment is still reached by the alt-pick. */}
          {showNetwork && appendLineId && (
            <g data-append-hit-layer={appendLineId}>
              {renderables.map((r) =>
                r.kind === 'stripe' && r.band.lines[r.stripeIndex].id === appendLineId ? (
                  <SegmentBand
                    key={'ah:' + r.band.bandKey}
                    spec={r.band}
                    stripeIndex={r.stripeIndex}
                    pass="hit"
                    interactive
                    interactiveCursor="pointer"
                    lines={lines}
                    {...makeAppendBandHandlers(r.band)}
                  />
                ) : null,
              )}
            </g>
          )}

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

          {/* Layering-mode region outlines: a dashed footprint per clickable
            overlap face, mounted BELOW transfers + station dots so those keep
            their visual primacy. The hover halo + click targets paint at the
            very end so they stay on top. */}
          {inLayeringMode && regionGeom && (
            <g data-export-exclude="1">
              <RegionModeOverlay
                faces={regionGeom.faces}
                hoveredKey={hoveredRegionKey}
                layer="outlines"
              />
            </g>
          )}

          {/* Transfers: user-styled lines connecting two dots. This is the
            'under' rung — the default, and the only one below the whole dots
            pass, so the dots paint on top and a transfer never obscures the
            dot it's connecting. The other three rungs are mounted between the
            dot sub-passes further down. Transfers stay at full opacity in
            layering mode (they ride between line stops so they're part of the
            route-network reading, not background annotation). */}
          {transferRung('under')}

          {/* In-progress transfer preview line: from the anchor dot to the
            cursor while waiting for the second click. Dashed + translucent so
            it reads as provisional rather than an already-placed transfer;
            renders below the dots for the same reason as the real ones. */}
          {showNetwork &&
            selection.uiMode.kind === 'creating-transfer' &&
            selection.uiMode.firstEnd &&
            cursorWorld &&
            (() => {
              const anchor = selection.uiMode.firstEnd;
              if (!anchor) return null;
              // Resolved through the union-aware helper, same as both paint
              // passes — the first-picked end may be a stop or an anchor.
              const anchorWorld = transferEndWorld(anchor, stations, transferAnchors, lineCircles);
              if (!anchorWorld) return null;
              // The dropped transfer will wear the designated default transfer
              // style, so the preview reads it too (a loaded doc always has
              // one; constants are a type-level fallback).
              const preview =
                defaultStyleProps({ styles, styleDefaults }, 'transfer') ?? TRANSFER_STYLE_DEFAULTS;
              return (
                <line
                  data-export-exclude="1"
                  data-transfer-preview="1"
                  x1={anchorWorld.x}
                  y1={anchorWorld.y}
                  x2={cursorWorld.x}
                  y2={cursorWorld.y}
                  stroke={resolveDayNight(preview.color, darkMode)}
                  strokeWidth={preview.thickness}
                  strokeLinecap="round"
                  strokeDasharray="6 4"
                  opacity={0.6}
                  pointerEvents="none"
                />
              );
            })()}

          {/* Station dots, in their three z-ordered sub-passes with the three
            LIFTED transfer rungs slotted between them. Every dot silhouette
            paints before every body (one continuous border across overlapping
            dots), and every body before every service code; a transfer can ask
            to sit in either gap, or above the lot. All of it above the 'under'
            rung, so a dot click still routes to the station, not the transfer
            (overlays below — previews, labels, snap guides — still paint over
            the dots). */}
          {DOT_STACK.map(([layer, rung]) => (
            <Fragment key={layer}>
              {Object.values(stations).map((st) =>
                // The layout-edited station is painted above the focus dim
                // instead, so it stays bright and its dots keep their true
                // colors; skip it here.
                st.id === layoutEditStationId ? null : (
                  <StationView
                    key={st.id + ':' + layer}
                    station={st}
                    lines={lines}
                    zoom={view.viewport.zoom}
                    onStartDrag={drag.onStartDrag}
                    layer={layer}
                  />
                ),
              )}
              {transferRung(rung)}
            </Fragment>
          ))}

          {/* Transfer anchors. Above the dots so a free anchor stays grabbable
            where it overlaps one, and inside an export-excluded subtree — the
            anchor is scaffolding, the transfer bound to it is the artwork, so
            only the transfer prints. Gated on showNetwork: anchors are part of
            the transfer network, and every transfer surface goes with it. */}
          {showNetwork && (
            <g data-export-exclude="1">
              <AnchorLayer
                lineCircles={lineCircles}
                // Two ways in. With the anchor toggle on (or a mode that forces
                // it) the whole network paints. With it off, only the hovered or
                // selected stations' HOSTED anchors do — and no free ones, since
                // that reveal is about the station you're looking at rather than
                // the network (revealedAnchorStations). The layer renders nothing
                // at all when both collections come back empty.
                transferAnchors={anchorsVisible ? transferAnchors : NO_FREE_ANCHORS}
                stations={anchorsVisible ? stations : revealedAnchorStations(stations, selection)}
                // With the whole network painted on an idle canvas, hosted
                // anchors rest at half opacity and come forward when their
                // station is hovered/selected — the same reveal set the
                // toggle-off path paints from, reused as the focus set. Null
                // (= no dimming) everywhere else: picking modes need every
                // endpoint fully legible, and the layout editor draws its own
                // chrome.
                dimHostedExcept={
                  anchorsVisible && selection.uiMode.kind === 'idle'
                    ? new Set(Object.keys(revealedAnchorStations(stations, selection)))
                    : null
                }
                // During a marquee, free anchors preview like every other kind
                // (rectSelect.previewAnchorIds ?? committed); empty when hidden.
                selectedIds={anchorSelectedIds}
                hoveredKey={selection.hoveredAnchorKey}
                onHover={selection.setHoveredAnchorKey}
                // Live only where an anchor click means something. Everywhere
                // else it must not swallow the BACKGROUND click that placement
                // modes (and Edit Stops, and layering) use as their exit.
                freeLive={freeAnchorsLive}
                picking={pickingTransferEnd}
                onPointerDown={itemDrag.onAnchorPointerDown}
                onClick={onAnchorClick}
              />
            </g>
          )}

          {/* Selected-transfer outline: above every dot pass AND every rung,
            so the connected dots — and any crossing transfer, however high it
            sits — can't cover the selection chrome. */}
          {transfersVisible && (
            <TransferSelectionOutline
              transfers={transfers}
              stations={stations}
              transferAnchors={transferAnchors}
              defaults={TRANSFER_STYLE_DEFAULTS}
              selectedId={selection.selectedTransferId}
            />
          )}

          {/* Mouseover preview: the hovered (unselected) transfer's selection
            outline at 50% opacity — the same ring, reused, just fainter. */}
          {transfersVisible && hoverTransferId && (
            <g data-export-exclude="1" opacity={0.5}>
              <TransferSelectionOutline
                transfers={transfers}
                stations={stations}
                transferAnchors={transferAnchors}
                defaults={TRANSFER_STYLE_DEFAULTS}
                selectedId={hoverTransferId}
              />
            </g>
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
              style={defaultStyleProps({ styles, styleDefaults }, 'textLabel')}
            />
            {/* Polygon-placing-mode ghost: a faint starter square following the
              cursor before the click, matching the shape that will drop. */}
            <PolygonPlacingPreview
              world={selection.uiMode.kind === 'creating-polygon' ? cursorWorld : null}
              style={defaultStyleProps({ styles, styleDefaults }, 'polygon')}
            />
            {/* Line-circle two-click ghost: a center cross before the first
              click; the dashed ring + diameter readout tracking the cursor
              between the clicks. */}
            {selection.uiMode.kind === 'placing-line-circle' && (
              <LineCirclePlacingPreview
                center={selection.uiMode.center}
                world={cursorWorld}
                zoom={view.viewport.zoom}
              />
            )}
            {/* Diameter readout while the resize knob is being dragged — the
              same measurement chip the placement ghost shows. */}
            {circleDrag.resizingId && lineCircles[circleDrag.resizingId] && (
              <CircleDiameterLabel
                cx={lineCircles[circleDrag.resizingId].x}
                cy={lineCircles[circleDrag.resizingId].y}
                radius={lineCircles[circleDrag.resizingId].radius}
                zoom={view.viewport.zoom}
              />
            )}
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
              style={defaultStyleProps({ styles, styleDefaults }, 'routeBullet')}
            />
            {/* Transfer-anchor-placing ghost: the same mark the click will drop,
              drawn through AnchorLayer so preview and drop can't drift. */}
            <AnchorPlacingPreview
              world={selection.uiMode.kind === 'placing-anchor' ? cursorWorld : null}
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
                onHoverEnter={(id) => setHover({ kind: 'bullet', id })}
                onHoverLeave={(id) => clearHoverIf('bullet', id)}
              />
            ))}
          </g>

          {/* Mouseover preview: the hovered (unselected) bullet's selection ring
            at 50% opacity — the same ring, reused, just fainter. At the bullet
            z-band, matching where the real ring paints. */}
          {hoverBulletId && routeBullets[hoverBulletId] && (
            <g data-export-exclude="1" opacity={0.5}>
              <RouteBulletSelectionRing bullet={routeBullets[hoverBulletId]} />
            </g>
          )}

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
                onHoverEnter={(id) => setHover({ kind: 'label', id })}
                onHoverLeave={(id) => clearHoverIf('label', id)}
              />
            ))}
          </g>

          {/* Line-selection highlight: dim wash + re-painted selected line on
            top. Painted after dots so other lines' stop dots can't punch
            through the selected line's outline. Gated on showNetwork for the
            DIM above all: it covers the whole viewport, so leaving it up with
            the network hidden would black out the background art the toggle
            exists to expose. */}
          {showNetwork && highlightLineId && (
            <g data-export-exclude="1">
              <HighlightedLineLayer
                highlightLineId={highlightLineId}
                lines={lines}
                stations={stations}
                lineCircles={lineCircles}
                renderables={renderables}
                underlayColor={underlayColor}
                uiMode={selection.uiMode}
                // Pan-suppress the hover preview the same way hoveredChrome does
                // for idle mode — a lingering ring/halo mid-pan reads as stale.
                // view.panning covers the arrow-mode middle-drag pan, whose
                // pointer capture freezes appendHover at its pre-pan target.
                appendHover={inHandMode || view.panning ? null : selection.appendHover}
                zoom={view.viewport.zoom}
                onStartDrag={drag.onStartDrag}
                onRemoveCursorStation={(sid) => {
                  const mode = selection.uiMode;
                  if (mode.kind !== 'appending-to-line') return;
                  const line = lines[mode.lineId];
                  if (!line || !line.stations.includes(sid)) return;
                  selection.setAppendCursor(null);
                  removeStationFromLine(mode.lineId, line.stations.indexOf(sid));
                }}
                onRemoveCursorEdge={(from, to) => {
                  const mode = selection.uiMode;
                  if (mode.kind !== 'appending-to-line') return;
                  selection.setAppendCursor(null);
                  toggleEdgeOnLine(mode.lineId, from, to);
                }}
                onCycleCursorEdgeStyle={(from, to) => {
                  const mode = selection.uiMode;
                  if (mode.kind !== 'appending-to-line') return;
                  const line = lines[mode.lineId];
                  if (!line) return;
                  // Cycle the pattern in place; leave the cursor armed so the
                  // chip stays put and repeated clicks keep cycling (like
                  // shift-click). Reuses the shared nextSegmentStyle cycle.
                  setLineSegmentStyle(
                    mode.lineId,
                    from,
                    to,
                    nextSegmentStyle(line, pairKeyOf(from, to)),
                  );
                }}
                vbX={overdrawn.vbX}
                vbY={overdrawn.vbY}
                vbW={overdrawn.vbW}
                vbH={overdrawn.vbH}
              />
            </g>
          )}

          {/* Edit Stops alt-ghost: while Alt is held over empty canvas and the
            alt-click would create a station (a create-* decision), preview
            the actual stop dot the new station gets — the edited line's
            SINGLETON dot (a fresh station starts with just this line), at the
            same snapped point the drop will use (wantsCursorTrack routes
            append-mode moves through snapPlacement). Above the dim, like the
            rest of the append chrome. Hidden over interactive targets
            (appendHover non-null): there the click routes to the target, not
            the canvas. */}
          {selection.uiMode.kind === 'appending-to-line' &&
            selection.altHeld &&
            cursorWorld &&
            (() => {
              const mode = selection.uiMode;
              // The ghost previews an alt-click CREATE. That fires over empty
              // canvas (no hover target) and — since splice-by-clicking — over
              // the line's OWN armed segment, where the alt-click now splices
              // instead of re-arming. Any other hover target (a station, an
              // unarmed segment, a foreign stripe) routes the click elsewhere, so
              // no ghost there.
              const hover = selection.appendHover;
              const overArmedSegment =
                hover?.kind === 'segment' &&
                mode.cursor?.kind === 'edge' &&
                pairKeyOf(mode.cursor.from, mode.cursor.to) === hover.pairKey;
              if (hover && !overArmedSegment) return null;
              const ln = lines[mode.lineId];
              if (!ln) return null;
              const d = decideCanvasClick(ln, mode.cursor, true);
              if (
                d.kind !== 'create-seed' &&
                d.kind !== 'create-connect' &&
                d.kind !== 'create-splice'
              )
                return null;
              return (
                <g
                  data-export-exclude="1"
                  data-append-create-ghost="1"
                  opacity={0.5}
                  pointerEvents="none"
                >
                  <StopGlyph
                    cx={cursorWorld.x}
                    cy={cursorWorld.y}
                    style={resolveDotStyle(ln, null, true)}
                    lineColor={ln.color}
                    serviceCode={ln.service}
                    sizeOverride={dotSizeOverride(ln, null, true)}
                  />
                </g>
              );
            })()}

          {/* Line tags: in-band labels that ride each line's stripe. Faded
            in layering mode so the tag text doesn't compete with the
            outline + layer-number overlays. */}
          {showNetwork && (
            <g opacity={inLayeringMode ? LAYERING_FADE_OPACITY : 1}>
              <LineTagsLayer
                bands={bands}
                zoom={view.viewport.zoom}
                svgRef={svgRef}
                screenToWorld={view.screenToWorld}
              />
            </g>
          )}

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

          {/* Mouseover preview — stroke half: the hovered (unselected) station's
            two-tone selection ring at 50% opacity, painted in the same top-of-
            stack pass as the real ring so it can't be occluded. Pairs with the
            hover-wash block above to make one faint copy of full selection. */}
          {hoverStationId && stations[hoverStationId] && (
            <g data-export-exclude="1" opacity={0.5}>
              <StationView
                key={hoverStationId + ':hover-stroke'}
                station={stations[hoverStationId]}
                lines={lines}
                zoom={view.viewport.zoom}
                onStartDrag={drag.onStartDrag}
                layer="stroke"
                preview
              />
            </g>
          )}

          {/* Selection stroke for text labels: dashed black ring around each
            selected label's rotated bbox. Painted in this pass so it sits
            above the dim overlay and on top of the network — matching how
            stations and bullets handle their outlines. */}
          <g data-export-exclude="1">
            {labelSelectedIds.map(
              (gid) =>
                textLabels[gid] && (
                  <LabelView
                    key={gid + ':stroke'}
                    label={textLabels[gid]}
                    selected
                    layer="stroke"
                  />
                ),
            )}
          </g>

          {/* Mouseover preview: the hovered (unselected) label's selection ring at
            50% opacity — reusing the exact stroke layer, just fainter. */}
          {hoverLabelId && textLabels[hoverLabelId] && (
            <g data-export-exclude="1" opacity={0.5}>
              <LabelView label={textLabels[hoverLabelId]} selected layer="stroke" preview />
            </g>
          )}

          {/* Selected-item drag proxies: a transparent hit target per selected,
            unlocked item, painted ABOVE all map content so a selected item wins
            the DRAG over whatever is stacked above it — a selected polygon under
            a station drags the polygon, not the station. onPointerDown routes to
            the item's body drag handler. CLICK / right-click do NOT act on the
            proxy: the SVG's onClickCapture/onContextMenuCapture intercept them and
            re-dispatch to the real element beneath, so SELECTION follows normal
            layer order (see rerouteProxyEventBeneath). That capture-phase
            stopPropagation also means the proxies' own onClick/onContextMenu never
            fire — hence the no-ops. Emitted in body paint order (background band
            → station → bullet → label) so when two SELECTED items overlap, the
            one painted higher still wins its grab. That's why the polygon/image
            proxies walk `backgroundRenderOrder` rather than their own id lists:
            those two kinds interleave, so a polygon selected ABOVE an image
            must emit its proxy after the image's or the visually-lower image
            steals the drag. The polygon/svg-image MANIPULATION handle passes
            come AFTER this layer in the SVG (they paint on top and win
            hit-testing), so a selected item's own corner/vertex handles still
            beat its body proxy. These honor the same preview-aware id lists as
            the handle overlays, harmless mid-marquee since useRectSelect
            captures the pointer on first move. Excluded from export — pure
            interaction chrome. */}
          <g ref={proxyLayerRef} data-export-exclude="1">
            {backgroundRenderOrder.map((bid) => {
              const poly = polygons[bid];
              if (poly) {
                return polygonSelectedIds.includes(bid) ? (
                  <PolygonView
                    key={bid + ':hit'}
                    polygon={poly}
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
                ) : null;
              }
              const im = svgImages[bid];
              return im && svgImageSelectedIds.includes(bid) ? (
                <SvgImageView
                  key={bid + ':hit'}
                  image={im}
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
              ) : null;
            })}
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

          {/* Mouseover preview: the hovered (unselected) polygon's selection
            outline at 50% opacity — ONLY the outline, never the vertex / edge-add
            manipulators (those belong to an actually-selected polygon). */}
          {hoverPolygonId && polygons[hoverPolygonId] && (
            <g data-export-exclude="1" opacity={0.5}>
              <PolygonSelectionOutline polygon={polygons[hoverPolygonId]} />
            </g>
          )}

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

          {/* Mouseover preview: the hovered (unselected) image's selection box at
            50% opacity — ONLY the box, never the resize/rotate handles (those
            belong to an actually-selected image). */}
          {hoverSvgImageId && svgImages[hoverSvgImageId] && (
            <g data-export-exclude="1" opacity={0.5}>
              <SvgImageSelectionBox image={svgImages[hoverSvgImageId]} />
            </g>
          )}

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
            labels sit on top of line tags and everything else. During a
            pipelined drag the landed frame carries its own guides — captured
            with the input that produced it — so the halo always encircles the
            dot as painted; the hooks' live guides serve every other moment
            (including the armed-but-not-yet-landed window, where hook state is
            frozen at the same slice the canvas shows). */}
          <g data-export-exclude="1">
            <SnapGuides guides={allSnapGuides} zoom={view.viewport.zoom} />
          </g>

          {/* Station-layout-editor focus dim (editing-station-layout mode):
            mutes the whole map so the mode is unmistakable and the overlays
            read. The edited station's own content (white border, dots, label,
            grab rings + direction arrows) is painted at the very END of the
            SVG, AFTER the routing-warning markers, so those markers can never
            cover its click targets. Same focus language as the line-selection
            highlight; chrome, excluded from export. */}
          {showNetwork && layoutEditStation && theme.dimOpacity > 0 && (
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
          {inLayeringMode && regionGeom && (
            <g data-export-exclude="1">
              <RegionModeOverlay
                faces={regionGeom.faces}
                hoveredKey={hoveredRegionKey}
                layer="hit"
                onHover={setHoveredRegionKey}
                onFaceClick={handleRegionClick}
              />
            </g>
          )}

          {/* Routing warnings: a red+white frame around each unrouteable band's
            crude straight segment plus a ⚠ over its center. Painted at the
            very end of the SVG so the marker draws on top of every stripe,
            dot, and label and is never occluded. The ⚠ takes whichever of
            black/white is legible against the stripe under its center. */}
          {showNetwork && (
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
          )}

          {/* Mouseover preview — orientation badges: the layout editor's axis
            glyph on each stop dot, so a hovered station's stop orientations
            read at a glance without entering the editor. Full opacity, unlike
            the faint wash/stroke halves — legibility is the whole point.
            Painted AFTER the routing-warning markers for the same reason the
            layout editor lifts its dots above them: a ⚠ frame appears exactly
            where you're looking when things go wrong, and it must never cover
            the badges. (Idle-mode-only chrome, so it can't collide with the
            layout-edit focus content below.) */}
          {hoverStationId && stations[hoverStationId] && (
            <g data-export-exclude="1">
              <StationView
                key={hoverStationId + ':hover-arrows'}
                station={stations[hoverStationId]}
                lines={lines}
                zoom={view.viewport.zoom}
                onStartDrag={drag.onStartDrag}
                layer="hover-arrows"
              />
            </g>
          )}

          {/* Layout-editor focus content, painted at the very END of the SVG so
            it sits ABOVE the routing-warning markers, which would otherwise
            cover the edited station's dots + direction arrows (the click
            targets you reach for exactly when a routing warning appears). The
            dim is painted much earlier, below the warnings, so the warnings
            stay visible beneath this content. */}
          {showNetwork && layoutEditStation && (
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
                  onStartNodeDrag={layoutDrag.onStartNodeDrag}
                  swapTarget={layoutSwapTarget}
                  anchorCell={layoutDrag.overlay?.anchor ?? null}
                  draggingSource={layoutDrag.overlay?.source ?? null}
                />
              </g>
              {/* Drop preview during a layout drag, above the dots so targets
                stay readable: the swap picture when the drop landed on another
                stop, the ghost lattice otherwise. */}
              {layoutDrag.overlay &&
                stations[layoutDrag.overlay.stationId] &&
                (layoutSwapTarget ? (
                  <g data-export-exclude="1">
                    <SwapPreview
                      station={stations[layoutDrag.overlay.stationId]}
                      lines={lines}
                      source={layoutDrag.overlay.source}
                      target={layoutSwapTarget}
                      circle={stationCircle(stations[layoutDrag.overlay.stationId], lineCircles)}
                    />
                  </g>
                ) : (
                  <g data-export-exclude="1">
                    <GhostLattice
                      ghosts={layoutDrag.overlay.ghosts}
                      over={
                        layoutDrag.overlay.over?.kind === 'ghost' ? layoutDrag.overlay.over : null
                      }
                      station={stations[layoutDrag.overlay.stationId]}
                      lines={lines}
                      source={layoutDrag.overlay.source}
                      circle={stationCircle(stations[layoutDrag.overlay.stationId], lineCircles)}
                      zoom={view.viewport.zoom}
                    />
                  </g>
                ))}
            </>
          )}
        </svg>
      </div>

      <ItemPopovers hostSize={view.size} />

      {/* Guide wells: idle arrow-mode only — every other mode owns the canvas
          edges (banner frame, placement clicks), and a pan tool press must
          pan, not pull. The strips stay up mid-gesture (they are the cancel /
          delete drop zones the tint advertises). */}
      {selection.uiMode.kind === 'idle' && !inHandMode && (
        <GuideWells
          guidesHidden={!showGuides}
          armed={guideDrag.overWell}
          onWellPointerDown={guideDrag.onWellPointerDown}
          onPointerMove={guideDrag.onPointerMove}
          onPointerUp={guideDrag.onPointerUp}
        />
      )}

      {/* Routing warnings are about bands the user can't see while the network
          is hidden — the toast's "jump to the band" click would land on blank
          canvas. Comes back with the map. */}
      {showNetwork && <WarningToasts bands={bands} hostSize={view.size} />}
    </div>
  );
}
