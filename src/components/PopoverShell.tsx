import type { ReactNode } from 'react';
import type { PinnedPopover } from './canvas/usePinnedPopover';

interface Props {
  className: string;
  // The panel's title, shown in the header band ("Label", "Polygon"…).
  title: string;
  // WINDOW position for the shell's top-left — the top-right dock computed by
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
 * label, polygon, svg image, transfer, multi-selection, line): fixed
 * positioning above the canvas at the top-right dock, the header title strip,
 * and the `.body` content box.
 *
 * FIXED, not absolute, and `usePinnedPopover`'s anchor is in window coordinates
 * to match: when the window is narrower than the app the page scrolls
 * sideways, and an absolute panel would scroll off with the host and have to be
 * dragged back by a scroll listener every frame — which visibly trails, since
 * the compositor doesn't wait for the main thread. Fixed hands that job to the
 * browser. Being fixed costs nothing here: `.canvas-host`'s `isolation:
 * isolate` still traps the shell's z-index in the canvas layer (so the sidebar
 * paints over it, as it must), because a stacking context is about DOM
 * ancestry, not about which box the offsets are measured from.
 *
 * Also owns the load-bearing event swallowing —
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
        position: 'fixed',
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
