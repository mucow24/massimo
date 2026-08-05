import { create } from 'zustand';

/** Which column the sidebar's Lines list is ordered by. Lives with the store
 *  that holds the choice, so the pure ordering module (a component-layer
 *  concern) is what depends on the state layer and never the reverse. */
export type LineSortColumn = 'name' | 'stops';

interface LineListPrefsState {
  /** Sort column. Always ascending — the control is a dropdown, with no
   *  direction affordance to read a descending order off of. */
  sortBy: LineSortColumn;
  setSortBy: (sortBy: LineSortColumn) => void;
  /** Whether rows file under per-style subheaders. */
  groupByStyle: boolean;
  setGroupByStyle: (groupByStyle: boolean) => void;
  /** Collapsed group keys: a style id, or `''` for the untagged Custom bucket. */
  collapsed: ReadonlySet<string>;
  toggleGroup: (key: string) => void;
}

/**
 * Lines-list view preferences. Unlike the other `*Prefs` stores this one is
 * deliberately NOT persisted: the sort, the grouping and especially the
 * collapsed set are a view of ONE map's lines, and a set of style ids restored
 * into a different map would collapse groups at random.
 *
 * A store rather than component state because the panel unmounts constantly —
 * clicking a row is the list's primary action, and it hides the whole sidebar
 * for Edit Stops (see `sidebarVisible`). Held inside `LinesPanel`, the user's
 * sort and grouping would reset on every single edit.
 */
export const useLineListPrefs = create<LineListPrefsState>()((set) => ({
  sortBy: 'name',
  setSortBy: (sortBy) => set({ sortBy }),
  groupByStyle: false,
  setGroupByStyle: (groupByStyle) => set({ groupByStyle }),
  collapsed: new Set<string>(),
  toggleGroup: (key) =>
    set((s) => {
      const next = new Set(s.collapsed);
      if (!next.delete(key)) next.add(key);
      return { collapsed: next };
    }),
}));
