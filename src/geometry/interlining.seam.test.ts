import { describe, it, expect } from 'vitest';
import { buildBands } from './interlining';
import { closestParamOnOffsetPath, sampleOffsetPath } from './lineTagGeometry';
import { lineWidthOf } from '../model/lineWidth';
import { makeDoc, makeLine, makeStation, makeStop } from '../test/fixtures';
import type { MapDoc, StopOrientation } from '../model/types';

// ---------------------------------------------------------------------------
// The branch seam shows ONLY where a line overlaps itself.
//
// The seam is two strokes CENTERED on each band edge (offset ± width/2, exactly
// where the casing sits, so the seam aligns with it), painted in the seam color
// and CLIPPED to the line's OTHER band corridors (SeamClips excludes the seam's
// own band). So a seam point is VISIBLE exactly when it falls strictly inside a
// DIFFERENT band's corridor — a branch/loop overlap — and clipped away on a
// plain segment (its own corridor is excluded) and on the outer boundary.
//
// This models the clip geometrically (jsdom doesn't apply SVG clipping): a seam
// sample on band b's edge is "visible" iff it lies within w/2 of ANOTHER band's
// centerline AND that band's nearest point is interior to its run. The second
// half carries the collinear cases, where distance alone says nothing: an edge
// point is exactly w/2 from any collinear centerline whether the bands merely
// meet end-to-end or genuinely overlap. So a lone straight line and a collinear
// joint show no seam, while a collinear self-overlap does.
// ---------------------------------------------------------------------------

function visibleSeamPoints(doc: MapDoc, lineId: string): number {
  const bands = buildBands(doc.stations, doc.lines, doc.lineOrder);
  const line = doc.lines[lineId];
  const w = lineWidthOf(line);
  const edgeOffset = w / 2; // the seam sits centered on each body edge
  const stationPts = Object.values(doc.stations).map((s) => ({ x: s.x, y: s.y }));
  const nearDot = (p: { x: number; y: number }) =>
    stationPts.some((s) => Math.hypot(p.x - s.x, p.y - s.y) <= w);

  let visible = 0;
  for (const b of bands) {
    for (const side of [-1, 1]) {
      const off = b.stripeOffsets[0] + side * edgeOffset;
      for (let i = 0; i <= 40; i++) {
        const { p } = sampleOffsetPath(b.centerline, b.radius, off, i / 40);
        if (nearDot(p)) continue;
        // Inside a DIFFERENT band's corridor? (The seam's own corridor is
        // excluded by the clip.)
        //
        // Distance alone cannot answer this for collinear bands: a point on b's
        // edge sits at EXACTLY w/2 from any collinear centerline, whether the
        // two bands merely meet end-to-end or genuinely overlap. A margin that
        // excluded the boundary therefore made every collinear case impossible
        // to count, so the "no seam at a collinear joint" assertion below held
        // by construction rather than by product behaviour.
        //
        // What separates a joint from an overlap is ALONG-track position: at a
        // joint the nearest point of the neighbouring band is its shared
        // endpoint (t at 0 or 1); in an overlap it is interior to the run.
        const inOther = bands.some((o) => {
          if (o === b) return false;
          const { t, dist } = closestParamOnOffsetPath(
            o.centerline,
            o.radius,
            o.stripeOffsets[0],
            p,
          );
          return dist <= w / 2 + 1e-6 && t > 0.02 && t < 0.98;
        });
        if (inOther) visible++;
      }
    }
  }
  return visible;
}

const seamLine = (edges: string[]) =>
  makeLine({ id: 'l1', color: '#c00', strokeWidth: 4, seamColor: '#ffffff80', edges });
const hStop = () => makeStop('l1', { orientation: 'auto-horizontal' });

describe('branch seam is localized to self-overlaps', () => {
  it('a degree-3 junction shows the seam over the branch overlap', () => {
    const doc = makeDoc({
      stations: [
        makeStation({ id: 'j', x: 0, y: 0, stops: [hStop()] }),
        makeStation({ id: 'a', x: -120, y: 0, stops: [hStop()] }),
        makeStation({ id: 'c', x: 120, y: 0, stops: [hStop()] }),
        makeStation({ id: 'd', x: 120, y: -120, stops: [hStop()] }),
      ],
      lines: [seamLine(['a|j', 'c|j', 'd|j'])],
    });
    expect(visibleSeamPoints(doc, 'l1')).toBeGreaterThan(0);
  });

  it('a lone straight line shows NO seam (fully clipped away)', () => {
    const doc = makeDoc({
      stations: [
        makeStation({ id: 's1', x: 0, y: 0, stops: [hStop()] }),
        makeStation({ id: 's2', x: 200, y: 0, stops: [hStop()] }),
      ],
      lines: [seamLine(['s1|s2'])],
    });
    // The content is the band count: one edge builds one band, so there is no
    // OTHER corridor for the seam to survive in. Without this the assertion
    // below is just `[].some(...)` and holds for any implementation.
    expect(buildBands(doc.stations, doc.lines, doc.lineOrder)).toHaveLength(1);
    expect(visibleSeamPoints(doc, 'l1')).toBe(0);
  });

  it('a COLLINEAR self-overlap does show the seam', () => {
    // The positive counterpart to the collinear-joint case below, on the same
    // probe: a|b and b|c meet end-to-end, and a|c runs the whole length back
    // over both. Same headings, same collinearity — the only difference is that
    // corridors genuinely overlap here, so this is what proves the "no seam at
    // a collinear joint" assertion is reporting geometry and not a tautology.
    const doc = makeDoc({
      stations: [
        makeStation({ id: 'a', x: -120, y: 0, stops: [hStop()] }),
        makeStation({ id: 'b', x: 0, y: 0, stops: [hStop()] }),
        makeStation({ id: 'c', x: 120, y: 0, stops: [hStop()] }),
      ],
      lines: [seamLine(['a|b', 'b|c', 'a|c'])],
    });
    expect(visibleSeamPoints(doc, 'l1')).toBeGreaterThan(0);
  });

  it('a plain collinear through-station shows NO seam (an end-to-end joint is not an overlap)', () => {
    const doc = makeDoc({
      stations: [
        makeStation({ id: 'b', x: 0, y: 0, stops: [hStop()] }),
        makeStation({ id: 'a', x: -120, y: 0, stops: [hStop()] }),
        makeStation({ id: 'c', x: 120, y: 0, stops: [hStop()] }),
      ],
      lines: [seamLine(['a|b', 'b|c'])],
    });
    expect(visibleSeamPoints(doc, 'l1')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Which ARM of the notch each band is — the verdict `seamEdges` selects on.
// Read off the JUNCTION (assignSeamArms), never off the band's own shape.
// ---------------------------------------------------------------------------

describe('branch arms are read off the junction', () => {
  const armsByPair = (doc: MapDoc): Record<string, string[]> => {
    const out: Record<string, string[]> = {};
    for (const b of buildBands(doc.stations, doc.lines, doc.lineOrder)) out[b.pairKey] = b.seamArms;
    return out;
  };
  const stopAt = (orientation: StopOrientation) => makeStop('l1', { orientation });

  it('a degree-3 junction: the opposed pair runs through, the odd arm is the branch', () => {
    const arms = armsByPair(
      makeDoc({
        stations: [
          makeStation({ id: 'j', x: 0, y: 0, stops: [hStop()] }),
          makeStation({ id: 'a', x: -120, y: 0, stops: [hStop()] }),
          makeStation({ id: 'c', x: 120, y: 0, stops: [hStop()] }),
          makeStation({ id: 'd', x: 120, y: -120, stops: [stopAt('auto-vertical')] }),
        ],
        lines: [seamLine(['a|j', 'c|j', 'd|j'])],
      }),
    );
    expect(arms['a|j']).toEqual(['straight']);
    expect(arms['c|j']).toEqual(['straight']);
    expect(arms['d|j']).toEqual(['curved']);
  });

  it('a two-band station is no junction, however its bands bend', () => {
    // A corner: one band arrives horizontally, the next leaves vertically.
    // Nothing turns AWAY from anything here, so neither band is a branch.
    const arms = armsByPair(
      makeDoc({
        stations: [
          makeStation({ id: 'b', x: 0, y: 0, stops: [hStop()] }),
          makeStation({ id: 'a', x: -120, y: 0, stops: [hStop()] }),
          makeStation({ id: 'c', x: 120, y: -120, stops: [stopAt('auto-vertical')] }),
        ],
        lines: [seamLine(['a|b', 'b|c'])],
      }),
    );
    expect(arms['a|b']).toEqual(['straight']);
    expect(arms['b|c']).toEqual(['straight']);
  });

  // The shape that exposed this: the A line at Broad Channel. n — j — m runs
  // through on the NW/SE diagonal; b branches off it, leaving j along that SAME
  // diagonal and only turning away 85 units on. So the junction has TWO arms
  // dead opposite the incoming one, and the through-run is the one that stays
  // straight longer. Meanwhile m sits off-axis, so the through band j|m doglegs
  // to reach it — 280 units from the junction, and no business of the notch.
  const broadChannel = (nAt = -200, edges = ['j|n', 'j|m', 'b|j']) =>
    makeDoc({
      stations: [
        makeStation({ id: 'j', x: 0, y: 0, stops: [stopAt('auto-nw-se')] }),
        makeStation({ id: 'n', x: nAt, y: nAt, stops: [stopAt('auto-nw-se')] }),
        makeStation({ id: 'm', x: 200, y: 260, stops: [stopAt('auto-vertical')] }),
        makeStation({ id: 'b', x: 140, y: 60, stops: [stopAt('auto-horizontal')] }),
      ],
      lines: [seamLine(edges)],
    });

  // Every permutation of the same three edges: `line.edges` order is the user's,
  // and the arms must not be.
  const EDGE_ORDERS = [
    ['j|n', 'j|m', 'b|j'],
    ['j|n', 'b|j', 'j|m'],
    ['b|j', 'j|m', 'j|n'],
    ['j|m', 'b|j', 'j|n'],
  ];

  it('the arm that peels off first is the branch, when two leave on the same axis', () => {
    for (const edges of EDGE_ORDERS) {
      const arms = armsByPair(broadChannel(-200, edges));
      expect(arms['b|j']).toEqual(['curved']);
      expect(arms['j|m']).toEqual(['straight']);
      expect(arms['j|n']).toEqual(['straight']);
    }
  });

  // Same junction, but the INCOMING arm is now the shortest of the three. Both
  // candidate through-pairs contain it, so scoring a pair by its SHORTER run
  // saturates on it and calls them equal — and the verdict falls to whatever
  // order the edges happen to be declared in. A through-run's length is the
  // length of BOTH its arms, so the pairs score 353 and 155 and never tie.
  it('scores a through-run by both its arms, not the shorter one', () => {
    for (const edges of EDGE_ORDERS) {
      const arms = armsByPair(broadChannel(-50, edges));
      expect(arms['b|j']).toEqual(['curved']);
      expect(arms['j|m']).toEqual(['straight']);
      expect(arms['j|n']).toEqual(['straight']);
    }
  });

  it('a self-crossing has TWO through-runs, and neither is a branch', () => {
    // The line reaches j twice and crosses itself there: four band ends, two
    // dead-opposed pairs. Picking one pair and calling the rest branches would
    // paint half an X.
    const arms = armsByPair(
      makeDoc({
        stations: [
          makeStation({ id: 'j', x: 0, y: 0, stops: [hStop()] }),
          makeStation({ id: 'w', x: -200, y: 0, stops: [hStop()] }),
          makeStation({ id: 'e', x: 200, y: 0, stops: [hStop()] }),
          makeStation({ id: 'n', x: 0, y: -200, stops: [stopAt('auto-vertical')] }),
          makeStation({ id: 's', x: 0, y: 200, stops: [stopAt('auto-vertical')] }),
        ],
        lines: [seamLine(['j|w', 'e|j', 'j|n', 'j|s'])],
      }),
    );
    expect(arms['j|w']).toEqual(['straight']);
    expect(arms['e|j']).toEqual(['straight']);
    expect(arms['j|n']).toEqual(['straight']);
    expect(arms['j|s']).toEqual(['straight']);
  });

  // Four ends again, but every one of them on the SAME axis: the AirTrain at
  // Federal Circle, where the trunk arrives from the SW, one branch doubles
  // back SW and two more leave NE for the terminal loop. Every SW/NE pair is
  // dead opposed, so a second run taken on opposition alone pairs the leftovers
  // up and calls all four a through-run — nothing under Branch, and the fork
  // painted over itself under Mainline.
  const federalCircle = (edges = ['j|trunk', 'back|j', 'j|up', 'j|right']) =>
    makeDoc({
      stations: [
        makeStation({ id: 'j', x: 0, y: 0, stops: [stopAt('auto-ne-sw')] }),
        makeStation({ id: 'trunk', x: -200, y: 200, stops: [stopAt('auto-ne-sw')] }),
        makeStation({ id: 'back', x: -100, y: 60, stops: [hStop()] }),
        makeStation({ id: 'up', x: 70, y: -180, stops: [stopAt('auto-vertical')] }),
        makeStation({ id: 'right', x: 180, y: -60, stops: [hStop()] }),
      ],
      lines: [seamLine(edges)],
    });

  it('two runs on ONE axis are a fork, not a crossing', () => {
    for (const edges of [
      ['j|trunk', 'back|j', 'j|up', 'j|right'],
      ['j|right', 'j|up', 'back|j', 'j|trunk'],
      ['back|j', 'j|right', 'j|trunk', 'j|up'],
    ]) {
      const arms = armsByPair(federalCircle(edges));
      // The trunk and the arm that stays straight longest run through.
      expect(arms['j|trunk']).toEqual(['straight']);
      expect(arms['j|up']).toEqual(['straight']);
      // The other two leave along the same axis and peel away: both branches.
      expect(arms['back|j']).toEqual(['curved']);
      expect(arms['j|right']).toEqual(['curved']);
    }
  });

  it("a through band's far-end dogleg does not make it a branch", () => {
    const doc = broadChannel();
    const through = buildBands(doc.stations, doc.lines, doc.lineOrder).find(
      (b) => b.pairKey === 'j|m',
    )!;
    // It really does bend — the vertex between its two runs — and that bend is
    // 280 units from the junction, the whole length of the corridor away.
    const [j, bend] = through.centerline;
    expect(through.centerline.length).toBe(3);
    expect(Math.hypot(bend.x - j.x, bend.y - j.y)).toBeGreaterThan(250);
    expect(through.seamArms).toEqual(['straight']);
  });
});
