import type { ReactNode } from 'react';
import type { DraggablePopover } from './canvas/useDraggablePopover';

interface Props {
  className: string;
  // The panel's title, shown in the drag-handle header. Usually a plain
  // string ("Label", "Polygon"…); the station popover passes richer content
  // (editable name + WP pill).
  title: ReactNode;
  // Screen position for the shell's top-left: usually useDraggablePopover's
  // anchor, but a caller may pin it elsewhere (StationPopover in layout edit).
  left: number;
  top: number;
  // display:none instead of unmounting — keeps the frozen anchor (and any
  // header drag) alive across a temporary hide, so the panel returns to the
  // same canvas point instead of re-spawning wherever the camera is then.
  hidden?: boolean;
  // The measuring commit (useDraggablePopover reading the shell's footprint
  // before choosing the spawn spot): laid out but invisible — visibility
  // keeps offsetWidth/Height real where display:none would zero them.
  measuring?: boolean;
  // useDraggablePopover's ref; how the measuring commit reaches the DOM node.
  shellRef?: DraggablePopover['shellRef'];
  headerHandlers: DraggablePopover['headerHandlers'];
  // Optional double-click on the header band (the station popover's rename).
  // It must live on the header DIV, not on content inside it: the drag's
  // pointer capture retargets the synthesized click/dblclick events to the
  // capture element, so a handler on a child span never fires in a real
  // browser (jsdom bubbles it, which hides the difference in tests).
  onHeaderDoubleClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
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
export function DraggablePopoverShell({
  className,
  title,
  left,
  top,
  hidden,
  measuring,
  shellRef,
  headerHandlers,
  onHeaderDoubleClick,
  children,
}: Props) {
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
        visibility: measuring ? 'hidden' : undefined,
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="header" {...headerHandlers} onDoubleClick={onHeaderDoubleClick}>
        {title}
      </div>
      <div className="body">{children}</div>
    </div>
  );
}
