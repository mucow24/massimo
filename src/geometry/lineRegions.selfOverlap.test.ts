import { describe, it, expect } from 'vitest';
import { buildBands, buildStopMarkers } from './interlining';
import {
  armCoverId,
  armOfLinePairKey,
  buildExclusionHoles,
  buildExclusionHolesCached,
  buildOverlapRegions,
  clipperQuant,
  edgeCoverId,
  mintAnchors,
  regionFloodTargets,
  regionPaintPlan,
  resetExclusionHoleCache,
  resolveRegionWinners,
  type RegionFace,
  type RegionSliver,
} from './lineRegions';
import { buildRegionsIncremental } from './regionIncremental';
import { reconcileRegionAssignments } from './regionReconcile';
import { sanitizeRegionAssignments } from '../model/serialize';
import {
  faceArea,
  interiorPoint,
  intersect,
  offsetClosed,
  pointInFace,
  splitIntoFaces,
  unionAll,
  type Ring,
} from './clip';
import { makeDoc, makeLine, makeStation, makeStop } from '../test/fixtures';
import type { MapDoc, RegionAssignment } from '../model/types';

// ---------------------------------------------------------------------------
// Self-overlap faces: where a line's ARMS overlap (a branch mouth, a station
// self-crossing), the arrangement now carries real clickable faces, covered by
// per-arm cover ids — exactly the faces the two-line workaround (model the
// branch as a separate line) has always produced. The golden claim: the real
// branch and the workaround yield THE SAME face geometry.
// ---------------------------------------------------------------------------

const hStop = (id: string) => makeStop(id, { orientation: 'auto-horizontal' });
const vStop = (id: string) => makeStop(id, { orientation: 'auto-vertical' });

/** Trunk a—j—c with a branch j—d, as ONE line. */
const branchDoc = () =>
  makeDoc({
    stations: [
      makeStation({ id: 'j', x: 0, y: 0, stops: [hStop('l1')] }),
      makeStation({ id: 'a', x: -120, y: 0, stops: [hStop('l1')] }),
      makeStation({ id: 'c', x: 120, y: 0, stops: [hStop('l1')] }),
      makeStation({ id: 'd', x: 120, y: -120, stops: [vStop('l1')] }),
    ],
    lines: [makeLine({ id: 'l1', color: '#c00', edges: ['a|j', 'c|j', 'd|j'] })],
  });

/** The SAME shape as two lines: trunk l1, branch lb, stop cells coincident. */
const workaroundDoc = () =>
  makeDoc({
    stations: [
      makeStation({ id: 'j', x: 0, y: 0, stops: [hStop('l1'), hStop('lb')] }),
      makeStation({ id: 'a', x: -120, y: 0, stops: [hStop('l1')] }),
      makeStation({ id: 'c', x: 120, y: 0, stops: [hStop('l1')] }),
      makeStation({ id: 'd', x: 120, y: -120, stops: [vStop('lb')] }),
    ],
    lines: [
      makeLine({ id: 'l1', color: '#c00', edges: ['a|j', 'c|j'] }),
      makeLine({ id: 'lb', color: '#c00', edges: ['d|j'] }),
    ],
  });

const facesFor = (doc: MapDoc): RegionFace[] =>
  buildOverlapRegions(buildBands(doc.stations, doc.lines, doc.lineOrder), []);

/** Rotation- and direction-invariant content key of one face's rings. */
const keyOf = (f: RegionFace): string =>
  f.face
    .map((ring) => {
      const pts = ring.map((p) => `${clipperQuant(p.x)},${clipperQuant(p.y)}`);
      const variants: string[] = [];
      for (const seq of [pts, [...pts].reverse()]) {
        for (let s = 0; s < seq.length; s++) {
          variants.push([...seq.slice(s), ...seq.slice(0, s)].join(' '));
        }
      }
      return variants.sort()[0];
    })
    .sort()
    .join('|');

describe('self-overlap faces (branch mouths)', () => {
  it('a branching line yields a mouth face covered by its two arms', () => {
    const faces = facesFor(branchDoc());
    expect(faces.length).toBeGreaterThan(0);
    // Every face here is a self face of l1: two distinct per-arm cover ids.
    for (const f of faces) {
      expect(f.lineIds).toHaveLength(2);
      expect(new Set(f.lineIds).size).toBe(2);
      for (const id of f.lineIds) expect(id).toContain('l1');
    }
  });

  it('golden parity: the real branch equals the two-line workaround, geometrically', () => {
    const branch = facesFor(branchDoc());
    const workaround = facesFor(workaroundDoc());
    expect(branch.length).toBe(workaround.length);
    expect(branch.map(keyOf).sort()).toEqual(workaround.map(keyOf).sort());
    const area = (fs: RegionFace[]) => fs.reduce((s, f) => s + faceArea(f.face), 0);
    expect(area(branch)).toBeCloseTo(area(workaround), 6);
  });

  it('a corner-only line yields NO self faces, however many bends it has', () => {
    const doc = makeDoc({
      stations: [
        makeStation({ id: 'a', x: -120, y: 0, stops: [hStop('l1')] }),
        makeStation({ id: 'b', x: 0, y: 0, stops: [hStop('l1')] }),
        makeStation({ id: 'c', x: 0, y: -120, stops: [vStop('l1')] }),
        makeStation({ id: 'd', x: 120, y: -120, stops: [hStop('l1')] }),
        makeStation({ id: 'e', x: 120, y: -240, stops: [vStop('l1')] }),
      ],
      lines: [makeLine({ id: 'l1', color: '#c00', edges: ['a|b', 'b|c', 'c|d', 'd|e'] })],
    });
    expect(facesFor(doc)).toEqual([]);
  });

  it('covers stay bare line ids where only one arm is present', () => {
    // A second line crossing the trunk far from the junction: that face's
    // cover must read exactly [l1, lx] — no arm spelling leaks out of the
    // self-overlapped component.
    const base = branchDoc();
    const doc = makeDoc({
      stations: [
        ...Object.values(base.stations),
        makeStation({ id: 'n', x: -60, y: -100, stops: [vStop('lx')] }),
        makeStation({ id: 's', x: -60, y: 100, stops: [vStop('lx')] }),
      ],
      lines: [base.lines['l1'], makeLine({ id: 'lx', color: '#00c', edges: ['n|s'] })],
    });
    const faces = facesFor(doc);
    const atCrossing = faces.filter((f) => f.bbox.x0 < -40 && f.bbox.x1 > -80);
    expect(atCrossing.length).toBeGreaterThan(0);
    for (const f of atCrossing) expect(f.lineIds).toEqual(['l1', 'lx']);
  });

  it('the incremental build matches the reference, cold and warm', () => {
    const doc = branchDoc();
    const bands = buildBands(doc.stations, doc.lines, doc.lineOrder);
    const ref = buildOverlapRegions(bands, []);
    const cold = buildRegionsIncremental(bands, [], null);
    expect(cold.faces.map(keyOf).sort()).toEqual(ref.map(keyOf).sort());
    const warm = buildRegionsIncremental(bands, [], cold.state);
    expect(warm.reused).toBe(true);
    expect(warm.faces.map(keyOf).sort()).toEqual(ref.map(keyOf).sort());
  });

  it('painting: a pure self face cycles merged → trunk arm → branch arm → merged (delete)', () => {
    const doc = branchDoc();
    const bands = buildBands(doc.stations, doc.lines, doc.lineOrder);
    const faces = buildOverlapRegions(bands, []);
    expect(faces).toHaveLength(1);
    const lineOrder = ['l1'];
    const planFor = (assignments: Record<string, RegionAssignment>) => {
      const winners = resolveRegionWinners(faces, assignments, bands, lineOrder);
      return regionPaintPlan({
        faces,
        winners,
        assignments,
        faceIndex: 0,
        dir: 1,
        flood: false,
        lineOrder,
        bands,
      });
    };
    // Click 1: merged (default) → first arm. Stores an arm choice.
    const p1 = planFor({});
    expect(p1).toHaveLength(1);
    const a1 = p1[0].assignment!;
    expect(a1.lineId).toBe('l1');
    expect(a1.lines).toEqual(['l1']);
    expect(a1.winnerPairKey).toBeDefined();
    expect(armOfLinePairKey(bands, 'l1', a1.winnerPairKey!)).toBe(0);
    // The winner's pairKey is one of its own anchors' — the invariant the
    // reconcile translation rides on.
    expect(a1.anchors.some((an) => an.lineId === 'l1' && an.pairKey === a1.winnerPairKey)).toBe(
      true,
    );
    // Click 2: first arm → second arm.
    const withA1 = { r1: { ...a1, id: 'r1' } };
    const w1 = resolveRegionWinners(faces, withA1, bands, lineOrder);
    expect(w1[0]).toEqual({ winner: armCoverId('l1', 0), assignmentId: 'r1' });
    const p2 = planFor(withA1);
    expect(p2).toHaveLength(1);
    expect(p2[0].id).toBe('r1');
    const a2 = p2[0].assignment!;
    expect(armOfLinePairKey(bands, 'l1', a2.winnerPairKey!)).toBe(1);
    // Click 3: second arm → merged = default ⇒ delete.
    const withA2 = { r1: { ...a2, id: 'r1' } };
    const p3 = planFor(withA2);
    expect(p3).toHaveLength(1);
    expect(p3[0].assignment).toBeNull();
  });

  it('a self face mints one anchor per arm, on different corridors', () => {
    const doc = branchDoc();
    const bands = buildBands(doc.stations, doc.lines, doc.lineOrder);
    const faces = buildOverlapRegions(bands, []);
    const anchors = mintAnchors(faces[0], bands);
    const l1Anchors = anchors.filter((a) => a.lineId === 'l1');
    expect(l1Anchors).toHaveLength(2);
    expect(new Set(l1Anchors.map((a) => a.pairKey)).size).toBe(2);
    const arms = l1Anchors.map((a) => armOfLinePairKey(bands, 'l1', a.pairKey)).sort();
    expect(arms).toEqual([0, 1]);
  });

  it('golden holes parity: the branch-arm reveal equals the two-line reveal, byte for byte', () => {
    const ringKey = (rings: Ring[]): string[] =>
      rings
        .map((ring) => {
          const pts = ring.map((p) => `${clipperQuant(p.x)},${clipperQuant(p.y)}`);
          const variants: string[] = [];
          for (const seq of [pts, [...pts].reverse()]) {
            for (let s = 0; s < seq.length; s++) {
              variants.push([...seq.slice(s), ...seq.slice(0, s)].join(' '));
            }
          }
          return variants.sort()[0];
        })
        .sort();
    const holesFor = (doc: MapDoc, winner: string, lineOrder: string[]) => {
      const bands = buildBands(doc.stations, doc.lines, doc.lineOrder);
      const slivers: RegionSliver[] = [];
      const faces = buildOverlapRegions(bands, [], slivers);
      expect(faces).toHaveLength(1);
      const winners = [{ winner, assignmentId: 'r1' }];
      return buildExclusionHoles(faces, winners, lineOrder, bands, [], () => 0, slivers);
    };
    // Real branch: branch arm (index 1) wins the mouth; the trunk arm loses.
    const branch = holesFor(branchDoc(), armCoverId('l1', 1), ['l1']);
    expect([...branch.keys()]).toEqual([armCoverId('l1', 0)]);
    // Workaround: lb (the branch line) wins; l1 (the trunk line) loses.
    const work = holesFor(workaroundDoc(), 'lb', ['l1', 'lb']);
    expect([...work.keys()]).toEqual(['l1']);
    expect(ringKey(branch.get(armCoverId('l1', 0))!)).toEqual(ringKey(work.get('l1')!));
  });

  it('cached holes equal the reference on a painted self face', () => {
    const doc = branchDoc();
    const bands = buildBands(doc.stations, doc.lines, doc.lineOrder);
    const slivers: RegionSliver[] = [];
    const faces = buildOverlapRegions(bands, [], slivers);
    const winners = [{ winner: armCoverId('l1', 1), assignmentId: 'r1' }];
    const reference = buildExclusionHoles(faces, winners, ['l1'], bands, [], () => 0, slivers);
    resetExclusionHoleCache();
    const cached = buildExclusionHolesCached(faces, winners, ['l1'], bands, [], () => 0, slivers);
    expect([...cached.keys()].sort()).toEqual([...reference.keys()].sort());
    for (const key of reference.keys()) {
      expect(JSON.stringify(cached.get(key))).toBe(JSON.stringify(reference.get(key)));
    }
  });

  it('an arm choice survives a station drag and re-spells across an edge split', () => {
    const before = branchDoc();
    const bandsBefore = buildBands(before.stations, before.lines, before.lineOrder);
    const facesBefore = buildOverlapRegions(bandsBefore, []);
    const winners = resolveRegionWinners(facesBefore, {}, bandsBefore, ['l1']);
    const plan = regionPaintPlan({
      faces: facesBefore,
      winners,
      assignments: {},
      faceIndex: 0,
      dir: -1, // straight to the branch arm
      flood: false,
      lineOrder: ['l1'],
      bands: bandsBefore,
    });
    const asg = { ...plan[0].assignment!, id: 'r1' };
    expect(armOfLinePairKey(bandsBefore, 'l1', asg.winnerPairKey!)).toBe(1);

    // Drag the branch terminus: same topology, new geometry. (A drag can
    // legitimately flip the junction's through-run verdict — the choice is
    // anchored to the EDGE, so it follows the edge's arm either way; this
    // drag keeps the verdict so the branch stays the branch.)
    const after = makeDoc({
      stations: Object.values(before.stations).map((s) =>
        s.id === 'd' ? { ...s, x: 100, y: -100 } : s,
      ),
      lines: [before.lines['l1']],
    });
    let n = 0;
    const out = reconcileRegionAssignments(
      { stations: before.stations, lines: before.lines, lineCircles: before.lineCircles },
      { stations: after.stations, lines: after.lines, lineCircles: after.lineCircles },
      { r1: asg },
      () => `m${n++}`,
    );
    expect(Object.keys(out)).toEqual(['r1']);
    const bandsAfter = buildBands(after.stations, after.lines, after.lineOrder);
    // The choice still names the branch edge's arm…
    expect(out.r1.winnerPairKey).toBe('d|j');
    const branchArm = armOfLinePairKey(bandsAfter, 'l1', 'd|j')!;
    expect(armOfLinePairKey(bandsAfter, 'l1', 'a|j')).not.toBe(branchArm);
    // …and resolves to it on the rebuilt faces.
    const facesAfter = buildOverlapRegions(bandsAfter, []);
    const resolved = resolveRegionWinners(facesAfter, out, bandsAfter, ['l1']);
    expect(resolved[0]).toEqual({ winner: armCoverId('l1', branchArm), assignmentId: 'r1' });
  });

  it('a flood of an arm winner stays confined to faces that distinguish that arm', () => {
    const doc = branchDoc();
    const bands = buildBands(doc.stations, doc.lines, doc.lineOrder);
    const faces = buildOverlapRegions(bands, []);
    const winners = [{ winner: armCoverId('l1', 1), assignmentId: 'r1' }];
    expect(regionFloodTargets(faces, winners, 0, armCoverId('l1', 1))).toEqual([0]);
  });

  it('sanitize keeps a string winnerPairKey and strips a malformed one', () => {
    const doc = branchDoc();
    const bands = buildBands(doc.stations, doc.lines, doc.lineOrder);
    const faces = buildOverlapRegions(bands, []);
    const anchors = mintAnchors(faces[0], bands);
    const good: RegionAssignment = {
      id: 'r1',
      lineId: 'l1',
      lines: ['l1'],
      anchors,
      winnerPairKey: 'd|j',
    };
    const kept = sanitizeRegionAssignments({ r1: good }, doc.lines);
    expect(kept.changed).toBe(false);
    expect(kept.assignments.r1.winnerPairKey).toBe('d|j');
    const bad = { r1: { ...good, winnerPairKey: 42 as unknown as string } };
    const stripped = sanitizeRegionAssignments(bad, doc.lines);
    expect(stripped.changed).toBe(true);
    expect('winnerPairKey' in stripped.assignments.r1).toBe(false);
  });

  it('a tangent mouth cycles to CURVE-ONLY: the branch arm is its own slice', () => {
    // The screenshot shape: the branch hugs the trunk (tangent departure,
    // large radius) before the arc peels off — the hardest mouth. The trunk
    // must stay one arm and the curve another, so the third cycle state is
    // the curve's casing alone, not trunk+curve welded.
    const doc = makeDoc({
      stations: [
        makeStation({ id: 'a', x: -400, y: 0, stops: [hStop('l1')] }),
        makeStation({ id: 'j', x: 0, y: 0, stops: [hStop('l1')] }),
        makeStation({ id: 'c', x: 150, y: 0, stops: [hStop('l1')] }),
        makeStation({ id: 'd', x: 500, y: -500, stops: [vStop('l1')] }),
      ],
      lines: [
        makeLine({ id: 'l1', color: '#c00', edges: ['a|j', 'c|j', 'd|j'], curveRadius: 250 }),
      ],
    });
    const bands = buildBands(doc.stations, doc.lines, doc.lineOrder);
    const faces = buildOverlapRegions(bands, []);
    const selfFaces = faces.filter((f) => f.lineIds.every((id) => id !== 'l1'));
    expect(selfFaces.length).toBeGreaterThan(0);
    const idx = faces.indexOf(selfFaces[0]);
    // Two clicks from merged land on the CURVE arm — the arm whose pairKey is
    // the branch edge — with only two arm slices on offer.
    const w0 = resolveRegionWinners(faces, {}, bands, ['l1']);
    const p1 = regionPaintPlan({
      faces,
      winners: w0,
      assignments: {},
      faceIndex: idx,
      dir: -1, // backward from merged = the LAST slice
      flood: false,
      lineOrder: ['l1'],
      bands,
    });
    const a1 = p1[0].assignment!;
    expect(a1.winnerPairKey).toBe('d|j');
    // Winning the curve arm holes ONLY the trunk arm — the reveal is the
    // curve's own casing, nothing welded in.
    const withA1 = { r1: { ...a1, id: 'r1' } };
    const w1 = resolveRegionWinners(faces, withA1, bands, ['l1']);
    expect(w1[idx].winner).toBe(armCoverId('l1', armOfLinePairKey(bands, 'l1', 'd|j')!));
    const holes = buildExclusionHoles(faces, w1, ['l1'], bands, [], () => 2, []);
    const trunkArm = armOfLinePairKey(bands, 'l1', 'a|j')!;
    expect([...holes.keys()]).toEqual([armCoverId('l1', trunkArm)]);
  });

  /** Interlined trunk (orange row 0 ABOVE grey row 1 in z), grey branching
   *  tangentially up through orange's stripe to d. The shape behind the
   *  boundary-stroke semantics tests below. */
  const tangentPairDoc = () =>
    makeDoc({
      stations: [
        makeStation({
          id: 'a',
          x: -400,
          y: 0,
          stops: [
            makeStop('oa', { row: 0, orientation: 'auto-horizontal' }),
            makeStop('gr', { row: 1, orientation: 'auto-horizontal' }),
          ],
        }),
        makeStation({
          id: 'j',
          x: 0,
          y: 0,
          stops: [
            makeStop('oa', { row: 0, orientation: 'auto-horizontal' }),
            makeStop('gr', { row: 1, orientation: 'auto-horizontal' }),
          ],
        }),
        makeStation({
          id: 'c',
          x: 400,
          y: 0,
          stops: [
            makeStop('oa', { row: 0, orientation: 'auto-horizontal' }),
            makeStop('gr', { row: 1, orientation: 'auto-horizontal' }),
          ],
        }),
        makeStation({ id: 'd', x: 500, y: -500, stops: [vStop('gr')] }),
      ],
      lines: [
        makeLine({ id: 'oa', color: '#f60', edges: ['a|j', 'c|j'], strokeWidth: 2 }),
        makeLine({
          id: 'gr',
          color: '#999',
          edges: ['a|j', 'c|j', 'd|j'],
          strokeWidth: 2,
          curveRadius: 200,
        }),
      ],
    });

  it("an UNPAINTED crossing keeps the neighbor's rail: the curve slides under intact", () => {
    // Only the mouth is painted; the oa∩curve crossing stays default, so
    // orange covers the curve above the shared edge. The boundary stroke
    // must then run intact across the reveal — holing orange's rail eats
    // the stroke's near half along the whole tangent hug (the "stroke gets
    // thinner where grey is curving" artifact) and leaves slivers of the
    // curve's own casing poking past the boundary (the overshoot ticks).
    // A line the winner slides UNDER is never a loser.
    const doc = tangentPairDoc();
    const bands = buildBands(doc.stations, doc.lines, doc.lineOrder);
    const faces = buildOverlapRegions(bands, []);
    const lineOrder = ['oa', 'gr']; // orange front-most = above grey
    const branchArm = armOfLinePairKey(bands, 'gr', 'd|j')!;
    const trunkArm = armOfLinePairKey(bands, 'gr', 'a|j')!;
    expect(branchArm).not.toBe(trunkArm);
    const mouthIdx = faces.findIndex(
      (f) =>
        f.lineIds.includes(armCoverId('gr', trunkArm)) &&
        f.lineIds.includes(armCoverId('gr', branchArm)),
    );
    expect(mouthIdx).toBeGreaterThanOrEqual(0);
    // The mouth's cover is pure grey — orange's body never overlaps it.
    expect(faces[mouthIdx].lineIds.some((id) => id.includes('oa'))).toBe(false);
    // Paint the curve arm on top.
    const set = regionPaintPlan({
      faces,
      winners: resolveRegionWinners(faces, {}, bands, lineOrder),
      assignments: {},
      faceIndex: mouthIdx,
      dir: -1,
      flood: false,
      lineOrder,
      bands,
    })[0].assignment!;
    expect(armOfLinePairKey(bands, 'gr', set.winnerPairKey!)).toBe(branchArm);
    const withSet = { r1: { ...set, id: 'r1' } };
    const winners = resolveRegionWinners(faces, withSet, bands, lineOrder);
    const holes = buildExclusionHoles(faces, winners, lineOrder, bands, [], () => 2, []);
    // The losing trunk arm is holed; orange is untouched.
    expect(holes.get(armCoverId('gr', trunkArm))?.length).toBeGreaterThan(0);
    expect(holes.has('oa'), "orange's stroke must survive a crossing it wins").toBe(false);
  });

  it("painting the crossing punches the neighbor's rail at the joint (no white residue)", () => {
    // Mouth AND the oa∩curve crossing painted for grey: the curve visibly
    // crosses onto orange, so the boundary stroke must break cleanly. The
    // crossing face's own cover holes reach the shared rail zone (loser
    // dilation spans railW past the face) and the mouth reveal tiles with
    // them through the same-line shield exemption — the original
    // coincident-rail white line stays dead without any extra mechanism.
    const doc = tangentPairDoc();
    const bands = buildBands(doc.stations, doc.lines, doc.lineOrder);
    const faces = buildOverlapRegions(bands, []);
    const lineOrder = ['oa', 'gr'];
    const branchArm = armOfLinePairKey(bands, 'gr', 'd|j')!;
    const trunkArm = armOfLinePairKey(bands, 'gr', 'a|j')!;
    const mouthIdx = faces.findIndex(
      (f) =>
        f.lineIds.includes(armCoverId('gr', trunkArm)) &&
        f.lineIds.includes(armCoverId('gr', branchArm)),
    );
    // The crossing sits in its own component (the two overlap zones only
    // abut at the boundary), so grey's cover there collapses to the merged
    // line — exactly the spelling the real map stores.
    const crossIdx = faces.findIndex((f) => f.lineIds.includes('oa') && f.lineIds.includes('gr'));
    expect(mouthIdx).toBeGreaterThanOrEqual(0);
    expect(crossIdx).toBeGreaterThanOrEqual(0);
    let assignments: Record<string, RegionAssignment> = {};
    for (const [rid, idx] of [
      ['r1', mouthIdx],
      ['r2', crossIdx],
    ] as const) {
      const set = regionPaintPlan({
        faces,
        winners: resolveRegionWinners(faces, assignments, bands, lineOrder),
        assignments,
        faceIndex: idx,
        dir: -1,
        flood: false,
        lineOrder,
        bands,
      })[0].assignment!;
      expect(set.lineId).toBe('gr');
      assignments = { ...assignments, [rid]: { ...set, id: rid } };
    }
    expect(armOfLinePairKey(bands, 'gr', assignments.r1.winnerPairKey!)).toBe(branchArm);
    expect(assignments.r2.winnerPairKey).toBeUndefined();
    const winners = resolveRegionWinners(faces, assignments, bands, lineOrder);
    const holes = buildExclusionHoles(faces, winners, lineOrder, bands, [], () => 2, []);
    const oaHoles = holes.get('oa');
    expect(oaHoles?.length).toBeGreaterThan(0);
    // The shared boundary sits midway between the two trunk centerlines
    // (bodies abut; both rails are centered on it). The punch must cover it
    // at the crossing — and stay LOCAL: left of the crossing the curve is
    // still under orange and the stroke intact.
    const trunkBand = bands.find((b) => b.pairKey === 'a|j')!;
    const kOa = trunkBand.lines.findIndex((l) => l.id === 'oa');
    const kGr = trunkBand.lines.findIndex((l) => l.id === 'gr');
    const yBoundary =
      trunkBand.centerline[0].y + (trunkBand.stripeOffsets[kOa] + trunkBand.stripeOffsets[kGr]) / 2;
    const cross = faces[crossIdx].bbox;
    const xMid = (cross.x0 + cross.x1) / 2;
    // Contributions from different faces may overlap — union before the
    // point test, or even-odd cancellation reads the joint as un-holed.
    const oaFaces = splitIntoFaces(unionAll(oaHoles!));
    const inOa = (p: { x: number; y: number }) => oaFaces.some((f) => pointInFace(p, f));
    expect(inOa({ x: xMid, y: yBoundary })).toBe(true);
    expect(inOa({ x: cross.x0 - 12, y: yBoundary })).toBe(false);
  });

  it('a five-line band: one painted crossing never clips the stripes above it', () => {
    // Torture-map case 19 distilled: five interlined lines, the bottom one
    // (x) forks up across the whole band; ONLY its crossing of w is painted
    // x-over-w. The v/u/t crossings stay default — x slides under them — so
    // their paint (body AND boundary rails) must stay whole. Clipping v here
    // is exactly the overshoot-tick / thinned-stroke artifact.
    const rowStop = (id: string, row: number) =>
      makeStop(id, { row, orientation: 'auto-horizontal' });
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 'a',
          x: -400,
          y: 0,
          stops: ['t', 'u', 'v', 'w', 'x'].map((id, r) => rowStop(id, r)),
        }),
        makeStation({
          id: 'j',
          x: 0,
          y: 0,
          stops: ['t', 'u', 'v', 'w', 'x'].map((id, r) => rowStop(id, r)),
        }),
        makeStation({
          id: 'c',
          x: 560,
          y: 0,
          stops: ['t', 'u', 'v', 'w', 'x'].map((id, r) => rowStop(id, r)),
        }),
        makeStation({ id: 'd', x: 460, y: -440, stops: [vStop('x')] }),
      ],
      lines: [
        makeLine({ id: 't', color: '#039', edges: ['a|j', 'c|j'], strokeWidth: 2 }),
        makeLine({ id: 'u', color: '#093', edges: ['a|j', 'c|j'], strokeWidth: 2 }),
        makeLine({ id: 'v', color: '#e32', edges: ['a|j', 'c|j'], strokeWidth: 2 }),
        makeLine({ id: 'w', color: '#f60', edges: ['a|j', 'c|j'], strokeWidth: 2 }),
        makeLine({ id: 'x', color: '#aaa', edges: ['a|j', 'c|j', 'd|j'], strokeWidth: 2 }),
      ],
    });
    const lineOrder = ['t', 'u', 'v', 'w', 'x']; // t front-most, x bottom
    const bands = buildBands(doc.stations, doc.lines, doc.lineOrder);
    const faces = buildOverlapRegions(bands, []);
    const idx = faces.findIndex((f) => {
      const lines = new Set(f.lineIds.map((id) => id.split(' ').pop() ?? id));
      return lines.has('w') && lines.has('x') && lines.size === 2;
    });
    expect(idx).toBeGreaterThanOrEqual(0);
    // Cycle the w∩x face until x's line wins it (spelling free).
    let assignments: Record<string, RegionAssignment> = {};
    let winners = resolveRegionWinners(faces, assignments, bands, lineOrder);
    for (let step = 0; step < 8 && !winners[idx].winner.includes('x'); step++) {
      const set = regionPaintPlan({
        faces,
        winners,
        assignments,
        faceIndex: idx,
        dir: 1,
        flood: false,
        lineOrder,
        bands,
      })[0].assignment;
      assignments = set ? { r1: { ...set, id: 'r1' } } : {};
      winners = resolveRegionWinners(faces, assignments, bands, lineOrder);
    }
    expect(winners[idx].winner.includes('x')).toBe(true);
    const holes = buildExclusionHoles(faces, winners, lineOrder, bands, [], () => 2, []);
    // w loses its face; every line above it that x merely slides under is
    // untouched, body and rails alike.
    expect(holes.get('w')?.length).toBeGreaterThan(0);
    for (const spared of ['t', 'u', 'v']) {
      expect(holes.has(spared), `${spared} must keep covering the curve`).toBe(false);
    }
  });

  it('a merged-line neighbor face does not shield an arm reveal of the same line', () => {
    // Grey FRONT-MOST this time: the face where grey's curve crosses orange
    // shows plain `gr` by z-default, right next to the mouth face painted
    // `arm:curve gr`. The shield compares winner strings, so without the
    // same-line exemption each face shields the other and the trunk's upper
    // rail-half — which pokes past the stripe boundary into the neighbor's
    // territory — survives unclipped exactly at the joint: the pixel-peeped
    // notches. The trunk-arm hole must reach through a same-line merged
    // neighbor.
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 'a',
          x: -400,
          y: 0,
          stops: [
            makeStop('oa', { row: 0, orientation: 'auto-horizontal' }),
            makeStop('gr', { row: 1, orientation: 'auto-horizontal' }),
          ],
        }),
        makeStation({
          id: 'j',
          x: 0,
          y: 0,
          stops: [
            makeStop('oa', { row: 0, orientation: 'auto-horizontal' }),
            makeStop('gr', { row: 1, orientation: 'auto-horizontal' }),
          ],
        }),
        makeStation({
          id: 'c',
          x: 400,
          y: 0,
          stops: [
            makeStop('oa', { row: 0, orientation: 'auto-horizontal' }),
            makeStop('gr', { row: 1, orientation: 'auto-horizontal' }),
          ],
        }),
        makeStation({ id: 'd', x: 500, y: -500, stops: [vStop('gr')] }),
      ],
      lines: [
        makeLine({ id: 'oa', color: '#f60', edges: ['a|j', 'c|j'], strokeWidth: 2 }),
        makeLine({
          id: 'gr',
          color: '#999',
          edges: ['a|j', 'c|j', 'd|j'],
          strokeWidth: 2,
          curveRadius: 200,
        }),
      ],
    });
    const lineOrder = ['gr', 'oa']; // grey front-most
    const bands = buildBands(doc.stations, doc.lines, doc.lineOrder);
    const faces = buildOverlapRegions(bands, []);
    const trunkArm = armOfLinePairKey(bands, 'gr', 'a|j')!;
    const branchArm = armOfLinePairKey(bands, 'gr', 'd|j')!;
    const mouthIdx = faces.findIndex(
      (f) =>
        f.lineIds.includes(armCoverId('gr', trunkArm)) &&
        f.lineIds.includes(armCoverId('gr', branchArm)),
    );
    const crossIdx = faces.findIndex((f) => f.lineIds.includes('gr') && f.lineIds.includes('oa'));
    expect(mouthIdx).toBeGreaterThanOrEqual(0);
    expect(crossIdx).toBeGreaterThanOrEqual(0);
    const set = regionPaintPlan({
      faces,
      winners: resolveRegionWinners(faces, {}, bands, lineOrder),
      assignments: {},
      faceIndex: mouthIdx,
      dir: -1,
      flood: false,
      lineOrder,
      bands,
    })[0].assignment!;
    expect(armOfLinePairKey(bands, 'gr', set.winnerPairKey!)).toBe(branchArm);
    const withSet = { r1: { ...set, id: 'r1' } };
    const winners = resolveRegionWinners(faces, withSet, bands, lineOrder);
    // The neighbor shows plain grey by default — same LINE, merged spelling.
    expect(winners[crossIdx]).toEqual({ winner: 'gr', assignmentId: null });
    const holes = buildExclusionHoles(faces, winners, lineOrder, bands, [], () => 2, []);
    const trunkRings = holes.get(armCoverId('gr', trunkArm))!;
    expect(trunkRings?.length).toBeGreaterThan(0);
    // Probe: a point INSIDE the merged neighbor face within the mouth's
    // dilation reach — where the trunk's rail-half crosses the joint. The
    // trunk hole must cover it, or the rail notches there.
    const overlap = intersect(
      offsetClosed(faces[mouthIdx].face, 2.5, 'miter'),
      faces[crossIdx].face,
    );
    expect(overlap.length).toBeGreaterThan(0);
    const probe = interiorPoint(splitIntoFaces(overlap)[0])!;
    expect(probe).toBeTruthy();
    const covered = splitIntoFaces(trunkRings).some((f) => pointInFace(probe, f));
    expect(covered, 'trunk hole must reach through the same-line neighbor').toBe(true);
  });

  it('stop markers do not manufacture extra self faces', () => {
    const doc = branchDoc();
    const bands = buildBands(doc.stations, doc.lines, doc.lineOrder);
    const markers = buildStopMarkers(doc.stations, doc.lines, doc.lineOrder);
    const withMarkers = buildOverlapRegions(bands, markers);
    // The mouth face is still there…
    expect(withMarkers.length).toBeGreaterThan(0);
    // …and every self-covered face still sits at the junction, not at the
    // plain stops the markers decorate.
    for (const f of withMarkers) {
      if (f.lineIds.some((id) => id !== 'l1' && id.includes('l1'))) {
        expect(f.bbox.x0).toBeLessThan(40);
        expect(f.bbox.x1).toBeGreaterThan(-40);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Mid-edge self-crossings — the band-pair rule. A one-arm chain looping back
// over its own trunk between stations (the P-shape) has no branch junction,
// so arms alone cannot see it; two bands of one arm sharing no station that
// bodily overlap are a genuine crossing, sliced per BAND.
// ---------------------------------------------------------------------------

describe('mid-edge self-crossings (band-pair rule)', () => {
  /** The P-shape: stem a—b, around via c and d, then d—e back across the
   *  stem. The crossing is at the origin, mid-edge on both pieces. */
  const pDoc = () =>
    makeDoc({
      stations: [
        makeStation({ id: 'a', x: 0, y: 200, stops: [vStop('l1')] }),
        makeStation({ id: 'b', x: 0, y: -200, stops: [vStop('l1')] }),
        makeStation({ id: 'c', x: 200, y: -200, stops: [hStop('l1')] }),
        makeStation({ id: 'd', x: 200, y: 0, stops: [vStop('l1')] }),
        makeStation({ id: 'e', x: -200, y: 0, stops: [hStop('l1')] }),
      ],
      lines: [makeLine({ id: 'l1', color: '#c00', edges: ['a|b', 'b|c', 'c|d', 'd|e'] })],
    });

  /** The same crossing as two lines. */
  const xDoc = () =>
    makeDoc({
      stations: [
        makeStation({ id: 'a', x: 0, y: 200, stops: [vStop('lv')] }),
        makeStation({ id: 'b', x: 0, y: -200, stops: [vStop('lv')] }),
        makeStation({ id: 'd', x: 200, y: 0, stops: [hStop('lh')] }),
        makeStation({ id: 'e', x: -200, y: 0, stops: [hStop('lh')] }),
      ],
      lines: [
        makeLine({ id: 'lv', color: '#c00', edges: ['a|b'] }),
        makeLine({ id: 'lh', color: '#c00', edges: ['d|e'] }),
      ],
    });

  it('a one-arm line crossing itself mid-edge yields a face sliced per band', () => {
    const faces = facesFor(pDoc());
    expect(faces).toHaveLength(1);
    expect(faces[0].lineIds).toEqual([edgeCoverId('l1', 'a|b'), edgeCoverId('l1', 'd|e')].sort());
  });

  it('golden parity: the crossing face equals the two-line X, geometrically', () => {
    const p = facesFor(pDoc());
    const x = facesFor(xDoc());
    expect(p.length).toBe(x.length);
    expect(p.map(keyOf).sort()).toEqual(x.map(keyOf).sort());
  });

  it('cycles merged → stem band → crossing band → merged, persisting each pairKey', () => {
    const doc = pDoc();
    const bands = buildBands(doc.stations, doc.lines, doc.lineOrder);
    const faces = buildOverlapRegions(bands, []);
    const planFor = (assignments: Record<string, RegionAssignment>) =>
      regionPaintPlan({
        faces,
        winners: resolveRegionWinners(faces, assignments, bands, ['l1']),
        assignments,
        faceIndex: 0,
        dir: 1,
        flood: false,
        lineOrder: ['l1'],
        bands,
      });
    const p1 = planFor({});
    const a1 = p1[0].assignment!;
    expect(a1.winnerPairKey).toBe('a|b');
    expect(a1.lines).toEqual(['l1']);
    const p2 = planFor({ r1: { ...a1, id: 'r1' } });
    const a2 = p2[0].assignment!;
    expect(a2.winnerPairKey).toBe('d|e');
    const p3 = planFor({ r1: { ...a2, id: 'r1' } });
    expect(p3[0].assignment).toBeNull();
  });

  it('golden holes parity: the band reveal equals the two-line reveal, byte for byte', () => {
    const ringKey = (rings: Ring[]): string[] =>
      rings
        .map((ring) => {
          const pts = ring.map((p) => `${clipperQuant(p.x)},${clipperQuant(p.y)}`);
          const variants: string[] = [];
          for (const seq of [pts, [...pts].reverse()]) {
            for (let s = 0; s < seq.length; s++) {
              variants.push([...seq.slice(s), ...seq.slice(0, s)].join(' '));
            }
          }
          return variants.sort()[0];
        })
        .sort();
    const holesFor = (doc: MapDoc, winner: string, lineOrder: string[]) => {
      const bands = buildBands(doc.stations, doc.lines, doc.lineOrder);
      const slivers: RegionSliver[] = [];
      const faces = buildOverlapRegions(bands, [], slivers);
      const winners = faces.map(() => ({ winner, assignmentId: 'r1' }));
      return buildExclusionHoles(faces, winners, lineOrder, bands, [], () => 0, slivers);
    };
    // P-shape: the stem band wins; the crossing band loses.
    const p = holesFor(pDoc(), edgeCoverId('l1', 'a|b'), ['l1']);
    expect([...p.keys()]).toEqual([edgeCoverId('l1', 'd|e')]);
    // Two lines: the vertical wins (an override — lh is the z-default).
    const x = holesFor(xDoc(), 'lv', ['lh', 'lv']);
    expect([...x.keys()]).toEqual(['lh']);
    expect(ringKey(p.get(edgeCoverId('l1', 'd|e'))!)).toEqual(ringKey(x.get('lh')!));
  });

  it("an edge def carries its ARM's holes too (stripes prefer the edge def)", () => {
    // One line with BOTH kinds of self face: a branch mouth at `a` (stem
    // g—a—b through, branch a—f) and a same-arm mid-edge crossing at the
    // origin (d|e back over a|b — both stem-arm bands). Paint the mouth so
    // the STEM ARM loses, and the crossing so band a|b loses. Stripe a|b
    // references its EDGE def — the finest spelling — so that def must
    // include the arm's mouth holes or the stripe paints unclipped over the
    // mouth winner's reveal.
    const doc = makeDoc({
      stations: [
        makeStation({ id: 'g', x: 0, y: 400, stops: [vStop('l1')] }),
        makeStation({ id: 'a', x: 0, y: 200, stops: [vStop('l1')] }),
        makeStation({ id: 'b', x: 0, y: -200, stops: [vStop('l1')] }),
        makeStation({ id: 'c', x: 200, y: -200, stops: [hStop('l1')] }),
        makeStation({ id: 'd', x: 200, y: 0, stops: [vStop('l1')] }),
        makeStation({ id: 'e', x: -200, y: 0, stops: [hStop('l1')] }),
        makeStation({ id: 'f', x: 200, y: 200, stops: [hStop('l1')] }),
      ],
      lines: [
        makeLine({
          id: 'l1',
          color: '#c00',
          edges: ['g|a', 'a|b', 'b|c', 'c|d', 'd|e', 'a|f'],
        }),
      ],
    });
    const bands = buildBands(doc.stations, doc.lines, doc.lineOrder);
    const faces = buildOverlapRegions(bands, []);
    const stemArm = armOfLinePairKey(bands, 'l1', 'a|b')!;
    const branchArm = armOfLinePairKey(bands, 'l1', 'a|f')!;
    expect(branchArm).not.toBe(stemArm);
    const mouthIdx = faces.findIndex((f) => f.lineIds.includes(armCoverId('l1', stemArm)));
    const crossIdx = faces.findIndex((f) => f.lineIds.includes(edgeCoverId('l1', 'a|b')));
    expect(mouthIdx).toBeGreaterThanOrEqual(0);
    expect(crossIdx).toBeGreaterThanOrEqual(0);
    // Mouth: branch arm wins (stem arm loses). Crossing: d|e wins (a|b loses).
    const mouthSet = regionPaintPlan({
      faces,
      winners: resolveRegionWinners(faces, {}, bands, ['l1']),
      assignments: {},
      faceIndex: mouthIdx,
      dir: -1,
      flood: false,
      lineOrder: ['l1'],
      bands,
    })[0].assignment!;
    expect(armOfLinePairKey(bands, 'l1', mouthSet.winnerPairKey!)).toBe(branchArm);
    const withMouth = { r1: { ...mouthSet, id: 'r1' } };
    const crossSet = regionPaintPlan({
      faces,
      winners: resolveRegionWinners(faces, withMouth, bands, ['l1']),
      assignments: withMouth,
      faceIndex: crossIdx,
      dir: -1,
      flood: false,
      lineOrder: ['l1'],
      bands,
    })[0].assignment!;
    expect(crossSet.winnerPairKey).toBe('d|e');
    const both = { r1: withMouth.r1, r2: { ...crossSet, id: 'r2' } };
    const winners = resolveRegionWinners(faces, both, bands, ['l1']);
    expect(winners[mouthIdx].winner).toBe(armCoverId('l1', branchArm));
    expect(winners[crossIdx].winner).toBe(edgeCoverId('l1', 'd|e'));
    const holes = buildExclusionHoles(faces, winners, ['l1'], bands, [], () => 2, []);
    const armKey = armCoverId('l1', stemArm);
    const edgeKey = edgeCoverId('l1', 'a|b');
    expect(holes.get(armKey)?.length).toBeGreaterThan(0);
    expect(holes.get(edgeKey)?.length).toBeGreaterThan(0);
    // The stripe's one clipPath (the edge def) must carry the mouth hole:
    // every arm-def ring appears in the edge def too.
    const ringKeySet = (rings: Ring[]) =>
      new Set(
        rings.map((r) => r.map((p) => `${clipperQuant(p.x)},${clipperQuant(p.y)}`).join(' ')),
      );
    const edgeRings = ringKeySet(holes.get(edgeKey)!);
    for (const key of ringKeySet(holes.get(armKey)!)) {
      expect(edgeRings.has(key), 'edge def must include the arm hole ring').toBe(true);
    }
  });

  it('the incremental build matches the reference on the P-shape, cold and warm', () => {
    const doc = pDoc();
    const bands = buildBands(doc.stations, doc.lines, doc.lineOrder);
    const ref = buildOverlapRegions(bands, []);
    const cold = buildRegionsIncremental(bands, [], null);
    expect(cold.faces.map(keyOf).sort()).toEqual(ref.map(keyOf).sort());
    const warm = buildRegionsIncremental(bands, [], cold.state);
    expect(warm.reused).toBe(true);
    expect(warm.faces.map(keyOf).sort()).toEqual(ref.map(keyOf).sort());
  });
});
