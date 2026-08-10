import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  chooseStrategy,
  countFaces,
  expectedFaceNames,
  FONT_TABLE_SOURCE,
  MARKER_NAME,
  stageInto,
} from './stageFonts.mjs';

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
  });
});

describe('chooseStrategy', () => {
  it('prefers a complete .fonts clone over everything else', () => {
    expect(chooseStrategy({ dotFontsFaces: 16, siblingFaces: 16, total: 16 })).toBe('dot-fonts');
  });

  it('falls back to the sibling checkout when .fonts is empty', () => {
    expect(chooseStrategy({ dotFontsFaces: 0, siblingFaces: 16, total: 16 })).toBe('sibling');
  });

  // A cloud session: fresh clone, no .fonts, no sibling working tree on disk.
  it('substitutes when there is no real source', () => {
    expect(chooseStrategy({ dotFontsFaces: 0, siblingFaces: 0, total: 16 })).toBe('substitute');
  });

  // A half-populated source is not a source. Taking it would stage some faces,
  // clear the marker, and leave the rest missing with no fallback.
  it('refuses a partial source and substitutes instead', () => {
    expect(chooseStrategy({ dotFontsFaces: 1, siblingFaces: 0, total: 16 })).toBe('substitute');
    expect(chooseStrategy({ dotFontsFaces: 15, siblingFaces: 0, total: 16 })).toBe('substitute');
  });

  it('skips a partial .fonts for a complete sibling', () => {
    expect(chooseStrategy({ dotFontsFaces: 3, siblingFaces: 16, total: 16 })).toBe('sibling');
  });
});

describe('countFaces', () => {
  let dir;
  const names = ['a.ttf', 'b.ttf'];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'faces-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('counts only the expected names', () => {
    writeFileSync(join(dir, 'a.ttf'), 'x');
    writeFileSync(join(dir, 'unrelated.ttf'), 'x');
    expect(countFaces(dir, names)).toBe(1);
  });

  it('is zero for a missing or null directory', () => {
    expect(countFaces(join(dir, 'nope'), names)).toBe(0);
    expect(countFaces(null, names)).toBe(0);
  });

  // Otherwise a worktree copies its sibling's stand-ins, reports them as
  // licensed, and clears its own marker — so nothing skips and every export
  // path runs on DejaVu metrics believing it has the real thing.
  it('refuses a directory that is itself marked as substituted', () => {
    writeFileSync(join(dir, 'a.ttf'), 'x');
    writeFileSync(join(dir, 'b.ttf'), 'x');
    expect(countFaces(dir, names)).toBe(2);
    writeFileSync(join(dir, MARKER_NAME), 'stand-ins');
    expect(countFaces(dir, names)).toBe(0);
  });
});

// stageInto owns the decision that can destroy files: whether what is already
// in public/fonts is real and must be left alone.
describe('stageInto', () => {
  let root, fontsDir, standIn;
  const names = ['soehne-buch.ttf', 'soehne-fett.ttf'];
  const marker = () => join(fontsDir, MARKER_NAME);

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'stage-'));
    fontsDir = join(root, 'fonts');
    mkdirSync(fontsDir, { recursive: true });
    standIn = join(fontsDir, 'DejaVuSans.ttf');
    writeFileSync(standIn, 'D'.repeat(5000)); // stand-in: a distinctive size
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const writeRealFaces = () => {
    for (const n of names) writeFileSync(join(fontsDir, n), 'REAL'.repeat(50)); // ≠ stand-in size
  };

  it('stages substitutes when the directory has no faces', () => {
    expect(stageInto({ fontsDir, standIn, names, source: null })).toBe('substituted');
    expect(statSync(join(fontsDir, names[0])).size).toBe(statSync(standIn).size);
    expect(existsSync(marker())).toBe(true);
  });

  // THE destructive case: a stale marker must not license overwriting real,
  // hand-placed faces that exist nowhere in git.
  it('never overwrites real faces, even with a stale marker present', () => {
    writeRealFaces();
    writeFileSync(marker(), 'stale');
    const realSize = statSync(join(fontsDir, names[0])).size;

    expect(stageInto({ fontsDir, standIn, names, source: null })).toBe('kept-real');

    expect(statSync(join(fontsDir, names[0])).size).toBe(realSize);
    expect(existsSync(marker())).toBe(false); // and the stale marker is cleared
  });

  it('re-stages when the faces on disk are themselves stand-ins', () => {
    for (const n of names) cpSync(standIn, join(fontsDir, n));
    expect(stageInto({ fontsDir, standIn, names, source: null })).toBe('substituted');
    expect(existsSync(marker())).toBe(true);
  });

  it('copies from a real source and clears any marker', () => {
    const source = join(root, 'src-fonts');
    mkdirSync(source);
    for (const n of names) writeFileSync(join(source, n), 'REAL'.repeat(50));
    writeFileSync(marker(), 'stale');

    expect(stageInto({ fontsDir, standIn, names, source })).toBe('staged');

    expect(statSync(join(fontsDir, names[0])).size).toBe(200);
    expect(existsSync(marker())).toBe(false);
  });

  it('reports when there is no stand-in to fall back to', () => {
    rmSync(standIn);
    expect(stageInto({ fontsDir, standIn, names, source: null })).toBe('nothing-available');
  });
});
