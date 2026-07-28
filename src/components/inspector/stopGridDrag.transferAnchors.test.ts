import { describe, it, expect } from 'vitest';
import {
  anchorBlockerNodes,
  computeGhosts,
  otherLayoutNodes,
  sourceCellOf,
  spawnAnchorCell,
  stationLayoutNodes,
  GRID_RADIUS,
} from './stopGridDrag';
import { STOP_SIZE } from '../../geometry/orientation';
import { makeLine, makeStation, makeStop } from '../../test/fixtures';
import type { Line, Station } from '../../model/types';

// Hosted transfer anchors ride the station lattice as PASSENGERS: they never
// enter stationLayoutNodes (whose node identity is `lineId: string | null`,
// where null already means "the label"), but they do block slots, and they
// drag on the label's exact parameters.

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

  it('is deterministic', () => {
    expect(spawnAnchorCell(station(), lines)).toEqual(spawnAnchorCell(station(), lines));
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
