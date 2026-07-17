import type { StationId } from '../model/types';
import { beginHistoryGroup, useDoc, useSelection } from './store';

/**
 * The current selection's ids across every multi-selectable kind, one concrete
 * list per kind. Structurally assignable to transforms.LockableItemIds, so the
 * same struct feeds bulk lock/unlock and the bulk gestures below.
 */
export interface SelectionItemIds {
  stations: StationId[];
  bullets: string[];
  labels: string[];
  polygons: string[];
  svgImages: string[];
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
  };
}

export function itemIdCount(ids: SelectionItemIds): number {
  return (
    ids.stations.length +
    ids.bullets.length +
    ids.labels.length +
    ids.polygons.length +
    ids.svgImages.length
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
  const group = beginHistoryGroup();
  const doc = useDoc.getState();
  for (const id of ids.stations) doc.deleteStation(id);
  for (const id of ids.bullets) doc.deleteRouteBullet(id);
  for (const id of ids.labels) doc.deleteTextLabel(id);
  for (const id of ids.polygons) doc.deletePolygon(id);
  for (const id of ids.svgImages) doc.deleteSvgImage(id);
  group.commit();
  return true;
}
