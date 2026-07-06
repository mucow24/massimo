import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface LabelEditorPrefsState {
  /** Soft-wrap long lines in the text label editor's textarea. Display-only —
   *  the label's stored text is untouched; wrapping just keeps a long justified
   *  paragraph visible instead of scrolling off the right edge. Persisted so it
   *  sticks across sessions rather than resetting each time the popover opens. */
  wrapText: boolean;
  setWrapText: (wrapText: boolean) => void;
}

/**
 * Text-label editor preferences. A UI preference, not document state — kept in
 * its own persisted store so it survives reloads and opening a different map.
 */
export const useLabelEditorPrefs = create<LabelEditorPrefsState>()(
  persist(
    (set) => ({
      wrapText: false,
      setWrapText: (wrapText) => set({ wrapText }),
    }),
    {
      name: 'massimo-label-editor-prefs-v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ wrapText: s.wrapText }),
    },
  ),
);
