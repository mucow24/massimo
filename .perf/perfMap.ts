import { existsSync, readdirSync, readFileSync } from 'node:fs';

/**
 * Where the harnesses get their document.
 *
 * Maps are not committed — they are drawings, not fixtures, and run to
 * megabytes — so this resolves one at run time: `PERF_MAP` if set, otherwise
 * whatever `.massimo.json` has been dropped in `.perf/` (gitignored, so that
 * is the frictionless place to put one).
 *
 * The failure mode this exists for is a bare `ENOENT` from `readFileSync` deep
 * inside a benchmark, which reads as "the harness is broken" rather than "you
 * have not given it a map".
 */
const PERF_DIR = '.perf';

export function perfMapPath(): string {
  const explicit = process.env.PERF_MAP;
  if (explicit) {
    if (!existsSync(explicit)) {
      throw new Error(`PERF_MAP points at a file that does not exist: ${explicit}`);
    }
    return explicit;
  }
  const found = existsSync(PERF_DIR)
    ? readdirSync(PERF_DIR)
        .filter((n) => n.endsWith('.massimo.json'))
        .sort()
    : [];
  if (found.length) return `${PERF_DIR}/${found[0]}`;
  throw new Error(
    'No map to benchmark against.\n' +
      `  Drop an exported .massimo.json into ${PERF_DIR}/ (gitignored), or set PERF_MAP=<path>.\n` +
      '  Use a real drawing — a small fixture has none of the crossing density\n' +
      '  that makes the region pipeline expensive, so it measures nothing.\n' +
      '  See .perf/README.md.',
  );
}

/** The map file's text, or a message telling you how to supply one. */
export const readPerfMap = (): string => readFileSync(perfMapPath(), 'utf8');
