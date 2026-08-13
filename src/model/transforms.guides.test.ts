import { describe, expect, it } from 'vitest';
import { makeDoc, makeGuide } from '../test/fixtures';
import {
  addGuide,
  deleteGuide,
  moveGuide,
  resizeGuide,
  setGuideLocked,
  setItemsLocked,
} from './transforms';

describe('alignment guide transforms', () => {
  it('addGuide mints a guide with its orientation and offset', () => {
    const doc = addGuide(makeDoc({}), 'g1', 'horizontal', 120);
    expect(doc.guides.g1).toEqual({ id: 'g1', orientation: 'horizontal', offset: 120 });
  });

  it('moveGuide rewrites the offset and is a same-reference no-op otherwise', () => {
    const doc = addGuide(makeDoc({}), 'g1', 'vertical', 40);
    const moved = moveGuide(doc, 'g1', 55.5);
    expect(moved.guides.g1.offset).toBe(55.5);
    expect(moveGuide(moved, 'g1', 55.5)).toBe(moved);
    expect(moveGuide(moved, 'nope', 10)).toBe(moved);
  });

  it('moveGuide refuses a non-finite offset', () => {
    const free = addGuide(makeDoc({}), 'g2', 'horizontal', 10);
    expect(moveGuide(free, 'g2', NaN)).toBe(free);
  });

  it('lock stores true and omits the field when unlocked (the canonical convention)', () => {
    const doc = addGuide(makeDoc({}), 'g1', 'horizontal', 0);
    const locked = setGuideLocked(doc, 'g1', true);
    expect(locked.guides.g1.locked).toBe(true);
    const unlocked = setGuideLocked(locked, 'g1', false);
    expect('locked' in unlocked.guides.g1).toBe(false);
    // Already at the requested state → untouched doc.
    expect(setGuideLocked(unlocked, 'g1', false)).toBe(unlocked);
  });

  it('setItemsLocked reaches guides alongside the other kinds', () => {
    const doc = makeDoc({ guides: [makeGuide({ id: 'g1' }), makeGuide({ id: 'g2' })] });
    const locked = setItemsLocked(doc, { guides: ['g1', 'g2'] }, true);
    expect(locked.guides.g1.locked).toBe(true);
    expect(locked.guides.g2.locked).toBe(true);
    // All-no-op batch returns the doc itself.
    expect(setItemsLocked(locked, { guides: ['g1', 'g2'] }, true)).toBe(locked);
  });

  it('addGuide stamps a provided extent', () => {
    const doc = addGuide(makeDoc({}), 'g1', 'horizontal', 120, { center: 300, halfLength: 100 });
    expect(doc.guides.g1.extent).toEqual({ center: 300, halfLength: 100 });
    // Absent stays absent — the unbounded guide stores no extent field.
    const free = addGuide(makeDoc({}), 'g2', 'horizontal', 120);
    expect('extent' in free.guides.g2).toBe(false);
  });

  it('moveGuide slides a bounded span with the optional center', () => {
    const doc = addGuide(makeDoc({}), 'g1', 'horizontal', 120, { center: 10, halfLength: 5 });
    const slid = moveGuide(doc, 'g1', 130, 25);
    expect(slid.guides.g1.offset).toBe(130);
    expect(slid.guides.g1.extent).toEqual({ center: 25, halfLength: 5 });
    // Center alone still writes (offset unchanged)…
    const slidOnly = moveGuide(slid, 'g1', 130, 40);
    expect(slidOnly.guides.g1.extent).toEqual({ center: 40, halfLength: 5 });
    // …and the same pair is a same-reference no-op.
    expect(moveGuide(slidOnly, 'g1', 130, 40)).toBe(slidOnly);
    // A center for an unbounded guide is meaningless and ignored.
    const free = addGuide(makeDoc({}), 'g2', 'horizontal', 10);
    const moved = moveGuide(free, 'g2', 20, 99);
    expect(moved.guides.g2.offset).toBe(20);
    expect('extent' in moved.guides.g2).toBe(false);
  });

  it('resizeGuide sets, replaces and strips the extent', () => {
    const doc = addGuide(makeDoc({}), 'g1', 'horizontal', 120);
    const bounded = resizeGuide(doc, 'g1', { center: 10, halfLength: 5 });
    expect(bounded.guides.g1.extent).toEqual({ center: 10, halfLength: 5 });
    const re = resizeGuide(bounded, 'g1', { center: 20, halfLength: 8 });
    expect(re.guides.g1.extent).toEqual({ center: 20, halfLength: 8 });
    // null strips back to the infinite (field-omitted) form.
    const infinite = resizeGuide(re, 'g1', null);
    expect('extent' in infinite.guides.g1).toBe(false);
    // Same-value writes and unknown ids are same-reference no-ops.
    expect(resizeGuide(re, 'g1', { center: 20, halfLength: 8 })).toBe(re);
    expect(resizeGuide(infinite, 'g1', null)).toBe(infinite);
    expect(resizeGuide(infinite, 'nope', null)).toBe(infinite);
  });

  it('resizeGuide refuses a malformed extent', () => {
    const doc = addGuide(makeDoc({}), 'g1', 'horizontal', 120);
    expect(resizeGuide(doc, 'g1', { center: NaN, halfLength: 5 })).toBe(doc);
    expect(resizeGuide(doc, 'g1', { center: 0, halfLength: NaN })).toBe(doc);
    // A zero span would commit an invisible, unhittable guide.
    expect(resizeGuide(doc, 'g1', { center: 0, halfLength: 0 })).toBe(doc);
    expect(resizeGuide(doc, 'g1', { center: 0, halfLength: -3 })).toBe(doc);
  });

  it('deleteGuide removes the guide and no-ops on an unknown id', () => {
    const doc = addGuide(makeDoc({}), 'g1', 'horizontal', 0);
    const gone = deleteGuide(doc, 'g1');
    expect(gone.guides.g1).toBeUndefined();
    expect(deleteGuide(gone, 'g1')).toBe(gone);
  });
});
