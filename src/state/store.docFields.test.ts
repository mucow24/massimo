import { describe, it, expect } from 'vitest';
import { pickDocSnapshot } from './store';
import { DEFAULT_DOC } from '../model/transforms';

/**
 * `DOC_FIELDS` (store.ts) decides which `MapDoc` fields persist, undo and
 * travel in a save. Both ways it can go wrong are caught at COMPILE time, not
 * here: a name the doc lacks breaks `DocSnapshot` against `DocState` (TS2345),
 * and a field the tuple forgets trips `DocFieldsCoverMapDoc` right beside it
 * (TS2344, naming the field). A test that re-asked either question could not
 * fail while `tsc` passes, so there isn't one.
 *
 * What no type can state is how `pickDocSnapshot` copies. The persist, undo and
 * save-status stacks all compare snapshots by per-field REFERENCE equality
 * (`docSnapshotsEqual`), which is sound only while the pick aliases the doc's
 * own objects rather than cloning them. A well-meaning deep copy would leave
 * every field comparing unequal — every keystroke a doc change, every gesture a
 * history entry, the save indicator permanently dirty — with no type error and
 * no other test to catch it.
 */
describe('pickDocSnapshot', () => {
  it('copies every field by reference, so the snapshot aliases the doc slice', () => {
    const snap = pickDocSnapshot(DEFAULT_DOC) as Record<string, unknown>;
    const doc = DEFAULT_DOC as unknown as Record<string, unknown>;
    const keys = Object.keys(snap);
    // Guard the guard: an empty pick would pass a per-key loop vacuously.
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) expect(snap[k]).toBe(doc[k]);
  });
});
