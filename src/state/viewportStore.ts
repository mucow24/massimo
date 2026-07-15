import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Viewport } from '../model/types';

/** Grid cell sizes the toolbar button cycles through, in world units. */
export const GRID_SIZES: readonly number[] = [5, 10, 20];

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
  darkMode: boolean;
  setDarkMode: (dark: boolean) => void;
  /** Render overlay: reveal waypoint stations (normally hidden) — their stops
   *  in a black-stroke/white-fill dot and their names with a "WP" lozenge. A
   *  pure paint toggle; it never mutates the doc (per-stop styles stay intact,
   *  same as the `isWaypoint` flag itself). */
  showWaypoints: boolean;
  setShowWaypoints: (show: boolean) => void;
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
}

/**
 * The live, un-committed viewport during an in-flight gesture (pan / wheel
 * zoom), or null between gestures. useViewport writes the SVG viewBox
 * imperatively each event and publishes the same viewport here so overlays
 * pinned to the canvas (the item popovers) can track the gesture per frame —
 * the only React subscriber is the small popover layer, so the ~2.7k-node SVG
 * tree (which reads the committed `useViewportStore`) is never re-rendered
 * mid-gesture. Kept OUT of `useViewportStore` precisely because that store is
 * persisted: a per-frame write there would hammer localStorage.
 */
interface LiveViewportState {
  pending: Viewport | null;
  setPending: (v: Viewport | null) => void;
}

export const useLiveViewportStore = create<LiveViewportState>((set) => ({
  pending: null,
  setPending: (pending) => set({ pending }),
}));

/**
 * The zoom a SELECTED item's chrome should size its handles by: the in-flight
 * (pending) gesture zoom while a pan/zoom is live, else the committed zoom.
 * Subscribing to `pending` re-renders the caller on every gesture frame, so use
 * it ONLY inside selected-only overlays (one item at a time) — never in a
 * per-item body pass, which would re-render the whole ~2.7k-node canvas per
 * frame, the exact cost the imperative viewBox avoids. Handles stay
 * screen-constant AND track the gesture, so nothing snaps when it commits.
 * (Stroke widths don't need this — vector-effect="non-scaling-stroke" holds
 * them with no subscription at all; only handle body geometry, which
 * vector-effect can't touch, does.)
 */
export function useLiveZoom(): number {
  const committed = useViewportStore((s) => s.zoom);
  const pending = useLiveViewportStore((s) => s.pending);
  return pending?.zoom ?? committed;
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
      setViewport: (v) => set(v),
      gridVisible: true,
      setGridVisible: (gridVisible) => set({ gridVisible }),
      gridSize: 10,
      setGridSize: (gridSize) => set({ gridSize }),
      darkMode: false,
      setDarkMode: (darkMode) => set({ darkMode }),
      showWaypoints: false,
      setShowWaypoints: (showWaypoints) => set({ showWaypoints }),
      showNetwork: true,
      setShowNetwork: (showNetwork) => set({ showNetwork }),
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
        darkMode: s.darkMode,
        showWaypoints: s.showWaypoints,
        // showNetwork is deliberately absent: hiding the network is a momentary
        // "get out of my way" toggle, not a saved preference. Persisting it
        // would let a reload open onto an apparently empty map, with only the
        // toolbar button's state to explain where everything went.
      }),
    },
  ),
);
