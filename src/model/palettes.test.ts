import { describe, it, expect } from 'vitest';
import {
  PALETTES,
  BUILTIN_PALETTE_NAMES,
  LEGACY_BUILTIN_IDS,
  copyPalette,
  cyclingColors,
  customLineColors,
  freshPaletteName,
  isPaletteSort,
  libraryPalettes,
  PALETTE_SORTS,
  paletteContentEqual,
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

const DESIGN: Palette = {
  name: 'Design grays',
  kind: 'design',
  swatches: [
    { name: 'Border', color: '#333333', night: '#bbbbbb' },
    { name: 'Wash', color: '#eeeeee' },
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

describe('paletteContentEqual', () => {
  const base: Palette = {
    name: 'a',
    description: 'desc',
    swatches: [
      { name: '1', color: '#c1272d' },
      { name: '2', color: '#0061a8', night: '#003a66' },
    ],
  };

  it('ignores the name — content is swatches + description only', () => {
    expect(paletteContentEqual(base, { ...base, name: 'renamed' })).toBe(true);
  });

  it('a differing description breaks equality', () => {
    expect(paletteContentEqual(base, { ...base, description: 'other' })).toBe(false);
    // absent vs empty is a real difference (empty collapses away on edit)
    expect(paletteContentEqual(base, { ...base, description: undefined })).toBe(false);
  });

  it('compares night strictly — a stored night ≠ its absence', () => {
    const noNight: Palette = {
      ...base,
      swatches: [base.swatches[0], { name: '2', color: '#0061a8' }],
    };
    expect(paletteContentEqual(base, noNight)).toBe(false);
  });

  it('a differing swatch count breaks equality', () => {
    expect(paletteContentEqual(base, { ...base, swatches: [base.swatches[0]] })).toBe(false);
  });

  it('a differing kind breaks equality — a design palette is not its line twin', () => {
    expect(paletteContentEqual(base, { ...base, kind: 'design' })).toBe(false);
    expect(paletteContentEqual({ ...base, kind: 'design' }, { ...base, kind: 'design' })).toBe(
      true,
    );
  });
});

describe('copyPalette', () => {
  it('copies swatches without shared references', () => {
    const source: Palette = { name: 'p', swatches: [{ name: '1', color: '#111111' }] };
    const copy = copyPalette(source);
    expect(copy).toEqual(source);
    copy.swatches[0].color = '#999999';
    expect(source.swatches[0].color).toBe('#111111');
  });

  it('carries a description and per-swatch night colors', () => {
    const source: Palette = {
      name: 'p',
      description: 'd',
      swatches: [{ name: '1', color: '#111111', night: '#222222' }],
    };
    expect(copyPalette(source)).toEqual(source);
  });

  it('omits the description key entirely when absent', () => {
    expect('description' in copyPalette(FRRF)).toBe(false);
  });

  it('carries the design kind, and omits the key when absent', () => {
    expect(copyPalette(DESIGN)).toEqual(DESIGN);
    expect('kind' in copyPalette(FRRF)).toBe(false);
  });

  // Swatch names are the swatch-ref KEY, so a duplicate makes a ref ambiguous
  // (it would resolve to whichever came first) and collides the React keys the
  // sidebar rows and the picker's menu items are built on. This is the one
  // choke point every door into a doc or the library goes through — the map
  // upsert, the library add, the manager's copies — so the rule is enforced
  // here rather than at each of them. A palette whose names already stand
  // alone passes through untouched.
  it('uniquifies duplicate and blank swatch names', () => {
    expect(
      copyPalette({
        name: 'p',
        swatches: [
          { name: 'Red', color: '#111111' },
          { name: 'Red', color: '#222222' },
          { name: '', color: '#333333' },
        ],
      }).swatches.map((s) => s.name),
    ).toEqual(['Red', 'Red 2', '3']);
    expect(copyPalette(FRRF).swatches.map((s) => s.name)).toEqual(['1', '2']);
  });
});

describe('freshPaletteName', () => {
  it('is "New palette" when nothing takes it', () => {
    expect(freshPaletteName(new Set())).toBe('New palette');
  });

  it('counts up past taken names', () => {
    expect(freshPaletteName(new Set(['New palette']))).toBe('New palette 2');
    expect(freshPaletteName(new Set(['New palette', 'New palette 2']))).toBe('New palette 3');
  });

  it('skips nothing for names that merely resemble the pattern', () => {
    expect(freshPaletteName(new Set(['New palette 2']))).toBe('New palette');
  });

  // Make copy numbers off the same generator, so a stem it supplies counts up
  // exactly as "New palette" does.
  it('counts up from a supplied stem', () => {
    expect(freshPaletteName(new Set(), 'frrf copy')).toBe('frrf copy');
    expect(freshPaletteName(new Set(['frrf copy']), 'frrf copy')).toBe('frrf copy 2');
    expect(freshPaletteName(new Set(['frrf copy', 'frrf copy 2']), 'frrf copy')).toBe(
      'frrf copy 3',
    );
  });

  it('a stem takes nothing from the "New palette" names already out there', () => {
    expect(freshPaletteName(new Set(['New palette']), 'frrf copy')).toBe('frrf copy');
  });
});

// One ladder, one guard — the picker's set and the gate its value passes
// through, which cannot disagree while both read PALETTE_SORTS.
describe('PALETTE_SORTS', () => {
  it('is exactly what isPaletteSort accepts', () => {
    for (const s of PALETTE_SORTS) expect(isPaletteSort(s)).toBe(true);
    expect(isPaletteSort('updated')).toBe(false);
    expect(isPaletteSort('')).toBe(false);
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

  // Design palettes hold decoration colors (borders, washes), not line
  // identities — the auto-color cycle never deals them out.
  it('skips design palettes', () => {
    expect(cyclingColors([DESIGN, FRRF])).toEqual(cyclingColors([FRRF]));
    expect(cyclingColors([DESIGN])).toEqual([]);
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

  // Only LINE palettes cover line colors: a line sitting on a design swatch's
  // hex is a hand-picked custom color as far as the line picker is concerned.
  it('ignores design palettes when deciding what is custom', () => {
    expect(customLineColors(['#333333'], [MTA, DESIGN])).toEqual(['#333333']);
  });
});
