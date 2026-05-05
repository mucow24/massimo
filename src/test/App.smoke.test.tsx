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

  it('shows toolbar buttons', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: /\+ Station/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Load/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Clear/ })).toBeInTheDocument();
  });
});
