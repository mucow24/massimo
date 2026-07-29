import { pairKeyOf } from './pairKey';
import type { Line, StationId } from './types';

// A line's connectivity is an EDGE SET over its member stations, stored as
// canonical `pairKeyOf` strings in `Line.edges`. This module is the single
// place that reads/writes that set — degree, neighbours, and incidence are all
// derived here so no consumer re-implements adjacency by scanning `stations`.
//
// Two properties hold by construction and every helper below relies on them:
//   • each edge is unique (a Set of pairKeys), so `degreeOf` == neighbour count;
//   • each edge is canonical (`from < to`), matching the key space that
//     `segmentStyles` / line tags already live in.
//
// The read helpers are memoized on the IDENTITY of the edges array (see
// `adjacencyOf`): the transforms below replace the array on every change and
// return the same reference on a no-op, so array identity is a version stamp —
// the same bargain stopMetrics makes with its slices. Two contract points for
// callers: (1) mutating an edges array in place would serve stale adjacency
// (nothing in the codebase does — the whole render pipeline memoizes on the
// same rule); (2) the arrays returned by `neighborsOf` / `edgeNeighbors` /
// `incidentEdges` are shared across calls — treat them as read-only and copy
// before sorting or splicing.

// Split a canonical pair-key back into its two station ids. Station ids never
// contain '|' (UUIDs / counter ids), so the first '|' is the separator.
export function edgeEndpoints(edge: string): [StationId, StationId] {
  const i = edge.indexOf('|');
  return [edge.slice(0, i), edge.slice(i + 1)];
}

// Derive the edge set of a LINEAR path from an ordered station list: the
// canonical pair-key of each consecutive pair, deduped. This is exactly the
// legacy "consecutive pairs" topology, and is used to backfill `edges` for
// saves that predate the field (see serialize.ts / migrateDoc).
export function edgesFromStations(stations: StationId[]): string[] {
  const set = new Set<string>();
  for (let i = 0; i < stations.length - 1; i++) {
    const a = stations[i];
    const b = stations[i + 1];
    if (a !== b) set.add(pairKeyOf(a, b));
  }
  return [...set];
}

// Derived adjacency for one edges array: membership set plus per-station
// neighbour and incident-edge lists, all built in a single pass IN EDGES-ARRAY
// ORDER so the cached lists are element-for-element what the old per-call
// scans produced. Cached per array identity in a WeakMap — a Line clone that
// shares its edges array (`{ ...line, color }`) hits, a transform that changed
// the topology (new array) rebuilds, and dropped arrays are collectable.
interface EdgeAdjacency {
  /** Same membership as the edges array (unique, canonical keys). */
  edgeSet: Set<string>;
  /** stationId → directly connected stations, in edges-array order. */
  neighbors: Map<StationId, StationId[]>;
  /** stationId → incident edge keys, in edges-array order. */
  incident: Map<StationId, string[]>;
}

const adjacencyCache = new WeakMap<readonly string[], EdgeAdjacency>();
// Shared empties handed out on a cache miss for a station with no incident
// edges — read-only by the module contract above.
const NO_NEIGHBORS: StationId[] = [];
const NO_EDGES: string[] = [];

function adjacencyOf(edges: string[]): EdgeAdjacency {
  const hit = adjacencyCache.get(edges);
  if (hit) return hit;
  const edgeSet = new Set(edges);
  const neighbors = new Map<StationId, StationId[]>();
  const incident = new Map<StationId, string[]>();
  const push = (station: StationId, other: StationId, edge: string) => {
    const n = neighbors.get(station);
    if (n) n.push(other);
    else neighbors.set(station, [other]);
    const i = incident.get(station);
    if (i) i.push(edge);
    else incident.set(station, [edge]);
  };
  for (const e of edges) {
    const [a, b] = edgeEndpoints(e);
    push(a, b, e);
    // A malformed self-loop key contributes once, like the old else-if scan.
    if (b !== a) push(b, a, e);
  }
  const adjacency: EdgeAdjacency = { edgeSet, neighbors, incident };
  adjacencyCache.set(edges, adjacency);
  return adjacency;
}

// True iff the line runs a track segment directly between `a` and `b`.
export function lineHasEdge(line: Line, a: StationId, b: StationId): boolean {
  return adjacencyOf(line.edges).edgeSet.has(pairKeyOf(a, b));
}

// The edges incident to `stationId` on this line (canonical pair-keys).
export function incidentEdges(line: Line, stationId: StationId): string[] {
  return adjacencyOf(line.edges).incident.get(stationId) ?? NO_EDGES;
}

// The distinct stations directly connected to `stationId` in an edge list.
export function edgeNeighbors(edges: string[], stationId: StationId): StationId[] {
  return adjacencyOf(edges).neighbors.get(stationId) ?? NO_NEIGHBORS;
}

// The distinct stations directly connected to `stationId` on this line.
export function neighborsOf(line: Line, stationId: StationId): StationId[] {
  return edgeNeighbors(line.edges, stationId);
}

// Number of incident edges. Since edges are unique, this equals the neighbour
// count. Degree 1 = a terminus; degree ≥ 3 = a branch junction.
export function degreeOf(line: Line, stationId: StationId): number {
  return neighborsOf(line, stationId).length;
}

// Is this station one of the line's ENDS? Degree 1 exactly: a loop (degree 2
// throughout) has no end, a junction has none at the fork, and a lone stop
// (degree 0) has no direction to end along. A branching line has one per branch
// tip. This is the predicate the painted end style and its per-station override
// key off.
export function isLineTerminus(line: Line, stationId: StationId): boolean {
  return degreeOf(line, stationId) === 1;
}

// Shortest hop path (BFS) over one line's edge graph from `fromId` to `toId`,
// excluding `fromId`. Null if either isn't a member or they're not connected on
// this line. For a plain linear line this is exactly the consecutive walk
// between them; for a loop it takes the shorter arc, and for a branch it walks
// the unique tree path.
export function shortestPathOnLine(
  line: Line,
  fromId: StationId,
  toId: StationId,
): StationId[] | null {
  if (!line.stations.includes(fromId) || !line.stations.includes(toId)) return null;
  const prev = new Map<StationId, StationId | null>([[fromId, null]]);
  const queue: StationId[] = [fromId];
  while (queue.length) {
    const cur = queue.shift() as StationId;
    if (cur === toId) {
      const path: StationId[] = [];
      for (let n: StationId | null = toId; n !== null; n = prev.get(n) ?? null) path.push(n);
      return path.reverse().slice(1); // from → to, excluding `fromId`
    }
    for (const nb of edgeNeighbors(line.edges, cur)) {
      if (!prev.has(nb)) {
        prev.set(nb, cur);
        queue.push(nb);
      }
    }
  }
  return null;
}

// Add the canonical edge (a, b) to an edge list. No-op (same array reference)
// on a self-loop or an edge already present, so callers keep the transform
// "same reference on no-op" invariant.
export function addEdge(edges: string[], a: StationId, b: StationId): string[] {
  if (a === b) return edges;
  const key = pairKeyOf(a, b);
  return edges.includes(key) ? edges : [...edges, key];
}

// Remove the edge (a, b). Same reference when the edge wasn't present.
export function removeEdge(edges: string[], a: StationId, b: StationId): string[] {
  const key = pairKeyOf(a, b);
  return edges.includes(key) ? edges.filter((e) => e !== key) : edges;
}

// Drop every edge incident to `stationId` (used when a station leaves the
// line). Same reference when the station had no incident edges.
export function edgesWithout(edges: string[], stationId: StationId): string[] {
  const next = edges.filter((e) => {
    const [a, b] = edgeEndpoints(e);
    return a !== stationId && b !== stationId;
  });
  return next.length === edges.length ? edges : next;
}
