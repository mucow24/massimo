import { describe, it, expect } from 'vitest';
import { PALETTES, activePalettes, cyclingColors, type PaletteId } from './palettes';

describe('PALETTES catalog', () => {
  it('contains mta, bart, and caltrain in declaration order', () => {
    expect(PALETTES.map((p) => p.id)).toEqual(['mta', 'bart', 'caltrain']);
  });

  it('has the expected swatch counts per palette', () => {
    const byId = Object.fromEntries(PALETTES.map((p) => [p.id, p]));
    expect(byId.mta.swatches).toHaveLength(11);
    expect(byId.bart.swatches).toHaveLength(5);
    expect(byId.caltrain.swatches).toHaveLength(3);
  });

  it('every swatch has a non-empty name and a 6-digit hex color', () => {
    for (const p of PALETTES) {
      for (const s of p.swatches) {
        expect(s.name.length).toBeGreaterThan(0);
        expect(s.color).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });
});

describe('cyclingColors', () => {
  it('returns an empty list for no active palettes', () => {
    expect(cyclingColors([])).toEqual([]);
  });

  it('returns all 11 MTA colors when only MTA is active', () => {
    const colors = cyclingColors(['mta']);
    expect(colors).toHaveLength(11);
    expect(colors[0]).toBe('#0039A6'); // MTA Blue, the historical first entry
  });

  it('concatenates active palettes in PALETTES declaration order, not input order', () => {
    const a = cyclingColors(['bart', 'mta']);
    const b = cyclingColors(['mta', 'bart']);
    expect(a).toEqual(b);
    expect(a).toHaveLength(16); // 11 + 5
    expect(a.slice(0, 11)).toEqual(cyclingColors(['mta']));
    expect(a.slice(11)).toEqual(cyclingColors(['bart']));
  });

  it('drops unknown ids silently', () => {
    expect(cyclingColors(['mta', 'nope' as PaletteId])).toEqual(cyclingColors(['mta']));
  });
});

describe('activePalettes', () => {
  it('returns palettes in PALETTES declaration order regardless of input order', () => {
    expect(activePalettes(['caltrain', 'mta']).map((p) => p.id)).toEqual(['mta', 'caltrain']);
  });

  it('drops unknown ids silently', () => {
    expect(activePalettes(['unknown' as PaletteId])).toEqual([]);
  });
});
