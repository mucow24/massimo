import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ColorPalette } from './ColorPalette';
import { useDoc } from '../../state/store';
import { DEFAULT_DOC } from '../../model/transforms';

beforeEach(() => {
  localStorage.clear();
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
});

describe('<ColorPalette /> sections', () => {
  it('renders one section per active palette in PALETTES order', () => {
    useDoc.setState({ ...useDoc.getState(), activePalettes: ['mta', 'bart'] });
    render(<ColorPalette value="#0039A6" onChange={vi.fn()} />);
    const headers = Array.from(document.querySelectorAll('.color-palette-section-label')).map(
      (el) => el.textContent,
    );
    // BART precedes MTA alphabetically within North America.
    expect(headers).toEqual(['BART', 'MTA']);
  });

  it('with only MTA active, shows the 11 MTA swatches plus the custom swatch', () => {
    useDoc.setState({ ...useDoc.getState(), activePalettes: ['mta'] });
    render(<ColorPalette value="#0039A6" onChange={vi.fn()} />);
    expect(screen.getByTitle('Blue (A·C·E)')).toBeInTheDocument();
    // 11 MTA swatches.
    expect(document.querySelectorAll('.color-palette-section button').length).toBe(11);
    // The custom-color label uses '?' as its visible glyph.
    const customLabel = document.querySelector('label[title^="Custom"]');
    expect(customLabel).not.toBeNull();
  });

  it('with only BART active, MTA section is absent and BART swatches appear', () => {
    useDoc.setState({ ...useDoc.getState(), activePalettes: ['bart'] });
    render(<ColorPalette value="#FFE800" onChange={vi.fn()} />);
    expect(screen.queryByTitle('Blue (A·C·E)')).toBeNull();
    expect(screen.getByTitle('Yellow Line')).toBeInTheDocument();
    expect(document.querySelectorAll('.color-palette-section button').length).toBe(5);
  });

  it('clicking a swatch fires onChange with the swatch hex', async () => {
    const user = userEvent.setup();
    useDoc.setState({ ...useDoc.getState(), activePalettes: ['bart'] });
    const onChange = vi.fn();
    render(<ColorPalette value="#FFE800" onChange={onChange} />);
    await user.click(screen.getByTitle('Red Line'));
    expect(onChange).toHaveBeenCalledWith('#ED1C24');
  });

  it('the currently-selected swatch carries a thick selected border', () => {
    useDoc.setState({ ...useDoc.getState(), activePalettes: ['mta'] });
    render(<ColorPalette value="#0039A6" onChange={vi.fn()} />);
    const selected = screen.getByTitle('Blue (A·C·E)');
    // Border style is set inline; assert the 2px sentinel that the renderer uses.
    expect(selected.getAttribute('style') ?? '').toContain('2px solid');
  });

  it('isCustom is computed against ACTIVE palettes only — an MTA blue with only-BART active reads as custom', () => {
    useDoc.setState({ ...useDoc.getState(), activePalettes: ['bart'] });
    render(<ColorPalette value="#0039A6" onChange={vi.fn()} />);
    const customLabel = document.querySelector('label[title^="Custom"]');
    expect(customLabel).not.toBeNull();
    // When custom is engaged, the title includes the value in parentheses.
    expect(customLabel?.getAttribute('title')).toBe('Custom (#0039A6)');
  });

  it('toggling MTA on flips the same color back to a swatch hit (no longer custom)', () => {
    useDoc.setState({ ...useDoc.getState(), activePalettes: ['mta', 'bart'] });
    render(<ColorPalette value="#0039A6" onChange={vi.fn()} />);
    const customLabel = document.querySelector('label[title^="Custom"]');
    expect(customLabel?.getAttribute('title')).toBe('Custom');
  });
});
