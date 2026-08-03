import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ColorPalette } from './ColorPalette';
import { useDoc } from '../../state/store';
import { DEFAULT_DOC } from '../../model/transforms';
import { PALETTES, type Palette } from '../../model/palettes';
import type { Line } from '../../model/types';
import { edgesFromStations } from '../../model/lineTopology';

/** The named built-ins, as a map carries them (in the order asked for). */
const named = (...names: string[]): Palette[] =>
  names.flatMap((n) => PALETTES.filter((p) => p.name === n));

const FRRF: Palette = {
  name: 'frrf',
  swatches: [
    { name: '1', color: '#c1272d' },
    { name: '2', color: '#0061a8' },
  ],
};

const withPalettes = (palettes: Palette[], rest: Partial<typeof DEFAULT_DOC> = {}) =>
  useDoc.setState({ ...useDoc.getState(), palettes, ...rest });

beforeEach(() => {
  localStorage.clear();
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
});

describe('<ColorPalette /> sections', () => {
  it('renders one section per palette, in the MAP’s order', () => {
    withPalettes(named('MTA', 'BART'));
    render(<ColorPalette value="#0039A6" onChange={vi.fn()} />);
    const headers = Array.from(document.querySelectorAll('.color-palette-section-label')).map(
      (el) => el.textContent,
    );
    // The always-present Custom section is last.
    expect(headers).toEqual(['MTA', 'BART', 'Custom']);
  });

  it('reordering the map’s palettes reorders the sections', () => {
    withPalettes(named('BART', 'MTA'));
    render(<ColorPalette value="#0039A6" onChange={vi.fn()} />);
    const headers = Array.from(document.querySelectorAll('.color-palette-section-label')).map(
      (el) => el.textContent,
    );
    expect(headers).toEqual(['BART', 'MTA', 'Custom']);
  });

  it('with only MTA, shows the 11 MTA swatches plus the custom slot', () => {
    withPalettes(named('MTA'));
    render(<ColorPalette value="#0039A6" onChange={vi.fn()} />);
    expect(screen.getByTitle('Blue (A·C·E)')).toBeInTheDocument();
    // 11 MTA preset swatches; the empty Custom section adds none (its new-color
    // slot is a `.color-field-swatch`, not a `.color-swatch`).
    expect(document.querySelectorAll('.color-swatch').length).toBe(11);
    // The custom slot is the react-colorful ColorField swatch.
    expect(screen.getByLabelText('Custom color')).toBeInTheDocument();
  });

  it('with only BART, the MTA section is absent and BART swatches appear', () => {
    withPalettes(named('BART'));
    render(<ColorPalette value="#FFE800" onChange={vi.fn()} />);
    expect(screen.queryByTitle('Blue (A·C·E)')).toBeNull();
    expect(screen.getByTitle('Yellow Line')).toBeInTheDocument();
    expect(document.querySelectorAll('.color-swatch').length).toBe(5);
  });

  // A map may carry no palettes at all — the picker is still usable, because
  // hand-picked colors and the new-color field never depended on one.
  it('with no palettes at all, only the Custom section renders', () => {
    withPalettes([]);
    render(<ColorPalette value="#123456" onChange={vi.fn()} />);
    const headers = Array.from(document.querySelectorAll('.color-palette-section-label')).map(
      (el) => el.textContent,
    );
    expect(headers).toEqual(['Custom']);
    expect(screen.getByLabelText('Custom color')).toBeInTheDocument();
  });

  it('clicking a swatch fires onChange with the swatch hex', async () => {
    const user = userEvent.setup();
    withPalettes(named('BART'));
    const onChange = vi.fn();
    render(<ColorPalette value="#FFE800" onChange={onChange} />);
    await user.click(screen.getByTitle('Red Line'));
    expect(onChange).toHaveBeenCalledWith('#ED1C24');
  });

  it('the currently-selected swatch carries the selected class (thick themed ring)', () => {
    withPalettes(named('MTA'));
    render(<ColorPalette value="#0039A6" onChange={vi.fn()} />);
    const selected = screen.getByTitle('Blue (A·C·E)');
    // The ring itself lives in styles.css (.color-swatch.selected) so it can
    // flip with the theme; the class is the renderer's contract.
    expect(selected.classList.contains('selected')).toBe(true);
    // And exactly one swatch is marked selected.
    expect(document.querySelectorAll('.color-swatch.selected').length).toBe(1);
  });

  it('the new-color slot is an add affordance (a "+"), never a chip mirroring the value', () => {
    withPalettes(named('BART'));
    // #0039A6 (MTA blue) is not in the map's BART palette, yet the add slot must
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
    withPalettes(named('MTA'));
    render(<ColorPalette value="#0039A6" onChange={vi.fn()} />);
    expect(document.querySelector('input[type="color"]')).toBeNull();
    const swatch = screen.getByLabelText('Custom color');
    expect(swatch.tagName).toBe('BUTTON');
    await user.click(swatch);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('<ColorPalette /> imported palettes', () => {
  it('renders an imported palette section with line-name swatch hovers', () => {
    withPalettes([FRRF]);
    render(<ColorPalette value="#000000" onChange={vi.fn()} />);
    const headers = Array.from(document.querySelectorAll('.color-palette-section-label')).map(
      (el) => el.textContent,
    );
    expect(headers).toContain('frrf');
    // Swatch hover (title) is the `line` field from the loaded file.
    expect(screen.getByTitle('1')).toBeInTheDocument();
    expect(screen.getByTitle('2')).toBeInTheDocument();
  });

  it('a color in an imported palette is a swatch hit there, not a Custom entry', () => {
    withPalettes([FRRF]);
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
    edges: edgesFromStations([]),
  });

  it('always renders a Custom section, even when the map has no custom colors', () => {
    withPalettes(named('MTA'), { lines: {} });
    render(<ColorPalette value="#0039A6" onChange={vi.fn()} />);
    const headers = Array.from(document.querySelectorAll('.color-palette-section-label')).map(
      (el) => el.textContent,
    );
    expect(headers).toContain('Custom');
    // The new-color field is always present; no custom swatches yet.
    expect(screen.getByLabelText('Custom color')).toBeInTheDocument();
  });

  it('lists each distinct line color not in one of the map’s palettes as a Custom swatch', () => {
    withPalettes(named('MTA'), {
      lines: {
        L1: makeLine('L1', '#123456'),
        L2: makeLine('L2', '#0039A6'), // MTA Blue — in the map, so NOT custom
        L3: makeLine('L3', '#abcdef'),
        L4: makeLine('L4', '#123456'), // duplicate of L1 → one swatch
      },
    });
    render(<ColorPalette value="#123456" onChange={vi.fn()} />);
    expect(screen.getByTitle('#123456')).toBeInTheDocument();
    expect(screen.getByTitle('#abcdef')).toBeInTheDocument();
    // The MTA-blue line does not spawn a custom swatch (it's a palette swatch).
    expect(screen.queryByTitle('#0039A6')).toBeNull();
    // 11 MTA presets + 2 distinct custom colors.
    expect(document.querySelectorAll('.color-swatch').length).toBe(11 + 2);
  });

  it('a custom line color renders as the selected swatch, not the new-color field', () => {
    withPalettes(named('MTA'), { lines: { L1: makeLine('L1', '#123456') } });
    render(<ColorPalette value="#123456" onChange={vi.fn()} />);
    expect(screen.getByTitle('#123456').classList.contains('selected')).toBe(true);
    // Exactly one selected swatch, and the new-color ColorField isn't it.
    expect(document.querySelectorAll('.color-swatch.selected').length).toBe(1);
    expect(screen.getByLabelText('Custom color').getAttribute('title')).toBe('New custom color');
  });

  it('clicking a Custom swatch fires onChange with its hex', async () => {
    const user = userEvent.setup();
    withPalettes(named('MTA'), { lines: { L1: makeLine('L1', '#123456') } });
    const onChange = vi.fn();
    render(<ColorPalette value="#0039A6" onChange={onChange} />);
    await user.click(screen.getByTitle('#123456'));
    expect(onChange).toHaveBeenCalledWith('#123456');
  });

  it('removing a palette from the map moves its colors into Custom, adding it back takes them out', () => {
    // A BART-yellow line in a map carrying only MTA: #FFE800 reads as custom.
    withPalettes(named('MTA'), { lines: { L1: makeLine('L1', '#FFE800') } });
    const { rerender } = render(<ColorPalette value="#FFE800" onChange={vi.fn()} />);
    expect(screen.getByTitle('#FFE800')).toBeInTheDocument(); // custom swatch

    // Add BART: #FFE800 is now its "Yellow Line", no longer custom.
    withPalettes(named('MTA', 'BART'));
    rerender(<ColorPalette value="#FFE800" onChange={vi.fn()} />);
    expect(screen.getByTitle('Yellow Line')).toBeInTheDocument();
    expect(screen.queryByTitle('#FFE800')).toBeNull();
  });
});
