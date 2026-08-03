import { describe, it, expect, beforeEach } from 'vitest';
import { useDoc } from './store';
import { useCustomPalettes } from './customPalettes';
import { DEFAULT_DOC } from '../model/transforms';
import { FALLBACK_LINE_COLOR, type Palette } from '../model/palettes';

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
