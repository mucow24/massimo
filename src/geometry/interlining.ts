import { Line, LineId, LineStyle, Station, StationId, StopCell } from '../model/types';
import { pairKeyOf } from '../model/pairKey';
import { Vec2, sub, len, norm, dot } from './vec';
import { dirIndex, offsetFilletPath, route } from './router';
import { rotateBy, STOP_SIZE, stopCenterAt, travelDirLocal } from './orientation';
import { LAYER_WEIGHT, segmentPriority, stationLayerFor } from '../model/layerPriority';

export interface SegmentBandSpec {
  pairKey: string;
  // Stable per-band identity for React keying. A station-pair can have
  // multiple bands (different axis buckets, or non-contiguous perpendicular
  // groups within a bucket); each band's line set is disjoint from its
  // siblings, so `pairKey + sorted(line ids)` is unique. Without this,
  // sibling bands collide on `pairKey` keys and React's reconciler leaks
  // stale fibers across renders.
  bandKey: string;
  fromId: StationId;
  toId: StationId;
  // Lines in this band, in render order (perpendicular to direction of travel).
  // Presentation-free by design: only the line id lives here. Color and
  // per-segment style are resolved at render time from the live `lines` map
  // (color via the line itself, style via {@link resolveSegmentStyle} keyed on
  // `pairKey`), so a color/style edit repaints without rebuilding geometry.
  lines: { id: LineId }[];
  paths: string[];
  warning: boolean;
  centerline: Vec2[];
  // Effective centerline curve radius used to build `paths`. For an n-stripe
  // band this is bumped above the configured `curveRadius` toward
  // `R + (n-1)/2 * STOP_SIZE` so the innermost stripe still hits R, then
  // capped per-endpoint so the stop marker (a STOP_SIZE square) fits within
  // the post-fillet straight section. Callers sampling offset paths against
  // `centerline` (line-tag layer, hover/click) MUST use this rather than the
  // raw doc.curveRadius, or they'll desync from painted geometry.
  radius: number;
  // Per-stripe z-priority: parallel to `lines` and `paths`. Smallest = front-most.
  // Each stripe carries its own line's lineOrder index so a perpendicular
  // line whose layer is sandwiched between two interlined lines renders
  // between their stripes (not behind the whole band).
  linePriorities: number[];
}

// A single colored stop square for one line at one station, with its
// per-line priority. Rendered alongside bands so that a back-stack line's
// stop square doesn't paint over a front-stack line's band passing through.
//
// `style` is derived from this line's segmentStyles at the incident
// adjacencies: any hatched adjacency wins (so the hatch pattern visually
// flows through the station); otherwise dashed only if EVERY adjacency is
// dashed (so two dashed corridors meet cleanly at the stop center with no
// painted marker breaking up the dash rhythm); otherwise solid.
//
// `outward` is set only when this is a TERMINUS on a dashed run (single
// dashed adjacency). The renderer paints a short cap-extension stub
// outward along this unit vector so the dashes fill the outer half of the
// dot — without it the dashed line would visually end mid-dot.
export interface StopMarkerSpec {
  cx: number;
  cy: number;
  color: string;
  lineId: LineId;
  stationId: StationId;
  rotationDeg: number; // station rotation in degrees CW
  priority: number;
  style: LineStyle;
  outward: Vec2 | null;
}

interface SegInfo {
  // Canonical (alphabetic): fromId < toId always. Both fromCell and toCell are
  // this line's stops at canonFrom and canonTo. So segs from different lines
  // through the same station-pair share a coordinate basis when bucketed.
  fromId: StationId;
  toId: StationId;
  fromCell: StopCell;
  toCell: StopCell;
  lineId: LineId;
  // Unit world vector along this LINE'S travel direction at this segment
  // (line.stations[i] → line.stations[i+1]). Drives auto-axis orientation
  // resolution. Not necessarily canonFrom→canonTo — a line traversing the
  // pair in reverse alphabetic order has worldHint pointing canonTo→canonFrom.
  worldHint: Vec2;
}

// Stop center in WORLD coords (anchor + cell offset rotated by station rotation).
// This IS the rendered position — every visual consumer (markers, bands,
// transfers, snap candidates) reads world positions through here. Moving a
// stop's (row, col) is the ONLY way to change its on-screen location;
// neighboring stops have no effect.
export function stopPosWorld(cell: StopCell, station: Station): Vec2 {
  const local = stopCenterAt(cell.row, cell.col);
  const a = (station.rotation * Math.PI) / 4;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return {
    x: station.x + local.x * c - local.y * s,
    y: station.y + local.x * s + local.y * c,
  };
}

// Rotate a world-frame vector into the unrotated station-local frame so that
// `travelDirLocal` can decide which way an auto-axis stop should travel.
function worldToStationLocal(v: Vec2, station: Station): Vec2 {
  const a = -(station.rotation * Math.PI) / 4;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

export function travelDirWorld(cell: StopCell, station: Station, worldHint: Vec2 | null): Vec2 {
  const localHint = worldHint ? worldToStationLocal(worldHint, station) : null;
  return rotateBy(travelDirLocal(cell.orientation, localHint), station.rotation);
}

/**
 * Resolve the rendered style of one line on one segment (identified by its
 * canonical {@link pairKeyOf} key). Per-segment overrides live in
 * `line.segmentStyles`; absent an override, a segment is solid.
 *
 * Single source of truth shared by geometry building (which bakes the style
 * into each stripe) and MapCanvas's render-time presentation refresh (which
 * re-derives it live, since the geometry memo intentionally ignores
 * presentation — see the `bands` memo). Keeping both on this one resolver
 * means a style edit can never disagree between the two.
 */
export function resolveSegmentStyle(line: Line, pairKey: string): LineStyle {
  return line.segmentStyles?.[pairKey] ?? 'solid';
}

/**
 * Build all colored bands for the map. A "band" is one or more lines that
 * share a station-pair and pass through it with matching stop orientations
 * AND grid-adjacent cells along the perpendicular-to-travel axis at both
 * stations. Bands render with stroke-width = STOP_SIZE per line, perpendicular
 * offsets `(k − (n−1)/2) * STOP_SIZE`.
 *
 * Composes {@link buildBandGeometry} (depends only on stations + line
 * topology) and {@link assignLinePriorities} (depends on `lineOrder` and
 * `segmentLayers`). Callers that want geometry to survive priority-only
 * changes (e.g. layering mode's outline / label memos) call the two halves
 * directly instead of this convenience wrapper.
 */
export function buildBands(
  stations: Record<StationId, Station>,
  lines: Record<LineId, Line>,
  curveRadius: number,
  lineOrder: LineId[] = [],
): SegmentBandSpec[] {
  const bands = buildBandGeometry(stations, lines, curveRadius);
  assignLinePriorities(bands, lines, lineOrder);
  return bands;
}

/**
 * Geometric half of {@link buildBands}: groups lines by canonical
 * station-pair, buckets by world travel axis, merges perpendicular-
 * adjacency runs, and computes the routed centerline + per-stripe paths.
 *
 * Reads only `stations`, `line.stations`, `line.segmentStyles`, and
 * `curveRadius`. None of those change on a per-segment layer cycle, so a
 * caller that memoizes this output gets a stable bands reference across
 * layer edits — that's how the layering-mode caches stay valid without
 * a content-hash workaround.
 *
 * Returns bands with `linePriorities: []`; call {@link assignLinePriorities}
 * to fill those in before consuming the array for paint order.
 */
export function buildBandGeometry(
  stations: Record<StationId, Station>,
  lines: Record<LineId, Line>,
  curveRadius: number,
): SegmentBandSpec[] {
  // 1. Collect per-line segments keyed by sorted station pair, with stop cells.
  const groups: Record<string, SegInfo[]> = {};

  for (const lineId of Object.keys(lines)) {
    const line = lines[lineId];
    for (let i = 0; i < line.stations.length - 1; i++) {
      const a = line.stations[i];
      const b = line.stations[i + 1];
      const sa = stations[a];
      const sb = stations[b];
      if (!sa || !sb) continue;
      const fromCell = sa.stops.find((c) => c.lineId === lineId);
      const toCell = sb.stops.find((c) => c.lineId === lineId);
      if (!fromCell || !toCell) continue;
      const key = pairKeyOf(a, b);
      const forward = a < b;
      // Line direction at this segment, regardless of canonical ordering.
      const dxLine = sb.x - sa.x;
      const dyLine = sb.y - sa.y;
      const lineLen = Math.hypot(dxLine, dyLine) || 1;
      (groups[key] ||= []).push({
        fromId: forward ? a : b,
        toId: forward ? b : a,
        fromCell: forward ? fromCell : toCell,
        toCell: forward ? toCell : fromCell,
        lineId,
        worldHint: { x: dxLine / lineLen, y: dyLine / lineLen },
      });
    }
  }

  // 2. Build interlined runs within each group.
  const bands: SegmentBandSpec[] = [];

  for (const [pairKey, segs] of Object.entries(groups)) {
    // Bucket by world travel AXIS at each end (mod 4). Two lines on the same
    // station-pair that share an axis can render as a single band — even if
    // they traverse the corridor in opposite directions. Their stops are at
    // the same world positions either way; the band's flow direction is
    // metadata that doesn't affect the rendered shape.
    const buckets: Record<string, SegInfo[]> = {};
    for (const s of segs) {
      const fromS = stations[s.fromId];
      const toS = stations[s.toId];
      if (!fromS || !toS) continue;
      const fAxis = dirIndex(travelDirWorld(s.fromCell, fromS, s.worldHint)) % 4;
      const tAxis = dirIndex(travelDirWorld(s.toCell, toS, s.worldHint)) % 4;
      const key = `${fAxis}|${tAxis}`;
      (buckets[key] ||= []).push(s);
    }

    for (const bucket of Object.values(buckets)) {
      if (bucket.length === 0) continue;
      // Reference travel directions / perpendicular axes from the first segment.
      const sample = bucket[0];
      const fromS = stations[sample.fromId];
      const toS = stations[sample.toId];
      // Resolve sample's tangent (gives us the AXIS), then sign-flip if
      // needed so the band's flow points canonFrom → canonTo. Without this,
      // if `bucket[0]` happens to be a line traversing the corridor in
      // reverse alphabetic order, the router gets a U-turn input.
      const sampleFDir = travelDirWorld(sample.fromCell, fromS, sample.worldHint);
      const sampleTDir = travelDirWorld(sample.toCell, toS, sample.worldHint);
      const canonDx = toS.x - fromS.x;
      const canonDy = toS.y - fromS.y;
      const fSign = sampleFDir.x * canonDx + sampleFDir.y * canonDy >= 0 ? 1 : -1;
      const tSign = sampleTDir.x * canonDx + sampleTDir.y * canonDy >= 0 ? 1 : -1;
      const fDir: Vec2 = { x: sampleFDir.x * fSign, y: sampleFDir.y * fSign };
      const tDir: Vec2 = { x: sampleTDir.x * tSign, y: sampleTDir.y * tSign };
      // leftOf(motion) — must match the perpendicular convention used by
      // offsetFilletPath. With this, sorting ascending by perp-projection
      // assigns lower-k indices to lines on the negative-offset (right of
      // motion) side — exactly what `(k − (n−1)/2) * STOP_SIZE` produces.
      const fPerp: Vec2 = { x: fDir.y, y: -fDir.x };
      const tPerp: Vec2 = { x: tDir.y, y: -tDir.x };

      // Enrich with world perp/parallel positions at each end for sorting and
      // adjacency comparison.
      type Enriched = {
        seg: SegInfo;
        fPerpPos: number;
        fParPos: number;
        tPerpPos: number;
        tParPos: number;
      };
      // All SegInfo in a bucket share the canonical from/to station IDs,
      // so the endpoint stations are fixed across the bucket — pull them
      // off the sample once.
      const enriched: Enriched[] = bucket.map((s) => {
        const fp = stopPosWorld(s.fromCell, fromS);
        const tp = stopPosWorld(s.toCell, toS);
        return {
          seg: s,
          fPerpPos: fp.x * fPerp.x + fp.y * fPerp.y,
          fParPos: fp.x * fDir.x + fp.y * fDir.y,
          tPerpPos: tp.x * tPerp.x + tp.y * tPerp.y,
          tParPos: tp.x * tDir.x + tp.y * tDir.y,
        };
      });
      enriched.sort((a, b) => a.fPerpPos - b.fPerpPos);

      // Greedily merge contiguous perp-adjacency in WORLD coords (≈ STOP_SIZE
      // step) at both ends, with matching parallel position at both ends.
      let group: Enriched[] = [];
      const flush = () => {
        if (group.length === 0) return;
        bands.push(
          buildBandSpec(
            group.map((e) => e.seg),
            curveRadius,
            pairKey,
            fDir,
            tDir,
            fromS,
            toS,
          ),
        );
        group = [];
      };
      const TOL = 0.5;
      for (const e of enriched) {
        if (group.length === 0) {
          group.push(e);
          continue;
        }
        const prev = group[group.length - 1];
        const dFromPerp = e.fPerpPos - prev.fPerpPos;
        const dToPerp = e.tPerpPos - prev.tPerpPos;
        const sameParA = Math.abs(e.fParPos - prev.fParPos) < TOL;
        const sameParB = Math.abs(e.tParPos - prev.tParPos) < TOL;
        if (
          Math.abs(dFromPerp - STOP_SIZE) < TOL &&
          Math.abs(dToPerp - STOP_SIZE) < TOL &&
          sameParA &&
          sameParB
        ) {
          group.push(e);
        } else {
          flush();
          group.push(e);
        }
      }
      flush();
    }
  }

  return bands;
}

/**
 * Priority half of {@link buildBands}: fills `band.linePriorities` from the
 * global `lineOrder` and each line's per-segment layer override. Mutates
 * the bands in place — the geometry array's reference is preserved, which
 * is what the layering-mode memos rely on.
 *
 * Reading split: depends on `lineOrder` and `lines[id].segmentLayers`, but
 * NOT on the geometric fields buildBandGeometry reads.
 */
export function assignLinePriorities(
  bands: SegmentBandSpec[],
  lines: Record<LineId, Line>,
  lineOrder: LineId[],
): void {
  // The actual back-to-front sort happens in buildOrderedRenderables, where
  // each stripe is emitted as its own renderable so a perpendicular line at
  // intermediate depth can interleave between the stripes of an interlined
  // band.
  const lineIndex = buildLineIndex(lineOrder, lines);
  const fallback = Object.keys(lineIndex).length;
  for (const band of bands) {
    band.linePriorities = band.lines.map((l) =>
      segmentPriority(lines[l.id], band.pairKey, lineIndex[l.id] ?? fallback),
    );
  }
}

// Flatten bands + markers into a single list of per-stripe renderables,
// sorted back-to-front for paint order. Each stripe in a band ships at its
// own line's z-priority so a line whose layer falls between two interlined
// lines correctly renders between their stripes.
//
// `kind` distinguishes:
//   - 'stripe' : one path of a band, identified by (band, stripeIndex).
//   - 'warning': a band's centerline ⚠ glyph (when band.warning). Paints at
//                the band's front-most stripe priority so it stays visible.
//   - 'marker' : a stop square for one line at one station.
export type OrderedRenderable =
  | { kind: 'stripe'; band: SegmentBandSpec; stripeIndex: number; priority: number }
  | { kind: 'warning'; band: SegmentBandSpec; priority: number }
  | { kind: 'marker'; spec: StopMarkerSpec; priority: number };

export function buildOrderedRenderables(
  bands: SegmentBandSpec[],
  markers: StopMarkerSpec[],
): OrderedRenderable[] {
  const list: OrderedRenderable[] = [];
  for (const band of bands) {
    for (let i = 0; i < band.lines.length; i++) {
      list.push({ kind: 'stripe', band, stripeIndex: i, priority: band.linePriorities[i] });
    }
    if (band.warning && band.linePriorities.length > 0) {
      list.push({ kind: 'warning', band, priority: Math.min(...band.linePriorities) });
    }
  }
  for (const m of markers) {
    list.push({ kind: 'marker', spec: m, priority: m.priority });
  }
  list.sort((a, b) => b.priority - a.priority);
  return list;
}

// Reconcile persisted lineOrder against the lines dict (filter dead IDs,
// append any missing). Returns a {lineId: index} map. Index 0 = front-most.
export function buildLineIndex(
  lineOrder: LineId[],
  lines: Record<LineId, Line>,
): Record<LineId, number> {
  const present = lineOrder.filter((id) => lines[id]);
  const seen = new Set(present);
  const reconciled = present.slice();
  for (const id of Object.keys(lines)) if (!seen.has(id)) reconciled.push(id);
  const idx: Record<LineId, number> = {};
  reconciled.forEach((id, i) => (idx[id] = i));
  return idx;
}

// One stop marker per (station, line stop) pair, in world coords, with the
// line's per-line z-priority. Rendered interleaved with bands.
//
// `bands` (optional) is consulted for dashed-terminus markers: we read the
// band's actual centerline tangent at the terminus so the cap-extension
// stub aligns with the rendered band path (which can curve through fillets,
// so a naive station-to-station direction would be wrong).
export function buildStopMarkers(
  stations: Record<StationId, Station>,
  lines: Record<LineId, Line>,
  lineOrder: LineId[],
  bands: SegmentBandSpec[] = [],
): StopMarkerSpec[] {
  const lineIndex = buildLineIndex(lineOrder, lines);
  const fallback = Object.keys(lineIndex).length;
  // Index bands by pairKey for O(1) lookup during outward computation.
  const bandByPair: Record<string, SegmentBandSpec> = {};
  for (const b of bands) bandByPair[b.pairKey] = b;
  const markers: StopMarkerSpec[] = [];
  for (const station of Object.values(stations)) {
    for (const cell of station.stops) {
      const line = lines[cell.lineId];
      if (!line) continue;
      const { x: cx, y: cy } = stopPosWorld(cell, station);
      // Rotate the marker square so its edges run parallel/perpendicular to
      // the stop's world-frame travel axis. For cardinal-axis stops this is
      // equivalent to station.rotation * 45 (mod 90, which the square's
      // 4-fold symmetry makes invisible); for diagonal stops it adds the
      // extra 45° needed to keep the square flush with the band edges.
      const worldTangent = rotateBy(travelDirLocal(cell.orientation), station.rotation);
      const rotationDeg = (Math.atan2(worldTangent.y, worldTangent.x) * 180) / Math.PI;
      const style = stationMarkerStyle(line, station.id);
      const stationLayer = stationLayerFor(line, station.id);
      const basePriority = lineIndex[cell.lineId] ?? fallback;
      markers.push({
        cx,
        cy,
        color: line.color,
        lineId: cell.lineId,
        stationId: station.id,
        rotationDeg,
        priority: basePriority - stationLayer * LAYER_WEIGHT,
        style,
        outward: style === 'dashed' ? terminusOutwardFromBand(line, station.id, bandByPair) : null,
      });
    }
  }
  return markers;
}

// Unit vector pointing outward from `stationId` along the band's actual
// tangent at the terminus, iff this station is a TERMINUS for the line
// (single adjacency) AND the corresponding band is in `bandByPair`. Returns
// null otherwise.
//
// Using the band's centerline (rather than a station-to-station direction)
// is what makes the cap-extension stub align with the rendered band path,
// even when the band routes through a fillet or has its endpoint shifted
// off the station's geometric center for interlining.
function terminusOutwardFromBand(
  line: Line,
  stationId: StationId,
  bandByPair: Record<string, SegmentBandSpec>,
): Vec2 | null {
  const indices: number[] = [];
  for (let i = 0; i < line.stations.length; i++) {
    if (line.stations[i] === stationId) indices.push(i);
  }
  if (indices.length !== 1) return null;
  const i = indices[0];
  let neighbourId: StationId | null = null;
  if (i === 0 && line.stations.length > 1) neighbourId = line.stations[1];
  else if (i === line.stations.length - 1 && line.stations.length > 1)
    neighbourId = line.stations[i - 1];
  if (!neighbourId) return null;
  const band = bandByPair[pairKeyOf(stationId, neighbourId)];
  if (!band || band.centerline.length < 2) return null;
  // Centerline goes canonFrom → canonTo. Pick the endpoint matching our
  // terminus station and read the tangent pointing OUT of the band there.
  const v = band.centerline;
  const atFrom = band.fromId === stationId;
  const atTo = band.toId === stationId;
  if (!atFrom && !atTo) return null;
  const a = atFrom ? v[1] : v[v.length - 2];
  const b = atFrom ? v[0] : v[v.length - 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return null;
  return { x: dx / len, y: dy / len };
}

// Derive the marker style from this line's segment styles at the adjacencies
// incident to `stationId`. Rule: if every adjacency shares the same non-solid
// style (dashed, hatched, or hatched-mirror), the dot inherits that style;
// otherwise it's solid. A mixed junction (e.g. one hatched + one solid, or
// hatched + hatched-mirror) resolves to solid so the dot covers the inner half
// of the patterned segment and the pattern visually starts past the dot's edge.
function stationMarkerStyle(line: Line, stationId: StationId): LineStyle {
  const styles = line.segmentStyles;
  if (!styles) return 'solid';
  const adjacencies: LineStyle[] = [];
  for (let i = 0; i < line.stations.length; i++) {
    if (line.stations[i] !== stationId) continue;
    if (i > 0) {
      adjacencies.push(styles[pairKeyOf(line.stations[i - 1], stationId)] ?? 'solid');
    }
    if (i < line.stations.length - 1) {
      adjacencies.push(styles[pairKeyOf(stationId, line.stations[i + 1])] ?? 'solid');
    }
  }
  if (adjacencies.length === 0) return 'solid';
  const first = adjacencies[0];
  if (first !== 'solid' && adjacencies.every((s) => s === first)) return first;
  return 'solid';
}

function buildBandSpec(
  group: SegInfo[],
  R: number,
  pairKey: string,
  // The band's canonical-direction tangents (signed canonFrom→canonTo). Must
  // be the same fDir/tDir the bucket loop used for sorting/grouping so the
  // router and the merge basis agree.
  fromDir: Vec2,
  toDir: Vec2,
  // The canonical endpoint stations for this band. All SegInfo in `group`
  // share these IDs by construction (a band is one pairKey + one bucket).
  fromStation: Station,
  toStation: Station,
): SegmentBandSpec {
  // Centerline endpoints are the mean of the band's per-line stop world
  // positions — i.e. the centroid of the contributing stop cells at each end.
  const fromWorlds = group.map((g) => stopPosWorld(g.fromCell, fromStation));
  const toWorlds = group.map((g) => stopPosWorld(g.toCell, toStation));
  const meanVec = (vs: Vec2[]): Vec2 => ({
    x: vs.reduce((a, p) => a + p.x, 0) / vs.length,
    y: vs.reduce((a, p) => a + p.y, 0) / vs.length,
  });
  const fromMeanWorld = meanVec(fromWorlds);
  const toMeanWorld = meanVec(toWorlds);

  // Bump centerline radius so the INNERMOST stripe still has radius ≥ R.
  // With n stripes at perp offsets `(k - (n-1)/2) * STOP_SIZE`, the extreme
  // |offset| is `(n-1)/2 * STOP_SIZE` — the inside stripe's effective radius
  // is `centerlineR − maxAbsOffset`, so we set centerlineR = R + maxAbsOffset
  // so the inner stripe sits at exactly R. Without this, a 4–5-line interline
  // collapses the inner curve toward a right angle as soon as |offset| ≥ R.
  const n = group.length;
  const maxAbsOffset = n > 1 ? ((n - 1) / 2) * STOP_SIZE : 0;
  const idealR = R + maxAbsOffset;

  const result = route(fromMeanWorld, fromDir, toMeanWorld, toDir, idealR);

  // Cap the centerline radius so the stop marker fits in the straight section
  // at each band endpoint. The marker is a STOP_SIZE × STOP_SIZE rect aligned
  // to the stop's local frame — it extends HALF (= STOP_SIZE/2) along travel
  // from the stop. For the marker's flat far-edge not to spill into the
  // curving arc (where it produces a visible stair-step at the marker's
  // boundary), the straight section before the fillet must be ≥ HALF. That
  // means at each end-corner i: r * tan(θ_i/2) ≤ edgeLen − HALF, so
  // r ≤ (edgeLen − HALF) / tan(θ_i/2). Cap centerline R to satisfy this at
  // both ends, but never below R (the user's configured min — they'd rather
  // see right-angle degeneracy than violate it).
  const verts = result.vertices;
  const HALF = STOP_SIZE / 2;
  let capR = idealR;
  if (verts.length >= 3) {
    const cornerCap = (edgeLen: number, inDir: Vec2, outDir: Vec2): number => {
      const cosA = Math.max(-1, Math.min(1, dot(inDir, outDir)));
      const theta = Math.acos(cosA);
      if (theta < 1e-6) return Infinity;
      const usable = edgeLen - HALF;
      if (usable <= 0) return 0;
      return usable / Math.tan(theta / 2);
    };
    const lastIdx = verts.length - 1;
    const fromEdgeLen = len(sub(verts[1], verts[0]));
    const fromIn = norm(sub(verts[1], verts[0]));
    const fromOut = norm(sub(verts[2], verts[1]));
    capR = Math.min(capR, cornerCap(fromEdgeLen, fromIn, fromOut));
    const toEdgeLen = len(sub(verts[lastIdx], verts[lastIdx - 1]));
    const toIn = norm(sub(verts[lastIdx - 1], verts[lastIdx - 2]));
    const toOut = norm(sub(verts[lastIdx], verts[lastIdx - 1]));
    capR = Math.min(capR, cornerCap(toEdgeLen, toIn, toOut));
  }
  const centerlineR = Math.max(R, Math.min(idealR, capR));

  const paths: string[] = [];
  const linesArr = group.map((g) => ({ id: g.lineId }));
  for (let k = 0; k < n; k++) {
    const offset = (k - (n - 1) / 2) * STOP_SIZE;
    paths.push(offsetFilletPath(result.vertices, centerlineR, offset));
  }

  const sortedLineIds = linesArr
    .map((l) => l.id)
    .slice()
    .sort();

  return {
    pairKey,
    bandKey: `${pairKey}#${sortedLineIds.join(',')}`,
    fromId: group[0].fromId,
    toId: group[0].toId,
    lines: linesArr,
    paths,
    warning: result.warning,
    centerline: result.vertices,
    radius: centerlineR,
    linePriorities: [], // overwritten in buildBands' final pass
  };
}
