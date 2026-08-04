import { describe, it, expect, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import App from '../App';
import { useDoc } from '../state/store';

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), stations: {}, lines: {}, lineOrder: [] });
});

describe('App smoke', () => {
  it('renders without crashing', () => {
    render(<App />);
    expect(screen.getByRole('img', { name: 'Massimo' })).toBeInTheDocument();
  });

  // The Canvas and Add menus are driven in depth by Toolbar.test.tsx (see its
  // "Canvas menu" describe and the Add-menu cases), which opens them rather
  // than just checking they exist — a presence check here could not fail
  // without taking that whole file down with it.

  it('exposes a Manage palettes button in the toolbar', () => {
    // Kept, unlike the toolbar-menu check above: PalettesDialog.test.tsx covers
    // the dialog's behaviour but never names its trigger, so nothing else at
    // the unit level pins the button's presence. e2e/customPalette.spec.ts does
    // click it, which would fail if it vanished — but that is one browser spec
    // away from the fast suite, and its failure would read as a palette bug
    // rather than a missing toolbar button.
    render(<App />);
    expect(screen.getByRole('button', { name: 'Manage palettes' })).toBeInTheDocument();
  });

  it('sets the window title from the map name on mount', () => {
    useDoc.setState({ ...useDoc.getState(), name: 'Regional Rail' });
    render(<App />);
    expect(document.title).toBe('Massimo - Regional Rail');
  });

  it('updates the window title when the map name changes', () => {
    render(<App />);
    act(() => {
      useDoc.getState().setDocName('North Shore Line');
    });
    expect(document.title).toBe('Massimo - North Shore Line');
  });
});
