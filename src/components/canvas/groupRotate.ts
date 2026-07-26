import { useDoc, useSelection } from '../../state/store';
import { buildRotateMembers, type ItemRef } from '../../model/transforms';
import type { MapDoc } from '../../model/types';

/** True when the referenced item exists and is locked. */
function isItemLocked(doc: MapDoc, ref: ItemRef): boolean {
  switch (ref.type) {
    case 'station':
      return !!doc.stations[ref.id]?.locked;
    case 'bullet':
      return !!doc.routeBullets[ref.id]?.locked;
    case 'label':
      return !!doc.textLabels[ref.id]?.locked;
    case 'polygon':
      return !!doc.polygons[ref.id]?.locked;
    case 'svgImage':
      return !!doc.svgImages[ref.id]?.locked;
    case 'anchor':
      // Anchors have no `locked` field at all — the first canvas kind without
      // one. They always rotate and always tow.
      return false;
  }
}

/**
 * Shared right-click "rotate" gesture for any selectable canvas item.
 *
 * When the clicked item is part of a multi-selection (more than one item across
 * stations, route bullets, labels, polygons, AND svg images), rotate the whole
 * group rigidly around it via `rotateItemsAround` — every type participates, so
 * a co-selected item is never silently left behind (the bug the per-type copies
 * had: the bullet/label/station handlers omitted polygon ids). Otherwise rotate
 * just this one item via `rotateSingle`.
 */
export function rotateItemOnContextMenu(pivot: ItemRef, rotateSingle: () => void): void {
  const doc = useDoc.getState();
  // A locked item can't be rotated. Right-clicking one does nothing at all —
  // neither the group path nor the single rotate — mirroring how a locked item
  // can't initiate a drag (usePolygonDrag et al. bail on pointer-down).
  if (isItemLocked(doc, pivot)) return;
  const sel = useSelection.getState();
  const st = sel.selectedStationIds;
  const bl = sel.selectedRouteBulletIds;
  const lb = sel.selectedLabelIds;
  const pg = sel.selectedPolygonIds;
  const sg = sel.selectedSvgImageIds;
  const an = sel.selectedAnchorIds;
  const total = st.length + bl.length + lb.length + pg.length + sg.length + an.length;
  // Exhaustive switch, not a ternary chain with a catch-all tail: the tail was a
  // bare `: sg.includes(pivot.id)`, so a new ItemRef type would have been tested
  // against the svg-image selection and read as "not in the selection".
  const selectedIdsFor = (type: ItemRef['type']): readonly string[] => {
    switch (type) {
      case 'station':
        return st;
      case 'bullet':
        return bl;
      case 'label':
        return lb;
      case 'polygon':
        return pg;
      case 'svgImage':
        return sg;
      case 'anchor':
        return an;
      default: {
        const unhandled: never = type;
        return unhandled;
      }
    }
  };
  const pivotInSelection = selectedIdsFor(pivot.type).includes(pivot.id);
  if (total > 1 && pivotInSelection) {
    // Skip locked co-selected members so they aren't rotated (mirrors
    // collectGroupSiblings towing only unlocked items during a group drag).
    // The pivot is guaranteed unlocked by the guard above, so it survives.
    const members = buildRotateMembers(st, bl, lb, pg, sg, an).filter((m) => !isItemLocked(doc, m));
    useDoc.getState().rotateItemsAround(pivot, members);
    return;
  }
  rotateSingle();
}
