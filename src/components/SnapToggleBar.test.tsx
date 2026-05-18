import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SnapToggleBar } from './SnapToggleBar';
import { useSnapPrefs } from '../state/snapPrefs';
import { DEFAULT_SNAP_MODES } from '../geometry/snap';

describe('<SnapToggleBar />', () => {
  beforeEach(() => {
    localStorage.clear();
    useSnapPrefs.setState({ modes: { ...DEFAULT_SNAP_MODES } });
  });

  it('renders five toggles labeled Line, Equidistant, Tens, All, Grid', () => {
    render(<SnapToggleBar />);
    expect(screen.getByRole('button', { name: 'Snap to line' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Snap to equidistant' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Snap to 10's" })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Snap to all' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Snap to grid' })).toBeInTheDocument();
  });

  it('Grid toggle works independently of Line', async () => {
    const user = userEvent.setup();
    useSnapPrefs.setState({ modes: { ...DEFAULT_SNAP_MODES, line: false } });
    render(<SnapToggleBar />);
    const grid = screen.getByRole('button', { name: 'Snap to grid' });
    expect(grid).toHaveAttribute('aria-disabled', 'false');
    await user.click(grid);
    expect(useSnapPrefs.getState().modes.grid).toBe(true);
  });

  it('renders Grid to the right of All', () => {
    render(<SnapToggleBar />);
    const buttons = screen.getAllByRole('button');
    const names = buttons.map((b) => b.getAttribute('aria-label'));
    const allIdx = names.indexOf('Snap to all');
    const gridIdx = names.indexOf('Snap to grid');
    expect(gridIdx).toBe(allIdx + 1);
  });

  it('shows Line as active by default; toggling it clears the active state', async () => {
    const user = userEvent.setup();
    render(<SnapToggleBar />);
    const line = screen.getByRole('button', { name: 'Snap to line' });
    expect(line).toHaveAttribute('aria-pressed', 'true');
    await user.click(line);
    expect(line).toHaveAttribute('aria-pressed', 'false');
    expect(useSnapPrefs.getState().modes.line).toBe(false);
  });

  it('disables Equidistant and Tens when Line is off', async () => {
    useSnapPrefs.setState({ modes: { ...DEFAULT_SNAP_MODES, line: false } });
    render(<SnapToggleBar />);
    const equi = screen.getByRole('button', { name: 'Snap to equidistant' });
    const tens = screen.getByRole('button', { name: "Snap to 10's" });
    const all = screen.getByRole('button', { name: 'Snap to all' });
    expect(equi).toHaveAttribute('aria-disabled', 'true');
    expect(tens).toHaveAttribute('aria-disabled', 'true');
    // All is independent of Line — must remain interactable.
    expect(all).toHaveAttribute('aria-disabled', 'false');
  });

  it('disabled buttons do not flip the store on click', async () => {
    const user = userEvent.setup();
    useSnapPrefs.setState({ modes: { ...DEFAULT_SNAP_MODES, line: false } });
    render(<SnapToggleBar />);
    const equi = screen.getByRole('button', { name: 'Snap to equidistant' });
    await user.click(equi);
    expect(useSnapPrefs.getState().modes.equidistant).toBe(false);
  });

  it('re-enabling Line restores Equidistant interactability without changing its value', async () => {
    const user = userEvent.setup();
    useSnapPrefs.setState({
      modes: { line: false, equidistant: true, tens: false, all: false, grid: false },
    });
    render(<SnapToggleBar />);
    const line = screen.getByRole('button', { name: 'Snap to line' });
    await user.click(line);
    const equi = screen.getByRole('button', { name: 'Snap to equidistant' });
    expect(equi).toHaveAttribute('aria-disabled', 'false');
    // The stored value was preserved across the disabled state.
    expect(useSnapPrefs.getState().modes.equidistant).toBe(true);
  });

  it('All toggle works independently of Line', async () => {
    const user = userEvent.setup();
    useSnapPrefs.setState({ modes: { ...DEFAULT_SNAP_MODES, line: false } });
    render(<SnapToggleBar />);
    const all = screen.getByRole('button', { name: 'Snap to all' });
    await user.click(all);
    expect(useSnapPrefs.getState().modes.all).toBe(true);
  });
});
