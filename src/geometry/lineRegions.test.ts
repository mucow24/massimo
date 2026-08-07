import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  flattenOffsetSegments,
  stripeBodyPolys,
  buildLineBodies,
  buildOverlapRegions,
  bindAssignments,
  resolveRegionWinners,
  regionClickAction,
  regionFloodTargets,
  regionPaintPlan,
  mintAnchors,
  evaluateAnchor,
} from './lineRegions';
import { splitIntoFaces, faceArea, pointInFace } from './clip';
import { emitOffsetSegments } from './router';
import { makeBandSpec } from '../test/fixtures';
import type { StopMarkerSpec } from './interlining';
import type { RegionAssignment } from '../model/types';
import type { Vec2 } from './vec';

const marker = (
  lineId: string,
  cx: number,
  cy: number,
  over: Partial<StopMarkerSpec> = {},
): StopMarkerSpec => ({
  cx,
  cy,
  color: '#000000',
  lineId,
  stationId: 'sX',
  rotationDeg: 0,
  jointRotationDeg: null,
  jointArcOut: null,
  priority: 0,
  style: 'solid',
  end: 'square',
  outward: null,
  width: 14,
  ...over,
});

/** Horizontal one-stripe band for `lineId` from (x0,y) to (x1,y). */
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

/** Vertical one-stripe band for `lineId` from (x,y0) to (x,y1). */
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

const totalArea = (rings: Vec2[][]): number =>
  splitIntoFaces(rings).reduce((s, f) => s + faceArea(f), 0);

describe('flattenOffsetSegments', () => {
  it('passes straight segments through as their endpoints', () => {
    const segs = emitOffsetSegments(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      24,
      0,
    );
    const pts = flattenOffsetSegments(segs);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 100, y: 0 });
  });

  it('flattens a filleted corner arc to within the chord tolerance', () => {
    const segs = emitOffsetSegments(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      24,
      0,
    );
    const arc = segs.find((s) => s.kind === 'arc');
    expect(arc).toBeDefined();
    const pts = flattenOffsetSegments(segs, 0.01);
    // The corner fillet is a r=24 arc centered at (76, 24) (tangent to both
    // legs). Every flattened vertex on the arc must sit on that circle, and
    // chord midpoints must sag less than the tolerance.
    const center = { x: 76, y: 24 };
    const onArc = pts.filter((p) => p.x > 76 && p.y < 24);
    expect(onArc.length).toBeGreaterThan(4);
    for (const p of onArc) {
      const r = Math.hypot(p.x - center.x, p.y - center.y);
      expect(r).toBeCloseTo(24, 6);
    }
    for (let i = 0; i + 1 < onArc.length; i++) {
      const mid = {
        x: (onArc[i].x + onArc[i + 1].x) / 2,
        y: (onArc[i].y + onArc[i + 1].y) / 2,
      };
      const sag = 24 - Math.hypot(mid.x - center.x, mid.y - center.y);
      expect(sag).toBeGreaterThanOrEqual(0);
      expect(sag).toBeLessThanOrEqual(0.011);
    }
  });

  it('handles arcs with radius below the tolerance without NaN', () => {
    const segs = [
      {
        kind: 'arc' as const,
        from: { x: 0, y: 0 },
        to: { x: 0.008, y: 0 },
        r: 0.004,
        theta: Math.PI,
        inDir: { x: 0, y: -1 },
        sign: 1 as const,
        length: 0.004 * Math.PI,
      },
    ];
    const pts = flattenOffsetSegments(segs);
    expect(pts.length).toBeGreaterThan(1);
    expect(pts.length).toBeLessThan(300); // sample count capped
    for (const p of pts) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });
});

describe('stripeBodyPolys', () => {
  it('turns a straight one-stripe band into a butt-capped rectangle', () => {
    const band = hBand('l1', 's1|s2', 0, 100);
    const rings = stripeBodyPolys(band, 0);
    expect(totalArea(rings)).toBeCloseTo(1400, -1);
    const face = splitIntoFaces(rings)[0];
    expect(pointInFace({ x: 50, y: 6.5 }, face)).toBe(true);
    expect(pointInFace({ x: -1, y: 0 }, face)).toBe(false); // butt cap
  });

  it('heals a degenerate inner corner solid (no phantom holes, tracks paint)', () => {
    // 5 tangent stripes → outermost offsets ±28. With radius 24, the inner
    // stripe's own path radius goes negative at a 90° corner: its offset path
    // folds through the capped miter. The painted stroke (round joins) is
    // solid there — the body polygon must be too.
    const band = makeBandSpec(['a', 'b', 'c', 'd', 'e'], {
      centerline: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      radius: 24,
    });
    // Inner-most stripe relative to the turn: offset +28 rides the inside.
    const inner = band.stripeOffsets.indexOf(28);
    expect(inner).toBeGreaterThanOrEqual(0);
    const rings = stripeBodyPolys(band, inner);
    const faces = splitIntoFaces(rings);
    expect(faces.length).toBeGreaterThanOrEqual(1);
    for (const f of faces) expect(f.length).toBe(1); // healed: no holes
    expect(totalArea(rings)).toBeGreaterThan(0);
  });
});

describe('buildLineBodies', () => {
  it('unions a line’s bands into one body and merges the marker at the joint', () => {
    // Right-angle line: two bands meeting at (100,0), plus the stop marker
    // there. The marker square’s outer corner sticks out beyond both stripe
    // rectangles — body must include it only because the marker is present.
    const bands = [hBand('l1', 's1|s2', 0, 100), vBand('l1', 's2|s3', 0, 100, 100)];
    const withMarker = buildLineBodies(bands, [marker('l1', 100, 0)]);
    const without = buildLineBodies(bands, []);
    const cornerProbe = { x: 105, y: -5 }; // in the marker square, outside both stripes
    const inWith = splitIntoFaces(withMarker.get('l1')!).some((f) => pointInFace(cornerProbe, f));
    const inWithout = splitIntoFaces(without.get('l1')!).some((f) => pointInFace(cornerProbe, f));
    expect(inWith).toBe(true);
    expect(inWithout).toBe(false);
  });

  it('covers a JOINT stop with the same three pieces the painter draws', () => {
    // The region body is what masks the paint, so its joint footprint has to be
    // the painter's exactly (StopMarker.test.tsx pins the other half of this):
    // arc-side half-square, straight-side half-square, cap-plane wedge. A body
    // that kept only one frame leaves a sliver of the neighbouring line showing
    // at every ring/straight junction. Same frames as the painter's fixture:
    // tangent axis 90° with the arc pointing +y, octant frame 135°.
    const joint = marker('l1', 100, 0, {
      rotationDeg: 90,
      jointRotationDeg: 135,
      jointArcOut: { x: 0, y: 1 },
    });
    const faces = splitIntoFaces(buildLineBodies([], [joint]).get('l1')!);
    const covers = (p: Vec2) => faces.some((f) => pointInFace(p, f));
    // Straight side: 5 units out along the octant axis AWAY from the arc.
    // Nothing but the straight half-square reaches here — the wedge's lobe on
    // this side of the cap plane sits at +y.
    expect(covers({ x: 103.54, y: -3.54 })).toBe(true);
    // Arc side: 5 units along the tangent, toward the arc.
    expect(covers({ x: 100, y: 5 })).toBe(true);
    // Wedge: the lobe on the far side of the cap plane from both half-squares —
    // the only ink that fills the bowtie the two butt caps leave uncovered.
    expect(covers({ x: 96, y: -1.6 })).toBe(true);
    // And nothing pokes past: a full square in the tangent frame would swallow
    // this corner, which lies outside every one of the three pieces.
    expect(covers({ x: 106.5, y: -5 })).toBe(false);
  });

  it('gives a loop line a body with a hole', () => {
    const bands = [
      hBand('l1', 's1|s2', 0, 100, 0),
      vBand('l1', 's2|s3', 0, 100, 100),
      hBand('l1', 's3|s4', 0, 100, 100),
      vBand('l1', 's1|s4', 0, 100, 0),
    ];
    const body = buildLineBodies(bands, []).get('l1')!;
    const faces = splitIntoFaces(body);
    expect(faces).toHaveLength(1);
    expect(faces[0].length).toBe(2); // outer + the loop's hole
  });

  it('is render-faithful for patterned markers: nothing interior, stub at termini', () => {
    const bands = [hBand('l1', 's1|s2', 0, 100)];
    const interior = buildLineBodies(bands, [
      marker('l1', 100, 0, { style: 'dashed', outward: null }),
    ]);
    const terminus = buildLineBodies(bands, [
      marker('l1', 100, 0, { style: 'dashed', outward: { x: 1, y: 0 } }),
    ]);
    const stubProbe = { x: 103, y: 0 }; // beyond the butt cap, inside the stub
    const inInterior = splitIntoFaces(interior.get('l1')!).some((f) => pointInFace(stubProbe, f));
    const inTerminus = splitIntoFaces(terminus.get('l1')!).some((f) => pointInFace(stubProbe, f));
    expect(inInterior).toBe(false);
    expect(inTerminus).toBe(true);
  });

  // The cover has to BE the paint: a shortened or rounded end that still
  // claimed the full square would hand its corners to the region arrangement
  // and let a crossing there resolve against territory nothing paints.
  describe('line ends', () => {
    const bands = [hBand('l1', 's1|s2', 0, 100)];
    const east = { x: 1, y: 0 };
    // The band is butt-capped at x = 100, so everything past it comes from the
    // marker alone. Corner = the square's outer corner; axis = straight out.
    const corner = { x: 105, y: 5 };
    const axis = { x: 105, y: 0 };
    const covers = (m: StopMarkerSpec, probe: Vec2) =>
      splitIntoFaces(buildLineBodies(bands, [m]).get('l1')!).some((f) => pointInFace(probe, f));

    it('claims the whole square for a square end', () => {
      const m = marker('l1', 100, 0, { outward: east, end: 'square' });
      expect(covers(m, axis)).toBe(true);
      expect(covers(m, corner)).toBe(true);
    });

    it('claims nothing past the stop center for a short end', () => {
      const m = marker('l1', 100, 0, { outward: east, end: 'short' });
      expect(covers(m, axis)).toBe(false);
      expect(covers(m, corner)).toBe(false);
      // …but the inward half is still there, holding the band's own corridor.
      expect(covers(m, { x: 96, y: 0 })).toBe(true);
    });

    it('claims the half-disc, and only that, for a round end', () => {
      const m = marker('l1', 100, 0, { outward: east, end: 'round' });
      expect(covers(m, axis)).toBe(true); // 5 out on the axis is inside r=7
      expect(covers(m, corner)).toBe(false); // but the corner is outside it
      expect(covers(m, { x: 108, y: 0 })).toBe(false); // and 8 out is past r=7
    });

    it('drops a patterned terminus stub when the end is short', () => {
      const m = marker('l1', 100, 0, { style: 'dashed', outward: east, end: 'short' });
      expect(covers(m, { x: 103, y: 0 })).toBe(false);
    });
  });
});

describe('buildOverlapRegions', () => {
  it('finds the single face of a perpendicular crossing with both covers and spans', () => {
    const bands = [hBand('l1', 's1|s2', 0, 100), vBand('l2', 's3|s4', -50, 50, 50)];
    const faces = buildOverlapRegions(bands, []);
    expect(faces).toHaveLength(1);
    const f = faces[0];
    expect(f.lineIds).toEqual(['l1', 'l2']);
    expect(f.area).toBeCloseTo(196, 0);
    const spanH = f.spans.get('l1|s1|s2');
    const spanV = f.spans.get('l2|s3|s4');
    expect(spanH).toBeDefined();
    expect(spanV).toBeDefined();
    // The crossing occupies x ∈ [43, 57] along the 100-long horizontal
    // stripe; the span records BODY overlap, which reaches half a width (7)
    // further out on each side.
    expect(spanH!.intervals[0].d0).toBeGreaterThan(32);
    expect(spanH!.intervals[0].d1).toBeLessThan(68);
    expect(spanH!.intervals[0].d0).toBeLessThan(43);
    expect(spanH!.intervals[0].d1).toBeGreaterThan(57);
    expect(spanH!.totalLen).toBeCloseTo(100, 0);
  });

  it('treats exactly coincident corridors as one long face', () => {
    const bands = [hBand('l1', 's1|s2', 0, 100), hBand('l2', 's3|s4', 0, 100)];
    const faces = buildOverlapRegions(bands, []);
    expect(faces).toHaveLength(1);
    expect(faces[0].lineIds).toEqual(['l1', 'l2']);
    expect(faces[0].area).toBeCloseTo(1400, -1);
  });

  it('produces NO faces for tangent interlined stripes of one band', () => {
    const band = makeBandSpec(['l1', 'l2']);
    expect(buildOverlapRegions([band], [])).toHaveLength(0);
  });

  it('spans cover a face the stripe bodies overlap but both center paths miss', () => {
    // Two parallel corridors offset by 10: bodies y ∈ [-7,7] and [3,17]
    // overlap in y ∈ [3,7], and BOTH center paths (y=0, y=10) run outside
    // the face. Small corner faces at real crossings have the same shape —
    // inside a stripe's painted body but off its center path — and a face
    // with no span for a cover line can only be anchored by projection,
    // the flakiest kind of anchor under drags.
    const faces = buildOverlapRegions(
      [hBand('l1', 's1|s2', 0, 100, 0), hBand('l2', 's3|s4', 0, 100, 10)],
      [],
    );
    expect(faces).toHaveLength(1);
    const f = faces[0];
    expect(f.lineIds).toEqual(['l1', 'l2']);
    const s1 = f.spans.get('l1|s1|s2');
    const s2 = f.spans.get('l2|s3|s4');
    expect(s1).toBeDefined();
    expect(s2).toBeDefined();
    // The overlap runs the corridors' full shared length.
    expect(s1!.intervals[0].d0).toBeLessThan(10);
    expect(s1!.intervals[0].d1).toBeGreaterThan(90);
  });

  it('culls hairline slivers but keeps real overlaps', () => {
    const sliver = buildOverlapRegions(
      [hBand('l1', 's1|s2', 0, 100, 0), hBand('l2', 's3|s4', 0, 100, 13.9)],
      [],
    );
    expect(sliver).toHaveLength(0);
    const real = buildOverlapRegions(
      [hBand('l1', 's1|s2', 0, 100, 0), hBand('l2', 's3|s4', 0, 100, 7)],
      [],
    );
    expect(real).toHaveLength(1);
    expect(real[0].area).toBeCloseTo(700, -1);
  });

  it('decomposes a three-line pinwheel into pairwise and triple faces', () => {
    const bands = [
      hBand('l1', 's1|s2', 0, 100),
      vBand('l2', 's3|s4', -50, 50, 50),
      makeBandSpec(['l3'], {
        pairKey: 's5|s6',
        bandKey: 's5|s6#l3',
        fromId: 's5',
        toId: 's6',
        centerline: [
          { x: 10, y: -40 },
          { x: 90, y: 40 },
        ],
      }),
    ];
    const faces = buildOverlapRegions(bands, []);
    const covers = faces.map((f) => f.lineIds.join(','));
    expect(covers.filter((c) => c === 'l1,l2,l3')).toHaveLength(1);
    expect(covers).toContain('l1,l2');
    expect(covers).toContain('l1,l3');
    expect(covers).toContain('l2,l3');
    for (const f of faces) expect(f.area).toBeGreaterThan(0);
  });
});

describe('buildOverlapRegions — dumbbell split (morphological opening)', () => {
  it('splits two real overlap lobes connected by a hairline neck into separate faces', () => {
    // l1 horizontal; l2 crosses it twice, and BETWEEN the crossings runs
    // almost-tangent alongside it (0.1-wide overlap sliver). Without the
    // opening, the two crossings + the neck fuse into ONE face — clicking
    // one crossing would flip the other ("weird region" bug).
    const bands = [
      hBand('l1', 's1|s2', 0, 400),
      vBand('l2', 's5|s6', -50, 13.9, 100),
      hBand('l2', 's6|s7', 100, 300, 13.9),
      vBand('l2', 's7|s8', -50, 13.9, 300),
    ];
    const faces = buildOverlapRegions(bands, []);
    const covers = faces.filter((f) => f.lineIds.join(',') === 'l1,l2');
    expect(covers.length).toBeGreaterThanOrEqual(2);
    // The two crossing lobes are separate faces at x≈100 and x≈300.
    const near = covers.find((f) => f.bbox.x0 < 200 && f.area > 50);
    const far = covers.find((f) => f.bbox.x0 > 200 && f.area > 50);
    expect(near).toBeDefined();
    expect(far).toBeDefined();
    // And no face spans both crossings anymore.
    for (const f of covers) {
      expect(f.bbox.x1 - f.bbox.x0).toBeLessThan(150);
    }
  });
});

describe('anchors: mint, bind, resolve', () => {
  const cross = (x: number, hLen = 100) => [
    hBand('l1', 's1|s2', 0, hLen),
    vBand('l2', 's3|s4', -50, 50, x),
  ];

  it('mints one anchor per covering line, at the span midpoint, nearest end', () => {
    const bands = cross(50);
    const [face] = buildOverlapRegions(bands, []);
    const anchors = mintAnchors(face, bands);
    expect(anchors).toHaveLength(2);
    const a1 = anchors.find((a) => a.lineId === 'l1')!;
    expect(a1.pairKey).toBe('s1|s2');
    expect(a1.distance).toBeGreaterThan(40);
    expect(a1.distance).toBeLessThan(60);
    const a2 = anchors.find((a) => a.lineId === 'l2')!;
    expect(a2.pairKey).toBe('s3|s4');
  });

  it('resolves the default winner from lineOrder when nothing is assigned', () => {
    const bands = cross(50);
    const faces = buildOverlapRegions(bands, []);
    const winners = resolveRegionWinners(faces, {}, bands, ['l1', 'l2']);
    expect(winners[0]).toEqual({ winner: 'l1', assignmentId: null });
    const winners2 = resolveRegionWinners(faces, {}, bands, ['l2', 'l1']);
    expect(winners2[0]).toEqual({ winner: 'l2', assignmentId: null });
  });

  it('binds an assignment and overrides the winner', () => {
    const bands = cross(50);
    const faces = buildOverlapRegions(bands, []);
    const asg: RegionAssignment = {
      id: 'r1',
      lineId: 'l2',
      lines: ['l1', 'l2'],
      anchors: mintAnchors(faces[0], bands),
    };
    const winners = resolveRegionWinners(faces, { r1: asg }, bands, ['l1', 'l2']);
    expect(winners[0]).toEqual({ winner: 'l2', assignmentId: 'r1' });
  });

  it('follows a crossing that slides far along the unmoved line', () => {
    // Assignment minted at the x=50 crossing; the vertical line then moves to
    // x=300 on a 400-long horizontal. Point-containment would lose it; the
    // nearest-compatible binding must follow.
    const before = cross(50, 400);
    const asg: RegionAssignment = {
      id: 'r1',
      lineId: 'l2',
      lines: ['l1', 'l2'],
      anchors: mintAnchors(buildOverlapRegions(before, [])[0], before),
    };
    const after = cross(300, 400);
    const faces = buildOverlapRegions(after, []);
    expect(faces).toHaveLength(1);
    const bound = bindAssignments(faces, { r1: asg }, after, new Set(['l1', 'l2']));
    expect(bound.get('r1')).toBe(0);
  });

  it('never jumps to a sibling crossing of the same pair under small edits', () => {
    // l2 crosses l1 twice (two vertical corridors). The assignment lives on
    // the x=100 crossing; after a small slide (x=100 → x=110) it must bind
    // the near crossing, not the x=300 sibling.
    const mk = (x1: number) => [
      hBand('l1', 's1|s2', 0, 400),
      vBand('l2', 's3|s4', -50, 50, x1),
      vBand('l2', 's5|s6', -50, 50, 300),
    ];
    const before = mk(100);
    const facesBefore = buildOverlapRegions(before, []);
    const nearBefore = facesBefore.find((f) => f.bbox.x0 < 200)!;
    const asg: RegionAssignment = {
      id: 'r1',
      lineId: 'l2',
      lines: ['l1', 'l2'],
      anchors: mintAnchors(nearBefore, before),
    };
    const after = mk(110);
    const faces = buildOverlapRegions(after, []);
    expect(faces).toHaveLength(2);
    const nearIdx = faces.findIndex((f) => f.bbox.x0 < 200);
    const bound = bindAssignments(faces, { r1: asg }, after, new Set(['l1', 'l2']));
    expect(bound.get('r1')).toBe(nearIdx);
  });

  it('mints anchors that evaluate INSIDE a face the center paths miss', () => {
    // The binder's distance scoring assumes a minted anchor evaluates on its
    // own face — a corner face whose span midpoints sit on center paths
    // OUTSIDE it would otherwise score no better than (and lose to) a big
    // neighboring superset-cover face touching those paths. The side offset
    // must carry the anchor from the center path onto the face.
    const bands = [hBand('l1', 's1|s2', 0, 100, 0), hBand('l2', 's3|s4', 0, 100, 10)];
    const [face] = buildOverlapRegions(bands, []);
    const anchors = mintAnchors(face, bands);
    expect(anchors).toHaveLength(2);
    for (const anchor of anchors) {
      const ev = evaluateAnchor(anchor, bands);
      expect(ev).not.toBeNull();
      expect(pointInFace(ev!.p, face.face)).toBe(true);
    }
  });

  it('does not jump to a sibling crossing when stale mid-drag anchors smear toward it', () => {
    // Mid-gesture render state: the reconcile only runs on commit, so during
    // a drag the stored anchors are pre-drag while the corridors have already
    // changed length — the stored arc distances evaluate far from the
    // crossing they mark. Here both anchors have slid toward the x=300
    // sibling, so distance scoring alone binds the sibling; the corridors
    // pinned in the anchors (l2 via s3|s4, not s5|s6) identify the true face.
    const bands = [
      hBand('l1', 's1|s2', 0, 400),
      vBand('l2', 's3|s4', -50, 50, 100),
      vBand('l2', 's5|s6', -50, 50, 300),
    ];
    const faces = buildOverlapRegions(bands, []);
    expect(faces).toHaveLength(2);
    const nearIdx = faces.findIndex((f) => f.bbox.x0 < 200);
    const asg: RegionAssignment = {
      id: 'r1',
      lineId: 'l2',
      lines: ['l1', 'l2'],
      anchors: [
        { lineId: 'l1', pairKey: 's1|s2', anchorEnd: 'from', distance: 280 },
        { lineId: 'l2', pairKey: 's3|s4', anchorEnd: 'from', distance: 95 },
      ],
    };
    const bound = bindAssignments(faces, { r1: asg }, bands, new Set(['l1', 'l2']));
    expect(bound.get('r1')).toBe(nearIdx);
  });

  it('still binds by distance when the crossing slid onto the next corridor', () => {
    // The crossing used to sit on l2's s3|s4 corridor; a long drag carried it
    // past the intermediate station onto s5|s6. No face runs s3|s4, so
    // corridor identity cannot match — the paint choice must still survive by
    // distance (the pre-identity behavior), not go dormant.
    const bands = [
      hBand('l1', 's1|s2', 0, 400),
      vBand('l2', 's3|s4', -50, -20, 300),
      vBand('l2', 's5|s6', -20, 50, 300),
    ];
    const faces = buildOverlapRegions(bands, []);
    expect(faces).toHaveLength(1);
    const asg: RegionAssignment = {
      id: 'r1',
      lineId: 'l2',
      lines: ['l1', 'l2'],
      anchors: [
        { lineId: 'l1', pairKey: 's1|s2', anchorEnd: 'from', distance: 300 },
        { lineId: 'l2', pairKey: 's3|s4', anchorEnd: 'from', distance: 25 },
      ],
    };
    const bound = bindAssignments(faces, { r1: asg }, bands, new Set(['l1', 'l2']));
    expect(bound.get('r1')).toBe(0);
  });

  it('leaves an assignment dormant when no compatible-cover face exists', () => {
    const bands = cross(50);
    const faces = buildOverlapRegions(bands, []);
    const asg: RegionAssignment = {
      id: 'r1',
      lineId: 'l3',
      lines: ['l1', 'l3'], // l3 does not cover this face
      anchors: [{ lineId: 'l1', pairKey: 's1|s2', anchorEnd: 'from', distance: 50 }],
    };
    const bound = bindAssignments(faces, { r1: asg }, bands, new Set(['l1', 'l2', 'l3']));
    expect(bound.has('r1')).toBe(false);
  });
});

describe('regionClickAction', () => {
  const bands = [hBand('l1', 's1|s2', 0, 100), vBand('l2', 's3|s4', -50, 50, 50)];

  it('cycles from the default to the next covering line', () => {
    const [face] = buildOverlapRegions(bands, []);
    const out = regionClickAction({
      face,
      bound: null,
      lineOrder: ['l1', 'l2'],
      dir: 1,
      bands,
      newId: 'new1',
    });
    expect(out.id).toBe('new1');
    expect(out.assignment).not.toBeNull();
    expect(out.assignment!.lineId).toBe('l2');
    expect(out.assignment!.lines).toEqual(['l1', 'l2']);
    expect(out.assignment!.anchors.length).toBe(2);
  });

  it('cycling back onto the default deletes the assignment', () => {
    const [face] = buildOverlapRegions(bands, []);
    const bound: RegionAssignment = {
      id: 'r1',
      lineId: 'l2',
      lines: ['l1', 'l2'],
      anchors: mintAnchors(face, bands),
    };
    const out = regionClickAction({
      face,
      bound,
      lineOrder: ['l1', 'l2'],
      dir: 1,
      bands,
      newId: 'unused',
    });
    expect(out.id).toBe('r1');
    expect(out.assignment).toBeNull();
  });

  it('cycles backward with dir = -1 (wrapping)', () => {
    const [face] = buildOverlapRegions(bands, []);
    const out = regionClickAction({
      face,
      bound: null,
      lineOrder: ['l1', 'l2'],
      dir: -1,
      bands,
      newId: 'new1',
    });
    expect(out.assignment!.lineId).toBe('l2'); // wrap: default l1 → back = l2
  });

  it('reports the line the face ends up showing, including back at the default', () => {
    const [face] = buildOverlapRegions(bands, []);
    const fwd = regionClickAction({
      face,
      bound: null,
      lineOrder: ['l1', 'l2'],
      dir: 1,
      bands,
      newId: 'new1',
    });
    expect(fwd.winner).toBe('l2');
    const bound: RegionAssignment = {
      id: 'r1',
      lineId: 'l2',
      lines: ['l1', 'l2'],
      anchors: mintAnchors(face, bands),
    };
    const back = regionClickAction({
      face,
      bound,
      lineOrder: ['l1', 'l2'],
      dir: 1,
      bands,
      newId: 'unused',
    });
    expect(back.assignment).toBeNull();
    expect(back.winner).toBe('l1'); // deleting the assignment shows the default
  });
});

// A horizontal trunk of three mutually-tangent stripes (a/b/c at y = -14/0/
// +14) crossed at x = 50 by a vertical trunk of two (d/e): a 3×2 grid of
// 14×14 overlap panes, every pane abutting its neighbours along a stripe
// seam. `atIn` is unambiguous — all six covers are distinct.
const trunkBands = () => [
  makeBandSpec(['a', 'b', 'c'], {
    pairKey: 's1|s2',
    bandKey: 's1|s2#a,b,c',
    fromId: 's1',
    toId: 's2',
    centerline: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
  }),
  makeBandSpec(['d', 'e'], {
    pairKey: 's3|s4',
    bandKey: 's3|s4#d,e',
    fromId: 's3',
    toId: 's4',
    centerline: [
      { x: 50, y: -50 },
      { x: 50, y: 50 },
    ],
  }),
];
// Trunk lines front-most, so every pane defaults to the horizontal trunk.
const trunkOrder = ['a', 'b', 'c', 'd', 'e'];
const atIn = (faces: ReturnType<typeof buildOverlapRegions>, cover: string) =>
  faces.findIndex((f) => f.lineIds.join(',') === cover);

describe('regionFloodTargets', () => {
  const lineOrder = trunkOrder;

  it('carries the target across a whole crossing trunk, but not sideways', () => {
    const bands = trunkBands();
    const faces = buildOverlapRegions(bands, []);
    expect(faces).toHaveLength(6);
    const at = (cover: string) => atIn(faces, cover);
    const winners = resolveRegionWinners(faces, {}, bands, lineOrder);

    const flooded = regionFloodTargets(faces, winners, at('a,d'), 'd');

    // d bridges the whole a/b/c trunk off one click on the {a,d} pane.
    expect([...flooded].sort()).toEqual([at('a,d'), at('b,d'), at('c,d')].sort());
    // {a,e} abuts the seed along the d/e stripe seam, but its cover has no d —
    // it can't legally show d, so the flood does not leak into the e column.
    expect(flooded).not.toContain(at('a,e'));
  });

  it('walls off at a face already showing the target', () => {
    const bands = trunkBands();
    const faces = buildOverlapRegions(bands, []);
    const at = (cover: string) => atIn(faces, cover);
    const mid = faces[at('b,d')];
    const assignments: Record<string, RegionAssignment> = {
      r1: { id: 'r1', lineId: 'd', lines: [...mid.lineIds], anchors: mintAnchors(mid, bands) },
    };
    const winners = resolveRegionWinners(faces, assignments, bands, lineOrder);
    expect(winners[at('b,d')].winner).toBe('d');

    const flooded = regionFloodTargets(faces, winners, at('a,d'), 'd');

    // {c,d} is reachable only THROUGH {b,d}, which already shows d — so the
    // flood stops dead at the seed rather than jumping the wall.
    expect(flooded).toEqual([at('a,d')]);
  });

  it('does not un-flood the trunk when the seed goes back to its default', () => {
    // Falls out of the legality rule and is worth pinning: once d has been
    // flooded over the trunk, flooding {a,d} back to a touches only {a,d} —
    // {b,d} and {c,d} have no a in their cover to carry it to. Reverting a
    // flood is undo's job, not a second shift-click's.
    const bands = trunkBands();
    const faces = buildOverlapRegions(bands, []);
    const at = (cover: string) => atIn(faces, cover);
    const assignments: Record<string, RegionAssignment> = {};
    for (const cover of ['a,d', 'b,d', 'c,d']) {
      const f = faces[at(cover)];
      assignments[cover] = {
        id: cover,
        lineId: 'd',
        lines: [...f.lineIds],
        anchors: mintAnchors(f, bands),
      };
    }
    const winners = resolveRegionWinners(faces, assignments, bands, lineOrder);
    expect(winners[at('b,d')].winner).toBe('d');

    expect(regionFloodTargets(faces, winners, at('a,d'), 'a')).toEqual([at('a,d')]);
  });
});

describe('regionPaintPlan', () => {
  const lineOrder = trunkOrder;
  // Which face each write lands on, by cover — an assignment carries its
  // face's lineIds, so the plan is readable without ids.
  const covers = (plan: { assignment: RegionAssignment | null }[]) =>
    plan.map((e) => e.assignment?.lines.join(',') ?? null).sort();

  it('cycles only the clicked face on a plain click', () => {
    const bands = trunkBands();
    const faces = buildOverlapRegions(bands, []);
    const at = (cover: string) => atIn(faces, cover);
    const winners = resolveRegionWinners(faces, {}, bands, lineOrder);

    const plan = regionPaintPlan({
      faces,
      winners,
      assignments: {},
      faceIndex: at('a,d'),
      dir: 1,
      flood: false,
      lineOrder,
      bands,
    });

    expect(plan).toHaveLength(1);
    expect(plan[0].id).toBeNull(); // unbound face — the store mints
    expect(plan[0].assignment!.lineId).toBe('d'); // default a → next in cover
  });

  it('shift-click floods the winner the face ALREADY shows, without cycling it', () => {
    // The point of the flood: spread the color you can SEE. Cycling first made
    // it a guess — you had no way to know which color would spread.
    const bands = trunkBands();
    const faces = buildOverlapRegions(bands, []);
    const at = (cover: string) => atIn(faces, cover);
    const seed = faces[at('a,d')];
    // The user has already clicked {a,d} over to d; now they shift-click it.
    const assignments: Record<string, RegionAssignment> = {
      r1: { id: 'r1', lineId: 'd', lines: [...seed.lineIds], anchors: mintAnchors(seed, bands) },
    };
    const winners = resolveRegionWinners(faces, assignments, bands, lineOrder);
    expect(winners[at('a,d')].winner).toBe('d');

    const plan = regionPaintPlan({
      faces,
      winners,
      assignments,
      faceIndex: at('a,d'),
      dir: 1,
      flood: true,
      lineOrder,
      bands,
    });

    // d carries across the rest of the crossing, and every write says d.
    expect(covers(plan)).toEqual(['b,d', 'c,d']);
    expect(plan.every((e) => e.assignment!.lineId === 'd')).toBe(true);
    // The clicked face is left alone — it already shows d, so re-writing it
    // would only churn its anchors (and cycling it would undo the click).
    expect(plan.map((e) => e.id)).not.toContain('r1');
  });

  it('shift-click that spreads nowhere writes nothing', () => {
    // {a,d} shows its default a; no neighbour's cover has a, so flooding a
    // reaches nothing. An empty plan is the signal not to burn an undo entry.
    const bands = trunkBands();
    const faces = buildOverlapRegions(bands, []);
    const winners = resolveRegionWinners(faces, {}, bands, lineOrder);

    const plan = regionPaintPlan({
      faces,
      winners,
      assignments: {},
      faceIndex: atIn(faces, 'a,d'),
      dir: 1,
      flood: true,
      lineOrder,
      bands,
    });

    expect(plan).toEqual([]);
  });
});

/**
 * Byte-exact cross-check of the optimized `bindAssignments` against a literal
 * copy of the pre-optimization implementation (linear band scans, per-candidate
 * Set allocations). The optimizations — pairKey band index, cover bitmasks,
 * per-line candidate prefilter, scratch-array scoring — are all claimed
 * output-identical; this property is the claim, executable. Reference kept
 * verbatim on purpose: if the two ever disagree, the reference is the spec.
 */
describe('bindAssignments cross-check vs reference implementation', () => {
  type Evaluated = { p: Vec2; d: number };

  const refEvaluateAnchor = (
    anchor: RegionAssignment['anchors'][number],
    bands: ReturnType<typeof hBand>[],
  ): Evaluated | null => evaluateAnchor(anchor, bands);

  const clamp01 = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

  const refPointToFaceDistance = (
    p: Vec2,
    face: ReturnType<typeof buildOverlapRegions>[number],
  ): number => {
    const b = face.bbox;
    const dx = Math.max(b.x0 - p.x, 0, p.x - b.x1);
    const dy = Math.max(b.y0 - p.y, 0, p.y - b.y1);
    const bboxDist = Math.hypot(dx, dy);
    if (bboxDist > 0) {
      if (bboxDist > 4) return bboxDist;
    }
    if (pointInFace(p, face.face)) return 0;
    const ring = face.face[0];
    let min = Infinity;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const c = ring[(i + 1) % ring.length];
      const ex = c.x - a.x;
      const ey = c.y - a.y;
      const lenSq = ex * ex + ey * ey;
      const t = lenSq > 0 ? clamp01(((p.x - a.x) * ex + (p.y - a.y) * ey) / lenSq, 0, 1) : 0;
      const qx = a.x + ex * t;
      const qy = a.y + ey * t;
      min = Math.min(min, Math.hypot(p.x - qx, p.y - qy));
    }
    return min;
  };

  const refAnchorCorridorOk = (
    anchor: RegionAssignment['anchors'][number],
    face: ReturnType<typeof buildOverlapRegions>[number],
  ): boolean => {
    if (face.spans.has(`${anchor.lineId}|${anchor.pairKey}`)) return true;
    for (const key of face.spans.keys()) {
      if (key.startsWith(`${anchor.lineId}|`)) return false;
    }
    return true;
  };

  const refBindAssignments = (
    faces: ReturnType<typeof buildOverlapRegions>,
    assignments: Record<string, RegionAssignment>,
    bands: ReturnType<typeof hBand>[],
    liveLines: Set<string>,
    order?: string[],
  ): Map<string, number> => {
    const out = new Map<string, number>();
    const taken = new Set<number>();
    const ids = order ?? Object.keys(assignments).sort();
    const prepared = new Map<
      string,
      {
        required: string[];
        evals: { anchor: RegionAssignment['anchors'][number]; ev: Evaluated }[];
      }
    >();
    for (const id of ids) {
      const a = assignments[id];
      if (!a || !liveLines.has(a.lineId)) continue;
      const evals = a.anchors
        .filter((anchor) => liveLines.has(anchor.lineId))
        .map((anchor) => ({ anchor, ev: refEvaluateAnchor(anchor, bands) }))
        .filter(
          (x): x is { anchor: RegionAssignment['anchors'][number]; ev: Evaluated } => x.ev !== null,
        );
      if (!evals.length) continue;
      prepared.set(id, { required: a.lines.filter((l) => liveLines.has(l)), evals });
    }
    for (const strict of [true, false]) {
      for (const id of ids) {
        if (out.has(id)) continue;
        const prep = prepared.get(id);
        if (!prep) continue;
        const a = assignments[id];
        let best = -1;
        let bestScore = Infinity;
        for (let i = 0; i < faces.length; i++) {
          if (taken.has(i)) continue;
          const f = faces[i];
          const cover = new Set(f.lineIds);
          if (!cover.has(a.lineId)) continue;
          if (!prep.required.every((l) => cover.has(l))) continue;
          if (strict && !prep.evals.every(({ anchor }) => refAnchorCorridorOk(anchor, f))) continue;
          const contributions = prep.evals
            .map(({ ev }) => refPointToFaceDistance(ev.p, f))
            .sort((x, y) => x - y);
          let score = 0;
          for (let c = 0; c < contributions.length; c++) {
            score += c === 0 ? contributions[c] : 0.25 * contributions[c];
          }
          if (score < bestScore - 1e-9) {
            bestScore = score;
            best = i;
          }
        }
        if (best >= 0) {
          out.set(id, best);
          taken.add(best);
        }
      }
    }
    return out;
  };

  it('matches the reference on randomized grids, assignments and orders', () => {
    // 2-3 horizontals × 2-3 verticals with distinct corridors per band gives
    // arrangements with sibling same-cover crossings — the case the two-pass
    // corridor logic exists for. Anchor distances are perturbed to simulate
    // the stale mid-drag values the binder must handle.
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 3 }),
        fc.integer({ min: 2, max: 3 }),
        fc.array(
          fc.record({
            face: fc.nat(30),
            winnerPick: fc.nat(5),
            drift: fc.double({ min: -80, max: 80, noNaN: true }),
            dropAnchor: fc.boolean(),
          }),
          { minLength: 0, maxLength: 6 },
        ),
        fc.boolean(),
        fc.boolean(),
        (nH, nV, seeds, shuffleOrder, dropLive) => {
          const bands = [
            ...Array.from({ length: nH }, (_, i) =>
              hBand(`h${i}`, `sh${i}|sh${i}b`, -30, 260, i * 90),
            ),
            ...Array.from({ length: nV }, (_, i) =>
              vBand(`v${i}`, `sv${i}|sv${i}b`, -30, 260, i * 90),
            ),
          ];
          const faces = buildOverlapRegions(bands, []);
          if (!faces.length) return;
          const assignments: Record<string, RegionAssignment> = {};
          seeds.forEach((s, n) => {
            const face = faces[s.face % faces.length];
            const anchors = mintAnchors(face, bands).map((a) => ({
              ...a,
              distance: Math.max(0, a.distance + s.drift),
            }));
            if (s.dropAnchor && anchors.length > 1) anchors.pop();
            const id = `r${n}`;
            assignments[id] = {
              id,
              lineId: face.lineIds[s.winnerPick % face.lineIds.length],
              lines: [...face.lineIds].sort(),
              anchors,
            };
          });
          const allLines = [...new Set(bands.map((b) => b.lines[0].id))];
          const liveLines = new Set(dropLive ? allLines.slice(1) : allLines);
          const order = shuffleOrder ? Object.keys(assignments).sort().reverse() : undefined;

          const expected = refBindAssignments(faces, assignments, bands, liveLines, order);
          const actual = bindAssignments(faces, assignments, bands, liveLines, order);
          expect([...actual.entries()].sort()).toEqual([...expected.entries()].sort());
        },
      ),
      { numRuns: 40 },
    );
  });

  // The cover subset test is a bitmask over the live-line universe, and the
  // universe is as big as the map's line list — an MTA-sized map puts real
  // lines past bit 31. A line's position in that universe cannot change
  // whether its assignments bind.
  it('binds regardless of where the line falls in the live-line universe', () => {
    const bands = [hBand('h', 'sh|shb', -30, 260), vBand('v', 'sv|svb', -30, 260, 90)];
    const faces = buildOverlapRegions(bands, []);
    expect(faces).toHaveLength(1);
    const asg: RegionAssignment = {
      id: 'r1',
      lineId: 'v',
      lines: ['h', 'v'].sort(),
      anchors: mintAnchors(faces[0], bands),
    };

    // Pad the universe so 'v' lands at each bit in turn. `liveLines` is a Set,
    // so insertion order is the bit order (see bindAssignments' lineBit map).
    for (let bit = 0; bit <= 33; bit++) {
      const liveLines = new Set<string>(Array.from({ length: bit }, (_, i) => `pad${i}`));
      liveLines.add('v');
      liveLines.add('h');
      expect(bindAssignments(faces, { r1: asg }, bands, liveLines).get('r1'), `bit ${bit}`).toBe(0);
    }
  });
});

describe('stripeBodyPolys memo', () => {
  it('returns the same rings object for the same spec object', () => {
    // Identity-stable band specs make spec identity a version stamp (the
    // reuse layer only hands back the same object when value-identical), so
    // the stripe body memo can never serve stale rings — and an untouched
    // corridor's body stops paying its offset on every rebuild.
    const band = hBand('l1', 's1|s2', 0, 100);
    expect(stripeBodyPolys(band, 0)).toBe(stripeBodyPolys(band, 0));
    // A fresh spec object recomputes — identical content, new rings.
    const again = hBand('l1', 's1|s2', 0, 100);
    expect(stripeBodyPolys(again, 0)).not.toBe(stripeBodyPolys(band, 0));
  });
});
