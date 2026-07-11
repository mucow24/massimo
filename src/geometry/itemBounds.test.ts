import { describe, it, expect } from 'vitest';
import {
  polygonAABB,
  routeBulletAABB,
  stationWorldAABB,
  svgImageAABB,
  textLabelAABB,
  transferAABB,
} from './itemBounds';
import { measureTextLabel } from './textMeasure';
import {
  makeRouteBullet,
  makeStation,
  makeStop,
  makeSvgImage,
  makeTextLabel,
} from '../test/fixtures';

const expectCloseAABB = (
  got: { x0: number; y0: number; x1: number; y1: number },
  want: { x0: number; y0: number; x1: number; y1: number },
) => {
  expect(got.x0).toBeCloseTo(want.x0, 9);
  expect(got.y0).toBeCloseTo(want.y0, 9);
  expect(got.x1).toBeCloseTo(want.x1, 9);
  expect(got.y1).toBeCloseTo(want.y1, 9);
};

describe('routeBulletAABB', () => {
  it('is the size-half-extent square around the center', () => {
    expect(routeBulletAABB(makeRouteBullet({ id: 'b', x: 10, y: -5, size: 12 }))).toEqual({
      x0: -2,
      y0: -17,
      x1: 22,
      y1: 7,
    });
  });
});

describe('transferAABB', () => {
  it('spans the endpoints grown by the half extent on every side', () => {
    expect(transferAABB({ x: 200, y: 0 }, { x: 0, y: 50 }, 4)).toEqual({
      x0: -4,
      y0: -4,
      x1: 204,
      y1: 54,
    });
  });
});

describe('polygonAABB', () => {
  it('min/maxes the vertices', () => {
    expect(
      polygonAABB([
        { x: 5, y: 2 },
        { x: -3, y: 9 },
        { x: 4, y: -1 },
      ]),
    ).toEqual({ x0: -3, y0: -1, x1: 5, y1: 9 });
  });
});

describe('svgImageAABB', () => {
  it('unrotated: center ± half size', () => {
    expect(svgImageAABB(makeSvgImage({ id: 'i', x: 10, y: 20 }))).toEqual({
      x0: -40,
      y0: -10,
      x1: 60,
      y1: 50,
    });
  });

  it('rotated 90°: width and height swap around the center', () => {
    expectCloseAABB(svgImageAABB(makeSvgImage({ id: 'i', x: 10, y: 20, rotation: 90 })), {
      x0: -20,
      y0: -30,
      x1: 40,
      y1: 70,
    });
  });
});

describe('textLabelAABB', () => {
  it('unrotated: measured box centered on (x, y), grown by pad on every side', () => {
    const label = makeTextLabel({ id: 'g', x: 100, y: 50, text: 'Hello' });
    const m = measureTextLabel(label);
    expectCloseAABB(textLabelAABB(label), {
      x0: 100 - m.width / 2,
      y0: 50 - m.height / 2,
      x1: 100 + m.width / 2,
      y1: 50 + m.height / 2,
    });
    expectCloseAABB(textLabelAABB(label, 4), {
      x0: 100 - m.width / 2 - 4,
      y0: 50 - m.height / 2 - 4,
      x1: 100 + m.width / 2 + 4,
      y1: 50 + m.height / 2 + 4,
    });
  });

  it('rotated 90° (rotation=2): measured width and height swap', () => {
    const flat = makeTextLabel({ id: 'g', x: 100, y: 50, text: 'Hello' });
    const m = measureTextLabel(flat);
    expectCloseAABB(
      textLabelAABB(makeTextLabel({ id: 'g', x: 100, y: 50, text: 'Hello', rotation: 2 })),
      {
        x0: 100 - m.height / 2,
        y0: 50 - m.width / 2,
        x1: 100 + m.height / 2,
        y1: 50 + m.width / 2,
      },
    );
  });
});

describe('stationWorldAABB', () => {
  it('waypoint with one stop: the padded stop cell translated to the station', () => {
    // Stop cell at local (0,0), half 7, HIT_PAD 2 → local [−9,9]²; +(100,50).
    const st = makeStation({
      id: 's',
      x: 100,
      y: 50,
      isWaypoint: true,
      stops: [makeStop('l1')],
    });
    expect(stationWorldAABB(st)).toEqual({ x0: 91, y0: 41, x1: 109, y1: 59 });
  });

  it('rotation carries the local box into world space', () => {
    // Two stops (cols 0,1): local x ∈ [−9,23], y ∈ [−9,9]. Rotation 2 (90°)
    // maps (x,y)→(−y,x) → x ∈ [−9,9], y ∈ [−9,23]; +(100,50).
    const st = makeStation({
      id: 's',
      x: 100,
      y: 50,
      rotation: 2,
      isWaypoint: true,
      stops: [makeStop('l1'), makeStop('l1', { col: 1 })],
    });
    expectCloseAABB(stationWorldAABB(st), { x0: 91, y0: 41, x1: 109, y1: 73 });
  });

  it('a named station is strictly wider than its waypoint twin (name label included)', () => {
    const wp = stationWorldAABB(
      makeStation({ id: 's', x: 100, y: 50, isWaypoint: true, stops: [makeStop('l1')] }),
    );
    const named = stationWorldAABB(
      makeStation({ id: 's', x: 100, y: 50, name: 'Alpha', stops: [makeStop('l1')] }),
    );
    // Contains the waypoint box…
    expect(named.x0).toBeLessThanOrEqual(wp.x0);
    expect(named.y0).toBeLessThanOrEqual(wp.y0);
    expect(named.x1).toBeGreaterThanOrEqual(wp.x1);
    expect(named.y1).toBeGreaterThanOrEqual(wp.y1);
    // …and the label cell (col −1) plus the painted name extend it left.
    expect(named.x0).toBeLessThan(wp.x0);
  });
});
