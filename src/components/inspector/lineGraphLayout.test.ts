import { describe, it, expect } from 'vitest';
import { lineGraphLayout } from './lineGraphLayout';
import { makeLine } from '../../test/fixtures';

const posByStation = (nodes: ReturnType<typeof lineGraphLayout>['nodes']) => {
  const m: Record<string, { row: number; lane: number }> = {};
  for (const n of nodes) m[n.stationId] = { row: n.row, lane: n.lane };
  return m;
};

describe('lineGraphLayout', () => {
  it('lays a linear line out as a single lane, top to bottom', () => {
    const layout = lineGraphLayout(makeLine({ id: 'L1', stations: ['s1', 's2', 's3'] }));
    expect(layout.laneCount).toBe(1);
    expect(posByStation(layout.nodes)).toEqual({
      s1: { row: 0, lane: 0 },
      s2: { row: 1, lane: 0 },
      s3: { row: 2, lane: 0 },
    });
    expect(layout.edges.every((e) => e.kind === 'tree')).toBe(true);
  });

  it('splits a branch: the trunk stays in lane 0, the branch runs alongside in lane 1', () => {
    // Trunk s1-s2-J; branches J-s3 and J-s4.
    const layout = lineGraphLayout(
      makeLine({
        id: 'L1',
        stations: ['s1', 's2', 'J', 's3', 's4'],
        edges: ['s1|s2', 's2|J', 'J|s3', 'J|s4'],
      }),
    );
    const pos = posByStation(layout.nodes);
    // Trunk + first branch continue down lane 0; the second branch takes lane 1.
    expect(pos.s1.lane).toBe(0);
    expect(pos.J.lane).toBe(0);
    expect(pos.s3.lane).toBe(0);
    expect(pos.s4.lane).toBe(1);
    expect(layout.laneCount).toBe(2);
    // The J→s4 edge crosses from the junction's lane to lane 1, running down
    // alongside the trunk to s4's row.
    const branch = layout.edges.find((e) => e.pairKey === 'J|s4')!;
    expect(branch.kind).toBe('tree');
    expect(branch.fromLane).toBe(0);
    expect(branch.toLane).toBe(1);
    expect(branch.fromRow).toBe(pos.J.row);
    expect(branch.toRow).toBe(pos.s4.row);
    expect(branch.toRow).toBeGreaterThan(pos.s3.row); // runs past s3
  });

  it('reserves a blank T-junction row one cell below a branch point', () => {
    const layout = lineGraphLayout(
      makeLine({
        id: 'L1',
        stations: ['s1', 's2', 'J', 's3', 's4'],
        edges: ['s1|s2', 's2|J', 'J|s3', 'J|s4'],
      }),
    );
    const pos = posByStation(layout.nodes);
    // The junction leaves a blank grid row, so there are more rows than stops.
    expect(layout.rowCount).toBe(layout.nodes.length + 1);
    // The branch tees off in that blank row — one cell below the junction — and
    // the first (trunk-continuing) child sits one cell below the blank row.
    const branch = layout.edges.find((e) => e.pairKey === 'J|s4')!;
    expect(branch.teeRow).toBe(pos.J.row + 1);
    expect(pos.s3.row).toBe(pos.J.row + 2);
    // The trunk-continuing child's edge is a plain vertical (no tee).
    expect(layout.edges.find((e) => e.pairKey === 'J|s3')!.teeRow).toBeUndefined();
  });

  it('reserves no blank row for a linear line, but one below each loop endpoint', () => {
    const linear = lineGraphLayout(makeLine({ id: 'L1', stations: ['s1', 's2', 's3'] }));
    expect(linear.rowCount).toBe(linear.nodes.length);
    const ring = lineGraphLayout(
      makeLine({ id: 'L2', stations: ['s1', 's2', 's3'], edges: ['s1|s2', 's2|s3', 's1|s3'] }),
    );
    // A ring's root has only ONE tree child (the wrap is a back-edge), so it is
    // not a branch point — but the loop DOES reserve a blank row below each of
    // its two endpoints (where its horizontals sit, below the stops).
    expect(ring.rowCount).toBe(ring.nodes.length + 2);
  });

  it('routes a loop through the blank rows below its endpoints', () => {
    // Ring s1-s2-s3-s1.
    const layout = lineGraphLayout(
      makeLine({ id: 'L1', stations: ['s1', 's2', 's3'], edges: ['s1|s2', 's2|s3', 's1|s3'] }),
    );
    const pos = posByStation(layout.nodes);
    // The three stops stack in one lane, with a blank row below s1 and below s3.
    expect(pos.s1).toEqual({ row: 0, lane: 0 });
    expect(pos.s2).toEqual({ row: 2, lane: 0 });
    expect(pos.s3).toEqual({ row: 3, lane: 0 });
    // The closing edge tees off below s1 and rejoins below s3, out in a side lane.
    const loop = layout.edges.find((e) => e.kind === 'loop')!;
    expect(loop.pairKey).toBe('s1|s3');
    expect(loop.fromRow).toBe(0); // s1 (upper)
    expect(loop.toRow).toBe(3); // s3 (lower)
    expect(loop.upperBlank).toBe(1); // blank row below s1
    expect(loop.lowerBlank).toBe(4); // blank row below s3
    expect(loop.sideLane).toBeGreaterThanOrEqual(1);
    expect(layout.laneCount).toBeGreaterThanOrEqual(2);
  });

  it('handles a disconnected member (degree 0) without crashing', () => {
    const layout = lineGraphLayout(
      makeLine({ id: 'L1', stations: ['s1', 's2', 's3'], edges: ['s1|s2'] }),
    );
    // s3 has no edge; it still gets its own row.
    expect(layout.nodes).toHaveLength(3);
    expect(posByStation(layout.nodes).s3.lane).toBe(0);
  });
});
