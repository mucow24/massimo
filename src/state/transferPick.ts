import { sameTransferEnd } from '../model/transforms';
import type { TransferEnd } from '../model/types';
import { useDoc, useSelection } from './store';

/**
 * One click of the transfer-creation flow: the first pick arms the mode, the
 * second commits the transfer and exits.
 *
 * Shared by every surface that can supply an end — a station's stop dots
 * (useStationInteraction) and the anchor layer (MapCanvas) — so the two-click
 * contract lives in one place. It used to be inline in the station handler,
 * which was fine while a station stop was the only thing an end could be.
 *
 * A repeat pick of the SAME point is deliberately inert rather than an exit:
 * `addTransfer` would refuse the zero-length segment anyway, and silently
 * dropping out of the mode on a mis-click is worse than doing nothing.
 */
export function pickTransferEnd(end: TransferEnd): void {
  const sel = useSelection.getState();
  if (sel.uiMode.kind !== 'creating-transfer') return;
  const first = sel.uiMode.firstEnd;
  if (!first) {
    sel.setTransferFirstEnd(end);
    // Clear the first-pick hover highlight — the dot is committed as the first
    // end now, not merely hovered.
    sel.setHoveredLineStop(null);
    return;
  }
  // Same test addTransfer applies, run here so the mode only exits when a
  // transfer was really created.
  if (sameTransferEnd(first, end)) return;
  useDoc.getState().addTransfer(first, end);
  sel.setUiMode({ kind: 'idle' });
  sel.setHoveredLineStop(null);
}
