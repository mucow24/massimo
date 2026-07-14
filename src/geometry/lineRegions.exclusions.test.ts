import { describe, it, expect } from 'vitest';
import { buildExclusionHoles, buildOverlapRegions } from './lineRegions';
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
    // Winner l2's body spans x ∈ [43, 57]. Just inside its edge (x = 43.1)
    // the hole has retreated — l1 still paints there, hiding l2's soft
    // antialiased edge tail under opaque l1.
    expect(contains(hole, { x: 43.1, y: 0 })).toBe(false);
    expect(contains(hole, { x: 56.9, y: 0 })).toBe(false);
    // Past the retreat the hole is open.
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
