import { describe, it, expect } from 'vitest';
import { makeLabel, makeLineCircle, makeStation, makeStop } from '../test/fixtures';
import { rotRad, stationCellToWorld, stationFrameRad, stopCenterAt } from './orientation';
import { localToWorld } from './orientation';
import { stationsForRect } from './stationBoundary';
import { stationWorldAABB } from './itemBounds';
import type { Rotation } from '../model/types';

/**
 * A ring-bound station's selection geometry follows the ring frame, because
 * that is the frame its cells were placed through (`stationFrameRad`). Pinned
 * from both sides: a probe where the name IS painted selects it, and a probe
 * where the OCTANT frame would have put the name does not — a one-sided test
 * would stay green on a box merely grown wide enough to cover both.
 *
 * The seat is θ = 22.5°, exactly between two octants, so the two frames
 * disagree maximally; `divergentSeat` fails loudly if a fixture edit ever
 * lands it back on an octant, where every assertion here is free.
 */

const CX = 100;
const CY = 100;
const R = 70;
const THETA = Math.PI / 8;
const SEAT_ROTATION: Rotation = 1; // the upright tangent octant at THETA
// Far enough out that the two frames' label boxes are disjoint, not merely
// offset — the negative probe below needs the miss to be unambiguous.
const LABEL_COL = 6;

const circle = { x: CX, y: CY, radius: R };
const lineCircles = { c1: makeLineCircle({ id: 'c1', x: CX, y: CY, radius: R }) };

const st = makeStation({
  id: 's1',
  name: 'Southfields',
  x: CX + R * Math.cos(THETA),
  y: CY + R * Math.sin(THETA),
  rotation: SEAT_ROTATION,
  circleId: 'c1',
  stops: [makeStop('l1', { viaCircle: true })],
  label: makeLabel({ row: 0, col: LABEL_COL, align: 'middle' }),
});

const labelCell = stopCenterAt(0, LABEL_COL);
/** Where the name is painted: the label cell through the RING frame. */
const ringPoint = stationCellToWorld(labelCell, st, circle);
/** Where it used to be painted: the same cell through the rounded octant. */
const octantPoint = localToWorld(labelCell, st);

const probe = (p: { x: number; y: number }) => ({
  x0: p.x - 2,
  y0: p.y - 2,
  x1: p.x + 2,
  y1: p.y + 2,
});

it('the fixture sits off the octants (else everything below passes for free)', () => {
  expect(Math.abs(stationFrameRad(st, circle) - rotRad(st.rotation))).toBeGreaterThan(0.3);
  expect(Math.hypot(ringPoint.x - octantPoint.x, ringPoint.y - octantPoint.y)).toBeGreaterThan(20);
});

describe('stationsForRect on a ring-bound station', () => {
  it('catches a marquee over the box the name is actually painted in', () => {
    expect(stationsForRect({ s1: st }, probe(ringPoint), lineCircles)).toEqual(['s1']);
  });

  it('does not catch one over the octant-frame ghost of that box', () => {
    expect(stationsForRect({ s1: st }, probe(octantPoint), lineCircles)).toEqual([]);
  });
});

describe('stationWorldAABB on a ring-bound station', () => {
  it('frames the painted name, so camera fit and export bounds do not clip it', () => {
    const b = stationWorldAABB(st, circle);
    expect(ringPoint.x).toBeGreaterThanOrEqual(b.x0);
    expect(ringPoint.x).toBeLessThanOrEqual(b.x1);
    expect(ringPoint.y).toBeGreaterThanOrEqual(b.y0);
    expect(ringPoint.y).toBeLessThanOrEqual(b.y1);
  });
});
