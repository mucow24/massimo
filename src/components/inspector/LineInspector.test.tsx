import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LineInspector } from './LineInspector';
import { useDoc, useSelection } from '../../state/store';
import { historyDepth } from '../../state/history';
import { DEFAULT_DOC } from '../../model/transforms';
import { makeDoc, makeLine, makeStation, makeStop, makeStyle } from '../../test/fixtures';
import { DOT_SHAPE_PRESETS } from '../../model/dotStyle';
import { openColorField } from '../../test/colorField';
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

describe('<LineInspector /> — name / service / default-shape (E9)', () => {
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
    const slider = screen.getByRole('slider', { name: 'Dot size' });
    expect(slider).toHaveAttribute('aria-valuemin', '0');
    expect(slider).toHaveAttribute('aria-valuemax', '20');
    expect(slider).toHaveAttribute('aria-valuenow', '8');
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
    stepSlider(slider, 1); // 8 -> 9
    expect(useDoc.getState().lines.L1.defaultDotSize).toBe(9);
    stepSlider(slider, -1); // back to the 8 default drops the key
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
    stepSlider(slider, 3); // focus opens the group; three steps inside one arc
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

  const seed = (
    over: {
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

describe('<LineInspector /> — style presets', () => {
  beforeEach(() => {
    localStorage.clear();
    useDoc.setState({ ...DEFAULT_DOC });
    useSelection.setState(SELECTION_BLANK);
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
