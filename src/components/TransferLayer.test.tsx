import { describe, it, expect } from 'vitest';
import { transferEndWorld } from './TransferLayer';
import { computeRenderedStopPositions } from '../geometry/stopPositions';
import { STOP_SIZE } from '../geometry/orientation';
import { makeStation, makeStop } from '../test/fixtures';
import type { Station, StationId } from '../model/types';

const dictOf = (...sts: Station[]): Record<StationId, Station> => {
  const m: Record<StationId, Station> = {};
  for (const s of sts) m[s.id] = s;
  return m;
};

describe('transferEndWorld', () => {
  it('returns the station anchor when lineId is null', () => {
    const st = makeStation({ id: 's1', x: 100, y: 200 });
    const renderedPos = computeRenderedStopPositions(dictOf(st));
    const w = transferEndWorld(st, null, renderedPos);
    expect(w).toEqual({ x: 100, y: 200 });
  });

  it('returns the cell-grid position for a cardinal stop (no compression)', () => {
    const st = makeStation({
      id: 's1',
      x: 0,
      y: 0,
      rotation: 0,
      stops: [makeStop('L1', { row: 0, col: 0, orientation: 'auto-vertical' })],
    });
    const renderedPos = computeRenderedStopPositions(dictOf(st));
    const w = transferEndWorld(st, 'L1', renderedPos);
    expect(w).toEqual({ x: 0, y: 0 });
  });

  it('returns the compressed position for a stop in a diagonal interline group', () => {
    // Two perp-adjacent auto-ne-sw stops on the same station — a diagonal
    // interline group of 2. The L1 cell is at world (0, 0); compression
    // pulls it inward toward the centroid by STOP_SIZE·(√2−1)/2 along
    // the NW-SE perp axis.
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
    const renderedPos = computeRenderedStopPositions(dictOf(st));
    const w = transferEndWorld(st, 'L1', renderedPos);
    // Compression shift along NW-SE perp axis (SE = (√2/2, √2/2)).
    const shift = (STOP_SIZE * (Math.SQRT2 - 1)) / 2;
    const expectedX = shift * Math.SQRT1_2;
    const expectedY = shift * Math.SQRT1_2;
    expect(w.x).toBeCloseTo(expectedX, 5);
    expect(w.y).toBeCloseTo(expectedY, 5);
    // Sanity: the compressed position is NOT the cell-grid position.
    expect(w.x).not.toBe(0);
    expect(w.y).not.toBe(0);
  });

  it('falls back to the station anchor when the line is not on this station', () => {
    const st = makeStation({
      id: 's1',
      x: 50,
      y: 75,
      stops: [makeStop('L1')],
    });
    const renderedPos = computeRenderedStopPositions(dictOf(st));
    // Query a line that doesn't exist on this station — should return anchor.
    const w = transferEndWorld(st, 'GHOST', renderedPos);
    expect(w).toEqual({ x: 50, y: 75 });
  });
});
