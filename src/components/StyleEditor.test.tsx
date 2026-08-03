import { describe, it, expect, beforeEach } from 'vitest';
import { act, cleanup, render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StyleEditor } from './StyleEditor';
import { useDoc } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
import { makeStyle } from '../test/fixtures';
import type { DotStyle, LineStyleProps } from '../model/types';

// Reset the live store each test and seed two custom stopDot styles the line
// editor's type pickers resolve against (a dash dot for the dash-gating tests).
beforeEach(() => {
  localStorage.clear();
  useDoc.setState({
    ...useDoc.getState(),
    ...DEFAULT_DOC,
    styles: {
      ...DEFAULT_DOC.styles,
      'sd-square': makeStyle('stopDot', 'sd-square', {
        name: 'Square',
        // A real stroke: the color/align controls are gated on strokeWidth > 0.
        props: { shape: 'square', strokeWidth: 2 },
      }),
      'sd-dash': makeStyle('stopDot', 'sd-dash', { name: 'Dash', props: { shape: 'dash' } }),
    },
  });
});

describe('<StyleEditor> — line', () => {
  it('renders the casing AND the seam controls (color + independent width)', () => {
    render(
      <StyleEditor
        def={makeStyle('line', 'y1', { props: { seamColor: '#abcdef80', seamWidth: 3 } })}
      />,
    );
    // Casing (pre-existing) …
    expect(screen.getByText('Stroke color')).toBeTruthy();
    expect(screen.getByRole('slider', { name: 'Stroke width' })).toBeTruthy();
    // … and the seam, previously missing from this editor.
    expect(screen.getByText('Seam color')).toBeTruthy();
    expect(screen.getByRole('slider', { name: 'Seam width' })).toHaveAttribute(
      'aria-valuenow',
      '3',
    );
  });

  it('inherits the casing width in the seam-width control when unset', () => {
    render(
      <StyleEditor
        def={makeStyle('line', 'y1', { props: { strokeWidth: 4 /* no seamWidth */ } })}
      />,
    );
    expect(screen.getByRole('slider', { name: 'Seam width' })).toHaveAttribute(
      'aria-valuenow',
      '4', // inherits the casing rail width
    );
  });

  it('renders the line-ends group at the def value and writes a pick through', async () => {
    const def = makeStyle('line', 'y1', { props: { endStyle: 'short' } });
    useDoc.setState({ styles: { ...useDoc.getState().styles, y1: def } });
    render(<StyleEditor def={def} />);
    expect(screen.getByRole('radio', { name: 'Short' })).toHaveAttribute('aria-checked', 'true');
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: 'Round' }));
    expect((useDoc.getState().styles.y1.props as LineStyleProps).endStyle).toBe('round');
  });

  it('renders the branch inner-edge group at the def value and writes a pick through', async () => {
    const def = makeStyle('line', 'y1', { props: { seamEdges: 'straight' } });
    useDoc.setState({ styles: { ...useDoc.getState().styles, y1: def } });
    render(<StyleEditor def={def} />);
    const group = screen.getByRole('radiogroup', { name: 'Branch inner edges' });
    expect(within(group).getByRole('radio', { name: 'Straight' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    const user = userEvent.setup();
    await user.click(within(group).getByRole('radio', { name: 'Curved' }));
    expect((useDoc.getState().styles.y1.props as LineStyleProps).seamEdges).toBe('curved');
  });

  it('renders the interline gap row at the def value, 0 when the def has none', () => {
    render(<StyleEditor def={makeStyle('line', 'y1', { props: { interlineGap: 2 } })} />);
    expect(screen.getByRole('slider', { name: 'Interline gap' })).toHaveAttribute(
      'aria-valuenow',
      '2',
    );
    cleanup();
    // Absent ⇒ 0 (never stored at the default) — the row still renders.
    render(<StyleEditor def={makeStyle('line', 'y2')} />);
    expect(screen.getByRole('slider', { name: 'Interline gap' })).toHaveAttribute(
      'aria-valuenow',
      '0',
    );
  });

  it('renders the label gap row at the def value, the default 3 when the def has none', () => {
    render(<StyleEditor def={makeStyle('line', 'y1', { props: { labelGap: 6 } })} />);
    expect(screen.getByRole('slider', { name: 'Label gap' })).toHaveAttribute('aria-valuenow', '6');
    cleanup();
    // Absent ⇒ the default 3 (never stored) — the row still renders.
    render(<StyleEditor def={makeStyle('line', 'y2')} />);
    expect(screen.getByRole('slider', { name: 'Label gap' })).toHaveAttribute('aria-valuenow', '3');
  });

  it('wheel ticks step THROUGH the collapse-at-default value without stalling', () => {
    // A canonical write COLLAPSES labelGap 3 to no-key. The wheel's live read
    // must then resolve the effective default — not fall back to a render-time
    // snapshot of the props, which is the value the scroll just left. Two raw
    // dispatches in one act() batch model a trackpad outpacing the re-render
    // (the wheel listener is a native non-React listener, so nothing flushes
    // between them); with the stale fallback the second tick re-writes 3 and
    // the scroll stalls for a frame, then double-jumps (the field bug report).
    const def = makeStyle('line', 'y1', { props: { labelGap: 2.75 } });
    useDoc.setState({ styles: { ...useDoc.getState().styles, y1: def } });
    render(<StyleEditor def={def} />);
    const row = screen
      .getByRole('slider', { name: 'Label gap' })
      .closest('.options-popover-row') as HTMLElement;
    const tick = () =>
      row.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, bubbles: true, cancelable: true }));
    act(() => {
      tick(); // 2.75 → 3, stored as ABSENT
      tick(); // must read effective 3 and write 3.25
    });
    expect((useDoc.getState().styles.y1.props as LineStyleProps).labelGap).toBe(3.25);
  });

  it('heads the dot controls with a "Stop dots" section, with no redundant "Line" header', () => {
    render(<StyleEditor def={makeStyle('line', 'y1')} />);
    expect(screen.getByText('Stop dots')).toBeInTheDocument();
    // The line controls lead the panel with no redundant "Line" header above
    // them. Scoped to section headers — "Line" is also a color-mode segment.
    expect(screen.queryByText('Line', { selector: '.style-section' })).toBeNull();
    expect(screen.getByRole('slider', { name: 'Line width' })).toBeInTheDocument();
  });

  it('offers a stop-dot TYPE picker beside the size for singleton AND interchange', () => {
    render(<StyleEditor def={makeStyle('line', 'y1')} />);
    // The pickers (StationShapePicker triggers) sit on the dot rows…
    expect(screen.getByRole('button', { name: 'Singleton stop shape' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Interchange stop shape' })).toBeInTheDocument();
    // …alongside their size sliders.
    expect(screen.getByRole('slider', { name: 'Singleton dot size' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Interchange dot size' })).toBeInTheDocument();
  });

  // Casing and seam can each be a fixed hex or the line's OWN color — same
  // Line/Custom idiom the stopDot editor uses for its fill/stroke/code colors,
  // so one style can give differently-colored lines a casing in their own hue.
  it('activates Custom and shows the swatch for a hex casing / seam', () => {
    render(
      <StyleEditor
        def={makeStyle('line', 'y1', { props: { strokeColor: '#ff0000', seamColor: '#00ff0080' } })}
      />,
    );
    expect(screen.getByLabelText('Stroke color custom')).toHaveClass('active');
    expect(screen.getByRole('button', { name: 'Stroke color' })).toBeInTheDocument();
    expect(screen.getByLabelText('Seam color custom')).toHaveClass('active');
    expect(screen.getByRole('button', { name: 'Seam color' })).toBeInTheDocument();
  });

  it("the 'line' sentinel activates Line and hides the swatch, on both colors", () => {
    render(
      <StyleEditor
        def={makeStyle('line', 'y1', { props: { strokeColor: 'line', seamColor: 'line' } })}
      />,
    );
    expect(screen.getByLabelText('Stroke color line')).toHaveClass('active');
    expect(screen.queryByRole('button', { name: 'Stroke color' })).toBeNull();
    expect(screen.getByLabelText('Seam color line')).toHaveClass('active');
    expect(screen.queryByRole('button', { name: 'Seam color' })).toBeNull();
  });

  it('an unset seam still reads as Custom (absent IS the off state, a transparent swatch)', () => {
    render(<StyleEditor def={makeStyle('line', 'y1')} />);
    expect(screen.getByLabelText('Seam color custom')).toHaveClass('active');
    expect(screen.getByRole('button', { name: 'Seam color' })).toBeInTheDocument();
  });

  it('picking a mode writes the prop: Line sets the sentinel, Custom restores a hex', () => {
    useDoc.setState({
      ...useDoc.getState(),
      styles: {
        ...useDoc.getState().styles,
        'ln-1': makeStyle('line', 'ln-1', { props: { strokeColor: '#ff0000' } }),
      },
    });
    const propsOf = () => useDoc.getState().styles['ln-1'].props as LineStyleProps;
    // Re-render from the store after each pick so the ToggleGroup sees the new
    // active mode (else Radix reads the next click as a deselect of the stale one).
    const { rerender } = render(<StyleEditor def={useDoc.getState().styles['ln-1']} />);

    fireEvent.click(screen.getByLabelText('Stroke color line'));
    expect(propsOf().strokeColor).toBe('line');
    rerender(<StyleEditor def={useDoc.getState().styles['ln-1']} />);

    fireEvent.click(screen.getByLabelText('Stroke color custom'));
    expect(propsOf().strokeColor).toBe('#ffffff');
    rerender(<StyleEditor def={useDoc.getState().styles['ln-1']} />);

    // Seam: Line sets the sentinel; Custom drops back to the transparent "off"
    // seed, which is never stored — the same off state a fresh style has.
    fireEvent.click(screen.getByLabelText('Seam color line'));
    expect(propsOf().seamColor).toBe('line');
    rerender(<StyleEditor def={useDoc.getState().styles['ln-1']} />);

    fireEvent.click(screen.getByLabelText('Seam color custom'));
    expect(propsOf().seamColor).toBeUndefined();
  });

  it('greys out Dash length/width unless a split default is a dash dot', () => {
    // Default dots (filled black) ⇒ dash controls disabled.
    const { unmount } = render(<StyleEditor def={makeStyle('line', 'y1')} />);
    expect(screen.getByRole('spinbutton', { name: 'Dash length' })).toBeDisabled();
    expect(screen.getByRole('spinbutton', { name: 'Dash width' })).toBeDisabled();
    unmount();

    // A dash singleton dot ⇒ the dash controls become editable.
    render(
      <StyleEditor def={makeStyle('line', 'y2', { props: { singletonDotStyleId: 'sd-dash' } })} />,
    );
    expect(screen.getByRole('spinbutton', { name: 'Dash length' })).toBeEnabled();
    expect(screen.getByRole('spinbutton', { name: 'Dash width' })).toBeEnabled();
  });
});

describe('<StyleEditor> — stopDot', () => {
  it('a non-dash dot exposes stroke width, stroke color, and service code', () => {
    render(<StyleEditor def={makeStyle('stopDot', 'y1', { props: { shape: 'circle' } })} />);
    expect(screen.getByRole('slider', { name: 'Stroke width' })).toBeTruthy();
    expect(screen.getByText('Stroke color')).toBeTruthy();
    expect(screen.getByText('Service code')).toBeTruthy();
  });

  it('a dash tick hides the inert stroke/service-code controls — only shape + fill apply', () => {
    render(<StyleEditor def={makeStyle('stopDot', 'y1', { props: { shape: 'dash' } })} />);
    // Shape + fill still apply to a dash tick …
    expect(screen.getByText('Shape')).toBeTruthy();
    expect(screen.getByText('Fill')).toBeTruthy();
    // … but stroke width/color and the service code are inert for a tick
    // (DashGlyph takes its casing from the line and never draws a code), so the
    // editor must not offer them.
    expect(screen.queryByRole('slider', { name: 'Stroke width' })).toBeNull();
    expect(screen.queryByText('Stroke color')).toBeNull();
    expect(screen.queryByText('Service code')).toBeNull();
    expect(screen.queryByText('First letter only')).toBeNull();
  });

  it('greys out "First letter only" until the service code is shown', () => {
    render(<StyleEditor def={makeStyle('stopDot', 'y1', { props: { shape: 'circle' } })} />);
    // Visible (so the option is discoverable) but inert with no code to trim.
    expect(screen.getByLabelText('Show first letter of the service code only')).toBeDisabled();
  });

  it('ticking "First letter only" writes serviceCodeFirstLetterOnly', () => {
    useDoc.setState({
      ...useDoc.getState(),
      styles: {
        ...useDoc.getState().styles,
        'sd-code': makeStyle('stopDot', 'sd-code', {
          props: { shape: 'circle', showServiceCode: true },
        }),
      },
    });
    render(<StyleEditor def={useDoc.getState().styles['sd-code']} />);
    const box = screen.getByLabelText('Show first letter of the service code only');
    expect(box).toBeEnabled();
    fireEvent.click(box);
    expect((useDoc.getState().styles['sd-code'].props as DotStyle).serviceCodeFirstLetterOnly).toBe(
      true,
    );
  });

  it('offers a B/W / Line / Custom service-code color toggle; auto-contrast selects B/W', () => {
    render(
      <StyleEditor
        def={makeStyle('stopDot', 'y1', { props: { shape: 'circle', showServiceCode: true } })}
      />,
    );
    // All three modes are present (ToggleGroup items — queried by label, as the
    // rest of the suite queries segmented controls) …
    expect(screen.getByLabelText('Code color bw')).toBeTruthy();
    expect(screen.getByLabelText('Code color line')).toBeTruthy();
    expect(screen.getByLabelText('Code color custom')).toBeTruthy();
    // … and with no explicit color, B/W (auto-contrast) is active, with no
    // explicit color row (the light swatch carries this accessible name).
    expect(screen.getByLabelText('Code color bw')).toHaveClass('active');
    expect(screen.queryByRole('button', { name: 'Service code color' })).toBeNull();
  });

  it("'line' service-code color activates the Line mode and hides the custom color row", () => {
    render(
      <StyleEditor
        def={makeStyle('stopDot', 'y1', {
          props: { shape: 'circle', showServiceCode: true, serviceCodeColor: 'line' },
        })}
      />,
    );
    expect(screen.getByLabelText('Code color line')).toHaveClass('active');
    // In 'line' mode the explicit color row is gone (like the stroke selector).
    expect(screen.queryByRole('button', { name: 'Service code color' })).toBeNull();
  });

  it('an explicit color pair activates Custom and shows the color row', () => {
    render(
      <StyleEditor
        def={makeStyle('stopDot', 'y1', {
          props: {
            shape: 'circle',
            showServiceCode: true,
            serviceCodeColor: { day: '#ff0000', night: '#00ff00' },
          },
        })}
      />,
    );
    expect(screen.getByLabelText('Code color custom')).toHaveClass('active');
    expect(screen.getByRole('button', { name: 'Service code color' })).toBeTruthy();
  });

  it('picking a mode writes serviceCodeColor: Line/Custom set it, B/W drops it', () => {
    // Seed a code-showing dot in the store so the click's updateStyleProps lands;
    // re-render from the store after each pick so the ToggleGroup reflects the new
    // active mode (else Radix reads the next click as a deselect of the stale one).
    useDoc.setState({
      ...useDoc.getState(),
      styles: {
        ...useDoc.getState().styles,
        'sd-code': makeStyle('stopDot', 'sd-code', {
          props: { shape: 'circle', showServiceCode: true },
        }),
      },
    });
    const sccOf = () => (useDoc.getState().styles['sd-code'].props as DotStyle).serviceCodeColor;
    const { rerender } = render(<StyleEditor def={useDoc.getState().styles['sd-code']} />);

    // Line → the 'line' sentinel.
    fireEvent.click(screen.getByLabelText('Code color line'));
    expect(sccOf()).toBe('line');
    rerender(<StyleEditor def={useDoc.getState().styles['sd-code']} />);

    // Custom → an explicit day/night pair.
    fireEvent.click(screen.getByLabelText('Code color custom'));
    expect(typeof sccOf()).toBe('object');
    rerender(<StyleEditor def={useDoc.getState().styles['sd-code']} />);

    // B/W → the field is dropped entirely (absent ⇒ auto-contrast).
    fireEvent.click(screen.getByLabelText('Code color bw'));
    expect(sccOf()).toBeUndefined();
  });

  it('offers a Center/Inside/Outside stroke-alignment selector that writes strokeAlign', () => {
    // Rendered from the SEEDED def so the click's updateStyleProps lands on it.
    render(<StyleEditor def={useDoc.getState().styles['sd-square']} />);
    // All three alignment options are present for a non-dash dot …
    expect(screen.getByLabelText('Align center')).toBeTruthy();
    expect(screen.getByLabelText('Align inside')).toBeTruthy();
    expect(screen.getByLabelText('Align outside')).toBeTruthy();
    // … and picking one writes the covered style field through updateStyleProps.
    fireEvent.click(screen.getByLabelText('Align inside'));
    expect((useDoc.getState().styles['sd-square'].props as DotStyle).strokeAlign).toBe('inside');
  });

  it('hides the stroke-alignment selector for a dash tick (stroke is inert)', () => {
    render(<StyleEditor def={useDoc.getState().styles['sd-dash']} />);
    expect(screen.queryByLabelText('Align inside')).toBeNull();
  });

  it('greys out stroke color and alignment while the stroke width is 0', () => {
    render(
      <StyleEditor
        def={makeStyle('stopDot', 'y1', { props: { shape: 'circle', strokeWidth: 0 } })}
      />,
    );
    // The Line/Custom mode toggle, the custom color swatches, and the
    // alignment selector are all inert without a stroke to color or place.
    expect(screen.getByLabelText('Stroke line')).toBeDisabled();
    expect(screen.getByLabelText('Stroke custom')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Stroke color' })).toBeDisabled();
    expect(screen.getByLabelText('Align center')).toBeDisabled();
    expect(screen.getByLabelText('Align inside')).toBeDisabled();
    expect(screen.getByLabelText('Align outside')).toBeDisabled();
  });

  it('stroke color and alignment come back once the stroke has width', () => {
    render(
      <StyleEditor
        def={makeStyle('stopDot', 'y1', { props: { shape: 'circle', strokeWidth: 2 } })}
      />,
    );
    expect(screen.getByLabelText('Stroke line')).toBeEnabled();
    expect(screen.getByLabelText('Stroke custom')).toBeEnabled();
    expect(screen.getByLabelText('Align inside')).toBeEnabled();
  });
});

// The segmented pick-one clusters (align / shape / mode) are Radix ToggleGroups,
// same as the item popovers — a single roving-focus tab stop (arrows move within)
// rather than a bag of independent buttons. These lock that contract in.
describe('<StyleEditor> — segmented controls are roving-focus ToggleGroups', () => {
  it('the label Align cluster is one roving-focus group (arrows move between segments)', async () => {
    const user = userEvent.setup();
    render(<StyleEditor def={makeStyle('textLabel', 'y1', { props: { align: 'left' } })} />);
    await user.click(screen.getByLabelText('Align left'));
    expect(screen.getByLabelText('Align left')).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByLabelText('Align center')).toHaveFocus();
  });

  it('the stop-dot Shape cluster is one roving-focus group', async () => {
    const user = userEvent.setup();
    render(<StyleEditor def={makeStyle('stopDot', 'y1', { props: { shape: 'circle' } })} />);
    await user.click(screen.getByLabelText('Circle'));
    expect(screen.getByLabelText('Circle')).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByLabelText('Square')).toHaveFocus();
  });

  it('re-clicking the active mode keeps it (radio-like: the deselect write is swallowed)', async () => {
    const user = userEvent.setup();
    useDoc.setState({
      ...useDoc.getState(),
      styles: {
        ...useDoc.getState().styles,
        'sd-fill': makeStyle('stopDot', 'sd-fill', { props: { shape: 'circle', fill: 'line' } }),
      },
    });
    render(<StyleEditor def={useDoc.getState().styles['sd-fill']} />);
    // 'Fill line' is already the active segment; re-clicking it fires Radix's
    // deselect (onValueChange('')), which the `if (v)` guard must swallow — the
    // fill must stay 'line', not fall through to a custom day/night pair.
    await user.click(screen.getByLabelText('Fill line'));
    expect((useDoc.getState().styles['sd-fill'].props as DotStyle).fill).toBe('line');
  });
});
