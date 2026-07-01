import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StationInspector } from './StationInspector';
import { useDoc, useSelection } from '../../state/store';
import { historyDepth } from '../../state/history';
import { DEFAULT_DOC, resolveOffsetPerp } from '../../model/transforms';
import { DOT_SHAPE_PRESETS } from '../../model/dotStyle';
import { makeDoc, makeStation, makeStop, makeLine } from '../../test/fixtures';

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

  it('picker is disabled when no stop is selected (only a station)', () => {
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
    expect(screen.getByRole('button', { name: 'Stop shape' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('picker is disabled when only the label is selected', () => {
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [makeStation({ id: 'a', stops: [makeStop('L1')] })],
        lines: [makeLine({ id: 'L1', stations: ['a'] })],
      }),
    });
    useSelection.setState({
      ...SELECTION_BLANK,
      selectedStationIds: ['a'],
      labelSelected: true,
    });

    render(<StationInspector id="a" />);
    expect(screen.getByRole('button', { name: 'Stop shape' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('picker becomes enabled once a stop is clicked in the StopGrid', async () => {
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
    expect(screen.getByRole('button', { name: 'Stop shape' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );

    const stopCell = document.querySelector(
      '[data-cell-kind="stop"][data-line-id="L1"]',
    ) as HTMLElement;
    expect(stopCell).not.toBeNull();
    await user.click(stopCell);

    expect(screen.getByRole('button', { name: 'Stop shape' })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
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
    const stopCell = document.querySelector(
      '[data-cell-kind="stop"][data-line-id="L1"]',
    ) as HTMLElement;
    await user.click(stopCell);
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
    const user = userEvent.setup();
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
    const stopCell = document.querySelector(
      '[data-cell-kind="stop"][data-line-id="L1"]',
    ) as HTMLElement;
    await user.click(stopCell);

    const trigger = screen.getByRole('button', { name: 'Stop shape' });
    const circle = trigger.querySelector('circle');
    expect(circle).not.toBeNull();
    expect(circle?.getAttribute('fill')).toBe('#ffffff');
  });

  it('trigger shows the filled-black default when the selected stop has no dotStyle set', async () => {
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
    const stopCell = document.querySelector(
      '[data-cell-kind="stop"][data-line-id="L1"]',
    ) as HTMLElement;
    await user.click(stopCell);

    const trigger = screen.getByRole('button', { name: 'Stop shape' });
    const circle = trigger.querySelector('circle');
    expect(circle).not.toBeNull();
    expect(circle?.getAttribute('fill')).toBe('#000000');
  });

  it('with mirror on and matching neighbors disagreeing, trigger still reflects the inspected station', async () => {
    const user = userEvent.setup();
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
    const stopCell = document.querySelector(
      '[data-cell-kind="stop"][data-line-id="L1"]',
    ) as HTMLElement;
    await user.click(stopCell);

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
    expect(wpBtn).not.toHaveClass('wp-on');

    await user.click(wpBtn);
    expect(useDoc.getState().stations.a.isWaypoint).toBe(true);
    const wpBtnOn = screen.getByRole('button', { name: 'Waypoint' });
    expect(wpBtnOn).toHaveAttribute('aria-pressed', 'true');
    expect(wpBtnOn).toHaveClass('wp-on');

    await user.click(screen.getByRole('button', { name: 'Waypoint' }));
    const wpBtnOff = screen.getByRole('button', { name: 'Waypoint' });
    expect(useDoc.getState().stations.a.isWaypoint).toBe(false);
    expect(wpBtnOff).toHaveAttribute('aria-pressed', 'false');
    expect(wpBtnOff).not.toHaveClass('wp-on');
  });

  it('Lock button toggles aria-pressed and writes locked on the station', async () => {
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
    const lockBtn = screen.getByRole('button', { name: 'Lock station' });
    expect(lockBtn).toHaveAttribute('aria-pressed', 'false');
    expect(lockBtn).not.toHaveClass('lock-on');

    await user.click(lockBtn);
    expect(useDoc.getState().stations.a.locked).toBe(true);
    // The label flips to the unlock affordance once locked.
    const lockBtnOn = screen.getByRole('button', { name: 'Unlock station' });
    expect(lockBtnOn).toHaveAttribute('aria-pressed', 'true');
    expect(lockBtnOn).toHaveClass('lock-on');

    await user.click(screen.getByRole('button', { name: 'Unlock station' }));
    expect(useDoc.getState().stations.a.locked).toBeFalsy();
    expect(screen.getByRole('button', { name: 'Lock station' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  describe('Bold button', () => {
    it('renders next to the label alignment buttons inside the Label field', () => {
      useDoc.setState({
        ...DEFAULT_DOC,
        ...makeDoc({
          stations: [makeStation({ id: 'a' })],
          lines: [],
        }),
      });
      useSelection.setState({ ...SELECTION_BLANK, selectedStationIds: ['a'] });

      render(<StationInspector id="a" />);
      const bold = screen.getByRole('button', { name: 'Bold' });
      // Same parent (row) as the horizontal-align segmented group.
      const hAlignGroup = screen.getByRole('group', { name: 'Label horizontal alignment' });
      expect(bold.parentElement).toBe(hAlignGroup.parentElement);
      // DOM order: align group → Bold.
      const siblings = Array.from(bold.parentElement!.children);
      expect(siblings.indexOf(bold)).toBeGreaterThan(siblings.indexOf(hAlignGroup));
    });

    it('starts unpressed when the station has no labelBold flag', () => {
      useDoc.setState({
        ...DEFAULT_DOC,
        ...makeDoc({ stations: [makeStation({ id: 'a' })] }),
      });
      useSelection.setState({ ...SELECTION_BLANK, selectedStationIds: ['a'] });
      render(<StationInspector id="a" />);
      expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('starts pressed when the station already has labelBold:true', () => {
      useDoc.setState({
        ...DEFAULT_DOC,
        ...makeDoc({
          stations: [{ ...makeStation({ id: 'a' }), labelBold: true }],
        }),
      });
      useSelection.setState({ ...SELECTION_BLANK, selectedStationIds: ['a'] });
      render(<StationInspector id="a" />);
      expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('toggles labelBold on the station when clicked', async () => {
      const user = userEvent.setup();
      useDoc.setState({
        ...DEFAULT_DOC,
        ...makeDoc({ stations: [makeStation({ id: 'a' })] }),
      });
      useSelection.setState({ ...SELECTION_BLANK, selectedStationIds: ['a'] });
      render(<StationInspector id="a" />);

      await user.click(screen.getByRole('button', { name: 'Bold' }));
      expect(useDoc.getState().stations.a.labelBold).toBe(true);
      expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true');

      await user.click(screen.getByRole('button', { name: 'Bold' }));
      expect(useDoc.getState().stations.a.labelBold).toBeFalsy();
      expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('does NOT mirror-propagate to matching stations', async () => {
      // Same expectation as the Waypoint button: per-station styling decisions
      // should stay per-station even with mirror on.
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
      await user.click(screen.getByRole('button', { name: 'Bold' }));

      const doc = useDoc.getState();
      expect(doc.stations.a.labelBold).toBe(true);
      expect(doc.stations.b.labelBold).toBeFalsy();
    });
  });

  describe('Italic button', () => {
    it('renders next to the Bold button inside the Label field', () => {
      useDoc.setState({
        ...DEFAULT_DOC,
        ...makeDoc({ stations: [makeStation({ id: 'a' })], lines: [] }),
      });
      useSelection.setState({ ...SELECTION_BLANK, selectedStationIds: ['a'] });

      render(<StationInspector id="a" />);
      const italic = screen.getByRole('button', { name: 'Italic' });
      const bold = screen.getByRole('button', { name: 'Bold' });
      // Same parent (row) as Bold, and ordered right after it.
      expect(italic.parentElement).toBe(bold.parentElement);
      const siblings = Array.from(italic.parentElement!.children);
      expect(siblings.indexOf(italic)).toBeGreaterThan(siblings.indexOf(bold));
    });

    it('starts unpressed when the station has no labelItalic flag', () => {
      useDoc.setState({
        ...DEFAULT_DOC,
        ...makeDoc({ stations: [makeStation({ id: 'a' })] }),
      });
      useSelection.setState({ ...SELECTION_BLANK, selectedStationIds: ['a'] });
      render(<StationInspector id="a" />);
      expect(screen.getByRole('button', { name: 'Italic' })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    });

    it('starts pressed when the station already has labelItalic:true', () => {
      useDoc.setState({
        ...DEFAULT_DOC,
        ...makeDoc({
          stations: [{ ...makeStation({ id: 'a' }), labelItalic: true }],
        }),
      });
      useSelection.setState({ ...SELECTION_BLANK, selectedStationIds: ['a'] });
      render(<StationInspector id="a" />);
      expect(screen.getByRole('button', { name: 'Italic' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });

    it('toggles labelItalic on the station when clicked', async () => {
      const user = userEvent.setup();
      useDoc.setState({
        ...DEFAULT_DOC,
        ...makeDoc({ stations: [makeStation({ id: 'a' })] }),
      });
      useSelection.setState({ ...SELECTION_BLANK, selectedStationIds: ['a'] });
      render(<StationInspector id="a" />);

      await user.click(screen.getByRole('button', { name: 'Italic' }));
      expect(useDoc.getState().stations.a.labelItalic).toBe(true);
      expect(screen.getByRole('button', { name: 'Italic' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );

      await user.click(screen.getByRole('button', { name: 'Italic' }));
      expect(useDoc.getState().stations.a.labelItalic).toBeFalsy();
      expect(screen.getByRole('button', { name: 'Italic' })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    });

    it('does NOT mirror-propagate to matching stations', async () => {
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
      expect(doc.stations.a.labelItalic).toBe(true);
      expect(doc.stations.b.labelItalic).toBeFalsy();
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
    expect(wpBtn).toHaveClass('wp-on');
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
    const stopCell = document.querySelector(
      '[data-cell-kind="stop"][data-line-id="L1"]',
    ) as HTMLElement;
    await user.click(stopCell);
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
            ...(over.lineDefaultDotSize !== undefined
              ? { defaultDotSize: over.lineDefaultDotSize }
              : {}),
          }),
        ],
      }),
    });
    useSelection.setState({ ...SELECTION_BLANK, selectedStationIds: ['a'] });
  };

  const sizeBox = () => screen.getByRole('spinbutton', { name: 'Stop dot size' });

  const selectStop = async (user: ReturnType<typeof userEvent.setup>) => {
    const stopCell = document.querySelector(
      '[data-cell-kind="stop"][data-line-id="L1"]',
    ) as HTMLElement;
    await user.click(stopCell);
  };

  it('is disabled, showing the global default, when no stop is selected', () => {
    seed();
    render(<StationInspector id="a" />);
    expect(sizeBox()).toBeDisabled();
    expect(sizeBox()).toHaveValue(8);
  });

  it('is disabled when only the label is selected', () => {
    seed();
    useSelection.setState({
      ...SELECTION_BLANK,
      selectedStationIds: ['a'],
      labelSelected: true,
    });
    render(<StationInspector id="a" />);
    expect(sizeBox()).toBeDisabled();
  });

  it("shows the selected stop's resolved size: explicit override first, then the line default", async () => {
    const user = userEvent.setup();
    seed({ stopDotSize: 16, lineDefaultDotSize: 10 });
    render(<StationInspector id="a" />);
    await selectStop(user);
    expect(sizeBox()).toHaveValue(16);
  });

  it('falls back to the line default for a tracking stop', async () => {
    const user = userEvent.setup();
    seed({ lineDefaultDotSize: 10 });
    render(<StationInspector id="a" />);
    await selectStop(user);
    expect(sizeBox()).toHaveValue(10);
  });

  it('editing writes the override; typing the effective default clears it', async () => {
    const user = userEvent.setup();
    seed();
    render(<StationInspector id="a" />);
    await selectStop(user);

    fireEvent.change(sizeBox(), { target: { value: '12' } });
    expect(useDoc.getState().stations.a.stops[0].dotSize).toBe(12);

    fireEvent.change(sizeBox(), { target: { value: '8' } });
    expect('dotSize' in useDoc.getState().stations.a.stops[0]).toBe(false);
  });

  it('clicking into the textbox does not deselect the stop', async () => {
    const user = userEvent.setup();
    seed();
    render(<StationInspector id="a" />);
    await selectStop(user);
    expect(useSelection.getState().selectedStopLineId).toBe('L1');

    await user.click(sizeBox());

    expect(useSelection.getState().selectedStopLineId).toBe('L1');
    expect(sizeBox()).toBeEnabled();
  });

  it('mirror mode propagates the size to matching stations and collapses to one undo step', async () => {
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
    await selectStop(user);

    const pastBefore = historyDepth();
    // Bare change (no focus arc) — dispatchAll's history group is the only
    // entry, matching the shape-picker mirror test.
    fireEvent.change(sizeBox(), { target: { value: '16' } });

    const doc = useDoc.getState();
    expect(doc.stations.a.stops[0].dotSize).toBe(16);
    expect(doc.stations.b.stops[0].dotSize).toBe(16);
    expect(historyDepth() - pastBefore).toBe(1);
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

  it('the ⟲ button rotates −45° net (seven forward steps wrap to 7)', async () => {
    const user = userEvent.setup();
    seedStation();
    render(<StationInspector id="a" />);
    await user.click(screen.getByRole('button', { name: 'Rotate −45°' }));
    // rotateStation steps +1 mod 8; the button fires it 7×, so 0 → 7 (= −45°).
    expect(useDoc.getState().stations.a.rotation).toBe(7);
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

  it('shows the rotation in degrees, tracking rotate clicks', async () => {
    const user = userEvent.setup();
    seedStation();
    render(<StationInspector id="a" />);
    expect(screen.getByTitle('Station rotation')).toHaveTextContent('0°');
    await user.click(screen.getByRole('button', { name: 'Rotate +45°' }));
    await user.click(screen.getByRole('button', { name: 'Rotate +45°' }));
    expect(screen.getByTitle('Station rotation')).toHaveTextContent('90°');
  });

  it('the mirror toggle names its match count when neighbors match', () => {
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
    useSelection.setState({ ...SELECTION_BLANK, selectedStationIds: ['a'] });
    render(<StationInspector id="a" />);
    expect(screen.getByRole('button', { name: 'Mirror ×1' })).toBeEnabled();
  });

  it('the mirror toggle reads plain "Mirror" and is disabled with no matches', () => {
    seedStation();
    render(<StationInspector id="a" />);
    expect(screen.getByRole('button', { name: 'Mirror' })).toBeDisabled();
  });

  it('clicking an align segment sets label.align directly (auto → end)', async () => {
    const user = userEvent.setup();
    seedStation();
    expect(useDoc.getState().stations.a.label.align).toBe('auto');
    render(<StationInspector id="a" />);
    await user.click(screen.getByRole('button', { name: 'Align: right' }));
    expect(useDoc.getState().stations.a.label.align).toBe('end');
  });

  it('clicking a valign segment sets label.valign directly (auto-down → bottom)', async () => {
    const user = userEvent.setup();
    seedStation();
    expect(useDoc.getState().stations.a.label.valign).toBe('auto-down');
    render(<StationInspector id="a" />);
    await user.click(screen.getByRole('button', { name: 'V-align: bottom' }));
    expect(useDoc.getState().stations.a.label.valign).toBe('bottom');
  });

  it('the current align/valign segments are marked active (aria-pressed)', () => {
    seedStation();
    render(<StationInspector id="a" />);
    expect(
      screen.getByRole('button', { name: 'Align: auto (snap against adjacent stop)' }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Align: right' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(
      screen.getByRole('button', {
        name: 'V-align: auto-down (first line on cell, extra lines below)',
      }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'V-align: top' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('clicking the already-active align segment records no history entry', async () => {
    const user = userEvent.setup();
    seedStation();
    useDoc.temporal.getState().clear();
    const before = historyDepth();
    render(<StationInspector id="a" />);
    await user.click(
      screen.getByRole('button', { name: 'Align: auto (snap against adjacent stop)' }),
    );
    expect(useDoc.getState().stations.a.label.align).toBe('auto');
    expect(historyDepth() - before).toBe(0);
  });

  it('align segment with mirror on broadcasts the SAME align to matching stations in one undo group', async () => {
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
    await user.click(screen.getByRole('button', { name: 'Align: center' }));

    const doc = useDoc.getState();
    expect(doc.stations.a.label.align).toBe('middle');
    // The matching neighbor gets the SAME absolute align — clicks are
    // absolute, so the old cycle-divergence problem cannot occur.
    expect(doc.stations.b.label.align).toBe('middle');
    // The whole batch collapses to a single undo entry.
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
