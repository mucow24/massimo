import { describe, it, expect, beforeEach } from 'vitest';
import { useDoc } from './store';
import { useCustomPalettes } from './customPalettes';
import { DEFAULT_DOC } from '../model/transforms';
import { FALLBACK_LINE_COLOR, type Palette } from '../model/palettes';

const FRRF: Palette = {
  id: 'custom:frrf',
  name: 'frrf',
  swatches: [{ name: '1', color: '#abcdef' }],
};

beforeEach(() => {
  localStorage.clear();
  useDoc.setState({ ...DEFAULT_DOC });
  useCustomPalettes.setState({ palettes: [] });
});

describe('addLine with custom palettes', () => {
  it('cycles a custom palette color when only a custom palette is active', () => {
    useCustomPalettes.setState({ palettes: [FRRF] });
    useDoc.setState({ ...DEFAULT_DOC, activePalettes: ['custom:frrf'] });
    const id = useDoc.getState().addLine();
    expect(useDoc.getState().lines[id].color).toBe('#abcdef');
  });

  it('falls back to a neutral color when the active set resolves to no colors', () => {
    // A dangling custom reference (definition absent) yields an empty cycle.
    useDoc.setState({ ...DEFAULT_DOC, activePalettes: ['custom:gone'] });
    const id = useDoc.getState().addLine();
    expect(useDoc.getState().lines[id].color).toBe(FALLBACK_LINE_COLOR);
  });
});

describe('deleteCustomPalette', () => {
  it('removes the definition and prunes it from the active set', () => {
    useCustomPalettes.setState({ palettes: [FRRF] });
    useDoc.setState({ ...DEFAULT_DOC, activePalettes: ['mta', 'custom:frrf'] });
    useDoc.getState().deleteCustomPalette('custom:frrf');
    expect(useCustomPalettes.getState().palettes).toEqual([]);
    expect(useDoc.getState().activePalettes).toEqual(['mta']);
  });

  it('falls back to the default set when deleting the sole active palette', () => {
    useCustomPalettes.setState({ palettes: [FRRF] });
    useDoc.setState({ ...DEFAULT_DOC, activePalettes: ['custom:frrf'] });
    useDoc.getState().deleteCustomPalette('custom:frrf');
    expect(useCustomPalettes.getState().palettes).toEqual([]);
    expect(useDoc.getState().activePalettes).toEqual([...DEFAULT_DOC.activePalettes]);
  });

  it('leaves the active set alone when deleting an inactive custom palette', () => {
    useCustomPalettes.setState({ palettes: [FRRF] });
    useDoc.setState({ ...DEFAULT_DOC, activePalettes: ['mta'] });
    useDoc.getState().deleteCustomPalette('custom:frrf');
    expect(useCustomPalettes.getState().palettes).toEqual([]);
    expect(useDoc.getState().activePalettes).toEqual(['mta']);
  });
});
