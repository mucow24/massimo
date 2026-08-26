import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HelpPopover } from './HelpPopover';
import { SnapToggleBar, SNAP_TOGGLE_COUNT, SNAP_TOGGLE_NAMES } from './SnapToggleBar';
import { useSnapPrefs } from '../state/snapPrefs';
import { useViewportStore } from '../state/viewportStore';
import { VISIBILITY_ITEMS } from '../state/visibility';
import { DEFAULT_SNAP_MODES } from '../geometry/snap';

// The overlay portals to the nearest `.app` ancestor, so give it one.
const renderHelp = () =>
  render(
    <div className="app">
      <HelpPopover />
    </div>,
  );

const panel = () => screen.queryByRole('dialog', { name: 'Quick reference' });

describe('<HelpPopover /> — the "?" shortcut', () => {
  it('opens and closes on "?" from anywhere on the page', async () => {
    const user = userEvent.setup();
    renderHelp();
    expect(panel()).toBeNull();
    await user.keyboard('?');
    expect(panel()).toBeInTheDocument();
    await user.keyboard('?');
    expect(panel()).toBeNull();
  });

  // "?" in a name field is typing, not a shortcut — the same denylist every
  // popover key handler shares (isInFormField).
  it('stays out of the way while a text field has the caret', async () => {
    const user = userEvent.setup();
    render(
      <div className="app">
        <input aria-label="Map name" />
        <HelpPopover />
      </div>,
    );
    await user.click(screen.getByRole('textbox', { name: 'Map name' }));
    await user.keyboard('?');
    expect(panel()).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Map name' })).toHaveValue('?');
  });

  it('leaves a modified "?" to the browser', async () => {
    const user = userEvent.setup();
    renderHelp();
    await user.keyboard('{Control>}?{/Control}');
    await user.keyboard('{Alt>}?{/Alt}');
    await user.keyboard('{Meta>}?{/Meta}');
    expect(panel()).toBeNull();
  });

  it('opens from the toolbar button and closes from the panel X', async () => {
    const user = userEvent.setup();
    renderHelp();
    const button = screen.getByRole('button', { name: 'Help' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await user.click(button);
    expect(panel()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Help' })).toHaveAttribute('aria-expanded', 'true');
    await user.click(screen.getByRole('button', { name: 'Close help' }));
    expect(panel()).toBeNull();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    renderHelp();
    await user.keyboard('?');
    expect(panel()).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(panel()).toBeNull();
  });

  // The listener unbinds with the component: a stale one left on `window` would
  // keep toggling a panel nothing renders any more.
  it('stops listening once unmounted', async () => {
    const user = userEvent.setup();
    const { unmount } = renderHelp();
    unmount();
    await user.keyboard('?');
    expect(panel()).toBeNull();
  });
});

describe('<HelpPopover /> — the snap row tracks the toggle bar', () => {
  beforeEach(() => {
    localStorage.clear();
    useSnapPrefs.setState({ modes: { ...DEFAULT_SNAP_MODES } });
    useViewportStore.setState({ gridSize: 10 });
  });

  // The digit keys ARE the bar's indices (App.tsx bounds them by
  // SNAP_TOGGLE_COUNT), so the row has to name the same toggles the bar shows,
  // in the same order. Re-listing them here is how it used to drift.
  it('names every toggle the bar renders, in bar order, over the right key range', async () => {
    const user = userEvent.setup();
    render(
      <div className="app">
        <SnapToggleBar />
        <HelpPopover />
      </div>,
    );
    await user.keyboard('?');
    const row = screen.getByText(/Toggle the snap options/);
    const chip = row.parentElement?.querySelector('kbd');
    expect(chip).toHaveTextContent(`1 – ${SNAP_TOGGLE_COUNT}`);

    const barNames = screen
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label') ?? '')
      .filter((l) => l.startsWith('Snap to '))
      .map((l) => l.replace(/^Snap to /, ''));
    expect(barNames).toHaveLength(SNAP_TOGGLE_COUNT);
    expect(row.textContent).toContain(`(${barNames.join(', ')})`);
    expect(row.textContent).toContain(`(${SNAP_TOGGLE_NAMES.join(', ')})`);
  });
});

describe('<HelpPopover /> — the layer row tracks the visibility registry', () => {
  // Same rule as the snap row one section up. The letter lives on the registry
  // entry and App.tsx binds it from there, so this row must name that set and
  // no other: a layer given a letter and missing here is a shortcut the user
  // is never told about, and one listed here but dropped from the registry is
  // a key press that does nothing.
  it('names every lettered layer, in registry order, and only those', async () => {
    const user = userEvent.setup();
    render(
      <div className="app">
        <HelpPopover />
      </div>,
    );
    await user.keyboard('?');
    const lettered = VISIBILITY_ITEMS.filter((i) => i.shortcut);
    const row = screen.getByText(/^Show \/ hide /);
    const chip = row.parentElement?.querySelector('kbd');
    expect(chip).toHaveTextContent(lettered.map((i) => i.shortcut).join(' · '));
    expect(row.textContent).toBe(
      `Show / hide ${lettered.map((i) => i.label.toLowerCase()).join(' · ')} (the View menu holds the rest)`,
    );
  });
});
