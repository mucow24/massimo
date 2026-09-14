import { describe, it, expect } from 'vitest';
import {
  anchorBlockerNodes,
  computeGhosts,
  dragLattice,
  ghostSourceParams,
  nudgeTarget,
  otherLayoutNodes,
  sameCell,
  sourceCellOf,
  spawnAnchorCell,
  stationLayoutNodes,
  GRID_RADIUS,
  type WidthNode,
} from './stopGridDrag';
import { STOP_SIZE } from '../../geometry/orientation';
import { makeLine, makeStation, makeStop } from '../../test/fixtures';
import type { Line, Station } from '../../model/types';

// Hosted transfer anchors ride the station lattice as PASSENGERS: they never
// enter stationLayoutNodes (whose node identity is `lineId: string | null`,
// where null already means "the label"), but they do block slots, and they
// drag body-less like the label — on the projection node's own pitch.

const lines: Record<string, Line> = { l1: makeLine({ id: 'l1' }) };
const station = (anchors: { id: string; row: number; col: number }[] = []): Station =>
  makeStation({
    id: 's1',
    stops: [makeStop('l1', { row: 0, col: 0 })],
    transferAnchors: anchors.length ? anchors : undefined,
  });

describe('hosted anchors and the layout lattice', () => {
  it('never appear in stationLayoutNodes', () => {
    // Two independent reasons this MUST hold: otherLayoutNodes discriminates
    // the label purely as `lineId === null` (an anchor node would be
    // indistinguishable), and anchorPool filters on isPoint (an anchor without
    // it would become a lattice ORIGIN, producing the incommensurate-pitch
    // kink anchorPool exists to forbid).
    const nodes = stationLayoutNodes(station([{ id: 'a1', row: 2, col: 0 }]), lines);
    expect(nodes).toHaveLength(2); // the stop + the label, and nothing else
    expect(nodes.filter((n) => n.lineId === null)).toHaveLength(1); // just the label
  });

  it('keeps every node available when the ANCHOR is the drag source', () => {
    // A stop drag strips its own node and a label drag strips the label; an
    // anchor is not in the list at all, so nothing needs stripping — every stop
    // AND the label stay available as lattice anchors and blockers.
    const st = station([{ id: 'a1', row: 2, col: 0 }]);
    const all = stationLayoutNodes(st, lines);
    expect(otherLayoutNodes(all, { kind: 'anchor', anchorId: 'a1' })).toHaveLength(all.length);
  });

  it('resolves its own cell through sourceCellOf', () => {
    const st = station([{ id: 'a1', row: 2, col: -1 }]);
    expect(sourceCellOf(st, { kind: 'anchor', anchorId: 'a1' })).toEqual({ row: 2, col: -1 });
    expect(sourceCellOf(st, { kind: 'anchor', anchorId: 'gone' })).toBeNull();
  });

  it('blocks a slot without being a lattice node', () => {
    // The cost of staying out of stationLayoutNodes would be zero repulsion —
    // a stop could be dropped straight on top of an anchor. anchorBlockerNodes
    // buys the repulsion back without the node identity.
    const st = station([{ id: 'a1', row: 0, col: 1 }]);
    const nodes = stationLayoutNodes(st, lines);
    const anchorNode = nodes.find((n) => n.lineId === 'l1')!;
    const withBlockers = computeGhosts({
      wSrc: STOP_SIZE,
      anchor: anchorNode,
      otherNodes: [...nodes, ...anchorBlockerNodes(st)],
      basis: 'orthogonal',
      stationRotation: 0,
      gridRadius: GRID_RADIUS,
    });
    const without = computeGhosts({
      wSrc: STOP_SIZE,
      anchor: anchorNode,
      otherNodes: nodes,
      basis: 'orthogonal',
      stationRotation: 0,
      gridRadius: GRID_RADIUS,
    });
    expect(withBlockers.length).toBeLessThan(without.length);
  });

  it('excludes the dragged anchor from its own blocker list', () => {
    const st = station([
      { id: 'a1', row: 0, col: 1 },
      { id: 'a2', row: 0, col: 2 },
    ]);
    expect(anchorBlockerNodes(st, 'a1')).toEqual([
      { row: 0, col: 2, w: STOP_SIZE, isPoint: true, lineId: null },
    ]);
  });
});

describe('spawnAnchorCell', () => {
  it('lands on a free lattice slot, not on the stop or the label', () => {
    const st = station();
    const [row, col] = spawnAnchorCell(st, lines);
    expect([row, col]).not.toEqual([0, 0]); // the stop
    expect([row, col]).not.toEqual([st.label.row, st.label.col]);
  });

  it('spawns directly adjacent to a station node, not in the grid corner', () => {
    // A new anchor must read as part of the station at a glance. Spawning at
    // the lattice's far corner (the old row-then-col sort picked (-2,-2)) made
    // it look like a stray map object two cells off in space — see the DKLB
    // ghost-anchor incident.
    const st = station();
    const [row, col] = spawnAnchorCell(st, lines);
    const nodes = [
      { row: 0, col: 0 },
      { row: st.label.row, col: st.label.col },
    ];
    const nearest = Math.min(...nodes.map((n) => Math.hypot(row - n.row, col - n.col)));
    expect(nearest).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('walks outward instead of stacking anchors on one cell', () => {
    const st = station();
    const first = spawnAnchorCell(st, lines);
    const second = spawnAnchorCell(station([{ id: 'a1', row: first[0], col: first[1] }]), lines);
    expect(second).not.toEqual(first);
  });

  it('picks ONE fixed slot, not merely some equally-near one', () => {
    // A stop at (0,0) with its label at (0,-1) leaves SIX free slots exactly one
    // cell from a node, and the two tests above are satisfied by any of them.
    // Which one you get is a product decision, not an accident: the same station
    // must grow its anchor in the same place every time, or a map re-opened
    // after an unrelated change sprouts anchors somewhere new. Pinned as the
    // concrete cell — the lowest (row, col) of the tied set — because a change
    // in the sort keys OR in the lattice walk's emission order would otherwise
    // move every newly spawned anchor with nothing going red.
    expect(spawnAnchorCell(station(), lines)).toEqual([-1, -1]);
  });
});

describe('a point source cannot stack on a body-less node', () => {
  // A point source (a hosted anchor, or the label) has no ink, so against
  // another body-less node (the label, or another anchor) plain geometry gives
  // zero clearance and they could occupy the SAME cell — the elbow anchor
  // vanishing under the label. computeGhosts must reject that coincidence.
  it('excludes a slot already held by the label/another anchor', () => {
    const anchor = { row: 0, col: 0, w: STOP_SIZE };
    const common = {
      wSrc: STOP_SIZE,
      srcIsPoint: true,
      anchor,
      basis: 'orthogonal' as const,
      stationRotation: 0 as const,
      gridRadius: GRID_RADIUS,
    };
    // A valid point-source slot when only the origin stop is present.
    const free = computeGhosts({ ...common, otherNodes: [anchor] });
    const target = free.find((g) => g.row !== 0 || g.col !== 0);
    expect(target).toBeDefined();
    // Park a body-less node (the label, or a hosted anchor) exactly there.
    const pointNode = { row: target!.row, col: target!.col, w: STOP_SIZE, isPoint: true };
    const blocked = computeGhosts({ ...common, otherNodes: [anchor, pointNode] });
    const stillThere = blocked.some(
      (g) => Math.abs(g.row - target!.row) < 1e-9 && Math.abs(g.col - target!.col) < 1e-9,
    );
    expect(stillThere).toBe(false);
  });

  it('leaves a body (stop) source unaffected — it still tangents the label', () => {
    // Regression guard: the fix only tightens POINT sources. For a stop source
    // the label still reads as width 0, so the label's own cell is excluded by
    // the SAME half-cell clearance as before and the adjacent slots survive.
    const anchor = { row: 0, col: 0, w: STOP_SIZE };
    const label = { row: 0, col: 1, w: STOP_SIZE, isPoint: true };
    const ghosts = computeGhosts({
      wSrc: STOP_SIZE,
      srcIsPoint: false,
      anchor,
      otherNodes: [anchor, label],
      basis: 'orthogonal' as const,
      stationRotation: 0 as const,
      gridRadius: GRID_RADIUS,
    });
    const onLabel = ghosts.some((g) => Math.abs(g.row) < 1e-9 && Math.abs(g.col - 1) < 1e-9);
    const opposite = ghosts.some((g) => Math.abs(g.row) < 1e-9 && Math.abs(g.col + 1) < 1e-9);
    expect(onLabel).toBe(false); // the label's cell stays blocked
    expect(opposite).toBe(true); // the slot away from the label survives
  });
});

// A hosted anchor is body-less like the label, but it has no pitch of its own:
// it takes the projection node's — the spacing that stop's line packs at — so
// it sits on the same grid as the stops around it. The label's tangency pitch
// ((STOP_SIZE + w)/2) is incommensurate with a thin line's w: an anchor 45°
// off one width-6 stop could never also sit level with the next, so no
// transfer through it could turn a clean corner.
describe('a hosted anchor takes the projection node’s own pitch', () => {
  const thin: WidthNode = { row: 0, col: 0, w: 6 };
  const ANCHOR_SRC = ghostSourceParams({ kind: 'anchor' }, {});
  const common = {
    basis: 'orthogonal' as const,
    stationRotation: 0 as const,
    gridRadius: GRID_RADIUS,
  };

  it('ring 1 sits one stop-pitch out, not at the label’s tangency', () => {
    const ghosts = computeGhosts({ ...ANCHOR_SRC, ...common, anchor: thin, otherNodes: [thin] });
    expect(ghosts.some((g) => sameCell(g, { row: 0, col: 6 / 14 }))).toBe(true);
    expect(ghosts.some((g) => sameCell(g, { row: 0, col: 10 / 14 }))).toBe(false);
    // The label keeps its tangency pitch — the rule is the anchor's alone.
    const label = computeGhosts({
      ...ghostSourceParams({ kind: 'label' }, {}),
      ...common,
      anchor: thin,
      otherNodes: [thin],
    });
    expect(label.some((g) => sameCell(g, { row: 0, col: 10 / 14 }))).toBe(true);
  });

  it('includes the node’s interline gap — the packed pitch its line uses', () => {
    // tangentGap(6, 6, 4, 4) = 10; the label's pair pitch would be (14+6)/2 + 4 = 14.
    const gapped: WidthNode = { row: 0, col: 0, w: 6, g: 4 };
    const ghosts = computeGhosts({
      ...ANCHOR_SRC,
      ...common,
      anchor: gapped,
      otherNodes: [gapped],
    });
    expect(ghosts.some((g) => sameCell(g, { row: 0, col: 10 / 14 }))).toBe(true);
    expect(ghosts.some((g) => sameCell(g, { row: 0, col: 1 }))).toBe(false);
  });

  it('lets a transfer turn a clean corner between two thin stops (drag)', () => {
    // Two width-6 stops packed at their own pitch. The slot level with A and
    // on R's 45° — (0, 6/14) — is where a 90°+45° elbow needs the anchor. It
    // is A's ring-1 cardinal on the stop pitch; on the label's pitch A's ring
    // 1 sat at 10/14 and the cell did not exist.
    const A: WidthNode = { row: 0, col: 0, w: 6 };
    const R: WidthNode = { row: 6 / 14, col: 0, w: 6 };
    const { ghosts } = dragLattice({
      cursor: { row: 0, col: 6 / 14 },
      ...ANCHOR_SRC,
      otherNodes: [A, R],
      basis: 'orthogonal',
      stationRotation: 0,
    });
    expect(ghosts.some((g) => sameCell(g, { row: 0, col: 6 / 14 }))).toBe(true);
  });

  it('a keyboard nudge hops on the same grid', () => {
    // Down from one cell above a thin stop: the nearest thin-grid slot in that
    // direction is -12/14 (the label's pitch would have offered -10/14).
    const target = nudgeTarget({
      source: { row: -1, col: 0 },
      ...ANCHOR_SRC,
      otherNodes: [thin],
      basis: 'orthogonal',
      stationRotation: 0,
      arrow: { row: 1, col: 0 },
    });
    expect(target && sameCell(target, { row: -12 / 14, col: 0 })).toBe(true);
  });

  it('spawnAnchorCell lands on the thin stop’s grid', () => {
    // The same tie-break the default case pins — the lowest (row, col) of the
    // ring-1 cardinals — now one stop-pitch out.
    const thinLines = { t: makeLine({ id: 't', width: 6 }) };
    const st = makeStation({ id: 's1', stops: [makeStop('t', { row: 0, col: 0 })] });
    const [row, col] = spawnAnchorCell(st, thinLines);
    expect(sameCell({ row, col }, { row: -6 / 14, col: 0 })).toBe(true);
  });
});

describe('ghostSourceParams', () => {
  it('a stop carries its line’s width and gap; the label and an anchor are unit-width points', () => {
    const l = { l1: makeLine({ id: 'l1', width: 6, interlineGap: 4 }) };
    expect(ghostSourceParams({ kind: 'stop', lineId: 'l1' }, l)).toEqual({ wSrc: 6, gSrc: 4 });
    expect(ghostSourceParams({ kind: 'label' }, l)).toEqual({
      wSrc: STOP_SIZE,
      gSrc: 0,
      srcIsPoint: true,
    });
    expect(ghostSourceParams({ kind: 'anchor' }, l)).toEqual({
      wSrc: STOP_SIZE,
      gSrc: 0,
      srcIsPoint: true,
      srcOnAnchorPitch: true,
    });
  });
});
