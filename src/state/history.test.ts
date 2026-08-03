import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  pushHistory,
  historyDepth,
  redoDepth,
  undo,
  redo,
  isHistoryGrouping,
  withCoalescedHistory,
} from './history';
import {
  useDoc,
  pickDocSnapshot,
  HISTORY_LIMIT,
  beginHistoryGroup,
  flushDocPersist,
} from './store';
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

describe('withCoalescedHistory — burst folding', () => {
  // Rapid-fire writes from one control (wheel ticks over a slider/spinbutton)
  // collapse to a single undo entry. `key` stands in for the control's identity
  // — the production one is a per-field token from useNumericField.
  beforeEach(() => {
    useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
    useDoc.temporal.getState().clear();
  });

  it('folds a run of same-key writes into one entry, undoable in one step', () => {
    const key = {};
    useDoc.getState().setDocName('Before');
    expect(historyDepth()).toBe(1);

    for (const n of ['1', '2', '3', '4']) {
      withCoalescedHistory(key, () => useDoc.getState().setDocName(n));
    }

    expect(useDoc.getState().name).toBe('4');
    expect(historyDepth()).toBe(2);
    undo();
    expect(useDoc.getState().name).toBe('Before');
  });

  it('starts a new entry once the run goes quiet', () => {
    // Two separate visits to the same control stay separately undoable — the
    // fold is scoped to one continuous gesture, not to the control forever.
    const key = {};
    const clock = vi.spyOn(Date, 'now');
    clock.mockReturnValue(1_000_000);
    withCoalescedHistory(key, () => useDoc.getState().setDocName('First'));
    clock.mockReturnValue(1_000_000 + 5_000);
    withCoalescedHistory(key, () => useDoc.getState().setDocName('Second'));
    clock.mockRestore();

    expect(historyDepth()).toBe(2);
    undo();
    expect(useDoc.getState().name).toBe('First');
  });

  it('does not merge writes from two different controls', () => {
    const width = {};
    const gap = {};
    withCoalescedHistory(width, () => useDoc.getState().setDocName('Width'));
    withCoalescedHistory(gap, () => useDoc.getState().setDocName('Gap'));

    expect(historyDepth()).toBe(2);
    undo();
    expect(useDoc.getState().name).toBe('Width');
  });

  it('never swallows an unrelated edit made between two ticks', () => {
    // The run is pinned to the exact entry it owns, so anything else recording
    // ends it. Without that check the second tick would discard the STATION's
    // entry and one undo would revert both it and the tick.
    const key = {};
    withCoalescedHistory(key, () => useDoc.getState().setDocName('Tick 1'));
    const id = useDoc.getState().addStation(0, 0);
    withCoalescedHistory(key, () => useDoc.getState().setDocName('Tick 2'));

    expect(historyDepth()).toBe(3);
    undo();
    expect(useDoc.getState().name).toBe('Tick 1');
    expect(useDoc.getState().stations[id]).toBeDefined();
    undo();
    expect(useDoc.getState().stations[id]).toBeUndefined();
  });

  it('is inert inside an open history group (the group owns the entry)', () => {
    // Writes made while a group is open record nothing of their own, so there
    // is nothing to fold — and nothing to accidentally truncate.
    const key = {};
    useDoc.getState().setDocName('Before');
    const group = beginHistoryGroup();
    withCoalescedHistory(key, () => useDoc.getState().setDocName('Mid'));
    withCoalescedHistory(key, () => useDoc.getState().setDocName('End'));
    group.commit();

    expect(historyDepth()).toBe(2);
    undo();
    expect(useDoc.getState().name).toBe('Before');
  });

  it('a tick after an undo starts a fresh entry, not a fold into the popped one', () => {
    const key = {};
    useDoc.getState().setDocName('Before');
    withCoalescedHistory(key, () => useDoc.getState().setDocName('Scrolled'));
    undo();
    expect(useDoc.getState().name).toBe('Before');

    withCoalescedHistory(key, () => useDoc.getState().setDocName('Scrolled again'));

    // Folding into the undone entry would leave nothing to go back to.
    expect(historyDepth()).toBe(2);
    undo();
    expect(useDoc.getState().name).toBe('Before');
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
    // Consume the debounced write the setState just armed, so no stray timer
    // fires mid-test; then start from empty storage.
    flushDocPersist();
    useDoc.temporal.getState().clear();
    localStorage.clear();
  });

  it('undo writes the reverted doc through to localStorage', () => {
    // A normal edit reaches storage on the debounce trail — flush stands in
    // for the timer here to pin the pre-undo bytes.
    useDoc.getState().setDocName('Edited');
    flushDocPersist();
    expect(persistedName()).toBe('Edited');
    expect(historyDepth()).toBe(1);

    undo();

    // In-memory the edit is gone — and the stored blob must reflect it too,
    // immediately (undo flushes; it never waits out the debounce).
    expect(useDoc.getState().name).toBe(DEFAULT_DOC.name);
    expect(persistedName()).toBe(DEFAULT_DOC.name);
  });

  it("an undo's write is never overtaken by a stale pending write", () => {
    // The edit arms a debounced write of 'Edited'; undo must both write the
    // reverted doc synchronously AND cancel that pending write — otherwise the
    // stale timer fires ~300ms later and resurrects the undone edit on disk.
    //
    // Driven on fake timers. The original waited out 350ms of wall clock, which
    // made this the slowest test in the file and — with no assertion that a
    // write was ever actually pending — indistinguishable from a path that
    // arms no timer at all.
    vi.useFakeTimers();
    try {
      useDoc.getState().setDocName('Edited');
      // Precondition: there IS a debounced write in flight to be overtaken by.
      expect(vi.getTimerCount()).toBeGreaterThan(0);

      undo();
      expect(persistedName()).toBe(DEFAULT_DOC.name);

      // Give a leaked timer every chance to fire: nothing may write again, and
      // the reverted name must survive the whole debounce window.
      const spy = vi.spyOn(window.Storage.prototype, 'setItem');
      vi.advanceTimersByTime(1000);
      expect(spy).not.toHaveBeenCalled();
      expect(persistedName()).toBe(DEFAULT_DOC.name);
    } finally {
      vi.useRealTimers();
    }
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

  it('undo is a no-op while a history group is open', () => {
    // zundo's undo ignores pause (pause only gates RECORDING), so stepping
    // history mid-gesture would pop an entry the still-armed gesture
    // immediately clobbers, and the group's later commit would push a stale
    // snapshot while wiping redo. Time travel must wait for the group to seal.
    useDoc.getState().setDocName('First');
    const group = beginHistoryGroup();
    useDoc.getState().setDocName('Mid-gesture');

    undo();

    expect(useDoc.getState().name).toBe('Mid-gesture');
    expect(historyDepth()).toBe(1);
    expect(redoDepth()).toBe(0);
    expect(isHistoryGrouping()).toBe(true);

    // Once the group seals, undo works normally again.
    group.commit();
    expect(historyDepth()).toBe(2);
    undo();
    expect(useDoc.getState().name).toBe('First');
  });

  it('redo is a no-op while a history group is open', () => {
    useDoc.getState().setDocName('First');
    undo();
    expect(redoDepth()).toBe(1);
    const group = beginHistoryGroup();
    useDoc.getState().setDocName('Mid-gesture');

    redo();

    expect(useDoc.getState().name).toBe('Mid-gesture');
    expect(redoDepth()).toBe(1);
    group.commit();
  });

  it('a coalesced write still writes through to localStorage', () => {
    // The fold discards an undo ENTRY, never a doc write — the persisted blob
    // must still track the latest value of a burst once the debounce settles.
    const key = {};
    withCoalescedHistory(key, () => useDoc.getState().setDocName('One'));
    withCoalescedHistory(key, () => useDoc.getState().setDocName('Two'));
    flushDocPersist();
    expect(persistedName()).toBe('Two');
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
