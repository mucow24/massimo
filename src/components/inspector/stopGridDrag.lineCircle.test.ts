import { describe, it, expect } from 'vitest';
import { makeStation, makeStop } from '../../test/fixtures';
import {
  rotRad,
  stationCellToWorld,
  stationFrameRad,
  stopCenterAt,
} from '../../geometry/orientation';
import { cursorCellAt } from './stopGridDrag';
import type { Rotation } from '../../model/types';

/**
 * Reading a cell back out of the world has to undo exactly what put it there.
 * On a ring-bound station that is the RING frame, so a cursor parked on a
 * station's own lane-2 cell must resolve to (0, 2) — through the rounded octant
 * it lands on a fractional cell nowhere near it, and the ghost lattice snaps
 * the dragged node to the wrong slot.
 */

const CX = 100;
const CY = 100;
const R = 70;
const THETA = Math.PI / 8; // between two octants: maximal frame divergence
const SEAT_ROTATION: Rotation = 1;

const circle = { x: CX, y: CY, radius: R };
const st = makeStation({
  id: 's1',
  x: CX + R * Math.cos(THETA),
  y: CY + R * Math.sin(THETA),
  rotation: SEAT_ROTATION,
  circleId: 'c1',
  stops: [makeStop('l1', { viaCircle: true })],
});

describe('cursorCellAt', () => {
  it('the fixture sits off the octants (else the two frames agree)', () => {
    expect(Math.abs(stationFrameRad(st, circle) - rotRad(st.rotation))).toBeGreaterThan(0.3);
  });

  it('round-trips a bound station cell through the ring frame', () => {
    const world = stationCellToWorld(stopCenterAt(1, 2), st, circle);
    const cell = cursorCellAt(st, world, circle);
    expect(cell.row).toBeCloseTo(1, 9);
    expect(cell.col).toBeCloseTo(2, 9);
  });

  it('is unchanged off a ring — the octant IS the frame there', () => {
    const free = makeStation({ id: 'f', x: 50, y: 20, rotation: 3 });
    const world = stationCellToWorld(stopCenterAt(-1, 2), free, null);
    const cell = cursorCellAt(free, world, null);
    expect(cell.row).toBeCloseTo(-1, 9);
    expect(cell.col).toBeCloseTo(2, 9);
  });
});
