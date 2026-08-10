#!/usr/bin/env node
/**
 * Stage the map's 16 typeface files into `public/fonts/`.
 *
 * The licensed Söhne faces are git-ignored — the app licence covers shipping the
 * typeface, not redistributing the files — so a clean checkout has none. Without
 * them the export tests do not merely fail: several pass while outlining
 * NOTHING, a vacuous green (see .github/workflows/ci.yml). This script is the
 * one place that answers "where do the faces come from here", for every
 * environment:
 *
 *   1. `.fonts/`          — a local clone of the private repo, and the layout CI
 *                           itself stages from.
 *   2. sibling checkout   — the main working tree of this same repo. Git
 *                           worktrees under `.claude/worktrees/` share a `.git`
 *                           but not ignored files, so a fresh worktree finds the
 *                           faces the dev machine already has, with no network.
 *   3. private repo       — cloned with `FONTS_REPO_PAT`, mirroring CI. This is
 *                           the only route a cloud session has: it is a fresh
 *                           clone with no sibling on disk.
 *   4. substitutes        — DejaVu Sans (committed, redistributable) copied under
 *                           each expected filename, so the export pipeline has a
 *                           real parseable face to trace even where the licensed
 *                           ones can never be fetched.
 *
 * Substitutes are a LAST resort and they announce themselves: staging them
 * writes `public/fonts/.substitute`, and `pdfGlyphs.test.ts` reads that marker to
 * skip the assertions that are about Söhne's own glyph coverage rather than
 * about the tracer. Everything else — the outlining, the PDF structure, the e2e
 * export — runs for real against the stand-ins instead of passing vacuously.
 */

import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const FONTS_DIR = join('public', 'fonts');
export const SUBSTITUTE_MARKER = join(FONTS_DIR, '.substitute');
export const SUBSTITUTE_SOURCE = join(FONTS_DIR, 'DejaVuSans.ttf');
export const FONT_TABLE_SOURCE = join('src', 'export', 'fonts.ts');
export const PRIVATE_FONTS_REPO = 'mucow24/massimo-fonts';
export const DOT_FONTS = '.fonts';

/**
 * The canonical face filenames, read out of `FONT_TABLE` (export/fonts.ts) so
 * this script can never drift from the list the app actually fetches. Parsing
 * the source beats re-typing the names: `FONT_TABLE` is TypeScript and this
 * script must run from `postinstall`, before any build step exists.
 */
export function expectedFaceNames(fontTableSource) {
  const re = /ttf\(\s*\d+\s*,\s*(?:true|false)\s*,\s*'([^']+)'\s*\)/g;
  return [...fontTableSource.matchAll(re)].map((m) => `${m[1]}.ttf`);
}

/** Does this directory hold at least one face we want? */
export function facesIn(dir) {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.ttf') && f.startsWith('soehne-'));
}

/**
 * Pick where the faces come from, in the documented order. Pure: takes the
 * probed facts, returns the decision, so the ordering is testable without a
 * filesystem or a network.
 */
export function chooseStrategy({ dotFontsFaces, siblingFaces, hasToken }) {
  if (dotFontsFaces > 0) return 'dot-fonts';
  if (siblingFaces > 0) return 'sibling';
  if (hasToken) return 'clone';
  return 'substitute';
}

/**
 * The main working tree of this repo, or null when we are already in it. Git
 * worktrees share `--git-common-dir`, which always points at the main
 * checkout's `.git`, so its parent is the main checkout.
 */
export function siblingFontsDir(cwd = process.cwd()) {
  let commonDir;
  try {
    commonDir = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null; // not a git checkout at all
  }
  const dir = join(dirname(commonDir), FONTS_DIR);
  // In the main checkout the sibling IS us — copying a file onto itself throws.
  return resolve(dir) === resolve(cwd, FONTS_DIR) ? null : dir;
}

function copyFaces(fromDir, names) {
  mkdirSync(FONTS_DIR, { recursive: true });
  let copied = 0;
  for (const name of names) {
    const src = join(fromDir, name);
    if (!existsSync(src)) continue;
    copyFileSync(src, join(FONTS_DIR, name));
    copied += 1;
  }
  return copied;
}

function stageSubstitutes(names) {
  if (!existsSync(SUBSTITUTE_SOURCE)) return 0;
  mkdirSync(FONTS_DIR, { recursive: true });
  for (const name of names) copyFileSync(SUBSTITUTE_SOURCE, join(FONTS_DIR, name));
  writeFileSync(
    SUBSTITUTE_MARKER,
    'DejaVu Sans standing in for the licensed Söhne faces.\n' +
      'Written by scripts/stageFonts.mjs; delete by staging the real faces.\n',
  );
  return names.length;
}

function clonePrivateRepo(token) {
  const url = `https://x-access-token:${token}@github.com/${PRIVATE_FONTS_REPO}.git`;
  rmSync(DOT_FONTS, { recursive: true, force: true });
  execFileSync('git', ['clone', '--depth', '1', '--quiet', url, DOT_FONTS], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
}

function main() {
  if (!existsSync(FONT_TABLE_SOURCE)) {
    console.warn(`[fonts] ${FONT_TABLE_SOURCE} not found — skipping font staging.`);
    return;
  }
  const names = expectedFaceNames(readFileSync(FONT_TABLE_SOURCE, 'utf8'));
  if (names.length === 0) {
    console.warn('[fonts] could not read FONT_TABLE — skipping font staging.');
    return;
  }

  const sibling = siblingFontsDir();
  // The token is read from the environment and passed straight to git; its value
  // is never logged, and it is not required for any other path.
  const token = process.env.FONTS_REPO_PAT ?? '';
  let strategy = chooseStrategy({
    dotFontsFaces: facesIn(DOT_FONTS).length,
    siblingFaces: facesIn(sibling).length,
    hasToken: token.length > 0,
  });

  if (strategy === 'clone') {
    try {
      clonePrivateRepo(token);
    } catch {
      console.warn(`[fonts] could not clone ${PRIVATE_FONTS_REPO} — falling back to substitutes.`);
      strategy = 'substitute';
    }
    if (strategy === 'clone' && facesIn(DOT_FONTS).length === 0) strategy = 'substitute';
  }

  if (strategy === 'substitute') {
    // Real faces already on disk from an earlier run beat any stand-in.
    if (!existsSync(SUBSTITUTE_MARKER) && facesIn(FONTS_DIR).length > 0) {
      console.log('[fonts] licensed faces already staged.');
      return;
    }
    const n = stageSubstitutes(names);
    if (n === 0) {
      console.warn(`[fonts] no faces and no ${SUBSTITUTE_SOURCE} to stand in — exports will fail.`);
      return;
    }
    console.warn(
      `[fonts] licensed faces unavailable — staged ${n} DejaVu Sans substitutes.\n` +
        `[fonts] Rendering and metrics are NOT representative. To get the real faces, clone\n` +
        `[fonts] ${PRIVATE_FONTS_REPO} into ${DOT_FONTS}/ or set FONTS_REPO_PAT, then re-run:\n` +
        `[fonts]   npm run fonts`,
    );
    return;
  }

  const from = strategy === 'sibling' ? sibling : DOT_FONTS;
  const copied = copyFaces(from, names);
  rmSync(SUBSTITUTE_MARKER, { force: true });
  console.log(`[fonts] staged ${copied}/${names.length} licensed faces from ${from}.`);
}

// Only run when invoked directly, so the helpers above stay importable in tests.
if (process.argv[1] && resolve(process.argv[1]).endsWith('stageFonts.mjs')) main();
