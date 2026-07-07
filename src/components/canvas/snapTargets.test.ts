import { describe, it, expect } from 'vitest';
import { alignTargets, textLabelAlignPoints } from './snapTargets';
import { stopPosWorld } from '../../geometry/interlining';
import { svgImageCorners } from '../../geometry/svgImage';
import { measureTextLabel } from '../../geometry/textMeasure';
import {
  makeDoc,
  makePolygon,
  makeRouteBullet,
  makeStation,
  makeStop,
  makeSvgImage,
  makeTextLabel,
} from '../../test/fixtures';

describe('textLabelAlignPoints', () => {
  it('emits the visible UL corner, center, and LR corner (no hit pad) for an unrotated label', () => {
    const label = makeTextLabel({ id: 't0', x: 50, y: 40 });
    const m = measureTextLabel(label);
    expect(m.width).toBeGreaterThan(0); // guard: measurement must be live in tests
    expect(textLabelAlignPoints(label)).toEqual([
      { x: 50 - m.width / 2, y: 40 - m.height / 2 },
      { x: 50, y: 40 },
      { x: 50 + m.width / 2, y: 40 + m.height / 2 },
    ]);
  });

  it('rotates the corner points about the center (rotation 2 = 90° clockwise)', () => {
    const label = makeTextLabel({ id: 't0', x: 50, y: 40, rotation: 2 });
    const m = measureTextLabel(label);
    const hw = m.width / 2;
    const hh = m.height / 2;
    // 90° CW in the y-down frame maps local (x, y) → (−y, x): the UL corner
    // (−hw, −hh) lands at (hh, −hw), the LR corner mirrors it.
    const [ul, center, lr] = textLabelAlignPoints(label);
    expect(ul.x).toBeCloseTo(50 + hh, 6);
    expect(ul.y).toBeCloseTo(40 - hw, 6);
    expect(center).toEqual({ x: 50, y: 40 });
    expect(lr.x).toBeCloseTo(50 - hh, 6);
    expect(lr.y).toBeCloseTo(40 + hw, 6);
  });
});

describe('alignTargets', () => {
  it('emits stop centers for stop-bearing stations and the anchor for stopless ones', () => {
    const bare = makeStation({ id: 'a', x: 12, y: -7 });
    const withStop = makeStation({ id: 'b', x: 100, y: 50, stops: [makeStop('L1')] });
    const out = alignTargets(makeDoc({ stations: [bare, withStop] }));
    expect(out).toContainEqual({ x: 12, y: -7 });
    expect(out).toContainEqual(stopPosWorld(withStop.stops[0], withStop));
    expect(out).toHaveLength(2);
  });

  it('emits every polygon vertex', () => {
    const p0 = makePolygon({
      id: 'p0',
      vertices: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
    });
    const out = alignTargets(makeDoc({ polygons: [p0] }));
    expect(out).toContainEqual({ x: 0, y: 0 });
    expect(out).toContainEqual({ x: 10, y: 0 });
    expect(out).toHaveLength(2);
  });

  it('emits all four rotated corners of every svg image', () => {
    const img = makeSvgImage({ id: 'i0', x: 200, y: 100, rotation: 30 });
    expect(alignTargets(makeDoc({ svgImages: [img] }))).toEqual(svgImageCorners(img));
  });

  it('emits the three label points per text label', () => {
    const label = makeTextLabel({ id: 't0', x: 50, y: 40 });
    expect(alignTargets(makeDoc({ textLabels: [label] }))).toEqual(textLabelAlignPoints(label));
  });

  it('emits route bullet centers', () => {
    const out = alignTargets(
      makeDoc({ routeBullets: [makeRouteBullet({ id: 'b0', x: 7, y: 8 })] }),
    );
    expect(out).toEqual([{ x: 7, y: 8 }]);
  });

  it('excludes items per kind so dragged/co-selected items never self-target', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 's0', x: 1, y: 1 }), makeStation({ id: 's1', x: 2, y: 2 })],
      polygons: [
        makePolygon({ id: 'p0', vertices: [{ x: 3, y: 3 }] }),
        makePolygon({ id: 'p1', vertices: [{ x: 4, y: 4 }] }),
      ],
      svgImages: [makeSvgImage({ id: 'i0' })],
      textLabels: [makeTextLabel({ id: 't0', x: 60, y: 60 })],
      routeBullets: [makeRouteBullet({ id: 'b0', x: 5, y: 5 })],
    });
    const out = alignTargets(doc, {
      stationIds: new Set(['s0']),
      polygonIds: new Set(['p1']),
      svgImageIds: new Set(['i0']),
      labelIds: new Set(['t0']),
      bulletIds: new Set(['b0']),
    });
    expect(out).toEqual([
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ]);
  });
});
