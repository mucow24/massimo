import { useSelection, type UiMode } from './selection';
import { useViewportStore } from './viewportStore';

/**
 * Modes that REVEAL transfer anchors regardless of the toolbar toggle.
 *
 * Anchors are hidden by default (they clutter a finished map), but the two
 * gestures that are ABOUT anchors have to show them or they ask the user to
 * click something invisible:
 *   - creating-transfer — an anchor is a transfer endpoint; picking one is the
 *     whole reason anchors exist.
 *   - placing-anchor — you need to see where the existing ones are to place the
 *     next one sensibly.
 *
 * This is a DERIVATION, not a temporary write to `showAnchors`. Flipping the
 * persisted flag on mode entry would need a matching revert on every exit path
 * (commit, Esc, right-click, mode switch, undo-driven reconcile), and any missed
 * one would strand the user's own preference in the wrong state.
 */
export function anchorsRevealedByMode(kind: UiMode['kind']): boolean {
  return kind === 'creating-transfer' || kind === 'placing-anchor';
}

/** Are transfer anchors on screen right now? Non-reactive (pointer handlers). */
export function anchorsVisibleNow(): boolean {
  const vp = useViewportStore.getState();
  if (!vp.showNetwork) return false;
  return vp.showAnchors || anchorsRevealedByMode(useSelection.getState().uiMode.kind);
}

/** Reactive twin of {@link anchorsVisibleNow}, for the render path. */
export function useAnchorsVisible(): boolean {
  const showNetwork = useViewportStore((s) => s.showNetwork);
  const showAnchors = useViewportStore((s) => s.showAnchors);
  const modeKind = useSelection((s) => s.uiMode.kind);
  if (!showNetwork) return false;
  return showAnchors || anchorsRevealedByMode(modeKind);
}
