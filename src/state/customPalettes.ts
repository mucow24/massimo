import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { BUILTIN_PALETTE_NAMES, type Palette, type PaletteSort } from '../model/palettes';

interface CustomPalettesState {
  /** The user's imported palettes — the half of the library that isn't built in. */
  palettes: Palette[];
  /**
   * Starred palette NAMES, built-in ones included: a star is a mark on the
   * library, not on a definition, so it has to outlive a list the built-ins
   * aren't in.
   */
  starred: string[];
  /** How the library column is listed. Persisted — a favourites list that
   *  reverts to A–Z on every open isn't one. */
  sort: PaletteSort;
  /**
   * Add an imported palette, upserting by name: re-importing a name already in
   * the library replaces its swatches in place, keeping its position and its
   * star. Returns false (changing nothing) when the name is a built-in's —
   * the library is name-keyed, so it cannot hold two rows under one name.
   */
  addPalette: (input: Palette) => boolean;
  /** Remove an imported palette, and the star that was on it. */
  removePalette: (name: string) => void;
  /** Rename an imported palette, carrying its star. Returns false when the new
   *  name is empty or already taken (by a built-in or another import). */
  renamePalette: (from: string, to: string) => boolean;
  setStarred: (name: string, starred: boolean) => void;
  setSort: (sort: PaletteSort) => void;
}

/**
 * The user's half of the palette library: imported palette definitions, the
 * stars over the whole library, and how the list is sorted. App-level, like
 * snap prefs — every map can reach these.
 *
 * This is a LIBRARY, not what any map paints with. Adding a palette to a map
 * copies it into the doc (`MapDoc.palettes`), so deleting it here never
 * disturbs a map that already holds a copy.
 */
export const useCustomPalettes = create<CustomPalettesState>()(
  persist(
    (set, get) => ({
      palettes: [],
      starred: [],
      sort: 'name',
      addPalette: ({ name, swatches }) => {
        if (BUILTIN_PALETTE_NAMES.has(name)) return false;
        set((s) => {
          const idx = s.palettes.findIndex((p) => p.name === name);
          if (idx >= 0) {
            const next = s.palettes.slice();
            next[idx] = { name, swatches };
            return { palettes: next };
          }
          return { palettes: [...s.palettes, { name, swatches }] };
        });
        return true;
      },
      removePalette: (name) =>
        set((s) => ({
          palettes: s.palettes.filter((p) => p.name !== name),
          starred: s.starred.filter((n) => n !== name),
        })),
      renamePalette: (from, to) => {
        const name = to.trim();
        if (!name) return false;
        if (name === from) return true;
        if (BUILTIN_PALETTE_NAMES.has(name)) return false;
        const { palettes } = get();
        if (palettes.some((p) => p.name === name)) return false;
        if (!palettes.some((p) => p.name === from)) return false;
        set((s) => ({
          palettes: s.palettes.map((p) => (p.name === from ? { ...p, name } : p)),
          starred: s.starred.map((n) => (n === from ? name : n)),
        }));
        return true;
      },
      setStarred: (name, starred) =>
        set((s) => ({
          starred: starred
            ? s.starred.includes(name)
              ? s.starred
              : [...s.starred, name]
            : s.starred.filter((n) => n !== name),
        })),
      setSort: (sort) => set({ sort }),
    }),
    {
      name: 'massimo-custom-palettes-v1',
      version: 1,
      // v0 → v1: palettes carried a generated `custom:<slug>` id, because the
      // doc referenced them by id. The doc holds copies now and the library is
      // keyed by name, so the ids have nothing left to name — drop them. The
      // two new fields come from the initial state via persist's merge.
      migrate: (persisted, version) => {
        const s = persisted as { palettes?: (Palette & { id?: string })[] };
        if (version >= 1 || !s?.palettes) return s as CustomPalettesState;
        return {
          ...s,
          palettes: s.palettes.map(({ name, swatches }) => ({ name, swatches })),
        } as CustomPalettesState;
      },
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ palettes: s.palettes, starred: s.starred, sort: s.sort }),
    },
  ),
);
