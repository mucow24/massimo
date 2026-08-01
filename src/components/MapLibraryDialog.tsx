import { useCallback, useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as HoverCard from '@radix-ui/react-hover-card';
import * as Select from '@radix-ui/react-select';
import * as Toggle from '@radix-ui/react-toggle';
import { ChevronDownIcon, Cross2Icon, StarIcon, StarFilledIcon } from '@radix-ui/react-icons';
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
  type MapSort,
  type MapSummary,
  type VersionMeta,
} from '../state/mapLibrary';
import { useLibraryPointer } from '../state/libraryPointer';
import { useLibraryPrefs } from '../state/libraryPrefs';
import { markUnbacked } from '../state/saveBaseline';
import { useDoc } from '../state/store';

interface Props {
  onClose: () => void;
  /** Adopt a version over the live doc. Rejects with a message worth showing. */
  onOpenVersion: (version: VersionMeta) => Promise<void>;
}

const when = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const SORT_LABELS: { value: MapSort; label: string }[] = [
  { value: 'updated', label: 'Last edited' },
  { value: 'created', label: 'Date created' },
  { value: 'name', label: 'Name' },
];

const isMapSort = (v: string): v is MapSort => v === 'updated' || v === 'created' || v === 'name';

/** Apply a column's star filter. Null (still loading) passes through. */
const starredOnly = <T extends { starred?: true }>(rows: T[] | null, on: boolean): T[] | null =>
  rows && on ? rows.filter((r) => r.starred) : rows;

/**
 * A column's star filter, in the head beside the list it filters.
 *
 * Field-shaped rather than the rows' bare star: this one is a command about
 * the list, and it has to read as pressed from across the dialog — a short
 * list is otherwise indistinguishable from a lost one.
 */
function StarFilterToggle({
  on,
  label,
  onToggle,
}: {
  on: boolean;
  label: string;
  onToggle: (on: boolean) => void;
}) {
  return (
    <Toggle.Root
      className={'map-library-filter' + (on ? ' active' : '')}
      pressed={on}
      onPressedChange={onToggle}
      aria-label={label}
      title={label}
    >
      {on ? <StarFilledIcon /> : <StarIcon />}
    </Toggle.Root>
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
 * A row's thumbnail. Hovering it raises the stored capture at full size (the
 * row shows a postage stamp; the raster is up to 240×180) in a hover-card
 * beside the row. Not portaled — the card must stay inside `.app` for the
 * design tokens and the dark-mode reassignment to apply.
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
   * Re-read the open map's versions in place. Separate from `selectMap`, which
   * blanks the list first: a star or a name is an edit to a list you are
   * looking at, and flashing "Loading…" under your cursor for it reads as a
   * glitch.
   */
  const refreshVersions = useCallback(async (mapId: string) => {
    try {
      setVersions(await listVersions(mapId));
    } catch {
      setVersions([]);
      setError('Could not read that map’s versions.');
    }
  }, []);

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

  const selectMap = async (id: string) => {
    setSelectedMapId(id);
    setVersions(null);
    setConfirmKey(null);
    await refreshVersions(id);
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
    if (selectedMapId) await refreshVersions(selectedMapId);
    await refreshMaps();
  };

  const onToggleStar = async (version: VersionMeta) => {
    try {
      await setVersionStarred(version.id, !version.starred);
    } catch {
      setError('Could not star that version.');
      return;
    }
    if (selectedMapId) await refreshVersions(selectedMapId);
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
    if (selectedMapId) await refreshVersions(selectedMapId);
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
        <Dialog.Overlay className="map-library-backdrop">
          <Dialog.Content
            className="map-library"
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
                <button type="button" className="map-library-close" aria-label="Close map library">
                  <Cross2Icon />
                </button>
              </Dialog.Close>
            </header>

            {error && (
              <div role="alert" className="map-library-error">
                {error}
              </div>
            )}

            <div className="map-library-columns">
              <section className="map-library-maps" aria-label="Saved maps">
                <div className="map-library-colhead">
                  <h3>Maps</h3>
                  <div className="map-library-colhead-controls">
                    <StarFilterToggle
                      on={starredMapsOnly}
                      label="Show starred maps only"
                      onToggle={setStarredMapsOnly}
                    />
                    <Select.Root
                      value={sort}
                      onValueChange={(v) => {
                        if (isMapSort(v)) setSort(v);
                      }}
                    >
                      <Select.Trigger
                        className="field-select map-library-sort"
                        aria-label="Sort maps"
                      >
                        <Select.Value />
                        <Select.Icon className="field-select-caret" aria-hidden="true">
                          <ChevronDownIcon />
                        </Select.Icon>
                      </Select.Trigger>
                      <Select.Content
                        className="field-select-panel"
                        position="popper"
                        sideOffset={4}
                        align="end"
                      >
                        <Select.Viewport>
                          {SORT_LABELS.map((s) => (
                            <Select.Item
                              key={s.value}
                              value={s.value}
                              className="field-select-item"
                            >
                              <Select.ItemText>{s.label}</Select.ItemText>
                            </Select.Item>
                          ))}
                        </Select.Viewport>
                      </Select.Content>
                    </Select.Root>
                  </div>
                </div>
                <div className="map-library-list">
                  {visibleMaps === null && <div className="empty">Loading…</div>}
                  {visibleMaps?.length === 0 && (
                    <div className="empty">
                      {starredMapsOnly ? 'No starred maps.' : 'No saved maps yet.'}
                    </div>
                  )}
                  {visibleMaps?.map((m) => (
                    <div
                      key={m.id}
                      className={'map-row' + (m.id === selectedMapId ? ' selected' : '')}
                      onClick={() => void selectMap(m.id)}
                    >
                      <Thumb src={m.thumb} />
                      <div className="map-row-body">
                        {renamingId === m.id ? (
                          <input
                            autoFocus
                            aria-label={`Rename ${m.name}`}
                            defaultValue={m.name}
                            onClick={(e) => e.stopPropagation()}
                            onBlur={(e) => void onCommitRename(m.id, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter')
                                void onCommitRename(m.id, e.currentTarget.value);
                              // Escape cancels the rename without closing the dialog.
                              if (e.key === 'Escape') {
                                e.stopPropagation();
                                setRenamingId(null);
                              }
                            }}
                          />
                        ) : (
                          <strong>{m.name}</strong>
                        )}
                        <span className="map-row-meta">
                          {m.versionCount} version{m.versionCount === 1 ? '' : 's'} ·{' '}
                          {when(m.updatedAt)}
                        </span>
                      </div>
                      <div className="map-row-actions" onClick={(e) => e.stopPropagation()}>
                        <StarToggle
                          starred={m.starred ?? false}
                          label={`${m.starred ? 'Unstar' : 'Star'} ${m.name}`}
                          title={
                            m.starred
                              ? 'Starred — kept by the head’s star filter'
                              : 'Star this map: the head’s star filter keeps it'
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
                <div className="map-library-colhead">
                  <h3>{selectedMap ? selectedMap.name : 'Versions'}</h3>
                  <StarFilterToggle
                    on={starredVersionsOnly}
                    label="Show starred versions only"
                    onToggle={setStarredVersionsOnly}
                  />
                </div>
                <div className="map-library-list">
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
                    <div key={r.id} className="version-row">
                      <Thumb src={r.thumb} />
                      <div className="map-row-body">
                        {namingVersionId === r.id ? (
                          <input
                            autoFocus
                            aria-label={`Name version ${r.version}`}
                            defaultValue={r.name ?? ''}
                            placeholder="beta 1 — needs work"
                            onBlur={(e) => void onCommitVersionName(r.id, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter')
                                void onCommitVersionName(r.id, e.currentTarget.value);
                              if (e.key === 'Escape') {
                                e.stopPropagation();
                                setNamingVersionId(null);
                              }
                            }}
                          />
                        ) : (
                          <span className="version-row-title">
                            <strong className="version-number">v{r.version}</strong>
                            {r.name && <span className="version-name">{r.name}</span>}
                          </span>
                        )}
                        <span className="map-row-meta">
                          <span className="version-source">{r.source}</span> · {when(r.savedAt)}
                        </span>
                      </div>
                      <div className="map-row-actions">
                        <StarToggle
                          starred={r.starred ?? false}
                          label={`${r.starred ? 'Unstar' : 'Star'} version ${r.version}`}
                          title={
                            r.starred
                              ? 'Starred — never pruned, and kept by the star filter'
                              : 'Star this version: safe from pruning, and kept by the filter'
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
