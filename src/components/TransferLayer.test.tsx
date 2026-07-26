import { describe, it, expect } from 'vitest';
import { capsuleOutlinePath } from './TransferLayer';

// The selected-transfer ring traces the OUTLINE of the transfer's capsule
// (round-capped line at radius r) — two edge-parallel segments joined by
// outward semicircle end caps. Sweep flags must bulge the caps AWAY from the
// segment; the wrong flag folds them inward across the body.
describe('capsuleOutlinePath', () => {
  it('traces a horizontal capsule with outward end caps', () => {
    const d = capsuleOutlinePath({ x: 0, y: 0 }, { x: 200, y: 0 }, 5);
    expect(d).toBe('M 0 5 L 200 5 A 5 5 0 0 0 200 -5 L 0 -5 A 5 5 0 0 0 0 5 Z');
  });

  it('traces a vertical capsule with outward end caps', () => {
    const d = capsuleOutlinePath({ x: 0, y: 0 }, { x: 0, y: 100 }, 5);
    expect(d).toBe('M -5 0 L -5 100 A 5 5 0 0 0 5 100 L 5 0 A 5 5 0 0 0 -5 0 Z');
  });

  it('degenerates to a circle when the endpoints coincide', () => {
    // A zero-length transfer renders as a round-cap dot; its outline is a
    // circle, not a NaN-laden capsule.
    const d = capsuleOutlinePath({ x: 10, y: 20 }, { x: 10, y: 20 }, 4);
    expect(d).toBe('M 14 20 A 4 4 0 1 0 6 20 A 4 4 0 1 0 14 20 Z');
  });
});
