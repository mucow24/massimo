import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Viewport } from '../model/types';

/** Grid cell sizes the toolbar button cycles through, in world units. */
export const GRID_SIZES: readonly number[] = [5, 10, 20];

/**
 * The paper color used in DAY mode. A local viewing preference, not a document
 * property: 'gray'/'black' dim the bright canvas to cut glare without flipping
 * to night mode (see themeColors) — 'gray' is the middle setting. Night mode is
 * unaffected — it's always black.
 */
export type DayCanvasColor = 'white' | 'gray' | 'black';

/**
 * The next grid size in the cycle (5 → 10 → 20 → 5). Falls back to the first
 * size when `current` isn't one of the known sizes (e.g. a stale persisted
 * value), so a click always lands on a valid grid.
 */
export function nextGridSize(current: number): number {
  const i = GRID_SIZES.indexOf(current);
  return GRID_SIZES[(i + 1) % GRID_SIZES.length];
}

interface ViewportState extends Viewport {
  setViewport: (v: Viewport) => void;
  gridVisible: boolean;
  setGridVisible: (visible: boolean) => void;
  /** Grid cell size in world units. Drives both the visible grid and all grid
   *  snapping (cycled through 5, 10, and 20 from the toolbar; see GRID_SIZES). */
  gridSize: number;
  setGridSize: (size: number) => void;
  // NOTE: darkMode is NOT here — it lives on MapDoc. A night map is a property
  // of the map, not of the session viewing it, so it has to travel in the
  // saved/exported file rather than sit beside it in localStorage.
  /** Render overlay: reveal waypoint stations (normally hidden) — their stops
   *  in a black-stroke/white-fill dot and their names with a "WP" lozenge. A
   *  pure paint toggle; it never mutates the doc (per-stop styles stay intact,
   *  same as the `isWaypoint` flag itself). */
  showWaypoints: boolean;
  setShowWaypoints: (show: boolean) => void;
  /** Render toggle: paint the transfer anchors (the small anchor glyphs that
   *  give a transfer end something other than a stop dot to bind to). Defaults
   *  OFF: anchors are scaffolding over finished artwork, so a map you are not
   *  currently routing transfers on should not carry them. The two gestures
   *  that are ABOUT anchors reveal them regardless — see
   *  state/anchorVisibility.ts, which derives that rather than temporarily
   *  writing this flag (a write would need a revert on every exit path). Anchors are editor
   *  chrome either way: their layer carries `data-export-exclude`, so they
   *  never reach an SVG/PNG/PDF export while the transfers bound to them do.
   *  A pure paint toggle; it never mutates the doc. Like `showNetwork`, code
   *  that reads geometry from the doc instead of the DOM has to opt in by hand
   *  — see useRectSelect (a marquee must not sweep up hidden anchors, or an
   *  invisible selection answers Delete) and liveAlignTargets (no snapping to
   *  invisible targets). Hiding is a PEEK, not a deselect: an already-selected
   *  anchor stays selected. */
  showAnchors: boolean;
  setShowAnchors: (show: boolean) => void;
  /** Render toggle: paint the line/station network at all — line bands, stop
   *  markers, station dots + names, line tags, and transfers. Off leaves the
   *  background (polygons, imported images, grid) alone on the canvas, so art
   *  buried under the network can be clicked and dragged. Hidden content isn't
   *  rendered rather than made invisible, so its pointer surface goes with it —
   *  that's the whole point. A pure paint toggle; it never mutates the doc.
   *  Anything that reads geometry from the doc instead of the DOM has to opt in
   *  by hand: see useRectSelect (a marquee must not sweep up stations that
   *  aren't there) and liveAlignTargets (no snapping to invisible targets). */
  showNetwork: boolean;
  setShowNetwork: (show: boolean) => void;
  /** Render toggle: paint the dashed line-circle guides. Deliberately NOT nested
   *  under `showNetwork` — hiding the network to reach a ring a line is sitting
   *  on is the case this exists for, so the master switch must not take the
   *  rings with it. Guides are export-excluded either way. */
  showLineCircles: boolean;
  setShowLineCircles: (show: boolean) => void;
  /** Render toggle: paint the alignment guides (the h/v snap lines). Scaffolding
   *  like the line circles, so independent of `showNetwork` and export-excluded
   *  either way. Hiding also drops them from the snap pools (liveGuideTargets)
   *  and disables the wells (the one creation affordance) — with no placing
   *  mode there is no `revealedBy` reveal to lean on, and a pull that lands an
   *  invisible guide would read as the gesture being broken. */
  showGuides: boolean;
  setShowGuides: (show: boolean) => void;
  /** Render toggle: paint transfers. Nested under `showNetwork` (a transfer runs
   *  between stations, so it goes when they do) — this narrows that to transfers
   *  alone, the same relationship `showAnchors` already has. */
  showTransfers: boolean;
  setShowTransfers: (show: boolean) => void;
  /** Render toggle: paint imported images/SVGs. Background art, so independent
   *  of `showNetwork` — which exists precisely to expose this layer. */
  showSvgImages: boolean;
  setShowSvgImages: (show: boolean) => void;
  /** Render toggle: paint free-floating canvas labels (`MapDoc.textLabels`) —
   *  NOT station names, which belong to their stations and go with
   *  `showNetwork`. */
  showTextLabels: boolean;
  setShowTextLabels: (show: boolean) => void;
  /** Render toggle: paint polygons. Background art, like `showSvgImages`. */
  showPolygons: boolean;
  setShowPolygons: (show: boolean) => void;
  /** Render toggle: paint route bullets. Independent of `showNetwork`: a bound
   *  bullet stays visible and draggable with the network hidden (see
   *  liveSnapStations), so its own toggle is the only way to clear it. */
  showRouteBullets: boolean;
  setShowRouteBullets: (show: boolean) => void;
  /** Day-mode paper color (see DayCanvasColor). A persisted local preference so
   *  a glare-averse user reopens the app to the same dimmed canvas, NOT a doc
   *  property — it never touches the map, so switching it isn't a dirty change
   *  and doesn't travel in the saved/exported file. Ignored in night mode. */
  dayCanvasColor: DayCanvasColor;
  setDayCanvasColor: (color: DayCanvasColor) => void;
  /** Darken only the CHROME (toolbar, sidebar, menus, popovers) while the map
   *  stays a day map — a local viewing preference, never a doc property. This is
   *  deliberately NOT the doc's night mode (MapDoc.darkMode, the moon toggle):
   *  that repaints the canvas too and travels in the saved file. This flag only
   *  flips `data-theme` on `.app` (see App.tsx); the canvas palette (themeColors)
   *  never reads it, so the map renders exactly as the doc defines. Redundant
   *  when the doc is already a night map (chrome is dark either way). */
  darkUiInDay: boolean;
  setDarkUiInDay: (on: boolean) => void;
}

/**
 * The live, un-committed viewport during an in-flight gesture (pan / wheel
 * zoom), or null between gestures. useViewport moves the world imperatively
 * each event (pan: composited pan-layer translate; zoom: viewBox write) and
 * publishes the same viewport here so overlays pinned to the canvas (the item
 * popovers) can track the gesture per frame — the only React subscriber is
 * the small popover layer, so the multi-thousand-node SVG tree (which reads
 * the committed `useViewportStore`) is never re-rendered mid-gesture. Kept
 * OUT of `useViewportStore` precisely because that store is persisted: a
 * per-frame write there would hammer localStorage.
 */
interface LiveViewportState {
  pending: Viewport | null;
  setPending: (v: Viewport | null) => void;
  /**
   * Is a pan gesture in flight? Here rather than in useViewport's own
   * `useState` for the same reason `pending` is: that hook runs inside
   * MapCanvas, so a boolean flip there re-rendered the whole canvas, and
   * Blink answered by re-compositing every node in the tree. Moving it here
   * took a middle-press from 28.7ms to 22.2ms on the 464-station map — about
   * 6ms, for a cursor change. The pan's own cursor is applied imperatively
   * (useViewport); the only React subscriber is HighlightedLineLayer, which is
   * mounted solely while a line is highlighted and is a fraction of the tree.
   */
  panning: boolean;
  setPanning: (v: boolean) => void;
}

export const useLiveViewportStore = create<LiveViewportState>((set) => ({
  pending: null,
  setPending: (pending) => set({ pending }),
  panning: false,
  setPanning: (panning) => set({ panning }),
}));

/**
 * The in-flight gesture ZOOM, or null between gestures (and, because the
 * selector returns only the primitive, subscribers re-render solely when the
 * zoom VALUE changes — pan frames publish a new pending with the same zoom
 * and wake nobody). That bailout is what makes a small per-item subscription
 * affordable (the alignment guides size their ink by it); a per-item body
 * pass over thousands of nodes would still re-render them all on every WHEEL
 * frame, so the multi-thousand-node canvas keeps reading committed state.
 */
export function useLivePendingZoom(): number | null {
  return useLiveViewportStore((s) => s.pending?.zoom ?? null);
}

/**
 * The zoom a SELECTED item's chrome should size its handles by: the in-flight
 * (pending) gesture zoom while a pan/zoom is live, else the committed zoom.
 * Handles stay screen-constant AND track the gesture, so nothing snaps when
 * it commits. Re-renders only on zoom changes (see useLivePendingZoom), but
 * wheel frames still hit every subscriber, so the per-item-body-pass caution
 * there applies here too. (Stroke widths don't need this —
 * vector-effect="non-scaling-stroke" holds them with no subscription at all;
 * only handle body geometry, which vector-effect can't touch, does.)
 */
export function useLiveZoom(): number {
  const committed = useViewportStore((s) => s.zoom);
  return useLivePendingZoom() ?? committed;
}

/**
 * Camera state (pan + zoom) lives outside MapDoc. It's UI/session state,
 * not document data — saved files are camera-agnostic, but local camera
 * memory across reloads still works via its own localStorage key.
 */
export const useViewportStore = create<ViewportState>()(
  persist(
    (set) => ({
      x: 0,
      y: 0,
      zoom: 1,
      // Also voids any in-flight live viewport: an external camera jump
      // (Reset view, sidebar centering, the warning-toast jump) must kill a
      // scheduled wheel-settle commit, or the stale pre-jump pending snaps
      // the camera back up to 90ms later (and post-jump momentum ticks would
      // rebase onto it). commitPending itself is unaffected — it reads
      // `pending` before calling here, and its own trailing setPending(null)
      // becomes a no-op.
      setViewport: (v) => {
        set(v);
        useLiveViewportStore.getState().setPending(null);
      },
      gridVisible: true,
      setGridVisible: (gridVisible) => set({ gridVisible }),
      gridSize: 10,
      setGridSize: (gridSize) => set({ gridSize }),
      showWaypoints: false,
      setShowWaypoints: (showWaypoints) => set({ showWaypoints }),
      showAnchors: false,
      setShowAnchors: (showAnchors) => set({ showAnchors }),
      showNetwork: true,
      setShowNetwork: (showNetwork) => set({ showNetwork }),
      showLineCircles: true,
      setShowLineCircles: (showLineCircles) => set({ showLineCircles }),
      showGuides: true,
      setShowGuides: (showGuides) => set({ showGuides }),
      showTransfers: true,
      setShowTransfers: (showTransfers) => set({ showTransfers }),
      showSvgImages: true,
      setShowSvgImages: (showSvgImages) => set({ showSvgImages }),
      showTextLabels: true,
      setShowTextLabels: (showTextLabels) => set({ showTextLabels }),
      showPolygons: true,
      setShowPolygons: (showPolygons) => set({ showPolygons }),
      showRouteBullets: true,
      setShowRouteBullets: (showRouteBullets) => set({ showRouteBullets }),
      dayCanvasColor: 'white',
      setDayCanvasColor: (dayCanvasColor) => set({ dayCanvasColor }),
      darkUiInDay: false,
      setDarkUiInDay: (darkUiInDay) => set({ darkUiInDay }),
    }),
    {
      name: 'massimo-viewport',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        x: s.x,
        y: s.y,
        zoom: s.zoom,
        gridVisible: s.gridVisible,
        gridSize: s.gridSize,
        showWaypoints: s.showWaypoints,
        // Persisted (unlike showNetwork): hiding anchors is a durable "I'm done
        // routing transfers" preference, not a momentary get-out-of-my-way.
        showAnchors: s.showAnchors,
        // The narrow kind toggles persist for the same reason, and because the
        // View button carries a hidden-content mark (see anyLayerHidden)
        // that answers "where did my polygons go" on the next launch.
        showLineCircles: s.showLineCircles,
        showGuides: s.showGuides,
        showTransfers: s.showTransfers,
        showSvgImages: s.showSvgImages,
        showTextLabels: s.showTextLabels,
        showPolygons: s.showPolygons,
        showRouteBullets: s.showRouteBullets,
        dayCanvasColor: s.dayCanvasColor,
        darkUiInDay: s.darkUiInDay,
        // showNetwork is deliberately absent, alone among the visibility flags:
        // it is the broad one, and hiding it blanks most of a map. That makes it
        // a momentary "get out of my way" toggle rather than a saved preference
        // — persisting it would let a reload open onto an apparently empty map.
        // The narrow toggles above each clear one kind, so a reload under them
        // still shows a recognisable map.
      }),
    },
  ),
);
