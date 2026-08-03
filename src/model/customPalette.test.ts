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

describe('serializeCustomPalette', () => {
  it('writes the format the parser reads', () => {
    const palette = {
      name: 'frrf',
      swatches: [
        { name: '1', color: '#c1272d' },
        { name: 'Red', color: '#0061a8' },
      ],
    };
    expect(JSON.parse(serializeCustomPalette(palette))).toEqual({
      name: 'frrf',
      colors: [
        { line: '1', human: '#c1272d' },
        { line: 'Red', human: '#0061a8' },
      ],
    });
  });

  it('round-trips through the parser', () => {
    const palette = { name: 'x', swatches: [{ name: 'Red', color: '#aabbcc' }] };
    const r = parseCustomPalette(serializeCustomPalette(palette));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect({ name: r.name, swatches: r.swatches }).toEqual(palette);
  });

  // A built-in's swatches carry upper-case hex; the parser lowercases, so an
  // exported built-in has to come back the same shape it went out as.
  it('lower-cases so an exported built-in round-trips unchanged', () => {
    const palette = { name: 'BART', swatches: [{ name: 'Yellow Line', color: '#FFE800' }] };
    const r = parseCustomPalette(serializeCustomPalette(palette));
    expect(r.ok && r.swatches).toEqual([{ name: 'Yellow Line', color: '#ffe800' }]);
    expect(JSON.parse(serializeCustomPalette(palette)).colors[0].human).toBe('#ffe800');
  });
});
