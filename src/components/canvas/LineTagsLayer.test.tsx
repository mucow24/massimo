import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { LineTagsLayer, resolveTag } from './LineTagsLayer';
import { useDoc } from '../../state/store';
import { DEFAULT_DOC } from '../../model/transforms';
import { makeBandSpec, makeLine } from '../../test/fixtures';
import { fakeSvgRef } from '../../test/interaction';
import type { LineTag } from '../../model/types';

// Mixed-width band over the fixture's default s1|s2 corridor: L1 at 14,
// L2 at 28 → baked offsets ±10.5.
const mixedBand = () => makeBandSpec(['L1', 'L2'], { stripeWidths: [14, 28] });

const tagOnL2 = (over: Partial<LineTag> = {}): LineTag => ({
  id: 'T',
  lineId: 'L2',
  fromStationId: 's1',
  toStationId: 's2',
  anchorEnd: 'from',
  distance: 50,
  orientation: 0,
  ...over,
});

describe('resolveTag — per-stripe geometry', () => {
  it('lands the tag on the stripe’s baked offset and carries the stripe width', () => {
    const lines = { L2: makeLine({ id: 'L2', stations: ['s1', 's2'], width: 28 }) };
    const r = resolveTag(tagOnL2(), { lines }, [mixedBand()])!;
    expect(r).not.toBeNull();
    // The wide stripe sits at |offset| = 10.5 off the horizontal centerline —
    // the legacy stripeOffset(k, 2) math would put it at ±7.
    expect(Math.abs(r.p.y)).toBeCloseTo(10.5, 6);
    expect(r.stripeWidth).toBe(28);
  });
});

describe('<LineTagsLayer> — chevron scales to its stripe', () => {
  beforeEach(() => {
    useDoc.setState({
      ...useDoc.getState(),
      ...DEFAULT_DOC,
      lines: {
        L1: makeLine({ id: 'L1', stations: ['s1', 's2'] }),
        L2: makeLine({ id: 'L2', stations: ['s1', 's2'], width: 28 }),
      },
      lineOrder: ['L1', 'L2'],
      lineTags: { T: tagOnL2({ kind: 'chevron' }) },
    });
    useDoc.temporal.getState().clear();
  });

  it('sizes the chevron arms AND its hit box to the stripe height', () => {
    const { ref } = fakeSvgRef();
    const { container } = render(
      <svg>
        <LineTagsLayer bands={[mixedBand()]} zoom={1} svgRef={ref} />
      </svg>,
    );
    // Arms reach the wide stripe's edges: half-height = 28/2 (+ the small
    // antialias bleed), not the legacy hardcoded 7.
    const poly = container.querySelector('polygon')!;
    expect(poly).not.toBeNull();
    const ys = poly
      .getAttribute('points')!
      .split(' ')
      .map((p) => Number(p.split(',')[1]));
    expect(Math.max(...ys.map(Math.abs))).toBeCloseTo(14.33, 2);
    // The invisible hit rect must track the scaled arms or clicks on the
    // arm tips miss (its height is the full stripe height).
    const hit = container.querySelector('rect[fill="transparent"]')!;
    expect(hit).not.toBeNull();
    expect(Number(hit.getAttribute('height'))).toBeCloseTo(28, 6);
  });
});
