import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

/**
 * The baseline across a DIRTY refresh: reload with unsaved edits and the
 * recorded hash no longer matches the rehydrated doc, so bootBaselineState
 * leaves the baseline unset — but when the baseline was `backed`, its exact
 * bytes still sit in the library under the version the pointer names, and the
 * boot recovery must fetch them back so Revert has its target again.
 *
 * Each test simulates real page loads: `boot()` re-imports the state modules
 * with `vi.resetModules()`, so persist rehydration, bootBaselineState and the
 * recovery kick-off all run exactly as they do in the app. localStorage and
 * the fake-indexeddb factory survive the "reload", the module registry does
 * not — the same split a browser refresh makes.
 */

interface Boot {
  store: typeof import('./store');
  sb: typeof import('./saveBaseline');
  lp: typeof import('./libraryPointer');
  lib: typeof import('./mapLibrary');
  hist: typeof import('./history');
  ser: typeof import('../model/serialize');
  tab: typeof import('./mapTab');
}

const boot = async (): Promise<Boot> => {
  // A real reload fires pagehide first, which flushes the store's debounced
  // localStorage write (store.ts). The jsdom window — and the previous boot's
  // listeners on it — survive vi.resetModules(), so dispatching the event here
  // gives the outgoing module instance the same last-write a browser would.
  window.dispatchEvent(new window.Event('pagehide'));
  vi.resetModules();
  return {
    store: await import('./store'),
    sb: await import('./saveBaseline'),
    lp: await import('./libraryPointer'),
    lib: await import('./mapLibrary'),
    hist: await import('./history'),
    ser: await import('../model/serialize'),
    tab: await import('./mapTab'),
  };
};

beforeEach(() => {
  // A brand-new universe of databases per test; NOT deleteDatabase, which
  // fires `versionchange` at connections cached by earlier imports and hangs
  // in `blocked` (see mapLibrary.test.ts).
  globalThis.indexedDB = new IDBFactory();
  globalThis.IDBKeyRange = IDBKeyRange as unknown as typeof globalThis.IDBKeyRange;
  localStorage.clear();
  // The tab is on map m1 throughout — the map every save below writes under.
  window.history.replaceState(null, '', '#map=m1');
});

const statusNow = (m: Boot) =>
  m.sb.saveStatusOf(m.store.useDoc.getState(), m.sb.useSaveBaseline.getState());
const canRevertNow = (m: Boot) =>
  m.sb.canRevertTo(m.store.useDoc.getState(), m.sb.useSaveBaseline.getState());

/** Save to the library exactly as Toolbar's onSaveToLibrary does: write the
 *  version, move the pointer, anchor the baseline. */
const saveToLibrary = async (m: Boot, mapId: string) => {
  const doc = m.store.useDoc.getState();
  const snap = m.store.pickDocSnapshot(doc);
  const json = m.ser.serialize(snap);
  const saved = await m.lib.saveVersion(mapId, doc.name, json, 'user');
  m.lp.useLibraryPointer.getState().setPointer(mapId, saved.version);
  m.sb.markSaved(json, snap);
  return { ...saved, json };
};

describe('bootRecovery — the Revert target across a dirty refresh', () => {
  it('recovers the baseline from the pointed library version', async () => {
    const m1 = await boot();
    m1.store.useDoc.getState().addStation(0, 0);
    const saved = await saveToLibrary(m1, 'm1');
    m1.store.useDoc.getState().addStation(100, 0); // unsaved work the reload keeps

    const m2 = await boot();
    await m2.sb.bootRecovery;

    // The doc is still dirty — the edit really did survive — but Revert has
    // its target back: the exact bytes of the saved version.
    expect(statusNow(m2)).toBe('dirty');
    expect(canRevertNow(m2)).toBe(true);
    expect(m2.sb.useSaveBaseline.getState().baselineJson).toBe(saved.json);
    expect(m2.sb.useSaveBaseline.getState().backed).toBe(true);
  });

  it('reverting after the recovery lands on the saved doc, undoably', async () => {
    const m1 = await boot();
    m1.store.useDoc.getState().addStation(0, 0);
    const saved = await saveToLibrary(m1, 'm1');
    m1.store.useDoc.getState().addStation(100, 0);

    const m2 = await boot();
    await m2.sb.bootRecovery;

    // Revert, the way Toolbar's onRevert does.
    const baseline = m2.sb.useSaveBaseline.getState().baselineSnap;
    expect(baseline).not.toBeNull();
    m2.store.useDoc.getState().loadDoc(baseline!);
    expect(statusNow(m2)).toBe('clean');
    expect(m2.ser.serialize(m2.store.pickDocSnapshot(m2.store.useDoc.getState()))).toBe(saved.json);

    // Still a normal undoable edit: Ctrl+Z brings the discarded work back.
    m2.hist.undo();
    expect(statusNow(m2)).toBe('dirty');
    expect(Object.keys(m2.store.useDoc.getState().stations)).toHaveLength(2);
  });

  it('declines when the recorded baseline was not backed by the library', async () => {
    const m1 = await boot();
    m1.store.useDoc.getState().addStation(0, 0);
    await saveToLibrary(m1, 'm1');
    // A file adoption over a still-set pointer: the record's bytes are not the
    // library's, and `backed: false` says so.
    const snap = m1.store.pickDocSnapshot(m1.store.useDoc.getState());
    m1.sb.markAdopted(m1.ser.serialize(snap), snap);
    m1.store.useDoc.getState().addStation(100, 0);

    const m2 = await boot();
    await m2.sb.bootRecovery;
    expect(canRevertNow(m2)).toBe(false);
    expect(statusNow(m2)).toBe('dirty');
  });

  it('declines when the pointer names a version with different bytes', async () => {
    const m1 = await boot();
    m1.store.useDoc.getState().addStation(0, 0);
    await saveToLibrary(m1, 'm1');
    m1.store.useDoc.getState().addStation(100, 0);
    await saveToLibrary(m1, 'm1'); // v2 is the recorded baseline...
    m1.lp.useLibraryPointer.getState().setPointer('m1', 1); // ...but the pointer went stale
    m1.store.useDoc.getState().addStation(200, 0);

    const m2 = await boot();
    await m2.sb.bootRecovery;
    // v1's bytes are not the bytes the record vouches for: stay unset rather
    // than arm Revert with the wrong document.
    expect(canRevertNow(m2)).toBe(false);
  });

  it('declines, without throwing, when the pointed version is gone', async () => {
    const m1 = await boot();
    m1.store.useDoc.getState().addStation(0, 0);
    const saved = await saveToLibrary(m1, 'm1');
    m1.store.useDoc.getState().addStation(100, 0);
    await m1.lib.deleteVersion(saved.id);

    const m2 = await boot();
    await m2.sb.bootRecovery;
    expect(canRevertNow(m2)).toBe(false);
  });

  it('stays unset after markUnbacked — a deleted backing row must not resurrect', async () => {
    const m1 = await boot();
    m1.store.useDoc.getState().addStation(0, 0);
    await saveToLibrary(m1, 'm1');
    m1.store.useDoc.getState().addStation(100, 0);
    // The dialog's delete flow: the row is gone and markUnbacked said so, but
    // the pointer may still name the dead version.
    m1.sb.markUnbacked();

    const m2 = await boot();
    await m2.sb.bootRecovery;
    expect(canRevertNow(m2)).toBe(false);
    expect(statusNow(m2)).toBe('dirty');
  });

  it('no-ops on a clean reload — the boot from the library anchored the baseline', async () => {
    const m1 = await boot();
    m1.store.useDoc.getState().addStation(0, 0);
    await saveToLibrary(m1, 'm1');

    // A clean save releases the working copy, so the reload comes up from
    // the library (mapTab.ts) — and that adoption IS the baseline.
    const m2 = await boot();
    await m2.tab.openTabMapFromLibrary();
    await m2.sb.bootRecovery;
    expect(statusNow(m2)).toBe('clean');
    expect(canRevertNow(m2)).toBe(false);
    // And the baseline is the adopted doc's own references, not a re-parsed
    // copy the recovery fetched over it.
    expect(m2.sb.useSaveBaseline.getState().baselineSnap?.stations).toBe(
      m2.store.useDoc.getState().stations,
    );
  });
});
