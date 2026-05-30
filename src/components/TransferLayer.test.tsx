import { describe, it, expect } from 'vitest';
import { transferEndWorld } from './TransferLayer';
import { STOP_SIZE } from '../geometry/orientation';
import { makeStation, makeStop } from '../test/fixtures';

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
