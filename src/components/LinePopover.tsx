import { useDoc, useSelection } from '../state/store';
import type { Line } from '../model/types';
import { DraggablePopoverShell, pinnedTopRight } from './DraggablePopoverShell';
import { PopoverFooter } from './PopoverFooter';
import { LineInspector } from './inspector';

/**
 * The line editor as an on-canvas popover — Edit Stops' companion panel,
 * mounted for the whole appending-to-line mode (there is no selected-but-not-
 * editing state for lines; see startAppend). Hard-pinned to the host's
 * top-right corner rather than spawned beside the item: a line has no single
 * on-canvas anchor, and the corner is where the station layout editor already
 * pins. The sidebar cedes the corner while the mode is active
 * (sidebarVisible), so the pin never lands under the panel.
 *
 * Exits are owned elsewhere — App's Escape ladder and the canvas click-out
 * both leave through setAppending(null), which deselects the line and
 * unmounts this popover.
 */
export function LinePopover({
  line,
  hostSize,
}: {
  line: Line;
  hostSize: { w: number; h: number };
}) {
  const deleteLine = useDoc((s) => s.deleteLine);
  const setAppending = useSelection((s) => s.setAppending);
  const pin = pinnedTopRight(hostSize.w);

  return (
    <DraggablePopoverShell
      className="text-label-popover line-popover"
      title="Line"
      left={pin.left}
      top={pin.top}
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
    </DraggablePopoverShell>
  );
}
