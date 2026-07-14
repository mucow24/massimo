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

// True iff the line runs a track segment directly between `a` and `b`.
export function lineHasEdge(line: Line, a: StationId, b: StationId): boolean {
  return line.edges.includes(pairKeyOf(a, b));
}

// The edges incident to `stationId` on this line (canonical pair-keys).
export function incidentEdges(line: Line, stationId: StationId): string[] {
  return line.edges.filter((e) => {
    const [a, b] = edgeEndpoints(e);
    return a === stationId || b === stationId;
  });
}

// The distinct stations directly connected to `stationId` in an edge list.
export function edgeNeighbors(edges: string[], stationId: StationId): StationId[] {
  const out: StationId[] = [];
  for (const e of edges) {
    const [a, b] = edgeEndpoints(e);
    if (a === stationId) out.push(b);
    else if (b === stationId) out.push(a);
  }
  return out;
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
