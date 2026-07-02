import { useDoc, type DocSnapshot } from './store';
import { useSelection } from './selection';

// The ONE module that reaches into zundo's temporal-store internals — the
// `pastStates` / `futureStates` arrays. Confining the private shape here means
// a zundo upgrade is reconciled in a single place, and callers (production +
// tests) depend on these named operations instead of the array layout.

// Push exactly one entry onto the undo stack and wipe the redo stack, mirroring
// zundo's default handler when a fresh action happens.
export function pushHistory(snapshot: DocSnapshot): void {
  useDoc.temporal.setState((s) => ({
    pastStates: [...s.pastStates, snapshot],
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

// After moving through history, prune the (separate) selection store of any
// ids the restored doc no longer contains — otherwise undoing the deletion of a
// still-selected item leaves a dangling selection id behind.
export function undo(): void {
  useDoc.temporal.getState().undo();
  useSelection.getState().reconcileWithDoc(useDoc.getState());
}
export function redo(): void {
  useDoc.temporal.getState().redo();
  useSelection.getState().reconcileWithDoc(useDoc.getState());
}

// Wipe both stacks — a loaded file starts with a fresh history (undo must
// never cross a file load back into the previous document).
export function clearHistory(): void {
  useDoc.temporal.getState().clear();
}

// Stack depths — for assertions and (future) UI enable/disable.
export function historyDepth(): number {
  return useDoc.temporal.getState().pastStates.length;
}
export function redoDepth(): number {
  return useDoc.temporal.getState().futureStates.length;
}
