import { describe, it, expect } from 'vitest';
import { lineGraphLayout, branchableStops } from './lineGraphLayout';
import { edgeEndpoints } from '../../model/lineTopology';
import { makeLine } from '../../test/fixtures';
import type { Line } from '../../model/types';

const posByStation = (nodes: ReturnType<typeof lineGraphLayout>['nodes']) => {
  const m: Record<string, { row: number; lane: number }> = {};
  for (const n of nodes) m[n.stationId] = { row: n.row, lane: n.lane };
  return m;
};

// Station ids top-to-bottom, in row order — how the stop list reads.
const readingOrder = (layout: ReturnType<typeof lineGraphLayout>) =>
  [...layout.nodes].sort((a, b) => a.row - b.row).map((n) => n.stationId);

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

  it('splits a branch: the branch hugs its junction, the trunk resumes below', () => {
    // Trunk s1-s2-J; branches J-s3 and J-s4. The display-first arm (s3)
    // continues the trunk in lane 0; the other arm (s4) tees into lane 1 and
    // its stops sit DIRECTLY under the junction, before the trunk resumes.
    const layout = lineGraphLayout(
      makeLine({
        id: 'L1',
        stations: ['s1', 's2', 'J', 's3', 's4'],
        edges: ['s1|s2', 's2|J', 'J|s3', 'J|s4'],
      }),
    );
    const pos = posByStation(layout.nodes);
    expect(pos.s1.lane).toBe(0);
    expect(pos.J.lane).toBe(0);
    expect(pos.s3.lane).toBe(0);
    expect(pos.s4.lane).toBe(1);
    expect(layout.laneCount).toBe(2);
    // The J→s4 edge crosses from the junction's lane to lane 1 and reaches s4
    // in the rows right below the junction — not after the whole trunk.
    const branch = layout.edges.find((e) => e.pairKey === 'J|s4')!;
    expect(branch.kind).toBe('tree');
    expect(branch.fromLane).toBe(0);
    expect(branch.toLane).toBe(1);
    expect(branch.fromRow).toBe(pos.J.row);
    expect(branch.toRow).toBe(pos.s4.row);
    expect(branch.toRow).toBeLessThan(pos.s3.row); // junction-local, s3 resumes below
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
    // The branch tees off in that blank row — one cell below the junction —
    // and the branch stop sits one cell below the blank row; the trunk child
    // resumes after the branch.
    const branch = layout.edges.find((e) => e.pairKey === 'J|s4')!;
    expect(branch.teeRow).toBe(pos.J.row + 1);
    expect(pos.s4.row).toBe(pos.J.row + 2);
    expect(pos.s3.row).toBe(pos.s4.row + 1);
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
    // as a loop, not a trumpet teeing off below the first stop. (The bypass-cap
    // trim never fires on a pure ring: the fold-back target is the trunk start,
    // so the ring keeps threading inline in drawn order.)
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
    // A tail A6–A5–A4–A3 meeting a 5-cycle A3–A2–A1–B2–B1(–A3) at the junction
    // A3. The trunk threads the whole cycle into lane 0; the cycle closes with
    // the A3–B1 back-edge, whose upper endpoint is A3. A3 is a genuine cycle
    // member, so the loop must arc OVER A3's top (a blank ABOVE it, between the
    // tail A4 and A3) — putting A3 inside the loop — rather than tee off below
    // A3 (which strands A3 above/outside its own loop and reads as a phantom
    // split between A2 and A3). The bypass-cap trim doesn't touch this shape:
    // the folded-back tail is three stations, not a singleton.
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

  it('threads the trunk through a loop to save a column', () => {
    // Trunk T–A; a 4-cycle A–X–Y–C with a short chord A–C; two dead-end branches
    // C–E, C–F. Display order lists the junction C BEFORE the loop internals
    // X, Y (as when the junction is drawn first). The trunk — the longest chain
    // from the display-first terminus T — threads the loop's long arc: X and Y
    // sit in lane 0, the cycle closes with the short A–C arc, and only ONE
    // branch column (for F) is needed.
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
    // (Hanger→…→Kennedy and Alperton→…→West Harrow). The trunk from the
    // display-first terminus (up) threads the loop into lane 0, leaving only
    // the Alperton branch in a second column.
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

// The three real maps this layout was tuned against (Jul 2026): a branching
// line, a loop with branches and a bypass, and the simple loop whose tree was
// already good and is pinned exactly.
describe('lineGraphLayout real fixtures', () => {
  const ORANGE = makeLine({
    id: 'orange',
    stations: [
      'ChiswickPk',
      'Hillingdon',
      'Embankment',
      'WFinchley',
      'OceanPark',
      'NorthActon',
      'Austin',
      'Millbrae',
      'Fanling',
      'PleasantHl',
      'StJamesPk',
      'Moorgate',
      'Upney',
      'Fairlop',
      'RuislipGdn', // prettier-ignore
    ],
    edges: [
      'ChiswickPk|Hillingdon',
      'Embankment|Hillingdon',
      'Embankment|WFinchley',
      'OceanPark|WFinchley',
      'NorthActon|OceanPark',
      'Austin|NorthActon',
      'Austin|Millbrae',
      'Fanling|Millbrae',
      'NorthActon|PleasantHl',
      'PleasantHl|StJamesPk',
      'Moorgate|StJamesPk',
      'Embankment|Upney',
      'Fairlop|Upney',
      'Fairlop|RuislipGdn',
    ],
  });

  const BLUE = makeLine({
    id: 'blue',
    stations: ['L3', 'L4', 'A1', 'A2', 'A3', 'L1', 'L2', 'B1', 'B2', 'B3', 'B2a'],
    edges: [
      'A1|L4',
      'A1|A2',
      'A2|A3',
      'L1|L4',
      'L1|L2',
      'L2|L3',
      'B1|L2',
      'B1|B2',
      'B2|B3',
      'B2|B2a',
      'B2a|B3',
      'L3|L4',
    ],
  });

  const GREEN = makeLine({
    id: 'green',
    stations: ['L1', 'L4', 'B1', 'B2', 'B3', 'L3', 'L2', 'C1', 'C2', 'C3'],
    edges: [
      'B1|L4',
      'B1|B2',
      'B2|B3',
      'L3|L4',
      'L2|L3',
      'L1|L2',
      'C1|L3',
      'C1|C2',
      'C2|C3',
      'L1|L4',
    ],
  });

  it('ORANGE: trunk reads in drawn order, branches sit at their junctions, 2 lanes', () => {
    const layout = lineGraphLayout(ORANGE);
    // The stop list reads the drawn mainline Chiswick Park → Fanling, with each
    // branch inserted right after its junction.
    expect(readingOrder(layout)).toEqual([
      'ChiswickPk',
      'Hillingdon',
      'Embankment',
      'Upney',
      'Fairlop',
      'RuislipGdn',
      'WFinchley',
      'OceanPark',
      'NorthActon',
      'PleasantHl',
      'StJamesPk',
      'Moorgate',
      'Austin',
      'Millbrae',
      'Fanling', // prettier-ignore
    ]);
    const pos = posByStation(layout.nodes);
    for (const branch of ['Upney', 'Fairlop', 'RuislipGdn', 'PleasantHl', 'StJamesPk', 'Moorgate'])
      expect(pos[branch].lane).toBe(1); // the second branch REUSES lane 1
    expect(layout.laneCount).toBe(2);
    expect(layout.rowCount).toBe(17); // 15 stops + one tee row per junction
  });

  it('BLUE: the loop reads as parallel arms rejoining, the bypass sits between its neighbors', () => {
    const layout = lineGraphLayout(BLUE);
    expect(readingOrder(layout)).toEqual([
      'A3',
      'A2',
      'A1',
      'L4',
      'L1',
      'L3',
      'L2',
      'B1',
      'B2',
      'B2a',
      'B3', // prettier-ignore
    ]);
    const pos = posByStation(layout.nodes);
    // The big loop: L4 splits into two arms — L1 (lane 1) parallel to L3
    // (lane 0) — which rejoin at L2 as a merge, like the map's ring.
    expect(pos.L1.lane).toBe(1);
    expect(pos.L3.lane).toBe(0);
    const rejoin = layout.edges.find((e) => e.pairKey === 'L1|L2')!;
    expect(rejoin.kind).toBe('merge');
    expect(rejoin.jogRow).toBe(pos.L2.row - 1); // jogs across just above L2
    // The bypass: B2a sits BETWEEN B2 and B3 as a singleton side arm (bypass-cap
    // trim), merging back into B3 — not folded onto the end of the trunk.
    expect(pos.B2a.lane).toBe(1);
    expect(layout.edges.find((e) => e.pairKey === 'B2a|B3')!.kind).toBe('merge');
    expect(layout.edges.find((e) => e.pairKey === 'B2|B3')!.teeRow).toBeUndefined();
    // No diagram-spanning arc brackets remain, and the whole line fits 2 lanes.
    expect(layout.edges.filter((e) => e.kind === 'loop')).toHaveLength(0);
    expect(layout.laneCount).toBe(2);
    expect(layout.rowCount).toBe(15);
  });

  it('GREEN: the already-good tree is pinned exactly', () => {
    const layout = lineGraphLayout(GREEN);
    expect(posByStation(layout.nodes)).toEqual({
      B3: { row: 0, lane: 0 },
      B2: { row: 1, lane: 0 },
      B1: { row: 2, lane: 0 },
      L4: { row: 4, lane: 0 }, // blank above: the loop arcs over L4's top
      L1: { row: 5, lane: 0 },
      L2: { row: 6, lane: 0 },
      L3: { row: 7, lane: 0 },
      C1: { row: 9, lane: 0 }, // blank above C1: the loop tees off below L3
      C2: { row: 10, lane: 0 },
      C3: { row: 11, lane: 0 },
    });
    const loop = layout.edges.find((e) => e.kind === 'loop')!;
    expect(loop.pairKey).toBe('L3|L4');
    expect(loop.upperBlank).toBe(3);
    expect(loop.lowerBlank).toBe(8);
    expect(loop.sideLane).toBe(1);
    expect(layout.laneCount).toBe(2);
    expect(layout.rowCount).toBe(12);
  });
});

describe('lineGraphLayout drawn direction and bypass caps', () => {
  it('a component drawn ring-first with a tail appended keeps the drawn direction', () => {
    // The only terminus is the tip of the LATER-drawn tail; without reorienting,
    // the whole component (ring included) would read backwards from that tip.
    const layout = lineGraphLayout(
      makeLine({
        id: 'L1',
        stations: ['L1', 'L2', 'L3', 'L4', 'T1', 'T2'],
        edges: ['L1|L2', 'L2|L3', 'L3|L4', 'L1|L4', 'L3|T1', 'T1|T2'],
      }),
    );
    const order = readingOrder(layout);
    expect(order[0]).not.toBe('T2');
    expect(order.indexOf('L1')).toBeLessThan(order.indexOf('T1'));
  });

  it('a singleton bypass mid-line reads between its neighbors (threaded inline)', () => {
    // m2–m3 direct plus a bypass through bp: the trunk threads bp between its
    // neighbors and the direct track closes as a local arc.
    const layout = lineGraphLayout(
      makeLine({
        id: 'L1',
        stations: ['m1', 'm2', 'm3', 'm4', 'bp'],
        edges: ['m1|m2', 'm2|m3', 'm3|m4', 'bp|m2', 'bp|m3'],
      }),
    );
    const order = readingOrder(layout);
    expect(order.indexOf('bp')).toBeGreaterThan(order.indexOf('m2'));
    expect(order.indexOf('bp')).toBeLessThan(order.indexOf('m3'));
  });

  it('a singleton bypass at the END of the line also reads between its neighbors', () => {
    // Without the bypass-cap trim the trunk would extend t-J-P-E and fold back
    // (reading J, P, E against the map's J, E-between, P). E pops off the trunk
    // and renders as a side arm between J and P, merging into P.
    const layout = lineGraphLayout(
      makeLine({
        id: 'L1',
        stations: ['t', 'J', 'P', 'E'],
        edges: ['J|t', 'J|P', 'E|J', 'E|P'],
      }),
    );
    expect(readingOrder(layout)).toEqual(['t', 'J', 'E', 'P']);
    const pos = posByStation(layout.nodes);
    expect(pos.E.lane).toBe(1);
    expect(layout.edges.find((e) => e.pairKey === 'E|P')!.kind).toBe('merge');
    expect(layout.edges.filter((e) => e.kind === 'loop')).toHaveLength(0);
  });

  it('the bypass-cap trim stands down when the junction was drawn after the cap', () => {
    // x–P drawn first, the hub J after, then the tail. Which corner is "the
    // bypass" is ambiguous, so the cap keeps threading inline (arc), the safe
    // default.
    const layout = lineGraphLayout(
      makeLine({
        id: 'L1',
        stations: ['x', 'P', 'J', 'a'],
        edges: ['P|x', 'J|x', 'J|P', 'J|a'],
      }),
    );
    expect(layout.edges.filter((e) => e.kind === 'merge')).toHaveLength(0);
    expect(layout.edges.filter((e) => e.kind === 'loop')).toHaveLength(1);
  });
});

// Structural invariants that must hold for ANY topology: every member gets
// exactly one row, no two dots share a cell, every edge is drawn exactly once,
// back-edges point down, and no connector segment passes through a foreign dot.
describe('lineGraphLayout invariants across an edge-case zoo', () => {
  function checkInvariants(line: Line, layout: ReturnType<typeof lineGraphLayout>) {
    expect(layout.nodes.map((n) => n.stationId).sort()).toEqual([...line.stations].sort());
    const cells = new Set(layout.nodes.map((n) => `${n.row}:${n.lane}`));
    expect(cells.size).toBe(layout.nodes.length);
    const rows = new Set(layout.nodes.map((n) => n.row));
    expect(rows.size).toBe(layout.nodes.length);
    expect(layout.edges.map((e) => e.pairKey).sort()).toEqual([...line.edges].sort());
    for (const e of layout.edges) {
      if (e.kind !== 'tree') expect(e.fromRow).toBeLessThan(e.toRow);
    }
    const byCell = new Map(layout.nodes.map((n) => [`${n.row}:${n.lane}`, n.stationId]));
    const passThrough = (r1: number, r2: number, lane: number, skip: string[]) => {
      for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
        const hit = byCell.get(`${r}:${lane}`);
        if (hit && !skip.includes(hit)) return hit;
      }
      return null;
    };
    for (const e of layout.edges) {
      const [a, b] = edgeEndpoints(e.pairKey);
      if (e.kind === 'tree' && e.teeRow === undefined) {
        expect(passThrough(e.fromRow, e.toRow, e.fromLane, [a, b])).toBeNull();
      } else if (e.kind === 'tree') {
        expect(passThrough(e.fromRow, e.teeRow!, e.fromLane, [a, b])).toBeNull();
        expect(passThrough(e.teeRow!, e.toRow, e.toLane, [a, b])).toBeNull();
      } else if (e.kind === 'merge') {
        expect(passThrough(e.fromRow, e.jogRow!, e.fromLane, [a, b])).toBeNull();
        expect(passThrough(e.jogRow!, e.toRow, e.toLane, [a, b])).toBeNull();
      } else {
        expect(passThrough(e.fromRow, e.upperBlank!, e.fromLane, [a, b])).toBeNull();
        expect(passThrough(e.upperBlank!, e.lowerBlank!, e.sideLane!, [a, b])).toBeNull();
        expect(passThrough(e.lowerBlank!, e.toRow, e.toLane, [a, b])).toBeNull();
      }
    }
  }

  const zoo: [string, Line][] = [
    [
      'theta: three arms between two hubs',
      makeLine({
        id: 'z1',
        stations: ['J', 'a1', 'X', 'b1', 'c1', 'c2'],
        edges: ['J|a1', 'X|a1', 'J|b1', 'X|b1', 'J|c1', 'c1|c2', 'X|c2', 'J|X'],
      }),
    ],
    [
      'figure 8: two cycles share a station',
      makeLine({
        id: 'z2',
        stations: ['H', 'a1', 'a2', 'b1', 'b2', 't1'],
        edges: ['H|a1', 'a1|a2', 'H|a2', 'H|b1', 'b1|b2', 'H|b2', 'H|t1'],
      }),
    ],
    [
      'two branches at one junction',
      makeLine({
        id: 'z3',
        stations: ['t1', 'J', 'm1', 'm2', 'p1', 'p2', 'q1', 'q2'],
        edges: ['J|t1', 'J|m1', 'm1|m2', 'J|p1', 'p1|p2', 'J|q1', 'q1|q2'],
      }),
    ],
    [
      'branch of a branch',
      makeLine({
        id: 'z4',
        stations: ['t1', 'J', 'm1', 'm2', 'b1', 'K', 'b2', 'c1'],
        edges: ['J|t1', 'J|m1', 'm1|m2', 'J|b1', 'K|b1', 'K|b2', 'K|c1'],
      }),
    ],
    [
      'chords across the trunk',
      makeLine({
        id: 'z5',
        stations: ['a', 'b', 'c', 'd', 'e'],
        edges: ['a|b', 'b|c', 'c|d', 'd|e', 'a|d', 'b|e'],
      }),
    ],
    [
      'trunk chord plus dead-end branch',
      makeLine({
        id: 'z6',
        stations: ['a', 'b', 'c', 'd', 'p', 'q'],
        edges: ['a|b', 'b|c', 'c|d', 'b|p', 'p|q', 'c|p'],
      }),
    ],
    [
      'two components + isolated member',
      makeLine({
        id: 'z7',
        stations: ['a', 'b', 'x', 'y', 'z', 'lone'],
        edges: ['a|b', 'x|y', 'y|z'],
      }),
    ],
    [
      'stub drawn first, long arms after',
      makeLine({
        id: 'z8',
        stations: ['S', 'J', 'a1', 'a2', 'a3', 'a4', 'b1', 'b2', 'b3', 'b4'],
        edges: ['J|S', 'J|a1', 'a1|a2', 'a2|a3', 'a3|a4', 'J|b1', 'b1|b2', 'b2|b3', 'b3|b4'],
      }),
    ],
    [
      'continuation steal: a cycle lets a branch absorb a run continuation',
      makeLine({
        id: 'z9',
        stations: [
          't1',
          't2',
          'a1',
          'J',
          'c',
          'b1',
          'b2',
          'K',
          'x1',
          'k1',
          'k2',
          'c2',
          'c3',
          'y1', // prettier-ignore
        ],
        edges: [
          't1|t2',
          'a1|t2',
          'J|a1',
          'J|c',
          'J|b1',
          'b1|c',
          'b1|b2',
          'K|b2',
          'K|x1',
          'K|k1',
          'k1|k2',
          'c|c2',
          'c2|c3',
          'c2|y1', // prettier-ignore
        ],
      }),
    ],
  ];

  for (const [name, line] of zoo) {
    it(`${name}: invariants hold`, () => {
      checkInvariants(line, lineGraphLayout(line));
    });
  }
});

describe('branchableStops (which inspector rows offer a Branch button)', () => {
  const setFor = (line: Line) => branchableStops(line, lineGraphLayout(line));

  it('offers Branch on the head and interior of a linear line, but not the tail', () => {
    const s = setFor(makeLine({ id: 'L1', stations: ['s1', 's2', 's3'] }));
    expect(s.has('s1')).toBe(true); // head: s2 is rendered below it (Insert splices in, Branch extends out)
    expect(s.has('s2')).toBe(true); // interior
    expect(s.has('s3')).toBe(false); // tail dead-end: Branch would just extend, same as Insert after
  });

  it('offers Branch on every stop of a ring, including the one drawn last', () => {
    // All three are degree-2; none is a dead-end. `r` is LAST in line.stations,
    // which must not hide it — visibility follows the rendered graph, not the
    // array order.
    const s = setFor(
      makeLine({ id: 'L1', stations: ['p', 'q', 'r'], edges: ['p|q', 'q|r', 'p|r'] }),
    );
    expect(s.has('p')).toBe(true);
    expect(s.has('q')).toBe(true);
    expect(s.has('r')).toBe(true);
  });

  it('offers Branch on a degree-1 HEAD and loop stops, but hides the bottom tail', () => {
    // Tail a-b, loop b-c-d, tail d-e. The longest chain a-b-c-d-e is the trunk,
    // so `a` renders at the top (head) and `e` at the bottom (tail).
    const s = setFor(
      makeLine({
        id: 'L1',
        stations: ['a', 'b', 'c', 'd', 'e'],
        edges: ['a|b', 'b|c', 'c|d', 'd|b', 'd|e'],
      }),
    );
    expect(s.has('a')).toBe(true); // degree-1 head — the case the degree-only rule wrongly hid
    expect(s.has('c')).toBe(true); // degree-2 loop stop
    expect(s.has('b')).toBe(true);
    expect(s.has('d')).toBe(true);
    expect(s.has('e')).toBe(false); // degree-1 bottom dead-end
  });
});
