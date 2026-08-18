#!/usr/bin/env node
/**
 * Which Chromium the e2e run launches.
 *
 * Playwright normally owns this: `playwright install` downloads the exact build
 * its version pins, into `PLAYWRIGHT_BROWSERS_PATH` (or the default cache), and
 * finds it again by that revision number. That works on a dev machine and in
 * CI, and nothing here interferes with it.
 *
 * It does not work in the cloud container this repo's daily session runs in.
 * The image bakes a Chromium in at a fixed revision and blocks
 * `cdn.playwright.dev` at the proxy, so the download that would fix a version
 * mismatch cannot happen — bumping `@playwright/test` past the image's build
 * leaves `npm run e2e` unable to launch anything at all. The baked-in build is
 * a real Chromium a few majors back; the specs here measure geometry and
 * layout, which it does the same way.
 *
 * So: use Playwright's own build whenever it is on disk, and fall back to the
 * newest build the image happens to ship only when it is not. The fallback is
 * announced, because a run on a browser other than the pinned one is worth
 * knowing about when a spec goes red.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/** Relative path from a `chromium-<rev>` directory to the binary, per platform. */
const BINARIES = [
  'chrome-linux/chrome',
  'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
  'chrome-win/chrome.exe',
];

/**
 * Pick a browser directory, given the revision Playwright wants and the
 * `chromium-<rev>` directories actually present. Pure: takes the probed
 * revisions, returns the one to launch, so the ordering is testable without a
 * filesystem.
 *
 * Returns null both when Playwright's own build is present (let Playwright
 * resolve it — overriding would only add a way to launch the wrong thing) and
 * when nothing is present (let Playwright fail with its own "run `playwright
 * install`" message, which is the right advice everywhere the download works).
 */
export function pickFallbackRevision(wanted, present) {
  if (present.includes(wanted)) return null;
  // Not "older": an image can lead the repo as easily as trail it, and a build
  // newer than the pin is just as usable a fallback.
  const candidates = present.filter((r) => Number.isInteger(r) && r > 0);
  return candidates.length ? Math.max(...candidates) : null;
}

/** The `chromium-<rev>` revisions under `dir` that hold a launchable binary. */
export function installedRevisions(dir) {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir)
    .map((name) => /^chromium-(\d+)$/.exec(name))
    .filter(Boolean)
    .filter((m) => BINARIES.some((b) => existsSync(join(dir, m[0], b))))
    .map((m) => Number(m[1]));
}

/**
 * The revision `@playwright/test` pins, read from playwright-core's own
 * `browsers.json` — the same manifest `playwright install` downloads from and
 * the launcher resolves against, so this cannot drift from the version in
 * `package.json`. Read as a file rather than imported: the package's `exports`
 * map does not publish it.
 */
export function wantedRevision() {
  const require = createRequire(import.meta.url);
  const manifest = join(dirname(require.resolve('playwright-core/package.json')), 'browsers.json');
  const { browsers } = JSON.parse(readFileSync(manifest, 'utf8'));
  const entry = browsers.find((b) => b.name === 'chromium');
  return entry ? Number(entry.revision) : NaN;
}

/**
 * An `executablePath` for Playwright's launch options, or undefined to let
 * Playwright resolve the browser itself (the normal case, everywhere the
 * pinned build is installed).
 */
export function chromiumExecutablePath(dir = process.env.PLAYWRIGHT_BROWSERS_PATH) {
  const wanted = wantedRevision();
  const present = installedRevisions(dir);
  const revision = pickFallbackRevision(wanted, present);
  if (revision === null) return undefined;

  const root = join(dir, `chromium-${revision}`);
  const binary = BINARIES.map((b) => join(root, b)).find((p) => existsSync(p));
  // Once per PROCESS that loads playwright.config, not once per run — the
  // runner and each worker each load it, so expect this line more than once.
  console.warn(
    `[e2e] Chromium ${wanted} is not installed and cannot be downloaded here — ` +
      `launching the image's build ${revision} instead (${binary}).`,
  );
  return binary;
}
