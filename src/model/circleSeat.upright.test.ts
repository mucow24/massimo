import { describe, expect, it } from 'vitest';
import { makeDoc, makeLabel, makeLineCircle, makeStation, makeStop } from '../test/fixtures';
import { moveStation } from './transforms';
import { pointAtAngle } from '../geometry/lineCircle';
import { stationFrameDeg } from '../geometry/orientation';
import type { MapDoc, Rotation } from '../model/types';

/**
 * WHERE a bound station's name flips end-for-end as it is dragged round the rim.
 *
 * `circleSeat` picks the tangent octant or its opposite — identical geometry,
 * opposite reading direction — so that the name never renders upside down. That
 * choice has to be judged on the angle the name is actually PAINTED at, and a
 * bound station paints through the ring frame (the true tangent) rather than the
 * rounded octant. Judge the octant and the flip fires up to 22.5° early: the
 * name spins round halfway through a drag while still reading at a plainly
 * upright 112.5°.
 *
 * Both directions are pinned below — the flip must not fire early, and must
 * still fire — because a rule that simply never flipped would pass the first
 * assertion alone.
 */

const CX = 100;
const CY = 100;
const R = 70;
const CIRCLE = makeLineCircle({ id: 'c1', x: CX, y: CY, radius: R });

// The reading angles a label renders upside down at, as one continuous band:
// the octant set {3, 4, 5} (135° / 180° / 225°) with its endpoints included.
const UPSIDE_DOWN_MIN = 135;
const UPSIDE_DOWN_MAX = 225;

function seatedAt(theta: number, labelRotation: Rotation = 0): MapDoc {
  const doc = makeDoc({
    stations: [
      makeStation({
        id: 's1',
        x: CX + R,
        y: CY,
        rotation: 0,
        circleId: 'c1',
        stops: [makeStop('l1', { viaCircle: true })],
        label: makeLabel({ row: 0, col: -1, rotation: labelRotation }),
      }),
    ],
    lineCircles: [CIRCLE],
  });
  const p = pointAtAngle(CIRCLE, theta);
  return moveStation(doc, 's1', p.x, p.y);
}

/** The angle the NAME reads at, in world degrees: the station's frame plus the
 *  label's own rotation — exactly what `StationLabel` composes to paint it. */
function readingDeg(doc: MapDoc, labelRotation: Rotation = 0): number {
  const st = doc.stations.s1;
  const deg = stationFrameDeg(st, CIRCLE) + labelRotation * 45;
  return ((deg % 360) + 360) % 360;
}

const rad = (deg: number) => (deg * Math.PI) / 180;

describe('the label-uprightness flip fires where the name would really turn over', () => {
  it('leaves a seat whose name reads at 120° alone — that is upright', () => {
    // The tangent octant here is 3 (135°), so judging the OCTANT reads this as
    // upside down and flips; the name is painted at the frame's 120°, which is
    // not.
    expect(readingDeg(seatedAt(rad(120)))).toBeCloseTo(120, 6);
  });

  it('still flips a seat whose name would read at 140°', () => {
    // Past the turnover: the un-flipped reading is 140°, so the seat must take
    // the opposite octant and read at 320° instead.
    expect(readingDeg(seatedAt(rad(140)))).toBeCloseTo(320, 6);
  });

  it('never leaves a name upside down, at any seat or label rotation', () => {
    for (let labelRotation = 0; labelRotation < 8; labelRotation++) {
      for (let deg = 0; deg < 360; deg += 1) {
        const r = labelRotation as Rotation;
        const read = readingDeg(seatedAt(rad(deg), r), r);
        expect(
          read > UPSIDE_DOWN_MIN + 1e-9 && read < UPSIDE_DOWN_MAX - 1e-9,
          `seat ${deg}°, label rotation ${r}: name reads at ${read}°`,
        ).toBe(false);
      }
    }
  });

  it('uses the whole upright window, not the 180° the octant rule can reach', () => {
    // A rule that flips on the OCTANT can only ever paint inside a 180° window
    // (each seat offers exactly two opposite readings, and it picks by the
    // rounded one). Judging the true frame widens that to the full 270° the
    // band leaves free — so readings in (112.5°, 135°) become reachable, and
    // they are precisely the ones the early flip used to throw away.
    const reachable = [];
    for (let deg = 0; deg < 360; deg += 1) {
      const read = readingDeg(seatedAt(rad(deg)));
      if (read > 112.5 && read < UPSIDE_DOWN_MIN) reachable.push(read);
    }
    expect(reachable.length).toBeGreaterThan(0);
  });
});
