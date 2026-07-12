import type { Line, StationId } from '../../model/types';
import { pairKeyOf } from '../../model/pairKey';
import { edgeEndpoints } from '../../model/lineTopology';

// Column-based ("git graph") layout for a line's topology in the inspector.
// Each member station gets a ROW (vertical order) and a LANE (column). The
// trunk (lane 0) follows the graph's LONGEST chain, so loops thread inline and
// only genuine dead-end branches spend an extra column; at a branch the trunk
// continues in the lane and each other path takes a new lane to the right that
// runs alongside down to its stops. A loop closes with a back-edge routed in a
// side lane so it doesn't overlap the trunk.
//
// Pure: depends only on `line.stations` (members + their display order, which
// only breaks ties for the trunk) and `line.edges` (topology).

export interface GraphNode {
  stationId: StationId;
  row: number;
  lane: number;
}

export interface GraphEdgeVis {
  pairKey: string;
  // Endpoints in graph space. `from` is the upper (smaller row) endpoint.
  fromRow: number;
  fromLane: number;
  toRow: number;
  toLane: number;
  // 'tree' = a spanning-tree edge (drawn as a straight/branch connector);
  // 'loop' = a back-edge closing a cycle, routed out in `sideLane`.
  kind: 'tree' | 'loop';
  // Only for loops: the column the back-edge bows out into (right of the tree).
  sideLane?: number;
  // Only for a cross-lane branch: the blank row one cell below the parent where
  // the branch tees off, so the horizontal sits below the stop, not through it.
  teeRow?: number;
  // Only for loops: the blank rows below the upper / lower endpoints where the
  // loop's horizontals sit (below the stops, not branching out of them).
  upperBlank?: number;
  lowerBlank?: number;
}

export interface LineGraphLayout {
  nodes: GraphNode[]; // one per stop (NOT one per row — junctions leave blanks)
  edges: GraphEdgeVis[];
  laneCount: number; // total columns incl. loop side-lanes
  rowCount: number; // total grid rows incl. the blank junction rows
}

// Total DFS steps the longest-path search may spend before falling back to the
// best chain found so far. Finding the longest simple path is NP-hard in
// general, but line graphs are tiny and near-tree; this only backstops a
// pathologically cyclic input (the layout stays correct with a merely-good
// trunk, just less column-optimal).
const LONGEST_PATH_STEP_BUDGET = 50000;

// Longest simple path starting at `start`, exploring neighbours in their given
// (display) order and keeping the first path found at each length so ties
// resolve deterministically. Decrements the shared `budget`.
function longestPathFrom(
  start: StationId,
  adj: Map<StationId, StationId[]>,
  budget: { steps: number },
): StationId[] {
  let best: StationId[] = [start];
  const path: StationId[] = [];
  const onPath = new Set<StationId>();
  const walk = (node: StationId) => {
    path.push(node);
    onPath.add(node);
    if (path.length > best.length) best = [...path];
    if (budget.steps > 0) {
      for (const nb of adj.get(node)!) {
        if (onPath.has(nb)) continue;
        budget.steps--;
        walk(nb);
        if (budget.steps <= 0) break;
      }
    }
    path.pop();
    onPath.delete(node);
  };
  walk(start);
  return best;
}

// Pick, per connected component, the longest simple path and record each of its
// nodes' trunk SUCCESSOR (so the layout walk lays that chain down lane 0) plus
// the component's start node. Routing the trunk down the longest chain threads
// loops inline — their internal stops sit in the trunk lane and the cycle closes
// with a short side arc — instead of each loop/branch claiming a parallel column.
function longestTrunk(
  members: StationId[],
  adj: Map<StationId, StationId[]>,
  order: Map<StationId, number>,
): { next: Map<StationId, StationId>; starts: StationId[] } {
  const next = new Map<StationId, StationId>();
  const starts: StationId[] = [];
  const budget = { steps: LONGEST_PATH_STEP_BUDGET };
  const byDisplay = (a: StationId, b: StationId) => order.get(a)! - order.get(b)!;
  const seen = new Set<StationId>();
  for (const m of [...members].sort(byDisplay)) {
    if (seen.has(m)) continue;
    // Flood m's whole component.
    const comp: StationId[] = [];
    const stack = [m];
    seen.add(m);
    while (stack.length) {
      const n = stack.pop()!;
      comp.push(n);
      for (const nb of adj.get(n)!) {
        if (!seen.has(nb)) {
          seen.add(nb);
          stack.push(nb);
        }
      }
    }
    // Seed from every terminus (a longest path ends at one); a ring with no ends
    // seeds from its display-first stop.
    const termini = comp.filter((c) => adj.get(c)!.length === 1).sort(byDisplay);
    const seeds = termini.length ? termini : [[...comp].sort(byDisplay)[0]];
    let bestPath: StationId[] = [seeds[0]];
    for (const s of seeds) {
      const p = longestPathFrom(s, adj, budget);
      if (p.length > bestPath.length) bestPath = p;
      if (budget.steps <= 0) break;
    }
    // Orient so the trunk starts at the display-earlier endpoint (determinism).
    if (order.get(bestPath[0])! > order.get(bestPath[bestPath.length - 1])!) bestPath.reverse();
    starts.push(bestPath[0]);
    for (let i = 0; i < bestPath.length - 1; i++) next.set(bestPath[i], bestPath[i + 1]);
  }
  return { next, starts };
}

export function lineGraphLayout(line: Line): LineGraphLayout {
  const members = line.stations;
  const order = new Map<StationId, number>();
  members.forEach((s, i) => order.set(s, i));

  const adj = new Map<StationId, StationId[]>();
  for (const s of members) adj.set(s, []);
  for (const e of line.edges) {
    const [a, b] = edgeEndpoints(e);
    if (adj.has(a) && adj.has(b)) {
      adj.get(a)!.push(b);
      adj.get(b)!.push(a);
    }
  }
  // Visit neighbours in display order so the layout is deterministic and the
  // user's drawn order decides which path is the trunk.
  for (const list of adj.values()) list.sort((x, y) => order.get(x)! - order.get(y)!);

  // Route the trunk down each component's LONGEST chain so loops thread inline
  // (a big win in the narrow editor). `starts` gives one root per component and
  // `trunkNext` names the lane-0 successor of every stop along those chains;
  // display order only breaks ties. The remaining members are appended as roots
  // purely as a safety net — every component is already covered by a start.
  const { next: trunkNext, starts } = longestTrunk(members, adj, order);
  const startSet = new Set(starts);
  const roots = [
    ...starts,
    ...[...members].filter((m) => !startSet.has(m)).sort((a, b) => order.get(a)! - order.get(b)!),
  ];

  // Phase A — one DFS: visit sequence + lane per stop, the spanning-tree edges,
  // the loop back-edges, and each stop's tree-child count.
  interface TreeE {
    pairKey: string;
    parent: StationId;
    child: StationId;
    sameLane: boolean;
  }
  interface LoopE {
    pairKey: string;
    upper: StationId; // earlier-visited endpoint
    lower: StationId; // later-visited endpoint
    overTop?: boolean; // upper is a top root → arc comes in over the top
  }
  const seqOf = new Map<StationId, number>();
  const laneOf = new Map<StationId, number>();
  const childCount = new Map<StationId, number>();
  const treeEdges: TreeE[] = [];
  const loopEdges: LoopE[] = [];
  const visited = new Set<StationId>();
  const rootSet = new Set<StationId>(); // stops started with no parent (top of a chain)
  let nextSeq = 0;
  let nextLane = 1; // lane 0 is the trunk

  const visit = (node: StationId, lane: number, parent: StationId | null) => {
    visited.add(node);
    if (parent === null) rootSet.add(node);
    seqOf.set(node, nextSeq++);
    laneOf.set(node, lane);
    let kids = 0;
    let first = true;
    let skippedParent = false;
    // Take the trunk successor first so it becomes the lane-0 continuation; the
    // rest follow in display order (branches / back-edges).
    const tn = trunkNext.get(node);
    const nbrs =
      tn === undefined ? adj.get(node)! : [tn, ...adj.get(node)!.filter((x) => x !== tn)];
    for (const nb of nbrs) {
      if (nb === parent && !skippedParent) {
        skippedParent = true; // consume the tree edge back to the parent once
        continue;
      }
      if (visited.has(nb)) {
        // Back-edge → a loop. Both endpoints see it; record once from the LOWER
        // (later-visited) node looking up at the already-placed upper one.
        if (seqOf.get(nb)! < seqOf.get(node)!) {
          loopEdges.push({ pairKey: pairKeyOf(node, nb), upper: nb, lower: node });
        }
        continue;
      }
      kids++;
      const childLane = first ? lane : nextLane++;
      first = false;
      treeEdges.push({
        pairKey: pairKeyOf(node, nb),
        parent: node,
        child: nb,
        sameLane: childLane === lane,
      });
      visit(nb, childLane, node);
    }
    childCount.set(node, kids);
  };
  for (const r of roots) if (!visited.has(r)) visit(r, 0, null);

  // Phase B — which stops get a blank row, and on which SIDE. Branch points and
  // most loop endpoints tee off in a blank BELOW them. But a loop that closes
  // back to a ROOT (a stop at the top of a chain, nothing above it) re-enters
  // from the top: that endpoint reserves its blank ABOVE and the arc loops over
  // it, so a loop-to-the-top reads as a loop rather than a trumpet.
  const blankBelow = new Set<StationId>();
  const blankAbove = new Set<StationId>();
  for (const [node, k] of childCount) if (k >= 2) blankBelow.add(node);
  for (const lp of loopEdges) {
    lp.overTop = rootSet.has(lp.upper);
    if (lp.overTop) blankAbove.add(lp.upper);
    else blankBelow.add(lp.upper);
    blankBelow.add(lp.lower);
  }

  // Phase C — assign final rows in visit order, inserting the reserved blanks
  // (above a loop-to-the-top endpoint, below everything else).
  const inSeq = [...seqOf.keys()].sort((a, b) => seqOf.get(a)! - seqOf.get(b)!);
  const rowOf = new Map<StationId, number>();
  const blankRowOf = new Map<StationId, number>();
  const aboveRowOf = new Map<StationId, number>();
  let nextRow = 0;
  for (const node of inSeq) {
    if (blankAbove.has(node)) aboveRowOf.set(node, nextRow++);
    rowOf.set(node, nextRow++);
    if (blankBelow.has(node)) blankRowOf.set(node, nextRow++);
  }
  const rowCount = nextRow;

  // Phase D — build renderable nodes + edges.
  const nodes: GraphNode[] = inSeq.map((s) => ({
    stationId: s,
    row: rowOf.get(s)!,
    lane: laneOf.get(s)!,
  }));
  const edges: GraphEdgeVis[] = [];
  for (const te of treeEdges) {
    edges.push({
      pairKey: te.pairKey,
      fromRow: rowOf.get(te.parent)!,
      fromLane: laneOf.get(te.parent)!,
      toRow: rowOf.get(te.child)!,
      toLane: laneOf.get(te.child)!,
      kind: 'tree',
      ...(te.sameLane ? {} : { teeRow: blankRowOf.get(te.parent)! }),
    });
  }
  for (const lp of loopEdges) {
    edges.push({
      pairKey: lp.pairKey,
      fromRow: rowOf.get(lp.upper)!,
      fromLane: laneOf.get(lp.upper)!,
      toRow: rowOf.get(lp.lower)!,
      toLane: laneOf.get(lp.lower)!,
      kind: 'loop',
      // Over-top loops come in from the blank ABOVE the upper stop; the rest tee
      // off from the blank below it.
      upperBlank: lp.overTop ? aboveRowOf.get(lp.upper)! : blankRowOf.get(lp.upper)!,
      lowerBlank: blankRowOf.get(lp.lower)!,
    });
  }

  // Phase E — route each loop in its own side lane, right of the tree.
  const treeLaneCount = nodes.reduce((m, n) => Math.max(m, n.lane), 0) + 1;
  let sideLane = treeLaneCount;
  for (const e of edges) if (e.kind === 'loop') e.sideLane = sideLane++;
  const laneCount = Math.max(treeLaneCount, sideLane);

  return { nodes, edges, laneCount, rowCount };
}
