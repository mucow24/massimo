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

  // No custom colors in this map, so there is nothing to choose between: the
  // row is the plain button it has always been.
  it('adds a gray color named by its position, on one click', async () => {
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

  // Add color ends the description's line rather than spanning the list: the
  // menu it opens hangs off its edge, and a window-wide button hangs one at the
  // far side of the window.
  it('Add color stands in the head, beside the description', () => {
    renderEditor('map', 'frrf');
    expect(
      screen.getByRole('button', { name: 'Add color' }).closest('.palette-editor-subhead'),
    ).not.toBeNull();
    const list = document.querySelector('.palette-editor-list');
    expect(list?.firstElementChild?.className).toContain('palette-editor-row');
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

  // A palette carries at least one color, so once a row is the only one left
  // its delete stops being a command: it stands disabled, keeping the row's
  // shape. The reason is its NAME, not a title — Chrome renders no tooltip on
  // a disabled button, so a reason kept there would reach nobody at all.
  it('will not delete the last color', async () => {
    const user = userEvent.setup();
    renderEditor('map', 'frrf');
    await user.click(screen.getByRole('button', { name: 'Delete color 2' }));
    await user.click(screen.getByRole('button', { name: 'Confirm deleting color 2' }));

    expect(screen.queryByRole('button', { name: 'Delete color 1' })).toBeNull();
    const last = screen.getByRole('button', { name: 'A palette keeps at least one color' });
    expect(last).toBeDisabled();
    await user.click(last);
    expect(screen.queryByRole('button', { name: /^Confirm deleting/ })).toBeNull();
    expect(mapSwatches()).toEqual([{ name: 'Red', color: '#c1272d' }]);
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

// Once the map has colors of its own, Add color has something to choose
// between and becomes a menu: New, or one of those colors.
describe('<PaletteEditor /> Add color with custom colors about', () => {
  // #c1272d is frrf's Red, so it is NOT custom; the other two are.
  const withCustomColors = () =>
    useDoc.setState({
      ...useDoc.getState(),
      lines: {
        L: makeLine({ id: 'L', color: '#123456' }),
        M: makeLine({ id: 'M', color: '#c1272d' }),
        N: makeLine({ id: 'N', color: '#abcdef' }),
      },
    });
  const openAdd = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: 'Add color' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Custom color' }));
  };
  const offered = async () =>
    (await screen.findAllByRole('menuitem', { name: /^Add #/ })).map((el) =>
      el.getAttribute('aria-label'),
    );
  // The leaf flyout is hover-driven; userEvent's pointer movement tears it down
  // before the click lands, so fire the click directly on the leaf.
  const pick = async (hex: string) =>
    fireEvent.click(await screen.findByRole('menuitem', { name: `Add ${hex}` }));

  it('keeps the old behavior on New', async () => {
    const user = userEvent.setup();
    withCustomColors();
    renderEditor('map', 'frrf');
    await user.click(screen.getByRole('button', { name: 'Add color' }));
    await user.click(await screen.findByRole('menuitem', { name: 'New' }));
    expect(mapSwatches()).toEqual([...FRRF.swatches, { name: '3', color: '#888888' }]);
  });

  it('offers the line colors no palette covers, and only those', async () => {
    const user = userEvent.setup();
    withCustomColors();
    renderEditor('map', 'frrf');
    await openAdd(user);
    expect(await offered()).toEqual(['Add #123456', 'Add #abcdef']);
  });

  // Adding one to the MAP's palette covers it, so the offer empties as it is
  // taken up — the same set the manager's custom colors row shows.
  it('appends the color it was given, which is custom no longer', async () => {
    const user = userEvent.setup();
    withCustomColors();
    renderEditor('map', 'frrf');
    await openAdd(user);
    await pick('#123456');
    expect(mapSwatches()).toEqual([...FRRF.swatches, { name: '3', color: '#123456' }]);
    await openAdd(user);
    expect(await offered()).toEqual(['Add #abcdef']);
  });

  // Taking the last one leaves nothing to choose between, so the trigger
  // becomes the plain button again — under Radix, as it closes the menu and
  // restores focus to a trigger that is on its way out.
  it('falls back to the plain button when the last custom color is taken', async () => {
    const user = userEvent.setup();
    useDoc.setState({
      ...useDoc.getState(),
      lines: { L: makeLine({ id: 'L', color: '#123456' }) },
    });
    renderEditor('map', 'frrf');
    await openAdd(user);
    await pick('#123456');
    await user.click(screen.getByRole('button', { name: 'Add color' }));
    expect(mapSwatches()).toEqual([
      ...FRRF.swatches,
      { name: '3', color: '#123456' },
      { name: '4', color: '#888888' },
    ]);
  });

  // The custom colors are the MAP's either way — a library palette is where
  // you collect them to keep, and collecting them doesn't cover anything.
  it('offers them to a library palette too, and writes only the library', async () => {
    const user = userEvent.setup();
    withCustomColors();
    renderEditor('library', 'frrf');
    await openAdd(user);
    await pick('#123456');
    expect(librarySwatches()).toEqual([...FRRF.swatches, { name: '3', color: '#123456' }]);
    expect(mapSwatches()).toEqual(FRRF.swatches);
  });

  // Taking a color into a LIBRARY palette covers nothing, so the map's list
  // doesn't shrink — but the open palette holds that color now, and offering
  // it again is offering to add it twice.
  it('stops offering a color the open palette already holds', async () => {
    const user = userEvent.setup();
    withCustomColors();
    renderEditor('library', 'frrf');
    await openAdd(user);
    await pick('#123456');
    await openAdd(user);
    expect(await offered()).toEqual(['Add #abcdef']);
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
    useDoc.setState({
      ...useDoc.getState(),
      palettes: [FRRF, { name: 'other', swatches: [{ name: '1', color: '#0061a8' }] }],
    });
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
      palettes: [FRRF, { name: 'other', swatches: [{ name: '1', color: '#0061a8' }] }],
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
