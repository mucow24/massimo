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
}

export interface LineGraphLayout {
  nodes: GraphNode[]; // in row order (row === index)
  edges: GraphEdgeVis[];
  laneCount: number; // total columns incl. loop side-lanes
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

  const nodes: GraphNode[] = [];
  const edges: GraphEdgeVis[] = [];
  const rowOf = new Map<StationId, number>();
  const laneOf = new Map<StationId, number>();
  const visited = new Set<StationId>();
  let nextRow = 0;
  let nextLane = 1; // lane 0 is the trunk

  const visit = (node: StationId, lane: number, parent: StationId | null) => {
    visited.add(node);
    rowOf.set(node, nextRow);
    laneOf.set(node, lane);
    nodes.push({ stationId: node, row: nextRow, lane });
    nextRow++;
    let first = true;
    let skippedParent = false;
    for (const nb of adj.get(node)!) {
      if (nb === parent && !skippedParent) {
        skippedParent = true; // consume the tree edge back to the parent once
        continue;
      }
      if (visited.has(nb)) {
        // Back-edge → a loop. Both endpoints see it, so record it exactly once,
        // from the LOWER node (this one) looking up at the already-placed upper
        // one (`nb.row < node.row`); the upper node skips its later encounter.
        if (rowOf.get(nb)! < rowOf.get(node)!) {
          edges.push({
            pairKey: pairKeyOf(node, nb),
            fromRow: rowOf.get(nb)!,
            fromLane: laneOf.get(nb)!,
            toRow: rowOf.get(node)!,
            toLane: lane,
            kind: 'loop',
          });
        }
        continue;
      }
      const childLane = first ? lane : nextLane++;
      first = false;
      const childRow = nextRow; // the row visit(nb) is about to assign
      edges.push({
        pairKey: pairKeyOf(node, nb),
        fromRow: rowOf.get(node)!,
        fromLane: lane,
        toRow: childRow,
        toLane: childLane,
        kind: 'tree',
      });
      visit(nb, childLane, node);
    }
  };

  // Roots: prefer a terminus (degree 1) so the DFS runs a full path down lane 0;
  // then any remaining unvisited node (disconnected pieces), by display order.
  const roots = [...members].sort((a, b) => {
    const ta = adj.get(a)!.length === 1 ? 0 : 1;
    const tb = adj.get(b)!.length === 1 ? 0 : 1;
    if (ta !== tb) return ta - tb;
    return order.get(a)! - order.get(b)!;
  });
  for (const r of roots) {
    if (!visited.has(r)) visit(r, 0, null);
  }

  const treeLaneCount = nodes.reduce((m, n) => Math.max(m, n.lane), 0) + 1;
  // Route each loop back-edge in its own side lane to the right of the tree.
  let sideLane = treeLaneCount;
  for (const e of edges) {
    if (e.kind === 'loop') e.sideLane = sideLane++;
  }
  const laneCount = Math.max(treeLaneCount, sideLane);

  return { nodes, edges, laneCount };
}
