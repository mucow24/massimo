import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { computeArcRadii } from './router';
import {
  bandCentroid,
  buildBands,
  buildLineIndex,
  buildOrderedRenderables,
  buildStopMarkers,
  cornerCapRadius,
  idealBandRadius,
  resolveSegmentStyle,
  stopPosWorld,
} from './interlining';
import { LAYER_WEIGHT } from '../model/layerPriority';
import { STOP_SIZE, stripeOffsetsForWidths, tangentGap } from './orientation';
import { makeDoc, makeLine, makeStation, makeStop, stationWithStop } from '../test/fixtures';
import type { LineStyle } from '../model/types';

describe('band geometry helpers', () => {
  it('bandCentroid averages the points', () => {
    expect(bandCentroid([{ x: 0, y: 0 }])).toEqual({ x: 0, y: 0 });
    expect(
      bandCentroid([
        { x: 0, y: 0 },
        { x: 10, y: 20 },
      ]),
    ).toEqual({ x: 5, y: 10 });
    expect(
      bandCentroid([
        { x: 0, y: 0 },
        { x: 6, y: 0 },
        { x: 0, y: 9 },
      ]),
    ).toEqual({ x: 2, y: 3 });
  });

  it('idealBandRadius bumps by the extreme stripe-center offset; a single stripe is a no-op', () => {
    // Signature takes max|stripe offset| directly; the uniform-width values
    // are the historical (n−1)/2 · STOP_SIZE bumps.
    expect(idealBandRadius(24, 0)).toBe(24); // n = 1
    expect(idealBandRadius(24, STOP_SIZE)).toBe(24 + STOP_SIZE); // n = 3 uniform
    expect(idealBandRadius(24, 2 * STOP_SIZE)).toBe(24 + 2 * STOP_SIZE); // n = 5 uniform
    // Mixed-width example: widths [14, 28, 14] → offsets [−21, 0, 21].
    expect(idealBandRadius(24, 21)).toBe(45);
  });

  it('cornerCapRadius: Infinity when straight, edge-limited at a turn, 0 with no straight run', () => {
    const east = { x: 1, y: 0 };
    const south = { x: 0, y: 1 };
    expect(cornerCapRadius(100, east, east)).toBe(Infinity);
    // 90° turn: r ≤ (edgeLen − HALF) / tan(45°) = edgeLen − HALF.
    expect(cornerCapRadius(50, east, south)).toBeCloseTo(50 - STOP_SIZE / 2, 6);
    // Edge shorter than HALF → no usable straight run.
    expect(cornerCapRadius(STOP_SIZE / 2 - 1, east, south)).toBe(0);
    // Wider marker (width-28 line) eats a bigger run-in: markerHalf = 14.
    expect(cornerCapRadius(50, east, south, 14)).toBeCloseTo(50 - 14, 6);
  });
});

describe('resolveSegmentStyle', () => {
  it('defaults to solid when the line has no per-segment overrides', () => {
    const line = makeLine({ id: 'L1', stations: ['s1', 's2'] });
    expect(resolveSegmentStyle(line, 's1|s2')).toBe('solid');
  });

  it('returns the override for the matching pairKey only', () => {
    const line = makeLine({
      id: 'L1',
      stations: ['s1', 's2', 's3'],
      segmentStyles: { 's1|s2': 'hatched' },
    });
    expect(resolveSegmentStyle(line, 's1|s2')).toBe('hatched');
    // A different segment on the same line stays solid.
    expect(resolveSegmentStyle(line, 's2|s3')).toBe('solid');
  });
});

describe('buildLineIndex', () => {
  it('numbers IDs in lineOrder front-to-back', () => {
    const lines = {
      a: makeLine({ id: 'a' }),
      b: makeLine({ id: 'b' }),
      c: makeLine({ id: 'c' }),
    };
    expect(buildLineIndex(['c', 'a', 'b'], lines)).toEqual({ c: 0, a: 1, b: 2 });
  });

  it('appends IDs missing from lineOrder', () => {
    const lines = {
      a: makeLine({ id: 'a' }),
      b: makeLine({ id: 'b' }),
    };
    const idx = buildLineIndex(['a'], lines);
    expect(idx.a).toBe(0);
    expect(idx.b).toBe(1);
  });

  it('filters dead IDs out of lineOrder', () => {
    const lines = { a: makeLine({ id: 'a' }) };
    const idx = buildLineIndex(['ghost', 'a'], lines);
    expect(idx).toEqual({ a: 0 });
  });
});

describe('buildBands — single line', () => {
  it('produces one band with one path for a 2-station line', () => {
    const doc = makeDoc({
      stations: [
        stationWithStop('s1', 'L1', { x: 0, y: 0 }),
        stationWithStop('s2', 'L1', { x: 0, y: 100 }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1', 's2'] })],
    });
    const bands = buildBands(doc.stations, doc.lines, 24, doc.lineOrder);
    expect(bands).toHaveLength(1);
    expect(bands[0].lines).toHaveLength(1);
    expect(bands[0].paths).toHaveLength(1);
    expect(bands[0].fromId).toBe('s1');
    expect(bands[0].toId).toBe('s2');
  });

  it('skips segments with a missing stop cell on either end', () => {
    const doc = makeDoc({
      stations: [
        stationWithStop('s1', 'L1', { x: 0, y: 0 }),
        // s2 has no stop cell for L1
        makeStation({ id: 's2', x: 0, y: 100 }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1', 's2'] })],
    });
    const bands = buildBands(doc.stations, doc.lines, 24, doc.lineOrder);
    expect(bands).toHaveLength(0);
  });
});

describe('buildBands — centerline radius', () => {
  // For an interlined band, the centerline must use a radius LARGER than the
  // configured `curveRadius` (the user's min) so that the innermost stripe —
  // offset by maxAbsOffset = (n-1)/2 * STOP_SIZE toward the inside of any
  // bend — still has an arc radius ≥ curveRadius. Without this, the inside
  // stripe of a 4-5-stripe band collapses to a right angle.
  //
  // But the bump can't go all the way to R + maxAbsOffset in tight layouts:
  // each band endpoint carries a STOP_SIZE × STOP_SIZE stop-marker rect, and
  // the marker's far edge spills HALF (=STOP_SIZE/2) past the stop along
  // travel. If the fillet at the first/last polyline corner eats more than
  // (edgeLen - HALF) of the edge, the marker rect extends INTO the curving
  // arc section and produces a visible stair-step at the marker boundary.
  // So the radius is capped per-endpoint so the post-fillet straight ≥ HALF.

  // 5 lines interlined through adjacent stop cells at both stations. The
  // stops at each station are perpendicular-adjacent so buildBands merges
  // them into a single 5-stripe band.
  const fiveStripeStations = (s1: { x: number; y: number }, s2: { x: number; y: number }) => [
    makeStation({
      id: 's1',
      ...s1,
      stops: [
        makeStop('L1', { col: 0 }),
        makeStop('L2', { col: 1 }),
        makeStop('L3', { col: 2 }),
        makeStop('L4', { col: 3 }),
        makeStop('L5', { col: 4 }),
      ],
    }),
    makeStation({
      id: 's2',
      ...s2,
      stops: [
        makeStop('L1', { col: 0 }),
        makeStop('L2', { col: 1 }),
        makeStop('L3', { col: 2 }),
        makeStop('L4', { col: 3 }),
        makeStop('L5', { col: 4 }),
      ],
    }),
  ];
  const fiveStripeLines = () =>
    ['L1', 'L2', 'L3', 'L4', 'L5'].map((id) => makeLine({ id, stations: ['s1', 's2'] }));

  it('single-stripe band: radius equals curveRadius (no bump, no cap)', () => {
    const doc = makeDoc({
      stations: [
        stationWithStop('s1', 'L1', { x: 0, y: 0 }),
        stationWithStop('s2', 'L1', { x: 0, y: 100 }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1', 's2'] })],
    });
    const bands = buildBands(doc.stations, doc.lines, 24, doc.lineOrder);
    expect(bands).toHaveLength(1);
    expect(bands[0].radius).toBe(24);
  });

  it('5-stripe straight band: radius bumps to R + (n-1)/2 * STOP_SIZE (no bend → cap inactive)', () => {
    // s1 and s2 vertically aligned: router produces a single straight edge
    // (no corners), so the marker-fit cap never engages. Inner stripe gets
    // exactly R.
    const doc = makeDoc({
      stations: fiveStripeStations({ x: 0, y: 0 }, { x: 0, y: 200 }),
      lines: fiveStripeLines(),
    });
    const bands = buildBands(doc.stations, doc.lines, 20, doc.lineOrder);
    expect(bands).toHaveLength(1);
    expect(bands[0].lines).toHaveLength(5);
    // n=5, STOP_SIZE=14 → maxAbsOffset = 2 * 14 = 28. ideal R = 20 + 28 = 48.
    expect(bands[0].radius).toBe(48);
  });

  it('5-stripe band with ample edges around a 2-bend: cap clears the bump, radius hits ideal', () => {
    // 2-bend Z routing with both south endpoints. tS = tE = ΔY/2 = 60, so
    // each end-edge is 60. ideal tan budget at the corner = idealR=48 ≤
    // edge−HALF = 60−7 = 53, so the cap doesn't engage and radius = ideal.
    const doc = makeDoc({
      stations: fiveStripeStations({ x: 0, y: 0 }, { x: 96, y: 120 }),
      lines: fiveStripeLines(),
    });
    const bands = buildBands(doc.stations, doc.lines, 20, doc.lineOrder);
    expect(bands).toHaveLength(1);
    expect(bands[0].radius).toBe(48);
  });

  it('5-stripe band with tight edges: cap clamps below ideal so the stop marker fits', () => {
    // 2-bend Z routing. tS = tE = 50, so each end-edge is 50. ideal tan
    // budget = 48 leaves only 2 units between the fillet's end and the
    // stop — not enough room for the 7-unit marker overhang. Cap engages:
    // radius = (50 − 7)/tan(45°) = 43. Inner stripe ends up at 43−28 = 15,
    // below the user's R=20 — that's the marker-fit / inner-stripe-respects-R
    // trade-off, marker-fit wins unless it would drag centerline below R.
    const doc = makeDoc({
      stations: fiveStripeStations({ x: 0, y: 0 }, { x: 96, y: 100 }),
      lines: fiveStripeLines(),
    });
    const bands = buildBands(doc.stations, doc.lines, 20, doc.lineOrder);
    expect(bands).toHaveLength(1);
    expect(bands[0].radius).toBeCloseTo(43, 6);
  });

  it('single-stripe band caps below R at a cramped perpendicular terminus so the stop marker still fits', () => {
    // Regression for the Osterley/Stonebridge bug. A single line whose two ends
    // approach on perpendicular axes (s1 vertical, s2 horizontal) and sit close
    // together routes as a tight 2-bend band. The terminal edge is too short to
    // fit both a full-R fillet AND the HALF marker run-in. A single-stripe band
    // has no offset stripes to keep above R, so the marker-fit cap is allowed to
    // pull the centerline below the configured R. Before the fix the cap floored
    // at R (idealR === R for one stripe), so the band kept curving inside the
    // axis-aligned stop marker and stair-stepped at the marker's near edge — the
    // curve appeared to meet the station at its far edge instead of running in
    // straight from the near edge.
    const R = 24;
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          x: 0,
          y: 0,
          rotation: 0,
          stops: [makeStop('L1', { orientation: 'auto-vertical' })],
        }),
        makeStation({
          id: 's2',
          x: 24,
          y: -37,
          rotation: 2, // 90° → the auto-vertical stop resolves to a horizontal world axis
          stops: [makeStop('L1', { orientation: 'auto-vertical' })],
        }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s2', 's1'] })],
    });
    const bands = buildBands(doc.stations, doc.lines, R, doc.lineOrder);
    expect(bands).toHaveLength(1);
    const band = bands[0];
    // The cap engaged below the configured R (old behavior floored at R = 24).
    expect(band.radius).toBeLessThan(R);
    expect(band.radius).toBeGreaterThan(0);
    // A clean tighter curve, not the straight-line routing-warning fallback.
    expect(band.warning).toBe(false);

    // The invariant that actually kills the stair-step: the post-fillet straight
    // section at each terminus is ≥ HALF, so the STOP_SIZE marker square sits
    // entirely within the straight run rather than spilling onto the arc.
    const HALF = STOP_SIZE / 2;
    const v = band.centerline;
    expect(v.length).toBeGreaterThanOrEqual(3);
    const { rs, angles } = computeArcRadii(v, band.radius);
    const edge = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.hypot(b.x - a.x, b.y - a.y);
    const last = v.length - 1;
    const fromRunIn = edge(v[0], v[1]) - rs[1] * Math.tan(angles[1] / 2);
    const toRunIn = edge(v[last - 1], v[last]) - rs[last - 1] * Math.tan(angles[last - 1] / 2);
    expect(fromRunIn).toBeGreaterThanOrEqual(HALF - 1e-6);
    expect(toRunIn).toBeGreaterThanOrEqual(HALF - 1e-6);
  });
});

describe('buildBands — interlining', () => {
  it('merges two parallel-adjacent lines on a shared pair into one band', () => {
    // Two stations, both with stops for L1 at col=0 and L2 at col=1 (adjacent
    // perpendicular to vertical travel). Same axis → single band, 2 paths.
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          x: 0,
          y: 0,
          stops: [makeStop('L1', { col: 0 }), makeStop('L2', { col: 1 })],
        }),
        makeStation({
          id: 's2',
          x: 0,
          y: 100,
          stops: [makeStop('L1', { col: 0 }), makeStop('L2', { col: 1 })],
        }),
      ],
      lines: [
        makeLine({ id: 'L1', stations: ['s1', 's2'] }),
        makeLine({ id: 'L2', stations: ['s1', 's2'] }),
      ],
    });
    const bands = buildBands(doc.stations, doc.lines, 24, doc.lineOrder);
    expect(bands).toHaveLength(1);
    expect(bands[0].lines).toHaveLength(2);
    expect(bands[0].paths).toHaveLength(2);
  });

  it('merges opposite-traverse lines on the same axis into one band', () => {
    // L1 traverses s1→s2; L2 traverses s2→s1. Same world axis → one band.
    // (Regression for the interline-bands-across-opposite-direction fix.)
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          x: 0,
          y: 0,
          stops: [makeStop('L1', { col: 0 }), makeStop('L2', { col: 1 })],
        }),
        makeStation({
          id: 's2',
          x: 0,
          y: 100,
          stops: [makeStop('L1', { col: 0 }), makeStop('L2', { col: 1 })],
        }),
      ],
      lines: [
        makeLine({ id: 'L1', stations: ['s1', 's2'] }),
        makeLine({ id: 'L2', stations: ['s2', 's1'] }),
      ],
    });
    const bands = buildBands(doc.stations, doc.lines, 24, doc.lineOrder);
    expect(bands).toHaveLength(1);
    expect(bands[0].lines).toHaveLength(2);
  });

  it('builds a band for a single line with auto-ne-sw stops on a NE-going pair', () => {
    // Stations on a NE-pointing line (screen-y-down: dy < 0). Stops at
    // rotation 0 with auto-ne-sw resolve to the NE world tangent via the
    // worldHint that buildBands derives from the line direction.
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          x: 0,
          y: 0,
          rotation: 0,
          stops: [makeStop('L1', { orientation: 'auto-ne-sw' })],
        }),
        makeStation({
          id: 's2',
          x: 100,
          y: -100,
          rotation: 0,
          stops: [makeStop('L1', { orientation: 'auto-ne-sw' })],
        }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1', 's2'] })],
    });
    const bands = buildBands(doc.stations, doc.lines, 24, doc.lineOrder);
    expect(bands).toHaveLength(1);
    expect(bands[0].lines).toHaveLength(1);
    expect(bands[0].paths).toHaveLength(1);
    // Centerline endpoints should match the station centers (no
    // perpendicular offset for a single-stripe band).
    const v = bands[0].centerline;
    expect(v[0].x).toBeCloseTo(0, 5);
    expect(v[0].y).toBeCloseTo(0, 5);
    expect(v[v.length - 1].x).toBeCloseTo(100, 5);
    expect(v[v.length - 1].y).toBeCloseTo(-100, 5);
    // No fillet warning — the world tangent matches the stop axis.
    expect(bands[0].warning).toBe(false);
  });

  it('merges two diagonal-adjacent lines on a NE-going pair into one band', () => {
    // auto-ne-sw band perp axis is NW-SE. In the diagonal basis, perp-
    // adjacent cells differ by (dRow=+√2/2, dCol=+√2/2) — a world delta of
    // (STOP_SIZE·√2/2, STOP_SIZE·√2/2), magnitude STOP_SIZE along SE. Cells
    // (0,0) and (√2/2, √2/2) form a valid 2-stripe diagonal band.
    const H = Math.SQRT1_2;
    const stops = (lineIds: [string, string]) => [
      makeStop(lineIds[0], { row: 0, col: 0, orientation: 'auto-ne-sw' }),
      makeStop(lineIds[1], { row: H, col: H, orientation: 'auto-ne-sw' }),
    ];
    const doc = makeDoc({
      stations: [
        makeStation({ id: 's1', x: 0, y: 0, rotation: 0, stops: stops(['L1', 'L2']) }),
        makeStation({ id: 's2', x: 100, y: -100, rotation: 0, stops: stops(['L1', 'L2']) }),
      ],
      lines: [
        makeLine({ id: 'L1', stations: ['s1', 's2'] }),
        makeLine({ id: 'L2', stations: ['s1', 's2'] }),
      ],
    });
    const bands = buildBands(doc.stations, doc.lines, 24, doc.lineOrder);
    expect(bands).toHaveLength(1);
    expect(bands[0].lines).toHaveLength(2);
    expect(bands[0].paths).toHaveLength(2);
    // Centerline endpoints at each station's group centroid (cell-grid mean).
    // s1 centroid: (H·STOP_SIZE/2, H·STOP_SIZE/2). s2 offset by (100, -100).
    const v = bands[0].centerline;
    expect(v[0].x).toBeCloseTo((H * STOP_SIZE) / 2, 5);
    expect(v[0].y).toBeCloseTo((H * STOP_SIZE) / 2, 5);
    expect(v[v.length - 1].x).toBeCloseTo(100 + (H * STOP_SIZE) / 2, 5);
    expect(v[v.length - 1].y).toBeCloseTo(-100 + (H * STOP_SIZE) / 2, 5);
    expect(bands[0].warning).toBe(false);
  });

  it('merges three diagonal-adjacent lines on the same pair into a single 3-stripe band', () => {
    // Three perp-adjacent auto-nw-se stops at diagonal-basis cells. Perp
    // axis is NE-SW; one NE step is cell delta (dRow=-√2/2, dCol=+√2/2),
    // world delta (STOP_SIZE·√2/2, -STOP_SIZE·√2/2) = NE at STOP_SIZE.
    const H = Math.SQRT1_2;
    const stops = (lineIds: [string, string, string]) => [
      makeStop(lineIds[0], { row: 0, col: 0, orientation: 'auto-nw-se' }),
      makeStop(lineIds[1], { row: -H, col: H, orientation: 'auto-nw-se' }),
      makeStop(lineIds[2], { row: -2 * H, col: 2 * H, orientation: 'auto-nw-se' }),
    ];
    const doc = makeDoc({
      stations: [
        makeStation({ id: 's1', x: 0, y: 0, rotation: 0, stops: stops(['L1', 'L2', 'L3']) }),
        makeStation({ id: 's2', x: 200, y: 200, rotation: 0, stops: stops(['L1', 'L2', 'L3']) }),
      ],
      lines: [
        makeLine({ id: 'L1', stations: ['s1', 's2'] }),
        makeLine({ id: 'L2', stations: ['s1', 's2'] }),
        makeLine({ id: 'L3', stations: ['s1', 's2'] }),
      ],
    });
    const bands = buildBands(doc.stations, doc.lines, 24, doc.lineOrder);
    expect(bands).toHaveLength(1);
    expect(bands[0].lines).toHaveLength(3);
    expect(bands[0].paths).toHaveLength(3);
  });

  it('two perp-adjacent runs in the same axis bucket stay separate when parallel positions differ', () => {
    // Four auto-ne-sw stops at one station: two diagonal-basis pairs that
    // are each perp-adjacent within, but the pairs differ on the band's
    // parallel axis. buildBands must keep them as two bands.
    //
    //   pair P: (0,0) + (√2/2, √2/2) — par projection 0.
    //   pair Q: (10,0) + (10+√2/2, √2/2) — par offset differs by STOP_SIZE.
    const H = Math.SQRT1_2;
    const stops = (ids: [string, string, string, string]) => [
      makeStop(ids[0], { row: 0, col: 0, orientation: 'auto-ne-sw' }),
      makeStop(ids[1], { row: H, col: H, orientation: 'auto-ne-sw' }),
      makeStop(ids[2], { row: 10, col: 0, orientation: 'auto-ne-sw' }),
      makeStop(ids[3], { row: 10 + H, col: H, orientation: 'auto-ne-sw' }),
    ];
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          x: 0,
          y: 0,
          rotation: 0,
          stops: stops(['L1', 'L2', 'L3', 'L4']),
        }),
        makeStation({
          id: 's2',
          x: 100,
          y: -100,
          rotation: 0,
          stops: stops(['L1', 'L2', 'L3', 'L4']),
        }),
      ],
      lines: [
        makeLine({ id: 'L1', stations: ['s1', 's2'] }),
        makeLine({ id: 'L2', stations: ['s1', 's2'] }),
        makeLine({ id: 'L3', stations: ['s1', 's2'] }),
        makeLine({ id: 'L4', stations: ['s1', 's2'] }),
      ],
    });
    const bands = buildBands(doc.stations, doc.lines, 24, doc.lineOrder);
    // Two bands (one per pair), each with two stripes.
    expect(bands).toHaveLength(2);
    for (const b of bands) expect(b.lines).toHaveLength(2);
  });

  it('asymmetric group sizes at each band endpoint keep the lines in separate bands', () => {
    // At s1, L1/L2/L3 form a 3-stop diagonal interline group on the
    // diagonal basis. At s2, L1/L2 still pair but L3 sits at an unrelated
    // parallel position. buildBands' sameParA/sameParB check should reject
    // a single 3-band merge — L1+L2 as a 2-stripe band, L3 as a singleton.
    const H = Math.SQRT1_2;
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          x: 0,
          y: 0,
          rotation: 0,
          stops: [
            makeStop('L1', { row: 0, col: 0, orientation: 'auto-ne-sw' }),
            makeStop('L2', { row: H, col: H, orientation: 'auto-ne-sw' }),
            makeStop('L3', { row: 2 * H, col: 2 * H, orientation: 'auto-ne-sw' }),
          ],
        }),
        makeStation({
          id: 's2',
          x: 100,
          y: -100,
          rotation: 0,
          stops: [
            // L1 and L2 still perp-adjacent at the same parallel as s1.
            makeStop('L1', { row: 0, col: 0, orientation: 'auto-ne-sw' }),
            makeStop('L2', { row: H, col: H, orientation: 'auto-ne-sw' }),
            // L3 displaced to a different parallel position (along NE-SW
            // travel axis), so it doesn't fit the run at this end.
            makeStop('L3', { row: 10, col: 10, orientation: 'auto-ne-sw' }),
          ],
        }),
      ],
      lines: [
        makeLine({ id: 'L1', stations: ['s1', 's2'] }),
        makeLine({ id: 'L2', stations: ['s1', 's2'] }),
        makeLine({ id: 'L3', stations: ['s1', 's2'] }),
      ],
    });
    const bands = buildBands(doc.stations, doc.lines, 24, doc.lineOrder);
    // L1+L2 form one interlined band; L3 is its own singleton band.
    expect(bands).toHaveLength(2);
    const byLineSet = bands.map((b) =>
      b.lines
        .map((l) => l.id)
        .sort()
        .join(','),
    );
    expect(byLineSet).toContain('L1,L2');
    expect(byLineSet).toContain('L3');
  });

  it('non-perp-adjacent diagonal stops on the same pair stay in separate bands', () => {
    // cells (0,0) and (3,3) for auto-ne-sw — 3·STOP_SIZE·√2 perp apart,
    // far beyond the adjacency tolerance. Should produce two bands.
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          x: 0,
          y: 0,
          rotation: 0,
          stops: [
            makeStop('L1', { row: 0, col: 0, orientation: 'auto-ne-sw' }),
            makeStop('L2', { row: 3, col: 3, orientation: 'auto-ne-sw' }),
          ],
        }),
        makeStation({
          id: 's2',
          x: 100,
          y: -100,
          rotation: 0,
          stops: [
            makeStop('L1', { row: 0, col: 0, orientation: 'auto-ne-sw' }),
            makeStop('L2', { row: 3, col: 3, orientation: 'auto-ne-sw' }),
          ],
        }),
      ],
      lines: [
        makeLine({ id: 'L1', stations: ['s1', 's2'] }),
        makeLine({ id: 'L2', stations: ['s1', 's2'] }),
      ],
    });
    const bands = buildBands(doc.stations, doc.lines, 24, doc.lineOrder);
    expect(bands).toHaveLength(2);
  });

  it('keeps non-adjacent lines on a shared pair in separate bands', () => {
    // L1 at col=0, L2 at col=5 (non-adjacent → no interline merge).
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          x: 0,
          y: 0,
          stops: [makeStop('L1', { col: 0 }), makeStop('L2', { col: 5 })],
        }),
        makeStation({
          id: 's2',
          x: 0,
          y: 100,
          stops: [makeStop('L1', { col: 0 }), makeStop('L2', { col: 5 })],
        }),
      ],
      lines: [
        makeLine({ id: 'L1', stations: ['s1', 's2'] }),
        makeLine({ id: 'L2', stations: ['s1', 's2'] }),
      ],
    });
    const bands = buildBands(doc.stations, doc.lines, 24, doc.lineOrder);
    expect(bands).toHaveLength(2);
  });
});

describe('buildBands — per-line widths', () => {
  // Two horizontal lines through the same pair, L2's stop `rowGap` rows below
  // L1's. One lattice row = STOP_SIZE world units, so the perpendicular
  // center distance is rowGap · STOP_SIZE.
  const twoLineDoc = (rowGap: number, widths: { L1?: number; L2?: number } = {}) => {
    const stops = () => [
      makeStop('L1', { row: 0, col: 0, orientation: 'auto-horizontal' }),
      makeStop('L2', { row: rowGap, col: 0, orientation: 'auto-horizontal' }),
    ];
    return makeDoc({
      stations: [
        makeStation({ id: 's1', x: 0, y: 0, stops: stops() }),
        makeStation({ id: 's2', x: 200, y: 0, stops: stops() }),
      ],
      lines: [
        makeLine({ id: 'L1', stations: ['s1', 's2'], width: widths.L1 }),
        makeLine({ id: 'L2', stations: ['s1', 's2'], width: widths.L2 }),
      ],
    });
  };

  it('merges a mixed-width pair whose stop centers sit exactly tangentGap apart', () => {
    // gap = (14 + 28) / 2 = 21 world units = 1.5 rows.
    const doc = twoLineDoc(1.5, { L2: 28 });
    const bands = buildBands(doc.stations, doc.lines, 24, doc.lineOrder);
    expect(bands).toHaveLength(1);
    // stripeWidths is parallel to lines (the band's perp-sorted order).
    const widthByLine: Record<string, number> = { L1: 14, L2: 28 };
    expect(bands[0].stripeWidths).toEqual(bands[0].lines.map((l) => widthByLine[l.id]));
    // Offsets straddle the centerline at the tangency spacing.
    expect(bands[0].stripeOffsets).toEqual([-10.5, 10.5]);
    expect(bands[0].paths).toHaveLength(2);
  });

  it('keeps a mixed-width pair at the legacy unit gap separate (stripes would overlap)', () => {
    const doc = twoLineDoc(1, { L2: 28 });
    expect(buildBands(doc.stations, doc.lines, 24, doc.lineOrder)).toHaveLength(2);
  });

  it('merges a uniform non-default-width pair at its own tangent gap', () => {
    // Both width 20 → tangent gap 20 world units = 20/14 rows.
    const doc = twoLineDoc(20 / STOP_SIZE, { L1: 20, L2: 20 });
    const bands = buildBands(doc.stations, doc.lines, 24, doc.lineOrder);
    expect(bands).toHaveLength(1);
    expect(bands[0].stripeWidths).toEqual([20, 20]);
    expect(bands[0].stripeOffsets).toEqual([-10, 10]);
  });

  it('bakes legacy-equivalent stripe fields for an all-default band', () => {
    const doc = twoLineDoc(1);
    const bands = buildBands(doc.stations, doc.lines, 24, doc.lineOrder);
    expect(bands).toHaveLength(1);
    expect(bands[0].stripeWidths).toEqual([STOP_SIZE, STOP_SIZE]);
    expect(bands[0].stripeOffsets).toEqual([-STOP_SIZE / 2, STOP_SIZE / 2]);
  });

  it('any tangent widths vector merges into ONE band whose offsets reproduce the stop spacing', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 40 }), { minLength: 2, maxLength: 5 }),
        (widths) => {
          // Stops at cumulative tangency spacing (in rows).
          const rows: number[] = [0];
          for (let k = 1; k < widths.length; k++) {
            rows.push(rows[k - 1] + tangentGap(widths[k - 1], widths[k]) / STOP_SIZE);
          }
          const ids = widths.map((_, i) => `L${i + 1}`);
          const stops = () =>
            ids.map((id, i) =>
              makeStop(id, { row: rows[i], col: 0, orientation: 'auto-horizontal' }),
            );
          const doc = makeDoc({
            stations: [
              makeStation({ id: 's1', x: 0, y: 0, stops: stops() }),
              makeStation({ id: 's2', x: 400, y: 0, stops: stops() }),
            ],
            lines: ids.map((id, i) => makeLine({ id, stations: ['s1', 's2'], width: widths[i] })),
          });
          const bands = buildBands(doc.stations, doc.lines, 24, doc.lineOrder);
          expect(bands).toHaveLength(1);
          const band = bands[0];
          expect(band.paths).toHaveLength(widths.length);

          // The band sorts stripes by perpendicular projection, which may run
          // in either direction relative to our row order — accept either.
          const widthByLine = Object.fromEntries(ids.map((id, i) => [id, widths[i]]));
          const bandWidths = band.lines.map((l) => widthByLine[l.id]);
          expect(band.stripeWidths).toEqual(bandWidths);

          // Offsets land each stripe exactly on its stop: stop world y minus
          // the centroid y equals ±offset (one consistent sign across the band).
          const rowByLine = Object.fromEntries(ids.map((id, i) => [id, rows[i]]));
          const ys = band.lines.map((l) => rowByLine[l.id] * STOP_SIZE);
          const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
          const rel = ys.map((y) => y - meanY);
          const sign =
            rel.find((r) => Math.abs(r) > 1e-9)! *
              band.stripeOffsets.find((o) => Math.abs(o) > 1e-9)! >=
            0
              ? 1
              : -1;
          band.stripeOffsets.forEach((o, k) => {
            expect(o * sign).toBeCloseTo(rel[k], 9);
          });

          // Straight band, no corners: the marker-fit cap never engages, so
          // the centerline radius is exactly R + max|offset|.
          const maxAbs = Math.max(...band.stripeOffsets.map(Math.abs));
          expect(band.radius).toBeCloseTo(24 + maxAbs, 9);
        },
      ),
    );
  });

  it('the all-default uniform property holds for any stripe count (legacy generalization)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 6 }), (n) => {
        const ids = Array.from({ length: n }, (_, i) => `L${i + 1}`);
        const stops = () =>
          ids.map((id, i) => makeStop(id, { row: i, col: 0, orientation: 'auto-horizontal' }));
        const doc = makeDoc({
          stations: [
            makeStation({ id: 's1', x: 0, y: 0, stops: stops() }),
            makeStation({ id: 's2', x: 400, y: 0, stops: stops() }),
          ],
          lines: ids.map((id) => makeLine({ id, stations: ['s1', 's2'] })),
        });
        const bands = buildBands(doc.stations, doc.lines, 24, doc.lineOrder);
        expect(bands).toHaveLength(1);
        expect(bands[0].stripeOffsets).toEqual(stripeOffsetsForWidths(Array(n).fill(STOP_SIZE)));
      }),
    );
  });
});

describe('buildBands — bandKey identity', () => {
  // Without unique bandKeys, sibling bands sharing a pairKey collide on
  // React keys and the reconciler leaks fibers across renders — surfaces
  // as stale ⚠ warning glyphs that survive a drag that resolves the
  // routing warning.
  it('assigns distinct bandKeys to sibling bands that share a pairKey', () => {
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          x: 0,
          y: 0,
          stops: [makeStop('L1', { col: 0 }), makeStop('L2', { col: 5 })],
        }),
        makeStation({
          id: 's2',
          x: 0,
          y: 100,
          stops: [makeStop('L1', { col: 0 }), makeStop('L2', { col: 5 })],
        }),
      ],
      lines: [
        makeLine({ id: 'L1', stations: ['s1', 's2'] }),
        makeLine({ id: 'L2', stations: ['s1', 's2'] }),
      ],
    });
    const bands = buildBands(doc.stations, doc.lines, 24, doc.lineOrder);
    expect(bands).toHaveLength(2);
    expect(bands[0].pairKey).toBe(bands[1].pairKey);
    expect(bands[0].bandKey).not.toBe(bands[1].bandKey);
    // Every band's bandKey is unique across the whole result.
    const keys = bands.map((b) => b.bandKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('produces a stable bandKey regardless of incoming line order', () => {
    // Same two stations, same two lines, but lineOrder reversed. The
    // bandKey must not depend on iteration order or the React key
    // would reshuffle whenever lineOrder changes — wrecking
    // reconciliation across an unrelated user action.
    const stations = [
      makeStation({
        id: 's1',
        x: 0,
        y: 0,
        stops: [makeStop('L1', { col: 0 }), makeStop('L2', { col: 1 })],
      }),
      makeStation({
        id: 's2',
        x: 0,
        y: 100,
        stops: [makeStop('L1', { col: 0 }), makeStop('L2', { col: 1 })],
      }),
    ];
    const lines = [
      makeLine({ id: 'L1', stations: ['s1', 's2'] }),
      makeLine({ id: 'L2', stations: ['s1', 's2'] }),
    ];
    const a = buildBands(
      makeDoc({ stations, lines, lineOrder: ['L1', 'L2'] }).stations,
      makeDoc({ stations, lines, lineOrder: ['L1', 'L2'] }).lines,
      24,
      ['L1', 'L2'],
    );
    const b = buildBands(
      makeDoc({ stations, lines, lineOrder: ['L2', 'L1'] }).stations,
      makeDoc({ stations, lines, lineOrder: ['L2', 'L1'] }).lines,
      24,
      ['L2', 'L1'],
    );
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0].bandKey).toBe(b[0].bandKey);
  });
});

describe('buildBands — priority', () => {
  it('tags each stripe with its own line priority (parallel to lines/paths)', () => {
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          x: 0,
          y: 0,
          stops: [makeStop('L1', { col: 0 }), makeStop('L2', { col: 1 })],
        }),
        makeStation({
          id: 's2',
          x: 0,
          y: 100,
          stops: [makeStop('L1', { col: 0 }), makeStop('L2', { col: 1 })],
        }),
      ],
      lines: [
        makeLine({ id: 'L1', stations: ['s1', 's2'] }),
        makeLine({ id: 'L2', stations: ['s1', 's2'] }),
      ],
      lineOrder: ['L2', 'L1'], // L2 in front (index 0), L1 behind (index 1)
    });
    const bands = buildBands(doc.stations, doc.lines, 24, doc.lineOrder);
    expect(bands).toHaveLength(1);
    expect(bands[0].linePriorities.length).toBe(bands[0].lines.length);
    // Each stripe carries its own line's priority — no longer collapsed to a min.
    const byId: Record<string, number> = {};
    bands[0].lines.forEach((l, i) => (byId[l.id] = bands[0].linePriorities[i]));
    expect(byId).toEqual({ L2: 0, L1: 1 });
  });
});

describe('buildOrderedRenderables — cross-band layering', () => {
  // Regression: an interlined band used to render as a single z-unit at the
  // min priority of its lines. A perpendicular line sandwiched between the
  // band's lines in lineOrder ended up rendering BEHIND the entire band,
  // not between its stripes. This test pins the per-stripe interleave so a
  // middle-layer line appears between the back stripe and the front stripe.
  it('a perpendicular line in the middle of lineOrder renders between the stripes of an interlined band', () => {
    const doc = makeDoc({
      stations: [
        // C and A interline vertically through s1 → s2 (adjacent cols).
        makeStation({
          id: 's1',
          x: 0,
          y: 0,
          stops: [makeStop('C', { col: 0 }), makeStop('A', { col: 1 })],
        }),
        makeStation({
          id: 's2',
          x: 0,
          y: 100,
          stops: [makeStop('C', { col: 0 }), makeStop('A', { col: 1 })],
        }),
        // D crosses perpendicularly with its own pair of stations.
        stationWithStop('s3', 'D', { x: -100, y: 50 }, { orientation: 'auto-horizontal' }),
        stationWithStop('s4', 'D', { x: 100, y: 50 }, { orientation: 'auto-horizontal' }),
      ],
      lines: [
        makeLine({ id: 'C', stations: ['s1', 's2'] }),
        makeLine({ id: 'A', stations: ['s1', 's2'] }),
        makeLine({ id: 'D', stations: ['s3', 's4'] }),
      ],
      lineOrder: ['C', 'D', 'A'], // C front (0), D middle (1), A back (2)
    });
    const bands = buildBands(doc.stations, doc.lines, 24, doc.lineOrder);
    const markers = buildStopMarkers(doc.stations, doc.lines, doc.lineOrder, bands);
    const list = buildOrderedRenderables(bands, markers);

    const stripeIds = list
      .filter((r): r is Extract<typeof r, { kind: 'stripe' }> => r.kind === 'stripe')
      .map((r) => r.band.lines[r.stripeIndex].id);
    const aPos = stripeIds.indexOf('A');
    const dPos = stripeIds.indexOf('D');
    const cPos = stripeIds.indexOf('C');
    expect(aPos).toBeGreaterThanOrEqual(0);
    expect(dPos).toBeGreaterThanOrEqual(0);
    expect(cPos).toBeGreaterThanOrEqual(0);
    // Render order is back-to-front (sorted descending by priority): A first,
    // then D, then C — so D paints over A and C paints over D.
    expect(aPos).toBeLessThan(dPos);
    expect(dPos).toBeLessThan(cPos);
  });
});

describe('buildBands — segmentLayer priority', () => {
  it('a layer-+1 stripe paints in front of a layer-0 stripe regardless of lineOrder', () => {
    // Two crossing lines, A globally behind B. If we bump A's only segment
    // to layer +1, A's stripe priority should now be smaller (front-most)
    // than B's despite A being later in lineOrder.
    const doc = makeDoc({
      stations: [
        stationWithStop('s1', 'A', { x: 0, y: 0 }),
        stationWithStop('s2', 'A', { x: 0, y: 100 }),
        stationWithStop('s3', 'B', { x: -50, y: 50 }, { orientation: 'auto-horizontal' }),
        stationWithStop('s4', 'B', { x: 50, y: 50 }, { orientation: 'auto-horizontal' }),
      ],
      lines: [
        makeLine({ id: 'A', stations: ['s1', 's2'], segmentLayers: { 's1|s2': 1 } }),
        makeLine({ id: 'B', stations: ['s3', 's4'] }),
      ],
      lineOrder: ['B', 'A'], // B in front by default
    });
    const bands = buildBands(doc.stations, doc.lines, 24, doc.lineOrder);
    const aBand = bands.find((b) => b.lines.some((l) => l.id === 'A'))!;
    const bBand = bands.find((b) => b.lines.some((l) => l.id === 'B'))!;
    // Smaller priority = front-most. A at layer +1 wins despite lineOrder.
    expect(aBand.linePriorities[0]).toBeLessThan(bBand.linePriorities[0]);
  });

  it('a layer-(-1) stripe paints behind a layer-0 stripe', () => {
    const doc = makeDoc({
      stations: [
        stationWithStop('s1', 'A', { x: 0, y: 0 }),
        stationWithStop('s2', 'A', { x: 0, y: 100 }),
        stationWithStop('s3', 'B', { x: -50, y: 50 }, { orientation: 'auto-horizontal' }),
        stationWithStop('s4', 'B', { x: 50, y: 50 }, { orientation: 'auto-horizontal' }),
      ],
      lines: [
        makeLine({ id: 'A', stations: ['s1', 's2'], segmentLayers: { 's1|s2': -1 } }),
        makeLine({ id: 'B', stations: ['s3', 's4'] }),
      ],
      lineOrder: ['A', 'B'], // A in front by default
    });
    const bands = buildBands(doc.stations, doc.lines, 24, doc.lineOrder);
    const aBand = bands.find((b) => b.lines.some((l) => l.id === 'A'))!;
    const bBand = bands.find((b) => b.lines.some((l) => l.id === 'B'))!;
    expect(aBand.linePriorities[0]).toBeGreaterThan(bBand.linePriorities[0]);
  });

  it('a bare line (no segmentLayers map) keeps its pre-layering priority', () => {
    const doc = makeDoc({
      stations: [
        stationWithStop('s1', 'A', { x: 0, y: 0 }),
        stationWithStop('s2', 'A', { x: 0, y: 100 }),
      ],
      lines: [makeLine({ id: 'A', stations: ['s1', 's2'] })],
    });
    const bands = buildBands(doc.stations, doc.lines, 24, doc.lineOrder);
    expect(bands[0].linePriorities[0]).toBe(0);
  });
});

describe('buildStopMarkers — segmentLayer priority', () => {
  it('a marker for a wholly-negative line stays behind a layer-0 crossing', () => {
    // Reproduces the prototype-iteration bug: stationLayerFor seeded at 0
    // used to clamp a negative-only line's marker priority to 0, so its
    // dots painted ON TOP of a layer-0 line crossing right through the
    // station. With the seed-at-first-incident fix, the marker priority is
    // strictly greater than the layer-0 stripe's priority (further back).
    const doc = makeDoc({
      stations: [
        stationWithStop('s1', 'A', { x: 0, y: 0 }),
        stationWithStop('s2', 'A', { x: 0, y: 100 }),
        stationWithStop('s3', 'A', { x: 0, y: 200 }),
        stationWithStop('s4', 'B', { x: -50, y: 100 }, { orientation: 'auto-horizontal' }),
        stationWithStop('s5', 'B', { x: 50, y: 100 }, { orientation: 'auto-horizontal' }),
      ],
      lines: [
        makeLine({
          id: 'A',
          stations: ['s1', 's2', 's3'],
          segmentLayers: { 's1|s2': -1, 's2|s3': -1 },
        }),
        makeLine({ id: 'B', stations: ['s4', 's5'] }),
      ],
    });
    const bands = buildBands(doc.stations, doc.lines, 24, doc.lineOrder);
    const markers = buildStopMarkers(doc.stations, doc.lines, doc.lineOrder, bands);
    const aMid = markers.find((m) => m.stationId === 's2' && m.lineId === 'A')!;
    const bBand = bands.find((b) => b.lines.some((l) => l.id === 'B'))!;
    // Marker further back than B's stripe → larger priority (paints earlier).
    expect(aMid.priority).toBeGreaterThan(bBand.linePriorities[0]);
  });

  it('a marker is bumped to the front-most incident layer (MAX rule)', () => {
    const doc = makeDoc({
      stations: [
        stationWithStop('s1', 'A', { x: 0, y: 0 }),
        stationWithStop('s2', 'A', { x: 0, y: 100 }),
        stationWithStop('s3', 'A', { x: 0, y: 200 }),
      ],
      lines: [
        makeLine({
          id: 'A',
          stations: ['s1', 's2', 's3'],
          segmentLayers: { 's1|s2': 0, 's2|s3': 2 }, // mixed at s2
        }),
      ],
    });
    const markers = buildStopMarkers(doc.stations, doc.lines, doc.lineOrder);
    const m = markers.find((mk) => mk.stationId === 's2' && mk.lineId === 'A')!;
    // lineIdx for A is 0 (only line), bumped by -2 * LAYER_WEIGHT.
    expect(m.priority).toBe(0 - 2 * LAYER_WEIGHT);
  });
});

describe('buildStopMarkers', () => {
  it('emits one marker per stop cell across all stations', () => {
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          x: 0,
          y: 0,
          stops: [makeStop('L1'), makeStop('L2', { col: 1 })],
        }),
        stationWithStop('s2', 'L1', { x: 0, y: 100 }),
      ],
      lines: [makeLine({ id: 'L1' }), makeLine({ id: 'L2' })],
    });
    const markers = buildStopMarkers(doc.stations, doc.lines, doc.lineOrder);
    expect(markers).toHaveLength(3);
  });

  it('rotates the marker square to the world tangent of the stop axis', () => {
    // The marker square should be flush with the band edges, so its rotation
    // tracks the world-frame travel axis of the stop — station rotation alone
    // isn't enough once diagonal stop orientations exist.
    //
    // Case 1: auto-vertical at station rotation 0 → world tangent +y (90°).
    const doc1 = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          x: 0,
          y: 0,
          rotation: 0,
          stops: [makeStop('L1', { orientation: 'auto-vertical' })],
        }),
      ],
      lines: [makeLine({ id: 'L1' })],
    });
    const m1 = buildStopMarkers(doc1.stations, doc1.lines, doc1.lineOrder);
    expect(m1).toHaveLength(1);
    expect(m1[0].rotationDeg).toBeCloseTo(90, 5);

    // Case 2: auto-nw-se at station rotation 0 → world tangent SE (45°).
    // (Square's 4-fold symmetry means 0 vs 45 is the visible difference.)
    const doc2 = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          x: 0,
          y: 0,
          rotation: 0,
          stops: [makeStop('L1', { orientation: 'auto-nw-se' })],
        }),
      ],
      lines: [makeLine({ id: 'L1' })],
    });
    const m2 = buildStopMarkers(doc2.stations, doc2.lines, doc2.lineOrder);
    expect(m2[0].rotationDeg).toBeCloseTo(45, 5);

    // Case 3: auto-ne-sw at station rotation 0 → world tangent NE (-45°).
    const doc3 = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          x: 0,
          y: 0,
          rotation: 0,
          stops: [makeStop('L1', { orientation: 'auto-ne-sw' })],
        }),
      ],
      lines: [makeLine({ id: 'L1' })],
    });
    const m3 = buildStopMarkers(doc3.stations, doc3.lines, doc3.lineOrder);
    expect(m3[0].rotationDeg).toBeCloseTo(-45, 5);
  });

  it('skips stop cells whose line was deleted', () => {
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          x: 0,
          y: 0,
          stops: [makeStop('ghost')],
        }),
      ],
      lines: [],
    });
    const markers = buildStopMarkers(doc.stations, doc.lines, doc.lineOrder);
    expect(markers).toHaveLength(0);
  });

  describe('style derivation from segmentStyles', () => {
    const lineThrough = (segmentStyles?: Record<string, LineStyle>) =>
      makeLine({ id: 'L1', stations: ['s1', 's2', 's3'], segmentStyles });
    const docWith = (segmentStyles?: Record<string, LineStyle>) =>
      makeDoc({
        stations: [
          stationWithStop('s1', 'L1', { x: 0, y: 0 }),
          stationWithStop('s2', 'L1', { x: 100, y: 0 }),
          stationWithStop('s3', 'L1', { x: 200, y: 0 }),
        ],
        lines: [lineThrough(segmentStyles)],
      });
    const markerForStation = (
      doc: ReturnType<typeof docWith>,
      stationId: string,
      lineId = 'L1',
    ) => {
      const ms = buildStopMarkers(doc.stations, doc.lines, doc.lineOrder);
      const station = doc.stations[stationId];
      return ms.find(
        (m) =>
          m.lineId === lineId && Math.abs(m.cx - station.x) < 1 && Math.abs(m.cy - station.y) < 1,
      );
    };

    it('defaults to solid when no segmentStyles are set', () => {
      const doc = docWith();
      expect(markerForStation(doc, 's2')?.style).toBe('solid');
    });

    it('solid at an interior station with one hatched and one solid adjacency', () => {
      const doc = docWith({ 's1|s2': 'hatched' });
      expect(markerForStation(doc, 's2')?.style).toBe('solid');
    });

    it('hatched at a terminus when its only adjacency is hatched', () => {
      const doc = docWith({ 's1|s2': 'hatched' });
      expect(markerForStation(doc, 's1')?.style).toBe('hatched');
    });

    it('solid at a junction with one hatched and one dashed adjacency', () => {
      const doc = docWith({ 's1|s2': 'hatched', 's2|s3': 'dashed' });
      expect(markerForStation(doc, 's2')?.style).toBe('solid');
    });

    it('hatched only when EVERY adjacency is hatched (interior between two hatched)', () => {
      const doc = docWith({ 's1|s2': 'hatched', 's2|s3': 'hatched' });
      expect(markerForStation(doc, 's2')?.style).toBe('hatched');
    });

    it('hatched-mirror only when EVERY adjacency is hatched-mirror (interior)', () => {
      const doc = docWith({ 's1|s2': 'hatched-mirror', 's2|s3': 'hatched-mirror' });
      expect(markerForStation(doc, 's2')?.style).toBe('hatched-mirror');
    });

    it('hatched-mirror at a terminus when its only adjacency is hatched-mirror', () => {
      const doc = docWith({ 's1|s2': 'hatched-mirror' });
      expect(markerForStation(doc, 's1')?.style).toBe('hatched-mirror');
    });

    it('solid at a junction with one hatched and one hatched-mirror adjacency', () => {
      const doc = docWith({ 's1|s2': 'hatched', 's2|s3': 'hatched-mirror' });
      expect(markerForStation(doc, 's2')?.style).toBe('solid');
    });

    it('dashed only when EVERY adjacency is dashed (interior between two dashed)', () => {
      const doc = docWith({ 's1|s2': 'dashed', 's2|s3': 'dashed' });
      expect(markerForStation(doc, 's2')?.style).toBe('dashed');
    });

    it('solid at an interior station with one dashed and one solid adjacency', () => {
      const doc = docWith({ 's1|s2': 'dashed' });
      expect(markerForStation(doc, 's2')?.style).toBe('solid');
    });

    it('dashed at a terminus when its only adjacency is dashed', () => {
      const doc = docWith({ 's1|s2': 'dashed' });
      expect(markerForStation(doc, 's1')?.style).toBe('dashed');
    });
  });

  describe('outward direction (terminus tangent)', () => {
    const dashedDoc = () =>
      makeDoc({
        stations: [
          stationWithStop('s1', 'L1', { x: 0, y: 0 }),
          stationWithStop('s2', 'L1', { x: 100, y: 0 }),
          stationWithStop('s3', 'L1', { x: 200, y: 0 }),
        ],
        lines: [
          makeLine({
            id: 'L1',
            stations: ['s1', 's2', 's3'],
            segmentStyles: { 's1|s2': 'dashed', 's2|s3': 'dashed' },
          }),
        ],
      });
    const findMarker = (doc: ReturnType<typeof dashedDoc>, stationId: string) => {
      const bands = buildBands(doc.stations, doc.lines, 24, doc.lineOrder);
      const ms = buildStopMarkers(doc.stations, doc.lines, doc.lineOrder, bands);
      const st = doc.stations[stationId];
      return ms.find(
        (m) => m.lineId === 'L1' && Math.abs(m.cx - st.x) < 1 && Math.abs(m.cy - st.y) < 1,
      );
    };

    it('outward at the start terminus points away from the next station', () => {
      const doc = dashedDoc();
      const m = findMarker(doc, 's1');
      // s1 is at (0,0); the line continues to s2 at (100,0). Outward (-x).
      expect(m?.outward?.x).toBeLessThan(0);
      expect(Math.abs(m?.outward?.y ?? 1)).toBeLessThan(0.01);
    });

    it('outward at the end terminus points away from the previous station', () => {
      const doc = dashedDoc();
      const m = findMarker(doc, 's3');
      // s3 is at (200,0); the line came from s2 at (100,0). Outward (+x).
      expect(m?.outward?.x).toBeGreaterThan(0);
      expect(Math.abs(m?.outward?.y ?? 1)).toBeLessThan(0.01);
    });

    it('outward is null at an interior dashed station', () => {
      const doc = dashedDoc();
      expect(findMarker(doc, 's2')?.outward).toBeNull();
    });

    it('outward is set on a SOLID terminus too (stroke end caps need it)', () => {
      const doc = makeDoc({
        stations: [
          stationWithStop('s1', 'L1', { x: 0, y: 0 }),
          stationWithStop('s2', 'L1', { x: 100, y: 0 }),
        ],
        lines: [makeLine({ id: 'L1', stations: ['s1', 's2'] })],
      });
      const m = findMarker(doc, 's1');
      expect(m?.outward?.x).toBeLessThan(0);
      expect(Math.abs(m?.outward?.y ?? 1)).toBeLessThan(0.01);
    });

    it('outward is null when bands are not supplied', () => {
      const doc = dashedDoc();
      // Calling without bands — terminus marker has no source for tangent.
      const ms = buildStopMarkers(doc.stations, doc.lines, doc.lineOrder);
      const m = ms.find((x) => x.lineId === 'L1' && Math.abs(x.cx) < 1);
      expect(m?.outward).toBeNull();
    });
  });
});

// Invariant: a stop's rendered world position equals its cell-grid world
// position. Moving any one stop must NEVER reposition another stop. There
// is no compression, no "trailer pulling", no neighbor-aware nudging — the
// (row, col) coordinates and station rotation are the source of truth for
// where a marker lands. Regressions here mean some heuristic crept back in.
describe('buildStopMarkers — rendered position equals cell-grid position', () => {
  const markerFor = (
    markers: ReturnType<typeof buildStopMarkers>,
    stationId: string,
    lineId: string,
  ) => {
    const m = markers.find((x) => x.stationId === stationId && x.lineId === lineId);
    if (!m) throw new Error(`no marker for (${stationId}, ${lineId})`);
    return { x: m.cx, y: m.cy };
  };

  it('Canary Wharf regression: cardinal pair + king-adjacent diagonal leaves the diagonal at its cell', () => {
    // The "before" layout from the user's repro: two auto-vertical stops
    // at the same row (a cardinal interline pair) plus an auto-nw-se stop
    // diagonally adjacent to one of them. Under the old heuristic the
    // diagonal got "trailer-pulled" inward toward the cardinal anchor
    // and rendered at STOP_SIZE/√2 instead of its true STOP_SIZE·√2.
    const station = makeStation({
      id: 's',
      x: 0,
      y: 0,
      rotation: 0,
      stops: [
        makeStop('A', { row: 0, col: 0, orientation: 'auto-vertical' }),
        makeStop('B', { row: 0, col: 1, orientation: 'auto-vertical' }),
        makeStop('D', { row: 1, col: -1, orientation: 'auto-nw-se' }),
      ],
    });
    const doc = makeDoc({
      stations: [station],
      lines: [makeLine({ id: 'A' }), makeLine({ id: 'B' }), makeLine({ id: 'D' })],
    });
    const markers = buildStopMarkers(doc.stations, doc.lines, doc.lineOrder);
    for (const cell of station.stops) {
      const got = markerFor(markers, 's', cell.lineId);
      const want = stopPosWorld(cell, station);
      expect(got.x).toBeCloseTo(want.x, 6);
      expect(got.y).toBeCloseTo(want.y, 6);
    }
  });

  it('moving one stop never shifts the rendered position of any other stop', () => {
    // Start from the Canary Wharf config above; move B one cell up.
    // A and D must render at the same world positions in both — the
    // invariant the user is asking for.
    const stops0 = [
      makeStop('A', { row: 0, col: 0, orientation: 'auto-vertical' }),
      makeStop('B', { row: 0, col: 1, orientation: 'auto-vertical' }),
      makeStop('D', { row: 1, col: -1, orientation: 'auto-nw-se' }),
    ];
    const before = makeStation({ id: 's', x: 50, y: 70, rotation: 0, stops: stops0 });
    const lines = [makeLine({ id: 'A' }), makeLine({ id: 'B' }), makeLine({ id: 'D' })];
    const docBefore = makeDoc({ stations: [before], lines });
    const mBefore = buildStopMarkers(docBefore.stations, docBefore.lines, docBefore.lineOrder);

    const stops1 = [
      stops0[0],
      makeStop('B', { row: -1, col: 1, orientation: 'auto-vertical' }),
      stops0[2],
    ];
    const after = makeStation({ id: 's', x: 50, y: 70, rotation: 0, stops: stops1 });
    const docAfter = makeDoc({ stations: [after], lines });
    const mAfter = buildStopMarkers(docAfter.stations, docAfter.lines, docAfter.lineOrder);

    const aBefore = markerFor(mBefore, 's', 'A');
    const aAfter = markerFor(mAfter, 's', 'A');
    expect(aAfter.x).toBeCloseTo(aBefore.x, 6);
    expect(aAfter.y).toBeCloseTo(aBefore.y, 6);

    const dBefore = markerFor(mBefore, 's', 'D');
    const dAfter = markerFor(mAfter, 's', 'D');
    expect(dAfter.x).toBeCloseTo(dBefore.x, 6);
    expect(dAfter.y).toBeCloseTo(dBefore.y, 6);
  });

  it('the invariant holds for every station rotation', () => {
    // Same "move B, observe A and D" setup as above, but at each of the 8
    // station rotations. Closes the rotation-coverage gap — a heuristic
    // that fires at a specific rotation would still get caught here.
    const stops0 = [
      makeStop('A', { row: 0, col: 0, orientation: 'auto-vertical' }),
      makeStop('B', { row: 0, col: 1, orientation: 'auto-vertical' }),
      makeStop('D', { row: 1, col: -1, orientation: 'auto-nw-se' }),
    ];
    const stops1 = [
      stops0[0],
      makeStop('B', { row: -1, col: 1, orientation: 'auto-vertical' }),
      stops0[2],
    ];
    const lines = [makeLine({ id: 'A' }), makeLine({ id: 'B' }), makeLine({ id: 'D' })];
    for (let rot = 0; rot < 8; rot++) {
      const r = rot as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
      const before = makeStation({ id: 's', x: 50, y: 70, rotation: r, stops: stops0 });
      const after = makeStation({ id: 's', x: 50, y: 70, rotation: r, stops: stops1 });
      const dBefore = makeDoc({ stations: [before], lines });
      const dAfter = makeDoc({ stations: [after], lines });
      const mBefore = buildStopMarkers(dBefore.stations, dBefore.lines, dBefore.lineOrder);
      const mAfter = buildStopMarkers(dAfter.stations, dAfter.lines, dAfter.lineOrder);

      for (const lineId of ['A', 'D']) {
        const b = markerFor(mBefore, 's', lineId);
        const a = markerFor(mAfter, 's', lineId);
        expect(a.x, `line ${lineId} x at rotation ${r}`).toBeCloseTo(b.x, 6);
        expect(a.y, `line ${lineId} y at rotation ${r}`).toBeCloseTo(b.y, 6);
      }

      // And each stop's marker still sits at stopPosWorld of its cell.
      for (const cell of before.stops) {
        const got = markerFor(mBefore, 's', cell.lineId);
        const want = stopPosWorld(cell, before);
        expect(got.x, `${cell.lineId} at rotation ${r}`).toBeCloseTo(want.x, 6);
        expect(got.y, `${cell.lineId} at rotation ${r}`).toBeCloseTo(want.y, 6);
      }
    }
  });
});
