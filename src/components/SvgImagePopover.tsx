import { useDoc } from '../state/store';
import { type ViewportProjection } from './canvas/screenAnchor';
import type { AABB } from '../geometry/rectPolygon';
import { DraggablePopoverShell } from './DraggablePopoverShell';
import { useDraggablePopover } from './canvas/useDraggablePopover';
import { LayerOrderRow } from './LayerOrderRow';
import { NumericFieldRow } from './NumericFieldRow';
import { PopoverFooter } from './PopoverFooter';
import {
  SVG_IMAGE_OPACITY_DEFAULT,
  SVG_IMAGE_OPACITY_MAX,
  SVG_IMAGE_OPACITY_MIN,
} from '../model/transforms';
import type { SvgImage } from '../model/types';

// The doc stores an SVG-native 0..1 alpha; the slider trades in whole percent,
// which is what people actually mean by "50% opacity". Round on the way out —
// an alpha × 100 lands on values like 37.000000000000004.
const PERCENT = 100;
const toPercent = (alpha: number | undefined): number =>
  Math.round((alpha ?? SVG_IMAGE_OPACITY_DEFAULT) * PERCENT);

interface Props {
  image: SvgImage;
  // The image's world AABB (rotated rect bounds) at the moment of selection —
  // the spawn opens the popover beside it.
  worldRect: AABB;
  view: ViewportProjection;
  // Spawn-placement box (host minus the open sidebar strip); see ItemPopovers.
  spawnBox?: { w: number; h: number };
  onClose: () => void;
}

/**
 * Popover for a selected svg image: opacity, layer up/down, lock, delete. The
 * artwork's own colors are baked into the import and can't be edited, and size
 * and rotation are edited via the on-canvas handles — so opacity is the one
 * style knob here. The spawn placement is frozen at first display and projected
 * through the live viewport, and the header drag stays pinned to the canvas
 * through zoom. Mirrors {@link PolygonPopover} minus the paint rows.
 */
export function SvgImagePopover({ image, worldRect, view, spawnBox, onClose }: Props) {
  const { anchor, measuring, shellRef, headerHandlers } = useDraggablePopover(
    image.id,
    worldRect,
    view,
    false,
    spawnBox,
  );
  const updateSvgImage = useDoc((s) => s.updateSvgImage);
  const deleteSvgImage = useDoc((s) => s.deleteSvgImage);
  const moveSvgImageUp = useDoc((s) => s.moveSvgImageUp);
  const moveSvgImageDown = useDoc((s) => s.moveSvgImageDown);

  const locked = image.locked ?? false;
  const onOpacity = (pct: number) => updateSvgImage(image.id, { opacity: pct / PERCENT });
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
      measuring={measuring}
      shellRef={shellRef}
      headerHandlers={headerHandlers}
    >
      <NumericFieldRow
        id="svg-image-opacity"
        label="Opacity"
        min={SVG_IMAGE_OPACITY_MIN * PERCENT}
        max={SVG_IMAGE_OPACITY_MAX * PERCENT}
        step={1}
        value={toPercent(image.opacity)}
        onChange={onOpacity}
        getCurrent={() => toPercent(useDoc.getState().svgImages[image.id]?.opacity)}
        disabled={locked}
      />
      <hr className="popover-divider" aria-hidden="true" />
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
