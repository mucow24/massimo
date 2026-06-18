import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Viewport } from '../model/types';

interface ViewportState extends Viewport {
  setViewport: (v: Viewport) => void;
  gridVisible: boolean;
  setGridVisible: (visible: boolean) => void;
  /** Grid cell size in world units. Drives both the visible grid and all grid
   *  snapping (toggled between 10 and 5 from the toolbar). */
  gridSize: number;
  setGridSize: (size: number) => void;
  darkMode: boolean;
  setDarkMode: (dark: boolean) => void;
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
      }),
    },
  ),
);
