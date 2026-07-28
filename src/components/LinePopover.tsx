import { useDoc, useSelection } from '../state/store';
import type { Line } from '../model/types';
import { PopoverShell } from './PopoverShell';
import { usePinnedPopover } from './canvas/usePinnedPopover';
import { PopoverFooter } from './PopoverFooter';
import { LineInspector } from './inspector';

/**
 * The line editor as an on-canvas popover — Edit Stops' companion panel,
 * mounted for the whole appending-to-line mode (there is no selected-but-not-
 * editing state for lines; see startAppend). Docked to the host's top-right
 * corner like every other canvas panel (usePinnedPopover); the sidebar cedes
 * the corner while the mode is active (sidebarVisible), so the whole host
 * width is the panel's to dock into.
 *
 * Exits are owned elsewhere — App's Escape ladder and the canvas click-out
 * both leave through setAppending(null), which deselects the line and
 * unmounts this popover.
 */
export function LinePopover({
  line,
  hostW,
}: {
  line: Line;
  // Width of the box the panel docks into — the host minus the open sidebar
  // strip; see ItemPopovers. (The sidebar cedes the corner for this mode, so
  // in practice it is the whole host.)
  hostW: number;
}) {
  const deleteLine = useDoc((s) => s.deleteLine);
  const setAppending = useSelection((s) => s.setAppending);
  const { anchor, shellRef } = usePinnedPopover(hostW);

  return (
    <PopoverShell
      className="text-label-popover line-popover"
      title="Line"
      left={anchor.x}
      top={anchor.y}
      shellRef={shellRef}
    >
      <LineInspector id={line.id} />
      {/* Delete-only footer: lines carry no `locked` field (same as
          transfers), so the lock toggle is omitted and Delete stands alone.
          Deleting also exits Edit Stops — the mode is bound to this line. */}
      <PopoverFooter
        noun="line"
        onDelete={() => {
          deleteLine(line.id);
          setAppending(null);
        }}
      />
    </PopoverShell>
  );
}
