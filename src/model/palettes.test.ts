import { describe, it, expect } from 'vitest';
import {
  PALETTES,
  BUILTIN_PALETTE_NAMES,
  LEGACY_BUILTIN_IDS,
  cyclingColors,
  customLineColors,
  libraryPalettes,
  type Palette,
} from './palettes';

const builtin = (name: string): Palette => {
  const p = PALETTES.find((x) => x.name === name);
  if (!p) throw new Error(`no built-in palette named ${name}`);
  return p;
};

const MTA = builtin('MTA');
const BART = builtin('BART');

const FRRF: Palette = {
  name: 'frrf',
  swatches: [
    { name: '1', color: '#c1272d' },
    { name: '2', color: '#0061a8' },
  ],
};

describe('PALETTES catalog', () => {
  // Names are the library's key — a duplicate would make one of the two
  // unreachable, and `BUILTIN_PALETTE_NAMES` would silently under-count.
  it('every built-in name is distinct', () => {
    expect(BUILTIN_PALETTE_NAMES.size).toBe(PALETTES.length);
  });

  it('preserves the existing per-palette swatch counts', () => {
    expect(MTA.swatches).toHaveLength(11);
    expect(BART.swatches).toHaveLength(5);
    expect(builtin('Caltrain').swatches).toHaveLength(3);
  });

  it('every swatch has a non-empty name and a 6-digit hex color', () => {
    for (const p of PALETTES) {
      for (const s of p.swatches) {
        expect(s.name.length).toBeGreaterThan(0);
        expect(s.color).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });

  it('every retired id names a palette that still exists', () => {
    for (const name of Object.values(LEGACY_BUILTIN_IDS)) {
      expect(BUILTIN_PALETTE_NAMES.has(name)).toBe(true);
    }
    expect(Object.keys(LEGACY_BUILTIN_IDS)).toHaveLength(PALETTES.length);
  });
});

describe('libraryPalettes', () => {
  it('lists built-ins and imports together, by name', () => {
    const rows = libraryPalettes([FRRF], [], 'name');
    expect(rows).toHaveLength(PALETTES.length + 1);
    const names = rows.map((p) => p.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(names).toContain('frrf');
  });

  it('marks built-ins, and leaves imports unmarked', () => {
    const rows = libraryPalettes([FRRF], [], 'name');
    expect(rows.find((p) => p.name === 'MTA')?.builtin).toBe(true);
    expect(rows.find((p) => p.name === 'frrf')?.builtin).toBeUndefined();
  });

  it('marks starred rows, built-in or imported', () => {
    const rows = libraryPalettes([FRRF], ['MTA', 'frrf'], 'name');
    expect(rows.find((p) => p.name === 'MTA')?.starred).toBe(true);
    expect(rows.find((p) => p.name === 'frrf')?.starred).toBe(true);
    expect(rows.find((p) => p.name === 'BART')?.starred).toBeUndefined();
  });

  // Case-insensitively, as an A–Z list reads: lowercase `frrf` sits between
  // BART and MTA rather than after both.
  it('the starred sort shows ONLY starred rows, by name', () => {
    const rows = libraryPalettes([FRRF], ['MTA', 'frrf', 'BART'], 'starred');
    expect(rows.map((p) => p.name)).toEqual(['BART', 'frrf', 'MTA']);
  });

  it('the starred sort over nothing starred is empty', () => {
    expect(libraryPalettes([FRRF], [], 'starred')).toEqual([]);
  });

  it('a star on a name the library no longer holds lists nothing', () => {
    expect(libraryPalettes([], ['deleted'], 'starred')).toEqual([]);
  });
});

describe('cyclingColors', () => {
  it('returns an empty list for a map with no palettes', () => {
    expect(cyclingColors([])).toEqual([]);
  });

  it('returns all 11 MTA colors for a map holding only MTA', () => {
    const colors = cyclingColors([MTA]);
    expect(colors).toHaveLength(11);
    expect(colors[0]).toBe('#0039A6'); // MTA Blue, the historical first entry
  });

  it('concatenates in the MAP’s palette order', () => {
    expect(cyclingColors([BART, MTA])).toEqual([...cyclingColors([BART]), ...cyclingColors([MTA])]);
    expect(cyclingColors([MTA, BART])).toEqual([...cyclingColors([MTA]), ...cyclingColors([BART])]);
  });

  it('includes an imported palette’s colors like any other', () => {
    const colors = cyclingColors([FRRF, MTA]);
    expect(colors.slice(0, 2)).toEqual(['#c1272d', '#0061a8']);
    expect(colors).toHaveLength(2 + 11);
  });
});

describe('customLineColors', () => {
  const inMap = [MTA]; // 11 swatches, incl. Blue #0039A6

  it('returns [] when there are no line colors', () => {
    expect(customLineColors([], inMap)).toEqual([]);
  });

  it('excludes colors that are a swatch in one of the map’s palettes', () => {
    expect(customLineColors(['#0039A6'], inMap)).toEqual([]);
  });

  it('matches the map’s palette colors case-insensitively', () => {
    expect(customLineColors(['#0039a6'], inMap)).toEqual([]);
  });

  it('keeps colors not present in any of the map’s palettes', () => {
    expect(customLineColors(['#123456'], inMap)).toEqual(['#123456']);
  });

  it('dedupes, keeping first-seen order and the original spelling', () => {
    expect(customLineColors(['#123456', '#ABCDEF', '#123456', '#abcdef'], inMap)).toEqual([
      '#123456',
      '#ABCDEF',
    ]);
  });

  it('is scoped to the map — a color from a palette the map lacks reads as custom', () => {
    // #FFE800 is BART's Yellow Line, but a map holding only MTA never shows it
    // as a swatch.
    expect(customLineColors(['#FFE800'], inMap)).toEqual(['#FFE800']);
  });

  it('excludes colors from an imported palette the map holds', () => {
    expect(customLineColors(['#c1272d'], [MTA, FRRF])).toEqual([]);
    // …and with frrf removed from the map, that color is custom again.
    expect(customLineColors(['#c1272d'], inMap)).toEqual(['#c1272d']);
  });
});
