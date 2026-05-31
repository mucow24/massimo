import { describe, it, expect } from 'vitest';
import { pickLayerLabelTUncached } from './layerLabelPlacement';
import type { SegmentBandSpec } from './interlining';
// Tests use the uncached wrapper so each call builds its own sampled-stripes
// table. Production paths build the cache once per geometry change via
// `sampleBandStripes` and call `pickLayerLabelT` directly — see
// `LayerNumberLabels`.

// Minimal SegmentBandSpec builder for placement tests. Only `bandKey`,
// `centerline`, `radius`, and `lines.length` (for the stripe-offset math)
// are read by the helper; the rest are set to plausible defaults so the
// spec type-checks.
interface BandOpts {
  bandKey: string;
  centerline: Array<{ x: number; y: number }>;
  lines?: string[];
  linePriorities?: number[];
}

function makeBand({
  bandKey,
  centerline,
  lines = ['L1'],
  linePriorities = lines.map((_, i) => i),
}: BandOpts): SegmentBandSpec {
  return {
    pairKey: bandKey,
    bandKey,
    fromId: 's1',
    toId: 's2',
    lines: lines.map((id) => ({ id })),
    paths: lines.map(() => ''),
    warning: false,
    centerline,
    radius: 24,
    linePriorities,
  };
}

// A vertical band from (0,0) to (0,100); midpoint at (0, 50).
const vertBand = () =>
  makeBand({
    bandKey: 'V',
    centerline: [
      { x: 0, y: 0 },
      { x: 0, y: 100 },
    ],
    lines: ['A'],
  });

// A horizontal band, centered on a given x. The default x=0 crosses our
// vertical band at the midpoint.
const horizBand = (x = 0) =>
  makeBand({
    bandKey: `H@${x}`,
    centerline: [
      { x: x - 50, y: 50 },
      { x: x + 50, y: 50 },
    ],
    lines: ['B'],
  });

describe('pickLayerLabelT', () => {
  // Both rows demonstrate the same property: when no candidate is more
  // covered than another, the midpoint bias wins. Once with literally no
  // other bands, once with a band that's far enough away to be effectively
  // absent — distinct setups, same expectation.
  it.each([
    { label: 'no other bands', otherBands: () => [] as ReturnType<typeof horizBand>[] },
    { label: 'far-away crossing', otherBands: () => [horizBand(500)] },
  ])('returns the midpoint (0.5) when there is no contention ($label)', ({ otherBands }) => {
    const target = vertBand();
    expect(pickLayerLabelTUncached(target, 0, [target, ...otherBands()])).toBe(0.5);
  });

  it('moves the label when a crossing band overlaps the midpoint, regardless of z-order', () => {
    // Render priority is intentionally ignored — even when the target
    // paints on top of the crossing, the crossing's surroundings leak past
    // the target's narrow band width so labels in the overlap zone read
    // as ambiguous. Both behind- and in-front-of crossings push the label.
    const target = vertBand();
    const crossing = horizBand();
    expect(pickLayerLabelTUncached(target, 0, [target, crossing])).not.toBe(0.5);
  });

  it('breaks ties between equal-clearance candidates by candidate-list order', () => {
    // Tiny horizontal crossing right at the midpoint so ONLY t=0.5 is
    // covered. Both 0.4 and 0.6 are 10 units away from the crossing
    // (perpendicular offset along the target stripe). With equal
    // clearance and equal midpoint penalty, the earlier candidate in the
    // list wins. Limiting the candidate set to [0.5, 0.4, 0.6] keeps the
    // comparison clean — full default order would also picks an even
    // further candidate (0.3/0.7/0.2/0.8) under the max-clearance rule.
    const target = vertBand();
    const tinyAtMidpoint = makeBand({
      bandKey: 'H',
      centerline: [
        { x: -2, y: 50 },
        { x: 2, y: 50 },
      ],
      lines: ['B'],
    });
    expect(
      pickLayerLabelTUncached(target, 0, [target, tinyAtMidpoint], { candidates: [0.5, 0.4, 0.6] }),
    ).toBe(0.4);
  });

  it('picks the most clear candidate rather than the first clear-enough one', () => {
    // The screenshot scenario: a single crossing covers the central
    // candidates so distance grows monotonically with |t - 0.5|. With the
    // old first-clear behaviour a moderately clear inner candidate
    // (0.4/0.6) would have won; with max-clearance scoring the outermost
    // candidate wins because it has the most breathing room.
    const target = vertBand();
    const crossing = horizBand();
    expect(pickLayerLabelTUncached(target, 0, [target, crossing])).toBe(0.2);
  });

  it('prefers 0.5 when every candidate is equally covered (degenerate hub)', () => {
    // A second vertical centerline at x=0 lying directly on top of the
    // target — same start/end so the sample-to-sample distance at every
    // target candidate is 0. With every candidate's clearance tied, the
    // midpoint bias picks t=0.5 — the least-bad arbitrary choice.
    const target = vertBand();
    const parallel = makeBand({
      bandKey: 'P',
      centerline: [
        { x: 0, y: 0 },
        { x: 0, y: 100 },
      ],
      lines: ['P'],
    });
    expect(pickLayerLabelTUncached(target, 0, [target, parallel])).toBe(0.5);
  });

  it('skips other stripes within the same band as the target', () => {
    // An interlined band has multiple stripes that run parallel to the
    // target stripe — they don't cover it (perpendicular offset, not
    // overlapping). The helper must skip same-band stripes; without the
    // skip a front-most sibling would look like a perpendicular occluder
    // and force a search.
    const target = makeBand({
      bandKey: 'V',
      centerline: [
        { x: 0, y: 0 },
        { x: 0, y: 100 },
      ],
      lines: ['A', 'B'],
    });
    expect(pickLayerLabelTUncached(target, 0, [target])).toBe(0.5);
  });

  it('respects a custom midpointBias: a high bias keeps the label at 0.5', () => {
    // Tiny crossing at midpoint. With the default bias an off-centre spot
    // wins; with a very high bias the penalty cancels the distance
    // advantage and 0.5 stays put.
    const target = vertBand();
    const tinyAtMidpoint = makeBand({
      bandKey: 'H',
      centerline: [
        { x: -2, y: 50 },
        { x: 2, y: 50 },
      ],
      lines: ['B'],
    });
    expect(pickLayerLabelTUncached(target, 0, [target, tinyAtMidpoint])).not.toBe(0.5);
    expect(
      pickLayerLabelTUncached(target, 0, [target, tinyAtMidpoint], { midpointBias: 10000 }),
    ).toBe(0.5);
  });

  it('respects a custom candidates array (forced order)', () => {
    // With candidates = [0.5, 0.9] only, the midpoint is covered and 0.9
    // is the only other option — it wins on clearance.
    const target = vertBand();
    const crossing = horizBand();
    expect(pickLayerLabelTUncached(target, 0, [target, crossing], { candidates: [0.5, 0.9] })).toBe(
      0.9,
    );
  });
});
