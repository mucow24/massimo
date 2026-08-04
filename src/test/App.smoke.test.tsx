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

  it('shows toolbar menus', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: /Canvas/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add/ })).toBeInTheDocument();
  });

  it('exposes a Manage palettes button in the toolbar', () => {
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
