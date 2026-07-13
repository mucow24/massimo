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
    // not a branch point — but the loop still reserves two blank rows: one ABOVE
    // its top endpoint (the arc comes over the top) and one BELOW the other.
    expect(ring.rowCount).toBe(ring.nodes.length + 2);
  });

  it('routes a loop-to-the-top over the top of the first stop', () => {
    // Ring s1-s2-s3-s1. The closing edge returns to s1, which is the TOP stop
    // (a root, nothing above it), so it re-enters from ABOVE — a blank row is
    // reserved above s1 and the arc loops over it. A loop-to-the-top should read
    // as a loop, not a trumpet teeing off below the first stop.
    const layout = lineGraphLayout(
      makeLine({ id: 'L1', stations: ['s1', 's2', 's3'], edges: ['s1|s2', 's2|s3', 's1|s3'] }),
    );
    const pos = posByStation(layout.nodes);
    // The three stops stack in one lane; s1 is pushed to row 1 by the blank above.
    expect(pos.s1).toEqual({ row: 1, lane: 0 });
    expect(pos.s2).toEqual({ row: 2, lane: 0 });
    expect(pos.s3).toEqual({ row: 3, lane: 0 });
    const loop = layout.edges.find((e) => e.kind === 'loop')!;
    expect(loop.pairKey).toBe('s1|s3');
    expect(loop.fromRow).toBe(1); // s1 (upper)
    expect(loop.toRow).toBe(3); // s3 (lower)
    // The upper blank is ABOVE s1 (arc comes over the top); the lower tees below s3.
    expect(loop.upperBlank).toBe(0);
    expect(loop.upperBlank!).toBeLessThan(loop.fromRow);
    expect(loop.lowerBlank).toBe(4); // blank row below s3
    expect(loop.sideLane).toBeGreaterThanOrEqual(1);
    expect(layout.laneCount).toBeGreaterThanOrEqual(2);
  });

  it('draws a lasso junction INSIDE its loop (over the top), not stranded above it', () => {
    // The reported case: a tail A6–A5–A4–A3 meeting a 5-cycle A3–A2–A1–B2–B1(–A3)
    // at the junction A3. The longest chain A6…B1 threads the whole cycle into
    // lane 0; the cycle closes with the A3–B1 back-edge, whose upper endpoint is
    // A3. A3 is a genuine cycle member, so the loop must arc OVER A3's top (a blank
    // ABOVE it, between the tail A4 and A3) — putting A3 inside the loop — rather
    // than tee off below A3 (which strands A3 above/outside its own loop and reads
    // as a phantom split between A2 and A3).
    const layout = lineGraphLayout(
      makeLine({
        id: 'L1',
        stations: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'B1', 'B2'],
        edges: ['A1|A2', 'A2|A3', 'A3|A4', 'A4|A5', 'A5|A6', 'A3|B1', 'B1|B2', 'B2|A1'],
      }),
    );
    const pos = posByStation(layout.nodes);
    // Every stop threads into the trunk lane; the loop costs a side lane, not a column.
    expect(Math.max(...layout.nodes.map((n) => n.lane))).toBe(0);
    const loop = layout.edges.filter((e) => e.kind === 'loop');
    expect(loop).toHaveLength(1);
    expect(loop[0].pairKey).toBe('A3|B1');
    // The loop's upper endpoint is A3, and it arcs over A3's TOP: the reserved
    // blank sits ABOVE A3 (between the tail A4 and A3), so A3 is inside the loop.
    expect(loop[0].fromRow).toBe(pos.A3.row);
    expect(loop[0].upperBlank).toBeLessThan(pos.A3.row); // over the top of A3
    expect(pos.A4.row).toBeLessThan(loop[0].upperBlank!); // the tail A4 stays OUTSIDE the loop
    // No phantom split between A2 and A3: the trunk runs straight through them.
    expect(pos.A2.row).toBe(pos.A3.row + 1);
  });

  it('handles a disconnected member (degree 0) without crashing', () => {
    const layout = lineGraphLayout(
      makeLine({ id: 'L1', stations: ['s1', 's2', 's3'], edges: ['s1|s2'] }),
    );
    // s3 has no edge; it still gets its own row.
    expect(layout.nodes).toHaveLength(3);
    expect(posByStation(layout.nodes).s3.lane).toBe(0);
  });

  it('threads the trunk through a loop to save a column (longest-path walk)', () => {
    // Trunk T–A; a 4-cycle A–X–Y–C with a short chord A–C; two dead-end branches
    // C–E, C–F. Display order lists the junction C BEFORE the loop internals
    // X, Y (as when the junction is drawn first) — so the old first-child walk
    // took the short chord and spilled the loop into its own column. The longest
    // path T–A–X–Y–C–E threads the loop's long arc into the trunk: X and Y sit
    // in lane 0, the cycle closes with the short A–C arc, and only ONE branch
    // column (for F) is left instead of two.
    const layout = lineGraphLayout(
      makeLine({
        id: 'L1',
        stations: ['T', 'A', 'C', 'X', 'Y', 'E', 'F'],
        edges: ['A|T', 'A|C', 'A|X', 'X|Y', 'C|Y', 'C|E', 'C|F'],
      }),
    );
    const pos = posByStation(layout.nodes);
    // Loop internals threaded into the trunk lane.
    expect(pos.X.lane).toBe(0);
    expect(pos.Y.lane).toBe(0);
    // The trunk continues into one branch (E); only F needs a second column.
    expect(pos.E.lane).toBe(0);
    expect(Math.max(...layout.nodes.map((n) => n.lane))).toBe(1);
    // The cycle closes with the SHORT chord A–C, not one of the long-arc edges.
    expect(layout.edges.find((e) => e.kind === 'loop')!.pairKey).toBe('A|C');
  });

  it('lays the real branch+loop line out in two columns, not three', () => {
    // The actual "B" line: a trunk up→…→fr, a 4-cycle fr–cv–pe–tk (Finchley,
    // Castro, Prince Edward, Tiu Keng Leng), and two dead-end branches off cv
    // (Hanger→…→Kennedy and Alperton→…→West Harrow). Display order lists cv
    // before the loop internals, so the old walk used three stop-columns; the
    // longest chain (up→…→fr→tk→pe→cv→hl→…→kt) threads the loop into the trunk,
    // leaving only the Alperton branch in a second column.
    const layout = lineGraphLayout(
      makeLine({
        id: 'L1',
        stations: [
          'up',
          'sl',
          'bp',
          'eb',
          'pb',
          'fr',
          'cv',
          'hl',
          'ep',
          'kb',
          'kt',
          'pe',
          'tk',
          'al',
          'oa',
          'wh', // prettier-ignore
        ],
        edges: [
          'sl|up',
          'bp|sl',
          'bp|eb',
          'eb|pb',
          'fr|pb',
          'cv|fr',
          'cv|hl',
          'ep|hl',
          'ep|kb',
          'kb|kt', // prettier-ignore
          'cv|pe',
          'pe|tk',
          'fr|tk',
          'al|cv',
          'al|oa',
          'oa|wh', // prettier-ignore
        ],
      }),
    );
    const pos = posByStation(layout.nodes);
    // Loop internals (Tiu, Prince) threaded into the trunk lane.
    expect(pos.tk.lane).toBe(0);
    expect(pos.pe.lane).toBe(0);
    // Only the Alperton chain needs a second column.
    expect(Math.max(...layout.nodes.map((n) => n.lane))).toBe(1);
    expect(pos.al.lane).toBe(1);
  });
});
