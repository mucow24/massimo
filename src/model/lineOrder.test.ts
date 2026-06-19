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

  it('filters out ids whose line no longer exists', () => {
    const lines = linesFrom(['l0', 'l2']);
    const result = effectiveLineOrder(['l0', 'l1', 'l2'] as LineId[], lines);
    // l1 is dead — dropped. Surviving ids keep their declared order.
    expect(result).toEqual(['l0', 'l2']);
  });

  it('appends line keys missing from the order, after the declared ones', () => {
    const lines = linesFrom(['l0', 'l1', 'l2']);
    const result = effectiveLineOrder(['l2', 'l0'] as LineId[], lines);
    // Declared order preserved (l2, l0), then the missing l1 appended.
    expect(result).toEqual(['l2', 'l0', 'l1']);
  });
});
