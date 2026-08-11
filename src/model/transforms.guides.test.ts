import { describe, expect, it } from 'vitest';
import { makeDoc, makeGuide } from '../test/fixtures';
import { addGuide, deleteGuide, moveGuide, setGuideLocked, setItemsLocked } from './transforms';

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

  it('deleteGuide removes the guide and no-ops on an unknown id', () => {
    const doc = addGuide(makeDoc({}), 'g1', 'horizontal', 0);
    const gone = deleteGuide(doc, 'g1');
    expect(gone.guides.g1).toBeUndefined();
    expect(deleteGuide(gone, 'g1')).toBe(gone);
  });
});
