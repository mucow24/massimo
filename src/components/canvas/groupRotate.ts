import { useDoc, useSelection } from '../../state/store';
import { buildRotateMembers, type ItemRef } from '../../model/transforms';

/**
 * Shared right-click "rotate" gesture for any selectable canvas item.
 *
 * When the clicked item is part of a multi-selection (more than one item across
 * stations, route bullets, labels, AND polygons), rotate the whole group
 * rigidly around it via `rotateItemsAround` — every type participates, so a
 * co-selected polygon is never silently left behind (the bug the per-type
 * copies had: the bullet/label/station handlers omitted polygon ids). Otherwise
 * rotate just this one item via `rotateSingle`.
 */
export function rotateItemOnContextMenu(pivot: ItemRef, rotateSingle: () => void): void {
  const sel = useSelection.getState();
  const st = sel.selectedStationIds;
  const bl = sel.selectedRouteBulletIds;
  const lb = sel.selectedLabelIds;
  const pg = sel.selectedPolygonIds;
  const total = st.length + bl.length + lb.length + pg.length;
  const pivotInSelection =
    pivot.type === 'station'
      ? st.includes(pivot.id)
      : pivot.type === 'bullet'
        ? bl.includes(pivot.id)
        : pivot.type === 'label'
          ? lb.includes(pivot.id)
          : pg.includes(pivot.id);
  if (total > 1 && pivotInSelection) {
    useDoc.getState().rotateItemsAround(pivot, buildRotateMembers(st, bl, lb, pg));
    return;
  }
  rotateSingle();
}
