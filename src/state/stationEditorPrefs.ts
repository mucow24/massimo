import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface StationEditorPrefsState {
  /** Whether the Style section's detail rows (Size → Tracking) are expanded in
   *  the station popover. The style picker itself always shows; only the manual
   *  typography overrides collapse. A UI preference, not document state —
   *  persisted so the choice sticks across stations and reloads. Defaults to
   *  collapsed to keep the multi-section panel compact. */
  styleExpanded: boolean;
  setStyleExpanded: (styleExpanded: boolean) => void;
}

/**
 * Station editor preferences. Mirrors {@link useLabelEditorPrefs}: a persisted
 * UI-preference store, separate from document state, so it survives reloads and
 * switching maps.
 */
export const useStationEditorPrefs = create<StationEditorPrefsState>()(
  persist(
    (set) => ({
      styleExpanded: false,
      setStyleExpanded: (styleExpanded) => set({ styleExpanded }),
    }),
    {
      name: 'massimo-station-editor-prefs-v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ styleExpanded: s.styleExpanded }),
    },
  ),
);
