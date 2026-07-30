import type { StationId } from '../model/types';
import { isHistoryGrouping } from './history';
import { beginHistoryGroup, useDoc, useSelection } from './store';

/**
 * The current selection's ids across every multi-selectable kind, one concrete
 * list per kind. Structurally assignable to transforms.LockableItemIds, so the
 * same struct feeds bulk lock/unlock and the bulk gestures below.
 *
 * `anchors` is the exception to that sentence: transfer anchors have no
 * `locked` field, so `setItemsLocked` simply ignores the key. That is
 * deliberate, not an oversight — but it does mean any bulk lock/unlock UI must
 * exclude anchors from its "N items" affordance, or it offers to lock things it
 * cannot lock (see SelectionPopover's lockableTotal).
 */
export interface SelectionItemIds {
  stations: StationId[];
  bullets: string[];
  labels: string[];
  polygons: string[];
  svgImages: string[];
  anchors: string[];
  lineCircles: string[];
}

// The selection minus locked members — locked items resist Delete, arrow-nudge
// and cut, so every bulk gesture filters through here the same way.
export function unlockedSelectedItemIds(): SelectionItemIds {
  const doc = useDoc.getState();
  const sel = useSelection.getState();
  return {
    stations: sel.selectedStationIds.filter((id) => !doc.stations[id]?.locked),
    bullets: sel.selectedRouteBulletIds.filter((id) => !doc.routeBullets[id]?.locked),
    labels: sel.selectedLabelIds.filter((id) => !doc.textLabels[id]?.locked),
    polygons: sel.selectedPolygonIds.filter((id) => !doc.polygons[id]?.locked),
    svgImages: sel.selectedSvgImageIds.filter((id) => !doc.svgImages[id]?.locked),
    // No lock filter: anchors have none. Breaking the visual symmetry of the
    // lines above is the honest spelling — a `.filter(() => true)` would read
    // like a lock check that happens to pass.
    anchors: sel.selectedAnchorIds,
    lineCircles: sel.selectedLineCircleIds.filter((id) => !doc.lineCircles[id]?.locked),
  };
}

export function itemIdCount(ids: SelectionItemIds): number {
  return (
    ids.stations.length +
    ids.bullets.length +
    ids.labels.length +
    ids.polygons.length +
    ids.svgImages.length +
    // MANDATORY: both bulk gestures gate on this count being non-zero, so an
    // anchor-only selection would silently ignore Delete and the arrow keys.
    ids.anchors.length +
    ids.lineCircles.length
  );
}

/**
 * Delete every UNLOCKED selected item in one history entry (a single Ctrl-Z
 * reverts the lot), clearing the selection first so no id dangles at a deleted
 * item. Locked members survive — lock protects against deletion. Returns false
 * (and touches nothing) when the unlocked subset is empty, so keyboard callers
 * can fall through to other Delete targets. Shared by the Delete key (App.tsx)
 * and the selection popover's "Delete all".
 */
export function deleteUnlockedSelection(): boolean {
  const ids = unlockedSelectedItemIds();
  if (itemIdCount(ids) === 0) return false;
  // Drop the whole selection first so no id dangles at a deleted item.
  useSelection.getState().clearAllSelections();
  // The Delete key can land while a drag gesture's group is open (groups
  // don't nest) — fold in rather than stealing it.
  const group = isHistoryGrouping() ? null : beginHistoryGroup();
  const doc = useDoc.getState();
  for (const id of ids.stations) doc.deleteStation(id);
  for (const id of ids.bullets) doc.deleteRouteBullet(id);
  for (const id of ids.labels) doc.deleteTextLabel(id);
  for (const id of ids.polygons) doc.deletePolygon(id);
  for (const id of ids.svgImages) doc.deleteSvgImage(id);
  // Inside the same group, so a mixed station+anchor delete stays ONE undo
  // entry. deleteTransferAnchor also cascades the transfers bound to it.
  for (const id of ids.anchors) doc.deleteTransferAnchor(id);
  // Deleting a circle strips its stations' bindings in place (they stay put;
  // their edges just re-route octolinearly).
  for (const id of ids.lineCircles) doc.deleteLineCircle(id);
  group?.commit();
  return true;
}
