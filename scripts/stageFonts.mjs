#!/usr/bin/env node
/**
 * Stage the map's 16 typeface files into `public/fonts/`.
 *
 * The licensed Söhne faces are git-ignored — the app licence covers shipping the
 * typeface, not redistributing the files — so a clean checkout has none. What
 * that costs, measured with all 16 deleted: the unit suite loses exactly one
 * test (`pdfGlyphs.test.ts` on Söhne's own glyph coverage), but all EIGHT export
 * e2e specs fail, because `loadOutlineFonts` throws and the export never
 * produces a download at all. This script is the one place that answers "where
 * do the faces come from here", for every environment:
 *
 *   1. `.fonts/`          — where CI and the Pages deploy check the private font
 *                           repo out before installing; also works if a dev
 *                           clones it there by hand.
 *   2. sibling checkout   — the main working tree of this same repo. Git
 *                           worktrees under `.claude/worktrees/` share a `.git`
 *                           but not ignored files, so a fresh worktree finds the
 *                           faces the dev machine already has, with no network.
 *   3. clone              — a shallow checkout of the private font repo into
 *                           `.fonts/`, needing the environment's git
 *                           credentials. This is a cloud session's only source:
 *                           a fresh clone, no sibling on disk. Tried only when
 *                           1 and 2 came up empty AND `public/fonts` is not
 *                           already stocked, so no machine that has the faces
 *                           ever pays for the network.
 *   4. substitutes        — DejaVu Sans (committed, redistributable) copied under
 *                           each expected filename, so the export pipeline has a
 *                           real parseable face to trace even where the licensed
 *                           ones are unavailable — a container with no reach to
 *                           the font repo.
 *
 * Substitutes are a LAST resort and they announce themselves: staging them
 * writes `public/fonts/.substitute`. Everything that would be asking about
 * Söhne ITSELF reads that marker and skips — four assertions in
 * `pdfGlyphs.test.ts` on its glyph coverage, and the two e2e gates behind
 * `onSubstituteFaces` (fixtures.ts) that measure how it sets and how it bolds.
 * Everything else runs for real against the stand-ins — with them staged, all
 * eight export e2e specs pass, including the two that count glyph fill
 * operations, so the outlining genuinely happens.
 */

import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const FONTS_DIR = join('public', 'fonts');
export const MARKER_NAME = '.substitute';
export const SUBSTITUTE_MARKER = join(FONTS_DIR, MARKER_NAME);
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

/**
 * How many of the faces we actually want does this directory hold?
 *
 * A directory carrying the substitute marker counts as ZERO however full it
 * looks: worktrees copy from their sibling main checkout, and a sibling holding
 * stand-ins would otherwise launder them into a tree that then reports "staged
 * 16/16 licensed faces" and clears its own marker — leaving every export path
 * running on DejaVu metrics while believing it has Söhne.
 */
export function countFaces(dir, names) {
  if (!dir || !existsSync(dir)) return 0;
  if (existsSync(join(dir, MARKER_NAME))) return 0;
  return names.filter((n) => existsSync(join(dir, n))).length;
}

/**
 * Pick where the faces come from, in the documented order. Pure: takes the
 * probed counts, returns the decision, so the ordering is testable without a
 * filesystem.
 *
 * A source must be COMPLETE. A half-populated `.fonts/` would otherwise win the
 * vote, stage what it had, clear the marker, and leave the rest missing with no
 * fallback at all.
 */
export function chooseStrategy({ dotFontsFaces, siblingFaces, total }) {
  if (dotFontsFaces === total) return 'dot-fonts';
  if (siblingFaces === total) return 'sibling';
  return 'substitute';
}

/**
 * Is a clone of the private font repo the next thing to try?
 *
 * Only when nothing on disk can supply the faces. A complete `.fonts/` or a
 * sibling checkout both answer the question locally, for free, and must never
 * be passed over for a network round-trip.
 *
 * `alreadyStaged` is the one the strategy cannot tell you: in the MAIN checkout
 * on a machine that simply has the faces, there is no `.fonts/` and the sibling
 * is us, so the vote comes back 'substitute' — and `stageInto` then keeps the
 * real files anyway. Fetching on that vote would clone the font repo on every
 * `npm install` on the one machine that never needed it. Stand-ins do NOT count
 * as staged (`countFaces` reports a marked directory as empty), so a container
 * that gains credentials upgrades itself on the next install.
 *
 * And never into an existing `.fonts/`: `git clone` refuses a non-empty target
 * anyway, and whatever is in there (an interrupted clone, a hand-copied subset)
 * belongs to whoever put it there.
 */
export function shouldFetch({ strategy, alreadyStaged, dotFontsExists }) {
  return strategy === 'substitute' && !alreadyStaged && !dotFontsExists;
}

/**
 * Check the private font repo out into `.fonts/`, the same place CI puts it.
 *
 * This is what makes a CLOUD session — a fresh clone with no sibling on disk
 * and no `.fonts/` — able to run on the real faces instead of stand-ins, which
 * matters because several e2e specs measure Söhne's own metrics and can only
 * be answered by Söhne. It needs the container's git credentials to reach a
 * private repo; where they are absent or the host is blocked, this fails and
 * staging falls through to substitutes exactly as before. Failure is normal,
 * so it must be both QUIET and NON-INTERACTIVE — this runs from `postinstall`,
 * where a prompt is not a question anyone is there to answer. `stdio: 'ignore'`
 * does not achieve that on its own: git asks for credentials on `/dev/tty`,
 * which no stdio setting reaches, and on Windows the Git Credential Manager
 * puts up a GUI dialog. Unset, a machine with neither fonts nor credentials
 * stalls `npm install` until the timeout or pops a window out of nowhere. The
 * two env vars below turn both into an immediate non-zero exit.
 */
export function fetchDotFonts(repo = PRIVATE_FONTS_REPO, dir = DOT_FONTS) {
  try {
    execFileSync('git', ['clone', '--depth', '1', `https://github.com/${repo}.git`, dir], {
      stdio: 'ignore',
      timeout: 120_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
    });
    return true;
  } catch {
    rmSync(dir, { recursive: true, force: true }); // a half-clone would block the next attempt
    return false;
  }
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

/** Is every expected face present AND byte-for-byte the size of the stand-in? */
function alreadyStandIns(fontsDir, standIn, names) {
  if (!existsSync(standIn)) return false;
  const standInSize = statSync(standIn).size;
  return names.every((n) => {
    const p = join(fontsDir, n);
    return existsSync(p) && statSync(p).size === standInSize;
  });
}

/**
 * Put the faces in place, and own the one decision here that can destroy data.
 *
 * The licensed `.ttf` files exist in no git repo we can reach — if this
 * overwrites them they are gone. So "should I stage stand-ins" is answered from
 * the CONTENT of `fontsDir`, never from the marker: a marker can go stale the
 * moment someone drops the real faces in by hand, and trusting it would clobber
 * them on the next `npm install`. Faces that are all exactly the stand-in's size
 * are stand-ins; anything else is real and is left alone.
 *
 * Exported for testing — every branch below either deletes or preserves files
 * that cannot be recovered.
 */
export function stageInto({ fontsDir, standIn, names, source }) {
  mkdirSync(fontsDir, { recursive: true });
  const marker = join(fontsDir, MARKER_NAME);

  if (source) {
    for (const name of names) {
      const from = join(source, name);
      if (existsSync(from)) copyFileSync(from, join(fontsDir, name));
    }
    rmSync(marker, { force: true });
    return 'staged';
  }

  const complete = names.every((n) => existsSync(join(fontsDir, n)));
  if (complete && !alreadyStandIns(fontsDir, standIn, names)) {
    rmSync(marker, { force: true }); // real faces: clear any stale marker, touch nothing else
    return 'kept-real';
  }

  if (!existsSync(standIn)) return 'nothing-available';

  for (const name of names) copyFileSync(standIn, join(fontsDir, name));
  writeFileSync(
    marker,
    'DejaVu Sans standing in for the licensed Söhne faces.\n' +
      'Written by scripts/stageFonts.mjs; delete by staging the real faces.\n',
  );
  return 'substituted';
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
  const decide = () =>
    chooseStrategy({
      dotFontsFaces: countFaces(DOT_FONTS, names),
      siblingFaces: countFaces(sibling, names),
      total: names.length,
    });

  let strategy = decide();
  const alreadyStaged = countFaces(FONTS_DIR, names) === names.length;
  if (shouldFetch({ strategy, alreadyStaged, dotFontsExists: existsSync(DOT_FONTS) })) {
    console.log(`[fonts] no faces on disk — trying ${PRIVATE_FONTS_REPO}.`);
    if (fetchDotFonts()) strategy = decide();
  }
  const source = strategy === 'dot-fonts' ? DOT_FONTS : strategy === 'sibling' ? sibling : null;

  const outcome = stageInto({
    fontsDir: FONTS_DIR,
    standIn: SUBSTITUTE_SOURCE,
    names,
    source,
  });

  if (outcome === 'staged') {
    console.log(`[fonts] staged ${names.length} licensed faces from ${source}.`);
  } else if (outcome === 'kept-real') {
    console.log('[fonts] licensed faces already staged.');
  } else if (outcome === 'nothing-available') {
    console.warn(`[fonts] no faces and no ${SUBSTITUTE_SOURCE} to stand in — exports will fail.`);
  } else {
    console.warn(
      `[fonts] licensed faces unavailable — staged ${names.length} DejaVu Sans substitutes.\n` +
        `[fonts] Rendering and metrics are NOT representative. To get the real faces, clone\n` +
        `[fonts] ${PRIVATE_FONTS_REPO} into ${DOT_FONTS}/ and re-run:  npm run fonts`,
    );
  }
}

// Only run when invoked directly, so the helpers above stay importable in tests.
// Never fail the install over this: a locked font file (Windows, dev server
// holding one open) would otherwise break `npm install` for a convenience.
if (process.argv[1] && resolve(process.argv[1]).endsWith('stageFonts.mjs')) {
  try {
    main();
  } catch (err) {
    console.warn(`[fonts] staging failed (${err.message}) — continuing without it.`);
  }
}
