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
import { faceArea, type Ring } from './clip';
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
