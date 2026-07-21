import { describe, it, expect } from 'vitest';
import {
  EXCLUSION_INSET,
  buildExclusionHoles,
  buildOverlapRegions,
  type RegionSliver,
} from './lineRegions';
import { pointInFace, splitIntoFaces } from './clip';
import { makeBandSpec } from '../test/fixtures';
import type { Vec2 } from './vec';
import type { LineId } from '../model/types';

const hBand = (lineId: string, pairKey: string, x0: number, x1: number, y = 0) => {
  const [fromId, toId] = pairKey.split('|');
  return makeBandSpec([lineId], {
    pairKey,
    bandKey: `${pairKey}#${lineId}`,
    fromId,
    toId,
    centerline: [
      { x: x0, y },
      { x: x1, y },
    ],
    paths: [`M${x0},${y} L${x1},${y}`],
  });
};
const vBand = (lineId: string, pairKey: string, y0: number, y1: number, x: number) => {
  const [fromId, toId] = pairKey.split('|');
  return makeBandSpec([lineId], {
    pairKey,
    bandKey: `${pairKey}#${lineId}`,
    fromId,
    toId,
    centerline: [
      { x, y: y0 },
      { x, y: y1 },
    ],
    paths: [`M${x},${y0} L${x},${y1}`],
  });
};

const contains = (rings: Vec2[][] | undefined, p: Vec2): boolean =>
  !!rings && splitIntoFaces(rings).some((f) => pointInFace(p, f));

/** l1 horizontal, l2 vertical crossing at (50,0); lineOrder puts l1 on top. */
const cross = () => [hBand('l1', 's1|s2', 0, 100), vBand('l2', 's3|s4', -50, 50, 50)];

describe('buildExclusionHoles', () => {
  it('punches a hole in every cover line painted ABOVE the winner — and only those', () => {
    const bands = cross();
    const faces = buildOverlapRegions(bands, []);
    const winners = [{ winner: 'l2' as LineId, assignmentId: 'r1' }];
    const holes = buildExclusionHoles(faces, winners, ['l1', 'l2'], bands, [], () => 0);
    // l1 (above the winner) is excluded over the face…
    expect(contains(holes.get('l1'), { x: 50, y: 0 })).toBe(true);
    // …the winner itself is never clipped.
    expect(holes.has('l2')).toBe(false);
  });

  it('retreats from the WINNER’s body edges so the hole edge sits on opaque winner paint', () => {
    const bands = cross();
    const faces = buildOverlapRegions(bands, []);
    const winners = [{ winner: 'l2' as LineId, assignmentId: 'r1' }];
    const holes = buildExclusionHoles(faces, winners, ['l1', 'l2'], bands, [], () => 0);
    const hole = holes.get('l1');
    // Winner l2's body spans x ∈ [43, 57]. Within EXCLUSION_INSET of its
    // edge the hole has retreated — l1 still paints there, hiding l2's soft
    // antialiased edge tail under opaque l1. The inset is deliberately TINY
    // (l1 visibly bites into l2's edge by exactly this much where the edge
    // faces open background — see the constant's doc), so probe close in.
    expect(contains(hole, { x: 43 + EXCLUSION_INSET * 0.4, y: 0 })).toBe(false);
    expect(contains(hole, { x: 57 - EXCLUSION_INSET * 0.4, y: 0 })).toBe(false);
    // Past the retreat the hole is open.
    expect(contains(hole, { x: 43 + EXCLUSION_INSET + 0.05, y: 0 })).toBe(true);
    expect(contains(hole, { x: 44, y: 0 })).toBe(true);
    // Along the LOSER l1's own edges (y = ±7) there is NO retreat — the hole
    // cuts exactly at l1's stroke edge (no paint beyond it anyway).
    expect(contains(hole, { x: 50, y: 6.9 })).toBe(true);
    expect(contains(hole, { x: 50, y: -6.9 })).toBe(true);
    // The hole never escapes the face.
    expect(contains(hole, { x: 50, y: 8 })).toBe(false);
    expect(contains(hole, { x: 60, y: 0 })).toBe(false);
  });

  it('is empty when every choice equals the lineOrder default', () => {
    const bands = cross();
    const faces = buildOverlapRegions(bands, []);
    // Bound assignment, but its line IS the default — nothing to exclude.
    const winners = [{ winner: 'l1' as LineId, assignmentId: 'r1' }];
    expect(buildExclusionHoles(faces, winners, ['l1', 'l2'], bands, [], () => 0).size).toBe(0);
    // No assignment at all: same.
    const unbound = [{ winner: 'l1' as LineId, assignmentId: null }];
    expect(buildExclusionHoles(faces, unbound, ['l1', 'l2'], bands, [], () => 0).size).toBe(0);
  });

  it('with a middle winner, excludes only the lines above it', () => {
    // Three lines through one crossing zone: l1 top, l2 middle, l3 bottom.
    const bands = [
      hBand('l1', 's1|s2', 0, 100),
      vBand('l2', 's3|s4', -50, 50, 50),
      hBand('l3', 's5|s6', 0, 100, 4), // overlaps l1's band heavily
    ];
    const faces = buildOverlapRegions(bands, []);
    const triple = faces.findIndex((f) => f.lineIds.length === 3);
    expect(triple).toBeGreaterThanOrEqual(0);
    const winners = faces.map((f, i) =>
      i === triple
        ? { winner: 'l2' as LineId, assignmentId: 'r1' }
        : { winner: f.lineIds[0], assignmentId: null },
    );
    const holes = buildExclusionHoles(faces, winners, ['l1', 'l2', 'l3'], bands, [], () => 0);
    const probe = {
      x: (faces[triple].bbox.x0 + faces[triple].bbox.x1) / 2,
      y: (faces[triple].bbox.y0 + faces[triple].bbox.y1) / 2,
    };
    // l1 (above winner l2) is excluded; l3 (below) keeps painting — the
    // winner covers it in the normal painter's order.
    expect(contains(holes.get('l1'), probe)).toBe(true);
    expect(holes.has('l3')).toBe(false);
    expect(holes.has('l2')).toBe(false);
  });
});

describe('buildExclusionHoles — casings', () => {
  // l1 horizontal (loser, painted above), l2 vertical (winner). Body edges:
  // l1 y = ±7, l2 x = 43/57. A railW of 2 puts each line's white fringe 1
  // unit outside its body edges.
  const winners = [{ winner: 'l2' as LineId, assignmentId: 'r1' }];

  it("removes the LOSER's white fringe where it crosses the winner beyond the face", () => {
    const bands = cross();
    const faces = buildOverlapRegions(bands, []);
    const railW = (id: string) => (id === 'l1' ? 2 : 0);
    const holes = buildExclusionHoles(faces, winners, ['l1', 'l2'], bands, [], railW);
    const hole = holes.get('l1');
    // l1's fringe over l2's body, just past the face (y ∈ [7, 8]): without
    // this, a white slash cuts the winner's continuous run at the boundary.
    expect(contains(hole, { x: 50, y: 7.5 })).toBe(true);
    expect(contains(hole, { x: 50, y: -7.5 })).toBe(true);
    // The fringe removal hugs the face — not the whole corridor.
    expect(contains(hole, { x: 50, y: 11 })).toBe(false);
    // And never cuts l1's fringe off the winner's body (background there).
    expect(contains(hole, { x: 60, y: 7.5 })).toBe(false);
  });

  it("uncovers the WINNER's own rails so they cut across the loser like a top line's", () => {
    const bands = cross();
    const faces = buildOverlapRegions(bands, []);
    const railW = (id: string) => (id === 'l2' ? 2 : 0);
    const holes = buildExclusionHoles(faces, winners, ['l1', 'l2'], bands, [], railW);
    const hole = holes.get('l1');
    // l2's white ring zone over l1's body (x ∈ [57, 58], inside l1): the rail
    // is ALREADY painted beneath l1 — the hole just reveals it.
    expect(contains(hole, { x: 57.5, y: 0 })).toBe(true);
    expect(contains(hole, { x: 42.5, y: 0 })).toBe(true);
    // Not beyond the ring.
    expect(contains(hole, { x: 60, y: 0 })).toBe(false);
    // With a cased winner the face needs no body-edge inset — the hole runs
    // continuously through the ring, so the whole face is open.
    expect(contains(hole, { x: 43.1, y: 0 })).toBe(true);
  });
});

describe('buildExclusionHoles — neighboring faces are never nicked', () => {
  it("stops at a tangent face the LOSER wins (the loser's own territory)", () => {
    // l1 vertical (loser, top of lineOrder); l2 horizontal (winner by
    // assignment, body y ∈ [-7, 7]); l3 horizontal TANGENT below l2 (body
    // y ∈ [7, 21]), painted between them. All cased at railW = 0.5, so the
    // winner's silhouette reaches y = 7.25 — past the face boundary, over
    // l3's body, where l1 is the DEFAULT winner of the {l1,l3} face. The
    // hole must not cut l1 there: beneath l1 sits l3's body (painted above
    // the winner), so the cut would expose an l3-colored sliver instead of
    // the winner's rail — the loser's paint must run to the boundary.
    const bands = [
      vBand('l1', 's1|s2', -50, 50, 50),
      hBand('l2', 's3|s4', 0, 100, 0),
      hBand('l3', 's5|s6', 0, 100, 14),
    ];
    const lineOrder = ['l1', 'l3', 'l2'];
    const faces = buildOverlapRegions(bands, []);
    expect(faces.map((f) => f.lineIds.join('+'))).toEqual(['l1+l2', 'l1+l3']);
    const winners = faces.map((f) =>
      f.lineIds.includes('l2')
        ? { winner: 'l2' as LineId, assignmentId: 'r1' }
        : { winner: 'l1' as LineId, assignmentId: null },
    );
    const holes = buildExclusionHoles(faces, winners, lineOrder, bands, [], () => 0.5);
    const hole = holes.get('l1');
    // Inside the tangent {l1,l3} face, just past the shared boundary: the
    // hole may not reach in, however far the winner's footprint extends.
    expect(contains(hole, { x: 50, y: 7.1 })).toBe(false);
    // The face itself stays fully cut, right up to that boundary…
    expect(contains(hole, { x: 50, y: 6.9 })).toBe(true);
    // …and on the FREE side (no neighboring face) the hole still runs
    // through the winner's rail for the bridges-over reveal.
    expect(contains(hole, { x: 50, y: -7.1 })).toBe(true);
  });
});

describe('buildExclusionHoles — absorbs dropped slivers into a bridge', () => {
  // l1 horizontal; l2 crosses it twice and runs near-tangent between the
  // crossings (the dumbbell). The morphological opening keeps the two crossings
  // as clickable faces and DROPS the hairline neck between them as a sliver
  // (buildOverlapRegions). With the near crossing assigned to l2, l1 is clipped
  // over it — and its clip must extend a little way into the dropped neck so
  // l2's revealed casing doesn't NOTCH at the join (the CTA fillet-arc bug),
  // without bridging the whole (long) neck to the far crossing.
  const dumbbell = () => [
    hBand('l1', 's1|s2', 0, 400),
    vBand('l2', 's5|s6', -50, 13.9, 100),
    hBand('l2', 's6|s7', 100, 300, 13.9),
    vBand('l2', 's7|s8', -50, 13.9, 300),
  ];
  const bridgeNear = (faces: ReturnType<typeof buildOverlapRegions>) => {
    const nearIdx = faces.findIndex((f) => f.lineIds.join(',') === 'l1,l2' && f.bbox.x0 < 200);
    return faces.map((f, i) =>
      i === nearIdx
        ? { winner: 'l2' as LineId, assignmentId: 'r1' }
        : { winner: f.lineIds[0], assignmentId: null },
    );
  };

  it('collects the dropped neck as a sliver of the overlap cover', () => {
    const slivers: RegionSliver[] = [];
    buildOverlapRegions(dumbbell(), [], slivers);
    const neck = slivers.find((s) => s.lineIds.join(',') === 'l1,l2');
    expect(neck).toBeDefined();
    // A thin (~0.1-tall) strip spanning between the two crossings.
    expect(neck!.bbox.y1 - neck!.bbox.y0).toBeLessThan(1);
    expect(neck!.bbox.x0).toBeGreaterThan(105);
    expect(neck!.bbox.x1).toBeLessThan(295);
  });

  it("extends the loser's clip into the neck at the join, but not along its whole length", () => {
    const bands = dumbbell();
    const slivers: RegionSliver[] = [];
    const faces = buildOverlapRegions(bands, [], slivers);
    const winners = bridgeNear(faces);
    const railW = () => 1;
    const holes = buildExclusionHoles(faces, winners, ['l1', 'l2'], bands, [], railW, slivers);
    // Just past the near crossing (its right edge is x≈107), inside the dropped
    // neck: the fix extends l1's hole here so l2's casing runs unbroken across
    // the join.
    const atJoin = { x: 110, y: 6.95 };
    expect(contains(holes.get('l1'), atJoin)).toBe(true);
    // Without the sliver input (the pre-fix path) the neck is unreachable — the
    // notch this bug is about.
    const noAbsorb = buildExclusionHoles(faces, winners, ['l1', 'l2'], bands, [], railW);
    expect(contains(noAbsorb.get('l1'), atJoin)).toBe(false);
    // The bound holds: the reveal does NOT run the whole neck to the far
    // crossing (a long tangent corridor must stay un-bridged past the junction).
    expect(contains(holes.get('l1'), { x: 200, y: 6.95 })).toBe(false);
  });
});

describe('buildExclusionHoles — corner alignment (the channel-junction nub)', () => {
  it('keeps full reach through face corners (miter, not round, dilation)', () => {
    // Both lines cased at railW = 2. The hole's cutoff beyond the face must
    // stay parallel to the loser's edges THROUGH the face corners — a round
    // dilation arcs inward there, leaving a sliver of loser paint over the
    // winner's rail that misaligns the white bands where a crossing meets a
    // parallel channel (the pixel-peeped nub).
    const bands = cross();
    const faces = buildOverlapRegions(bands, []);
    const winners = [{ winner: 'l2' as LineId, assignmentId: 'r1' }];
    const holes = buildExclusionHoles(faces, winners, ['l1', 'l2'], bands, [], () => 2);
    const hole = holes.get('l1');
    // Face corner at (57, 7); winner silhouette reaches x = 58; reach beyond
    // the face is railW_L/2 + railW_W/2 + slack = 2.5. This probe is inside
    // the miter region (0.9 and 2.4 past the corner's edges) but 2.56 from
    // the corner point — a round dilation excludes it.
    expect(contains(hole, { x: 57.9, y: 9.4 })).toBe(true);
    // Still cut exactly at the winner's silhouette edge (the channel edge).
    expect(contains(hole, { x: 58.5, y: 9.4 })).toBe(false);
    expect(contains(hole, { x: 58.5, y: 0 })).toBe(false);
  });
});
