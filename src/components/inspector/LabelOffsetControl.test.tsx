import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { LabelOffsetControl } from './LabelOffsetControl';
import { stepSlider } from '../../test/interaction';

// The two label-offset fields: a half-unit slider spanning [-100, 100] with a
// purely visual tick at 0, plus a spinbutton mirror that accepts any number
// (its own Number.isFinite guard rejects non-numeric input).
//
// The slider is a Radix thumb, so tests step it by keyboard from a tailored
// start value (one arrow press = one step of the half-unit grid) instead of
// firing synthetic change events with absolute values.

function renderControl(value = 0, onChange = vi.fn()) {
  render(<LabelOffsetControl value={value} onChange={onChange} />);
  const slider = screen.getByRole('slider', { name: 'Offset' });
  const number = screen.getByRole('spinbutton', { name: 'Offset value' }) as HTMLInputElement;
  return { onChange, slider, number };
}

/** The control is controlled, so a multi-press run needs a state owner —
 *  otherwise every press re-proposes from the same frozen prop. */
function renderStateful(initial: number) {
  function Harness() {
    const [v, setV] = useState(initial);
    return (
      <>
        <LabelOffsetControl value={v} onChange={setV} />
        <output data-testid="committed">{v}</output>
      </>
    );
  }
  render(<Harness />);
  return {
    slider: screen.getByRole('slider', { name: 'Offset' }),
    committed: () => Number(screen.getByTestId('committed').textContent),
  };
}

describe('LabelOffsetControl — half-unit granularity', () => {
  it('moves the slider by 0.5 per arrow press', () => {
    const { onChange, slider } = renderControl(10);
    stepSlider(slider, 1); // 10 → 10.5
    expect(onChange).toHaveBeenLastCalledWith(10.5);
  });

  it('moves by 0.5 downward too', () => {
    const { onChange, slider } = renderControl(10);
    stepSlider(slider, -1); // 10 → 9.5
    expect(onChange).toHaveBeenLastCalledWith(9.5);
  });

  it('steps the number box by 0.5 (its native stepper arrows)', () => {
    const { number } = renderControl(10);
    number.stepUp();
    expect(number.value).toBe('10.5');
  });

  it('pads the text mirror to the half-step decimal so a whole value reads "10.0"', () => {
    const { number } = renderControl(10);
    expect(number.value).toBe('10.0');
  });

  it('shows a half value as typed', () => {
    const { number } = renderControl(-7.5);
    expect(number.value).toBe('-7.5');
  });
});

describe('LabelOffsetControl — the 0 tick is a landmark, not a snap', () => {
  // The tick used to rewrite anything within ±2 to 0. That made 0 a one-way
  // door: the first arrow press proposed a value inside the band, the rewrite
  // sent it back to 0, and the controlled thumb never moved — so the whole
  // band was unreachable from the keyboard, in both directions.
  it('commits a small slider value verbatim', () => {
    const { onChange, slider } = renderControl(1);
    stepSlider(slider, -1); // 1 → 0.5, formerly rewritten to 0
    expect(onChange).toHaveBeenLastCalledWith(0.5);
  });

  it('walks up off 0 one half-step at a time', () => {
    const { slider, committed } = renderStateful(0);
    stepSlider(slider, 6);
    expect(committed()).toBe(3);
  });

  it('walks down off 0 too', () => {
    const { slider, committed } = renderStateful(0);
    stepSlider(slider, -6);
    expect(committed()).toBe(-3);
  });

  it('still lands exactly on 0 on the way back (0 is on the step grid)', () => {
    const { slider, committed } = renderStateful(2);
    stepSlider(slider, -4);
    expect(committed()).toBe(0);
  });
});

describe('LabelOffsetControl — number input path (E10)', () => {
  it('writes a finite number entered in the textbox', () => {
    const { onChange, number } = renderControl();
    fireEvent.change(number, { target: { value: '12' } });
    expect(onChange).toHaveBeenLastCalledWith(12);
  });

  it('writes a small typed value verbatim', () => {
    const { onChange, number } = renderControl();
    fireEvent.change(number, { target: { value: '1' } });
    expect(onChange).toHaveBeenLastCalledWith(1);
  });

  it('ignores an emptied textbox instead of committing 0 (Number("") === 0)', () => {
    const { onChange, number } = renderControl();
    fireEvent.change(number, { target: { value: '' } });
    expect(onChange).not.toHaveBeenCalled();
  });
});
