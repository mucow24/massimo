// Pure helpers and constants for the StopGrid drag/snap logic — kept out of
// the component so they can be unit-tested without React Testing Library,
// and consumed by Playwright e2e helpers without pulling in React.
import type { RowCol } from '../../geometry/lattice';

/** Inspector-local pixels per unit in row/col space. Circle radius =
 *  PITCH/2 so two nodes at unit distance are tangent in the editor. */
export const PITCH = 22;

const dist = (a: RowCol, b: RowCol): number => Math.hypot(a.row - b.row, a.col - b.col);

/** Closest node to the cursor by Euclidean distance in (row, col) space.
 *  Returns null for an empty input. */
export function nearestNode<T extends RowCol>(cursor: RowCol, nodes: readonly T[]): T | null {
  let best: T | null = null;
  let bestDist = Infinity;
  for (const n of nodes) {
    const d = dist(cursor, n);
    if (d < bestDist) {
      bestDist = d;
      best = n;
    }
  }
  return best;
}

export type DragSourceKind = 'stop' | 'label';
export type DropTarget =
  | { kind: 'ghost'; row: number; col: number }
  | { kind: 'stop'; row: number; col: number; lineId: string };

export interface DropOptions {
  /** Cursor distance below which a non-source stop becomes a swap target. */
  swapRadius: number;
  /** Cursor distance below which the nearest ghost becomes the snap target. */
  snapRadius: number;
}

/**
 * Two-tier snap rule:
 *
 *   1. If the source is a stop and the cursor lies INSIDE a non-source
 *      stop's circle (distance < swapRadius), that stop wins as a swap
 *      target. Labels never swap.
 *   2. Otherwise, the nearest ghost within snapRadius wins.
 *   3. Otherwise, no target.
 */
export function findDropTarget<S extends RowCol & { lineId: string }>(
  cursor: RowCol,
  source: { kind: DragSourceKind; lineId?: string },
  stops: readonly S[],
  ghosts: readonly RowCol[],
  opts: DropOptions,
): DropTarget | null {
  if (source.kind === 'stop') {
    for (const s of stops) {
      if (s.lineId === source.lineId) continue;
      if (dist(cursor, s) < opts.swapRadius) {
        return { kind: 'stop', row: s.row, col: s.col, lineId: s.lineId };
      }
    }
  }
  const nearest = nearestNode(cursor, ghosts);
  if (!nearest) return null;
  if (dist(cursor, nearest) >= opts.snapRadius) return null;
  return { kind: 'ghost', row: nearest.row, col: nearest.col };
}
