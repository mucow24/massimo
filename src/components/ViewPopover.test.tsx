import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ViewPopover } from './ViewPopover';
import { useViewportStore } from '../state/viewportStore';
import { VISIBILITY_ITEMS } from '../state/visibility';

const resetFlags = () =>
  useViewportStore.setState({
    showNetwork: true,
    showAnchors: false,
    showWaypoints: false,
    showLineCircles: true,
    showTransfers: true,
    showSvgImages: true,
    showTextLabels: true,
    showPolygons: true,
    showRouteBullets: true,
  });

beforeEach(() => {
  localStorage.clear();
  resetFlags();
});

const openMenu = async () => {
  const user = userEvent.setup();
  render(<ViewPopover />);
  await user.click(screen.getByRole('button', { name: 'View' }));
  return user;
};

describe('ViewPopover', () => {
  it('is closed until the View button is clicked', () => {
    render(<ViewPopover />);
    expect(screen.queryByRole('dialog', { name: 'View' })).not.toBeInTheDocument();
  });

  it('shows one checkbox per visibility flag, in registry order', async () => {
    await openMenu();
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes.map((b) => b.getAttribute('aria-label'))).toEqual(
      VISIBILITY_ITEMS.map((i) => i.label),
    );
  });

  it('draws a divider between each group, and only between groups', async () => {
    await openMenu();
    const groups = new Set(VISIBILITY_ITEMS.map((i) => i.group));
    const panel = screen.getByRole('dialog', { name: 'View' });
    expect(panel.querySelectorAll('hr').length).toBe(groups.size - 1);
  });

  it('reflects the live flag state', async () => {
    useViewportStore.setState({ showPolygons: false });
    await openMenu();
    expect(screen.getByRole('checkbox', { name: 'Polygons' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByRole('checkbox', { name: 'Line circles' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('writes the flag its checkbox owns, and nothing else', async () => {
    const user = await openMenu();
    await user.click(screen.getByRole('checkbox', { name: 'Line circles' }));
    expect(useViewportStore.getState().showLineCircles).toBe(false);
    // The neighbours in the same group stay put — a mis-wired setter would be
    // invisible in a one-flag assertion.
    expect(useViewportStore.getState().showTransfers).toBe(true);
    expect(useViewportStore.getState().showAnchors).toBe(false);
    await user.click(screen.getByRole('checkbox', { name: 'Line circles' }));
    expect(useViewportStore.getState().showLineCircles).toBe(true);
  });

  it('drives every flag from its own checkbox', async () => {
    // One pass over the whole menu: catches a copy-paste that points two rows at
    // the same flag, which the single-row case above cannot see.
    const user = await openMenu();
    for (const item of VISIBILITY_ITEMS) {
      const before = useViewportStore.getState()[item.key];
      await user.click(screen.getByRole('checkbox', { name: item.label }));
      expect(useViewportStore.getState()[item.key], `${item.key} did not flip`).toBe(!before);
    }
  });

  it('marks the button when a layer is hidden, and clears the mark when restored', async () => {
    const user = await openMenu();
    const btn = () => screen.getByRole('button', { name: 'View' });
    expect(btn()).not.toHaveClass('has-hidden');
    await user.click(screen.getByRole('checkbox', { name: 'Polygons' }));
    expect(btn()).toHaveClass('has-hidden');
    await user.click(screen.getByRole('checkbox', { name: 'Polygons' }));
    expect(btn()).not.toHaveClass('has-hidden');
  });

  it('leaves the button unmarked with every box checked', async () => {
    // Nothing is hidden, so there is nothing to warn about. Checking every box
    // and STILL seeing the mark is the bug this pins — anchors and waypoints
    // default to hidden, so a "differs from the default" rule fires here.
    const user = await openMenu();
    for (const item of VISIBILITY_ITEMS) {
      const box = screen.getByRole('checkbox', { name: item.label });
      if (box.getAttribute('aria-checked') !== 'true') await user.click(box);
    }
    expect(screen.getByRole('button', { name: 'View' })).not.toHaveClass('has-hidden');
  });

  it('does not mark for a REVEALED layer — turning one on hides nothing', async () => {
    const user = await openMenu();
    await user.click(screen.getByRole('checkbox', { name: 'Waypoints' }));
    expect(screen.getByRole('button', { name: 'View' })).not.toHaveClass('has-hidden');
  });

  it('is not marked on a pristine canvas, despite anchors and waypoints being off', async () => {
    render(<ViewPopover />);
    expect(screen.getByRole('button', { name: 'View' })).not.toHaveClass('has-hidden');
  });
});
