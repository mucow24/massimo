import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LineInspector } from './LineInspector';
import { useDoc, useSelection } from '../../state/store';
import { useLineEditorPrefs } from '../../state/lineEditorPrefs';
import { historyDepth } from '../../state/history';
import { DEFAULT_DOC } from '../../model/transforms';
import { makeDoc, makeLine, makeStation, makeStop, makeStyle } from '../../test/fixtures';
import { DOT_SHAPE_PRESETS } from '../../model/dotStyle';
import { openColorField } from '../../test/colorField';
import { chooseOption, stepSlider } from '../../test/interaction';

// Most style controls live inside the collapsible style-detail section
// (collapsed by default, remembered) — the describes below expand it up front
// and the collapse behavior itself is pinned in its own describe at the end.
const expandStyleDetail = () => useLineEditorPrefs.setState({ styleExpanded: true });

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

describe('<LineInspector /> — name / service / default-shape (E9)', () => {
  beforeEach(() => {
    localStorage.clear();
    useDoc.setState({ ...DEFAULT_DOC });
    // Reset uiMode too: the Edit-Stops / append flow flips it, and SELECTION_BLANK
    // doesn't carry uiMode, so it would otherwise leak between these tests.
    useSelection.setState({ ...SELECTION_BLANK, uiMode: { kind: 'idle' } });
    useDoc.temporal.getState().clear();
    expandStyleDetail();
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

  it('picking a singleton stop dot shape writes singletonDotStyle only', async () => {
    const user = userEvent.setup();
    seedThree();
    render(<LineInspector id="L1" />);
    await user.click(screen.getByRole('button', { name: 'Singleton stop shape' }));
    await user.click(screen.getByRole('menuitem', { name: 'Open white' }));
    expect(useDoc.getState().lines.L1.singletonDotStyle).toEqual(DOT_SHAPE_PRESETS['open-white']);
    // The shared default is independent — untouched.
    expect('multiDotStyle' in useDoc.getState().lines.L1).toBe(false);
  });

  it('picking a shared stop dot shape writes multiDotStyle only', async () => {
    const user = userEvent.setup();
    seedThree();
    render(<LineInspector id="L1" />);
    await user.click(screen.getByRole('button', { name: 'Interchange stop shape' }));
    await user.click(screen.getByRole('menuitem', { name: 'Filled white' }));
    expect(useDoc.getState().lines.L1.multiDotStyle).toEqual(DOT_SHAPE_PRESETS['filled-white']);
    expect('singletonDotStyle' in useDoc.getState().lines.L1).toBe(false);
  });

  it('renders no Edit Stops button — picking a line IS entering the editor', () => {
    seedThree();
    render(<LineInspector id="L1" />);
    expect(screen.queryByRole('button', { name: 'Edit Stops' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
  });
});

describe('<LineInspector /> — width control', () => {
  beforeEach(() => {
    localStorage.clear();
    useDoc.setState({ ...DEFAULT_DOC });
    useSelection.setState(SELECTION_BLANK);
    useDoc.temporal.getState().clear();
    expandStyleDetail();
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

  it('renders a 2–28 quarter-step slider at the line’s effective width', () => {
    seed();
    render(<LineInspector id="L1" />);
    const slider = screen.getByRole('slider', { name: 'Line width' });
    expect(slider).toHaveAttribute('aria-valuemin', '2');
    expect(slider).toHaveAttribute('aria-valuemax', '28');
    expect(slider).toHaveAttribute('aria-valuenow', '14');
  });

  it('slider edits write the width (quarter steps); the default drops the key', () => {
    seed();
    render(<LineInspector id="L1" />);
    const slider = screen.getByRole('slider', { name: 'Line width' });
    stepSlider(slider, 1); // one step of the 0.25 grid: 14 -> 14.25
    expect(useDoc.getState().lines.L1.width).toBe(14.25);
    stepSlider(slider, -1); // back to the 14 default drops the key
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
    stepSlider(slider, 3); // focus opens the group; three steps inside one arc
    fireEvent.blur(slider);
    expect(historyDepth()).toBe(before + 1);
    useDoc.temporal.getState().undo();
    expect('width' in useDoc.getState().lines.L1).toBe(false);
  });
});

describe('<LineInspector /> — interline gap control', () => {
  beforeEach(() => {
    localStorage.clear();
    useDoc.setState({ ...DEFAULT_DOC });
    useSelection.setState(SELECTION_BLANK);
    useDoc.temporal.getState().clear();
    expandStyleDetail();
  });

  // Two lines packed tangent (rows 0/1 at default width) at both corridor
  // ends — the layout a gap edit must spread without un-merging.
  const seedPair = () => {
    const stops = () => [
      makeStop('L1', { row: 0, col: 0, orientation: 'auto-horizontal' }),
      makeStop('L2', { row: 1, col: 0, orientation: 'auto-horizontal' }),
    ];
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [
          makeStation({ id: 's1', x: 0, y: 0, stops: stops() }),
          makeStation({ id: 's2', x: 200, y: 0, stops: stops() }),
        ],
        lines: [
          makeLine({ id: 'L1', stations: ['s1', 's2'] }),
          makeLine({ id: 'L2', stations: ['s1', 's2'] }),
        ],
      }),
    });
  };

  it('renders a 0–14 quarter-step slider at the effective gap (0 by default)', () => {
    seedPair();
    render(<LineInspector id="L1" />);
    const slider = screen.getByRole('slider', { name: 'Interline gap' });
    expect(slider).toHaveAttribute('aria-valuemin', '0');
    expect(slider).toHaveAttribute('aria-valuemax', '14');
    expect(slider).toHaveAttribute('aria-valuenow', '0');
  });

  it('slider edits write the gap and re-pack the stops; back to 0 drops the key', () => {
    seedPair();
    render(<LineInspector id="L1" />);
    const slider = screen.getByRole('slider', { name: 'Interline gap' });
    stepSlider(slider, 1); // one 0.25 step
    expect(useDoc.getState().lines.L1.interlineGap).toBe(0.25);
    // The packed pair spread symmetrically: spacing 14 → 14.25.
    const rows = useDoc.getState().stations.s1.stops.map((s) => s.row);
    expect(rows[0]).toBeCloseTo(-0.125 / 14, 12);
    expect(rows[1]).toBeCloseTo(14.125 / 14, 12);
    stepSlider(slider, -1); // back to 0 drops the key and re-packs to tangency
    expect('interlineGap' in useDoc.getState().lines.L1).toBe(false);
    const back = useDoc.getState().stations.s1.stops.map((s) => s.row);
    expect(back[0]).toBeCloseTo(0, 12);
    expect(back[1]).toBeCloseTo(1, 12);
  });
});

describe('<LineInspector /> — dash dimension controls', () => {
  beforeEach(() => {
    localStorage.clear();
    useDoc.setState({ ...DEFAULT_DOC });
    useSelection.setState(SELECTION_BLANK);
    useDoc.temporal.getState().clear();
    expandStyleDetail();
  });

  const seedDash = (over: Record<string, unknown> = {}) => {
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [makeStation({ id: 's1', stops: [makeStop('L1')] })],
        // The dash rows only render while a dash dot is in use (see the
        // conditional-rows describe) — seed the singleton default as dash.
        lines: [
          makeLine({
            id: 'L1',
            stations: ['s1'],
            singletonDotStyle: DOT_SHAPE_PRESETS.dash,
            ...over,
          }),
        ],
      }),
    });
  };

  it('shows the width-derived values when unset (length = width, width = width/2)', () => {
    seedDash();
    render(<LineInspector id="L1" />);
    expect(screen.getByRole('slider', { name: 'Dash length' })).toHaveAttribute(
      'aria-valuenow',
      '14',
    );
    expect(screen.getByRole('slider', { name: 'Dash width' })).toHaveAttribute(
      'aria-valuenow',
      '7',
    );
  });

  it('shows explicit stored dims, and slider edits write through the setters', () => {
    seedDash({ dashLength: 21, dashWidth: 3 });
    render(<LineInspector id="L1" />);
    const length = screen.getByRole('slider', { name: 'Dash length' });
    expect(length).toHaveAttribute('aria-valuenow', '21');
    expect(screen.getByRole('slider', { name: 'Dash width' })).toHaveAttribute(
      'aria-valuenow',
      '3',
    );
    stepSlider(length, 1); // one 0.25 step up
    fireEvent.blur(length);
    expect(useDoc.getState().lines.L1.dashLength).toBe(21.25);
  });
});

describe('<LineInspector /> — dot size control', () => {
  beforeEach(() => {
    localStorage.clear();
    useDoc.setState({ ...DEFAULT_DOC });
    useSelection.setState(SELECTION_BLANK);
    useDoc.temporal.getState().clear();
    expandStyleDetail();
  });

  const seed = (sizes?: { singletonDotSize?: number; multiDotSize?: number }) => {
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
          makeLine({ id: 'L1', stations: ['s1', 's2'], ...(sizes ?? {}) }),
        ],
      }),
    });
  };

  it('renders a 0–20 slider for each case at the effective default dot size', () => {
    seed();
    render(<LineInspector id="L1" />);
    for (const name of ['Singleton dot size', 'Interchange dot size']) {
      const slider = screen.getByRole('slider', { name });
      expect(slider).toHaveAttribute('aria-valuemin', '0');
      expect(slider).toHaveAttribute('aria-valuemax', '20');
      expect(slider).toHaveAttribute('aria-valuenow', '8');
    }
  });

  it('each dot case shares one row with its picker, in renamed captioned fields', () => {
    seed();
    render(<LineInspector id="L1" />);
    const singleton = screen.getByText('Singleton (One line stops)');
    const picker = screen.getByRole('button', { name: 'Singleton stop shape' });
    const slider = screen.getByRole('slider', { name: 'Singleton dot size' });
    // DOCUMENT_POSITION_FOLLOWING = 4: the argument follows the receiver.
    expect(singleton.compareDocumentPosition(picker) & 4).toBe(4);
    // The picker and the size slider live in the same row.
    expect(picker.closest('.options-popover-row')).toBe(slider.closest('.options-popover-row'));
    // The interchange field follows the singleton one.
    const shared = screen.getByText('Interchange (Multiple lines stop)');
    expect(singleton.compareDocumentPosition(shared) & 4).toBe(4);
  });

  it('the two sliders write their own field independently; the default drops the key', () => {
    seed();
    render(<LineInspector id="L1" />);
    const singleton = screen.getByRole('slider', { name: 'Singleton dot size' });
    stepSlider(singleton, 1); // one 0.25 step: 8 -> 8.25
    expect(useDoc.getState().lines.L1.singletonDotSize).toBe(8.25);
    expect('multiDotSize' in useDoc.getState().lines.L1).toBe(false);

    const shared = screen.getByRole('slider', { name: 'Interchange dot size' });
    stepSlider(shared, 2); // two 0.25 steps: 8 -> 8.5
    expect(useDoc.getState().lines.L1.multiDotSize).toBe(8.5);
    // Singleton unaffected by the shared edit.
    expect(useDoc.getState().lines.L1.singletonDotSize).toBe(8.25);

    stepSlider(singleton, -1); // back to the 8 default drops the key
    expect('singletonDotSize' in useDoc.getState().lines.L1).toBe(false);
  });

  it('the spinbutton floors at 0 and is uncapped above the slider max', () => {
    seed();
    render(<LineInspector id="L1" />);
    const spin = screen.getByRole('spinbutton', { name: 'Singleton dot size' });
    expect(spin.getAttribute('min')).toBe('0');
    expect(spin.getAttribute('max')).toBeNull();
    fireEvent.change(spin, { target: { value: '32' } });
    expect(useDoc.getState().lines.L1.singletonDotSize).toBe(32);
  });

  it('one slider focus-arc collapses to a single undo entry', () => {
    seed();
    useDoc.temporal.getState().clear();
    render(<LineInspector id="L1" />);
    const slider = screen.getByRole('slider', { name: 'Singleton dot size' });
    const before = historyDepth();
    stepSlider(slider, 3); // focus opens the group; three steps inside one arc
    fireEvent.blur(slider);
    expect(historyDepth()).toBe(before + 1);
    useDoc.temporal.getState().undo();
    expect('singletonDotSize' in useDoc.getState().lines.L1).toBe(false);
  });
});

describe('<LineInspector /> — stroke controls', () => {
  beforeEach(() => {
    localStorage.clear();
    useDoc.setState({ ...DEFAULT_DOC });
    useSelection.setState(SELECTION_BLANK);
    useDoc.temporal.getState().clear();
    expandStyleDetail();
  });

  const seed = (
    over: {
      color?: string;
      strokeWidth?: number;
      strokeColor?: string;
      seamColor?: string;
      seamWidth?: number;
    } = {},
  ) => {
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

  it('renders a 0–10 quarter-step slider at the line’s effective stroke width', () => {
    seed();
    render(<LineInspector id="L1" />);
    const slider = screen.getByRole('slider', { name: 'Stroke width' });
    expect(slider).toHaveAttribute('aria-valuemin', '0');
    expect(slider).toHaveAttribute('aria-valuemax', '10');
    expect(slider).toHaveAttribute('aria-valuenow', '0');
  });

  it('slider edits write the stroke width (quarter steps included); zero drops the key', () => {
    seed();
    render(<LineInspector id="L1" />);
    const slider = screen.getByRole('slider', { name: 'Stroke width' });
    stepSlider(slider, 3); // three steps of the 0.25 grid: 0 -> 0.75
    expect(useDoc.getState().lines.L1.strokeWidth).toBe(0.75);
    stepSlider(slider, -3); // back to 0 drops the key
    expect('strokeWidth' in useDoc.getState().lines.L1).toBe(false);
  });

  it('the spinbutton steps by 0.25 and is uncapped above the slider max', () => {
    seed();
    render(<LineInspector id="L1" />);
    const spin = screen.getByRole('spinbutton', { name: 'Stroke width' });
    expect(spin.getAttribute('min')).toBe('0');
    expect(spin.getAttribute('max')).toBeNull();
    expect(spin.getAttribute('step')).toBe('0.25');
    fireEvent.change(spin, { target: { value: '30' } });
    expect(useDoc.getState().lines.L1.strokeWidth).toBe(30);
  });

  it('the color picker reflects the effective stroke color and writes edits', async () => {
    const user = userEvent.setup();
    // A nonzero width: the color row only renders while the casing is on.
    seed({ strokeWidth: 2, strokeColor: '#ff0000' });
    render(<LineInspector id="L1" />);
    const input = await openColorField(user, 'Stroke color');
    expect(input).toHaveValue('#ff0000');
    fireEvent.change(input, { target: { value: '#00aa55' } });
    expect(useDoc.getState().lines.L1.strokeColor).toBe('#00aa55');
    // Picking the default drops the key (never stored).
    fireEvent.change(input, { target: { value: '#ffffff' } });
    expect('strokeColor' in useDoc.getState().lines.L1).toBe(false);
  });

  it('defaults the color picker to white when the casing is on but colorless', async () => {
    const user = userEvent.setup();
    seed({ strokeWidth: 4 });
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

  // A line style can set the casing/seam to the LINE_OWN_COLOR sentinel and
  // stamp it onto its lines, so the inspector must cope with a stored 'line'.
  // The sentinel is not a color: show what's actually PAINTED, never the word.
  it("shows the line's own color in both pickers when they follow it ('line')", async () => {
    const user = userEvent.setup();
    seed({ color: '#123456', strokeWidth: 4, strokeColor: 'line', seamColor: 'line' });
    render(<LineInspector id="L1" />);
    expect(await openColorField(user, 'Stroke color')).toHaveValue('#123456');
    expect(await openColorField(user, 'Seam color')).toHaveValue('#123456');
  });

  it('seeds the seam picker at the casing hue with zero alpha when off (reads as off)', async () => {
    const user = userEvent.setup();
    seed({ strokeWidth: 4, strokeColor: '#123456' });
    render(<LineInspector id="L1" />);
    expect(await openColorField(user, 'Seam color')).toHaveValue('#12345600');
  });

  it('the Seam width slider inherits the casing width when unset, and writes edits', () => {
    seed({ strokeWidth: 4 }); // casing 4, no seam width
    render(<LineInspector id="L1" />);
    const slider = screen.getByRole('slider', { name: 'Seam width' });
    expect(slider).toHaveAttribute('aria-valuenow', '4'); // inherits the casing rail width
    stepSlider(slider, -8); // eight steps of the 0.25 grid: 4 -> 2
    expect(useDoc.getState().lines.L1.seamWidth).toBe(2);
    // Back to 0 drops the field → inherits the casing width again.
    stepSlider(slider, -8);
    expect('seamWidth' in useDoc.getState().lines.L1).toBe(false);
  });

  it('one slider focus-arc collapses to a single undo entry', () => {
    seed();
    useDoc.temporal.getState().clear();
    render(<LineInspector id="L1" />);
    const slider = screen.getByRole('slider', { name: 'Stroke width' });
    const before = historyDepth();
    stepSlider(slider, 3); // focus opens the group; three steps inside one arc
    fireEvent.blur(slider);
    expect(historyDepth()).toBe(before + 1);
    useDoc.temporal.getState().undo();
    expect('strokeWidth' in useDoc.getState().lines.L1).toBe(false);
  });
});

describe('<LineInspector /> — collapsible style detail', () => {
  beforeEach(() => {
    localStorage.clear();
    useDoc.setState({ ...DEFAULT_DOC });
    useSelection.setState(SELECTION_BLANK);
    useDoc.temporal.getState().clear();
    useLineEditorPrefs.setState({ styleExpanded: false });
  });

  const seed = (lineOver: Record<string, unknown> = {}, stopOver: Record<string, unknown> = {}) => {
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        stations: [
          makeStation({ id: 's1', stops: [makeStop('L1', stopOver)] }),
          makeStation({ id: 's2', stops: [makeStop('L1')] }),
        ],
        lines: [makeLine({ id: 'L1', stations: ['s1', 's2'], ...lineOver })],
      }),
    });
  };

  it('collapsed by default: identity + Style row visible, the parameter stack hidden', () => {
    seed();
    render(<LineInspector id="L1" />);
    expect(screen.getByText('Line name')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Style' })).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: /style detail/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    for (const name of ['Line width', 'Curve radius', 'Seam width']) {
      expect(screen.queryByRole('slider', { name })).toBeNull();
    }
    expect(screen.queryByRole('button', { name: 'Singleton stop shape' })).toBeNull();
  });

  it('the toggle expands the section and the preference is remembered', () => {
    seed();
    render(<LineInspector id="L1" />);
    fireEvent.click(screen.getByRole('button', { name: /style detail/i }));
    expect(screen.getByRole('slider', { name: 'Line width' })).toBeInTheDocument();
    // Remembered — the pref store persists it for the next popover/reload.
    expect(useLineEditorPrefs.getState().styleExpanded).toBe(true);
  });

  it('orders the expanded stack: geometry, dots (with header), stroke, seam', () => {
    seed();
    expandStyleDetail();
    render(<LineInspector id="L1" />);
    const order = [
      screen.getByRole('slider', { name: 'Line width' }),
      screen.getByRole('slider', { name: 'Interline gap' }),
      screen.getByRole('slider', { name: 'Curve radius' }),
      screen.getByText('Station stop dot types and sizes'),
      screen.getByText('Singleton (One line stops)'),
      screen.getByText('Interchange (Multiple lines stop)'),
      screen.getByRole('slider', { name: 'Stroke width' }),
      screen.getByRole('slider', { name: 'Seam width' }),
    ];
    for (let i = 0; i + 1 < order.length; i++) {
      // DOCUMENT_POSITION_FOLLOWING = 4: the argument follows the receiver.
      expect(order[i].compareDocumentPosition(order[i + 1]) & 4).toBe(4);
    }
  });

  it('dash rows render only while a dash dot is in use (line default or stop override)', () => {
    seed();
    expandStyleDetail();
    const { unmount } = render(<LineInspector id="L1" />);
    expect(screen.queryByRole('slider', { name: 'Dash length' })).toBeNull();
    expect(screen.queryByRole('slider', { name: 'Dash width' })).toBeNull();
    unmount();

    // Line-level default: the singleton case is dash.
    seed({ singletonDotStyle: DOT_SHAPE_PRESETS.dash });
    const second = render(<LineInspector id="L1" />);
    expect(screen.getByRole('slider', { name: 'Dash length' })).toBeInTheDocument();
    second.unmount();

    // Per-stop override on a member stop, with non-dash line defaults.
    seed({}, { dotStyle: DOT_SHAPE_PRESETS.dash });
    render(<LineInspector id="L1" />);
    expect(screen.getByRole('slider', { name: 'Dash width' })).toBeInTheDocument();
  });

  it('the stroke color row renders only while the stroke width is > 0', () => {
    seed();
    expandStyleDetail();
    const { unmount } = render(<LineInspector id="L1" />);
    expect(screen.queryByText('Stroke color')).toBeNull();
    unmount();

    seed({ strokeWidth: 2 });
    render(<LineInspector id="L1" />);
    expect(screen.getByText('Stroke color')).toBeInTheDocument();
  });
});

describe('<LineInspector /> — style presets', () => {
  beforeEach(() => {
    localStorage.clear();
    useDoc.setState({ ...DEFAULT_DOC });
    useSelection.setState(SELECTION_BLANK);
    expandStyleDetail();
  });

  it('applies a preset from the Style row, then flips to Custom on a covered edit', async () => {
    useDoc.setState({
      ...DEFAULT_DOC,
      ...makeDoc({
        lines: [makeLine({ id: 'L1' })],
        styles: [makeStyle('line', 'y1', { name: 'Thick', props: { width: 12 } })],
      }),
    });
    render(<LineInspector id="L1" />);
    await chooseOption(userEvent.setup(), 'Style', 'Thick');
    expect(useDoc.getState().lines['L1']).toMatchObject({ width: 12, styleId: 'y1' });
    expect(screen.getByRole('combobox', { name: 'Style' })).toHaveTextContent('Thick');
    // A covered edit (line width) detaches; name/service/color stay identity.
    stepSlider(screen.getByRole('slider', { name: 'Line width' }), 1);
    expect(useDoc.getState().lines['L1'].styleId).toBeUndefined();
    expect(screen.getByRole('combobox', { name: 'Style' })).toHaveTextContent('Custom');
  });
});
