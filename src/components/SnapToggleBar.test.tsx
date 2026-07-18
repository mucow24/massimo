import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SnapToggleBar, advanceSnapToggle } from './SnapToggleBar';
import { useSnapPrefs } from '../state/snapPrefs';
import { useSelection } from '../state/store';
import { useViewportStore } from '../state/viewportStore';
import { DEFAULT_SNAP_MODES, type SnapModes } from '../geometry/snap';

describe('<SnapToggleBar />', () => {
  beforeEach(() => {
    localStorage.clear();
    useSnapPrefs.setState({ modes: { ...DEFAULT_SNAP_MODES } });
    useViewportStore.setState({ gridSize: 10 });
  });

  it('renders five toggles labeled Line, Equidistant, Grid length, All, Grid', () => {
    render(<SnapToggleBar />);
    expect(screen.getByRole('button', { name: 'Snap to line' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Snap to equidistant' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Snap to grid length' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Snap to all' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Snap to grid' })).toBeInTheDocument();
  });

  it('shows the active grid size in the grid-length tooltip (10)', () => {
    render(<SnapToggleBar />);
    expect(
      screen.getByRole('button', { name: 'Snap to grid length' }).getAttribute('title'),
    ).toContain("(10's)");
  });

  it('reflects a 5px grid in the grid-length tooltip', () => {
    useViewportStore.setState({ gridSize: 5 });
    render(<SnapToggleBar />);
    expect(
      screen.getByRole('button', { name: 'Snap to grid length' }).getAttribute('title'),
    ).toContain("(5's)");
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

  it('disables Equidistant when Line is off; Grid length and All stay enabled', async () => {
    useSnapPrefs.setState({ modes: { ...DEFAULT_SNAP_MODES, line: false } });
    render(<SnapToggleBar />);
    const equi = screen.getByRole('button', { name: 'Snap to equidistant' });
    const tens = screen.getByRole('button', { name: 'Snap to grid length' });
    const all = screen.getByRole('button', { name: 'Snap to all' });
    expect(equi).toHaveAttribute('aria-disabled', 'true');
    // Grid-length snapping now applies to any snapped object (not just stations
    // on a line), so it no longer gates on Line.
    expect(tens).toHaveAttribute('aria-disabled', 'false');
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

describe('<SnapToggleBar /> — label selection no longer gates the toggles', () => {
  // Text labels participate in alignment snapping (Snap to all + grid), so
  // selecting a label must NOT disable the snap toggles. Equidistant/tens
  // still gate on Line being enabled — but never on the selection.
  beforeEach(() => {
    localStorage.clear();
    useSnapPrefs.setState({ modes: { ...DEFAULT_SNAP_MODES } });
    useSelection.setState({ ...useSelection.getState(), selectedLabelIds: ['g1'] });
  });
  afterEach(() => {
    useSelection.setState({ ...useSelection.getState(), selectedLabelIds: [] });
  });

  it('keeps every toggle enabled with a label selected (line-gating aside)', () => {
    render(<SnapToggleBar />);
    for (const name of ['Snap to line', 'Snap to all', 'Snap to grid']) {
      const btn = screen.getByRole('button', { name });
      expect(btn).toHaveAttribute('aria-disabled', 'false');
      expect(btn.getAttribute('title')).not.toContain('not applicable to labels');
    }
  });

  it("'Snap to all' still cycles while a label is selected", async () => {
    const user = userEvent.setup();
    render(<SnapToggleBar />);
    await user.click(screen.getByRole('button', { name: 'Snap to all' }));
    expect(useSnapPrefs.getState().modes.all).toBe('horizontal');
  });

  it('Grid still cycles while a label is selected', async () => {
    const user = userEvent.setup();
    render(<SnapToggleBar />);
    await user.click(screen.getByRole('button', { name: 'Snap to grid' }));
    expect(useSnapPrefs.getState().modes.grid).toBe('horizontal');
  });
});

// The pure step-advance shared by the toolbar's onClick and App's 1–5 keyboard
// shortcuts, so a keypress is exactly one click.
describe('advanceSnapToggle', () => {
  const modes = (over: Partial<SnapModes> = {}): SnapModes => ({ ...DEFAULT_SNAP_MODES, ...over });

  it('toggle 0 (line) flips the boolean', () => {
    expect(advanceSnapToggle(modes({ line: true }), 0)).toEqual({ key: 'line', value: false });
    expect(advanceSnapToggle(modes({ line: false }), 0)).toEqual({ key: 'line', value: true });
  });

  it('toggle 2 (tens) flips the boolean independently of line', () => {
    expect(advanceSnapToggle(modes({ line: false, tens: false }), 2)).toEqual({
      key: 'tens',
      value: true,
    });
  });

  it('toggle 3 (all) walks off → horizontal → vertical → diagonal → all → off', () => {
    const order = ['horizontal', 'vertical', 'diagonal', 'all', 'off'];
    let cur: SnapModes['all'] = 'off';
    for (const want of order) {
      const next = advanceSnapToggle(modes({ all: cur }), 3);
      expect(next).toEqual({ key: 'all', value: want });
      cur = next!.value as SnapModes['all'];
    }
  });

  it('toggle 4 (grid) walks off → horizontal → vertical → both → off', () => {
    const order = ['horizontal', 'vertical', 'both', 'off'];
    let cur: SnapModes['grid'] = 'off';
    for (const want of order) {
      const next = advanceSnapToggle(modes({ grid: cur }), 4);
      expect(next).toEqual({ key: 'grid', value: want });
      cur = next!.value as SnapModes['grid'];
    }
  });

  it('toggle 1 (equidistant) is a no-op when line is off, matching the disabled button', () => {
    expect(advanceSnapToggle(modes({ line: false, equidistant: false }), 1)).toBeNull();
  });

  it('toggle 1 (equidistant) advances when line is on', () => {
    expect(advanceSnapToggle(modes({ line: true, equidistant: false }), 1)).toEqual({
      key: 'equidistant',
      value: true,
    });
  });

  it('returns null for an out-of-range index', () => {
    expect(advanceSnapToggle(modes(), 5)).toBeNull();
    expect(advanceSnapToggle(modes(), -1)).toBeNull();
  });
});
