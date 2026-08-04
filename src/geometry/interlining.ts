import {
  Line,
  LineCircle,
  LineEndStyle,
  LineId,
  LineStyle,
  Station,
  StationId,
  StopCell,
} from '../model/types';
import {
  arcTangentPolygon,
  circleAngleAt,
  stationCircle,
  tangentAtAngle,
  wrapAngleToPi,
} from './lineCircle';
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
import { dirIndex, offsetFilletPath, route, straightRunFrom } from './router';
import {
  BAND_MERGE_TOL,
  stationCellToWorld,
  rotateBy,
  STOP_SIZE,
  stopCenterAt,
  stripeOffsetsForWidths,
  tangentGap,
  travelDirLocal,
  worldDirToLocal,
} from './orientation';
import { LINE_STYLE_TIE_RANK } from '../model/lineStyle';
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
  // Which ARM OF ITS LINE each stripe belongs to, parallel to `lines` —
  // filled by {@link assignLineArms} from the junction pairing. Arms
  // partition a line's bands at its branch junctions: two bands glue into one
  // arm wherever their ends pair as a through-run, so a line with no branch
  // is a single arm (index 0) end to end, and a branch or a station
  // self-crossing splits it. Per STRIPE, not per band: two lines sharing a
  // corridor can have different topology, so one may branch here while the
  // other runs through. Indices are canonical per build (arms ordered by
  // smallest member pairKey) but carry no cross-build identity — persistence
  // speaks pairKeys. Arms move ink: self-overlap region faces are built from
  // per-arm bodies (lineRegions.selfOverlapParts), so the index IS mixed
  // into regionIncremental's hashUnits.
  arms: number[];
}


// A single colored stop square for one line at one station, with its
// per-line priority. Rendered alongside bands so that a back-stack line's
// stop square doesn't paint over a front-stack line's band passing through.
//
// `style` is derived from this line's segmentStyles at the incident
// adjacencies: the PLURALITY style wins (so the pattern visually flows through
// the station along its through-route), ties broken by canonical LineStyle
// order — see stationMarkerStyle. It is therefore always a style some incident
// segment actually has, and at a branch it is also the reference that decides
// which segments paint in front (see stopDotSubOrder).
//
// `outward` is set when the line's ink ENDS at this stop — every band incident
// to it leaves the same way, whether that is a single adjacency or a branch
// that forks off down one shared corridor: the unit vector pointing out of the
// line's end along the bands' tangent. Dashed/dotted/dashed-open termini use it
// to paint the cap-extension stub (so the pattern fills the outer half of the
// dot — without it the patterned line would visually end mid-dot); stroked
// lines of any style use it to place the casing's end-cap rail across the
// line's end. Null where a band leaves the other way too, and when bands aren't
// supplied.
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
  // The stop's world travel-axis angle in degrees CW — octant-derived for
  // normal stops, the EXACT circle tangent (continuous) for viaCircle stops.
  rotationDeg: number;
  // Second frame for a JOINT stop — a viaCircle stop where an arc band meets
  // an octolinear one. The two band ends cross the stop at different angles
  // (exact tangent vs. octant, up to 22.5° apart), and a single full square
  // can only stay flush with ONE of them (whichever frame it takes, its other
  // half runs at the wrong angle through the other band — a poking corner on
  // one side, a bite on the other). A joint marker is therefore SPLIT BY
  // SIDE: the arc-side HALF-square in the tangent frame (`rotationDeg`,
  // extending along `jointArcOut`), the straight-side half-square in this
  // octant frame (extending the other way), and the cap-plane wedge between
  // them (`jointWedgeCorners`). Null everywhere else (pure ring stops, normal
  // stops, termini — one edge has one frame; null-not-optional so the
  // field-drift guard sees it on every built spec, like `outward`). Reshapes
  // the painted footprint, so both joint fields join markerBodyRings AND
  // regionIncremental's unit hash (the `end` precedent).
  jointRotationDeg: number | null;
  // Unit vector along the tangent axis pointing toward the ARC neighbor —
  // which side of the joint the tangent half-square covers. Non-null exactly
  // when jointRotationDeg is.
  jointArcOut: Vec2 | null;
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

// ————— Identity-stable spec reuse ————————————————————————————————————————
//
// Both builders mint fresh spec objects on every call. Downstream, everything
// keys on spec IDENTITY — the SegmentBand/StopMarker React memos, lineRegions'
// per-spec stripe-path cache, regionIncremental's unit hashing — so fresh
// objects per frame defeat all of it: moving one station re-renders every
// band and marker on the map. The fix is the stopMetrics last-build bargain
// (src/model/stopMetrics.ts): after the full exact rebuild, each fresh spec is
// swapped for the PREVIOUS build's object when — and only when — every
// consumed field is value-identical. Value-identical immutable specs are
// indistinguishable to consumers, so emitting `prev` changes nothing but
// identity, which becomes a truthful "this geometry did not change" signal.
//
// The classification tables below must list EVERY field of their spec — the
// `satisfies` clause fails to compile when a field is added to the interface
// but not classified here, forcing the author to decide how reuse treats it
// (and, per the interface doc comments above, whether regionIncremental's
// hashUnits needs it too). A field that is read anywhere but missing from the
// equality would ship a STALE spec under a fresh-looking identity — so
// 'compared' is the only safe default for a new field.
type SpecFieldPolicy = 'compared' | 'derived' | 'excluded';

export const BAND_SPEC_FIELDS = {
  bandKey: 'compared',
  pairKey: 'compared',
  fromId: 'compared',
  toId: 'compared',
  // Element-wise by id, ORDER INCLUDED — see bandSpecEqual for why.
  lines: 'compared',
  warning: 'compared',
  // Exact float compare, never quantized (unlike hashUnits' deliberate
  // clipper-matched rounding): reuse must not conflate inputs the renderer
  // distinguishes.
  centerline: 'compared',
  radius: 'compared',
  stripeOffsets: 'compared',
  stripeWidths: 'compared',
  // paths[k] = offsetFilletPath(centerline, radius, stripeOffsets[k]) — a
  // pure function of three compared fields, so equal inputs imply equal
  // strings. Comparing the ~KB path text would re-pay much of the build cost;
  // determinism is pinned by interlining.reuse.test.ts instead.
  paths: 'derived',
  // Always [] on pristine builder output; stamped only onto CLONES
  // (withLinePriorities / buildBands), never onto the cached objects.
  linePriorities: 'excluded',
  // Stamped on pristine output (assignLineArms runs inside buildBandGeometry,
  // before the reuse swap), and derived from the WHOLE band set — a band whose
  // own geometry is unchanged can still change arm when a sibling corridor
  // appears or moves. So it must be compared, not derived from this band.
  arms: 'compared',
} as const satisfies Record<keyof SegmentBandSpec, SpecFieldPolicy>;

// Markers are NOT presentation-free (color and priority are baked at build),
// so every field is compared — a color edit or layer reorder correctly mints
// fresh markers.
export const MARKER_SPEC_FIELDS = {
  cx: 'compared',
  cy: 'compared',
  color: 'compared',
  lineId: 'compared',
  stationId: 'compared',
  rotationDeg: 'compared',
  jointRotationDeg: 'compared',
  jointArcOut: 'compared',
  priority: 'compared',
  style: 'compared',
  outward: 'compared',
  width: 'compared',
  end: 'compared',
} as const satisfies Record<keyof StopMarkerSpec, SpecFieldPolicy>;

function sameNumbers(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Value equality over BAND_SPEC_FIELDS' 'compared' set — one clause per
// field, in table order. NaN compares unequal and falls through to a fresh
// spec: the safe direction.
function bandSpecEqual(a: SegmentBandSpec, b: SegmentBandSpec): boolean {
  if (
    a.bandKey !== b.bandKey ||
    a.pairKey !== b.pairKey ||
    a.fromId !== b.fromId ||
    a.toId !== b.toId ||
    a.warning !== b.warning ||
    a.radius !== b.radius
  ) {
    return false;
  }
  // Slot ORDER matters: bandKey is built from the SORTED ids, so two lines
  // swapping stripe slots leave bandKey identical while inverting every
  // stripe's cover — the same trap regionIncremental's hashUnits mixes the
  // slot line-id for.
  if (a.lines.length !== b.lines.length) return false;
  for (let i = 0; i < a.lines.length; i++) if (a.lines[i].id !== b.lines[i].id) return false;
  if (a.centerline.length !== b.centerline.length) return false;
  for (let i = 0; i < a.centerline.length; i++) {
    if (a.centerline[i].x !== b.centerline[i].x || a.centerline[i].y !== b.centerline[i].y) {
      return false;
    }
  }
  return (
    sameNumbers(a.arms, b.arms) &&
    sameNumbers(a.stripeOffsets, b.stripeOffsets) &&
    sameNumbers(a.stripeWidths, b.stripeWidths)
  );
}

// Value equality over MARKER_SPEC_FIELDS — every field, in table order.
function markerSpecEqual(a: StopMarkerSpec, b: StopMarkerSpec): boolean {
  return (
    a.cx === b.cx &&
    a.cy === b.cy &&
    a.color === b.color &&
    a.lineId === b.lineId &&
    a.stationId === b.stationId &&
    a.rotationDeg === b.rotationDeg &&
    a.jointRotationDeg === b.jointRotationDeg &&
    (a.jointArcOut === b.jointArcOut ||
      (a.jointArcOut !== null &&
        b.jointArcOut !== null &&
        a.jointArcOut.x === b.jointArcOut.x &&
        a.jointArcOut.y === b.jointArcOut.y)) &&
    a.priority === b.priority &&
    a.style === b.style &&
    (a.outward === b.outward ||
      (a.outward !== null &&
        b.outward !== null &&
        a.outward.x === b.outward.x &&
        a.outward.y === b.outward.y)) &&
    a.width === b.width &&
    a.end === b.end
  );
}

// One slot per builder, replaced wholesale on every call (the stopMetrics
// single-slot shape): every canvas consumer builds from the same doc, so they
// miss and hit together. Interleaved consumers building a DIFFERENT doc
// (append-mode route previews; the commit reconcile's fallback marker build
// with an empty lineOrder) repopulate the slot and cost the next same-doc
// build one all-miss pass — a per-gesture blip, never a per-frame one, and
// never a correctness issue: reuse only ever fires on full value equality.
//
// Keys are proven-unique identities: bandKey uniqueness is documented on the
// spec; the marker key is the same `${lineId}#${stationId}` identity
// regionIncremental's hashUnits already uses.
let lastBandSpecs: Map<string, SegmentBandSpec> | null = null;
let lastMarkerSpecs: Map<string, StopMarkerSpec> | null = null;

function reuseBandSpecs(fresh: SegmentBandSpec[]): SegmentBandSpec[] {
  const prev = lastBandSpecs;
  const next = new Map<string, SegmentBandSpec>();
  const out = fresh.map((spec) => {
    const old = prev?.get(spec.bandKey);
    const emit = old && bandSpecEqual(old, spec) ? old : spec;
    next.set(emit.bandKey, emit);
    return emit;
  });
  lastBandSpecs = next;
  return out;
}

function reuseMarkerSpecs(fresh: StopMarkerSpec[]): StopMarkerSpec[] {
  const prev = lastMarkerSpecs;
  const next = new Map<string, StopMarkerSpec>();
  const out = fresh.map((spec) => {
    const key = `${spec.lineId}#${spec.stationId}`;
    const old = prev?.get(key);
    const emit = old && markerSpecEqual(old, spec) ? old : spec;
    next.set(key, emit);
    return emit;
  });
  lastMarkerSpecs = next;
  return out;
}

/** Test seam: forget the last build so a suite can pin cache-free output. */
export function __resetSpecReuse(): void {
  lastBandSpecs = null;
  lastMarkerSpecs = null;
  stampedBandClones = new WeakMap();
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

// Stop center in WORLD coords (anchor + cell offset rotated into the station's
// frame). This IS the rendered position — every visual consumer (markers, bands,
// transfers, snap candidates) reads world positions through here. Moving a
// stop's (row, col) is the ONLY way to change its on-screen location;
// neighboring stops have no effect.
//
// `lineCircles` is REQUIRED, not defaulted, for the same reason `tangentGap`'s
// gap params are: a station bound to a ring resolves its cells through the ring
// frame (see `stationFrameRad`), and a call site that quietly fell back to the
// octant frame would place that stop a lane off its own arc — visible as a
// dot sitting beside its stripe, or a "can't route" on a perfectly good
// interline. An empty record is the honest way to say "no rings here".
export function stopPosWorld(
  cell: StopCell,
  station: Station,
  lineCircles: Record<string, LineCircle>,
): Vec2 {
  return stationCellToWorld(
    stopCenterAt(cell.row, cell.col),
    station,
    stationCircle(station, lineCircles),
  );
}

export function travelDirWorld(cell: StopCell, station: Station, worldHint: Vec2 | null): Vec2 {
  // Rotate the world-frame hint into the unrotated station-local frame so
  // `travelDirLocal` can decide which way an auto-axis stop should travel.
  const localHint = worldHint ? worldDirToLocal(worldHint, station.rotation) : null;
  return rotateBy(travelDirLocal(cell.orientation, localHint), station.rotation);
}

// Two outward tangents count as the SAME heading. Octolinear bands out of a
// stop run along its travel axis, so their real dot product is +1 or −1 and
// this is a guard against the last bit — but an ARC band's centerline is a
// sampled polyline whose first chord is a hair off the true tangent, so an arc
// leaving alongside a straight can land anywhere just short of 1. Those fall
// through to "not an end", which is what they got before any of this:
// deliberately conservative, and the reason not to loosen the constant.
const SAME_HEADING_DOT = 1 - 1e-9;

/**
 * A band's canonical heading (canonFrom → canonTo) at ONE of its endpoints: the
 * stop's travel axis, sign-flipped to run ALONG the corridor rather than back
 * up it. `canon` is the raw canonFrom→canonTo delta, `hint` its unit form.
 *
 * The single answer to "which way does a band leave a station". `buildBands`
 * hands exactly this to the router as `fromDir`/`toDir`, so the first step of
 * the centerline IS this vector; {@link lineEndsAt} re-derives it from the doc
 * to answer the same question before any band exists. One function, so the two
 * cannot come to different conclusions.
 */
function canonTravelDir(cell: StopCell, station: Station, canon: Vec2, hint: Vec2): Vec2 {
  const axis = travelDirWorld(cell, station, hint);
  return dot(axis, canon) >= 0 ? axis : { x: -axis.x, y: -axis.y };
}

/**
 * Does this line's ink END at `stationId` — every edge incident to it leaving
 * the SAME way, so nothing covers the other half of its stop marker?
 *
 * The doc-side twin of {@link StopMarkerSpec.outward}, which the renderer reads
 * off built band centerlines. This one asks before any band exists, which is
 * what the EDITORS need: it decides where offering a per-station end pin means
 * anything (`stationEndStyles`). Both walk `canonTravelDir`, and
 * `interlining.lineEnds.test.ts` demands the two agree stop for stop — arcs
 * included, whose sampled centerline is nobody's travel axis.
 *
 * Not for judging STORED data. A pin outlives the geometry that made it
 * meaningful, on purpose: this answer moves under a station drag, and a prune
 * keyed off it would delete what the user set the last time the stop was an end
 * (see `pruneOrphanLineOverrides`).
 *
 * An edge that renders NO band is skipped, exactly as the renderer skips one: a
 * missing neighbour, a neighbour with no stop of this line, or one sitting on
 * top of this station covers nothing and offers no heading. A stop reached only
 * by such edges is therefore not an end — like a lone stop, it has no direction
 * to end along.
 *
 * ONE thing it cannot see: a band the router gave up on paints a straight from
 * station to station (see `route`'s warning), which need not leave along the
 * travel axis at all. At such a stop the two answers may differ and the pin
 * this one offers is inert — the red frame and ⚠ over that band are already
 * asking for the fix that settles it.
 */
export function lineEndsAt(
  stations: Record<StationId, Station>,
  line: Line,
  stationId: StationId,
): boolean {
  const station = stations[stationId];
  const cell = station?.stops.find((c) => c.lineId === line.id);
  if (!cell) return false;
  let leave: Vec2 | null = null;
  for (const neighbourId of neighborsOf(line, stationId)) {
    const nbr = stations[neighbourId];
    if (!nbr || !nbr.stops.some((c) => c.lineId === line.id)) continue;
    // pairKeyOf's canonical order, so `canon` points the way the band's own
    // centerline runs and `canonTravelDir` can be read straight off it.
    const atFrom = stationId < neighbourId;
    const canon = atFrom ? sub(nbr, station) : sub(station, nbr);
    if (canon.x === 0 && canon.y === 0) continue;
    const dir = canonTravelDir(cell, station, canon, norm(canon));
    // At canonTo the band ARRIVES along `dir`, so it leaves the other way.
    const out = atFrom ? dir : { x: -dir.x, y: -dir.y };
    if (!leave) leave = out;
    else if (dot(leave, out) < SAME_HEADING_DOT) return false;
  }
  return leave !== null;
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
  lineCircles: Record<string, LineCircle> = {},
): SegmentBandSpec[] {
  // Clone before stamping: buildBandGeometry's output objects are shared with
  // the reuse slot (and through it with every other caller across frames), so
  // an in-place stamp here would leak priorities onto cached pristine specs.
  const bands = buildBandGeometry(stations, lines, lineCircles).map((b) => ({ ...b }));
  assignLinePriorities(bands, lines, lineOrder);
  return bands;
}

/**
 * One seg placed in its band's local frame: the width and interline gap that
 * set its packed distance to a neighbour, plus its position at each end
 * resolved into "perp" (across the corridor, the axis stripe offsets run along)
 * and "par" (along it). The straight case reads those off the travel axis; the
 * circle case reads radius and arc length. Both then compare them identically —
 * see {@link forEachPackedRun}.
 */
interface PackedSeg {
  seg: SegInfo;
  width: number;
  gap: number;
  fPerpPos: number;
  fParPos: number;
  tPerpPos: number;
  tParPos: number;
}

/**
 * THE interlining merge rule, for straight bands and circle bands alike: sort
 * by perpendicular position and hand `emit` each maximal run of EXACTLY-packed
 * segs. "Adjacent" means the perp step between consecutive stop centers equals
 * `tangentGap(width, width, gap, gap)` (= STOP_SIZE for two default-width
 * zero-gap lines) at BOTH ends, with matching parallel position at both ends.
 * Stops that are not packed — including mixed-width pairs still at the legacy
 * unit spacing — land in separate bands.
 *
 * One owner, because the two callers differ only in how they PROJECT a seg into
 * {@link PackedSeg} and what they build from a run; the packing gate itself is
 * the same rule and must stay one number in one place. Sorts `segs` in place.
 */
function forEachPackedRun(segs: PackedSeg[], emit: (run: PackedSeg[]) => void): void {
  segs.sort((a, b) => a.fPerpPos - b.fPerpPos);
  const TOL = BAND_MERGE_TOL;
  let run: PackedSeg[] = [];
  for (const e of segs) {
    if (run.length > 0) {
      const prev = run[run.length - 1];
      const tangent = tangentGap(prev.width, e.width, prev.gap, e.gap);
      const packed =
        Math.abs(e.fPerpPos - prev.fPerpPos - tangent) < TOL &&
        Math.abs(e.tPerpPos - prev.tPerpPos - tangent) < TOL &&
        Math.abs(e.fParPos - prev.fParPos) < TOL &&
        Math.abs(e.tParPos - prev.tParPos) < TOL;
      if (!packed) {
        emit(run);
        run = [];
      }
    }
    run.push(e);
  }
  if (run.length > 0) emit(run);
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
  lineCircles: Record<string, LineCircle> = {},
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
    // Circle-riding segs — both stops opted in (viaCircle) on stations bound
    // to the SAME circle, radially consistent between the ends — render as
    // concentric arcs of that circle. Everything else (including a seg that
    // fails the radial gate) takes the octolinear path below, so a chord
    // between two ring stations that did NOT opt in routes like any other
    // edge. A seg that ASKED for the arc but is blocked by mismatched radial
    // offsets flags its band's routing warning (see segCircleFit).
    const circleGroups: Record<string, SegInfo[]> = {};
    const normalSegs: SegInfo[] = [];
    const blockedSegs = new Set<SegInfo>();
    for (const s of segs) {
      const fit = segCircleFit(s, stations, lineCircles);
      if (fit?.kind === 'rides') (circleGroups[fit.circle.id] ||= []).push(s);
      else {
        if (fit?.kind === 'blocked') blockedSegs.add(s);
        normalSegs.push(s);
      }
    }
    for (const cid of Object.keys(circleGroups)) {
      buildCircleBands(
        circleGroups[cid],
        lineCircles[cid],
        pairKey,
        stations,
        lines,
        lineCircles,
        bands,
      );
    }

    // Bucket by world travel AXIS at each end (mod 4). Two lines on the same
    // station-pair that share an axis can render as a single band — even if
    // they traverse the corridor in opposite directions. Their stops are at
    // the same world positions either way; the band's flow direction is
    // metadata that doesn't affect the rendered shape.
    const buckets: Record<string, SegInfo[]> = {};
    for (const s of normalSegs) {
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
      const canon = sub(toS, fromS);
      const fDir = canonTravelDir(sample.fromCell, fromS, canon, sample.worldHint);
      const tDir = canonTravelDir(sample.toCell, toS, canon, sample.worldHint);
      // leftOf(motion) — must match the perpendicular convention used by
      // offsetFilletPath. With this, sorting ascending by perp-projection
      // assigns lower-k indices to lines on the negative-offset (right of
      // motion) side — exactly what the ascending stripeOffsetsForWidths
      // run produces.
      const fPerp: Vec2 = leftNormal(fDir);
      const tPerp: Vec2 = leftNormal(tDir);

      // Project into the band frame: perp/parallel positions in WORLD coords
      // at each end, plus the line's effective width and interline gap (which
      // together set the pairwise packed distance the merge gate tests).
      // All SegInfo in a bucket share the canonical from/to station IDs,
      // so the endpoint stations are fixed across the bucket — pull them
      // off the sample once.
      const placed: PackedSeg[] = bucket.map((s) => {
        const fp = stopPosWorld(s.fromCell, fromS, lineCircles);
        const tp = stopPosWorld(s.toCell, toS, lineCircles);
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

      forEachPackedRun(placed, (run) => {
        const spec = buildBandSpec(
          run.map((e) => e.seg),
          run.map((e) => e.width),
          run.map((e) => e.gap),
          // Interlined lines may disagree on curve radius; the shared
          // centerline curves at the LARGEST member radius, so no line
          // curves tighter than it asked for (the smaller-radius lines
          // just ride along — same trade as the inner-stripe bump).
          Math.max(...run.map((e) => lineCurveRadiusOf(lines[e.seg.lineId]))),
          pairKey,
          fDir,
          tDir,
          fromS,
          toS,
          lineCircles,
        );
        // A member that asked to ride a circle but couldn't (mismatched
        // radial offsets — see segCircleFit) lights the routing warning, so
        // the degrade is visible instead of reading as "arcs are broken".
        if (run.some((e) => blockedSegs.has(e.seg))) spec.warning = true;
        bands.push(spec);
      });
    }
  }

  // Before the reuse swap, so the arms take part in the value equality.
  assignLineArms(bands);

  // Swap value-identical specs for the previous build's objects so identity
  // survives a rebuild wherever geometry didn't change (see the reuse layer
  // above). The array itself is fresh every call — only per-spec identity is
  // stabilized, which is what the downstream memos and caches key on.
  return reuseBandSpecs(bands);
}

// Tie window on a junction pair's OPPOSITION score, which is a dot product:
// 1e-6 is ~0.08° of angle either side of dead-straight, wide enough for the
// float noise off exact-45° geometry and far narrower than any fork a map
// could draw. The corner test that goes with it lives in `straightRunFrom`,
// on the router's own epsilon.
const OPPOSITION_TIE = 1e-6;

// One end of one stripe at one station: the direction it leaves the station,
// and how far it runs before its first bend.
interface JunctionArm {
  band: SegmentBandSpec;
  stripeIndex: number;
  out: Vec2;
  run: number;
}

/**
 * Fills `band.arms`: which arm OF ITS LINE each stripe belongs to. The
 * through-run pairing below is the glue of a union-find over each line's
 * bands, so a line's arm partition falls straight out of its junction
 * verdicts — and those are facts about the JUNCTION, read off the junction:
 * at each station, the line's band ends there are matched into THROUGH-RUNS,
 * most opposed first, and anything left over is a branch. A station with two
 * ends is a plain joint (or a corner) and always pairs up, whichever way its
 * bands bend; a lone end is a terminus and pairs with nothing, which is not
 * the same as branching.
 *
 * A run is scored by how nearly its two arms oppose each other, then by their
 * COMBINED straight length — which is just the length of the straight corridor
 * they make through the station, and the scoring that a real branch needs: two
 * arms can leave a junction along the SAME axis, dead opposite the incoming
 * corridor either way, and diverge only further on. Scoring the pair by its
 * shorter arm would saturate on the one they share and tie, leaving the verdict
 * to the order the edges happen to be declared in. Summed, the one that peels
 * off first is the branch and the one that stays straight longer runs through,
 * whatever their stations' names suggest.
 *
 * After the first run, matching CONTINUES only while a remaining pair is dead
 * opposed: a line that crosses itself at a station has two through-runs — two
 * ARMS crossing — and stopping at one would weld half the X into one arm. A
 * second run that is merely the best of what's left is a fork, not a crossing.
 *
 * Reading any of this off the band's own shape instead (does this polyline
 * bend?) is the older trap: a through corridor whose next station sits
 * off-axis doglegs to reach it, and read that way it claims to be the branch.
 */
function assignLineArms(bands: SegmentBandSpec[]): void {
  // Every band end of every line, grouped by the line + station it meets at.
  const byJunction = new Map<string, JunctionArm[]>();
  // Union-find over (line, band) stripe slots, for `band.arms`: two of a
  // line's bands glue into one ARM wherever the pairing below matches their
  // ends into a through-run. Keys never leave this function.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r)! !== r) r = parent.get(r)!;
    let c = x;
    while (c !== r) {
      const n = parent.get(c)!;
      parent.set(c, r);
      c = n;
    }
    return r;
  };
  const nodeOf = (band: SegmentBandSpec, k: number): string =>
    `${band.lines[k].id} ${band.bandKey}`;
  const byLine = new Map<string, { band: SegmentBandSpec; k: number }[]>();
  for (const band of bands) {
    band.arms = band.lines.map(() => 0);
    for (let k = 0; k < band.lines.length; k++) {
      const node = nodeOf(band, k);
      if (!parent.has(node)) parent.set(node, node);
      const slots = byLine.get(band.lines[k].id);
      if (slots) slots.push({ band, k });
      else byLine.set(band.lines[k].id, [{ band, k }]);
    }
    for (const [stationId, fromStart] of [
      [band.fromId, true],
      [band.toId, false],
    ] as const) {
      const end = straightRunFrom(band.centerline, fromStart);
      if (!end) continue;
      const { out, run } = end;
      band.lines.forEach((line, stripeIndex) => {
        const key = `${line.id}#${stationId}`;
        const arms = byJunction.get(key);
        const arm = { band, stripeIndex, out, run };
        if (arms) arms.push(arm);
        else byJunction.set(key, [arm]);
      });
    }
  }

  for (const arms of byJunction.values()) {
    // A lone end is a TERMINUS: nothing to pair with and nothing to turn away
    // from, so it is no more a branch than a plain joint is.
    if (arms.length < 2) continue;
    // Match ends into through-runs, best first. n is 3–4 at any junction worth
    // the name, so the repeated pairwise walk is free.
    let pool = arms.map((_, i) => i);
    const through = new Set<number>();
    while (pool.length >= 2) {
      // Most opposed (dot = −1 is dead straight through), then the longest
      // combined straight run.
      let bestOpposition = -Infinity;
      let bestRun = -Infinity;
      let pair: [number, number] = [pool[0], pool[1]];
      for (const i of pool) {
        for (const j of pool) {
          if (j <= i) continue;
          const opposition = -dot(arms[i].out, arms[j].out);
          const run = arms[i].run + arms[j].run;
          if (
            opposition > bestOpposition + OPPOSITION_TIE ||
            (opposition > bestOpposition - OPPOSITION_TIE && run > bestRun)
          ) {
            bestOpposition = Math.max(bestOpposition, opposition);
            bestRun = run;
            pair = [i, j];
          }
        }
      }
      // The FIRST run is the through-run whatever its angle — a fork's arms
      // need not be exactly opposite. Every run after it must be dead straight,
      // or the leftovers of a fork would pair up as a second one.
      if (through.size > 0 && bestOpposition < 1 - OPPOSITION_TIE) break;
      through.add(pair[0]).add(pair[1]);
      // The through-run glues its two bands into one arm of this line.
      const a = arms[pair[0]];
      const b = arms[pair[1]];
      parent.set(find(nodeOf(a.band, a.stripeIndex)), find(nodeOf(b.band, b.stripeIndex)));
      pool = pool.filter((i) => i !== pair[0] && i !== pair[1]);
    }
  }

  // Number each line's arms canonically — components ordered by their
  // smallest member (pairKey, bandKey), so indices are a pure function of
  // geometry, never of edge declaration or pairing order.
  for (const slots of byLine.values()) {
    const byRoot = new Map<string, { minKey: string; slots: { band: SegmentBandSpec; k: number }[] }>();
    for (const s of slots) {
      const root = find(nodeOf(s.band, s.k));
      const key = `${s.band.pairKey} ${s.band.bandKey}`;
      const comp = byRoot.get(root);
      if (comp) {
        if (key < comp.minKey) comp.minKey = key;
        comp.slots.push(s);
      } else {
        byRoot.set(root, { minKey: key, slots: [s] });
      }
    }
    const comps = [...byRoot.values()].sort((a, b) => (a.minKey < b.minKey ? -1 : 1));
    comps.forEach((comp, idx) => {
      for (const s of comp.slots) s.band.arms[s.k] = idx;
    });
  }
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

// pristine spec → its most recent priority-stamped clone. Keying on
// pristine-spec identity is sound because that identity implies value-identity
// of every geometry field (the reuse layer's contract), and the one divergent
// field, linePriorities, is compared explicitly before a clone is reused.
// Cache-owned clones are handed to consumers across frames — they must never
// be mutated (the same discipline the reuse slots impose on pristine specs).
let stampedBandClones = new WeakMap<SegmentBandSpec, SegmentBandSpec>();

/**
 * {@link assignLinePriorities} semantics without the in-place mutation:
 * returns priority-stamped CLONES, leaving the pristine input specs untouched
 * (the reuse layer's cached objects must never carry priorities). The clones
 * are identity-stable: a pristine spec kept by the reuse layer hands back the
 * SAME stamped clone while its priorities hold, so per-spec identity survives
 * the stamp — which is what lets SegmentBand's memo bail out for clean
 * corridors mid-drag.
 */
export function withLinePriorities(
  bands: SegmentBandSpec[],
  lines: Record<LineId, Line>,
  lineOrder: LineId[],
): SegmentBandSpec[] {
  const lineIndex = buildLineIndex(lineOrder, lines);
  const fallback = Object.keys(lineIndex).length;
  return bands.map((b) => {
    const want = b.lines.map((l) => lineIndex[l.id] ?? fallback);
    const prev = stampedBandClones.get(b);
    if (prev && sameNumbers(prev.linePriorities, want)) return prev;
    const clone = { ...b, linePriorities: want };
    stampedBandClones.set(b, clone);
    return clone;
  });
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
// Flatten bands + markers into a single list of renderables, sorted
// back-to-front for paint order. Each stripe in a band ships at its own line's
// z-priority so a line whose layer falls between two interlined lines correctly
// renders between their stripes.
//
// `kind` distinguishes:
//   - 'stripe' : one body path of a band, identified by (band, stripeIndex).
//   - 'casing' : that stripe's casing silhouette, at priority + CASING_EPS.
//   - 'marker' : a stop square for one line at one station.
//
// Band routing warnings are NOT emitted here — they paint in a dedicated
// top-most overlay (see <BandWarning> in MapCanvas) so the ⚠ marker and its
// red frame sit above every stripe, dot, and label rather than at a stripe's
// z-priority.
// `subOrder` is the WITHIN-line tie-break (see {@link stopDotSubOrder}), in the
// same sense as `priority`: higher sorts further back. It is a separate sort key
// rather than a fractional nudge to `priority` on purpose — the CASING_EPS
// safety argument above is written as valid only because base priorities are
// integers, and a fractional offset would land inside that ±0.5 band.
export type OrderedRenderable =
  | {
      kind: 'stripe';
      band: SegmentBandSpec;
      stripeIndex: number;
      priority: number;
      subOrder: number;
    }
  | {
      kind: 'casing';
      band: SegmentBandSpec;
      stripeIndex: number;
      priority: number;
      subOrder: number;
    }
  | { kind: 'marker'; spec: StopMarkerSpec; priority: number; subOrder: number };

// `lines` is needed and cannot be read off the band: `SegmentBandSpec.lines` is
// presentation-free by design and holds only `{ id }`, so the per-segment styles
// `stopDotSubOrder` compares live on the Line alone.
export function buildOrderedRenderables(
  bands: SegmentBandSpec[],
  markers: StopMarkerSpec[],
  lines: Record<LineId, Line>,
): OrderedRenderable[] {
  // The stop-dot styles the within-line order is measured against, taken from
  // the MARKERS rather than recomputed: these are the values that will actually
  // paint, so the order and the square it answers to cannot drift apart. Built
  // once per call instead of per stripe — stationMarkerStyle allocates.
  // A caller passing no markers (geometry-only tests) leaves this empty, and
  // every stripe then falls through to subOrder 0, i.e. plain `edges` order.
  const dotStyles = new Map<string, LineStyle>();
  for (const m of markers) dotStyles.set(`${m.lineId}|${m.stationId}`, m.style);
  const list: OrderedRenderable[] = [];
  for (const band of bands) {
    for (let i = 0; i < band.lines.length; i++) {
      const priority = band.linePriorities[i];
      // A stripe carries its own line's within-line rank on both of its
      // passes, so a demoted body takes its casing back with it.
      const line = lines[band.lines[i].id];
      const subOrder = line ? stopDotSubOrder(band, line, dotStyles) : 0;
      list.push({ kind: 'stripe', band, stripeIndex: i, priority, subOrder });
      list.push({
        kind: 'casing',
        band,
        stripeIndex: i,
        priority: priority + CASING_EPS,
        subOrder,
      });
    }
  }
  for (const m of markers) {
    list.push({ kind: 'marker', spec: m, priority: m.priority, subOrder: 0 });
  }
  // Descending priority, then descending subOrder — a demoted stripe sorts
  // EARLIER (further back) exactly as a higher priority does. Ties on both keys
  // keep insertion order (stable sort): markers are pushed last, so at equal
  // priority they stay AFTER their line's stripes and paint over them, and an
  // unbranched line keeps its historical edges-array order.
  list.sort((a, b) => b.priority - a.priority || b.subOrder - a.subOrder);
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
  lineCircles: Record<string, LineCircle> = {},
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
      const { x: cx, y: cy } = stopPosWorld(cell, station, lineCircles);
      // Rotate the marker square so its edges run parallel/perpendicular to
      // the stop's world-frame travel axis. For cardinal-axis stops this is
      // equivalent to station.rotation * 45 (mod 90, which the square's
      // 4-fold symmetry makes invisible); for diagonal stops it adds the
      // extra 45° needed to keep the square flush with the band edges. A
      // circle-riding stop instead takes the EXACT tangent of its circle at
      // the stop's angle — continuous, not octant — so the square sits flush
      // with the arc band (rotationDeg is already in the marker unit hash, so
      // the region cache invalidates on it like any other rotation).
      const viaCircle = cell.viaCircle ? stationCircle(station, lineCircles) : null;
      const octantTangent = rotateBy(travelDirLocal(cell.orientation), station.rotation);
      let worldTangent = viaCircle
        ? tangentAtAngle(circleAngleAt(viaCircle, { x: cx, y: cy }))
        : octantTangent;
      const style = stationMarkerStyle(line, station.id);
      const basePriority = lineIndex[cell.lineId] ?? fallback;
      const outward = endOutwardFromBands(line, station.id, bandsByPair);
      // Which frame(s) does this stop's marker paint? A viaCircle stop:
      //  - every incident edge arcs → the plain TANGENT square;
      //  - NO incident edge arcs (opted in but blocked/alone) → the plain
      //    OCTANT square — no arc meets this stop, so a tangent square would
      //    poke out of the octolinear bands for nothing;
      //  - mixed → a JOINT: arc-side tangent half + straight-side octant half
      //    + the cap-plane wedge (see StopMarkerSpec.jointRotationDeg).
      // An END (outward set) is exempt: the end-style machinery owns its
      // outward half. That holds however many edges it has — a stop only reads
      // as an end when its bands agree to SAME_HEADING_DOT, and an arc and a
      // straight that agree that closely are already on one frame, so there is
      // no joint to build.
      let jointRotationDeg: number | null = null;
      let jointArcOut: Vec2 | null = null;
      if (viaCircle && !outward) {
        let arcNbrPos: Vec2 | null = null;
        let hasStraight = false;
        for (const edge of incidentEdges(line, station.id)) {
          const [a, b] = edgeEndpoints(edge);
          const nid = a === station.id ? b : a;
          const nSt = stations[nid];
          const nCell = nSt?.stops.find((c) => c.lineId === cell.lineId);
          if (!nSt || !nCell) continue; // no rendered band, no joint
          const fit = segCircleFit(
            { fromId: station.id, toId: nid, fromCell: cell, toCell: nCell },
            stations,
            lineCircles,
          );
          if (fit?.kind === 'rides') arcNbrPos ??= stopPosWorld(nCell, nSt, lineCircles);
          else hasStraight = true;
        }
        if (!arcNbrPos) {
          worldTangent = octantTangent;
        } else if (hasStraight) {
          jointRotationDeg = angleDeg(octantTangent);
          const toArc = { x: arcNbrPos.x - cx, y: arcNbrPos.y - cy };
          const along = worldTangent.x * toArc.x + worldTangent.y * toArc.y;
          jointArcOut = along >= 0 ? worldTangent : { x: -worldTangent.x, y: -worldTangent.y };
        }
      }
      const rotationDeg = angleDeg(worldTangent);
      markers.push({
        cx,
        cy,
        color: line.color,
        lineId: cell.lineId,
        stationId: station.id,
        rotationDeg,
        jointRotationDeg,
        jointArcOut,
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
  // As with bands: value-identical markers keep the previous build's
  // identity (see the reuse layer above).
  return reuseMarkerSpecs(markers);
}

// Unit vector pointing outward from `stationId` along the bands' actual
// tangent there, iff the line's ink ENDS at this station — every band incident
// to it leaves the SAME way, so nothing covers the marker's other half. Null
// otherwise.
//
// Degree 1 is the usual shape but it is not the rule: a line that BRANCHES at
// its own end sends two edges (or more) off down the SAME corridor, and the end
// behind them is every bit as open — the casing has to close around it there
// too. What disqualifies a station is a band leaving the other way: a through
// stop, a corner, a loop, a fork that splits both ways. An edge with no band in
// `bandsByPair` paints nothing, so it covers nothing and is skipped — which
// both leaves a lone bandless edge returning null, as before, and ends a stop
// whose only other edge never rendered.
//
// Using the bands' centerlines (rather than station-to-station directions) is
// what makes the cap and the cap-extension stub align with the rendered band
// path, even when a band routes through a fillet or has its endpoint shifted
// off the station's geometric center for interlining.
function endOutwardFromBands(
  line: Line,
  stationId: StationId,
  bandsByPair: Record<string, SegmentBandSpec[]>,
): Vec2 | null {
  let outward: Vec2 | null = null;
  for (const neighbourId of neighborsOf(line, stationId)) {
    const o = bandOutwardAt(line, stationId, neighbourId, bandsByPair);
    if (!o) continue;
    if (!outward) outward = o;
    else if (outward.x * o.x + outward.y * o.y < SAME_HEADING_DOT) return null;
  }
  return outward;
}

// The outward tangent of ONE incident band — the `stationId`→`neighbourId`
// edge — at `stationId`, or null when that edge has no band to read.
function bandOutwardAt(
  line: Line,
  stationId: StationId,
  neighbourId: StationId,
  bandsByPair: Record<string, SegmentBandSpec[]>,
): Vec2 | null {
  // Disambiguate siblings on line membership — the cap must follow the band
  // THIS line actually rides, the way LineTagsLayer and lineRegions already do
  // at their equivalent lookups.
  const band = bandsByPair[pairKeyOf(stationId, neighbourId)]?.find((b) =>
    b.lines.some((l) => l.id === line.id),
  );
  if (!band || band.centerline.length < 2) return null;
  // Centerline goes canonFrom → canonTo. Pick the endpoint matching our
  // station and read the tangent pointing OUT of the band there.
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
// incident to `stationId`. Rule: the PLURALITY style wins, ties broken by
// LINE_STYLE_TIE_RANK (`solid` is first, so a tie it takes part in still keeps
// the plain square that covers the inner half of the patterned segment, making
// the pattern start past the dot's edge). The dot therefore always shows a
// style some incident segment actually HAS — a junction of hatched + hatched +
// dotted reads hatched rather than inventing a solid square for a line with no
// solid anywhere.
//
// Order-invariant by construction: a strict count comparison decides the
// winner, and equal counts fall to a rank that does not depend on which edge
// the adjacency walk saw first.
//
// At a branch this resolves to the THROUGH-ROUTE's style, which is what
// {@link stopDotSubOrder} then uses to keep the through-route painting in front.
function stationMarkerStyle(line: Line, stationId: StationId): LineStyle {
  const styles = line.segmentStyles;
  if (!styles) return 'solid';
  // Every edge incident to this station on this line (its key IS the style key).
  const adjacencies: LineStyle[] = incidentEdges(line, stationId).map((e) => styles[e] ?? 'solid');
  if (adjacencies.length === 0) return 'solid';
  const counts = new Map<LineStyle, number>();
  for (const s of adjacencies) counts.set(s, (counts.get(s) ?? 0) + 1);
  let best: LineStyle = 'solid';
  let bestCount = 0;
  for (const [style, n] of counts) {
    if (
      n > bestCount ||
      (n === bestCount && LINE_STYLE_TIE_RANK[style] < LINE_STYLE_TIE_RANK[best])
    ) {
      best = style;
      bestCount = n;
    }
  }
  return best;
}

// Within-line paint order, enforcing one invariant: A STOP DOT'S STYLE IS THE
// STYLE OF THE TOPMOST SEGMENT OF THAT LINE AT THAT STATION. A segment whose
// style differs from a station's resolved marker style (see
// {@link stationMarkerStyle}) paints BEHIND its siblings there, so the square
// and the stripe that covers it can never disagree.
//
// That is what keeps a through-route continuous wherever a line's own stripes
// coincide — a branch whose route runs up its own trunk corridor, and equally a
// plain degree-2 station where the line DOUBLES BACK (both edges leave in the
// same direction, stripes overlap, degree still 2). Applied at every station
// for that reason: at a station the line merely passes through, consecutive
// bands abut rather than overlap, so a demotion there is inert.
//
// Differing at EITHER end demotes — the conservative direction (a segment is
// never RAISED over a sibling), and it makes the answer independent of which
// endpoint is inspected first.
//
// The invariant is a GOAL, not a guarantee, and one scalar per stripe is why: an
// edge pulled the opposite way by its two stations can only obey one of them. If
// a station's every incident segment is demoted by some OTHER station, they tie
// again and `edges` order decides, which can leave that station's dot naming a
// style that is not on top. Reachable (see the known-limit test in
// interlining.branchStyle.test.ts), not a regression, and it costs nothing when
// each edge gets a consistent verdict at both ends.
//
// Returns a value with the same sense as `priority`: HIGHER sorts further back.
function stopDotSubOrder(
  band: SegmentBandSpec,
  line: Line,
  // `${lineId}|${stationId}` → that dot's painted style; see the builder.
  dotStyles: ReadonlyMap<string, LineStyle>,
): number {
  const style = resolveSegmentStyle(line, band.pairKey);
  for (const stationId of [band.fromId, band.toId]) {
    const dot = dotStyles.get(`${line.id}|${stationId}`);
    if (dot !== undefined && dot !== style) return 1;
  }
  return 0;
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

// How one seg relates to the line circles: 'rides' (both stops carry
// `viaCircle` on stations bound to the same existing circle, at matching
// radial offsets — a concentric arc has one radius), 'blocked' (both stops
// ASKED to ride that circle but the radial offsets disagree between the ends,
// so the arc is impossible — the seg routes octolinearly AND flags the band's
// routing warning, because a silent degrade here reads as "circle routing is
// broken" while the actual problem is one stop sitting a lattice cell off the
// ring), or null (no circle intent — the ordinary octolinear path).
type SegCircleFit = { kind: 'rides'; circle: LineCircle } | { kind: 'blocked' } | null;

function segCircleFit(
  // Narrowed so buildStopMarkers can probe an edge with a hand-built pair
  // (worldHint and lineId play no part in the fit).
  s: Pick<SegInfo, 'fromId' | 'toId' | 'fromCell' | 'toCell'>,
  stations: Record<StationId, Station>,
  lineCircles: Record<string, LineCircle>,
): SegCircleFit {
  if (!s.fromCell.viaCircle || !s.toCell.viaCircle) return null;
  const fromS = stations[s.fromId];
  const toS = stations[s.toId];
  const cid = fromS?.circleId;
  if (cid === undefined || toS?.circleId !== cid) return null;
  const circle = lineCircles[cid];
  if (!circle) return null;
  const fp = stopPosWorld(s.fromCell, fromS, lineCircles);
  const tp = stopPosWorld(s.toCell, toS, lineCircles);
  const rf = Math.hypot(fp.x - circle.x, fp.y - circle.y);
  const rt = Math.hypot(tp.x - circle.x, tp.y - circle.y);
  return Math.abs(rf - rt) < BAND_MERGE_TOL ? { kind: 'rides', circle } : { kind: 'blocked' };
}

/**
 * The circle analogue of the axis-bucket loop: project one pairKey's
 * circle-riding segs into the ring's frame — "perpendicular" ≡ radial,
 * "parallel" ≡ arc position — and emit one band per exactly-packed run, off
 * the same {@link forEachPackedRun} gate the straight case uses.
 */
function buildCircleBands(
  segs: SegInfo[],
  circle: LineCircle,
  pairKey: string,
  stations: Record<StationId, Station>,
  lines: Record<LineId, Line>,
  lineCircles: Record<string, LineCircle>,
  out: SegmentBandSpec[],
): void {
  const fromS = stations[segs[0].fromId];
  const toS = stations[segs[0].toId];
  // The band flows canonFrom → canonTo; its sweep sign orients the radial
  // axis so that ascending "perp" matches ascending stripe offsets (positive
  // offset = left of motion = radially OUT on a clockwise sweep).
  const sample = segs[0];
  const aFrom0 = circleAngleAt(circle, stopPosWorld(sample.fromCell, fromS, lineCircles));
  const aTo0 = circleAngleAt(circle, stopPosWorld(sample.toCell, toS, lineCircles));
  const sgn = wrapAngleToPi(aTo0 - aFrom0) >= 0 ? 1 : -1;

  const placed: PackedSeg[] = segs.map((s) => {
    const fp = stopPosWorld(s.fromCell, fromS, lineCircles);
    const tp = stopPosWorld(s.toCell, toS, lineCircles);
    return {
      seg: s,
      width: lineWidthOf(lines[s.lineId]),
      gap: lineInterlineGapOf(lines[s.lineId]),
      fPerpPos: sgn * Math.hypot(fp.x - circle.x, fp.y - circle.y),
      tPerpPos: sgn * Math.hypot(tp.x - circle.x, tp.y - circle.y),
      // Arc position relative to the sample's endpoint angle (wrapped
      // difference, so stops straddling the ±π seam still compare locally).
      fParPos: wrapAngleToPi(circleAngleAt(circle, fp) - aFrom0) * circle.radius,
      tParPos: wrapAngleToPi(circleAngleAt(circle, tp) - aTo0) * circle.radius,
    };
  });

  forEachPackedRun(placed, (run) => {
    out.push(
      buildCircleBandSpec(
        run.map((e) => e.seg),
        run.map((e) => e.width),
        run.map((e) => e.gap),
        circle,
        pairKey,
        fromS,
        toS,
        lineCircles,
      ),
    );
  });
}

function buildCircleBandSpec(
  group: SegInfo[],
  widths: number[],
  gaps: number[],
  circle: LineCircle,
  pairKey: string,
  fromStation: Station,
  toStation: Station,
  lineCircles: Record<string, LineCircle>,
): SegmentBandSpec {
  const fromWorlds = group.map((g) => stopPosWorld(g.fromCell, fromStation, lineCircles));
  const toWorlds = group.map((g) => stopPosWorld(g.toCell, toStation, lineCircles));
  const fromMean = centroid(fromWorlds);
  const toMean = centroid(toWorlds);
  const aFrom = circleAngleAt(circle, fromMean);
  const aTo = circleAngleAt(circle, toMean);
  // ALWAYS the shorter arc (antipodal ties sweep clockwise) — the whole
  // routing rule. The longer way around is expressed by splicing a bound
  // waypoint onto the circle, which splits the edge into two shorter arcs.
  const delta = wrapAngleToPi(aTo - aFrom);
  // The band's ride radius is the stripes' mean radial distance (the merge
  // gate pinned every stripe to one radial position; the ends agree within
  // tolerance by segCircleFit). The offsets then land each stripe at its
  // packed radial position: positive offset = left of motion = radially out
  // on a clockwise (delta > 0) sweep — matching buildCircleBands' sort sign.
  const bandR =
    (Math.hypot(fromMean.x - circle.x, fromMean.y - circle.y) +
      Math.hypot(toMean.x - circle.x, toMean.y - circle.y)) /
    2;
  // The centerline is the arc's tangent polygon: the plain fillet walk at
  // radius bandR reproduces EXACTLY this arc, so every consumer of
  // (centerline, radius, offset) — paint, outlines, samplers, region
  // flattening, the incremental hash — sees the true circle through the code
  // paths it already has. No marker-fit cap and no inner-stripe bump: the
  // geometry is dictated by the circle, not by the corner-styling trade-offs.
  const centerline = arcTangentPolygon({ x: circle.x, y: circle.y, radius: bandR }, aFrom, delta);
  const offsets = stripeOffsetsForWidths(widths, gaps);
  const linesArr = group.map((g) => ({ id: g.lineId }));
  const paths = offsets.map((o) => offsetFilletPath(centerline, bandR, o));
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
    warning: false,
    centerline,
    radius: bandR,
    linePriorities: [], // filled in by assignLinePriorities
    arms: [], // filled in by assignLineArms
    stripeOffsets: offsets,
    stripeWidths: widths,
  };
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
  lineCircles: Record<string, LineCircle>,
): SegmentBandSpec {
  // Centerline endpoints are the mean of the band's per-line stop world
  // positions — i.e. the centroid of the contributing stop cells at each end.
  const fromWorlds = group.map((g) => stopPosWorld(g.fromCell, fromStation, lineCircles));
  const toWorlds = group.map((g) => stopPosWorld(g.toCell, toStation, lineCircles));
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
    arms: [], // filled in by assignLineArms
    stripeOffsets: offsets,
    stripeWidths: widths,
  };
}
