import { describe, it, expect } from 'vitest';
import { stationAnchorWorld, stopWorld, transferEndWorld } from './transferEnds';
import { STOP_SIZE, type Rotation } from './orientation';
import { makeStation, makeStop } from '../test/fixtures';
import type { Station, TransferAnchor } from '../model/types';

// `stopWorld` was `transferEndWorld` in TransferLayer.tsx until transfer ends
// became a union; these cases moved with it unchanged.
describe('stopWorld', () => {
  it('returns the station anchor when lineId is null', () => {
    const st = makeStation({ id: 's1', x: 100, y: 200 });
    expect(stopWorld(st, null)).toEqual({ x: 100, y: 200 });
  });

  it('returns the cell-grid position for a cardinal stop', () => {
    const st = makeStation({
      id: 's1',
      x: 0,
      y: 0,
      rotation: 0,
      stops: [makeStop('L1', { row: 0, col: 0, orientation: 'auto-vertical' })],
    });
    expect(stopWorld(st, 'L1')).toEqual({ x: 0, y: 0 });
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
    expect(stopWorld(st, 'L1')).toEqual({ x: 0, y: 0 });
    expect(stopWorld(st, 'L2')).toEqual({ x: STOP_SIZE, y: STOP_SIZE });
  });

  it('falls back to the station anchor when the line is not on this station', () => {
    const st = makeStation({ id: 's1', x: 50, y: 75, stops: [makeStop('L1')] });
    expect(stopWorld(st, 'GHOST')).toEqual({ x: 50, y: 75 });
  });
});

describe('transferEndWorld', () => {
  const anchors: Record<string, TransferAnchor> = { free1: { id: 'free1', x: 31, y: -7 } };
  const hosted = (rotation: Rotation = 0): Record<string, Station> => ({
    s1: makeStation({
      id: 's1',
      x: 100,
      y: 200,
      rotation,
      stops: [makeStop('L1')],
      transferAnchors: [{ id: 'h1', row: 0, col: 1 }],
    }),
  });

  it('resolves a stop end through stopWorld', () => {
    expect(transferEndWorld({ stationId: 's1', lineId: 'L1' }, hosted(), {})).toEqual({
      x: 100,
      y: 200,
    });
  });

  it('resolves a free-anchor end to its world point', () => {
    expect(transferEndWorld({ anchorId: 'free1' }, {}, anchors)).toEqual({ x: 31, y: -7 });
  });

  it('resolves a hosted-anchor end through its station cell grid', () => {
    // col 1 on an unrotated station is one cell to the right of the anchor.
    expect(transferEndWorld({ stationId: 's1', anchorId: 'h1' }, hosted(), {})).toEqual({
      x: 100 + STOP_SIZE,
      y: 200,
    });
  });

  it('carries a hosted anchor around the station rotation', () => {
    // rotation 2 = 90° CW, so the +col direction points down the screen. This
    // is what makes a hosted anchor stay put relative to the stops it was
    // placed against when the whole station turns.
    const w = transferEndWorld({ stationId: 's1', anchorId: 'h1' }, hosted(2), {});
    expect(w!.x).toBeCloseTo(100);
    expect(w!.y).toBeCloseTo(200 + STOP_SIZE);
    expect(w).toEqual(stationAnchorWorld(hosted(2).s1, { row: 0, col: 1 }));
  });

  it('returns null for every flavour of dangling end', () => {
    // Null is what makes both paint passes drop the transfer, which is why no
    // load path needs a transfer-endpoint sanitizer.
    expect(transferEndWorld({ stationId: 'gone', lineId: null }, hosted(), {})).toBeNull();
    expect(transferEndWorld({ anchorId: 'gone' }, {}, anchors)).toBeNull();
    expect(transferEndWorld({ stationId: 's1', anchorId: 'gone' }, hosted(), {})).toBeNull();
    expect(transferEndWorld({ stationId: 'gone', anchorId: 'h1' }, hosted(), {})).toBeNull();
  });
});
