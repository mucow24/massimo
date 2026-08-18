import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { NumericFieldRow } from './NumericFieldRow';

/** Controlled harness so arrow-key steps accumulate like against a store. */
function Harness({
  onChange,
  initial = 10,
  step = 1,
  detent,
  disabled,
}: {
  onChange?: (n: number) => void;
  initial?: number;
  step?: number;
  detent?: number;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <NumericFieldRow
      id="test-size"
      label="Size"
      min={0}
      max={40}
      step={step}
      value={value}
      onChange={(n) => {
        setValue(n);
        onChange?.(n);
      }}
      getCurrent={() => value}
      detent={detent}
      disabled={disabled}
    />
  );
}

describe('NumericFieldRow slider', () => {
  it('steps the value with arrow keys on the focused slider', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} initial={10} />);
    const slider = screen.getByRole('slider', { name: 'Size' });
    slider.focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith(11);
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith(9);
  });

  it('steps by the field step, not by 1', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} initial={10} step={0.5} />);
    screen.getByRole('slider', { name: 'Size' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith(10.5);
  });

  it('jumps to the ends with Home and End', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} initial={10} />);
    screen.getByRole('slider', { name: 'Size' }).focus();
    await user.keyboard('{End}');
    expect(onChange).toHaveBeenLastCalledWith(40);
    await user.keyboard('{Home}');
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it('exposes value and range to assistive tech', () => {
    render(<Harness initial={10} />);
    const slider = screen.getByRole('slider', { name: 'Size' });
    expect(slider).toHaveAttribute('aria-valuenow', '10');
    expect(slider).toHaveAttribute('aria-valuemin', '0');
    expect(slider).toHaveAttribute('aria-valuemax', '40');
  });

  it('ignores keyboard input while disabled', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} disabled />);
    // A disabled Radix slider removes the thumb from the tab order and
    // ignores interaction; there must be no way to change the value.
    const slider = screen.queryByRole('slider', { name: 'Size' });
    if (slider) {
      slider.focus();
      const user = userEvent.setup();
      await user.keyboard('{ArrowRight}');
    }
    expect(onChange).not.toHaveBeenCalled();
  });

  // The row carries the state as a class because CSS is the only thing that
  // can grey the LABEL and the spinbutton: neither is reached by the UA's
  // `input:disabled` styling once styles.css paints number inputs with the
  // input tokens. So the class is load-bearing, not decoration.
  it('marks the whole row disabled so the label and spinbutton can grey with it', () => {
    const { unmount } = render(<Harness disabled />);
    const spin = screen.getByRole('spinbutton', { name: 'Size' });
    expect(spin).toBeDisabled();
    expect(spin.closest('.options-popover-row')).toHaveClass('disabled');
    unmount();

    render(<Harness />);
    const live = screen.getByRole('spinbutton', { name: 'Size' });
    expect(live).toBeEnabled();
    expect(live.closest('.options-popover-row')).not.toHaveClass('disabled');
  });
});
