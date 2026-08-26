import { describe, it, expect, beforeEach } from 'vitest';
import { useSnapPrefs } from './snapPrefs';
import { DEFAULT_SNAP_MODES, type SnapModes } from '../geometry/snap';

describe('useSnapPrefs', () => {
  beforeEach(() => {
    // Reset both the in-memory state and the localStorage backing so each
    // test starts clean.
    localStorage.clear();
    useSnapPrefs.setState({ modes: { ...DEFAULT_SNAP_MODES }, presets: {} });
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
    // WHOLESALE, so without the fill the store would run with a required
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

  /**
   * The same fill, at the CURRENT version — which is the case that actually
   * happens. `migrate` runs only when the stored version differs from the
   * configured one, so every blob written by this build skips it entirely: the
   * next mode added without a version bump would land `undefined` on every
   * existing installation, while the v1 test above went on passing. The fill
   * therefore has to sit in `merge`, which runs on every rehydrate.
   */
  it('fills a predated key in a CURRENT-version blob too, where migrate never runs', () => {
    localStorage.setItem(
      'massimo-snap-prefs-v1',
      JSON.stringify({
        state: {
          modes: { line: true, equidistant: false, tens: false, all: 'off', grid: 'both' },
          presets: {},
        },
        version: 2,
      }),
    );
    useSnapPrefs.persist.rehydrate();
    const modes = useSnapPrefs.getState().modes;
    expect(modes.circle).toBe(false);
    expect(modes.grid).toBe('both');
  });

  describe('presets', () => {
    it('savePreset snapshots the live modes into the slot', () => {
      useSnapPrefs.setState({ modes: { ...DEFAULT_SNAP_MODES, all: 'diagonal', circle: true } });
      useSnapPrefs.getState().savePreset(3);
      // A copy, not a live reference: editing the modes afterwards must not
      // rewrite what the slot holds.
      useSnapPrefs.getState().setMode('all', 'off');
      expect(useSnapPrefs.getState().presets[3]).toEqual({
        ...DEFAULT_SNAP_MODES,
        all: 'diagonal',
        circle: true,
      });
    });

    it('recallPreset applies a saved slot and reports the hit', () => {
      useSnapPrefs.setState({ modes: { ...DEFAULT_SNAP_MODES, grid: 'both' } });
      useSnapPrefs.getState().savePreset(7);
      useSnapPrefs.setState({ modes: { ...DEFAULT_SNAP_MODES } });
      expect(useSnapPrefs.getState().recallPreset(7)).toBe(true);
      expect(useSnapPrefs.getState().modes).toEqual({ ...DEFAULT_SNAP_MODES, grid: 'both' });
    });

    it('recallPreset on an unsaved slot changes nothing and reports the miss', () => {
      useSnapPrefs.setState({ modes: { ...DEFAULT_SNAP_MODES, tens: true } });
      expect(useSnapPrefs.getState().recallPreset(4)).toBe(false);
      expect(useSnapPrefs.getState().modes).toEqual({ ...DEFAULT_SNAP_MODES, tens: true });
    });

    it('savePreset overwrites its own slot and leaves the others alone', () => {
      useSnapPrefs.setState({ modes: { ...DEFAULT_SNAP_MODES, grid: 'both' } });
      useSnapPrefs.getState().savePreset(1);
      useSnapPrefs.setState({ modes: { ...DEFAULT_SNAP_MODES, all: 'all' } });
      useSnapPrefs.getState().savePreset(2);
      useSnapPrefs.setState({ modes: { ...DEFAULT_SNAP_MODES, circle: true } });
      useSnapPrefs.getState().savePreset(2);
      expect(useSnapPrefs.getState().presets[1]?.grid).toBe('both');
      expect(useSnapPrefs.getState().presets[2]).toEqual({ ...DEFAULT_SNAP_MODES, circle: true });
    });

    it('persists presets to localStorage', () => {
      useSnapPrefs.setState({ modes: { ...DEFAULT_SNAP_MODES, all: 'diagonal' } });
      useSnapPrefs.getState().savePreset(0);
      const parsed = JSON.parse(localStorage.getItem('massimo-snap-prefs-v1') as string);
      expect(parsed.state.presets['0'].all).toBe('diagonal');
    });

    it('recall fills a mode the saved preset predates, rather than leaving it undefined', () => {
      // A preset written before `circle` existed has no key for it. The persist
      // migration can't help — it only reshapes `modes` — so recall must fill
      // from the defaults, or the mode lands `undefined` at runtime (and, worse,
      // silently keeps whatever the live modes happened to have).
      useSnapPrefs.setState({
        modes: { ...DEFAULT_SNAP_MODES, circle: true },
        presets: {
          5: { line: true, equidistant: false, tens: false, all: 'off', grid: 'both' } as SnapModes,
        },
      });
      useSnapPrefs.getState().recallPreset(5);
      expect(useSnapPrefs.getState().modes.circle).toBe(false);
      expect(useSnapPrefs.getState().modes.grid).toBe('both');
    });
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
