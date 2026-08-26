import { describe, it, expect, beforeEach } from 'vitest';
import { useLibraryPrefs } from './libraryPrefs';
import { MAP_SORTS } from './mapLibrary';

const KEY = 'massimo-library-prefs-v1';

const seed = (state: unknown) => {
  localStorage.setItem(KEY, JSON.stringify({ state, version: 0 }));
  useLibraryPrefs.persist.rehydrate();
};

describe('useLibraryPrefs', () => {
  beforeEach(() => {
    localStorage.clear();
    useLibraryPrefs.setState({
      sort: 'updated',
      starredMapsOnly: false,
      starredVersionsOnly: false,
    });
  });

  it('defaults to newest-edited first, with neither star filter on', () => {
    const init = useLibraryPrefs.getInitialState();
    expect(init.sort).toBe('updated');
    expect(MAP_SORTS).toContain(init.sort);
    expect(init.starredMapsOnly).toBe(false);
    expect(init.starredVersionsOnly).toBe(false);
  });

  it('restores a stored choice', () => {
    seed({ sort: 'name', starredMapsOnly: true, starredVersionsOnly: false });
    expect(useLibraryPrefs.getState().sort).toBe('name');
    expect(useLibraryPrefs.getState().starredMapsOnly).toBe(true);
  });

  /**
   * A persisted union fails from the picker's end: a mode the ladder no longer
   * offers has no Select item to match, so the trigger reads BLANK while
   * `sortMaps` quietly falls through to its default ordering — the picker
   * showing one thing and the list doing another. The guard beside the ladder
   * is what lets the store heal it on the way in.
   */
  it('heals a stored sort the ladder no longer offers', () => {
    seed({ sort: 'size', starredMapsOnly: false, starredVersionsOnly: false });
    expect(useLibraryPrefs.getState().sort).toBe('updated');
  });

  it('leaves a blob that predates the field on the live value', () => {
    seed({ starredMapsOnly: true });
    expect(useLibraryPrefs.getState().sort).toBe('updated');
    expect(useLibraryPrefs.getState().starredMapsOnly).toBe(true);
  });
});
