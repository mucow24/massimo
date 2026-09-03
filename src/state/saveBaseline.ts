import { create } from 'zustand';
import { docSnapshotsEqual, pickDocSnapshot, useDoc, type DocSnapshot } from './store';
import { parse, serialize } from '../model/serialize';
import { DEFAULT_DOC } from '../model/transforms';
import { tabMapId, useLibraryPointer } from './libraryPointer';
import { getPayload, listVersions } from './mapLibrary';
import { useCustomPalettes } from './customPalettes';
import { baselineKey, removeDocDraft } from './mapKeys';

/**
 * The save baseline: what the live document would have to look like to count
 * as "saved". It is the bytes last written to the library or adopted from a
 * load, PLUS the doc-field references captured at that same moment — the
 * bytes drive the auto-save's exact dedup gate, the references drive the
 * cheap reactive status signal (~20 reference compares per doc change, no
 * serialization on the drag path).
 *
 * The reference comparison is undo-aware for free: zundo snapshots share
 * field references and undo restores them verbatim, so editing and then
 * undoing back to the save point compares equal again. That soundness rests
 * on the same invariant the undo stack itself rests on — transforms allocate
 * new objects only when something actually changed.
 *
 * `backed` distinguishes the two flavors of "clean": the baseline bytes exist
 * as a library version (saved there, or opened from there), or they merely
 * came from a load (a JSON file, a fresh New) and the library has no copy.
 */
interface SaveBaselineState {
  baselineSnap: DocSnapshot | null;
  baselineJson: string | null;
  backed: boolean;
}

/**
 * The live document's relationship to the library:
 * - `clean`   — matches a library version, byte for byte. Nothing to save.
 * - `dirty`   — differs from its last save/load (or has no baseline at all,
 *               which errs toward "save me").
 * - `unsaved` — untouched since its load, but the library holds no copy: a
 *               loaded JSON file, or a fresh New map. Saving imports it.
 */
export type SaveStatus = 'clean' | 'dirty' | 'unsaved';

/**
 * The empty document, serialized. Byte-comparing against this is the
 * auto-save's "nothing to lose" gate: exact, and covering every DOC_FIELDS
 * entry by construction — a new doc field is gated the day it is added.
 *
 * Deliberately NOT `computeContentBounds` — that is a camera hull which reads
 * five of those fields and omits lines on purpose, so a map whose work lives
 * entirely in its lines would read as "empty", the auto-save would write
 * nothing, and New would wipe it for good. One concept, not two.
 */
export const EMPTY_DOC_JSON = serialize(pickDocSnapshot(DEFAULT_DOC));

/**
 * Where the baseline survives a refresh: a hash of the baseline bytes plus
 * the backed bit, in localStorage under the tab's map (mapKeys.ts). The bytes
 * themselves would double the doc's storage footprint (svg images carry data
 * URIs), so on boot the rehydrated doc is re-serialized and compared by hash
 * instead — a match restores the baseline, a mismatch errs dirty, the same
 * direction a null baseline errs.
 */
const persistKey = (): string => baselineKey(tabMapId());

/** FNV-1a over the code units, prefixed with the length. Not cryptographic —
 *  a collision costs one wrongly-quiet dot until the next edit, on a
 *  single-user app, at 2^-32 odds per boot. */
export function hashBaseline(json: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${json.length}.${(h >>> 0).toString(36)}`;
}

const UNSET: SaveBaselineState = { baselineSnap: null, baselineJson: null, backed: false };

/**
 * Reconstruct the baseline for the doc the persist middleware just
 * rehydrated. Exported for tests; runs once at module init.
 *
 * A recorded hash that matches the doc restores the baseline (with its backed
 * bit); one that mismatches means unsaved work went down with the refresh —
 * stay unset, which reads dirty (a backed baseline may still come back through
 * `bootRecovery` below, from the library). With nothing recorded at all (first boot,
 * pre-feature storage) an EMPTY doc adopts itself as the unsaved baseline, so
 * a brand-new user meets the same blue dot a virgin New shows rather than a
 * red one; a non-empty doc of unknown provenance errs dirty.
 */
export function bootBaselineState(): SaveBaselineState {
  const snap = pickDocSnapshot(useDoc.getState());
  const json = serialize(snap);
  const raw = localStorage.getItem(persistKey());
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw) as { h?: unknown; backed?: unknown };
      if (parsed.h === hashBaseline(json)) {
        return { baselineSnap: snap, baselineJson: json, backed: parsed.backed === true };
      }
    } catch {
      // Unreadable record: same as a mismatch.
    }
    return UNSET;
  }
  if (json === EMPTY_DOC_JSON) return { baselineSnap: snap, baselineJson: json, backed: false };
  return UNSET;
}

export const useSaveBaseline = create<SaveBaselineState>()(() => bootBaselineState());

const persistBaseline = (json: string, backed: boolean): void => {
  localStorage.setItem(persistKey(), JSON.stringify({ h: hashBaseline(json), backed }));
};

/**
 * The doc was written to the library (or adopted straight from it): these
 * bytes ARE a library version. `json`/`snap` must be captured together from
 * the same state — and BEFORE any await, so an edit that lands mid-save
 * leaves the doc correctly dirty.
 *
 * Also releases the map's working copy, IF the live doc still is the snapshot
 * just vouched for: the library holds those bytes now, and a working copy
 * exists only for work the library does not hold (mapKeys.ts). An edit that
 * landed during the save's awaits is such work — it is in the slot and
 * nowhere else — so the slot stays for it, and the next boot comes back to it
 * rather than to the version.
 */
export function markSaved(json: string, snap: DocSnapshot): void {
  useSaveBaseline.setState({ baselineSnap: snap, baselineJson: json, backed: true });
  persistBaseline(json, true);
  if (docSnapshotsEqual(useDoc.getState(), snap)) removeDocDraft(tabMapId());
}

/** The doc was adopted from outside the library (a JSON file, New): clean,
 *  but the library holds no copy — Save stays armed to import it. */
export function markAdopted(json: string, snap: DocSnapshot): void {
  useSaveBaseline.setState({ baselineSnap: snap, baselineJson: json, backed: false });
  persistBaseline(json, false);
}

/**
 * The library row backing these bytes was deleted under the live doc. Null —
 * not "kept but unbacked" — on purpose: the auto-save's dedup gate compares
 * bytes against `baselineJson`, and after this deletion those bytes exist
 * nowhere but the canvas, so the next switch MUST write them. A kept baseline
 * would read as "already in the library, verbatim" and New would wipe a doc
 * that is then in no file, no row, and no undo stack. Reading dirty (red)
 * rather than unsaved (blue) is the erring direction that keeps the doc.
 */
export function markUnbacked(): void {
  useSaveBaseline.setState(UNSET);
  localStorage.removeItem(persistKey());
}

/** The tri-state signal, pure. `doc` is the live doc state (any superset of
 *  DocSnapshot works — the comparison reads only DOC_FIELDS). */
export function saveStatusOf(doc: DocSnapshot, baseline: SaveBaselineState): SaveStatus {
  if (baseline.baselineSnap === null || !docSnapshotsEqual(doc, baseline.baselineSnap)) {
    return 'dirty';
  }
  return baseline.backed ? 'clean' : 'unsaved';
}

/** Reactive tri-state for components: re-renders only when the status flips. */
export function useSaveStatus(): SaveStatus {
  const baseline = useSaveBaseline();
  return useDoc((s) => saveStatusOf(s, baseline));
}

/**
 * Whether Revert has anything to discard: a baseline exists AND the live doc
 * has diverged from it. A clean or unsaved doc already equals its baseline
 * (nothing to throw away), and a doc with no baseline has no saved state to
 * return to — both leave Revert inert. Note this is NOT `status === 'dirty'`:
 * a doc with no baseline reads dirty (it errs "save me") yet has nothing to
 * revert, so Revert and Save version gate on different predicates. Reuses the
 * same reference comparison as `saveStatusOf`, so the two can never disagree
 * about whether the doc is sitting on its baseline. */
export function canRevertTo(doc: DocSnapshot, baseline: SaveBaselineState): boolean {
  return baseline.baselineSnap !== null && !docSnapshotsEqual(doc, baseline.baselineSnap);
}

/** Reactive twin for components: re-renders only when revert-ability flips. */
export function useCanRevert(): boolean {
  const baseline = useSaveBaseline();
  return useDoc((s) => canRevertTo(s, baseline));
}

/**
 * Recover a baseline whose bytes went down with the refresh.
 *
 * `bootBaselineState` can restore the baseline only when the rehydrated doc IS
 * the baseline. Reload with unsaved edits and the hash mismatches, the
 * baseline boots unset, and Revert goes grey — even though, for a `backed`
 * baseline, the exact bytes it should restore sit in the library under the
 * version the pointer names. So fetch them: rebuild the (json, snap) pair the
 * way adoption does (loadDoc's DEFAULT_DOC merge, then pick, then serialize)
 * and accept it only if its hash IS the recorded one. A stale pointer, a
 * pruned row, or bytes an app update now serializes differently all fail that
 * check and decline — the same unset-reads-dirty direction the boot erred.
 *
 * Only the baseline store is written; the doc is never touched. The recorded
 * `backed: false` declines up front: those bytes came from a file or a New,
 * and the library never held them.
 */
async function recoverBaselineFromLibrary(): Promise<void> {
  if (useSaveBaseline.getState().baselineSnap !== null) return; // boot restored it
  const raw = localStorage.getItem(persistKey());
  if (raw === null) return; // nothing recorded — or markUnbacked, which must stay unset
  let recorded: { h?: unknown; backed?: unknown };
  try {
    recorded = JSON.parse(raw) as { h?: unknown; backed?: unknown };
  } catch {
    return;
  }
  if (recorded.backed !== true) return;
  const { mapId, version } = useLibraryPointer.getState();
  if (version === null) return;

  // Best-effort IO: a storage failure declines, same as a missing row.
  let payload: string | undefined;
  try {
    const meta = (await listVersions(mapId)).find((v) => v.version === version);
    if (meta === undefined) return;
    payload = await getPayload(meta.id);
  } catch {
    return;
  }
  if (payload === undefined) return;
  const parsed = parse(payload, useCustomPalettes.getState().palettes);
  if (!parsed.ok) return;
  const snap = pickDocSnapshot({ ...DEFAULT_DOC, ...parsed.doc });
  const json = serialize(snap);
  if (hashBaseline(json) !== recorded.h) return; // not the bytes the record vouches for

  // Re-check the gates across the awaits: a save, load, or delete that landed
  // mid-fetch owns the baseline now, and markUnbacked in particular must not
  // be resurrected (see its doc comment).
  if (useSaveBaseline.getState().baselineSnap !== null) return;
  if (localStorage.getItem(persistKey()) !== raw) return;
  useSaveBaseline.setState({ baselineSnap: snap, baselineJson: json, backed: true });
}

/**
 * The boot sequence again, for a tab that has just become another map
 * (mapTab.ts): read that map's record against the doc now on the canvas, then
 * fetch the bytes from the library if the record vouches for a version the
 * canvas has moved past.
 */
export function rebootBaseline(): Promise<void> {
  useSaveBaseline.setState(bootBaselineState());
  return recoverBaselineFromLibrary();
}

/** Fired once at boot, beside `bootBaselineState`; exported so tests (and any
 *  boot sequencing that needs the baseline settled) can await it. */
export const bootRecovery: Promise<void> = recoverBaselineFromLibrary();
