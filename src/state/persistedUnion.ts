/**
 * The gate a persisted UNION preference passes through on the way in.
 *
 * A stored union fails from the opposite end to a stored DOCUMENT value. A doc
 * carrying a member the ladder has dropped is repaired or refused by the load
 * path; a PREFERENCE carrying one is simply stuck — no picker row names it, so
 * nothing but another rehydrate can ever write it, and it sits in localStorage
 * painting whatever its reader's fallback happens to be while the picker shows
 * a choice the user never made. The membership guard the ladder already carries
 * is what lets the store heal it instead, which it can only do on rehydrate.
 *
 * Three answers, and the third is the one that is easy to get wrong:
 *   - a stored member → itself, untouched;
 *   - a stored non-member → `fallback`, the store's own default;
 *   - ABSENT → `live`. A blob written before the field existed is not in
 *     violation of anything, and must keep the live value exactly as zustand's
 *     shallow merge alone would have.
 *
 * Call it from a `merge` hook, not from `migrate`: zustand runs `migrate` only
 * when the stored version differs from the configured one, so a gate placed
 * there would never see a blob written by the current build — which is every
 * blob that matters.
 */
export function healPersistedUnion<T>(
  stored: unknown,
  live: T,
  isMember: (v: unknown) => v is T,
  fallback: T,
): T {
  if (stored === undefined) return live;
  return isMember(stored) ? stored : fallback;
}
