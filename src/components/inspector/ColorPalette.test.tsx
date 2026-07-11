import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ColorPalette } from './ColorPalette';
import { useDoc } from '../../state/store';
import { useCustomPalettes } from '../../state/customPalettes';
import { DEFAULT_DOC } from '../../model/transforms';
import type { Line } from '../../model/types';

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
    // BART precedes MTA alphabetically within North America; the always-present
    // Custom section is last.
    expect(headers).toEqual(['BART', 'MTA', 'Custom']);
  });

  it('with only MTA active, shows the 11 MTA swatches plus the custom slot', () => {
    useDoc.setState({ ...useDoc.getState(), activePalettes: ['mta'] });
    render(<ColorPalette value="#0039A6" onChange={vi.fn()} />);
    expect(screen.getByTitle('Blue (A·C·E)')).toBeInTheDocument();
    // 11 MTA preset swatches; the empty Custom section adds none (its new-color
    // slot is a `.color-field-swatch`, not a `.color-swatch`).
    expect(document.querySelectorAll('.color-swatch').length).toBe(11);
    // The custom slot is the react-colorful ColorField swatch.
    expect(screen.getByLabelText('Custom color')).toBeInTheDocument();
  });

  it('with only BART active, MTA section is absent and BART swatches appear', () => {
    useDoc.setState({ ...useDoc.getState(), activePalettes: ['bart'] });
    render(<ColorPalette value="#FFE800" onChange={vi.fn()} />);
    expect(screen.queryByTitle('Blue (A·C·E)')).toBeNull();
    expect(screen.getByTitle('Yellow Line')).toBeInTheDocument();
    expect(document.querySelectorAll('.color-swatch').length).toBe(5);
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

  it('the new-color slot is an add affordance (a "+"), never a chip mirroring the value', () => {
    useDoc.setState({ ...useDoc.getState(), activePalettes: ['bart'] });
    // #0039A6 (MTA blue) is not in the active BART palette, yet the add slot must
    // NOT surface it — it's a fixed "add a new color" button, not the value.
    render(<ColorPalette value="#0039A6" onChange={vi.fn()} />);
    const addBtn = screen.getByLabelText('Custom color');
    expect(addBtn.getAttribute('title')).toBe('New custom color');
    expect(addBtn.classList.contains('add-new')).toBe(true);
    expect(addBtn.querySelector('.color-field-add')).not.toBeNull();
    expect(addBtn.querySelector('.color-field-chip')).toBeNull();
    // It never carries the `selected` ring (it's an action, not a value).
    expect(addBtn.classList.contains('selected')).toBe(false);
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

  it('a color in an active custom palette is a swatch hit there, not a Custom entry', () => {
    seedFrrf();
    useDoc.setState({ ...useDoc.getState(), activePalettes: ['custom:frrf'] });
    render(<ColorPalette value="#c1272d" onChange={vi.fn()} />);
    // #c1272d is frrf's "1" swatch → selected there…
    expect(screen.getByTitle('1').classList.contains('selected')).toBe(true);
    // …and the add slot stays a plain "add a new color" button.
    expect(screen.getByLabelText('Custom color').getAttribute('title')).toBe('New custom color');
  });
});

describe('<ColorPalette /> custom colors from the map', () => {
  const makeLine = (id: string, color: string): Line => ({
    id,
    service: 'X',
    name: id,
    color,
    stations: [],
  });

  it('always renders a Custom section, even when the map has no custom colors', () => {
    useDoc.setState({ ...useDoc.getState(), activePalettes: ['mta'], lines: {} });
    render(<ColorPalette value="#0039A6" onChange={vi.fn()} />);
    const headers = Array.from(document.querySelectorAll('.color-palette-section-label')).map(
      (el) => el.textContent,
    );
    expect(headers).toContain('Custom');
    // The new-color field is always present; no custom swatches yet.
    expect(screen.getByLabelText('Custom color')).toBeInTheDocument();
  });

  it('lists each distinct line color not in an active palette as a Custom swatch', () => {
    useDoc.setState({
      ...useDoc.getState(),
      activePalettes: ['mta'],
      lines: {
        L1: makeLine('L1', '#123456'),
        L2: makeLine('L2', '#0039A6'), // MTA Blue — active, so NOT custom
        L3: makeLine('L3', '#abcdef'),
        L4: makeLine('L4', '#123456'), // duplicate of L1 → one swatch
      },
    });
    render(<ColorPalette value="#123456" onChange={vi.fn()} />);
    expect(screen.getByTitle('#123456')).toBeInTheDocument();
    expect(screen.getByTitle('#abcdef')).toBeInTheDocument();
    // The MTA-blue line does not spawn a custom swatch (it's an active swatch).
    expect(screen.queryByTitle('#0039A6')).toBeNull();
    // 11 MTA presets + 2 distinct custom colors.
    expect(document.querySelectorAll('.color-swatch').length).toBe(11 + 2);
  });

  it('a custom line color renders as the selected swatch, not the new-color field', () => {
    useDoc.setState({
      ...useDoc.getState(),
      activePalettes: ['mta'],
      lines: { L1: makeLine('L1', '#123456') },
    });
    render(<ColorPalette value="#123456" onChange={vi.fn()} />);
    expect(screen.getByTitle('#123456').classList.contains('selected')).toBe(true);
    // Exactly one selected swatch, and the new-color ColorField isn't it.
    expect(document.querySelectorAll('.color-swatch.selected').length).toBe(1);
    expect(screen.getByLabelText('Custom color').getAttribute('title')).toBe('New custom color');
  });

  it('clicking a Custom swatch fires onChange with its hex', async () => {
    const user = userEvent.setup();
    useDoc.setState({
      ...useDoc.getState(),
      activePalettes: ['mta'],
      lines: { L1: makeLine('L1', '#123456') },
    });
    const onChange = vi.fn();
    render(<ColorPalette value="#0039A6" onChange={onChange} />);
    await user.click(screen.getByTitle('#123456'));
    expect(onChange).toHaveBeenCalledWith('#123456');
  });

  it('toggling a palette off moves its colors into Custom, and back on removes them', () => {
    // A BART-yellow line with only MTA active: BART is off, so #FFE800 is custom.
    useDoc.setState({
      ...useDoc.getState(),
      activePalettes: ['mta'],
      lines: { L1: makeLine('L1', '#FFE800') },
    });
    const { rerender } = render(<ColorPalette value="#FFE800" onChange={vi.fn()} />);
    expect(screen.getByTitle('#FFE800')).toBeInTheDocument(); // custom swatch

    // Turn BART on: #FFE800 is now BART's "Yellow Line", no longer custom.
    useDoc.setState({ ...useDoc.getState(), activePalettes: ['mta', 'bart'] });
    rerender(<ColorPalette value="#FFE800" onChange={vi.fn()} />);
    expect(screen.getByTitle('Yellow Line')).toBeInTheDocument();
    expect(screen.queryByTitle('#FFE800')).toBeNull();
  });
});
