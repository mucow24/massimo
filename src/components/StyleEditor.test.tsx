import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StyleEditor } from './StyleEditor';
import { useDoc } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';
import { makeStyle } from '../test/fixtures';
import type { DotStyle } from '../model/types';

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
        props: { shape: 'square' },
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

  it('heads the dot controls with a "Stop dots" section, with no redundant "Line" header', () => {
    render(<StyleEditor def={makeStyle('line', 'y1')} />);
    expect(screen.getByText('Stop dots')).toBeInTheDocument();
    // The line controls lead the panel with no redundant "Line" header above them.
    expect(screen.queryByText('Line')).toBeNull();
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
  });

  it('a code-showing dot offers a Line/Custom service-code color toggle, mirroring stroke', () => {
    render(
      <StyleEditor
        def={makeStyle('stopDot', 'y1', { props: { shape: 'circle', showServiceCode: true } })}
      />,
    );
    // The toggle is present with both modes …
    expect(screen.getByRole('button', { name: 'Code color line' })).toBeTruthy();
    const custom = screen.getByRole('button', { name: 'Code color custom' });
    // … and with no explicit color (auto-contrast), 'Custom' is active and its
    // day/night color row is shown (the light swatch carries this accessible name).
    expect(custom.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Service code color' })).toBeTruthy();
  });

  it("'line' service-code color activates the Line mode and hides the custom color row", () => {
    render(
      <StyleEditor
        def={makeStyle('stopDot', 'y1', {
          props: { shape: 'circle', showServiceCode: true, serviceCodeColor: 'line' },
        })}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Code color line' }).getAttribute('aria-pressed'),
    ).toBe('true');
    // In 'line' mode the explicit color row is gone (like the stroke selector).
    expect(screen.queryByRole('button', { name: 'Service code color' })).toBeNull();
  });

  it('offers a Center/Inside/Outside stroke-alignment selector that writes strokeAlign', () => {
    // Rendered from the SEEDED def so the click's updateStyleProps lands on it.
    render(<StyleEditor def={useDoc.getState().styles['sd-square']} />);
    // All three alignment options are present for a non-dash dot …
    expect(screen.getByRole('button', { name: 'Align center' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Align inside' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Align outside' })).toBeTruthy();
    // … and picking one writes the covered style field through updateStyleProps.
    fireEvent.click(screen.getByRole('button', { name: 'Align inside' }));
    expect((useDoc.getState().styles['sd-square'].props as DotStyle).strokeAlign).toBe('inside');
  });

  it('hides the stroke-alignment selector for a dash tick (stroke is inert)', () => {
    render(<StyleEditor def={useDoc.getState().styles['sd-dash']} />);
    expect(screen.queryByRole('button', { name: 'Align inside' })).toBeNull();
  });
});
