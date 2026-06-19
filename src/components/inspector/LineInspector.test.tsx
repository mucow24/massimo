import { describe, it, expect, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LineInspector } from './LineInspector';
import { useDoc, useSelection } from '../../state/store';
import { historyDepth } from '../../state/history';
import { DEFAULT_DOC } from '../../model/transforms';
import { makeDoc, makeLine, makeStation, makeStop } from '../../test/fixtures';

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

describe('<LineInspector /> — segment style dividers', () => {
  beforeEach(() => {
    localStorage.clear();
    useDoc.setState({ ...DEFAULT_DOC });
    useSelection.setState(SELECTION_BLANK);
  });

  const seedThreeStationLine = () => {
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [
          makeStation({ id: 's1', stops: [makeStop('L1')] }),
          makeStation({ id: 's2', stops: [makeStop('L1')] }),
          makeStation({ id: 's3', stops: [makeStop('L1')] }),
        ],
        lines: [makeLine({ id: 'L1', stations: ['s1', 's2', 's3'] })],
      }),
    });
  };

  it('renders one divider per adjacent station-pair (N-1 for N stations)', () => {
    seedThreeStationLine();
    const { container } = render(<LineInspector id="L1" />);
    const dividers = container.querySelectorAll('[data-segment-style-divider]');
    expect(dividers.length).toBe(2);
  });

  it('reflects the current style of each segment via data-style', () => {
    seedThreeStationLine();
    useDoc.getState().setLineSegmentStyle('L1', 's2', 's3', 'hatched');
    const { container } = render(<LineInspector id="L1" />);
    const dividers = container.querySelectorAll('[data-segment-style-divider]');
    expect(dividers[0].getAttribute('data-style')).toBe('solid');
    expect(dividers[1].getAttribute('data-style')).toBe('hatched');
  });

  it('clicking a divider cycles solid → dashed → hatched → hatched-mirror → dotted → dashed-open → solid', async () => {
    seedThreeStationLine();
    const user = userEvent.setup();
    render(<LineInspector id="L1" />);

    const divider = screen.getAllByRole('button', { name: /segment style/i })[0];

    await user.click(divider);
    expect(useDoc.getState().lines.L1.segmentStyles).toEqual({ 's1|s2': 'dashed' });

    await user.click(divider);
    expect(useDoc.getState().lines.L1.segmentStyles).toEqual({ 's1|s2': 'hatched' });

    await user.click(divider);
    expect(useDoc.getState().lines.L1.segmentStyles).toEqual({ 's1|s2': 'hatched-mirror' });

    await user.click(divider);
    expect(useDoc.getState().lines.L1.segmentStyles).toEqual({ 's1|s2': 'dotted' });

    await user.click(divider);
    expect(useDoc.getState().lines.L1.segmentStyles).toEqual({ 's1|s2': 'dashed-open' });

    await user.click(divider);
    // Back to solid -> entry deleted entirely.
    expect(useDoc.getState().lines.L1.segmentStyles).toEqual({});
  });

  it('renders no dividers for a line with fewer than two stations', () => {
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [makeStation({ id: 's1', stops: [makeStop('L1')] })],
        lines: [makeLine({ id: 'L1', stations: ['s1'] })],
      }),
    });
    const { container } = render(<LineInspector id="L1" />);
    expect(container.querySelectorAll('[data-segment-style-divider]').length).toBe(0);
  });
});

describe('<LineInspector /> — width control', () => {
  beforeEach(() => {
    localStorage.clear();
    useDoc.setState({ ...DEFAULT_DOC });
    useSelection.setState(SELECTION_BLANK);
    useDoc.temporal.getState().clear();
  });

  const seed = (width?: number) => {
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [
          makeStation({ id: 's1', stops: [makeStop('L1')] }),
          makeStation({ id: 's2', stops: [makeStop('L1')] }),
        ],
        lines: [
          // Spread conditionally — `width: undefined` would plant the KEY,
          // and the canonical width-less form has no key at all.
          makeLine({ id: 'L1', stations: ['s1', 's2'], ...(width !== undefined ? { width } : {}) }),
        ],
      }),
    });
  };

  it('renders a 2–28 step-1 slider at the line’s effective width', () => {
    seed();
    render(<LineInspector id="L1" />);
    const slider = screen.getByRole('slider', { name: 'Width' }) as HTMLInputElement;
    expect(slider.getAttribute('min')).toBe('2');
    expect(slider.getAttribute('max')).toBe('28');
    expect(slider.getAttribute('step')).toBe('1');
    expect(slider.value).toBe('14');
  });

  it('slider edits write the width; the default drops the key', () => {
    seed();
    render(<LineInspector id="L1" />);
    const slider = screen.getByRole('slider', { name: 'Width' });
    fireEvent.change(slider, { target: { value: '20' } });
    expect(useDoc.getState().lines.L1.width).toBe(20);
    fireEvent.change(slider, { target: { value: '14' } });
    expect('width' in useDoc.getState().lines.L1).toBe(false);
  });

  it('the spinbutton floors at 1 and is uncapped above the slider max', () => {
    seed();
    render(<LineInspector id="L1" />);
    const spin = screen.getByRole('spinbutton', { name: 'Width' });
    expect(spin.getAttribute('min')).toBe('1');
    expect(spin.getAttribute('max')).toBeNull();
    fireEvent.change(spin, { target: { value: '40' } });
    expect(useDoc.getState().lines.L1.width).toBe(40);
  });

  it('one slider focus-arc collapses to a single undo entry', () => {
    seed();
    useDoc.temporal.getState().clear();
    render(<LineInspector id="L1" />);
    const slider = screen.getByRole('slider', { name: 'Width' });
    const before = historyDepth();
    fireEvent.focus(slider);
    fireEvent.change(slider, { target: { value: '16' } });
    fireEvent.change(slider, { target: { value: '20' } });
    fireEvent.change(slider, { target: { value: '24' } });
    fireEvent.blur(slider);
    expect(historyDepth()).toBe(before + 1);
    useDoc.temporal.getState().undo();
    expect('width' in useDoc.getState().lines.L1).toBe(false);
  });

  it('the stop-band preview always renders at the default width, ignoring the line width', () => {
    // A wide line must not make the preview band thick...
    seed(28);
    const wide = render(<LineInspector id="L1" />);
    const wideBand = wide.container.querySelectorAll('svg line');
    expect(wideBand.length).toBeGreaterThan(0);
    for (const l of wideBand) expect(l.getAttribute('stroke-width')).toBe('14');
    wide.unmount();

    // ...nor a thin line make it a hairline.
    seed(2);
    const thin = render(<LineInspector id="L1" />);
    const thinBand = thin.container.querySelectorAll('svg line');
    expect(thinBand.length).toBeGreaterThan(0);
    for (const l of thinBand) expect(l.getAttribute('stroke-width')).toBe('14');
  });
});

describe('<LineInspector /> — dot size control', () => {
  beforeEach(() => {
    localStorage.clear();
    useDoc.setState({ ...DEFAULT_DOC });
    useSelection.setState(SELECTION_BLANK);
    useDoc.temporal.getState().clear();
  });

  const seed = (defaultDotSize?: number) => {
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [
          makeStation({ id: 's1', stops: [makeStop('L1')] }),
          makeStation({ id: 's2', stops: [makeStop('L1')] }),
        ],
        lines: [
          // Spread conditionally — an explicit `undefined` would plant the
          // key, and the canonical size-less form has no key at all.
          makeLine({
            id: 'L1',
            stations: ['s1', 's2'],
            ...(defaultDotSize !== undefined ? { defaultDotSize } : {}),
          }),
        ],
      }),
    });
  };

  it('renders a 0–20 step-1 slider at the line’s effective default dot size', () => {
    seed();
    render(<LineInspector id="L1" />);
    const slider = screen.getByRole('slider', { name: 'Dot size' }) as HTMLInputElement;
    expect(slider.getAttribute('min')).toBe('0');
    expect(slider.getAttribute('max')).toBe('20');
    expect(slider.getAttribute('step')).toBe('1');
    expect(slider.value).toBe('8');
  });

  it('sits below the "Default stop dot" control and above Color', () => {
    seed();
    render(<LineInspector id="L1" />);
    const picker = screen.getByText('Default stop dot');
    const sizeLabel = screen.getByText('Dot size');
    const color = screen.getByText('Color');
    // DOCUMENT_POSITION_FOLLOWING = 4: the argument follows the receiver.
    expect(picker.compareDocumentPosition(sizeLabel) & 4).toBe(4);
    expect(sizeLabel.compareDocumentPosition(color) & 4).toBe(4);
  });

  it('slider edits write defaultDotSize; the default drops the key', () => {
    seed();
    render(<LineInspector id="L1" />);
    const slider = screen.getByRole('slider', { name: 'Dot size' });
    fireEvent.change(slider, { target: { value: '12' } });
    expect(useDoc.getState().lines.L1.defaultDotSize).toBe(12);
    fireEvent.change(slider, { target: { value: '8' } });
    expect('defaultDotSize' in useDoc.getState().lines.L1).toBe(false);
  });

  it('the spinbutton floors at 0 and is uncapped above the slider max', () => {
    seed();
    render(<LineInspector id="L1" />);
    const spin = screen.getByRole('spinbutton', { name: 'Dot size' });
    expect(spin.getAttribute('min')).toBe('0');
    expect(spin.getAttribute('max')).toBeNull();
    fireEvent.change(spin, { target: { value: '32' } });
    expect(useDoc.getState().lines.L1.defaultDotSize).toBe(32);
  });

  it('one slider focus-arc collapses to a single undo entry', () => {
    seed();
    useDoc.temporal.getState().clear();
    render(<LineInspector id="L1" />);
    const slider = screen.getByRole('slider', { name: 'Dot size' });
    const before = historyDepth();
    fireEvent.focus(slider);
    fireEvent.change(slider, { target: { value: '10' } });
    fireEvent.change(slider, { target: { value: '14' } });
    fireEvent.change(slider, { target: { value: '16' } });
    fireEvent.blur(slider);
    expect(historyDepth()).toBe(before + 1);
    useDoc.temporal.getState().undo();
    expect('defaultDotSize' in useDoc.getState().lines.L1).toBe(false);
  });
});

describe('<LineInspector /> — stroke controls', () => {
  beforeEach(() => {
    localStorage.clear();
    useDoc.setState({ ...DEFAULT_DOC });
    useSelection.setState(SELECTION_BLANK);
    useDoc.temporal.getState().clear();
  });

  const seed = (over: { strokeWidth?: number; strokeColor?: string } = {}) => {
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [
          makeStation({ id: 's1', stops: [makeStop('L1')] }),
          makeStation({ id: 's2', stops: [makeStop('L1')] }),
        ],
        // Spread conditionally — an explicit `undefined` would plant the
        // key, and the canonical stroke-less form has no key at all.
        lines: [makeLine({ id: 'L1', stations: ['s1', 's2'], ...over })],
      }),
    });
  };

  it('renders a 0–10 half-step slider at the line’s effective stroke width', () => {
    seed();
    render(<LineInspector id="L1" />);
    const slider = screen.getByRole('slider', { name: 'Stroke' }) as HTMLInputElement;
    expect(slider.getAttribute('min')).toBe('0');
    expect(slider.getAttribute('max')).toBe('10');
    expect(slider.getAttribute('step')).toBe('0.5');
    expect(slider.value).toBe('0');
  });

  it('slider edits write the stroke width (half steps included); zero drops the key', () => {
    seed();
    render(<LineInspector id="L1" />);
    const slider = screen.getByRole('slider', { name: 'Stroke' });
    fireEvent.change(slider, { target: { value: '1.5' } });
    expect(useDoc.getState().lines.L1.strokeWidth).toBe(1.5);
    fireEvent.change(slider, { target: { value: '0' } });
    expect('strokeWidth' in useDoc.getState().lines.L1).toBe(false);
  });

  it('the spinbutton steps by 0.5 and is uncapped above the slider max', () => {
    seed();
    render(<LineInspector id="L1" />);
    const spin = screen.getByRole('spinbutton', { name: 'Stroke' });
    expect(spin.getAttribute('min')).toBe('0');
    expect(spin.getAttribute('max')).toBeNull();
    expect(spin.getAttribute('step')).toBe('0.5');
    fireEvent.change(spin, { target: { value: '30' } });
    expect(useDoc.getState().lines.L1.strokeWidth).toBe(30);
  });

  it('the color input reflects the effective stroke color and writes edits', () => {
    seed({ strokeColor: '#ff0000' });
    render(<LineInspector id="L1" />);
    const input = screen.getByLabelText('Stroke color') as HTMLInputElement;
    expect(input.value).toBe('#ff0000');
    fireEvent.change(input, { target: { value: '#00aa55' } });
    expect(useDoc.getState().lines.L1.strokeColor).toBe('#00aa55');
    // Picking the default drops the key (never stored).
    fireEvent.change(input, { target: { value: '#ffffff' } });
    expect('strokeColor' in useDoc.getState().lines.L1).toBe(false);
  });

  it('defaults the color input to white for a stroke-less line', () => {
    seed();
    render(<LineInspector id="L1" />);
    expect((screen.getByLabelText('Stroke color') as HTMLInputElement).value).toBe('#ffffff');
  });

  it('one slider focus-arc collapses to a single undo entry', () => {
    seed();
    useDoc.temporal.getState().clear();
    render(<LineInspector id="L1" />);
    const slider = screen.getByRole('slider', { name: 'Stroke' });
    const before = historyDepth();
    fireEvent.focus(slider);
    fireEvent.change(slider, { target: { value: '2' } });
    fireEvent.change(slider, { target: { value: '4' } });
    fireEvent.change(slider, { target: { value: '6' } });
    fireEvent.blur(slider);
    expect(historyDepth()).toBe(before + 1);
    useDoc.temporal.getState().undo();
    expect('strokeWidth' in useDoc.getState().lines.L1).toBe(false);
  });

  it('the stop-band preview paints two edge-centered rails per segment', () => {
    seed({ strokeWidth: 4, strokeColor: '#ff0000' });
    const { container } = render(<LineInspector id="L1" />);
    const casings = Array.from(container.querySelectorAll('svg line[data-preview-casing]'));
    expect(casings.length).toBe(2); // one segment × two rails
    for (const l of casings) {
      expect(l.getAttribute('stroke')).toBe('#ff0000');
      expect(l.getAttribute('stroke-width')).toBe('4'); // the rail itself
    }
    // Rails straddle the body edges at ±previewW/2 = ±7 around the marker
    // column center (12).
    const xs = casings.map((l) => Number(l.getAttribute('x1'))).sort((a, b) => a - b);
    expect(xs).toEqual([5, 19]);
    // The body paints first; the rails follow it in document order.
    const first = container.querySelector('svg line');
    expect(first?.hasAttribute('data-preview-casing')).toBe(false);
  });

  it('the preview paints no casing for a stroke-less line', () => {
    seed();
    const { container } = render(<LineInspector id="L1" />);
    expect(container.querySelectorAll('[data-preview-casing]').length).toBe(0);
  });
});

describe('<LineInspector /> — waypoint pill', () => {
  beforeEach(() => {
    localStorage.clear();
    useDoc.setState({ ...DEFAULT_DOC });
    useSelection.setState(SELECTION_BLANK);
  });

  const seed = () => {
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [
          makeStation({ id: 's1', name: 'Alpha', stops: [makeStop('L1')] }),
          makeStation({ id: 's2', name: 'Beta', isWaypoint: true, stops: [makeStop('L1')] }),
        ],
        lines: [makeLine({ id: 'L1', stations: ['s1', 's2'] })],
      }),
    });
  };

  it('renders a WP pill only on the waypoint stop, before its name', () => {
    seed();
    const { container } = render(<LineInspector id="L1" />);

    // Exactly one pill — for the waypoint stop only.
    const pills = container.querySelectorAll('.wp-pill');
    expect(pills.length).toBe(1);

    // The pill lives in Beta's row, not Alpha's.
    const betaRow = screen.getByText('Beta').closest('.list-row');
    const alphaRow = screen.getByText('Alpha').closest('.list-row');
    const pill = betaRow?.querySelector('.wp-pill');
    expect(pill).not.toBeNull();
    expect(alphaRow?.querySelector('.wp-pill')).toBeNull();

    // The pill precedes the name within the row.
    // DOCUMENT_POSITION_FOLLOWING = 4: the argument follows the receiver.
    expect(pill!.compareDocumentPosition(screen.getByText('Beta')) & 4).toBe(4);
  });
});

describe('<LineInspector /> — empty line stop-adding', () => {
  beforeEach(() => {
    localStorage.clear();
    useDoc.setState({ ...DEFAULT_DOC });
    useSelection.setState(SELECTION_BLANK);
    useSelection.getState().setUiMode({ kind: 'idle' });
  });

  const seedEmptyLine = () => {
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({ stations: [], lines: [makeLine({ id: 'L1', stations: [] })] }),
    });
  };

  it('shows no insert "+" for an empty line when not editing', () => {
    seedEmptyLine();
    render(<LineInspector id="L1" />);
    expect(screen.queryByRole('button', { name: '+' })).toBeNull();
  });

  it('reveals a single insert "+" while editing an empty line, and clicking it arms the cursor before the first stop', async () => {
    seedEmptyLine();
    useSelection.getState().setAppending('L1');
    useSelection.getState().setInsertAfterIndex(null);
    const user = userEvent.setup();
    render(<LineInspector id="L1" />);

    const plus = screen.getByRole('button', { name: '+' });
    await user.click(plus);

    const ui = useSelection.getState().uiMode;
    expect(ui.kind).toBe('appending-to-line');
    if (ui.kind === 'appending-to-line') expect(ui.insertAfterIndex).toBe(-1);
  });
});

describe('<LineInspector /> — removing a station clears its dangling hover highlights', () => {
  beforeEach(() => {
    localStorage.clear();
    useDoc.setState({ ...DEFAULT_DOC });
    useSelection.setState(SELECTION_BLANK);
    useSelection.getState().setUiMode({ kind: 'idle' });
    useSelection.getState().setHoveredInspectorSegment(null);
    useDoc.temporal.getState().clear();
  });

  const seedTwoStationLine = () => {
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [
          makeStation({ id: 's1', stops: [makeStop('L1')] }),
          makeStation({ id: 's2', stops: [makeStop('L1')] }),
        ],
        lines: [makeLine({ id: 'L1', stations: ['s1', 's2'] })],
      }),
    });
  };

  const seedThreeStationLine = () => {
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [
          makeStation({ id: 's1', stops: [makeStop('L1')] }),
          makeStation({ id: 's2', stops: [makeStop('L1')] }),
          makeStation({ id: 's3', stops: [makeStop('L1')] }),
        ],
        lines: [makeLine({ id: 'L1', stations: ['s1', 's2', 's3'] })],
      }),
    });
  };

  it('clicking "×" on a hovered row clears hoveredLineStop / hoveredStation so undo cannot resurrect a phantom dot halo', () => {
    seedTwoStationLine();
    // Appending mode reveals the per-row remove "×" buttons.
    useSelection.getState().setAppending('L1');
    render(<LineInspector id="L1" />);

    const removeButtons = screen.getAllByTitle('Remove from line');
    expect(removeButtons).toHaveLength(2);
    const s2Remove = removeButtons[1];
    const s2Row = s2Remove.closest('.list-row') as HTMLElement;

    // The user hovers the row to reach its "×" — drives the real hover state
    // that paints the white casing on the (s2, L1) dot.
    fireEvent.mouseEnter(s2Row);
    expect(useSelection.getState().hoveredLineStop).toEqual({ lineId: 'L1', stationId: 's2' });
    expect(useSelection.getState().hoveredStationId).toBe('s2');

    // Removing the row unmounts it WITHOUT firing onMouseLeave.
    fireEvent.click(s2Remove);
    expect(useDoc.getState().lines.L1.stations).toEqual(['s1']);

    // The hover must be cleared, or undo (which restores the stop) re-renders
    // the stale white halo on the dot.
    expect(useSelection.getState().hoveredLineStop).toBeNull();
    expect(useSelection.getState().hoveredStationId).toBeNull();
  });

  it('clicking "×" clears a hovered segment divider whose endpoint is removed, so its corridor wash cannot survive undo', () => {
    seedThreeStationLine();
    // Appending mode reveals the "×" buttons.
    useSelection.getState().setAppending('L1');
    const { container } = render(<LineInspector id="L1" />);

    // Hover the s1|s2 segment divider, exactly as the user would.
    const dividers = container.querySelectorAll('[data-segment-style-divider]');
    expect(dividers).toHaveLength(2);
    fireEvent.mouseEnter(dividers[0]);
    expect(useSelection.getState().hoveredInspectorSegment).toEqual({
      lineId: 'L1',
      fromStationId: 's1',
      toStationId: 's2',
    });

    // Remove s2 — an endpoint of the hovered segment. Its divider unmounts
    // WITHOUT firing onMouseLeave.
    const removeButtons = screen.getAllByTitle('Remove from line');
    fireEvent.click(removeButtons[1]);
    expect(useDoc.getState().lines.L1.stations).toEqual(['s1', 's3']);

    expect(useSelection.getState().hoveredInspectorSegment).toBeNull();
  });

  it('reordering a hovered row (move ↓) clears its hover so the highlight does not dangle on the moved dot', () => {
    seedThreeStationLine();
    // Appending mode reveals the move "↑/↓" buttons.
    useSelection.getState().setAppending('L1');
    render(<LineInspector id="L1" />);

    const downButtons = screen.getAllByTitle('Move down');
    const s2Down = downButtons[1];
    const s2Row = s2Down.closest('.list-row') as HTMLElement;

    fireEvent.mouseEnter(s2Row);
    expect(useSelection.getState().hoveredLineStop).toEqual({ lineId: 'L1', stationId: 's2' });

    // Moving s2 down remounts the rows under the cursor (no onMouseLeave).
    fireEvent.click(s2Down);
    expect(useDoc.getState().lines.L1.stations).toEqual(['s1', 's3', 's2']);

    expect(useSelection.getState().hoveredLineStop).toBeNull();
    expect(useSelection.getState().hoveredStationId).toBeNull();
  });

  it('unmounting the inspector (line deleted, a station selected, panel collapsed) clears lingering hovers', () => {
    seedTwoStationLine();
    const { unmount } = render(<LineInspector id="L1" />);

    // A row + divider hover left set at the moment the inspector goes away —
    // none of their onMouseLeave/onBlur handlers will ever fire.
    act(() => {
      useSelection.getState().setHoveredLineStop({ lineId: 'L1', stationId: 's2' });
      useSelection.getState().setHoveredStation('s2');
      useSelection.getState().setHoveredInspectorSegment({
        lineId: 'L1',
        fromStationId: 's1',
        toStationId: 's2',
      });
    });

    unmount();

    expect(useSelection.getState().hoveredLineStop).toBeNull();
    expect(useSelection.getState().hoveredStationId).toBeNull();
    expect(useSelection.getState().hoveredInspectorSegment).toBeNull();
  });
});
