import { describe, it, expect } from 'vitest';
import { computeContentBounds } from './contentBounds';
import {
  makeDoc,
  makePolygon,
  makeRouteBullet,
  makeTextLabel,
  stationWithStop,
} from '../test/fixtures';

describe('computeContentBounds', () => {
  it('returns null for an empty map', () => {
    expect(computeContentBounds(makeDoc({}))).toBeNull();
  });

  it('bounds a single polygon to its vertices exactly', () => {
    const doc = makeDoc({
      polygons: [
        makePolygon({
          id: 'p',
          vertices: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 50 },
            { x: 0, y: 50 },
          ],
        }),
      ],
    });
    expect(computeContentBounds(doc)).toEqual({ x: 0, y: 0, w: 100, h: 50 });
  });

  it('bounds a route bullet to a size-radius box around its center', () => {
    const doc = makeDoc({ routeBullets: [makeRouteBullet({ id: 'b', x: 200, y: 200, size: 10 })] });
    expect(computeContentBounds(doc)).toEqual({ x: 190, y: 190, w: 20, h: 20 });
  });

  it('unions every content type into one box', () => {
    const doc = makeDoc({
      polygons: [
        makePolygon({
          id: 'p',
          vertices: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 50 },
            { x: 0, y: 50 },
          ],
        }),
      ],
      routeBullets: [makeRouteBullet({ id: 'b', x: 300, y: 300, size: 10 })],
    });
    const box = computeContentBounds(doc)!;
    // Spans the polygon's origin corner to the bullet's far corner.
    expect(box.x).toBe(0);
    expect(box.y).toBe(0);
    expect(box.x + box.w).toBe(310);
    expect(box.y + box.h).toBe(310);
  });

  it('includes a far-flung station in the bounds', () => {
    const box = computeContentBounds(
      makeDoc({ stations: [stationWithStop('A', 'l1', { x: 1000, y: 500 })] }),
    )!;
    // The box must sit out where the station is, not back at the origin.
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    expect(cx).toBeGreaterThan(900);
    expect(cx).toBeLessThan(1100);
    expect(cy).toBeGreaterThan(400);
    expect(cy).toBeLessThan(600);
  });

  it('grows the box when a text label extends past the other content', () => {
    const withoutLabel = computeContentBounds(
      makeDoc({ routeBullets: [makeRouteBullet({ id: 'b', x: 0, y: 0, size: 5 })] }),
    )!;
    const withLabel = computeContentBounds(
      makeDoc({
        routeBullets: [makeRouteBullet({ id: 'b', x: 0, y: 0, size: 5 })],
        textLabels: [makeTextLabel({ id: 't', x: 500, y: 0, text: 'Far away' })],
      }),
    )!;
    expect(withLabel.x + withLabel.w).toBeGreaterThan(withoutLabel.x + withoutLabel.w);
  });
});
