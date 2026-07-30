import { describe, it, expect, beforeEach } from 'vitest';
import { useSnapPrefs } from './snapPrefs';
import { DEFAULT_SNAP_MODES } from '../geometry/snap';

describe('useSnapPrefs', () => {
  beforeEach(() => {
    // Reset both the in-memory state and the localStorage backing so each
    // test starts clean.
    localStorage.clear();
    useSnapPrefs.setState({ modes: { ...DEFAULT_SNAP_MODES } });
  });

  it('initializes with the default snap modes', () => {
    // Assert the store's OWN initializer via getInitialState (the pristine
    // snapshot captured at creation), not `getState()` — the latter only
    // reflects what `beforeEach` just wrote, so it could never catch a broken
    // default like `modes: {}` on line 45 of snapPrefs.ts.
    expect(useSnapPrefs.getInitialState().modes).toEqual(DEFAULT_SNAP_MODES);
  });

  it('setMode flips a single key without touching the others', () => {
    useSnapPrefs.getState().setMode('equidistant', true);
    expect(useSnapPrefs.getState().modes).toEqual({
      ...DEFAULT_SNAP_MODES,
      equidistant: true,
    });
  });

  it('persists toggles to localStorage', () => {
    useSnapPrefs.getState().setMode('all', 'diagonal');
    const raw = localStorage.getItem('massimo-snap-prefs-v1');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string);
    expect(parsed.state.modes.all).toBe('diagonal');
  });

  it('setMode accepts directional grid values', () => {
    useSnapPrefs.getState().setMode('grid', 'vertical');
    expect(useSnapPrefs.getState().modes.grid).toBe('vertical');
  });

  it('migrates a legacy v0 blob with boolean all/grid to the directional enums', () => {
    // Seed a pre-versioned persisted blob (no `version`, boolean all/grid),
    // then re-hydrate the store from storage.
    localStorage.setItem(
      'massimo-snap-prefs-v1',
      JSON.stringify({
        state: { modes: { line: true, equidistant: false, tens: false, all: true, grid: true } },
        version: 0,
      }),
    );
    useSnapPrefs.persist.rehydrate();
    const modes = useSnapPrefs.getState().modes;
    expect(modes.all).toBe('all');
    expect(modes.grid).toBe('both');
  });

  it('fills a key the persisted blob predates, rather than leaving it undefined', () => {
    // A v1 blob has no `circle`. Zustand's default merge replaces `modes`
    // WHOLESALE, so without a version bump the store would run with a required
    // field missing — benign today only because `undefined` happens to be
    // falsey, which is not the invariant we want to rest on.
    localStorage.setItem(
      'massimo-snap-prefs-v1',
      JSON.stringify({
        state: { modes: { line: true, equidistant: false, tens: false, all: 'off', grid: 'both' } },
        version: 1,
      }),
    );
    useSnapPrefs.persist.rehydrate();
    const modes = useSnapPrefs.getState().modes;
    expect(modes.circle).toBe(false);
    // ...without trampling what the user had actually set.
    expect(modes.grid).toBe('both');
  });

  it('migrates legacy false flags to off', () => {
    localStorage.setItem(
      'massimo-snap-prefs-v1',
      JSON.stringify({
        state: { modes: { line: true, equidistant: false, tens: false, all: false, grid: false } },
        version: 0,
      }),
    );
    useSnapPrefs.persist.rehydrate();
    const modes = useSnapPrefs.getState().modes;
    expect(modes.all).toBe('off');
    expect(modes.grid).toBe('off');
  });
});
