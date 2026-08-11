import type { ReactNode } from 'react';
import { ChevronDownIcon } from '@radix-ui/react-icons';
import * as Select from '@radix-ui/react-select';
import { FieldSelectContent } from './FieldSelectContent';
import { TRANSFER_DRAW_LABELS, TRANSFER_DRAW_ORDERS } from '../model/transferStyle';
import type { TransferDrawOrder } from '../model/types';

/**
 * The "Draw" row: which rung of the stop-dot stack a transfer paints on (see
 * TransferDrawOrder). Shared verbatim by the transfer popover and the Styles
 * panel's transfer editor — one covered field, one control, so the two can
 * never label or order the rungs differently.
 *
 * Listed bottom-up, so the dropdown reads as a stack you climb.
 */
export function TransferDrawRow({
  id,
  value,
  onChange,
  dot,
}: {
  id: string;
  value: TransferDrawOrder;
  onChange: (draw: TransferDrawOrder) => void;
  /** Optional override marker (an `OverrideDot`) rendered first in the row. */
  dot?: ReactNode;
}) {
  return (
    <div className="row">
      {dot}
      <label htmlFor={id}>Draw</label>
      <Select.Root value={value} onValueChange={(v) => onChange(v as TransferDrawOrder)}>
        <Select.Trigger id={id} className="field-select" aria-label="Draw">
          <Select.Value />
          <Select.Icon className="field-select-caret" aria-hidden="true">
            <ChevronDownIcon />
          </Select.Icon>
        </Select.Trigger>
        <FieldSelectContent>
          {TRANSFER_DRAW_ORDERS.map((rung) => (
            <Select.Item key={rung} value={rung} className="field-select-item">
              <Select.ItemText>{TRANSFER_DRAW_LABELS[rung]}</Select.ItemText>
            </Select.Item>
          ))}
        </FieldSelectContent>
      </Select.Root>
    </div>
  );
}
