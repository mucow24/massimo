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
    const seamWidth = screen.getByRole('slider', { name: 'Seam width' }) as HTMLInputElement;
    expect(seamWidth.value).toBe('3');
  });

  it('inherits the casing width in the seam-width control when unset', () => {
    render(
      <StyleEditor
        def={makeStyle('line', 'y1', { props: { strokeWidth: 4 /* no seamWidth */ } })}
      />,
    );
    const seamWidth = screen.getByRole('slider', { name: 'Seam width' }) as HTMLInputElement;
    expect(seamWidth.value).toBe('4'); // inherits the casing rail width
  });
});
