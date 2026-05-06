import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../App';
import { useDoc } from '../state/store';

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), stations: {}, lines: {}, lineOrder: [] });
});

describe('App smoke', () => {
  it('renders without crashing', () => {
    render(<App />);
    expect(screen.getByText('Massimo')).toBeInTheDocument();
  });

  it('shows toolbar menus', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: /Canvas/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add/ })).toBeInTheDocument();
  });
});
