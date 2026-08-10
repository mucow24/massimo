import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { chooseStrategy, expectedFaceNames, FONT_TABLE_SOURCE } from './stageFonts.mjs';

describe('expectedFaceNames', () => {
  it('reads the face filenames out of a FONT_TABLE literal', () => {
    const source = `
      export const FONT_TABLE: FontFaceSpec[] = [
        ttf(200, false, 'soehne-extraleicht'), // Thin
        ttf(400, false, 'soehne-buch'), // Roman
        ttf(900, true, 'soehne-extrafett-kursiv'),
      ];
    `;
    expect(expectedFaceNames(source)).toEqual([
      'soehne-extraleicht.ttf',
      'soehne-buch.ttf',
      'soehne-extrafett-kursiv.ttf',
    ]);
  });

  it('returns nothing for a source with no FONT_TABLE entries', () => {
    expect(expectedFaceNames('export const FONT_TABLE = [];')).toEqual([]);
  });

  // The whole point of parsing rather than re-typing the list: if FONT_TABLE
  // gains, loses or renames a face, staging must follow it without an edit here.
  it('agrees with the real FONT_TABLE — all 16 shipped faces', () => {
    const names = expectedFaceNames(readFileSync(FONT_TABLE_SOURCE, 'utf8'));
    expect(names).toHaveLength(16);
    expect(names).toContain('soehne-buch.ttf');
    expect(names).toContain('soehne-halbfett-kursiv.ttf');
    expect(names.every((n) => n.startsWith('soehne-') && n.endsWith('.ttf'))).toBe(true);
  });
});

describe('chooseStrategy', () => {
  it('prefers a local .fonts clone over everything else', () => {
    expect(chooseStrategy({ dotFontsFaces: 16, siblingFaces: 16, hasToken: true })).toBe(
      'dot-fonts',
    );
  });

  it('falls back to the sibling checkout when .fonts is empty', () => {
    expect(chooseStrategy({ dotFontsFaces: 0, siblingFaces: 16, hasToken: true })).toBe('sibling');
  });

  // A cloud session: fresh clone, no sibling working tree on disk, but a token.
  it('clones the private repo when only a token is available', () => {
    expect(chooseStrategy({ dotFontsFaces: 0, siblingFaces: 0, hasToken: true })).toBe('clone');
  });

  it('substitutes only when there is no source and no token', () => {
    expect(chooseStrategy({ dotFontsFaces: 0, siblingFaces: 0, hasToken: false })).toBe(
      'substitute',
    );
  });

  it('prefers a real source over a token even when both are present', () => {
    expect(chooseStrategy({ dotFontsFaces: 0, siblingFaces: 1, hasToken: true })).toBe('sibling');
  });
});
