import { describe, it, expect, beforeEach } from 'vitest';
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StyleEditor } from './StyleEditor';
import { useDoc } from '../state/store';
import { historyDepth } from '../state/history';
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
  it('hides the stroke type and color until the def has a stroke', () => {
    render(<StyleEditor def={makeStyle('line', 'y1', { props: { strokeWidth: 0 } })} />);
    expect(screen.getByRole('slider', { name: 'Stroke width' })).toBeTruthy();
    expect(screen.queryByText('Stroke')).toBeNull();
    expect(screen.queryByText('Stroke color')).toBeNull();
  });

  // A patch is one store write — which is why this row needs no history group,
  // unlike the line inspector's separate setters. Pinned, not assumed: it is
  // the whole reason the group is absent.
  it('the stroke width writes strokeWidth only, in a single undo entry', () => {
    const def = makeStyle('line', 'y1', { props: { strokeWidth: 2 } });
    useDoc.setState({ styles: { ...useDoc.getState().styles, y1: def } });
    useDoc.temporal.getState().clear();
    render(<StyleEditor def={def} />);
    const before = historyDepth();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Stroke width' }), {
      target: { value: '5' },
    });
    const props = () => useDoc.getState().styles.y1.props as LineStyleProps;
    expect(props().strokeWidth).toBe(5);
    expect(historyDepth()).toBe(before + 1);
    useDoc.temporal.getState().undo();
    expect(props().strokeWidth).toBe(2);
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

  // The casing can be a fixed hex or the line's OWN color — same Line/Color
  // idiom the stopDot editor uses for its fill/stroke/code colors, so one style
  // can give differently-colored lines a casing in their own hue. The picker row
  // is named for the field ("Stroke"); "Stroke color" names the swatch row it
  // reveals, so the segments take a "Stroke type …" name to stay distinct.
  it('activates Color and shows the swatch for a hex casing', () => {
    render(
      <StyleEditor
        def={makeStyle('line', 'y1', { props: { strokeWidth: 3, strokeColor: '#ff0000' } })}
      />,
    );
    expect(screen.getByLabelText('Stroke type color')).toHaveClass('active');
    expect(screen.getByRole('button', { name: 'Stroke color' })).toBeInTheDocument();
  });

  it("the 'line' sentinel activates Line and hides the swatch", () => {
    render(
      <StyleEditor
        def={makeStyle('line', 'y1', { props: { strokeWidth: 3, strokeColor: 'line' } })}
      />,
    );
    expect(screen.getByLabelText('Stroke type line')).toHaveClass('active');
    expect(screen.queryByRole('button', { name: 'Stroke color' })).toBeNull();
  });

  it('picking a type writes the prop: Line sets the sentinel, Color restores a hex', () => {
    useDoc.setState({
      ...useDoc.getState(),
      styles: {
        ...useDoc.getState().styles,
        'ln-1': makeStyle('line', 'ln-1', {
          props: { strokeWidth: 3, strokeColor: '#ff0000' },
        }),
      },
    });
    const propsOf = () => useDoc.getState().styles['ln-1'].props as LineStyleProps;
    // Re-render from the store after each pick so the ToggleGroup sees the new
    // active type (else Radix reads the next click as a deselect of the stale one).
    const { rerender } = render(<StyleEditor def={useDoc.getState().styles['ln-1']} />);

    fireEvent.click(screen.getByLabelText('Stroke type line'));
    expect(propsOf().strokeColor).toBe('line');
    rerender(<StyleEditor def={useDoc.getState().styles['ln-1']} />);

    fireEvent.click(screen.getByLabelText('Stroke type color'));
    expect(propsOf().strokeColor).toBe('#ffffff');
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
  it('a non-dash dot exposes stroke width, a stroke type, and a service-code type', () => {
    render(<StyleEditor def={makeStyle('stopDot', 'y1', { props: { shape: 'circle' } })} />);
    expect(screen.getByRole('slider', { name: 'Stroke width' })).toBeTruthy();
    // The picker rows are named for the FIELD ("Stroke"); "Stroke color" names
    // the swatch row that the Color type reveals beneath it.
    expect(screen.getByText('Stroke')).toBeTruthy();
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
    expect(screen.queryByText('Stroke')).toBeNull();
    expect(screen.queryByText('Service code')).toBeNull();
    expect(screen.queryByText('First letter only')).toBeNull();
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

  // ── The three color-TYPE rows ──
  // Fill, Stroke and Service code all read the same way: a "how is this
  // colored?" picker, and a swatch row that appears only under Color. These
  // pin that shared shape per row, so the three can't drift apart again.

  it('offers a None / B/W / Line / Color fill type; no swatch row until Color', () => {
    render(
      <StyleEditor def={makeStyle('stopDot', 'y1', { props: { shape: 'circle', fill: 'bw' } })} />,
    );
    const group = screen.getByLabelText('Fill type none').closest('.align-group') as HTMLElement;
    expect(
      [...group.querySelectorAll('[aria-label^="Fill type "]')].map((b) => b.textContent),
    ).toEqual(['None', 'B/W', 'Line', 'Color']);
    // 'bw' is active, and it is NOT a color pair, so no swatch row.
    expect(screen.getByLabelText('Fill type bw')).toHaveClass('active');
    expect(screen.queryByRole('button', { name: 'Fill color' })).toBeNull();
  });

  it('a fill color pair activates Color and reveals the "Fill color" swatch row', () => {
    render(
      <StyleEditor
        def={makeStyle('stopDot', 'y1', {
          props: { shape: 'circle', fill: { day: '#ff0000', night: '#00ff00' } },
        })}
      />,
    );
    expect(screen.getByLabelText('Fill type color')).toHaveClass('active');
    expect(screen.getByRole('button', { name: 'Fill color' })).toBeTruthy();
  });

  it('picking a fill type writes fill', () => {
    useDoc.setState({
      ...useDoc.getState(),
      styles: {
        ...useDoc.getState().styles,
        'sd-fill4': makeStyle('stopDot', 'sd-fill4', { props: { shape: 'circle' } }),
      },
    });
    const fillOf = () => (useDoc.getState().styles['sd-fill4'].props as DotStyle).fill;
    const { rerender } = render(<StyleEditor def={useDoc.getState().styles['sd-fill4']} />);

    fireEvent.click(screen.getByLabelText('Fill type bw'));
    expect(fillOf()).toBe('bw');
    rerender(<StyleEditor def={useDoc.getState().styles['sd-fill4']} />);

    fireEvent.click(screen.getByLabelText('Fill type none'));
    expect(fillOf()).toBe('none');
    rerender(<StyleEditor def={useDoc.getState().styles['sd-fill4']} />);

    fireEvent.click(screen.getByLabelText('Fill type line'));
    expect(fillOf()).toBe('line');
    rerender(<StyleEditor def={useDoc.getState().styles['sd-fill4']} />);

    fireEvent.click(screen.getByLabelText('Fill type color'));
    expect(typeof fillOf()).toBe('object');
  });

  it('offers a B/W / Line / Color stroke type — no None, since width 0 says that', () => {
    render(
      <StyleEditor
        def={makeStyle('stopDot', 'y1', {
          props: { shape: 'circle', strokeWidth: 2, strokeColor: 'bw' },
        })}
      />,
    );
    const group = screen.getByLabelText('Stroke type bw').closest('.align-group') as HTMLElement;
    expect(
      [...group.querySelectorAll('[aria-label^="Stroke type "]')].map((b) => b.textContent),
    ).toEqual(['B/W', 'Line', 'Color']);
    expect(screen.getByLabelText('Stroke type bw')).toHaveClass('active');
    expect(screen.queryByRole('button', { name: 'Stroke color' })).toBeNull();
  });

  it('picking a stroke type writes strokeColor', () => {
    useDoc.setState({
      ...useDoc.getState(),
      styles: {
        ...useDoc.getState().styles,
        'sd-stroke': makeStyle('stopDot', 'sd-stroke', {
          props: { shape: 'circle', strokeWidth: 2 },
        }),
      },
    });
    const strokeOf = () => (useDoc.getState().styles['sd-stroke'].props as DotStyle).strokeColor;
    const { rerender } = render(<StyleEditor def={useDoc.getState().styles['sd-stroke']} />);

    // B/W → the explicit 'bw' sentinel (unlike the code color, the field is
    // required, so auto-contrast can't be spelled by absence).
    fireEvent.click(screen.getByLabelText('Stroke type bw'));
    expect(strokeOf()).toBe('bw');
    rerender(<StyleEditor def={useDoc.getState().styles['sd-stroke']} />);

    fireEvent.click(screen.getByLabelText('Stroke type line'));
    expect(strokeOf()).toBe('line');
    rerender(<StyleEditor def={useDoc.getState().styles['sd-stroke']} />);

    fireEvent.click(screen.getByLabelText('Stroke type color'));
    expect(typeof strokeOf()).toBe('object');
  });

  it('folds "show the code" into the service-code type picker: None is the off state', () => {
    render(<StyleEditor def={makeStyle('stopDot', 'y1', { props: { shape: 'circle' } })} />);
    const group = screen
      .getByLabelText('Service code type none')
      .closest('.align-group') as HTMLElement;
    expect(
      [...group.querySelectorAll('[aria-label^="Service code type "]')].map((b) => b.textContent),
    ).toEqual(['None', 'B/W', 'Line', 'Color']);
    // A dot that draws no code sits on None — and neither the swatch row nor the
    // first-letter option is offered, since both only mean something with a code.
    expect(screen.getByLabelText('Service code type none')).toHaveClass('active');
    expect(screen.queryByRole('button', { name: 'Service code color' })).toBeNull();
    expect(screen.queryByLabelText('Show first letter of the service code only')).toBeNull();
  });

  it('a code with no explicit color sits on B/W and offers "First letter only"', () => {
    render(
      <StyleEditor
        def={makeStyle('stopDot', 'y1', { props: { shape: 'circle', showServiceCode: true } })}
      />,
    );
    expect(screen.getByLabelText('Service code type bw')).toHaveClass('active');
    expect(screen.queryByRole('button', { name: 'Service code color' })).toBeNull();
    // Shown rather than greyed out — the type picker already gates it.
    expect(screen.getByLabelText('Show first letter of the service code only')).toBeEnabled();
  });

  it("a 'line' code color activates Line; an explicit pair activates Color plus its row", () => {
    const { unmount } = render(
      <StyleEditor
        def={makeStyle('stopDot', 'y1', {
          props: { shape: 'circle', showServiceCode: true, serviceCodeColor: 'line' },
        })}
      />,
    );
    expect(screen.getByLabelText('Service code type line')).toHaveClass('active');
    expect(screen.queryByRole('button', { name: 'Service code color' })).toBeNull();
    unmount();

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
    expect(screen.getByLabelText('Service code type color')).toHaveClass('active');
    expect(screen.getByRole('button', { name: 'Service code color' })).toBeTruthy();
  });

  it('picking a service-code type writes showServiceCode and serviceCodeColor together', () => {
    // Seed in the store so the click's updateStyleProps lands; re-render from the
    // store after each pick so the ToggleGroup reflects the new active type (else
    // Radix reads the next click as a deselect of the stale one).
    useDoc.setState({
      ...useDoc.getState(),
      styles: {
        ...useDoc.getState().styles,
        'sd-code': makeStyle('stopDot', 'sd-code', { props: { shape: 'circle' } }),
      },
    });
    const propsOf = () => useDoc.getState().styles['sd-code'].props as DotStyle;
    const { rerender } = render(<StyleEditor def={useDoc.getState().styles['sd-code']} />);

    // B/W turns the code ON with no explicit color — absence IS auto-contrast.
    fireEvent.click(screen.getByLabelText('Service code type bw'));
    expect(propsOf().showServiceCode).toBe(true);
    expect(propsOf().serviceCodeColor).toBeUndefined();
    rerender(<StyleEditor def={useDoc.getState().styles['sd-code']} />);

    fireEvent.click(screen.getByLabelText('Service code type line'));
    expect(propsOf().serviceCodeColor).toBe('line');
    rerender(<StyleEditor def={useDoc.getState().styles['sd-code']} />);

    fireEvent.click(screen.getByLabelText('Service code type color'));
    expect(typeof propsOf().serviceCodeColor).toBe('object');
    rerender(<StyleEditor def={useDoc.getState().styles['sd-code']} />);

    fireEvent.click(screen.getByLabelText('Service code type none'));
    expect(propsOf().showServiceCode).toBe(false);
  });

  it('None clears the code-only fields, so a codeless dot stores nothing inert', () => {
    useDoc.setState({
      ...useDoc.getState(),
      styles: {
        ...useDoc.getState().styles,
        'sd-code2': makeStyle('stopDot', 'sd-code2', {
          props: {
            shape: 'circle',
            showServiceCode: true,
            serviceCodeColor: { day: '#ff0000', night: '#00ff00' },
            serviceCodeFirstLetterOnly: true,
          },
        }),
      },
    });
    render(<StyleEditor def={useDoc.getState().styles['sd-code2']} />);
    fireEvent.click(screen.getByLabelText('Service code type none'));
    // Both code-only fields are dropped, not left dangling: a color and a
    // first-letter flag for a code that isn't drawn would make two identical-
    // looking dots compare unequal through dotStylesEqual.
    const props = useDoc.getState().styles['sd-code2'].props as DotStyle;
    expect(props.showServiceCode).toBe(false);
    expect('serviceCodeColor' in props).toBe(false);
    expect('serviceCodeFirstLetterOnly' in props).toBe(false);
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
    // The type toggle, the color swatches, and the alignment selector are all
    // inert without a stroke to color or place.
    expect(screen.getByLabelText('Stroke type line')).toBeDisabled();
    expect(screen.getByLabelText('Stroke type color')).toBeDisabled();
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
    expect(screen.getByLabelText('Stroke type line')).toBeEnabled();
    expect(screen.getByLabelText('Stroke type color')).toBeEnabled();
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
    // 'Fill type line' is already the active segment; re-clicking it fires Radix's
    // deselect (onValueChange('')), which the `if (v)` guard must swallow — the
    // fill must stay 'line', not fall through to a color day/night pair.
    await user.click(screen.getByLabelText('Fill type line'));
    expect((useDoc.getState().styles['sd-fill'].props as DotStyle).fill).toBe('line');
  });
});
