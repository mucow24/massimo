/**
 * Region building for "paint by numbers" line layering: the faces of the
 * planar arrangement formed by all lines' painted bodies, plus the anchor
 * machinery that lets a stored RegionAssignment track its face through
 * geometry edits.
 *
 * Bodies are built by round-join/butt-cap stroking of each stripe's offset
 * path (the same path the renderer strokes), so the region boundaries track
 * the painted pixels — including at degenerate inner corners where the ±w/2
 * edge segments would mislead (they miter-cap while the paint rounds).
 * Marker squares join a body only where the marker actually renders.
 */
import type { LineId, RegionAnchor, RegionAssignment } from '../model/types';
import type { SegmentBandSpec, StopMarkerSpec } from './interlining';
import type { OffsetPathSegment } from './router';
import { emitOffsetSegments } from './router';
import { clamp } from '../util/grid';
import { closestParamOnOffsetPath, sampleOffsetPathByArcLength } from './lineTagGeometry';
import { leftNormal, perp, rotatedRectCorners, type Vec2 } from './vec';
import { markerEndRing } from './markerEnd';
import {
  type Face,
  type Ring,
  interiorPoint,
  intersect,
  offsetClosed,
  offsetOpenPath,
  pointInFace,
  faceArea,
  splitIntoFaces,
  subtract,
  unionAll,
} from './clip';

/** Arc flattening chord tolerance, world units. */
export const FLATTEN_TOL = 0.01;

/** Faces that vanish under this erosion depth are hairline slivers. */
export const SLIVER_ERODE = 0.15;

/** Arc-length sampling step for face spans, world units. */
const SPAN_STEP = 2;

export interface RegionSpanEntry {
  /** Arc-length intervals of the stripe path inside the face. */
  intervals: { d0: number; d1: number }[];
  /** Total arc length of that stripe path. */
  totalLen: number;
}

export interface RegionFace {
  /** Render key: cover + rounded bbox center + index (collision-proof). */
  key: string;
  /** Sorted covering line ids. */
  lineIds: LineId[];
  /** Outer ring + holes, world space. */
  face: Face;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  area: number;
  /** `${lineId}|${pairKey}` → where that line's stripe runs inside this face. */
  spans: Map<string, RegionSpanEntry>;
}

/**
 * A dropped overlap sliver: territory the {@link SLIVER_ERODE} morphological
 * opening removed from the clickable arrangement (hairline faces and the neck
 * residue between split lobes). NOT a region — it has no anchors, no spans, and
 * is never a click target. It is carried only so {@link buildExclusionHoles}
 * can absorb it into an adjacent bridge, keeping a winner's revealed casing
 * continuous across the gap the erosion left (at near-tangent fillets a sliver
 * sits between two real bridged faces; without it the reveal notches there).
 */
export interface RegionSliver {
  /** Sorted covering line ids of the dropped arrangement cell. */
  lineIds: LineId[];
  /** Outer ring + holes, world space. */
  face: Face;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

/** Dropped slivers below this area are clipper dust — never collected. */
const SLIVER_MIN_AREA = 0.02;

/**
 * How far past a bridging face a reveal follows a dropped sliver, world units
 * (see {@link buildExclusionHoles}). Big enough to close a near-tangent fillet
 * gap (the sliver between two bridged faces at an inner corner); bounded so a
 * long tangent corridor sharing the winner+loser is bridged only near the
 * junction, not painted over along its whole length.
 */
export const SLIVER_ABSORB_REACH = 2;

/** Flatten line/arc offset segments into a polyline by chord tolerance. */
export function flattenOffsetSegments(segs: OffsetPathSegment[], tol = FLATTEN_TOL): Vec2[] {
  const pts: Vec2[] = [];
  const push = (p: Vec2) => {
    const last = pts[pts.length - 1];
    if (!last || Math.abs(last.x - p.x) > 1e-9 || Math.abs(last.y - p.y) > 1e-9) pts.push(p);
  };
  for (const s of segs) {
    push(s.from);
    if (s.kind === 'arc') {
      // Chord error e = r(1 − cos(dψ/2)) ⇒ dψ = 2·acos(1 − e/r), clamped so
      // tiny radii (inner fillets shrink arbitrarily) can't NaN the acos.
      const cosArg = clamp(1 - tol / s.r, -1, 1);
      const maxStep = 2 * Math.acos(cosArg);
      const n = clamp(Math.ceil(s.theta / Math.max(maxStep, 1e-4)), 1, 256);
      // p(ψ) = from + r·(sin ψ · inDir + sign·(1 − cos ψ)·perp(inDir)) — the
      // exact parametrization lineTagGeometry samples with.
      const pp = perp(s.inDir);
      for (let i = 1; i < n; i++) {
        const psi = (s.theta * i) / n;
        const a = Math.sin(psi);
        const b = s.sign * (1 - Math.cos(psi));
        push({
          x: s.from.x + s.r * (a * s.inDir.x + b * pp.x),
          y: s.from.y + s.r * (a * s.inDir.y + b * pp.y),
        });
      }
    }
    push(s.to);
  }
  return pts;
}

/** The painted body of one stripe: round-join, butt-cap stroke outline. */
export function stripeBodyPolys(band: SegmentBandSpec, stripeIndex: number): Ring[] {
  const { pts } = stripePathFor(band, stripeIndex);
  return offsetOpenPath(pts, band.stripeWidths[stripeIndex] / 2);
}

/**
 * The rendered footprint of a stop marker, or nothing when the marker paints
 * nothing (patterned styles at interior stops).
 */
function markerBodyRings(spec: StopMarkerSpec): Ring[] {
  const half = spec.width / 2;
  const center = { x: spec.cx, y: spec.cy };
  // A reshaped line end (see markerEnd.ts) replaces the square outright, for
  // every style that paints a shape — same helper the painter uses, so the
  // cover is the paint.
  const endShape = spec.outward && spec.end !== 'square' ? spec.end : null;
  if (spec.style === 'solid' || spec.style === 'hatched' || spec.style === 'hatched-mirror') {
    if (endShape && spec.outward) return [markerEndRing(center, spec.outward, half, endShape)];
    const rad = (spec.rotationDeg * Math.PI) / 180;
    return [Array.from(rotatedRectCorners(center, half, half, rad))];
  }
  // Patterned (dashed/dotted/dashed-open): nothing at interior stops; a
  // width/2-long, width-wide stub continuing outward at a terminus — and
  // nothing at all when that end is short, since the stub IS the outward half
  // the style drops.
  if (!spec.outward || endShape) return [];
  const o = spec.outward;
  const px = -o.y;
  const py = o.x;
  const end = { x: center.x + o.x * half, y: center.y + o.y * half };
  return [
    [
      { x: center.x + px * half, y: center.y + py * half },
      { x: end.x + px * half, y: end.y + py * half },
      { x: end.x - px * half, y: end.y - py * half },
      { x: center.x - px * half, y: center.y - py * half },
    ],
  ];
}

/** Per-line painted body: union of stripe bodies + rendering marker squares. */
export function buildLineBodies(
  bands: SegmentBandSpec[],
  markers: StopMarkerSpec[],
  reuse?: (id: LineId) => Ring[] | undefined,
): Map<LineId, Ring[]> {
  const raw = new Map<LineId, Ring[]>();
  const reused = new Map<LineId, Ring[]>();
  const notReusable = new Set<LineId>();
  // A reusable line short-circuits before its stripe outline is ever offset —
  // the offsets are the expensive part of this pass, so the ring producer is
  // deliberately a thunk rather than an argument.
  const isReused = (id: LineId): boolean => {
    if (reused.has(id)) return true;
    if (!reuse || notReusable.has(id)) return false;
    const cached = reuse(id);
    if (cached) {
      reused.set(id, cached);
      return true;
    }
    notReusable.add(id);
    return false;
  };
  const add = (id: LineId, rings: () => Ring[]) => {
    if (isReused(id)) return;
    const r = rings();
    if (!r.length) return;
    const list = raw.get(id);
    if (list) list.push(...r);
    else raw.set(id, [...r]);
  };
  for (const band of bands) {
    for (let k = 0; k < band.lines.length; k++) {
      add(band.lines[k].id, () => stripeBodyPolys(band, k));
    }
  }
  for (const m of markers) add(m.lineId, () => markerBodyRings(m));
  const out = new Map<LineId, Ring[]>(reused);
  for (const [id, rings] of raw) {
    const merged = unionAll(rings);
    if (merged.length) out.set(id, merged);
  }
  return out;
}

/**
 * Face geometry is independent of where a stripe runs OUTSIDE the overlap zone,
 * but {@link computeSpans} is not: it measures arc length from each stripe's
 * start, so a band that moves anywhere along a covering line shifts that face's
 * span intervals even when the face polygon is untouched. An incremental
 * rebuild that reuses face geometry must therefore still refresh the spans of
 * every face covered by a line whose bands changed, or stored region anchors
 * bind against stale arc positions.
 *
 * Returns fresh face objects (geometry shared, spans replaced) for affected
 * faces; untouched faces are returned by reference.
 */
export function refreshFaceSpans(
  faces: RegionFace[],
  bands: SegmentBandSpec[],
  dirtyLines: ReadonlySet<LineId>,
): RegionFace[] {
  if (!dirtyLines.size) return faces;
  return faces.map((f) =>
    f.lineIds.some((id) => dirtyLines.has(id))
      ? { ...f, spans: computeSpans(f.face, f.bbox, f.lineIds, bands) }
      : f,
  );
}

// ---------------------------------------------------------------------------
// Stripe-path sampling (flattened once per band spec, WeakMap-cached — band
// specs are rebuilt objects whenever geometry changes, so the cache can never
// serve stale paths).

interface StripePath {
  pts: Vec2[];
  /** Cumulative arc length at each vertex; cum[0] = 0. */
  cum: number[];
  len: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

const stripePathCache = new WeakMap<SegmentBandSpec, Map<number, StripePath>>();

function stripePathFor(band: SegmentBandSpec, stripeIndex: number): StripePath {
  let byIndex = stripePathCache.get(band);
  if (!byIndex) {
    byIndex = new Map();
    stripePathCache.set(band, byIndex);
  }
  const hit = byIndex.get(stripeIndex);
  if (hit) return hit;
  const pts = flattenOffsetSegments(
    emitOffsetSegments(band.centerline, band.radius, band.stripeOffsets[stripeIndex]),
  );
  const cum = [0];
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    x0 = Math.min(x0, pts[i].x);
    y0 = Math.min(y0, pts[i].y);
    x1 = Math.max(x1, pts[i].x);
    y1 = Math.max(y1, pts[i].y);
  }
  const sp: StripePath = { pts, cum, len: cum[cum.length - 1] ?? 0, bbox: { x0, y0, x1, y1 } };
  byIndex.set(stripeIndex, sp);
  return sp;
}

function pointAtArcLength(sp: StripePath, d: number): Vec2 {
  const target = clamp(d, 0, sp.len);
  let lo = 0;
  let hi = sp.cum.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (sp.cum[mid] <= target) lo = mid;
    else hi = mid;
  }
  const span = sp.cum[hi] - sp.cum[lo];
  const t = span > 0 ? (target - sp.cum[lo]) / span : 0;
  return {
    x: sp.pts[lo].x + (sp.pts[hi].x - sp.pts[lo].x) * t,
    y: sp.pts[lo].y + (sp.pts[hi].y - sp.pts[lo].y) * t,
  };
}

export const boxesOverlap = (
  a: { x0: number; y0: number; x1: number; y1: number },
  b: { x0: number; y0: number; x1: number; y1: number },
  pad = 0,
) => a.x0 <= b.x1 + pad && b.x0 <= a.x1 + pad && a.y0 <= b.y1 + pad && b.y0 <= a.y1 + pad;

// ---------------------------------------------------------------------------
// Overlap faces

export function ringsBbox(rings: Ring[]): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const ring of rings) {
    for (const p of ring) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
  }
  return { x0, y0, x1, y1 };
}

function computeSpans(
  face: Face,
  bbox: { x0: number; y0: number; x1: number; y1: number },
  cover: LineId[],
  bands: SegmentBandSpec[],
): Map<string, RegionSpanEntry> {
  const spans = new Map<string, RegionSpanEntry>();
  const coverSet = new Set(cover);
  for (const band of bands) {
    for (let k = 0; k < band.lines.length; k++) {
      const lineId = band.lines[k].id;
      if (!coverSet.has(lineId)) continue;
      const sp = stripePathFor(band, k);
      // The stripe's painted body extends half a width past the path bbox.
      if (!boxesOverlap(sp.bbox, bbox, band.stripeWidths[k] / 2)) continue;
      const intervals: { d0: number; d1: number }[] = [];
      let runStart: number | null = null;
      for (let d = 0; ; d += SPAN_STEP) {
        const at = Math.min(d, sp.len);
        const inside = pointInFace(pointAtArcLength(sp, at), face);
        if (inside && runStart === null) runStart = Math.max(0, at - SPAN_STEP / 2);
        if (!inside && runStart !== null) {
          intervals.push({ d0: runStart, d1: Math.min(sp.len, at - SPAN_STEP / 2) });
          runStart = null;
        }
        if (at >= sp.len) break;
      }
      if (runStart !== null) intervals.push({ d0: runStart, d1: sp.len });
      if (intervals.length) {
        spans.set(`${lineId}|${band.pairKey}`, { intervals, totalLen: sp.len });
      }
    }
  }
  return spans;
}

/**
 * All overlap faces (cover ≥ 2 lines) of the current geometry, composing the
 * phases above in one full rebuild.
 *
 * NOT the production path — nothing outside tests calls this. The app builds
 * faces through `regionIncremental.buildRegionsIncremental`, which reuses these
 * same phases per component across frames; this is the reference it is asserted
 * equal to, so keep it the obvious, cache-free composition. Territory that the
 * sliver erosion drops is pushed into `sliverSink` when one is supplied (see
 * {@link RegionSliver}); callers that only want faces omit it and pay nothing.
 */
export function buildOverlapRegions(
  bands: SegmentBandSpec[],
  markers: StopMarkerSpec[],
  sliverSink?: RegionSliver[],
): RegionFace[] {
  const bodies = buildLineBodies(bands, markers);
  const ids = [...bodies.keys()].sort();
  if (ids.length < 2) return [];
  const zone = buildOverlapZone(ids, bodies);
  if (!zone.length) return [];
  // Component-at-a-time. Cells cannot span components, so this yields the same
  // faces as one global subdivision while keeping every clipper operand down to
  // one crossing's worth of geometry — and it is the seam the incremental
  // builder caches on.
  const faces: RegionFace[] = [];
  for (const comp of significantComponents(zone)) {
    faces.push(
      ...extractFaces(subdivideCells(restrictBodiesToZone(ids, bodies, comp)), bands, sliverSink),
    );
  }
  return finalizeFaces(faces);
}

/**
 * The pairwise-overlap zone: any ≥2-cover point lies in some pairwise body
 * intersection, so cells inside this zone subdivide exactly as they would in
 * the full arrangement, at a fraction of the cost.
 */
export function buildOverlapZone(ids: LineId[], bodies: Map<LineId, Ring[]>): Ring[] {
  const boxes = new Map(ids.map((id) => [id, ringsBbox(bodies.get(id)!)]));
  const zoneParts: Ring[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      if (!boxesOverlap(boxes.get(ids[i])!, boxes.get(ids[j])!)) continue;
      zoneParts.push(...intersect(bodies.get(ids[i])!, bodies.get(ids[j])!));
    }
  }
  if (!zoneParts.length) return [];
  return unionAll(zoneParts);
}

/** Each line's body clipped to the zone, in `ids` order; empties dropped. */
export function restrictBodiesToZone(
  ids: LineId[],
  bodies: Map<LineId, Ring[]>,
  zone: Ring[],
): { id: LineId; rings: Ring[] }[] {
  const out: { id: LineId; rings: Ring[] }[] = [];
  // Most lines are nowhere near any one component; a bbox reject is far cheaper
  // than asking clipper for an empty intersection.
  const zoneBox = ringsBbox(zone);
  for (const id of ids) {
    const body = bodies.get(id)!;
    if (!boxesOverlap(ringsBbox(body), zoneBox)) continue;
    const rings = intersect(body, zone);
    if (rings.length) out.push({ id, rings });
  }
  return out;
}

/**
 * Iterative cell splitting: each cell is a maximal area with one cover set.
 * Order-dependent — callers must pass `restricted` in a stable (sorted) order.
 */
export function subdivideCells(
  restricted: { id: LineId; rings: Ring[] }[],
): { cover: LineId[]; rings: Ring[] }[] {
  let cells: { cover: LineId[]; rings: Ring[] }[] = [];
  for (const { id, rings } of restricted) {
    const next: typeof cells = [];
    let remaining = rings;
    for (const cell of cells) {
      const inter = intersect(cell.rings, remaining);
      if (!inter.length) {
        next.push(cell);
        continue;
      }
      const diff = subtract(cell.rings, remaining);
      remaining = subtract(remaining, cell.rings);
      next.push({ cover: [...cell.cover, id], rings: inter });
      if (diff.length) next.push({ cover: cell.cover, rings: diff });
    }
    if (remaining.length) next.push({ cover: [id], rings: remaining });
    cells = next;
  }
  return cells;
}

/**
 * Connected components of the zone, minus the ones too small to matter.
 *
 * Splitting here is what makes an incremental rebuild possible: cells never
 * span two components (every cell is a subset of the zone, and disjoint
 * territory cannot interact through intersect/subtract), so each component's
 * faces can be computed — and cached — independently.
 *
 * Sub-`SLIVER_MIN_AREA` components are dropped because they cannot reach either
 * output: a cell is a subset of its component, so any face or sliver it yields
 * is at most that area, and both `pushFace`'s erosion and `addSliver`'s area
 * test already discard those. They are also ~95% of components by count (426 on
 * the DKLB map, ~20 above the threshold) and they churn constantly, so keeping
 * them would defeat caching for no output.
 */
export function significantComponents(zone: Ring[]): Face[] {
  const out: Face[] = [];
  for (const comp of splitIntoFaces(zone)) {
    if (faceArea(comp) < SLIVER_MIN_AREA) continue;
    out.push(comp);
  }
  return out;
}

/**
 * Sort faces back-to-front and stamp render keys. Split out of face extraction
 * because an incremental build assembles its face list from several components
 * (some freshly built, some reused) and must key the merged result exactly as a
 * single-pass build would.
 */
export function finalizeFaces(faces: RegionFace[]): RegionFace[] {
  faces.sort(
    (a, b) =>
      a.bbox.y0 - b.bbox.y0 ||
      a.bbox.x0 - b.bbox.x0 ||
      (a.lineIds.join(',') < b.lineIds.join(',') ? -1 : 1),
  );
  faces.forEach((f, i) => {
    const cx = Math.round((f.bbox.x0 + f.bbox.x1) / 2);
    const cy = Math.round((f.bbox.y0 + f.bbox.y1) / 2);
    f.key = `${f.lineIds.join(',')}@${cx},${cy}#${i}`;
  });
  return faces;
}

/**
 * Split cells into clickable faces, applying the sliver-opening morphology.
 * Returns them UNSORTED and UNKEYED — run {@link finalizeFaces} over the
 * complete set once every component has contributed.
 */
export function extractFaces(
  cells: { cover: LineId[]; rings: Ring[] }[],
  bands: SegmentBandSpec[],
  sliverSink?: RegionSliver[],
): RegionFace[] {
  const out: RegionFace[] = [];
  const pushFace = (face: Face, cover: LineId[]) => {
    const bbox = ringsBbox([face[0]]);
    const lineIds = [...cover].sort();
    out.push({
      key: '',
      lineIds,
      face,
      bbox,
      area: faceArea(face),
      spans: computeSpans(face, bbox, lineIds, bands),
    });
  };
  const addSliver = (rings: Ring[], cover: LineId[]) => {
    if (!sliverSink) return;
    const lineIds = [...cover].sort();
    for (const rf of splitIntoFaces(rings)) {
      if (faceArea(rf) < SLIVER_MIN_AREA) continue;
      sliverSink.push({ lineIds, face: rf, bbox: ringsBbox([rf[0]]) });
    }
  };
  for (const cell of cells) {
    if (cell.cover.length < 2) continue;
    for (const face of splitIntoFaces(cell.rings)) {
      const eroded = offsetClosed(face, -SLIVER_ERODE);
      if (!eroded.length) {
        addSliver(face, cell.cover); // whole face is a hairline sliver
        continue;
      }
      // Morphological opening: a face made of REAL lobes joined by hairline
      // necks (near-tangent parallel corridors, marker-corner grazes) must
      // not act as one region — clicking one crossing would flip another far
      // away. Erosion splits at the necks; each surviving lobe reclaims its
      // share of the original face and becomes its own clickable region.
      const lobes = splitIntoFaces(eroded);
      if (lobes.length <= 1) {
        pushFace(face, cell.cover);
        continue;
      }
      let remaining: Ring[] = [...face];
      for (const lobe of lobes) {
        const blob = intersect(remaining, offsetClosed(lobe, SLIVER_ERODE * 2 + 0.05));
        if (!blob.length) continue;
        for (const piece of splitIntoFaces(blob)) {
          if (offsetClosed(piece, -SLIVER_ERODE).length) pushFace(piece, cell.cover);
          else addSliver(piece, cell.cover); // reclaimed piece still sub-sliver
        }
        remaining = subtract(remaining, blob);
      }
      addSliver(remaining, cell.cover); // leftover neck residue between lobes
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Anchors: mint, evaluate, bind

/**
 * Fresh anchors for a face: one per covering line, at its span midpoint.
 * A cover line whose stripe CENTER path doesn't cross the face (small corner
 * faces sit inside the stripe body but off its center; marker-only cover)
 * gets a projection fallback: the arc position on its nearest stripe.
 */
export function mintAnchors(face: RegionFace, bands: SegmentBandSpec[]): RegionAnchor[] {
  const anchors: RegionAnchor[] = [];
  let fallbackTarget: Vec2 | undefined;
  for (const lineId of face.lineIds) {
    let best: { pairKey: string; mid: number; totalLen: number; size: number } | null = null;
    for (const [key, entry] of face.spans) {
      if (!key.startsWith(`${lineId}|`)) continue;
      const pairKey = key.slice(lineId.length + 1);
      for (const iv of entry.intervals) {
        const size = iv.d1 - iv.d0;
        if (!best || size > best.size) {
          best = { pairKey, mid: (iv.d0 + iv.d1) / 2, totalLen: entry.totalLen, size };
        }
      }
    }
    let side = 0;
    if (!best) {
      if (fallbackTarget === undefined) {
        fallbackTarget = interiorPoint(face.face) ?? {
          x: (face.bbox.x0 + face.bbox.x1) / 2,
          y: (face.bbox.y0 + face.bbox.y1) / 2,
        };
      }
      const projected = projectOntoLineStripe(lineId, fallbackTarget, bands);
      if (projected) {
        best = projected;
        side = projected.side;
      }
    }
    if (!best) continue;
    const nearFrom = best.mid <= best.totalLen / 2;
    anchors.push({
      lineId,
      pairKey: best.pairKey,
      anchorEnd: nearFrom ? 'from' : 'to',
      distance: nearFrom ? best.mid : best.totalLen - best.mid,
      ...(side !== 0 ? { side } : {}),
    });
  }
  return anchors;
}

/**
 * Nearest arc position to `target` across all of a line's stripes, plus the
 * signed perpendicular offset (leftNormal frame, capped to the half-width)
 * that points from the path back toward the target.
 */
function projectOntoLineStripe(
  lineId: LineId,
  target: Vec2,
  bands: SegmentBandSpec[],
): { pairKey: string; mid: number; totalLen: number; size: number; side: number } | null {
  let best: {
    pairKey: string;
    mid: number;
    totalLen: number;
    size: number;
    side: number;
  } | null = null;
  let bestDist = Infinity;
  for (const band of bands) {
    const k = band.lines.findIndex((l) => l.id === lineId);
    if (k < 0) continue;
    const sp = stripePathFor(band, k);
    if (
      target.x < sp.bbox.x0 - bestDist ||
      target.x > sp.bbox.x1 + bestDist ||
      target.y < sp.bbox.y0 - bestDist ||
      target.y > sp.bbox.y1 + bestDist
    ) {
      continue;
    }
    const { t, dist } = closestParamOnOffsetPath(
      band.centerline,
      band.radius,
      band.stripeOffsets[k],
      target,
    );
    if (dist < bestDist) {
      bestDist = dist;
      const d = t * sp.len;
      const at = sampleOffsetPathByArcLength(
        band.centerline,
        band.radius,
        band.stripeOffsets[k],
        d,
      );
      const n = leftNormal(at.tangent);
      const half = band.stripeWidths[k] / 2;
      const raw = (target.x - at.p.x) * n.x + (target.y - at.p.y) * n.y;
      const side = clamp(raw, -half, half);
      best = { pairKey: band.pairKey, mid: d, totalLen: sp.len, size: 0, side };
    }
  }
  return best;
}

/**
 * Total arc length of a line's stripe in a corridor, or null when the line
 * has no stripe there. Used by reconcile's anchor translation to walk
 * distances across edge splits/heals.
 */
export function stripeArcLength(
  bands: SegmentBandSpec[],
  pairKey: string,
  lineId: LineId,
): number | null {
  for (const band of bands) {
    if (band.pairKey !== pairKey) continue;
    const k = band.lines.findIndex((l) => l.id === lineId);
    if (k < 0) continue;
    return stripePathFor(band, k).len;
  }
  return null;
}

/**
 * Evaluate an anchor under current geometry: the world point (side offset
 * applied) and absolute arc-length position (from the canonical 'from' end)
 * along its stripe. Null when the corridor no longer exists for that line.
 */
export function evaluateAnchor(
  anchor: RegionAnchor,
  bands: SegmentBandSpec[],
): { p: Vec2; d: number } | null {
  for (const band of bands) {
    if (band.pairKey !== anchor.pairKey) continue;
    const k = band.lines.findIndex((l) => l.id === anchor.lineId);
    if (k < 0) continue;
    const sp = stripePathFor(band, k);
    const raw = anchor.anchorEnd === 'from' ? anchor.distance : sp.len - anchor.distance;
    const d = clamp(raw, 0, sp.len);
    const side = anchor.side ?? 0;
    if (side === 0) return { p: pointAtArcLength(sp, d), d };
    const at = sampleOffsetPathByArcLength(band.centerline, band.radius, band.stripeOffsets[k], d);
    const n = leftNormal(at.tangent);
    return { p: { x: at.p.x + n.x * side, y: at.p.y + n.y * side }, d };
  }
  return null;
}

/** World distance from a point to a face: 0 inside, else to the outer ring. */
function pointToFaceDistance(p: Vec2, face: RegionFace): number {
  const b = face.bbox;
  const dx = Math.max(b.x0 - p.x, 0, p.x - b.x1);
  const dy = Math.max(b.y0 - p.y, 0, p.y - b.y1);
  const bboxDist = Math.hypot(dx, dy);
  if (bboxDist > 0) {
    // Outside the bbox: segment-exact distance still ≥ bboxDist; the bbox
    // value is enough for ranking distant candidates. Refine only when near.
    if (bboxDist > 4) return bboxDist;
  }
  if (pointInFace(p, face.face)) return 0;
  const ring = face.face[0];
  let min = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const c = ring[(i + 1) % ring.length];
    const ex = c.x - a.x;
    const ey = c.y - a.y;
    const lenSq = ex * ex + ey * ey;
    const t = lenSq > 0 ? clamp(((p.x - a.x) * ex + (p.y - a.y) * ey) / lenSq, 0, 1) : 0;
    const qx = a.x + ex * t;
    const qy = a.y + ey * t;
    min = Math.min(min, Math.hypot(p.x - qx, p.y - qy));
  }
  return min;
}

/**
 * Nearest-compatible-face binding (shared by rendering and reconciliation):
 * assignment id → face index. Each anchor evaluates to a world point on its
 * line; a face's score is a discounted sum of the *world* distances from those
 * points to the face (nearest anchor at full weight, the rest at 25% — see the
 * inline note below for why), and the assignment binds to the lowest-scoring
 * compatible face. (The arc-length value `evaluateAnchor` also returns is not
 * used here.) Unbindable assignments are absent from the result (dormant). One
 * assignment per face: on conflict the earlier id (or the caller's explicit
 * `order`, which reconciliation uses to give larger old faces priority) keeps
 * it.
 */
export function bindAssignments(
  faces: RegionFace[],
  assignments: Record<string, RegionAssignment>,
  bands: SegmentBandSpec[],
  liveLines: Set<LineId>,
  order?: string[],
): Map<string, number> {
  const out = new Map<string, number>();
  const taken = new Set<number>();
  for (const id of order ?? Object.keys(assignments).sort()) {
    const a = assignments[id];
    if (!a || !liveLines.has(a.lineId)) continue;
    const required = a.lines.filter((l) => liveLines.has(l));
    const evals = a.anchors
      .filter((anchor) => liveLines.has(anchor.lineId))
      .map((anchor) => ({ anchor, ev: evaluateAnchor(anchor, bands) }))
      .filter((x): x is { anchor: RegionAnchor; ev: { p: Vec2; d: number } } => x.ev !== null);
    if (!evals.length) continue; // nothing evaluable — dormant
    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i < faces.length; i++) {
      if (taken.has(i)) continue;
      const f = faces[i];
      const cover = new Set(f.lineIds);
      if (!cover.has(a.lineId)) continue;
      if (!required.every((l) => cover.has(l))) continue;
      // Discounted sum of world distances: the nearest anchor counts in
      // full, the rest at 25%. A long drag strands the anchors of UNMOVED
      // cover lines at the old location — the anchor that rode the moved
      // line must outvote them (plain sum lets a stale anchor drag the bind
      // onto a nearer sibling crossing) — while small corner faces at a
      // junction still need the agreement of every anchor (plain min would
      // let one shared-boundary anchor steal a neighbor's face).
      const contributions = evals
        .map(({ ev }) => pointToFaceDistance(ev.p, f))
        .sort((x, y) => x - y);
      let score = 0;
      for (let c = 0; c < contributions.length; c++) {
        score += c === 0 ? contributions[c] : 0.25 * contributions[c];
      }
      if (score < bestScore - 1e-9) {
        bestScore = score;
        best = i;
      }
    }
    if (best >= 0) {
      out.set(id, best);
      taken.add(best);
    }
  }
  return out;
}

const orderIndexer = (lineOrder: LineId[]) => {
  const idx = new Map(lineOrder.map((id, i) => [id, i]));
  return (id: LineId) => idx.get(id) ?? lineOrder.length;
};

/** The line an unassigned face shows: highest in lineOrder among the cover. */
export function regionDefaultWinner(face: RegionFace, lineOrder: LineId[]): LineId {
  const orderIdx = orderIndexer(lineOrder);
  return defaultWinner(face, orderIdx);
}

const defaultWinner = (face: RegionFace, orderIdx: (id: LineId) => number): LineId =>
  [...face.lineIds].sort((a, b) => orderIdx(a) - orderIdx(b) || (a < b ? -1 : 1))[0];

/** Does a stripe's flattened path bbox (padded) intersect a box? */
export function stripeIntersectsBox(
  band: SegmentBandSpec,
  stripeIndex: number,
  box: { x0: number; y0: number; x1: number; y1: number },
  pad: number,
): boolean {
  return boxesOverlap(stripePathFor(band, stripeIndex).bbox, box, pad);
}

/**
 * Inset from the WINNER's body edges when punching exclusion holes, world
 * units. The hole edge must land on fully-opaque winner paint — cutting a
 * loser exactly at the winner's stroke edge would expose the winner's
 * antialiased tail (a half-covered pixel row) as a ghost hairline. Along the
 * losers' own edges no inset is needed: there is no loser paint beyond them.
 *
 * The value is a visible trade-off: the loser keeps painting over the
 * winner's outermost INSET strip, so a big inset reads as the loser BITING
 * into the winner's edges — invisible while every hole edge was buried
 * under tangent neighbor paint, glaring once interline gaps put those
 * edges against open background (the historical 0.25 ate a quarter unit
 * per side, scaling with zoom). Tuned by eye at maximum zoom over a gapped
 * crossing: 0.00625 reads flush AND seamless — big enough to keep the
 * hairline guard, ~1/2000 of a default stripe.
 */
export const EXCLUSION_INSET = 0.00625;

/**
 * Region overrides, subtractively: for every face whose bound choice differs
 * from its lineOrder default, every covering line painted ABOVE the winner
 * gets a clip hole — the winner then shows through as its ORIGINAL,
 * continuous, never-repainted base stroke. Nothing is painted twice (no
 * doubled antialiased edges, no seams inside the winner, tangent territory
 * untouched), and holes hug the face (adjacent regions can't be nicked).
 *
 * The hole for loser L at face F with winner W is ONE intersection:
 *
 *   dilate_miter(F, railW_L/2 + railW_W/2 + 0.5) ∩ footprintW
 *
 * where footprintW is W's silhouette when W is cased (the hole runs on
 * through W's white ring, uncovering W's rails where they cross L — the
 * rails are already painted in the base pass, buried under L, so revealing
 * them gives the exact "winner bridges over" look), or W's body eroded by
 * EXCLUSION_INSET when uncased (the hole edge must land on opaque winner
 * paint, not its antialiased tail). Both hole boundaries are invisible by
 * construction: the dilation reaches past L's own silhouette (no L paint
 * beyond the cutoff to cut), with MITER joins so the cutoff stays parallel
 * to L's edges through F's corners (a round dilation arcs inward there,
 * leaving a misaligned sliver where a crossing meets a parallel channel);
 * and the footprint boundary coincides with the winner's natural paint/rail
 * edge, aligning with the same edge above and below the crossing.
 *
 * Minus, finally, every nearby face a DIFFERENT line wins: the footprint is
 * no backstop against nicking those when W's own path curves back alongside
 * F (the bend body carries the footprint deep into the neighbor — e.g. over
 * a tangent corridor painted between W and L, where cutting L would expose
 * that corridor's color instead of W's rail; found on the CTA map as a blue
 * sliver notched out of an orange column under a pink bridge). Same-winner
 * neighbors are deliberately not shielded, so adjacent faces assigned to
 * one winner merge seamlessly.
 *
 * Before dilating, F's reveal region absorbs any adjacent dropped `slivers`
 * (see {@link RegionSliver}): at a near-tangent inner fillet the arrangement
 * cell between two bridged faces erodes to a hairline and is dropped, so the
 * winner's revealed casing NOTCHES at the gap. Only the part of a sliver
 * within {@link SLIVER_ABSORB_REACH} of F is taken (a long tangent corridor
 * that shares F's winner+loser is bridged only near the junction), and only
 * when every above-winner line in the sliver is already a loser of F (nothing
 * above the winner is left un-clipped in the patch). Absorbed territory never
 * coincides with a real face — its cover set differs — so no shield can
 * re-subtract it.
 *
 * Returns lineId → hole rings; lines absent from the map paint unclipped.
 * Clipping also removes the losers' pointer-event surface over the face, so
 * idle-mode clicks and deep-picks reach the visible winner natively.
 */
export function buildExclusionHoles(
  faces: RegionFace[],
  winners: { winner: LineId; assignmentId: string | null }[],
  lineOrder: LineId[],
  bands: SegmentBandSpec[],
  markers: StopMarkerSpec[],
  railWOf: (lineId: LineId) => number,
  slivers: RegionSliver[] = [],
): Map<LineId, Ring[]> {
  const orderIdx = orderIndexer(lineOrder);
  const holes = new Map<LineId, Ring[]>();

  // A line's painted footprint near one face, at body width (pad 0) or
  // silhouette width (pad railW). Bbox-filtered; markers dilate by pad/2.
  const paintNear = (lineId: LineId, box: RegionFace['bbox'], pad: number): Ring[] => {
    const rings: Ring[] = [];
    for (const band of bands) {
      for (let k = 0; k < band.lines.length; k++) {
        if (band.lines[k].id !== lineId) continue;
        if (!stripeIntersectsBox(band, k, box, (band.stripeWidths[k] + pad) / 2 + pad)) continue;
        if (pad === 0) {
          rings.push(...stripeBodyPolys(band, k));
        } else {
          rings.push(
            ...offsetOpenPath(stripePathFor(band, k).pts, (band.stripeWidths[k] + pad) / 2),
          );
        }
      }
    }
    const markerRings: Ring[] = [];
    for (const m of markers) {
      if (m.lineId !== lineId) continue;
      const half = m.width + pad; // generous reject: squares are width×width
      if (
        m.cx + half < box.x0 ||
        m.cx - half > box.x1 ||
        m.cy + half < box.y0 ||
        m.cy - half > box.y1
      ) {
        continue;
      }
      markerRings.push(...markerBodyRings(m));
    }
    if (markerRings.length) {
      rings.push(...(pad > 0 ? offsetClosed(markerRings, pad / 2) : markerRings));
    }
    return rings;
  };

  faces.forEach((face, i) => {
    const w = winners[i];
    if (!w || !w.assignmentId) return;
    if (w.winner === defaultWinner(face, orderIdx)) return; // base already shows it
    const winnerRank = orderIdx(w.winner);
    const losers = face.lineIds.filter(
      (lineId) => lineId !== w.winner && orderIdx(lineId) < winnerRank,
    );
    if (!losers.length) return;
    const railWWinner = railWOf(w.winner);

    // Absorb adjacent dropped slivers into the reveal region (see the doc
    // comment): take only the part within SLIVER_ABSORB_REACH of this face,
    // and only slivers whose above-winner lines are all losers here.
    const loserSet = new Set(losers);
    let region: Ring[] = face.face;
    let regionBbox = face.bbox;
    if (slivers.length) {
      const near = offsetClosed(face.face, SLIVER_ABSORB_REACH, 'miter');
      const absorbed: Ring[] = [];
      for (const s of slivers) {
        if (!s.lineIds.includes(w.winner)) continue;
        if (!s.lineIds.every((id) => orderIdx(id) >= winnerRank || loserSet.has(id))) continue;
        // Prefilter generously — a miter dilation reaches up to 3× past a
        // corner; `near` is the real gate.
        if (!boxesOverlap(s.bbox, face.bbox, SLIVER_ABSORB_REACH * 3)) continue;
        const part = intersect(s.face, near); // clip to the face's neighborhood
        if (part.length) absorbed.push(...part);
      }
      if (absorbed.length) {
        region = [...face.face, ...absorbed];
        regionBbox = ringsBbox(region);
      }
    }

    const footprint =
      railWWinner > 0
        ? paintNear(w.winner, regionBbox, railWWinner)
        : offsetClosed(paintNear(w.winner, regionBbox, 0), -EXCLUSION_INSET);
    if (!footprint.length) return;
    // Differently-won neighboring faces, to subtract from every hole (see
    // the doc comment). Bbox-filtered generously: a miter dilation can poke
    // up to 3× reach (the miter limit) past a corner.
    const maxReach = Math.max(...losers.map((id) => railWOf(id))) / 2 + railWWinner / 2 + 0.5;
    const shield: Ring[] = [];
    faces.forEach((other, j) => {
      if (j === i || winners[j]?.winner === w.winner) return;
      if (!boxesOverlap(other.bbox, regionBbox, maxReach * 3)) return;
      shield.push(...other.face);
    });
    for (const lineId of losers) {
      const reach = railWOf(lineId) / 2 + railWWinner / 2 + 0.5;
      const dilated = intersect(offsetClosed(region, reach, 'miter'), footprint);
      const hole = shield.length ? subtract(dilated, shield) : dilated;
      if (!hole.length) continue;
      const list = holes.get(lineId);
      if (list) list.push(...hole);
      else holes.set(lineId, [...hole]);
    }
  });
  return holes;
}

/** Slack around {@link regionClipBounds}: covers seam strokes, antialiasing,
 *  and any sub-world-unit overhang the per-band reach bound doesn't model. */
export const REGION_CLIP_BOUNDS_PAD = 50;

/**
 * World AABB every region-exclude clip must PASS — the union extent of all
 * band stripes (centerline vertices + max |stripe offset| + stripe width,
 * which also covers casing silhouettes; fillet arcs never leave the vertex
 * hull) and stop markers, padded by {@link REGION_CLIP_BOUNDS_PAD}.
 *
 * The exclude clip is "everything EXCEPT the holes", so its outer ring must
 * cover all clipped paint — but no more. It was historically a ±500000
 * constant, and coordinates that large lose float precision in GPU clip
 * rasterization at deep zoom (500000 × a 20–30× device scale lands in the
 * ~1e7 range, where float32 ULP approaches whole pixels), which painted the
 * hole edges a few pixels off. Under full tangency the drift hid beneath
 * opaque neighbor paint; an interline gap exposes hole edges over bare
 * background, where it read as white notches on the clipped line. Returns
 * null when there is nothing to cover.
 */
export function regionClipBounds(
  bands: SegmentBandSpec[],
  markers: StopMarkerSpec[],
): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of bands) {
    let reach = 0;
    for (let k = 0; k < b.lines.length; k++) {
      reach = Math.max(reach, Math.abs(b.stripeOffsets[k]) + b.stripeWidths[k]);
    }
    for (const v of b.centerline) {
      if (v.x - reach < x0) x0 = v.x - reach;
      if (v.x + reach > x1) x1 = v.x + reach;
      if (v.y - reach < y0) y0 = v.y - reach;
      if (v.y + reach > y1) y1 = v.y + reach;
    }
  }
  for (const m of markers) {
    // A width × width square at any rotation reaches at most width/√2 < width.
    if (m.cx - m.width < x0) x0 = m.cx - m.width;
    if (m.cx + m.width > x1) x1 = m.cx + m.width;
    if (m.cy - m.width < y0) y0 = m.cy - m.width;
    if (m.cy + m.width > y1) y1 = m.cy + m.width;
  }
  if (!Number.isFinite(x0)) return null;
  return {
    x0: x0 - REGION_CLIP_BOUNDS_PAD,
    y0: y0 - REGION_CLIP_BOUNDS_PAD,
    x1: x1 + REGION_CLIP_BOUNDS_PAD,
    y1: y1 + REGION_CLIP_BOUNDS_PAD,
  };
}

/** Per-face effective winner: bound assignment's line, else lineOrder-first. */
export function resolveRegionWinners(
  faces: RegionFace[],
  assignments: Record<string, RegionAssignment>,
  bands: SegmentBandSpec[],
  lineOrder: LineId[],
): { winner: LineId; assignmentId: string | null }[] {
  const liveLines = new Set<LineId>(lineOrder);
  for (const band of bands) for (const l of band.lines) liveLines.add(l.id);
  const bound = bindAssignments(faces, assignments, bands, liveLines);
  const byFace = new Map<number, string>();
  for (const [id, faceIndex] of bound) byFace.set(faceIndex, id);
  const orderIdx = orderIndexer(lineOrder);
  return faces.map((face, i) => {
    const assignmentId = byFace.get(i) ?? null;
    return assignmentId
      ? { winner: assignments[assignmentId].lineId, assignmentId }
      : { winner: defaultWinner(face, orderIdx), assignmentId: null };
  });
}

/**
 * How close two faces' boundaries must come to count as neighbours for a
 * flood, world units. Faces of one arrangement share EXACT boundaries (band
 * stripes are built mutually tangent, so a line crossing a trunk yields panes
 * that abut along each stripe seam), so this only has to beat the clipper
 * integer snap (1/CLIP_SCALE) — and must stay well under {@link SLIVER_ERODE}
 * so the opening's split lobes aren't re-bridged wholesale.
 */
export const REGION_ADJACENCY_TOL = 0.05;

/**
 * Flood-fill from a clicked face: every face that should join it in showing
 * `target`. Returns `seedIndex` plus each face reachable from it through
 * neighbours that BOTH
 *
 *  - can legally show `target` (it covers them — the only lines a face can
 *    ever show are its cover), and
 *  - don't already show it.
 *
 * This turns a click from "flip one window pane" into "flip a logical piece
 * of a line": where line D crosses a trunk of A/B/C, the panes {A,D} {B,D}
 * {C,D} abut along the trunk's stripe seams, so one shift-click carries D over
 * the whole crossing. The already-showing-target rule is what bounds it — a
 * face that already shows D is a wall, so the flood can't run away up and down
 * D's whole length through some chain of incidental touches. The seed is
 * exempt from that rule (it's the normal case: {@link regionPaintPlan} floods
 * the winner the seed ALREADY shows), so it always comes back in the result.
 *
 * Faces that merely touch but can't show `target` are walls too, which is why
 * the flood doesn't leak sideways: {A,D} abuts {A,E} along the D/E seam, but
 * {A,E}'s cover has no D.
 */
export function regionFloodTargets(
  faces: RegionFace[],
  winners: { winner: LineId }[],
  seedIndex: number,
  target: LineId,
): number[] {
  if (!faces[seedIndex]) return [];
  // Both rules are cheap set tests, so applying them up front leaves only a
  // handful of candidates for the clipper adjacency work below.
  const open = new Set<number>();
  for (let i = 0; i < faces.length; i++) {
    if (i === seedIndex) continue;
    if (!faces[i].lineIds.includes(target)) continue;
    if (winners[i]?.winner === target) continue;
    open.add(i);
  }
  const dilated = new Map<number, Ring[]>();
  const grown = (i: number): Ring[] => {
    let rings = dilated.get(i);
    if (!rings) {
      rings = offsetClosed(faces[i].face, REGION_ADJACENCY_TOL);
      dilated.set(i, rings);
    }
    return rings;
  };
  const out = [seedIndex];
  const frontier = [seedIndex];
  while (frontier.length) {
    const i = frontier.pop()!;
    for (const j of [...open]) {
      if (!boxesOverlap(faces[i].bbox, faces[j].bbox, REGION_ADJACENCY_TOL)) continue;
      // Neighbouring faces share an exact boundary, so they only intersect
      // once one of them is grown by the tolerance.
      if (!intersect(grown(i), faces[j].face).length) continue;
      open.delete(j);
      out.push(j);
      frontier.push(j);
    }
  }
  return out;
}

/**
 * The click interaction: cycle the face's winner, deleting at the default.
 * `winner` is the line the face ends up showing — the flood's target when the
 * click floods (see {@link regionFloodTargets}).
 */
export function regionClickAction(args: {
  face: RegionFace;
  bound: RegionAssignment | null;
  lineOrder: LineId[];
  dir: 1 | -1;
  bands: SegmentBandSpec[];
  newId: string;
}): { id: string; assignment: RegionAssignment | null; winner: LineId } {
  const { face, bound, lineOrder, dir, bands, newId } = args;
  const orderIdx = orderIndexer(lineOrder);
  const order = [...face.lineIds].sort((a, b) => orderIdx(a) - orderIdx(b) || (a < b ? -1 : 1));
  const current = bound?.lineId ?? order[0];
  const at = Math.max(0, order.indexOf(current));
  const winner = order[(at + dir + order.length) % order.length];
  return {
    winner,
    ...regionSetAction({ face, boundId: bound?.id ?? null, lineOrder, winner, bands, newId }),
  };
}

/**
 * Make one face show `winner`: the write behind both a click and each face a
 * flood carries (see {@link regionFloodTargets}). Assignment null means the
 * face already shows `winner` by lineOrder default, so any stored choice is
 * deleted rather than restated.
 */
export function regionSetAction(args: {
  face: RegionFace;
  /** The face's currently bound assignment id, reused so a flood re-aims an
   *  existing choice instead of stranding it (one assignment per face). */
  boundId: string | null;
  lineOrder: LineId[];
  winner: LineId;
  bands: SegmentBandSpec[];
  newId: string;
}): { id: string; assignment: RegionAssignment | null } {
  const { face, boundId, lineOrder, winner, bands, newId } = args;
  const id = boundId ?? newId;
  if (winner === regionDefaultWinner(face, lineOrder)) return { id, assignment: null };
  return {
    id,
    assignment: { id, lineId: winner, lines: [...face.lineIds], anchors: mintAnchors(face, bands) },
  };
}

/**
 * The whole layering-mode click, as a list of writes for `assignRegions`.
 *
 * A plain click cycles the clicked face's winner ({@link regionClickAction}).
 * A shift-click does NOT cycle: it floods the winner the face ALREADY shows
 * out to its neighbours ({@link regionFloodTargets}), so what spreads is the
 * color you can see rather than whichever one the cycle happened to land on.
 * The clicked face is therefore left untouched by a flood — get the color you
 * want with plain clicks first, then shift-click to carry it.
 *
 * Entry ids are the faces' currently bound assignment ids, or null where the
 * face has none — the store mints those, so the ids in the returned
 * assignments are placeholders it overwrites. An empty list means the click
 * changes nothing and must not be written (it would cost an empty undo).
 */
export function regionPaintPlan(args: {
  faces: RegionFace[];
  winners: { winner: LineId; assignmentId: string | null }[];
  assignments: Record<string, RegionAssignment>;
  faceIndex: number;
  dir: 1 | -1;
  flood: boolean;
  lineOrder: LineId[];
  bands: SegmentBandSpec[];
}): { id: string | null; assignment: RegionAssignment | null }[] {
  const { faces, winners, assignments, faceIndex, dir, flood, lineOrder, bands } = args;
  const face = faces[faceIndex];
  const w = winners[faceIndex];
  if (!face || !w) return [];
  if (flood) {
    return regionFloodTargets(faces, winners, faceIndex, w.winner)
      .filter((i) => i !== faceIndex)
      .map((i) => {
        const boundId = winners[i].assignmentId;
        const set = regionSetAction({
          face: faces[i],
          boundId,
          lineOrder,
          winner: w.winner,
          bands,
          newId: '',
        });
        return { id: boundId, assignment: set.assignment };
      });
  }
  const bound = (w.assignmentId && assignments[w.assignmentId]) || null;
  const seed = regionClickAction({ face, bound, lineOrder, dir, bands, newId: '' });
  return [{ id: bound?.id ?? null, assignment: seed.assignment }];
}
