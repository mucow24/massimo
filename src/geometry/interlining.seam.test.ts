import { describe, it, expect } from 'vitest';
import { buildBands } from './interlining';
import { closestParamOnOffsetPath, sampleOffsetPath } from './lineTagGeometry';
import { lineWidthOf } from '../model/lineWidth';
import { makeDoc, makeLine, makeStation, makeStop } from '../test/fixtures';
import type { MapDoc } from '../model/types';

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
// centerline. On its own straight run the edge only touches its own corridor
// boundary, so a lone straight line (and a collinear joint) shows no seam.
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
        // Strictly inside a DIFFERENT band's corridor? (The seam's own corridor
        // is excluded by the clip; a collinear joint only reaches the boundary,
        // not the interior — the margin keeps that from counting.)
        const inOther = bands.some(
          (o) =>
            o !== b &&
            closestParamOnOffsetPath(o.centerline, o.radius, o.stripeOffsets[0], p).dist <
              w / 2 - 0.5,
        );
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
    expect(visibleSeamPoints(doc, 'l1')).toBe(0);
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
  const stopAt = (orientation: 'auto-horizontal' | 'auto-vertical' | 'auto-nw-se') =>
    makeStop('l1', { orientation });

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
  const broadChannel = () =>
    makeDoc({
      stations: [
        makeStation({ id: 'j', x: 0, y: 0, stops: [stopAt('auto-nw-se')] }),
        makeStation({ id: 'n', x: -200, y: -200, stops: [stopAt('auto-nw-se')] }),
        makeStation({ id: 'm', x: 200, y: 260, stops: [stopAt('auto-vertical')] }),
        makeStation({ id: 'b', x: 140, y: 60, stops: [stopAt('auto-horizontal')] }),
      ],
      lines: [seamLine(['j|n', 'j|m', 'b|j'])],
    });

  it('the arm that peels off first is the branch, when two leave on the same axis', () => {
    const arms = armsByPair(broadChannel());
    expect(arms['b|j']).toEqual(['curved']);
    expect(arms['j|m']).toEqual(['straight']);
    expect(arms['j|n']).toEqual(['straight']);
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
