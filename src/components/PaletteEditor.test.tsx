import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PaletteEditor, PALETTE_EDITOR_ROW_HEIGHT, type PaletteSource } from './PaletteEditor';
import { useDoc } from '../state/store';
import { useCustomPalettes } from '../state/customPalettes';
import { DEFAULT_DOC } from '../model/transforms';
import { type Palette } from '../model/palettes';
import { legibleTextOn } from '../util/color';
import { setColorField } from '../test/colorField';
import { makeLine } from '../test/fixtures';

const FRRF: Palette = {
  name: 'frrf',
  swatches: [
    { name: 'Red', color: '#c1272d' },
    { name: 'Yellow', color: '#ffe800' },
  ],
};

const onBack = vi.fn();
const onRenamed = vi.fn();
const setError = vi.fn();
const inlineEditRef = { current: false };

const renderEditor = (source: PaletteSource, name: string, autoEditTitle = false) =>
  render(
    <PaletteEditor
      source={source}
      name={name}
      autoEditTitle={autoEditTitle}
      onBack={onBack}
      onRenamed={onRenamed}
      setError={setError}
      inlineEditRef={inlineEditRef}
    />,
  );

const mapSwatches = () => useDoc.getState().palettes.find((p) => p.name === 'frrf')?.swatches;
const librarySwatches = () =>
  useCustomPalettes.getState().palettes.find((p) => p.name === 'frrf')?.swatches;

beforeEach(() => {
  localStorage.clear();
  onBack.mockReset();
  onRenamed.mockReset();
  setError.mockReset();
  inlineEditRef.current = false;
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC, palettes: [FRRF] });
  useDoc.temporal.getState().clear();
  useCustomPalettes.setState({ palettes: [FRRF], starred: [], sort: 'name' });
});

describe('<PaletteEditor /> rows', () => {
  it('numbers each color with a route bullet in the color itself', () => {
    renderEditor('map', 'frrf');
    const bullets = [...document.querySelectorAll('.palette-bullet')];
    expect(bullets.map((b) => b.textContent)).toEqual(['1', '2']);
    // Colors compare through a probe element, so jsdom's normalization (hex →
    // rgb()) applies to both sides.
    const probe = document.createElement('span');
    bullets.forEach((b, i) => {
      probe.style.background = FRRF.swatches[i].color;
      expect((b as HTMLElement).style.background).toBe(probe.style.background);
      probe.style.color = legibleTextOn(FRRF.swatches[i].color);
      expect((b as HTMLElement).style.color).toBe(probe.style.color);
    });
  });

  it('adds a gray color named by its position', async () => {
    const user = userEvent.setup();
    renderEditor('map', 'frrf');
    await user.click(screen.getByRole('button', { name: 'Add color' }));
    expect(mapSwatches()).toEqual([...FRRF.swatches, { name: '3', color: '#888888' }]);
  });

  it('recolors through the color field, collapsing any stored night', async () => {
    const user = userEvent.setup();
    useDoc.setState({
      ...useDoc.getState(),
      palettes: [{ name: 'frrf', swatches: [{ name: 'Red', color: '#c1272d', night: '#7a1a1d' }] }],
    });
    renderEditor('map', 'frrf');
    await setColorField(user, 'Color 1', '#123456');
    expect(mapSwatches()).toEqual([{ name: 'Red', color: '#123456' }]);
  });

  // The map paints from its palettes, so recoloring a swatch takes the lines
  // wearing that color along — matched the way the picker matches
  // (normalizeHex), and live per picker gesture.
  it('recoloring a map swatch repaints the lines wearing that color', async () => {
    const user = userEvent.setup();
    useDoc.setState({
      ...useDoc.getState(),
      lines: {
        L: makeLine({ id: 'L', color: '#C1272D' }),
        M: makeLine({ id: 'M', color: '#123456' }),
      },
    });
    renderEditor('map', 'frrf');
    await setColorField(user, 'Color 1', '#00ff00');
    expect(useDoc.getState().lines.L.color).toBe('#00ff00');
    expect(useDoc.getState().lines.M.color).toBe('#123456');
  });

  it('the Add color row sits at the top of the list', () => {
    renderEditor('map', 'frrf');
    const list = document.querySelector('.palette-editor-list');
    expect(list?.firstElementChild?.className).toContain('palette-editor-add');
  });

  it('a library editor writes the library and leaves the doc alone', async () => {
    const user = userEvent.setup();
    renderEditor('library', 'frrf');
    await setColorField(user, 'Color 1', '#123456');
    expect(librarySwatches()?.[0]).toEqual({ name: 'Red', color: '#123456' });
    expect(mapSwatches()).toEqual(FRRF.swatches);
  });

  it('renames a color on double-click, and an empty draft reverts', async () => {
    const user = userEvent.setup();
    renderEditor('map', 'frrf');
    await user.dblClick(screen.getByText('Red'));
    const input = screen.getByRole('textbox', { name: 'Rename color 1' });
    await user.clear(input);
    await user.type(input, 'Crimson{Enter}');
    expect(mapSwatches()?.[0].name).toBe('Crimson');

    await user.dblClick(screen.getByText('Crimson'));
    await user.clear(screen.getByRole('textbox', { name: 'Rename color 1' }));
    await user.keyboard('{Enter}');
    expect(mapSwatches()?.[0].name).toBe('Crimson');
  });

  it('deletes a color behind the speed bump', async () => {
    const user = userEvent.setup();
    renderEditor('map', 'frrf');
    await user.click(screen.getByRole('button', { name: 'Delete color 1' }));
    // Armed, not done.
    expect(mapSwatches()).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Confirm deleting color 1' }));
    expect(mapSwatches()).toEqual([{ name: 'Yellow', color: '#ffe800' }]);
  });

  it('drag-reorders a row by its handle, one undo entry for the drop', () => {
    renderEditor('map', 'frrf');
    const handle = screen.getByRole('button', { name: 'Reorder color 1' });
    fireEvent.pointerDown(handle, { clientY: 0, pointerId: 1, buttons: 1 });
    fireEvent.pointerMove(handle, {
      clientY: PALETTE_EDITOR_ROW_HEIGHT,
      pointerId: 1,
      buttons: 1,
    });
    expect(mapSwatches()?.[0].name).toBe('Red'); // preview only, no write yet
    fireEvent.pointerUp(handle, { clientY: PALETTE_EDITOR_ROW_HEIGHT, pointerId: 1 });
    expect(mapSwatches()?.map((s) => s.name)).toEqual(['Yellow', 'Red']);

    act(() => useDoc.temporal.getState().undo());
    expect(mapSwatches()?.map((s) => s.name)).toEqual(['Red', 'Yellow']);
  });
});

describe('<PaletteEditor /> title and description', () => {
  it('renames a map palette from the title, reporting the new name up', async () => {
    const user = userEvent.setup();
    renderEditor('map', 'frrf');
    await user.dblClick(screen.getByRole('heading', { level: 3, name: 'frrf' }));
    const input = screen.getByRole('textbox', { name: 'Palette name' });
    await user.clear(input);
    await user.type(input, 'house style{Enter}');
    expect(useDoc.getState().palettes.map((p) => p.name)).toEqual(['house style']);
    expect(useCustomPalettes.getState().palettes.map((p) => p.name)).toEqual(['frrf']);
    expect(onRenamed).toHaveBeenCalledWith('house style');
  });

  it('refuses a map rename onto another of the map’s palettes, and says why', async () => {
    const user = userEvent.setup();
    useDoc.setState({ ...useDoc.getState(), palettes: [FRRF, { name: 'other', swatches: [] }] });
    renderEditor('map', 'frrf');
    await user.dblClick(screen.getByRole('heading', { level: 3, name: 'frrf' }));
    const input = screen.getByRole('textbox', { name: 'Palette name' });
    await user.clear(input);
    await user.type(input, 'other{Enter}');
    expect(useDoc.getState().palettes.map((p) => p.name)).toEqual(['frrf', 'other']);
    expect(setError).toHaveBeenCalledWith('“other” is already one of this map’s palettes.');
    expect(onRenamed).not.toHaveBeenCalled();
  });

  it('renames a library palette, refusing a taken name with the library message', async () => {
    const user = userEvent.setup();
    useCustomPalettes.setState({
      palettes: [FRRF, { name: 'other', swatches: [] }],
      starred: [],
      sort: 'name',
    });
    renderEditor('library', 'frrf');
    await user.dblClick(screen.getByRole('heading', { level: 3, name: 'frrf' }));
    let input = screen.getByRole('textbox', { name: 'Palette name' });
    await user.clear(input);
    await user.type(input, 'other{Enter}');
    expect(setError).toHaveBeenCalledWith('“other” is already taken in your library.');
    expect(onRenamed).not.toHaveBeenCalled();

    await user.dblClick(screen.getByRole('heading', { level: 3, name: 'frrf' }));
    input = screen.getByRole('textbox', { name: 'Palette name' });
    await user.clear(input);
    await user.type(input, 'mine{Enter}');
    expect(useCustomPalettes.getState().palettes.map((p) => p.name)).toEqual(['mine', 'other']);
    expect(onRenamed).toHaveBeenCalledWith('mine');
  });

  it('the title opens already editing for a fresh palette', () => {
    renderEditor('map', 'frrf', true);
    expect(screen.getByRole('textbox', { name: 'Palette name' })).toHaveValue('frrf');
    expect(inlineEditRef.current).toBe(true);
  });

  it('sets, shows, and clears the description', async () => {
    const user = userEvent.setup();
    renderEditor('map', 'frrf');
    await user.dblClick(screen.getByText('Double-click to add a description'));
    await user.type(
      screen.getByRole('textbox', { name: 'Palette description' }),
      'weekend reds{Enter}',
    );
    expect(useDoc.getState().palettes[0].description).toBe('weekend reds');

    await user.dblClick(screen.getByText('weekend reds'));
    await user.clear(screen.getByRole('textbox', { name: 'Palette description' }));
    await user.keyboard('{Enter}');
    expect('description' in useDoc.getState().palettes[0]).toBe(false);
  });
});

describe('<PaletteEditor /> lifecycle', () => {
  it('falls back to the manager when the palette vanishes beneath it', () => {
    renderEditor('map', 'frrf');
    expect(onBack).not.toHaveBeenCalled();
    act(() => useDoc.setState({ ...useDoc.getState(), palettes: [] }));
    expect(onBack).toHaveBeenCalled();
  });
});
