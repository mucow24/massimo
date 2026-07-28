import type { ReactNode } from 'react';
import type { PinnedPopover } from './canvas/usePinnedPopover';

interface Props {
  className: string;
  // The panel's title, shown in the header band ("Label", "Polygon"…).
  title: string;
  // Screen position for the shell's top-left — the top-right dock computed by
  // usePinnedPopover.
  left: number;
  top: number;
  // display:none instead of unmounting across a temporary hide (a uiMode
  // excursion), so the panel keeps its DOM node and its measured width.
  hidden?: boolean;
  // usePinnedPopover's ref; how the pin reads the panel's width.
  shellRef?: PinnedPopover['shellRef'];
  children: ReactNode;
}

/**
 * The outer frame shared by every canvas popover (station, route bullet, text
 * label, polygon, svg image, transfer, multi-selection, line): absolute
 * positioning above the canvas at the top-right dock, the header title strip,
 * and the `.body` content box. Also owns the load-bearing event swallowing —
 * pointerdowns, clicks, and context menus inside the popover must never reach
 * the canvas, which would deselect the item (closing the popover) or
 * right-click-rotate whatever sits under it.
 */
export function PopoverShell({ className, title, left, top, hidden, shellRef, children }: Props) {
  return (
    <div
      ref={shellRef}
      className={className}
      style={{
        position: 'absolute',
        left,
        top,
        zIndex: 1100,
        display: hidden ? 'none' : undefined,
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="header">{title}</div>
      <div className="body">{children}</div>
    </div>
  );
}
