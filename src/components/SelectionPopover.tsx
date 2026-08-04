import { LockClosedIcon, LockOpen1Icon } from '@radix-ui/react-icons';
import { useDoc } from '../state/store';
import { useRenderDoc } from '../state/renderDoc';
import { PopoverShell } from './PopoverShell';
import { usePinnedPopover } from './canvas/usePinnedPopover';
import { deleteUnlockedSelection, itemIdCount, type SelectionItemIds } from '../state/selectionOps';

interface Props {
  // Every selected item, one id list per kind. Always ≥2 in total — the
  // per-item popovers own the single-item case (ItemPopovers gates).
  ids: SelectionItemIds;
  // Width of the box the panel docks into — the host minus the open sidebar
  // strip; see ItemPopovers.
  hostW: number;
}

/**
 * The one popover for a multi-selection: a count summary plus bulk
 * lock/unlock/delete over the whole group. Lock all / Unlock all are two
 * explicit buttons (not a toggle) so a mixed selection resolves in ONE click
 * either way — no intermediate everything-locked state polluting undo.
 * Delete all shares the Delete key's semantics (state/selectionOps.ts): the
 * unlocked subset goes, locked members survive, one history entry.
 */
export function SelectionPopover({ ids, hostW }: Props) {
  const { anchor, shellRef } = usePinnedPopover(hostW);
  const setItemsLocked = useDoc((s) => s.setItemsLocked);
  // Render source, not the live doc: a group drag rewrites these per
  // pointermove, and this panel's output (counts + locked flags) is
  // position-independent — a live subscription would re-render it at input
  // cadence for nothing. The render source freezes with the canvas mid-drag;
  // at rest the two stores are identical.
  const stations = useRenderDoc((s) => s.stations);
  const routeBullets = useRenderDoc((s) => s.routeBullets);
  const textLabels = useRenderDoc((s) => s.textLabels);
  const polygons = useRenderDoc((s) => s.polygons);
  const svgImages = useRenderDoc((s) => s.svgImages);
  const lineCircles = useRenderDoc((s) => s.lineCircles);

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
    ids.svgImages.filter((id) => svgImages[id]?.locked).length +
    ids.lineCircles.filter((id) => lineCircles[id]?.locked).length;

  return (
    <PopoverShell
      className="bullet-popover selection-popover"
      title="Selection"
      left={anchor.x}
      top={anchor.y}
      shellRef={shellRef}
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
    </PopoverShell>
  );
}
