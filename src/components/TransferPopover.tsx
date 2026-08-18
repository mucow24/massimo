import { useDoc } from '../state/store';
import { PopoverShell } from './PopoverShell';
import { usePinnedPopover } from './canvas/usePinnedPopover';
import { NumericFieldRow } from './NumericFieldRow';
import { PopoverFooter } from './PopoverFooter';
import { PaletteColorRow } from './PaletteColorRow';
import { StyleRow } from './StyleRow';
import { OverrideDot } from './OverrideDot';
import { TransferDrawRow } from './TransferDrawRow';
import {
  resolveTransferStyle,
  TRANSFER_STROKE_WIDTH_DEFAULT,
  TRANSFER_STROKE_WIDTH_MAX,
  TRANSFER_STROKE_WIDTH_MIN,
  TRANSFER_STROKE_WIDTH_STEP,
  TRANSFER_THICKNESS_DEFAULT,
  TRANSFER_THICKNESS_MAX,
  TRANSFER_THICKNESS_MIN,
  TRANSFER_THICKNESS_STEP,
} from '../model/transferStyle';
import type { Transfer } from '../model/types';

interface Props {
  transfer: Transfer;
  // Width of the box the panel docks into — the host minus the open sidebar
  // strip; see ItemPopovers.
  hostW: number;
  onClose: () => void;
}

/**
 * Editing popover for a selected transfer: per-transfer overrides of the
 * constant transfer defaults (thickness, color, stroke width, stroke color,
 * draw rung), plus delete. Every control shows the EFFECTIVE value (override when
 * present, else the constant default); choosing the default's own value
 * clears that override — the same default-vs-override contract as per-stop
 * dot styles (see `updateTransferStyle`). Docked to the host's top-right
 * corner (usePinnedPopover). Mirrors {@link PolygonPopover}.
 */
export function TransferPopover({ transfer, hostW, onClose }: Props) {
  const updateTransferStyle = useDoc((s) => s.updateTransferStyle);
  const deleteTransfer = useDoc((s) => s.deleteTransfer);
  const style = resolveTransferStyle(transfer);

  const { anchor, shellRef } = usePinnedPopover(hostW);

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
    <PopoverShell
      className="bullet-popover transfer-popover style-fields"
      title="Transfer"
      left={anchor.x}
      top={anchor.y}
      shellRef={shellRef}
    >
      <StyleRow key={transfer.id} kind="transfer" itemId={transfer.id} styleId={transfer.styleId} />
      <hr className="popover-divider" aria-hidden="true" />
      <NumericFieldRow
        id="transfer-thickness"
        label="Thickness"
        min={TRANSFER_THICKNESS_MIN}
        max={TRANSFER_THICKNESS_MAX}
        step={TRANSFER_THICKNESS_STEP}
        value={style.thickness}
        onChange={(thickness) => updateTransferStyle(transfer.id, { thickness })}
        getCurrent={currentThickness}
        textboxAllowAboveMax
        dot={
          <OverrideDot
            kind="transfer"
            itemId={transfer.id}
            fields={['thickness']}
            name="Thickness"
          />
        }
      />
      <PaletteColorRow
        label="Color"
        id="transfer-color"
        darkId="transfer-dark-color"
        lightAriaLabel="Transfer color"
        darkAriaLabel="Transfer dark color"
        titleNoun="color"
        value={style.color.day}
        darkValue={style.color.night}
        swatchRef={transfer.colorRef}
        onChange={(day) =>
          updateTransferStyle(transfer.id, { color: { day, night: style.color.night } })
        }
        onDarkChange={(night) =>
          updateTransferStyle(transfer.id, { color: { day: style.color.day, night } })
        }
        onPick={(ref, pair) =>
          updateTransferStyle(transfer.id, ref ? { color: pair, colorRef: ref } : { color: pair })
        }
        dot={<OverrideDot kind="transfer" itemId={transfer.id} fields={['color']} name="Color" />}
      />
      <hr className="popover-divider" aria-hidden="true" />
      <NumericFieldRow
        id="transfer-stroke-width"
        label="Stroke width"
        min={TRANSFER_STROKE_WIDTH_MIN}
        max={TRANSFER_STROKE_WIDTH_MAX}
        step={TRANSFER_STROKE_WIDTH_STEP}
        value={style.strokeWidth}
        onChange={(strokeWidth) => updateTransferStyle(transfer.id, { strokeWidth })}
        getCurrent={currentStrokeWidth}
        textboxAllowAboveMax
        dot={
          <OverrideDot
            kind="transfer"
            itemId={transfer.id}
            fields={['strokeWidth']}
            name="Stroke width"
          />
        }
      />
      {/* Greyed at width 0 — a halo nobody paints has no color to pick. Draw
          below is NOT gated: it orders the whole transfer, body included. */}
      <PaletteColorRow
        label="Stroke color"
        id="transfer-stroke-color"
        darkId="transfer-dark-stroke-color"
        lightAriaLabel="Transfer stroke color"
        darkAriaLabel="Transfer dark stroke color"
        titleNoun="stroke"
        value={style.strokeColor.day}
        darkValue={style.strokeColor.night}
        swatchRef={transfer.strokeColorRef}
        disabled={style.strokeWidth === 0}
        onChange={(day) =>
          updateTransferStyle(transfer.id, {
            strokeColor: { day, night: style.strokeColor.night },
          })
        }
        onDarkChange={(night) =>
          updateTransferStyle(transfer.id, {
            strokeColor: { day: style.strokeColor.day, night },
          })
        }
        onPick={(ref, pair) =>
          updateTransferStyle(
            transfer.id,
            ref ? { strokeColor: pair, strokeColorRef: ref } : { strokeColor: pair },
          )
        }
        dot={
          <OverrideDot
            kind="transfer"
            itemId={transfer.id}
            fields={['strokeColor']}
            name="Stroke color"
          />
        }
      />
      {/* Paint order, not paint: its own section at the bottom, below the
          divider that closes the body/stroke appearance controls. */}
      <hr className="popover-divider" aria-hidden="true" />
      <TransferDrawRow
        id="transfer-draw"
        value={style.draw}
        onChange={(draw) => updateTransferStyle(transfer.id, { draw })}
        dot={<OverrideDot kind="transfer" itemId={transfer.id} fields={['draw']} name="Draw" />}
      />
      <PopoverFooter noun="transfer" onDelete={onDelete} />
    </PopoverShell>
  );
}
