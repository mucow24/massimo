import { useCallback, useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as HoverCard from '@radix-ui/react-hover-card';
import * as Toggle from '@radix-ui/react-toggle';
import { Cross2Icon, StarIcon, StarFilledIcon } from '@radix-ui/react-icons';
import {
  deleteMap,
  deleteVersion,
  listMaps,
  listVersions,
  renameMap,
  setMapStarred,
  setVersionName,
  setVersionStarred,
  sortMaps,
  isMapSort,
  MAP_SORTS,
  type MapSort,
  type MapSummary,
  type VersionMeta,
} from '../state/mapLibrary';
import { useLibraryPointer } from '../state/libraryPointer';
import { useLibraryPrefs } from '../state/libraryPrefs';
import { markUnbacked } from '../state/saveBaseline';
import { useDoc } from '../state/store';
import { DialogSortSelect } from './dialogRow';

interface Props {
  onClose: () => void;
  /** Adopt a version over the live doc. Rejects with a message worth showing. */
  onOpenVersion: (version: VersionMeta) => Promise<void>;
}

const when = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

// The picker's wording, one entry per MAP_SORTS rung. Being a Record over the
// union is the exhaustiveness guard: a mode added to MapSort fails to compile
// until it is named here, and the picker then reads its order from the ladder.
const SORT_LABELS: Record<MapSort, string> = {
  updated: 'Last edited',
  created: 'Date created',
  name: 'Name',
};

/** Apply a column's star filter. Null (still loading) passes through. */
const starredOnly = <T extends { starred?: true }>(rows: T[] | null, on: boolean): T[] | null =>
  rows && on ? rows.filter((r) => r.starred) : rows;

/**
 * A column's star filter, in the head beside the list it filters, with the
 * state also in words: a filtered list of five where there were twelve is what
 * reads as a library that lost something, and the named empty message only
 * speaks when nothing at all survives.
 *
 * Field-shaped rather than the rows' bare star, because this one is a command
 * about the list rather than a mark on a row.
 *
 * Un-starring the last marked row while the filter is on takes that row out
 * from under the cursor. That is honest — it no longer matches — and library
 * writes are outside zundo, so the empty message is the whole of the
 * reassurance; it names the filter rather than claiming the list is empty.
 */
function StarFilterToggle({
  on,
  label,
  disabled,
  onToggle,
}: {
  on: boolean;
  label: string;
  disabled?: boolean;
  onToggle: (on: boolean) => void;
}) {
  return (
    <>
      {on && <span className="map-library-filter-note">starred only</span>}
      <Toggle.Root
        className={'map-library-filter' + (on ? ' active' : '')}
        pressed={on}
        disabled={disabled}
        onPressedChange={onToggle}
        aria-label={label}
        title={label}
      >
        {on ? <StarFilledIcon /> : <StarIcon />}
      </Toggle.Root>
    </>
  );
}

/**
 * A star as it appears in both columns: state first, command on approach.
 * A Radix Toggle for the pressed/unpressed contract; the caller supplies the
 * subject-specific labels.
 */
function StarToggle({
  starred,
  label,
  title,
  onToggle,
}: {
  starred: boolean;
  label: string;
  title: string;
  onToggle: () => void;
}) {
  return (
    <Toggle.Root
      className={'star-btn' + (starred ? ' starred' : '')}
      pressed={starred}
      onPressedChange={onToggle}
      aria-label={label}
      title={title}
    >
      {starred ? <StarFilledIcon /> : <StarIcon />}
    </Toggle.Root>
  );
}

/**
 * A row's thumbnail. Hovering it raises the stored capture (the row shows a
 * postage stamp; the raster is up to 480×360, shown at half size so the card
 * stays crisp on HiDPI) in a hover-card beside the row. Not portaled — the
 * card must stay inside `.app` for the design tokens and the dark-mode
 * reassignment to apply.
 */
function Thumb({ src }: { src?: string }) {
  if (!src) return <span className="map-thumb map-thumb-blank" aria-hidden="true" />;
  return (
    <HoverCard.Root openDelay={250} closeDelay={100}>
      <HoverCard.Trigger asChild>
        <img src={src} alt="" className="map-thumb" />
      </HoverCard.Trigger>
      <HoverCard.Content
        className="map-thumb-preview"
        side="right"
        sideOffset={12}
        collisionPadding={12}
      >
        <img src={src} alt="" />
      </HoverCard.Content>
    </HoverCard.Root>
  );
}

/**
 * The click-to-edit name field both columns use — a map's name on the left, a
 * version's on the right. Same interaction as {@link useInlineRename}, which
 * every other inline rename in the app runs on, but not that hook: a commit
 * here is ASYNC (it awaits IndexedDB and can raise the dialog's error line), and
 * Escape has to be kept out of the Dialog's own dismiss, which listens on
 * `document`. What it does share is the behaviour, which is the part a user
 * feels — entry selects the whole name, so typing replaces it; Enter and blur
 * commit; Escape cancels without a write.
 */
function RenameField({
  label,
  initial,
  placeholder,
  onCommit,
  onCancel,
}: {
  label: string;
  initial: string;
  placeholder?: string;
  onCommit: (draft: string) => void;
  onCancel: () => void;
}) {
  return (
    <input
      autoFocus
      aria-label={label}
      defaultValue={initial}
      placeholder={placeholder}
      onFocus={(e) => e.currentTarget.select()}
      // A row click selects the map; a click INSIDE its own name field must not.
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => onCommit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit(e.currentTarget.value);
        if (e.key === 'Escape') {
          e.stopPropagation();
          onCancel();
        }
      }}
    />
  );
}

/**
 * The library manager: maps on the left, the selected map's versions on the
 * right. Reached from Load → From library…, and the only place maps are renamed
 * or deleted — you never have to open a map to throw it away.
 *
 * A Radix Dialog (portaled into `.app` so the design tokens reach it), which
 * owns Escape, outside-click, and the focus trap.
 *
 * Deletes here are the one destructive action in the app that undo cannot
 * reach (IndexedDB is outside zundo), so they get a speed bump: the button
 * flips to "Sure?" in place. Not a modal on a modal — there is no confirmation
 * dialog anywhere in this app.
 */
export function MapLibraryDialog({ onClose, onOpenVersion }: Props) {
  // null means "still loading" — distinct from [], which means "no maps yet".
  // Collapsing the two flashes "No saved maps" on every open.
  const [maps, setMaps] = useState<MapSummary[] | null>(null);
  const [selectedMapId, setSelectedMapId] = useState<string | null>(null);
  /** Bumped to re-read the selected map's versions in place (see below). */
  const [versionsEpoch, setVersionsEpoch] = useState(0);
  const [versions, setVersions] = useState<VersionMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [namingVersionId, setNamingVersionId] = useState<number | null>(null);
  const sort = useLibraryPrefs((s) => s.sort);
  const setSort = useLibraryPrefs((s) => s.setSort);
  const starredMapsOnly = useLibraryPrefs((s) => s.starredMapsOnly);
  const setStarredMapsOnly = useLibraryPrefs((s) => s.setStarredMapsOnly);
  const starredVersionsOnly = useLibraryPrefs((s) => s.starredVersionsOnly);
  const setStarredVersionsOnly = useLibraryPrefs((s) => s.setStarredVersionsOnly);

  const refreshMaps = useCallback(async () => {
    try {
      setMaps(await listMaps());
    } catch {
      setMaps([]);
      setError('Could not read the map library.');
    }
  }, []);

  /**
   * Ask for a fresh read of the SELECTED map's versions — the map that is
   * selected when the effect below runs, never the one that was selected when
   * the caller started. A star, a name or a delete resolves after an await,
   * by which time the click that started it may have been followed by a click
   * on another map's row; naming the map here would paint one map's versions
   * under another map's heading, where Open and the non-undoable Delete then
   * act on them.
   *
   * Deliberately does NOT blank the list first, unlike `selectMap`: a star or
   * a name is an edit to a list you are looking at, and flashing "Loading…"
   * under your cursor for it reads as a glitch.
   */
  const refreshVersions = useCallback(() => setVersionsEpoch((n) => n + 1), []);

  // The versions read, owned by the selection rather than by whoever asked for
  // it. Re-runs on a new map or a bumped epoch, and the cleanup disowns the
  // read in flight — two readonly IndexedDB reads may run concurrently and
  // settle backwards, so the column takes rows only from its own read.
  useEffect(() => {
    if (selectedMapId === null) return;
    let live = true;
    void (async () => {
      try {
        const rows = await listVersions(selectedMapId);
        if (live) setVersions(rows);
      } catch {
        if (!live) return;
        setVersions([]);
        setError('Could not read that map’s versions.');
      }
    })();
    return () => {
      live = false;
    };
  }, [selectedMapId, versionsEpoch]);

  // The first read. Guarded rather than calling refreshMaps: the dialog can be
  // dismissed while listMaps() is still in flight.
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const rows = await listMaps();
        if (live) setMaps(rows);
      } catch {
        if (!live) return;
        setMaps([]);
        setError('Could not read the map library.');
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  // Blanks the list, so the column never shows the previous map's versions
  // while the read for the new one is out. The refresh is what fetches them —
  // and it is unconditional, because clicking the row you are already on
  // blanks the list just the same and would otherwise sit at "Loading…".
  const selectMap = (id: string) => {
    setSelectedMapId(id);
    setVersions(null);
    setConfirmKey(null);
    refreshVersions();
  };

  const onDeleteMap = async (id: string) => {
    setConfirmKey(null);
    try {
      await deleteMap(id);
    } catch {
      setError('Could not delete that map.');
      return;
    }
    // A stale pointer would resurrect the row: saveVersion's write to the maps
    // store is an upsert, so the very next save re-creates what we just deleted.
    // The baseline goes with it — the library no longer holds the live doc's
    // bytes, and anything still treating it as "already saved" would decline
    // to save a document that now exists nowhere else. Only the dialog knows:
    // upstream, a cleared pointer looks identical to opening a JSON file, and
    // that document is safe on disk.
    if (useLibraryPointer.getState().mapId === id) {
      useLibraryPointer.getState().setPointer(null, null);
      markUnbacked();
    }
    if (selectedMapId === id) {
      setSelectedMapId(null);
      setVersions(null);
    }
    await refreshMaps();
  };

  /**
   * Delete one version. The POINTER is deliberately left alone even when this
   * is the version the live document came from: the canvas still holds those
   * bytes, so "came from v32" stays true — v32 is merely no longer in the
   * library, and the map's counter has spent that number for good.
   *
   * The document's BACKING is a different question with the opposite answer.
   * Those bytes just stopped existing anywhere but the canvas, so the live doc
   * is now unbacked exactly as if its whole map had gone — one version deleted
   * is the same wipe as a map deleted, through a smaller door.
   */
  const onDeleteVersion = async (version: VersionMeta) => {
    setConfirmKey(null);
    try {
      await deleteVersion(version.id);
    } catch {
      setError('Could not delete that version.');
      return;
    }
    const pointer = useLibraryPointer.getState();
    if (pointer.mapId === version.mapId && pointer.version === version.version) markUnbacked();
    refreshVersions();
    await refreshMaps();
  };

  const onToggleStar = async (version: VersionMeta) => {
    try {
      await setVersionStarred(version.id, !version.starred);
    } catch {
      setError('Could not star that version.');
      return;
    }
    refreshVersions();
  };

  const onToggleMapStar = async (map: MapSummary) => {
    try {
      await setMapStarred(map.id, !map.starred);
    } catch {
      setError('Could not star that map.');
      return;
    }
    await refreshMaps();
  };

  const onCommitVersionName = async (versionId: number, name: string) => {
    setNamingVersionId(null);
    try {
      // Not trimmed or emptiness-checked here: a blank name is how you CLEAR
      // one, and the library owns that rule.
      await setVersionName(versionId, name);
    } catch {
      setError('Could not name that version.');
      return;
    }
    refreshVersions();
  };

  const onCommitRename = async (id: string, name: string) => {
    setRenamingId(null);
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await renameMap(id, trimmed);
    } catch {
      setError('Could not rename that map.');
      return;
    }
    // Keep the live title and the library row from diverging: an auto-save
    // passes doc.name, so a diverged rename would be silently reverted by the
    // next document switch.
    if (useLibraryPointer.getState().mapId === id) useDoc.getState().setDocName(trimmed);
    await refreshMaps();
  };

  const onOpen = async (version: VersionMeta) => {
    setError(null);
    try {
      await onOpenVersion(version);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open that version.');
    }
  };

  const deleteButton = (key: string, label: string, run: () => void) =>
    confirmKey === key ? (
      <button type="button" className="danger" onClick={run}>
        Sure?
      </button>
    ) : (
      <button type="button" aria-label={label} onClick={() => setConfirmKey(key)}>
        Delete
      </button>
    );

  const sortedMaps = maps === null ? null : sortMaps(maps, sort);
  // The selected map is looked up BEFORE the filter: the right column answers
  // for the map you clicked, so filtering its row out of the left column must
  // not blank the versions beside it.
  const selectedMap = sortedMaps?.find((m) => m.id === selectedMapId) ?? null;
  const visibleMaps = starredOnly(sortedMaps, starredMapsOnly);
  const visibleVersions = starredOnly(versions, starredVersionsOnly);

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {/* `.app` is absent in standalone component tests; Radix then portals to
          document.body, exactly as the hand-rolled portal did. */}
      <Dialog.Portal container={document.querySelector<HTMLElement>('.app') ?? undefined}>
        <Dialog.Overlay className="dialog-backdrop">
          <Dialog.Content
            className="dialog map-library"
            aria-describedby={undefined}
            onEscapeKeyDown={(e) => {
              // Mid-rename, Escape belongs to the input (which cancels the
              // edit); keep the dialog out of that keypress.
              if (renamingId !== null || namingVersionId !== null) e.preventDefault();
            }}
          >
            <header>
              <Dialog.Title asChild>
                <h2>Map library</h2>
              </Dialog.Title>
              <Dialog.Close asChild>
                <button type="button" className="dialog-close" aria-label="Close map library">
                  <Cross2Icon />
                </button>
              </Dialog.Close>
            </header>

            {error && (
              <div role="alert" className="dialog-error">
                {error}
              </div>
            )}

            <div className="dialog-columns">
              <section className="map-library-maps" aria-label="Saved maps">
                <div className="dialog-colhead">
                  <h3>Maps</h3>
                  <div className="dialog-colhead-controls">
                    <StarFilterToggle
                      on={starredMapsOnly}
                      label="Show starred maps only"
                      onToggle={setStarredMapsOnly}
                    />
                    <DialogSortSelect
                      value={sort}
                      sorts={MAP_SORTS}
                      labels={SORT_LABELS}
                      isSort={isMapSort}
                      onChange={setSort}
                      ariaLabel="Sort maps"
                      className="map-library-sort"
                    />
                  </div>
                </div>
                <div className="dialog-list">
                  {visibleMaps === null && <div className="empty">Loading…</div>}
                  {visibleMaps?.length === 0 && (
                    <div className="empty">
                      {starredMapsOnly ? 'No starred maps.' : 'No saved maps yet.'}
                    </div>
                  )}
                  {visibleMaps?.map((m) => (
                    <div
                      key={m.id}
                      className={'dialog-row map-row' + (m.id === selectedMapId ? ' selected' : '')}
                      onClick={() => selectMap(m.id)}
                    >
                      <Thumb src={m.thumb} />
                      <div className="dialog-row-body">
                        {renamingId === m.id ? (
                          <RenameField
                            label={`Rename ${m.name}`}
                            initial={m.name}
                            onCommit={(draft) => void onCommitRename(m.id, draft)}
                            onCancel={() => setRenamingId(null)}
                          />
                        ) : (
                          <strong>{m.name}</strong>
                        )}
                        <span className="dialog-row-meta">
                          {m.versionCount} version{m.versionCount === 1 ? '' : 's'} ·{' '}
                          {when(m.updatedAt)}
                        </span>
                      </div>
                      <div className="dialog-row-actions" onClick={(e) => e.stopPropagation()}>
                        <StarToggle
                          starred={m.starred ?? false}
                          label={`${m.starred ? 'Unstar' : 'Star'} ${m.name}`}
                          title={
                            m.starred
                              ? 'Starred — kept by the star filter above'
                              : 'Star this map — the star filter above keeps it'
                          }
                          onToggle={() => void onToggleMapStar(m)}
                        />
                        <button
                          type="button"
                          aria-label={`Rename ${m.name}`}
                          onClick={() => setRenamingId(m.id)}
                        >
                          Rename
                        </button>
                        {deleteButton(
                          `map:${m.id}`,
                          `Delete ${m.name}`,
                          () => void onDeleteMap(m.id),
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="map-library-versions" aria-label="Versions">
                <div className="dialog-colhead">
                  <h3>{selectedMap ? selectedMap.name : 'Versions'}</h3>
                  <div className="dialog-colhead-controls">
                    {/* Nothing to filter until a map is chosen, and the flag is
                        persisted — a press over an empty column would write a
                        preference you never see take effect. */}
                    <StarFilterToggle
                      on={starredVersionsOnly}
                      label="Show starred versions only"
                      disabled={selectedMapId === null}
                      onToggle={setStarredVersionsOnly}
                    />
                  </div>
                </div>
                <div className="dialog-list">
                  {selectedMapId === null && (
                    <div className="empty">Select a map to see its versions.</div>
                  )}
                  {selectedMapId !== null && visibleVersions === null && (
                    <div className="empty">Loading…</div>
                  )}
                  {visibleVersions?.length === 0 && (
                    <div className="empty">
                      {starredVersionsOnly ? 'No starred versions.' : 'No versions.'}
                    </div>
                  )}
                  {visibleVersions?.map((r) => (
                    <div key={r.id} className="dialog-row version-row">
                      <Thumb src={r.thumb} />
                      <div className="dialog-row-body">
                        {namingVersionId === r.id ? (
                          <RenameField
                            label={`Name version ${r.version}`}
                            initial={r.name ?? ''}
                            placeholder="beta 1 — needs work"
                            onCommit={(draft) => void onCommitVersionName(r.id, draft)}
                            onCancel={() => setNamingVersionId(null)}
                          />
                        ) : (
                          <span className="version-row-title">
                            <strong className="version-number">v{r.version}</strong>
                            {r.name && <span className="version-name">{r.name}</span>}
                          </span>
                        )}
                        <span className="dialog-row-meta">
                          <span className="version-source">{r.source}</span> · {when(r.savedAt)}
                        </span>
                      </div>
                      <div className="dialog-row-actions">
                        <StarToggle
                          starred={r.starred ?? false}
                          label={`${r.starred ? 'Unstar' : 'Star'} version ${r.version}`}
                          title={
                            r.starred
                              ? 'Starred — never pruned, and kept by the star filter'
                              : 'Star this version — safe from pruning, and kept by the star filter'
                          }
                          onToggle={() => void onToggleStar(r)}
                        />
                        <button
                          type="button"
                          aria-label={`Name version ${r.version}`}
                          onClick={() => setNamingVersionId(r.id)}
                        >
                          Name
                        </button>
                        <button
                          type="button"
                          aria-label={`Open version ${r.version}`}
                          onClick={() => void onOpen(r)}
                        >
                          Open
                        </button>
                        {deleteButton(
                          `ver:${r.id}`,
                          `Delete version ${r.version}`,
                          () => void onDeleteVersion(r),
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
