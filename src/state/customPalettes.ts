import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  BUILTIN_PALETTE_NAMES,
  copyPalette,
  dropEmptyPalettes,
  isPaletteSort,
  type Palette,
  type PaletteSort,
} from '../model/palettes';
import { healPersistedUnion } from './persistedUnion';

/** The order a fresh library opens in, and what a stored non-member heals to. */
const DEFAULT_PALETTE_SORT: PaletteSort = 'name';

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
   * star. Returns false (changing nothing) when the name is a built-in's — the
   * library is name-keyed, so it cannot hold two rows under one name — or when
   * the palette carries no colors, which is not a palette (`dropEmptyPalettes`).
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
      sort: DEFAULT_PALETTE_SORT,
      addPalette: (input) => {
        if (BUILTIN_PALETTE_NAMES.has(input.name)) return false;
        if (input.swatches.length === 0) return false;
        // A COPY, for the same reason the doc takes one: saving a map's palette
        // back here hands over a live document array, and the two are supposed
        // to be independent from that moment on.
        const palette = copyPalette(input);
        set((s) => {
          const idx = s.palettes.findIndex((p) => p.name === palette.name);
          if (idx >= 0) {
            const next = s.palettes.slice();
            next[idx] = palette;
            return { palettes: next };
          }
          return { palettes: [...s.palettes, palette] };
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
      version: 2,
      migrate: (persisted, version) => {
        const s = persisted as { palettes?: (Palette & { id?: string })[] };
        if (!s?.palettes) return s as CustomPalettesState;
        let palettes: Palette[] = s.palettes;
        // v0 → v1: palettes carried a generated `custom:<slug>` id, because the
        // doc referenced them by id. The doc holds copies now and the library is
        // keyed by name, so the ids have nothing left to name — drop them. The
        // two new fields come from the initial state via persist's merge.
        if (version < 1) palettes = palettes.map(({ name, swatches }) => ({ name, swatches }));
        // v1 → v2: a palette carries at least one color. New… used to seed the
        // library with an empty one on the way into the editor, and only the
        // map's copy ever took the colors, so a stub was left under every name
        // it ever minted.
        if (version < 2) palettes = dropEmptyPalettes(palettes);
        return { ...s, palettes } as CustomPalettesState;
      },
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ palettes: s.palettes, starred: s.starred, sort: s.sort }),
      // zustand's shallow merge, plus the gate on the one stored UNION here
      // (see healPersistedUnion). A mode PALETTE_SORTS no longer offers leaves
      // the picker's Radix trigger blank while `libraryPalettes` falls through
      // to plain name order — and `starred` is a FILTER as well as an order, so
      // a stuck value can hide most of the library too.
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as Partial<CustomPalettesState>;
        return {
          ...current,
          ...stored,
          sort: healPersistedUnion(stored.sort, current.sort, isPaletteSort, DEFAULT_PALETTE_SORT),
        };
      },
    },
  ),
);
