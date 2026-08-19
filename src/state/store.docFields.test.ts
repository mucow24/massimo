import { describe, it, expect } from 'vitest';
import { pickDocSnapshot } from './store';
import { DEFAULT_DOC } from '../model/transforms';
import type { DocSnapshot } from './store';

/**
 * `DOC_FIELDS` (store.ts) is a hand-maintained tuple, and it is what decides
 * which `MapDoc` fields persist, undo and travel in a save. Nothing in the type
 * system ties it to the doc: `DocSnapshot` is `Pick<MapDoc, DocFieldName>`, so
 * it is DERIVED from the tuple rather than checked against `MapDoc` — a field
 * added to `MapDoc`/`DEFAULT_DOC` and forgotten here still compiles, still
 * defaults, and is then silently dropped from every save, every undo entry and
 * every save-baseline comparison. That failure looks like "my edit came back
 * after a refresh", days later, so the tuple is guarded here instead.
 *
 * `pickDocSnapshot` is the tuple's public face (it copies exactly `DOC_FIELDS`),
 * which is why this asks it rather than the unexported array.
 */
describe('DOC_FIELDS covers the document', () => {
  it('picks exactly the fields DEFAULT_DOC declares', () => {
    // Both directions matter: a key here that DEFAULT_DOC lacks is a tuple
    // entry naming a field that no longer exists (it would snapshot as
    // `undefined` forever), and one DEFAULT_DOC has that this lacks is the
    // silent-drop case above.
    expect(Object.keys(pickDocSnapshot(DEFAULT_DOC)).sort()).toEqual(
      Object.keys(DEFAULT_DOC).sort(),
    );
  });

  it('copies every field by reference, so the snapshot IS the doc slice', () => {
    // The whole persist/undo/save-status stack compares snapshots by per-field
    // reference equality (`docSnapshotsEqual`), which is only sound while the
    // pick copies references rather than cloning.
    const snap = pickDocSnapshot(DEFAULT_DOC) as Record<string, unknown>;
    const doc = DEFAULT_DOC as unknown as Record<string, unknown>;
    for (const k of Object.keys(snap)) expect(snap[k]).toBe(doc[k]);
  });

  it('drops everything outside the tuple', () => {
    // The store's state carries mutator methods and UI-only fields alongside
    // the doc; the snapshot must not pick them up, or every action reference
    // would read as a doc change.
    const withExtras = {
      ...DEFAULT_DOC,
      addStation: () => {},
      someFutureUiField: 7,
    } as unknown as DocSnapshot;
    expect(Object.keys(pickDocSnapshot(withExtras)).sort()).toEqual(
      Object.keys(DEFAULT_DOC).sort(),
    );
  });
});
