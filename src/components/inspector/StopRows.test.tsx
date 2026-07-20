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
