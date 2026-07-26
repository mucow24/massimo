import { LockClosedIcon, LockOpen1Icon } from '@radix-ui/react-icons';
import { useDoc } from '../state/store';
import { type ViewportProjection } from './canvas/screenAnchor';
import type { AABB } from '../geometry/rectPolygon';
import { DraggablePopoverShell } from './DraggablePopoverShell';
import { useDraggablePopover } from './canvas/useDraggablePopover';
import { deleteUnlockedSelection, itemIdCount, type SelectionItemIds } from '../state/selectionOps';

interface Props {
  // Every selected item, one id list per kind. Always ≥2 in total — the
  // per-item popovers own the single-item case (ItemPopovers gates).
  ids: SelectionItemIds;
  // Union AABB of the members at selection time; spawn hint only.
  worldRect: AABB;
  view: ViewportProjection;
  // Spawn-placement box (host minus the open sidebar strip); see ItemPopovers.
  spawnBox?: { w: number; h: number };
}

// The popover's identity is the selection's MEMBERSHIP: adding/removing an
// item re-spawns the panel beside the new union rect, exactly like the
// per-item popovers re-freezing when the selected id switches.
function memberKey(ids: SelectionItemIds): string {
  return [...ids.stations, ...ids.bullets, ...ids.labels, ...ids.polygons, ...ids.svgImages]
    .sort()
    .join('\n');
}

/**
 * The one popover for a multi-selection: a count summary plus bulk
 * lock/unlock/delete over the whole group. Lock all / Unlock all are two
 * explicit buttons (not a toggle) so a mixed selection resolves in ONE click
 * either way — no intermediate everything-locked state polluting undo.
 * Delete all shares the Delete key's semantics (state/selectionOps.ts): the
 * unlocked subset goes, locked members survive, one history entry.
 */
export function SelectionPopover({ ids, worldRect, view, spawnBox }: Props) {
  // Frozen-anchor + header-drag mechanism shared with the item popovers.
  const { anchor, measuring, shellRef, headerHandlers } = useDraggablePopover(
    memberKey(ids),
    worldRect,
    view,
    false,
    spawnBox,
  );
  const setItemsLocked = useDoc((s) => s.setItemsLocked);
  const stations = useDoc((s) => s.stations);
  const routeBullets = useDoc((s) => s.routeBullets);
  const textLabels = useDoc((s) => s.textLabels);
  const polygons = useDoc((s) => s.polygons);
  const svgImages = useDoc((s) => s.svgImages);

  const total = itemIdCount(ids);
  // Transfer anchors have no `locked` field, so they can never be counted as
  // locked — which means `lockedCount === total` would be unreachable with one
  // in the selection, leaving Lock all permanently enabled and silently inert.
  // Lock gates on the LOCKABLE subset; Delete deliberately still gates on the
  // full total, because an anchor IS deletable.
  const lockableTotal = total - ids.anchors.length;
  // Members that momentarily fail to resolve (mid-delete render) count as
  // unlocked; reconcileWithDoc prunes dangling ids right after.
  const lockedCount =
    ids.stations.filter((id) => stations[id]?.locked).length +
    ids.bullets.filter((id) => routeBullets[id]?.locked).length +
    ids.labels.filter((id) => textLabels[id]?.locked).length +
    ids.polygons.filter((id) => polygons[id]?.locked).length +
    ids.svgImages.filter((id) => svgImages[id]?.locked).length;

  return (
    <DraggablePopoverShell
      className="bullet-popover selection-popover"
      title="Selection"
      left={anchor.x}
      top={anchor.y}
      measuring={measuring}
      shellRef={shellRef}
      headerHandlers={headerHandlers}
    >
      <div className="selection-summary">
        {total} items · {lockedCount} locked
      </div>
      <div className="row">
        <button
          type="button"
          className="lock-btn"
          disabled={lockedCount === lockableTotal}
          onClick={() => setItemsLocked(ids, true)}
          title="Lock every selected item"
        >
          <LockClosedIcon aria-hidden="true" />
          Lock all
        </button>
        <button
          type="button"
          className="lock-btn"
          disabled={lockedCount === 0}
          onClick={() => setItemsLocked(ids, false)}
          title="Unlock every selected item"
        >
          <LockOpen1Icon aria-hidden="true" />
          Unlock all
        </button>
      </div>
      <div className="footer">
        <button
          className="delete-btn"
          disabled={lockedCount === total}
          onClick={() => deleteUnlockedSelection()}
          title="Delete every unlocked selected item"
        >
          Delete all
        </button>
      </div>
    </DraggablePopoverShell>
  );
}
