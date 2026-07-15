import { describe, it, expect } from 'vitest';
import {
  addSvgImage,
  updateSvgImage,
  deleteSvgImage,
  setSvgImageCenter,
  rotateItemsAround,
  buildRotateMembers,
} from './transforms';
import { makeDoc, makeSvgImage } from '../test/fixtures';

describe('svg-image transforms', () => {
  it('addSvgImage inserts the image and appends it to the paint order', () => {
    const doc = makeDoc({});
    const out = addSvgImage(doc, 'i0', {
      x: 5,
      y: 6,
      width: 80,
      height: 40,
      rotation: 0,
      href: 'd',
    });
    expect(out.svgImages.i0).toMatchObject({ id: 'i0', x: 5, y: 6 });
    expect(out.backgroundOrder).toEqual(['i0']);
  });

  it('updateSvgImage clamps width/height to the min and normalizes rotation', () => {
    const doc = makeDoc({ svgImages: [makeSvgImage({ id: 'i0' })] });
    expect(updateSvgImage(doc, 'i0', { width: 1 }).svgImages.i0.width).toBe(4);
    expect(updateSvgImage(doc, 'i0', { height: 0 }).svgImages.i0.height).toBe(4);
    expect(updateSvgImage(doc, 'i0', { rotation: 400 }).svgImages.i0.rotation).toBe(40);
    expect(updateSvgImage(doc, 'i0', { rotation: -10 }).svgImages.i0.rotation).toBe(350);
    // A value within range passes through untouched.
    expect(updateSvgImage(doc, 'i0', { width: 200 }).svgImages.i0.width).toBe(200);
  });

  it('updateSvgImage clamps opacity into the 0..1 alpha range', () => {
    const doc = makeDoc({ svgImages: [makeSvgImage({ id: 'i0' })] });
    expect(updateSvgImage(doc, 'i0', { opacity: 0.4 }).svgImages.i0.opacity).toBe(0.4);
    expect(updateSvgImage(doc, 'i0', { opacity: -1 }).svgImages.i0.opacity).toBe(0);
    expect(updateSvgImage(doc, 'i0', { opacity: 5 }).svgImages.i0.opacity).toBe(1);
    // Absent ⇒ fully opaque; a fresh image carries no opacity field at all.
    expect(doc.svgImages.i0.opacity).toBeUndefined();
  });

  it('setSvgImageCenter moves the image to an absolute center', () => {
    const doc = makeDoc({ svgImages: [makeSvgImage({ id: 'i0' })] });
    const out = setSvgImageCenter(doc, 'i0', 42, 99);
    expect(out.svgImages.i0).toMatchObject({ x: 42, y: 99 });
  });

  it('deleteSvgImage drops the image and its backgroundOrder entry', () => {
    const doc = makeDoc({ svgImages: [makeSvgImage({ id: 'i0' }), makeSvgImage({ id: 'i1' })] });
    const out = deleteSvgImage(doc, 'i0');
    expect(out.svgImages.i0).toBeUndefined();
    expect(out.backgroundOrder).toEqual(['i1']);
  });

  // The z-order algebra is kind-agnostic and shared with polygons — see
  // transforms.backgroundOrder.test.ts.

  it('group rotate orbits a member center and bumps every member rotation by 45°', () => {
    const doc = makeDoc({
      svgImages: [
        makeSvgImage({ id: 'a', x: 0, y: 0, rotation: 10 }),
        makeSvgImage({ id: 'b', x: 100, y: 0, rotation: 10 }),
      ],
    });
    const out = rotateItemsAround(
      doc,
      { type: 'svgImage', id: 'a' },
      buildRotateMembers([], [], [], [], ['a', 'b']),
    );
    // Pivot center fixed; rotation steps 10 → 55.
    expect(out.svgImages.a).toMatchObject({ x: 0, y: 0, rotation: 55 });
    // Member orbits 45° CW about the origin: (100,0) → (70.71, 70.71).
    expect(out.svgImages.b.x).toBeCloseTo(70.71068, 4);
    expect(out.svgImages.b.y).toBeCloseTo(70.71068, 4);
    expect(out.svgImages.b.rotation).toBe(55);
  });
});
