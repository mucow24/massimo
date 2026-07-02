import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { LabelOffsetControl } from './LabelOffsetControl';

// E10: the slider's 0-snap detent (LabelOffsetControl.tsx:32) — entering a
// value within ±2 of zero commits 0, anything beyond commits the value as-is.
// The detent lives on the range input only; the number input has a separate
// Number.isFinite guard that rejects non-numeric input.

function renderControl(onChange = vi.fn()) {
  const { container } = render(<LabelOffsetControl value={0} onChange={onChange} />);
  const range = container.querySelector('input[type="range"]') as HTMLInputElement;
  const number = container.querySelector('input[type="number"]') as HTMLInputElement;
  if (!range || !number) throw new Error('expected a range and a number input');
  return { onChange, range, number };
}

describe('LabelOffsetControl — slider 0-snap detent (E10)', () => {
  it('snaps a slider value of 1 to 0 (|n| <= 2)', () => {
    const { onChange, range } = renderControl();
    fireEvent.change(range, { target: { value: '1' } });
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it('snaps a slider value of 2 to 0 (boundary of the detent)', () => {
    const { onChange, range } = renderControl();
    fireEvent.change(range, { target: { value: '2' } });
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it('snaps a slider value of -2 to 0 (symmetric boundary)', () => {
    const { onChange, range } = renderControl();
    fireEvent.change(range, { target: { value: '-2' } });
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it('passes a slider value of 3 through unchanged (just outside the detent)', () => {
    const { onChange, range } = renderControl();
    fireEvent.change(range, { target: { value: '3' } });
    expect(onChange).toHaveBeenLastCalledWith(3);
  });

  it('passes a slider value of -3 through unchanged', () => {
    const { onChange, range } = renderControl();
    fireEvent.change(range, { target: { value: '-3' } });
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
