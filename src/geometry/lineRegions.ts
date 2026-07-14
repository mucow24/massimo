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
import { closestParamOnOffsetPath, sampleOffsetPathByArcLength } from './lineTagGeometry';
import { leftNormal, perp, rotatedRectCorners, type Vec2 } from './vec';
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
      const cosArg = Math.min(1, Math.max(-1, 1 - tol / s.r));
      const maxStep = 2 * Math.acos(cosArg);
      const n = Math.min(256, Math.max(1, Math.ceil(s.theta / Math.max(maxStep, 1e-4))));
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
  const segs = emitOffsetSegments(band.centerline, band.radius, band.stripeOffsets[stripeIndex]);
  const pts = flattenOffsetSegments(segs);
  return offsetOpenPath(pts, band.stripeWidths[stripeIndex] / 2);
}

/**
 * The rendered footprint of a stop marker, or nothing when the marker paints
 * nothing (patterned styles at interior stops).
 */
function markerBodyRings(spec: StopMarkerSpec): Ring[] {
  const half = spec.width / 2;
  const center = { x: spec.cx, y: spec.cy };
  if (spec.style === 'solid' || spec.style === 'hatched' || spec.style === 'hatched-mirror') {
    const rad = (spec.rotationDeg * Math.PI) / 180;
    return [Array.from(rotatedRectCorners(center, half, half, rad))];
  }
  // Patterned (dashed/dotted/dashed-open): nothing at interior stops; a
  // width/2-long, width-wide stub continuing outward at a terminus.
  if (!spec.outward) return [];
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
): Map<LineId, Ring[]> {
  const raw = new Map<LineId, Ring[]>();
  const add = (id: LineId, rings: Ring[]) => {
    if (!rings.length) return;
    const list = raw.get(id);
    if (list) list.push(...rings);
    else raw.set(id, [...rings]);
  };
  for (const band of bands) {
    for (let k = 0; k < band.lines.length; k++) add(band.lines[k].id, stripeBodyPolys(band, k));
  }
  for (const m of markers) add(m.lineId, markerBodyRings(m));
  const out = new Map<LineId, Ring[]>();
  for (const [id, rings] of raw) {
    const merged = unionAll(rings);
    if (merged.length) out.set(id, merged);
  }
  return out;
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
  const target = Math.min(Math.max(d, 0), sp.len);
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

const boxesOverlap = (
  a: { x0: number; y0: number; x1: number; y1: number },
  b: { x0: number; y0: number; x1: number; y1: number },
  pad = 0,
) => a.x0 <= b.x1 + pad && b.x0 <= a.x1 + pad && a.y0 <= b.y1 + pad && b.y0 <= a.y1 + pad;

// ---------------------------------------------------------------------------
// Overlap faces

function ringsBbox(rings: Ring[]): { x0: number; y0: number; x1: number; y1: number } {
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

/** All overlap faces (cover ≥ 2 lines) of the current geometry. */
export function buildOverlapRegions(
  bands: SegmentBandSpec[],
  markers: StopMarkerSpec[],
): RegionFace[] {
  const bodies = buildLineBodies(bands, markers);
  const ids = [...bodies.keys()].sort();
  if (ids.length < 2) return [];
  const boxes = new Map(ids.map((id) => [id, ringsBbox(bodies.get(id)!)]));

  // Restrict everything to the pairwise-overlap zone: any ≥2-cover point is
  // in some pairwise intersection, so cells inside the zone subdivide exactly
  // as they would in the full arrangement, at a fraction of the cost.
  const zoneParts: Ring[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      if (!boxesOverlap(boxes.get(ids[i])!, boxes.get(ids[j])!)) continue;
      zoneParts.push(...intersect(bodies.get(ids[i])!, bodies.get(ids[j])!));
    }
  }
  if (!zoneParts.length) return [];
  const zone = unionAll(zoneParts);

  // Iterative cell splitting: each cell is a maximal area with one cover set.
  let cells: { cover: LineId[]; rings: Ring[] }[] = [];
  for (const id of ids) {
    const restricted = intersect(bodies.get(id)!, zone);
    if (!restricted.length) continue;
    const next: typeof cells = [];
    let remaining = restricted;
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
  for (const cell of cells) {
    if (cell.cover.length < 2) continue;
    for (const face of splitIntoFaces(cell.rings)) {
      const eroded = offsetClosed(face, -SLIVER_ERODE);
      if (!eroded.length) continue; // hairline sliver
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
          if (!offsetClosed(piece, -SLIVER_ERODE).length) continue;
          pushFace(piece, cell.cover);
        }
        remaining = subtract(remaining, blob);
      }
      // Whatever is left is sub-sliver neck residue — dropped, like any
      // standalone sliver. (Painted patches overdraw across it anyway.)
    }
  }
  out.sort(
    (a, b) =>
      a.bbox.y0 - b.bbox.y0 ||
      a.bbox.x0 - b.bbox.x0 ||
      (a.lineIds.join(',') < b.lineIds.join(',') ? -1 : 1),
  );
  out.forEach((f, i) => {
    const cx = Math.round((f.bbox.x0 + f.bbox.x1) / 2);
    const cy = Math.round((f.bbox.y0 + f.bbox.y1) / 2);
    f.key = `${f.lineIds.join(',')}@${cx},${cy}#${i}`;
  });
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
      const side = Math.max(-half, Math.min(half, raw));
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
    const d = Math.min(Math.max(raw, 0), sp.len);
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
    const t =
      lenSq > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / lenSq)) : 0;
    const qx = a.x + ex * t;
    const qy = a.y + ey * t;
    min = Math.min(min, Math.hypot(p.x - qx, p.y - qy));
  }
  return min;
}

/**
 * Nearest-compatible-face binding (shared by rendering and reconciliation):
 * assignment id → face index. Distances are measured in arc length along
 * each anchor's line — that is what follows a crossing that slides ALONG an
 * unmoved line, where any world-point containment test loses it. Unbindable
 * assignments are absent from the result (dormant). One assignment per face:
 * on conflict the earlier id (or the caller's explicit `order`, which
 * reconciliation uses to give larger old faces priority) keeps it.
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
 */
export const EXCLUSION_INSET = 0.25;

/**
 * Region overrides, subtractively: for every face whose bound choice differs
 * from its lineOrder default, every covering line painted ABOVE the winner
 * gets a clip hole — the winner then shows through as its ORIGINAL,
 * continuous, never-repainted base stroke. Nothing is painted twice (no
 * doubled antialiased edges, no seams inside the winner, tangent territory
 * untouched), and holes hug the face (adjacent regions can't be nicked).
 *
 * The hole for loser L at face F with winner W is the union of:
 *  - CORE — W's body over L: F itself. Uncased W: F ∩ erode(bodyW,
 *    EXCLUSION_INSET) so the hole edge lands on opaque winner paint. Cased
 *    W: F ∪ (silhouetteW ∩ dilate(F, railW_W/2 + ε)) — the hole runs on
 *    THROUGH W's white ring, uncovering W's rails where they cross L: the
 *    rails are already painted in the base pass, buried under L; revealing
 *    them gives the override the exact "winner bridges over" look of a
 *    natural top line (no inset needed — no exposed body edge remains).
 *  - FRINGE (cased L): silhouetteL ∩ bodyW ∩ dilate(F, railW_L/2 + ε) — L's
 *    white casing fringe extends railW/2 beyond its body, i.e. beyond F,
 *    and would otherwise slash across the winner's continuous run at every
 *    face boundary.
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
          const segs = emitOffsetSegments(band.centerline, band.radius, band.stripeOffsets[k]);
          rings.push(
            ...offsetOpenPath(flattenOffsetSegments(segs), (band.stripeWidths[k] + pad) / 2),
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
    const railWWinner = railWOf(w.winner);
    const body = paintNear(w.winner, face.bbox, 0);
    if (!body.length) return;
    const core =
      railWWinner > 0
        ? unionAll([
            ...face.face,
            ...intersect(
              paintNear(w.winner, face.bbox, railWWinner),
              offsetClosed(face.face, railWWinner / 2 + 0.5),
            ),
          ])
        : intersect(face.face, offsetClosed(body, -EXCLUSION_INSET));
    if (!core.length) return;
    const winnerRank = orderIdx(w.winner);
    for (const lineId of face.lineIds) {
      if (lineId === w.winner) continue;
      if (orderIdx(lineId) >= winnerRank) continue; // painted below the winner
      const railWLoser = railWOf(lineId);
      let hole = core;
      if (railWLoser > 0) {
        const fringe = intersect(
          intersect(paintNear(lineId, face.bbox, railWLoser), body),
          offsetClosed(face.face, railWLoser / 2 + 0.5),
        );
        if (fringe.length) hole = unionAll([...core, ...fringe]);
      }
      const list = holes.get(lineId);
      if (list) list.push(...hole);
      else holes.set(lineId, [...hole]);
    }
  });
  return holes;
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

/** The click interaction: cycle the face's winner, deleting at the default. */
export function regionClickAction(args: {
  face: RegionFace;
  bound: RegionAssignment | null;
  lineOrder: LineId[];
  dir: 1 | -1;
  bands: SegmentBandSpec[];
  newId: string;
}): { id: string; assignment: RegionAssignment | null } {
  const { face, bound, lineOrder, dir, bands, newId } = args;
  const orderIdx = orderIndexer(lineOrder);
  const order = [...face.lineIds].sort((a, b) => orderIdx(a) - orderIdx(b) || (a < b ? -1 : 1));
  const current = bound?.lineId ?? order[0];
  const at = Math.max(0, order.indexOf(current));
  const next = order[(at + dir + order.length) % order.length];
  const id = bound?.id ?? newId;
  if (next === order[0]) return { id, assignment: null };
  return {
    id,
    assignment: { id, lineId: next, lines: [...face.lineIds], anchors: mintAnchors(face, bands) },
  };
}
