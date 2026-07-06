import { useDoc } from '../state/store';
import { type ViewportProjection } from './canvas/screenAnchor';
import { DraggablePopoverShell } from './DraggablePopoverShell';
import { useDraggablePopover } from './canvas/useDraggablePopover';
import { LayerOrderRow } from './LayerOrderRow';
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
    <DraggablePopoverShell
      className="bullet-popover polygon-popover svg-image-popover"
      left={anchor.x}
      top={anchor.y}
      headerHandlers={headerHandlers}
    >
      <LayerOrderRow
        noun="image"
        onMoveDown={() => moveSvgImageDown(image.id)}
        onMoveUp={() => moveSvgImageUp(image.id)}
        disabled={locked}
      />
      <PopoverFooter noun="image" locked={locked} onToggleLock={onToggleLock} onDelete={onDelete} />
    </DraggablePopoverShell>
  );
}
