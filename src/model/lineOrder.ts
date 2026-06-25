import { reconcileOrder } from './recordOrder';
import type { Line, LineId } from './types';

/**
 * Returns lineOrder reconciled against `lines`: filters out missing IDs and
 * appends any line IDs that aren't yet in the order. Use this everywhere you
 * read order so older persisted docs (without lineOrder) still work.
 */
export function effectiveLineOrder(
  lineOrder: LineId[] | undefined,
  lines: Record<LineId, Line>,
): LineId[] {
  return reconcileOrder(lines, lineOrder ?? []);
}
