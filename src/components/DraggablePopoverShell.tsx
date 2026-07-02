import type { ReactNode } from 'react';
import type { DraggablePopover } from './canvas/useDraggablePopover';

interface Props {
  className: string;
  // Screen position for the shell's top-left: usually useDraggablePopover's
  // anchor, but a caller may pin it elsewhere (StationPopover in layout edit).
  left: number;
  top: number;
  headerHandlers: DraggablePopover['headerHandlers'];
  children: ReactNode;
}

/**
 * The floating outer frame shared by every canvas item popover (station, route
 * bullet, text label, polygon, svg image): absolute positioning above the
 * canvas, the drag-handle header strip, and the `.body` content box. Also owns
 * the load-bearing event swallowing — pointerdowns, clicks, and context menus
 * inside the popover must never reach the canvas, which would deselect the
 * item (closing the popover) or right-click-rotate whatever sits under it.
 */
export function DraggablePopoverShell({ className, left, top, headerHandlers, children }: Props) {
  return (
    <div
      className={className}
      style={{ position: 'absolute', left, top, zIndex: 1100 }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="header" {...headerHandlers} />
      <div className="body">{children}</div>
    </div>
  );
}
