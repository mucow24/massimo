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

// How long after a coalesced write the next one still counts as the same
// gesture. Long enough to bridge the ragged tail of trackpad inertia (and a
// few deliberate mouse-wheel clicks in a row); short enough that two separate
// visits to the same control stay separately undoable.
const COALESCE_WINDOW_MS = 500;

// How zundo types the entries it stores (a Partial of the partialized doc).
// The burst tracking only ever compares them by IDENTITY, never reads a field.
type PastEntry = Partial<DocSnapshot>;

// The run of writes the last withCoalescedHistory call belongs to: whose
// control (`key`), which undo entry it owns, and when it last fired.
let burst: { key: object; entry: PastEntry; at: number } | null = null;

function topPastState(): PastEntry | undefined {
  const { pastStates } = useDoc.temporal.getState();
  return pastStates[pastStates.length - 1];
}

// Drop everything recorded above `entry`, putting the past stack back exactly
// where the burst started. A no-op if the entry is gone (a load cleared the
// stack mid-burst) — never guess at an index.
function truncatePastTo(entry: PastEntry): void {
  useDoc.temporal.setState((s) => {
    const i = s.pastStates.lastIndexOf(entry);
    return i === -1 ? {} : { pastStates: s.pastStates.slice(0, i + 1) };
  });
}

/**
 * Run a write that a user can fire in rapid succession without lifting a
 * finger — a wheel tick over a slider or spinbutton — and fold consecutive
 * ones into a SINGLE undo entry. A trackpad emits dozens of wheel events per
 * flick; one entry each meant an accidental scroll buried the real work under
 * a wall of 0.25-step entries that Ctrl+Z had to unwind one at a time.
 *
 * Unlike beginHistoryGroup this never pauses recording: each write records
 * normally and the entry it just added is then discarded, so the burst's FIRST
 * entry (the pre-burst doc) is what survives. Nothing is held open between
 * ticks — undo/redo, unrelated actions, and a file load all keep working
 * mid-burst, and any of them ends the run: `entry` is an identity check on the
 * top of the past stack, so the moment anything else records (or removes) an
 * entry the next write starts a fresh burst instead of swallowing it.
 *
 * `key` identifies the control — a stable per-field token — so wheeling one
 * field and then another doesn't merge the two into one entry.
 *
 * Writes made while a history GROUP is open (a focused field, a drag) record
 * nothing of their own, so this is inert for them: the group already collapses
 * them into its one entry.
 */
export function withCoalescedHistory(key: object, apply: () => void): void {
  const now = Date.now();
  const before = topPastState();
  const continues =
    burst !== null &&
    burst.key === key &&
    burst.entry === before &&
    now - burst.at < COALESCE_WINDOW_MS;

  apply();

  if (continues) {
    truncatePastTo(burst!.entry);
    burst!.at = now;
    return;
  }
  // A run only begins once a write has actually landed an entry to fold into.
  const after = topPastState();
  if (after !== undefined && after !== before) burst = { key, entry: after, at: now };
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
//
// Both are NO-OPS while a history group is open: zundo's undo/redo ignore
// pause (pause only gates recording), so stepping mid-gesture would pop an
// entry the still-armed gesture immediately clobbers, and the group's later
// commit would push its stale pre-gesture snapshot while wiping the redo
// stack — non-monotonic undo. Field edits aren't affected: the Ctrl+Z handler
// blurs first, and blur seals a focused field's group before undo() runs (the
// blur-then-undo contract).
export function undo(): void {
  if (isHistoryGrouping()) return;
  useDoc.temporal.getState().undo();
  flushPersist();
  useSelection.getState().reconcileWithDoc(useDoc.getState());
}
export function redo(): void {
  if (isHistoryGrouping()) return;
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
