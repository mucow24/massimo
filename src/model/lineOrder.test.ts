import { describe, it, expect } from 'vitest';
import { effectiveLineOrder } from './lineOrder';
import { makeLine } from '../test/fixtures';
import type { Line, LineId } from './types';

// Build a `Record<LineId, Line>` from a list of ids — only the keys matter to
// effectiveLineOrder, so the line bodies are minimal.
const linesFrom = (ids: string[]): Record<LineId, Line> => {
  const out: Record<LineId, Line> = {};
  for (const id of ids) out[id as LineId] = makeLine({ id: id as LineId });
  return out;
};

describe('effectiveLineOrder', () => {
  it('falls back to the line keys when order is undefined (legacy doc)', () => {
    const lines = linesFrom(['l0', 'l1', 'l2']);
    const result = effectiveLineOrder(undefined, lines);
    // Order is the insertion order of Object.keys for the appended branch.
    expect(result).toEqual(['l0', 'l1', 'l2']);
  });

  // The filter-dead-ids and append-missing rules are reconcileOrder's, and
  // effectiveLineOrder is a one-line delegate to it — they are pinned at
  // recordOrder.test.ts:12 and :16. Only the `?? []` fallback above is this
  // function's own behaviour.
});
