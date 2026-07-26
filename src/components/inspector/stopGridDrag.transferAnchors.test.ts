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
    // indistinguishable), and anchorPool filters on isLabel (an anchor without
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
      { row: 0, col: 2, w: STOP_SIZE, isLabel: true, lineId: null },
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
