import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ColorPalette } from './ColorPalette';
import { useDoc } from '../../state/store';
import { useCustomPalettes } from '../../state/customPalettes';
import { DEFAULT_DOC } from '../../model/transforms';

beforeEach(() => {
  localStorage.clear();
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
  useCustomPalettes.setState({ palettes: [] });
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
    // The custom slot is the react-colorful ColorField swatch.
    expect(screen.getByLabelText('Custom color')).toBeInTheDocument();
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

  it('the currently-selected swatch carries the selected class (thick themed ring)', () => {
    useDoc.setState({ ...useDoc.getState(), activePalettes: ['mta'] });
    render(<ColorPalette value="#0039A6" onChange={vi.fn()} />);
    const selected = screen.getByTitle('Blue (A·C·E)');
    // The ring itself lives in styles.css (.color-swatch.selected) so it can
    // flip with the theme; the class is the renderer's contract.
    expect(selected.classList.contains('selected')).toBe(true);
    // And exactly one swatch is marked selected.
    expect(document.querySelectorAll('.color-swatch.selected').length).toBe(1);
  });

  it('isCustom is computed against ACTIVE palettes only — an MTA blue with only-BART active reads as custom', () => {
    useDoc.setState({ ...useDoc.getState(), activePalettes: ['bart'] });
    render(<ColorPalette value="#0039A6" onChange={vi.fn()} />);
    const custom = screen.getByLabelText('Custom color');
    // When custom is engaged, the title includes the value in parentheses.
    expect(custom.getAttribute('title')).toBe('Custom (#0039A6)');
  });

  it('toggling MTA on flips the same color back to a swatch hit (no longer custom)', () => {
    useDoc.setState({ ...useDoc.getState(), activePalettes: ['mta', 'bart'] });
    render(<ColorPalette value="#0039A6" onChange={vi.fn()} />);
    expect(screen.getByLabelText('Custom color').getAttribute('title')).toBe('Custom');
  });

  // The custom slot no longer hosts a hidden native <input type=color> (which
  // needed a positioned containing block to avoid stretching the scrolled
  // inspector). It's a ColorField button whose picker portals to <body>, so it
  // can't push the document taller. Guard that the native input is gone and the
  // swatch opens the RGBA picker instead.
  it('the custom slot is a ColorField button with no in-flow native color input', async () => {
    const user = userEvent.setup();
    useDoc.setState({ ...useDoc.getState(), activePalettes: ['mta'] });
    render(<ColorPalette value="#0039A6" onChange={vi.fn()} />);
    expect(document.querySelector('input[type="color"]')).toBeNull();
    const swatch = screen.getByLabelText('Custom color');
    expect(swatch.tagName).toBe('BUTTON');
    await user.click(swatch);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('<ColorPalette /> custom palettes', () => {
  const seedFrrf = () =>
    useCustomPalettes.setState({
      palettes: [
        {
          id: 'custom:frrf',
          name: 'frrf',
          swatches: [
            { name: '1', color: '#c1272d' },
            { name: '2', color: '#0061a8' },
          ],
        },
      ],
    });

  it('renders an active custom palette section with line-name swatch hovers', () => {
    seedFrrf();
    useDoc.setState({ ...useDoc.getState(), activePalettes: ['custom:frrf'] });
    render(<ColorPalette value="#000000" onChange={vi.fn()} />);
    const headers = Array.from(document.querySelectorAll('.color-palette-section-label')).map(
      (el) => el.textContent,
    );
    expect(headers).toContain('frrf');
    // Swatch hover (title) is the `line` field from the loaded file.
    expect(screen.getByTitle('1')).toBeInTheDocument();
    expect(screen.getByTitle('2')).toBeInTheDocument();
  });

  it('a color in an active custom palette is recognized (not the custom "?" chip)', () => {
    seedFrrf();
    useDoc.setState({ ...useDoc.getState(), activePalettes: ['custom:frrf'] });
    render(<ColorPalette value="#c1272d" onChange={vi.fn()} />);
    // Recognized swatch hit → plain "Custom", not "Custom (#c1272d)".
    expect(screen.getByLabelText('Custom color').getAttribute('title')).toBe('Custom');
  });
});
