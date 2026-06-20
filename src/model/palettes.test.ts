import { describe, it, expect } from 'vitest';
import {
  PALETTES,
  activePalettes,
  cyclingColors,
  normalizePaletteIds,
  type Palette,
} from './palettes';

describe('PALETTES catalog', () => {
  it('lists palettes in alphabetical order, grouped by continent (asia → europe → na)', () => {
    expect(PALETTES.map((p) => p.id)).toEqual([
      // Asia, alphabetical
      'beijing-subway',
      'mtr',
      'shanghai-metro',
      'tokyo-subway',
      // Europe, alphabetical
      'berlin-ubahn',
      'paris-ratp',
      'tfl',
      // North America, alphabetical
      'bart',
      'caltrain',
      'cta',
      'la-metro',
      'mbta',
      'mta',
      'muni',
      'wmata',
    ]);
  });

  it('every continent group is internally sorted by display name (case-insensitive)', () => {
    const byContinent: Record<string, string[]> = {};
    for (const p of PALETTES) {
      // Built-in catalog palettes always declare a continent (only custom
      // palettes omit it).
      (byContinent[p.continent!] ??= []).push(p.name);
    }
    for (const names of Object.values(byContinent)) {
      const sorted = [...names].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
      expect(names).toEqual(sorted);
    }
  });

  it('continent groups appear in alphabetical continent order, contiguously', () => {
    const continents = PALETTES.map((p) => p.continent!);
    // Each continent appears in one contiguous block.
    const seen = new Set<string>();
    let prev: string | null = null;
    for (const c of continents) {
      if (c !== prev) {
        expect(seen.has(c)).toBe(false);
        seen.add(c);
        prev = c;
      }
    }
    // And the block order is alphabetical.
    expect([...seen]).toEqual([...seen].sort());
  });

  it('preserves the existing per-palette swatch counts', () => {
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
    expect(cyclingColors([], [])).toEqual([]);
  });

  it('returns all 11 MTA colors when only MTA is active', () => {
    const colors = cyclingColors(['mta'], []);
    expect(colors).toHaveLength(11);
    expect(colors[0]).toBe('#0039A6'); // MTA Blue, the historical first entry
  });

  it('concatenates active palettes in PALETTES declaration order, not input order', () => {
    // BART comes before MTA in the new ordering (alphabetical within
    // North America), so a [mta, bart] input still produces a [bart..., mta...]
    // output.
    const a = cyclingColors(['mta', 'bart'], []);
    const b = cyclingColors(['bart', 'mta'], []);
    expect(a).toEqual(b);
    expect(a).toHaveLength(16); // 11 MTA + 5 BART
    expect(a.slice(0, 5)).toEqual(cyclingColors(['bart'], []));
    expect(a.slice(5)).toEqual(cyclingColors(['mta'], []));
  });

  it('drops unknown ids silently', () => {
    expect(cyclingColors(['mta', 'nope'], [])).toEqual(cyclingColors(['mta'], []));
  });
});

describe('activePalettes', () => {
  it('returns palettes in PALETTES declaration order regardless of input order', () => {
    // BART comes before MTA in N. America (alphabetical).
    expect(activePalettes(['mta', 'bart'], []).map((p) => p.id)).toEqual(['bart', 'mta']);
  });

  it('drops unknown ids silently', () => {
    expect(activePalettes(['unknown'], [])).toEqual([]);
  });
});

describe('custom palettes', () => {
  const CUSTOM: Palette = {
    id: 'custom:frrf',
    name: 'frrf',
    swatches: [
      { name: '1', color: '#c1272d' },
      { name: '2', color: '#0061a8' },
    ],
  };

  it('activePalettes includes an active custom palette, before built-ins', () => {
    expect(activePalettes(['mta', 'custom:frrf'], [CUSTOM]).map((p) => p.id)).toEqual([
      'custom:frrf',
      'mta',
    ]);
  });

  it('activePalettes ignores a custom palette that is not active', () => {
    expect(activePalettes(['mta'], [CUSTOM]).map((p) => p.id)).toEqual(['mta']);
  });

  it('activePalettes drops ids that are neither built-in nor a known custom palette', () => {
    expect(activePalettes(['custom:frrf', 'nope'], [CUSTOM]).map((p) => p.id)).toEqual([
      'custom:frrf',
    ]);
  });

  it('cyclingColors puts the custom palette colors first, then built-ins', () => {
    const colors = cyclingColors(['mta', 'custom:frrf'], [CUSTOM]);
    expect(colors.slice(0, 2)).toEqual(['#c1272d', '#0061a8']);
    expect(colors).toHaveLength(2 + 11);
  });

  it('normalizePaletteIds keeps active custom ids (custom-first) and drops truly-unknown ones', () => {
    expect(normalizePaletteIds(['mta', 'custom:frrf', 'nope'], [CUSTOM])).toEqual([
      'custom:frrf',
      'mta',
    ]);
  });

  it('normalizePaletteIds with no custom arg drops custom ids (built-in-only behavior)', () => {
    expect(normalizePaletteIds(['mta', 'custom:frrf'])).toEqual(['mta']);
  });
});
