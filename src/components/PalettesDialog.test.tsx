import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Exporting a palette downloads a file; jsdom has no download, and the real
// helper touches URL.createObjectURL.
vi.mock('../export/exportCanvas', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../export/exportCanvas')>()),
  downloadBlob: vi.fn(),
}));

import { PalettesDialog } from './PalettesDialog';
import { downloadBlob } from '../export/exportCanvas';
import { useDoc } from '../state/store';
import { useCustomPalettes } from '../state/customPalettes';
import { DEFAULT_DOC } from '../model/transforms';
import { PALETTES, type Palette } from '../model/palettes';
import { chooseOption } from '../test/interaction';

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
    await user.click(screen.getByRole('button', { name: 'Delete frrf' }));
    await user.click(screen.getByRole('button', { name: 'Confirm deleting frrf' }));
    expect(useCustomPalettes.getState().palettes).toEqual([]);
    expect(useDoc.getState().palettes.map((p) => p.name)).toEqual(['frrf']);
  });
});

describe('<PalettesDialog /> the map column', () => {
  it('removes a palette from the map on one click — undo can reach it', async () => {
    const user = userEvent.setup();
    useDoc.setState({ ...useDoc.getState(), palettes: named('MTA', 'BART') });
    renderDialog();
    await user.click(screen.getByRole('button', { name: 'Remove BART from the map' }));
    expect(useDoc.getState().palettes.map((p) => p.name)).toEqual(['MTA']);
  });

  it('moves a palette up and down', async () => {
    const user = userEvent.setup();
    useDoc.setState({ ...useDoc.getState(), palettes: named('MTA', 'BART') });
    renderDialog();
    await user.click(screen.getByRole('button', { name: 'Move BART up' }));
    expect(useDoc.getState().palettes.map((p) => p.name)).toEqual(['BART', 'MTA']);
    await user.click(screen.getByRole('button', { name: 'Move BART down' }));
    expect(useDoc.getState().palettes.map((p) => p.name)).toEqual(['MTA', 'BART']);
  });

  it('cannot move the first up or the last down', () => {
    useDoc.setState({ ...useDoc.getState(), palettes: named('MTA', 'BART') });
    renderDialog();
    expect(screen.getByRole('button', { name: 'Move MTA up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move BART down' })).toBeDisabled();
  });

  it('renames the map’s copy without touching the library', async () => {
    const user = userEvent.setup();
    useCustomPalettes.setState({ palettes: [FRRF], starred: [], sort: 'name' });
    useDoc.setState({ ...useDoc.getState(), palettes: [FRRF] });
    renderDialog();
    await user.click(screen.getByRole('button', { name: 'Rename frrf in the map' }));
    await user.clear(screen.getByRole('textbox', { name: 'Rename frrf' }));
    await user.type(screen.getByRole('textbox', { name: 'Rename frrf' }), 'house style{Enter}');
    expect(useDoc.getState().palettes.map((p) => p.name)).toEqual(['house style']);
    expect(useCustomPalettes.getState().palettes.map((p) => p.name)).toEqual(['frrf']);
  });

  it('refuses a rename onto another of the map’s palettes, and says why', async () => {
    const user = userEvent.setup();
    useDoc.setState({ ...useDoc.getState(), palettes: named('MTA', 'BART') });
    renderDialog();
    await user.click(screen.getByRole('button', { name: 'Rename BART in the map' }));
    await user.clear(screen.getByRole('textbox', { name: 'Rename BART' }));
    await user.type(screen.getByRole('textbox', { name: 'Rename BART' }), 'MTA{Enter}');
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

describe('<PalettesDialog /> built-ins are fixed', () => {
  it('cannot be renamed or deleted', () => {
    renderDialog();
    expect(screen.queryByRole('button', { name: 'Rename MTA' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete MTA' })).toBeNull();
  });

  it('…while an imported palette can be', () => {
    useCustomPalettes.setState({ palettes: [FRRF], starred: [], sort: 'name' });
    renderDialog();
    expect(screen.getByRole('button', { name: 'Rename frrf' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete frrf' })).toBeInTheDocument();
  });

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

describe('<PalettesDialog /> export', () => {
  it('exports a palette in the format the loader reads', async () => {
    const user = userEvent.setup();
    useCustomPalettes.setState({ palettes: [FRRF], starred: [], sort: 'name' });
    renderDialog();
    await user.click(screen.getByRole('button', { name: 'Export frrf' }));
    expect(downloadBlob).toHaveBeenCalledTimes(1);
    expect(vi.mocked(downloadBlob).mock.calls[0][1]).toBe('frrf.palette.json');
  });

  it('exports a built-in too — that is how one leaves the app', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('button', { name: 'Export BART' }));
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
    await user.click(screen.getByRole('button', { name: 'Export house style from the map' }));
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
    await user.click(screen.getByRole('button', { name: 'Export a/b:c*d' }));
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
    await user.click(screen.getByRole('button', { name: 'Export ///' }));
    expect(vi.mocked(downloadBlob).mock.calls[0][1]).toBe('palette.palette.json');
  });
});
