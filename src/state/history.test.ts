import { describe, it, expect, beforeEach } from 'vitest';
import { pushHistory, historyDepth, redoDepth, undo, redo } from './history';
import { useDoc, pickDocSnapshot, HISTORY_LIMIT } from './store';
import type { DocSnapshot } from './store';
import { DEFAULT_DOC } from '../model/transforms';

describe('pushHistory — undo-stack cap', () => {
  let snap: DocSnapshot;

  beforeEach(() => {
    useDoc.temporal.getState().clear();
    snap = pickDocSnapshot(useDoc.getState());
  });

  it('caps the grouped-edit undo stack at HISTORY_LIMIT, discarding the oldest', () => {
    // zundo only enforces `limit` inside its own set-handler; the grouped path
    // goes through pushHistory's manual `.slice`, so this cap is the ONLY thing
    // bounding it. Push well past the limit and confirm it stops growing.
    for (let i = 0; i < HISTORY_LIMIT + 25; i++) pushHistory(snap);
    expect(historyDepth()).toBe(HISTORY_LIMIT);
  });

  it('wipes the redo stack on a fresh push', () => {
    // Seed a redo entry, then push: the new action must clear the redo future,
    // mirroring zundo's default handler.
    useDoc.temporal.setState({ futureStates: [snap] });
    expect(redoDepth()).toBe(1);
    pushHistory(snap);
    expect(redoDepth()).toBe(0);
  });
});

describe('undo / redo — persistence flush', () => {
  // zundo applies undo/redo through the raw `set` it captured, which sits ABOVE
  // persist in the temporal(persist(...)) chain — so the reverted state never
  // reaches persist's storage writer. Without an explicit flush, the stored
  // blob keeps the pre-undo edit and a refresh resurrects it (edit → Ctrl+Z →
  // reload brings the edit back). These assert the persisted bytes track undo.
  const KEY = 'vignelli-map-doc-v1';
  const persistedName = (): unknown => {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw).state?.name as unknown) : undefined;
  };

  beforeEach(() => {
    useDoc.setState({ ...DEFAULT_DOC });
    useDoc.temporal.getState().clear();
    localStorage.clear();
  });

  it('undo writes the reverted doc through to localStorage', () => {
    // A normal edit persists the way it always has.
    useDoc.getState().setDocName('Edited');
    expect(persistedName()).toBe('Edited');
    expect(historyDepth()).toBe(1);

    undo();

    // In-memory the edit is gone — and the stored blob must reflect it too.
    expect(useDoc.getState().name).toBe(DEFAULT_DOC.name);
    expect(persistedName()).toBe(DEFAULT_DOC.name);
  });

  it('redo writes the reapplied doc through to localStorage', () => {
    useDoc.getState().setDocName('Edited');
    undo();
    // Wipe the blob so this isolates REDO's own write — not a value an earlier
    // persist left behind.
    localStorage.removeItem(KEY);

    redo();

    expect(useDoc.getState().name).toBe('Edited');
    expect(persistedName()).toBe('Edited');
  });

  it('leaves the redo stack intact after an undo (flush records no history)', () => {
    // The flush must be a true no-op to the temporal store: a redundant write
    // would clear the redo future (breaking redo-after-undo) and push a stray
    // undo entry. Guarded by temporal's `equality` on an unchanged snapshot.
    useDoc.getState().setDocName('Edited');
    undo();
    expect(redoDepth()).toBe(1);
    expect(historyDepth()).toBe(0);
  });
});
