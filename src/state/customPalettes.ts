import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { KNOWN_PALETTE_IDS, type Palette, type PaletteSwatch } from '../model/palettes';
import { makeCustomPaletteId } from '../model/customPalette';

interface CustomPalettesState {
  palettes: Palette[];
  /**
   * Add a custom palette, upserting by exact name: re-adding a name that already
   * exists replaces that palette's swatches in place (reusing its id and list
   * position, so its active state survives a re-load). A genuinely new name gets
   * a fresh unique id and is appended (and is NOT activated — the caller leaves
   * it unchecked).
   */
  addPalette: (input: { name: string; swatches: PaletteSwatch[] }) => void;
  /** Remove a custom palette definition. Pruning it from the doc's active set is
   *  the doc store's job (see `deleteCustomPalette`). */
  removePalette: (id: string) => void;
}

/**
 * User-imported color palettes. Like snap prefs, these are an app-level
 * preference (available to every map), not document state — so they live in
 * their own localStorage-backed store rather than in the map doc.
 */
export const useCustomPalettes = create<CustomPalettesState>()(
  persist(
    (set) => ({
      palettes: [],
      addPalette: ({ name, swatches }) =>
        set((s) => {
          const idx = s.palettes.findIndex((p) => p.name === name);
          if (idx >= 0) {
            const next = s.palettes.slice();
            next[idx] = { ...next[idx], swatches };
            return { palettes: next };
          }
          const taken = new Set<string>([...KNOWN_PALETTE_IDS, ...s.palettes.map((p) => p.id)]);
          const id = makeCustomPaletteId(name, taken);
          return { palettes: [...s.palettes, { id, name, swatches }] };
        }),
      removePalette: (id) => set((s) => ({ palettes: s.palettes.filter((p) => p.id !== id) })),
    }),
    {
      name: 'massimo-custom-palettes-v1',
      version: 0,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ palettes: s.palettes }),
    },
  ),
);
