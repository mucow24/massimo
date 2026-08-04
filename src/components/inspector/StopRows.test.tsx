import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StopRows } from './StopRows';
import { useDoc, useSelection } from '../../state/store';
import { historyDepth } from '../../state/history';
import { DEFAULT_DOC, selfTransferAt } from '../../model/transforms';
import { DOT_SIZE_DEFAULT, DOT_SIZE_STEP } from '../../model/dotSize';
import { STOP_DOT_FACTORY_STYLES } from '../../model/dotStyle';
import { resolveTransferStyle } from '../../model/transferStyle';
import type { Station } from '../../model/types';
import { makeLine, makeStyle } from '../../test/fixtures';
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

describe('<StopRows /> — column order', () => {
  it('reads bullet, type, transfer, end, size, direction across the row', () => {
    // The three glyph pickers cluster, then the number box, then the
    // right-hugging direction button. Every control but the line bullet
    // carries an aria-label, so the row's labels ARE the column order.
    seed({ a: hub({ stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' }] }) });
    renderRows();
    const labels = Array.from(screen.getByTestId('stop-row').querySelectorAll('[aria-label]')).map(
      (el) => el.getAttribute('aria-label'),
    );
    expect(labels).toEqual([
      'Stop shape',
      'Transfer (line 1)',
      'Line end (line 1)',
      'Stop dot size',
      'Stop orientation (line 1): vertical',
    ]);
  });
});

// The per-stop SELF-transfer: a disc of a chosen transfer style painted around
// the stop dot, created and cleared ONLY here (the two-click flow refuses a
// zero-length transfer, and a tiny one on canvas is easy to lose).
describe('<StopRows /> — transfer picker', () => {
  const xferCombo = (service: string) => `Transfer (line ${service})`;

  const seedWithStyles = () => {
    seed({ a: hub({ stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' }] }) });
    useDoc.setState({
      styles: {
        ...useDoc.getState().styles,
        'y-fat': makeStyle('transfer', 'y-fat', { name: 'Fat', props: { thickness: 12 } }),
      },
    });
  };

  const selfTransfer = () => selfTransferAt(useDoc.getState(), 'a', 'L1');

  it('starts at None with nothing on the stop', () => {
    seedWithStyles();
    renderRows();
    expect(screen.getByRole('combobox', { name: xferCombo('1') })).toBeTruthy();
    expect(selfTransfer()).toBeUndefined();
  });

  it('picking a style wraps the stop dot in that transfer', async () => {
    seedWithStyles();
    const user = userEvent.setup();
    renderRows();
    await chooseOption(user, xferCombo('1'), 'Fat');
    expect(selfTransfer()?.styleId).toBe('y-fat');
    expect(resolveTransferStyle(selfTransfer()!).thickness).toBe(12);
  });

  it('picking None takes it away again', async () => {
    seedWithStyles();
    const user = userEvent.setup();
    renderRows();
    await chooseOption(user, xferCombo('1'), 'Fat');
    await chooseOption(user, xferCombo('1'), 'None');
    expect(selfTransfer()).toBeUndefined();
    expect(useDoc.getState().transfers).toEqual({});
  });

  it('offers None plus every transfer style, and marks a hand-tuned one Custom', async () => {
    seedWithStyles();
    const user = userEvent.setup();
    renderRows();
    await user.click(screen.getByRole('combobox', { name: xferCombo('1') }));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'None',
      'Default',
      'Fat',
    ]);
    await user.click(screen.getByRole('option', { name: 'Fat' }));
    // Editing the transfer itself detaches it from the preset (updateTransferStyle's
    // contract) — the picker has to admit that rather than keep claiming "Fat".
    useDoc.getState().updateTransferStyle(selfTransfer()!.id, { thickness: 9 });
    expect(selfTransfer()!.styleId).toBeUndefined();
    await user.click(screen.getByRole('combobox', { name: xferCombo('1') }));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'None',
      'Custom',
      'Default',
      'Fat',
    ]);
  });

  it('does NOT mirror to matching stations — a self transfer is one station’s business', async () => {
    // A LIVE match: `z` renders identically to `a` and shares L1 with it, which
    // is the whole of what findMatchingStations asks. The dot-type pick below
    // proves the fan-out really is armed — without that, "z got nothing" would
    // pass just as well against a match that never existed.
    seedWithStyles();
    const oneStop = [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' as const }];
    useDoc.setState({
      stations: {
        a: hub({ stops: oneStop }),
        z: hub({ id: 'z', x: 500, stops: oneStop }),
      },
      lines: {
        ...useDoc.getState().lines,
        L1: makeLine({ id: 'L1', service: '1', color: '#c60c30', stations: ['a', 'z'] }),
      },
    });
    useSelection.setState({ mirrorMatching: true });
    const user = userEvent.setup();
    renderRows();

    await user.click(screen.getByRole('button', { name: 'Stop shape' }));
    await user.click(screen.getByRole('menuitem', { name: 'None' }));
    expect(useDoc.getState().stations.z.stops[0].dotStyleId).toBe('stop-none');

    await chooseOption(user, xferCombo('1'), 'Fat');
    expect(Object.keys(useDoc.getState().transfers)).toHaveLength(1);
    expect(selfTransferAt(useDoc.getState(), 'z', 'L1')).toBeUndefined();
  });

  it('each pick is one undo step', async () => {
    seedWithStyles();
    const user = userEvent.setup();
    renderRows();
    const before = historyDepth();
    await chooseOption(user, xferCombo('1'), 'Fat');
    expect(historyDepth()).toBe(before + 1);
  });
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

  // The inspector greys itself out for a locked station via a `disabled`
  // fieldset — but browsers still deliver wheel events to disabled inputs, and
  // the size box's native listener is bound outside React. Same rule the dash
  // case above states: if the box can't be typed into, it can't be scrolled
  // either. Lock is a guarantee.
  it('a wheel over a LOCKED station’s size input writes nothing', () => {
    seed({ a: hub({ locked: true }) });
    renderRows();
    fireEvent.wheel(screen.getAllByRole('spinbutton', { name: 'Stop dot size' })[0], {
      deltaY: -1,
    });
    const stop = useDoc.getState().stations.a.stops.find((s) => s.lineId === 'L1')!;
    expect('dotSize' in stop).toBe(false);
  });

  it('a wheel over an UNLOCKED station’s size input still writes', () => {
    seed({ a: hub() });
    renderRows();
    fireEvent.wheel(screen.getAllByRole('spinbutton', { name: 'Stop dot size' })[0], {
      deltaY: -1,
    });
    const stop = useDoc.getState().stations.a.stops.find((s) => s.lineId === 'L1')!;
    expect(stop.dotSize).toBeCloseTo(DOT_SIZE_DEFAULT + DOT_SIZE_STEP, 9);
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

  // Where a line ENDS is geometric, so these seeds carry real neighbours at
  // real coordinates: `a` sits at the origin and the line runs south from it.
  const southOf = (id: string, x: number, y: number): Station => ({
    id,
    name: id,
    x,
    y,
    rotation: 0,
    stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' }],
    label: { row: 0, col: -1, rotation: 0, offset: 0, align: 'auto', valign: 'middle' },
  });

  // a—b for L1 (so `a` is an end); L2 runs a—b—c, so `b` is interior for it.
  const chain = () => {
    seed({
      a: hub({ stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' }] }),
      b: southOf('b', 0, 300),
    });
    useDoc.setState({
      lines: {
        ...useDoc.getState().lines,
        L1: makeLine({ id: 'L1', service: '1', color: '#c60c30', stations: ['a', 'b'] }),
      },
    });
  };

  // The same line BRANCHING at `a`: both edges leave it south down one
  // corridor, `d` peeling off south-east. Degree 2, still where the ink stops.
  const branchedAtA = () => {
    seed({
      a: hub({ stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' }] }),
      b: southOf('b', 0, 600),
      d: {
        ...southOf('d', 200, 400),
        stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-nw-se' }],
      },
    });
    useDoc.setState({
      lines: {
        ...useDoc.getState().lines,
        L1: makeLine({
          id: 'L1',
          service: '1',
          color: '#c60c30',
          stations: ['a', 'b', 'd'],
          edges: ['a|b', 'a|d'],
        }),
      },
    });
  };

  it('offers the end control at a terminus', () => {
    chain();
    renderRows();
    const combo = screen.getByRole('combobox', { name: endCombo('1') });
    expect(combo).toBeTruthy();
    expect(combo).not.toHaveProperty('disabled', true);
  });

  it('offers it where the line BRANCHES at that end, degree 2 and all', () => {
    branchedAtA();
    renderRows();
    expect(screen.getByRole('combobox', { name: endCombo('1') })).toBeTruthy();
  });

  it('greys it out at an interior stop rather than vanishing', () => {
    // An empty slot read as a rendering glitch; a disabled control says "an
    // end style is a thing here, just not at THIS stop" — and the columns
    // stay put either way.
    seed({ a: hub({ stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' }] }) });
    useDoc.setState({
      lines: {
        ...useDoc.getState().lines,
        L1: makeLine({ id: 'L1', service: '1', color: '#c60c30', stations: ['x', 'a', 'b'] }),
      },
    });
    const { container } = renderRows();
    const combo = screen.getByRole('combobox', { name: endCombo('1') });
    expect(combo).toHaveProperty('disabled', true);
    // …and it can still SAY why. The explanation has to hang off the enabled
    // wrapper: a disabled button gets no hover events, so a title on the
    // trigger itself would never surface.
    expect(combo.getAttribute('title')).toBeNull();
    expect(container.querySelector('.end-style-slot')?.getAttribute('title')).toContain(
      'end of the line',
    );
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
    // a look, so it stays put — pinned deliberately. `b` renders identically to
    // `a` and shares L1, so the fan-out really is armed; the dot-type pick
    // proves it before the end pick asserts the negative.
    seed(
      {
        a: hub({ stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' }] }),
        b: southOf('b', 0, 300),
      },
      { mirrorMatching: true },
    );
    useDoc.setState({
      lines: {
        ...useDoc.getState().lines,
        L1: makeLine({ id: 'L1', service: '1', color: '#c60c30', stations: ['a', 'b'] }),
      },
    });
    const user = userEvent.setup();
    renderRows();

    await user.click(screen.getByRole('button', { name: 'Stop shape' }));
    await user.click(screen.getByRole('menuitem', { name: 'None' }));
    expect(useDoc.getState().stations.b.stops[0].dotStyleId).toBe('stop-none');

    await chooseOption(user, endCombo('1'), 'Short');
    expect(useDoc.getState().lines.L1.stationEndStyles).toEqual({ a: 'short' });
  });
});
