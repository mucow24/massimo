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
 * Spans ride the reuse untouched. A face's span intervals are arc lengths
 * measured from the start of each contributing BAND's stripe (keyed per
 * `lineId|pairKey` — never from anywhere on the line as a whole), and any band
 * whose stripe body can contribute a span to a component's face has a unit box
 * overlapping that component's box (the unit box is the centerline box grown
 * by stripe offset + half width + slack — a superset of the painted stripe).
 * So the same `untouched` test that proves the polygons reusable also proves
 * every span-relevant band unchanged: cached spans are byte-identical to a
 * recompute. A cover line changing far away moves its hash but not its boxes,
 * and cannot shift them. Pinned by the distant-band fixture in
 * `regionIncremental.test.ts`.
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
  restrictBodiesToZone,
  ringSetKey,
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
  /**
   * Old + new boxes of every unit that changed, appeared or vanished vs
   * `prev` — the same boxes the component reuse test consumed. Downstream
   * caches (the exclusion-hole cache) apply the identical invalidation
   * scheme at their own granularity.
   */
  dirtyBoxes: Box[];
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
 * Cache key for one zone component: {@link ringSetKey}'s collision-hardened
 * content key (canonical ring hash + structural discriminators + quantized
 * bbox). This cache runs per pointermove for hours and a silent collision
 * would hand out the WRONG component's faces; the key construction — shared
 * with the exclusion-hole cache's face identity — lives in lineRegions.
 */
export function compCacheKey(comp: Face, box: Box): string {
  return ringSetKey(comp, box);
}

const growBox = (b: Box, pad: number): Box => ({
  x0: b.x0 - pad,
  y0: b.y0 - pad,
  x1: b.x1 + pad,
  y1: b.y1 + pad,
});

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
 * Pointwise ring-list equality at clipper's own 1e-3 resolution — the
 * finest distinction the engine can act on (`CLIP_SCALE`), so substituting a
 * content-equal cached array for a fresh one cannot change any downstream
 * boolean. Deliberately order-sensitive (same rings, same order, same start
 * vertex): a stricter compare only costs a missed reuse, never a wrong one.
 */
function ringsContentEqual(a: Ring[], b: Ring[]): boolean {
  if (a.length !== b.length) return false;
  const q = (v: number) => Math.round(v * 1000);
  for (let r = 0; r < a.length; r++) {
    const ra = a[r];
    const rb = b[r];
    if (ra.length !== rb.length) return false;
    for (let i = 0; i < ra.length; i++) {
      if (q(ra[i].x) !== q(rb[i].x) || q(ra[i].y) !== q(rb[i].y)) return false;
    }
  }
  return true;
}

/**
 * The overlap zone, reusing each pair's body intersection while neither of its
 * two bodies changed. This is the expensive half of the prefix — O(lines²)
 * whole-body clipper intersections — and a station move dirties only the two or
 * three lines passing through it, so most pairs are answerable from cache.
 * Bbox-rejected pairs are cached as empty so the map stays total.
 *
 * A pair with a dirty LINE whose intersection came out content-equal anyway
 * (the line moved at a faraway station) keeps the cached array by reference
 * and does not count as changed — the moved-line-crosses-many-stationary-
 * lines case is what keeps the changed set to the crossings that genuinely
 * moved.
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
      const rings = boxesOverlap(boxes.get(a)!, boxes.get(b)!)
        ? intersect(bodies.get(a)!, bodies.get(b)!)
        : [];
      if (cached && ringsContentEqual(cached, rings)) {
        // Clean after all: the intersect had to run to learn it, but the
        // answer is engine-indistinguishable from the cached one.
        pairParts.set(key, cached);
        parts.push(...cached);
        continue;
      }
      allReused = false;
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

  // Both early-outs below carry everything they already paid for. An
  // arrangement can be empty without the FRAME being idle — a document with
  // dormant `regionAssignments` runs this builder on every pointermove, and a
  // map whose lines happen not to cross yet takes one of these exits on all of
  // them. Returning an empty state there would make the next frame re-offset
  // every stripe and re-intersect every pair from scratch: the expensive half
  // of the build, discarded because the cheap half came out empty.
  const bodies = buildLineBodies(bands, markers, reuse);
  const ids = [...bodies.keys()].sort();
  if (ids.length < 2) {
    return {
      faces: [],
      slivers: [],
      // One line has no pairs and therefore no zone, but its body is built.
      state: {
        lineHash,
        units,
        bodies,
        pairParts: new Map(),
        zone: [],
        zoneComps: [],
        comps: new Map(),
      },
      reused: false,
      rebuilt: 0,
      total: 0,
      dirtyBoxes,
    };
  }

  const { zone, zoneComps, pairParts } = buildZoneCached(ids, bodies, dirtyLines, prev);
  if (!zone.length) {
    return {
      faces: [],
      slivers: [],
      state: { lineHash, units, bodies, pairParts, zone, zoneComps, comps: new Map() },
      reused: false,
      rebuilt: 0,
      total: 0,
      dirtyBoxes,
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
      // Spans reuse verbatim with the polygons: every band that can contribute
      // a span here has a unit box overlapping this comp's box (see the header),
      // so `untouched` already proves them unchanged.
      nextComps.set(key, cached);
      // Clone before handing out: `finalizeFaces` stamps `key` in place, and
      // these objects are still owned by the cache.
      faces.push(...cached.faces.map((f) => ({ ...f })));
      slivers.push(...cached.slivers);
      continue;
    }

    rebuilt++;
    const compSlivers: RegionSliver[] = [];
    const built = extractFaces(
      subdivideCells(restrictBodiesToZone(ids, bodies, comp)),
      bands,
      compSlivers,
    );
    nextComps.set(key, { faces: built, slivers: compSlivers });
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
    dirtyBoxes,
  };
}
