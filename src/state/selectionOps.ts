import type { LockableKind } from '../model/transforms';
import type { StationId } from '../model/types';
import { isHistoryGrouping } from './history';
import { beginHistoryGroup, getCopyableSelection, useDoc, useSelection } from './store';
import { visibleSelectionKinds, type SelectionKind } from './visibility';

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
  guides: string[];
}

// Every lockable kind has a list above. `LockableItemIds` is all-optional, so a
// registry kind this struct forgot would type-check and then silently score
// zero in the bulk lock and in the popover's tally — a "Lock all" that never
// finishes and a count that never mentions it. Spelled as a type rather than a
// test, the same way store.ts pins the doc-field tuple: `never` while the
// coverage holds, and otherwise a constraint violation naming the missing kind,
// at this line, in the editor. Exported because `noUnusedLocals` would
// otherwise flag it.
export type SelectionCoversLockable<
  T extends never = Exclude<LockableKind, keyof SelectionItemIds>,
> = T;

// The same pin against the VISIBILITY registry, and it runs the other way: a
// kind added here but not there would read as permanently on screen, so a
// hidden layer would answer Delete after all. `visibleSelectionKinds` returns a
// complete record, so the reverse gap (a gate nothing selects) cannot hide.
export type SelectionKindsAllGated<
  T extends never = Exclude<keyof SelectionItemIds, SelectionKind>,
> = T;

/**
 * The selection an edit may actually act on: minus locked members, and minus
 * every kind the View menu is currently hiding.
 *
 * Lock is the obvious half — locked items resist Delete, arrow-nudge and cut,
 * so every bulk gesture filters through here the same way. Visibility is the
 * other half, and for the same reason `hitsForRect` keeps hidden kinds out of a
 * marquee: an item on a switched-off layer is not on screen, so a Delete aimed
 * at "the selection" would remove something the user cannot see, with nothing
 * to show for the keypress. Hidden members stay SELECTED — hiding is a peek, so
 * unhiding brings the whole group back — they simply do not answer. That is
 * deliberately SILENT: these gestures repeat (hold an arrow key down), so a
 * notice per press would be noise, and the group popover already reports the
 * visible tally rather than the raw one.
 *
 * Through `visibleSelectionKinds` — the one kind-to-row table, which the drag
 * tow reads too — so a kind its placing mode has revealed still counts as on
 * screen, and the two halves cannot acquire different opinions about a layer.
 */
export function unlockedSelectedItemIds(): SelectionItemIds {
  const doc = useDoc.getState();
  const sel = useSelection.getState();
  const shows = visibleSelectionKinds();
  return {
    stations: shows.stations
      ? sel.selectedStationIds.filter((id) => !doc.stations[id]?.locked)
      : [],
    bullets: shows.bullets
      ? sel.selectedRouteBulletIds.filter((id) => !doc.routeBullets[id]?.locked)
      : [],
    labels: shows.labels ? sel.selectedLabelIds.filter((id) => !doc.textLabels[id]?.locked) : [],
    polygons: shows.polygons
      ? sel.selectedPolygonIds.filter((id) => !doc.polygons[id]?.locked)
      : [],
    svgImages: shows.svgImages
      ? sel.selectedSvgImageIds.filter((id) => !doc.svgImages[id]?.locked)
      : [],
    // No lock filter: anchors have none. Breaking the visual symmetry of the
    // lines above is the honest spelling — a `.filter(() => true)` would read
    // like a lock check that happens to pass. They do have visibility.
    anchors: shows.anchors ? sel.selectedAnchorIds : [],
    lineCircles: shows.lineCircles
      ? sel.selectedLineCircleIds.filter((id) => !doc.lineCircles[id]?.locked)
      : [],
    guides: shows.guides ? sel.selectedGuideIds.filter((id) => !doc.guides[id]?.locked) : [],
  };
}

/**
 * {@link getCopyableSelection} minus every kind the View menu is hiding — the
 * DUPLICATE gesture's read. Duplicate is a write with a sting the other writes
 * don't have: the clone selects itself, and Delete refuses hidden items, so an
 * invisible copy couldn't even be removed until the layer came back. Ctrl+C
 * stays on the unfiltered helper — copying is a read, and pasting is an act on
 * the paste-time doc. No lock filter, matching duplicate's existing behaviour:
 * a locked item may be duplicated (the copy is born unlocked).
 */
export function visibleCopyableSelection(): ReturnType<typeof getCopyableSelection> {
  const raw = getCopyableSelection(useSelection.getState());
  const shows = visibleSelectionKinds();
  return {
    bullets: shows.bullets ? raw.bullets : [],
    labels: shows.labels ? raw.labels : [],
    polygons: shows.polygons ? raw.polygons : [],
    svgImages: shows.svgImages ? raw.svgImages : [],
  };
}

/**
 * The stations a set of MOVING line circles carries. `moveLineCircle` takes its
 * bound stations with it, so a gesture that translates a ring must not also
 * write those stations: `T.moveStation` RESEATS a ring-bound station onto its
 * circle rather than translating it, so the second write would slide it round a
 * rim that has already moved, and the group would visibly come apart. Neither
 * selection nor lock has a say — a ring carries every passenger either way.
 * The keyboard twin of groupDrag's `carriedStations`.
 */
export function stationsCarriedByCircles(circleIds: readonly string[]): ReadonlySet<string> {
  const out = new Set<string>();
  if (circleIds.length === 0) return out;
  const moving = new Set(circleIds);
  const { stations } = useDoc.getState();
  for (const id of Object.keys(stations)) {
    const cid = stations[id].circleId;
    if (cid !== undefined && moving.has(cid)) out.add(id);
  }
  return out;
}

/**
 * How many items the selection holds, across every kind.
 *
 * Summed over the struct's own lists rather than a written-out addition per
 * kind: every field of {@link SelectionItemIds} IS one of these lists, so a
 * kind added to the interface counts the moment `unlockedSelectedItemIds`
 * (which the type forces to be complete) fills it in. `anchors` is the case
 * that proves the rule — both bulk gestures gate on this count being non-zero,
 * so an anchor-only selection dropped from the sum would silently ignore
 * Delete and the arrow keys.
 */
export function itemIdCount(ids: SelectionItemIds): number {
  let n = 0;
  for (const list of Object.values(ids)) n += list.length;
  return n;
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
  for (const id of ids.guides) doc.deleteGuide(id);
  group?.commit();
  return true;
}
