import { useDoc } from '../state/store';
import { PopoverShell } from './PopoverShell';
import { usePinnedPopover } from './canvas/usePinnedPopover';
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
  // Width of the box the panel docks into — the host minus the open sidebar
  // strip; see ItemPopovers.
  hostW: number;
  onClose: () => void;
}

/**
 * Popover for a selected svg image: opacity, layer up/down, lock, delete. The
 * artwork's own colors are baked into the import and can't be edited, and size
 * and rotation are edited via the on-canvas handles — so opacity is the one
 * style knob here. Docked to the host's top-right corner (usePinnedPopover).
 * Mirrors {@link PolygonPopover} minus the paint rows.
 */
export function SvgImagePopover({ image, hostW, onClose }: Props) {
  const { anchor, shellRef } = usePinnedPopover(hostW);
  const updateSvgImage = useDoc((s) => s.updateSvgImage);
  const deleteSvgImage = useDoc((s) => s.deleteSvgImage);
  const moveBackgroundUp = useDoc((s) => s.moveBackgroundUp);
  const moveBackgroundDown = useDoc((s) => s.moveBackgroundDown);
  const moveBackgroundToTop = useDoc((s) => s.moveBackgroundToTop);
  const moveBackgroundToBottom = useDoc((s) => s.moveBackgroundToBottom);

  const locked = image.locked ?? false;
  const onOpacity = (pct: number) => updateSvgImage(image.id, { opacity: pct / PERCENT });
  const onToggleLock = () => updateSvgImage(image.id, { locked: !locked });
  const onDelete = () => {
    deleteSvgImage(image.id);
    onClose();
  };

  return (
    <PopoverShell
      className="bullet-popover polygon-popover svg-image-popover"
      title="Image"
      left={anchor.x}
      top={anchor.y}
      shellRef={shellRef}
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
        onMoveToTop={() => moveBackgroundToTop(image.id)}
        onMoveUp={() => moveBackgroundUp(image.id)}
        onMoveDown={() => moveBackgroundDown(image.id)}
        onMoveToBottom={() => moveBackgroundToBottom(image.id)}
        disabled={locked}
      />
      <PopoverFooter noun="image" locked={locked} onToggleLock={onToggleLock} onDelete={onDelete} />
    </PopoverShell>
  );
}
