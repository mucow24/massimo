/**
 * Sig-keyed cache for region geometry, shared by the render layer and the
 * store's reconcile step so neither rebuilds what the other just computed.
 * Reconciliation needs faces for BOTH the pre-edit and post-edit geometry;
 * the pre-edit entry usually fell out of any per-render memo, so this cache
 * is the one place both sides read.
 */
import type { Line, LineId, Station, StationId } from '../model/types';
import {
  buildBandGeometry,
  buildStopMarkers,
  type SegmentBandSpec,
  type StopMarkerSpec,
} from './interlining';
import { type HoleChain, type RegionFace, type RegionSliver } from './lineRegions';
import { buildRegionsIncremental, type RegionIncrementalState } from './regionIncremental';

export interface GeometrySlice {
  stations: Record<StationId, Station>;
  lines: Record<LineId, Line>;
}

/**
 * Hash of everything region geometry depends on: station positions/rotations
 * and stop cells, line edge sets, widths, interline gaps and curve radii,
 * and segment style VALUES (they flip marker footprints between full-square
 * and stub/none). Deliberately excludes colors, casing, seams, lineOrder —
 * presentation.
 */
export function regionGeometrySig(g: GeometrySlice): string {
  const parts: string[] = [];
  // Lines that own at least one stop. An edgeless line still contributes a
  // width x width marker square to the arrangement (buildStopMarkers emits a
  // marker per stop regardless of edges), so its width has to be in the key —
  // (an edgeless line has no terminus, so its end style genuinely cannot
  // matter; it is hashed anyway rather than conditionally, since a key that
  // over-invalidates costs one rebuild and one that under-invalidates is a
  // stale arrangement)
  // and edgeless-but-stopped is ordinary, not exotic: a line is that way from
  // its first station until its second, and again whenever an endpoint of a
  // two-station line is deleted.
  const stoppedLines = new Set<LineId>();
  for (const id of Object.keys(g.stations)) {
    const st = g.stations[id];
    if (!st.stops.length) continue; // stopless stations carry no band geometry
    parts.push(id, String(st.x), String(st.y), String(st.rotation));
    for (const c of st.stops) {
      parts.push(c.lineId, String(c.row), String(c.col), c.orientation);
      stoppedLines.add(c.lineId);
    }
  }
  for (const id of Object.keys(g.lines)) {
    const ln = g.lines[id];
    if (!ln.edges.length && !stoppedLines.has(id)) continue; // contributes nothing
    parts.push(
      id,
      ln.edges.join('.'),
      String(ln.width ?? ''),
      String(ln.interlineGap ?? ''),
      String(ln.curveRadius ?? ''),
      // Line END style, and every per-terminus pin: like a segment style
      // these flip marker footprints — a short end withdraws its outward half
      // from the arrangement, a round one replaces it with a half-disc.
      String(ln.endStyle ?? ''),
    );
    const ends = ln.stationEndStyles;
    if (ends) for (const k of Object.keys(ends)) parts.push(k, ends[k]);
    const styles = ln.segmentStyles;
    if (styles) for (const k of Object.keys(styles)) parts.push(k, styles[k]);
  }
  return parts.join('|');
}

export interface RegionGeometry {
  bands: SegmentBandSpec[];
  markers: StopMarkerSpec[];
  faces: RegionFace[];
  /** Dropped overlap slivers, for bridge reveals (see buildExclusionHoles). */
  slivers: RegionSliver[];
  /**
   * The incremental transition that PRODUCED this entry, for the exclusion-
   * hole cache's invalidation (see {@link HoleChain}). An LRU hit hands back
   * the entry's original chain; the hole cache recognizes the broken link
   * and flushes — over-invalidation, never staleness.
   */
  holeChain: HoleChain;
}

const CACHE_LIMIT = 4;
const cache = new Map<string, RegionGeometry>();

/**
 * The most recent incremental build, carried across calls so a drag's next
 * frame can reuse it. Deliberately module-scoped and single-slot: the useful
 * comparison is always "what did we build immediately before", and holding more
 * would not help — a drag never revisits a geometry.
 */
let lastIncremental: RegionIncrementalState | null = null;

/**
 * Bands + markers built by the caller from the SAME geometry slice passed to
 * {@link regionsFor} — the render layer's memos already hold this frame's
 * build, and rebuilding it here was pure duplicate work. Priority fields may
 * be stamped or not: region geometry never reads them, so entries built from
 * either side of the cache are interchangeable.
 */
export interface PrebuiltGeometry {
  bands: SegmentBandSpec[];
  markers: StopMarkerSpec[];
}

/**
 * Bands + markers + overlap faces for a geometry slice. LRU-cached by sig
 * (small: render + reconcile old/new). Without `prebuilt`, markers are built
 * with an empty lineOrder — their priority field is irrelevant to region
 * geometry.
 *
 * `transient` marks a mid-gesture frame: the sig string (a walk over every
 * station and line) and the LRU probe/insert are skipped — a drag never
 * revisits an intermediate geometry, so the entry could never hit, and
 * SKIPPING the insert preserves the pre-gesture entry for the commit
 * reconcile's old-geometry lookup instead of evicting it within
 * CACHE_LIMIT frames. The incremental state still advances, so the next
 * frame (transient or not) reuses everything this one built.
 */
export function regionsFor(
  g: GeometrySlice,
  prebuilt?: PrebuiltGeometry,
  opts?: { transient?: boolean },
): RegionGeometry {
  const transient = opts?.transient ?? false;
  let sig: string | null = null;
  if (!transient) {
    sig = regionGeometrySig(g);
    const hit = cache.get(sig);
    if (hit) {
      // Refresh recency.
      cache.delete(sig);
      cache.set(sig, hit);
      return hit;
    }
  }
  const bands = prebuilt?.bands ?? buildBandGeometry(g.stations, g.lines);
  const markers = prebuilt?.markers ?? buildStopMarkers(g.stations, g.lines, [], bands);
  // Seeded from whatever we built last. During a drag that is the previous
  // frame, which is exactly the comparison the incremental builder wants; the
  // reconcile step's old-then-new pair chains the same way. A mismatched seed
  // only costs a miss — the result is identical either way (the builder hashes
  // its own inputs rather than trusting the seed).
  const seed = lastIncremental;
  const built = buildRegionsIncremental(bands, markers, seed);
  lastIncremental = built.state;
  const entry: RegionGeometry = {
    bands,
    markers,
    faces: built.faces,
    slivers: built.slivers,
    holeChain: { state: built.state, prevState: seed, dirtyBoxes: built.dirtyBoxes },
  };
  if (sig !== null) {
    cache.set(sig, entry);
    if (cache.size > CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  }
  return entry;
}
