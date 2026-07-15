import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Wholesale: jsdom has no indexedDB, so a partial mock would leave the real
// module reachable and fail on a ReferenceError instead of an assertion.
const libState = vi.hoisted(() => ({ current: null as string | null }));
vi.mock('../state/mapLibrary', () => ({
  listMaps: vi.fn(async () => []),
  listRevisions: vi.fn(async () => []),
  getPayload: vi.fn(async () => undefined),
  renameMap: vi.fn(async () => {}),
  deleteMap: vi.fn(async () => {}),
  deleteRevision: vi.fn(async () => {}),
  getCurrentMapId: vi.fn(() => libState.current),
  setCurrentMapId: vi.fn((id: string | null) => {
    libState.current = id;
  }),
}));

import { MapLibraryDialog } from './MapLibraryDialog';
import {
  listMaps,
  listRevisions,
  renameMap,
  deleteMap,
  deleteRevision,
  getCurrentMapId,
  setCurrentMapId,
  type MapSummary,
  type RevisionMeta,
} from '../state/mapLibrary';
import { useDoc } from '../state/store';
import { DEFAULT_DOC } from '../model/transforms';

const MAPS: MapSummary[] = [
  { id: 'm1', name: 'Canal Line', updatedAt: Date.parse('2026-07-14T10:00:00Z'), revisionCount: 2 },
  { id: 'm2', name: 'Broadway', updatedAt: Date.parse('2026-07-13T10:00:00Z'), revisionCount: 1 },
];

const REVS: RevisionMeta[] = [
  { id: 7, mapId: 'm1', savedAt: Date.parse('2026-07-14T10:00:00Z'), source: 'user' },
  { id: 6, mapId: 'm1', savedAt: Date.parse('2026-07-13T09:00:00Z'), source: 'auto' },
];

const onClose = vi.fn();
const onOpenRevision = vi.fn(async () => {});

const renderDialog = () =>
  render(<MapLibraryDialog onClose={onClose} onOpenRevision={onOpenRevision} />);

beforeEach(() => {
  libState.current = null;
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  vi.mocked(listMaps).mockReset().mockResolvedValue(MAPS);
  vi.mocked(listRevisions).mockReset().mockResolvedValue(REVS);
  vi.mocked(renameMap).mockReset().mockResolvedValue(undefined);
  vi.mocked(deleteMap).mockReset().mockResolvedValue(undefined);
  vi.mocked(deleteRevision).mockReset().mockResolvedValue(undefined);
  vi.mocked(getCurrentMapId).mockClear();
  vi.mocked(setCurrentMapId).mockClear();
  onClose.mockClear();
  onOpenRevision.mockClear();
});

describe('MapLibraryDialog', () => {
  it('lists maps, and a selected map’s revisions with their source tags', async () => {
    const user = userEvent.setup();
    renderDialog();
    await screen.findByText('Canal Line');
    expect(screen.getByText('Broadway')).toBeInTheDocument();
    expect(screen.getByText(/2 revisions/)).toBeInTheDocument();
    expect(screen.getByText(/1 revision ·/)).toBeInTheDocument(); // not "1 revisions"

    await user.click(screen.getByText('Canal Line'));
    await waitFor(() => expect(listRevisions).toHaveBeenCalledWith('m1'));
    const revisions = screen.getByRole('region', { name: 'Revisions' });
    expect(within(revisions).getByText('user')).toBeInTheDocument();
    expect(within(revisions).getByText('auto')).toBeInTheDocument();
  });

  it('opens a revision through the caller', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(await screen.findByText('Canal Line'));
    const opens = await screen.findAllByRole('button', { name: /Open revision/ });
    await user.click(opens[0]);
    await waitFor(() => expect(onOpenRevision).toHaveBeenCalledWith('m1', 7));
  });

  it('shows a failed open inside the dialog and keeps it mounted', async () => {
    const user = userEvent.setup();
    onOpenRevision.mockRejectedValue(new Error('Not valid JSON: Unexpected token'));
    renderDialog();
    await user.click(await screen.findByText('Canal Line'));
    const opens = await screen.findAllByRole('button', { name: /Open revision/ });
    await user.click(opens[0]);
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
    await user.click(await screen.findByText('Canal Line'));
    await waitFor(() => expect(listRevisions).toHaveBeenCalled());

    // One click arms; it does NOT delete.
    await user.click(screen.getByRole('button', { name: 'Delete Canal Line' }));
    expect(deleteMap).not.toHaveBeenCalled();

    vi.mocked(listMaps).mockResolvedValue([MAPS[1]]);
    await user.click(screen.getByRole('button', { name: 'Sure?' }));
    await waitFor(() => expect(deleteMap).toHaveBeenCalledWith('m1'));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Canal Line')).toBeNull());
    expect(screen.getByText('Broadway')).toBeInTheDocument();
    // The right column must not keep rendering a dead map's revisions.
    expect(screen.getByText('Select a map to see its revisions.')).toBeInTheDocument();
  });

  /**
   * Without this, the stale pointer resurrects the map: saveRevision's write to
   * the maps store is an upsert, so the next save re-creates the row we deleted.
   */
  it('clears the current-map pointer when the current map is deleted', async () => {
    const user = userEvent.setup();
    libState.current = 'm1';
    renderDialog();
    await screen.findByText('Canal Line');
    await user.click(screen.getByRole('button', { name: 'Delete Canal Line' }));
    await user.click(screen.getByRole('button', { name: 'Sure?' }));
    await waitFor(() => expect(setCurrentMapId).toHaveBeenCalledWith(null));
  });

  it('leaves the pointer alone when a different map is deleted', async () => {
    const user = userEvent.setup();
    libState.current = 'm2';
    renderDialog();
    await screen.findByText('Canal Line');
    await user.click(screen.getByRole('button', { name: 'Delete Canal Line' }));
    await user.click(screen.getByRole('button', { name: 'Sure?' }));
    await waitFor(() => expect(deleteMap).toHaveBeenCalledWith('m1'));
    expect(setCurrentMapId).not.toHaveBeenCalled();
  });

  it('deletes a single revision behind the same two-step', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(await screen.findByText('Canal Line'));
    const dels = await screen.findAllByRole('button', { name: /Delete revision/ });
    await user.click(dels[0]);
    expect(deleteRevision).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Sure?' }));
    await waitFor(() => expect(deleteRevision).toHaveBeenCalledWith(7));
  });

  /**
   * Both halves are required. #1 alone passes against an unconditional
   * setDocName, which would clobber the live title whenever any other map is
   * renamed — and an auto-save would then write the wrong name.
   */
  it('renaming the CURRENT map also renames the live document', async () => {
    const user = userEvent.setup();
    libState.current = 'm1';
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
    libState.current = 'm2';
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
    expect(screen.getByText('Select a map to see its revisions.')).toBeInTheDocument();
  });
});
