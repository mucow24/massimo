import { describe, it, expect } from 'vitest';
import {
  buildBands,
  buildLineIndex,
  buildOrderedRenderables,
  buildStopMarkers,
} from './interlining';
import { STOP_SIZE } from './orientation';
import { makeDoc, makeLine, makeStation, makeStop, stationWithStop } from '../test/fixtures';
import type { LineStyle } from '../model/types';

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
    // auto-ne-sw band perp axis is NW-SE; perp-adjacent cells differ by
    // (dRow=+1, dCol=+1). At rotation 0 cells (0,0) and (1,1) have world
    // delta (STOP_SIZE, STOP_SIZE) = SE along the perp axis. After
    // compression the two stripes sit at ±STOP_SIZE/2 perp from the band
    // centerline, packing exactly like cardinal interlining.
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          x: 0,
          y: 0,
          rotation: 0,
          stops: [
            makeStop('L1', { row: 0, col: 0, orientation: 'auto-ne-sw' }),
            makeStop('L2', { row: 1, col: 1, orientation: 'auto-ne-sw' }),
          ],
        }),
        makeStation({
          id: 's2',
          x: 100,
          y: -100,
          rotation: 0,
          stops: [
            makeStop('L1', { row: 0, col: 0, orientation: 'auto-ne-sw' }),
            makeStop('L2', { row: 1, col: 1, orientation: 'auto-ne-sw' }),
          ],
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
    // Centerline endpoints at each station's group centroid (cell-grid mean).
    // s1 centroid: (STOP_SIZE/2, STOP_SIZE/2). s2 centroid offset by (100, -100).
    const v = bands[0].centerline;
    expect(v[0].x).toBeCloseTo(STOP_SIZE / 2, 5);
    expect(v[0].y).toBeCloseTo(STOP_SIZE / 2, 5);
    expect(v[v.length - 1].x).toBeCloseTo(100 + STOP_SIZE / 2, 5);
    expect(v[v.length - 1].y).toBeCloseTo(-100 + STOP_SIZE / 2, 5);
    expect(bands[0].warning).toBe(false);
  });

  it('merges three diagonal-adjacent lines on the same pair into a single 3-stripe band', () => {
    // Three perp-adjacent auto-nw-se stops: cells (0,0), (-1,1), (-2,2).
    // Perp axis NE-SW; consecutive cells differ by STOP_SIZE·√2 along NE
    // (world delta (STOP_SIZE, -STOP_SIZE) each step).
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          x: 0,
          y: 0,
          rotation: 0,
          stops: [
            makeStop('L1', { row: 0, col: 0, orientation: 'auto-nw-se' }),
            makeStop('L2', { row: -1, col: 1, orientation: 'auto-nw-se' }),
            makeStop('L3', { row: -2, col: 2, orientation: 'auto-nw-se' }),
          ],
        }),
        makeStation({
          id: 's2',
          x: 200,
          y: 200,
          rotation: 0,
          stops: [
            makeStop('L1', { row: 0, col: 0, orientation: 'auto-nw-se' }),
            makeStop('L2', { row: -1, col: 1, orientation: 'auto-nw-se' }),
            makeStop('L3', { row: -2, col: 2, orientation: 'auto-nw-se' }),
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
    expect(bands).toHaveLength(1);
    expect(bands[0].lines).toHaveLength(3);
    expect(bands[0].paths).toHaveLength(3);
  });

  it('two perp-adjacent runs in the same axis bucket stay separate when parallel positions differ', () => {
    // Four auto-ne-sw stops at one station: two pairs perp-adjacent within
    // each pair, but the pairs are at DIFFERENT parallel positions along
    // the band's travel axis. The compression pass must reject them as a
    // single run-of-4; the merge in buildBands must also keep them as two
    // bands (each interlined within itself).
    //
    // Cells (chosen so each pair is perp-adjacent locally but the two pairs
    // differ on the band's parallel axis):
    //   pair P: (0,0) + (1,1) — par projection 0.
    //   pair Q: (10,0) + (11,1) — par projection differs from P by a full STOP_SIZE.
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          x: 0,
          y: 0,
          rotation: 0,
          stops: [
            makeStop('L1', { row: 0, col: 0, orientation: 'auto-ne-sw' }),
            makeStop('L2', { row: 1, col: 1, orientation: 'auto-ne-sw' }),
            makeStop('L3', { row: 10, col: 0, orientation: 'auto-ne-sw' }),
            makeStop('L4', { row: 11, col: 1, orientation: 'auto-ne-sw' }),
          ],
        }),
        makeStation({
          id: 's2',
          x: 100,
          y: -100,
          rotation: 0,
          stops: [
            makeStop('L1', { row: 0, col: 0, orientation: 'auto-ne-sw' }),
            makeStop('L2', { row: 1, col: 1, orientation: 'auto-ne-sw' }),
            makeStop('L3', { row: 10, col: 0, orientation: 'auto-ne-sw' }),
            makeStop('L4', { row: 11, col: 1, orientation: 'auto-ne-sw' }),
          ],
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
    // At s1, L1/L2/L3 form a 3-stop diagonal interline group. At s2, only
    // L1/L2 form a 2-stop group (L3 sits at an unrelated parallel position).
    // The two ends don't have matching parallel positions at L3, so the
    // buildBands sameParA/sameParB check should reject a single 3-band
    // merge — leaving L1+L2 as one 2-stripe band and L3 as a singleton.
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          x: 0,
          y: 0,
          rotation: 0,
          stops: [
            makeStop('L1', { row: 0, col: 0, orientation: 'auto-ne-sw' }),
            makeStop('L2', { row: 1, col: 1, orientation: 'auto-ne-sw' }),
            makeStop('L3', { row: 2, col: 2, orientation: 'auto-ne-sw' }),
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
            makeStop('L2', { row: 1, col: 1, orientation: 'auto-ne-sw' }),
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

  it('trailers on BOTH sides of a diagonal band each pull in by STOP_SIZE', () => {
    // Three-stop diagonal interline group with one trailer at each perp end:
    //   T_NE (above the NE end) and T_SW (below the SW end).
    // Each trailer should land STOP_SIZE in its king-direction from the
    // nearest band stop's compressed position.
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          x: 0,
          y: 0,
          rotation: 0,
          stops: [
            // 3-stop auto-nw-se diagonal band along the NE-SW perp chain.
            makeStop('L1', { row: 1, col: 2, orientation: 'auto-nw-se' }),
            makeStop('L2', { row: 2, col: 1, orientation: 'auto-nw-se' }),
            makeStop('L3', { row: 3, col: 0, orientation: 'auto-nw-se' }),
            // Trailer one diagonal step past the NE end (above L1).
            makeStop('TNE', { row: 0, col: 3, orientation: 'auto-horizontal' }),
            // Trailer one diagonal step past the SW end (below L3).
            makeStop('TSW', { row: 4, col: -1, orientation: 'auto-horizontal' }),
          ],
        }),
      ],
      lines: [
        makeLine({ id: 'L1', stations: ['s1'] }),
        makeLine({ id: 'L2', stations: ['s1'] }),
        makeLine({ id: 'L3', stations: ['s1'] }),
        makeLine({ id: 'TNE', stations: ['s1'] }),
        makeLine({ id: 'TSW', stations: ['s1'] }),
      ],
    });
    // Use buildStopMarkers as a black-box: the marker positions are the
    // rendered positions consumed by everything visual.
    const markers = buildStopMarkers(doc.stations, doc.lines, doc.lineOrder);
    const pos = (lineId: string) => {
      const m = markers.find((x) => x.lineId === lineId);
      if (!m) throw new Error(`no marker for ${lineId}`);
      return { x: m.cx, y: m.cy };
    };
    const l1 = pos('L1');
    const l3 = pos('L3');
    const tne = pos('TNE');
    const tsw = pos('TSW');

    // TNE sits one king-direction step past L1 in the cell grid. Cell delta
    // L1 → TNE = (-1, 1) → world delta (STOP_SIZE, -STOP_SIZE) → NE direction.
    // Distance after pull-in: STOP_SIZE.
    expect(Math.hypot(tne.x - l1.x, tne.y - l1.y)).toBeCloseTo(STOP_SIZE, 5);

    // TSW sits one king-direction step past L3. Cell delta L3 → TSW =
    // (1, -1) → SW direction. Distance: STOP_SIZE.
    expect(Math.hypot(tsw.x - l3.x, tsw.y - l3.y)).toBeCloseTo(STOP_SIZE, 5);

    // Each trailer is on the OUTSIDE of the band, not between band stops.
    // Verify: distance from each trailer to the band centroid (L2's cell) is
    // larger than 2·STOP_SIZE (i.e., beyond the band's compressed extent).
    const centroidX = STOP_SIZE; // L2's col
    const centroidY = 2 * STOP_SIZE; // L2's row
    expect(Math.hypot(tne.x - centroidX, tne.y - centroidY)).toBeGreaterThan(2 * STOP_SIZE - 0.1);
    expect(Math.hypot(tsw.x - centroidX, tsw.y - centroidY)).toBeGreaterThan(2 * STOP_SIZE - 0.1);
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

  describe('outward direction (dashed terminus cap-extension)', () => {
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

    it('outward is null on a non-dashed terminus', () => {
      const doc = makeDoc({
        stations: [
          stationWithStop('s1', 'L1', { x: 0, y: 0 }),
          stationWithStop('s2', 'L1', { x: 100, y: 0 }),
        ],
        lines: [makeLine({ id: 'L1', stations: ['s1', 's2'] })],
      });
      expect(findMarker(doc, 's1')?.outward).toBeNull();
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
