import type { Station } from '../model/types';
import { hoveredChrome, type SelectionState } from './selection';

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
 * of inventing its own gate. The whole thing is idle-only, from the other side
 * of the registry's own reveal rule: creating-transfer and placing-anchor are
 * `showAnchors`'s `revealedBy` modes and already show EVERY anchor, and the
 * layout editor draws its own grab ring on each of the edited station's anchors
 * — a second, differently-shaped copy underneath would only be noise.
 *
 * Whether anchors are on screen AT ALL is the registry's question, not this
 * module's: `kindVisible('showAnchors', …)` and its non-reactive twin
 * `kindVisibleNow` ([visibility.ts](src/state/visibility.ts)). This narrower
 * reveal is the part that has no menu row, which is why it lives here.
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
