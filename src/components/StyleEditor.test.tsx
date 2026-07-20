import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StyleEditor } from './StyleEditor';
import { makeStyle } from '../test/fixtures';

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
});
