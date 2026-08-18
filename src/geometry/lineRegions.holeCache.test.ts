import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildExclusionHoles,
  buildExclusionHolesCached,
  resetExclusionHoleCache,
  type HoleCacheStats,
  type HoleChain,
  type RegionFace,
  type RegionSliver,
} from './lineRegions';
import { buildRegionsIncremental, type RegionIncrementalState } from './regionIncremental';
import { makeBandSpec } from '../test/fixtures';
import type { SegmentBandSpec } from './interlining';
import type { LineId } from '../model/types';
import type { Ring } from './clip';

/**
 * The cached hole builder's contract: byte-equal to the cache-free reference
 * on every frame of every scenario — drags with real incremental chains,
 * winner flips with unchanged geometry, lineOrder permutations (including the
 * adversarial one that only a sliver-gate outcome can see), railW edits, and
 * broken chains — AND reuse must actually fire, or a builder that silently
 * recomputes everything passes every equality test.
 */

const hBand = (lineId: string, pairKey: string, x0: number, x1: number, y = 0) =>
  makeBandSpec([lineId], {
    pairKey,
    bandKey: `${pairKey}#${lineId}`,
    centerline: [
      { x: x0, y },
      { x: x1, y },
    ],
  });
const vBand = (lineId: string, pairKey: string, y0: number, y1: number, x: number) =>
  makeBandSpec([lineId], {
    pairKey,
    bandKey: `${pairKey}#${lineId}`,
    centerline: [
      { x, y: y0 },
      { x, y: y1 },
    ],
  });

/** Three horizontals crossed by three verticals; `vB` slides by dx. */
const grid = (dx = 0): SegmentBandSpec[] => [
  hBand('hA', 'a1|a2', -40, 260, 0),
  hBand('hB', 'b1|b2', -40, 260, 110),
  vBand('vA', 'c1|c2', -40, 260, 0),
  vBand('vB', 'd1|d2', -40, 260, 110 + dx),
  vBand('vC', 'e1|e2', -40, 260, 220),
];

/** Override every multi-cover face to its LOWEST-ranked cover line. */
const overrideAll = (faces: RegionFace[], lineOrder: LineId[]) => {
  const rank = new Map(lineOrder.map((id, i) => [id, i]));
  return faces.map((f) => {
    const sorted = [...f.lineIds].sort(
      (a, b) => (rank.get(a) ?? 99) - (rank.get(b) ?? 99) || (a < b ? -1 : 1),
    );
    const def = sorted[0];
    const winner = sorted[sorted.length - 1];
    return winner !== def ? { winner, assignmentId: 'r' } : { winner: def, assignmentId: null };
  });
};

const describeHoles = (holes: Map<LineId, Ring[]>): string =>
  [...holes.entries()]
    .map(
      ([id, rings]) =>
        `${id}:` + rings.map((r) => r.map((p) => `${p.x},${p.y}`).join(';')).join('|'),
    )
    .sort()
    .join('\n');

const ORDER = ['hA', 'hB', 'vA', 'vB', 'vC'];

describe('buildExclusionHolesCached ≡ buildExclusionHoles', () => {
  beforeEach(() => resetExclusionHoleCache());

  /** Drive one frame through the incremental builder; return everything the
   *  cached hole builder consumes, chain included. */
  const frame = (bands: SegmentBandSpec[], prev: RegionIncrementalState | null) => {
    const built = buildRegionsIncremental(bands, [], prev);
    const chain: HoleChain = {
      state: built.state,
      prevState: prev,
      dirtyBoxes: built.dirtyBoxes,
    };
    return { built, chain };
  };

  it('matches the reference across a drag, and reuse fires away from the move', () => {
    let prev: RegionIncrementalState | null = null;
    for (const dx of [0, 3, 6, 9, 6, 3, 0]) {
      const bands = grid(dx);
      const { built, chain } = frame(bands, prev);
      const winners = overrideAll(built.faces, ORDER);
      const stats: HoleCacheStats = { reused: 0, recomputed: 0 };
      const cached = buildExclusionHolesCached(
        built.faces,
        winners,
        ORDER,
        bands,
        [],
        () => 0,
        built.slivers,
        chain,
        stats,
      );
      const reference = buildExclusionHoles(
        built.faces,
        winners,
        ORDER,
        bands,
        [],
        () => 0,
        built.slivers,
      );
      expect(describeHoles(cached)).toBe(describeHoles(reference));
      if (prev !== null) {
        // vB crosses 2 of the 6 crossings; the other crossings' overridden
        // faces must be served from the cache.
        expect(stats.reused).toBeGreaterThan(0);
      }
      prev = built.state;
    }
  });

  it('drag-away-and-back reproduces the starting holes exactly (no hysteresis)', () => {
    const first = frame(grid(0), null);
    const w0 = overrideAll(first.built.faces, ORDER);
    const start = buildExclusionHolesCached(
      first.built.faces,
      w0,
      ORDER,
      grid(0),
      [],
      () => 0,
      first.built.slivers,
      first.chain,
    );
    let prev = first.built.state;
    let last: Map<LineId, Ring[]> | null = null;
    for (const dx of [5, 10, 5, 0]) {
      const bands = grid(dx);
      const { built, chain } = frame(bands, prev);
      last = buildExclusionHolesCached(
        built.faces,
        overrideAll(built.faces, ORDER),
        ORDER,
        bands,
        [],
        () => 0,
        built.slivers,
        chain,
      );
      prev = built.state;
    }
    expect(describeHoles(last!)).toBe(describeHoles(start));
  });

  it('a winner flip with unchanged geometry invalidates exactly what it touches', () => {
    const bands = grid(0);
    const { built, chain } = frame(bands, null);
    const winners = overrideAll(built.faces, ORDER);
    buildExclusionHolesCached(
      built.faces,
      winners,
      ORDER,
      bands,
      [],
      () => 0,
      built.slivers,
      chain,
    );
    // Same geometry, same state: flip ONE overridden face back to default.
    const flipIdx = winners.findIndex((w) => w.assignmentId);
    const flipped = winners.map((w, i) =>
      i === flipIdx ? { winner: built.faces[i].lineIds[0], assignmentId: null } : w,
    );
    const sameStateChain: HoleChain = { state: chain.state, prevState: null, dirtyBoxes: [] };
    const stats: HoleCacheStats = { reused: 0, recomputed: 0 };
    const cached = buildExclusionHolesCached(
      built.faces,
      flipped,
      ORDER,
      bands,
      [],
      () => 0,
      built.slivers,
      sameStateChain,
      stats,
    );
    const reference = buildExclusionHoles(
      built.faces,
      flipped,
      ORDER,
      bands,
      [],
      () => 0,
      built.slivers,
    );
    expect(describeHoles(cached)).toBe(describeHoles(reference));
    // Distant overridden faces (outside the flipped face's shield radius)
    // must still reuse.
    expect(stats.reused).toBeGreaterThan(0);
  });

  it('a lineOrder permutation re-resolves through the cache', () => {
    const bands = grid(0);
    const { built, chain } = frame(bands, null);
    const winners = overrideAll(built.faces, ORDER);
    buildExclusionHolesCached(
      built.faces,
      winners,
      ORDER,
      bands,
      [],
      () => 0,
      built.slivers,
      chain,
    );
    const order2 = ['vC', 'vB', 'vA', 'hB', 'hA'];
    const winners2 = overrideAll(built.faces, order2);
    const sameStateChain: HoleChain = { state: chain.state, prevState: null, dirtyBoxes: [] };
    const cached = buildExclusionHolesCached(
      built.faces,
      winners2,
      order2,
      bands,
      [],
      () => 0,
      built.slivers,
      sameStateChain,
    );
    const reference = buildExclusionHoles(
      built.faces,
      winners2,
      order2,
      bands,
      [],
      () => 0,
      built.slivers,
    );
    expect(describeHoles(cached)).toBe(describeHoles(reference));
  });

  it('a railW edit invalidates through inputSig', () => {
    const bands = grid(0);
    const { built, chain } = frame(bands, null);
    const winners = overrideAll(built.faces, ORDER);
    buildExclusionHolesCached(
      built.faces,
      winners,
      ORDER,
      bands,
      [],
      () => 0,
      built.slivers,
      chain,
    );
    const railW = (id: LineId): number => (id === 'hA' ? 2 : 0);
    const sameStateChain: HoleChain = { state: chain.state, prevState: null, dirtyBoxes: [] };
    const cached = buildExclusionHolesCached(
      built.faces,
      winners,
      ORDER,
      bands,
      [],
      railW,
      built.slivers,
      sameStateChain,
    );
    const reference = buildExclusionHoles(
      built.faces,
      winners,
      ORDER,
      bands,
      [],
      railW,
      built.slivers,
    );
    expect(describeHoles(cached)).toBe(describeHoles(reference));
  });

  it('a broken chain (undo served from the geometry LRU) flushes to a full rebuild', () => {
    const a = frame(grid(0), null);
    const wa = overrideAll(a.built.faces, ORDER);
    buildExclusionHolesCached(
      a.built.faces,
      wa,
      ORDER,
      grid(0),
      [],
      () => 0,
      a.built.slivers,
      a.chain,
    );
    const b = frame(grid(9), a.built.state);
    buildExclusionHolesCached(
      b.built.faces,
      overrideAll(b.built.faces, ORDER),
      ORDER,
      grid(9),
      [],
      () => 0,
      b.built.slivers,
      b.chain,
    );
    // "Undo": geometry A again, but served without an incremental run — the
    // chain references states the cache has never seen consecutively.
    const stats: HoleCacheStats = { reused: 0, recomputed: 0 };
    const brokenChain: HoleChain = { state: {}, prevState: {}, dirtyBoxes: [] };
    const cached = buildExclusionHolesCached(
      a.built.faces,
      wa,
      ORDER,
      grid(0),
      [],
      () => 0,
      a.built.slivers,
      brokenChain,
      stats,
    );
    const reference = buildExclusionHoles(
      a.built.faces,
      wa,
      ORDER,
      grid(0),
      [],
      () => 0,
      a.built.slivers,
    );
    expect(describeHoles(cached)).toBe(describeHoles(reference));
    expect(stats.reused).toBe(0); // the flush really flushed
    expect(stats.recomputed).toBeGreaterThan(0);
  });

  // Two tangent panes sharing one winner: the shield excludes same-winner
  // neighbors, so flipping ONE pane back to its default changes the OTHER
  // pane's shield (it gains the neighbor's rings) while that pane's own
  // geometry, winner, losers and slivers are all untouched. Only the
  // neighborhood signature can see it — this is the fixture that would catch
  // its loss.
  it('a neighbor pane flipping to default invalidates the adjacent pane via neighborSig', () => {
    // hA at y=0 and hB at y=14 are tangent (14-wide bodies meet at y=7); vA
    // crosses both, making two abutting panes {hA,vA} and {hB,vA}.
    const bands = [
      hBand('hA', 'a1|a2', 0, 100, 0),
      hBand('hB', 'b1|b2', 0, 100, 14),
      vBand('vA', 'c1|c2', -40, 60, 50),
    ];
    const order = ['hA', 'hB', 'vA'];
    const { built, chain } = frame(bands, null);
    expect(built.faces.length).toBe(2);
    // Both panes overridden to vA (defaults are hA / hB).
    const both = built.faces.map(() => ({ winner: 'vA' as LineId, assignmentId: 'r' }));
    buildExclusionHolesCached(built.faces, both, order, bands, [], () => 0, built.slivers, chain);
    // Flip the SECOND pane back to its default; same geometry, same state.
    const hbIdx = built.faces.findIndex((f) => f.lineIds.includes('hB'));
    const flipped = built.faces.map((_f, i) =>
      i === hbIdx
        ? { winner: 'hB' as LineId, assignmentId: null }
        : { winner: 'vA' as LineId, assignmentId: 'r' },
    );
    const sameStateChain: HoleChain = { state: chain.state, prevState: null, dirtyBoxes: [] };
    const stats: HoleCacheStats = { reused: 0, recomputed: 0 };
    const cached = buildExclusionHolesCached(
      built.faces,
      flipped,
      order,
      bands,
      [],
      () => 0,
      built.slivers,
      sameStateChain,
      stats,
    );
    const reference = buildExclusionHoles(
      built.faces,
      flipped,
      order,
      bands,
      [],
      () => 0,
      built.slivers,
    );
    expect(describeHoles(cached)).toBe(describeHoles(reference));
    // The flip must genuinely change the surviving pane's holes (the shield
    // it gains bites the dilation poke into the neighbor) — otherwise this
    // fixture is vacuous…
    const before = buildExclusionHoles(built.faces, both, order, bands, [], () => 0, built.slivers);
    expect(describeHoles(before)).not.toBe(describeHoles(reference));
    // …and the cache must have seen it: the surviving pane recomputed.
    expect(stats.recomputed).toBe(1);
  });

  // `neighborRail` clamps the shield's stand-down to the narrowest rail among
  // the lines covering a SHIELDING NEIGHBOR that paint above the winner — lines
  // that are in neither this face's cover nor its losers, so neither inputSig
  // (winner + losers) nor neighborSig (face key + winner) records their casing.
  // The geometry signature deliberately excludes casing too, so a casing edit
  // on such a line arrives as a same-state frame with no dirty boxes: only a
  // signature that carries those rails can see it.
  it('a casing edit on a SHIELDING neighbor-only line invalidates via neighborSig', () => {
    // vW and vA are the two adjacent stripes of one interlined band (bodies
    // meet at x=57); hB crosses both, so the overlap faces {hB,vW} and
    // {hB,vA} abut along that same edge — which is exactly where the winner's
    // rail annulus falls, so the stand-down really lands in the neighbour.
    const bands = [
      hBand('hB', 'b1|b2', -40, 120, 0),
      vBand('vW', 'w1|w2', -40, 60, 50),
      vBand('vA', 'a1|a2', -40, 60, 64),
    ];
    const order = ['vA', 'hB', 'vW'];
    const { built, chain } = frame(bands, null);
    expect(built.faces.length).toBe(2);
    // Only the vW pane is overridden (to vW, from its hB default); the vA pane
    // keeps its default and so becomes the shielding neighbor. vA covers it,
    // paints in front of vW and is NOT one of the vW pane's losers — exactly
    // the line that sets `neighborRail` and that no signature names.
    const wIdx = built.faces.findIndex((f) => f.lineIds.includes('vW'));
    const winners = built.faces.map((_f, i) =>
      i === wIdx
        ? { winner: 'vW' as LineId, assignmentId: 'r' }
        : { winner: 'vA' as LineId, assignmentId: null },
    );
    const railCased = (id: LineId): number => (id === 'vW' || id === 'vA' ? 2 : 0);
    const railBare = (id: LineId): number => (id === 'vW' ? 2 : 0);
    buildExclusionHolesCached(
      built.faces,
      winners,
      order,
      bands,
      [],
      railCased,
      built.slivers,
      chain,
    );
    // Drag hA's casing width to 0. Same geometry, same state, same winners,
    // same losers (hB, uncased either way) — only hA's rail moved.
    const sameStateChain: HoleChain = { state: chain.state, prevState: null, dirtyBoxes: [] };
    const stats: HoleCacheStats = { reused: 0, recomputed: 0 };
    const cached = buildExclusionHolesCached(
      built.faces,
      winners,
      order,
      bands,
      [],
      railBare,
      built.slivers,
      sameStateChain,
      stats,
    );
    const reference = buildExclusionHoles(
      built.faces,
      winners,
      order,
      bands,
      [],
      railBare,
      built.slivers,
    );
    expect(describeHoles(cached)).toBe(describeHoles(reference));
    // Non-vacuous: an UNCASED neighbour clamps the stand-down to nothing, so
    // the shield applies whole and the hole really is a different shape…
    const before = buildExclusionHoles(
      built.faces,
      winners,
      order,
      bands,
      [],
      railCased,
      built.slivers,
    );
    expect(describeHoles(before)).not.toBe(describeHoles(reference));
    // …and the cache must have seen it.
    expect(stats.recomputed).toBe(1);
  });

  // The absorb gate reads the lineOrder RANK of sliver lines that are NOT in
  // the face's cover (`s.lineIds.every(id => orderIdx(id) >= winnerRank ||
  // loserSet.has(id))`): a permutation that moves such a line across the
  // winner's rank flips the gate while the face's own winner/losers/default —
  // the whole inputSig — stay identical. Only a signature that records the
  // gate OUTCOMES can see it; this is the fixture that would catch its loss.
  it('a lineOrder flip through a NON-cover sliver line invalidates the absorb', () => {
    // Face covers {A,B}; sliver covers {B,C}; C is not in the face's cover.
    const face: RegionFace = {
      key: 'f0',
      lineIds: ['A', 'B'],
      face: [
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
        ],
      ],
      bbox: { x0: 0, y0: 0, x1: 10, y1: 10 },
      area: 100,
      spans: new Map(),
    };
    const sliver: RegionSliver = {
      lineIds: ['B', 'C'],
      face: [
        [
          { x: 10.2, y: 0 },
          { x: 11, y: 0 },
          { x: 11, y: 10 },
          { x: 10.2, y: 10 },
        ],
      ],
      bbox: { x0: 10.2, y0: 0, x1: 11, y1: 10 },
    };
    // B must be the face's winner (overridden; default is A) and its stripe
    // must run near the face so the footprint is non-empty.
    const bands = [hBand('A', 'a1|a2', -20, 30, 5), hBand('B', 'b1|b2', -20, 30, 5)];
    const winners = [{ winner: 'B' as LineId, assignmentId: 'r1' }];
    const run = (order: LineId[], chain: HoleChain, stats?: HoleCacheStats) => ({
      cached: buildExclusionHolesCached(
        [face],
        winners,
        order,
        bands,
        [],
        () => 0,
        [sliver],
        chain,
        stats,
      ),
      reference: buildExclusionHoles([face], winners, order, bands, [], () => 0, [sliver]),
    });
    const state = {};
    // Order 1: C ranks BELOW the winner B → gate fails (C is neither ≥ rank
    // nor a loser) → sliver not absorbed.
    const r1 = run(['A', 'C', 'B'], { state, prevState: null, dirtyBoxes: [] });
    expect(describeHoles(r1.cached)).toBe(describeHoles(r1.reference));
    // Order 2: C ranks ABOVE (after) the winner → gate passes → absorbed.
    // Face cover, winner, losers, default are IDENTICAL across the two
    // orders; only the sliver-gate outcome differs.
    const stats: HoleCacheStats = { reused: 0, recomputed: 0 };
    const r2 = run(['A', 'B', 'C'], { state, prevState: null, dirtyBoxes: [] }, stats);
    expect(describeHoles(r2.cached)).toBe(describeHoles(r2.reference));
    // The two orders must genuinely produce different holes (the fixture
    // would be vacuous otherwise) and the cache must have recomputed.
    expect(describeHoles(r1.reference)).not.toBe(describeHoles(r2.reference));
    expect(stats.recomputed).toBe(1);
    expect(stats.reused).toBe(0);
  });
});
