import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  deleteMap,
  deleteRevision,
  getCurrentMapId,
  listMaps,
  listRevisions,
  renameMap,
  setCurrentMapId,
  type MapSummary,
  type RevisionMeta,
} from '../state/mapLibrary';
import { useDoc } from '../state/store';
import { useDismiss } from './usePopover';

interface Props {
  onClose: () => void;
  /** Adopt a revision over the live doc. Rejects with a message worth showing. */
  onOpenRevision: (mapId: string, revisionId: number) => Promise<void>;
}

const when = (ms: number) => new Date(ms).toLocaleString();

/**
 * The library manager: maps on the left, the selected map's revisions on the
 * right. Reached from Load → From library…, and the only place maps are renamed
 * or deleted — you never have to open a map to throw it away.
 *
 * Deletes here are the one destructive action in the app that undo cannot
 * reach (IndexedDB is outside zundo), so they get a speed bump: the button
 * flips to "Sure?" in place. Not a modal — there is no confirmation dialog
 * anywhere in this app, and a second layer would mean two Escape listeners
 * racing over one keypress.
 */
export function MapLibraryDialog({ onClose, onOpenRevision }: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  // null means "still loading" — distinct from [], which means "no maps yet".
  // Collapsing the two flashes "No saved maps" on every open.
  const [maps, setMaps] = useState<MapSummary[] | null>(null);
  const [selectedMapId, setSelectedMapId] = useState<string | null>(null);
  const [revisions, setRevisions] = useState<RevisionMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);

  useDismiss(true, onClose, [panelRef]);

  const refreshMaps = useCallback(async () => {
    try {
      setMaps(await listMaps());
    } catch {
      setMaps([]);
      setError('Could not read the map library.');
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
    setRevisions(null);
    setConfirmKey(null);
    try {
      setRevisions(await listRevisions(id));
    } catch {
      setRevisions([]);
      setError('Could not read that map’s revisions.');
    }
  };

  const onDeleteMap = async (id: string) => {
    setConfirmKey(null);
    try {
      await deleteMap(id);
    } catch {
      setError('Could not delete that map.');
      return;
    }
    // A stale pointer would resurrect the row: saveRevision's write to the maps
    // store is an upsert, so the very next save re-creates what we just deleted.
    if (getCurrentMapId() === id) setCurrentMapId(null);
    if (selectedMapId === id) {
      setSelectedMapId(null);
      setRevisions(null);
    }
    await refreshMaps();
  };

  const onDeleteRevision = async (revisionId: number) => {
    setConfirmKey(null);
    try {
      await deleteRevision(revisionId);
    } catch {
      setError('Could not delete that revision.');
      return;
    }
    if (selectedMapId) await selectMap(selectedMapId);
    await refreshMaps();
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
    if (getCurrentMapId() === id) useDoc.getState().setDocName(trimmed);
    await refreshMaps();
  };

  const onOpen = async (mapId: string, revisionId: number) => {
    setError(null);
    try {
      await onOpenRevision(mapId, revisionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open that revision.');
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

  const panel = (
    <div className="map-library-backdrop">
      <div
        className="map-library"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Map library"
      >
        <header>
          <h2>Map library</h2>
          <button type="button" aria-label="Close map library" onClick={onClose}>
            Close
          </button>
        </header>

        {error && (
          <div role="alert" className="map-library-error">
            {error}
          </div>
        )}

        <div className="map-library-columns">
          <section className="map-library-maps" aria-label="Saved maps">
            {maps === null && <div className="empty">Loading…</div>}
            {maps?.length === 0 && <div className="empty">No saved maps yet.</div>}
            {maps?.map((m) => (
              <div
                key={m.id}
                className={'map-row' + (m.id === selectedMapId ? ' selected' : '')}
                onClick={() => void selectMap(m.id)}
              >
                {m.thumb ? (
                  <img src={m.thumb} alt="" className="map-thumb" />
                ) : (
                  <span className="map-thumb map-thumb-blank" aria-hidden="true" />
                )}
                <div className="map-row-body">
                  {renamingId === m.id ? (
                    <input
                      autoFocus
                      aria-label={`Rename ${m.name}`}
                      defaultValue={m.name}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={(e) => void onCommitRename(m.id, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void onCommitRename(m.id, e.currentTarget.value);
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
                    {m.revisionCount} revision{m.revisionCount === 1 ? '' : 's'} ·{' '}
                    {when(m.updatedAt)}
                  </span>
                </div>
                <div className="map-row-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    aria-label={`Rename ${m.name}`}
                    onClick={() => setRenamingId(m.id)}
                  >
                    Rename
                  </button>
                  {deleteButton(`map:${m.id}`, `Delete ${m.name}`, () => void onDeleteMap(m.id))}
                </div>
              </div>
            ))}
          </section>

          <section className="map-library-revisions" aria-label="Revisions">
            {selectedMapId === null && (
              <div className="empty">Select a map to see its revisions.</div>
            )}
            {selectedMapId !== null && revisions === null && <div className="empty">Loading…</div>}
            {revisions?.length === 0 && <div className="empty">No revisions.</div>}
            {revisions?.map((r) => (
              <div key={r.id} className="revision-row">
                {r.thumb ? (
                  <img src={r.thumb} alt="" className="map-thumb" />
                ) : (
                  <span className="map-thumb map-thumb-blank" aria-hidden="true" />
                )}
                <div className="map-row-body">
                  <span>{when(r.savedAt)}</span>
                  <span className="revision-source">{r.source}</span>
                </div>
                <div className="map-row-actions">
                  <button
                    type="button"
                    aria-label={`Open revision from ${when(r.savedAt)}`}
                    onClick={() => void onOpen(r.mapId, r.id)}
                  >
                    Open
                  </button>
                  {deleteButton(
                    `rev:${r.id}`,
                    `Delete revision from ${when(r.savedAt)}`,
                    () => void onDeleteRevision(r.id),
                  )}
                </div>
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  );

  // `.app` is absent in standalone component tests, and React throws on a null
  // container.
  return createPortal(panel, document.querySelector('.app') ?? document.body);
}
