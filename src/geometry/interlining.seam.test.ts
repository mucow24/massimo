import { describe, it, expect } from 'vitest';
import { buildBands } from './interlining';
import { closestParamOnOffsetPath, sampleOffsetPath } from './lineTagGeometry';
import { lineWidthOf } from '../model/lineWidth';
import { lineStrokeRailWidth } from '../model/lineStroke';
import { makeDoc, makeLine, makeStation, makeStop } from '../test/fixtures';
import type { MapDoc } from '../model/types';

// ---------------------------------------------------------------------------
// The branch seam shows ONLY where a line overlaps itself.
//
// The seam is the casing's OUTER ring (a railW-wide stroke just outside each
// band edge) painted in the seam color and CLIPPED to the line's own body
// corridor (SeamClips). So a seam point is VISIBLE exactly when it falls inside
// the corridor — i.e. over ANOTHER of the line's bands (a branch/loop overlap)
// — and clipped away on the true outer boundary of a plain segment.
//
// This models the clip geometrically (jsdom doesn't apply SVG clipping): a seam
// ring sample is "visible" iff it lies within w/2 of some band's centerline
// (inside the width-w corridor). It never lies in its OWN band's corridor (the
// ring sits railW/2 beyond that edge), so a lone straight line shows no seam,
// while a junction does.
// ---------------------------------------------------------------------------

function visibleSeamPoints(doc: MapDoc, lineId: string): number {
  const bands = buildBands(doc.stations, doc.lines, doc.curveRadius, doc.lineOrder);
  const line = doc.lines[lineId];
  const w = lineWidthOf(line);
  const railW = lineStrokeRailWidth(line.strokeWidth ?? 0, w);
  const ringOffset = w / 2 + railW / 2; // the seam ring, just outside each body edge
  const stationPts = Object.values(doc.stations).map((s) => ({ x: s.x, y: s.y }));
  const nearDot = (p: { x: number; y: number }) =>
    stationPts.some((s) => Math.hypot(p.x - s.x, p.y - s.y) <= w);

  let visible = 0;
  for (const b of bands) {
    for (const side of [-1, 1]) {
      const off = b.stripeOffsets[0] + side * ringOffset;
      for (let i = 0; i <= 40; i++) {
        const { p } = sampleOffsetPath(b.centerline, b.radius, off, i / 40);
        if (nearDot(p)) continue;
        // Inside the line's corridor (within w/2 of SOME band's centerline)?
        // The ring is railW/2 outside its own band, so this only hits when it
        // falls over a DIFFERENT band — a self-overlap.
        const inCorridor = bands.some(
          (o) =>
            closestParamOnOffsetPath(o.centerline, o.radius, o.stripeOffsets[0], p).dist <=
            w / 2 + 1e-6,
        );
        if (inCorridor) visible++;
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
