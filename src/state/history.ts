import { HISTORY_LIMIT, cancelOpenHistoryGroup, useDoc, type DocSnapshot } from './store';
import { useSelection } from './selection';

// The ONE module that reaches into zundo's temporal-store internals — the
// `pastStates` / `futureStates` arrays. Confining the private shape here means
// a zundo upgrade is reconciled in a single place, and callers (production +
// tests) depend on these named operations instead of the array layout.

// Push exactly one entry onto the undo stack and wipe the redo stack, mirroring
// zundo's default handler when a fresh action happens — including its
// HISTORY_LIMIT cap (zundo only enforces `limit` in its own set-handler, so
// this path must trim the oldest entries itself).
export function pushHistory(snapshot: DocSnapshot): void {
  useDoc.temporal.setState((s) => ({
    pastStates: [...s.pastStates, snapshot].slice(-HISTORY_LIMIT),
    futureStates: [],
  }));
}

// Pause / resume recording while a grouped edit is in flight.
export function pauseHistory(): void {
  useDoc.temporal.getState().pause();
}
export function resumeHistory(): void {
  useDoc.temporal.getState().resume();
}

// True while a history group is open (recording is paused). Grouping doesn't
// nest, so a broadcast that can fire from inside an open group (e.g. a mirror
// edit dispatched from a focused numeric field) checks this and skips opening
// a second group — the outer one already collapses its writes into one entry.
export function isHistoryGrouping(): boolean {
  return !useDoc.temporal.getState().isTracking;
}

// zundo applies undo/redo through the raw `set` it captured, which sits ABOVE
// persist in the temporal(persist(...)) chain (store.ts) — so the reverted doc
// never reaches persist's storage writer, and a refresh would resurrect the
// undone edit from localStorage. Nudge persist to flush by writing an empty
// partial through useDoc.setState, which persist's middleware wraps with a
// storage write. It is a true no-op to history: nothing changes, so temporal's
// `equality` (docSnapshotsEqual) skips both the entry AND the redo-stack wipe.
function flushPersist(): void {
  useDoc.setState({});
}

// After moving through history, prune the (separate) selection store of any
// ids the restored doc no longer contains — otherwise undoing the deletion of a
// still-selected item leaves a dangling selection id behind.
export function undo(): void {
  useDoc.temporal.getState().undo();
  flushPersist();
  useSelection.getState().reconcileWithDoc(useDoc.getState());
}
export function redo(): void {
  useDoc.temporal.getState().redo();
  flushPersist();
  useSelection.getState().reconcileWithDoc(useDoc.getState());
}

// Wipe both stacks — a loaded file starts with a fresh history (undo must
// never cross a file load back into the previous document). Any group still
// open (a focused field whose blur lands after the load, a drag that died
// mid-gesture) holds a pre-load snapshot, so it is cancelled too: neither its
// own late end nor the next begin's steal may push the dead document.
export function clearHistory(): void {
  cancelOpenHistoryGroup();
  useDoc.temporal.getState().clear();
}

// Stack depths — for assertions and (future) UI enable/disable.
export function historyDepth(): number {
  return useDoc.temporal.getState().pastStates.length;
}
export function redoDepth(): number {
  return useDoc.temporal.getState().futureStates.length;
}
