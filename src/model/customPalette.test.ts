import { describe, it, expect } from 'vitest';
import { parseCustomPalette, serializeCustomPalette } from './customPalette';

const FRRF = JSON.stringify({
  name: 'frrf',
  colors: [
    { line: 1, human: '#c1272d', cat: '#777151', locked: false },
    { line: 2, human: '#0061a8', cat: '#415c82', locked: false },
  ],
});

describe('parseCustomPalette', () => {
  it('parses the frrf format using only the human colors, ignoring cat/locked', () => {
    const r = parseCustomPalette(FRRF);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.name).toBe('frrf');
    expect(r.swatches).toEqual([
      { name: '1', color: '#c1272d' },
      { name: '2', color: '#0061a8' },
    ]);
  });

  it('lowercases hex colors', () => {
    const r = parseCustomPalette(
      JSON.stringify({ name: 'x', colors: [{ line: 1, human: '#AABBCC' }] }),
    );
    expect(r.ok && r.swatches[0].color).toBe('#aabbcc');
  });

  it('uses the line field as the swatch name (hover label)', () => {
    const r = parseCustomPalette(
      JSON.stringify({ name: 'x', colors: [{ line: 'Red', human: '#aabbcc' }] }),
    );
    expect(r.ok && r.swatches[0].name).toBe('Red');
  });

  it('skips entries with a missing or invalid human color', () => {
    const r = parseCustomPalette(
      JSON.stringify({
        name: 'x',
        colors: [{ line: 1, human: 'not-a-color' }, { line: 2, human: '#00ff00' }, { line: 3 }],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.swatches).toEqual([{ name: '2', color: '#00ff00' }]);
  });

  it('rejects invalid JSON', () => {
    expect(parseCustomPalette('{nope').ok).toBe(false);
  });

  it('rejects a missing or blank name', () => {
    expect(parseCustomPalette(JSON.stringify({ colors: [{ line: 1, human: '#aabbcc' }] })).ok).toBe(
      false,
    );
    expect(
      parseCustomPalette(JSON.stringify({ name: '   ', colors: [{ line: 1, human: '#aabbcc' }] }))
        .ok,
    ).toBe(false);
  });

  it('rejects an empty or missing colors array', () => {
    expect(parseCustomPalette(JSON.stringify({ name: 'x', colors: [] })).ok).toBe(false);
    expect(parseCustomPalette(JSON.stringify({ name: 'x' })).ok).toBe(false);
  });

  it('rejects a file whose colors all have invalid human values', () => {
    expect(
      parseCustomPalette(JSON.stringify({ name: 'x', colors: [{ line: 1, human: 'bad' }] })).ok,
    ).toBe(false);
  });
});

describe('parseCustomPalette — massimo-palette format', () => {
  const file = (over: object = {}): string =>
    JSON.stringify({
      format: 'massimo-palette',
      version: 1,
      name: 'My palette',
      description: 'weekend reds',
      colors: [
        { name: 'Line 1', day: '#C1272DFF', night: '#7A1A1DFF' },
        { name: 'Line 2', day: '#0061A8FF', night: '#0061A8FF' },
      ],
      ...over,
    });

  it('parses name, description, and day/night colors', () => {
    const r = parseCustomPalette(file());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.name).toBe('My palette');
    expect(r.description).toBe('weekend reds');
    expect(r.swatches).toEqual([
      // Night differs from day, so it stays; equal night collapses away.
      { name: 'Line 1', color: '#c1272d', night: '#7a1a1d' },
      { name: 'Line 2', color: '#0061a8' },
    ]);
  });

  it('a missing, blank, or non-string description reads as none', () => {
    for (const description of [undefined, '   ', 7]) {
      const r = parseCustomPalette(file({ description }));
      expect(r.ok && !('description' in r)).toBe(true);
    }
  });

  it('preserves a real alpha and strips an opaque one', () => {
    const r = parseCustomPalette(
      file({
        colors: [
          { name: 'x', day: '#11223344' },
          { name: 'y', day: '#112233' },
        ],
      }),
    );
    expect(r.ok && r.swatches).toEqual([
      { name: 'x', color: '#11223344' },
      { name: 'y', color: '#112233' },
    ]);
  });

  it('names an unnamed color by its 1-based position', () => {
    const r = parseCustomPalette(file({ colors: [{ day: '#112233' }] }));
    expect(r.ok && r.swatches).toEqual([{ name: '1', color: '#112233' }]);
  });

  it('skips entries with an invalid day, and drops an invalid night', () => {
    const r = parseCustomPalette(
      file({
        colors: [
          { name: 'bad', day: 'nope' },
          { name: 'ok', day: '#112233', night: 'nope' },
        ],
      }),
    );
    expect(r.ok && r.swatches).toEqual([{ name: 'ok', color: '#112233' }]);
  });

  it('rejects a non-empty colors list with no valid entry', () => {
    const r = parseCustomPalette(file({ colors: [{ name: 'bad', day: 'nope' }] }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('No valid colors found');
  });

  // An empty palette is a real state — the editor creates them — so an exported
  // one must come back, unlike the legacy format's non-empty gate.
  it('accepts an empty colors array', () => {
    const r = parseCustomPalette(file({ colors: [] }));
    expect(r.ok && r.swatches).toEqual([]);
  });

  it('rejects a file claiming some other format', () => {
    expect(parseCustomPalette(file({ format: 'massimo-map' })).ok).toBe(false);
  });

  it('rejects a missing or blank name', () => {
    expect(parseCustomPalette(file({ name: undefined })).ok).toBe(false);
    expect(parseCustomPalette(file({ name: '   ' })).ok).toBe(false);
  });

  it('rejects a missing colors array', () => {
    expect(parseCustomPalette(file({ colors: undefined })).ok).toBe(false);
  });

  // Forward tolerance, matching the map loader: a future version that only ADDS
  // fields still opens under today's rules.
  it('ignores the version field', () => {
    expect(parseCustomPalette(file({ version: undefined })).ok).toBe(true);
    expect(parseCustomPalette(file({ version: 99 })).ok).toBe(true);
  });
});

describe('serializeCustomPalette', () => {
  const RED = { name: 'Red', color: '#c1272d' };

  it('writes the massimo-palette format, night backfilled and 8-digit uppercase', () => {
    const palette = {
      name: 'p',
      description: 'weekend reds',
      swatches: [RED, { name: 'Blue', color: '#0061a8', night: '#00335c' }],
    };
    expect(JSON.parse(serializeCustomPalette(palette))).toEqual({
      format: 'massimo-palette',
      version: 1,
      name: 'p',
      description: 'weekend reds',
      colors: [
        { name: 'Red', day: '#C1272DFF', night: '#C1272DFF' },
        { name: 'Blue', day: '#0061A8FF', night: '#00335CFF' },
      ],
    });
  });

  it('omits the description key when the palette has none', () => {
    const out = JSON.parse(serializeCustomPalette({ name: 'p', swatches: [RED] }));
    expect('description' in out).toBe(false);
  });

  it('writes a translucent color with its real alpha', () => {
    const out = JSON.parse(
      serializeCustomPalette({ name: 'p', swatches: [{ name: 'x', color: '#11223344' }] }),
    );
    expect(out.colors[0].day).toBe('#11223344');
  });

  it('round-trips through the parser, description and night included', () => {
    const palette = {
      name: 'x',
      description: 'd',
      swatches: [
        { name: 'Red', color: '#aabbcc' },
        { name: 'Night', color: '#112233', night: '#445566' },
      ],
    };
    const r = parseCustomPalette(serializeCustomPalette(palette));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect({ name: r.name, description: r.description, swatches: r.swatches }).toEqual(palette);
  });

  it('round-trips an empty palette', () => {
    const r = parseCustomPalette(serializeCustomPalette({ name: 'x', swatches: [] }));
    expect(r.ok && r.swatches).toEqual([]);
  });

  // A built-in's swatches carry upper-case hex; the parser normalizes, so an
  // exported built-in comes back in canonical lowercase.
  it('an exported built-in round-trips to the canonical spelling', () => {
    const palette = { name: 'BART', swatches: [{ name: 'Yellow Line', color: '#FFE800' }] };
    const r = parseCustomPalette(serializeCustomPalette(palette));
    expect(r.ok && r.swatches).toEqual([{ name: 'Yellow Line', color: '#ffe800' }]);
  });

  // The old export shape (frrf) parses through the legacy path, so palette
  // files exported before this format keep importing.
  it('a legacy frrf export still parses', () => {
    const legacy = JSON.stringify({
      name: 'old',
      colors: [{ line: 'Red', human: '#c1272d' }],
    });
    const r = parseCustomPalette(legacy);
    expect(r.ok && r.swatches).toEqual([{ name: 'Red', color: '#c1272d' }]);
  });
});
