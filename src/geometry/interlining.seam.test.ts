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
  const bands = buildBands(doc.stations, doc.lines, doc.curveRadius, doc.lineOrder);
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
        makeStation({ id: 'a', x: -120, y: 0, stops: [hStop()] }),
        makeStation({ id: 'b', x: 0, y: 0, stops: [hStop()] }),
        makeStation({ id: 'c', x: 120, y: 0, stops: [hStop()] }),
      ],
      lines: [seamLine(['a|b', 'b|c'])],
    });
    expect(visibleSeamPoints(doc, 'l1')).toBe(0);
  });
});
