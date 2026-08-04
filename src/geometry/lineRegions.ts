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
import { jointMarkerPieces } from './lineCircle';
import { clamp } from '../util/grid';
import { closestParamOnOffsetPath, sampleOffsetPathByArcLength } from './lineTagGeometry';
import { leftNormal, perp, rotatedRectCorners, type Vec2 } from './vec';
import { markerEndRing } from './markerEnd';
import { bodyMask, masksMeet } from './bodyMask';
import {
  type Face,
  type Ring,
  interiorPoint,
  intersect,
  offsetClosed,
  offsetNormalized,
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
  /** Arc-length intervals of the stripe path where the stripe BODY overlaps the face. */
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

/**
 * The painted body of one stripe: round-join, butt-cap stroke outline.
 * Memoized per spec object (like {@link stripePathFor} below): interlining's
 * reuse layer hands back the same spec only when value-identical, so identity
 * implies current geometry, and an untouched corridor's stripes stop paying
 * their clipper offset on every rebuild. Callers treat the rings as
 * read-only, which they already did — the same arrays flow through
 * unionAll/intersect operands untouched.
 */
const stripeBodyCache = new WeakMap<SegmentBandSpec, Map<number, Ring[]>>();
export function stripeBodyPolys(band: SegmentBandSpec, stripeIndex: number): Ring[] {
  let byIndex = stripeBodyCache.get(band);
  if (!byIndex) stripeBodyCache.set(band, (byIndex = new Map()));
  const hit = byIndex.get(stripeIndex);
  if (hit) return hit;
  const { pts } = stripePathFor(band, stripeIndex);
  const rings = offsetOpenPath(pts, band.stripeWidths[stripeIndex] / 2);
  byIndex.set(stripeIndex, rings);
  return rings;
}

/**
 * The rendered footprint of a stop marker, or nothing when the marker paints
 * nothing (patterned styles at interior stops). Memoized per spec object —
 * same contract as {@link stripeBodyPolys}.
 */
const markerBodyCache = new WeakMap<StopMarkerSpec, Ring[]>();
function markerBodyRings(spec: StopMarkerSpec): Ring[] {
  const hit = markerBodyCache.get(spec);
  if (hit) return hit;
  const rings = markerBodyRingsUncached(spec);
  markerBodyCache.set(spec, rings);
  return rings;
}

function markerBodyRingsUncached(spec: StopMarkerSpec): Ring[] {
  const half = spec.width / 2;
  const center = { x: spec.cx, y: spec.cy };
  // A reshaped line end (see markerEnd.ts) replaces the square outright, for
  // every style that paints a shape — same helper the painter uses, so the
  // cover is the paint.
  const endShape = spec.outward && spec.end !== 'square' ? spec.end : null;
  if (spec.style === 'solid' || spec.style === 'hatched' || spec.style === 'hatched-mirror') {
    if (endShape && spec.outward) return [markerEndRing(center, spec.outward, half, endShape)];
    // A joint stop (see StopMarkerSpec.jointRotationDeg) is painted as the
    // side-split pieces, so the cover is the paint here too: the two
    // half-squares plus the cap-plane wedge — the painter draws the wedge as
    // one crossed "bowtie" polygon; the clipper gets the same region as its
    // two SIMPLE triangle lobes (corner order [pA+, pB+, pA−, pB−]: lobes are
    // (c, pA+, pB+) and (c, pA−, pB−)).
    const joint = jointMarkerPieces(spec);
    if (joint) {
      const rings: Ring[] = [Array.from(joint.arcHalf), Array.from(joint.straightHalf)];
      const { wedge } = joint;
      if (wedge) rings.push([center, wedge[0], wedge[1]], [center, wedge[2], wedge[3]]);
      return rings;
    }
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

// ---------------------------------------------------------------------------
// Self-overlap (branch mouths, loop crossings). A line's body is ONE unioned
// polygon, so the pairwise stage cannot see the line overlapping itself. Where
// a line has ≥2 ARMS (interlining's junction pairing partitions its bands —
// see SegmentBandSpec.arms), the arms' bodies are intersected pairwise into
// extra zone parts, and the components those parts live in subdivide the line
// PER ARM, so a branch mouth becomes a real face covered by two arm cover ids.

// Slice cover-id payloads end with ` <lineId>`, so any line id parses
// back regardless of its characters. Build-local: slice spellings carry no
// cross-build identity and never persist — assignments spell them as
// pairKeys (winnerPairKey).
const SLICE_SEP = ' ';

/**
 * Cover id of one ARM of a line — used in {@link RegionFace.lineIds} where a
 * face's cover distinguishes the line's arms (its self-overlap faces); bare
 * LineIds everywhere else.
 */
export const armCoverId = (lineId: LineId, arm: number): string =>
  `arm:${arm}${SLICE_SEP}${lineId}`;

/**
 * Cover id of one BAND of a line — the finer slice a mid-edge self-crossing
 * needs (two bands of ONE arm overlapping; see the band-pair rule in
 * selfCrossingParts). Spelled by the band's pairKey, which is also exactly
 * how the choice persists.
 */
export const edgeCoverId = (lineId: LineId, pairKey: string): string =>
  `edge:${pairKey}${SLICE_SEP}${lineId}`;

/** Is this cover id an arm spelling? */
export const isArmCoverId = (id: string): boolean => id.startsWith('arm:');

/** Is this cover id a band (edge) spelling? */
export const isEdgeCoverId = (id: string): boolean => id.startsWith('edge:');

/** Any slice spelling (vs a bare LineId)? */
export const isSliceCoverId = (id: string): boolean => isArmCoverId(id) || isEdgeCoverId(id);

/** The line behind a cover id, bare or slice-spelled. A bare id passes
 *  through untouched whatever characters it contains — only the slice
 *  prefixes are parsed. */
export const lineOfCover = (id: string): LineId =>
  isSliceCoverId(id) ? id.slice(id.indexOf(SLICE_SEP) + 1) : id;

/** The arm index of an arm-spelled cover id, or null otherwise. */
export const armOfCover = (id: string): number | null =>
  isArmCoverId(id) ? Number(id.slice(4, id.indexOf(SLICE_SEP))) : null;

/** The pairKey of a band-spelled cover id, or null otherwise. */
export const pairKeyOfCover = (id: string): string | null =>
  isEdgeCoverId(id) ? id.slice(5, id.indexOf(SLICE_SEP)) : null;

/**
 * Arm index of `lineId`'s stripe on the band of `pairKey`, or null when the
 * line doesn't run that corridor. This is how a persisted arm choice
 * (`RegionAssignment.winnerPairKey` — an EDGE name, the only cross-build arm
 * identity) resolves back to this build's arm indices.
 */
export function armOfLinePairKey(
  bands: SegmentBandSpec[],
  lineId: LineId,
  pairKey: string,
): number | null {
  for (const band of bands) {
    if (band.pairKey !== pairKey) continue;
    const k = band.lines.findIndex((l) => l.id === lineId);
    if (k >= 0) return band.arms[k] ?? 0;
  }
  return null;
}

/** The distinct LINES of a cover, in first-appearance order. */
export const distinctCoverLines = (cover: readonly string[]): LineId[] => {
  const out: LineId[] = [];
  const seen = new Set<LineId>();
  for (const id of cover) {
    const line = lineOfCover(id);
    if (!seen.has(line)) {
      seen.add(line);
      out.push(line);
    }
  }
  return out;
};

/** Lines with ≥2 arms in this build (any stripe with arm index > 0). */
export function multiArmLineIds(bands: SegmentBandSpec[]): Set<LineId> {
  const out = new Set<LineId>();
  for (const band of bands) {
    for (let k = 0; k < band.lines.length; k++) {
      if ((band.arms[k] ?? 0) > 0) out.add(band.lines[k].id);
    }
  }
  return out;
}

/** One line's stripe rings grouped per arm — stripe bodies only, no markers. */
const armStripeRings = (bands: SegmentBandSpec[], lineId: LineId): Map<number, Ring[]> => {
  const groups = new Map<number, Ring[]>();
  for (const band of bands) {
    for (let k = 0; k < band.lines.length; k++) {
      if (band.lines[k].id !== lineId) continue;
      const rings = stripeBodyPolys(band, k);
      if (!rings.length) continue;
      const arm = band.arms[k] ?? 0;
      const list = groups.get(arm);
      if (list) list.push(...rings);
      else groups.set(arm, [...rings]);
    }
  }
  return groups;
};

/**
 * Zone parts where a line overlaps ITSELF: pairwise intersections of its arm
 * bodies. STRIPE bodies only — a marker belongs to the line, not an arm, so a
 * marker grazing the other arm is not a self-overlap (and the two-line
 * construction whose faces these must equal keeps each pseudo-line's marker
 * out of the wedge for the same reason). Empty for single-arm lines, which is
 * the plain-corner guarantee: arms split only at branch junctions, so an
 * ordinary bend can never zone with itself.
 */
export function selfOverlapParts(bands: SegmentBandSpec[], lineId: LineId): Ring[] {
  const groups = armStripeRings(bands, lineId);
  if (groups.size < 2) return [];
  const arms = [...groups.keys()].sort((a, b) => a - b);
  const bodies = arms.map((a) => unionAll(groups.get(a)!));
  const boxes = bodies.map((b) => ringsBbox(b));
  const masks = bodies.map((b) => bodyMask(b));
  const parts: Ring[] = [];
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      if (!boxesOverlap(boxes[i], boxes[j])) continue;
      if (!masksMeet(masks[i], masks[j])) continue;
      parts.push(...intersect(bodies[i], bodies[j]));
    }
  }
  return parts;
}

/**
 * One mid-edge self-crossing's zone contribution: the overlap of two bands of
 * ONE arm, with the pair identity the component planner needs to know which
 * bands to slice where.
 */
export interface SelfCrossingPart {
  pairKeys: [string, string];
  rings: Ring[];
}

/**
 * The BAND-PAIR rule: zone parts where a line crosses itself WITHIN one arm
 * (the P-shape — a chain looping back over its own trunk between stations).
 * Two bands of the same arm that share no station cannot be corner-adjacent,
 * so any bodily overlap between them is a genuine crossing; cross-arm overlap
 * is already covered (at arm granularity) by {@link selfOverlapParts}, and
 * pairs sharing a station are exactly the joints and branch mouths the arm
 * model owns. Stripe bodies only, like the arm parts.
 */
export function selfCrossingParts(bands: SegmentBandSpec[], lineId: LineId): SelfCrossingPart[] {
  const stripes: { band: SegmentBandSpec; k: number }[] = [];
  for (const band of bands) {
    for (let k = 0; k < band.lines.length; k++) {
      if (band.lines[k].id === lineId) stripes.push({ band, k });
    }
  }
  if (stripes.length < 2) return [];
  const out: SelfCrossingPart[] = [];
  for (let i = 0; i < stripes.length; i++) {
    for (let j = i + 1; j < stripes.length; j++) {
      const a = stripes[i];
      const b = stripes[j];
      if ((a.band.arms[a.k] ?? 0) !== (b.band.arms[b.k] ?? 0)) continue;
      if (
        a.band.fromId === b.band.fromId ||
        a.band.fromId === b.band.toId ||
        a.band.toId === b.band.fromId ||
        a.band.toId === b.band.toId
      ) {
        continue;
      }
      const ra = stripeBodyPolys(a.band, a.k);
      const rb = stripeBodyPolys(b.band, b.k);
      if (!ra.length || !rb.length) continue;
      if (!boxesOverlap(ringsBbox(ra), ringsBbox(rb))) continue;
      if (!masksMeet(bodyMask(ra), bodyMask(rb))) continue;
      const rings = intersect(ra, rb);
      if (rings.length) out.push({ pairKeys: [a.band.pairKey, b.band.pairKey], rings });
    }
  }
  return out;
}

/**
 * One line's slice bodies for a component hosting its mid-edge crossings:
 * one entry per involved band (id = {@link edgeCoverId}, its stripe body)
 * plus the REST of the line under its bare id (all other stripes + markers).
 * A third piece of the line passing over the crossing keeps its bare
 * spelling — expressiveness there is deliberately line-level; the crossing
 * pair itself is what this partitions.
 */
export function bandSliceBodiesForRestriction(
  bands: SegmentBandSpec[],
  markers: StopMarkerSpec[],
  lineId: LineId,
  involved: ReadonlySet<string>,
): { id: string; rings: Ring[] }[] {
  const out: { id: string; rings: Ring[] }[] = [];
  const rest: Ring[] = [];
  for (const band of bands) {
    for (let k = 0; k < band.lines.length; k++) {
      if (band.lines[k].id !== lineId) continue;
      const rings = stripeBodyPolys(band, k);
      if (!rings.length) continue;
      if (involved.has(band.pairKey)) {
        out.push({ id: edgeCoverId(lineId, band.pairKey), rings: unionAll(rings) });
      } else {
        rest.push(...rings);
      }
    }
  }
  for (const m of markers) {
    if (m.lineId !== lineId) continue;
    rest.push(...markerBodyRings(m));
  }
  out.sort((a, b) => (a.id < b.id ? -1 : 1));
  if (rest.length) {
    const merged = unionAll(rest);
    if (merged.length) out.push({ id: lineId, rings: merged });
  }
  return out;
}

/**
 * One line's per-arm bodies for cell subdivision, marker footprints included:
 * each marker joins its HOST arm — the smallest arm index among the line's
 * stripes incident to its station — so marker territory keeps the line in a
 * cell's cover exactly as the whole-line body did. (Which arm hosts is
 * invisible today: lone-arm covers collapse back to the bare line id, and
 * markers are never part of the self-overlap zone.) Unioned per arm, like
 * {@link buildLineBodies} unions per line; build ONCE per frame and reuse
 * across components, so the body-mask memos hold.
 */
export function armBodiesForRestriction(
  bands: SegmentBandSpec[],
  markers: StopMarkerSpec[],
  lineId: LineId,
): Map<number, Ring[]> {
  const groups = armStripeRings(bands, lineId);
  if (groups.size === 0) return groups;
  const hostAt = new Map<string, number>();
  for (const band of bands) {
    for (let k = 0; k < band.lines.length; k++) {
      if (band.lines[k].id !== lineId) continue;
      const arm = band.arms[k] ?? 0;
      for (const st of [band.fromId, band.toId]) {
        const cur = hostAt.get(st);
        if (cur === undefined || arm < cur) hostAt.set(st, arm);
      }
    }
  }
  const fallback = Math.min(...groups.keys());
  for (const m of markers) {
    if (m.lineId !== lineId) continue;
    const rings = markerBodyRings(m);
    if (!rings.length) continue;
    const host = hostAt.get(m.stationId) ?? fallback;
    const list = groups.get(host);
    if (list) list.push(...rings);
    else groups.set(host, [...rings]);
  }
  for (const [arm, rings] of groups) groups.set(arm, unionAll(rings));
  return groups;
}

// ---------------------------------------------------------------------------
// Stripe-path sampling (flattened once per band spec, WeakMap-cached). The
// safety argument is owned by interlining's spec-reuse layer: a spec object
// is reused across frames ONLY when value-identical, so spec identity still
// implies current geometry and the cache can never serve stale paths — and
// reuse now means these flattenings survive a drag for untouched corridors.

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
// Ring-set content identity: FNV-1a over coordinates quantized to clipper's own
// 1e-3 resolution, so a key cannot distinguish inputs clipper itself would treat
// as identical.
//
// The primitives below are THE owner of that rule, for the exclusion-hole
// cache's face identity here AND the incremental builder's component and unit
// caches (regionIncremental, which imports them). One owner because the
// quantization is the load-bearing half: a cache that rounded to a different
// resolution than clipper works at would either re-hash geometry clipper calls
// identical (reuse silently stops firing, and the only symptom is frame time)
// or, rounded coarser, hand back the WRONG cached faces.

export const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
export const fnvMix = (h: number, v: number): number => Math.imul(h ^ (v | 0), FNV_PRIME) >>> 0;

/** A world coordinate at clipper's 1e-3 resolution — the quantization every
 *  region cache key is built on. */
export const clipperQuant = (v: number): number => Math.round(v * 1000);

/** `fnvMix` of a quantized world coordinate. */
export const fnvMixNum = (h: number, v: number): number => fnvMix(h, clipperQuant(v));

/**
 * Hash one ring independently of where its vertex list starts. Clipper is free
 * to emit the same polygon rotated to a different first vertex when unrelated
 * input moved; without canonicalizing, reuse never fires.
 */
function hashRingCanonical(ring: Ring): number {
  const n = ring.length;
  if (!n) return FNV_OFFSET;
  const qx = (i: number) => clipperQuant(ring[i].x);
  const qy = (i: number) => clipperQuant(ring[i].y);
  let start = 0;
  for (let i = 1; i < n; i++) {
    const dx = qx(i) - qx(start);
    if (dx < 0 || (dx === 0 && qy(i) < qy(start))) start = i;
  }
  let h = fnvMix(FNV_OFFSET, n);
  for (let i = 0; i < n; i++) {
    const j = (start + i) % n;
    h = fnvMix(h, qx(j));
    h = fnvMix(h, qy(j));
  }
  return h;
}

/** Order-independent hash of a ring set (clipper does not promise ring order). */
function hashRings(rings: Ring[]): number {
  const per = rings.map(hashRingCanonical).sort((a, b) => a - b);
  let h = fnvMix(FNV_OFFSET, per.length);
  for (const x of per) h = fnvMix(h, x);
  return h;
}

/**
 * Collision-hardened content key for a ring set: the canonical hash, then
 * cheap structural discriminators (ring count, vertex count, quantized bbox).
 * The 32-bit hash does the real work; the discriminators exist because these
 * caches run per pointermove for hours and a silent collision would hand out
 * the WRONG cached geometry — with them, two ring sets must collide in the
 * hash AND agree on shape statistics and position at once to alias.
 */
export function ringSetKey(
  rings: Ring[],
  box: { x0: number; y0: number; x1: number; y1: number },
): string {
  let verts = 0;
  for (const ring of rings) verts += ring.length;
  const q = clipperQuant;
  return (
    `${hashRings(rings)}|${rings.length}|${verts}|` +
    `${q(box.x0)},${q(box.y0)},${q(box.x1)},${q(box.y1)}`
  );
}

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

/**
 * Merged arc-length windows of `sp` whose segments come within `pad` of
 * `bbox`. A sample at arc position `at` lies on some segment; if that whole
 * segment sits clear of the padded box, {@link pointNearFace}'s own bbox
 * gate would reject the sample — so outside these windows `inside` is
 * provably false and the walk can skip constructing the point at all. The
 * windows only need to be supersets: a false-positive window costs one real
 * evaluation that returns false, changing nothing.
 */
function nearWindows(
  sp: StripePath,
  bbox: { x0: number; y0: number; x1: number; y1: number },
  pad: number,
): { d0: number; d1: number }[] {
  const wins: { d0: number; d1: number }[] = [];
  for (let i = 0; i + 1 < sp.pts.length; i++) {
    const a = sp.pts[i];
    const b = sp.pts[i + 1];
    const near =
      Math.min(a.x, b.x) <= bbox.x1 + pad &&
      Math.max(a.x, b.x) >= bbox.x0 - pad &&
      Math.min(a.y, b.y) <= bbox.y1 + pad &&
      Math.max(a.y, b.y) >= bbox.y0 - pad;
    if (!near) continue;
    const last = wins[wins.length - 1];
    if (last && last.d1 >= sp.cum[i]) last.d1 = sp.cum[i + 1];
    else wins.push({ d0: sp.cum[i], d1: sp.cum[i + 1] });
  }
  return wins;
}

/** Slack around window edges so a sample exactly on a shared vertex between
 * a near and a far segment is always evaluated for real, never skipped. */
const WINDOW_EPS = 1e-7;

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
      const halfWidth = band.stripeWidths[k] / 2;
      // The stripe's painted body extends half a width past the path bbox.
      if (!boxesOverlap(sp.bbox, bbox, halfWidth)) continue;
      // The walk below visits the stripe's WHOLE arc, but almost all of it
      // runs nowhere near this face; precomputing the near windows makes the
      // out-of-window iterations a couple of float compares instead of an
      // arc-length binary search + point test each.
      const wins = nearWindows(sp, bbox, halfWidth);
      let w = 0;
      const intervals: { d0: number; d1: number }[] = [];
      let runStart: number | null = null;
      for (let d = 0; ; d += SPAN_STEP) {
        const at = Math.min(d, sp.len);
        while (w < wins.length && at > wins[w].d1 + WINDOW_EPS) w++;
        const maybeNear = w < wins.length && at >= wins[w].d0 - WINDOW_EPS;
        // Body overlap, not center containment: the stripe covers face
        // material anywhere within half its width of the path. Small corner
        // faces sit inside a stripe's body but off its center path — with
        // center containment they'd get no span here, and a spanless cover
        // line can only be anchored by projection (the flakiest anchor kind).
        const inside = maybeNear && pointNearFace(pointAtArcLength(sp, at), face, bbox, halfWidth);
        if (inside && runStart === null) runStart = Math.max(0, at - SPAN_STEP / 2);
        if (!inside && runStart !== null) {
          intervals.push({ d0: runStart, d1: Math.min(sp.len, at - SPAN_STEP / 2) });
          runStart = null;
        }
        if (at >= sp.len) break;
        // Out of window with no run open, every grid point from here to the
        // next window is provably `!inside` (the windows are a superset of
        // where `inside` can hold), and a false sample with no open run emits
        // nothing — so the walk can jump. Land one full step BEFORE the
        // window edge's grid cell so the first possibly-near sample is still
        // evaluated for real (it may sit exactly on `d0 − eps`). SPAN_STEP is
        // dyadic, so the iterated d values and the floor-to-grid target are
        // exact — the jump rejoins the identical sample sequence.
        if (!maybeNear && runStart === null) {
          if (w >= wins.length) break; // nothing near for the rest of the arc
          const target = Math.floor((wins[w].d0 - WINDOW_EPS) / SPAN_STEP) * SPAN_STEP - SPAN_STEP;
          if (target > d) d = target;
        }
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
 * Is `p` on the face's material, or within `tol` of it? A point inside a hole
 * (or outside the outer ring) counts only when within `tol` of some boundary
 * ring — which is the right body-overlap semantics either way.
 */
function pointNearFace(
  p: Vec2,
  face: Face,
  bbox: { x0: number; y0: number; x1: number; y1: number },
  tol: number,
): boolean {
  if (p.x < bbox.x0 - tol || p.x > bbox.x1 + tol || p.y < bbox.y0 - tol || p.y > bbox.y1 + tol) {
    return false;
  }
  if (pointInFace(p, face)) return true;
  const tolSq = tol * tol;
  for (const ring of face) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const lenSq = ex * ex + ey * ey;
      const t = lenSq > 0 ? clamp(((p.x - a.x) * ex + (p.y - a.y) * ey) / lenSq, 0, 1) : 0;
      const dx = p.x - (a.x + ex * t);
      const dy = p.y - (a.y + ey * t);
      if (dx * dx + dy * dy <= tolSq) return true;
    }
  }
  return false;
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
  const selfEntries: [LineId, Ring[]][] = [];
  for (const id of [...multiArmLineIds(bands)].sort()) {
    const parts = selfOverlapParts(bands, id);
    if (parts.length) selfEntries.push([id, parts]);
  }
  const crossParts = new Map<LineId, SelfCrossingPart[]>();
  for (const id of ids) {
    const parts = selfCrossingParts(bands, id);
    if (parts.length) crossParts.set(id, parts);
  }
  // A single line can no longer short-circuit unconditionally: alone on the
  // map, its branch mouths and self-crossings are still an arrangement.
  if (ids.length < 2 && !selfEntries.length && !crossParts.size) return [];
  // Component-at-a-time. Cells cannot span components, so this yields the same
  // faces as one global subdivision while keeping every clipper operand down to
  // one crossing's worth of geometry — and it is the seam the incremental
  // builder caches on.
  const parts = overlapZoneParts(ids, bodies);
  for (const [, p] of selfEntries) parts.push(...p);
  for (const cps of crossParts.values()) for (const cp of cps) parts.push(...cp.rings);
  const comps = significantComponents(parts);
  const selfHomes = selfPartCompHomes(selfEntries, comps);
  const crossPlans = crossingCompPlans(crossParts, comps);
  const sliceEntriesOf = makeSliceEntrySource(bands, markers);
  const faces: RegionFace[] = [];
  for (const comp of comps) {
    const sliceSplit = sliceSplitForComp(
      selfHomes.get(comp),
      crossPlans.get(comp),
      sliceEntriesOf,
    );
    faces.push(
      ...extractFaces(
        subdivideCells(restrictBodiesToZone(ids, bodies, comp, sliceSplit)),
        bands,
        sliverSink,
      ),
    );
  }
  return finalizeFaces(faces);
}

/**
 * Which components host a line's mid-edge crossings, with the involved band
 * pairKeys per line — the planner's input for band-level slicing. Same
 * membership predicate as {@link selfPartCompHomes}.
 */
export function crossingCompPlans(
  crossParts: ReadonlyMap<LineId, SelfCrossingPart[]>,
  comps: Face[],
): Map<Face, Map<LineId, Set<string>>> {
  const out = new Map<Face, Map<LineId, Set<string>>>();
  if (!crossParts.size) return out;
  const entries: [number, CompHomeEntry][] = comps.map((rings, i) => [
    i,
    { rings, box: ringsBbox(rings) },
  ]);
  for (const [lineId, parts] of crossParts) {
    for (const part of parts) {
      for (const ring of part.rings) {
        for (const i of ringHomes(ring, entries)) {
          const comp = comps[i];
          let byLine = out.get(comp);
          if (!byLine) out.set(comp, (byLine = new Map()));
          let set = byLine.get(lineId);
          if (!set) byLine.set(lineId, (set = new Set()));
          set.add(part.pairKeys[0]);
          set.add(part.pairKeys[1]);
        }
      }
    }
  }
  return out;
}

/**
 * Per-frame builder of a line's slice entries, memoized so the bbox/mask
 * memos on the ring arrays hold across components. Arm entries where the
 * line's branch-mouth parts live; band entries (per involved pairKey + the
 * bare-id rest) where only mid-edge crossings do. A component hosting BOTH
 * for one line takes the ARM partition — the crossing goes undistinguished
 * there (deliberate punt: the merged-with-a-mouth crossing is the rare case
 * the design doc registers, and arm covers keep the mouth paintable).
 */
export function makeSliceEntrySource(
  bands: SegmentBandSpec[],
  markers: StopMarkerSpec[],
): (lineId: LineId, crossPairs: ReadonlySet<string> | null) => { id: string; rings: Ring[] }[] {
  const armEntries = new Map<LineId, { id: string; rings: Ring[] }[]>();
  const bandEntries = new Map<string, { id: string; rings: Ring[] }[]>();
  return (lineId, crossPairs) => {
    if (crossPairs === null) {
      let e = armEntries.get(lineId);
      if (!e) {
        const byArm = armBodiesForRestriction(bands, markers, lineId);
        e = [...byArm.keys()]
          .sort((a, b) => a - b)
          .map((arm) => ({ id: armCoverId(lineId, arm), rings: byArm.get(arm)! }));
        armEntries.set(lineId, e);
      }
      return e;
    }
    const key = `${lineId}|${[...crossPairs].sort().join(',')}`;
    let e = bandEntries.get(key);
    if (!e) {
      e = bandSliceBodiesForRestriction(bands, markers, lineId, crossPairs);
      bandEntries.set(key, e);
    }
    return e;
  };
}

/** The slice plan of one component: arm partition where the line's arm parts
 *  live (crossings punt there), band partition where only crossings do. */
export function sliceSplitForComp(
  armLines: ReadonlySet<LineId> | undefined,
  crossPlan: ReadonlyMap<LineId, Set<string>> | undefined,
  sliceEntriesOf: (
    lineId: LineId,
    crossPairs: ReadonlySet<string> | null,
  ) => { id: string; rings: Ring[] }[],
): Map<LineId, { id: string; rings: Ring[] }[]> | null {
  if (!armLines && !crossPlan) return null;
  const split = new Map<LineId, { id: string; rings: Ring[] }[]>();
  const lines = new Set<LineId>([...(armLines ?? []), ...(crossPlan?.keys() ?? [])]);
  for (const l of [...lines].sort()) {
    split.set(l, sliceEntriesOf(l, armLines?.has(l) ? null : (crossPlan?.get(l) ?? null)));
  }
  return split;
}

/**
 * Which components a line's self parts live in — the comps whose subdivision
 * must split that line into arms. One membership predicate (nonzero-winding
 * test on each ring's probe vertex, bbox fallback on boundary ambiguity),
 * shared by the reference and the incremental builder so the two arm-split
 * exactly the same cells. Candidates are the SIGNIFICANT comps — the only
 * ones that subdivide.
 */
export function selfPartCompHomes(
  selfParts: Iterable<[LineId, Ring[]]>,
  comps: Face[],
): Map<Face, Set<LineId>> {
  const entries: [number, CompHomeEntry][] = comps.map((rings, i) => [
    i,
    { rings, box: ringsBbox(rings) },
  ]);
  const out = new Map<Face, Set<LineId>>();
  for (const [lineId, parts] of selfParts) {
    for (const ring of parts) {
      for (const i of ringHomes(ring, entries)) {
        const comp = comps[i];
        const set = out.get(comp);
        if (set) set.add(lineId);
        else out.set(comp, new Set([lineId]));
      }
    }
  }
  return out;
}

/**
 * Pure-JS nonzero-winding containment tester over a comp's rings (outer +
 * holes), with edges y-bucketed so one probe scans only the edges whose
 * y-range can cross its scanline — membership probes hundreds of part rings
 * per frame, and the biggest comp carries thousands of vertices. Built lazily
 * per entry and carried with it (the incremental zone index caches it across
 * frames).
 */
export function makeFaceTester(
  rings: Face,
  box: { x0: number; y0: number; x1: number; y1: number },
): (p: { x: number; y: number }) => boolean {
  const H = 64;
  const yMin = box.y0;
  const span = Math.max(box.y1 - box.y0, 1e-9);
  const bucketOf = (y: number) => Math.min(H - 1, Math.max(0, Math.floor(((y - yMin) / span) * H)));
  const buckets: { ax: number; ay: number; bx: number; by: number }[][] = Array.from(
    { length: H },
    () => [],
  );
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j];
      const b = ring[i];
      const lo = bucketOf(Math.min(a.y, b.y));
      const hi = bucketOf(Math.max(a.y, b.y));
      for (let k = lo; k <= hi; k++) buckets[k].push({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
    }
  }
  return (p) => {
    let winding = 0;
    for (const e of buckets[bucketOf(p.y)]) {
      if (e.ay <= p.y) {
        if (e.by > p.y && (e.bx - e.ax) * (p.y - e.ay) - (p.x - e.ax) * (e.by - e.ay) > 0) {
          winding++;
        }
      } else if (e.by <= p.y && (e.bx - e.ax) * (p.y - e.ay) - (p.x - e.ax) * (e.by - e.ay) < 0) {
        winding--;
      }
    }
    return winding !== 0;
  };
}

/** A ring-membership candidate: a comp's rings + bbox, with the tester cached
 *  on the entry across probes (and, in the incremental index, across frames). */
export interface CompHomeEntry {
  rings: Face;
  box: { x0: number; y0: number; x1: number; y1: number };
  tester?: (p: { x: number; y: number }) => boolean;
}

/** All home comp ids of one part ring: every candidate comp whose bbox admits
 *  it AND whose polygon winds around the ring's probe vertex. A vertex ON a
 *  shared boundary can test inside several comps — or, with the strict
 *  winding test, inside NONE — so an empty result falls back to every comp
 *  whose bbox contains the vertex (a superset of the true home): membership
 *  only decides what seeds and what joins the re-union, and over-seeding is
 *  exact where a silent miss would drop territory. */
export function ringHomes(ring: Ring, candidates: Iterable<[number, CompHomeEntry]>): number[] {
  const p = ring[0];
  const homes: number[] = [];
  const boxed: number[] = [];
  for (const [id, comp] of candidates) {
    if (p.x < comp.box.x0 || p.x > comp.box.x1 || p.y < comp.box.y0 || p.y > comp.box.y1) {
      continue;
    }
    boxed.push(id);
    comp.tester ??= makeFaceTester(comp.rings, comp.box);
    if (comp.tester(p)) homes.push(id);
  }
  return homes.length ? homes : boxed;
}

/**
 * The raw parts of the pairwise-overlap zone: any ≥2-cover point lies in some
 * pairwise body intersection, so cells inside their union subdivide exactly as
 * they would in the full arrangement, at a fraction of the cost. Deliberately
 * NOT unioned here — {@link significantComponents}' polytree union both merges
 * the parts and splits the result into components in one boolean, so a
 * separate unionAll pass would just do the same work twice.
 */
export function overlapZoneParts(ids: LineId[], bodies: Map<LineId, Ring[]>): Ring[] {
  const boxes = new Map(ids.map((id) => [id, ringsBbox(bodies.get(id)!)]));
  const zoneParts: Ring[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      if (!boxesOverlap(boxes.get(ids[i])!, boxes.get(ids[j])!)) continue;
      zoneParts.push(...intersect(bodies.get(ids[i])!, bodies.get(ids[j])!));
    }
  }
  return zoneParts;
}

/** Each line's body clipped to the zone, in `ids` order; empties dropped. */
export function restrictBodiesToZone(
  ids: LineId[],
  bodies: Map<LineId, Ring[]>,
  zone: Ring[],
  // Lines to subdivide PER SLICE in this component (their self parts live
  // here): the line's single entry is replaced by the given slice entries —
  // per-arm bodies at a branch mouth, per-band + rest at a mid-edge
  // crossing. Entries are built once per frame so their bbox/mask memos hold
  // across components.
  sliceSplit?: Map<LineId, { id: string; rings: Ring[] }[]> | null,
): { id: LineId; rings: Ring[] }[] {
  const out: { id: LineId; rings: Ring[] }[] = [];
  // Most lines are nowhere near any one component; a bbox reject is far cheaper
  // than asking clipper for an empty intersection.
  const zoneBox = ringsBbox(zone);
  // A body's bbox spans ~26% of the world, so the bbox reject lets most lines
  // through to a whole-body boolean against a small component. The occupancy
  // mask is a strict refinement: cell-disjoint means the intersection is empty,
  // which is the same branch the empty result takes below.
  const zoneMask = bodyMask(zone);
  const restrict = (id: LineId, body: Ring[]) => {
    if (!boxesOverlap(ringsBbox(body), zoneBox)) return;
    if (!masksMeet(bodyMask(body), zoneMask)) return;
    const rings = intersect(body, zone);
    if (rings.length) out.push({ id, rings });
  };
  for (const id of ids) {
    const slices = sliceSplit?.get(id);
    if (slices) {
      for (const s of slices) restrict(s.id, s.rings);
    } else {
      restrict(id, bodies.get(id)!);
    }
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
  // Each cell carries its bbox so the loop can prove "these can't interact"
  // without a clipper round-trip: an intersection is a subset of both
  // operands' boxes, so strictly disjoint boxes take exactly the branch an
  // empty intersection takes — cell pushed through, remaining untouched. On
  // a multi-crossing component most cell/line pairs sit at different
  // crossings, so most of the empty intersects (71% of subdivide's clipper
  // calls on the DKLB drag) never run. Touching-but-not-overlapping boxes
  // still go through clipper; the skip only fires on strict separation.
  interface Cell {
    cover: LineId[];
    rings: Ring[];
    box: { x0: number; y0: number; x1: number; y1: number };
  }
  let cells: Cell[] = [];
  for (const { id, rings } of restricted) {
    const next: Cell[] = [];
    let remaining = rings;
    let remainingBox = ringsBbox(remaining);
    for (const cell of cells) {
      if (!remaining.length || !boxesOverlap(cell.box, remainingBox)) {
        next.push(cell);
        continue;
      }
      const inter = intersect(cell.rings, remaining);
      if (!inter.length) {
        next.push(cell);
        continue;
      }
      const diff = subtract(cell.rings, remaining);
      remaining = subtract(remaining, cell.rings);
      remainingBox = ringsBbox(remaining);
      next.push({ cover: [...cell.cover, id], rings: inter, box: ringsBbox(inter) });
      if (diff.length) next.push({ cover: cell.cover, rings: diff, box: ringsBbox(diff) });
    }
    if (remaining.length) next.push({ cover: [id], rings: remaining, box: remainingBox });
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
  return zoneComponents(zone).comps;
}

/**
 * Canonical content key of one zone component, memoized per ring-array
 * identity (comps carried across frames by the incremental zone maintenance
 * keep their arrays, so an untouched comp never re-hashes). Also the sort
 * key that fixes the component ITERATION order to a pure function of
 * geometry — clipper's own output order can differ between a global union
 * and a spliced local one, and iteration order is output-visible through
 * per-component sliver emission.
 */
const compKeys = new WeakMap<Face, string>();
export function compKeyOf(comp: Face): string {
  let key = compKeys.get(comp);
  if (!key) compKeys.set(comp, (key = ringSetKey(comp, ringsBbox(comp))));
  return key;
}

/**
 * One polytree union over the raw zone parts, yielding both products of the
 * old unionAll-then-splitIntoFaces pair in a single boolean: the merged zone
 * rings (every component's outer + holes, flattened, sub-sliver ones
 * included so `zone.length` keeps meaning "any overlap exists") and the
 * significant components, in canonical (content-key) order. `all` is every
 * component including sub-sliver ones — the incremental zone maintenance
 * needs them for part membership; nothing else reads them.
 */
export function zoneComponents(parts: Ring[]): { zone: Ring[]; comps: Face[]; all: Face[] } {
  if (!parts.length) return { zone: [], comps: [], all: [] };
  const all = splitIntoFaces(parts);
  const comps: Face[] = [];
  for (const comp of all) {
    if (faceArea(comp) < SLIVER_MIN_AREA) continue;
    comps.push(comp);
  }
  comps.sort((a, b) => (compKeyOf(a) < compKeyOf(b) ? -1 : 1));
  return { zone: all.flat(), comps, all };
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

/** Rewrite lone slices back to bare line ids (see the call site below): a
 *  cover distinguishes a line's slices only where ≥2 of that line's coverers
 *  are actually in the cell. A bare id can coexist with EDGE slices (the
 *  band partition's "rest of the line") and counts as a coverer, so a third
 *  piece crossing a band pair keeps the pair distinguished — but a bare id
 *  itself never rewrites, so the rewrite cannot create duplicates. */
const collapseCover = (cover: readonly string[]): string[] => {
  let counts: Map<LineId, number> | null = null;
  for (const id of cover) {
    if (!isSliceCoverId(id)) continue;
    counts ??= new Map();
    const line = lineOfCover(id);
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  if (!counts) return [...cover];
  const withBare = counts;
  for (const id of cover) {
    if (!isSliceCoverId(id) && withBare.has(id)) withBare.set(id, withBare.get(id)! + 1);
  }
  return cover.map((id) =>
    isSliceCoverId(id) && withBare.get(lineOfCover(id))! < 2 ? lineOfCover(id) : id,
  );
};

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
      // Spans are keyed per LINE (`${lineId}|${pairKey}`) whatever the cover
      // spelling — a self face gets one entry per arm through the pairKeys.
      spans: computeSpans(face, bbox, distinctCoverLines(lineIds), bands),
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
  for (const rawCell of cells) {
    if (rawCell.cover.length < 2) continue;
    // Collapse lone arms back to bare line ids: cover distinguishes a line's
    // arms only where ≥2 of them actually cover the cell, so every face
    // outside a genuine self-overlap keeps exactly its historical identity.
    const cell = { ...rawCell, cover: collapseCover(rawCell.cover) };
    // Faces, lobes and pieces below are all splitIntoFaces output, so the
    // normalization-free offset applies throughout this loop.
    for (const face of splitIntoFaces(cell.rings)) {
      const eroded = offsetNormalized(face, -SLIVER_ERODE);
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
        const blob = intersect(remaining, offsetNormalized(lobe, SLIVER_ERODE * 2 + 0.05));
        if (!blob.length) continue;
        for (const piece of splitIntoFaces(blob)) {
          if (offsetNormalized(piece, -SLIVER_ERODE).length) pushFace(piece, cell.cover);
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
 * Fresh anchors for a face: one per cover SLICE, at its span midpoint. A
 * bare cover id yields one anchor for the line (its biggest span interval,
 * any corridor); an arm-spelled id yields one anchor pinned to a corridor OF
 * THAT ARM — so a self face mints two same-line anchors with different
 * pairKeys, and pass-1 binding demands a face running BOTH corridors. Spans
 * record body overlap, so every stripe-covered slice has one; a line whose
 * presence comes from its stop marker alone gets a projection fallback: the
 * arc position on its nearest stripe.
 */
export function mintAnchors(face: RegionFace, bands: SegmentBandSpec[]): RegionAnchor[] {
  const anchors: RegionAnchor[] = [];
  let fallbackTarget: Vec2 | undefined;
  const target = () =>
    (fallbackTarget ??= interiorPoint(face.face) ?? {
      x: (face.bbox.x0 + face.bbox.x1) / 2,
      y: (face.bbox.y0 + face.bbox.y1) / 2,
    });
  for (const coverId of face.lineIds) {
    const lineId = lineOfCover(coverId);
    const arm = armOfCover(coverId);
    const edgePk = pairKeyOfCover(coverId);
    let best: { pairKey: string; mid: number; totalLen: number; size: number } | null = null;
    for (const [key, entry] of face.spans) {
      if (!key.startsWith(`${lineId}|`)) continue;
      const pairKey = key.slice(lineId.length + 1);
      if (edgePk !== null && pairKey !== edgePk) continue;
      if (arm !== null && armOfLinePairKey(bands, lineId, pairKey) !== arm) continue;
      for (const iv of entry.intervals) {
        const size = iv.d1 - iv.d0;
        if (!best || size > best.size) {
          best = { pairKey, mid: (iv.d0 + iv.d1) / 2, totalLen: entry.totalLen, size };
        }
      }
    }
    let side = 0;
    if (best) {
      // Spans record BODY overlap, so on a corner face the span midpoint is
      // an arc position whose center-path point lies OUTSIDE the face. The
      // binder's distance scoring assumes a minted anchor evaluates on its
      // own face (a big neighboring superset-cover face touching the center
      // path would otherwise outscore it) — carry such an anchor onto the
      // face with the same capped side offset the projection fallback uses.
      const stripe = stripeFor(bands, best.pairKey, lineId);
      if (stripe) {
        const { band, k } = stripe;
        const at = sampleOffsetPathByArcLength(
          band.centerline,
          band.radius,
          band.stripeOffsets[k],
          best.mid,
        );
        if (!pointInFace(at.p, face.face)) {
          const n = leftNormal(at.tangent);
          const t = target();
          const half = band.stripeWidths[k] / 2;
          side = clamp((t.x - at.p.x) * n.x + (t.y - at.p.y) * n.y, -half, half);
        }
      }
    } else {
      // Slices never take the projection fallback: it is slice-blind, and a
      // wrong-slice pairKey here would break the winnerPairKey↔anchor
      // invariant. A slice with no span simply mints nothing — its sibling
      // anchors still pin the face.
      if (isSliceCoverId(coverId)) continue;
      const projected = projectOntoLineStripe(lineId, target(), bands);
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

/** A line's stripe in a corridor: its band and stripe index, or null. */
function stripeFor(
  bands: SegmentBandSpec[],
  pairKey: string,
  lineId: LineId,
): { band: SegmentBandSpec; k: number } | null {
  for (const band of bands) {
    if (band.pairKey !== pairKey) continue;
    const k = band.lines.findIndex((l) => l.id === lineId);
    if (k >= 0) return { band, k };
  }
  return null;
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
  const stripe = stripeFor(bands, pairKey, lineId);
  return stripe ? stripePathFor(stripe.band, stripe.k).len : null;
}

/**
 * Evaluate an anchor under current geometry: the world point (side offset
 * applied) and absolute arc-length position (from the canonical 'from' end)
 * along its stripe. Null when the corridor no longer exists for that line.
 */
export function evaluateAnchor(
  anchor: RegionAnchor,
  bands: SegmentBandSpec[],
  // Optional pairKey → bands index (in original array order) so a caller
  // evaluating many anchors skips the linear scan. Same first-hit semantics:
  // the indexed list preserves array order and non-matching bands can't match.
  byPairKey?: Map<string, SegmentBandSpec[]>,
): { p: Vec2; d: number } | null {
  const candidates = byPairKey ? (byPairKey.get(anchor.pairKey) ?? []) : bands;
  for (const band of candidates) {
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
 * Corridor-identity-first face binding (shared by rendering and
 * reconciliation): assignment id → face index. Each anchor names its line's
 * corridor (`pairKey`) and evaluates to a world point on it; a candidate face
 * must cover the assignment's lines, and binding runs in two passes over the
 * assignments:
 *
 * Pass 1 — identity: a face is eligible only when each evaluable anchor's own
 * corridor runs inside it (see {@link anchorCorridorOk}). Corridors are
 * station-id pairs, so the match survives arbitrary drags: mid-gesture the
 * stored arc distances go stale (the reconcile that would re-mint them only
 * runs on commit), but the corridors a crossing sits on do not — sibling
 * faces with the same cover elsewhere on the map are not interchangeable.
 *
 * Pass 2 — distance-only fallback for what pass 1 left unbound: an
 * assignment whose crossing slid onto a NEIGHBORING corridor (past a
 * station) still survives by proximity instead of going dormant.
 *
 * Within a pass, a face's score is a discounted sum of the *world* distances
 * from the anchor points to the face (nearest anchor at full weight, the rest
 * at 25% — see the inline note below for why), and the assignment binds to
 * the lowest-scoring eligible face. (The arc-length value `evaluateAnchor`
 * also returns is not used here.) Unbindable assignments are absent from the
 * result (dormant). One assignment per face: on conflict the earlier id (or
 * the caller's explicit `order`, which reconciliation uses to give larger old
 * faces priority) keeps it.
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
  const ids = order ?? Object.keys(assignments).sort();

  // This runs per render frame over every assignment × candidate face, so the
  // per-candidate work is kept allocation-free: anchors evaluate through a
  // pairKey index instead of scanning the band array, cover subset tests are
  // bitmasks over the live-line universe built once per call, and only faces
  // covering the assignment's own line are visited at all (an ascending index
  // list, preserving the first-best tie-break order of the full scan).
  const bandsByPairKey = new Map<string, SegmentBandSpec[]>();
  for (const band of bands) {
    const list = bandsByPairKey.get(band.pairKey);
    if (list) list.push(band);
    else bandsByPairKey.set(band.pairKey, [band]);
  }
  const lineBit = new Map<LineId, number>();
  for (const id of liveLines) lineBit.set(id, lineBit.size);
  const words = (lineBit.size >> 5) + 1;
  const maskOf = (lineIds: Iterable<LineId>): Uint32Array => {
    const m = new Uint32Array(words);
    for (const id of lineIds) {
      const bit = lineBit.get(id);
      // Non-live ids stay out of the mask — the reference predicate never
      // tests them (required lines are pre-filtered to live, and a cover's
      // non-live members can satisfy no requirement).
      if (bit !== undefined) m[bit >> 5] |= 1 << (bit & 31);
    }
    return m;
  };
  const hasAll = (need: Uint32Array, have: Uint32Array): boolean => {
    for (let i = 0; i < words; i++) if ((need[i] & have[i]) !== need[i]) return false;
    return true;
  };
  // Cover ids normalize to LINES here: an arm-spelled cover satisfies the
  // same line requirements its bare spelling would.
  const coverMasks = faces.map((f) => maskOf(distinctCoverLines(f.lineIds)));
  const facesByLine = new Map<LineId, number[]>();
  for (let i = 0; i < faces.length; i++) {
    for (const id of distinctCoverLines(faces[i].lineIds)) {
      const list = facesByLine.get(id);
      if (list) list.push(i);
      else facesByLine.set(id, [i]);
    }
  }

  const prepared = new Map<
    string,
    {
      requiredMask: Uint32Array;
      evals: { anchor: RegionAnchor; ev: { p: Vec2; d: number } }[];
    }
  >();
  for (const id of ids) {
    const a = assignments[id];
    if (!a || !liveLines.has(a.lineId)) continue;
    const evals = a.anchors
      .filter((anchor) => liveLines.has(anchor.lineId))
      .map((anchor) => ({ anchor, ev: evaluateAnchor(anchor, bands, bandsByPairKey) }))
      .filter((x): x is { anchor: RegionAnchor; ev: { p: Vec2; d: number } } => x.ev !== null);
    if (!evals.length) continue; // nothing evaluable — dormant
    // The assignment's own line rides in the mask too: candidates come from
    // its face list, so the bit is always satisfied — folding it in keeps the
    // mask the single subset test.
    prepared.set(id, {
      requiredMask: maskOf([a.lineId, ...a.lines.filter((l) => liveLines.has(l))]),
      evals,
    });
  }
  const scratch: number[] = [];
  for (const strict of [true, false]) {
    for (const id of ids) {
      if (out.has(id)) continue;
      const prep = prepared.get(id);
      if (!prep) continue;
      const a = assignments[id];
      let best = -1;
      let bestScore = Infinity;
      for (const i of facesByLine.get(a.lineId) ?? []) {
        if (taken.has(i)) continue;
        const f = faces[i];
        if (!hasAll(prep.requiredMask, coverMasks[i])) continue;
        if (strict && !prep.evals.every(({ anchor }) => anchorCorridorOk(anchor, f))) continue;
        // Discounted sum of world distances: the nearest anchor counts in
        // full, the rest at 25%. A long drag strands the anchors of UNMOVED
        // cover lines at the old location — the anchor that rode the moved
        // line must outvote them (plain sum lets a stale anchor drag the bind
        // onto a nearer sibling crossing) — while small corner faces at a
        // junction still need the agreement of every anchor (plain min would
        // let one shared-boundary anchor steal a neighbor's face).
        // Scratch reuse keeps the sort's fp-accumulation ORDER identical to
        // the fresh-array form — the sorted order is the documented contract.
        scratch.length = prep.evals.length;
        for (let c = 0; c < prep.evals.length; c++) {
          scratch[c] = pointToFaceDistance(prep.evals[c].ev.p, f);
        }
        scratch.sort((x, y) => x - y);
        let score = 0;
        for (let c = 0; c < scratch.length; c++) {
          score += c === 0 ? scratch[c] : 0.25 * scratch[c];
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
  }
  return out;
}

/**
 * Does the face run this anchor's own corridor? True also when the face has
 * no stripe of the anchor's line at all — a marker-only cover leaves nothing
 * to compare against. False only on a genuine mismatch: the line's stripe
 * runs through the face, but under different corridors than the anchor names.
 */
function anchorCorridorOk(anchor: RegionAnchor, face: RegionFace): boolean {
  if (face.spans.has(`${anchor.lineId}|${anchor.pairKey}`)) return true;
  for (const key of face.spans.keys()) {
    if (key.startsWith(`${anchor.lineId}|`)) return false;
  }
  return true;
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

// LINE domain, whatever the cover spelling: an unassigned face — a self face
// included — shows its natural paint, and the natural paint's front-most is a
// line (a line's own arms merge; there is no default arm).
const defaultWinner = (face: RegionFace, orderIdx: (id: LineId) => number): LineId =>
  distinctCoverLines(face.lineIds).sort((a, b) => orderIdx(a) - orderIdx(b) || (a < b ? -1 : 1))[0];

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
/**
 * One overridden face's hole output: the loser-ordered ring lists the hole
 * assembly appends, plus the reveal region's bbox (face + absorbed slivers) —
 * stored by the cross-frame cache so validation can re-query the shield
 * neighborhood without recomputing the absorption.
 */
interface FaceHoleContribution {
  contributions: { lineId: LineId; rings: Ring[] }[];
  regionBbox: { x0: number; y0: number; x1: number; y1: number };
}

/**
 * The shared per-face hole builder both {@link buildExclusionHoles} (the
 * cache-free reference) and {@link buildExclusionHolesCached} run — one owner
 * for the geometry, so the cached path cannot drift from the reference.
 */
function makeHoleContext(
  faces: RegionFace[],
  winners: { winner: LineId; assignmentId: string | null }[],
  lineOrder: LineId[],
  bands: SegmentBandSpec[],
  markers: StopMarkerSpec[],
  railWOf: (lineId: LineId) => number,
  slivers: RegionSliver[],
) {
  const orderIdx = orderIndexer(lineOrder);

  // Call-scoped memos over the repeated clipper calls below. Faces along one
  // winner's trunk request the same stripe silhouette — and adjacent faces of
  // one junction the same marker dilation — once per face; the arguments fully
  // determine the (pure, deterministic) result, so the memoized rings ARE what
  // the call would return, byte for byte. Keyed on the band OBJECT (stable
  // within one call) rather than bandKey so the key cannot alias.
  const stripeSil = new Map<SegmentBandSpec, Map<string, Ring[]>>();
  const markerDil = new Map<string, Ring[]>();

  // A line's painted footprint near one face, at body width (pad 0) or
  // silhouette width (pad railW). Bbox-filtered; markers dilate by pad/2.
  // A non-null `slice` (a slice cover id) keeps only that slice's stripes —
  // a SLICE winner's footprint — while markers stay included either way: a
  // marker is the LINE's paint, shared by its slices.
  const sliceHasStripe = (slice: string, band: SegmentBandSpec, k: number): boolean => {
    const pk = pairKeyOfCover(slice);
    if (pk !== null) return band.pairKey === pk;
    return (band.arms[k] ?? 0) === armOfCover(slice);
  };
  const paintNear = (
    lineId: LineId,
    box: RegionFace['bbox'],
    pad: number,
    slice: string | null = null,
  ): Ring[] => {
    const rings: Ring[] = [];
    for (const band of bands) {
      for (let k = 0; k < band.lines.length; k++) {
        if (band.lines[k].id !== lineId) continue;
        if (slice !== null && !sliceHasStripe(slice, band, k)) continue;
        if (!stripeIntersectsBox(band, k, box, (band.stripeWidths[k] + pad) / 2 + pad)) continue;
        let byArgs = stripeSil.get(band);
        if (!byArgs) stripeSil.set(band, (byArgs = new Map()));
        const argKey = `${k}|${pad}`;
        let sil = byArgs.get(argKey);
        if (!sil) {
          sil =
            pad === 0
              ? stripeBodyPolys(band, k)
              : offsetOpenPath(stripePathFor(band, k).pts, (band.stripeWidths[k] + pad) / 2);
          byArgs.set(argKey, sil);
        }
        rings.push(...sil);
      }
    }
    const markerRings: Ring[] = [];
    const markerIds: string[] = [];
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
      markerIds.push(`${m.lineId}#${m.stationId}`);
    }
    if (markerRings.length) {
      if (pad > 0) {
        // The dilation memo keys on the COLLECTED subset (in `markers` array
        // order) + pad: the one offsetClosed over exactly those rings is what
        // determines the output. Never split into per-marker dilations — the
        // call union-normalizes its whole operand, so the ring structure of
        // the single call is part of the byte-identity argument.
        const dilKey = `${markerIds.join(',')}|${pad}`;
        let dil = markerDil.get(dilKey);
        if (!dil) markerDil.set(dilKey, (dil = offsetClosed(markerRings, pad / 2)));
        rings.push(...dil);
      } else {
        rings.push(...markerRings);
      }
    }
    return rings;
  };

  // Uniform-grid bucket index over face bboxes, so the shield scan (and the
  // cached path's neighborhood signature) queries ~tens of candidates instead
  // of testing all faces per overridden face. Candidates come back sorted
  // ascending and re-checked against the exact bbox predicate, so shield
  // membership and push order are byte-identical to the linear scan.
  const cell = (() => {
    let maxExt = 32;
    const exts: number[] = [];
    for (const f of faces) {
      const ext = Math.max(f.bbox.x1 - f.bbox.x0, f.bbox.y1 - f.bbox.y0);
      exts.push(ext);
      maxExt = Math.max(maxExt, ext);
    }
    exts.sort((a, b) => a - b);
    return Math.max(16, 4 * (exts[exts.length >> 1] ?? 32), maxExt / 64);
  })();
  const grid = new Map<string, number[]>();
  for (let i = 0; i < faces.length; i++) {
    const b = faces[i].bbox;
    for (let gx = Math.floor(b.x0 / cell); gx <= Math.floor(b.x1 / cell); gx++) {
      for (let gy = Math.floor(b.y0 / cell); gy <= Math.floor(b.y1 / cell); gy++) {
        const k = `${gx},${gy}`;
        const list = grid.get(k);
        if (list) list.push(i);
        else grid.set(k, [i]);
      }
    }
  }
  const facesNear = (
    box: { x0: number; y0: number; x1: number; y1: number },
    pad: number,
  ): number[] => {
    const seen = new Set<number>();
    for (
      let gx = Math.floor((box.x0 - pad) / cell);
      gx <= Math.floor((box.x1 + pad) / cell);
      gx++
    ) {
      for (
        let gy = Math.floor((box.y0 - pad) / cell);
        gy <= Math.floor((box.y1 + pad) / cell);
        gy++
      ) {
        const list = grid.get(`${gx},${gy}`);
        if (list) for (const j of list) seen.add(j);
      }
    }
    return [...seen].filter((j) => boxesOverlap(faces[j].bbox, box, pad)).sort((a, b) => a - b);
  };

  /** The winner/loser decomposition of one overridden face, shared by the
   *  hole build and the cache's input signatures so the two cannot drift.
   *  LINE domain plus slices: a losing line loses with all its slices; a
   *  SLICE winner's sibling slices are additionally losers (same z — both
   *  paint orders exist, so the overlap must clip whichever sibling paints
   *  later), while a merged-line winner's own slices never are. */
  const loserPlanFor = (
    face: RegionFace,
    w: { winner: LineId; assignmentId: string | null },
  ): {
    winnerLine: LineId;
    winnerSlice: string | null;
    winnerRank: number;
    lineLosers: LineId[];
    sliceLosers: string[];
  } => {
    const winnerLine = lineOfCover(w.winner);
    const winnerSlice = isSliceCoverId(w.winner) ? w.winner : null;
    const winnerRank = orderIdx(winnerLine);
    const lineLosers = distinctCoverLines(face.lineIds).filter(
      (lineId) => lineId !== winnerLine && orderIdx(lineId) < winnerRank,
    );
    const sliceLosers =
      winnerSlice === null
        ? []
        : face.lineIds.filter(
            (id) => isSliceCoverId(id) && id !== w.winner && lineOfCover(id) === winnerLine,
          );
    return { winnerLine, winnerSlice, winnerRank, lineLosers, sliceLosers };
  };

  /** The per-face body. Caller has already established `w` is an overridden
   *  non-default winner; returns null when there is nothing to hole. */
  const contributionFor = (
    face: RegionFace,
    i: number,
    w: { winner: LineId; assignmentId: string | null },
  ): FaceHoleContribution | null => {
    const { winnerLine, winnerSlice, winnerRank, lineLosers, sliceLosers } = loserPlanFor(face, w);
    if (!lineLosers.length && !sliceLosers.length) return null;
    const railWWinner = railWOf(winnerLine);

    // Absorb adjacent dropped slivers into the reveal region (see the doc
    // comment): take only the part within SLIVER_ABSORB_REACH of this face,
    // and only slivers whose above-winner lines are all losers here.
    const loserSet = new Set(lineLosers);
    let region: Ring[] = face.face;
    let regionBbox = face.bbox;
    if (slivers.length) {
      const near = offsetClosed(face.face, SLIVER_ABSORB_REACH, 'miter');
      const absorbed: Ring[] = [];
      for (const s of slivers) {
        const sliverLines = distinctCoverLines(s.lineIds);
        if (!sliverLines.includes(winnerLine)) continue;
        if (!sliverLines.every((id) => orderIdx(id) >= winnerRank || loserSet.has(id))) continue;
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

    // A SLICE winner's footprint is its own slice's paint: the hole then
    // runs through THAT slice's ring, revealing its rails across the overlap
    // — the identical bridges-over reveal the inter-line path produces.
    const footprint =
      railWWinner > 0
        ? paintNear(winnerLine, regionBbox, railWWinner, winnerSlice)
        : offsetClosed(paintNear(winnerLine, regionBbox, 0, winnerSlice), -EXCLUSION_INSET);
    if (!footprint.length) return { contributions: [], regionBbox };
    // Differently-won neighboring faces, to subtract from every hole (see
    // the doc comment). Bbox-filtered generously: a miter dilation can poke
    // up to 3× reach (the miter limit) past a corner.
    const maxReach =
      Math.max(
        ...lineLosers.map((id) => railWOf(id)),
        ...(sliceLosers.length ? [railWWinner] : []),
      ) /
        2 +
      railWWinner / 2 +
      0.5;
    const shield: Ring[] = [];
    for (const j of facesNear(regionBbox, maxReach * 3)) {
      if (j === i || winners[j]?.winner === w.winner) continue;
      shield.push(...faces[j].face);
    }
    // Within one face, losers sharing a railW dilate the same region by the
    // same reach — memo the dilation: pure call, identical arguments. Loser
    // holes key by cover id: bare line = the line's whole paint, arm id =
    // that arm's stripes only (the render maps stripes to arm defs).
    const regionDil = new Map<number, Ring[]>();
    const contributions: { lineId: LineId; rings: Ring[] }[] = [];
    const loserKeys = [
      ...lineLosers.map((id) => ({ key: id, railW: railWOf(id) })),
      ...sliceLosers.map((id) => ({ key: id, railW: railWWinner })),
    ];
    for (const { key: loserKey, railW } of loserKeys) {
      const reach = railW / 2 + railWWinner / 2 + 0.5;
      let dil = regionDil.get(reach);
      if (!dil) regionDil.set(reach, (dil = offsetClosed(region, reach, 'miter')));
      const dilated = intersect(dil, footprint);
      const hole = shield.length ? subtract(dilated, shield) : dilated;
      if (!hole.length) continue;
      contributions.push({ lineId: loserKey, rings: hole });
    }
    return { contributions, regionBbox };
  };

  /** Is this face's winner an override the base paint doesn't already show? */
  const overridden = (
    face: RegionFace,
    w: { winner: LineId; assignmentId: string | null } | undefined,
  ): w is { winner: LineId; assignmentId: string } =>
    !!w && !!w.assignmentId && w.winner !== defaultWinner(face, orderIdx);

  return { orderIdx, contributionFor, loserPlanFor, overridden, facesNear };
}

/**
 * Post-pass over an assembled hole map: a slice-keyed def must also carry
 * its line's line-level holes, because a paint element references exactly
 * ONE clipPath — a slice-losing stripe may lose line-level faces too, and it
 * will reference the slice def. Line rings first, then the slice's own, so
 * the merge is order-deterministic. Shared by the reference and cached
 * builders.
 */
function mergeArmHoleKeys(holes: Map<LineId, Ring[]>): Map<LineId, Ring[]> {
  for (const [key, rings] of holes) {
    if (!isSliceCoverId(key)) continue;
    const lineRings = holes.get(lineOfCover(key));
    if (lineRings?.length) holes.set(key, [...lineRings, ...rings]);
  }
  return holes;
}

/** See the block comment above. This is the cache-free REFERENCE; production
 *  renders go through {@link buildExclusionHolesCached}, whose output must
 *  byte-equal this. */
export function buildExclusionHoles(
  faces: RegionFace[],
  winners: { winner: LineId; assignmentId: string | null }[],
  lineOrder: LineId[],
  bands: SegmentBandSpec[],
  markers: StopMarkerSpec[],
  railWOf: (lineId: LineId) => number,
  slivers: RegionSliver[] = [],
): Map<LineId, Ring[]> {
  const ctx = makeHoleContext(faces, winners, lineOrder, bands, markers, railWOf, slivers);
  const holes = new Map<LineId, Ring[]>();
  faces.forEach((face, i) => {
    const w = winners[i];
    if (!ctx.overridden(face, w)) return;
    const c = ctx.contributionFor(face, i, w);
    if (!c) return;
    for (const { lineId, rings } of c.contributions) {
      const list = holes.get(lineId);
      if (list) list.push(...rings);
      else holes.set(lineId, [...rings]);
    }
  });
  return mergeArmHoleKeys(holes);
}

// ---------------------------------------------------------------------------
// Cross-frame exclusion-hole cache. buildExclusionHoles recomputes every
// overridden face's holes per pointermove, yet on a typical drag frame ~all
// of them are byte-identical to the previous frame's. Each entry records the
// full input signature of one face's contribution; an entry is reused only
// when every input is provably unchanged, so the cached path's output equals
// the reference's byte for byte (pinned by lineRegions.holeCache.test.ts).

interface FaceHoleEntry {
  contribution: FaceHoleContribution;
  /** Winner id | winner railW | default winner | losers with their railWs. */
  inputSig: string;
  /** (face key, winner) of every shield-scan candidate near the region. */
  neighborSig: string;
  /** (sliver token, gate outcomes) of every bbox-prefilter-passing sliver. */
  sliverSig: string;
}

/**
 * How the cache knows WHICH transition its dirty boxes describe: the
 * incremental builder's state objects are unique per build, so `state` /
 * `prevState` identity ties the boxes to exactly one before/after pair. A
 * chain the cache cannot verify (an undo served from the geometry LRU, a
 * cold start) flushes to a full rebuild — over-invalidation is always safe.
 */
export interface HoleChain {
  state: unknown;
  prevState: unknown;
  dirtyBoxes: { x0: number; y0: number; x1: number; y1: number }[];
}

let holeCacheSlot: { validForState: unknown; entries: Map<string, FaceHoleEntry> } | null = null;

/** Test hook: forget everything, as at app start. */
export function resetExclusionHoleCache(): void {
  holeCacheSlot = null;
}

// Face identity = collision-hardened content key, memoized per ring-array
// reference (untouched comps hand out clones SHARING `face.face`, so
// unchanged faces never re-hash; a rebuilt comp's fresh-but-identical face
// re-hashes once and lands on the same key).
const faceKeyCache = new WeakMap<Face, string>();
const faceKeyOf = (face: RegionFace): string => {
  let key = faceKeyCache.get(face.face);
  if (!key) faceKeyCache.set(face.face, (key = ringSetKey(face.face, face.bbox)));
  return key;
};

// Sliver identity is per OBJECT (untouched comps push cached sliver objects
// by reference; a rebuilt comp's fresh slivers mint new tokens and force a
// spurious-but-safe recompute of the faces near them).
const sliverTokens = new WeakMap<RegionSliver, number>();
let nextSliverToken = 1;
const sliverTokenOf = (s: RegionSliver): number => {
  let t = sliverTokens.get(s);
  if (!t) sliverTokens.set(s, (t = nextSliverToken++));
  return t;
};

/** Optional instrumentation for the cache's tests. */
export interface HoleCacheStats {
  reused: number;
  recomputed: number;
}

/**
 * {@link buildExclusionHoles} with a per-face cross-frame cache. An entry for
 * face F is reused only when ALL of:
 *
 *  1. F's content key matches (same rings, same place);
 *  2. the chain is verified (see {@link HoleChain}) and no dirty box comes
 *     within `R` of F's bbox — R conservatively covers every reach through
 *     which geometry enters F's contribution: paintNear's stripe/marker
 *     collection (up to a stripe width + 1.5 railW), sliver absorption
 *     (3× SLIVER_ABSORB_REACH, miter), loser dilation (3× reach, miter),
 *     and the unit-box-vs-silhouette slack;
 *  3. the presentation inputs match (`inputSig`: winner, railWs, default);
 *  4. the shield neighborhood matches (`neighborSig`: every candidate face's
 *     content key + CURRENT winner — a neighbor flipping between same- and
 *     different-winner must invalidate, so same-winner candidates are in the
 *     sig even though they are excluded from the shield);
 *  5. the nearby-sliver set matches (`sliverSig`: token + BOTH absorb-gate
 *     outcomes per bbox-passing sliver — a lineOrder edit can flip a gate
 *     through a sliver line that is NOT in F's cover, so the outcomes are
 *     part of the signature, not derivable from the face alone).
 *
 * Under 1-5 every input to `contributionFor` is identical to the entry's
 * build frame and the clipper is deterministic, so reuse is byte-exact; the
 * assembly appends reused and fresh contributions in face order, exactly as
 * the reference does.
 */
export function buildExclusionHolesCached(
  faces: RegionFace[],
  winners: { winner: LineId; assignmentId: string | null }[],
  lineOrder: LineId[],
  bands: SegmentBandSpec[],
  markers: StopMarkerSpec[],
  railWOf: (lineId: LineId) => number,
  slivers: RegionSliver[] = [],
  chain: HoleChain | null = null,
  stats?: HoleCacheStats,
): Map<LineId, Ring[]> {
  const ctx = makeHoleContext(faces, winners, lineOrder, bands, markers, railWOf, slivers);
  const holes = new Map<LineId, Ring[]>();
  const nextEntries = new Map<string, FaceHoleEntry>();

  // Which transition do we know about? Same state ⇒ geometry is unchanged
  // since the cache was filled (only presentation can differ — the sigs
  // catch it). Prev state ⇒ the chain's boxes are exactly what changed.
  // Anything else ⇒ the cache cannot prove reuse; rebuild everything.
  const prevSlot = holeCacheSlot;
  const reusable =
    prevSlot && chain
      ? chain.state === prevSlot.validForState
        ? { entries: prevSlot.entries, boxes: [] as HoleChain['dirtyBoxes'] }
        : chain.prevState === prevSlot.validForState
          ? { entries: prevSlot.entries, boxes: chain.dirtyBoxes }
          : null
      : null;

  // The reuse radius. Every geometric input to a face's contribution is
  // collected within: a stripe silhouette admitted by paintNear's filter
  // (≤ stripeWidth/2 + 1.5·railW past the region bbox), a marker (≤ width +
  // railW), an absorbed sliver (≤ 3·SLIVER_ABSORB_REACH, miter), a loser
  // dilation poke (≤ 3·(railW + 0.5), miter) — and the region bbox itself
  // sits ≤ 3·SLIVER_ABSORB_REACH outside the face bbox. Unit boxes trail
  // painted silhouettes by ≤ railW/2 + 1. Sum every term, generously: an
  // over-padded R costs a needless recompute, never a wrong reuse.
  let maxW = 0;
  let maxRailW = 0;
  for (const band of bands) {
    for (let k = 0; k < band.lines.length; k++) {
      maxW = Math.max(maxW, band.stripeWidths[k]);
      maxRailW = Math.max(maxRailW, railWOf(band.lines[k].id));
    }
  }
  for (const m of markers) {
    maxW = Math.max(maxW, m.width);
    maxRailW = Math.max(maxRailW, railWOf(m.lineId));
  }
  const R = 6 * SLIVER_ABSORB_REACH + 1.5 * maxW + 6 * maxRailW + 4;

  faces.forEach((face, i) => {
    const w = winners[i];
    if (!ctx.overridden(face, w)) return;

    // The same decomposition contributionFor runs — shared, so the signature
    // captures exactly the inputs the geometry consumed.
    const { winnerLine, winnerRank, lineLosers, sliceLosers } = ctx.loserPlanFor(face, w);
    const loserSet = new Set(lineLosers);
    const railWWinner = railWOf(winnerLine);
    const inputSig =
      `${w.winner}|${railWWinner}|${defaultWinner(face, ctx.orderIdx)}|` +
      lineLosers.map((l) => `${l}:${railWOf(l)}`).join(',') +
      `|${sliceLosers.join(',')}`;
    let sliverSig = '';
    for (const s of slivers) {
      if (!boxesOverlap(s.bbox, face.bbox, SLIVER_ABSORB_REACH * 3)) continue;
      const sliverLines = distinctCoverLines(s.lineIds);
      const gWinner = sliverLines.includes(winnerLine) ? 1 : 0;
      const gLosers = sliverLines.every((id) => ctx.orderIdx(id) >= winnerRank || loserSet.has(id))
        ? 1
        : 0;
      sliverSig += `${sliverTokenOf(s)}:${gWinner}${gLosers};`;
    }
    const maxReach =
      lineLosers.length || sliceLosers.length
        ? Math.max(
            ...lineLosers.map((id) => railWOf(id)),
            ...(sliceLosers.length ? [railWWinner] : []),
          ) /
            2 +
          railWWinner / 2 +
          0.5
        : 0;
    const neighborSigAround = (box: FaceHoleContribution['regionBbox']): string => {
      let sig = '';
      for (const j of ctx.facesNear(box, maxReach * 3)) {
        if (j === i) continue;
        sig += `${faceKeyOf(faces[j])}=${winners[j]?.winner ?? ''};`;
      }
      return sig;
    };

    const key = faceKeyOf(face);
    const prev = reusable?.entries.get(key);
    let entry: FaceHoleEntry | null = null;
    if (
      prev &&
      prev.inputSig === inputSig &&
      prev.sliverSig === sliverSig &&
      !reusable!.boxes.some((d) => boxesOverlap(d, face.bbox, R)) &&
      // The shield neighborhood, queried against the ENTRY's region bbox —
      // identical to this frame's by conditions 1/2/5.
      neighborSigAround(prev.contribution.regionBbox) === prev.neighborSig
    ) {
      entry = prev;
      if (stats) stats.reused++;
    }

    if (!entry) {
      const c = ctx.contributionFor(face, i, w);
      if (stats) stats.recomputed++;
      if (!c) return; // no losers — nothing to hole, nothing to cache
      entry = {
        contribution: c,
        inputSig,
        neighborSig: neighborSigAround(c.regionBbox),
        sliverSig,
      };
    }

    nextEntries.set(key, entry);
    for (const { lineId, rings } of entry.contribution.contributions) {
      const list = holes.get(lineId);
      if (list) list.push(...rings);
      else holes.set(lineId, [...rings]);
    }
  });

  holeCacheSlot = { validForState: chain ? chain.state : {}, entries: nextEntries };
  return mergeArmHoleKeys(holes);
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

/**
 * Per-face effective winner: bound assignment's choice, else lineOrder-first.
 * The winner is a COVER ID: a bare LineId ("this line, arms merged" — the
 * only spelling plain faces ever produce) or an arm cover id when the
 * assignment carries `winnerPairKey` and the face's cover distinguishes that
 * arm. A stale or unresolvable arm choice degrades to the merged line —
 * never a wrong clip.
 */
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
    if (!assignmentId) return { winner: defaultWinner(face, orderIdx), assignmentId: null };
    const a = assignments[assignmentId];
    let winner: LineId = a.lineId;
    if (a.winnerPairKey !== undefined) {
      // Finest spelling the face distinguishes wins: the band itself at a
      // mid-edge crossing, else the arm containing it at a branch mouth.
      const edgeId = edgeCoverId(a.lineId, a.winnerPairKey);
      if (face.lineIds.includes(edgeId)) {
        winner = edgeId;
      } else {
        const arm = armOfLinePairKey(bands, a.lineId, a.winnerPairKey);
        const armId = arm === null ? null : armCoverId(a.lineId, arm);
        if (armId && face.lineIds.includes(armId)) winner = armId;
      }
    }
    return { winner, assignmentId };
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
  // Legality: a line target is satisfiable by any spelling of that line; a
  // slice target needs the cover to distinguish THAT slice (spellings are
  // consistent within one build, so direct membership is exact).
  const canShow = (i: number): boolean =>
    isSliceCoverId(target)
      ? faces[i].lineIds.includes(target)
      : distinctCoverLines(faces[i].lineIds).includes(target);
  for (let i = 0; i < faces.length; i++) {
    if (i === seedIndex) continue;
    if (!canShow(i)) continue;
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
  // Cycle domain: the cover's distinct LINES first (each meaning "that line,
  // slices merged" — exactly the pre-arm cycle for plain faces), then any
  // slices the cover distinguishes, by line z then slice id. So a plain face
  // cycles as it always did, a pure self face cycles merged → slice → slice
  // → merged (delete), and a mixed face offers lines then slices.
  const byLineThenId = (a: string, b: string) => {
    const la = lineOfCover(a);
    const lb = lineOfCover(b);
    return orderIdx(la) - orderIdx(lb) || (la < lb ? -1 : la > lb ? 1 : a < b ? -1 : a > b ? 1 : 0);
  };
  const order = [
    ...distinctCoverLines(face.lineIds).sort((a, b) => orderIdx(a) - orderIdx(b) || (a < b ? -1 : 1)),
    ...face.lineIds.filter(isSliceCoverId).sort(byLineThenId),
  ];
  let current = bound?.lineId ?? order[0];
  if (bound && bound.winnerPairKey !== undefined) {
    const edgeId = edgeCoverId(bound.lineId, bound.winnerPairKey);
    if (face.lineIds.includes(edgeId)) {
      current = edgeId;
    } else {
      const arm = armOfLinePairKey(bands, bound.lineId, bound.winnerPairKey);
      const armId = arm === null ? null : armCoverId(bound.lineId, arm);
      if (armId && face.lineIds.includes(armId)) current = armId;
    }
  }
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
  const lineId = lineOfCover(winner);
  const anchors = mintAnchors(face, bands);
  // A slice winner persists as the pairKey of ITS OWN minted anchor — the
  // one cross-build slice identity (arm indices and cover spellings are
  // build-local). By construction that anchor exists: a slice is in the
  // cover only when its stripes overlap the face, so it minted from a real
  // span.
  let winnerPairKey: string | undefined;
  if (isSliceCoverId(winner)) {
    const edgePk = pairKeyOfCover(winner);
    const arm = armOfCover(winner);
    winnerPairKey = anchors.find(
      (an) =>
        an.lineId === lineId &&
        (edgePk !== null
          ? an.pairKey === edgePk
          : armOfLinePairKey(bands, lineId, an.pairKey) === arm),
    )?.pairKey;
    if (winnerPairKey === undefined) return { id, assignment: null };
  }
  return {
    id,
    // The stored cover is DISTINCT LINES whatever the face's spelling — arm
    // ids are build-local and must never persist.
    assignment: {
      id,
      lineId,
      lines: distinctCoverLines(face.lineIds).sort(),
      anchors,
      ...(winnerPairKey !== undefined ? { winnerPairKey } : {}),
    },
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
