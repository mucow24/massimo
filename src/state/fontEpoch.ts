import { create } from 'zustand';

/**
 * A counter bumped whenever the web fonts finish loading and the text-measure
 * cache is dropped (see App.tsx). Every component whose layout comes from
 * `measureTextLabel` / `labelLayoutLocal` subscribes to it, so the re-measure
 * actually reaches the canvas.
 *
 * It is a STORE rather than App-local `useState` on purpose. `StationView` is
 * `memo`'d and receives referentially-stable props (`station`/`lines` are
 * unchanged store objects, `zoom` is the same number, `onStartDrag` is a stable
 * `useCallback`), so an App-level state bump re-renders App and MapCanvas and
 * then React bails out of the entire station subtree — leaving every station
 * label at its fallback-font geometry until an unrelated edit disturbs it. A
 * store subscription re-renders through `memo` regardless of prop equality,
 * which is the same mechanism `showNetwork` already relies on there.
 *
 * Session state: never persisted, never in history.
 */
export const useFontEpoch = create<{ epoch: number; bump: () => void }>((set) => ({
  epoch: 0,
  bump: () => set((s) => ({ epoch: s.epoch + 1 })),
}));

/** Subscribe to the epoch. The VALUE is deliberately unused by callers — they
 *  read it only to re-render (and therefore re-measure) when fonts arrive. */
export const useFontEpochValue = (): number => useFontEpoch((s) => s.epoch);
