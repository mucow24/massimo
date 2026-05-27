import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { useDoc, useSelection } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';

beforeEach(() => {
  localStorage.clear();
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
  useSelection.setState({ ...useSelection.getState(), spaceHeld: false });
});

describe('App keyboard shortcuts: inForm guard routing', () => {
  it('Ctrl+Z fires on a focused range slider (slider drag is undoable without click-away)', async () => {
    const user = userEvent.setup();
    render(<App />);
    // Create an undoable entry so Ctrl+Z has something to pop.
    useDoc.getState().addStation(50, 50);
    const pastBefore = useDoc.temporal.getState().pastStates.length;
    const stationsBefore = Object.keys(useDoc.getState().stations).length;

    await user.click(screen.getByRole('button', { name: 'Options' }));
    const slider = screen.getByRole('slider', { name: /font size/i });
    slider.focus();

    fireEvent.keyDown(slider, { key: 'z', ctrlKey: true });

    expect(useDoc.temporal.getState().pastStates.length).toBe(pastBefore - 1);
    expect(Object.keys(useDoc.getState().stations).length).toBe(stationsBefore - 1);
  });

  it('Ctrl+Z is suppressed on a focused text input (preserves native text undo)', () => {
    render(<App />);
    useDoc.getState().addStation(50, 50);
    const pastBefore = useDoc.temporal.getState().pastStates.length;

    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);
    input.focus();
    try {
      fireEvent.keyDown(input, { key: 'z', ctrlKey: true });
      expect(useDoc.temporal.getState().pastStates.length).toBe(pastBefore);
    } finally {
      document.body.removeChild(input);
    }
  });

  it('Ctrl+Z fires on a focused color picker (no native text undo to preserve)', () => {
    render(<App />);
    useDoc.getState().addStation(50, 50);
    const pastBefore = useDoc.temporal.getState().pastStates.length;

    const input = document.createElement('input');
    input.type = 'color';
    document.body.appendChild(input);
    input.focus();
    try {
      fireEvent.keyDown(input, { key: 'z', ctrlKey: true });
      expect(useDoc.temporal.getState().pastStates.length).toBe(pastBefore - 1);
    } finally {
      document.body.removeChild(input);
    }
  });

  // Regression for an a11y concern caught in self-review: an earlier draft of
  // the inForm narrowing included checkbox/radio/button-likes in the denylist,
  // which let the global Space handler preempt native checkbox toggling.
  it('Space on a focused palette checkbox does not trigger pan mode', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Options' }));
    await user.click(screen.getByRole('button', { name: /color palettes/i }));
    const bart = screen.getByRole('checkbox', { name: 'BART' });
    bart.focus();

    fireEvent.keyDown(bart, { key: ' ' });

    expect(useSelection.getState().spaceHeld).toBe(false);
  });
});

describe('App keyboard shortcuts: blur-then-undo', () => {
  it('Ctrl+Z mid-slider-drag commits the open useFieldHistory group, then undoes the drag', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Options' }));
    const slider = screen.getByRole('slider', { name: /font size/i }) as HTMLInputElement;
    const initialFontSize = useDoc.getState().labelFontSize;
    const pastBaseline = useDoc.temporal.getState().pastStates.length;

    // Simulate focus → mid-drag → Ctrl+Z without intervening blur. The focus
    // opens a useFieldHistory group (pauses zundo); the change mutates state
    // but no entry lands on pastStates yet; the Ctrl+Z handler must blur the
    // active element so commit() runs, *then* undo against the just-pushed
    // entry. Without blur-then-undo, undo would skip the in-progress edit.
    //
    // Note: use the real DOM .focus() (not fireEvent.focus) so jsdom updates
    // document.activeElement — the Ctrl+Z handler's blur target depends on it.
    slider.focus();
    fireEvent.change(slider, { target: { value: String(initialFontSize + 4) } });
    expect(useDoc.getState().labelFontSize).toBe(initialFontSize + 4);

    fireEvent.keyDown(slider, { key: 'z', ctrlKey: true });

    expect(useDoc.getState().labelFontSize).toBe(initialFontSize);
    expect(useDoc.temporal.getState().pastStates.length).toBe(pastBaseline);
    expect(useDoc.temporal.getState().futureStates.length).toBe(1);
  });
});
