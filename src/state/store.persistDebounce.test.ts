import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { beginHistoryGroup, flushDocPersist, pickDocSnapshot, useDoc } from './store';
import { DEFAULT_DOC } from '../model/transforms';

// The doc store's localStorage write is trailing-debounced ONLY inside a
// history group opened with `deferPersist` — the canvas drag hooks' per-frame
// write streams. One-shot edits AND focus-scoped field groups write
// synchronously, exactly as createJSONStorage did, so anything reading
// localStorage as ground truth right after a discrete edit (the e2e helpers
// do) keeps its contract. Flush points (gesture commit, undo/redo, page
// hide) write synchronously.

const KEY = 'vignelli-map-doc-v1';

function persistedDoc(): { state: Record<string, unknown>; version: number } | null {
  const raw = localStorage.getItem(KEY);
  return raw ? (JSON.parse(raw) as { state: Record<string, unknown>; version: number }) : null;
}

function persistedStationX(id: string): number | undefined {
  const stations = persistedDoc()?.state.stations as Record<string, { x: number }> | undefined;
  return stations?.[id]?.x;
}

describe('debounced doc persist', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
    useDoc.temporal.getState().clear();
    localStorage.clear();
  });

  afterEach(() => {
    // Drain any pending write so no timer leaks into the next test, then
    // restore real timers and the setItem spy.
    vi.runOnlyPendingTimers();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('a one-shot edit writes localStorage synchronously (the pre-debounce contract)', () => {
    // This is the contract the e2e helpers rely on: read the key right after
    // a discrete edit, no timers involved. CI caught its loss the hard way.
    const spy = vi.spyOn(window.Storage.prototype, 'setItem');
    useDoc.getState().setDocName('Immediate');
    expect(spy).toHaveBeenCalled();
    expect(persistedDoc()?.state.name).toBe('Immediate');
  });

  it('a focus-scoped (non-deferring) group still writes synchronously', () => {
    // The field-history pattern: a group opened on focus can stay open as
    // long as focus does — under it, every write must still land at once, or
    // storage trails an observable, discrete edit indefinitely (the race CI
    // caught on the popover spinbutton specs).
    const group = beginHistoryGroup();
    const spy = vi.spyOn(window.Storage.prototype, 'setItem');
    useDoc.getState().setDocName('Typed');
    expect(spy).toHaveBeenCalled();
    expect(persistedDoc()?.state.name).toBe('Typed');
    group.commit();
  });

  it('a grouped moveStation burst writes once, at the trailing edge', () => {
    const id = useDoc.getState().addStation(0, 0);
    const group = beginHistoryGroup({ deferPersist: true });
    localStorage.clear();
    const spy = vi.spyOn(window.Storage.prototype, 'setItem');

    for (let i = 1; i <= 20; i++) useDoc.getState().moveStation(id, i * 5, 0);

    // State updates stay synchronous...
    expect(useDoc.getState().stations[id].x).toBe(100);
    // ...but no storage write lands per-set while the gesture is open.
    expect(spy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);

    // One trailing write, holding the latest state.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(persistedStationX(id)).toBe(100);
    group.cancel();
  });

  it('a quiet period between grouped bursts yields one write per burst', () => {
    const id = useDoc.getState().addStation(0, 0);
    const group = beginHistoryGroup({ deferPersist: true });
    localStorage.clear();
    const spy = vi.spyOn(window.Storage.prototype, 'setItem');

    useDoc.getState().moveStation(id, 10, 0);
    vi.advanceTimersByTime(300);
    useDoc.getState().moveStation(id, 20, 0);
    vi.advanceTimersByTime(300);

    expect(spy).toHaveBeenCalledTimes(2);
    expect(persistedStationX(id)).toBe(20);
    group.cancel();
  });

  it('flushDocPersist writes the pending snapshot synchronously and cancels the timer', () => {
    const id = useDoc.getState().addStation(0, 0);
    const group = beginHistoryGroup({ deferPersist: true });
    useDoc.getState().moveStation(id, 42, 0);
    // The write is still pending (the clear wipes the key, not the slot).
    localStorage.clear();
    expect(persistedDoc()).toBeNull();

    flushDocPersist();
    expect(persistedStationX(id)).toBe(42);

    // The timer was cancelled: nothing writes again after the window.
    const spy = vi.spyOn(window.Storage.prototype, 'setItem');
    vi.advanceTimersByTime(1000);
    expect(spy).not.toHaveBeenCalled();
    group.cancel();
  });

  it('flushDocPersist is a no-op when nothing is pending', () => {
    flushDocPersist(); // consume the setup writes
    const spy = vi.spyOn(window.Storage.prototype, 'setItem');
    flushDocPersist();
    expect(spy).not.toHaveBeenCalled();
  });

  it('a gesture commit flushes synchronously — durable at pointerup', () => {
    const id = useDoc.getState().addStation(0, 0);
    const group = beginHistoryGroup({ deferPersist: true });
    for (let i = 1; i <= 10; i++) useDoc.getState().moveStation(id, i * 7, 0);
    localStorage.clear();

    group.commit();

    // No timer advance: the committed doc is already on disk.
    expect(persistedStationX(id)).toBe(70);
  });

  it('persisted bytes are identical to what createJSONStorage produced', () => {
    // Rehydration compatibility is byte-level: same key, same JSON.stringify
    // of the same { state, version } shape createJSONStorage serialized.
    useDoc.getState().setDocName('Parity check');

    const raw = localStorage.getItem(KEY);
    const version = useDoc.persist.getOptions().version;
    expect(raw).toBe(JSON.stringify({ state: pickDocSnapshot(useDoc.getState()), version }));
  });

  it('a trailing grouped write round-trips through rehydrate', () => {
    const id = useDoc.getState().addStation(0, 0);
    const group = beginHistoryGroup({ deferPersist: true });
    useDoc.getState().moveStation(id, 55, 0);
    vi.advanceTimersByTime(300); // the trailing write lands
    group.commit(); // keep the move — cancel would roll back and re-persist

    // Scribble over memory INSIDE a group (an ungrouped write would persist
    // synchronously and clobber the very bytes under test), then rehydrate.
    const scribble = beginHistoryGroup({ deferPersist: true });
    useDoc.setState({ ...useDoc.getState(), stations: {} });
    useDoc.persist.rehydrate();

    expect(useDoc.getState().stations[id]?.x).toBe(55);
    scribble.cancel();
  });

  it('clearStorage drops the pending write along with the key', () => {
    const id = useDoc.getState().addStation(0, 0);
    const group = beginHistoryGroup({ deferPersist: true });
    useDoc.getState().moveStation(id, 99, 0);
    useDoc.persist.clearStorage();

    // The zombie timer must not resurrect the cleared key.
    vi.advanceTimersByTime(1000);
    expect(localStorage.getItem(KEY)).toBeNull();
    group.cancel();
  });

  it('pagehide flushes the pending write', () => {
    const id = useDoc.getState().addStation(0, 0);
    const group = beginHistoryGroup({ deferPersist: true });
    useDoc.getState().moveStation(id, 31, 0);
    localStorage.clear();
    expect(persistedDoc()).toBeNull();

    window.dispatchEvent(new window.Event('pagehide'));

    expect(persistedStationX(id)).toBe(31);
    group.cancel();
  });

  it('visibilitychange to hidden flushes the pending write', () => {
    const id = useDoc.getState().addStation(0, 0);
    const group = beginHistoryGroup({ deferPersist: true });
    useDoc.getState().moveStation(id, 62, 0);
    localStorage.clear();
    expect(persistedDoc()).toBeNull();

    // Shadow the prototype getter on the instance; deleting the shadow restores it.
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    try {
      document.dispatchEvent(new window.Event('visibilitychange'));
    } finally {
      delete (document as { visibilityState?: unknown }).visibilityState;
    }

    expect(persistedStationX(id)).toBe(62);
    group.cancel();
  });
});
