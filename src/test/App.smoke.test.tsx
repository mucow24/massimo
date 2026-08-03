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
    // Kept: this is the ONLY assertion in the suite that the button is in the
    // toolbar at all. PalettesDialog.test.tsx covers the dialog's behaviour but
    // never names its trigger.
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
