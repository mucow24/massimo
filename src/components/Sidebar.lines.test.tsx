import { describe, it, expect, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sidebar } from './Sidebar';
import { useDoc, useSelection } from '../state/store';
import { useLineListPrefs } from '../state/lineListPrefs';
import { DEFAULT_DOC } from '../model/transforms';
import { makeDoc, makeLine, makeStation, makeStyle } from '../test/fixtures';
import { chooseOption } from '../test/interaction';

// The Lines tab: no z-order controls (region painting decides who is in front,
// so layer order is no longer the user's business), a stop-count column, and a
// control bar that sorts the list and groups it by assigned style.

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  // The view prefs are a module-level store now, so they outlive a render —
  // reset them or one test's grouping leaks into the next.
  useLineListPrefs.setState({ sortBy: 'name', groupByStyle: false, collapsed: new Set() });
  useSelection.setState({
    ...useSelection.getState(),
    activeTab: 'lines',
    sidebarOpen: true,
    selectedStationIds: [],
    selectedRouteBulletIds: [],
    selectedLineId: null,
    hoveredStationId: null,
    uiMode: { kind: 'idle' },
  });
});

const lineRows = () =>
  Array.from(document.querySelectorAll('[data-line-row]')).map((el) =>
    el.getAttribute('data-line-row'),
  );

/** The visible group subheaders, top to bottom. */
const groupHeaders = () =>
  Array.from(document.querySelectorAll('.list-header .section-toggle')).map((el) =>
    (el.textContent ?? '').trim(),
  );

const groupToggle = (label: string): HTMLButtonElement => {
  const el = Array.from(document.querySelectorAll('.list-header .section-toggle')).find(
    (b) => (b.textContent ?? '').trim() === label,
  );
  if (!el) throw new Error(`expected a ${label} group header`);
  return el as HTMLButtonElement;
};

// Three lines whose name order (Ash, Birch, Cedar) and stop-count order
// (1, 3, 2) disagree, so a sort assertion can only pass for the right reason.
const threeLines = () =>
  makeDoc({
    stations: [makeStation({ id: 's1' }), makeStation({ id: 's2' }), makeStation({ id: 's3' })],
    lines: [
      makeLine({ id: 'ash', service: 'A', name: 'Ash', stations: ['s1'] }),
      makeLine({ id: 'birch', service: 'B', name: 'Birch', stations: ['s1', 's2', 's3'] }),
      makeLine({ id: 'cedar', service: 'C', name: 'Cedar', stations: ['s1', 's2'] }),
    ],
  });

describe('<Sidebar /> lines — z-order controls are gone', () => {
  beforeEach(() => {
    useDoc.setState({ ...useDoc.getState(), ...threeLines() });
  });

  it('offers no move up / move down buttons', () => {
    render(<Sidebar />);
    expect(lineRows()).toHaveLength(3); // the rows are there…
    const titles = Array.from(document.querySelectorAll('[data-line-row] button')).map(
      (b) => b.getAttribute('title') ?? b.getAttribute('aria-label') ?? '',
    );
    // …and delete is the only per-row command left.
    expect(titles.filter((t) => /move/i.test(t))).toEqual([]);
    expect(titles).toEqual(['Delete line', 'Delete line', 'Delete line']);
  });

  it('says nothing about stacking order in the row tooltip', () => {
    render(<Sidebar />);
    const title = document.querySelector('[data-line-row="ash"] .list-row')?.getAttribute('title');
    expect(title ?? '').not.toMatch(/reorder|stacking|front|back/i);
  });
});

describe('<Sidebar /> lines — the stop count is its own column', () => {
  beforeEach(() => {
    useDoc.setState({ ...useDoc.getState(), ...threeLines() });
  });

  it('shows the count in a dedicated cell, not in the name', () => {
    render(<Sidebar />);
    const row = document.querySelector('[data-line-row="birch"]')!;
    // The cell names its own unit — there is no column header to do it.
    expect(row.querySelector('.line-stops')?.textContent).toBe('3 stops');
    // The title cell carries the name alone — no "· 3 stations" suffix.
    expect(row.querySelector('.grow')?.textContent).toBe('Birch');
  });

  it('says "stop" for a one-stop line and "stops" for none', () => {
    useDoc.setState({
      ...useDoc.getState(),
      ...makeDoc({
        stations: [makeStation({ id: 's1' })],
        lines: [
          makeLine({ id: 'one', service: 'O', name: 'One', stations: ['s1'] }),
          makeLine({ id: 'none', service: 'N', name: 'None', stations: [] }),
        ],
      }),
    });
    render(<Sidebar />);
    expect(document.querySelector('[data-line-row="one"] .line-stops')?.textContent).toBe('1 stop');
    // Zero takes the plural, as English does.
    expect(document.querySelector('[data-line-row="none"] .line-stops')?.textContent).toBe(
      '0 stops',
    );
  });
});

describe('<Sidebar /> lines — the Sort by control', () => {
  beforeEach(() => {
    useDoc.setState({ ...useDoc.getState(), ...threeLines() });
  });

  const sortCombo = () => screen.getByRole('combobox', { name: 'Sort by' });

  it('starts on Name, in name order', () => {
    render(<Sidebar />);
    expect(sortCombo().textContent).toContain('Name');
    expect(lineRows()).toEqual(['ash', 'birch', 'cedar']);
  });

  it('picking # Stops reorders by stop count', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    await chooseOption(user, 'Sort by', '# Stops');

    // 1, 2, 3 — an order neither the name sort nor the doc's insertion order gives.
    expect(lineRows()).toEqual(['ash', 'cedar', 'birch']);
    expect(sortCombo().textContent).toContain('# Stops');
  });

  it('picking Name again goes back to name order', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    await chooseOption(user, 'Sort by', '# Stops');
    await chooseOption(user, 'Sort by', 'Name');

    expect(lineRows()).toEqual(['ash', 'birch', 'cedar']);
  });

  it('carries controls, not a clickable column-header bar', () => {
    render(<Sidebar />);
    expect(document.querySelector('.list-controls')).not.toBeNull();
    // The stations list still sorts by clicking its column headers; this one
    // does not, so none of those buttons should be in the Lines tab.
    expect(document.querySelector('button.sort-header')).toBeNull();
  });

  it('drops the controls entirely when there are no lines', () => {
    useDoc.setState({ ...useDoc.getState(), ...makeDoc({}) });
    render(<Sidebar />);
    // Nothing to sort or group — the bar would just be dead chrome over the
    // empty-state message.
    expect(document.querySelector('.list-controls')).toBeNull();
    expect(screen.getByText('No lines yet.')).toBeTruthy();
  });
});

describe('<Sidebar /> lines — group by style', () => {
  const bold = makeStyle('line', 'st-bold', { name: 'Bold' });
  const airy = makeStyle('line', 'st-airy', { name: 'Airy' });

  beforeEach(() => {
    useDoc.setState({
      ...useDoc.getState(),
      ...makeDoc({
        stations: [makeStation({ id: 's1' }), makeStation({ id: 's2' }), makeStation({ id: 's3' })],
        styles: [bold, airy],
        lines: [
          makeLine({ id: 'plain', service: 'P', name: 'Plain', stations: ['s1'] }),
          makeLine({ id: 'heavy', service: 'H', name: 'Heavy', styleId: 'st-bold' }),
          makeLine({
            id: 'breeze',
            service: 'Z',
            name: 'Breeze',
            styleId: 'st-airy',
            stations: ['s1', 's2'],
          }),
          // Anvil sorts FIRST by name but LAST by stop count, and the two Bold
          // lines straddle the others' counts — so a per-group sort and a
          // whole-list sort can't produce the same row order.
          makeLine({
            id: 'anvil',
            service: 'N',
            name: 'Anvil',
            styleId: 'st-bold',
            stations: ['s1', 's2', 's3'],
          }),
        ],
      }),
    });
  });

  const checkbox = () => screen.getByRole('checkbox', { name: 'Group by style' });

  it('is off by default — one flat list, no subheaders', () => {
    render(<Sidebar />);
    expect(checkbox()).toHaveProperty('dataset.state', 'unchecked');
    expect(groupHeaders()).toEqual([]);
    expect(lineRows()).toEqual(['anvil', 'breeze', 'heavy', 'plain']);
  });

  it('checking it groups the rows under alphabetical style headers, Custom last', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(checkbox());

    expect(groupHeaders()).toEqual(['Airy', 'Bold', 'Custom']);
    expect(lineRows()).toEqual(['breeze', 'anvil', 'heavy', 'plain']);
  });

  it('sorts within each group, not across the whole list', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.click(checkbox());
    await chooseOption(user, 'Sort by', '# Stops');

    expect(groupHeaders()).toEqual(['Airy', 'Bold', 'Custom']); // groups hold their order
    // Airy(2) | Bold: heavy(0) then anvil(3) | Custom(1). Sorted across the
    // WHOLE list those counts would read heavy, plain, breeze, anvil instead.
    expect(lineRows()).toEqual(['breeze', 'heavy', 'anvil', 'plain']);
  });

  it('collapses one group without touching the others', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    await user.click(checkbox());

    await user.click(groupToggle('Bold'));

    expect(groupToggle('Bold').getAttribute('aria-expanded')).toBe('false');
    expect(lineRows()).toEqual(['breeze', 'plain']); // Bold's two rows are hidden
    expect(groupHeaders()).toEqual(['Airy', 'Bold', 'Custom']); // the header stays

    await user.click(groupToggle('Bold'));
    expect(lineRows()).toEqual(['breeze', 'anvil', 'heavy', 'plain']);
  });

  it('unchecking restores every row, even with the Custom group collapsed', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    await user.click(checkbox());

    await user.click(groupToggle('Custom'));
    expect(lineRows()).toEqual(['breeze', 'anvil', 'heavy']); // 'plain' hidden

    await user.click(checkbox());

    // The ungrouped list is one group keyed by the same empty string Custom
    // uses. Only a real (labelled) group may collapse, or that leftover key
    // would swallow the entire flat list.
    expect(groupHeaders()).toEqual([]);
    expect(lineRows()).toEqual(['anvil', 'breeze', 'heavy', 'plain']);
  });

  it('survives the panel hiding for Edit Stops', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    await user.click(checkbox());
    await user.click(groupToggle('Bold'));

    // Clicking a line row enters Edit Stops, which hides the whole panel — the
    // single most common thing to do from this list. The view controls must not
    // reset behind it.
    act(() => useSelection.getState().startAppend('breeze'));
    expect(document.querySelector('.sidebar')).toBeNull();
    act(() => useSelection.getState().setAppending(null));

    expect(checkbox()).toHaveProperty('dataset.state', 'checked');
    expect(lineRows()).toEqual(['breeze', 'plain']); // Bold still collapsed
  });
});
