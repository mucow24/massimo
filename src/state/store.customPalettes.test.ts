import { describe, it, expect, beforeEach } from 'vitest';
import { useDoc } from './store';
import { useCustomPalettes } from './customPalettes';
import { DEFAULT_DOC } from '../model/transforms';
import { FALLBACK_LINE_COLOR, type Palette } from '../model/palettes';
import { docKey } from './mapKeys';
import { tabMapId } from './libraryPointer';

const FRRF: Palette = { name: 'frrf', swatches: [{ name: '1', color: '#abcdef' }] };

beforeEach(() => {
  localStorage.clear();
  useDoc.setState({ ...DEFAULT_DOC });
  useCustomPalettes.setState({ palettes: [], starred: [], sort: 'name' });
});

describe('addLine over the map’s palettes', () => {
  it('cycles an imported palette’s color when that is all the map carries', () => {
    useDoc.setState({ ...DEFAULT_DOC, palettes: [FRRF] });
    const id = useDoc.getState().addLine();
    expect(useDoc.getState().lines[id].color).toBe('#abcdef');
  });

  it('falls back to a neutral color when the map carries no palettes', () => {
    useDoc.setState({ ...DEFAULT_DOC, palettes: [] });
    const id = useDoc.getState().addLine();
    expect(useDoc.getState().lines[id].color).toBe(FALLBACK_LINE_COLOR);
  });
});

// The whole point of the map holding copies: the library is a place to keep
// palettes, not the map's supply line.
describe('the library and the map are independent', () => {
  it('deleting from the library leaves the map’s copy painting', () => {
    useCustomPalettes.setState({ palettes: [FRRF], starred: [], sort: 'name' });
    useDoc.getState().addPaletteToMap(FRRF);
    useCustomPalettes.getState().removePalette('frrf');
    expect(useCustomPalettes.getState().palettes).toEqual([]);
    expect(useDoc.getState().palettes.map((p) => p.name)).toEqual(['MTA', 'frrf']);
  });

  it('a map can carry a palette the library never had', () => {
    useDoc.getState().addPaletteToMap(FRRF);
    expect(useCustomPalettes.getState().palettes).toEqual([]);
    expect(useDoc.getState().palettes.map((p) => p.name)).toEqual(['MTA', 'frrf']);
  });

  it('re-adding a corrected palette refreshes the map’s copy in place', () => {
    useDoc.getState().addPaletteToMap(FRRF);
    useDoc
      .getState()
      .addPaletteToMap({ name: 'frrf', swatches: [{ name: '1', color: '#000000' }] });
    expect(useDoc.getState().palettes[1].swatches).toEqual([{ name: '1', color: '#000000' }]);
  });
});

// The v<29 migration cleans what the old New… stored, but the editor still
// mints an empty palette into the doc at the CURRENT version — and a doc
// persisted there never reaches `migrate` at all. So the floor needs a door on
// every rehydrate, exactly like the cell-dust snap and the dot-size bake.
describe('the persist merge hook drops empty palettes', () => {
  // The live persist version, not a literal: the whole point is that the stored
  // version EQUALS the config's, so zustand skips `migrate` and only `merge`
  // can repair it. A hardcoded number stops testing that the day it bumps.
  const rehydrate = (palettes: unknown) => {
    localStorage.setItem(
      docKey(tabMapId()),
      JSON.stringify({ version: useDoc.persist.getOptions().version, state: { palettes } }),
    );
    useDoc.persist.rehydrate();
  };

  it('drops one left by closing the window on a fresh, unfilled palette', () => {
    rehydrate([FRRF, { name: 'New palette', swatches: [] }]);
    expect(useDoc.getState().palettes).toEqual([FRRF]);
  });

  it('passes a canonical list straight through, by reference', () => {
    const palettes = [FRRF];
    rehydrate(palettes);
    // Reference-stable like the other merge repairs — a doc with nothing to fix
    // must not be rewritten on the way in.
    expect(useDoc.getState().palettes).toEqual(palettes);
  });
});
