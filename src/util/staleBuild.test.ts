import { describe, it, expect } from 'vitest';
import { bootFailureMessage, isStaleChunkError, STALE_BUILD_MESSAGE } from './staleBuild';
import { ClipperUnavailableError } from '../geometry/clip';

describe('isStaleChunkError', () => {
  // Verbatim from the engines. Chromium's is the one that reached a user: a
  // deploy landed under an open tab, and the export's glyph-outliner chunk was
  // no longer at the hashed name the running build asked for.
  it.each([
    [
      'Chromium',
      'Failed to fetch dynamically imported module: https://mucow24.github.io/massimo/assets/pdfGlyphs-CI4rog1I.js',
    ],
    ['Firefox', 'error loading dynamically imported module: /assets/pdfGlyphs-CI4rog1I.js'],
    ['Safari', 'Importing a module script failed.'],
    ['Vite preload', 'Unable to preload CSS for /assets/index-gfff1dtC.css'],
  ])('recognizes the %s wording', (_engine, message) => {
    expect(isStaleChunkError(new TypeError(message))).toBe(true);
  });

  it('leaves genuine export faults alone', () => {
    expect(isStaleChunkError(new Error('Nothing to export — the canvas is empty.'))).toBe(false);
    expect(isStaleChunkError(new Error('Could not get a 2D canvas context.'))).toBe(false);
    expect(isStaleChunkError(new Error('PNG encoding failed.'))).toBe(false);
  });

  // A failed fetch of the map's own data is not a stale build, and must not be
  // answered with "reload" — the reload would not help and the real fault
  // would be hidden.
  it('does not fire on an unrelated fetch failure', () => {
    expect(isStaleChunkError(new TypeError('Failed to fetch'))).toBe(false);
  });

  // Boot never sees the raw failure: clip.ts catches it and rethrows a
  // ClipperUnavailableError carrying the original. Unwrapped, a page whose
  // cached HTML outlived the build it names would be reported as a broken
  // WebAssembly install — with a console to check and nothing to fix.
  it('sees a stale chunk through the clipper wrapper', () => {
    const wrapped = new ClipperUnavailableError(
      'Could not load the polygon clipping engine',
      new TypeError('Failed to fetch dynamically imported module: /assets/clipper-Bq1x9k2p.js'),
    );
    expect(isStaleChunkError(wrapped)).toBe(true);
  });

  // Two levels deep, and assigned rather than passed to the constructor: the
  // project compiles against the ES2020 lib, which has no `ErrorOptions`.
  it('sees a stale chunk through a standard cause chain', () => {
    const inner = new TypeError('Failed to fetch dynamically imported module: /assets/x-9f3.js');
    const middle = new Error('nested') as Error & { cause?: unknown };
    middle.cause = inner;
    const outer = new Error('Startup failed') as Error & { cause?: unknown };
    outer.cause = middle;
    expect(isStaleChunkError(outer)).toBe(true);
  });

  // A wrapper around something else stays itself — the unwrap must not turn
  // every nested failure into a reload prompt.
  it('does not fire on a wrapper around a genuine engine fault', () => {
    const wrapped = new ClipperUnavailableError(
      'Could not load the polygon clipping engine',
      new Error('WebAssembly.instantiate(): Out of memory'),
    );
    expect(isStaleChunkError(wrapped)).toBe(false);
  });

  // Self-referential causes happen when a handler rewraps its own error; the
  // walk has to terminate rather than hang the failure path.
  it('terminates on a cyclic cause chain', () => {
    const a = new Error('a') as Error & { cause?: unknown };
    const b = new Error('b') as Error & { cause?: unknown };
    a.cause = b;
    b.cause = a;
    expect(isStaleChunkError(a)).toBe(false);
  });

  it('ignores non-Error rejections', () => {
    expect(isStaleChunkError('Failed to fetch dynamically imported module: /a.js')).toBe(false);
    expect(isStaleChunkError(undefined)).toBe(false);
    expect(isStaleChunkError(null)).toBe(false);
  });
});

describe('bootFailureMessage', () => {
  // Exactly how the failure reaches main.tsx: clip.ts catches the import
  // rejection and rethrows its own error carrying the original.
  const stranded = () =>
    new ClipperUnavailableError(
      'Could not load the polygon clipping engine',
      new TypeError('Failed to fetch dynamically imported module: /assets/clipper-Bq1x9k2p.js'),
    );

  it('asks a stranded boot to reload, and says nothing about WebAssembly', () => {
    const text = bootFailureMessage(stranded());
    expect(text).toMatch(/[Rr]eload/);
    // The engine is fine; sending someone to a WebAssembly setting that was
    // never off is the whole failure this replaces.
    expect(text).not.toMatch(/WebAssembly|console/i);
  });

  it('keeps the engine message when the engine is the actual problem', () => {
    const text = bootFailureMessage(
      new ClipperUnavailableError(
        'Could not load the polygon clipping engine',
        new Error('WebAssembly.instantiate(): Out of memory'),
      ),
    );
    expect(text).toMatch(/WebAssembly/);
    expect(text).not.toBe(STALE_BUILD_MESSAGE);
  });

  // An unwrapped rejection from anywhere else in the boot chain is not a
  // stranded chunk and must not be answered as one.
  it('falls back to the engine message for an unrecognized failure', () => {
    expect(bootFailureMessage(new Error('something else entirely'))).toMatch(/clipping engine/);
    expect(bootFailureMessage(undefined)).toMatch(/clipping engine/);
  });
});
