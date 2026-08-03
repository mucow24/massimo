import { describe, it, expect } from 'vitest';
import {
  effectiveBackgroundOrder,
  moveBackgroundUp,
  moveBackgroundDown,
  moveBackgroundToTop,
  moveBackgroundToBottom,
} from './transforms';
import { makeDoc, makePolygon, makeSvgImage } from '../test/fixtures';

// Polygons and svg images share ONE z-stack (`backgroundOrder`), so the order
// algebra is kind-agnostic: one pair of move transforms drives both, and a
// swap can cross kinds. The per-kind wiring (which add/delete touches the
// order) lives in transforms.polygon.test.ts / transforms.svgImage.test.ts.

const mixed = () =>
  makeDoc({
    polygons: [makePolygon({ id: 'p0' })],
    svgImages: [makeSvgImage({ id: 'i0' })],
    backgroundOrder: ['p0', 'i0'], // image on top
  });

describe('background-order transforms', () => {
  it('moves a polygon up past an image (the two kinds share one stack)', () => {
    expect(moveBackgroundUp(mixed(), 'p0').backgroundOrder).toEqual(['i0', 'p0']);
  });

  it('moves an image down past a polygon', () => {
    expect(moveBackgroundDown(mixed(), 'i0').backgroundOrder).toEqual(['i0', 'p0']);
  });

  it('swaps neighbours of the same kind too', () => {
    const doc = makeDoc({
      polygons: [makePolygon({ id: 'a' }), makePolygon({ id: 'b' })],
      backgroundOrder: ['a', 'b'],
    });
    expect(moveBackgroundUp(doc, 'a').backgroundOrder).toEqual(['b', 'a']);
    expect(moveBackgroundDown(doc, 'b').backgroundOrder).toEqual(['b', 'a']);
  });

  // No-ops return the SAME doc reference (not just an equal order) — history
  // grouping keys off reference identity to skip a spurious undo entry for a
  // boundary click that changed nothing.
  it('no-ops at either end return the same doc reference', () => {
    const doc = mixed();
    expect(moveBackgroundUp(doc, 'i0')).toBe(doc); // already top
    expect(moveBackgroundDown(doc, 'p0')).toBe(doc); // already bottom
  });

  it('no-ops for an id that is neither a polygon nor an image', () => {
    const doc = mixed();
    expect(moveBackgroundUp(doc, 'nope')).toBe(doc);
    expect(moveBackgroundDown(doc, 'nope')).toBe(doc);
  });

  // The to-top/to-bottom pair clears the whole band in one click. A three-deep
  // stack is the smallest one that tells them apart from the single-step pair:
  // from the middle, one step and all-the-way land on different orders.
  const deep = () =>
    makeDoc({
      polygons: [makePolygon({ id: 'p0' }), makePolygon({ id: 'p1' })],
      svgImages: [makeSvgImage({ id: 'i0' })],
      backgroundOrder: ['p0', 'p1', 'i0'], // image on top
    });

  it('moves a polygon from the middle to the top, past every kind above it', () => {
    expect(moveBackgroundToTop(deep(), 'p1').backgroundOrder).toEqual(['p0', 'i0', 'p1']);
  });

  it('moves an image from the top to the bottom, under every kind below it', () => {
    expect(moveBackgroundToBottom(deep(), 'i0').backgroundOrder).toEqual(['i0', 'p0', 'p1']);
  });

  it('travels further than the single-step pair from the same start', () => {
    expect(moveBackgroundToTop(deep(), 'p0').backgroundOrder).toEqual(['p1', 'i0', 'p0']);
    expect(moveBackgroundUp(deep(), 'p0').backgroundOrder).toEqual(['p1', 'p0', 'i0']);
  });

  it('to-top/to-bottom no-op at either end returns the same doc reference', () => {
    const doc = deep();
    expect(moveBackgroundToTop(doc, 'i0')).toBe(doc); // already top
    expect(moveBackgroundToBottom(doc, 'p0')).toBe(doc); // already bottom
  });

  it('to-top/to-bottom no-op for an id that is neither a polygon nor an image', () => {
    const doc = deep();
    expect(moveBackgroundToTop(doc, 'nope')).toBe(doc);
    expect(moveBackgroundToBottom(doc, 'nope')).toBe(doc);
  });

  it('effectiveBackgroundOrder drops stale ids and appends missing records', () => {
    const polygons = { p0: makePolygon({ id: 'p0' }), p1: makePolygon({ id: 'p1' }) };
    const svgImages = { i0: makeSvgImage({ id: 'i0' }), i1: makeSvgImage({ id: 'i1' }) };
    // Stored order references a dead id and omits p1/i1 entirely.
    expect(effectiveBackgroundOrder(polygons, svgImages, ['i0', 'gone', 'p0'])).toEqual([
      'i0',
      'p0',
      'p1',
      'i1',
    ]);
  });

  it('appends polygons before images, reproducing the pre-merge stacking', () => {
    // A doc whose order is empty (legacy save, or a record added in a race)
    // must fall back to every image sitting above every polygon — what the two
    // separate arrays used to render.
    const polygons = { p0: makePolygon({ id: 'p0' }) };
    const svgImages = { i0: makeSvgImage({ id: 'i0' }) };
    expect(effectiveBackgroundOrder(polygons, svgImages, [])).toEqual(['p0', 'i0']);
  });
});
