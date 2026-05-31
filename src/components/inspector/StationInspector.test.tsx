import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StationInspector } from './StationInspector';
import { useDoc, useSelection } from '../../state/store';
import { historyDepth } from '../../state/history';
import { DEFAULT_DOC } from '../../model/transforms';
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

  it("trigger reflects the selected stop's explicit dotShape", async () => {
    const user = userEvent.setup();
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [
          makeStation({
            id: 'a',
            stops: [makeStop('L1', { dotShape: 'filled-white' })],
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
    expect(circle?.getAttribute('fill')).toBe('#fff');
  });

  it('trigger shows the filled-black default when the selected stop has no dotShape set', async () => {
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
    expect(circle?.getAttribute('fill')).toBe('#000');
  });

  it('with mirror on and matching neighbors disagreeing, trigger still reflects the inspected station', async () => {
    const user = userEvent.setup();
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [
          makeStation({ id: 'a', stops: [makeStop('L1', { dotShape: 'filled-white' })] }),
          makeStation({ id: 'b', stops: [makeStop('L1', { dotShape: 'filled-black' })] }),
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
    expect(circle?.getAttribute('fill')).toBe('#fff');
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
      // Same parent (row) as the H/V alignment buttons.
      const hAlign = screen.getByRole('button', { name: /Label horizontal alignment/i });
      expect(bold.parentElement).toBe(hAlign.parentElement);
      // DOM order: H-align → V-align → Bold.
      const siblings = Array.from(bold.parentElement!.children);
      expect(siblings.indexOf(bold)).toBeGreaterThan(siblings.indexOf(hAlign));
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
    expect(doc.stations.a.stops[0].dotShape).toBe('open-white');
    expect(doc.stations.b.stops[0].dotShape).toBe('open-white');

    const pastAfter = historyDepth();
    expect(pastAfter - pastBefore).toBe(1);
  });
});
