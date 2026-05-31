import { describe, it, expect } from 'vitest';
import { arrowTrianglePath } from './HighlightedLineLayer';

describe('arrowTrianglePath', () => {
  it('points along +x with the apex ahead of the base', () => {
    expect(arrowTrianglePath(0, 0, 1, 0, 10, 15, 3)).toBe('M 15 0 L 10 3 L 10 -3 Z');
  });

  it('points along +y (screen-down) with the base wings spread on x', () => {
    expect(arrowTrianglePath(0, 0, 0, 1, 10, 15, 3)).toBe('M 0 15 L -3 10 L 3 10 Z');
  });

  it('flips 180° when base/apex distances are swapped (apex behind the base)', () => {
    const fwd = arrowTrianglePath(0, 0, 1, 0, 10, 15, 3);
    const flipped = arrowTrianglePath(0, 0, 1, 0, 15, 10, 3);
    expect(flipped).toBe('M 10 0 L 15 3 L 15 -3 Z');
    expect(flipped).not.toBe(fwd);
  });

  it('translates with the origin', () => {
    expect(arrowTrianglePath(100, 50, 1, 0, 10, 15, 3)).toBe('M 115 50 L 110 53 L 110 47 Z');
  });
});
