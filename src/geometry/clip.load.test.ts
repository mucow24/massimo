import { describe, expect, it, vi } from 'vitest';
import { ClipperUnavailableError, __resetClipper, loadClipper } from './clip';

/**
 * The engine module is FAKED for this whole file, which is why it is a file of
 * its own: this is about the loader's memoization, and making a load fail on
 * cue is the only way to reach the retry branch. `clip.engine.test.ts` exercises
 * the loader against the real build, and nothing here touches the arithmetic.
 */
let failNext = false;

vi.mock('js-angusj-clipper', () => ({
  NativeClipperLibRequestedFormat: { WasmWithAsmJsFallback: 'wasmWithAsmJsFallback' },
  loadNativeClipperLibInstanceAsync: async () => {
    if (failNext) {
      failNext = false;
      throw new Error('no engine on this machine');
    }
    return { format: 'asmJs' };
  },
}));

describe('clipper loader', () => {
  // Memoizing the in-flight promise must not also memoize a FAILURE: a load
  // that lost to a transient hiccup would otherwise replay its rejection for
  // the life of the page, and the pre-memo loader retried because it only ever
  // cached a resolved instance.
  it('does not memoize a failed load — the next call retries', async () => {
    __resetClipper();
    failNext = true;
    await expect(loadClipper()).rejects.toBeInstanceOf(ClipperUnavailableError);
    await expect(loadClipper()).resolves.toBe('asmJs');
  });
});
