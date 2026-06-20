import { describe, it, expect } from 'vitest';
import { parseCustomPalette, makeCustomPaletteId } from './customPalette';

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

describe('makeCustomPaletteId', () => {
  it('slugifies the name into a custom: id', () => {
    expect(makeCustomPaletteId('My Palette!', new Set())).toBe('custom:my-palette');
  });

  it('falls back to custom:palette when the slug would be empty', () => {
    expect(makeCustomPaletteId('!!!', new Set())).toBe('custom:palette');
  });

  it('suffixes to avoid collisions with existing ids', () => {
    expect(makeCustomPaletteId('frrf', new Set(['custom:frrf']))).toBe('custom:frrf-2');
    expect(makeCustomPaletteId('frrf', new Set(['custom:frrf', 'custom:frrf-2']))).toBe(
      'custom:frrf-3',
    );
  });
});
