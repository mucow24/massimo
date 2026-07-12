import type { Line, StationId } from '../../model/types';
import { pairKeyOf } from '../../model/pairKey';
import { edgeEndpoints } from '../../model/lineTopology';

// Column-based ("git graph") layout for a line's topology in the inspector.
// Each member station gets a ROW (vertical order) and a LANE (column). The
// trunk stays in lane 0; at a branch the first path continues the lane and each
// other path takes a new lane to the right that runs alongside down to its
// stops. A loop closes with a back-edge routed in a side lane so it doesn't
// overlap the trunk.
//
// Pure: depends only on `line.stations` (members + their display order, which
// breaks ties for which path is the "trunk") and `line.edges` (topology).

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

  // Roots: prefer a terminus (degree 1) so the DFS runs a full path down lane 0;
  // then any remaining unvisited node (disconnected pieces), by display order.
  const roots = [...members].sort((a, b) => {
    const ta = adj.get(a)!.length === 1 ? 0 : 1;
    const tb = adj.get(b)!.length === 1 ? 0 : 1;
    if (ta !== tb) return ta - tb;
    return order.get(a)! - order.get(b)!;
  });

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
  }
  const seqOf = new Map<StationId, number>();
  const laneOf = new Map<StationId, number>();
  const childCount = new Map<StationId, number>();
  const treeEdges: TreeE[] = [];
  const loopEdges: LoopE[] = [];
  const visited = new Set<StationId>();
  let nextSeq = 0;
  let nextLane = 1; // lane 0 is the trunk

  const visit = (node: StationId, lane: number, parent: StationId | null) => {
    visited.add(node);
    seqOf.set(node, nextSeq++);
    laneOf.set(node, lane);
    let kids = 0;
    let first = true;
    let skippedParent = false;
    for (const nb of adj.get(node)!) {
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

  // Phase B — which stops get a blank row below them: branch points (their
  // branches tee off there) and loop endpoints (the loop's horizontals sit
  // below the stop, not at it).
  const blankBelow = new Set<StationId>();
  for (const [node, k] of childCount) if (k >= 2) blankBelow.add(node);
  for (const lp of loopEdges) {
    blankBelow.add(lp.upper);
    blankBelow.add(lp.lower);
  }

  // Phase C — assign final rows in visit order, inserting the reserved blanks.
  const inSeq = [...seqOf.keys()].sort((a, b) => seqOf.get(a)! - seqOf.get(b)!);
  const rowOf = new Map<StationId, number>();
  const blankRowOf = new Map<StationId, number>();
  let nextRow = 0;
  for (const node of inSeq) {
    rowOf.set(node, nextRow++);
    if (blankBelow.has(node)) {
      blankRowOf.set(node, nextRow);
      nextRow++; // reserve the blank junction row
    }
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
      upperBlank: blankRowOf.get(lp.upper)!,
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
