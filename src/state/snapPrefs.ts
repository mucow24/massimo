import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { DEFAULT_SNAP_MODES, type SnapModes } from '../geometry/snap';

interface SnapPrefsState {
  modes: SnapModes;
  /** Saved snapshots of {@link modes}, keyed by the digit that recalls them
   *  (0–9). Sparse on purpose: a slot the user has never saved is simply
   *  absent, which is how {@link recallPreset} knows to leave the live modes
   *  alone rather than reset them. */
  presets: Record<number, SnapModes>;
  /** Set one snap mode. Value type is the union across keys (booleans for
   *  line/equidistant/tens, the directional enums for all/grid) — the
   *  toolbar's spec table is the source of truth for which values are legal
   *  per key, so a correlated generic isn't worth the call-site casts. */
  setMode: (key: keyof SnapModes, value: SnapModes[keyof SnapModes]) => void;
  /** Snapshot the live modes into `slot`, replacing whatever was there. */
  savePreset: (slot: number) => void;
  /** Apply the snapshot in `slot`. Returns false — changing nothing — when the
   *  slot has never been saved, so the caller can say so instead of silently
   *  doing nothing. */
  recallPreset: (slot: number) => boolean;
}

/**
 * What actually goes to localStorage (see `partialize`) — with `modes` PARTIAL
 * on the way back in, which is the honest shape of a stored blob: it carries
 * whatever keys existed when it was written, and {@link useSnapPrefs}'s `merge`
 * completes it.
 */
interface SnapPrefsPersisted {
  modes: Partial<SnapModes>;
  presets: Record<number, SnapModes>;
}

/**
 * Bring a persisted blob up to the current SHAPE: v0 stored `all`/`grid` as
 * booleans, and they become the directional enums (`all: true → 'all'`,
 * `grid: true → 'both'`, false → 'off'). A v1 blob's are already strings and
 * pass through untouched.
 *
 * Filling in keys the blob PREDATES is deliberately not this function's job —
 * that lives in `merge`, which runs on every rehydrate rather than only when
 * the stored version differs from the configured one.
 */
function migrateSnapPrefs(persisted: unknown): SnapPrefsPersisted {
  const modes = (persisted as { modes?: Partial<Record<keyof SnapModes, unknown>> })?.modes ?? {};
  const { all, grid } = modes;
  return {
    // A v0/v1 blob predates presets entirely — nothing to carry across.
    presets: {},
    modes: {
      ...(modes as Partial<SnapModes>),
      ...(typeof all === 'boolean' ? { all: all ? ('all' as const) : ('off' as const) } : {}),
      ...(typeof grid === 'boolean' ? { grid: grid ? ('both' as const) : ('off' as const) } : {}),
    },
  };
}

/**
 * User-toggleable snap modes. UI preference, not document state — kept in a
 * separate store so opening a different map doesn't clobber the user's snap
 * choices. Persisted to localStorage so toggles — and the preset slots
 * Ctrl/Cmd+Shift+digit saves into and Shift+digit recalls — stick across
 * reloads.
 */
export const useSnapPrefs = create<SnapPrefsState>()(
  persist(
    (set, get) => ({
      modes: DEFAULT_SNAP_MODES,
      presets: {},
      setMode: (key, value) => set((s) => ({ modes: { ...s.modes, [key]: value } })),
      savePreset: (slot) => set((s) => ({ presets: { ...s.presets, [slot]: { ...s.modes } } })),
      recallPreset: (slot) => {
        const saved = get().presets[slot];
        if (!saved) return false;
        // Fill from the defaults on the way out. A preset saved before a mode
        // existed has no key for it, and the persist migration can't reach a
        // value nested this deep — so without the spread that mode would land
        // `undefined`, or (worse) keep whatever the live modes happened to
        // hold, making a recall depend on what it replaced.
        set({ modes: { ...DEFAULT_SNAP_MODES, ...saved } });
        return true;
      },
    }),
    {
      name: 'massimo-snap-prefs-v1',
      version: 2,
      migrate: (persisted, version) =>
        version < 2 ? migrateSnapPrefs(persisted) : (persisted as SnapPrefsPersisted),
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ modes: s.modes, presets: s.presets }),
      // zustand's own shallow merge, plus the fill that keeps `modes` whole.
      // That merge replaces `modes` WHOLESALE, so a blob written before a mode
      // existed leaves it `undefined` — a required field missing at runtime,
      // with the toolbar reading one thing and the snap code another.
      //
      // The fill belongs HERE and not in `migrate`: zustand runs `migrate` only
      // when the stored version differs from the configured one, so every blob
      // this build writes skips it entirely. A mode added without a version
      // bump would land undefined on every existing installation while the
      // migration's own tests went on passing.
      //
      // A PRESET's modes are a level deeper than any merge hook reaches, so
      // they are filled on the way out instead — see `recallPreset`.
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as Partial<SnapPrefsPersisted>;
        return {
          ...current,
          ...stored,
          // Absent is not a violation: a blob with no `modes` at all keeps the
          // live ones, exactly as the shallow merge alone would have.
          modes: stored.modes ? { ...DEFAULT_SNAP_MODES, ...stored.modes } : current.modes,
        };
      },
    },
  ),
);
