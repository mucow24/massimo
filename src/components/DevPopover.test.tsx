import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toolbar } from './Toolbar';
import { useDoc } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
import { DEFAULT_GUIDE_RENDER, useDevSettings } from '../state/devSettings';
import { makeLine, makeStation, makeStop } from '../test/fixtures';

beforeEach(() => {
  localStorage.clear();
  useDoc.setState({
    ...useDoc.getState(),
    ...DEFAULT_DOC,
    stations: {
      s1: makeStation({ id: 's1', x: 0, y: 0, stops: [makeStop('L1')] }),
      s2: makeStation({ id: 's2', x: 200, y: 0, stops: [makeStop('L1')] }),
    },
    lines: { L1: makeLine({ id: 'L1', stations: ['s1', 's2'] }) },
  });
  useDoc.temporal.getState().clear();
  useDevSettings.getState().resetGuide();
});

const openPane = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'Developer' }));
  return screen.getByRole('dialog', { name: /developer/i });
};

describe('<DevPopover />', () => {
  it('sits in the toolbar next to Help', async () => {
    render(<Toolbar />);
    const dev = screen.getByRole('button', { name: 'Developer' });
    expect(dev).toHaveClass('tool-btn');
    const all = Array.from(document.querySelectorAll('.tool-btn'));
    const help = screen.getByRole('button', { name: 'Help' });
    expect(all.indexOf(dev)).toBeGreaterThanOrEqual(0);
    expect(Math.abs(all.indexOf(dev) - all.indexOf(help))).toBe(1);
  });

  it('is closed until pressed, and the same press closes it again', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    expect(screen.queryByRole('dialog', { name: /developer/i })).not.toBeInTheDocument();
    await openPane(user);
    await user.click(screen.getByRole('button', { name: 'Developer' }));
    expect(screen.queryByRole('dialog', { name: /developer/i })).not.toBeInTheDocument();
  });
});

describe('<DevPopover /> performance section', () => {
  it('is collapsed on open — the numbers are a lead to chase, not the pane', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    const panel = await openPane(user);
    expect(screen.getByRole('button', { name: 'Performance' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByTestId('perf-stat-stations')).not.toBeInTheDocument();
    expect(panel).not.toHaveTextContent(/clipper/i);
  });

  it('reports the live counters once expanded, labelled in words rather than field names', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    const panel = await openPane(user);
    await user.click(screen.getByRole('button', { name: 'Performance' }));

    // The number this whole exercise exists to surface.
    expect(panel).toHaveTextContent(/clipper/i);
    expect(panel).toHaveTextContent(/MB/);
    // Doc size, read from the live store — 2 stations, 1 line seeded above.
    expect(screen.getByTestId('perf-stat-stations')).toHaveTextContent('2');
    expect(screen.getByTestId('perf-stat-lines')).toHaveTextContent('1');
    expect(panel).toHaveTextContent(/undo/i);

    // Field names must not leak into the UI.
    expect(panel).not.toHaveTextContent(/wasmMB|svgNodes|regionAssignments|heapMB/);
  });

  it('re-snapshots on each expansion rather than freezing the first reading', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await openPane(user);
    await user.click(screen.getByRole('button', { name: 'Performance' }));
    expect(screen.getByTestId('perf-stat-stations')).toHaveTextContent('2');
    await user.click(screen.getByRole('button', { name: 'Performance' })); // collapse

    useDoc.getState().addStation(50, 50, 'Third');
    await user.click(screen.getByRole('button', { name: 'Performance' }));
    expect(screen.getByTestId('perf-stat-stations')).toHaveTextContent('3');
  });
});

describe('<DevPopover /> guide rendering section', () => {
  it('opens expanded — it is the pane a dial is being turned in', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await openPane(user);
    expect(screen.getByRole('button', { name: 'Guide rendering' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('spinbutton', { name: 'Thickness' })).toHaveValue(1.5);
    expect(screen.getByRole('spinbutton', { name: 'Casing thickness' })).toHaveValue(0.5);
    expect(screen.getByRole('textbox', { name: 'Dash' })).toHaveValue('10 2');
    // "1 0" — a dash with no gap: the casing starts SOLID under a dashed core.
    expect(screen.getByRole('textbox', { name: 'Casing dash' })).toHaveValue('1 0');
    expect(screen.getByRole('spinbutton', { name: 'Transition zoom %' })).toHaveValue(300);
  });

  it('writes each dial straight to the live recipe', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await openPane(user);

    const dash = screen.getByRole('textbox', { name: 'Dash' });
    await user.clear(dash);
    await user.type(dash, '9 3');
    expect(useDevSettings.getState().guide.dash).toBe('9 3');

    const thickness = screen.getByRole('spinbutton', { name: 'Thickness' });
    await user.clear(thickness);
    await user.type(thickness, '3');
    expect(useDevSettings.getState().guide.thickness).toBe(3);

    const casingDash = screen.getByRole('textbox', { name: 'Casing dash' });
    await user.clear(casingDash);
    await user.type(casingDash, '6 1');
    expect(useDevSettings.getState().guide.casingDash).toBe('6 1');

    const casing = screen.getByRole('spinbutton', { name: 'Casing thickness' });
    await user.clear(casing);
    await user.type(casing, '2');
    expect(useDevSettings.getState().guide.casingThickness).toBe(2);

    const min = screen.getByRole('spinbutton', { name: 'Min thickness' });
    await user.clear(min);
    await user.type(min, '1');
    expect(useDevSettings.getState().guide.minThickness).toBe(1);

    const transition = screen.getByRole('spinbutton', { name: 'Transition zoom %' });
    await user.clear(transition);
    await user.type(transition, '400');
    expect(useDevSettings.getState().guide.transitionZoomPercent).toBe(400);
  });

  it('takes a negative casing thickness, down to where the casing vanishes', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await openPane(user);
    const casing = screen.getByRole('spinbutton', { name: 'Casing thickness' });
    // An inset can only run to half the core's width — past that the casing
    // stroke would cross zero.
    expect(casing).toHaveAttribute('min', '-0.75');
    await user.clear(casing);
    await user.type(casing, '-0.5');
    expect(useDevSettings.getState().guide.casingThickness).toBe(-0.5);
  });

  it('moves the inset floor with the core thickness', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await openPane(user);
    useDevSettings.getState().setGuide({ thickness: 3 });

    const casing = await screen.findByRole('spinbutton', { name: 'Casing thickness' });
    expect(casing).toHaveAttribute('min', '-1.5');
    await user.clear(casing);
    await user.type(casing, '-2');
    expect(useDevSettings.getState().guide.casingThickness).toBe(-1.5);
  });

  it('shows the recipe color, and the theme color once a dial is cleared', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await openPane(user);
    const chip = (name: string) =>
      screen
        .getByRole('button', { name })
        .querySelector('.color-field-chip')!
        .getAttribute('style');
    // The recipe ships both colors, so the swatches mirror those…
    expect(chip('Guide color')).toContain('#0067ff');
    expect(chip('Guide casing color')).toContain('#fafafab5');
    // …and a cleared dial (a recipe stored before the colors were baked) falls
    // through to the day theme's guide indigo and paper tone.
    useDevSettings.getState().setGuide({ color: null, casingColor: null });
    expect(await screen.findByRole('button', { name: 'Guide color' })).toBeInTheDocument();
    expect(chip('Guide color')).toContain('#2f439b');
    expect(chip('Guide casing color')).toContain('#fafafa');
  });

  it('puts every dial back with one Reset', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await openPane(user);
    useDevSettings.getState().setGuide({ thickness: 4, color: '#ff00ff', dash: '1 1' });

    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(useDevSettings.getState().guide).toEqual(DEFAULT_GUIDE_RENDER);
    expect(screen.getByRole('spinbutton', { name: 'Thickness' })).toHaveValue(1.5);
    expect(screen.getByRole('textbox', { name: 'Dash' })).toHaveValue('10 2');
  });
});
