import { describe, it, expect } from 'vitest';
import {
  sampleOffsetPath,
  sampleOffsetPathByArcLength,
  offsetPathLength,
  closestParamOnOffsetPath,
  lineTraversesForwardCanon,
  snapNeighborTag,
  anchorFromArcLen,
  arcLenFromAnchor,
  lineTagDropAt,
} from './lineTagGeometry';
import { Vec2 } from './vec';
import { makeLine } from '../test/fixtures';
import type { LineTag } from '../model/types';

const eq = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;
const approxVec = (a: Vec2, b: Vec2, eps = 1e-3) =>
  Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;

describe('sampleOffsetPath — 2-vertex straight', () => {
  const verts = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ];

  it('t=0 sits at the start point with offset=0', () => {
    const s = sampleOffsetPath(verts, 24, 0, 0);
    expect(approxVec(s.p, { x: 0, y: 0 })).toBe(true);
    expect(approxVec(s.tangent, { x: 1, y: 0 })).toBe(true);
  });

  it('t=1 sits at the end point with offset=0', () => {
    const s = sampleOffsetPath(verts, 24, 0, 1);
    expect(approxVec(s.p, { x: 100, y: 0 })).toBe(true);
  });

  it('t=0.5 sits at the midpoint with offset=0', () => {
    const s = sampleOffsetPath(verts, 24, 0, 0.5);
    expect(approxVec(s.p, { x: 50, y: 0 })).toBe(true);
    expect(approxVec(s.tangent, { x: 1, y: 0 })).toBe(true);
  });

  it('positive offset shifts perpendicular (left-of-motion = north in y-down)', () => {
    const s = sampleOffsetPath(verts, 24, 10, 0.5);
    expect(approxVec(s.p, { x: 50, y: -10 })).toBe(true);
    expect(approxVec(s.tangent, { x: 1, y: 0 })).toBe(true);
  });

  it('negative offset shifts the opposite direction', () => {
    const s = sampleOffsetPath(verts, 24, -10, 0.5);
    expect(approxVec(s.p, { x: 50, y: 10 })).toBe(true);
  });

  it('total length matches the polyline length', () => {
    expect(eq(offsetPathLength(verts, 24, 0), 100)).toBe(true);
  });
});

describe('sampleOffsetPath — single 90° bend', () => {
  // East then south: arc replaces the corner at (100, 0).
  const verts = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ];
  const R = 24;

  it('t=0 is the start vertex (centerline)', () => {
    const s = sampleOffsetPath(verts, R, 0, 0);
    expect(approxVec(s.p, { x: 0, y: 0 })).toBe(true);
    expect(approxVec(s.tangent, { x: 1, y: 0 })).toBe(true);
  });

  it('t=1 is the end vertex (centerline)', () => {
    const s = sampleOffsetPath(verts, R, 0, 1);
    expect(approxVec(s.p, { x: 100, y: 100 })).toBe(true);
    expect(approxVec(s.tangent, { x: 0, y: 1 })).toBe(true);
  });

  it('total length is two straights + one quarter-arc (centerline)', () => {
    // From (0,0) east to (100-R, 0), then quarter arc r=R, then south from
    // (100, R) to (100, 100). Both straights = 100 - R.
    const expected = 2 * (100 - R) + (Math.PI * R) / 2;
    expect(eq(offsetPathLength(verts, R, 0), expected, 1e-6)).toBe(true);
  });

  it('mid-arc sample lies on the expected circle and tangent is perpendicular to radius', () => {
    const total = offsetPathLength(verts, R, 0);
    // Arc center at (100 - R, 0 + R) = (76, 24) for the east-then-south corner.
    // Find a t inside the arc: arc starts at (100-R, 0) at arc-length (100-R),
    // ends at arc-length (100-R + π*R/2). Mid-arc at (100-R) + π*R/4.
    const midArcS = 100 - R + (Math.PI * R) / 4;
    const tMid = midArcS / total;
    const s = sampleOffsetPath(verts, R, 0, tMid);
    // Distance from arc center to sampled point should equal R.
    const center = { x: 100 - R, y: R };
    const d = Math.hypot(s.p.x - center.x, s.p.y - center.y);
    expect(eq(d, R, 1e-3)).toBe(true);
    // Tangent should be perpendicular to (point - center) (dot = 0).
    const radial = { x: s.p.x - center.x, y: s.p.y - center.y };
    const tDotRadial = s.tangent.x * radial.x + s.tangent.y * radial.y;
    expect(eq(tDotRadial, 0, 1e-3)).toBe(true);
  });

  it('positive offset shrinks inside-of-bend arc length, negative offset expands it', () => {
    // Bend at (100,0) goes east → south, which is a "right turn" visually.
    // The "inside" of the bend is to the south-east; "outside" to the
    // north-west. Per emitOffsetSegments, positive offset moves left-of-
    // motion = north when traveling east, which is OUTSIDE this bend.
    // So positive offset → outside → larger arc → longer total.
    const total0 = offsetPathLength(verts, R, 0);
    const totalPos = offsetPathLength(verts, R, 10);
    const totalNeg = offsetPathLength(verts, R, -10);
    expect(totalPos).toBeGreaterThan(total0);
    expect(totalNeg).toBeLessThan(total0);
  });
});

describe('sampleOffsetPath — Z (2-bend, parallel ends)', () => {
  const verts = [
    { x: 0, y: 0 },
    { x: 60, y: 0 },
    { x: 60, y: 80 },
    { x: 200, y: 80 },
  ];
  const R = 24;

  it('arc length is monotonic in t', () => {
    let prev: Vec2 | null = null;
    let totalDist = 0;
    const samples = 100;
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const s = sampleOffsetPath(verts, R, 0, t);
      if (prev) totalDist += Math.hypot(s.p.x - prev.x, s.p.y - prev.y);
      prev = s.p;
    }
    // Sum of fine-grained distances approximates total arc length.
    const total = offsetPathLength(verts, R, 0);
    expect(Math.abs(totalDist - total)).toBeLessThan(1);
  });

  it('tangent stays unit-length over the whole sweep', () => {
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      const s = sampleOffsetPath(verts, R, 0, t);
      const tlen = Math.hypot(s.tangent.x, s.tangent.y);
      expect(eq(tlen, 1, 1e-6)).toBe(true);
    }
  });
});

describe('closestParamOnOffsetPath', () => {
  it('projects perpendicularly onto a straight segment', () => {
    const verts = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const r = closestParamOnOffsetPath(verts, 24, 0, { x: 30, y: 5 });
    const sample = sampleOffsetPath(verts, 24, 0, r.t);
    expect(approxVec(sample.p, { x: 30, y: 0 }, 0.5)).toBe(true);
    expect(r.dist).toBeLessThan(5.5);
  });

  it('finds a point near a 90° bend', () => {
    const verts = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    // A point just inside the bend: should land near the arc.
    const r = closestParamOnOffsetPath(verts, 24, 0, { x: 95, y: 5 });
    expect(r.dist).toBeLessThan(20);
    // t should be near the middle of the path (which is the arc).
    expect(r.t).toBeGreaterThan(0.4);
    expect(r.t).toBeLessThan(0.7);
  });
});

describe('sampleOffsetPathByArcLength', () => {
  const verts = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ];

  it('returns start at arcLen=0', () => {
    const s = sampleOffsetPathByArcLength(verts, 24, 0, 0);
    expect(approxVec(s.p, { x: 0, y: 0 })).toBe(true);
  });

  it('returns the point at the given arc length', () => {
    const s = sampleOffsetPathByArcLength(verts, 24, 0, 30);
    expect(approxVec(s.p, { x: 30, y: 0 })).toBe(true);
  });

  it('clamps to the end when arcLen exceeds total length', () => {
    const s = sampleOffsetPathByArcLength(verts, 24, 0, 999);
    expect(approxVec(s.p, { x: 100, y: 0 })).toBe(true);
  });

  it('clamps to the start when arcLen is negative', () => {
    const s = sampleOffsetPathByArcLength(verts, 24, 0, -50);
    expect(approxVec(s.p, { x: 0, y: 0 })).toBe(true);
  });

  it('returns a unit start tangent when the first offset segment is zero-length', () => {
    // A coincident leading vertex makes emitOffsetSegments emit a zero-length
    // first line before the real geometry. Sampling at arcLen 0 must skip it and
    // report the band's true start direction (east), not a degenerate (0,0)
    // tangent (which the old code produced via hypot(0,0)||1).
    const dupVerts = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const s = sampleOffsetPathByArcLength(dupVerts, 24, 0, 0);
    expect(approxVec(s.p, { x: 0, y: 0 })).toBe(true);
    expect(approxVec(s.tangent, { x: 1, y: 0 })).toBe(true);
    expect(eq(Math.hypot(s.tangent.x, s.tangent.y), 1)).toBe(true);
  });
});

describe('lineTraversesForwardCanon', () => {
  it('returns true when the line has a (from, to) edge in canonical order', () => {
    const line = makeLine({ id: 'L1', stations: ['s1', 's2', 's3'] });
    expect(lineTraversesForwardCanon(line, 's1', 's2')).toBe(true);
    expect(lineTraversesForwardCanon(line, 's2', 's3')).toBe(true);
  });

  it('returns false when the edge appears reversed in line.stations', () => {
    // Line traverses s2→s1, so for the canonical pair (s1, s2) it is reverse.
    const line = makeLine({ id: 'L1', stations: ['s2', 's1'] });
    expect(lineTraversesForwardCanon(line, 's1', 's2')).toBe(false);
  });
});

describe('snapNeighborTag', () => {
  // Straight 100-unit centerline. Stripe offset 0 means stripe length = 100.
  const centerline = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ];
  const R = 24;
  // All neighbors live on the same band, offset 0.
  const stripeOffset = () => 0;

  const makeArgs = (
    overrides: Partial<Parameters<typeof snapNeighborTag>[0]>,
  ): Parameters<typeof snapNeighborTag>[0] => ({
    candCanonT: 0.5,
    candOffset: 0,
    candPairKey: 's1|s2',
    selfTagId: 'self',
    bandCenterline: centerline,
    curveRadius: R,
    lineStripeOffset: stripeOffset,
    lineTags: {},
    tol: 10,
    ...overrides,
  });

  it('snaps when neighbor anchored at "from" with the matching distance', () => {
    // canon-t = 0.3 ⇒ neighbor anchored at "from" with distance 30 (stripe=100).
    const tag: LineTag = {
      id: 't1',
      lineId: 'L1',
      fromStationId: 's1',
      toStationId: 's2',
      anchorEnd: 'from',
      distance: 30,
      orientation: 0,
    };
    const result = snapNeighborTag(makeArgs({ candCanonT: 0.305, lineTags: { t1: tag } }));
    expect(result.snapped).toBe(true);
    expect(result.canonT).toBeCloseTo(0.3, 6);
  });

  it('snaps when neighbor anchored at "to" — must convert distance to canon-t', () => {
    // canon-t = 0.3 ⇒ canon-arclen = 30. Neighbor anchored at "to" with
    // distance 70 sits at the same world position (stripe=100, 100-70=30).
    const tag: LineTag = {
      id: 't1',
      lineId: 'L1',
      fromStationId: 's1',
      toStationId: 's2',
      anchorEnd: 'to',
      distance: 70,
      orientation: 0,
    };
    const result = snapNeighborTag(makeArgs({ candCanonT: 0.305, lineTags: { t1: tag } }));
    expect(result.snapped).toBe(true);
    expect(result.canonT).toBeCloseTo(0.3, 6);
  });

  it('does not falsely snap when a "to"-anchored neighbor has matching raw distance but different position', () => {
    // canon-t=0.3, distance=30 from "to" sits at canon-t=0.7 (stripe=100,
    // 100-30=70). Candidate at canon-t=0.305 must NOT snap.
    const tag: LineTag = {
      id: 't1',
      lineId: 'L1',
      fromStationId: 's1',
      toStationId: 's2',
      anchorEnd: 'to',
      distance: 30,
      orientation: 0,
    };
    const result = snapNeighborTag(makeArgs({ candCanonT: 0.305, lineTags: { t1: tag } }));
    expect(result.snapped).toBe(false);
  });

  it('symmetric: from-anchored and to-anchored at same world position both snap', () => {
    // Two tags at canon-t=0.4 (stripe=100): one anchored from with distance 40,
    // one anchored to with distance 60. Both should be snap targets.
    const fromTag: LineTag = {
      id: 'fr',
      lineId: 'A',
      fromStationId: 's1',
      toStationId: 's2',
      anchorEnd: 'from',
      distance: 40,
      orientation: 0,
    };
    const toTag: LineTag = {
      id: 'to',
      lineId: 'B',
      fromStationId: 's1',
      toStationId: 's2',
      anchorEnd: 'to',
      distance: 60,
      orientation: 0,
    };
    const r1 = snapNeighborTag(
      makeArgs({ candCanonT: 0.405, selfTagId: 'fr', lineTags: { fr: fromTag, to: toTag } }),
    );
    const r2 = snapNeighborTag(
      makeArgs({ candCanonT: 0.405, selfTagId: 'to', lineTags: { fr: fromTag, to: toTag } }),
    );
    expect(r1.snapped).toBe(true);
    expect(r2.snapped).toBe(true);
    expect(r1.canonT).toBeCloseTo(0.4, 6);
    expect(r2.canonT).toBeCloseTo(0.4, 6);
  });

  it('the NEAREST in-tolerance neighbor wins, not the first by insertion order', () => {
    // Two neighbors inside tolerance: n1 at canon-t 0.5 (Δ=5) inserted first,
    // n2 at canon-t 0.44 (Δ=1). Proximity must decide, not creation order.
    const n1: LineTag = {
      id: 'n1',
      lineId: 'L1',
      fromStationId: 's1',
      toStationId: 's2',
      anchorEnd: 'from',
      distance: 50,
      orientation: 0,
    };
    const n2: LineTag = {
      id: 'n2',
      lineId: 'L1',
      fromStationId: 's1',
      toStationId: 's2',
      anchorEnd: 'from',
      distance: 44,
      orientation: 0,
    };
    const result = snapNeighborTag(makeArgs({ candCanonT: 0.45, lineTags: { n1, n2 } }));
    expect(result.snapped).toBe(true);
    expect(result.canonT).toBeCloseTo(0.44, 6);
    // The matched neighbor's identity + stripe are reported so the caller can
    // draw a guide to it.
    expect(result.match?.lineId).toBe('L1');
    expect(result.match?.canonT).toBeCloseTo(0.44, 6);
    expect(result.match?.stripeOffset).toBe(0);
  });

  it('does not snap when neighbor is on a different corridor', () => {
    const tag: LineTag = {
      id: 't1',
      lineId: 'L1',
      fromStationId: 's3',
      toStationId: 's4',
      anchorEnd: 'from',
      distance: 50,
      orientation: 0,
    };
    const result = snapNeighborTag(makeArgs({ candCanonT: 0.5, lineTags: { t1: tag } }));
    expect(result.snapped).toBe(false);
  });

  it('skips the dragged tag itself', () => {
    const self: LineTag = {
      id: 'self',
      lineId: 'L1',
      fromStationId: 's1',
      toStationId: 's2',
      anchorEnd: 'from',
      distance: 50,
      orientation: 0,
    };
    const result = snapNeighborTag(
      makeArgs({ candCanonT: 0.5, selfTagId: 'self', lineTags: { self } }),
    );
    expect(result.snapped).toBe(false);
  });

  it('does not snap when far from any neighbor', () => {
    const tag: LineTag = {
      id: 't1',
      lineId: 'L1',
      fromStationId: 's1',
      toStationId: 's2',
      anchorEnd: 'from',
      distance: 20,
      orientation: 0,
    };
    const result = snapNeighborTag(makeArgs({ candCanonT: 0.8, lineTags: { t1: tag } }));
    expect(result.snapped).toBe(false);
  });

  it('skips neighbors whose line is not in the band', () => {
    const tag: LineTag = {
      id: 't1',
      lineId: 'OTHER',
      fromStationId: 's1',
      toStationId: 's2',
      anchorEnd: 'from',
      distance: 30,
      orientation: 0,
    };
    const result = snapNeighborTag(
      makeArgs({
        candCanonT: 0.305,
        lineTags: { t1: tag },
        lineStripeOffset: (id) => (id === 'IN_BAND' ? 0 : null),
      }),
    );
    expect(result.snapped).toBe(false);
  });

  it('matches a neighbor on the same adjacency regardless of endpoint order', () => {
    // candPairKey is canonical ('s1|s2'). The neighbor stores its endpoints in
    // the opposite order ('s2'→'s1') for the *same* adjacency. Matching must be
    // by unordered station-pair (pairKeyOf), so this still snaps.
    const tag: LineTag = {
      id: 't1',
      lineId: 'L1',
      fromStationId: 's2',
      toStationId: 's1',
      anchorEnd: 'from',
      distance: 30,
      orientation: 0,
    };
    const result = snapNeighborTag(makeArgs({ candCanonT: 0.305, lineTags: { t1: tag } }));
    expect(result.snapped).toBe(true);
    expect(result.canonT).toBeCloseTo(0.3, 6);
  });

  it('lands the dragged tag ADJACENT (same cross-section) to a neighbor on a curved band', () => {
    // Bent corridor: east, 90° fillet, north. Two interlined stripes at
    // offsets ±7 have DIFFERENT arc-lengths around the fillet, so aligning by
    // fraction-of-own-stripe would drop the dragged tag at an along-corridor
    // offset (the "snaps but not adjacent" bug). The snap must instead put it
    // directly across the corridor: same perpendicular slice, |Δoffset| apart.
    const bent = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    const oDrag = -7;
    const oNbr = 7;
    const nbrTotal = offsetPathLength(bent, R, oNbr);
    // Neighbor near the bend (65% along its own stripe), on the +7 stripe.
    const nbrArcLen = 0.65 * nbrTotal;
    const nbr: LineTag = {
      id: 'N',
      lineId: 'L2',
      fromStationId: 's1',
      toStationId: 's2',
      ...anchorFromArcLen(nbrArcLen, nbrTotal),
      orientation: 0,
    };
    const nbrPt = sampleOffsetPath(bent, R, oNbr, 0.65).p;
    // Dragged candidate: cursor at (near) the neighbor's world point, projected
    // onto the drag (−7) stripe — exactly what the drag hook feeds in.
    const cand = closestParamOnOffsetPath(bent, R, oDrag, nbrPt).t;

    const result = snapNeighborTag({
      candCanonT: cand,
      candOffset: oDrag,
      candPairKey: 's1|s2',
      selfTagId: 'self',
      bandCenterline: bent,
      curveRadius: R,
      lineStripeOffset: (lid) => (lid === 'L1' ? oDrag : lid === 'L2' ? oNbr : null),
      lineTags: { N: nbr },
      tol: 20,
    });
    expect(result.snapped).toBe(true);

    // The landed point and the neighbor share a cross-section ⟺ their feet on
    // the centerline coincide, and they sit exactly |Δoffset| = 14 apart.
    const draggedPt = sampleOffsetPath(bent, R, oDrag, result.canonT).p;
    const clTotal = offsetPathLength(bent, R, 0);
    const nbrFoot = closestParamOnOffsetPath(bent, R, 0, nbrPt).t * clTotal;
    const dragFoot = closestParamOnOffsetPath(bent, R, 0, draggedPt).t * clTotal;
    expect(Math.abs(nbrFoot - dragFoot)).toBeCloseTo(0, 1); // no along-corridor drift
    expect(Math.hypot(draggedPt.x - nbrPt.x, draggedPt.y - nbrPt.y)).toBeCloseTo(14, 1);

    // The guide still reports the neighbor's OWN position (its own stripe/t),
    // not the dragged landing spot.
    expect(result.match?.lineId).toBe('L2');
    expect(result.match?.stripeOffset).toBe(oNbr);
    expect(result.match?.canonT).toBeCloseTo(0.65, 3);
  });
});

describe('offsetFilletPath cross-check (no drift between rendered and sampled)', () => {
  // Render path, parse its M-start and final L-end, compare against samples.
  it('t=0 matches the M command start coordinates for offset=10 with arcs', () => {
    const verts = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    const R = 24;
    const offset = 10;
    const sample = sampleOffsetPath(verts, R, offset, 0);
    // The sampled start should equal the offset polyline's first vertex
    // (offV[0]). For this geometry: leftOf(east) = (0,-1), so offV[0] = (0,-10).
    expect(approxVec(sample.p, { x: 0, y: -10 }, 1e-3)).toBe(true);
  });

  it('t=1 matches the offset polyline end (offV[N-1])', () => {
    const verts = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    const R = 24;
    const offset = 10;
    const sample = sampleOffsetPath(verts, R, offset, 1);
    // leftOf(south) = (1, 0), so offV[2] = (100+10, 100) = (110, 100).
    expect(approxVec(sample.p, { x: 110, y: 100 }, 1e-3)).toBe(true);
  });
});

describe('anchor <-> arc-length conversion', () => {
  describe('anchorFromArcLen', () => {
    it('anchors to the near end (from) in the first half of the stripe', () => {
      expect(anchorFromArcLen(20, 100)).toEqual({ anchorEnd: 'from', distance: 20 });
    });

    it('anchors to the far end (to) in the second half, storing distance from that end', () => {
      expect(anchorFromArcLen(80, 100)).toEqual({ anchorEnd: 'to', distance: 20 });
    });

    it('treats the exact midpoint as the from end', () => {
      expect(anchorFromArcLen(50, 100)).toEqual({ anchorEnd: 'from', distance: 50 });
    });
  });

  describe('arcLenFromAnchor', () => {
    it('returns the stored distance for a from-anchored tag', () => {
      expect(arcLenFromAnchor('from', 20, 100)).toBe(20);
    });

    it('walks back from the far end for a to-anchored tag', () => {
      expect(arcLenFromAnchor('to', 20, 100)).toBe(80);
    });

    it('clamps a from-distance that overruns the (shrunken) stripe', () => {
      expect(arcLenFromAnchor('from', 150, 100)).toBe(100);
    });

    it('clamps a to-distance that overruns the (shrunken) stripe to 0', () => {
      expect(arcLenFromAnchor('to', 150, 100)).toBe(0);
    });
  });

  it('round-trips arc length -> anchor -> arc length for points on the stripe', () => {
    const total = 100;
    for (const arcLen of [0, 12.5, 49.9, 50, 50.1, 73, 100]) {
      const { anchorEnd, distance } = anchorFromArcLen(arcLen, total);
      expect(arcLenFromAnchor(anchorEnd, distance, total)).toBeCloseTo(arcLen, 9);
    }
  });
});

/**
 * The placement resolution the add-line-tag hover ghost and the click that
 * commits both run through. They used to derive it twice, side by side, so a
 * rule added to one would have moved the preview off the tag it promised.
 */
describe('lineTagDropAt', () => {
  // A two-stripe band on a straight 100-unit centerline: L1 rides the
  // centerline, L2 sits 12 units off it.
  const spec = {
    pairKey: 's1|s2',
    lines: [{ id: 'L1' }, { id: 'L2' }],
    stripeOffsets: [0, 12],
    centerline: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
    radius: 24,
  };

  it('names the stripe, the parameter along it, and the corridor ends', () => {
    const drop = lineTagDropAt(spec, 'L2', { x: 30, y: 12 }, {}, null);
    expect(drop).not.toBeNull();
    expect(drop!.offset).toBe(12);
    expect(drop!.t).toBeCloseTo(0.3, 6);
    expect(drop!.fromCanon).toBe('s1');
    expect(drop!.toCanon).toBe('s2');
  });

  it('measures against the pointed stripe, not the centerline', () => {
    // The same world point read as L1's stripe (offset 0) and as L2's (offset
    // 12). A resolution that ignored the offset would return one answer for
    // both — and drop the tag on a stripe the ghost never showed.
    const onL1 = lineTagDropAt(spec, 'L1', { x: 30, y: 6 }, {}, null);
    const onL2 = lineTagDropAt(spec, 'L2', { x: 30, y: 6 }, {}, null);
    expect(onL1!.offset).toBe(0);
    expect(onL2!.offset).toBe(12);
  });

  it('applies the neighbor snap, and null tolerance bypasses it (the Shift half)', () => {
    // A neighbor on L1's stripe at arc-length 30; the pointer lands just past
    // it, inside the engage radius.
    const neighbor: LineTag = {
      id: 't1',
      lineId: 'L1',
      fromStationId: 's1',
      toStationId: 's2',
      anchorEnd: 'from',
      distance: 30,
      orientation: 0,
    };
    const world = { x: 30.5, y: 0 };
    expect(lineTagDropAt(spec, 'L1', world, { t1: neighbor }, 10)!.t).toBeCloseTo(0.3, 6);
    expect(lineTagDropAt(spec, 'L1', world, { t1: neighbor }, null)!.t).toBeCloseTo(0.305, 6);
  });

  it('is null for a line with no stripe in this band', () => {
    // Not merely defensive: `stripeOffsets` has one entry per band member, so
    // a miss would read `undefined` and carry NaN through the path math into a
    // stored tag.
    expect(lineTagDropAt(spec, 'L9', { x: 30, y: 0 }, {}, null)).toBeNull();
  });
});
