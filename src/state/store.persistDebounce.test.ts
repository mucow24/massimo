import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { beginHistoryGroup, flushDocPersist, pickDocSnapshot, useDoc } from './store';
import { DEFAULT_DOC } from '../model/transforms';

// The doc store's localStorage write is trailing-debounced: state updates stay
// synchronous, but the stringify + setItem of the ~full doc runs once per
// quiet period instead of once per pointermove. Flush points (gesture commit,
// undo/redo, page hide) write synchronously.

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

  it('a moveStation burst writes localStorage once, after the debounce window', () => {
    const id = useDoc.getState().addStation(0, 0);
    localStorage.clear();
    const spy = vi.spyOn(window.Storage.prototype, 'setItem');

    for (let i = 1; i <= 20; i++) useDoc.getState().moveStation(id, i * 5, 0);

    // State updates stay synchronous...
    expect(useDoc.getState().stations[id].x).toBe(100);
    // ...but no storage write lands per-set.
    expect(spy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);

    // One trailing write, holding the latest state.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(persistedStationX(id)).toBe(100);
  });

  it('a quiet period between bursts yields one write per burst', () => {
    const id = useDoc.getState().addStation(0, 0);
    localStorage.clear();
    const spy = vi.spyOn(window.Storage.prototype, 'setItem');

    useDoc.getState().moveStation(id, 10, 0);
    vi.advanceTimersByTime(300);
    useDoc.getState().moveStation(id, 20, 0);
    vi.advanceTimersByTime(300);

    expect(spy).toHaveBeenCalledTimes(2);
    expect(persistedStationX(id)).toBe(20);
  });

  it('flushDocPersist writes the pending snapshot synchronously and cancels the timer', () => {
    useDoc.getState().setDocName('Flushed');
    // The write is still pending (the clear wipes the key, not the slot).
    localStorage.clear();
    expect(persistedDoc()).toBeNull();

    flushDocPersist();
    expect(persistedDoc()?.state.name).toBe('Flushed');

    // The timer was cancelled: nothing writes again after the window.
    const spy = vi.spyOn(window.Storage.prototype, 'setItem');
    vi.advanceTimersByTime(1000);
    expect(spy).not.toHaveBeenCalled();
  });

  it('flushDocPersist is a no-op when nothing is pending', () => {
    flushDocPersist(); // consume the setup writes
    const spy = vi.spyOn(window.Storage.prototype, 'setItem');
    flushDocPersist();
    expect(spy).not.toHaveBeenCalled();
  });

  it('a gesture commit flushes synchronously — durable at pointerup', () => {
    const id = useDoc.getState().addStation(0, 0);
    const group = beginHistoryGroup();
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
    flushDocPersist();

    const raw = localStorage.getItem(KEY);
    const version = useDoc.persist.getOptions().version;
    expect(raw).toBe(JSON.stringify({ state: pickDocSnapshot(useDoc.getState()), version }));
  });

  it('a debounced write round-trips through rehydrate', () => {
    useDoc.getState().setDocName('Round trip');
    vi.advanceTimersByTime(300); // the trailing write lands

    // Scribble over memory, then rehydrate from the stored bytes.
    useDoc.setState({ ...useDoc.getState(), name: 'Scratch' });
    useDoc.persist.rehydrate();

    expect(useDoc.getState().name).toBe('Round trip');
  });

  it('clearStorage drops the pending write along with the key', () => {
    useDoc.getState().setDocName('Doomed');
    useDoc.persist.clearStorage();

    // The zombie timer must not resurrect the cleared key.
    vi.advanceTimersByTime(1000);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('pagehide flushes the pending write', () => {
    useDoc.getState().setDocName('Hidden');
    localStorage.clear();
    expect(persistedDoc()).toBeNull();

    window.dispatchEvent(new window.Event('pagehide'));

    expect(persistedDoc()?.state.name).toBe('Hidden');
  });

  it('visibilitychange to hidden flushes the pending write', () => {
    useDoc.getState().setDocName('Backgrounded');
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

    expect(persistedDoc()?.state.name).toBe('Backgrounded');
  });
});
