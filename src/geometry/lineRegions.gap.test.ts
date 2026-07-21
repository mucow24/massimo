import { describe, it, expect } from 'vitest';
import { buildBandGeometry, buildStopMarkers } from './interlining';
import { buildExclusionHoles, buildOverlapRegions } from './lineRegions';
import { pointInFace, splitIntoFaces } from './clip';
import { makeDoc, makeLine, makeStation, makeStop } from '../test/fixtures';
import type { Vec2 } from './vec';
import type { LineId } from '../model/types';

const contains = (rings: Vec2[][] | undefined, p: Vec2): boolean =>
  !!rings && splitIntoFaces(rings).some((f) => pointInFace(p, f));

// The screenshot scenario: a two-stripe GAPPED band (B and O, vertical,
// interline gap 4 → stripe bodies [93,107] and [111,125] with background
// showing in the gap [107,111]) crossed by a horizontal line G painted
// ABOVE by lineOrder but assigned to pass UNDER both stripes. G's clip
// holes must stay on the winners' opaque paint — G stays visible in the gap.
function gappedCrossing() {
  const bandStops = () => [
    makeStop('B', { row: 0, col: 0, orientation: 'auto-vertical' }),
    makeStop('O', { row: 0, col: 18 / 14, orientation: 'auto-vertical' }),
  ];
  const doc = makeDoc({
    stations: [
      makeStation({ id: 's1', x: 100, y: -60, stops: bandStops() }),
      makeStation({ id: 's2', x: 100, y: 260, stops: bandStops() }),
      makeStation({ id: 's3', x: -60, y: 100, stops: [makeStop('G')] }),
      makeStation({ id: 's4', x: 260, y: 100, stops: [makeStop('G')] }),
    ],
    lines: [
      makeLine({ id: 'G', stations: ['s3', 's4'] }),
      makeLine({ id: 'B', stations: ['s1', 's2'], interlineGap: 4 }),
      makeLine({ id: 'O', stations: ['s1', 's2'] }),
    ],
  });
  const bands = buildBandGeometry(doc.stations, doc.lines);
  const markers = buildStopMarkers(doc.stations, doc.lines, [], bands);
  return { doc, bands, markers };
}

describe('exclusion holes at a gapped band', () => {
  it('the loser stays visible in the interline gap (holes clamp to winner paint)', () => {
    const { bands, markers } = gappedCrossing();
    const gapped = bands.find((b) => b.lines.length === 2);
    expect(gapped).toBeDefined();
    // Sanity: the band really is gapped — offsets ±9 around x=109 → bodies
    // [93,107] and [111,125].
    expect(gapped!.stripeOffsets).toEqual([-9, 9]);

    const faces = buildOverlapRegions(bands, markers);
    expect(faces).toHaveLength(2);
    const winnerOf = (i: number): LineId => faces[i].lineIds.find((id) => id !== 'G') as LineId;
    const winners = faces.map((f, i) => ({ winner: winnerOf(i), assignmentId: `r${i}` }));
    const holes = buildExclusionHoles(faces, winners, ['G', 'B', 'O'], bands, markers, () => 0);
    const hole = holes.get('G');
    expect(hole).toBeDefined();

    // G is cut over both face interiors…
    expect(contains(hole, { x: 100, y: 100 })).toBe(true);
    expect(contains(hole, { x: 118, y: 100 })).toBe(true);
    // …but NEVER in the gap between the stripes (x ∈ [107, 111]) — that is
    // background territory where G must keep painting. A hole here is the
    // white notch bug.
    expect(contains(hole, { x: 107.5, y: 100 })).toBe(false);
    expect(contains(hole, { x: 109, y: 100 })).toBe(false);
    expect(contains(hole, { x: 110.5, y: 100 })).toBe(false);
    // Nor outside the band's outer edges.
    expect(contains(hole, { x: 92.5, y: 100 })).toBe(false);
    expect(contains(hole, { x: 125.5, y: 100 })).toBe(false);
  });
});
