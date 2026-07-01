import { beginHistoryGroup, useDoc, useSelection } from './store';
import { findMatchingStations, type LayoutOffset } from '../model/matching';
import type { StationId } from '../model/types';

// Mirror-matching fan-out, shared by every station-layout editing surface
// (inspector controls, keyboard nudges, canvas drags). When mirror matching
// is on, an edit to one station broadcasts to every station that renders
// identically AND shares a line with it (model/matching.ts); each match
// carries a layoutOffset (0-3) so callers can rotate local-frame (dRow,dCol)
// deltas into the match's frame via rotateGridDelta. Rotation-invariant edits
// (dot style/size, offsets, absolute align values) ignore the offset.

/**
 * Apply `act` to the station and — with mirror matching on — to every match.
 * NEVER opens a history group: zundo's pause/resume is a plain boolean, so
 * groups must not nest. Use this variant from call sites that already hold a
 * group open (keyboard nudge handlers, drag gestures); use dispatchMirrored
 * for standalone one-shot controls.
 */
export function fanOutMirrored(
  stationId: StationId,
  act: (sid: StationId, layoutOffset: LayoutOffset) => void,
): void {
  const sel = useSelection.getState();
  if (!sel.mirrorMatching) {
    act(stationId, 0);
    return;
  }
  const doc = useDoc.getState();
  const matches = findMatchingStations({ stations: doc.stations, lines: doc.lines }, stationId);
  act(stationId, 0);
  for (const m of matches) act(m.id, m.layoutOffset);
}

/**
 * Standalone dispatch for one-shot controls (buttons, pickers, spinners):
 * like fanOutMirrored, but a genuine fan-out is wrapped in ONE history group
 * so undo reverts the whole broadcast at once. A single-station dispatch
 * stays ungrouped — one store set is one history entry already, and skipping
 * the group avoids nesting inside a focused field's useFieldHistory group.
 */
export function dispatchMirrored(
  stationId: StationId,
  act: (sid: StationId, layoutOffset: LayoutOffset) => void,
): void {
  const sel = useSelection.getState();
  const doc = useDoc.getState();
  const matches = sel.mirrorMatching
    ? findMatchingStations({ stations: doc.stations, lines: doc.lines }, stationId)
    : [];
  if (matches.length === 0) {
    act(stationId, 0);
    return;
  }
  const group = beginHistoryGroup();
  act(stationId, 0);
  for (const m of matches) act(m.id, m.layoutOffset);
  group.commit();
}
