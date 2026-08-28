import { describe, it, expect } from 'vitest';
import { healPersistedUnion } from './persistedUnion';

/**
 * The gate every persisted union field passes on the way in. Six stores call it
 * from their `merge` hooks, and each of those tests its OWN field — which
 * proves the wiring, not the rule. Pinned here so the rule itself has one home:
 * the three answers are pinned once, against the guard shapes real callers pass
 * (`isMapSort`-style membership, and a ladder whose members are not strings).
 */
const SORTS = ['name', 'updated'] as const;
type Sort = (typeof SORTS)[number];
const isSort = (v: unknown): v is Sort =>
  typeof v === 'string' && (SORTS as readonly string[]).includes(v);

describe('healPersistedUnion', () => {
  it('passes a stored member through untouched', () => {
    expect(healPersistedUnion('updated', 'name', isSort, 'name')).toBe('updated');
  });

  it('drops a stored non-member to the fallback, not to the live value', () => {
    // The distinction matters: `live` is whatever the store happens to hold
    // when the rehydrate lands, which for an async rehydrate is not necessarily
    // the default. A value the ladder rejects must land on the store's DEFAULT.
    expect(healPersistedUnion('retired', 'updated', isSort, 'name')).toBe('name');
  });

  it('drops a stored value of the wrong TYPE too — a blob is only ever JSON', () => {
    for (const junk of [7, null, {}, [], true]) {
      expect(healPersistedUnion(junk, 'updated', isSort, 'name')).toBe('name');
    }
  });

  it('keeps the LIVE value when the field is absent, rather than the fallback', () => {
    // The answer that is easy to get wrong. A blob written before the field
    // existed violates nothing, so it must leave the live value exactly as
    // zustand's shallow merge alone would have — even where that differs from
    // the store's default.
    expect(healPersistedUnion(undefined, 'updated', isSort, 'name')).toBe('updated');
  });

  it('treats an explicit null as a stored non-member, not as absent', () => {
    // `undefined` is the only spelling of "the blob predates this field";
    // `null` is a value someone wrote, and no ladder has it.
    expect(healPersistedUnion(null, 'updated', isSort, 'name')).toBe('name');
  });

  it('judges by the guard alone, so a non-string ladder works the same', () => {
    // Nothing about the rule is string-specific — it is whatever the caller's
    // guard admits.
    const isEven = (v: unknown): v is number => typeof v === 'number' && v % 2 === 0;
    expect(healPersistedUnion(4, 0, isEven, 2)).toBe(4);
    expect(healPersistedUnion(3, 0, isEven, 2)).toBe(2);
    expect(healPersistedUnion(undefined, 0, isEven, 2)).toBe(0);
  });
});
