import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toolbar } from './Toolbar';
import { useDoc } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
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
});

describe('<PerfPopover />', () => {
  it('sits in the toolbar next to Help', async () => {
    render(<Toolbar />);
    const perf = screen.getByRole('button', { name: 'Perf' });
    expect(perf).toHaveClass('tool-btn');
    const all = Array.from(document.querySelectorAll('.tool-btn'));
    const help = screen.getByRole('button', { name: 'Help' });
    expect(all.indexOf(perf)).toBeGreaterThanOrEqual(0);
    expect(Math.abs(all.indexOf(perf) - all.indexOf(help))).toBe(1);
  });

  it('is closed until pressed, then shows the panel', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    expect(screen.queryByRole('dialog', { name: /performance/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Perf' }));
    expect(screen.getByRole('dialog', { name: /performance/i })).toBeInTheDocument();
  });

  it('reports the live counters, labelled in words rather than field names', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await user.click(screen.getByRole('button', { name: 'Perf' }));
    const panel = screen.getByRole('dialog', { name: /performance/i });

    // The number this whole exercise exists to surface.
    expect(panel).toHaveTextContent(/clipper/i);
    expect(panel).toHaveTextContent(/MB/);
    // Doc size, read from the live store — 2 stations, 1 line seeded above.
    expect(panel).toHaveTextContent(/stations/i);
    expect(panel).toHaveTextContent(/lines/i);
    expect(panel).toHaveTextContent(/undo/i);

    // Field names must not leak into the UI.
    expect(panel).not.toHaveTextContent(/wasmMB|svgNodes|regionAssignments|heapMB/);
  });

  it('shows the live station and line counts', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await user.click(screen.getByRole('button', { name: 'Perf' }));
    const stations = screen.getByTestId('perf-stat-stations');
    const lines = screen.getByTestId('perf-stat-lines');
    expect(stations).toHaveTextContent('2');
    expect(lines).toHaveTextContent('1');
  });

  it('re-snapshots on each open rather than freezing the first reading', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await user.click(screen.getByRole('button', { name: 'Perf' }));
    expect(screen.getByTestId('perf-stat-stations')).toHaveTextContent('2');
    await user.click(screen.getByRole('button', { name: 'Perf' })); // close

    useDoc.getState().addStation(50, 50, 'Third');
    await user.click(screen.getByRole('button', { name: 'Perf' }));
    expect(screen.getByTestId('perf-stat-stations')).toHaveTextContent('3');
  });

  it('has no close button — it dismisses like the other toolbar menus', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await user.click(screen.getByRole('button', { name: 'Perf' }));
    const panel = screen.getByRole('dialog', { name: /performance/i });
    expect(panel.querySelectorAll('button')).toHaveLength(0);
  });
});
