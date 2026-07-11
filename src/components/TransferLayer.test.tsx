import { describe, it, expect } from 'vitest';
import { capsuleOutlinePath, transferEndWorld } from './TransferLayer';
import { STOP_SIZE } from '../geometry/orientation';
import { makeStation, makeStop } from '../test/fixtures';

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

describe('transferEndWorld', () => {
  it('returns the station anchor when lineId is null', () => {
    const st = makeStation({ id: 's1', x: 100, y: 200 });
    const w = transferEndWorld(st, null);
    expect(w).toEqual({ x: 100, y: 200 });
  });

  it('returns the cell-grid position for a cardinal stop', () => {
    const st = makeStation({
      id: 's1',
      x: 0,
      y: 0,
      rotation: 0,
      stops: [makeStop('L1', { row: 0, col: 0, orientation: 'auto-vertical' })],
    });
    const w = transferEndWorld(st, 'L1');
    expect(w).toEqual({ x: 0, y: 0 });
  });

  it('returns the cell-grid position for a diagonal stop, no compression', () => {
    // Two perp-adjacent auto-ne-sw stops. L1's rendered position is its
    // literal cell position — STOP_SIZE·√2 from L2, not the band stripe
    // pitch. No neighbor-aware nudging is applied.
    const st = makeStation({
      id: 's1',
      x: 0,
      y: 0,
      rotation: 0,
      stops: [
        makeStop('L1', { row: 0, col: 0, orientation: 'auto-ne-sw' }),
        makeStop('L2', { row: 1, col: 1, orientation: 'auto-ne-sw' }),
      ],
    });
    const w1 = transferEndWorld(st, 'L1');
    const w2 = transferEndWorld(st, 'L2');
    expect(w1).toEqual({ x: 0, y: 0 });
    expect(w2).toEqual({ x: STOP_SIZE, y: STOP_SIZE });
  });

  it('falls back to the station anchor when the line is not on this station', () => {
    const st = makeStation({
      id: 's1',
      x: 50,
      y: 75,
      stops: [makeStop('L1')],
    });
    // Query a line that doesn't exist on this station — should return anchor.
    const w = transferEndWorld(st, 'GHOST');
    expect(w).toEqual({ x: 50, y: 75 });
  });
});
