import { execFileSync } from 'node:child_process';

/**
 * The Lenovo Legion power mode (`quiet` | `balance` | `performance` | `custom`),
 * or `unknown` when it can't be read.
 *
 * This exists because the dev machine is a laptop whose CPU performance mode
 * swings these numbers by a large factor. The mode is constant WITHIN a session
 * but varies BETWEEN sessions, so a number carried over from an earlier run is
 * only comparable if it was taken in the same mode — and nothing in the output
 * says which mode that was unless it is stamped. See README.
 *
 * Read through Lenovo Legion Toolkit's CLI (`llt.exe feature get power-mode`),
 * which needs LLT running with its CLI enabled. Everywhere that does not hold —
 * CI, cloud containers, a machine without LLT — this returns `unknown` fast and
 * silently rather than failing a perf run.
 */
const LLT_CANDIDATES = [
  process.env.LLT_PATH,
  'C:\\Program Files\\LenovoLegionToolkit\\llt.exe',
  'llt',
].filter((p): p is string => !!p);

export function readPowerMode(): string {
  for (const exe of LLT_CANDIDATES) {
    try {
      const out = execFileSync(exe, ['feature', 'get', 'power-mode'], {
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (out) return out;
    } catch {
      // Try the next candidate; fall through to `unknown` if none answer.
    }
  }
  return 'unknown';
}
