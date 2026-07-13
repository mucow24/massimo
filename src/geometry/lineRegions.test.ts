import { describe, it, expect } from 'vitest';
import {
  flattenOffsetSegments,
  stripeBodyPolys,
  buildLineBodies,
  buildOverlapRegions,
  bindAssignments,
  resolveRegionWinners,
  regionClickAction,
  mintAnchors,
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
  priority: 0,
  style: 'solid',
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
    // The crossing occupies x ∈ [43, 57] along the 100-long horizontal stripe.
    expect(spanH!.intervals[0].d0).toBeGreaterThan(38);
    expect(spanH!.intervals[0].d1).toBeLessThan(62);
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
});
