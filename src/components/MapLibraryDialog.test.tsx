import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Wholesale: jsdom has no indexedDB, so a partial mock would leave the real
// module reachable and fail on a ReferenceError instead of an assertion.
vi.mock('../state/mapLibrary', () => ({
  listMaps: vi.fn(async () => []),
  listVersions: vi.fn(async () => []),
  getPayload: vi.fn(async () => undefined),
  renameMap: vi.fn(async () => {}),
  deleteMap: vi.fn(async () => {}),
  deleteVersion: vi.fn(async () => {}),
  setVersionName: vi.fn(async () => {}),
  setVersionStarred: vi.fn(async () => {}),
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
  type MapSummary,
  type VersionMeta,
} from '../state/mapLibrary';
// NOT mocked: a plain zustand + localStorage store, which jsdom runs happily.
import { useLibraryPointer } from '../state/libraryPointer';
import { markSaved, useSaveBaseline } from '../state/saveBaseline';
import { pickDocSnapshot, useDoc } from '../state/store';
import { serialize } from '../model/serialize';
import { DEFAULT_DOC } from '../model/transforms';

const MAPS: MapSummary[] = [
  { id: 'm1', name: 'Canal Line', updatedAt: Date.parse('2026-07-14T10:00:00Z'), versionCount: 2 },
  { id: 'm2', name: 'Broadway', updatedAt: Date.parse('2026-07-13T10:00:00Z'), versionCount: 1 },
];

/**
 * Mirrors `listVersions`'s contract: the starred block first, newest-first
 * within each group. A fixture in plain newest-first order would let the
 * dialog's divider logic pass while disagreeing with every real list.
 */
const VERSIONS: VersionMeta[] = [
  {
    id: 6,
    mapId: 'm1',
    savedAt: Date.parse('2026-07-13T09:00:00Z'),
    source: 'auto',
    version: 2,
    starred: true,
    name: 'beta 1 — needs work',
  },
  { id: 7, mapId: 'm1', savedAt: Date.parse('2026-07-14T10:00:00Z'), source: 'user', version: 3 },
];

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

beforeEach(() => {
  localStorage.clear();
  useLibraryPointer.setState({ mapId: null, version: null });
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  vi.mocked(listMaps).mockReset().mockResolvedValue(MAPS);
  vi.mocked(listVersions).mockReset().mockResolvedValue(VERSIONS);
  vi.mocked(renameMap).mockReset().mockResolvedValue(undefined);
  vi.mocked(deleteMap).mockReset().mockResolvedValue(undefined);
  vi.mocked(deleteVersion).mockReset().mockResolvedValue(undefined);
  vi.mocked(setVersionName).mockReset().mockResolvedValue(undefined);
  vi.mocked(setVersionStarred).mockReset().mockResolvedValue(undefined);
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
    await waitFor(() => expect(onOpenVersion).toHaveBeenCalledWith(VERSIONS[1]));
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

    it('re-reads the list so the newly starred version sorts up', async () => {
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
   * The divider marks where the starred block ends. It hangs off the first
   * UNSTARRED row, so it collapses on its own at both degenerate ends.
   */
  describe('the starred divider', () => {
    // The dialog portals into document.body, so the render container is empty.
    const rowClasses = () => [...document.querySelectorAll('.version-row')].map((r) => r.className);

    it('marks the first unstarred row when a starred block sits above it', async () => {
      const user = userEvent.setup();
      renderDialog();
      await openCanalLine(user);
      await waitFor(() => expect(rowClasses()).toHaveLength(2));
      const classes = rowClasses();
      expect(classes[0]).not.toContain('after-starred'); // the starred one
      expect(classes[1]).toContain('after-starred');
    });

    /**
     * Three rows, TWO of them unstarred — the two-row fixture above cannot tell
     * "the first unstarred row" from "every unstarred row", because they are the
     * same row. A divider under every unstarred entry is just a list of boxes.
     */
    it('marks only the FIRST unstarred row, not every one below it', async () => {
      const user = userEvent.setup();
      vi.mocked(listVersions).mockResolvedValue([
        VERSIONS[0],
        VERSIONS[1],
        { ...VERSIONS[1], id: 8, version: 1, savedAt: Date.parse('2026-07-12T09:00:00Z') },
      ]);
      renderDialog();
      await openCanalLine(user);
      await waitFor(() => expect(rowClasses()).toHaveLength(3));
      const classes = rowClasses();
      expect(classes[0]).not.toContain('after-starred');
      expect(classes[1]).toContain('after-starred');
      expect(classes[2]).not.toContain('after-starred');
    });

    it('marks nothing when no version is starred', async () => {
      const user = userEvent.setup();
      vi.mocked(listVersions).mockResolvedValue(
        VERSIONS.map((v) => ({ ...v, starred: undefined })),
      );
      renderDialog();
      await openCanalLine(user);
      await waitFor(() => expect(rowClasses()).toHaveLength(2));
      expect(rowClasses().join(' ')).not.toContain('after-starred');
    });

    it('marks nothing when every version is starred', async () => {
      const user = userEvent.setup();
      vi.mocked(listVersions).mockResolvedValue(
        VERSIONS.map((v) => ({ ...v, starred: true as const })),
      );
      renderDialog();
      await openCanalLine(user);
      await waitFor(() => expect(rowClasses()).toHaveLength(2));
      expect(rowClasses().join(' ')).not.toContain('after-starred');
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
});
