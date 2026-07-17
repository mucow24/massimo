import { describe, it, expect, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StationInspector } from './StationInspector';
import { StationPopover } from '../StationPopover';
import { useDoc, useSelection } from '../../state/store';
import { historyDepth, undo } from '../../state/history';
import { DEFAULT_DOC, resolveOffsetPerp } from '../../model/transforms';
import { DOT_SHAPE_PRESETS } from '../../model/dotStyle';
import { makeDoc, makeStation, makeStop, makeLine, makeStyle } from '../../test/fixtures';
import { chooseOption, stepSlider } from '../../test/interaction';

const SELECTION_BLANK = {
  selectedStationIds: [] as string[],
  selectedRouteBulletIds: [] as string[],
  selectedLineId: null,
  appendingToLineId: null,
  insertAfterIndex: null,
  placingStation: false,
  selectedLineTagId: null,
  selectedTransferId: null,
  creatingLineTag: false,
  creatingRouteBullet: false,
  creatingTransfer: false,
  transferAnchor: null,
  mirrorMatching: false,
  selectedStopLineId: null,
  labelSelected: false,
  editingStationId: null,
};

describe('<StationInspector /> — shape picker wiring', () => {
  beforeEach(() => {
    localStorage.clear();
    useDoc.setState({ ...DEFAULT_DOC });
    useSelection.setState(SELECTION_BLANK);
  });

  it('renders one ALWAYS-enabled picker per stop row — no selection ritual', () => {
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [
          makeStation({
            id: 'a',
            stops: [makeStop('L1'), makeStop('L2', { col: 1 })],
          }),
        ],
        lines: [makeLine({ id: 'L1', stations: ['a'] }), makeLine({ id: 'L2', stations: ['a'] })],
      }),
    });
    useSelection.setState({ ...SELECTION_BLANK, selectedStationIds: ['a'] });

    render(<StationInspector id="a" />);
    const pickers = screen.getAllByRole('button', { name: 'Stop shape' });
    expect(pickers).toHaveLength(2);
    for (const p of pickers) expect(p).toHaveAttribute('aria-disabled', 'false');
  });

  it('clicking the picker trigger does not deselect the stop (picker stays enabled)', async () => {
    const user = userEvent.setup();
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [makeStation({ id: 'a', stops: [makeStop('L1')] })],
        lines: [makeLine({ id: 'L1', stations: ['a'] })],
      }),
    });
    useSelection.setState({ ...SELECTION_BLANK, selectedStationIds: ['a'] });

    render(<StationInspector id="a" />);
    act(() => useSelection.getState().setSelectedStopLineId('L1'));
    expect(useSelection.getState().selectedStopLineId).toBe('L1');

    await user.click(screen.getByRole('button', { name: 'Stop shape' }));

    expect(useSelection.getState().selectedStopLineId).toBe('L1');
    expect(screen.getByRole('button', { name: 'Stop shape' })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it("trigger reflects the selected stop's explicit dotStyle", async () => {
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [
          makeStation({
            id: 'a',
            stops: [makeStop('L1', { dotStyle: DOT_SHAPE_PRESETS['filled-white'] })],
          }),
        ],
        lines: [makeLine({ id: 'L1', stations: ['a'] })],
      }),
    });
    useSelection.setState({ ...SELECTION_BLANK, selectedStationIds: ['a'] });

    render(<StationInspector id="a" />);
    act(() => useSelection.getState().setSelectedStopLineId('L1'));

    const trigger = screen.getByRole('button', { name: 'Stop shape' });
    const circle = trigger.querySelector('circle');
    expect(circle).not.toBeNull();
    expect(circle?.getAttribute('fill')).toBe('#ffffff');
  });

  it('trigger shows the filled-black default when the selected stop has no dotStyle set', async () => {
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [makeStation({ id: 'a', stops: [makeStop('L1')] })],
        lines: [makeLine({ id: 'L1', stations: ['a'] })],
      }),
    });
    useSelection.setState({ ...SELECTION_BLANK, selectedStationIds: ['a'] });

    render(<StationInspector id="a" />);
    act(() => useSelection.getState().setSelectedStopLineId('L1'));

    const trigger = screen.getByRole('button', { name: 'Stop shape' });
    const circle = trigger.querySelector('circle');
    expect(circle).not.toBeNull();
    expect(circle?.getAttribute('fill')).toBe('#000000');
  });

  it('with mirror on and matching neighbors disagreeing, trigger still reflects the inspected station', async () => {
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [
          makeStation({
            id: 'a',
            stops: [makeStop('L1', { dotStyle: DOT_SHAPE_PRESETS['filled-white'] })],
          }),
          makeStation({
            id: 'b',
            stops: [makeStop('L1', { dotStyle: DOT_SHAPE_PRESETS['filled-black'] })],
          }),
        ],
        lines: [makeLine({ id: 'L1', stations: ['a', 'b'] })],
      }),
    });
    useSelection.setState({
      ...SELECTION_BLANK,
      selectedStationIds: ['a'],
      mirrorMatching: true,
    });

    render(<StationInspector id="a" />);
    act(() => useSelection.getState().setSelectedStopLineId('L1'));

    const trigger = screen.getByRole('button', { name: 'Stop shape' });
    const circle = trigger.querySelector('circle');
    expect(circle).not.toBeNull();
    expect(circle?.getAttribute('fill')).toBe('#ffffff');
  });

  it('Waypoint button toggles aria-pressed and writes isWaypoint on the station', async () => {
    const user = userEvent.setup();
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [makeStation({ id: 'a', stops: [makeStop('L1')] })],
        lines: [makeLine({ id: 'L1', stations: ['a'] })],
      }),
    });
    useSelection.setState({ ...SELECTION_BLANK, selectedStationIds: ['a'] });

    render(<StationInspector id="a" />);
    const wpBtn = screen.getByRole('button', { name: 'Waypoint' });
    expect(wpBtn).toHaveAttribute('aria-pressed', 'false');
    expect(wpBtn).not.toHaveClass('active');

    await user.click(wpBtn);
    expect(useDoc.getState().stations.a.isWaypoint).toBe(true);
    const wpBtnOn = screen.getByRole('button', { name: 'Waypoint' });
    expect(wpBtnOn).toHaveAttribute('aria-pressed', 'true');
    expect(wpBtnOn).toHaveClass('active');

    await user.click(screen.getByRole('button', { name: 'Waypoint' }));
    const wpBtnOff = screen.getByRole('button', { name: 'Waypoint' });
    expect(useDoc.getState().stations.a.isWaypoint).toBe(false);
    expect(wpBtnOff).toHaveAttribute('aria-pressed', 'false');
    expect(wpBtnOff).not.toHaveClass('active');
  });

  it('Lock toggles aria-pressed and writes locked (in the popover footer)', async () => {
    // The lock toggle lives in the StationPopover footer now (beside Delete,
    // like every other item popover) — render the popover, which hosts the
    // inspector plus that footer.
    const user = userEvent.setup();
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [makeStation({ id: 'a', stops: [makeStop('L1')] })],
        lines: [makeLine({ id: 'L1', stations: ['a'] })],
      }),
    });
    useSelection.setState({ ...SELECTION_BLANK, selectedStationIds: ['a'] });

    function LivePopover() {
      const station = useDoc((s) => s.stations.a);
      return station ? (
        <StationPopover
          station={station}
          worldRect={{ x0: 0, y0: 0, x1: 0, y1: 0 }}
          view={{ vbX: 0, vbY: 0, vbW: 800, vbH: 600, size: { w: 800, h: 600 } }}
          onClose={() => {}}
        />
      ) : null;
    }
    render(<LivePopover />);
    const lockBtn = screen.getByRole('button', { name: 'Lock station' });
    expect(lockBtn).toHaveAttribute('aria-pressed', 'false');

    await user.click(lockBtn);
    expect(useDoc.getState().stations.a.locked).toBe(true);
    // The label flips to the unlock affordance once locked, and the
    // inspector's editing controls grey out behind the disabled fieldset.
    const lockBtnOn = screen.getByRole('button', { name: 'Unlock station' });
    expect(lockBtnOn).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Waypoint' })).toBeDisabled();
    expect(screen.getByRole('slider', { name: 'Size' })).toHaveAttribute('data-disabled');

    await user.click(screen.getByRole('button', { name: 'Unlock station' }));
    expect(useDoc.getState().stations.a.locked).toBeFalsy();
    expect(screen.getByRole('button', { name: 'Lock station' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: 'Waypoint' })).toBeEnabled();
  });

  describe('Text style section', () => {
    const setup = (station = makeStation({ id: 'a' })) => {
      useDoc.setState({ ...DEFAULT_DOC, ...makeDoc({ stations: [station] }) });
      useSelection.setState({ ...SELECTION_BLANK, selectedStationIds: ['a'] });
      render(<StationInspector id="a" />);
    };

    it('renders the style picker and the typography controls', () => {
      setup();
      expect(screen.getByRole('combobox', { name: 'Style' })).toBeInTheDocument();
      expect(screen.getByRole('slider', { name: /size/i })).toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: /weight/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Italic' })).toBeInTheDocument();
      expect(screen.getByRole('slider', { name: /leading/i })).toBeInTheDocument();
      expect(screen.getByRole('slider', { name: /tracking/i })).toBeInTheDocument();
    });

    it('the Size slider writes per-station fontSize', () => {
      setup();
      // One arrow-key step of the 0.25 grid up from the 12 default.
      stepSlider(screen.getByRole('slider', { name: /size/i }), 1);
      expect(useDoc.getState().stations.a.fontSize).toBe(12.25);
    });

    it('the Weight dropdown writes per-station weight', async () => {
      const user = userEvent.setup();
      setup();
      await chooseOption(user, /weight/i, 'Bold');
      expect(useDoc.getState().stations.a.weight).toBe(700);
    });

    it('the Italic button toggles per-station italic', async () => {
      const user = userEvent.setup();
      setup();
      await user.click(screen.getByRole('button', { name: 'Italic' }));
      expect(useDoc.getState().stations.a.italic).toBe(true);
      await user.click(screen.getByRole('button', { name: 'Italic' }));
      expect(useDoc.getState().stations.a.italic).toBeFalsy();
    });

    it('editing a covered typography field detaches the style tag', () => {
      // A default-looking station tagged to a matching style (tagged ⇒ matches).
      useDoc.setState({
        ...DEFAULT_DOC,
        ...makeDoc({
          stations: [{ ...makeStation({ id: 'a' }), styleId: 'y1' }],
          styles: [makeStyle('station', 'y1', { name: 'Big' })],
        }),
      });
      useSelection.setState({ ...SELECTION_BLANK, selectedStationIds: ['a'] });
      render(<StationInspector id="a" />);
      expect(screen.getByRole('combobox', { name: 'Style' })).toHaveTextContent('Big');
      stepSlider(screen.getByRole('slider', { name: /size/i }), 1);
      expect(useDoc.getState().stations.a.styleId).toBeUndefined();
    });

    it('typography edits do NOT mirror-propagate to matching stations (pinned decision)', async () => {
      // Even with mirror matching on, typography stays local to the inspected
      // station — the style picker is how you share it.
      const user = userEvent.setup();
      useDoc.setState({
        ...DEFAULT_DOC,
        ...makeDoc({
          stations: [
            makeStation({ id: 'a', stops: [makeStop('L1')] }),
            makeStation({ id: 'b', stops: [makeStop('L1')] }),
          ],
          lines: [makeLine({ id: 'L1', stations: ['a', 'b'] })],
        }),
      });
      useSelection.setState({
        ...SELECTION_BLANK,
        selectedStationIds: ['a'],
        mirrorMatching: true,
      });

      render(<StationInspector id="a" />);
      await user.click(screen.getByRole('button', { name: 'Italic' }));

      const doc = useDoc.getState();
      expect(doc.stations.a.italic).toBe(true);
      expect(doc.stations.b.italic).toBeFalsy();
    });
  });

  it('Waypoint button starts pressed when the station is already a waypoint', () => {
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [makeStation({ id: 'a', isWaypoint: true, stops: [makeStop('L1')] })],
        lines: [makeLine({ id: 'L1', stations: ['a'] })],
      }),
    });
    useSelection.setState({ ...SELECTION_BLANK, selectedStationIds: ['a'] });

    render(<StationInspector id="a" />);
    const wpBtn = screen.getByRole('button', { name: 'Waypoint' });
    expect(wpBtn).toHaveAttribute('aria-pressed', 'true');
    expect(wpBtn).toHaveClass('active');
  });

  it('Waypoint toggle does NOT mirror-propagate to matching stations', async () => {
    const user = userEvent.setup();
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [
          makeStation({ id: 'a', stops: [makeStop('L1')] }),
          makeStation({ id: 'b', stops: [makeStop('L1')] }),
        ],
        lines: [makeLine({ id: 'L1', stations: ['a', 'b'] })],
      }),
    });
    useSelection.setState({
      ...SELECTION_BLANK,
      selectedStationIds: ['a'],
      mirrorMatching: true,
    });

    render(<StationInspector id="a" />);
    await user.click(screen.getByRole('button', { name: 'Waypoint' }));

    const doc = useDoc.getState();
    expect(doc.stations.a.isWaypoint).toBe(true);
    expect(doc.stations.b.isWaypoint).toBeFalsy();
  });

  it('mirror mode propagates the per-stop shape change to matching stations and collapses to one undo step', async () => {
    const user = userEvent.setup();
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [
          makeStation({ id: 'a', stops: [makeStop('L1')] }),
          makeStation({ id: 'b', stops: [makeStop('L1')] }),
        ],
        lines: [makeLine({ id: 'L1', stations: ['a', 'b'] })],
      }),
    });
    useSelection.setState({
      ...SELECTION_BLANK,
      selectedStationIds: ['a'],
      mirrorMatching: true,
    });

    const pastBefore = historyDepth();

    render(<StationInspector id="a" />);
    act(() => useSelection.getState().setSelectedStopLineId('L1'));
    await user.click(screen.getByRole('button', { name: 'Stop shape' }));
    await user.click(screen.getByRole('menuitem', { name: 'Open white' }));

    const doc = useDoc.getState();
    expect(doc.stations.a.stops[0].dotStyle).toEqual(DOT_SHAPE_PRESETS['open-white']);
    expect(doc.stations.b.stops[0].dotStyle).toEqual(DOT_SHAPE_PRESETS['open-white']);

    const pastAfter = historyDepth();
    expect(pastAfter - pastBefore).toBe(1);
  });
});

describe('<StationInspector /> — stop dot size textbox', () => {
  beforeEach(() => {
    localStorage.clear();
    useDoc.setState({ ...DEFAULT_DOC });
    useSelection.setState(SELECTION_BLANK);
    useDoc.temporal.getState().clear();
  });

  const seed = (over: { stopDotSize?: number; lineDefaultDotSize?: number } = {}) => {
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [
          makeStation({
            id: 'a',
            stops: [
              makeStop('L1', over.stopDotSize !== undefined ? { dotSize: over.stopDotSize } : {}),
            ],
          }),
        ],
        lines: [
          makeLine({
            id: 'L1',
            stations: ['a'],
            // Station 'a' is a singleton (one stop), so the size its stop row
            // resolves is the line's SINGLETON default.
            ...(over.lineDefaultDotSize !== undefined
              ? { singletonDotSize: over.lineDefaultDotSize }
              : {}),
          }),
        ],
      }),
    });
    useSelection.setState({ ...SELECTION_BLANK, selectedStationIds: ['a'] });
  };

  const sizeBox = () => screen.getByRole('spinbutton', { name: 'Stop dot size' });

  // Selection comes from the canvas layout editor; set it directly.
  const selectStop = () => act(() => useSelection.getState().setSelectedStopLineId('L1'));

  it('is always enabled (per-row control), showing the resolved default', () => {
    seed();
    render(<StationInspector id="a" />);
    expect(sizeBox()).toBeEnabled();
    expect(sizeBox()).toHaveValue(8);
  });

  it("shows the selected stop's resolved size: explicit override first, then the line default", async () => {
    seed({ stopDotSize: 16, lineDefaultDotSize: 10 });
    render(<StationInspector id="a" />);
    selectStop();
    expect(sizeBox()).toHaveValue(16);
  });

  it('falls back to the line default for a tracking stop', async () => {
    seed({ lineDefaultDotSize: 10 });
    render(<StationInspector id="a" />);
    selectStop();
    expect(sizeBox()).toHaveValue(10);
  });

  it('editing writes the override; typing the effective default clears it', async () => {
    seed();
    render(<StationInspector id="a" />);
    selectStop();

    fireEvent.change(sizeBox(), { target: { value: '12' } });
    expect(useDoc.getState().stations.a.stops[0].dotSize).toBe(12);

    fireEvent.change(sizeBox(), { target: { value: '8' } });
    expect('dotSize' in useDoc.getState().stations.a.stops[0]).toBe(false);
  });

  it('clicking into the textbox does not deselect the stop', async () => {
    const user = userEvent.setup();
    seed();
    render(<StationInspector id="a" />);
    selectStop();
    expect(useSelection.getState().selectedStopLineId).toBe('L1');

    await user.click(sizeBox());

    expect(useSelection.getState().selectedStopLineId).toBe('L1');
    expect(sizeBox()).toBeEnabled();
  });

  it('mirror mode propagates the size to matching stations and collapses to one undo step', async () => {
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [
          makeStation({ id: 'a', stops: [makeStop('L1')] }),
          makeStation({ id: 'b', stops: [makeStop('L1')] }),
        ],
        lines: [makeLine({ id: 'L1', stations: ['a', 'b'] })],
      }),
    });
    useSelection.setState({
      ...SELECTION_BLANK,
      selectedStationIds: ['a'],
      mirrorMatching: true,
    });

    render(<StationInspector id="a" />);
    selectStop();

    const pastBefore = historyDepth();
    // Bare change (no focus arc) — dispatchAll's history group is the only
    // entry, matching the shape-picker mirror test.
    fireEvent.change(sizeBox(), { target: { value: '16' } });

    const doc = useDoc.getState();
    expect(doc.stations.a.stops[0].dotSize).toBe(16);
    expect(doc.stations.b.stops[0].dotSize).toBe(16);
    expect(historyDepth() - pastBefore).toBe(1);
  });

  it('a focused edit with mirror on collapses to exactly one undo entry', () => {
    // Regression (#146): focusing the field opens useFieldHistory's outer
    // group, and the mirror broadcast (dispatchMirrored, reached through the
    // per-stop row's size field) would nest a SECOND group inside it. The
    // isHistoryGrouping gate must keep the whole focus arc one undo entry.
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [
          makeStation({ id: 'a', stops: [makeStop('L1')] }),
          makeStation({ id: 'b', stops: [makeStop('L1')] }),
        ],
        lines: [makeLine({ id: 'L1', stations: ['a', 'b'] })],
      }),
    });
    useSelection.setState({
      ...SELECTION_BLANK,
      selectedStationIds: ['a'],
      mirrorMatching: true,
    });

    render(<StationInspector id="a" />);

    useDoc.temporal.getState().clear();
    const before = historyDepth();

    const box = sizeBox();
    fireEvent.focus(box); // opens useFieldHistory's outer group
    fireEvent.change(box, { target: { value: '9' } }); // mirror broadcast fires inside it
    fireEvent.blur(box); // commits the outer group

    const doc = useDoc.getState();
    expect(doc.stations.a.stops[0].dotSize).toBe(9);
    expect(doc.stations.b.stops[0].dotSize).toBe(9);
    expect(historyDepth() - before).toBe(1);
  });
});

describe('<StationInspector /> — edit paths that reach the document (E8)', () => {
  beforeEach(() => {
    localStorage.clear();
    useDoc.setState({ ...DEFAULT_DOC });
    useSelection.setState(SELECTION_BLANK);
    useDoc.temporal.getState().clear();
  });

  const seedStation = (over: Partial<ReturnType<typeof makeStation>> = {}) => {
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({ stations: [makeStation({ id: 'a', x: 10, y: 20, ...over })] }),
    });
    useSelection.setState({ ...SELECTION_BLANK, selectedStationIds: ['a'] });
  };

  it('the ⟳ button rotates +45° (one step) on the station', async () => {
    const user = userEvent.setup();
    seedStation();
    expect(useDoc.getState().stations.a.rotation).toBe(0);
    render(<StationInspector id="a" />);
    await user.click(screen.getByRole('button', { name: 'Rotate +45°' }));
    expect(useDoc.getState().stations.a.rotation).toBe(1);
  });

  it('the ⟲ button rotates −45° (0 wraps to 7) as ONE undo entry', async () => {
    const user = userEvent.setup();
    seedStation();
    render(<StationInspector id="a" />);
    const before = historyDepth();
    await user.click(screen.getByRole('button', { name: 'Rotate −45°' }));
    expect(useDoc.getState().stations.a.rotation).toBe(7);
    // One click = one entry: the old "seven +45° steps" implementation cost
    // seven Ctrl+Z presses (through six states the user never saw) to undo.
    expect(historyDepth() - before).toBe(1);
    undo();
    expect(useDoc.getState().stations.a.rotation).toBe(0);
  });

  it('the Name textarea writes through renameStation', () => {
    seedStation({ name: 'Old' });
    render(<StationInspector id="a" />);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'New Name' } });
    expect(useDoc.getState().stations.a.name).toBe('New Name');
  });

  it('the X and Y inputs are labeled and each move the station on their own axis', () => {
    seedStation();
    render(<StationInspector id="a" />);
    const xIn = screen.getByRole('spinbutton', { name: 'X' }) as HTMLInputElement;
    const yIn = screen.getByRole('spinbutton', { name: 'Y' }) as HTMLInputElement;
    // X input writes x, leaves y.
    fireEvent.change(xIn, { target: { value: '55' } });
    expect(useDoc.getState().stations.a.x).toBe(55);
    expect(useDoc.getState().stations.a.y).toBe(20);
    // Y input writes y, leaves x.
    fireEvent.change(yIn, { target: { value: '77' } });
    expect(useDoc.getState().stations.a.y).toBe(77);
    expect(useDoc.getState().stations.a.x).toBe(55);
  });

  it('ignores an emptied X/Y input mid-edit instead of teleporting the station to 0', () => {
    seedStation();
    render(<StationInspector id="a" />);
    // Number('') === 0, so an unguarded handler would move the station to the
    // axis the moment the user clears the field to type a new value.
    fireEvent.change(screen.getByRole('spinbutton', { name: 'X' }), { target: { value: '' } });
    expect(useDoc.getState().stations.a.x).toBe(10);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Y' }), { target: { value: '' } });
    expect(useDoc.getState().stations.a.y).toBe(20);
  });

  it('shows no rotation-degrees readout and no Mirror button', () => {
    seedStation();
    render(<StationInspector id="a" />);
    expect(screen.queryByTitle('Station rotation')).toBeNull();
    expect(screen.queryByRole('button', { name: /Mirror/ })).toBeNull();
  });

  it('WP sits in the top header row next to the Name label (Lock moved to the footer)', () => {
    seedStation();
    render(<StationInspector id="a" />);
    const wp = screen.getByRole('button', { name: 'Waypoint' });
    const nameLabel = screen.getByText('Name');
    expect(wp.parentElement).toBe(nameLabel.parentElement);
    // The lock toggle is the StationPopover footer's, not the inspector's.
    expect(screen.queryByRole('button', { name: 'Lock station' })).toBeNull();
  });

  it('clicking the align button cycles label.align one step (auto → left) as one undo entry', async () => {
    const user = userEvent.setup();
    seedStation();
    expect(useDoc.getState().stations.a.label.align).toBe('auto');
    useDoc.temporal.getState().clear();
    const before = historyDepth();
    render(<StationInspector id="a" />);
    await user.click(
      screen.getByRole('button', { name: 'Align: auto (snap against adjacent stop)' }),
    );
    expect(useDoc.getState().stations.a.label.align).toBe('start');
    expect(historyDepth() - before).toBe(1);
    // The button re-labels to the new state and keeps cycling from there.
    await user.click(screen.getByRole('button', { name: 'Align: left' }));
    expect(useDoc.getState().stations.a.label.align).toBe('middle');
  });

  it('the align cycle wraps from the last state back to the first (right → auto)', async () => {
    const user = userEvent.setup();
    seedStation();
    useDoc.getState().setLabelAlign('a', 'end');
    render(<StationInspector id="a" />);
    await user.click(screen.getByRole('button', { name: 'Align: right' }));
    expect(useDoc.getState().stations.a.label.align).toBe('auto');
  });

  it('clicking the valign button cycles label.valign one step (auto-down → top)', async () => {
    const user = userEvent.setup();
    seedStation();
    expect(useDoc.getState().stations.a.label.valign).toBe('auto-down');
    render(<StationInspector id="a" />);
    await user.click(
      screen.getByRole('button', {
        name: 'V-align: auto-down (first line on cell, extra lines below)',
      }),
    );
    expect(useDoc.getState().stations.a.label.valign).toBe('top');
  });

  it('align cycle with mirror on broadcasts the SAME align to matching stations in one undo group', async () => {
    const user = userEvent.setup();
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [
          makeStation({ id: 'a', stops: [makeStop('L1')] }),
          makeStation({ id: 'b', stops: [makeStop('L1')] }),
        ],
        lines: [makeLine({ id: 'L1', stations: ['a', 'b'] })],
      }),
    });
    useSelection.setState({
      ...SELECTION_BLANK,
      selectedStationIds: ['a'],
      mirrorMatching: true,
    });
    useDoc.temporal.getState().clear();
    const before = historyDepth();

    render(<StationInspector id="a" />);
    await user.click(
      screen.getByRole('button', { name: 'Align: auto (snap against adjacent stop)' }),
    );

    const doc = useDoc.getState();
    expect(doc.stations.a.label.align).toBe('start');
    // The matching neighbor gets the SAME absolute value — the cycle computes
    // the next state once, then broadcasts it, so matches cannot diverge.
    expect(doc.stations.b.label.align).toBe('start');
    // The whole batch collapses to a single undo entry.
    expect(historyDepth() - before).toBe(1);
  });

  it('the Auto placement toggle writes label.autoAlign as one undo entry and disables the cycles', async () => {
    const user = userEvent.setup();
    seedStation();
    useDoc.temporal.getState().clear();
    const before = historyDepth();
    render(<StationInspector id="a" />);

    const alignBtn = screen.getByRole('button', {
      name: 'Align: auto (snap against adjacent stop)',
    });
    const valignBtn = screen.getByRole('button', {
      name: 'V-align: auto-down (first line on cell, extra lines below)',
    });
    const toggle = screen.getByRole('button', { name: 'Auto placement' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(alignBtn).toBeEnabled();

    await user.click(toggle);
    expect(useDoc.getState().stations.a.label.autoAlign).toBe(true);
    expect(historyDepth() - before).toBe(1);
    expect(screen.getByRole('button', { name: 'Auto placement' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // The overridden align/valign cycles disable while the toggle is on.
    expect(alignBtn).toBeDisabled();
    expect(valignBtn).toBeDisabled();

    // Toggling off removes the key entirely (omitted-when-false).
    await user.click(screen.getByRole('button', { name: 'Auto placement' }));
    expect('autoAlign' in useDoc.getState().stations.a.label).toBe(false);
    expect(alignBtn).toBeEnabled();
  });

  it('Auto placement with mirror on broadcasts the same value in one undo group', async () => {
    const user = userEvent.setup();
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [
          makeStation({ id: 'a', stops: [makeStop('L1')] }),
          makeStation({ id: 'b', stops: [makeStop('L1')] }),
        ],
        lines: [makeLine({ id: 'L1', stations: ['a', 'b'] })],
      }),
    });
    useSelection.setState({
      ...SELECTION_BLANK,
      selectedStationIds: ['a'],
      mirrorMatching: true,
    });
    useDoc.temporal.getState().clear();
    const before = historyDepth();

    render(<StationInspector id="a" />);
    await user.click(screen.getByRole('button', { name: 'Auto placement' }));

    const doc = useDoc.getState();
    expect(doc.stations.a.label.autoAlign).toBe(true);
    expect(doc.stations.b.label.autoAlign).toBe(true);
    expect(historyDepth() - before).toBe(1);
  });

  it('the H/V tuning cycles are enabled only with Auto placement on and write the overrides', async () => {
    const user = userEvent.setup();
    seedStation();
    render(<StationInspector id="a" />);

    const h = screen.getByRole('button', { name: 'Auto align H: auto (from position)' });
    const v = screen.getByRole('button', { name: 'Auto align V: auto (line nearest the station)' });
    expect(h).toBeDisabled();
    expect(v).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Auto placement' }));
    expect(h).toBeEnabled();
    expect(v).toBeEnabled();

    useDoc.temporal.getState().clear();
    const before = historyDepth();
    await user.click(h);
    expect(useDoc.getState().stations.a.label.autoHAlign).toBe('start');
    expect(historyDepth() - before).toBe(1);
    // Re-labels to the new state and keeps cycling from there.
    await user.click(screen.getByRole('button', { name: 'Auto align H: left' }));
    expect(useDoc.getState().stations.a.label.autoHAlign).toBe('middle');

    await user.click(v);
    expect(useDoc.getState().stations.a.label.autoVAlign).toBe('up');
    await user.click(
      screen.getByRole('button', {
        name: 'Auto align V: up (bottom line anchors, lines stack up)',
      }),
    );
    expect(useDoc.getState().stations.a.label.autoVAlign).toBe('down');
    // Wrapping back around to auto removes the key entirely.
    await user.click(
      screen.getByRole('button', {
        name: 'Auto align V: down (top line anchors, lines stack down)',
      }),
    );
    expect('autoVAlign' in useDoc.getState().stations.a.label).toBe(false);
  });

  it('the H tuning cycle broadcasts the same absolute value with mirror on', async () => {
    const user = userEvent.setup();
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [
          makeStation({ id: 'a', stops: [makeStop('L1')] }),
          makeStation({ id: 'b', stops: [makeStop('L1')] }),
        ],
        lines: [makeLine({ id: 'L1', stations: ['a', 'b'] })],
      }),
    });
    useDoc.getState().setLabelAutoAlign('a', true);
    useDoc.getState().setLabelAutoAlign('b', true);
    useSelection.setState({
      ...SELECTION_BLANK,
      selectedStationIds: ['a'],
      mirrorMatching: true,
    });
    useDoc.temporal.getState().clear();
    const before = historyDepth();

    render(<StationInspector id="a" />);
    await user.click(screen.getByRole('button', { name: 'Auto align H: auto (from position)' }));

    const doc = useDoc.getState();
    expect(doc.stations.a.label.autoHAlign).toBe('start');
    expect(doc.stations.b.label.autoHAlign).toBe('start');
    expect(historyDepth() - before).toBe(1);
  });
});

describe('<StationInspector /> — label offset wiring (along vs perpendicular)', () => {
  beforeEach(() => {
    localStorage.clear();
    useDoc.setState({ ...DEFAULT_DOC });
    useSelection.setState(SELECTION_BLANK);
  });

  const seedStation = () => {
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({ stations: [makeStation({ id: 'a' })] }),
    });
    useSelection.setState({ ...SELECTION_BLANK, selectedStationIds: ['a'] });
  };

  // The two LabelOffsetControls are identical markup distinguished only by their
  // preceding field-hint text. Find the number input belonging to the control
  // that follows a given hint.
  const offsetNumberInput = (hint: string): HTMLInputElement => {
    const hintEl = screen.getByText(hint);
    const control = hintEl.nextElementSibling as HTMLElement;
    const input = control.querySelector('input[type="number"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    return input;
  };

  it('the "along" control writes label.offset and leaves offsetPerp untouched', () => {
    seedStation();
    render(<StationInspector id="a" />);

    const along = offsetNumberInput('Offset (along reading direction)');
    fireEvent.change(along, { target: { value: '7' } });

    const label = useDoc.getState().stations.a.label;
    expect(label.offset).toBe(7);
    // The perpendicular offset is unchanged (defaults to 0 via resolveOffsetPerp).
    expect(resolveOffsetPerp(label)).toBe(0);
  });

  it('the "perpendicular" control writes offsetPerp and leaves label.offset untouched', () => {
    seedStation();
    render(<StationInspector id="a" />);

    const perp = offsetNumberInput('Offset (perpendicular to reading direction)');
    fireEvent.change(perp, { target: { value: '9' } });

    const label = useDoc.getState().stations.a.label;
    expect(resolveOffsetPerp(label)).toBe(9);
    expect(label.offset).toBe(0);
  });
});

describe('<StationInspector /> — Edit layout entry', () => {
  beforeEach(() => {
    localStorage.clear();
    useDoc.setState({ ...DEFAULT_DOC });
    useSelection.setState({ ...SELECTION_BLANK, uiMode: { kind: 'idle' } });
  });

  const seedStation = () => {
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [makeStation({ id: 'a', stops: [makeStop('L1')] })],
        lines: [makeLine({ id: 'L1', stations: ['a'] })],
      }),
    });
    useSelection.setState({
      ...SELECTION_BLANK,
      uiMode: { kind: 'idle' },
      selectedStationIds: ['a'],
    });
  };

  it('the Edit layout button enters editing-station-layout for this station', async () => {
    const user = userEvent.setup();
    seedStation();
    render(<StationInspector id="a" />);
    await user.click(screen.getByRole('button', { name: 'Edit layout' }));
    expect(useSelection.getState().uiMode).toEqual({
      kind: 'editing-station-layout',
      stationId: 'a',
    });
    expect(useSelection.getState().selectedStationIds).toEqual(['a']);
  });

  it('while the mode is active the button reads Done and exits to idle', async () => {
    const user = userEvent.setup();
    seedStation();
    useSelection.setState({
      ...useSelection.getState(),
      uiMode: { kind: 'editing-station-layout', stationId: 'a' },
    });
    render(<StationInspector id="a" />);
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(useSelection.getState().uiMode.kind).toBe('idle');
  });
});

describe('<StationInspector /> — Select Similar (mirror matching) toggle', () => {
  beforeEach(() => {
    localStorage.clear();
    useDoc.setState({ ...DEFAULT_DOC });
    useSelection.setState(SELECTION_BLANK);
    useDoc.temporal.getState().clear();
  });

  // a and b: identical single-L1-stop layouts on one line — exactly one match.
  const seedPair = (over: Partial<typeof SELECTION_BLANK> = {}) => {
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [
          makeStation({ id: 'a', stops: [makeStop('L1')] }),
          makeStation({ id: 'b', x: 200, stops: [makeStop('L1')] }),
        ],
        lines: [makeLine({ id: 'L1', stations: ['a', 'b'] })],
      }),
    });
    useSelection.setState({ ...SELECTION_BLANK, selectedStationIds: ['a'], ...over });
  };

  it('sits in the Name header row, to the left of the WP button', () => {
    seedPair();
    render(<StationInspector id="a" />);
    const similar = screen.getByRole('button', { name: 'Select Similar' });
    const wp = screen.getByRole('button', { name: 'Waypoint' });
    expect(similar.parentElement).toBe(wp.parentElement);
    const siblings = Array.from(wp.parentElement!.children);
    expect(siblings.indexOf(similar)).toBeLessThan(siblings.indexOf(wp));
  });

  it('toggles mirrorMatching on and off, reflected via aria-pressed + active class', async () => {
    const user = userEvent.setup();
    seedPair();
    render(<StationInspector id="a" />);
    const btn = () => screen.getByRole('button', { name: 'Select Similar' });
    expect(btn()).toHaveAttribute('aria-pressed', 'false');
    expect(btn()).not.toHaveClass('active');

    await user.click(btn());
    expect(useSelection.getState().mirrorMatching).toBe(true);
    expect(btn()).toHaveAttribute('aria-pressed', 'true');
    expect(btn()).toHaveClass('active');

    await user.click(btn());
    expect(useSelection.getState().mirrorMatching).toBe(false);
    expect(btn()).toHaveAttribute('aria-pressed', 'false');
  });

  it('advertises the match count in its title while off', () => {
    seedPair();
    render(<StationInspector id="a" />);
    expect(screen.getByRole('button', { name: 'Select Similar' })).toHaveAttribute(
      'title',
      expect.stringMatching(/\b1 station\b/),
    );
  });

  it('is disabled with an explanatory title when no station on the line matches', () => {
    // b shares the line but its stop sits one cell over — different layout.
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [
          makeStation({ id: 'a', stops: [makeStop('L1')] }),
          makeStation({ id: 'b', x: 200, stops: [makeStop('L1', { col: 1 })] }),
        ],
        lines: [makeLine({ id: 'L1', stations: ['a', 'b'] })],
      }),
    });
    useSelection.setState({ ...SELECTION_BLANK, selectedStationIds: ['a'] });
    render(<StationInspector id="a" />);
    const btn = screen.getByRole('button', { name: 'Select Similar' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', expect.stringMatching(/No other station/i));
  });

  it('stays clickable while ON with zero matches, so the mode can still be turned off', async () => {
    // Defensive corner: mirror somehow on with nothing matching (e.g. the
    // match dissolved via an unmirrored edit elsewhere). The button must not
    // trap the user in the mode.
    const user = userEvent.setup();
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [makeStation({ id: 'a', stops: [makeStop('L1')] })],
        lines: [makeLine({ id: 'L1', stations: ['a'] })],
      }),
    });
    useSelection.setState({ ...SELECTION_BLANK, selectedStationIds: ['a'], mirrorMatching: true });
    render(<StationInspector id="a" />);
    const btn = screen.getByRole('button', { name: 'Select Similar' });
    expect(btn).toBeEnabled();
    await user.click(btn);
    expect(useSelection.getState().mirrorMatching).toBe(false);
  });

  it('with mirror on, the rotate buttons rotate every matching station as ONE undo entry', async () => {
    const user = userEvent.setup();
    seedPair({ mirrorMatching: true });
    render(<StationInspector id="a" />);
    useDoc.temporal.getState().clear();
    const before = historyDepth();

    await user.click(screen.getByRole('button', { name: 'Rotate +45°' }));
    let doc = useDoc.getState();
    expect(doc.stations.a.rotation).toBe(1);
    expect(doc.stations.b.rotation).toBe(1);
    expect(historyDepth() - before).toBe(1);

    undo();
    doc = useDoc.getState();
    expect(doc.stations.a.rotation).toBe(0);
    expect(doc.stations.b.rotation).toBe(0);
  });

  it('with mirror off, the rotate buttons touch only the inspected station', async () => {
    const user = userEvent.setup();
    seedPair();
    render(<StationInspector id="a" />);
    await user.click(screen.getByRole('button', { name: 'Rotate −45°' }));
    const doc = useDoc.getState();
    expect(doc.stations.a.rotation).toBe(7);
    expect(doc.stations.b.rotation).toBe(0);
  });
});
