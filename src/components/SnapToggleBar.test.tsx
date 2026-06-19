import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SnapToggleBar } from './SnapToggleBar';
import { useSnapPrefs } from '../state/snapPrefs';
import { useSelection } from '../state/store';
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
    // First click advances Off → first directional state.
    expect(useSnapPrefs.getState().modes.grid).toBe('horizontal');
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
      modes: { line: false, equidistant: true, tens: false, all: 'off', grid: 'off' },
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
    expect(useSnapPrefs.getState().modes.all).toBe('horizontal');
  });

  it('cycles Snap to all through off → horizontal → vertical → diagonal → all → off', async () => {
    const user = userEvent.setup();
    render(<SnapToggleBar />);
    const all = screen.getByRole('button', { name: 'Snap to all' });
    const expected = ['horizontal', 'vertical', 'diagonal', 'all', 'off'];
    expect(all).toHaveAttribute('data-snap-state', 'off');
    expect(all).toHaveAttribute('aria-pressed', 'false');
    for (const want of expected) {
      await user.click(all);
      expect(useSnapPrefs.getState().modes.all).toBe(want);
      expect(all).toHaveAttribute('data-snap-state', want);
      // aria-pressed is true for every state except off.
      expect(all).toHaveAttribute('aria-pressed', String(want !== 'off'));
    }
  });

  it('cycles Snap to grid through off → horizontal → vertical → both → off', async () => {
    const user = userEvent.setup();
    render(<SnapToggleBar />);
    const grid = screen.getByRole('button', { name: 'Snap to grid' });
    const expected = ['horizontal', 'vertical', 'both', 'off'];
    expect(grid).toHaveAttribute('data-snap-state', 'off');
    for (const want of expected) {
      await user.click(grid);
      expect(useSnapPrefs.getState().modes.grid).toBe(want);
      expect(grid).toHaveAttribute('data-snap-state', want);
    }
  });

  it("reflects the active sub-mode in the button's tooltip", async () => {
    const user = userEvent.setup();
    render(<SnapToggleBar />);
    const all = screen.getByRole('button', { name: 'Snap to all' });
    await user.click(all); // → horizontal
    expect(all.getAttribute('title')).toContain('Horizontal only');
  });
});

describe('<SnapToggleBar /> — label-gated toggles (E6)', () => {
  // With a text label selected, the snap toggles that don't apply to labels
  // (line/equidistant/tens/all) disable and show the "not applicable to labels"
  // tooltip, while grid (appliesToLabels) stays enabled. The rest of the suite
  // never sets selectedLabelIds; we set it here and restore it after.
  beforeEach(() => {
    localStorage.clear();
    useSnapPrefs.setState({ modes: { ...DEFAULT_SNAP_MODES } });
    useSelection.setState({ ...useSelection.getState(), selectedLabelIds: ['g1'] });
  });
  afterEach(() => {
    useSelection.setState({ ...useSelection.getState(), selectedLabelIds: [] });
  });

  it('disables every non-grid toggle and tags them "not applicable to labels"', () => {
    render(<SnapToggleBar />);
    for (const name of ['Snap to line', 'Snap to equidistant', "Snap to 10's", 'Snap to all']) {
      const btn = screen.getByRole('button', { name });
      expect(btn).toHaveAttribute('aria-disabled', 'true');
      expect(btn.getAttribute('title')).toContain('not applicable to labels');
    }
  });

  it('keeps Grid enabled (it applies to labels) without the label tooltip', () => {
    render(<SnapToggleBar />);
    const grid = screen.getByRole('button', { name: 'Snap to grid' });
    expect(grid).toHaveAttribute('aria-disabled', 'false');
    expect(grid.getAttribute('title')).not.toContain('not applicable to labels');
  });

  it('a disabled label-gated toggle does not flip the store on click', async () => {
    const user = userEvent.setup();
    render(<SnapToggleBar />);
    // Line is on by default; clicking it while label-gated must leave it on.
    await user.click(screen.getByRole('button', { name: 'Snap to line' }));
    expect(useSnapPrefs.getState().modes.line).toBe(true);
  });

  it('Grid still cycles while a label is selected', async () => {
    const user = userEvent.setup();
    render(<SnapToggleBar />);
    await user.click(screen.getByRole('button', { name: 'Snap to grid' }));
    expect(useSnapPrefs.getState().modes.grid).toBe('horizontal');
  });
});
