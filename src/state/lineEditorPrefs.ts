import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface LineEditorPrefsState {
  /** Whether the style-detail section (Line width → Inner strokes) is expanded in
   *  the pinned line popover. Identity (name/service/color) and the Style
   *  picker always show; the full parameter stack collapses so the Edit Stops
   *  panel stays compact. A UI preference, not document state — persisted so
   *  the choice sticks across lines and reloads. Defaults to collapsed. */
  styleExpanded: boolean;
  setStyleExpanded: (styleExpanded: boolean) => void;
}

/**
 * Line editor preferences. Mirrors {@link useStationEditorPrefs}: a persisted
 * UI-preference store, separate from document state, so it survives reloads
 * and switching maps.
 */
export const useLineEditorPrefs = create<LineEditorPrefsState>()(
  persist(
    (set) => ({
      styleExpanded: false,
      setStyleExpanded: (styleExpanded) => set({ styleExpanded }),
    }),
    {
      name: 'massimo-line-editor-prefs-v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ styleExpanded: s.styleExpanded }),
    },
  ),
);
