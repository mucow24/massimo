import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sidebar } from './Sidebar';
import { useDoc, useSelection } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
import { makeDoc, makeLine, makeStation, makeStop } from '../test/fixtures';

// Scoped to the Sidebar-only logic the plan calls out (the rest is e2e):
//  - station sort-direction flip (clicking the active header toggles asc/desc)
//  - a station-row line badge → selectLine (and the stop-propagation that keeps
//    it from also selecting the station).

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useSelection.setState({
    ...useSelection.getState(),
    activeTab: 'stations',
    selectedStationIds: [],
    selectedRouteBulletIds: [],
    selectedLineId: null,
    hoveredStationId: null,
  });
});

const rowOrder = () =>
  Array.from(document.querySelectorAll('[data-station-row]')).map((el) =>
    el.getAttribute('data-station-row'),
  );

// The "Station" column header is a .sort-header button (distinct from the
// "Stations (N)" tab button, which would also match a /Station/ name query).
const stationHeader = (): HTMLButtonElement => {
  const el = Array.from(document.querySelectorAll('button.sort-header')).find((b) =>
    b.textContent?.startsWith('Station'),
  );
  if (!el) throw new Error('expected a Station sort header');
  return el as HTMLButtonElement;
};

describe('<Sidebar /> — station sort-direction flip', () => {
  beforeEach(() => {
    useDoc.setState({
      ...useDoc.getState(),
      ...makeDoc({
        stations: [
          makeStation({ id: 'alpha', name: 'Alpha' }),
          makeStation({ id: 'beta', name: 'Beta' }),
          makeStation({ id: 'gamma', name: 'Gamma' }),
        ],
      }),
    });
  });

  // The arrow is a Radix triangle icon carrying its own accessible name, so
  // the assertion targets the rendered indicator (icon + label travel as a
  // unit — a flipped direction ternary reads "ascending" over reversed rows
  // and fails here).
  const sortDir = () =>
    stationHeader().querySelector('.sort-arrow [role="img"]')?.getAttribute('aria-label');

  it('defaults to name-ascending order with an ascending arrow on the Station header', () => {
    render(<Sidebar />);
    expect(rowOrder()).toEqual(['alpha', 'beta', 'gamma']);
    expect(sortDir()).toBe('sorted ascending');
  });

  it('clicking the active Station header once flips to descending and reverses the rows', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(stationHeader());
    expect(rowOrder()).toEqual(['gamma', 'beta', 'alpha']);
    expect(sortDir()).toBe('sorted descending');

    // A second click flips back to ascending.
    await user.click(stationHeader());
    expect(rowOrder()).toEqual(['alpha', 'beta', 'gamma']);
    expect(sortDir()).toBe('sorted ascending');
  });
});

describe('<Sidebar /> — line badge selects the line', () => {
  it('clicking a station-row line badge calls selectLine (not selectStation)', async () => {
    const user = userEvent.setup();
    useDoc.setState({
      ...useDoc.getState(),
      ...makeDoc({
        stations: [makeStation({ id: 's1', name: 'Hub', stops: [makeStop('L1')] })],
        lines: [makeLine({ id: 'L1', service: 'A', stations: ['s1'] })],
      }),
    });
    render(<Sidebar />);

    // The badge carries the service code "A" and a "Edit line A" title.
    const badge = screen.getByTitle('Edit line A');
    await user.click(badge);

    const sel = useSelection.getState();
    expect(sel.selectedLineId).toBe('L1');
    // The badge's stopPropagation kept the row's onClick (selectStation) from
    // firing, so no station got selected.
    expect(sel.selectedStationIds).toEqual([]);
    // selectLine also switches the active tab to lines.
    expect(sel.activeTab).toBe('lines');
  });
});
