import {
  Line,
  LineEndStyle,
  LineId,
  LineStyle,
  Station,
  StationId,
  StopCell,
} from '../model/types';
import { pairKeyOf } from '../model/pairKey';
import { edgeEndpoints, incidentEdges, neighborsOf } from '../model/lineTopology';
import { LINE_END_STYLE_DEFAULT, resolveEndStyle, stationEndStyleOf } from '../model/lineEnd';
import { reconcileOrder } from '../model/recordOrder';
import {
  Vec2,
  sub,
  dot,
  len,
  norm,
  leftNormal,
  angleBetween,
  tanHalf,
  angleDeg,
  centroid,
} from './vec';
import { dirIndex, offsetFilletPath, route } from './router';
import {
  BAND_MERGE_TOL,
  localToWorld,
  rotateBy,
  STOP_SIZE,
  stopCenterAt,
  stripeOffsetsForWidths,
  tangentGap,
  travelDirLocal,
  worldDirToLocal,
} from './orientation';
import { lineInterlineGapOf, lineWidthOf } from '../model/lineWidth';
import { lineCurveRadiusOf } from '../model/lineCurve';

// A new field that changes a stripe's PAINTED BODY (stripeBodyPolys reads the
// centerline, radius, offsets and widths) must also be folded into
// regionIncremental's hashUnits, or incremental region reuse serves stale
// geometry under a cache key that claims to be current.
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
  // Effective centerline curve radius used to build `paths`. The configured
  // R is the LARGEST member line's `curveRadius`; for an n-stripe band it is
  // bumped toward `R + max|stripeOffsets|` so the innermost stripe still hits
  // R, then capped per-endpoint so the widest stop marker (a width × width
  // square) fits within the post-fillet straight section. Callers sampling
  // offset paths against `centerline` (line-tag layer, hover/click) MUST use
  // this rather than any line's raw `curveRadius`, or they'll desync from
  // painted geometry.
  radius: number;
  // Per-stripe z-priority: parallel to `lines` and `paths`. Smallest = front-most.
  // Each stripe carries its own line's lineOrder index so a perpendicular
  // line whose layer is sandwiched between two interlined lines renders
  // between their stripes (not behind the whole band).
  linePriorities: number[];
  // Per-stripe perpendicular offsets from the centerline, parallel to
  // `lines`/`paths`: the mean-centered tangency positions of the per-line
  // widths (see stripeOffsetsForWidths). The single source of truth formerly
  // held by the uniform stripeOffset(k, n) formula — every consumer (outline,
  // tag/label placement, hit sampling) MUST read these rather than re-derive,
  // or it desyncs from the baked `paths`.
  stripeOffsets: number[];
  // Per-stripe stroke widths (each line's effective width at build time).
  // Unlike color/style, width is GEOMETRY, not presentation: a width edit
  // moves `paths`, so the band is rebuilt anyway and baking the widths
  // costs no repaint flexibility.
  stripeWidths: number[];
}

// A single colored stop square for one line at one station, with its
// per-line priority. Rendered alongside bands so that a back-stack line's
// stop square doesn't paint over a front-stack line's band passing through.
//
// `style` is derived from this line's segmentStyles at the incident
// adjacencies: a uniform non-solid style across every adjacency wins (so
// the pattern visually flows through the station); any mix resolves to
// solid (see stationMarkerStyle).
//
// `outward` is set when this stop is a TERMINUS for the line (single
// adjacency, band available): the unit vector pointing out of the line's
// end along the band's tangent. Dashed/dotted/dashed-open termini use it to
// paint the cap-extension stub (so the pattern fills the outer half of the
// dot — without it the patterned line would visually end mid-dot); stroked
// lines of any style use it to place the casing's end-cap rail across the
// line's end. Null at interior stations and when bands aren't supplied.
//
// A new field that changes the marker's painted footprint (markerBodyRings)
// must also be folded into regionIncremental's hashUnits — `end` is the
// precedent — or incremental region reuse serves stale geometry.
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
  // The line's effective width: the marker renders as a width × width square
  // (and the dashed terminus stub at this stroke width).
  width: number;
  // How the line's end is painted here, already RESOLVED: the per-station
  // override folded over the line default, then degraded against `style` (a
  // dash-pattern stroke has no shape to round — see resolveEndStyle). Always
  // 'square' where `outward` is null, so a consumer branches on this alone and
  // an interior stop can never be handed a half marker.
  end: LineEndStyle;
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
  return localToWorld(stopCenterAt(cell.row, cell.col), station);
}

export function travelDirWorld(cell: StopCell, station: Station, worldHint: Vec2 | null): Vec2 {
  // Rotate the world-frame hint into the unrotated station-local frame so
  // `travelDirLocal` can decide which way an auto-axis stop should travel.
  const localHint = worldHint ? worldDirToLocal(worldHint, station.rotation) : null;
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
 * AND exactly-tangent cells along the perpendicular-to-travel axis at both
 * stations (consecutive stop centers tangentGap(wA, wB) apart). Bands render
 * with per-stripe stroke-width = the line's effective width, perpendicular
 * offsets `stripeOffsetsForWidths(widths)` (mean-centered tangency
 * positions; `(k − (n−1)/2) * STOP_SIZE` in the uniform default case).
 *
 * Composes {@link buildBandGeometry} (depends only on stations + line
 * topology) and {@link assignLinePriorities} (depends on `lineOrder` only).
 * Callers that want geometry to survive priority-only
 * changes (e.g. layering mode's outline / label memos) call the two halves
 * directly instead of this convenience wrapper.
 */
export function buildBands(
  stations: Record<StationId, Station>,
  lines: Record<LineId, Line>,
  lineOrder: LineId[] = [],
): SegmentBandSpec[] {
  const bands = buildBandGeometry(stations, lines);
  assignLinePriorities(bands, lines, lineOrder);
  return bands;
}

/**
 * Geometric half of {@link buildBands}: groups lines by canonical
 * station-pair, buckets by world travel axis, merges perpendicular-
 * adjacency runs, and computes the routed centerline + per-stripe paths.
 *
 * Reads only `stations`, `line.edges`, `line.width`, `line.interlineGap`, and
 * `line.curveRadius`. NOT color, per-segment style, or lineOrder — those are
 * presentation, resolved live at render time (see `resolveSegmentStyle` and the
 * {@link SegmentBandSpec} `lines` doc). So a color/style edit or a layer
 * reorder leaves this output byte-identical, and a caller that memoizes it gets
 * a stable bands reference across those edits — that's how the layering-mode
 * caches stay valid without a content-hash workaround. (A width, gap, or
 * curve-radius edit DOES rebuild — those ARE geometry; MapCanvas's
 * `linesGeometrySig` must include them, and only them.)
 *
 * Returns bands with `linePriorities: []`; call {@link assignLinePriorities}
 * to fill those in before consuming the array for paint order.
 */
export function buildBandGeometry(
  stations: Record<StationId, Station>,
  lines: Record<LineId, Line>,
): SegmentBandSpec[] {
  // 1. Collect per-line segments keyed by sorted station pair, with stop cells.
  const groups: Record<string, SegInfo[]> = {};

  for (const lineId of Object.keys(lines)) {
    const line = lines[lineId];
    for (const edge of line.edges) {
      // Each edge is already a canonical pair-key (fromId < toId), so the seg
      // is stored canon-first with no ternary shuffling.
      const [a, b] = edgeEndpoints(edge);
      const sa = stations[a];
      const sb = stations[b];
      if (!sa || !sb) continue;
      const fromCell = sa.stops.find((c) => c.lineId === lineId);
      const toCell = sb.stops.find((c) => c.lineId === lineId);
      if (!fromCell || !toCell) continue;
      (groups[edge] ||= []).push({
        fromId: a,
        toId: b,
        fromCell,
        toCell,
        lineId,
        // Canonical from→to direction. An edge carries no traversal order, so
        // the hint's sign is immaterial: axis bucketing folds mod 4 and the
        // band is sign-flipped to flow canonFrom→canonTo before routing.
        worldHint: norm(sub(sb, sa)),
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
      const canon = sub(toS, fromS);
      const fSign = dot(sampleFDir, canon) >= 0 ? 1 : -1;
      const tSign = dot(sampleTDir, canon) >= 0 ? 1 : -1;
      const fDir: Vec2 = { x: sampleFDir.x * fSign, y: sampleFDir.y * fSign };
      const tDir: Vec2 = { x: sampleTDir.x * tSign, y: sampleTDir.y * tSign };
      // leftOf(motion) — must match the perpendicular convention used by
      // offsetFilletPath. With this, sorting ascending by perp-projection
      // assigns lower-k indices to lines on the negative-offset (right of
      // motion) side — exactly what the ascending stripeOffsetsForWidths
      // run produces.
      const fPerp: Vec2 = leftNormal(fDir);
      const tPerp: Vec2 = leftNormal(tDir);

      // Enrich with world perp/parallel positions at each end for sorting and
      // adjacency comparison, plus the line's effective width and interline
      // gap (which together set the pairwise packed distance below).
      type Enriched = {
        seg: SegInfo;
        width: number;
        gap: number;
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
          width: lineWidthOf(lines[s.lineId]),
          gap: lineInterlineGapOf(lines[s.lineId]),
          fPerpPos: dot(fp, fPerp),
          fParPos: dot(fp, fDir),
          tPerpPos: dot(tp, tPerp),
          tParPos: dot(tp, tDir),
        };
      });
      enriched.sort((a, b) => a.fPerpPos - b.fPerpPos);

      // Greedily merge contiguous perp-adjacency in WORLD coords at both
      // ends, with matching parallel position at both ends. "Adjacent" =
      // EXACTLY packed: the perp step between consecutive stop centers must
      // equal tangentGap(width, width, gap, gap) (= STOP_SIZE for two
      // default-width zero-gap lines). Stops that are not packed — including
      // mixed-width pairs still at the legacy unit spacing — stay in
      // separate bands.
      let group: Enriched[] = [];
      const flush = () => {
        if (group.length === 0) return;
        bands.push(
          buildBandSpec(
            group.map((e) => e.seg),
            group.map((e) => e.width),
            group.map((e) => e.gap),
            // Interlined lines may disagree on curve radius; the shared
            // centerline curves at the LARGEST member radius, so no line
            // curves tighter than it asked for (the smaller-radius lines
            // just ride along — same trade as the inner-stripe bump).
            Math.max(...group.map((e) => lineCurveRadiusOf(lines[e.seg.lineId]))),
            pairKey,
            fDir,
            tDir,
            fromS,
            toS,
          ),
        );
        group = [];
      };
      const TOL = BAND_MERGE_TOL;
      for (const e of enriched) {
        if (group.length === 0) {
          group.push(e);
          continue;
        }
        const prev = group[group.length - 1];
        const dFromPerp = e.fPerpPos - prev.fPerpPos;
        const dToPerp = e.tPerpPos - prev.tPerpPos;
        const tangent = tangentGap(prev.width, e.width, prev.gap, e.gap);
        const sameParA = Math.abs(e.fParPos - prev.fParPos) < TOL;
        const sameParB = Math.abs(e.tParPos - prev.tParPos) < TOL;
        if (
          Math.abs(dFromPerp - tangent) < TOL &&
          Math.abs(dToPerp - tangent) < TOL &&
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
 * global `lineOrder` (index 0 = front-most). Per-segment layer overrides are
 * gone — region assignments override the covering line per-face at render
 * time (see lineRegions.resolveRegionWinners) instead.
 * Mutates the bands in place — the geometry array's reference is preserved,
 * which is what the mode-overlay memos rely on.
 *
 * Reading split: depends on `lineOrder` only, NOT on the geometric fields
 * buildBandGeometry reads.
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
    band.linePriorities = band.lines.map((l) => lineIndex[l.id] ?? fallback);
  }
}

// Casing paints just BEHIND its own body: a stripe emits a `casing` renderable
// at `priority + CASING_EPS`. Higher priority sorts EARLIER (further back), so
// the casing lands directly under its body, yet still IN FRONT of any
// lower-priority line's body. ε = 0.5 is provably safe because stripe
// priorities are integers (lineOrder indices), so the smallest gap between two distinct
// priorities is 1 — a casing can never leapfrog another line's body across the
// integer boundary. This is what lets a line's OWN overlapping bands (loops,
// branches) merge into one continuous outer casing: every silhouette paints
// before every body, so a same-line body always re-covers a sibling's casing
// in the shared interior — WITHOUT the global "all casing first" reorder that
// historically erased the between-lines separators.
export const CASING_EPS = 0.5;
// The branch seam (interior overlap indicator) paints just IN FRONT of its own
// body: a stripe emits a `seam` renderable at `priority − SEAM_EPS`. It must
// clear the body (0 < SEAM_EPS) yet not collide with a neighbour line's casing:
// with integer base priorities (gap ≥ 1), a neighbour's casing sits at
// `(p−1) + CASING_EPS = p − 0.5`, so SEAM_EPS ≠ CASING_EPS keeps them distinct
// (0.25 vs 0.5). Clipped to the line's own corridor (see SeamClips), the seam
// only shows where the line overlaps itself — so its z only matters versus the
// line's own bodies, which it correctly sits above.
export const SEAM_EPS = 0.25;

// Flatten bands + markers into a single list of renderables, sorted
// back-to-front for paint order. Each stripe in a band ships at its own line's
// z-priority so a line whose layer falls between two interlined lines correctly
// renders between their stripes.
//
// `kind` distinguishes:
//   - 'stripe' : one body path of a band, identified by (band, stripeIndex).
//   - 'casing' : that stripe's casing silhouette, at priority + CASING_EPS.
//   - 'seam'   : that stripe's branch-seam ring, at priority − SEAM_EPS.
//   - 'marker' : a stop square for one line at one station.
//
// Band routing warnings are NOT emitted here — they paint in a dedicated
// top-most overlay (see <BandWarning> in MapCanvas) so the ⚠ marker and its
// red frame sit above every stripe, dot, and label rather than at a stripe's
// z-priority.
export type OrderedRenderable =
  | { kind: 'stripe'; band: SegmentBandSpec; stripeIndex: number; priority: number }
  | { kind: 'casing'; band: SegmentBandSpec; stripeIndex: number; priority: number }
  | { kind: 'seam'; band: SegmentBandSpec; stripeIndex: number; priority: number }
  | { kind: 'marker'; spec: StopMarkerSpec; priority: number };

export function buildOrderedRenderables(
  bands: SegmentBandSpec[],
  markers: StopMarkerSpec[],
): OrderedRenderable[] {
  const list: OrderedRenderable[] = [];
  for (const band of bands) {
    for (let i = 0; i < band.lines.length; i++) {
      const priority = band.linePriorities[i];
      list.push({ kind: 'stripe', band, stripeIndex: i, priority });
      list.push({ kind: 'casing', band, stripeIndex: i, priority: priority + CASING_EPS });
      list.push({ kind: 'seam', band, stripeIndex: i, priority: priority - SEAM_EPS });
    }
  }
  for (const m of markers) {
    list.push({ kind: 'marker', spec: m, priority: m.priority });
  }
  list.sort((a, b) => b.priority - a.priority);
  return list;
}

// Reconcile persisted lineOrder against the lines dict (filter dead IDs,
// append any missing) via the shared `reconcileOrder` algebra, then index it.
// Returns a {lineId: index} map. Index 0 = front-most.
export function buildLineIndex(
  lineOrder: LineId[],
  lines: Record<LineId, Line>,
): Record<LineId, number> {
  const reconciled = reconcileOrder(lines, lineOrder) as LineId[];
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
  // Index bands by pairKey for O(1) lookup during outward computation. One
  // pairKey can carry SIBLING bands (two lines sharing a corridor but reaching
  // it on different world axes land in different axis buckets), so this is a
  // LIST — a last-wins map would hand a terminus the tangent of whichever
  // sibling happened to be built last, pointing its cap stub the wrong way.
  const bandsByPair: Record<string, SegmentBandSpec[]> = {};
  for (const b of bands) (bandsByPair[b.pairKey] ??= []).push(b);
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
      const rotationDeg = angleDeg(worldTangent);
      const style = stationMarkerStyle(line, station.id);
      const basePriority = lineIndex[cell.lineId] ?? fallback;
      const outward = terminusOutwardFromBand(line, station.id, bandsByPair);
      markers.push({
        cx,
        cy,
        color: line.color,
        lineId: cell.lineId,
        stationId: station.id,
        rotationDeg,
        priority: basePriority,
        style,
        outward,
        width: lineWidthOf(line),
        // Resolved once, here, so the painter and the region footprint can
        // never disagree about which shape this end is.
        end: outward
          ? resolveEndStyle(stationEndStyleOf(line, station.id), style)
          : LINE_END_STYLE_DEFAULT,
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
  bandsByPair: Record<string, SegmentBandSpec[]>,
): Vec2 | null {
  // A terminus is a degree-1 station: exactly one incident edge. Loops
  // (degree 2) and junctions (degree ≥ 3) correctly get no cap stub.
  const nbrs = neighborsOf(line, stationId);
  if (nbrs.length !== 1) return null;
  const neighbourId = nbrs[0];
  // Disambiguate siblings on line membership — the cap must follow the band
  // THIS line actually rides, the way LineTagsLayer and lineRegions already do
  // at their equivalent lookups.
  const band = bandsByPair[pairKeyOf(stationId, neighbourId)]?.find((b) =>
    b.lines.some((l) => l.id === line.id),
  );
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
// style (dashed, hatched/-mirror, dotted, dashed-open), the dot inherits that
// style; otherwise it's solid. A mixed junction (e.g. one hatched + one solid, or
// hatched + hatched-mirror) resolves to solid so the dot covers the inner half
// of the patterned segment and the pattern visually starts past the dot's edge.
function stationMarkerStyle(line: Line, stationId: StationId): LineStyle {
  const styles = line.segmentStyles;
  if (!styles) return 'solid';
  // Every edge incident to this station on this line (its key IS the style key).
  const adjacencies: LineStyle[] = incidentEdges(line, stationId).map((e) => styles[e] ?? 'solid');
  if (adjacencies.length === 0) return 'solid';
  const first = adjacencies[0];
  if (first !== 'solid' && adjacencies.every((s) => s === first)) return first;
  return 'solid';
}

// Centerline radius bumped so the INNERMOST stripe of a band still has
// radius >= the configured curve radius. `maxAbsOffset` is the extreme
// |stripe-center offset| (max |stripeOffsetsForWidths(widths)|) — for a
// uniform-width band that's the historical (n-1)/2 * width.
export function idealBandRadius(curveRadius: number, maxAbsOffset: number): number {
  return curveRadius + maxAbsOffset;
}

// Largest centerline radius whose fillet still leaves a straight run >=
// `markerHalf` before the corner, so the stop marker doesn't spill into the
// arc. The marker is a width × width square extending width/2 along travel;
// callers pass the binding (largest) marker half among the band's lines.
// Defaults to the standard STOP_SIZE/2. The turn angle comes from
// inDir·outDir; returns Infinity for a ~straight corner and 0 when there's
// no usable straight run.
export function cornerCapRadius(
  edgeLen: number,
  inDir: Vec2,
  outDir: Vec2,
  markerHalf: number = STOP_SIZE / 2,
): number {
  const theta = angleBetween(inDir, outDir);
  if (theta < 1e-6) return Infinity;
  const usable = edgeLen - markerHalf;
  if (usable <= 0) return 0;
  return usable / tanHalf(theta);
}

function buildBandSpec(
  group: SegInfo[],
  // Per-line effective widths and interline gaps, parallel to `group`
  // (already in the bucket's perp-sorted order).
  widths: number[],
  gaps: number[],
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
  const fromMeanWorld = centroid(fromWorlds);
  const toMeanWorld = centroid(toWorlds);

  // Per-stripe offsets: mean-centered packed positions of the widths + gaps.
  // The merge gate guaranteed the actual stop centers sit at exactly these
  // spacings, and the centerline is the stop centroid (the mean), so
  // centerline + offset_k reproduces each stop position.
  const n = group.length;
  const offsets = stripeOffsetsForWidths(widths, gaps);
  const maxAbsOffset = offsets.reduce((m, o) => Math.max(m, Math.abs(o)), 0);

  // Bump centerline radius so the INNERMOST stripe still has radius ≥ R.
  // The inside stripe's effective radius is `centerlineR − maxAbsOffset`, so
  // we set centerlineR = R + maxAbsOffset so the inner stripe's CENTER sits
  // at exactly R. Without this, a 4–5-line interline collapses the inner
  // curve toward a right angle as soon as |offset| ≥ R.
  const idealR = idealBandRadius(R, maxAbsOffset);

  const result = route(fromMeanWorld, fromDir, toMeanWorld, toDir, idealR);

  // Cap the centerline radius so the stop marker fits in the straight section
  // at each band endpoint. Each line's marker is a width × width rect aligned
  // to the stop's local frame — it extends width/2 along travel from the
  // stop; the binding constraint is the band's WIDEST marker. For the
  // marker's flat far-edge not to spill into the curving arc (where it
  // produces a visible stair-step at the marker's boundary), the straight
  // section before the fillet must be ≥ markerHalf. That means at each
  // end-corner i: r * tan(θ_i/2) ≤ edgeLen − markerHalf, so
  // r ≤ (edgeLen − markerHalf) / tan(θ_i/2). Cap centerline R to satisfy
  // this at both ends.
  //
  // For a single-stripe band there are no offset stripes to keep above R, so
  // the cap is allowed to pull the centerline below the configured R when a
  // terminus is too cramped to fit the fillet plus the HALF run-in. Without
  // this, a single line keeps curving inside the (axis-aligned) stop marker and
  // stair-steps at the marker's near edge — the curve appears to meet the
  // station at its far edge instead of running straight in from the near edge.
  // A tighter-than-configured curve in a cramped layout reads as intentional;
  // the stair-step reads as a bug. Multi-stripe bands keep the R floor —
  // dropping the centerline below R there would collapse the inner stripes
  // (the inner-stripe-respects-R trade-off; see the 5-stripe cap tests).
  const verts = result.vertices;
  let capR = idealR;
  if (verts.length >= 3) {
    const lastIdx = verts.length - 1;
    const markerHalf = Math.max(...widths) / 2;
    const fromEdgeLen = len(sub(verts[1], verts[0]));
    const fromIn = norm(sub(verts[1], verts[0]));
    const fromOut = norm(sub(verts[2], verts[1]));
    capR = Math.min(capR, cornerCapRadius(fromEdgeLen, fromIn, fromOut, markerHalf));
    const toEdgeLen = len(sub(verts[lastIdx], verts[lastIdx - 1]));
    const toIn = norm(sub(verts[lastIdx - 1], verts[lastIdx - 2]));
    const toOut = norm(sub(verts[lastIdx], verts[lastIdx - 1]));
    capR = Math.min(capR, cornerCapRadius(toEdgeLen, toIn, toOut, markerHalf));
  }
  // capR ≤ 0 means even a zero-radius fillet can't clear the marker (a terminal
  // edge ≤ markerHalf) — no radius helps, so fall back to R. Otherwise a
  // single-stripe band honors the marker-fit cap (which may be below R);
  // multi-stripe floors at R.
  const fit = Math.min(idealR, capR);
  // A single-stripe band may tighten below the configured R to fit the marker
  // (capR > 0 means a positive radius still clears it); multi-stripe bands floor
  // at R to keep the inner stripes from collapsing. See the comment block above.
  const honorMarkerCap = n === 1 && capR > 0;
  const centerlineR = honorMarkerCap ? fit : Math.max(R, fit);

  const paths: string[] = [];
  const linesArr = group.map((g) => ({ id: g.lineId }));
  for (let k = 0; k < n; k++) {
    paths.push(offsetFilletPath(result.vertices, centerlineR, offsets[k]));
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
    linePriorities: [], // filled in by assignLinePriorities
    stripeOffsets: offsets,
    stripeWidths: widths,
  };
}
