import { describe, it, expect, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LineInspector } from './LineInspector';
import { useDoc, useSelection } from '../../state/store';
import { historyDepth } from '../../state/history';
import { DEFAULT_DOC } from '../../model/transforms';
import { makeDoc, makeLine, makeStation, makeStop, makeStyle } from '../../test/fixtures';
import { DOT_SHAPE_PRESETS } from '../../model/dotStyle';
import { openColorField } from '../../test/colorField';

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
    // The inline dividers are the EDIT-mode segment UI (the view shows the
    // graph, whose connectors are clickable instead), so edit the line.
    useSelection.getState().setAppending('L1');
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

  it('clicking a graph connector cycles that segment: solid → dashed → … → solid', () => {
    seedThreeStationLine();
    const { container } = render(<LineInspector id="L1" />);
    // The first connector (transparent hit-target) is the s1|s2 corridor.
    const conn = container.querySelectorAll('path[stroke="transparent"]')[0];
    for (const style of ['dashed', 'hatched', 'hatched-mirror', 'dotted', 'dashed-open']) {
      fireEvent.click(conn);
      expect(useDoc.getState().lines.L1.segmentStyles).toEqual({ 's1|s2': style });
    }
    fireEvent.click(conn);
    expect(useDoc.getState().lines.L1.segmentStyles).toEqual({}); // back to solid → dropped
  });

  it('right-clicking a graph connector removes that edge (e.g. opening a loop)', () => {
    // Loop s1-s2-s3-s1; the wrap edge s1|s3 is a labelled connector.
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [
          makeStation({ id: 's1', stops: [makeStop('L1')] }),
          makeStation({ id: 's2', stops: [makeStop('L1')] }),
          makeStation({ id: 's3', stops: [makeStop('L1')] }),
        ],
        lines: [
          makeLine({ id: 'L1', stations: ['s1', 's2', 's3'], edges: ['s1|s2', 's2|s3', 's1|s3'] }),
        ],
      }),
    });
    const { container } = render(<LineInspector id="L1" />);
    const title = Array.from(container.querySelectorAll('title')).find((t) =>
      /Segment s1 → s3/.test(t.textContent ?? ''),
    );
    expect(title).toBeTruthy();
    fireEvent.contextMenu(title!.parentElement!);
    // The loop is opened: the wrap edge is gone, the s1-s2-s3 path remains.
    expect(new Set(useDoc.getState().lines.L1.edges)).toEqual(new Set(['s1|s2', 's2|s3']));
  });
});

describe('<LineInspector /> — name / service / default-shape / station-list (E9)', () => {
  beforeEach(() => {
    localStorage.clear();
    useDoc.setState({ ...DEFAULT_DOC });
    // Reset uiMode too: the Edit-Stops / append flow flips it, and SELECTION_BLANK
    // doesn't carry uiMode, so it would otherwise leak between these tests.
    useSelection.setState({ ...SELECTION_BLANK, uiMode: { kind: 'idle' } });
    useDoc.temporal.getState().clear();
  });

  const seedThree = () => {
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [
          makeStation({ id: 's1', name: 'One', stops: [makeStop('L1')] }),
          makeStation({ id: 's2', name: 'Two', stops: [makeStop('L1')] }),
          makeStation({ id: 's3', name: 'Three', stops: [makeStop('L1')] }),
        ],
        lines: [makeLine({ id: 'L1', service: 'A', stations: ['s1', 's2', 's3'] })],
      }),
    });
  };

  // Labels in this inspector aren't htmlFor-associated; find the text input
  // that follows a given <label> within its .field wrapper.
  const fieldInput = (labelText: string): HTMLInputElement => {
    const label = screen.getByText(labelText);
    const input = label.parentElement?.querySelector('input[type="text"]') as HTMLInputElement;
    if (!input) throw new Error(`no text input for field "${labelText}"`);
    return input;
  };

  it('renders station-list names as cleaned plain text (tags stripped, bullets dropped, symbols except <xfer>)', () => {
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [
          makeStation({ id: 's1', name: '<b>Foo</b> |A| Bar<tm><xfer>', stops: [makeStop('L1')] }),
        ],
        lines: [makeLine({ id: 'L1', service: 'A', stations: ['s1'] })],
      }),
    });
    const { container } = render(<LineInspector id="L1" />);

    const nameCell = container.querySelector('.list-row .grow');
    expect(nameCell?.textContent).toBe('Foo Bar™');
    expect(container.querySelector('[data-inline-bullet]')).toBeNull();
  });

  it('the Line name input writes through updateLine({name})', () => {
    seedThree();
    render(<LineInspector id="L1" />);
    fireEvent.change(fieldInput('Line name'), { target: { value: 'Crosstown' } });
    expect(useDoc.getState().lines.L1.name).toBe('Crosstown');
  });

  it('the Service code input upper-cases its value before writing', () => {
    seedThree();
    render(<LineInspector id="L1" />);
    fireEvent.change(fieldInput('Service code'), { target: { value: 'bd' } });
    // .toUpperCase() normalization (LineInspector.tsx:218).
    expect(useDoc.getState().lines.L1.service).toBe('BD');
  });

  it('picking a default stop dot shape writes setLineDefaultDotStyle', async () => {
    const user = userEvent.setup();
    seedThree();
    render(<LineInspector id="L1" />);
    // The default-dot picker trigger is the only "Stop shape" button.
    await user.click(screen.getByRole('button', { name: 'Stop shape' }));
    await user.click(screen.getByRole('menuitem', { name: 'Open white' }));
    expect(useDoc.getState().lines.L1.defaultDotStyle).toEqual(DOT_SHAPE_PRESETS['open-white']);
  });

  it('the station-list remove button drops the stop via removeStationFromLine', async () => {
    const user = userEvent.setup();
    seedThree();
    render(<LineInspector id="L1" />);
    await user.click(screen.getByRole('button', { name: 'Edit Stops' }));
    const removes = screen.getAllByTitle('Remove from line');
    await user.click(removes[1]); // remove the middle station
    expect(useDoc.getState().lines.L1.stations).toEqual(['s1', 's3']);
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
    const slider = screen.getByRole('slider', { name: 'Line width' }) as HTMLInputElement;
    expect(slider.getAttribute('min')).toBe('2');
    expect(slider.getAttribute('max')).toBe('28');
    expect(slider.getAttribute('step')).toBe('1');
    expect(slider.value).toBe('14');
  });

  it('slider edits write the width; the default drops the key', () => {
    seed();
    render(<LineInspector id="L1" />);
    const slider = screen.getByRole('slider', { name: 'Line width' });
    fireEvent.change(slider, { target: { value: '20' } });
    expect(useDoc.getState().lines.L1.width).toBe(20);
    fireEvent.change(slider, { target: { value: '14' } });
    expect('width' in useDoc.getState().lines.L1).toBe(false);
  });

  it('the spinbutton floors at 1 and is uncapped above the slider max', () => {
    seed();
    render(<LineInspector id="L1" />);
    const spin = screen.getByRole('spinbutton', { name: 'Line width' });
    expect(spin.getAttribute('min')).toBe('1');
    expect(spin.getAttribute('max')).toBeNull();
    fireEvent.change(spin, { target: { value: '40' } });
    expect(useDoc.getState().lines.L1.width).toBe(40);
  });

  it('one slider focus-arc collapses to a single undo entry', () => {
    seed();
    useDoc.temporal.getState().clear();
    render(<LineInspector id="L1" />);
    const slider = screen.getByRole('slider', { name: 'Line width' });
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

  it('shares one row with the dot-shape picker, under a caption below Color', () => {
    seed();
    render(<LineInspector id="L1" />);
    const color = screen.getByText('Color');
    const caption = screen.getByText('Default stop dot type and size');
    const picker = screen.getByRole('button', { name: 'Stop shape' });
    const slider = screen.getByRole('slider', { name: 'Dot size' });
    // DOCUMENT_POSITION_FOLLOWING = 4: the argument follows the receiver.
    // Color precedes the caption, which precedes the combined dot row.
    expect(color.compareDocumentPosition(caption) & 4).toBe(4);
    expect(caption.compareDocumentPosition(picker) & 4).toBe(4);
    expect(color.compareDocumentPosition(slider) & 4).toBe(4);
    // The picker and the size slider live in the same row.
    expect(picker.closest('.options-popover-row')).toBe(slider.closest('.options-popover-row'));
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

  const seed = (over: { strokeWidth?: number; strokeColor?: string; seamColor?: string } = {}) => {
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
    const slider = screen.getByRole('slider', { name: 'Stroke width' }) as HTMLInputElement;
    expect(slider.getAttribute('min')).toBe('0');
    expect(slider.getAttribute('max')).toBe('10');
    expect(slider.getAttribute('step')).toBe('0.5');
    expect(slider.value).toBe('0');
  });

  it('slider edits write the stroke width (half steps included); zero drops the key', () => {
    seed();
    render(<LineInspector id="L1" />);
    const slider = screen.getByRole('slider', { name: 'Stroke width' });
    fireEvent.change(slider, { target: { value: '1.5' } });
    expect(useDoc.getState().lines.L1.strokeWidth).toBe(1.5);
    fireEvent.change(slider, { target: { value: '0' } });
    expect('strokeWidth' in useDoc.getState().lines.L1).toBe(false);
  });

  it('the spinbutton steps by 0.5 and is uncapped above the slider max', () => {
    seed();
    render(<LineInspector id="L1" />);
    const spin = screen.getByRole('spinbutton', { name: 'Stroke width' });
    expect(spin.getAttribute('min')).toBe('0');
    expect(spin.getAttribute('max')).toBeNull();
    expect(spin.getAttribute('step')).toBe('0.5');
    fireEvent.change(spin, { target: { value: '30' } });
    expect(useDoc.getState().lines.L1.strokeWidth).toBe(30);
  });

  it('the color picker reflects the effective stroke color and writes edits', async () => {
    const user = userEvent.setup();
    seed({ strokeColor: '#ff0000' });
    render(<LineInspector id="L1" />);
    const input = await openColorField(user, 'Stroke color');
    expect(input).toHaveValue('#ff0000');
    fireEvent.change(input, { target: { value: '#00aa55' } });
    expect(useDoc.getState().lines.L1.strokeColor).toBe('#00aa55');
    // Picking the default drops the key (never stored).
    fireEvent.change(input, { target: { value: '#ffffff' } });
    expect('strokeColor' in useDoc.getState().lines.L1).toBe(false);
  });

  it('defaults the color picker to white for a stroke-less line', async () => {
    const user = userEvent.setup();
    seed();
    render(<LineInspector id="L1" />);
    expect(await openColorField(user, 'Stroke color')).toHaveValue('#ffffff');
  });

  it('the seam color picker writes translucent edits and drops a transparent (off) pick', async () => {
    const user = userEvent.setup();
    seed({ strokeWidth: 4, seamColor: '#abcdef80' });
    render(<LineInspector id="L1" />);
    const input = await openColorField(user, 'Seam color');
    expect(input).toHaveValue('#abcdef80');
    fireEvent.change(input, { target: { value: '#00aa5580' } });
    expect(useDoc.getState().lines.L1.seamColor).toBe('#00aa5580');
    // Dragging alpha to zero (fully transparent) turns the seam OFF → key dropped.
    fireEvent.change(input, { target: { value: '#00aa5500' } });
    expect('seamColor' in useDoc.getState().lines.L1).toBe(false);
  });

  it('seeds the seam picker at the casing hue with zero alpha when off (reads as off)', async () => {
    const user = userEvent.setup();
    seed({ strokeWidth: 4, strokeColor: '#123456' });
    render(<LineInspector id="L1" />);
    expect(await openColorField(user, 'Seam color')).toHaveValue('#12345600');
  });

  it('one slider focus-arc collapses to a single undo entry', () => {
    seed();
    useDoc.temporal.getState().clear();
    render(<LineInspector id="L1" />);
    const slider = screen.getByRole('slider', { name: 'Stroke width' });
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

  it('renders no WP pill in the line stop list, even for a waypoint stop', () => {
    seed();
    const { container } = render(<LineInspector id="L1" />);

    // The waypoint pill lives in the station list, not the line's stop list.
    expect(container.querySelectorAll('.wp-pill').length).toBe(0);
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

  const INSERT_LABEL = 'Insert stops after this stop (in-line)';

  it('shows no insert button for an empty line when not editing', () => {
    seedEmptyLine();
    render(<LineInspector id="L1" />);
    expect(screen.queryByRole('button', { name: INSERT_LABEL })).toBeNull();
  });

  it('reveals a single insert button while editing an empty line, and clicking it arms the cursor before the first stop', async () => {
    seedEmptyLine();
    useSelection.getState().setAppending('L1');
    useSelection.getState().setInsertAfterIndex(null);
    const user = userEvent.setup();
    render(<LineInspector id="L1" />);

    // An empty line has no stop to branch from, so only the insert button shows.
    expect(screen.queryByRole('button', { name: 'Start a new branch from this stop' })).toBeNull();
    const plus = screen.getByRole('button', { name: INSERT_LABEL });
    await user.click(plus);

    const ui = useSelection.getState().uiMode;
    expect(ui.kind).toBe('appending-to-line');
    if (ui.kind === 'appending-to-line') expect(ui.insertAfterIndex).toBe(-1);
  });
});

describe('<LineInspector /> — branch button (draw mode)', () => {
  beforeEach(() => {
    localStorage.clear();
    useDoc.setState({ ...DEFAULT_DOC });
    useSelection.setState(SELECTION_BLANK);
    useSelection.getState().setUiMode({ kind: 'idle' });
  });

  it('the per-stop Branch button arms draw mode with the pen on that stop', async () => {
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
    useSelection.getState().setAppending('L1');
    const user = userEvent.setup();
    render(<LineInspector id="L1" />);

    await user.click(screen.getByRole('button', { name: 'Branch from s1' }));

    const ui = useSelection.getState().uiMode;
    expect(ui.kind).toBe('appending-to-line');
    if (ui.kind === 'appending-to-line') {
      expect(ui.draw).toBe(true);
      expect(ui.insertAfterIndex).toBe(0); // pen on s1 (index 0)
    }
  });
});

describe('<LineInspector /> — branch/loop segment styles', () => {
  beforeEach(() => {
    localStorage.clear();
    useDoc.setState({ ...DEFAULT_DOC });
    useSelection.setState(SELECTION_BLANK);
    useSelection.getState().setUiMode({ kind: 'idle' });
  });

  it('a branch leg (off the display chain) is style-settable via its graph connector', () => {
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [
          makeStation({ id: 's1', stops: [makeStop('L1')] }),
          makeStation({ id: 's2', stops: [makeStop('L1')] }),
          makeStation({ id: 's3', stops: [makeStop('L1')] }),
          makeStation({ id: 's4', stops: [makeStop('L1')] }),
        ],
        // Trunk s1-s2-s3 + branch leg s2-s4 (s2|s4 is NOT display-consecutive).
        lines: [
          makeLine({
            id: 'L1',
            stations: ['s1', 's2', 's3', 's4'],
            edges: ['s1|s2', 's2|s3', 's2|s4'],
          }),
        ],
      }),
    });
    const { container } = render(<LineInspector id="L1" />);
    // The branch leg is a labelled connector in the graph; click it to cycle.
    const title = Array.from(container.querySelectorAll('title')).find((t) =>
      /Segment s2 → s4/.test(t.textContent ?? ''),
    );
    expect(title).toBeTruthy();
    fireEvent.click(title!.parentElement!);
    // Cycling stored a non-solid style for the branch leg (solid is never stored).
    expect(useDoc.getState().lines.L1.segmentStyles?.['s2|s4']).toBeDefined();
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

  it('removing a stop clears a hovered graph connector, so its corridor wash cannot survive undo', () => {
    seedThreeStationLine();
    // Appending mode reveals the "×" buttons.
    useSelection.getState().setAppending('L1');
    const { container } = render(<LineInspector id="L1" />);

    // Hover the s1|s2 connector (the first transparent hit-target).
    const conn = container.querySelectorAll('path[stroke="transparent"]')[0];
    fireEvent.mouseEnter(conn);
    expect(useSelection.getState().hoveredInspectorSegment).toEqual({
      lineId: 'L1',
      fromStationId: 's1',
      toStationId: 's2',
    });

    // Remove s2 — an endpoint of the hovered segment. Its connector unmounts
    // WITHOUT firing onMouseLeave.
    const removeButtons = screen.getAllByTitle('Remove from line');
    fireEvent.click(removeButtons[1]);
    expect(useDoc.getState().lines.L1.stations).toEqual(['s1', 's3']);

    expect(useSelection.getState().hoveredInspectorSegment).toBeNull();
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

describe('<LineInspector /> — style presets', () => {
  beforeEach(() => {
    localStorage.clear();
    useDoc.setState({ ...DEFAULT_DOC });
    useSelection.setState(SELECTION_BLANK);
  });

  it('applies a preset from the Style row, then flips to Custom on a covered edit', () => {
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        lines: [makeLine({ id: 'L1' })],
        styles: [makeStyle('line', 'y1', { name: 'Thick', props: { width: 12 } })],
      }),
    });
    render(<LineInspector id="L1" />);
    const select = screen.getByRole('combobox', { name: 'Style' });
    fireEvent.change(select, { target: { value: 'y1' } });
    expect(useDoc.getState().lines['L1']).toMatchObject({ width: 12, styleId: 'y1' });
    expect(select).toHaveValue('y1');
    // A covered edit (line width) detaches; name/service/color stay identity.
    fireEvent.change(screen.getByRole('slider', { name: 'Line width' }), {
      target: { value: '14' },
    });
    expect(useDoc.getState().lines['L1'].styleId).toBeUndefined();
    expect(select).toHaveValue('__custom__');
  });
});
