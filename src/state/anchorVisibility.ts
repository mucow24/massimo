import type { Station } from '../model/types';
import { hoveredChrome, useSelection, type SelectionState, type UiMode } from './selection';
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

/**
 * The stations whose HOSTED anchors paint even with the anchor toggle off: the
 * one under the cursor, plus the selected ones.
 *
 * Anchors are hidden by default because they clutter a finished map — but when
 * you are looking AT a station you want to see what it carries. So the reveal is
 * scoped to that station rather than lifting the toggle: the rest of the network
 * stays clean. Free anchors are never revealed this way; they belong to no
 * station, so nothing about pointing at one asks for them.
 *
 * The hover half rides on {@link hoveredChrome}, so it appears and disappears
 * with every other piece of mouseover chrome (and stays quiet mid-pan) instead
 * of inventing its own gate. The whole thing is idle-only for the reason the
 * mode list above gives from the other side: creating-transfer and
 * placing-anchor already reveal EVERY anchor, and the layout editor draws its
 * own grab ring on each of the edited station's anchors — a second,
 * differently-shaped copy underneath would only be noise.
 */
export function revealedAnchorStations(
  stations: Record<string, Station>,
  s: SelectionState,
): Record<string, Station> {
  if (s.uiMode.kind !== 'idle') return {};
  const hover = hoveredChrome(s);
  // hoveredChrome already drops an ALREADY-SELECTED station, so the two halves
  // can't collide — but the Set keeps that a property of this code, not a
  // dependency on that one.
  const ids = new Set<string>(s.selectedStationIds);
  if (hover?.kind === 'station') ids.add(hover.id);
  const out: Record<string, Station> = {};
  for (const id of ids) {
    // A selection id can outlive its station (undo restores the doc without
    // touching this store), so resolve rather than trust.
    const st = stations[id];
    if (st) out[id] = st;
  }
  return out;
}

/** Reactive twin of {@link anchorsVisibleNow}, for the render path. */
export function useAnchorsVisible(): boolean {
  const showNetwork = useViewportStore((s) => s.showNetwork);
  const showAnchors = useViewportStore((s) => s.showAnchors);
  const modeKind = useSelection((s) => s.uiMode.kind);
  if (!showNetwork) return false;
  return showAnchors || anchorsRevealedByMode(modeKind);
}
