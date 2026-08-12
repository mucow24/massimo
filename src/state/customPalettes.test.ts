import { describe, it, expect, beforeEach } from 'vitest';
import { useCustomPalettes } from './customPalettes';

const reset = () => {
  localStorage.clear();
  useCustomPalettes.setState({ palettes: [], starred: [], sort: 'name' });
};

const add = (name: string, color = '#111111') =>
  useCustomPalettes.getState().addPalette({ name, swatches: [{ name: '1', color }] });

describe('useCustomPalettes', () => {
  beforeEach(reset);

  it('adds a palette keyed by its name', () => {
    add('frrf', '#c1272d');
    const { palettes } = useCustomPalettes.getState();
    expect(palettes).toEqual([{ name: 'frrf', swatches: [{ name: '1', color: '#c1272d' }] }]);
  });

  it('upserts by name: re-adding a name replaces its swatches in place', () => {
    add('a', '#111111');
    add('b', '#222222');
    add('a', '#999999');
    const { palettes } = useCustomPalettes.getState();
    expect(palettes.map((p) => p.name)).toEqual(['a', 'b']); // position preserved
    expect(palettes[0].swatches).toEqual([{ name: '1', color: '#999999' }]);
  });

  it('refuses a name a built-in palette already uses', () => {
    expect(add('MTA')).toBe(false);
    expect(useCustomPalettes.getState().palettes).toEqual([]);
  });

  // A palette carries at least one color wherever it comes to rest, and the
  // library is the one place it rests longest.
  it('refuses a palette with no colors, changing nothing', () => {
    add('a');
    expect(useCustomPalettes.getState().addPalette({ name: 'empty', swatches: [] })).toBe(false);
    expect(useCustomPalettes.getState().palettes.map((p) => p.name)).toEqual(['a']);
  });

  it('refuses to empty a palette it already holds', () => {
    add('a', '#c1272d');
    useCustomPalettes.getState().addPalette({ name: 'a', swatches: [] });
    expect(useCustomPalettes.getState().palettes[0].swatches).toEqual([
      { name: '1', color: '#c1272d' },
    ]);
  });

  // The library and a map are meant to be independent, and saving a map's
  // palette back here is the one call that hands over a live document array.
  it('stores a COPY — the caller’s swatch array cannot reach the library', () => {
    const source = { name: 'a', swatches: [{ name: '1', color: '#111111' }] };
    useCustomPalettes.getState().addPalette(source);
    source.swatches.push({ name: '2', color: '#222222' });
    expect(useCustomPalettes.getState().palettes[0].swatches).toHaveLength(1);
  });

  it('removes a palette by name', () => {
    add('a');
    useCustomPalettes.getState().removePalette('a');
    expect(useCustomPalettes.getState().palettes).toEqual([]);
  });

  it('drops the star when the palette is removed', () => {
    add('a');
    useCustomPalettes.getState().setStarred('a', true);
    useCustomPalettes.getState().removePalette('a');
    expect(useCustomPalettes.getState().starred).toEqual([]);
  });

  it('renames a palette in place', () => {
    add('a');
    add('b');
    expect(useCustomPalettes.getState().renamePalette('a', 'z')).toBe(true);
    expect(useCustomPalettes.getState().palettes.map((p) => p.name)).toEqual(['z', 'b']);
  });

  it('carries the star through a rename', () => {
    add('a');
    useCustomPalettes.getState().setStarred('a', true);
    useCustomPalettes.getState().renamePalette('a', 'z');
    expect(useCustomPalettes.getState().starred).toEqual(['z']);
  });

  it('refuses a rename onto another custom palette’s name', () => {
    add('a');
    add('b');
    expect(useCustomPalettes.getState().renamePalette('a', 'b')).toBe(false);
    expect(useCustomPalettes.getState().palettes.map((p) => p.name)).toEqual(['a', 'b']);
  });

  it('refuses a rename onto a built-in name', () => {
    add('a');
    expect(useCustomPalettes.getState().renamePalette('a', 'MTA')).toBe(false);
    expect(useCustomPalettes.getState().palettes.map((p) => p.name)).toEqual(['a']);
  });

  it('stars a BUILT-IN palette — starring is by name, over the whole library', () => {
    useCustomPalettes.getState().setStarred('MTA', true);
    expect(useCustomPalettes.getState().starred).toEqual(['MTA']);
  });

  it('unstars', () => {
    useCustomPalettes.getState().setStarred('MTA', true);
    useCustomPalettes.getState().setStarred('MTA', false);
    expect(useCustomPalettes.getState().starred).toEqual([]);
  });

  it('does not double-star', () => {
    useCustomPalettes.getState().setStarred('MTA', true);
    useCustomPalettes.getState().setStarred('MTA', true);
    expect(useCustomPalettes.getState().starred).toEqual(['MTA']);
  });

  it('persists palettes, stars and the sort mode', () => {
    add('frrf', '#c1272d');
    useCustomPalettes.getState().setStarred('MTA', true);
    useCustomPalettes.getState().setSort('starred');
    const state = JSON.parse(localStorage.getItem('massimo-custom-palettes-v1') as string).state;
    expect(state.palettes[0].name).toBe('frrf');
    expect(state.starred).toEqual(['MTA']);
    expect(state.sort).toBe('starred');
  });

  const persisted = (state: unknown, version: number) => {
    localStorage.setItem('massimo-custom-palettes-v1', JSON.stringify({ state, version }));
    useCustomPalettes.persist.rehydrate();
  };

  // v0 stored `custom:<slug>` ids alongside the name; the library is name-keyed
  // now, so the migration drops them.
  it('migrates v0 entries by dropping their ids', () => {
    persisted(
      { palettes: [{ id: 'custom:x', name: 'x', swatches: [{ name: '1', color: '#abcdef' }] }] },
      0,
    );
    expect(useCustomPalettes.getState().palettes).toEqual([
      { name: 'x', swatches: [{ name: '1', color: '#abcdef' }] },
    ]);
  });

  // v1 → v2: New… seeded the library with an empty palette on the way into the
  // editor, and only the map's copy ever got the colors — so the library kept
  // a stub under every name it minted, backed out of or not.
  it('migrates v1 by dropping the palettes carrying no colors', () => {
    const kept = { name: 'x', swatches: [{ name: '1', color: '#abcdef' }] };
    persisted({ palettes: [{ name: 'New palette', swatches: [] }, kept], starred: [] }, 1);
    expect(useCustomPalettes.getState().palettes).toEqual([kept]);
  });
});
