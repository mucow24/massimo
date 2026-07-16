import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LabelOffsetControl } from './LabelOffsetControl';
import { stepSlider } from '../../test/interaction';

// E10: the slider's 0-snap detent (LabelOffsetControl.tsx) — a slider move
// landing within ±2 of zero commits 0, anything beyond commits the value
// as-is. The detent lives on the slider only; the number input has a separate
// Number.isFinite guard that rejects non-numeric input.
//
// The slider is a Radix thumb now, so tests step it by keyboard from a
// tailored start value (one arrow press = one step of the 1-unit grid)
// instead of firing synthetic change events with absolute values.

function renderControl(value = 0, onChange = vi.fn()) {
  render(<LabelOffsetControl value={value} onChange={onChange} />);
  const slider = screen.getByRole('slider', { name: 'Offset' });
  const number = screen.getByRole('spinbutton', { name: 'Offset value' });
  return { onChange, slider, number };
}

describe('LabelOffsetControl — slider 0-snap detent (E10)', () => {
  it('snaps a slider value of 1 to 0 (|n| <= 2)', () => {
    const { onChange, slider } = renderControl(0);
    stepSlider(slider, 1); // 0 → 1
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it('snaps a slider value of 2 to 0 (boundary of the detent)', () => {
    const { onChange, slider } = renderControl(3);
    stepSlider(slider, -1); // 3 → 2
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it('snaps a slider value of -2 to 0 (symmetric boundary)', () => {
    const { onChange, slider } = renderControl(-3);
    stepSlider(slider, 1); // -3 → -2
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it('passes a slider value of 3 through unchanged (just outside the detent)', () => {
    const { onChange, slider } = renderControl(4);
    stepSlider(slider, -1); // 4 → 3
    expect(onChange).toHaveBeenLastCalledWith(3);
  });

  it('passes a slider value of -3 through unchanged', () => {
    const { onChange, slider } = renderControl(-4);
    stepSlider(slider, 1); // -4 → -3
    expect(onChange).toHaveBeenLastCalledWith(-3);
  });
});

describe('LabelOffsetControl — number input path (E10)', () => {
  // The textbox has NO 0-snap detent (the detent is slider-only): a number
  // entered there commits verbatim, including small magnitudes the slider
  // would have snapped to 0. This is the behavioral contrast that distinguishes
  // the two inputs.
  it('writes a finite number entered in the textbox', () => {
    const { onChange, number } = renderControl();
    fireEvent.change(number, { target: { value: '12' } });
    expect(onChange).toHaveBeenLastCalledWith(12);
  });

  it('does NOT snap a small typed value to 0 (no detent on the textbox)', () => {
    const { onChange, number } = renderControl();
    fireEvent.change(number, { target: { value: '1' } });
    // The slider would snap 1 → 0; the textbox commits 1 verbatim.
    expect(onChange).toHaveBeenLastCalledWith(1);
  });

  it('ignores an emptied textbox instead of committing 0 (Number("") === 0)', () => {
    const { onChange, number } = renderControl();
    fireEvent.change(number, { target: { value: '' } });
    expect(onChange).not.toHaveBeenCalled();
  });
});
