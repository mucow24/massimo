import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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

const onClose = vi.fn();
const onOpenVersion = vi.fn(async () => {});

const renderDialog = () =>
  render(<MapLibraryDialog onClose={onClose} onOpenVersion={onOpenVersion} />);

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

// The dialog portals into document.body, so the render container is empty.
const mapNames = () =>
  [...document.querySelectorAll('.map-row strong')].map((el) => el.textContent);
const versionNumbers = () =>
  [...document.querySelectorAll('.version-number')].map((el) => el.textContent);

beforeEach(() => {
  localStorage.clear();
  useLibraryPointer.setState({ mapId: null, version: null });
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
   */
  it('clears the current-map pointer when the current map is deleted', async () => {
    const user = userEvent.setup();
    useLibraryPointer.setState({ mapId: 'm1', version: 3 });
    renderDialog();
    await screen.findByText('Canal Line');
    await user.click(screen.getByRole('button', { name: 'Delete Canal Line' }));
    await user.click(screen.getByRole('button', { name: 'Sure?' }));
    // Both halves: a lingering version would put a pill on a map that is gone.
    await waitFor(() => expect(useLibraryPointer.getState().mapId).toBeNull());
    expect(useLibraryPointer.getState().version).toBeNull();
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

  // The failed delete must not report a loss that did not happen: the map, and
  // the document's claim on it, are both still there.
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

    // A view preference, like the sort beside it: the next open opens the way
    // you left it.
    it('remembers both filters across sessions', async () => {
      const user = userEvent.setup();
      renderDialog();
      await openCanalLine(user);
      await user.click(mapFilter());
      await user.click(versionFilter());
      expect(useLibraryPrefs.getState()).toMatchObject({
        starredMapsOnly: true,
        starredVersionsOnly: true,
      });
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

    it('shows no preview for a thumb-less row', async () => {
      const user = userEvent.setup();
      renderDialog();
      await openCanalLine(user);
      // The fixture versions carry no thumb: the placeholder is inert.
      expect(document.querySelector('.map-library-versions img.map-thumb')).toBeNull();
      expect(document.querySelector('.map-thumb-preview')).toBeNull();
    });
  });
});
