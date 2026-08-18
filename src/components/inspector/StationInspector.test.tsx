import { describe, it, expect, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StationInspector } from './StationInspector';
import { StationPopover } from '../StationPopover';
import { useDoc, useSelection } from '../../state/store';
import { useStationEditorPrefs } from '../../state/stationEditorPrefs';
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
    useStationEditorPrefs.setState({ styleExpanded: false });
    useDoc.setState({ ...DEFAULT_DOC });
    useSelection.setState(SELECTION_BLANK);
  });

  // The always-enabled shape picker (and the one-per-stop-row count) belongs to
  // StopRows and is pinned there — StopRows.test.tsx's 'every row has exactly
  // one ENABLED shape picker' — for ~1/20th the cost of mounting the whole
  // inspector.

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

  describe('Stop type', () => {
    const oneStop = () => ({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [makeStation({ id: 'a', stops: [makeStop('L1')] })],
        lines: [makeLine({ id: 'L1', stations: ['a'] })],
      }),
    });

    // Auto names what it currently resolves to, because that is the one thing
    // the control can't tell you by looking — and it is what the declaration
    // is being weighed against.
    it('reads Auto with the answer the count gives — Singleton for a lone stop', () => {
      useDoc.setState(oneStop());
      useSelection.setState({ ...SELECTION_BLANK, selectedStationIds: ['a'] });
      render(<StationInspector id="a" />);
      expect(screen.getByRole('combobox', { name: 'Stop type' })).toHaveTextContent(
        'Auto (Singleton)',
      );
    });

    it('reads Auto (Interchange) once a second line stops there', () => {
      useDoc.setState({
        ...DEFAULT_DOC,
        ...makeDoc({
          stations: [makeStation({ id: 'a', stops: [makeStop('L1'), makeStop('L2', { col: 1 })] })],
          lines: [makeLine({ id: 'L1', stations: ['a'] }), makeLine({ id: 'L2', stations: ['a'] })],
        }),
      });
      useSelection.setState({ ...SELECTION_BLANK, selectedStationIds: ['a'] });
      render(<StationInspector id="a" />);
      expect(screen.getByRole('combobox', { name: 'Stop type' })).toHaveTextContent(
        'Auto (Interchange)',
      );
    });

    it('reports the count Auto WOULD give, not the declaration standing in its way', () => {
      // A lone stop declared an interchange: the trigger reads the declaration,
      // but the Auto option still offers "Singleton" — what reverting buys you.
      useDoc.setState({
        ...DEFAULT_DOC,
        ...makeDoc({
          stations: [makeStation({ id: 'a', stops: [makeStop('L1')], stopType: 'interchange' })],
          lines: [makeLine({ id: 'L1', stations: ['a'] })],
        }),
      });
      useSelection.setState({ ...SELECTION_BLANK, selectedStationIds: ['a'] });
      render(<StationInspector id="a" />);
      expect(screen.getByRole('combobox', { name: 'Stop type' })).toHaveTextContent('Interchange');
      expect(screen.getByRole('combobox', { name: 'Stop type' })).not.toHaveTextContent('Auto');
    });

    it('drops the parenthetical for a station with no stops — nothing to resolve', () => {
      useDoc.setState({
        ...DEFAULT_DOC,
        ...makeDoc({ stations: [makeStation({ id: 'a', stops: [] })], lines: [] }),
      });
      useSelection.setState({ ...SELECTION_BLANK, selectedStationIds: ['a'] });
      render(<StationInspector id="a" />);
      expect(screen.getByRole('combobox', { name: 'Stop type' })).toHaveTextContent('Auto');
      expect(screen.getByRole('combobox', { name: 'Stop type' })).not.toHaveTextContent('(');
    });

    it('stays live with no stops — declaring one before wiring up a line is allowed', async () => {
      // Not an oversight: the declaration simply sits inert until a stop
      // arrives to read it. Pinned so it can't be "tidied" into a disable.
      const user = userEvent.setup();
      useDoc.setState({
        ...DEFAULT_DOC,
        ...makeDoc({ stations: [makeStation({ id: 'a', stops: [] })], lines: [] }),
      });
      useSelection.setState({ ...SELECTION_BLANK, selectedStationIds: ['a'] });
      render(<StationInspector id="a" />);

      expect(screen.getByRole('combobox', { name: 'Stop type' })).toBeEnabled();
      await chooseOption(user, 'Stop type', 'Interchange');
      expect(useDoc.getState().stations.a.stopType).toBe('interchange');
    });

    it('sits directly below Add transfer anchor, in that section', () => {
      useDoc.setState(oneStop());
      useSelection.setState({ ...SELECTION_BLANK, selectedStationIds: ['a'] });
      render(<StationInspector id="a" />);
      const anchorBtn = screen.getByRole('button', { name: 'Add transfer anchor' });
      const combo = screen.getByRole('combobox', { name: 'Stop type' });
      // Same field block as the button, and after it in document order.
      expect(anchorBtn.closest('.field')).toBe(combo.closest('.field'));
      expect(
        anchorBtn.compareDocumentPosition(combo) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it('choosing Interchange declares it, and Auto clears the declaration', async () => {
      const user = userEvent.setup();
      useDoc.setState(oneStop());
      useSelection.setState({ ...SELECTION_BLANK, selectedStationIds: ['a'] });
      render(<StationInspector id="a" />);

      await chooseOption(user, 'Stop type', 'Interchange');
      expect(useDoc.getState().stations.a.stopType).toBe('interchange');
      expect(screen.getByRole('combobox', { name: 'Stop type' })).toHaveTextContent('Interchange');

      await chooseOption(user, 'Stop type', 'Auto (Singleton)');
      expect('stopType' in useDoc.getState().stations.a).toBe(false);
    });

    it('choosing Singleton declares it', async () => {
      const user = userEvent.setup();
      useDoc.setState(oneStop());
      useSelection.setState({ ...SELECTION_BLANK, selectedStationIds: ['a'] });
      render(<StationInspector id="a" />);

      await chooseOption(user, 'Stop type', 'Singleton');
      expect(useDoc.getState().stations.a.stopType).toBe('singleton');
    });

    // Select Similar stands in for "stations of the same general purpose", and
    // a station's stop type is exactly that kind of fact — so the declaration
    // rides it, like dot type and size and unlike the End / Xfer pins.
    const twoMatching = () => ({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [
          makeStation({ id: 'a', stops: [makeStop('L1')] }),
          makeStation({ id: 'b', x: 100, stops: [makeStop('L1')] }),
        ],
        lines: [makeLine({ id: 'L1', stations: ['a', 'b'] })],
      }),
    });

    it('rides Select Similar — the declaration reaches every matching station', async () => {
      const user = userEvent.setup();
      useDoc.setState(twoMatching());
      useSelection.setState({
        ...SELECTION_BLANK,
        selectedStationIds: ['a'],
        mirrorMatching: true,
      });
      render(<StationInspector id="a" />);

      await chooseOption(user, 'Stop type', 'Interchange');
      expect(useDoc.getState().stations.a.stopType).toBe('interchange');
      expect(useDoc.getState().stations.b.stopType).toBe('interchange');
    });

    it('clearing back to Auto reaches them too', async () => {
      // Both seeded declared, so the clear has something to DO at b — starting
      // them unset would pass whether or not the broadcast happened.
      const user = userEvent.setup();
      useDoc.setState({
        ...DEFAULT_DOC,
        ...makeDoc({
          stations: [
            makeStation({ id: 'a', stops: [makeStop('L1')], stopType: 'interchange' }),
            makeStation({ id: 'b', x: 100, stops: [makeStop('L1')], stopType: 'interchange' }),
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

      await chooseOption(user, 'Stop type', 'Auto (Singleton)');
      expect('stopType' in useDoc.getState().stations.a).toBe(false);
      expect('stopType' in useDoc.getState().stations.b).toBe(false);
    });

    it('with mirror OFF it stays local to the inspected station', async () => {
      const user = userEvent.setup();
      useDoc.setState(twoMatching());
      useSelection.setState({ ...SELECTION_BLANK, selectedStationIds: ['a'] });
      render(<StationInspector id="a" />);

      await chooseOption(user, 'Stop type', 'Interchange');
      expect(useDoc.getState().stations.a.stopType).toBe('interchange');
      expect(useDoc.getState().stations.b.stopType).toBeUndefined();
    });
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
    // The Size slider is in the collapsible detail; open it so the locked-state
    // assertion below can see it disabled.
    useStationEditorPrefs.setState({ styleExpanded: true });

    function LivePopover() {
      const station = useDoc((s) => s.stations.a);
      return station ? <StationPopover station={station} hostW={800} onClose={() => {}} /> : null;
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
    // The style detail (Size → Tracking) collapses by default; these tests
    // exercise the controls, so open it up front.
    const setup = (station = makeStation({ id: 'a' })) => {
      useDoc.setState({ ...DEFAULT_DOC, ...makeDoc({ stations: [station] }) });
      useSelection.setState({ ...SELECTION_BLANK, selectedStationIds: ['a'] });
      useStationEditorPrefs.setState({ styleExpanded: true });
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

    it('collapses the Size → Tracking detail by default; the style picker stays visible', () => {
      useDoc.setState({ ...DEFAULT_DOC, ...makeDoc({ stations: [makeStation({ id: 'a' })] }) });
      useSelection.setState({ ...SELECTION_BLANK, selectedStationIds: ['a'] });
      render(<StationInspector id="a" />);
      // Picker always shows; the detail rows are hidden until expanded.
      expect(screen.getByRole('combobox', { name: 'Style' })).toBeInTheDocument();
      expect(screen.queryByRole('slider', { name: /size/i })).toBeNull();
      expect(screen.queryByRole('slider', { name: /tracking/i })).toBeNull();
    });

    it('a locked station still shows the typography detail even when collapsed by preference', () => {
      // Lock freezes editing, not viewing: the collapse pref is false, but a
      // locked station forces the (disabled) detail open so its values stay
      // visible — the disclosure toggle is itself frozen by the fieldset.
      useStationEditorPrefs.setState({ styleExpanded: false });
      useDoc.setState({
        ...DEFAULT_DOC,
        ...makeDoc({ stations: [{ ...makeStation({ id: 'a' }), locked: true }] }),
      });
      useSelection.setState({ ...SELECTION_BLANK, selectedStationIds: ['a'] });
      render(<StationInspector id="a" />);
      const size = screen.getByRole('slider', { name: /size/i });
      expect(size).toBeInTheDocument();
      expect(size).toHaveAttribute('data-disabled');
    });

    it('the disclosure reveals the detail and persists the choice', async () => {
      const user = userEvent.setup();
      useDoc.setState({ ...DEFAULT_DOC, ...makeDoc({ stations: [makeStation({ id: 'a' })] }) });
      useSelection.setState({ ...SELECTION_BLANK, selectedStationIds: ['a'] });
      render(<StationInspector id="a" />);

      const toggle = screen.getByRole('button', { name: /size & spacing/i });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await user.click(toggle);
      expect(screen.getByRole('slider', { name: /size/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /size & spacing/i })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
      // The open/closed state is a remembered preference.
      expect(useStationEditorPrefs.getState().styleExpanded).toBe(true);
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

    it('editing a covered typography field keeps the style tag (an override)', () => {
      // A default-looking station tagged to a matching style.
      useDoc.setState({
        ...DEFAULT_DOC,
        ...makeDoc({
          stations: [{ ...makeStation({ id: 'a' }), styleId: 'y1' }],
          styles: [makeStyle('station', 'y1', { name: 'Big' })],
        }),
      });
      useSelection.setState({ ...SELECTION_BLANK, selectedStationIds: ['a'] });
      useStationEditorPrefs.setState({ styleExpanded: true });
      render(<StationInspector id="a" />);
      expect(screen.getByRole('combobox', { name: 'Style' })).toHaveTextContent('Big');
      stepSlider(screen.getByRole('slider', { name: /size/i }), 1);
      expect(useDoc.getState().stations.a.styleId).toBe('y1');
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
      useStationEditorPrefs.setState({ styleExpanded: true });

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
    useStationEditorPrefs.setState({ styleExpanded: false });
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
    useStationEditorPrefs.setState({ styleExpanded: false });
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
    // The fields speak the PIVOT: this station has no stops, so that is the
    // label cell, one cell (14) left of the pin. Typing 55 lands the label
    // at 55, i.e. the pin at 69; the y axis rides along untouched.
    seedStation();
    render(<StationInspector id="a" />);
    const xIn = screen.getByRole('spinbutton', { name: 'X' }) as HTMLInputElement;
    const yIn = screen.getByRole('spinbutton', { name: 'Y' }) as HTMLInputElement;
    fireEvent.change(xIn, { target: { value: '55' } });
    expect(useDoc.getState().stations.a.x).toBe(69);
    expect(useDoc.getState().stations.a.y).toBe(20);
    // Y input writes y, leaves x. The label sits on the pin's row, so here
    // the pivot and the pin agree.
    fireEvent.change(yIn, { target: { value: '77' } });
    expect(useDoc.getState().stations.a.y).toBe(77);
    expect(useDoc.getState().stations.a.x).toBe(69);
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

  it('Edit layout, Select Similar, and WP share the button bar (Name is a row of its own)', () => {
    seedStation();
    render(<StationInspector id="a" />);
    const editLayout = screen.getByRole('button', { name: 'Edit layout' });
    const similar = screen.getByRole('button', { name: 'Select Similar' });
    const wp = screen.getByRole('button', { name: 'Waypoint' });
    // All three live in one row (the button bar).
    expect(similar.parentElement).toBe(editLayout.parentElement);
    expect(wp.parentElement).toBe(editLayout.parentElement);
    // Left-to-right order: Edit layout, Select Similar, WP (right-justified).
    const bar = Array.from(editLayout.parentElement!.children);
    expect(bar.indexOf(editLayout)).toBeLessThan(bar.indexOf(similar));
    expect(bar.indexOf(similar)).toBeLessThan(bar.indexOf(wp));
    // The Name field no longer shares a line with these buttons.
    expect(wp.parentElement).not.toBe(screen.getByText('Name').parentElement);
    // The lock toggle is the StationPopover footer's, not the inspector's.
    expect(screen.queryByRole('button', { name: 'Lock station' })).toBeNull();
  });

  it('clicking a horizontal-alignment segment sets label.align as one undo entry', async () => {
    const user = userEvent.setup();
    seedStation();
    // Default is the legacy 'auto'; the manual segmented control shows while the
    // wand is off.
    expect(useDoc.getState().stations.a.label.align).toBe('auto');
    useDoc.temporal.getState().clear();
    const before = historyDepth();
    render(<StationInspector id="a" />);
    await user.click(screen.getByLabelText('Align left'));
    expect(useDoc.getState().stations.a.label.align).toBe('start');
    expect(historyDepth() - before).toBe(1);
    // Each segment writes its own absolute value.
    await user.click(screen.getByLabelText('Align center'));
    expect(useDoc.getState().stations.a.label.align).toBe('middle');
    // 'auto' is kept as an explicit segment so old maps stay editable.
    await user.click(screen.getByLabelText('Align auto'));
    expect(useDoc.getState().stations.a.label.align).toBe('auto');
  });

  it('marks the current alignment segment active', () => {
    seedStation();
    useDoc.getState().setLabelAlign('a', 'end');
    render(<StationInspector id="a" />);
    expect(screen.getByLabelText('Align right')).toHaveClass('active');
    expect(screen.getByLabelText('Align left')).not.toHaveClass('active');
  });

  it('re-clicking the active alignment segment keeps the value (radio-like, no empty write)', async () => {
    // Radix ToggleGroup type="single" is deselectable — re-clicking the active
    // item fires onValueChange(''). The onSet guard must swallow that so an
    // invalid empty align never reaches the model.
    const user = userEvent.setup();
    seedStation();
    useDoc.getState().setLabelAlign('a', 'start');
    render(<StationInspector id="a" />);
    const left = screen.getByLabelText('Align left');
    expect(left).toHaveClass('active');
    await user.click(left);
    expect(useDoc.getState().stations.a.label.align).toBe('start');
    expect(screen.getByLabelText('Align left')).toHaveClass('active');
  });

  it('clicking a vertical-alignment segment sets label.valign', async () => {
    const user = userEvent.setup();
    seedStation();
    expect(useDoc.getState().stations.a.label.valign).toBe('auto-down');
    render(<StationInspector id="a" />);
    await user.click(screen.getByLabelText('V-align top'));
    expect(useDoc.getState().stations.a.label.valign).toBe('top');
    await user.click(screen.getByLabelText('V-align bottom'));
    expect(useDoc.getState().stations.a.label.valign).toBe('bottom');
  });

  it('the rotate-label button sits last on the Label row, after the alignment controls', () => {
    seedStation();
    render(<StationInspector id="a" />);
    const rotate = screen.getByRole('button', { name: 'Rotate label' });
    const wand = screen.getByRole('button', { name: 'Auto placement' });
    expect(rotate.parentElement).toBe(wand.parentElement);
    const row = Array.from(wand.parentElement!.children);
    expect(row.indexOf(rotate)).toBe(row.length - 1);
    expect(row.indexOf(rotate)).toBeGreaterThan(row.indexOf(wand));
  });

  it('clicking the rotate-label button steps label.rotation one step (0 → 1) as one undo entry', async () => {
    const user = userEvent.setup();
    seedStation();
    expect(useDoc.getState().stations.a.label.rotation).toBe(0);
    useDoc.temporal.getState().clear();
    const before = historyDepth();
    render(<StationInspector id="a" />);
    await user.click(screen.getByRole('button', { name: 'Rotate label' }));
    expect(useDoc.getState().stations.a.label.rotation).toBe(1);
    expect(historyDepth() - before).toBe(1);
  });

  it('the rotate-label button stays on the row with Auto placement on (rotation is orthogonal)', async () => {
    // Toggling the wand swaps the manual align/valign controls for the auto
    // tuning ones, but rotation sets the reading axis (which autoAlign honors),
    // so the rotate control stays put and usable in both setups.
    const user = userEvent.setup();
    seedStation();
    render(<StationInspector id="a" />);
    await user.click(screen.getByRole('button', { name: 'Auto placement' }));
    const rotate = screen.getByRole('button', { name: 'Rotate label' });
    expect(rotate).toBeEnabled();
    await user.click(rotate);
    expect(useDoc.getState().stations.a.label.rotation).toBe(1);
  });

  it('rotate-label with mirror on broadcasts the step to matching stations in one undo group', async () => {
    // A relative rotation step is frame-invariant across mirror matches, so the
    // same +1 reaches every match (the R shortcut and right-click do the same).
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
    await user.click(screen.getByRole('button', { name: 'Rotate label' }));

    const doc = useDoc.getState();
    expect(doc.stations.a.label.rotation).toBe(1);
    expect(doc.stations.b.label.rotation).toBe(1);
    expect(historyDepth() - before).toBe(1);
  });

  it('an alignment segment with mirror on broadcasts the SAME align to matches in one undo group', async () => {
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
    await user.click(screen.getByLabelText('Align left'));

    const doc = useDoc.getState();
    expect(doc.stations.a.label.align).toBe('start');
    // The matching neighbor gets the SAME absolute value, so matches can't
    // diverge.
    expect(doc.stations.b.label.align).toBe('start');
    // The whole batch collapses to a single undo entry.
    expect(historyDepth() - before).toBe(1);
  });

  it('the Auto placement toggle writes label.autoAlign as one undo entry and swaps the controls', async () => {
    const user = userEvent.setup();
    seedStation();
    useDoc.temporal.getState().clear();
    const before = historyDepth();
    render(<StationInspector id="a" />);

    const toggle = screen.getByRole('button', { name: 'Auto placement' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    // Wand off: the manual align control shows; the auto tuning one does not.
    expect(screen.getByLabelText('Align auto')).toBeInTheDocument();
    expect(screen.queryByLabelText('Auto align: auto')).toBeNull();

    await user.click(toggle);
    expect(useDoc.getState().stations.a.label.autoAlign).toBe(true);
    expect(historyDepth() - before).toBe(1);
    expect(screen.getByRole('button', { name: 'Auto placement' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Wand on: the controls swap — manual gone, auto tuning shown.
    expect(screen.queryByLabelText('Align auto')).toBeNull();
    expect(screen.getByLabelText('Auto align: auto')).toBeInTheDocument();

    // Toggling off removes the key entirely (omitted-when-false) and swaps back.
    await user.click(screen.getByRole('button', { name: 'Auto placement' }));
    expect('autoAlign' in useDoc.getState().stations.a.label).toBe(false);
    expect(screen.getByLabelText('Align auto')).toBeInTheDocument();
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

  it('the auto H/V tuning controls show only with Auto placement on and write the overrides', async () => {
    const user = userEvent.setup();
    seedStation();
    render(<StationInspector id="a" />);

    // Wand off: no auto tuning controls in the DOM.
    expect(screen.queryByLabelText('Auto align: auto')).toBeNull();
    expect(screen.queryByLabelText('Auto align V: auto')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Auto placement' }));
    // Wand on: the auto tuning controls appear.
    expect(screen.getByLabelText('Auto align: auto')).toBeInTheDocument();
    expect(screen.getByLabelText('Auto align V: auto')).toBeInTheDocument();

    useDoc.temporal.getState().clear();
    const before = historyDepth();
    await user.click(screen.getByLabelText('Auto align: left'));
    expect(useDoc.getState().stations.a.label.autoHAlign).toBe('start');
    expect(historyDepth() - before).toBe(1);
    await user.click(screen.getByLabelText('Auto align: center'));
    expect(useDoc.getState().stations.a.label.autoHAlign).toBe('middle');

    await user.click(screen.getByLabelText('Auto align V: up'));
    expect(useDoc.getState().stations.a.label.autoVAlign).toBe('up');
    await user.click(screen.getByLabelText('Auto align V: down'));
    expect(useDoc.getState().stations.a.label.autoVAlign).toBe('down');
    // Selecting the auto segment clears the override (key removed).
    await user.click(screen.getByLabelText('Auto align V: auto'));
    expect('autoVAlign' in useDoc.getState().stations.a.label).toBe(false);
  });

  it('an auto H segment broadcasts the same absolute value with mirror on', async () => {
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
    await user.click(screen.getByLabelText('Auto align: left'));

    const doc = useDoc.getState();
    expect(doc.stations.a.label.autoHAlign).toBe('start');
    expect(doc.stations.b.label.autoHAlign).toBe('start');
    expect(historyDepth() - before).toBe(1);
  });
});

describe('<StationInspector /> — label offset wiring (along vs perpendicular)', () => {
  beforeEach(() => {
    localStorage.clear();
    useStationEditorPrefs.setState({ styleExpanded: false });
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
    useStationEditorPrefs.setState({ styleExpanded: false });
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
    useStationEditorPrefs.setState({ styleExpanded: false });
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

  it('sits in the button bar, between Edit layout and the WP button', () => {
    seedPair();
    render(<StationInspector id="a" />);
    const editLayout = screen.getByRole('button', { name: 'Edit layout' });
    const similar = screen.getByRole('button', { name: 'Select Similar' });
    const wp = screen.getByRole('button', { name: 'Waypoint' });
    expect(similar.parentElement).toBe(editLayout.parentElement);
    expect(wp.parentElement).toBe(editLayout.parentElement);
    const siblings = Array.from(editLayout.parentElement!.children);
    expect(siblings.indexOf(editLayout)).toBeLessThan(siblings.indexOf(similar));
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
    expect(btn).toHaveAttribute('title', expect.stringMatching(/No matching stations/i));
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
    // …and it must not claim a selection it doesn't have. The ON title counts
    // its matches, so this corner needs its own wording, not "0 similar
    // stations selected".
    expect(btn).toHaveAttribute('title', expect.stringMatching(/^No matching stations/));
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

describe('<StationInspector /> — Stop dots section', () => {
  beforeEach(() => {
    localStorage.clear();
    useStationEditorPrefs.setState({ styleExpanded: false });
    useDoc.setState({ ...DEFAULT_DOC });
    useSelection.setState(SELECTION_BLANK);
  });

  it('is titled "Stop dots" with column captions and no "edited on the map" hint', () => {
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [makeStation({ id: 'a', stops: [makeStop('L1')] })],
        lines: [makeLine({ id: 'L1', stations: ['a'] })],
      }),
    });
    useSelection.setState({ ...SELECTION_BLANK, selectedStationIds: ['a'] });
    render(<StationInspector id="a" />);
    expect(screen.getByText('Stop dots')).toBeInTheDocument();
    // Column captions above the rows (the collapsed style detail keeps its own
    // "Size" label out of the DOM, so this "Size" is the column caption).
    for (const caption of ['Line', 'Type', 'Size', 'Direction']) {
      expect(screen.getByText(caption)).toBeInTheDocument();
    }
    // The old "positions are edited on the map" help text is gone.
    expect(screen.queryByText(/edited on the map/i)).toBeNull();
    expect(screen.queryByText(/click Edit layout/i)).toBeNull();
  });

  it('shows the column captions only when the station has stops', () => {
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({ stations: [makeStation({ id: 'a', stops: [] })] }),
    });
    useSelection.setState({ ...SELECTION_BLANK, selectedStationIds: ['a'] });
    render(<StationInspector id="a" />);
    expect(screen.queryByText('Direction')).toBeNull();
    // The empty-state hint still shows.
    expect(screen.getByText(/No stops yet/i)).toBeInTheDocument();
  });
});

describe('<StationInspector /> — X/Y fields speak the pivot, not the pin', () => {
  beforeEach(() => {
    localStorage.clear();
    useStationEditorPrefs.setState({ styleExpanded: false });
    useDoc.setState({ ...DEFAULT_DOC });
    useSelection.setState(SELECTION_BLANK);
  });

  // Pin at (40, -10), single stop parked two cells over (col 2, pitch 14):
  // the picture is at x = 40 + 28 = 68, and 68 is what the field must say.
  const seedOffsetLayout = () => {
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [makeStation({ id: 'a', x: 40, y: -10, stops: [makeStop('L1', { col: 2 })] })],
        lines: [makeLine({ id: 'L1', stations: ['a'] })],
      }),
    });
    useSelection.setState({ ...SELECTION_BLANK, selectedStationIds: ['a'] });
  };

  it('displays the pivot world position for a layout parked off the pin', () => {
    seedOffsetLayout();
    render(<StationInspector id="a" />);
    expect((screen.getByLabelText('X') as HTMLInputElement).value).toBe('68');
    expect((screen.getByLabelText('Y') as HTMLInputElement).value).toBe('-10');
  });

  it('reads a sub-tenth pivot in the one-decimal measurement register', () => {
    // A dragged/snapped station lands wherever the gesture put it, and a box
    // reciting all of 120.437291 back is noise rather than precision. Same
    // reading as the guide popover's boxes and the canvas measurement chips
    // (`roundMeasurement`); the doc keeps the full value behind it until
    // something is typed over the box.
    // Stop parked ON the pin (col 0), so the pivot IS the stored position and
    // the assertion is about the reading, nothing else.
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [
          makeStation({ id: 'a', x: 120.437291, y: -0.04, stops: [makeStop('L1', { col: 0 })] }),
        ],
        lines: [makeLine({ id: 'L1', stations: ['a'] })],
      }),
    });
    useSelection.setState({ ...SELECTION_BLANK, selectedStationIds: ['a'] });
    render(<StationInspector id="a" />);
    expect((screen.getByLabelText('X') as HTMLInputElement).value).toBe('120.4');
    // A station a hair above the axis must not read "-0".
    expect((screen.getByLabelText('Y') as HTMLInputElement).value).toBe('0');
    expect(useDoc.getState().stations.a.x).toBe(120.437291);
  });

  it('shows a fractional pivot that already fits the register as it stands', () => {
    // Stop parked ON the pin (col 0), so the pivot IS the stored position and
    // the assertion is about the reading, nothing else.
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [
          makeStation({ id: 'a', x: 120.4, y: 0.1 + 0.2, stops: [makeStop('L1', { col: 0 })] }),
        ],
        lines: [makeLine({ id: 'L1', stations: ['a'] })],
      }),
    });
    useSelection.setState({ ...SELECTION_BLANK, selectedStationIds: ['a'] });
    render(<StationInspector id="a" />);
    expect((screen.getByLabelText('X') as HTMLInputElement).value).toBe('120.4');
    expect((screen.getByLabelText('Y') as HTMLInputElement).value).toBe('0.3');
  });

  it('typing X moves the station so the pivot lands there, cells untouched', () => {
    seedOffsetLayout();
    render(<StationInspector id="a" />);
    const x = screen.getByLabelText('X') as HTMLInputElement;
    fireEvent.focus(x);
    fireEvent.change(x, { target: { value: '100' } });
    fireEvent.blur(x);
    const st = useDoc.getState().stations.a;
    // Pivot at 100 ⇒ pin at 100 − 28; y untouched; the layout cells intact.
    expect(st.x).toBeCloseTo(72, 9);
    expect(st.y).toBeCloseTo(-10, 9);
    expect(st.stops.map((c) => c.col)).toEqual([2]);
  });
});

describe('<StationPopover /> — title', () => {
  beforeEach(() => {
    localStorage.clear();
    useStationEditorPrefs.setState({ styleExpanded: false });
    useDoc.setState({ ...DEFAULT_DOC });
    useSelection.setState(SELECTION_BLANK);
  });

  const renderPopover = (name: string): HTMLElement => {
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({ stations: [makeStation({ id: 'a', name })] }),
    });
    useSelection.setState({ ...SELECTION_BLANK, selectedStationIds: ['a'] });
    const { container } = render(
      <StationPopover station={useDoc.getState().stations.a} hostW={800} onClose={() => {}} />,
    );
    return container.querySelector('.header') as HTMLElement;
  };

  it('titles the panel with the short name (inline bullets/tags stripped)', () => {
    // Same text the stations list shows: the bullet token drops, tags strip.
    expect(renderPopover('Foo |A| Bar')).toHaveTextContent('Foo Bar');
  });

  it('falls back to "Station" for an empty name', () => {
    expect(renderPopover('')).toHaveTextContent('Station');
  });
});
