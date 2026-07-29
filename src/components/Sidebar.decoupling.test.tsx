import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sidebar, linesByStation } from './Sidebar';
import type { Line, LineId } from '../model/types';
import { useDoc, useSelection } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
import { makeDoc, makeLine, makeStation, makeStop } from '../test/fixtures';

// The sidebar renders no positional field, so a pure x/y station move must
// cost it ~nothing: no name re-cleaning for unmoved stations (the sort's
// dominant cost) and no re-render of unmoved rows (probed via the per-badge
// contrast call). The mocks wrap the real functions — output is unchanged,
// only the call counts are observed.

const calls = vi.hoisted(() => ({ nameList: 0, legible: 0 }));

vi.mock('../geometry/labelTokens', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../geometry/labelTokens')>();
  return {
    ...mod,
    stationNameListText: (text: string) => {
      calls.nameList += 1;
      return mod.stationNameListText(text);
    },
  };
});

vi.mock('../util/color', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../util/color')>();
  return {
    ...mod,
    legibleTextOn: (color: string) => {
      calls.legible += 1;
      return mod.legibleTextOn(color);
    },
  };
});

const rowOrder = () =>
  Array.from(document.querySelectorAll('[data-station-row]')).map((el) =>
    el.getAttribute('data-station-row'),
  );

const badgeCodes = (stationId: string) =>
  Array.from(document.querySelectorAll(`[data-station-row="${stationId}"] .line-badge__code`)).map(
    (el) => el.textContent,
  );

beforeEach(() => {
  calls.nameList = 0;
  calls.legible = 0;
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useSelection.setState({
    ...useSelection.getState(),
    activeTab: 'stations',
    sidebarOpen: true,
    selectedStationIds: [],
    selectedRouteBulletIds: [],
    selectedLineId: null,
    hoveredStationId: null,
    uiMode: { kind: 'idle' },
  });
});

describe('<Sidebar /> — a pure station move costs the list ~nothing', () => {
  // Badge counts per row: a=1, b=2, c=1 — so the legible-call probe can tell
  // "only the moved row rendered" (≤1 for a) from "every row rendered" (4).
  beforeEach(() => {
    useDoc.setState({
      ...useDoc.getState(),
      ...makeDoc({
        stations: [
          makeStation({ id: 'a', name: 'Alpha', stops: [makeStop('L1')] }),
          makeStation({ id: 'b', name: 'Beta', stops: [makeStop('L1'), makeStop('L2')] }),
          makeStation({ id: 'c', name: 'Gamma', stops: [makeStop('L2')] }),
        ],
        lines: [
          makeLine({ id: 'L1', service: '1', stations: ['a', 'b'] }),
          makeLine({ id: 'L2', service: '2', stations: ['b', 'c'] }),
        ],
      }),
    });
  });

  it('re-cleans at most the moved station name (unmoved names come from cache)', () => {
    render(<Sidebar />);
    calls.nameList = 0;

    act(() => useDoc.getState().moveStation('a', 40, 40));

    // The moved station is a new object, so its name may be cleaned once; the
    // unmoved stations' names must not be re-cleaned (before decoupling, the
    // sort re-cleans per comparison and every row re-cleans on render).
    expect(calls.nameList).toBeLessThanOrEqual(1);
  });

  it('re-renders only the moved station row (no badge work elsewhere)', () => {
    render(<Sidebar />);
    calls.legible = 0;

    act(() => useDoc.getState().moveStation('a', 40, 40));

    // Only the moved row may render: its single badge re-evaluates contrast
    // once. A full-list re-render would count one call per badge (4).
    expect(calls.legible).toBeLessThanOrEqual(1);
  });

  it('leaves the rendered list byte-identical, reusing the row DOM nodes', () => {
    render(<Sidebar />);
    const shell = document.querySelector('.sidebar')!;
    const before = shell.innerHTML;
    const rowsBefore = Array.from(document.querySelectorAll('[data-station-row]'));

    act(() => useDoc.getState().moveStation('a', 40, 40));

    expect(shell.innerHTML).toBe(before);
    const rowsAfter = Array.from(document.querySelectorAll('[data-station-row]'));
    rowsAfter.forEach((el, i) => expect(el).toBe(rowsBefore[i]));
  });

  it('a rename still updates the row text and re-sorts (cache follows the new object)', () => {
    render(<Sidebar />);
    expect(rowOrder()).toEqual(['a', 'b', 'c']);

    act(() => useDoc.getState().renameStation('a', 'Zulu'));

    expect(document.querySelector('[data-station-row="a"] .grow')?.textContent).toBe('Zulu');
    expect(rowOrder()).toEqual(['b', 'c', 'a']);
  });

  it('a line membership change still updates the badges', () => {
    render(<Sidebar />);
    expect(badgeCodes('a')).toEqual(['1']);

    const { lines } = useDoc.getState();
    act(() =>
      useDoc.setState({
        lines: { ...lines, L3: makeLine({ id: 'L3', service: '0', stations: ['a'] }) },
      }),
    );

    // Sorted by service ('0' < '1'), displayed reversed.
    expect(badgeCodes('a')).toEqual(['1', '0']);
  });
});

describe('<Sidebar /> — stops-sort still orders by the joined service codes', () => {
  beforeEach(() => {
    useDoc.setState({
      ...useDoc.getState(),
      ...makeDoc({
        stations: [
          makeStation({ id: 'a', name: 'Zed', stops: [makeStop('L1')] }),
          makeStation({ id: 'b', name: 'Milo', stops: [makeStop('L1'), makeStop('L2')] }),
          makeStation({ id: 'c', name: 'Ada', stops: [makeStop('L2')] }),
        ],
        lines: [
          makeLine({ id: 'L1', service: 'A', stations: ['a', 'b'] }),
          makeLine({ id: 'L2', service: 'B', stations: ['b', 'c'] }),
        ],
      }),
    });
  });

  it('clicking the Lines header sorts by service keys (A < "A B" < B)', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    // Name-ascending default: Ada, Milo, Zed.
    expect(rowOrder()).toEqual(['c', 'b', 'a']);

    const header = Array.from(document.querySelectorAll('button.sort-header')).find((b) =>
      b.textContent?.startsWith('Lines'),
    );
    await user.click(header!);

    expect(rowOrder()).toEqual(['a', 'b', 'c']);
  });
});

describe('linesByStation index', () => {
  const fixtureLines = (): Record<LineId, Line> => ({
    L1: makeLine({ id: 'L1', service: 'B', stations: ['a', 'b'] }),
    L2: makeLine({ id: 'L2', service: 'A', stations: ['b', 'c'] }),
  });

  it('returns the same index for the same lines identity, a new one after a change', () => {
    const lines = fixtureLines();
    const first = linesByStation(lines);
    expect(linesByStation(lines)).toBe(first);

    const changed = { ...lines, L2: { ...lines.L2, stations: ['b', 'c', 'a'] } };
    const rebuilt = linesByStation(changed);
    expect(rebuilt).not.toBe(first);
    expect(rebuilt.linesAt.get('a')?.map((ln) => ln.id)).toEqual(['L2', 'L1']);
  });

  it('matches the per-row filter+sort it replaces, station for station', () => {
    const lines = fixtureLines();
    const index = linesByStation(lines);
    for (const id of ['a', 'b', 'c', 'orphan']) {
      const expected = Object.values(lines)
        .filter((ln) => ln.stations.includes(id))
        .sort((x, y) => x.service.localeCompare(y.service));
      expect(index.linesAt.get(id) ?? []).toEqual(expected);
      expect(index.stopsKey.get(id) ?? '').toBe(expected.map((ln) => ln.service).join(' '));
    }
  });
});
