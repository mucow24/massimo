import { describe, it, expect } from 'vitest';
import { svgImagesForRect } from './stationBoundary';
import { makeSvgImage } from '../test/fixtures';

// A 100×60 image centered at (0,0) → world corners at (±50, ±30).
describe('svgImagesForRect', () => {
  it('selects an image whose footprint overlaps the rect', () => {
    const images = { i0: makeSvgImage({ id: 'i0' }) };
    expect(svgImagesForRect(images, { x0: 40, y0: 20, x1: 60, y1: 40 })).toEqual(['i0']);
  });

  it('does not select an image the rect misses entirely', () => {
    const images = { i0: makeSvgImage({ id: 'i0' }) };
    expect(svgImagesForRect(images, { x0: 200, y0: 200, x1: 300, y1: 300 })).toEqual([]);
  });

  it('excludes locked images from marquee selection', () => {
    const images = { i0: makeSvgImage({ id: 'i0', locked: true }) };
    expect(svgImagesForRect(images, { x0: -100, y0: -100, x1: 100, y1: 100 })).toEqual([]);
  });

  it('uses the rotated footprint: a rect over a rotated corner hits', () => {
    // Rotated 45°, the bottom-left corner swings out to (~ -56.6, -14.1) —
    // beyond the unrotated box's left edge (x = -50), so a rect there only
    // overlaps because the footprint is rotated.
    const images = { i0: makeSvgImage({ id: 'i0', rotation: 45 }) };
    const hit = svgImagesForRect(images, { x0: -58, y0: -16, x1: -54, y1: -12 });
    expect(hit).toEqual(['i0']);
  });
});
