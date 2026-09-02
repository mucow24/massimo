import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DEFAULT_DOC } from '../model/transforms';
import { docKey } from './mapKeys';

/**
 * What happens on a page load. persist rehydrates SYNCHRONOUSLY from inside the
 * store's initializer — before zustand has assigned the store's state — so
 * zundo partializes `undefined` there, and anything that throws on the way is
 * swallowed whole by zustand's thenable wrapper, taking the migrated write-back
 * and the hydration callbacks with it. `boot()` re-imports the module the way a
 * refresh would: localStorage and the URL survive, the module registry does not.
 */

// The tab boots on the map its URL names; the doc slot is that map's own.
const MAP = 'boot-map';
const KEY = docKey(MAP);

const boot = async (): Promise<typeof import('./store')> => {
  vi.resetModules();
  return await import('./store');
};

const seed = (version: number, key = KEY): void => {
  localStorage.setItem(
    key,
    JSON.stringify({ state: { ...DEFAULT_DOC, name: 'Stored map' }, version }),
  );
};

describe('boot hydration', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, '', `#map=${MAP}`);
  });

  it('reads the working copy of the map the URL names, and no other map’s', async () => {
    seed(30, docKey('some-other-map'));
    const other = await boot();
    expect(other.useDoc.getState().name).toBe(DEFAULT_DOC.name);

    seed(30);
    const store = await boot();
    expect(store.useDoc.getState().name).toBe('Stored map');
  });

  it('writes the working copy under the map’s own slot', async () => {
    const store = await boot();
    store.useDoc.getState().setDocName('Edited here');
    expect(JSON.parse(localStorage.getItem(KEY)!).state.name).toBe('Edited here');
    expect(localStorage.getItem('vignelli-map-doc-v1')).toBeNull();
  });

  it('finishes hydrating, and writes the migrated doc back at the current version', async () => {
    seed(29);
    const store = await boot();

    expect(store.useDoc.getState().name).toBe('Stored map');
    expect(store.useDoc.persist.hasHydrated()).toBe(true);
    // Without the write-back the stored blob stays at its old version and
    // migrateDoc re-runs on every single reload.
    expect(JSON.parse(localStorage.getItem(KEY)!).version).toBe(
      store.useDoc.persist.getOptions().version,
    );
  });

  it('records no undo entry for the hydrate write', async () => {
    seed(29);
    await boot();
    const { historyDepth } = await import('./history');

    // Rehydration is not an edit: the first Ctrl+Z of a session must reach the
    // user's first edit, not an entry the boot left behind.
    expect(historyDepth()).toBe(0);
  });
});
