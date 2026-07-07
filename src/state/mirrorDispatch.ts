import { beginHistoryGroup, useDoc, useSelection } from './store';
import { isHistoryGrouping } from './history';
import { findMatchingStations, type LayoutOffset } from '../model/matching';
import type { StationId } from '../model/types';

// Mirror-matching fan-out, shared by every station-layout editing surface
// (inspector controls, keyboard nudges, canvas drags). When mirror matching
// is on, an edit to one station broadcasts to every station that renders
// identically AND shares a line with it (model/matching.ts); each match
// carries a layoutOffset (0-7, in 45° steps) so callers can rotate
// local-frame (dRow,dCol) deltas into the match's frame via rotateGridDelta.
// Rotation-invariant edits (dot style/size, offsets, absolute align values)
// ignore the offset.

export interface MirrorTarget {
  id: StationId;
  layoutOffset: LayoutOffset;
}

/**
 * The station itself plus — with mirror matching on — its current matches.
 * Drag gestures MUST capture this once at gesture start and fan out to the
 * captured list: the first write to the source station changes its layout
 * and dissolves the match, so a later recompute would find nothing.
 */
export function captureMirrorTargets(stationId: StationId): MirrorTarget[] {
  const targets: MirrorTarget[] = [{ id: stationId, layoutOffset: 0 }];
  if (!useSelection.getState().mirrorMatching) return targets;
  const doc = useDoc.getState();
  for (const m of findMatchingStations({ stations: doc.stations, lines: doc.lines }, stationId)) {
    targets.push({ id: m.id, layoutOffset: m.layoutOffset });
  }
  return targets;
}

/**
 * Apply `act` to the station and — with mirror matching on — to every match.
 * NEVER opens a history group of its own. Use this variant from call sites
 * that explicitly manage their group (a keyboard press writing several
 * fields, a drag gesture's open group); use dispatchMirrored for one-shot
 * controls.
 */
export function fanOutMirrored(
  stationId: StationId,
  act: (sid: StationId, layoutOffset: LayoutOffset) => void,
): void {
  for (const t of captureMirrorTargets(stationId)) act(t.id, t.layoutOffset);
}

/**
 * Standalone dispatch for one-shot controls (buttons, pickers, numeric
 * fields): like fanOutMirrored, but a genuine fan-out is wrapped in ONE
 * history group so undo reverts the whole broadcast at once. Two cases skip
 * the group: a single-station dispatch (one store set is one entry already),
 * and a dispatch fired while a group is ALREADY open (a focused field's
 * useFieldHistory arc, e.g. the dot-size spinbutton) — groups don't nest,
 * and the outer group already collapses the writes into its single entry
 * (see isHistoryGrouping / #146).
 */
export function dispatchMirrored(
  stationId: StationId,
  act: (sid: StationId, layoutOffset: LayoutOffset) => void,
): void {
  const targets = captureMirrorTargets(stationId);
  if (targets.length === 1) {
    act(targets[0].id, targets[0].layoutOffset);
    return;
  }
  const group = isHistoryGrouping() ? null : beginHistoryGroup();
  for (const t of targets) act(t.id, t.layoutOffset);
  group?.commit();
}
