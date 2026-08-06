import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Exporting a palette downloads a file; jsdom has no download, and the real
// helper touches URL.createObjectURL.
vi.mock('../export/exportCanvas', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../export/exportCanvas')>()),
  downloadBlob: vi.fn(),
}));

import { PalettesDialog, PALETTE_ROW_HEIGHT } from './PalettesDialog';
import { downloadBlob } from '../export/exportCanvas';
import { useDoc } from '../state/store';
import { useCustomPalettes } from '../state/customPalettes';
import { DEFAULT_DOC } from '../model/transforms';
import { PALETTES, type Palette } from '../model/palettes';
import { chooseOption } from '../test/interaction';
import { makeLine } from '../test/fixtures';

const FRRF: Palette = {
  name: 'frrf',
  swatches: [
    { name: '1', color: '#c1272d' },
    { name: '2', color: '#0061a8' },
  ],
};

const named = (...names: string[]): Palette[] =>
  names.flatMap((n) => PALETTES.filter((p) => p.name === n));

const onClose = vi.fn();
const renderDialog = () => render(<PalettesDialog onClose={onClose} />);

// The dialog portals into document.body, so the render container is empty.
const column = (label: string) => screen.getByRole('region', { name: label });
const libraryColumn = () => column('Palette library');
const mapColumn = () => column('Palettes in this map');
const rowNames = (root: HTMLElement) =>
  [...root.querySelectorAll('.palette-row strong')].map((el) => el.textContent);

type User = ReturnType<typeof userEvent.setup>;

// A row keeps two commands; the rest live behind its `…`. Opening one closes
// any other, so a test wanting two of them compares them one at a time.
const openMore = (user: User, name: string) =>
  user.click(screen.getByRole('button', { name: `More actions for ${name}` }));
const rowCommand = async (user: User, row: string, command: string) => {
  await openMore(user, row);
  await user.click(await screen.findByRole('button', { name: command }));
};

beforeEach(() => {
  localStorage.clear();
  onClose.mockReset();
  vi.mocked(downloadBlob).mockReset();
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
  useCustomPalettes.setState({ palettes: [], starred: [], sort: 'name' });
});

describe('<PalettesDialog /> two columns', () => {
  it('lists the whole library on the left, by name', () => {
    useCustomPalettes.setState({ palettes: [FRRF], starred: [], sort: 'name' });
    renderDialog();
    const names = rowNames(libraryColumn());
    expect(names).toHaveLength(PALETTES.length + 1);
    expect(names).toEqual([...names].sort((a, b) => (a ?? '').localeCompare(b ?? '')));
  });

  it('lists only the map’s palettes on the right, in the map’s order', () => {
    useDoc.setState({ ...useDoc.getState(), palettes: named('MTA', 'BART') });
    renderDialog();
    expect(rowNames(mapColumn())).toEqual(['MTA', 'BART']);
  });

  it('says so when the map carries no palettes', () => {
    useDoc.setState({ ...useDoc.getState(), palettes: [] });
    renderDialog();
    expect(within(mapColumn()).getByText(/carries no palettes/)).toBeInTheDocument();
  });
});

describe('<PalettesDialog /> library → map', () => {
  it('adds a library palette to the map', async () => {
    const user = userEvent.setup();
    useDoc.setState({ ...useDoc.getState(), palettes: [] });
    renderDialog();
    await user.click(screen.getByRole('button', { name: 'Add BART to the map' }));
    expect(useDoc.getState().palettes.map((p) => p.name)).toEqual(['BART']);
  });

  it('a palette the map already holds identically offers nothing to do', () => {
    useDoc.setState({ ...useDoc.getState(), palettes: named('MTA') });
    renderDialog();
    expect(screen.getByRole('button', { name: 'MTA is already in the map' })).toBeDisabled();
  });

  // Name is the key, so adding over one destroys the map's palette of that
  // name. It asks first, exactly as the destinations that undo can't reach do.
  it('an add that would overwrite the map’s palette arms first', async () => {
    const user = userEvent.setup();
    const old = [{ name: 'old', color: '#000000' }];
    useCustomPalettes.setState({ palettes: [FRRF], starred: [], sort: 'name' });
    useDoc.setState({ ...useDoc.getState(), palettes: [{ name: 'frrf', swatches: old }] });
    renderDialog();
    await user.click(screen.getByRole('button', { name: 'Replace frrf in the map' }));
    // Armed, not done.
    expect(useDoc.getState().palettes[0].swatches).toEqual(old);
    await user.click(screen.getByRole('button', { name: 'Confirm replacing frrf in the map' }));
    expect(useDoc.getState().palettes[0].swatches).toEqual(FRRF.swatches);
  });

  it('an add that displaces nothing goes on one click', async () => {
    const user = userEvent.setup();
    useCustomPalettes.setState({ palettes: [FRRF], starred: [], sort: 'name' });
    useDoc.setState({ ...useDoc.getState(), palettes: [] });
    renderDialog();
    await user.click(screen.getByRole('button', { name: 'Add frrf to the map' }));
    expect(useDoc.getState().palettes).toEqual([FRRF]);
  });

  it('the map’s copy is independent — deleting from the library leaves it', async () => {
    const user = userEvent.setup();
    useCustomPalettes.setState({ palettes: [FRRF], starred: [], sort: 'name' });
    useDoc.setState({ ...useDoc.getState(), palettes: [FRRF] });
    renderDialog();
    await rowCommand(user, 'frrf', 'Delete frrf');
    await user.click(screen.getByRole('button', { name: 'Confirm deleting frrf' }));
    expect(useCustomPalettes.getState().palettes).toEqual([]);
    expect(useDoc.getState().palettes.map((p) => p.name)).toEqual(['frrf']);
  });
});

describe('<PalettesDialog /> the map column', () => {
  // Every destructive command in this window arms first, wherever it points:
  // one Delete, one gesture, in both columns.
  it('arms before removing a palette from the map', async () => {
    const user = userEvent.setup();
    useDoc.setState({ ...useDoc.getState(), palettes: named('MTA', 'BART') });
    renderDialog();
    await rowCommand(user, 'BART in the map', 'Remove BART from the map');
    // Armed, not done.
    expect(useDoc.getState().palettes.map((p) => p.name)).toEqual(['MTA', 'BART']);
    await user.click(screen.getByRole('button', { name: 'Confirm removing BART from the map' }));
    expect(useDoc.getState().palettes.map((p) => p.name)).toEqual(['MTA']);
  });

  // The unarmed state must look like the library's Delete, not like a warning:
  // the red is what the SECOND click wears. Only one toolbar opens at a time,
  // so the two are read one after the other.
  it('the unarmed remove is dressed exactly like the library’s Delete', async () => {
    const user = userEvent.setup();
    useCustomPalettes.setState({ palettes: [FRRF], starred: [], sort: 'name' });
    useDoc.setState({ ...useDoc.getState(), palettes: named('MTA', 'BART') });
    renderDialog();
    await openMore(user, 'BART in the map');
    const remove = await screen.findByRole('button', { name: 'Remove BART from the map' });
    expect(remove.classList.contains('danger')).toBe(false);
    const removeClass = remove.className;
    await openMore(user, 'frrf');
    expect((await screen.findByRole('button', { name: 'Delete frrf' })).className).toBe(
      removeClass,
    );
  });

  // The map column reorders by dragging a row's handle — the editor's gesture.
  it('drag-reorders the map’s palettes by the row handle', () => {
    useDoc.setState({ ...useDoc.getState(), palettes: named('MTA', 'BART') });
    renderDialog();
    const handle = screen.getByRole('button', { name: 'Reorder BART' });
    fireEvent.pointerDown(handle, { clientY: 100, pointerId: 1, buttons: 1 });
    fireEvent.pointerMove(handle, { clientY: 100 - PALETTE_ROW_HEIGHT, pointerId: 1, buttons: 1 });
    expect(useDoc.getState().palettes.map((p) => p.name)).toEqual(['MTA', 'BART']); // preview only
    fireEvent.pointerUp(handle, { clientY: 100 - PALETTE_ROW_HEIGHT, pointerId: 1 });
    expect(useDoc.getState().palettes.map((p) => p.name)).toEqual(['BART', 'MTA']);
  });

  it('a drag past either end clamps to the list', () => {
    useDoc.setState({ ...useDoc.getState(), palettes: named('MTA', 'BART') });
    renderDialog();
    const handle = screen.getByRole('button', { name: 'Reorder MTA' });
    fireEvent.pointerDown(handle, { clientY: 300, pointerId: 1, buttons: 1 });
    fireEvent.pointerMove(handle, {
      clientY: 300 - 5 * PALETTE_ROW_HEIGHT,
      pointerId: 1,
      buttons: 1,
    });
    fireEvent.pointerUp(handle, { clientY: 300 - 5 * PALETTE_ROW_HEIGHT, pointerId: 1 });
    expect(useDoc.getState().palettes.map((p) => p.name)).toEqual(['MTA', 'BART']);
    fireEvent.pointerDown(handle, { clientY: 100, pointerId: 1, buttons: 1 });
    fireEvent.pointerMove(handle, {
      clientY: 100 + 9 * PALETTE_ROW_HEIGHT,
      pointerId: 1,
      buttons: 1,
    });
    fireEvent.pointerUp(handle, { clientY: 100 + 9 * PALETTE_ROW_HEIGHT, pointerId: 1 });
    expect(useDoc.getState().palettes.map((p) => p.name)).toEqual(['BART', 'MTA']);
  });

  // Renaming lives in the editor now: the pencil opens it, the title edits.
  it('renames the map’s copy through the editor without touching the library', async () => {
    const user = userEvent.setup();
    useCustomPalettes.setState({ palettes: [FRRF], starred: [], sort: 'name' });
    useDoc.setState({ ...useDoc.getState(), palettes: [FRRF] });
    renderDialog();
    await rowCommand(user, 'frrf in the map', 'Edit frrf in the map');
    await user.dblClick(screen.getByRole('heading', { level: 3, name: 'frrf' }));
    const input = screen.getByRole('textbox', { name: 'Palette name' });
    await user.clear(input);
    await user.type(input, 'house style{Enter}');
    expect(useDoc.getState().palettes.map((p) => p.name)).toEqual(['house style']);
    expect(useCustomPalettes.getState().palettes.map((p) => p.name)).toEqual(['frrf']);
    // The editor stays open on the renamed palette.
    expect(screen.getByRole('heading', { level: 3, name: 'house style' })).toBeInTheDocument();
  });

  it('a refused rename surfaces in the dialog’s message band', async () => {
    const user = userEvent.setup();
    useDoc.setState({ ...useDoc.getState(), palettes: named('MTA', 'BART') });
    renderDialog();
    await rowCommand(user, 'BART in the map', 'Edit BART in the map');
    await user.dblClick(screen.getByRole('heading', { level: 3, name: 'BART' }));
    const input = screen.getByRole('textbox', { name: 'Palette name' });
    await user.clear(input);
    await user.type(input, 'MTA{Enter}');
    expect(useDoc.getState().palettes.map((p) => p.name)).toEqual(['MTA', 'BART']);
    expect(screen.getByRole('alert')).toHaveTextContent('already one of this map’s palettes');
  });

  it('saves a map-only palette to the library', async () => {
    const user = userEvent.setup();
    useDoc.setState({ ...useDoc.getState(), palettes: [FRRF] });
    renderDialog();
    await user.click(screen.getByRole('button', { name: 'Save frrf to the library' }));
    expect(useCustomPalettes.getState().palettes).toEqual([FRRF]);
  });

  // An armed speed bump must be able to stand down: any press elsewhere or
  // Escape un-arms it without running anything.
  it('clicking anywhere else stands an armed delete down', async () => {
    const user = userEvent.setup();
    useCustomPalettes.setState({ palettes: [FRRF], starred: [], sort: 'name' });
    renderDialog();
    await rowCommand(user, 'frrf', 'Delete frrf');
    expect(screen.getByRole('button', { name: 'Confirm deleting frrf' })).toBeInTheDocument();
    // A press outside takes the toolbar with it, so the bump has to be found
    // again — and it must be found UNARMED, or a stale prime would be waiting.
    await user.click(screen.getByRole('heading', { name: 'Library' }));
    expect(screen.queryByRole('button', { name: 'Confirm deleting frrf' })).toBeNull();
    await openMore(user, 'frrf');
    expect(await screen.findByRole('button', { name: 'Delete frrf' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm deleting frrf' })).toBeNull();
    expect(useCustomPalettes.getState().palettes.map((p) => p.name)).toEqual(['frrf']);
  });

  it('Escape stands an armed delete down without closing the dialog', async () => {
    const user = userEvent.setup();
    useCustomPalettes.setState({ palettes: [FRRF], starred: [], sort: 'name' });
    renderDialog();
    await rowCommand(user, 'frrf', 'Delete frrf');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('button', { name: 'Confirm deleting frrf' })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('region', { name: 'Palette library' })).toBeInTheDocument();
  });

  // localStorage is outside undo, so an overwriting save gets the speed bump.
  it('a save that would overwrite the library arms first', async () => {
    const user = userEvent.setup();
    useCustomPalettes.setState({
      palettes: [{ name: 'frrf', swatches: [{ name: 'old', color: '#000000' }] }],
      starred: [],
      sort: 'name',
    });
    useDoc.setState({ ...useDoc.getState(), palettes: [FRRF] });
    renderDialog();
    await user.click(
      screen.getByRole('button', { name: 'Save frrf to the library, replacing the one there' }),
    );
    // Armed, not done.
    expect(useCustomPalettes.getState().palettes[0].swatches[0].color).toBe('#000000');
    await user.click(screen.getByRole('button', { name: 'Confirm replacing frrf in the library' }));
    expect(useCustomPalettes.getState().palettes).toEqual([FRRF]);
  });
});

// What a built-in withholds — edit, delete — is asserted where those commands
// now live, in the … toolbar describe above. What's left here is the map
// column's side of it.
describe('<PalettesDialog /> built-ins are fixed', () => {
  it('an untouched built-in in the map reads as already in the library', () => {
    useDoc.setState({ ...useDoc.getState(), palettes: named('MTA') });
    renderDialog();
    expect(screen.getByRole('button', { name: 'MTA is in the library' })).toBeDisabled();
  });

  // …but a DIVERGED copy under a built-in's name is not in the library, and
  // saying it is would be a lie with no way out of it.
  it('a diverged copy under a built-in’s name says to rename it', () => {
    useDoc.setState({ ...useDoc.getState(), palettes: [{ name: 'MTA', swatches: [] }] });
    renderDialog();
    expect(screen.queryByRole('button', { name: 'MTA is in the library' })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Rename MTA to save it — the library’s is built in' }),
    ).toBeDisabled();
  });
});

describe('<PalettesDialog /> stars and sorting', () => {
  it('stars a built-in, and the Starred sort shows only starred rows', async () => {
    const user = userEvent.setup();
    useCustomPalettes.setState({ palettes: [FRRF], starred: [], sort: 'name' });
    renderDialog();
    await user.click(screen.getByRole('button', { name: 'Star MTA' }));
    expect(useCustomPalettes.getState().starred).toEqual(['MTA']);
    await chooseOption(user, 'Sort palettes', 'Starred');
    expect(rowNames(libraryColumn())).toEqual(['MTA']);
  });

  it('unstarring the last starred row leaves the Starred sort saying so', async () => {
    const user = userEvent.setup();
    useCustomPalettes.setState({ palettes: [FRRF], starred: ['frrf'], sort: 'starred' });
    renderDialog();
    expect(rowNames(libraryColumn())).toEqual(['frrf']);
    await user.click(screen.getByRole('button', { name: 'Unstar frrf' }));
    expect(within(libraryColumn()).getByText('No starred palettes.')).toBeInTheDocument();
  });

  it('the sort mode is remembered', async () => {
    const user = userEvent.setup();
    renderDialog();
    await chooseOption(user, 'Sort palettes', 'Starred');
    expect(useCustomPalettes.getState().sort).toBe('starred');
  });
});

describe('<PalettesDialog /> Load…', () => {
  const file = (body: unknown) =>
    new File([JSON.stringify(body)], 'p.json', { type: 'application/json' });
  const loadInput = () => screen.getByLabelText('Load palette file');

  it('puts a loaded palette in BOTH the library and the map', async () => {
    const user = userEvent.setup();
    useDoc.setState({ ...useDoc.getState(), palettes: [] });
    renderDialog();
    await user.upload(loadInput(), file({ name: 'frrf', colors: [{ line: 1, human: '#c1272d' }] }));
    expect(useCustomPalettes.getState().palettes.map((p) => p.name)).toEqual(['frrf']);
    expect(useDoc.getState().palettes.map((p) => p.name)).toEqual(['frrf']);
  });

  // A load is the one collision that can't be warned about first — the name
  // arrives with the file — so it reports what it displaced. It lands in BOTH
  // destinations, so it has to account for both.
  it('says so when the load replaced a library palette', async () => {
    const user = userEvent.setup();
    useCustomPalettes.setState({ palettes: [FRRF], starred: [], sort: 'name' });
    useDoc.setState({ ...useDoc.getState(), palettes: [] });
    renderDialog();
    await user.upload(loadInput(), file({ name: 'frrf', colors: [{ line: 1, human: '#00ff00' }] }));
    expect(screen.getByRole('status')).toHaveTextContent('your library');
    expect(screen.getByRole('status')).not.toHaveTextContent('this map');
    expect(useCustomPalettes.getState().palettes[0].swatches).toEqual([
      { name: '1', color: '#00ff00' },
    ]);
  });

  it('says so when the load replaced a palette the MAP was carrying', async () => {
    const user = userEvent.setup();
    useDoc.setState({ ...useDoc.getState(), palettes: [FRRF] });
    renderDialog();
    await user.upload(loadInput(), file({ name: 'frrf', colors: [{ line: 1, human: '#00ff00' }] }));
    expect(screen.getByRole('status')).toHaveTextContent('this map');
    expect(useDoc.getState().palettes[0].swatches).toEqual([{ name: '1', color: '#00ff00' }]);
  });

  it('names both when the load replaced one in each', async () => {
    const user = userEvent.setup();
    useCustomPalettes.setState({ palettes: [FRRF], starred: [], sort: 'name' });
    useDoc.setState({ ...useDoc.getState(), palettes: [FRRF] });
    renderDialog();
    await user.upload(loadInput(), file({ name: 'frrf', colors: [{ line: 1, human: '#00ff00' }] }));
    const said = screen.getByRole('status').textContent ?? '';
    expect(said).toContain('your library');
    expect(said).toContain('this map');
  });

  // A load that displaced nothing is not a failure, and must not wear the red
  // band that a rejected file does.
  it('reports a plain load as a notice, never as an alert', async () => {
    const user = userEvent.setup();
    useDoc.setState({ ...useDoc.getState(), palettes: [] });
    renderDialog();
    await user.upload(loadInput(), file({ name: 'frrf', colors: [{ line: 1, human: '#c1272d' }] }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('frrf');
  });

  it('carries a massimo-palette file’s description into both destinations', async () => {
    const user = userEvent.setup();
    useDoc.setState({ ...useDoc.getState(), palettes: [] });
    renderDialog();
    await user.upload(
      loadInput(),
      file({
        format: 'massimo-palette',
        version: 1,
        name: 'described',
        description: 'weekend reds',
        colors: [{ name: 'Red', day: '#C1272DFF', night: '#C1272DFF' }],
      }),
    );
    expect(useCustomPalettes.getState().palettes[0].description).toBe('weekend reds');
    expect(useDoc.getState().palettes[0].description).toBe('weekend reds');
  });

  it('refuses a file named after a built-in, changing nothing', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.upload(loadInput(), file({ name: 'MTA', colors: [{ line: 1, human: '#00ff00' }] }));
    expect(screen.getByRole('alert')).toHaveTextContent('is a built-in palette’s name');
    expect(useCustomPalettes.getState().palettes).toEqual([]);
    expect(useDoc.getState().palettes).toEqual(DEFAULT_DOC.palettes);
  });

  it('reports a malformed file', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.upload(loadInput(), file({ name: 'x' }));
    expect(screen.getByRole('alert')).toHaveTextContent('colors');
    expect(useCustomPalettes.getState().palettes).toEqual([]);
  });
});

describe('<PalettesDialog /> New… and the editor view', () => {
  const newMenu = async (user: ReturnType<typeof userEvent.setup>, item: string | RegExp) => {
    await user.click(screen.getByRole('button', { name: 'New…' }));
    await user.click(await screen.findByRole('menuitem', { name: item }));
  };

  it('From empty mints a fresh name into BOTH destinations and opens the editor naming it', async () => {
    const user = userEvent.setup();
    renderDialog();
    await newMenu(user, 'From empty…');
    expect(useCustomPalettes.getState().palettes.map((p) => p.name)).toEqual(['New palette']);
    expect(useDoc.getState().palettes.map((p) => p.name)).toEqual(['MTA', 'New palette']);
    // Editor view, title already editing (it's a fresh palette), no columns.
    expect(screen.getByRole('textbox', { name: 'Palette name' })).toHaveValue('New palette');
    expect(screen.queryByRole('region', { name: 'Palette library' })).toBeNull();
  });

  it('a second From empty counts up past the first', async () => {
    const user = userEvent.setup();
    renderDialog();
    await newMenu(user, 'From empty…');
    await user.keyboard('{Escape}'); // cancel the title edit
    await user.click(screen.getByRole('button', { name: 'Back to palettes' }));
    await newMenu(user, 'From empty…');
    expect(useDoc.getState().palettes.map((p) => p.name)).toEqual([
      'MTA',
      'New palette',
      'New palette 2',
    ]);
  });

  it('From map’s custom colors seeds the colors no palette covers', async () => {
    const user = userEvent.setup();
    useDoc.setState({
      ...useDoc.getState(),
      lines: { A: makeLine({ id: 'A', color: '#123456' }) },
    });
    renderDialog();
    await newMenu(user, 'From map’s custom colors…');
    const palettes = useDoc.getState().palettes;
    expect(palettes[palettes.length - 1]).toEqual({
      name: 'New palette',
      swatches: [{ name: '1', color: '#123456' }],
    });
  });

  it('From map’s custom colors is inert when every line color is covered', async () => {
    const user = userEvent.setup();
    useDoc.setState({ ...useDoc.getState(), lines: {} });
    renderDialog();
    await user.click(screen.getByRole('button', { name: 'New…' }));
    const item = await screen.findByRole('menuitem', { name: 'From map’s custom colors…' });
    expect(item).toHaveAttribute('data-disabled');
    await user.click(item);
    expect(useDoc.getState().palettes.map((p) => p.name)).toEqual(['MTA']);
  });

  // The dialog is MODAL: Radix traps focus inside Dialog.Content, so a color
  // picker portalled outside it (ColorField's default `.app` target) would
  // have its focus yanked and an untypeable hex field. The popover must mount
  // INSIDE the dialog.
  it('a color picker opened from the editor mounts inside the dialog', async () => {
    const user = userEvent.setup();
    useDoc.setState({ ...useDoc.getState(), palettes: [FRRF] });
    renderDialog();
    await rowCommand(user, 'frrf in the map', 'Edit frrf in the map');
    await user.click(screen.getByRole('button', { name: 'Color 1' }));
    const picker = screen.getByRole('dialog', { name: 'Color 1 picker' });
    expect(document.querySelector('.dialog')?.contains(picker)).toBe(true);
  });

  it('the pencil opens the editor on that palette, and Back restores the columns', async () => {
    const user = userEvent.setup();
    useCustomPalettes.setState({ palettes: [FRRF], starred: [], sort: 'name' });
    renderDialog();
    await rowCommand(user, 'frrf', 'Edit frrf');
    expect(screen.getByRole('heading', { level: 3, name: 'frrf' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Palette library' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Back to palettes' }));
    expect(screen.getByRole('region', { name: 'Palette library' })).toBeInTheDocument();
  });

  it('the title band reads Palette Editor while editing, Palettes otherwise', async () => {
    const user = userEvent.setup();
    useDoc.setState({ ...useDoc.getState(), palettes: [FRRF] });
    renderDialog();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Palettes');
    await rowCommand(user, 'frrf in the map', 'Edit frrf in the map');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Palette Editor');
    await user.click(screen.getByRole('button', { name: 'Back to palettes' }));
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Palettes');
  });

  // The app's global shortcut handler treats anything inside a role=dialog as
  // a form context, so the dialog owns its own undo keys.
  it('Ctrl+Z inside the dialog undoes the last palette edit', async () => {
    const user = userEvent.setup();
    useDoc.setState({ ...useDoc.getState(), palettes: [FRRF] });
    renderDialog();
    await rowCommand(user, 'frrf in the map', 'Edit frrf in the map');
    await user.click(screen.getByRole('button', { name: 'Add color' }));
    expect(useDoc.getState().palettes[0].swatches).toHaveLength(3);
    await user.keyboard('{Control>}z{/Control}');
    expect(useDoc.getState().palettes[0].swatches).toHaveLength(2);
    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
    expect(useDoc.getState().palettes[0].swatches).toHaveLength(3);
  });

  it('the dialog drags by its title band', () => {
    renderDialog();
    const header = screen.getByRole('heading', { level: 2 }).closest('header')!;
    fireEvent.pointerDown(header, { clientX: 100, clientY: 100, pointerId: 1, buttons: 1 });
    fireEvent.pointerMove(header, { clientX: 140, clientY: 130, pointerId: 1, buttons: 1 });
    fireEvent.pointerUp(header, { pointerId: 1 });
    const content = document.querySelector('.palette-manager') as HTMLElement;
    expect(content.style.left).toBe('40px');
    expect(content.style.top).toBe('30px');
  });

  it('Escape peels one layer at a time: name edit, then editor, then dialog', async () => {
    const user = userEvent.setup();
    useDoc.setState({ ...useDoc.getState(), palettes: [FRRF] });
    renderDialog();
    await rowCommand(user, 'frrf in the map', 'Edit frrf in the map');
    await user.dblClick(screen.getByRole('heading', { level: 3, name: 'frrf' }));

    await user.keyboard('{Escape}'); // cancels the edit, stays in the editor
    expect(screen.queryByRole('textbox', { name: 'Palette name' })).toBeNull();
    expect(screen.getByRole('heading', { level: 3, name: 'frrf' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await user.keyboard('{Escape}'); // leaves the editor, stays in the dialog
    expect(screen.getByRole('region', { name: 'Palette library' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await user.keyboard('{Escape}'); // now the dialog itself
    expect(onClose).toHaveBeenCalled();
  });
});

describe('<PalettesDialog /> the row’s … toolbar', () => {
  // The row keeps only the two commands that carry state or point somewhere:
  // the star / transfer arrow, and the map's drag handle.
  it('holds every other command, and shows none of them until it opens', async () => {
    const user = userEvent.setup();
    useCustomPalettes.setState({ palettes: [FRRF], starred: [], sort: 'name' });
    renderDialog();
    expect(screen.queryByRole('button', { name: 'Delete frrf' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Export frrf' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit frrf' })).toBeNull();
    // …but the two that stayed are there all along.
    expect(screen.getByRole('button', { name: 'Star frrf' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add frrf to the map' })).toBeInTheDocument();

    await openMore(user, 'frrf');
    expect(await screen.findByRole('button', { name: 'Delete frrf' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export frrf' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit frrf' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Make a copy of frrf' })).toBeInTheDocument();
  });

  it('a built-in’s toolbar offers only what a built-in can do', async () => {
    const user = userEvent.setup();
    renderDialog();
    await openMore(user, 'MTA');
    expect(await screen.findByRole('button', { name: 'Export MTA' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Make a copy of MTA' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit MTA' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete MTA' })).toBeNull();
  });

  // The panel must mount INSIDE Dialog.Content: the dialog is modal, and Radix
  // would yank focus off a panel portalled anywhere else. Same assertion the
  // editor's color picker carries, for the same reason.
  it('mounts inside the dialog, not beside it', async () => {
    const user = userEvent.setup();
    useCustomPalettes.setState({ palettes: [FRRF], starred: [], sort: 'name' });
    renderDialog();
    await openMore(user, 'frrf');
    const panel = await screen.findByRole('button', { name: 'Delete frrf' });
    expect(document.querySelector('.dialog')?.contains(panel)).toBe(true);
  });

  it('opening one row’s toolbar closes another’s', async () => {
    const user = userEvent.setup();
    useCustomPalettes.setState({ palettes: [FRRF], starred: [], sort: 'name' });
    renderDialog();
    await openMore(user, 'frrf');
    expect(await screen.findByRole('button', { name: 'Delete frrf' })).toBeInTheDocument();
    await openMore(user, 'MTA');
    expect(await screen.findByRole('button', { name: 'Export MTA' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete frrf' })).toBeNull();
  });
});

describe('<PalettesDialog /> Make copy', () => {
  it('copies a library palette into the library, beside the original', async () => {
    const user = userEvent.setup();
    useCustomPalettes.setState({ palettes: [FRRF], starred: [], sort: 'name' });
    useDoc.setState({ ...useDoc.getState(), palettes: [] });
    renderDialog();
    await rowCommand(user, 'frrf', 'Make a copy of frrf');
    expect(useCustomPalettes.getState().palettes).toEqual([FRRF, { ...FRRF, name: 'frrf copy' }]);
    // The library is the source, so the map is left out of it entirely.
    expect(useDoc.getState().palettes).toEqual([]);
  });

  // A copy is just a copy: it lands and the columns stay put. (New… opens the
  // editor because a blank palette is useless until you fill it; a copy isn't.)
  it('does not open the editor', async () => {
    const user = userEvent.setup();
    useCustomPalettes.setState({ palettes: [FRRF], starred: [], sort: 'name' });
    renderDialog();
    await rowCommand(user, 'frrf', 'Make a copy of frrf');
    expect(screen.getByRole('region', { name: 'Palette library' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Palette name' })).toBeNull();
  });

  it('counts up when the copy’s name is taken', async () => {
    const user = userEvent.setup();
    useCustomPalettes.setState({ palettes: [FRRF], starred: [], sort: 'name' });
    renderDialog();
    await rowCommand(user, 'frrf', 'Make a copy of frrf');
    await rowCommand(user, 'frrf', 'Make a copy of frrf');
    expect(useCustomPalettes.getState().palettes.map((p) => p.name)).toEqual([
      'frrf',
      'frrf copy',
      'frrf copy 2',
    ]);
  });

  // The reason this command earns its place: a built-in cannot be edited, and
  // copying it is how you get one you CAN edit without going through a map.
  it('forks a built-in into an editable library palette', async () => {
    const user = userEvent.setup();
    renderDialog();
    await rowCommand(user, 'MTA', 'Make a copy of MTA');
    const copy = useCustomPalettes.getState().palettes;
    expect(copy.map((p) => p.name)).toEqual(['MTA copy']);
    expect(copy[0].swatches).toEqual(named('MTA')[0].swatches);
    await openMore(user, 'MTA copy');
    expect(await screen.findByRole('button', { name: 'Edit MTA copy' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete MTA copy' })).toBeInTheDocument();
  });

  it('copies a map palette into the map, and undoes in one step', async () => {
    const user = userEvent.setup();
    useCustomPalettes.setState({ palettes: [], starred: [], sort: 'name' });
    useDoc.setState({ ...useDoc.getState(), palettes: named('MTA', 'BART') });
    renderDialog();
    await rowCommand(user, 'BART in the map', 'Make a copy of BART in the map');
    expect(useDoc.getState().palettes.map((p) => p.name)).toEqual(['MTA', 'BART', 'BART copy']);
    // The map is the source, so the library is left out of it.
    expect(useCustomPalettes.getState().palettes).toEqual([]);
    await user.keyboard('{Control>}z{/Control}');
    expect(useDoc.getState().palettes.map((p) => p.name)).toEqual(['MTA', 'BART']);
  });

  // The copy's name is minted, not chosen, and the row can land anywhere in an
  // A–Z list of seventeen — or, under the Starred sort, nowhere at all, since
  // that sort FILTERS and a fresh copy is unstarred. Without a word from the
  // window the command reads as a no-op, and clicking again silently mints
  // "frrf copy 2".
  it('names what it minted, even when the sort hides the new row', async () => {
    const user = userEvent.setup();
    useCustomPalettes.setState({ palettes: [FRRF], starred: ['frrf'], sort: 'starred' });
    renderDialog();
    await rowCommand(user, 'frrf', 'Make a copy of frrf');
    expect(useCustomPalettes.getState().palettes.map((p) => p.name)).toEqual(['frrf', 'frrf copy']);
    expect(rowNames(libraryColumn())).toEqual(['frrf']); // the sort hides it
    expect(screen.getByRole('status')).toHaveTextContent('frrf copy');
  });

  it('names what it minted in the map too', async () => {
    const user = userEvent.setup();
    useDoc.setState({ ...useDoc.getState(), palettes: named('BART') });
    renderDialog();
    await rowCommand(user, 'BART in the map', 'Make a copy of BART in the map');
    expect(screen.getByRole('status')).toHaveTextContent('BART copy');
    expect(screen.queryByRole('alert')).toBeNull(); // a copy is not a failure
  });

  it('carries the description but not the star', async () => {
    const user = userEvent.setup();
    const described = { ...FRRF, description: 'weekend reds' };
    useCustomPalettes.setState({ palettes: [described], starred: ['frrf'], sort: 'name' });
    renderDialog();
    await rowCommand(user, 'frrf', 'Make a copy of frrf');
    const copy = useCustomPalettes.getState().palettes[1];
    expect(copy.description).toBe('weekend reds');
    expect(useCustomPalettes.getState().starred).toEqual(['frrf']);
  });

  it('the copy is independent — editing it leaves the original alone', async () => {
    const user = userEvent.setup();
    useCustomPalettes.setState({ palettes: [FRRF], starred: [], sort: 'name' });
    renderDialog();
    await rowCommand(user, 'frrf', 'Make a copy of frrf');
    await rowCommand(user, 'frrf copy', 'Edit frrf copy');
    await user.click(screen.getByRole('button', { name: 'Add color' }));
    const [original, copy] = useCustomPalettes.getState().palettes;
    expect(original.swatches).toHaveLength(2);
    expect(copy.swatches).toHaveLength(3);
  });
});

describe('<PalettesDialog /> export', () => {
  it('exports a palette in the format the loader reads', async () => {
    const user = userEvent.setup();
    useCustomPalettes.setState({ palettes: [FRRF], starred: [], sort: 'name' });
    renderDialog();
    await rowCommand(user, 'frrf', 'Export frrf');
    expect(downloadBlob).toHaveBeenCalledTimes(1);
    expect(vi.mocked(downloadBlob).mock.calls[0][1]).toBe('frrf.palette.json');
  });

  it('exports a built-in too — that is how one leaves the app', async () => {
    const user = userEvent.setup();
    renderDialog();
    await rowCommand(user, 'BART', 'Export BART');
    expect(vi.mocked(downloadBlob).mock.calls[0][1]).toBe('BART.palette.json');
  });

  // The map's copy can have diverged from the library's — renamed, or replaced
  // from a file — so it is exportable in its own right.
  it('exports the MAP’s copy, diverged name and all', async () => {
    const user = userEvent.setup();
    useDoc.setState({
      ...useDoc.getState(),
      palettes: [{ name: 'house style', swatches: [{ name: '1', color: '#c1272d' }] }],
    });
    renderDialog();
    await rowCommand(user, 'house style in the map', 'Export house style from the map');
    expect(vi.mocked(downloadBlob).mock.calls[0][1]).toBe('house style.palette.json');
  });

  // Palette names come out of imported files, so they reach the filename with
  // whatever the author put in them.
  it('strips filename-illegal characters from the download name', async () => {
    const user = userEvent.setup();
    useCustomPalettes.setState({
      palettes: [{ name: 'a/b:c*d', swatches: [{ name: '1', color: '#111111' }] }],
      starred: [],
      sort: 'name',
    });
    renderDialog();
    await rowCommand(user, 'a/b:c*d', 'Export a/b:c*d');
    expect(vi.mocked(downloadBlob).mock.calls[0][1]).toBe('abcd.palette.json');
  });

  it('falls back to a usable name when every character is illegal', async () => {
    const user = userEvent.setup();
    useCustomPalettes.setState({
      palettes: [{ name: '///', swatches: [{ name: '1', color: '#111111' }] }],
      starred: [],
      sort: 'name',
    });
    renderDialog();
    await rowCommand(user, '///', 'Export ///');
    expect(vi.mocked(downloadBlob).mock.calls[0][1]).toBe('palette.palette.json');
  });
});
