import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { useDoc, useSelection } from '../state/store';
import { historyDepth, redoDepth } from '../state/history';
import { DEFAULT_DOC } from '../model/transforms';

beforeEach(() => {
  localStorage.clear();
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
  useSelection.setState({
    ...useSelection.getState(),
    spaceHeld: false,
    uiMode: { kind: 'idle' },
  });
});

describe('App keyboard shortcuts: inForm guard routing', () => {
  it('Ctrl+Z fires on a focused range slider (slider drag is undoable without click-away)', async () => {
    const user = userEvent.setup();
    render(<App />);
    // Create an undoable entry so Ctrl+Z has something to pop.
    useDoc.getState().addStation(50, 50);
    const pastBefore = historyDepth();
    const stationsBefore = Object.keys(useDoc.getState().stations).length;

    await user.click(screen.getByRole('button', { name: 'Options' }));
    const slider = screen.getByRole('slider', { name: /font size/i });
    slider.focus();

    fireEvent.keyDown(slider, { key: 'z', ctrlKey: true });

    expect(historyDepth()).toBe(pastBefore - 1);
    expect(Object.keys(useDoc.getState().stations).length).toBe(stationsBefore - 1);
  });

  it('Ctrl+Z is suppressed on a focused text input (preserves native text undo)', () => {
    render(<App />);
    useDoc.getState().addStation(50, 50);
    const pastBefore = historyDepth();

    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);
    input.focus();
    try {
      fireEvent.keyDown(input, { key: 'z', ctrlKey: true });
      expect(historyDepth()).toBe(pastBefore);
    } finally {
      document.body.removeChild(input);
    }
  });

  it('Ctrl+Z fires on a focused color picker (no native text undo to preserve)', () => {
    render(<App />);
    useDoc.getState().addStation(50, 50);
    const pastBefore = historyDepth();

    const input = document.createElement('input');
    input.type = 'color';
    document.body.appendChild(input);
    input.focus();
    try {
      fireEvent.keyDown(input, { key: 'z', ctrlKey: true });
      expect(historyDepth()).toBe(pastBefore - 1);
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

describe('App keyboard shortcuts: layering mode', () => {
  it("L toggles uiMode to 'layering', then back to 'idle'", () => {
    render(<App />);
    expect(useSelection.getState().uiMode.kind).toBe('idle');
    fireEvent.keyDown(window, { key: 'l' });
    expect(useSelection.getState().uiMode.kind).toBe('layering');
    fireEvent.keyDown(window, { key: 'l' });
    expect(useSelection.getState().uiMode.kind).toBe('idle');
  });

  it('L is case-insensitive (Shift+L behaves the same)', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'L' });
    expect(useSelection.getState().uiMode.kind).toBe('layering');
  });

  it('Esc exits layering mode', () => {
    render(<App />);
    useSelection.setState({ uiMode: { kind: 'layering' } });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useSelection.getState().uiMode.kind).toBe('idle');
  });

  it('L on a focused text input is suppressed (typing "l" in the input keeps mode untouched)', () => {
    render(<App />);
    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);
    input.focus();
    try {
      fireEvent.keyDown(input, { key: 'l' });
      expect(useSelection.getState().uiMode.kind).toBe('idle');
    } finally {
      document.body.removeChild(input);
    }
  });

  it('Ctrl+L is NOT bound (e.g. browser focus-address-bar gestures pass through)', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'l', ctrlKey: true });
    expect(useSelection.getState().uiMode.kind).toBe('idle');
  });
});

describe('App keyboard shortcuts: add-transfer mode', () => {
  it("T toggles uiMode to 'creating-transfer', then back to 'idle'", () => {
    render(<App />);
    expect(useSelection.getState().uiMode.kind).toBe('idle');
    fireEvent.keyDown(window, { key: 't' });
    expect(useSelection.getState().uiMode.kind).toBe('creating-transfer');
    fireEvent.keyDown(window, { key: 't' });
    expect(useSelection.getState().uiMode.kind).toBe('idle');
  });

  it('T is case-insensitive (Shift+T behaves the same)', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'T' });
    expect(useSelection.getState().uiMode.kind).toBe('creating-transfer');
  });

  it('Esc exits add-transfer mode', () => {
    render(<App />);
    useSelection.setState({ uiMode: { kind: 'creating-transfer', anchor: null } });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useSelection.getState().uiMode.kind).toBe('idle');
  });

  it('T on a focused text input is suppressed (typing "t" keeps mode untouched)', () => {
    render(<App />);
    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);
    input.focus();
    try {
      fireEvent.keyDown(input, { key: 't' });
      expect(useSelection.getState().uiMode.kind).toBe('idle');
    } finally {
      document.body.removeChild(input);
    }
  });

  it('Ctrl+T is NOT bound (browser new-tab gesture passes through)', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 't', ctrlKey: true });
    expect(useSelection.getState().uiMode.kind).toBe('idle');
  });
});

describe('App keyboard shortcuts: blur-then-undo', () => {
  it('Ctrl+Z mid-slider-drag commits the open useFieldHistory group, then undoes the drag', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Options' }));
    const slider = screen.getByRole('slider', { name: /font size/i }) as HTMLInputElement;
    const initialFontSize = useDoc.getState().labelFontSize;
    const pastBaseline = historyDepth();

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
    expect(historyDepth()).toBe(pastBaseline);
    expect(redoDepth()).toBe(1);
  });
});
