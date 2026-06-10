import { describe, it, expect } from 'vitest';
import { computeStripeOutline } from './stripeOutline';
import type { SegmentBandSpec } from './interlining';
import { makeBandSpec } from '../test/fixtures';

// Minimal vertical band from (0,0)→(0,100), 1 stripe, radius 24. Re-used
// across every case here so the assertions only have to reason about the
// adjustment values.
const band: SegmentBandSpec = makeBandSpec(['A'], {
  paths: ['M0,0 L0,100'],
  centerline: [
    { x: 0, y: 0 },
    { x: 0, y: 100 },
  ],
});

describe('computeStripeOutline — endpoint adjustments', () => {
  it('caps at the centerline endpoints when no adjustments are given', () => {
    const out = computeStripeOutline(band, 0)!;
    // capStart at y=0 (v0), capEnd at y=100 (vN1). Cap line x-coords are
    // at ±HALF = ±7 (perpendicular to the vertical centerline).
    expect(out.capStart.y1).toBeCloseTo(0, 5);
    expect(out.capStart.y2).toBeCloseTo(0, 5);
    expect(out.capEnd.y1).toBeCloseTo(100, 5);
    expect(out.capEnd.y2).toBeCloseTo(100, 5);
  });

  it('extends both caps outward when both adjustments are positive (win/win)', () => {
    const out = computeStripeOutline(band, 0, { start: 7, end: 7 })!;
    // Tangent at v0 = (0, +1) so outward = (0, -1): capStart slides to y=-7.
    // Tangent at vN1 = (0, +1) so outward = (0, +1): capEnd slides to y=107.
    expect(out.capStart.y1).toBeCloseTo(-7, 5);
    expect(out.capEnd.y1).toBeCloseTo(107, 5);
  });

  it('retreats inward when adjustments are negative (lose)', () => {
    const out = computeStripeOutline(band, 0, { start: -7, end: -7 })!;
    expect(out.capStart.y1).toBeCloseTo(7, 5);
    expect(out.capEnd.y1).toBeCloseTo(93, 5);
  });

  it('handles mixed adjustments (win at start, lose at end)', () => {
    const out = computeStripeOutline(band, 0, { start: 7, end: -7 })!;
    expect(out.capStart.y1).toBeCloseTo(-7, 5);
    expect(out.capEnd.y1).toBeCloseTo(93, 5);
  });

  it('returns null on a degenerate (< 2-vertex) centerline', () => {
    const degenerate: SegmentBandSpec = {
      ...band,
      centerline: [{ x: 0, y: 0 }],
    };
    expect(computeStripeOutline(degenerate, 0)).toBeNull();
  });

  it('derives the stripe edges from the baked offsets and per-stripe widths', () => {
    // Mixed band [14, 28]: offsets ±10.5. Each stripe's outline must hug its
    // OWN width (edge spread = width) centered on its OWN baked offset — not
    // the uniform STOP_SIZE/2 ± stripeOffset(k, n) legacy math.
    const mixed = makeBandSpec(['A', 'B'], {
      stripeWidths: [14, 28],
      paths: ['M0,0 L0,100', 'M0,0 L0,100'],
      centerline: [
        { x: 0, y: 0 },
        { x: 0, y: 100 },
      ],
    });
    const out0 = computeStripeOutline(mixed, 0)!;
    const out1 = computeStripeOutline(mixed, 1)!;
    expect(Math.abs(out0.capStart.x1 - out0.capStart.x2)).toBeCloseTo(14, 6);
    expect(Math.abs(out1.capStart.x1 - out1.capStart.x2)).toBeCloseTo(28, 6);
    const mid0 = (out0.capStart.x1 + out0.capStart.x2) / 2;
    const mid1 = (out1.capStart.x1 + out1.capStart.x2) / 2;
    expect(Math.abs(mid0)).toBeCloseTo(10.5, 6);
    expect(Math.abs(mid1)).toBeCloseTo(10.5, 6);
    expect(Math.sign(mid0)).toBe(-Math.sign(mid1));
  });
});
