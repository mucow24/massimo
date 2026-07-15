// Shared z-order algebra for the keyed record collections that carry an
// explicit paint order alongside the records themselves (lines, polygons, svg
// images). Each used to hand-roll the identical reconcile/move logic; this is
// the single source of truth they now delegate to. The array↔paint mapping is
// the CALLER's convention: polygons/svg images paint later-in-array on top,
// while lineOrder is inverted (index 0 renders last = on top; see types.ts).

/**
 * Reconcile a stored paint order against the records that actually exist: drop
 * ids whose record is gone, then append any record ids missing from the order
 * (legacy saves without an order, or a race between add and order update) so
 * nothing ever silently drops out.
 */
export function reconcileOrder(records: Record<string, unknown>, order: string[]): string[] {
  const existing = order.filter((id) => records[id]);
  const seen = new Set(existing);
  const missing = Object.keys(records).filter((id) => !seen.has(id));
  return [...existing, ...missing];
}

/**
 * Swap the element `id` one step toward the end (`dir: +1`) or the start
 * (`dir: -1`) of `order`. What that means for the paint order is the caller's
 * convention (see the module header). Returns the SAME array reference when
 * the move is a no-op (id absent, or already at the respective end) so callers
 * can detect "nothing changed".
 */
export function moveInOrder(order: string[], id: string, dir: 1 | -1): string[] {
  const i = order.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return order;
  const next = order.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/**
 * Move `id` all the way to the end (`dir: +1`) or the start (`dir: -1`) of
 * `order`, sliding everything it passes along by one. The jump-to-the-end
 * counterpart of {@link moveInOrder}, with the same caller-side paint
 * convention and the same same-reference-on-no-op contract (id absent, or
 * already at the respective end).
 */
export function moveToEndInOrder(order: string[], id: string, dir: 1 | -1): string[] {
  const i = order.indexOf(id);
  if (i < 0 || i === (dir === 1 ? order.length - 1 : 0)) return order;
  const rest = order.filter((x) => x !== id);
  return dir === 1 ? [...rest, id] : [id, ...rest];
}
