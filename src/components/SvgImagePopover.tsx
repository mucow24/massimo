import { ArrowDownIcon, ArrowUpIcon } from '@radix-ui/react-icons';
import { useDoc } from '../state/store';
import { type ViewportProjection } from './canvas/screenAnchor';
import { useDraggablePopover } from './canvas/useDraggablePopover';
import { PopoverFooter } from './PopoverFooter';
import type { SvgImage } from '../model/types';

interface Props {
  image: SvgImage;
  view: ViewportProjection;
  onClose: () => void;
}

/**
 * Popover for a selected svg image: layer up/down, lock, delete. An imported
 * image has no editable style (it's opaque), so there are no color/size
 * controls — size and rotation are edited via the on-canvas handles. The anchor
 * (image center) is frozen at mount and projected through the live viewport, and
 * the header drag stays pinned to the canvas through zoom. Mirrors
 * {@link PolygonPopover} minus the style rows.
 */
export function SvgImagePopover({ image, view, onClose }: Props) {
  const { anchor, headerHandlers } = useDraggablePopover(
    image.id,
    { x: image.x, y: image.y },
    view,
  );
  const updateSvgImage = useDoc((s) => s.updateSvgImage);
  const deleteSvgImage = useDoc((s) => s.deleteSvgImage);
  const moveSvgImageUp = useDoc((s) => s.moveSvgImageUp);
  const moveSvgImageDown = useDoc((s) => s.moveSvgImageDown);

  const locked = image.locked ?? false;
  const onToggleLock = () => updateSvgImage(image.id, { locked: !locked });
  const onDelete = () => {
    deleteSvgImage(image.id);
    onClose();
  };

  return (
    <div
      className="bullet-popover polygon-popover svg-image-popover"
      style={{ position: 'absolute', left: anchor.x, top: anchor.y, zIndex: 1100 }}
      // Keep pointer events off the canvas (which would deselect the image and
      // close the popover, or right-click-rotate underneath it).
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="header" {...headerHandlers} />
      <div className="body">
        <div className="row">
          <label>Layer</label>
          <div className="shape-group">
            <button
              type="button"
              className="shape-btn"
              aria-label="Move image down"
              title="Send backward"
              disabled={locked}
              onClick={() => moveSvgImageDown(image.id)}
            >
              <ArrowDownIcon />
            </button>
            <button
              type="button"
              className="shape-btn"
              aria-label="Move image up"
              title="Bring forward"
              disabled={locked}
              onClick={() => moveSvgImageUp(image.id)}
            >
              <ArrowUpIcon />
            </button>
          </div>
        </div>
        <PopoverFooter
          noun="image"
          locked={locked}
          onToggleLock={onToggleLock}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
}
