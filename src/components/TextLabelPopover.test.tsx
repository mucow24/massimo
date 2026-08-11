import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextLabelPopover, TEXT_LABEL_ALIGN_CHIPS } from './TextLabelPopover';
import { useDoc } from '../state/store';
import { useLabelEditorPrefs } from '../state/labelEditorPrefs';
import { DEFAULT_DOC, TEXT_LABEL_ALIGNS, TEXT_LABEL_WIDTH_MAX } from '../model/transforms';
import { makeStyle, makeTextLabel } from '../test/fixtures';
import { openColorField, setColorField } from '../test/colorField';
import { chooseOption, stepSlider } from '../test/interaction';

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
});

describe('<TextLabelPopover /> — day/night color pickers', () => {
  function seedAndRender(
    label = makeTextLabel({ id: 'g1', color: '#112233', darkColor: '#445566' }),
  ) {
    useDoc.setState({
      ...useDoc.getState(),
      textLabels: { g1: label },
    });
    return render(
      <TextLabelPopover
        label={useDoc.getState().textLabels['g1']}
        hostW={800}
        onClose={() => {}}
      />,
    );
  }

  it('renders day + night pickers initialized to the label colors', async () => {
    const user = userEvent.setup();
    seedAndRender();
    expect(await openColorField(user, 'Label color')).toHaveValue('#112233');
    await user.keyboard('{Escape}');
    expect(await openColorField(user, 'Dark mode label color')).toHaveValue('#445566');
  });

  it('editing the day color writes color, leaving darkColor alone', async () => {
    const user = userEvent.setup();
    seedAndRender();
    await setColorField(user, 'Label color', '#0a0a0a');
    expect(useDoc.getState().textLabels['g1'].color).toBe('#0a0a0a');
    expect(useDoc.getState().textLabels['g1'].darkColor).toBe('#445566');
  });

  it('editing the night color writes darkColor, leaving color alone', async () => {
    const user = userEvent.setup();
    seedAndRender();
    await setColorField(user, 'Dark mode label color', '#fafafa');
    expect(useDoc.getState().textLabels['g1'].darkColor).toBe('#fafafa');
    expect(useDoc.getState().textLabels['g1'].color).toBe('#112233');
  });
});

describe('<TextLabelPopover /> — text / size / align / weight controls', () => {
  // Subscribe to the live store label, like the real mount (ItemPopovers)
  // does — successive slider steps must see each other's writes.
  function LiveControlsPopover({ onClose }: { onClose: () => void }) {
    const label = useDoc((s) => s.textLabels['g1']);
    return label ? <TextLabelPopover label={label} hostW={800} onClose={onClose} /> : null;
  }

  function seedAndRender(onClose = () => {}) {
    const label = makeTextLabel({ id: 'g1', text: 'Hi', fontSize: 16, weight: 400, align: 'left' });
    useDoc.setState({ ...useDoc.getState(), textLabels: { g1: label } });
    render(<LiveControlsPopover onClose={onClose} />);
  }

  it('edits the label text', () => {
    seedAndRender();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Hello' } });
    expect(useDoc.getState().textLabels['g1'].text).toBe('Hello');
  });

  it('lays out the controls top-to-bottom with two section dividers (Text stays pinned at top)', () => {
    const label = makeTextLabel({ id: 'g1', text: 'Hi', fontSize: 16, weight: 400, align: 'left' });
    useDoc.setState({ ...useDoc.getState(), textLabels: { g1: label } });
    const { container } = render(
      <TextLabelPopover
        label={useDoc.getState().textLabels['g1']}
        hostW={800}
        onClose={() => {}}
      />,
    );
    const body = container.querySelector('.text-label-popover .body') as HTMLElement;
    // Map each body row to a token: dividers to 'divider', control rows to their
    // label text, the footer (no label) to 'footer'. Locks order + divider spots.
    const sequence = Array.from(body.children).map((child) =>
      child.tagName === 'HR' ? 'divider' : (child.querySelector('label')?.textContent ?? 'footer'),
    );
    expect(sequence).toEqual([
      'Text',
      'Wrap',
      'Style',
      'divider',
      'Color',
      'Size',
      'Weight',
      'divider',
      'Align',
      'Width',
      'divider',
      'Leading',
      'Tracking',
      'footer',
    ]);
  });

  it('changes the font size via the range slider', () => {
    seedAndRender();
    stepSlider(screen.getByRole('slider', { name: 'Size' }), 1);
    expect(useDoc.getState().textLabels['g1'].fontSize).toBe(16.25);
  });

  it('the size slider and spinbutton step by 0.25 and the box shows two decimals', () => {
    seedAndRender();
    const spin = screen.getByRole('spinbutton', { name: 'Size' }) as HTMLInputElement;
    expect(spin.getAttribute('step')).toBe('0.25');
    expect(spin.value).toBe('16.00');
    // The slider's step grid is behavioral now (a Radix thumb has no step
    // attribute): one arrow press moves a quarter point and the box mirrors it.
    stepSlider(screen.getByRole('slider', { name: 'Size' }), 1);
    expect(useDoc.getState().textLabels['g1'].fontSize).toBe(16.25);
    expect(spin.value).toBe('16.25');
  });

  it('writes quarter-point sizes via the wheel and the slider', () => {
    seedAndRender();
    fireEvent.wheel(screen.getByRole('spinbutton', { name: 'Size' }), { deltaY: -1 });
    expect(useDoc.getState().textLabels['g1'].fontSize).toBe(16.25);
    stepSlider(screen.getByRole('slider', { name: 'Size' }), 1);
    expect(useDoc.getState().textLabels['g1'].fontSize).toBe(16.5);
  });

  // This popover and the Styles panel's text-label editor are two renders of
  // ONE ladder. Offering a different set from either would leave an alignment
  // reachable in one surface and not the other, so both are checked against
  // the model's ladder rather than against a list spelled here.
  it('offers exactly the model align ladder, in its order', () => {
    seedAndRender();
    const titles = Object.values(TEXT_LABEL_ALIGN_CHIPS).map((c) => c.title);
    const chips = screen
      .getAllByRole('radio')
      .map((el) => el.getAttribute('aria-label'))
      .filter((l): l is string => l !== null && titles.includes(l));
    expect(chips).toEqual(TEXT_LABEL_ALIGNS.map((a) => TEXT_LABEL_ALIGN_CHIPS[a].title));
  });

  it('changes alignment and toggles italic', () => {
    seedAndRender();
    fireEvent.click(screen.getByLabelText('Align center'));
    expect(useDoc.getState().textLabels['g1'].align).toBe('center');
    fireEvent.click(screen.getByLabelText('Italic'));
    expect(useDoc.getState().textLabels['g1'].italic).toBe(true);
  });

  it('the align options are one roving-focus group: arrows move between them', async () => {
    seedAndRender();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Align left'));
    expect(screen.getByLabelText('Align left')).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByLabelText('Align center')).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByLabelText('Align right')).toHaveFocus();
  });

  it('re-clicking the selected alignment keeps it selected (no empty state)', async () => {
    seedAndRender();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Align center'));
    await user.click(screen.getByLabelText('Align center'));
    expect(useDoc.getState().textLabels['g1'].align).toBe('center');
  });

  it('changes the weight via the dropdown', async () => {
    seedAndRender();
    await chooseOption(userEvent.setup(), 'Weight', 'Bold');
    expect(useDoc.getState().textLabels['g1'].weight).toBe(700);
  });

  it('deletes the label and closes', () => {
    const onClose = vi.fn();
    seedAndRender(onClose);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(useDoc.getState().textLabels['g1']).toBeUndefined();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('<TextLabelPopover /> — leading + tracking', () => {
  function seedAndRender() {
    const label = makeTextLabel({ id: 'g1', text: 'Hi\nThere' });
    useDoc.setState({ ...useDoc.getState(), textLabels: { g1: label } });
    render(
      <TextLabelPopover
        label={useDoc.getState().textLabels['g1']}
        hostW={800}
        onClose={() => {}}
      />,
    );
  }

  it('sets leading via its slider ([0,2] range, 0.05 step)', () => {
    seedAndRender();
    const slider = screen.getByRole('slider', { name: 'Leading' });
    expect(slider).toHaveAttribute('aria-valuemin', '0');
    expect(slider).toHaveAttribute('aria-valuemax', '2');
    expect(slider).toHaveAttribute('aria-valuenow', '1'); // default
    stepSlider(slider, 1); // one step of the 0.05 grid
    expect(useDoc.getState().textLabels['g1'].leading).toBeCloseTo(1.05, 10);
  });

  it('sets tracking via its slider ([-0.1,0.5] range, 0.001 step)', () => {
    seedAndRender();
    const slider = screen.getByRole('slider', { name: 'Tracking' });
    expect(slider).toHaveAttribute('aria-valuemin', '-0.1');
    expect(slider).toHaveAttribute('aria-valuemax', '0.5');
    expect(slider).toHaveAttribute('aria-valuenow', '0'); // default
    stepSlider(slider, 1); // one step of the 0.001 grid
    expect(useDoc.getState().textLabels['g1'].tracking).toBeCloseTo(0.001, 10);
  });

  it('marks the neutral values with a detent tick', () => {
    seedAndRender();
    for (const [name, expectedLeftPct] of [
      ['Leading', 50], // 1 in [0, 2]
      ['Tracking', (0.1 / 0.6) * 100], // 0 in [-0.1, 0.5]
    ] as const) {
      const slider = screen.getByRole('slider', { name });
      const tick = slider
        .closest('.options-popover-row')
        ?.querySelector('.field-slider-detent') as HTMLElement | null;
      expect(tick).toBeTruthy();
      expect(parseFloat(tick!.style.left)).toBeCloseTo(expectedLeftPct, 2);
    }
  });

  it('disables both rows when locked', () => {
    const label = makeTextLabel({ id: 'g1', text: 'Hi', locked: true });
    useDoc.setState({ ...useDoc.getState(), textLabels: { g1: label } });
    render(<TextLabelPopover label={label} hostW={800} onClose={() => {}} />);
    expect(screen.getByRole('slider', { name: 'Leading' })).toHaveAttribute('data-disabled');
    expect(screen.getByRole('slider', { name: 'Tracking' })).toHaveAttribute('data-disabled');
  });
});

describe('<TextLabelPopover /> — lock toggle', () => {
  function seedAndRender(label = makeTextLabel({ id: 'g1', text: 'Hi' })) {
    useDoc.setState({ ...useDoc.getState(), textLabels: { g1: label } });
    render(
      <TextLabelPopover
        label={useDoc.getState().textLabels['g1']}
        hostW={800}
        onClose={() => {}}
      />,
    );
  }

  it('the lock toggle flips locked', () => {
    seedAndRender();
    fireEvent.click(screen.getByRole('button', { name: 'Lock label' }));
    expect(useDoc.getState().textLabels['g1'].locked).toBe(true);
  });

  it('when locked, editing controls are disabled but the lock toggle stays active', () => {
    seedAndRender(makeTextLabel({ id: 'g1', text: 'Hi', locked: true }));
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByRole('slider', { name: 'Size' })).toHaveAttribute('data-disabled');
    expect(screen.getByRole('spinbutton', { name: 'Size' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Weight' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Style' })).toBeDisabled();
    expect(screen.getByLabelText('Align center')).toBeDisabled();
    expect(screen.getByLabelText('Italic')).toBeDisabled();
    expect(screen.getByLabelText('Label color')).toBeDisabled();
    expect(screen.getByLabelText('Dark mode label color')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    // The unlock control remains usable.
    const unlock = screen.getByRole('button', { name: 'Unlock label' });
    expect(unlock).toBeEnabled();
    fireEvent.click(unlock);
    expect(useDoc.getState().textLabels['g1'].locked).toBe(false);
  });
});

describe('<TextLabelPopover /> — column width + justify', () => {
  function seed(label = makeTextLabel({ id: 'g1', text: 'Hi', align: 'left' })) {
    useDoc.setState({ ...useDoc.getState(), textLabels: { g1: label } });
    render(
      <TextLabelPopover
        label={useDoc.getState().textLabels['g1']}
        hostW={800}
        onClose={() => {}}
      />,
    );
  }

  it('offers a justify alignment button', () => {
    seed();
    fireEvent.click(screen.getByLabelText('Justify'));
    expect(useDoc.getState().textLabels['g1'].align).toBe('justify');
  });

  it('sets a column width via the width slider', () => {
    seed();
    // From Auto (0), one arrow press starts a fixed column on the 1-unit grid.
    stepSlider(screen.getByRole('slider', { name: 'Width' }), 1);
    expect(useDoc.getState().textLabels['g1'].width).toBe(1);
    // End jumps to the slider's rail — the documented [0, max] range.
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Width' }), { key: 'End' });
    expect(useDoc.getState().textLabels['g1'].width).toBe(TEXT_LABEL_WIDTH_MAX);
  });

  it('shows width 0 (Auto) for a label with no width', () => {
    seed();
    expect(screen.getByRole('spinbutton', { name: 'Width' })).toHaveValue(0);
  });

  it('disables the width controls when locked', () => {
    seed(makeTextLabel({ id: 'g1', text: 'Hi', locked: true }));
    expect(screen.getByRole('slider', { name: 'Width' })).toHaveAttribute('data-disabled');
    expect(screen.getByRole('spinbutton', { name: 'Width' })).toBeDisabled();
  });

  it('wheel over a locked label’s size/width rows leaves the label unchanged', () => {
    // The row-level wheel handler must respect the lock — both inputs are
    // disabled, so a wheel notch anywhere in the row must not edit the label.
    seed(makeTextLabel({ id: 'g1', text: 'Hi', locked: true }));
    const before = useDoc.getState().textLabels['g1'];
    fireEvent.wheel(screen.getByRole('slider', { name: 'Size' }), { deltaY: -1 });
    fireEvent.wheel(screen.getByRole('slider', { name: 'Width' }), { deltaY: -1 });
    expect(useDoc.getState().textLabels['g1'].fontSize).toBe(before.fontSize);
    expect(useDoc.getState().textLabels['g1'].width).toBe(before.width);
  });
});

describe('<TextLabelPopover /> — wrap-lines toggle (persisted editor preference)', () => {
  beforeEach(() => {
    // The wrap flag is a global persisted preference, not doc state — reset both
    // the store and its localStorage backing so tests don't leak into each other
    // or into the other describes in this file.
    localStorage.clear();
    useLabelEditorPrefs.setState({ wrapText: false });
  });

  function seedAndRender() {
    const label = makeTextLabel({ id: 'g1', text: 'Hi' });
    useDoc.setState({ ...useDoc.getState(), textLabels: { g1: label } });
    render(
      <TextLabelPopover
        label={useDoc.getState().textLabels['g1']}
        hostW={800}
        onClose={() => {}}
      />,
    );
  }

  // The wrap toggle drives a CSS class, not the textarea's `wrap` attribute:
  // Chromium ignores post-creation changes to `wrap`, and the base stylesheet
  // pins `white-space: pre`, so the `.wrap` class is what actually flips it.
  it('defaults to unchecked with no wrap class (unchanged legacy behavior)', () => {
    seedAndRender();
    expect(screen.getByRole('checkbox', { name: 'Wrap' })).not.toBeChecked();
    expect(screen.getByRole('textbox')).not.toHaveClass('wrap');
  });

  it('checking it adds the wrap class and writes the persisted preference', () => {
    seedAndRender();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Wrap' }));
    expect(screen.getByRole('textbox')).toHaveClass('wrap');
    expect(useLabelEditorPrefs.getState().wrapText).toBe(true);
  });

  it('reflects an already-remembered preference when the popover opens', () => {
    useLabelEditorPrefs.setState({ wrapText: true });
    seedAndRender();
    expect(screen.getByRole('checkbox', { name: 'Wrap' })).toBeChecked();
    expect(screen.getByRole('textbox')).toHaveClass('wrap');
  });

  it('stays usable on a locked label (view-only preference, never mutates the label)', () => {
    const label = makeTextLabel({ id: 'g1', text: 'Hi', locked: true });
    useDoc.setState({ ...useDoc.getState(), textLabels: { g1: label } });
    render(<TextLabelPopover label={label} hostW={800} onClose={() => {}} />);
    const box = screen.getByRole('checkbox', { name: 'Wrap' });
    expect(box).toBeEnabled();
    fireEvent.click(box);
    expect(useLabelEditorPrefs.getState().wrapText).toBe(true);
  });
});

// Header drag (incl. across zoom) is covered by the world-position describe
// above. Escape handling (close on Esc, but not while typing in a field)
// lives in App's global keydown handler — covered in App.keyboard.test.tsx.

describe('<TextLabelPopover /> — style presets', () => {
  // The real mount (ItemPopovers) passes the live store label; mirror that
  // so the Style row re-derives when an action writes the tag.
  function LivePopover() {
    const label = useDoc((s) => s.textLabels['g1']);
    return label ? <TextLabelPopover label={label} hostW={800} onClose={() => {}} /> : null;
  }

  it('applies a preset from the Style row; a covered edit keeps the style (override)', async () => {
    useDoc.setState({
      ...useDoc.getState(),
      textLabels: { g1: makeTextLabel({ id: 'g1', text: 'Hi' }) },
      styles: {
        y1: makeStyle('textLabel', 'y1', {
          name: 'Heading',
          props: { fontSize: 24, weight: 700 },
        }),
      },
    });
    render(<LivePopover />);
    const user = userEvent.setup();
    await chooseOption(user, 'Style', 'Heading');
    expect(useDoc.getState().textLabels['g1']).toMatchObject({
      fontSize: 24,
      weight: 700,
      styleId: 'y1',
    });
    expect(screen.getByRole('combobox', { name: 'Style' })).toHaveTextContent('Heading');
    expect(screen.getByRole('spinbutton', { name: 'Size' })).toHaveValue(24);
    // A covered edit (weight) becomes a per-field override — the tag stays.
    await chooseOption(user, 'Weight', 'Roman');
    expect(useDoc.getState().textLabels['g1'].styleId).toBe('y1');
    expect(useDoc.getState().textLabels['g1'].weight).toBe(400);
    expect(screen.getByRole('combobox', { name: 'Style' })).toHaveTextContent('Heading (edited)');
  });

  it('a red dot marks the overridden field; clicking it reverts just that field', async () => {
    useDoc.setState({
      ...useDoc.getState(),
      textLabels: { g1: makeTextLabel({ id: 'g1', text: 'Hi' }) },
      styles: {
        y1: makeStyle('textLabel', 'y1', {
          name: 'Heading',
          props: { fontSize: 24, weight: 700 },
        }),
      },
    });
    render(<LivePopover />);
    const user = userEvent.setup();
    await chooseOption(user, 'Style', 'Heading');
    // Matching everywhere: no dots.
    expect(screen.queryByRole('button', { name: 'Revert Weight to style' })).toBeNull();
    await chooseOption(user, 'Weight', 'Roman'); // override weight (700 → 400)
    // Only the diverging row grows a dot, and its tooltip names the style's
    // own value for the field.
    expect(screen.queryByRole('button', { name: 'Revert Size to style' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Revert Weight to style' })).toHaveAttribute(
      'title',
      'Overrides style weight (Bold) — click to revert',
    );
    await user.click(screen.getByRole('button', { name: 'Revert Weight to style' }));
    const label = useDoc.getState().textLabels.g1;
    expect(label.weight).toBe(700);
    expect(label.fontSize).toBe(24);
    expect(label.styleId).toBe('y1');
    expect(screen.queryByRole('button', { name: 'Revert Weight to style' })).toBeNull();
  });
});
