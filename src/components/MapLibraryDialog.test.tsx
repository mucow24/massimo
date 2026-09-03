import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Every IndexedDB-touching function is mocked — jsdom has no indexedDB, and a
// call that slipped through to the real module would fail on a ReferenceError
// instead of an assertion. The pure exports (sortMaps, types) pass through
// real, so the ordering the dialog shows is the real ordering.
vi.mock('../state/mapLibrary', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../state/mapLibrary')>()),
  listMaps: vi.fn(async () => []),
  listVersions: vi.fn(async () => []),
  getPayload: vi.fn(async () => undefined),
  renameMap: vi.fn(async () => {}),
  deleteMap: vi.fn(async () => {}),
  deleteVersion: vi.fn(async () => {}),
  setVersionName: vi.fn(async () => {}),
  setVersionStarred: vi.fn(async () => {}),
  setMapStarred: vi.fn(async () => {}),
}));

import { MapLibraryDialog } from './MapLibraryDialog';
import {
  listMaps,
  listVersions,
  renameMap,
  deleteMap,
  deleteVersion,
  setVersionName,
  setVersionStarred,
  setMapStarred,
  type MapSummary,
  type VersionMeta,
} from '../state/mapLibrary';
// NOT mocked: plain zustand + localStorage stores, which jsdom runs happily.
import { useLibraryPointer } from '../state/libraryPointer';
import { useLibraryPrefs } from '../state/libraryPrefs';
import { markSaved, useSaveBaseline } from '../state/saveBaseline';
import { pickDocSnapshot, useDoc } from '../state/store';
import { serialize } from '../model/serialize';
import { DEFAULT_DOC } from '../model/transforms';
import { chooseOption } from '../test/interaction';
import { baselineKey, cameraKey, docKey, hasDocDraft, pointerKey } from '../state/mapKeys';

const MAPS: MapSummary[] = [
  {
    id: 'm1',
    name: 'Canal Line',
    updatedAt: Date.parse('2026-07-14T10:00:00Z'),
    createdAt: Date.parse('2026-07-01T10:00:00Z'),
    versionCount: 2,
  },
  {
    id: 'm2',
    name: 'Broadway',
    updatedAt: Date.parse('2026-07-13T10:00:00Z'),
    createdAt: Date.parse('2026-07-10T10:00:00Z'),
    versionCount: 1,
  },
];

/**
 * Mirrors `listVersions`'s contract: newest-first, stars and all. A fixture
 * with the starred row hoisted would agree with no real list, and would let a
 * dialog that still sorts by star pass.
 */
const V3: VersionMeta = {
  id: 7,
  mapId: 'm1',
  savedAt: Date.parse('2026-07-14T10:00:00Z'),
  source: 'user',
  version: 3,
};
const V2: VersionMeta = {
  id: 6,
  mapId: 'm1',
  savedAt: Date.parse('2026-07-13T09:00:00Z'),
  source: 'auto',
  version: 2,
  starred: true,
  name: 'beta 1 — needs work',
};
const VERSIONS: VersionMeta[] = [V3, V2];

/** Broadway's one version. A different map's rows, so "whose versions are
 *  these" is a legible assertion rather than a count. */
const M2_V9: VersionMeta = {
  id: 90,
  mapId: 'm2',
  savedAt: Date.parse('2026-07-13T10:00:00Z'),
  source: 'user',
  version: 9,
};

const onClose = vi.fn();
const onOpenVersion = vi.fn(async () => {});
const onOpenDraft = vi.fn(async () => {});

const renderDialog = () =>
  render(
    <MapLibraryDialog onClose={onClose} onOpenVersion={onOpenVersion} onOpenDraft={onOpenDraft} />,
  );

/** Vouch for the live doc as saved, so "the baseline survived" and "the
 *  baseline was wiped" are distinguishable outcomes below. */
const anchorSavedBaseline = () => {
  const snap = pickDocSnapshot(useDoc.getState());
  markSaved(serialize(snap), snap);
};
const baselineWiped = () => useSaveBaseline.getState().baselineSnap === null;

/** Select Canal Line and wait for its versions to land. */
const openCanalLine = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByText('Canal Line'));
  await waitFor(() => expect(listVersions).toHaveBeenCalledWith('m1'));
};

/** Run every already-resolved promise to its setState. A macrotask boundary
 *  drains the whole microtask queue, so a read chain settles in one await —
 *  which is what "the late read landed and was ignored" needs to observe. */
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

// The dialog portals into document.body, so the render container is empty.
const mapNames = () =>
  [...document.querySelectorAll('.map-row strong')].map((el) => el.textContent);
const versionNumbers = () =>
  [...document.querySelectorAll('.version-number')].map((el) => el.textContent);

beforeEach(() => {
  localStorage.clear();
  useLibraryPointer.setState({ mapId: 'tab-map', version: null });
  useLibraryPrefs.setState({ sort: 'updated', starredMapsOnly: false, starredVersionsOnly: false });
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  vi.mocked(listMaps).mockReset().mockResolvedValue(MAPS);
  vi.mocked(listVersions).mockReset().mockResolvedValue(VERSIONS);
  vi.mocked(renameMap).mockReset().mockResolvedValue(undefined);
  vi.mocked(deleteMap).mockReset().mockResolvedValue(undefined);
  vi.mocked(deleteVersion).mockReset().mockResolvedValue(undefined);
  vi.mocked(setVersionName).mockReset().mockResolvedValue(undefined);
  vi.mocked(setVersionStarred).mockReset().mockResolvedValue(undefined);
  vi.mocked(setMapStarred).mockReset().mockResolvedValue(undefined);
  onClose.mockClear();
  onOpenVersion.mockClear();
  onOpenDraft.mockClear();
  useSaveBaseline.setState({ baselineSnap: null, baselineJson: null, backed: false });
});

describe('MapLibraryDialog', () => {
  it('lists maps, and a selected map’s versions with their numbers and source tags', async () => {
    const user = userEvent.setup();
    renderDialog();
    await screen.findByText('Canal Line');
    expect(screen.getByText('Broadway')).toBeInTheDocument();
    expect(screen.getByText(/2 versions/)).toBeInTheDocument();
    expect(screen.getByText(/1 version ·/)).toBeInTheDocument(); // not "1 versions"

    await openCanalLine(user);
    const versions = screen.getByRole('region', { name: 'Versions' });
    expect(within(versions).getByText('user')).toBeInTheDocument();
    expect(within(versions).getByText('auto')).toBeInTheDocument();
    expect(within(versions).getByText('v3')).toBeInTheDocument();
    expect(within(versions).getByText('v2')).toBeInTheDocument();
  });

  it('shows a version’s name when it has one', async () => {
    const user = userEvent.setup();
    renderDialog();
    await openCanalLine(user);
    expect(screen.getByText('beta 1 — needs work')).toBeInTheDocument();
  });

  it('opens a version through the caller', async () => {
    const user = userEvent.setup();
    renderDialog();
    await openCanalLine(user);
    await user.click(screen.getByRole('button', { name: 'Open version 3' }));
    await waitFor(() => expect(onOpenVersion).toHaveBeenCalledWith(V3));
  });

  it('shows a failed open inside the dialog and keeps it mounted', async () => {
    const user = userEvent.setup();
    onOpenVersion.mockRejectedValue(new Error('Not valid JSON: Unexpected token'));
    renderDialog();
    await openCanalLine(user);
    await user.click(screen.getByRole('button', { name: 'Open version 3' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Not valid JSON');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  /**
   * Deletes are two-step in-row, not a modal. The "library still open" leg is
   * the one that matters: an earlier version of this test passed against the
   * very bug it was named for, because the library unmounting also made the row
   * "disappear".
   */
  it('deletes a map behind a two-step confirm, leaving the library open', async () => {
    const user = userEvent.setup();
    renderDialog();
    await openCanalLine(user);

    // One click arms; it does NOT delete.
    await user.click(screen.getByRole('button', { name: 'Delete Canal Line' }));
    expect(deleteMap).not.toHaveBeenCalled();

    vi.mocked(listMaps).mockResolvedValue([MAPS[1]]);
    await user.click(screen.getByRole('button', { name: 'Sure?' }));
    await waitFor(() => expect(deleteMap).toHaveBeenCalledWith('m1'));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Canal Line')).toBeNull());
    expect(screen.getByText('Broadway')).toBeInTheDocument();
    // The right column must not keep rendering a dead map's versions.
    expect(screen.getByText('Select a map to see its versions.')).toBeInTheDocument();
  });

  /**
   * Without this, the stale pointer resurrects the map: saveVersion's write to
   * the maps store is an upsert, so the next save re-creates the row we deleted.
   * The live doc continues under a fresh identity instead — with its working
   * copy, since those bytes now exist nowhere else.
   */
  it('moves the live doc to a fresh identity when its own map is deleted', async () => {
    const user = userEvent.setup();
    useLibraryPointer.setState({ mapId: 'm1', version: 3 });
    useDoc.getState().setDocName('Live doc'); // writes m1's working copy
    renderDialog();
    await screen.findByText('Canal Line');
    await user.click(screen.getByRole('button', { name: 'Delete Canal Line' }));
    await user.click(screen.getByRole('button', { name: 'Sure?' }));
    // Both halves: a lingering version would put a pill on a map that is gone.
    await waitFor(() => expect(useLibraryPointer.getState().mapId).not.toBe('m1'));
    const { mapId, version } = useLibraryPointer.getState();
    expect(version).toBeNull();
    expect(window.location.hash).toBe(`#map=${mapId}`);
    expect(hasDocDraft('m1')).toBe(false);
    expect(JSON.parse(localStorage.getItem(docKey(mapId))!).state.name).toBe('Live doc');
  });

  it('deleting a map sweeps its per-map slots — a working copy is not left as an orphan', async () => {
    const user = userEvent.setup();
    for (const key of [docKey, baselineKey, cameraKey, pointerKey])
      localStorage.setItem(key('m1'), '{}');
    renderDialog();
    await screen.findByText('Canal Line');
    await user.click(screen.getByRole('button', { name: 'Delete Canal Line' }));
    await user.click(screen.getByRole('button', { name: 'Sure?' }));
    await waitFor(() => expect(deleteMap).toHaveBeenCalledWith('m1'));
    for (const key of [docKey, baselineKey, cameraKey, pointerKey]) {
      expect(localStorage.getItem(key('m1'))).toBeNull();
    }
  });

  it('deleting the live map sweeps the old identity’s slots but keeps the moved doc', async () => {
    const user = userEvent.setup();
    useLibraryPointer.setState({ mapId: 'm1', version: 3 });
    useDoc.getState().setDocName('Live doc');
    localStorage.setItem(baselineKey('m1'), '{}');
    renderDialog();
    await screen.findByText('Canal Line');
    await user.click(screen.getByRole('button', { name: 'Delete Canal Line' }));
    await user.click(screen.getByRole('button', { name: 'Sure?' }));
    await waitFor(() => expect(useLibraryPointer.getState().mapId).not.toBe('m1'));
    expect(localStorage.getItem(baselineKey('m1'))).toBeNull();
    expect(localStorage.getItem(pointerKey('m1'))).toBeNull();
    expect(hasDocDraft(useLibraryPointer.getState().mapId)).toBe(true);
  });

  /**
   * A New drawn and then closed on has a working copy under a map id that no
   * library row names. Nothing else can reach it — a bare boot mints another
   * map — so the dialog lists it.
   */
  it('lists a working copy whose map has no library row, and opens it through the caller', async () => {
    const user = userEvent.setup();
    localStorage.setItem(docKey('ghost'), '{"state":{"name":"Drawn last night"},"version":30}');
    renderDialog();
    await screen.findByText('Canal Line');
    const row = [...document.querySelectorAll('.map-row')].find((r) =>
      r.textContent?.includes('Drawn last night'),
    )!;
    expect(row).toHaveTextContent('unsaved draft');
    expect(row.querySelector('.map-row-link')).toHaveAttribute('href', '#map=ghost');
    await user.click(screen.getByRole('button', { name: 'Open draft Drawn last night' }));
    await waitFor(() => expect(onOpenDraft).toHaveBeenCalledWith('ghost'));
  });

  it('does not list the tab’s own map as a draft — it is already on the canvas', async () => {
    useDoc.getState().setDocName('Being drawn'); // writes tab-map's working copy; no row for it
    renderDialog();
    await screen.findByText('Canal Line');
    expect(screen.queryByText('unsaved draft')).toBeNull();
    expect(screen.queryByText('Being drawn')).toBeNull();
  });

  it('shows a failed draft open inside the dialog', async () => {
    const user = userEvent.setup();
    localStorage.setItem(docKey('ghost'), '{"state":{"name":"Ghost"},"version":30}');
    onOpenDraft.mockRejectedValue(new Error('That map is open in another window.'));
    renderDialog();
    await screen.findByText('Canal Line');
    await user.click(screen.getByRole('button', { name: 'Open draft Ghost' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('another window');
  });

  it('links each map to its own URL, for a new tab', async () => {
    renderDialog();
    await screen.findByText('Canal Line');
    const link = screen.getByRole('link', { name: 'Open Canal Line in a new tab' });
    expect(link).toHaveAttribute('href', '#map=m1');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('marks a map that has a working copy the library does not hold', async () => {
    localStorage.setItem(docKey('m2'), '{"state":{},"version":30}');
    renderDialog();
    await screen.findByText('Canal Line');
    const rows = [...document.querySelectorAll('.map-row')];
    const broadway = rows.find((r) => r.textContent?.includes('Broadway'))!;
    const canal = rows.find((r) => r.textContent?.includes('Canal Line'))!;
    expect(broadway).toHaveTextContent('unsaved changes');
    expect(canal).not.toHaveTextContent('unsaved changes');
  });

  it('leaves the pointer alone when a different map is deleted', async () => {
    const user = userEvent.setup();
    useLibraryPointer.setState({ mapId: 'm2', version: 9 });
    renderDialog();
    await screen.findByText('Canal Line');
    await user.click(screen.getByRole('button', { name: 'Delete Canal Line' }));
    await user.click(screen.getByRole('button', { name: 'Sure?' }));
    await waitFor(() => expect(deleteMap).toHaveBeenCalledWith('m1'));
    expect(useLibraryPointer.getState()).toMatchObject({ mapId: 'm2', version: 9 });
  });

  /**
   * Clearing the pointer is NOT enough on its own, and it is why this is a
   * separate signal rather than something upstream can infer. A null pointer is
   * also what a loaded JSON file looks like — and that document is safe on disk,
   * so its bytes are legitimately still "saved". These bytes are not: their
   * library row is gone. Only the dialog knows the difference.
   */
  it('deleting the live doc’s own map wipes the baseline, so its bytes stop counting as saved', async () => {
    const user = userEvent.setup();
    useLibraryPointer.setState({ mapId: 'm1', version: 3 });
    anchorSavedBaseline();
    renderDialog();
    await screen.findByText('Canal Line');
    await user.click(screen.getByRole('button', { name: 'Delete Canal Line' }));
    await user.click(screen.getByRole('button', { name: 'Sure?' }));
    await waitFor(() => expect(baselineWiped()).toBe(true));
  });

  it('keeps the baseline when the deleted map is not the live doc’s', async () => {
    const user = userEvent.setup();
    useLibraryPointer.setState({ mapId: 'm2', version: 9 });
    anchorSavedBaseline();
    renderDialog();
    await screen.findByText('Canal Line');
    await user.click(screen.getByRole('button', { name: 'Delete Canal Line' }));
    await user.click(screen.getByRole('button', { name: 'Sure?' }));
    await waitFor(() => expect(deleteMap).toHaveBeenCalledWith('m1'));
    expect(baselineWiped()).toBe(false);
  });

  /**
   * The same loss through a smaller door, and the one the map-level fix misses:
   * delete just the version the live doc came from and its bytes are equally
   * gone, while the pointer deliberately does not move at all.
   */
  it('deleting the one version the live doc came from wipes the baseline', async () => {
    const user = userEvent.setup();
    useLibraryPointer.setState({ mapId: 'm1', version: 3 });
    anchorSavedBaseline();
    renderDialog();
    await openCanalLine(user);
    await user.click(screen.getByRole('button', { name: 'Delete version 3' }));
    await user.click(screen.getByRole('button', { name: 'Sure?' }));
    await waitFor(() => expect(baselineWiped()).toBe(true));
  });

  // Some OTHER version of the same map: the doc's own bytes are untouched, so
  // this must not fire — a signal on every delete would defeat the dedup gate
  // and copy the document on the next switch.
  it('keeps the baseline when a version the live doc did not come from is deleted', async () => {
    const user = userEvent.setup();
    useLibraryPointer.setState({ mapId: 'm1', version: 2 });
    anchorSavedBaseline();
    renderDialog();
    await openCanalLine(user);
    await user.click(screen.getByRole('button', { name: 'Delete version 3' }));
    await user.click(screen.getByRole('button', { name: 'Sure?' }));
    await waitFor(() => expect(deleteVersion).toHaveBeenCalledWith(7));
    expect(baselineWiped()).toBe(false);
  });

  // Same version NUMBER, different map: the number alone is not identity.
  it('keeps the baseline when another map happens to share the version number', async () => {
    const user = userEvent.setup();
    useLibraryPointer.setState({ mapId: 'm2', version: 3 });
    anchorSavedBaseline();
    renderDialog();
    await openCanalLine(user);
    await user.click(screen.getByRole('button', { name: 'Delete version 3' }));
    await user.click(screen.getByRole('button', { name: 'Sure?' }));
    await waitFor(() => expect(deleteVersion).toHaveBeenCalledWith(7));
    expect(baselineWiped()).toBe(false);
  });

  it('keeps the baseline when the delete itself fails', async () => {
    const user = userEvent.setup();
    useLibraryPointer.setState({ mapId: 'm1', version: 3 });
    anchorSavedBaseline();
    vi.mocked(deleteMap).mockRejectedValue(new Error('QuotaExceededError'));
    renderDialog();
    await screen.findByText('Canal Line');
    await user.click(screen.getByRole('button', { name: 'Delete Canal Line' }));
    await user.click(screen.getByRole('button', { name: 'Sure?' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(baselineWiped()).toBe(false);
    expect(useLibraryPointer.getState()).toMatchObject({ mapId: 'm1', version: 3 });
  });

  it('deletes a single version behind the same two-step', async () => {
    const user = userEvent.setup();
    renderDialog();
    await openCanalLine(user);
    await user.click(screen.getByRole('button', { name: 'Delete version 3' }));
    expect(deleteVersion).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Sure?' }));
    await waitFor(() => expect(deleteVersion).toHaveBeenCalledWith(7));
  });

  /**
   * Deleting the version the live doc came from must NOT clear the pill: the
   * canvas still holds those bytes, so "came from v3" stays true. Only deleting
   * the whole map takes the pointer with it.
   */
  it('leaves the pointer alone when the live doc’s own version is deleted', async () => {
    const user = userEvent.setup();
    useLibraryPointer.setState({ mapId: 'm1', version: 3 });
    renderDialog();
    await openCanalLine(user);
    await user.click(screen.getByRole('button', { name: 'Delete version 3' }));
    await user.click(screen.getByRole('button', { name: 'Sure?' }));
    await waitFor(() => expect(deleteVersion).toHaveBeenCalledWith(7));
    expect(useLibraryPointer.getState()).toMatchObject({ mapId: 'm1', version: 3 });
  });

  describe('stars', () => {
    it('stars an unstarred version', async () => {
      const user = userEvent.setup();
      renderDialog();
      await openCanalLine(user);
      await user.click(screen.getByRole('button', { name: 'Star version 3' }));
      await waitFor(() => expect(setVersionStarred).toHaveBeenCalledWith(7, true));
    });

    // The same control both ways: a star button that only ever stars is the
    // easy bug, and it reads as "nothing happened".
    it('un-stars a starred version', async () => {
      const user = userEvent.setup();
      renderDialog();
      await openCanalLine(user);
      await user.click(screen.getByRole('button', { name: 'Unstar version 2' }));
      await waitFor(() => expect(setVersionStarred).toHaveBeenCalledWith(6, false));
    });

    // The row has to come back with its new flag: the filled star, and whether
    // it still belongs in a list filtered to starred rows.
    it('re-reads the list after starring a version', async () => {
      const user = userEvent.setup();
      renderDialog();
      await openCanalLine(user);
      vi.mocked(listVersions).mockClear();
      await user.click(screen.getByRole('button', { name: 'Star version 3' }));
      await waitFor(() => expect(listVersions).toHaveBeenCalledWith('m1'));
    });

    /**
     * A star is an edit to a list you are looking at. Re-selecting the map to
     * refresh would blank the column and flash "Loading…" under the cursor.
     */
    it('does not flash the loading state while re-reading', async () => {
      const user = userEvent.setup();
      renderDialog();
      await openCanalLine(user);
      await user.click(screen.getByRole('button', { name: 'Star version 3' }));
      expect(screen.queryByText('Loading…')).toBeNull();
      await waitFor(() => expect(setVersionStarred).toHaveBeenCalled());
      expect(screen.queryByText('Loading…')).toBeNull();
    });
  });

  /**
   * Each column's head carries its own star filter. It replaces the block of
   * starred rows that used to be pinned above each list: a star now tags a row
   * where it sits, and the filter is how you go and look at only those.
   */
  describe('the star filter', () => {
    const mapFilter = () => screen.getByRole('button', { name: 'Show starred maps only' });
    const versionFilter = () => screen.getByRole('button', { name: 'Show starred versions only' });

    /**
     * One test for both halves on purpose. A filter that quietly re-sorted its
     * survivors (dropping back to insertion order, say) would pass a
     * membership-only check — so the third map is both the newest-edited and
     * the alphabetically first, and must be absent under either mode.
     */
    it('filters the map list to starred maps, still honouring the chosen sort', async () => {
      const user = userEvent.setup();
      vi.mocked(listMaps).mockResolvedValue([
        { ...MAPS[0], starred: true }, // Canal Line, edited 7-14
        { ...MAPS[1], starred: true }, // Broadway, edited 7-13
        {
          id: 'm3',
          name: 'Archive',
          updatedAt: Date.parse('2026-07-15T10:00:00Z'),
          createdAt: Date.parse('2026-07-02T10:00:00Z'),
          versionCount: 1,
        },
      ]);
      renderDialog();
      await screen.findByText('Archive');

      await user.click(mapFilter());
      await waitFor(() => expect(mapNames()).toEqual(['Canal Line', 'Broadway']));

      await chooseOption(user, 'Sort maps', 'Name');
      await waitFor(() => expect(mapNames()).toEqual(['Broadway', 'Canal Line']));
    });

    it('depresses while it is filtering, and releases the list again', async () => {
      const user = userEvent.setup();
      renderDialog();
      await screen.findByText('Canal Line');
      expect(mapFilter()).toHaveAttribute('aria-pressed', 'false');

      await user.click(mapFilter());
      expect(mapFilter()).toHaveAttribute('aria-pressed', 'true');

      await user.click(mapFilter());
      expect(mapFilter()).toHaveAttribute('aria-pressed', 'false');
      await waitFor(() => expect(mapNames()).toEqual(['Canal Line', 'Broadway']));
    });

    // Not "No saved maps yet." — the library is full, you are just looking
    // through a filter nothing has been marked for.
    it('says No starred maps rather than No saved maps when nothing is starred', async () => {
      const user = userEvent.setup();
      renderDialog();
      await screen.findByText('Canal Line');
      await user.click(mapFilter());
      expect(await screen.findByText('No starred maps.')).toBeInTheDocument();
      expect(screen.queryByText('No saved maps yet.')).toBeNull();
    });

    /**
     * The right column answers for the map you clicked, not for the left
     * column's current filter — filtering a selected map's row out of sight must
     * not empty the versions beside it.
     */
    it('keeps the selected map’s versions when the filter hides its row', async () => {
      const user = userEvent.setup();
      renderDialog();
      await openCanalLine(user);
      await user.click(mapFilter());
      await waitFor(() => expect(mapNames()).toEqual([]));

      const versions = screen.getByRole('region', { name: 'Versions' });
      expect(within(versions).getByText('Canal Line')).toBeInTheDocument();
      expect(versionNumbers()).toEqual(['v3', 'v2']);
    });

    it('filters the version list to starred versions', async () => {
      const user = userEvent.setup();
      renderDialog();
      await openCanalLine(user);
      expect(versionNumbers()).toEqual(['v3', 'v2']);
      await user.click(versionFilter());
      await waitFor(() => expect(versionNumbers()).toEqual(['v2']));
    });

    it('says No starred versions when the map has versions but none is starred', async () => {
      const user = userEvent.setup();
      vi.mocked(listVersions).mockResolvedValue([V3]);
      renderDialog();
      await openCanalLine(user);
      await user.click(versionFilter());
      expect(await screen.findByText('No starred versions.')).toBeInTheDocument();
      expect(screen.queryByText('No versions.')).toBeNull();
    });

    // Two separate controls over two separate lists; one must not reach across
    // and thin out the other.
    it('filters each column independently', async () => {
      const user = userEvent.setup();
      renderDialog();
      await openCanalLine(user);
      await user.click(versionFilter());
      await waitFor(() => expect(versionNumbers()).toEqual(['v2']));
      expect(mapNames()).toEqual(['Canal Line', 'Broadway']);
    });

    /**
     * View preferences, like the sort beside them: the next open opens the way
     * you left it. Asserted against the STORED bytes, not the store — reading
     * `useLibraryPrefs.getState()` back tests the setter, and would pass just
     * as happily if the keys never reached `partialize`.
     */
    it('persists both filters, and the sort, for the next session', async () => {
      const user = userEvent.setup();
      renderDialog();
      await openCanalLine(user);
      await user.click(mapFilter());
      await user.click(versionFilter());
      await chooseOption(user, 'Sort maps', 'Name');
      await waitFor(() => {
        const stored = JSON.parse(localStorage.getItem('massimo-library-prefs-v1') ?? '{}') as {
          state?: Record<string, unknown>;
        };
        expect(stored.state).toMatchObject({
          sort: 'name',
          starredMapsOnly: true,
          starredVersionsOnly: true,
        });
      });
    });

    /**
     * The cue has to survive the case it exists for. The named empty message
     * only speaks when NOTHING survives the filter — a list of one where there
     * were three is the reading that needs answering, and the toggle alone is
     * 24px of it.
     */
    it('says "starred only" in the head while a non-empty list is filtered', async () => {
      const user = userEvent.setup();
      vi.mocked(listMaps).mockResolvedValue([MAPS[0], { ...MAPS[1], starred: true }]);
      renderDialog();
      await screen.findByText('Canal Line');
      const maps = screen.getByRole('region', { name: 'Saved maps' });
      expect(within(maps).queryByText('starred only')).toBeNull();

      await user.click(mapFilter());
      await waitFor(() => expect(mapNames()).toEqual(['Broadway']));
      expect(within(maps).getByText('starred only')).toBeInTheDocument();
    });

    // Nothing to filter yet, and the flag is persisted: a press here would
    // write a preference whose effect you never see, and find the next column
    // you open already thinned out.
    it('will not filter versions before a map is chosen', async () => {
      const user = userEvent.setup();
      renderDialog();
      await screen.findByText('Canal Line');
      expect(versionFilter()).toBeDisabled();

      await user.click(versionFilter());
      expect(useLibraryPrefs.getState().starredVersionsOnly).toBe(false);
    });

    /**
     * Un-starring the last marked row while filtering takes it out from under
     * the cursor. The list must say which of the two things happened — the
     * filter emptied, not the map's history — because the write is outside
     * zundo and there is nothing else to reassure with.
     */
    it('names the filter, not the map, when the last starred version is un-starred', async () => {
      const user = userEvent.setup();
      renderDialog();
      await openCanalLine(user);
      await user.click(versionFilter());
      await waitFor(() => expect(versionNumbers()).toEqual(['v2']));

      vi.mocked(listVersions).mockResolvedValue([V3, { ...V2, starred: undefined }]);
      await user.click(screen.getByRole('button', { name: 'Unstar version 2' }));
      expect(await screen.findByText('No starred versions.')).toBeInTheDocument();
      expect(screen.queryByText('No versions.')).toBeNull();
    });
  });

  describe('naming a version', () => {
    it('names an unnamed version', async () => {
      const user = userEvent.setup();
      renderDialog();
      await openCanalLine(user);
      await user.click(screen.getByRole('button', { name: 'Name version 3' }));
      await user.type(screen.getByRole('textbox', { name: 'Name version 3' }), 'rc2{Enter}');
      await waitFor(() => expect(setVersionName).toHaveBeenCalledWith(7, 'rc2'));
    });

    it('opens the editor on the existing name so it can be edited, not retyped', async () => {
      const user = userEvent.setup();
      renderDialog();
      await openCanalLine(user);
      await user.click(screen.getByRole('button', { name: 'Name version 2' }));
      expect(screen.getByRole('textbox', { name: 'Name version 2' })).toHaveValue(
        'beta 1 — needs work',
      );
    });

    /**
     * Clearing the field is how you remove a name, so a blank must reach the
     * library rather than being swallowed as "nothing to do" — which is exactly
     * what the map rename above it does with a blank.
     */
    it('passes a cleared name through, so a name can be removed', async () => {
      const user = userEvent.setup();
      renderDialog();
      await openCanalLine(user);
      await user.click(screen.getByRole('button', { name: 'Name version 2' }));
      const input = screen.getByRole('textbox', { name: 'Name version 2' });
      await user.clear(input);
      await user.keyboard('{Enter}');
      await waitFor(() => expect(setVersionName).toHaveBeenCalledWith(6, ''));
    });

    it('commits on blur', async () => {
      const user = userEvent.setup();
      renderDialog();
      await openCanalLine(user);
      await user.click(screen.getByRole('button', { name: 'Name version 3' }));
      await user.type(screen.getByRole('textbox', { name: 'Name version 3' }), 'rc2');
      await user.tab();
      await waitFor(() => expect(setVersionName).toHaveBeenCalledWith(7, 'rc2'));
    });

    // Same shape as the map rename: Escape is a second consumer of a keypress
    // useDismiss also listens for on `document`.
    it('Escape while naming cancels it without closing the library', async () => {
      const user = userEvent.setup();
      renderDialog();
      await openCanalLine(user);
      await user.click(screen.getByRole('button', { name: 'Name version 3' }));
      await user.type(screen.getByRole('textbox', { name: 'Name version 3' }), 'zzz{Escape}');
      expect(setVersionName).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  /**
   * Both halves are required. #1 alone passes against an unconditional
   * setDocName, which would clobber the live title whenever any other map is
   * renamed — and an auto-save would then write the wrong name.
   */
  it('renaming the CURRENT map also renames the live document', async () => {
    const user = userEvent.setup();
    useLibraryPointer.setState({ mapId: 'm1', version: 3 });
    useDoc.getState().setDocName('Canal Line');
    renderDialog();
    await screen.findByText('Canal Line');
    await user.click(screen.getByRole('button', { name: 'Rename Canal Line' }));
    const input = screen.getByRole('textbox', { name: 'Rename Canal Line' });
    await user.clear(input);
    await user.type(input, 'Canal St{Enter}');
    await waitFor(() => expect(renameMap).toHaveBeenCalledWith('m1', 'Canal St'));
    expect(useDoc.getState().name).toBe('Canal St');
  });

  it('renaming a NON-current map leaves the live document’s name alone', async () => {
    const user = userEvent.setup();
    useLibraryPointer.setState({ mapId: 'm2', version: 1 });
    useDoc.getState().setDocName('Broadway');
    renderDialog();
    await screen.findByText('Canal Line');
    await user.click(screen.getByRole('button', { name: 'Rename Canal Line' }));
    const input = screen.getByRole('textbox', { name: 'Rename Canal Line' });
    await user.clear(input);
    await user.type(input, 'Renamed{Enter}');
    await waitFor(() => expect(renameMap).toHaveBeenCalledWith('m1', 'Renamed'));
    expect(useDoc.getState().name).toBe('Broadway');
  });

  /**
   * Exclusion, not presence. A half-fix — add a loading state, leave the empty
   * branch as a bare `maps.length === 0` (true while pending) — renders BOTH and
   * flashes "No saved maps yet" on every open. A presence-only test passes that.
   */
  it('shows loading WITHOUT the empty message, then empty WITHOUT loading', async () => {
    let resolveMaps: (v: MapSummary[]) => void = () => {};
    vi.mocked(listMaps).mockReturnValue(
      new Promise<MapSummary[]>((r) => {
        resolveMaps = r;
      }),
    );
    renderDialog();

    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText('No saved maps yet.')).toBeNull();

    resolveMaps([]);
    await screen.findByText('No saved maps yet.');
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  /**
   * useDismiss listens for Escape on `document`, so the rename input is a second
   * consumer of the same keypress. Escape mid-rename must cancel the rename and
   * nothing else.
   */
  it('Escape while renaming cancels the rename without closing the library', async () => {
    const user = userEvent.setup();
    renderDialog();
    await screen.findByText('Canal Line');
    await user.click(screen.getByRole('button', { name: 'Rename Canal Line' }));
    await user.type(screen.getByRole('textbox', { name: 'Rename Canal Line' }), 'zzz{Escape}');

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(renameMap).not.toHaveBeenCalled();
  });

  /**
   * Every other click-to-edit name field in the app selects its text on entry
   * (`useInlineRename`), so typing REPLACES the old name. The library's two
   * fields are hand-rolled — they cannot use the hook (their commit is async
   * and their Escape must be kept from the Dialog's dismiss) — but the
   * interaction is the same one, and a rename you have to select-all first is
   * a different control.
   */
  it('selects the existing name on entry, in both columns', async () => {
    const user = userEvent.setup();
    renderDialog();
    await openCanalLine(user);

    await user.click(screen.getByRole('button', { name: 'Rename Canal Line' }));
    const mapInput = screen.getByRole('textbox', {
      name: 'Rename Canal Line',
    }) as HTMLInputElement;
    expect(mapInput.selectionStart).toBe(0);
    expect(mapInput.selectionEnd).toBe('Canal Line'.length);

    await user.click(screen.getByRole('button', { name: 'Name version 2' }));
    const versionInput = screen.getByRole('textbox', {
      name: 'Name version 2',
    }) as HTMLInputElement;
    expect(versionInput.selectionStart).toBe(0);
    expect(versionInput.selectionEnd).toBe(versionInput.value.length);
    expect(versionInput.value).not.toBe('');
  });

  it('Escape with nothing else going on closes the library', async () => {
    const user = userEvent.setup();
    renderDialog();
    await screen.findByText('Canal Line');
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('starts with no map selected', async () => {
    renderDialog();
    await screen.findByText('Canal Line');
    expect(screen.getByText('Select a map to see its versions.')).toBeInTheDocument();
  });

  describe('map sorting', () => {
    it('orders by last edited by default', async () => {
      renderDialog();
      await screen.findByText('Canal Line');
      expect(mapNames()).toEqual(['Canal Line', 'Broadway']);
    });

    it('re-orders alphabetically when Name is chosen, and remembers the choice', async () => {
      const user = userEvent.setup();
      renderDialog();
      await screen.findByText('Canal Line');
      await chooseOption(user, 'Sort maps', 'Name');
      await waitFor(() => expect(mapNames()).toEqual(['Broadway', 'Canal Line']));
      expect(useLibraryPrefs.getState().sort).toBe('name');
    });

    // The mode's semantics live in sortMaps's own tests; this pins the wiring —
    // the option exists and lands in the preference the next open reads.
    it('offers creation-date order, remembering the choice', async () => {
      const user = userEvent.setup();
      renderDialog();
      await screen.findByText('Canal Line');
      await chooseOption(user, 'Sort maps', 'Date created');
      await waitFor(() => expect(useLibraryPrefs.getState().sort).toBe('created'));
    });

    // The star is a tag, not a rank: an unfiltered list shows it exactly where
    // the sort put it, rather than hoisting it into a block of its own.
    it('leaves a starred map where the sort puts it', async () => {
      vi.mocked(listMaps).mockResolvedValue([MAPS[0], { ...MAPS[1], starred: true }]);
      renderDialog();
      await screen.findByText('Canal Line');
      expect(mapNames()).toEqual(['Canal Line', 'Broadway']);
    });
  });

  describe('map stars', () => {
    it('stars an unstarred map', async () => {
      const user = userEvent.setup();
      renderDialog();
      await screen.findByText('Canal Line');
      await user.click(screen.getByRole('button', { name: 'Star Broadway' }));
      await waitFor(() => expect(setMapStarred).toHaveBeenCalledWith('m2', true));
    });

    it('un-stars a starred map', async () => {
      vi.mocked(listMaps).mockResolvedValue([MAPS[0], { ...MAPS[1], starred: true }]);
      const user = userEvent.setup();
      renderDialog();
      await screen.findByText('Broadway');
      await user.click(screen.getByRole('button', { name: 'Unstar Broadway' }));
      await waitFor(() => expect(setMapStarred).toHaveBeenCalledWith('m2', false));
    });

    // A star is an edit to a list you are looking at (the version-star rule):
    // the re-read must not blank the column into "Loading…" under the cursor.
    it('re-reads the list after starring a map, without flashing loading', async () => {
      const user = userEvent.setup();
      renderDialog();
      await screen.findByText('Canal Line');
      vi.mocked(listMaps).mockClear();
      await user.click(screen.getByRole('button', { name: 'Star Broadway' }));
      await waitFor(() => expect(listMaps).toHaveBeenCalled());
      expect(screen.queryByText('Loading…')).toBeNull();
    });

    it('does not select the map on the way to its star', async () => {
      const user = userEvent.setup();
      renderDialog();
      await screen.findByText('Canal Line');
      await user.click(screen.getByRole('button', { name: 'Star Broadway' }));
      await waitFor(() => expect(setMapStarred).toHaveBeenCalled());
      expect(listVersions).not.toHaveBeenCalled();
    });
  });

  /**
   * The right-hand column is headed by the selected map's name, and Open and
   * the non-undoable Delete act on the rows under that heading — so a version
   * read that lands after the selection moved on must not paint them.
   */
  describe('versions belong to the selected map', () => {
    it('ignores a read that settles after another map was selected', async () => {
      const user = userEvent.setup();
      let landCanalLine: (rows: VersionMeta[]) => void = () => {};
      vi.mocked(listVersions).mockImplementation((id) =>
        id === 'm1'
          ? new Promise<VersionMeta[]>((r) => {
              landCanalLine = r;
            })
          : Promise.resolve([M2_V9]),
      );
      renderDialog();
      await user.click(await screen.findByText('Canal Line'));
      await user.click(await screen.findByText('Broadway'));
      await waitFor(() => expect(versionNumbers()).toEqual(['v9']));

      landCanalLine(VERSIONS); // two concurrent readonly reads, settling backwards
      await settle();
      expect(versionNumbers()).toEqual(['v9']);
      expect(screen.getByRole('heading', { name: 'Broadway' })).toBeInTheDocument();
    });

    // Clicking the row you are already on blanks the list, so it owes you a
    // read: without one the column sits at "Loading…" with nothing coming.
    it('re-reads when the selected map is clicked again', async () => {
      const user = userEvent.setup();
      renderDialog();
      await openCanalLine(user);
      vi.mocked(listVersions).mockClear();
      // From the maps column: the versions column is now headed by the same name.
      const maps = document.querySelector('.map-library-maps') as HTMLElement;
      await user.click(within(maps).getByText('Canal Line'));
      await waitFor(() => expect(listVersions).toHaveBeenCalledWith('m1'));
      expect(versionNumbers()).toEqual(['v3', 'v2']);
    });

    /**
     * The route that needs no reordering at all: a version-name write blocks
     * the reads behind it, so its own refresh — which closes over the map that
     * was selected when the input was opened — is the LAST read issued.
     */
    it('ignores the refresh a name commit makes for the map you just left', async () => {
      const user = userEvent.setup();
      let commitName: () => void = () => {};
      vi.mocked(setVersionName).mockReturnValue(
        new Promise<void>((r) => {
          commitName = () => r();
        }),
      );
      vi.mocked(listVersions).mockImplementation((id) =>
        Promise.resolve(id === 'm1' ? VERSIONS : [M2_V9]),
      );
      renderDialog();
      await openCanalLine(user);
      await user.click(screen.getByRole('button', { name: 'Name version 3' }));
      await user.type(screen.getByRole('textbox', { name: 'Name version 3' }), 'beta 1');
      // Mousedown on the map row blurs the input, so the name write is in
      // flight while the click selects Broadway.
      await user.click(screen.getByText('Broadway'));
      await waitFor(() => expect(versionNumbers()).toEqual(['v9']));

      commitName();
      await settle();
      expect(versionNumbers()).toEqual(['v9']);
      expect(screen.getByRole('heading', { name: 'Broadway' })).toBeInTheDocument();
    });
  });

  describe('thumb hover preview', () => {
    it('raises the full-size capture while hovering a version thumb', async () => {
      const user = userEvent.setup();
      vi.mocked(listVersions).mockResolvedValue([{ ...V3, thumb: 'data:image/png;base64,LARGE' }]);
      renderDialog();
      await openCanalLine(user);
      const thumb = document.querySelector('.map-library-versions img.map-thumb');
      expect(thumb).not.toBeNull();
      await user.hover(thumb!);
      await waitFor(() => {
        const preview = document.querySelector('.map-thumb-preview img');
        expect(preview).toHaveAttribute('src', 'data:image/png;base64,LARGE');
      });
    });

    it('renders no thumb image for a thumb-less row', async () => {
      const user = userEvent.setup();
      renderDialog();
      await openCanalLine(user);
      // The fixture versions carry no thumb: the placeholder is inert.
      expect(document.querySelector('.map-library-versions img.map-thumb')).toBeNull();
      expect(document.querySelector('.map-thumb-preview')).toBeNull();
    });
  });
});
