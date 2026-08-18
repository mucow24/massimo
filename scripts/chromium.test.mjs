import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installedRevisions, pickFallbackRevision, wantedRevision } from './chromium.mjs';

describe('pickFallbackRevision', () => {
  // The normal case, everywhere `playwright install` works: Playwright's own
  // resolution is the one that should run. Answering here at all would only add
  // a way to launch something other than the pinned build.
  it('picks nothing when the pinned build is installed', () => {
    expect(pickFallbackRevision(1217, [1217])).toBe(null);
  });

  it('picks nothing when the pinned build sits among others', () => {
    expect(pickFallbackRevision(1217, [1194, 1217])).toBe(null);
  });

  // The cloud container: the image bakes in one build, and the CDN that would
  // supply the pinned one is blocked at the proxy.
  it('falls back to the build the image ships', () => {
    expect(pickFallbackRevision(1217, [1194])).toBe(1194);
  });

  // Several to choose from: the newest is the closest to what the pinned
  // version was built against.
  it('takes the newest of several fallbacks', () => {
    expect(pickFallbackRevision(1217, [1091, 1194, 1155])).toBe(1194);
  });

  // A build NEWER than the pin is still a fallback — an image can lead the
  // repo as easily as trail it, and launching it beats launching nothing.
  it('falls back to a newer build too', () => {
    expect(pickFallbackRevision(1194, [1217])).toBe(1217);
  });

  // Nothing to fall back to. Staying silent hands the failure to Playwright,
  // whose own message ("run `playwright install`") is the right advice
  // everywhere the download works — which is everywhere but here.
  it('picks nothing when no build is installed at all', () => {
    expect(pickFallbackRevision(1217, [])).toBe(null);
  });
});

describe('installedRevisions', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pw-browsers-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** A browsers-path entry holding a launchable binary, as `playwright install` leaves it. */
  const install = (name, binary = 'chrome-linux/chrome') => {
    mkdirSync(join(dir, name, binary, '..'), { recursive: true });
    writeFileSync(join(dir, name, binary), '');
  };

  it('reads the revision out of each chromium directory', () => {
    install('chromium-1194');
    install('chromium-1217');
    expect(installedRevisions(dir).sort()).toEqual([1194, 1217]);
  });

  // A browsers path holds more than the browser: the image ships
  // `chromium_headless_shell-1194` and `ffmpeg-1011` beside it, and Playwright
  // installs `chromium-tip-of-tree-<rev>` for anyone who asks for that channel.
  // Tip-of-tree is the one that bites — it is a real Chromium, at its own much
  // higher revision, sitting behind a `chrome-linux/chrome` exactly where this
  // looks. Matched loosely it would win the fallback vote outright and launch a
  // nightly nobody asked for.
  it('ignores every directory that is not a plain chromium build', () => {
    install('chromium-1194');
    install('chromium-tip-of-tree-1417');
    install('chromium_headless_shell-1194', 'chrome-linux/headless_shell');
    mkdirSync(join(dir, 'ffmpeg-1011'), { recursive: true });
    expect(installedRevisions(dir)).toEqual([1194]);
  });

  // An interrupted download leaves the directory without the binary. Counting
  // it would send the launch at a path that does not exist, replacing
  // Playwright's clear error with an opaque one.
  it('ignores a directory with no binary in it', () => {
    mkdirSync(join(dir, 'chromium-1194'), { recursive: true });
    expect(installedRevisions(dir)).toEqual([]);
  });

  it('reads nothing from a browsers path that is not there', () => {
    expect(installedRevisions(join(dir, 'nope'))).toEqual([]);
    expect(installedRevisions(undefined)).toEqual([]);
  });
});

describe('wantedRevision', () => {
  // The pin has to come from playwright-core's own manifest — the same file
  // its launcher resolves against — or a version bump could leave this
  // shimming around a mismatch that no longer exists.
  it('reads a real revision from the installed playwright-core', () => {
    expect(wantedRevision()).toBeGreaterThan(0);
  });
});
