import { create } from 'zustand';

/**
 * Easter egg: alt-clicking the toolbar's "M" bullet drops it out of the bar and
 * turns it into a bouncing ball (BouncingBullet). Modal — while it's loose the
 * map is dimmed and inert, and any click on the map puts the badge back.
 *
 * Deliberately its own store rather than a `useSelection` ui mode: those carry
 * mode-exit subscriptions (append GC and friends) that a toy has no business
 * entangling itself with.
 *
 * Three phases, not a boolean, because entering and leaving are crossfades: the
 * toolbar badge hides for `live` and fades back in during `exiting`, while the
 * loose ball fades out over the same beat.
 */
export type FunPhase = 'off' | 'live' | 'exiting';

interface FunModeState {
  phase: FunPhase;
  /** Window-space center the ball drops from — the badge's own resting spot. */
  origin: { x: number; y: number };
  enter: (origin: { x: number; y: number }) => void;
  beginExit: () => void;
  finishExit: () => void;
}

export const useFunMode = create<FunModeState>((set) => ({
  phase: 'off',
  origin: { x: 0, y: 0 },
  enter: (origin) => set({ phase: 'live', origin }),
  beginExit: () => set((s) => (s.phase === 'live' ? { phase: 'exiting' } : s)),
  finishExit: () => set((s) => (s.phase === 'exiting' ? { phase: 'off' } : s)),
}));

/** True from the drop until the crossfade back finishes. Read by App's global
 *  key handler, which stays inert for the whole modal stretch. */
export const isFunModeActive = (): boolean => useFunMode.getState().phase !== 'off';
