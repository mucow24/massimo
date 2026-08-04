/**
 * The region pipeline's frame protocol, in pure form: what crosses the
 * main↔worker boundary and what the worker computes per frame. No DOM, no
 * stores — this module runs identically in either realm, which is what lets
 * vitest pin the worker's output byte-equal to the synchronous path without
 * spawning a worker.
 *
 * ONE diff mechanism, two cadences: the main thread keeps the mirror it last
 * posted and identity-diffs the current slice against it — changed RECORDS
 * cross whole, never per-hook position deltas. Mid-drag that runs at frame
 * cadence (the diff IS the frame message); at rest it runs on commits. Deriving
 * the payload from the slice rather than from what a gesture thinks it wrote is
 * what makes ring capture correct by construction: `bindStationToCircle`
 * mid-drag rewrites circleId, rotation and stop cells — geometry no position
 * delta can express — and the diff sees all of it because the records changed,
 * no matter who changed them.
 */
import type {
  Line,
  LineCircle,
  LineId,
  RegionAssignment,
  Station,
  StationId,
} from '../model/types';
import { intersect, type Ring } from '../geometry/clip';
import { regionsFor, type GeometrySlice } from '../geometry/regionCache';
import { buildExclusionHolesCached, resolveRegionWinners } from '../geometry/lineRegions';
import { lineStrokeRailWidth, lineStrokeWidthOf } from '../model/lineStroke';
import { lineWidthOf } from '../model/lineWidth';

/**
 * The worker health probe's fixed op: two overlapping axis-aligned squares.
 * Lives here (not in the worker shell) so the main thread can run the same op
 * for the byte-compare WITHOUT executing the shell module — whose top-level
 * `self.onmessage` assignment would land on `window` outside a worker.
 */
export function pingRings(): Ring[] {
  const square = (x0: number, y0: number, x1: number, y1: number): Ring[] => [
    [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ],
  ];
  return intersect(square(0, 0, 10, 10), square(5, 5, 15, 15));
}

/**
 * Everything the region pipeline reads: the geometry slice plus the two
 * presentation inputs that pick winners (`lineOrder`, `regionAssignments`).
 * The worker holds one of these, kept warm by {@link MirrorSync} messages.
 */
export interface RegionMirror {
  stations: Record<StationId, Station>;
  lines: Record<LineId, Line>;
  lineCircles: Record<string, LineCircle>;
  lineOrder: LineId[];
  regionAssignments: Record<string, RegionAssignment>;
}

/** Changed records whole + removals per collection; absent = untouched. */
export interface MirrorSync {
  stations?: Record<StationId, Station>;
  lines?: Record<LineId, Line>;
  lineCircles?: Record<string, LineCircle>;
  regionAssignments?: Record<string, RegionAssignment>;
  removed?: {
    stations?: StationId[];
    lines?: LineId[];
    lineCircles?: string[];
    regionAssignments?: string[];
  };
  lineOrder?: LineId[];
}

/** Changed records by identity (the store is immutable — a changed record IS a
 *  new object), plus the ids that vanished. Null halves mean "nothing". */
function diffCollection<T>(
  cur: Record<string, T>,
  prev: Record<string, T>,
): { changed: Record<string, T> | null; removed: string[] | null } {
  if (cur === prev) return { changed: null, removed: null };
  let changed: Record<string, T> | null = null;
  for (const id of Object.keys(cur)) {
    if (cur[id] !== prev[id]) (changed ??= {})[id] = cur[id];
  }
  let removed: string[] | null = null;
  for (const id of Object.keys(prev)) {
    if (!(id in cur)) (removed ??= []).push(id);
  }
  return { changed, removed };
}

/**
 * The SYNC payload that brings a mirror holding `prev` up to `cur` — or null
 * when nothing the pipeline reads has changed. `prev === null` means the
 * receiver has nothing yet: everything crosses.
 */
export function diffMirror(cur: RegionMirror, prev: RegionMirror | null): MirrorSync | null {
  if (prev === null) {
    return {
      stations: cur.stations,
      lines: cur.lines,
      lineCircles: cur.lineCircles,
      regionAssignments: cur.regionAssignments,
      lineOrder: cur.lineOrder,
    };
  }
  const sync: MirrorSync = {};
  let removed: MirrorSync['removed'];
  const st = diffCollection(cur.stations, prev.stations);
  if (st.changed) sync.stations = st.changed;
  if (st.removed) (removed ??= {}).stations = st.removed;
  const ln = diffCollection(cur.lines, prev.lines);
  if (ln.changed) sync.lines = ln.changed;
  if (ln.removed) (removed ??= {}).lines = ln.removed;
  const lc = diffCollection(cur.lineCircles, prev.lineCircles);
  if (lc.changed) sync.lineCircles = lc.changed;
  if (lc.removed) (removed ??= {}).lineCircles = lc.removed;
  const ra = diffCollection(cur.regionAssignments, prev.regionAssignments);
  if (ra.changed) sync.regionAssignments = ra.changed;
  if (ra.removed) (removed ??= {}).regionAssignments = ra.removed;
  if (removed) sync.removed = removed;
  if (cur.lineOrder !== prev.lineOrder) sync.lineOrder = cur.lineOrder;
  return Object.keys(sync).length ? sync : null;
}

/** Apply a SYNC to a mirror. Pure — returns the updated mirror. */
export function applyMirrorSync(mirror: RegionMirror, sync: MirrorSync): RegionMirror {
  const apply = <T>(
    cur: Record<string, T>,
    changed: Record<string, T> | undefined,
    removed: string[] | undefined,
  ): Record<string, T> => {
    if (!changed && !removed) return cur;
    const next = { ...cur, ...changed };
    if (removed) for (const id of removed) delete next[id];
    return next;
  };
  return {
    stations: apply(mirror.stations, sync.stations, sync.removed?.stations),
    lines: apply(mirror.lines, sync.lines, sync.removed?.lines),
    lineCircles: apply(mirror.lineCircles, sync.lineCircles, sync.removed?.lineCircles),
    regionAssignments: apply(
      mirror.regionAssignments,
      sync.regionAssignments,
      sync.removed?.regionAssignments,
    ),
    lineOrder: sync.lineOrder ?? mirror.lineOrder,
  };
}

/**
 * One frame's exclusion holes for a mirror — the worker's whole job, and
 * byte-for-byte what the synchronous render path produces for the same
 * geometry (pinned by regionFrame.test.ts). Runs the same chain MapCanvas
 * does: transient `regionsFor` (drag frames are never revisited, and the
 * skipped LRU insert is this realm's own bookkeeping), winners, then the
 * cached hole build seeded by the chain — all of whose cross-frame state
 * lives in THIS realm's module scope, which in the worker is the worker's
 * own warm copy.
 */
export function computeMirrorHoles(mirror: RegionMirror): Map<LineId, Ring[]> {
  const g: GeometrySlice = {
    stations: mirror.stations,
    lines: mirror.lines,
    lineCircles: mirror.lineCircles,
  };
  const geom = regionsFor(g, undefined, { transient: true });
  const winners = resolveRegionWinners(
    geom.faces,
    mirror.regionAssignments,
    geom.bands,
    mirror.lineOrder,
  );
  const railWOf = (lineId: LineId) => {
    const line = mirror.lines[lineId];
    return line ? lineStrokeRailWidth(lineStrokeWidthOf(line), lineWidthOf(line)) : 0;
  };
  return buildExclusionHolesCached(
    geom.faces,
    winners,
    mirror.lineOrder,
    geom.bands,
    geom.markers,
    railWOf,
    geom.slivers,
    geom.holeChain,
  );
}

/**
 * Holes packed for the boundary: every coordinate in one transferable
 * Float64Array (zero-copy postMessage) + a small index preserving line and
 * ring boundaries in emit order. Faces never cross — mid-drag nothing renders
 * them, and their UUID strings are what made full-payload frames ~1MB.
 */
export interface PackedHoles {
  /** x,y pairs, ring after ring, line after line. */
  coords: Float64Array;
  index: { lineId: LineId; ringLengths: number[] }[];
}

export function packHoles(holes: Map<LineId, Ring[]>): PackedHoles {
  let points = 0;
  for (const rings of holes.values()) for (const ring of rings) points += ring.length;
  const coords = new Float64Array(points * 2);
  const index: PackedHoles['index'] = [];
  let at = 0;
  for (const [lineId, rings] of holes) {
    const ringLengths: number[] = [];
    for (const ring of rings) {
      ringLengths.push(ring.length);
      for (const p of ring) {
        coords[at++] = p.x;
        coords[at++] = p.y;
      }
    }
    index.push({ lineId, ringLengths });
  }
  return { coords, index };
}

export function unpackHoles(packed: PackedHoles): Map<LineId, Ring[]> {
  const holes = new Map<LineId, Ring[]>();
  let at = 0;
  for (const { lineId, ringLengths } of packed.index) {
    const rings: Ring[] = [];
    for (const len of ringLengths) {
      const ring: Ring = new Array(len);
      for (let i = 0; i < len; i++) {
        ring[i] = { x: packed.coords[at++], y: packed.coords[at++] };
      }
      rings.push(ring);
    }
    holes.set(lineId, rings);
  }
  return holes;
}
