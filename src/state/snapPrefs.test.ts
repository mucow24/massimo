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
    expect(useSnapPrefs.getState().modes).toEqual(DEFAULT_SNAP_MODES);
  });

  it('setMode flips a single key without touching the others', () => {
    useSnapPrefs.getState().setMode('equidistant', true);
    expect(useSnapPrefs.getState().modes).toEqual({
      ...DEFAULT_SNAP_MODES,
      equidistant: true,
    });
  });

  it('persists toggles to localStorage', () => {
    useSnapPrefs.getState().setMode('all', true);
    const raw = localStorage.getItem('massimo-snap-prefs-v1');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string);
    expect(parsed.state.modes.all).toBe(true);
  });
});
