/**
 * Incremental rebuild of the region arrangement.
 *
 * WHY: `buildOverlapRegions` costs ~1.3ms per overlap face and is whole-
 * document — dragging a one-stop station on an empty corner rebuilds all 103
 * faces of a dense map exactly like dragging a nine-line interchange does. But
 * measured across every station of the DKLB map, 59% of moves change NO face at
 * all: the arrangement is far more stable than the inputs that produce it.
 *
 * HOW: the zone splits into connected components, and a cell can never span two
 * of them (every cell is a subset of the zone, and disjoint territory cannot
 * interact through intersect/subtract). So each component's faces are an
 * independent unit of work — and an independent unit of CACHING.
 *
 * A component is reused when both hold:
 *   1. its own geometry hashes the same as last frame, and
 *   2. no geometry that changed this frame lies anywhere near it.
 *
 * Condition 2 is what makes it sound. A component's faces depend on the bodies
 * restricted to it, not just on its own outline, so an unchanged outline is not
 * on its own proof that the interior is unchanged. Tracking the bounding box of
 * every band and marker that actually moved, and requiring the component to sit
 * clear of it, closes that gap without computing the restriction.
 *
 * Two cheaper reuse levels sit in front, so a hit does not pay a full prefix:
 *   - per-line BODY, skipped whole when none of that line's bands or markers
 *     changed (this also skips its stripe offsets, the priciest prefix step);
 *   - per-PAIR zone intersections, skipped while both bodies are clean.
 *
 * A face polygon is not the whole of a face. Span intervals are arc lengths
 * measured from each stripe's START, so a covering line that moves ANYWHERE
 * shifts them even when the face polygon is untouched — and that shift persists
 * into later frames which do not touch that line at all. So each cached
 * component records `spanHash`, the combined per-line hash of its cover at the
 * moment its spans were measured; a mismatch re-measures, and the result is
 * written BACK into the cache. Refreshing only the copy handed out would leave
 * the cache frozen at the last full rebuild, and stored region anchors would
 * bind against stale arc positions.
 *
 * Correctness is pinned by `regionIncremental.test.ts`, which asserts the
 * incremental result equals a full rebuild — covers, polygons AND spans —
 * across a drag, a deletion and a stripe permutation, AND that reuse actually
 * fires: without the latter, a builder that never reuses passes everything.
 */
import type { LineId } from '../model/types';
import type { SegmentBandSpec, StopMarkerSpec } from './interlining';
import type { Face, Ring } from './clip';
import { intersect } from './clip';
import {
  boxesOverlap,
  buildLineBodies,
  extractFaces,
  finalizeFaces,
  refreshFaceSpans,
  restrictBodiesToZone,
  ringsBbox,
  subdivideCells,
  zoneComponents,
  type RegionFace,
  type RegionSliver,
} from './lineRegions';

type Box = { x0: number; y0: number; x1: number; y1: number };

/** One component's built output, keyed in the cache by {@link compCacheKey}. */
interface CachedComponent {
  faces: RegionFace[];
  slivers: RegionSliver[];
  /** Combined cover-line hash at the moment `faces`' spans were measured. */
  spanHash: number;
}

/**
 * One independently-movable piece of body geometry: a band stripe or a stop
 * marker, with a content hash and a CONSERVATIVE box of everything it can paint.
 */
export interface GeomUnit {
  hash: number;
  box: Box;
}

/** Carried between frames. Opaque to callers; pass the previous one back in. */
export interface RegionIncrementalState {
  /** Per-line hash of the bands + markers forming its body. */
  lineHash: Map<LineId, number>;
  /** Per band-stripe / per marker geometry unit, for locating what moved. */
  units: Map<string, GeomUnit>;
  bodies: Map<LineId, Ring[]>;
  /** `a|b` → that pair's body intersection, reusable while both bodies are. */
  pairParts: Map<string, Ring[]>;
  zone: Ring[];
  /** Significant components of `zone`, cached with it (same polytree pass). */
  zoneComps: Face[];
  comps: Map<string, CachedComponent>;
}

export interface RegionIncrementalResult {
  faces: RegionFace[];
  slivers: RegionSliver[];
  state: RegionIncrementalState;
  /** True when no component needed rebuilding. */
  reused: boolean;
  /** Components rebuilt this frame, out of the total. */
  rebuilt: number;
  total: number;
}

// FNV-1a over coordinates quantized to clipper's own 1e-3 resolution, so the
// hash cannot distinguish inputs clipper itself would treat as identical.
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const mix = (h: number, v: number): number => Math.imul(h ^ (v | 0), FNV_PRIME) >>> 0;
const mixNum = (h: number, v: number): number => mix(h, Math.round(v * 1000));

function mixString(h: number, s: string): number {
  let out = h;
  for (let i = 0; i < s.length; i++) out = mix(out, s.charCodeAt(i));
  return out;
}

/**
 * Hash one ring independently of where its vertex list starts. Clipper is free
 * to emit the same polygon rotated to a different first vertex when unrelated
 * input moved; without canonicalizing, reuse never fires.
 */
function hashRingCanonical(ring: Ring): number {
  const n = ring.length;
  if (!n) return FNV_OFFSET;
  const qx = (i: number) => Math.round(ring[i].x * 1000);
  const qy = (i: number) => Math.round(ring[i].y * 1000);
  let start = 0;
  for (let i = 1; i < n; i++) {
    const dx = qx(i) - qx(start);
    if (dx < 0 || (dx === 0 && qy(i) < qy(start))) start = i;
  }
  let h = mix(FNV_OFFSET, n);
  for (let i = 0; i < n; i++) {
    const j = (start + i) % n;
    h = mix(h, qx(j));
    h = mix(h, qy(j));
  }
  return h;
}

/** Order-independent hash of a ring set (clipper does not promise ring order). */
function hashRings(rings: Ring[]): number {
  const per = rings.map(hashRingCanonical).sort((a, b) => a - b);
  let h = mix(FNV_OFFSET, per.length);
  for (const x of per) h = mix(h, x);
  return h;
}

/**
 * Cache key for one zone component: the ring hash, then cheap structural
 * discriminators (ring count, vertex count, quantized bbox). The 32-bit hash
 * does the real work; the discriminators exist because this cache runs per
 * pointermove for hours and a silent 32-bit collision would hand out the WRONG
 * component's faces — with them, two components must collide in the hash AND
 * agree on shape statistics and position at once to alias.
 */
export function compCacheKey(comp: Face, box: Box): string {
  let verts = 0;
  for (const ring of comp) verts += ring.length;
  const q = (v: number) => Math.round(v * 1000);
  return (
    `${hashRings(comp)}|${comp.length}|${verts}|` +
    `${q(box.x0)},${q(box.y0)},${q(box.x1)},${q(box.y1)}`
  );
}

const growBox = (b: Box, pad: number): Box => ({
  x0: b.x0 - pad,
  y0: b.y0 - pad,
  x1: b.x1 + pad,
  y1: b.y1 + pad,
});

/**
 * Combined hash of the lines covering `faces`, as of this frame. Two frames
 * agreeing on this agree that every covering line is geometrically unchanged,
 * which is exactly the condition under which arc-length spans stay valid.
 */
function coverHash(faces: RegionFace[], lineHash: Map<LineId, number>): number {
  const ids = new Set<LineId>();
  for (const f of faces) for (const id of f.lineIds) ids.add(id);
  let h = mix(FNV_OFFSET, ids.size);
  for (const id of [...ids].sort()) h = mix(h, lineHash.get(id) ?? 0);
  return h;
}

/**
 * Every independently-movable piece of body geometry — one entry per band
 * stripe and per stop marker — with a content hash and a CONSERVATIVE bounding
 * box of the area its painted body can occupy.
 *
 * The boxes only ever need to be supersets: they are used to decide which
 * components sit clear of everything that moved, so over-estimating costs a
 * needless rebuild while under-estimating would be a correctness bug. A stripe
 * body is bounded by its centerline box grown by the corner radius, the stripe
 * offset and half the stroke width; a marker by its square's circumradius.
 */
export function hashUnits(
  bands: SegmentBandSpec[],
  markers: StopMarkerSpec[],
): { units: Map<string, GeomUnit>; lineOf: Map<string, LineId> } {
  const units = new Map<string, GeomUnit>();
  const lineOf = new Map<string, LineId>();

  for (const band of bands) {
    let cx0 = Infinity;
    let cy0 = Infinity;
    let cx1 = -Infinity;
    let cy1 = -Infinity;
    let ch = mix(FNV_OFFSET, band.centerline.length);
    for (let i = 0; i < band.centerline.length; i++) {
      const p = band.centerline[i];
      const qx = Math.round(p.x * 1000);
      const qy = Math.round(p.y * 1000);
      ch = mix(ch, qx);
      ch = mix(ch, qy);
      cx0 = Math.min(cx0, p.x);
      cy0 = Math.min(cy0, p.y);
      cx1 = Math.max(cx1, p.x);
      cy1 = Math.max(cy1, p.y);
    }
    for (let k = 0; k < band.lines.length; k++) {
      const key = `b:${band.bandKey}#${k}`;
      let h = mixNum(ch, band.radius);
      h = mixNum(h, band.stripeOffsets[k]);
      h = mixNum(h, band.stripeWidths[k]);
      // WHICH line owns this slot is part of the unit, not just bookkeeping:
      // `bandKey` is built from SORTED ids, so two lines swapping stripe slots
      // leaves every key and every geometric field identical while inverting
      // the cover of every face the band crosses.
      h = mixString(h, band.lines[k].id);
      // The offset path stays within the centerline's box grown by the stripe
      // offset (corner fillets cut INWARD, so the radius adds nothing), and the
      // stroke adds half a width. +1 of slack covers flattening chord error.
      const pad = Math.abs(band.stripeOffsets[k]) + band.stripeWidths[k] / 2 + 1;
      units.set(key, {
        hash: h,
        box: growBox({ x0: cx0, y0: cy0, x1: cx1, y1: cy1 }, pad),
      });
      lineOf.set(key, band.lines[k].id);
    }
  }

  for (const m of markers) {
    const key = `m:${m.lineId}#${m.stationId}`;
    let h = mixNum(FNV_OFFSET, m.cx);
    h = mixNum(h, m.cy);
    h = mixNum(h, m.rotationDeg);
    h = mixNum(h, m.width);
    h = mixString(h, m.style);
    // The line END reshapes the marker's painted footprint (markerBodyRings)
    // while every other field here stays put — it is the ONLY thing that moves
    // when a terminus goes square → short → round, so without it the line never
    // goes dirty and the previous frame's footprint is reused under a cache key
    // that claims to be current.
    h = mixString(h, m.end);
    h = m.outward ? mixNum(mixNum(mix(h, 1), m.outward.x), m.outward.y) : mix(h, 0);
    const pad = m.width; // > half-diagonal (w·0.707) for any rotation
    units.set(key, {
      hash: h,
      box: { x0: m.cx - pad, y0: m.cy - pad, x1: m.cx + pad, y1: m.cy + pad },
    });
    lineOf.set(key, m.lineId);
  }
  return { units, lineOf };
}

/**
 * The overlap zone, reusing each pair's body intersection while neither of its
 * two bodies changed. This is the expensive half of the prefix — O(lines²)
 * whole-body clipper intersections — and a station move dirties only the two or
 * three lines passing through it, so most pairs are answerable from cache.
 * Bbox-rejected pairs are cached as empty so the map stays total.
 */
function buildZoneCached(
  ids: LineId[],
  bodies: Map<LineId, Ring[]>,
  dirtyLines: ReadonlySet<LineId>,
  prev: RegionIncrementalState | null,
): { zone: Ring[]; zoneComps: Face[]; pairParts: Map<string, Ring[]> } {
  const boxes = new Map(ids.map((id) => [id, ringsBbox(bodies.get(id)!)]));
  const pairParts = new Map<string, Ring[]>();
  const parts: Ring[] = [];
  let allReused = prev !== null;

  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i];
      const b = ids[j];
      const key = `${a}|${b}`;
      const cached = prev?.pairParts.get(key);
      if (cached && !dirtyLines.has(a) && !dirtyLines.has(b)) {
        pairParts.set(key, cached);
        parts.push(...cached);
        continue;
      }
      allReused = false;
      const rings = boxesOverlap(boxes.get(a)!, boxes.get(b)!)
        ? intersect(bodies.get(a)!, bodies.get(b)!)
        : [];
      pairParts.set(key, rings);
      parts.push(...rings);
    }
  }

  // Equal pair COUNTS are part of the reuse condition: a removed line leaves
  // every SURVIVING pair clean, so `allReused` alone would return the previous
  // zone with the dead line's territory still in it. A vanished line strictly
  // shrinks the pair set, and a same-size-but-different set cannot have reused
  // every pair (its new pairs are not in the cache), so size is enough.
  if (allReused && prev && prev.pairParts.size === pairParts.size && prev.zone.length) {
    return { zone: prev.zone, zoneComps: prev.zoneComps, pairParts };
  }
  const { zone, comps } = zoneComponents(parts);
  return { zone, zoneComps: comps, pairParts };
}

const emptyState = (
  lineHash: Map<LineId, number>,
  units: Map<string, GeomUnit>,
): RegionIncrementalState => ({
  lineHash,
  units,
  bodies: new Map(),
  pairParts: new Map(),
  zone: [],
  zoneComps: [],
  comps: new Map(),
});

/**
 * Build the arrangement, reusing whatever the previous frame's `state` makes
 * provably reusable. Pass `null` for a cold build. The result is always
 * identical to `buildOverlapRegions` on the same input.
 */
export function buildRegionsIncremental(
  bands: SegmentBandSpec[],
  markers: StopMarkerSpec[],
  prev: RegionIncrementalState | null,
): RegionIncrementalResult {
  const { units, lineOf } = hashUnits(bands, markers);

  // What moved, and where. A unit that appeared, vanished, or changed hash
  // contributes BOTH its old and new box — geometry that left a place matters
  // as much as geometry that arrived.
  //
  // The WHOLE box, deliberately. Narrowing to the vertices that moved looks
  // safe and is not: `computeArcRadii` (router.ts) shrinks each corner's
  // tangent budget in a single forward pass that writes `tans[i + 1]` in place,
  // so one vertex move can cascade fillet radii along the entire polyline. A
  // band is one station pair, so its box is one segment's worth anyway.
  const dirtyLines = new Set<LineId>();
  const dirtyBoxes: Box[] = [];
  for (const [key, u] of units) {
    const old = prev?.units.get(key);
    if (old && old.hash === u.hash) continue;
    const line = lineOf.get(key);
    if (line) dirtyLines.add(line);
    dirtyBoxes.push(u.box);
    if (old) dirtyBoxes.push(old.box); // where it used to be counts too
  }
  // A unit that vanished leaves its old footprint dirty. Its owning line is
  // caught by the per-line hash comparison below.
  for (const [key, old] of prev?.units ?? []) {
    if (!units.has(key)) dirtyBoxes.push(old.box);
  }

  const lineHash = new Map<LineId, number>();
  for (const [key, u] of units) {
    const id = lineOf.get(key)!;
    lineHash.set(id, mix(lineHash.get(id) ?? FNV_OFFSET, u.hash));
  }
  for (const [id, h] of lineHash) if (prev?.lineHash.get(id) !== h) dirtyLines.add(id);
  for (const id of prev?.lineHash.keys() ?? []) if (!lineHash.has(id)) dirtyLines.add(id);

  const reuse = prev
    ? (id: LineId): Ring[] | undefined =>
        dirtyLines.has(id) ? undefined : (prev.bodies.get(id) ?? undefined)
    : undefined;

  const bodies = buildLineBodies(bands, markers, reuse);
  const ids = [...bodies.keys()].sort();
  if (ids.length < 2) {
    return {
      faces: [],
      slivers: [],
      state: emptyState(lineHash, units),
      reused: false,
      rebuilt: 0,
      total: 0,
    };
  }

  const { zone, zoneComps, pairParts } = buildZoneCached(ids, bodies, dirtyLines, prev);
  if (!zone.length) {
    return {
      faces: [],
      slivers: [],
      state: emptyState(lineHash, units),
      reused: false,
      rebuilt: 0,
      total: 0,
    };
  }

  const comps = zoneComps;
  const nextComps = new Map<string, CachedComponent>();
  const faces: RegionFace[] = [];
  const slivers: RegionSliver[] = [];
  let rebuilt = 0;

  for (const comp of comps) {
    const box = ringsBbox(comp);
    const key = compCacheKey(comp, box);
    const cached = prev?.comps.get(key);
    const untouched = !dirtyBoxes.some((d) => boxesOverlap(d, box));

    if (cached && untouched) {
      // The polygons are right, but the spans may not be: they are arc lengths
      // from each stripe's start, so a covering line that moved anywhere since
      // this component was last measured shifts them. Compare against the cover
      // hash recorded WITH the spans, not against this frame's dirty set — the
      // line may have moved several frames ago and be clean now.
      let entry = cached;
      const spanHash = coverHash(cached.faces, lineHash);
      if (spanHash !== cached.spanHash) {
        const covers = new Set<LineId>();
        for (const f of cached.faces) for (const id of f.lineIds) covers.add(id);
        entry = {
          faces: refreshFaceSpans(cached.faces, bands, covers),
          slivers: cached.slivers,
          spanHash,
        };
      }
      nextComps.set(key, entry);
      // Clone before handing out: `finalizeFaces` stamps `key` in place, and
      // these objects are still owned by the cache.
      faces.push(...entry.faces.map((f) => ({ ...f })));
      slivers.push(...entry.slivers);
      continue;
    }

    rebuilt++;
    const compSlivers: RegionSliver[] = [];
    const built = extractFaces(
      subdivideCells(restrictBodiesToZone(ids, bodies, comp)),
      bands,
      compSlivers,
    );
    nextComps.set(key, {
      faces: built,
      slivers: compSlivers,
      spanHash: coverHash(built, lineHash),
    });
    faces.push(...built);
    slivers.push(...compSlivers);
  }

  const finalized = finalizeFaces(faces);
  return {
    faces: finalized,
    slivers,
    state: { lineHash, units, bodies, pairParts, zone, zoneComps, comps: nextComps },
    reused: rebuilt === 0,
    rebuilt,
    total: comps.length,
  };
}
