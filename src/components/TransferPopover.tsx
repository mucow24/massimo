import { MoonIcon, SunIcon } from '@radix-ui/react-icons';
import { useDoc } from '../state/store';
import { type ViewportProjection } from './canvas/screenAnchor';
import { DraggablePopoverShell } from './DraggablePopoverShell';
import { useDraggablePopover } from './canvas/useDraggablePopover';
import { NumericFieldRow } from './NumericFieldRow';
import { PopoverFooter } from './PopoverFooter';
import { ColorField } from './ColorField';
import { StyleRow } from './StyleRow';
import type { AABB } from '../geometry/rectPolygon';
import {
  resolveTransferStyle,
  TRANSFER_STROKE_WIDTH_DEFAULT,
  TRANSFER_STROKE_WIDTH_MAX,
  TRANSFER_STROKE_WIDTH_MIN,
  TRANSFER_THICKNESS_DEFAULT,
  TRANSFER_THICKNESS_MAX,
  TRANSFER_THICKNESS_MIN,
} from '../model/transferStyle';
import type { Transfer } from '../model/types';

interface Props {
  transfer: Transfer;
  // The transfer capsule's world AABB at the moment of selection — the spawn
  // opens the popover beside it (see transferAABB / ItemPopovers).
  worldRect: AABB;
  view: ViewportProjection;
  // Spawn-placement box (host minus the open sidebar strip); see ItemPopovers.
  spawnBox?: { w: number; h: number };
  onClose: () => void;
}

/**
 * Editing popover for a selected transfer: per-transfer overrides of the
 * constant transfer defaults (thickness, color, stroke width, stroke color),
 * plus delete. Every control shows the EFFECTIVE value (override when
 * present, else the constant default); choosing the default's own value
 * clears that override — the same default-vs-override contract as per-stop
 * dot styles (see `updateTransferStyle`). The spawn placement is frozen at
 * first display and projected through the live viewport
 * (useDraggablePopover), so it tracks pan/zoom without sliding when
 * endpoints move. Mirrors {@link PolygonPopover}.
 */
export function TransferPopover({ transfer, worldRect, view, spawnBox, onClose }: Props) {
  const updateTransferStyle = useDoc((s) => s.updateTransferStyle);
  const deleteTransfer = useDoc((s) => s.deleteTransfer);
  const style = resolveTransferStyle(transfer);

  const { anchor, measuring, shellRef, headerHandlers } = useDraggablePopover(
    transfer.id,
    worldRect,
    view,
    false,
    spawnBox,
  );

  // Wheel ticks must step from the authoritative EFFECTIVE value, resolved
  // live from the store (not the render-stale prop).
  const currentThickness = () =>
    useDoc.getState().transfers[transfer.id]?.thickness ?? TRANSFER_THICKNESS_DEFAULT;
  const currentStrokeWidth = () =>
    useDoc.getState().transfers[transfer.id]?.strokeWidth ?? TRANSFER_STROKE_WIDTH_DEFAULT;

  const onDelete = () => {
    deleteTransfer(transfer.id);
    onClose();
  };

  return (
    <DraggablePopoverShell
      className="bullet-popover transfer-popover"
      title="Transfer"
      left={anchor.x}
      top={anchor.y}
      measuring={measuring}
      shellRef={shellRef}
      headerHandlers={headerHandlers}
    >
      <StyleRow key={transfer.id} kind="transfer" itemId={transfer.id} styleId={transfer.styleId} />
      <hr className="popover-divider" aria-hidden="true" />
      <NumericFieldRow
        id="transfer-thickness"
        label="Thickness"
        min={TRANSFER_THICKNESS_MIN}
        max={TRANSFER_THICKNESS_MAX}
        step={1}
        value={style.thickness}
        onChange={(thickness) => updateTransferStyle(transfer.id, { thickness })}
        getCurrent={currentThickness}
        textboxAllowAboveMax
      />
      <div className="row">
        <label htmlFor="transfer-color">Color</label>
        <SunIcon aria-hidden="true" />
        <ColorField
          id="transfer-color"
          ariaLabel="Transfer color"
          title="Light mode color"
          value={style.color.day}
          onChange={(day) =>
            updateTransferStyle(transfer.id, { color: { day, night: style.color.night } })
          }
        />
        <MoonIcon aria-hidden="true" />
        <ColorField
          id="transfer-dark-color"
          ariaLabel="Transfer dark color"
          title="Dark mode color"
          value={style.color.night}
          onChange={(night) =>
            updateTransferStyle(transfer.id, { color: { day: style.color.day, night } })
          }
        />
      </div>
      <hr className="popover-divider" aria-hidden="true" />
      <NumericFieldRow
        id="transfer-stroke-width"
        label="Stroke width"
        min={TRANSFER_STROKE_WIDTH_MIN}
        max={TRANSFER_STROKE_WIDTH_MAX}
        step={1}
        value={style.strokeWidth}
        onChange={(strokeWidth) => updateTransferStyle(transfer.id, { strokeWidth })}
        getCurrent={currentStrokeWidth}
        textboxAllowAboveMax
      />
      <div className="row">
        <label htmlFor="transfer-stroke-color">Stroke color</label>
        <SunIcon aria-hidden="true" />
        <ColorField
          id="transfer-stroke-color"
          ariaLabel="Transfer stroke color"
          title="Light mode stroke"
          value={style.strokeColor.day}
          onChange={(day) =>
            updateTransferStyle(transfer.id, {
              strokeColor: { day, night: style.strokeColor.night },
            })
          }
        />
        <MoonIcon aria-hidden="true" />
        <ColorField
          id="transfer-dark-stroke-color"
          ariaLabel="Transfer dark stroke color"
          title="Dark mode stroke"
          value={style.strokeColor.night}
          onChange={(night) =>
            updateTransferStyle(transfer.id, {
              strokeColor: { day: style.strokeColor.day, night },
            })
          }
        />
      </div>
      <PopoverFooter noun="transfer" onDelete={onDelete} />
    </DraggablePopoverShell>
  );
}
