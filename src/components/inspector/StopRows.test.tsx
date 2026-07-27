import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StopRows } from './StopRows';
import { useDoc, useSelection } from '../../state/store';
import { historyDepth } from '../../state/history';
import { DEFAULT_DOC } from '../../model/transforms';
import { DOT_SIZE_DEFAULT } from '../../model/dotSize';
import { STOP_DOT_FACTORY_STYLES } from '../../model/dotStyle';
import type { Station } from '../../model/types';
import { makeLine } from '../../test/fixtures';
import { chooseOption } from '../../test/interaction';

const hub = (over: Partial<Station> = {}): Station => ({
  id: 'a',
  name: 'A',
  x: 0,
  y: 0,
  rotation: 0,
  stops: [
    { lineId: 'L2', row: 0, col: 1, orientation: 'auto-vertical' },
    { lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' },
  ],
  label: { row: 0, col: -1, rotation: 0, offset: 0, align: 'auto', valign: 'middle' },
  ...over,
});

const seed = (stations: Record<string, Station>, over: Record<string, unknown> = {}) => {
  useDoc.setState({
    ...DEFAULT_DOC,
    stations,
    lines: {
      L1: makeLine({
        id: 'L1',
        service: '1',
        name: '1 line',
        color: '#c60c30',
        stations: Object.keys(stations),
      }),
      L2: makeLine({
        id: 'L2',
        service: '2',
        name: '2 line',
        color: '#0039a6',
        stations: Object.keys(stations),
      }),
    },
    lineOrder: ['L1', 'L2'],
  });
  useSelection.setState({
    ...useSelection.getState(),
    selectedStationIds: ['a'],
    selectedStopLineId: null,
    labelSelected: false,
    mirrorMatching: false,
    hoveredLineStop: null,
    ...over,
  });
  useDoc.temporal.getState().clear();
};

const renderRows = () => {
  const station = useDoc.getState().stations.a;
  const lines = useDoc.getState().lines;
  return render(<StopRows station={station} lines={lines} />);
};

beforeEach(() => {
  localStorage.clear();
  useDoc.setState({ ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
});

describe('<StopRows />', () => {
  it('disables the dot-size input for dash stops (dimensions follow the line width)', () => {
    const dash = {
      shape: 'dash',
      fill: 'line',
      strokeWidth: 0,
      strokeColor: 'line',
      strokeAlign: 'center',
      showServiceCode: false,
    } as const;
    seed({
      a: hub({
        stops: [
          { lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical', dotStyle: dash },
          { lineId: 'L2', row: 0, col: 1, orientation: 'auto-vertical' },
        ],
      }),
    });
    renderRows();
    const sizeInputs = screen.getAllByRole('spinbutton', { name: 'Stop dot size' });
    expect(sizeInputs[0]).toBeDisabled(); // the dash stop's row
    expect(sizeInputs[1]).not.toBeDisabled(); // the circle stop keeps its size
  });

  it('a wheel over the disabled dash size input writes nothing (listener unbound)', () => {
    const dash = {
      shape: 'dash',
      fill: 'line',
      strokeWidth: 0,
      strokeColor: 'line',
      strokeAlign: 'center',
      showServiceCode: false,
    } as const;
    seed({
      a: hub({
        stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical', dotStyle: dash }],
      }),
    });
    renderRows();
    const input = screen.getByRole('spinbutton', { name: 'Stop dot size' });
    fireEvent.wheel(input, { deltaY: -1 });
    const stop = useDoc.getState().stations.a.stops.find((s) => s.lineId === 'L1')!;
    expect('dotSize' in stop).toBe(false);
  });

  it('renders one row per stop, sorted row-major, with the service badge', () => {
    seed({ a: hub() });
    renderRows();
    const rows = screen.getAllByTestId('stop-row');
    expect(rows).toHaveLength(2);
    // Stops are (0,0) L1 then (0,1) L2 in cell order, though stored L2-first.
    expect(rows[0]).toHaveTextContent('1');
    expect(rows[1]).toHaveTextContent('2');
  });

  it("titles each badge with the line's display name, like every other surface", () => {
    // The badge tooltip is the inspector's answer to "which line is this stop
    // on?" — the same question the sidebar row and the layout editor's stop
    // tooltip answer. All three go through lineDisplayName, so a named line
    // reads by NAME here too instead of "Line <service>".
    seed({ a: hub() });
    renderRows();
    const rows = screen.getAllByTestId('stop-row');
    // ...followed by the double-click affordance, so the mode hop below is
    // discoverable rather than folklore.
    expect(rows[0].querySelector('.line-badge')).toHaveAttribute(
      'title',
      '1 line — double-click to edit this line',
    );
    expect(rows[1].querySelector('.line-badge')).toHaveAttribute(
      'title',
      '2 line — double-click to edit this line',
    );
  });

  it('double-clicking a badge jumps to editing that line', async () => {
    // The badge answers "which line is this stop on?"; double-clicking it goes
    // there — straight into Edit Stops for that line (the only line-editor
    // entry point, see startAppend). The single clicks on the way just select
    // the row's stop, so nothing is left behind.
    const user = userEvent.setup();
    seed({ a: hub() });
    renderRows();
    const badge = screen.getAllByTestId('stop-row')[1].querySelector('.line-badge')!;
    await user.dblClick(badge);
    expect(useSelection.getState().uiMode).toEqual({
      kind: 'appending-to-line',
      lineId: 'L2',
      cursor: null,
    });
    expect(useSelection.getState().selectedLineId).toBe('L2');
  });

  it('every row has an ENABLED shape picker (no selection ritual)', () => {
    seed({ a: hub() });
    renderRows();
    const rows = screen.getAllByTestId('stop-row');
    for (const row of rows) {
      expect(within(row).getByRole('button', { name: 'Stop shape' })).toHaveAttribute(
        'aria-disabled',
        'false',
      );
    }
  });

  it("picking a shape writes THAT row's stop style", async () => {
    const user = userEvent.setup();
    seed({ a: hub() });
    // A fresh map seeds only the pruned library; add the full known catalog to
    // the doc so the "Filled black diamond" preset is offered for the pick.
    useDoc.setState({ styles: { ...useDoc.getState().styles, ...STOP_DOT_FACTORY_STYLES } });
    renderRows();
    const rows = screen.getAllByTestId('stop-row');
    await user.click(within(rows[1]).getByRole('button', { name: 'Stop shape' }));
    await user.click(screen.getByRole('menuitem', { name: 'Filled black diamond' }));
    const st = useDoc.getState().stations.a;
    expect(st.stops.find((s) => s.lineId === 'L2')?.dotStyle?.shape).toBe('diamond');
    expect(st.stops.find((s) => s.lineId === 'L1')?.dotStyle).toBeUndefined();
  });

  it('the size field shows the resolved size and writes a per-stop override', () => {
    seed({ a: hub() });
    renderRows();
    const rows = screen.getAllByTestId('stop-row');
    const size = within(rows[0]).getByRole('spinbutton', { name: 'Stop dot size' });
    expect(size).toHaveValue(DOT_SIZE_DEFAULT);
    size.focus();
    fireEvent.change(size, { target: { value: '12' } });
    expect(useDoc.getState().stations.a.stops.find((s) => s.lineId === 'L1')?.dotSize).toBe(12);
  });

  it('the orientation button shows the WORLD-true axis on rotated stations', () => {
    // Rotation 1 (45° CW): local auto-vertical paints as NE/SW.
    seed({ a: hub({ rotation: 1 }) });
    renderRows();
    const row = screen.getAllByTestId('stop-row')[0];
    within(row).getByRole('button', { name: 'Stop orientation (line 1): NE–SW' });
  });

  it('clicking the orientation button cycles the axis one step in one undo entry', async () => {
    const user = userEvent.setup();
    seed({ a: hub() });
    renderRows();
    const row = screen.getAllByTestId('stop-row')[0];
    await user.click(
      within(row).getByRole('button', { name: 'Stop orientation (line 1): vertical' }),
    );
    const st = useDoc.getState().stations.a;
    expect(st.stops.find((s) => s.lineId === 'L1')?.orientation).toBe('auto-ne-sw');
    expect(historyDepth()).toBe(1);
  });

  it('mirror mode: a cycle click advances each match from its own state in one undo entry', async () => {
    const user = userEvent.setup();
    seed({ a: hub(), b: hub({ id: 'b', x: 400 }) }, { mirrorMatching: true });
    useDoc.temporal.getState().clear();
    renderRows();
    const row = screen.getAllByTestId('stop-row')[0];
    await user.click(
      within(row).getByRole('button', { name: 'Stop orientation (line 1): vertical' }),
    );
    const doc = useDoc.getState();
    expect(doc.stations.a.stops.find((s) => s.lineId === 'L1')?.orientation).toBe('auto-ne-sw');
    expect(doc.stations.b.stops.find((s) => s.lineId === 'L1')?.orientation).toBe('auto-ne-sw');
    expect(historyDepth()).toBe(1);
  });

  it('clicking a row selects its stop; hovering highlights the dot on the canvas', async () => {
    const user = userEvent.setup();
    seed({ a: hub() });
    renderRows();
    const rows = screen.getAllByTestId('stop-row');
    await user.hover(rows[1]);
    expect(useSelection.getState().hoveredLineStop).toEqual({ lineId: 'L2', stationId: 'a' });
    await user.click(rows[1]);
    expect(useSelection.getState().selectedStopLineId).toBe('L2');
    await user.unhover(rows[1]);
    expect(useSelection.getState().hoveredLineStop).toBeNull();
  });
});

// The per-terminus END style override. It shows only where the stop IS one of
// its line's ends, and writes through setStationEndStyle's clear-at-default
// contract (so picking the line's own value un-pins rather than storing it).
describe('<StopRows /> — line ends', () => {
  const endCombo = (service: string) => `Line end (line ${service})`;

  // a—b for L1 (so `a` is an end); L2 runs a—b—c, so `b` is interior for it.
  const chain = () => {
    seed({
      a: hub({ stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' }] }),
    });
    useDoc.setState({
      lines: {
        ...useDoc.getState().lines,
        L1: makeLine({ id: 'L1', service: '1', color: '#c60c30', stations: ['a', 'b'] }),
      },
    });
  };

  it('offers the end control at a terminus', () => {
    chain();
    renderRows();
    expect(screen.getByRole('combobox', { name: endCombo('1') })).toBeTruthy();
  });

  it('hides it at an interior stop, keeping the row’s columns aligned', () => {
    seed({ a: hub({ stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' }] }) });
    useDoc.setState({
      lines: {
        ...useDoc.getState().lines,
        L1: makeLine({ id: 'L1', service: '1', color: '#c60c30', stations: ['x', 'a', 'b'] }),
      },
    });
    const { container } = renderRows();
    expect(screen.queryByRole('combobox', { name: endCombo('1') })).toBeNull();
    // The slot is still held, so Direction doesn't slide left on this row.
    expect(container.querySelector('.end-style-placeholder')).not.toBeNull();
  });

  it('pins this terminus without touching the line default', async () => {
    chain();
    const user = userEvent.setup();
    renderRows();
    await chooseOption(user, endCombo('1'), 'Round');
    expect(useDoc.getState().lines.L1.stationEndStyles).toEqual({ a: 'round' });
    expect(useDoc.getState().lines.L1.endStyle).toBeUndefined();
  });

  it('shows the RESOLVED end — the line default when nothing is pinned', () => {
    chain();
    useDoc.setState({
      lines: {
        ...useDoc.getState().lines,
        L1: { ...useDoc.getState().lines.L1, endStyle: 'round' },
      },
    });
    renderRows();
    // The trigger is a glyph, and the glyph IS the SVG cap — so a round line
    // default shows a round cap here even with nothing pinned at this stop.
    const cap = screen
      .getByRole('combobox', { name: endCombo('1') })
      .querySelector('line')!
      .getAttribute('stroke-linecap');
    expect(cap).toBe('round');
  });

  it('clears the pin when set back to the line’s own end', async () => {
    chain();
    useDoc.setState({
      lines: {
        ...useDoc.getState().lines,
        L1: { ...useDoc.getState().lines.L1, endStyle: 'round', stationEndStyles: { a: 'short' } },
      },
    });
    const user = userEvent.setup();
    renderRows();
    await chooseOption(user, endCombo('1'), 'Round');
    expect('stationEndStyles' in useDoc.getState().lines.L1).toBe(false);
  });

  it('leaves no stuck dot highlight behind when an end is picked', async () => {
    chain();
    const user = userEvent.setup();
    renderRows();
    await user.hover(screen.getByTestId('stop-row'));
    expect(useSelection.getState().hoveredLineStop).toEqual({ lineId: 'L1', stationId: 'a' });
    await chooseOption(user, endCombo('1'), 'Round');
    expect(useSelection.getState().hoveredLineStop).toBeNull();
  });

  it('does NOT mirror to matching stations', async () => {
    // Dot type and size fan out across mirror matches; an end is topology, not
    // a look, so it stays put — pinned deliberately.
    seed(
      { a: hub({ stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' }] }) },
      { mirrorMatching: true, matchedStationIds: ['a', 'z'] },
    );
    useDoc.setState({
      stations: {
        ...useDoc.getState().stations,
        z: hub({
          id: 'z',
          x: 500,
          stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' }],
        }),
      },
      lines: {
        ...useDoc.getState().lines,
        L1: makeLine({ id: 'L1', service: '1', color: '#c60c30', stations: ['a', 'b'] }),
      },
    });
    const user = userEvent.setup();
    renderRows();
    await chooseOption(user, endCombo('1'), 'Short');
    expect(useDoc.getState().lines.L1.stationEndStyles).toEqual({ a: 'short' });
  });
});
