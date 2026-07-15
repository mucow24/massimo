import { describe, it, expect } from 'vitest';
import { reconcileOrder, moveInOrder, moveToEndInOrder } from './recordOrder';

const records = (...ids: string[]): Record<string, unknown> =>
  Object.fromEntries(ids.map((id) => [id, {}]));

describe('reconcileOrder', () => {
  it('keeps a fully-specified order untouched', () => {
    expect(reconcileOrder(records('a', 'b', 'c'), ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('drops ids whose record no longer exists', () => {
    expect(reconcileOrder(records('a', 'c'), ['a', 'b', 'c'])).toEqual(['a', 'c']);
  });

  it('appends record ids missing from the order (legacy/partial saves)', () => {
    // 'a' present in order, 'b' and 'c' only in records → appended after.
    expect(reconcileOrder(records('a', 'b', 'c'), ['a'])).toEqual(['a', 'b', 'c']);
  });

  it('appends everything when the order is empty', () => {
    expect(reconcileOrder(records('a', 'b'), [])).toEqual(['a', 'b']);
  });
});

describe('moveInOrder', () => {
  it('swaps one step toward the end with dir +1', () => {
    expect(moveInOrder(['a', 'b', 'c'], 'a', 1)).toEqual(['b', 'a', 'c']);
  });

  it('swaps one step toward the start with dir -1', () => {
    expect(moveInOrder(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
  });

  it('returns the SAME array reference when already at the end (+1 no-op)', () => {
    const order = ['a', 'b', 'c'];
    expect(moveInOrder(order, 'c', 1)).toBe(order);
  });

  it('returns the SAME array reference when already at the start (-1 no-op)', () => {
    const order = ['a', 'b', 'c'];
    expect(moveInOrder(order, 'a', -1)).toBe(order);
  });

  it('returns the SAME array reference when the id is absent', () => {
    const order = ['a', 'b', 'c'];
    expect(moveInOrder(order, 'z', 1)).toBe(order);
  });
});

describe('moveToEndInOrder', () => {
  it('jumps to the end with dir +1, sliding the rest down one', () => {
    expect(moveToEndInOrder(['a', 'b', 'c'], 'a', 1)).toEqual(['b', 'c', 'a']);
  });

  it('jumps to the start with dir -1, sliding the rest up one', () => {
    expect(moveToEndInOrder(['a', 'b', 'c'], 'c', -1)).toEqual(['c', 'a', 'b']);
  });

  // The distinction from moveInOrder: from the middle of a long order it clears
  // every remaining neighbour in one call, not just the adjacent one.
  it('clears every neighbour from the middle, not just the adjacent one', () => {
    expect(moveToEndInOrder(['a', 'b', 'c', 'd'], 'b', 1)).toEqual(['a', 'c', 'd', 'b']);
    expect(moveToEndInOrder(['a', 'b', 'c', 'd'], 'c', -1)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('preserves the relative order of the items it passes', () => {
    expect(moveToEndInOrder(['a', 'b', 'c', 'd', 'e'], 'e', -1)).toEqual(['e', 'a', 'b', 'c', 'd']);
  });

  it('returns the SAME array reference when already at the end (+1 no-op)', () => {
    const order = ['a', 'b', 'c'];
    expect(moveToEndInOrder(order, 'c', 1)).toBe(order);
  });

  it('returns the SAME array reference when already at the start (-1 no-op)', () => {
    const order = ['a', 'b', 'c'];
    expect(moveToEndInOrder(order, 'a', -1)).toBe(order);
  });

  it('returns the SAME array reference when the id is absent', () => {
    const order = ['a', 'b', 'c'];
    expect(moveToEndInOrder(order, 'z', 1)).toBe(order);
  });

  it('no-ops on a single-element order (already at both ends)', () => {
    const order = ['a'];
    expect(moveToEndInOrder(order, 'a', 1)).toBe(order);
    expect(moveToEndInOrder(order, 'a', -1)).toBe(order);
  });
});
