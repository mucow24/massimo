import {
  DEFAULT_DOC,
  DEFAULT_STYLES,
  LABEL_FONT_SIZE_DEFAULT,
  LABEL_LEADING_DEFAULT,
  LABEL_TRACKING_DEFAULT,
  LABEL_WEIGHT_DEFAULT,
  STATION_LABEL_STYLE_DEFAULTS,
  TEXT_LABEL_COLOR_DEFAULT,
  TEXT_LABEL_DARK_COLOR_DEFAULT,
  bumpWeightByIndex,
  canonicalStationLabelStyle,
  isLabelWeight,
  isRouteBulletShape,
  isTextLabelAlign,
  stationIsSingleton,
  withTransferOverride,
} from './transforms';
import {
  TRANSFER_COLOR_DEFAULT,
  TRANSFER_DRAW_DEFAULT,
  TRANSFER_STROKE_COLOR_DEFAULT,
  TRANSFER_STROKE_WIDTH_DEFAULT,
  TRANSFER_THICKNESS_DEFAULT,
  canonicalTransferColor,
  canonicalTransferDraw,
  canonicalTransferStrokeWidth,
  canonicalTransferThickness,
  isTransferDrawOrder,
  legacyColorToDayNight,
} from './transferStyle';
import { canonicalLineLabelGap, canonicalLineWidth } from './lineWidth';
import { canonicalLineCircleRadius } from './lineCircle';
import { projectToCircle, stationCircle } from '../geometry/lineCircle';
import { clamp, rot8 } from '../util/grid';
import {
  LINE_CURVE_RADIUS_DEFAULT,
  LINE_CURVE_RADIUS_MIN,
  canonicalLineCurveRadius,
} from './lineCurve';
import { canonicalDotSize } from './dotSize';
import { canonicalStrokeColor, canonicalStrokeWidth } from './lineStroke';
import {
  DEFAULT_DOT_STYLE,
  DEFAULT_STOP_DOT_STYLE_ID,
  DOT_SHAPE_PRESETS,
  STOP_DOT_FACTORY_STYLES,
  STOP_DOT_SEED_STYLES,
  defaultDotDiameter,
  dotStylesEqual,
  isDotBaseShape,
  resolveDotStyle,
} from './dotStyle';
import {
  adoptDefaultStyles,
  canonicalStyleProps,
  captureStyleProps,
  isReservedStyleName,
  stylePropsEqual,
} from './styles';
import { edgeEndpoints, edgesFromStations } from './lineTopology';
import { pairKeyOf } from './pairKey';
import {
  LINE_END_STYLE_DEFAULT,
  isLineEndStyle,
  lineEndStyleOf,
  withStationEndStyles,
} from './lineEnd';
import { reconcileOrder } from './recordOrder';
import { parseHexA, withHexAlpha } from '../util/color';
import { migrateLegacyInlineTokens } from '../geometry/labelTokens';
import {
  copyPalette,
  FALLBACK_LINE_COLOR,
  LEGACY_BUILTIN_IDS,
  PALETTES,
  type Palette,
} from './palettes';
import { isAllowedImageHref } from './svgImport';
import type {
  DayNightColor,
  DotBaseShape,
  DotFill,
  DotServiceCodeColor,
  DotShape,
  DotStrokeAlign,
  DotStrokeColor,
  DotStyle,
  LabelCell,
  LabelValign,
  Line,
  LineId,
  LineTag,
  Rotation,
  RouteBullet,
  TransferAnchor,
  TransferEnd,
  LineCircle,
  LineEndStyle,
  LineStyle,
  MapDoc,
  Polygon,
  RegionAnchor,
  RegionAssignment,
  Station,
  StationId,
  StationStyleProps,
  StopCell,
  StopOrientation,
  StyleDef,
  StyleKind,
  SvgImage,
  TextLabel,
  TextLabelAlign,
  TextLabelWeight,
  Transfer,
} from './types';
import { KNOWN_LINE_STYLES } from './lineStyle';

const KNOWN_ORIENTATIONS = new Set<StopOrientation>([
  'auto-vertical',
  'auto-horizontal',
  'auto-ne-sw',
  'auto-nw-se',
]);

// Vestigial cardinals from earlier schema versions: collapse to the
// matching auto-* axis. Unknown values fall back to 'auto-vertical'.
const LEGACY_ORIENTATION_MIGRATIONS: Record<string, StopOrientation> = {
  up: 'auto-vertical',
  down: 'auto-vertical',
  left: 'auto-horizontal',
  right: 'auto-horizontal',
};

function migrateStopOrientation(o: unknown): StopOrientation {
  if (typeof o === 'string') {
    if (KNOWN_ORIENTATIONS.has(o as StopOrientation)) return o as StopOrientation;
    const mapped = LEGACY_ORIENTATION_MIGRATIONS[o];
    if (mapped) return mapped;
  }
  return 'auto-vertical';
}

// Legacy valign value seen in saves from before the auto-down/auto-up split.
// The single 'auto' option grew the block downward from the anchor; we map it
// to the new 'auto-down' which has the same geometry.
function migrateLabelValign(v: unknown): LabelValign | null {
  if (v === 'auto') return 'auto-down';
  return null;
}

// Re-apply the legacy-orientation migration to a stations dict. Used by
// `parse()` (file-import path) and by the zustand persist `migrate` hook
// (localStorage rehydration path) so legacy values from BOTH entry points
// are normalized before any consumer reads them.
export function sanitizeStations(stations: Record<string, Station>): {
  stations: Record<string, Station>;
  changed: boolean;
} {
  let changed = false;
  const out: Record<string, Station> = {};
  for (const id of Object.keys(stations)) {
    const st = stations[id];
    let stopsChanged = false;
    const stops = st.stops.map((c) => {
      const migrated = migrateStopOrientation(c.orientation);
      if (migrated !== c.orientation) {
        stopsChanged = true;
        return { ...c, orientation: migrated };
      }
      return c;
    });
    const migratedValign = migrateLabelValign(st.label.valign);
    const labelChanged = migratedValign !== null;
    if (stopsChanged || labelChanged) {
      changed = true;
      const nextLabel = labelChanged ? { ...st.label, valign: migratedValign } : st.label;
      out[id] = { ...st, stops, label: nextLabel };
    } else {
      out[id] = st;
    }
  }
  return { stations: out, changed };
}

// A bound station this far off its circle's circumference (world units) is
// repaired by reprojection; anything closer is float dust from the projection
// arithmetic itself and must NOT rewrite the station, or every load of a
// well-formed save would read dirty.
const CIRCLE_DRIFT_TOL = 1e-6;

/**
 * Enforce the line-circle binding invariants on a loaded doc. Shared by
 * `parse()` (file import) and the zustand persist `migrate` hook (localStorage
 * rehydration); idempotent, so both run it unconditionally.
 *
 *  - a malformed circle (non-finite center/radius) is dropped; a legal one
 *    gets its radius canonicalized (quarter grid, floored at the minimum);
 *  - a station whose `circleId` no longer resolves loses the binding (and its
 *    stops' `viaCircle` flags — the flag only lives on bound stations);
 *  - `viaCircle` on a stop of an unbound station is stripped, and a stored
 *    `false` collapses to the omitted form;
 *  - a bound station that drifted off its circle is reprojected onto it.
 */
export function sanitizeLineCircles(
  lineCirclesIn: Record<string, LineCircle>,
  stationsIn: Record<string, Station>,
): {
  lineCircles: Record<string, LineCircle>;
  stations: Record<string, Station>;
  changed: boolean;
} {
  let changed = false;

  let lineCircles = lineCirclesIn;
  const cleanedCircles: Record<string, LineCircle> = {};
  let circlesChanged = false;
  for (const id of Object.keys(lineCirclesIn)) {
    const c = lineCirclesIn[id];
    if (!Number.isFinite(c.x) || !Number.isFinite(c.y) || !Number.isFinite(c.radius)) {
      circlesChanged = true;
      continue;
    }
    const radius = canonicalLineCircleRadius(c.radius);
    if (radius !== c.radius) {
      circlesChanged = true;
      cleanedCircles[id] = { ...c, radius };
    } else {
      cleanedCircles[id] = c;
    }
  }
  if (circlesChanged) {
    lineCircles = cleanedCircles;
    changed = true;
  }

  let stations = stationsIn;
  const cleanedStations: Record<string, Station> = {};
  let stationsChanged = false;
  for (const id of Object.keys(stationsIn)) {
    const st = stationsIn[id];
    const circle = stationCircle(st, lineCircles);
    // `stationCircle` reads a dangling `circleId` as null, which is exactly the
    // question this sanitizer asks — a station is bound only if its id resolves.
    const bound = circle !== null;

    // `viaCircle` keeps only the canonical form: `true`, on a bound station.
    let stopsChanged = false;
    const stops = st.stops.map((c) => {
      if (c.viaCircle === undefined || (bound && c.viaCircle === true)) return c;
      stopsChanged = true;
      const { viaCircle: _via, ...rest } = c;
      return rest;
    });

    let next = st;
    if (st.circleId !== undefined && !bound) {
      const { circleId: _gone, ...rest } = st;
      next = { ...rest, stops };
      stationsChanged = true;
    } else if (stopsChanged) {
      next = { ...st, stops };
      stationsChanged = true;
    }
    if (circle) {
      const p = projectToCircle(circle, next);
      if (Math.abs(p.x - next.x) > CIRCLE_DRIFT_TOL || Math.abs(p.y - next.y) > CIRCLE_DRIFT_TOL) {
        next = { ...next, x: p.x, y: p.y };
        stationsChanged = true;
      }
    }
    cleanedStations[id] = next;
  }
  if (stationsChanged) {
    stations = cleanedStations;
    changed = true;
  }

  return { lineCircles, stations, changed };
}

/**
 * Widest gap between a cell coordinate and the integer it was meant to be.
 *
 * There is no lattice to round cells to in general: integers (the cardinal
 * lattice), integer multiples of √2/2 (the diagonal one), and width/gap-derived
 * pitches like 1.25 or 17/14 are all coordinates a stop legitimately holds. But
 * a value THIS close to an integer can only be an integer that drifted — the
 * nearest legitimate non-integer is 1 − √2/2 ≈ 0.17 away, eight orders of
 * magnitude out. It is also far tighter than `CELL_EPS` (1e-4), so nothing that
 * compares cells can tell the difference between a snapped value and its
 * original; the repair is invisible to the map and visible only in the file.
 */
const CELL_DUST = 1e-9;

const snapCell = (v: number): number => {
  const r = Math.round(v);
  // `+ 0` normalizes Math.round's -0 (for -0 and for tiny negatives) to +0.
  return Math.abs(v - r) < CELL_DUST ? r + 0 : v;
};

/**
 * Pull station cells that drifted off the integer lattice back onto it.
 *
 * The editor's ghost lattice used to be produced by trigonometric rotation, so
 * a station at any non-zero rotation offered slots a fraction of a ulp off
 * true — `Math.cos(π/2)` is 6.1e-17, not 0. `computeGhosts` added those offsets
 * to an anchor cell and moveStop/moveLabel/moveStationAnchor committed the sum,
 * so saved maps carry cells like `2.220446049250313e-16` where they mean 0. The
 * lattice is exact now (`localLatticeOffsets`), but nothing else on the load
 * path touches a cell, so documents that already recorded the drift keep it.
 *
 * Idempotent and keyed off the values themselves, so it runs ungated on BOTH
 * entry points — `parse()` and the persist `migrate` hook — rather than behind a
 * schema bump: the drift is not tied to a version, and a doc written by today's
 * build carries it at the newest one.
 */
export function snapStationCells(stations: Record<string, Station>): {
  stations: Record<string, Station>;
  changed: boolean;
} {
  let changed = false;
  const out: Record<string, Station> = {};
  for (const id of Object.keys(stations)) {
    const st = stations[id];
    let stationChanged = false;
    const snap = <T extends { row: number; col: number }>(cell: T): T => {
      const row = snapCell(cell.row);
      const col = snapCell(cell.col);
      if (Object.is(row, cell.row) && Object.is(col, cell.col)) return cell;
      stationChanged = true;
      return { ...cell, row, col };
    };
    const stops = st.stops.map(snap);
    const label = snap(st.label);
    // Absent stays absent — a station that never grew an anchor must persist
    // identically (the omitted-when-empty convention).
    const anchors = st.transferAnchors?.map(snap);
    if (!stationChanged) {
      out[id] = st;
      continue;
    }
    changed = true;
    out[id] = { ...st, stops, label, ...(anchors ? { transferAnchors: anchors } : {}) };
  }
  return { stations: out, changed };
}

export const SCHEMA_FORMAT = 'massimo-map';
// File schema version. Bump when a load-time rewrite must run exactly once
// and can't be inferred from the data itself (unlike the idempotent
// backfills below, which key off missing fields / legacy enum values).
// Files without the field are version 1.
//  - v1 → v2: legacy inline bullet syntax — `<X>` circle tokens become
//    `|X|`, and literal pipe text that would newly parse as a bullet gets
//    a backslash escape. Mirrors the persist-store v7 → v8 migration.
export const SCHEMA_VERSION = 2;

export interface SerializedFile {
  format: typeof SCHEMA_FORMAT;
  /** Absent in files saved before versioning was introduced (= 1). */
  version?: number;
  doc: MapDoc;
}

export type ParseResult = { ok: true; doc: MapDoc } | { ok: false; error: string };

/**
 * Keep only well-formed palettes, and only the first under any one name — the
 * map's list is keyed by name, so a duplicate would leave one of the pair
 * unreachable. Shared by both load paths.
 */
export function sanitizePalettes(value: unknown): Palette[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: Palette[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const p = raw as { name?: unknown; swatches?: unknown; description?: unknown };
    if (typeof p.name !== 'string' || !p.name || seen.has(p.name)) continue;
    if (!Array.isArray(p.swatches)) continue;
    seen.add(p.name);
    out.push({
      name: p.name,
      swatches: p.swatches
        .filter((s) => s && typeof s.name === 'string' && typeof s.color === 'string')
        // `night` is kept only when it differs from the day color — the same
        // collapse invariant the editor and the palette-file parser enforce.
        .map((s) => ({
          name: s.name as string,
          color: s.color as string,
          ...(typeof s.night === 'string' && s.night !== s.color && { night: s.night as string }),
        })),
      ...(typeof p.description === 'string' &&
        p.description.trim() !== '' && {
          description: p.description,
        }),
    });
  }
  return out;
}

// Custom palettes of the id era were `custom:<slug-of-name>`, so slugging the
// library's names back down is what matches one to its definition. Where two
// names slugged alike the id generator disambiguated with `-2`, `-3` suffixes
// that no name carries: the unsuffixed id matches whichever of them comes
// first, and a suffixed one matches nothing and is dropped like any other
// unresolvable id. Both are rare and both degrade the same way a dangling
// custom id always did.
const legacySlug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * Bake the RETIRED `activePalettes` id list into the palette COPIES a map
 * carries now (`MapDoc.palettes`). Built-in ids resolve through
 * `LEGACY_BUILTIN_IDS`; `custom:` ids resolve against the palette library,
 * which is the only place those definitions ever lived. An id that resolves to
 * neither is dropped — as a dangling custom id always was — and a map can end
 * up carrying none, which is a legitimate state.
 *
 * Keyed off field presence (`palettes` absent, `activePalettes` present), so
 * `parse()` runs it unconditionally and the localStorage rehydrate gates it at
 * v<24. Stored order is kept: it was already normalised, and it is the order
 * the map's owner last saw.
 */
export function bakeActivePalettes(
  active: readonly string[] | undefined,
  library: readonly Palette[] = [],
): Palette[] {
  const out: Palette[] = [];
  const seen = new Set<string>();
  for (const id of active ?? []) {
    const builtinName = LEGACY_BUILTIN_IDS[id];
    const found = builtinName
      ? PALETTES.find((p) => p.name === builtinName)
      : id.startsWith('custom:')
        ? library.find((p) => legacySlug(p.name) === id.slice('custom:'.length))
        : undefined;
    if (!found || seen.has(found.name)) continue;
    seen.add(found.name);
    out.push(copyPalette(found));
  }
  return out;
}

export function serialize(doc: MapDoc): string {
  const file: SerializedFile = { format: SCHEMA_FORMAT, version: SCHEMA_VERSION, doc };
  return JSON.stringify(file, null, 2);
}

/**
 * One-time rewrite of station names and text-label texts saved under the
 * legacy inline bullet syntax (see `migrateLegacyInlineTokens`). Shared by
 * `parse()` (file version < 2) and the zustand persist `migrate` hook
 * (store version < 8). Version-gated at BOTH call sites — the rewrite is
 * not idempotent: in a migrated doc, `<X>` is intentional literal text and
 * `|X|` a real bullet, so re-running would corrupt them.
 */
export function migrateLegacyBulletSyntax(
  stations: Record<string, Station>,
  textLabels: Record<string, TextLabel>,
): { stations: Record<string, Station>; textLabels: Record<string, TextLabel>; changed: boolean } {
  let changed = false;
  const nextStations: Record<string, Station> = {};
  for (const id of Object.keys(stations)) {
    const st = stations[id];
    const name = migrateLegacyInlineTokens(st.name);
    if (name !== st.name) {
      nextStations[id] = { ...st, name };
      changed = true;
    } else {
      nextStations[id] = st;
    }
  }
  const nextLabels: Record<string, TextLabel> = {};
  for (const id of Object.keys(textLabels)) {
    const g = textLabels[id];
    const text = migrateLegacyInlineTokens(g.text);
    if (text !== g.text) {
      nextLabels[id] = { ...g, text };
      changed = true;
    } else {
      nextLabels[id] = g;
    }
  }
  return { stations: nextStations, textLabels: nextLabels, changed };
}

/**
 * Parse a .massimo.json file. NEVER throws: beyond the explicit shape gate
 * below, any failure inside the pipeline surfaces as `{ok:false}`. The load
 * handlers only know how to show a ParseResult — a raw throw out of an async
 * file-input handler reads as a silent no-op load, the worst possible answer
 * to a malformed file. The explicit gates carry the real messages; this
 * wrapper is insurance against the sanitizer regression nobody wrote a gate
 * for yet.
 */
export function parse(json: string, custom: readonly Palette[] = []): ParseResult {
  try {
    return parseInner(json, custom);
  } catch (e) {
    return { ok: false, error: `Malformed map file: ${(e as Error).message}` };
  }
}

function parseInner(json: string, custom: readonly Palette[]): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    return { ok: false, error: `Not valid JSON: ${(e as Error).message}` };
  }
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'File is not a JSON object' };
  }
  const file = raw as Partial<SerializedFile>;
  if (file.format !== SCHEMA_FORMAT) {
    return {
      ok: false,
      error: `Not a Massimo map file (expected format='${SCHEMA_FORMAT}', got '${file.format}')`,
    };
  }
  if (!file.doc || typeof file.doc !== 'object') {
    return { ok: false, error: 'Missing `doc` field' };
  }
  // Substance shape gate: map substance of the WRONG shape refuses to load,
  // with a message naming the entity (see docShapeError). Runs on the raw doc
  // so nothing downstream ever reads an unguarded wrong-typed core field.
  const shapeError = docShapeError(file.doc as unknown as Record<string, unknown>);
  if (shapeError) return { ok: false, error: shapeError };
  // Pre-migration: older saves stored `labelBold: boolean`; the schema now
  // uses `labelWeight: TextLabelWeight`. Translate before merging so the
  // typed shape is clean and `labelBold` doesn't leak through.
  const rawDoc = file.doc as unknown as Record<string, unknown>;
  // Also pre-migration, and for the same reason: merge the retired
  // `polygonOrder`/`svgImageOrder` into the single `backgroundOrder` BEFORE the
  // DEFAULT_DOC merge below fabricates an empty one (see the bake's comment).
  const docWithMigratedWeight = bakeLegacyBackgroundOrder(migrateLegacyLabelBold(rawDoc));
  // Pre-styles saves get the factory Defaults via the merge below AND a
  // default-adoption pass at the end; a file that carries a styles record
  // keeps its explicit tag/Custom state (round-trip stability).
  const hadStyles = 'styles' in (docWithMigratedWeight as Record<string, unknown>);
  // Same presence gate for the default designations: the merge fabricates
  // factory-id styleDefaults for a pre-designation file, and a fabricated id
  // that happens to resolve would win over the repair-by-name path the
  // rehydrate uses — the two load paths must designate identically.
  const hadStyleDefaults = 'styleDefaults' in (docWithMigratedWeight as Record<string, unknown>);
  // Which palettes the map carries, by the same presence gate the bake uses:
  // its own list if it has one, the retired id list resolved against the
  // library if that's all it has, and the DEFAULT_DOC seed (via the merge
  // below) if it predates both.
  const rawPalettes = docWithMigratedWeight as Record<string, unknown>;
  const hadPalettes = 'palettes' in rawPalettes;
  const hadActivePalettes = 'activePalettes' in rawPalettes;
  let merged: MapDoc = { ...DEFAULT_DOC, ...(docWithMigratedWeight as Partial<MapDoc>) };
  if (hadPalettes) {
    merged.palettes = sanitizePalettes(merged.palettes);
  } else if (hadActivePalettes) {
    merged.palettes = bakeActivePalettes(
      rawPalettes.activePalettes as string[] | undefined,
      custom,
    );
  }
  delete (merged as { activePalettes?: unknown }).activePalettes;
  // Fill ABSENT per-entity substance with its defaults — the per-entity twin
  // of the DEFAULT_DOC merge above, which only reaches top-level fields. After
  // this, the rest of the pipeline reads `st.stops` / `st.label` /
  // `ln.stations` unguarded.
  merged = repairCoreShapes(merged);
  // Bake the retired doc-level curveRadius onto the lines (and fill line
  // style defs that predate the covered field) BEFORE the per-line clean and
  // the style validation below — both expect the per-line/per-def form.
  merged = bakeDocCurveRadius(merged);
  // The retired seam fields strip whole (lines, defs, and the even older
  // doc-level seamEdges) — see stripRetiredSeamFields.
  merged = stripRetiredSeamFields(merged);
  // Normalize each line's OWN topology first — canonical edge keys are what
  // the linkage closure below joins on. The override clean (segments + end
  // pins) deliberately does NOT run here: it must judge against the REPAIRED
  // topology/membership, so it runs after repairLineLinkages — a pre-repair
  // judgment ate pins the closure was about to legitimize and kept segment
  // styles on edges it was about to drop.
  const topoLines: Record<string, Line> = {};
  let topoChanged = false;
  for (const id of Object.keys(merged.lines)) {
    const cleaned = sanitizeLineTopology(backfillLineEdges(merged.lines[id]));
    if (cleaned !== merged.lines[id]) topoChanged = true;
    topoLines[id] = cleaned;
  }
  if (topoChanged) merged.lines = topoLines;
  const sanitized = sanitizeStations(merged.stations);
  if (sanitized.changed) merged.stations = sanitized.stations;
  // Pull cells that drifted off the integer lattice back onto it. Not gated on
  // the file version — see `snapStationCells`.
  const snapped = snapStationCells(merged.stations);
  if (snapped.changed) merged.stations = snapped.stations;
  // Referential repairs, BEFORE anything downstream resolves cross-collection
  // references: the membership/stops/edges closure first (it may add stops the
  // dot passes below must see), then the reference sweep over everything else.
  const linked = repairLineLinkages(merged.stations, merged.lines);
  if (linked.changed) {
    merged.stations = linked.stations;
    merged.lines = linked.lines;
  }
  merged = sanitizeDocReferences(merged);
  // Per-line override + value clean, now that topology and membership are
  // final: drop segment styles whose pair-key isn't a live adjacency, end
  // pins whose station isn't a member, and clamp the numeric fields. Also
  // backfill `name` for legacy files saved before the field existed.
  const cleanedLines: Record<string, Line> = {};
  let linesChanged = false;
  for (const id of Object.keys(merged.lines)) {
    const line = merged.lines[id];
    // NB: dot-SIZE cleaning is deferred to after bakeLineDotDefaults — its
    // drop-at default is style-aware, so it must see the baked split dot styles.
    const cleaned = sanitizeLineStroke(
      sanitizeLineCurve(sanitizeLineWidth(sanitizeLineOverrides(line))),
    );
    if (cleaned !== line) linesChanged = true;
    cleanedLines[id] = cleaned;
  }
  const named = backfillLineNames(cleanedLines);
  if (linesChanged || named.changed) merged.lines = named.lines;
  // Drop images whose href is outside the inline-data allowlist. Idempotent and
  // shared with the rehydrate path via `sanitizeImageHrefs` — the two doc loads
  // must repair identically, or a persisted doc keeps its remote href forever.
  const hrefs = sanitizeImageHrefs(merged.svgImages, merged.backgroundOrder);
  if (hrefs.changed) {
    merged.svgImages = hrefs.svgImages;
    merged.backgroundOrder = hrefs.backgroundOrder;
  }
  // Line-circle binding invariants: drop malformed circles, strip dangling
  // bindings / orphaned viaCircle flags, reproject drifted bound stations.
  const circles = sanitizeLineCircles(merged.lineCircles, merged.stations);
  if (circles.changed) {
    merged.lineCircles = circles.lineCircles;
    merged.stations = circles.stations;
  }
  // Region assignments validate against the CLEANED lines (dangling ids drop
  // the assignment; dangling pairKey anchors survive for reconcile).
  const cleanedAssignments = sanitizeRegionAssignments(merged.regionAssignments, merged.lines);
  if (cleanedAssignments.changed) merged.regionAssignments = cleanedAssignments.assignments;
  // Convert legacy dotShape preset ids to DotStyle objects and validate any
  // explicit style objects (after the line/station passes so it sees their
  // cleaned output).
  const dots = convertLegacyDotShapes(merged.stations, merged.lines);
  if (dots.changed) {
    merged.stations = dots.stations;
    merged.lines = dots.lines;
  }
  // Split the retired single `defaultDotStyle` / `defaultDotSize` into the
  // singleton/multi pair (lines + line style defs) — AFTER convertLegacyDotShapes
  // has materialized `defaultDotStyle` from any legacy `defaultDotShape`, and
  // BEFORE the singleton-aware `sanitizeStopDotSizes` (which reads the split
  // line sizes) and the style validation below (which reads the split props).
  merged = bakeLineDotDefaults(merged);
  // Canonicalize the split dot SIZES now that the dot styles are baked: the
  // drop-at default is style-aware (a service-code disc defaults to 12, not 8),
  // so this must run after bakeLineDotDefaults and before the stop-size pass
  // (which reads the cleaned line sizes).
  let lineSizesChanged = false;
  const sizedLines: Record<string, Line> = {};
  for (const id of Object.keys(merged.lines)) {
    const cleaned = sanitizeLineDotSize(merged.lines[id]);
    if (cleaned !== merged.lines[id]) lineSizesChanged = true;
    sizedLines[id] = cleaned;
  }
  if (lineSizesChanged) merged.lines = sizedLines;
  // Sanitize per-stop dot sizes AFTER the line pass: the canonical stored
  // form depends on the line's effective default, so the comparison must use
  // sanitized line values.
  const sizes = sanitizeStopDotSizes(merged.stations, merged.lines);
  if (sizes.changed) merged.stations = sizes.stations;
  // Seed the stopDot style library + tag every dot slot (idempotent; a no-op on
  // docs that already carry the library). BEFORE the style validation below so
  // the seeded defs are sanitized and the invariant pass sees the non-empty
  // stopDot kind + its default designation.
  merged = bakeStopDotLibrary(merged, hadStyles);
  const cleanedPolygons = backfillPolygonDarkColors(merged.polygons);
  if (cleanedPolygons.changed) merged.polygons = cleanedPolygons.polygons;
  // Fold any legacy fillOpacity into the fill/darkFill alpha (idempotent) —
  // after the dark-color backfill so darkFill is present to fold.
  const foldedPolygons = foldPolygonFillOpacity(merged.polygons);
  if (foldedPolygons.changed) merged.polygons = foldedPolygons.polygons;
  const cleanedLabels = backfillTextLabelColors(merged.textLabels);
  if (cleanedLabels.changed) merged.textLabels = cleanedLabels.textLabels;
  // Validate style defs, then enforce the structural style invariants (≥ 1
  // style per kind, styleDefaults resolving per kind) BEFORE the transfer
  // bake below — the bake seeds the DESIGNATED default transfer style, so
  // the designation must be repaired first.
  const cleanedStyles = sanitizeStyles(merged.styles);
  if (cleanedStyles.changed) merged.styles = cleanedStyles.styles;
  const inv = ensureStyleInvariants(
    merged.styles,
    hadStyleDefaults ? merged.styleDefaults : undefined,
  );
  if (inv.changed) {
    merged.styles = inv.styles;
    merged.styleDefaults = inv.styleDefaults;
  }
  // Fold the retired doc-level transfer settings (pre-retirement saves) into
  // per-transfer overrides, then normalize the overrides against the
  // constant defaults.
  merged = bakeLegacyTransferSettings(merged);
  const cleanedTransfers = sanitizeTransferStyles(merged.transfers);
  if (cleanedTransfers.changed) merged.transfers = cleanedTransfers.transfers;
  // Fold the retired doc-level station-label font settings into per-station
  // typography, seeding + adopting the Default station style (runs after the
  // style invariants so styleDefaults.station resolves).
  merged = bakeLegacyLabelSettings(merged);
  // Version-gated (non-idempotent) rewrite: files saved before the pipe
  // bullet grammar carry `<X>` circle tokens and unescaped literal pipes.
  if ((typeof file.version === 'number' ? file.version : 1) < 2) {
    const migrated = migrateLegacyBulletSyntax(merged.stations, merged.textLabels);
    if (migrated.changed) {
      merged.stations = migrated.stations;
      merged.textLabels = migrated.textLabels;
    }
  }
  let final = pruneDanglingStyleRefs(merged);
  // Pre-styles saves: adopt untagged, default-looking items into the
  // just-backfilled Default styles, so the Styles panel's Default editors
  // act on the whole loaded map rather than nothing.
  if (!hadStyles) final = adoptDefaultStyles(final);
  return { ok: true, doc: final };
}

// Loose shape both retirement bakes below operate on: a whole MapDoc on the
// file path, a partial persisted doc on the rehydrate path.
type LinesAndStyles = { lines?: Record<string, Line>; styles?: Record<string, StyleDef> };

/**
 * The shared body of a "this doc-global became a covered line-style field"
 * bake. `curveRadius` is the one live user (the retired `seamEdges` took the
 * same route until the whole seam retired — see stripRetiredSeamFields) and
 * the mechanics are identical every time:
 *
 *   1. Read the legacy doc value, healing garbage/absent to the field's default.
 *   2. If the doc CARRIES the field, drop it and stamp the per-line STORED form
 *      onto every line that has none — a line with its own value keeps it. The
 *      stored form is undefined at the default (never stored), in which case
 *      there is nothing to stamp.
 *   3. Fill every LINE style def that lacks the field with the concrete DEF
 *      form — defs always store a resolved value. This half runs whether or not
 *      the doc carried the field, so a def written by an older build is healed
 *      either way.
 *
 * Keyed off field presence throughout, so it is idempotent: `parse()` runs each
 * bake unconditionally and the localStorage rehydrate gates it on its version.
 * Reference-stable (returns the input doc) when nothing changed.
 *
 * Only the three per-field pieces vary, so callers pass them: `read` validates
 * the raw legacy value, `storedOf` gives the per-line form, `defOf` the per-def
 * one. Each bake stays its own exported function — the ORDERING constraints and
 * migration invariants differ per field, and those live in their doc comments.
 */
function bakeRetiredLineField<T extends LinesAndStyles, V>(
  doc: T,
  field: string,
  read: (rawValue: unknown) => V,
  storedOf: (legacy: V) => V | undefined,
  defOf: (legacy: V) => V,
): T {
  const raw = doc as Record<string, unknown>;
  const hasLegacy = field in raw;
  const legacy = read(raw[field]);
  const stored = storedOf(legacy);

  let out = doc;
  let changed = false;

  if (hasLegacy) {
    const { [field]: _retired, ...rest } = raw;
    out = rest as unknown as T;
    changed = true;
    if (stored !== undefined && out.lines) {
      const lines: Record<string, Line> = {};
      for (const id of Object.keys(out.lines)) {
        const ln = out.lines[id];
        lines[id] = field in ln ? ln : ({ ...ln, [field]: stored } as Line);
      }
      out = { ...out, lines };
    }
  }

  if (out.styles) {
    let stylesChanged = false;
    const styles: Record<string, StyleDef> = {};
    for (const id of Object.keys(out.styles)) {
      const def = out.styles[id];
      if (
        def &&
        def.kind === 'line' &&
        def.props &&
        typeof def.props === 'object' &&
        !(field in def.props)
      ) {
        // Raw persisted props — spread via a loose view, and cast back through
        // `unknown`: the def predates the field, so it is not a valid
        // LineStyleProps until this write lands. (The computed key widens the
        // spread to an index signature, which is why the cast needs the hop.)
        const props = def.props as unknown as Record<string, unknown>;
        styles[id] = {
          ...def,
          props: { ...props, [field]: defOf(legacy) },
        } as unknown as StyleDef;
        stylesChanged = true;
      } else {
        styles[id] = def;
      }
    }
    if (stylesChanged) {
      out = out === doc ? ({ ...doc, styles } as T) : { ...out, styles };
      changed = true;
    }
  }

  return changed ? out : doc;
}

/**
 * Bake the RETIRED doc-level `curveRadius` into per-line fields, and fill
 * line style defs saved before `curveRadius` was a covered field. Corner
 * rounding is per-line now (`Line.curveRadius`, missing ⇒ the old doc-global
 * default 24), so a legacy file's map-wide radius must land on every line to
 * keep its rendered curves; the doc field is then dropped. A line (or style
 * def) that somehow carries its own value keeps it. Keyed off field presence
 * (idempotent), so parse() runs it unconditionally and the localStorage
 * rehydrate gates it at v<16. Garbage legacy values read as the default.
 * Must run BEFORE style-def validation on both paths — `sanitizeStyleProps`
 * requires `curveRadius` on line defs, and this bake is what guarantees it
 * for defs written by older builds.
 */
export function bakeDocCurveRadius<T extends LinesAndStyles>(doc: T): T {
  return bakeRetiredLineField(
    doc,
    'curveRadius',
    (v) => (typeof v === 'number' && Number.isFinite(v) ? v : LINE_CURVE_RADIUS_DEFAULT),
    canonicalLineCurveRadius,
    (r) => Math.max(LINE_CURVE_RADIUS_MIN, Math.round(r)),
  );
}

/**
 * Strip the RETIRED seam fields: `seamColor`/`seamWidth`/`seamEdges` on lines
 * and line style defs, plus the even older doc-level `seamEdges`. The branch
 * seam retired when self-overlaps became real region faces — a branch mouth
 * is painted per junction in Layering mode now, not styled per line — so a
 * save that carried a seam renders merged at its junctions after this strip,
 * and the look is re-created (where wanted) as region assignments by hand.
 * Fields leave LINES and DEFS together, so `stylePropsEqual` still holds and
 * no tagged wearer detaches. Reference-stable when nothing changed; parse()
 * runs it unconditionally and the localStorage rehydrate gates it at v<25.
 */
export function stripRetiredSeamFields<T extends LinesAndStyles>(doc: T): T {
  const raw = doc as Record<string, unknown>;
  let out = doc;
  let changed = false;
  if ('seamEdges' in raw) {
    const { seamEdges: _retired, ...rest } = raw;
    out = rest as unknown as T;
    changed = true;
  }
  const hasSeam = (o: object): boolean => 'seamColor' in o || 'seamWidth' in o || 'seamEdges' in o;
  if (out.lines) {
    let linesChanged = false;
    const lines: Record<string, Line> = {};
    for (const id of Object.keys(out.lines)) {
      const ln = out.lines[id] as Line & Record<string, unknown>;
      if (ln && typeof ln === 'object' && hasSeam(ln)) {
        const { seamColor: _c, seamWidth: _w, seamEdges: _e, ...restLn } = ln;
        lines[id] = restLn as unknown as Line;
        linesChanged = true;
      } else {
        lines[id] = ln;
      }
    }
    if (linesChanged) {
      out = out === doc ? ({ ...doc, lines } as T) : { ...out, lines };
      changed = true;
    }
  }
  if (out.styles) {
    let stylesChanged = false;
    const styles: Record<string, StyleDef> = {};
    for (const id of Object.keys(out.styles)) {
      const def = out.styles[id];
      if (
        def &&
        def.kind === 'line' &&
        def.props &&
        typeof def.props === 'object' &&
        hasSeam(def.props)
      ) {
        const props = def.props as unknown as Record<string, unknown>;
        const { seamColor: _c, seamWidth: _w, seamEdges: _e, ...restProps } = props;
        styles[id] = { ...def, props: restProps } as unknown as StyleDef;
        stylesChanged = true;
      } else {
        styles[id] = def;
      }
    }
    if (stylesChanged) {
      out = out === doc ? ({ ...doc, styles } as T) : { ...out, styles };
      changed = true;
    }
  }
  return changed ? out : doc;
}

/**
 * Fill the split dot-TYPE ids (`singletonDotStyleId` / `multiDotStyleId`) on
 * LINE STYLE DEFS saved before dot type became a covered line-style field —
 * absent ⇒ the stopDot ⭐ default id. Only the defs need this: a line's own
 * split-default ids were materialized by the v19 stopDot-library bake. The
 * file-import path heals the same way inside `sanitizeStyleProps`
 * (canonicalStyleProps' `?? DEFAULT`), so this is the localStorage-rehydrate
 * counterpart, gated at v<20 by `migrateDoc`. Idempotent (keyed off the ids'
 * presence) and reference-stable when every line def already carries both.
 */
export function bakeLineStyleDotIds<T extends { styles?: Record<string, StyleDef> }>(doc: T): T {
  if (!doc.styles) return doc;
  let changed = false;
  const styles: Record<string, StyleDef> = {};
  for (const id of Object.keys(doc.styles)) {
    const def = doc.styles[id];
    if (def && def.kind === 'line' && def.props && typeof def.props === 'object') {
      // Raw persisted props — a loose view, since a pre-v20 def isn't a valid
      // LineStyleProps yet.
      const props = def.props as unknown as Record<string, unknown>;
      const missingSingle = !('singletonDotStyleId' in props);
      const missingMulti = !('multiDotStyleId' in props);
      if (missingSingle || missingMulti) {
        styles[id] = {
          ...def,
          props: {
            ...props,
            ...(missingSingle ? { singletonDotStyleId: DEFAULT_STOP_DOT_STYLE_ID } : {}),
            ...(missingMulti ? { multiDotStyleId: DEFAULT_STOP_DOT_STYLE_ID } : {}),
          },
        } as StyleDef;
        changed = true;
        continue;
      }
    }
    styles[id] = def;
  }
  return changed ? ({ ...doc, styles } as T) : doc;
}

/**
 * Heal `endStyle` on LINE STYLE DEFS saved before the line END became a covered
 * line-style field — anything that isn't one of the three known values (absent
 * included) ⇒ 'square', the historical full marker square, so a legacy def
 * still paints what it always did. Only the defs need it: a line that predates
 * the feature carries no end of its own, so it already paints square and stays
 * a MATCH for its healed def — no tag pruning, unlike the v20 dot-type
 * backfill. The file-import path heals the same way inside `sanitizeStyleProps`
 * (canonicalStyleProps' `isLineEndStyle` guard), so this is the
 * localStorage-rehydrate counterpart, gated at v<22 by `migrateDoc`.
 * Reference-stable when every line def already carries a valid value.
 */
export function backfillLineStyleEndStyle<T extends { styles?: Record<string, StyleDef> }>(
  doc: T,
): T {
  if (!doc.styles) return doc;
  let changed = false;
  const styles: Record<string, StyleDef> = {};
  for (const id of Object.keys(doc.styles)) {
    const def = doc.styles[id];
    if (def && def.kind === 'line' && def.props && typeof def.props === 'object') {
      // Raw persisted props — a pre-v22 def isn't a valid LineStyleProps yet.
      const props = def.props as unknown as Record<string, unknown>;
      if (!isLineEndStyle(props.endStyle)) {
        styles[id] = {
          ...def,
          props: { ...props, endStyle: LINE_END_STYLE_DEFAULT },
        } as StyleDef;
        changed = true;
        continue;
      }
    }
    styles[id] = def;
  }
  return changed ? ({ ...doc, styles } as T) : doc;
}

/**
 * Rehydrate-path counterpart to `pruneDanglingStyleRefs` for the ONE covered
 * field that newly diverges when dot type joins line styles (v<20): drop a
 * line's `styleId` when its split dot-TYPE ids no longer match its (now-fuller)
 * line style def. Every other covered line field was kept in sync by the app on
 * write, so only dot type can mismatch a v19 save — a targeted check that reads
 * only the line + its def (no `captureStyleProps`), so it tolerates the migrate
 * path's partial docs. Reference-stable when nothing is untagged. The file-
 * import path handles this via the general `pruneDanglingStyleRefs` instead.
 */
export function pruneLineDotTypeTagMismatches(
  lines: Record<string, Line>,
  styles: Record<string, StyleDef>,
): Record<string, Line> {
  let changed = false;
  const out: Record<string, Line> = {};
  for (const id of Object.keys(lines)) {
    const ln = lines[id];
    const def = typeof ln.styleId === 'string' ? styles[ln.styleId] : undefined;
    if (def?.kind === 'line') {
      const single = ln.singletonDotStyleId ?? DEFAULT_STOP_DOT_STYLE_ID;
      const multi = ln.multiDotStyleId ?? DEFAULT_STOP_DOT_STYLE_ID;
      if (single !== def.props.singletonDotStyleId || multi !== def.props.multiDotStyleId) {
        const { styleId: _gone, ...rest } = ln;
        out[id] = rest as Line;
        changed = true;
        continue;
      }
    }
    out[id] = ln;
  }
  return changed ? out : lines;
}

/**
 * Bake the retired single `defaultDotStyle` / `defaultDotSize` into the split
 * `singletonDotStyle` / `multiDotStyle` (+ sizes) — on both the lines and the
 * line style-def props — so a save that predates the split renders identically:
 * every stop used one default, now both the singleton and shared cases carry
 * it. Idempotent and keyed off the retired keys' presence: reference-stable when
 * neither appears (preserving the already-canonical passthrough storeMigrate
 * pins). Called by parse() — after convertLegacyDotShapes materializes
 * `defaultDotStyle` from any legacy `defaultDotShape`, and before the
 * singleton-aware `sanitizeStopDotSizes` — and by migrateDoc (v<18).
 */
export function bakeLineDotDefaults<
  T extends { lines?: Record<string, Line>; styles?: Record<string, StyleDef> },
>(doc: T): T {
  let out = doc;
  let changed = false;

  if (out.lines) {
    let linesChanged = false;
    const lines: Record<string, Line> = {};
    for (const id of Object.keys(out.lines)) {
      const ln = out.lines[id] as Line & { defaultDotStyle?: DotStyle; defaultDotSize?: number };
      const hasLegacyStyle = 'defaultDotStyle' in ln;
      const hasLegacySize = 'defaultDotSize' in ln;
      if (!hasLegacyStyle && !hasLegacySize) {
        lines[id] = ln;
        continue;
      }
      const { defaultDotStyle: legacyStyle, defaultDotSize: legacySize, ...rest } = ln;
      let next = rest as Line;
      if (hasLegacyStyle) {
        // Per-line stored form: drop at the historical default (never stored).
        // An explicit split field already present wins (never clobbered).
        const stored =
          legacyStyle !== undefined && !dotStylesEqual(legacyStyle, DEFAULT_DOT_STYLE)
            ? legacyStyle
            : undefined;
        if (stored !== undefined) {
          if (!('singletonDotStyle' in next)) next = { ...next, singletonDotStyle: stored };
          if (!('multiDotStyle' in next)) next = { ...next, multiDotStyle: stored };
        }
      }
      if (hasLegacySize) {
        // canonicalDotSize does not guard finiteness (its callers do), so a
        // non-finite legacy value must be dropped here, not clamped to Infinity.
        const stored =
          typeof legacySize === 'number' && Number.isFinite(legacySize)
            ? canonicalDotSize(legacySize)
            : undefined;
        if (stored !== undefined) {
          if (!('singletonDotSize' in next)) next = { ...next, singletonDotSize: stored };
          if (!('multiDotSize' in next)) next = { ...next, multiDotSize: stored };
        }
      }
      lines[id] = next;
      linesChanged = true;
    }
    if (linesChanged) {
      out = { ...out, lines } as T;
      changed = true;
    }
  }

  if (out.styles) {
    let stylesChanged = false;
    const styles: Record<string, StyleDef> = {};
    for (const id of Object.keys(out.styles)) {
      const def = out.styles[id];
      const props = def?.props as unknown as Record<string, unknown> | undefined;
      if (
        def &&
        def.kind === 'line' &&
        props &&
        ('defaultDotStyle' in props || 'defaultDotSize' in props)
      ) {
        // Line styles no longer cover dot APPEARANCE — the retired
        // `defaultDotStyle` is just stripped here (sanitizeStyleProps would drop
        // it anyway); only dot SIZE still splits onto the def.
        const { defaultDotStyle: _ls, defaultDotSize: lz, ...restProps } = props;
        const filled: Record<string, unknown> = { ...restProps };
        // Style-def props are CONCRETE (always store the resolved value, even a
        // default), so no drop-at-default here — mirror bakeDocCurveRadius.
        if (!('singletonDotSize' in filled) && lz !== undefined) filled.singletonDotSize = lz;
        if (!('multiDotSize' in filled) && lz !== undefined) filled.multiDotSize = lz;
        styles[id] = { ...def, props: filled } as unknown as StyleDef;
        stylesChanged = true;
      } else {
        styles[id] = def;
      }
    }
    if (stylesChanged) {
      out = out === doc ? ({ ...doc, styles } as T) : { ...out, styles };
      changed = true;
    }
  }

  return changed ? out : doc;
}

/**
 * v19: introduce the stopDot style LIBRARY. Pre-v19 docs stored dot appearance
 * as raw `DotStyle` values on lines (`singleton/multiDotStyle`) and per-stop
 * overrides (`dotStyle`), with no library. This seeds the PRUNED baseline
 * (STOP_DOT_SEED_STYLES: Filled black + None) into `doc.styles`, recognizes each
 * dot slot's raw value against the full known catalog, and — for a matched
 * preset the map actually WEARS — adds it to the library and tags the slot (so
 * editing that style restamps its wearers). A map's library thus stays pruned
 * plus exactly the presets it uses; unmatched hand-edited values are left
 * untagged, raw kept. Each line's split default is materialized (always stored
 * now). Sets the `stopDot` default designation. Idempotent and keyed off the
 * ABSENCE of any stopDot style — a doc that already has a library is returned
 * unchanged (reference-stable), so parse() can run it unconditionally and the
 * localStorage rehydrate gates it at v<19.
 */
export function bakeStopDotLibrary(doc: MapDoc, sourceHadStyles = true): MapDoc {
  if (!doc.styles) return doc;
  // Idempotency gate: a doc that already carries the library is left alone.
  // `sourceHadStyles` lets parse() judge that against the FILE rather than
  // against `doc` — its DEFAULT_DOC merge fabricates a whole styles record
  // (seeded stopDot entries and all) BEFORE this runs, so testing `doc` alone
  // short-circuits the bake on exactly the pre-Styles files it exists for,
  // leaving their dot slots untagged and their raw shadows orphaned. The
  // rehydrate path reads a real persisted record, so it keeps the default.
  if (sourceHadStyles && Object.values(doc.styles).some((d) => d.kind === 'stopDot')) return doc;
  // Recognize against the FULL known catalog, but seed only the pruned baseline
  // plus whatever the map actually wears (collected below).
  const knownDefs = Object.values(STOP_DOT_FACTORY_STYLES);
  const idOf = (v: DotStyle): string | undefined =>
    knownDefs.find((d) => dotStylesEqual(d.props as DotStyle, v))?.id;
  const usedIds = new Set<string>();
  const track = (id: string | undefined): string | undefined => {
    if (id !== undefined) usedIds.add(id);
    return id;
  };

  const lines: Record<string, Line> = {};
  for (const id of Object.keys(doc.lines ?? {})) {
    const ln = doc.lines[id];
    // Tag each split default by value-match against the known catalog, using
    // the RESOLVED value (an absent raw already renders filled-black). The raw
    // itself is left exactly as the file had it: materializing an absent one
    // would store a value equal to its default, against the clean-persisted
    // convention — and on the file-import path (where this bake now correctly
    // runs for pre-Styles saves) it would dirty every legacy line on load.
    const sId = track(idOf(ln.singletonDotStyle ?? DEFAULT_DOT_STYLE));
    const mId = track(idOf(ln.multiDotStyle ?? DEFAULT_DOT_STYLE));
    lines[id] = {
      ...ln,
      ...(sId !== undefined ? { singletonDotStyleId: sId } : {}),
      ...(mId !== undefined ? { multiDotStyleId: mId } : {}),
    };
  }

  const stations: Record<string, Station> = {};
  for (const sid of Object.keys(doc.stations ?? {})) {
    const st = doc.stations[sid];
    let changed = false;
    const stops = st.stops.map((s) => {
      if (s.dotStyle === undefined || s.dotStyleId !== undefined) return s;
      const id = track(idOf(s.dotStyle));
      if (id === undefined) return s;
      changed = true;
      return { ...s, dotStyleId: id };
    });
    stations[sid] = changed ? { ...st, stops } : st;
  }

  // Seed the pruned baseline + only the known presets the map actually wears.
  const usedStyles: Record<string, StyleDef> = {};
  for (const id of usedIds) usedStyles[id] = STOP_DOT_FACTORY_STYLES[id];
  const styles = { ...STOP_DOT_SEED_STYLES, ...usedStyles, ...doc.styles };

  return {
    ...doc,
    styles,
    lines,
    stations,
    styleDefaults: {
      ...doc.styleDefaults,
      stopDot: doc.styleDefaults?.stopDot ?? DEFAULT_STOP_DOT_STYLE_ID,
    },
  };
}

/**
 * Backfill the required `strokeAlign` field onto every persisted dot style that
 * predates it. Walks all four dot-style homes — a stop's `dotStyle` override, a
 * line's `singletonDotStyle`/`multiDotStyle` split shadows, and each stopDot
 * library def's `props` — adding 'center' (the historical, SVG-native stroke
 * placement) wherever it is absent. Reference-stable when nothing is missing, so
 * migrateDoc keeps its pass-through-by-reference for already-canonical docs. The
 * file-import path needs no separate call: every dot style there already flows
 * through `sanitizeDotStyle`, which defaults the field.
 */
export function backfillDotStrokeAlign<
  T extends {
    stations?: Record<string, Station>;
    lines?: Record<string, Line>;
    styles?: Record<string, StyleDef>;
  },
>(doc: T): T {
  // A DotStyle persisted before the field existed lacks it at runtime; add
  // 'center'. Same reference back when it's already present (no churn).
  const withAlign = (ds: DotStyle): DotStyle =>
    (ds as { strokeAlign?: DotStrokeAlign }).strokeAlign === undefined
      ? { ...ds, strokeAlign: 'center' }
      : ds;
  let changed = false;

  let lines = doc.lines;
  if (lines) {
    const next: Record<string, Line> = {};
    for (const id of Object.keys(lines)) {
      const ln = lines[id];
      const s = ln.singletonDotStyle && withAlign(ln.singletonDotStyle);
      const m = ln.multiDotStyle && withAlign(ln.multiDotStyle);
      if (s === ln.singletonDotStyle && m === ln.multiDotStyle) {
        next[id] = ln;
      } else {
        changed = true;
        next[id] = {
          ...ln,
          ...(s ? { singletonDotStyle: s } : {}),
          ...(m ? { multiDotStyle: m } : {}),
        };
      }
    }
    lines = next;
  }

  let stations = doc.stations;
  if (stations) {
    const next: Record<string, Station> = {};
    for (const sid of Object.keys(stations)) {
      const st = stations[sid];
      let stopsChanged = false;
      const stops = st.stops.map((stop) => {
        if (stop.dotStyle === undefined) return stop;
        const d = withAlign(stop.dotStyle);
        if (d === stop.dotStyle) return stop;
        stopsChanged = true;
        return { ...stop, dotStyle: d };
      });
      next[sid] = stopsChanged ? { ...st, stops } : st;
      if (stopsChanged) changed = true;
    }
    stations = next;
  }

  let styles = doc.styles;
  if (styles) {
    const next: Record<string, StyleDef> = {};
    for (const id of Object.keys(styles)) {
      const def = styles[id];
      if (def.kind === 'stopDot') {
        const props = withAlign(def.props);
        if (props !== def.props) {
          changed = true;
          next[id] = { ...def, props };
          continue;
        }
      }
      next[id] = def;
    }
    styles = next;
  }

  return changed
    ? {
        ...doc,
        ...(lines ? { lines } : {}),
        ...(stations ? { stations } : {}),
        ...(styles ? { styles } : {}),
      }
    : doc;
}

/**
 * Merge the RETIRED `polygonOrder` + `svgImageOrder` into the single
 * `backgroundOrder`. Polygons and svg images share one z-stack now, so either
 * kind can sit over the other; before the merge they were two arrays painted
 * as two blocks, which pinned every image above every polygon. Concatenating
 * polygons-then-images reproduces that stacking exactly, so a legacy map
 * renders unchanged. Each side is reconciled against its records first (drop
 * dead ids, append records the order missed), and the two retired fields are
 * dropped. Keyed off field presence (idempotent), so parse() runs it
 * unconditionally and the localStorage rehydrate gates it at v<17. Returns the
 * input reference untouched when there is nothing to merge — `migrateDoc` pins
 * pass-through-by-reference for already-canonical docs.
 *
 * MUST run BEFORE parse()'s `{...DEFAULT_DOC, ...doc}` merge: that merge
 * fabricates `backgroundOrder: []` for a legacy file, which is indistinguishable
 * from a real empty one, and the "already has it" check below would then throw
 * the legacy order away. Pre-merge, presence means the file truly carried it.
 */
export function bakeLegacyBackgroundOrder<
  T extends {
    polygons?: Record<string, unknown>;
    svgImages?: Record<string, unknown>;
    backgroundOrder?: string[];
  },
>(doc: T): T {
  const raw = doc as Record<string, unknown>;
  const hasLegacy = 'polygonOrder' in raw || 'svgImageOrder' in raw;
  if (!hasLegacy) return doc;

  const legacy = (key: string): string[] => (Array.isArray(raw[key]) ? (raw[key] as string[]) : []);
  const { polygonOrder: _retiredP, svgImageOrder: _retiredI, ...rest } = raw;
  // A doc that already carries a real backgroundOrder (a newer build's, with
  // stale legacy keys alongside) keeps it; only the dead keys are dropped.
  const merged = Array.isArray(raw.backgroundOrder)
    ? (raw.backgroundOrder as string[])
    : [
        ...reconcileOrder(doc.polygons ?? {}, legacy('polygonOrder')),
        ...reconcileOrder(doc.svgImages ?? {}, legacy('svgImageOrder')),
      ];
  return { ...rest, backgroundOrder: merged } as unknown as T;
}

/**
 * Drop every svg image whose `href` is outside the inline-data allowlist, and
 * its `backgroundOrder` entry with it.
 *
 * The allowlist ({@link isAllowedImageHref}) is what makes an image opaque:
 * every image a map carries is inline bytes, so a map paints without reaching
 * the network and an exported SVG/PNG/PDF is genuinely self-contained. The
 * clipboard paste path checked it; the two DOC LOAD paths did not, so a
 * hand-edited file with a remote `https://` href was accepted verbatim, fetched
 * on every paint, and re-serialized into library payloads and every export.
 *
 * Dropping is the same repair every sibling sanitizer in this file makes for
 * data it cannot honour (a malformed line circle, a region assignment with a
 * dangling line id) — silently, and by removing the record rather than leaving
 * a half-valid one behind.
 *
 * Non-version-gated: the hole existed at every store version, so a gate would
 * skip exactly the docs most likely to carry it. Idempotent and value-keyed;
 * returns its inputs by reference when nothing is wrong.
 */
export function sanitizeImageHrefs(
  svgImages: Record<string, SvgImage>,
  backgroundOrder: readonly string[],
): { svgImages: Record<string, SvgImage>; backgroundOrder: string[]; changed: boolean } {
  const dropped = new Set<string>();
  for (const id of Object.keys(svgImages)) {
    const href = svgImages[id]?.href;
    if (typeof href !== 'string' || !isAllowedImageHref(href)) dropped.add(id);
  }
  if (dropped.size === 0) {
    return { svgImages, backgroundOrder: backgroundOrder as string[], changed: false };
  }
  const kept: Record<string, SvgImage> = {};
  for (const id of Object.keys(svgImages)) if (!dropped.has(id)) kept[id] = svgImages[id];
  return {
    svgImages: kept,
    backgroundOrder: backgroundOrder.filter((id) => !dropped.has(id)),
    changed: true,
  };
}

// Backfill `line.name` for legacy files saved before the field existed, using
// the historical `${service} line` default. Shared by parse() (file import) and
// the zustand persist `migrate` hook (localStorage rehydration), so both entry
// points stay in step — like the other backfills.
export function backfillLineNames(lines: Record<string, Line>): {
  lines: Record<string, Line>;
  changed: boolean;
} {
  let changed = false;
  const next: Record<string, Line> = {};
  for (const id of Object.keys(lines)) {
    const ln = lines[id];
    if (!ln.name) {
      next[id] = { ...ln, name: `${ln.service} line` };
      changed = true;
    } else {
      next[id] = ln;
    }
  }
  return { lines: next, changed };
}

// Backfill the day/night colors for labels saved before those fields existed.
// Old labels rendered with the theme colors (#111111 / #ffffff), so each
// missing field is set once to the matching default; independent thereafter.
export function backfillTextLabelColors(textLabels: Record<string, TextLabel>): {
  textLabels: Record<string, TextLabel>;
  changed: boolean;
} {
  let changed = false;
  const next: Record<string, TextLabel> = {};
  for (const id of Object.keys(textLabels)) {
    const g = textLabels[id];
    if (g.color === undefined || g.darkColor === undefined) {
      next[id] = {
        ...g,
        color: g.color ?? TEXT_LABEL_COLOR_DEFAULT,
        darkColor: g.darkColor ?? TEXT_LABEL_DARK_COLOR_DEFAULT,
      };
      changed = true;
    } else {
      next[id] = g;
    }
  }
  return { textLabels: next, changed };
}

// Backfill the dark-mode colors for polygons saved before those fields existed.
// Each missing field is set once to the matching light color; from then on the
// two are independent. (Polygons written by the current app already carry them.)
export function backfillPolygonDarkColors(polygons: Record<string, Polygon>): {
  polygons: Record<string, Polygon>;
  changed: boolean;
} {
  let changed = false;
  const next: Record<string, Polygon> = {};
  for (const id of Object.keys(polygons)) {
    const p = polygons[id];
    if (p.darkFill === undefined || p.darkStroke === undefined) {
      next[id] = { ...p, darkFill: p.darkFill ?? p.fill, darkStroke: p.darkStroke ?? p.stroke };
      changed = true;
    } else {
      next[id] = p;
    }
  }
  return { polygons: next, changed };
}

// Fold a polygon's legacy `fillOpacity` (0-100 percent) into the alpha channel
// of its `fill` AND `darkFill`, then drop the field. The old opacity slider
// applied one value to whichever theme fill was showing, so both fold to the
// same alpha. Idempotent — a polygon without `fillOpacity` passes straight
// through — so parse() (file import) can run it unconditionally, and migrateDoc
// gates it on v<9. Multiplies any alpha the fill already carries by the opacity
// fraction, so a translucent fill only gets more transparent. Must run AFTER
// backfillPolygonDarkColors so `darkFill` exists to fold.
export function foldPolygonFillOpacity(polygons: Record<string, Polygon>): {
  polygons: Record<string, Polygon>;
  changed: boolean;
} {
  let changed = false;
  const next: Record<string, Polygon> = {};
  for (const id of Object.keys(polygons)) {
    const p = polygons[id] as Polygon & { fillOpacity?: number };
    if (p.fillOpacity === undefined) {
      next[id] = p;
      continue;
    }
    const pct = clamp(p.fillOpacity, 0, 100);
    const fold = (hex: string) => withHexAlpha(hex, (parseHexA(hex)[3] * pct) / 100);
    const { fillOpacity: _drop, ...rest } = p;
    next[id] = { ...rest, fill: fold(p.fill), darkFill: fold(p.darkFill) };
    changed = true;
  }
  return { polygons: next, changed };
}

const KNOWN_DOT_STROKE_ALIGNS = new Set<DotStrokeAlign>(['center', 'inside', 'outside']);
// Stroke alignment is REQUIRED on DotStyle but was added after some saves; a
// missing or malformed value defaults to 'center' (the historical behavior)
// rather than invalidating the whole style.
const sanitizeStrokeAlign = (v: unknown): DotStrokeAlign =>
  typeof v === 'string' && KNOWN_DOT_STROKE_ALIGNS.has(v as DotStrokeAlign)
    ? (v as DotStrokeAlign)
    : 'center';

// Validate + normalize one raw dot color from a hand-edited file: the 'line'
// sentinel, a {day, night} string pair (lowercased), or whichever of the
// narrower sentinels the slot accepts — 'none' (fills only) and 'bw'
// (auto-contrast; fills and strokes, but NOT the service code, where
// auto-contrast is spelled by ABSENCE). Returns undefined when the value
// doesn't conform. The return type covers every slot; callers narrow.
function sanitizeDotColor(
  raw: unknown,
  allow: { none?: boolean; bw?: boolean } = {},
): DotFill | undefined {
  if (raw === 'line') return 'line';
  if (raw === 'none') return allow.none ? 'none' : undefined;
  if (raw === 'bw') return allow.bw ? 'bw' : undefined;
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.day !== 'string' || typeof o.night !== 'string') return undefined;
  return { day: o.day.toLowerCase(), night: o.night.toLowerCase() };
}

// Validate + normalize one raw transfer color: a legacy single-color string
// (wrapped so both halves take it — old colors are day colors) or a {day,
// night} string pair. Returns undefined when the value doesn't conform.
// Unlike sanitizeDotColor this has no 'line'/'none' sentinels and does NOT
// lowercase — transfer colors are compared exactly and legacy strings are
// preserved verbatim (see legacyColorToDayNight / canonicalTransferColor).
function sanitizeDayNightColor(raw: unknown): DayNightColor | undefined {
  if (typeof raw === 'string') return legacyColorToDayNight(raw);
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.day !== 'string' || typeof o.night !== 'string') return undefined;
  return { day: o.day, night: o.night };
}

// Validate + normalize one raw `dotStyle` value. Returns the canonical style,
// or undefined when the value doesn't conform — callers drop the field so the
// default chain takes over. File-import hygiene only; app-written styles are
// canonical by construction.
function sanitizeDotStyle(raw: unknown): DotStyle | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  if (!isDotBaseShape(o.shape)) {
    return undefined;
  }
  const fill = sanitizeDotColor(o.fill, { none: true, bw: true });
  if (fill === undefined) return undefined;
  const strokeColor = sanitizeDotColor(o.strokeColor, { bw: true }) as DotStrokeColor | undefined;
  if (strokeColor === undefined) return undefined;
  if (typeof o.strokeWidth !== 'number' || !Number.isFinite(o.strokeWidth)) return undefined;
  if (typeof o.showServiceCode !== 'boolean') return undefined;
  // serviceCodeColor is OPTIONAL — absent ⇒ auto-contrast; a malformed value is
  // dropped (treated as absent) rather than invalidating the whole style. The
  // 'line' sentinel or a day/night pair (no 'none', and no 'bw' either — here
  // auto-contrast is spelled by ABSENCE, so a stray 'bw' dropping to absent
  // lands on exactly the behavior it asked for).
  const serviceCodeColor =
    o.serviceCodeColor === undefined
      ? undefined
      : (sanitizeDotColor(o.serviceCodeColor) as DotServiceCodeColor | undefined);
  const out: DotStyle = {
    shape: o.shape as DotBaseShape,
    fill,
    strokeWidth: Math.max(0, o.strokeWidth),
    strokeColor,
    strokeAlign: sanitizeStrokeAlign(o.strokeAlign),
    showServiceCode: o.showServiceCode,
  };
  if (serviceCodeColor !== undefined) out.serviceCodeColor = serviceCodeColor;
  // Also optional, and stored only when ON — anything but a literal `true` is
  // the (absent) off state, so a garbage value degrades to the whole code
  // rather than invalidating the style.
  if (o.serviceCodeFirstLetterOnly === true) out.serviceCodeFirstLetterOnly = true;
  return out;
}

// "Already canonical" check for an existing dotStyle value: stringify-equal to
// its sanitized rebuild (field order is fixed by construction everywhere the
// app writes styles, so this is exact for app-written docs; hand-edited docs
// just get rebuilt).
const isCanonicalDotStyle = (orig: unknown, cleaned: DotStyle): boolean =>
  JSON.stringify(orig) === JSON.stringify(cleaned);

function convertStopDotFields(stop: StopCell): StopCell {
  let next = stop;
  if ('dotShape' in next) {
    const { dotShape, ...rest } = next as StopCell & { dotShape?: unknown };
    if (rest.dotStyle === undefined) {
      // Legacy preset id → its pinned style. Unknown ids are dropped so the
      // stop falls back to the line default, like other garbage fallbacks.
      const preset =
        typeof dotShape === 'string' ? DOT_SHAPE_PRESETS[dotShape as DotShape] : undefined;
      next = preset ? { ...rest, dotStyle: preset } : rest;
    } else {
      // Both fields present: the writer knew about the new field — trust it.
      next = rest;
    }
  }
  if (next.dotStyle !== undefined) {
    const cleaned = sanitizeDotStyle(next.dotStyle);
    if (cleaned === undefined) {
      const { dotStyle: _gone, ...rest } = next;
      next = rest;
    } else if (!isCanonicalDotStyle(next.dotStyle, cleaned)) {
      next = { ...next, dotStyle: cleaned };
    }
  }
  return next;
}

// Validate/canonicalize one line-level dot-style field: drop when invalid, else
// rebuild to canonical form. The RETIRED single `defaultDotStyle` also drops at
// the historical default (mirrors its retired setter — it is split into the two
// live fields by bakeLineDotDefaults right after). The live split fields
// (`singletonDotStyle` / `multiDotStyle`) are NOT dropped at the default: their
// setter (setLineCaseDotStyle) and the v19 library bake ALWAYS store the raw
// shadow beside the id tag, so dropping it here would make file round-trip
// disagree with the in-memory form. Accessed loosely so the retired key (absent
// from the Line type) still resolves.
function sanitizeLineDotStyleField(
  line: Line,
  field: 'defaultDotStyle' | 'singletonDotStyle' | 'multiDotStyle',
): Line {
  const raw = (line as unknown as Record<string, unknown>)[field];
  if (raw === undefined) return line;
  const cleaned = sanitizeDotStyle(raw);
  // Invalid ⇒ drop. The retired single field additionally drops at the default.
  if (
    cleaned === undefined ||
    (field === 'defaultDotStyle' && dotStylesEqual(cleaned, DEFAULT_DOT_STYLE))
  ) {
    const { [field]: _gone, ...rest } = line as unknown as Record<string, unknown>;
    return rest as unknown as Line;
  }
  if (!isCanonicalDotStyle(raw, cleaned)) {
    return { ...line, [field]: cleaned } as Line;
  }
  return line;
}

function convertLineDotFields(line: Line): Line {
  let next = line as Line & { defaultDotShape?: unknown; defaultDotStyle?: DotStyle };
  if ('defaultDotShape' in next) {
    const { defaultDotShape, ...rest } = next;
    if (rest.defaultDotStyle === undefined) {
      const preset =
        typeof defaultDotShape === 'string'
          ? DOT_SHAPE_PRESETS[defaultDotShape as DotShape]
          : undefined;
      next = (preset ? { ...rest, defaultDotStyle: preset } : rest) as typeof next;
    } else {
      next = rest as typeof next;
    }
  }
  // The retired single `defaultDotStyle` is validated here and split into the
  // singleton/multi pair by bakeLineDotDefaults (runs immediately after); v18+
  // files carry the split fields directly, validated the same way.
  let out: Line = sanitizeLineDotStyleField(next, 'defaultDotStyle');
  out = sanitizeLineDotStyleField(out, 'singletonDotStyle');
  out = sanitizeLineDotStyleField(out, 'multiDotStyle');
  return out;
}

// Convert legacy `dotShape`/`defaultDotShape` preset ids (pre-v7 saves) to
// DotStyle objects, and validate any explicit style objects. Shared by
// `parse()` (file-import path) and the zustand persist `migrate` hook
// (localStorage rehydration path) so legacy values from BOTH entry points are
// converted before any consumer reads them.
export function convertLegacyDotShapes(
  stations: Record<string, Station>,
  lines: Record<string, Line>,
): { stations: Record<string, Station>; lines: Record<string, Line>; changed: boolean } {
  let changed = false;
  const nextLines: Record<string, Line> = {};
  for (const id of Object.keys(lines)) {
    const ln = lines[id];
    const cleaned = convertLineDotFields(ln);
    if (cleaned !== ln) changed = true;
    nextLines[id] = cleaned;
  }
  const nextStations: Record<string, Station> = {};
  for (const id of Object.keys(stations)) {
    const st = stations[id];
    let stopsChanged = false;
    const stops = st.stops.map((s) => {
      const cleaned = convertStopDotFields(s);
      if (cleaned !== s) stopsChanged = true;
      return cleaned;
    });
    if (stopsChanged) {
      changed = true;
      nextStations[id] = { ...st, stops };
    } else {
      nextStations[id] = st;
    }
  }
  return changed
    ? { stations: nextStations, lines: nextLines, changed }
    : { stations, lines, changed };
}

// Legacy `labelBold: boolean` → `labelWeight: TextLabelWeight`. Older docs
// only had a bold toggle (mapping to weight 700 when on, 400 when off);
// the schema now has a full weight scale and a separate per-station bold
// flag that bumps two steps heavier on top of the default.
//
// - If `labelWeight` is already present and valid, the legacy field is
//   stripped (writer knew about the new field — trust it).
// - Otherwise `labelBold` is translated and dropped.
function migrateLegacyLabelBold(raw: Record<string, unknown>): Record<string, unknown> {
  const hasLegacy = 'labelBold' in raw;
  const explicitWeight = raw.labelWeight;
  if (!hasLegacy) return raw;
  const { labelBold, ...rest } = raw;
  if (isLabelWeight(explicitWeight)) return rest;
  const translated: TextLabelWeight = labelBold === true ? 700 : 400;
  return { ...rest, labelWeight: translated };
}

// Normalize a hand-edited / legacy `width` to the canonical stored form the
// transforms maintain: integer ≥ LINE_WIDTH_MIN, and absent when it equals
// the default (the app never stores the default). Non-numbers and non-finite
// values are dropped. File-import hygiene only — localStorage rehydration
// never sees uncanonical widths because every write goes through
// `setLineWidth`'s clamp.
function sanitizeLineWidth(line: Line): Line {
  if (!('width' in line)) return line;
  const raw = line.width as unknown;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const stored = canonicalLineWidth(raw);
    if (stored !== undefined) {
      return stored === line.width ? line : { ...line, width: stored };
    }
  }
  const { width: _gone, ...rest } = line;
  return rest;
}

// Normalize a hand-edited `curveRadius` to the canonical stored form the
// transforms maintain: integer ≥ LINE_CURVE_RADIUS_MIN, and absent when it
// equals the default (the app never stores the default). Non-numbers and
// non-finite values are dropped. Same contract as `sanitizeLineWidth`.
function sanitizeLineCurve(line: Line): Line {
  if (!('curveRadius' in line)) return line;
  const raw = line.curveRadius as unknown;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const stored = canonicalLineCurveRadius(raw);
    if (stored !== undefined) {
      return stored === line.curveRadius ? line : { ...line, curveRadius: stored };
    }
  }
  const { curveRadius: _gone, ...rest } = line;
  return rest;
}

// Normalize one hand-edited / legacy split default-dot-size field to the
// canonical stored form the transforms maintain: integer ≥ DOT_SIZE_MIN, and
// absent when it equals the default (the app never stores the default).
// Non-numbers and non-finite values are dropped. File-import hygiene only —
// localStorage rehydration never sees uncanonical sizes because every write
// goes through the setters' clamp.
function sanitizeLineDotSizeField(line: Line, field: 'singletonDotSize' | 'multiDotSize'): Line {
  if (!(field in line)) return line;
  const raw = line[field] as unknown;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // Drop at the size this case's DEFAULT STYLE renders when untracked (12 for
    // a service-code disc, 8 otherwise) — mirrors setLineCaseDotSize, so an
    // exported service-code default of 8 re-imports as 8, not a dropped-to-12.
    // Requires the styles to be baked first (see the call site's ordering).
    const style =
      (field === 'singletonDotSize' ? line.singletonDotStyle : line.multiDotStyle) ??
      DEFAULT_DOT_STYLE;
    const stored = canonicalDotSize(raw, defaultDotDiameter(style));
    if (stored !== undefined) {
      return stored === line[field] ? line : { ...line, [field]: stored };
    }
  }
  const { [field]: _gone, ...rest } = line;
  return rest as Line;
}

function sanitizeLineDotSize(line: Line): Line {
  return sanitizeLineDotSizeField(
    sanitizeLineDotSizeField(line, 'singletonDotSize'),
    'multiDotSize',
  );
}

// Normalize hand-edited / legacy per-stop `dotSize` values to the canonical
// stored form `setDotSize` maintains: integer ≥ DOT_SIZE_MIN, and absent
// when it equals the line's EFFECTIVE default. Needs line context, so it
// runs after the per-line cleaning — the comparison must use sanitized
// line defaults. Non-numbers and non-finite values are dropped.
export function sanitizeStopDotSizes(
  stations: Record<string, Station>,
  lines: Record<string, Line>,
): { stations: Record<string, Station>; changed: boolean } {
  let changed = false;
  const next: Record<string, Station> = {};
  for (const sid of Object.keys(stations)) {
    const st = stations[sid];
    let stopsChanged = false;
    const stops = st.stops.map((s) => {
      if (!('dotSize' in s)) return s;
      const raw = s.dotSize as unknown;
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        // Effective default depends on whether this stop's station is a
        // singleton or shared — same split the renderer resolves — and, when
        // the line default is itself unset, on the stop STYLE's own default
        // diameter (12 for a service-code disc, 8 otherwise). Same rule as
        // setDotSize, so import and edit agree.
        const line = lines[s.lineId];
        const isSingleton = stationIsSingleton(st);
        const effDefault =
          (isSingleton ? line?.singletonDotSize : line?.multiDotSize) ??
          defaultDotDiameter(resolveDotStyle(line, s, isSingleton));
        const stored = canonicalDotSize(raw, effDefault);
        if (stored !== undefined) {
          if (stored === s.dotSize) return s;
          stopsChanged = true;
          return { ...s, dotSize: stored };
        }
      }
      stopsChanged = true;
      const { dotSize: _gone, ...rest } = s;
      return rest;
    });
    if (stopsChanged) {
      changed = true;
      next[sid] = { ...st, stops };
    } else {
      next[sid] = st;
    }
  }
  return { stations: next, changed };
}

// Normalize hand-edited / legacy casing fields to the canonical stored form
// the transforms maintain: strokeWidth on the quarter-unit (0.25) grid and ≥
// LINE_STROKE_WIDTH_MIN, strokeColor a lowercase string, and each field
// absent when it equals its default (the app never stores defaults).
// Non-numbers / non-finite widths and non-string colors are dropped.
// File-import hygiene only — localStorage rehydration never sees
// uncanonical values because every write goes through the setters'
// normalization.
function sanitizeLineStroke(line: Line): Line {
  let next = line;
  // Every numeric width field shares one contract — canonicalStrokeWidth
  // (casing grid/floor) + drop-at-0: strokeWidth is the casing rails,
  // dashLength/dashWidth the TfL-tick dims (0 / absent = derive from the line
  // width at render), interlineGap the packed spacing bump (0 / absent =
  // plain tangency). One loop keeps them from drifting apart.
  for (const field of ['strokeWidth', 'dashLength', 'dashWidth', 'interlineGap'] as const) {
    if (!(field in line)) continue;
    const raw = line[field] as unknown;
    const stored =
      typeof raw === 'number' && Number.isFinite(raw) ? canonicalStrokeWidth(raw) : undefined;
    if (stored === undefined) {
      const { [field]: _gone, ...rest } = next;
      next = rest;
    } else if (stored !== next[field]) {
      next = { ...next, [field]: stored };
    }
  }
  // labelGap has its OWN canonical (collapse at the default 3, keep 0), so it
  // sits outside the shared drop-at-0 loop above.
  if ('labelGap' in line) {
    const raw = line.labelGap as unknown;
    const stored =
      typeof raw === 'number' && Number.isFinite(raw) ? canonicalLineLabelGap(raw) : undefined;
    if (stored === undefined) {
      const { labelGap: _gone, ...rest } = next;
      next = rest;
    } else if (stored !== next.labelGap) {
      next = { ...next, labelGap: stored };
    }
  }
  if ('strokeColor' in line) {
    const raw = line.strokeColor as unknown;
    const stored = typeof raw === 'string' ? canonicalStrokeColor(raw) : undefined;
    if (stored === undefined) {
      const { strokeColor: _gone, ...rest } = next;
      next = rest;
    } else if (stored !== next.strokeColor) {
      next = { ...next, strokeColor: stored };
    }
  }
  return next;
}

// Strip the retired per-segment z-layer field from persisted lines. The
// layering rework replaced it with MapDoc.regionAssignments; docs saved by
// older builds still carry it. Reference-stable when no line has the field.
// Shared by migrateDoc's v15 gate; parse() strips inside sanitizeSegments.
export function stripLegacySegmentLayers(lines: Record<string, Line>): {
  lines: Record<string, Line>;
  changed: boolean;
} {
  let changed = false;
  const next: Record<string, Line> = {};
  for (const id of Object.keys(lines)) {
    const line = lines[id];
    if ('segmentLayers' in line) {
      const { segmentLayers: _retired, ...rest } = line as Line & { segmentLayers?: unknown };
      next[id] = rest;
      changed = true;
    } else {
      next[id] = line;
    }
  }
  return changed ? { lines: next, changed } : { lines, changed };
}

// Drop region assignments that can never bind again (dangling chosen/cover
// line ids) and anchors that are malformed or reference a dead line. Anchors
// whose pairKey is no longer among the line's edges are deliberately KEPT:
// reconcile's topology-translation step maps them across edge splits/heals,
// and the binding falls back to the assignment's other anchors meanwhile.
// File-only hygiene (parse) — the localStorage path never sees uncanonical
// values because every write goes through the store's own writers.
export function sanitizeRegionAssignments(
  assignments: Record<string, RegionAssignment>,
  lines: Record<string, Line>,
): { assignments: Record<string, RegionAssignment>; changed: boolean } {
  let changed = false;
  const next: Record<string, RegionAssignment> = {};
  for (const id of Object.keys(assignments)) {
    const a = assignments[id];
    if (!a || typeof a !== 'object' || !Array.isArray(a.lines) || !Array.isArray(a.anchors)) {
      changed = true;
      continue;
    }
    if (!lines[a.lineId] || !a.lines.every((l) => typeof l === 'string' && !!lines[l])) {
      changed = true;
      continue;
    }
    if (!a.lines.includes(a.lineId)) {
      changed = true;
      continue;
    }
    const anchors = a.anchors.filter(
      (anchor): anchor is RegionAnchor =>
        !!anchor &&
        typeof anchor === 'object' &&
        typeof anchor.pairKey === 'string' &&
        (anchor.anchorEnd === 'from' || anchor.anchorEnd === 'to') &&
        typeof anchor.distance === 'number' &&
        Number.isFinite(anchor.distance) &&
        anchor.distance >= 0 &&
        (anchor.side === undefined || Number.isFinite(anchor.side)) &&
        !!lines[anchor.lineId],
    );
    if (!anchors.length) {
      changed = true;
      continue;
    }
    let cleaned = anchors.length === a.anchors.length ? a : { ...a, anchors };
    if (cleaned.id !== id) cleaned = { ...cleaned, id };
    // A malformed arm choice strips to the merged-line winner; a string one
    // is kept even when it names no current edge — reconcile translates
    // pairKeys, same policy as the anchors above.
    if ('winnerPairKey' in cleaned && typeof cleaned.winnerPairKey !== 'string') {
      const { winnerPairKey: _bad, ...rest } = cleaned;
      cleaned = rest;
    }
    if (cleaned !== a) changed = true;
    next[id] = cleaned;
  }
  return changed ? { assignments: next, changed } : { assignments, changed };
}

// Normalize hand-edited / legacy per-transfer style overrides to the
// canonical stored form `updateTransferStyle` maintains: numeric fields
// rounded and floor-clamped, and every field absent when it equals the
// constant transfer default (the app never stores a redundant override).
// Non-numbers / non-finite numerics and non-string colors are dropped.
// File-import hygiene only — localStorage rehydration never sees uncanonical
// overrides because every write goes through `updateTransferStyle`.
export function sanitizeTransferStyles(transfers: Record<string, Transfer>): {
  transfers: Record<string, Transfer>;
  changed: boolean;
} {
  let changed = false;
  const next: Record<string, Transfer> = {};
  for (const id of Object.keys(transfers)) {
    const t = transfers[id];
    let cleaned = t;
    if ('thickness' in cleaned) {
      const raw = cleaned.thickness as unknown;
      const stored =
        typeof raw === 'number' && Number.isFinite(raw)
          ? canonicalTransferThickness(raw, TRANSFER_THICKNESS_DEFAULT)
          : undefined;
      cleaned = withTransferOverride(cleaned, 'thickness', stored);
    }
    if ('color' in cleaned) {
      const dn = sanitizeDayNightColor(cleaned.color);
      const stored =
        dn === undefined ? undefined : canonicalTransferColor(dn, TRANSFER_COLOR_DEFAULT);
      cleaned = withTransferOverride(cleaned, 'color', stored);
    }
    if ('strokeWidth' in cleaned) {
      const raw = cleaned.strokeWidth as unknown;
      const stored =
        typeof raw === 'number' && Number.isFinite(raw)
          ? canonicalTransferStrokeWidth(raw, TRANSFER_STROKE_WIDTH_DEFAULT)
          : undefined;
      cleaned = withTransferOverride(cleaned, 'strokeWidth', stored);
    }
    if ('strokeColor' in cleaned) {
      const dn = sanitizeDayNightColor(cleaned.strokeColor);
      const stored =
        dn === undefined ? undefined : canonicalTransferColor(dn, TRANSFER_STROKE_COLOR_DEFAULT);
      cleaned = withTransferOverride(cleaned, 'strokeColor', stored);
    }
    if ('draw' in cleaned) {
      // A value outside the ladder is dropped, not healed to 'under' by
      // storing it: absent IS 'under', so dropping says the same thing.
      const stored = isTransferDrawOrder(cleaned.draw)
        ? canonicalTransferDraw(cleaned.draw, TRANSFER_DRAW_DEFAULT)
        : undefined;
      cleaned = withTransferOverride(cleaned, 'draw', stored);
    }
    if (cleaned !== t) changed = true;
    next[id] = cleaned;
  }
  return { transfers: next, changed };
}

/**
 * One-time fold of the RETIRED doc-level transfer settings
 * (transferThickness/transferColor/transferStrokeWidth/transferStrokeColor)
 * into per-transfer overrides, so a pre-retirement save keeps every
 * transfer's exact look. For each transfer and field, the EFFECTIVE value
 * under the old model (valid override, else the legacy setting) is re-stored
 * canonically against the constant default — a transfer that tracked a
 * legacy setting gets it materialized as an override; a value equal to the
 * constant collapses away. The legacy fields are then dropped. Keyed off the
 * legacy fields' presence, so parse() runs it unconditionally (idempotent —
 * post-retirement saves lack the fields); the localStorage rehydrate gates
 * it at v<10. Garbage legacy values read as the constant default.
 *
 * The settings' MAP-WIDE role moves to the DESIGNATED default transfer style
 * (`styleDefaults.transfer` — repaired before the bake runs on both load
 * paths): when it still wears untouched factory props (backfilled for
 * pre-styles saves), it is seeded from the legacy settings too, so newly
 * drawn transfers keep dropping with the old map-wide look. A customized
 * default is left alone.
 */
export function bakeLegacyTransferSettings<
  T extends {
    transfers?: Record<string, Transfer>;
    styles?: Record<string, StyleDef>;
    styleDefaults?: Record<StyleKind, string>;
  },
>(doc: T): T {
  const raw = doc as Record<string, unknown>;
  const hasLegacy =
    'transferThickness' in raw ||
    'transferColor' in raw ||
    'transferStrokeWidth' in raw ||
    'transferStrokeColor' in raw;
  if (!hasLegacy) return doc;
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  // The retired settings were single colors; wrap each as a day/night color
  // (old colors are day colors, night matches). Fall back to the default's day
  // half when the field is absent/garbage.
  const legacy = {
    thickness: num(raw.transferThickness, TRANSFER_THICKNESS_DEFAULT),
    color: legacyColorToDayNight(
      typeof raw.transferColor === 'string' ? raw.transferColor : TRANSFER_COLOR_DEFAULT.day,
    ),
    strokeWidth: num(raw.transferStrokeWidth, TRANSFER_STROKE_WIDTH_DEFAULT),
    strokeColor: legacyColorToDayNight(
      typeof raw.transferStrokeColor === 'string'
        ? raw.transferStrokeColor
        : TRANSFER_STROKE_COLOR_DEFAULT.day,
    ),
    // There was never a doc-level draw setting — pre-retirement maps painted
    // every transfer beneath the dots, which is what 'under' spells.
    draw: TRANSFER_DRAW_DEFAULT,
  };
  const transfers: Record<string, Transfer> = {};
  for (const id of Object.keys(doc.transfers ?? {})) {
    const t = (doc.transfers as Record<string, Transfer>)[id];
    // Effective under the old model — a valid override wins, else the legacy
    // setting. Garbage override values fall back to the setting too (the same
    // outcome sanitizeTransferStyles would produce). A legacy string override
    // is wrapped to day/night; anything unparseable falls back via `??`.
    const effColor = sanitizeDayNightColor(t.color) ?? legacy.color;
    const effStrokeColor = sanitizeDayNightColor(t.strokeColor) ?? legacy.strokeColor;
    let next = t;
    next = withTransferOverride(
      next,
      'thickness',
      canonicalTransferThickness(num(t.thickness, legacy.thickness), TRANSFER_THICKNESS_DEFAULT),
    );
    next = withTransferOverride(
      next,
      'color',
      canonicalTransferColor(effColor, TRANSFER_COLOR_DEFAULT),
    );
    next = withTransferOverride(
      next,
      'strokeWidth',
      canonicalTransferStrokeWidth(
        num(t.strokeWidth, legacy.strokeWidth),
        TRANSFER_STROKE_WIDTH_DEFAULT,
      ),
    );
    next = withTransferOverride(
      next,
      'strokeColor',
      canonicalTransferColor(effStrokeColor, TRANSFER_STROKE_COLOR_DEFAULT),
    );
    transfers[id] = next;
  }
  // Seed the designated default transfer style from the legacy settings when
  // it still wears untouched factory props (concrete clamped values, no
  // collapse — style props are always concrete).
  let styles = doc.styles;
  const targetId = doc.styleDefaults?.transfer;
  const target = styles && targetId !== undefined ? styles[targetId] : undefined;
  if (styles && targetId !== undefined && target?.kind === 'transfer') {
    const factory = Object.values(DEFAULT_STYLES).find((d) => d.kind === 'transfer');
    if (factory && stylePropsEqual('transfer', target.props, factory.props)) {
      const seeded = canonicalStyleProps('transfer', legacy);
      if (!stylePropsEqual('transfer', seeded, target.props)) {
        styles = { ...styles, [targetId]: { ...target, props: seeded } };
      }
    }
  }
  const {
    transferThickness: _t,
    transferColor: _c,
    transferStrokeWidth: _w,
    transferStrokeColor: _s,
    ...rest
  } = raw;
  return {
    ...rest,
    ...(doc.transfers ? { transfers } : {}),
    ...(styles !== doc.styles ? { styles } : {}),
  } as T;
}

// Convert one transfer color from the legacy single-color STRING form to the
// day/night pair (old colors are day colors — night matches). Returns the same
// reference for an already-resolved day/night object, so callers stay
// reference-preserving and the conversion is idempotent. Absent stays absent.
function transferColorToDayNight(c: unknown): DayNightColor | undefined {
  if (typeof c === 'string') return legacyColorToDayNight(c);
  return c as DayNightColor | undefined;
}

/**
 * v12 → v13 for the localStorage rehydrate: convert transfer colors from the
 * legacy single-color STRING form to the day/night pair form, for BOTH
 * per-transfer overrides and transfer StyleDef props. Old app builds stored one
 * color that applied in both themes; each becomes `{day, night}` with both
 * halves set to it. Idempotent and reference-preserving — a value that is
 * already a day/night object (or an absent override) passes straight through,
 * so a converted doc is a no-op. The file-import path does the same conversion
 * inside its sanitizers (sanitizeTransferStyles / sanitizeStyleProps), so this
 * is the rehydrate-only counterpart (the rehydrate otherwise trusts app-written
 * data whose stored shape changed). Non-transfer styles are untouched.
 */
export function backfillTransferDayNightColors(
  transfers: Record<string, Transfer>,
  styles: Record<string, StyleDef>,
): { transfers: Record<string, Transfer>; styles: Record<string, StyleDef>; changed: boolean } {
  let changed = false;

  let nextTransfers = transfers;
  const outT: Record<string, Transfer> = {};
  let tChanged = false;
  for (const id of Object.keys(transfers)) {
    const t = transfers[id];
    // withTransferOverride keeps the same reference when unchanged and never
    // materializes an absent field, so a tracking transfer stays clean.
    let next = withTransferOverride(t, 'color', transferColorToDayNight(t.color));
    next = withTransferOverride(next, 'strokeColor', transferColorToDayNight(t.strokeColor));
    outT[id] = next;
    if (next !== t) tChanged = true;
  }
  if (tChanged) {
    nextTransfers = outT;
    changed = true;
  }

  let nextStyles = styles;
  const outS: Record<string, StyleDef> = {};
  let sChanged = false;
  for (const key of Object.keys(styles)) {
    const def = styles[key];
    if (def.kind === 'transfer') {
      const p = def.props;
      const color = transferColorToDayNight(p.color);
      const strokeColor = transferColorToDayNight(p.strokeColor);
      if (color !== p.color || strokeColor !== p.strokeColor) {
        // Style props are always concrete, so the conversions are defined.
        outS[key] = {
          ...def,
          props: { ...p, color: color as DayNightColor, strokeColor: strokeColor as DayNightColor },
        };
        sChanged = true;
        continue;
      }
    }
    outS[key] = def;
  }
  if (sChanged) {
    nextStyles = outS;
    changed = true;
  }

  return { transfers: nextTransfers, styles: nextStyles, changed };
}

/**
 * Fold the retired doc-level station-label font settings (labelFontSize/
 * labelWeight/labelItalic/labelLeading/labelTracking) into per-station
 * typography, mirroring `bakeLegacyTransferSettings`. For each station the
 * effective look under the OLD model is baked onto its own fields (with the
 * collapse-at-default rule), and the per-station `labelBold` (+2 weight step) /
 * `labelItalic` (OR) flags are consumed and dropped.
 *
 * The settings' MAP-WIDE role moves to the DESIGNATED default station style:
 * while it still wears untouched factory props (backfilled/injected by
 * `ensureStyleInvariants` before this runs), it is seeded from the legacy BASE
 * settings so newly dropped stations keep the old look — and any station whose
 * baked look matches it is TAGGED here, so default-looking stations stay on the
 * Default even on the styles-present load path (where the general
 * `adoptDefaultStyles` is gated off). Guarded by the presence of any legacy
 * field, so it never touches a post-retirement save (idempotent).
 */
export function bakeLegacyLabelSettings<
  T extends {
    stations?: Record<string, Station>;
    styles?: Record<string, StyleDef>;
    styleDefaults?: Record<StyleKind, string>;
  },
>(doc: T): T {
  const raw = doc as Record<string, unknown>;
  const hasLegacy =
    'labelFontSize' in raw ||
    'labelWeight' in raw ||
    'labelItalic' in raw ||
    'labelLeading' in raw ||
    'labelTracking' in raw;
  if (!hasLegacy) return doc;
  const num = (v: unknown, fb: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fb;
  const legacy: StationStyleProps = {
    fontSize: num(raw.labelFontSize, LABEL_FONT_SIZE_DEFAULT),
    weight: isLabelWeight(raw.labelWeight) ? raw.labelWeight : LABEL_WEIGHT_DEFAULT,
    italic: raw.labelItalic === true,
    leading: num(raw.labelLeading, LABEL_LEADING_DEFAULT),
    tracking: num(raw.labelTracking, LABEL_TRACKING_DEFAULT),
  };
  // Seed the designated default station style from the legacy BASE settings
  // (weight un-bumped) while it still wears untouched factory props.
  let styles = doc.styles;
  const targetId = doc.styleDefaults?.station;
  const target = styles && targetId !== undefined ? styles[targetId] : undefined;
  if (styles && targetId !== undefined && target?.kind === 'station') {
    const factory = DEFAULT_STYLES['default-station'];
    const seeded = canonicalStationLabelStyle(legacy);
    if (
      factory &&
      stylePropsEqual('station', target.props, factory.props) &&
      !stylePropsEqual('station', seeded, target.props)
    ) {
      styles = { ...styles, [targetId]: { ...target, props: seeded } };
    }
  }
  // The default style's post-seed props — the adoption target.
  const defaultId = target?.kind === 'station' ? targetId : undefined;
  const defaultProps =
    defaultId !== undefined ? (styles?.[defaultId] as StyleDef | undefined)?.props : undefined;
  const stations: Record<string, Station> = {};
  for (const id of Object.keys(doc.stations ?? {})) {
    const rawSt = (doc.stations as Record<string, Station>)[id] as unknown as Record<
      string,
      unknown
    >;
    const bold = rawSt.labelBold === true;
    const italicFlag = rawSt.labelItalic === true;
    const eff = canonicalStationLabelStyle({
      fontSize: legacy.fontSize,
      weight: bold ? bumpWeightByIndex(legacy.weight, 2) : legacy.weight,
      italic: legacy.italic || italicFlag,
      leading: legacy.leading,
      tracking: legacy.tracking,
    });
    // Strip the legacy flags and any prior typography/tag, then re-apply the
    // baked look with the collapse-at-default rule.
    const {
      labelBold: _b,
      labelItalic: _i,
      fontSize: _f,
      weight: _w,
      italic: _it,
      leading: _l,
      tracking: _tr,
      styleId: _sid,
      ...restSt
    } = rawSt;
    const next: Record<string, unknown> = { ...restSt };
    if (eff.fontSize !== STATION_LABEL_STYLE_DEFAULTS.fontSize) next.fontSize = eff.fontSize;
    if (eff.weight !== STATION_LABEL_STYLE_DEFAULTS.weight) next.weight = eff.weight;
    if (eff.italic !== STATION_LABEL_STYLE_DEFAULTS.italic) next.italic = eff.italic;
    if (eff.leading !== STATION_LABEL_STYLE_DEFAULTS.leading) next.leading = eff.leading;
    if (eff.tracking !== STATION_LABEL_STYLE_DEFAULTS.tracking) next.tracking = eff.tracking;
    if (defaultId !== undefined && defaultProps && stylePropsEqual('station', eff, defaultProps)) {
      next.styleId = defaultId;
    }
    stations[id] = next as unknown as Station;
  }
  const {
    labelFontSize: _1,
    labelWeight: _2,
    labelItalic: _3,
    labelLeading: _4,
    labelTracking: _5,
    ...rest
  } = raw;
  return {
    ...rest,
    ...(doc.stations ? { stations } : {}),
    ...(styles !== doc.styles ? { styles } : {}),
  } as T;
}

/**
 * v9 → v10 style-def hygiene for the localStorage rehydrate: docs persisted
 * by the round-1 Styles build carry textLabel defs with the since-dropped
 * width/leading/tracking keys. Rebuild every def through the canonical
 * grids — stripping stale keys, so the stylePropsEqual no-op guards work.
 * Kind coverage and the default designations are NOT this migration's job:
 * `ensureStyleInvariants` runs non-version-gated right after it.
 */
export function migrateV9Styles(styles: Record<string, StyleDef>): Record<string, StyleDef> {
  let changed = false;
  const next: Record<string, StyleDef> = {};
  for (const key of Object.keys(styles)) {
    const def = styles[key];
    const cleaned = {
      id: def.id,
      name: def.name,
      kind: def.kind,
      props: canonicalStyleProps(def.kind, def.props),
    } as StyleDef;
    // Same stringify-canonical check as sanitizeStyles: app-written defs have
    // fixed field order, so an already-clean def keeps its reference.
    if (JSON.stringify(def) === JSON.stringify(cleaned)) {
      next[key] = def;
    } else {
      next[key] = cleaned;
      changed = true;
    }
  }
  return changed ? next : styles;
}

/**
 * Enforce the three structural style invariants every loaded doc must satisfy
 * (see MapDoc): every kind has ≥ 1 style — kinds with none get their factory
 * Default injected — `styleDefaults` maps every kind to one of its
 * styles, and every line style's dot-TYPE ids name live stopDot styles. A
 * valid incoming designation is kept verbatim; a missing, dangling
 * or wrong-kind one is repaired to the kind's style named "Default" when one
 * exists (what pre-designation builds treated as the default), else its
 * first style in name order. Non-version-gated, like the active-palettes
 * invariant: shared by parse() and the localStorage rehydrate, and expected
 * to be a no-op on every doc this build has written. Assumes `styles` is
 * already sanitized (canonical defs, id === key).
 */
export function ensureStyleInvariants(
  styles: Record<string, StyleDef>,
  styleDefaults: unknown,
): {
  styles: Record<string, StyleDef>;
  styleDefaults: Record<StyleKind, string>;
  changed: boolean;
} {
  let changed = false;
  let nextStyles = styles;
  const raw =
    styleDefaults && typeof styleDefaults === 'object' && !Array.isArray(styleDefaults)
      ? (styleDefaults as Record<string, unknown>)
      : undefined;
  const nextDefaults = {} as Record<StyleKind, string>;
  for (const kind of KNOWN_STYLE_KINDS) {
    let ofKind = Object.values(nextStyles).filter((d) => d.kind === kind);
    if (ofKind.length === 0) {
      const factory = Object.values(DEFAULT_STYLES).find((d) => d.kind === kind)!;
      // The factory id is normally free (nothing of this kind exists), but a
      // hand-edited file could hold it for another kind — id === record key,
      // so probe for a free key rather than clobber.
      let key = factory.id;
      for (let n = 2; key in nextStyles; n++) key = `${factory.id}-${n}`;
      nextStyles = { ...nextStyles, [key]: { ...factory, id: key } as StyleDef };
      ofKind = [nextStyles[key]];
      changed = true;
    }
    const incoming = raw?.[kind];
    if (typeof incoming === 'string' && nextStyles[incoming]?.kind === kind) {
      nextDefaults[kind] = incoming;
    } else {
      const sorted = ofKind.slice().sort((a, b) => a.name.localeCompare(b.name));
      // stopDot styles carry readable names, not "Default"; prefer the factory
      // default id so the fallback lands on filled-black, not the name-first
      // "Dash". Harmless for other kinds (no non-stopDot style holds that id).
      nextDefaults[kind] = (
        sorted.find((d) => d.id === DEFAULT_STOP_DOT_STYLE_ID) ??
        sorted.find((d) => d.name === 'Default') ??
        sorted[0]
      ).id;
      changed = true;
    }
  }
  // Dot TYPE is a COVERED line-style field, so a line style def naming a stopDot
  // style the doc doesn't have is UNMATCHABLE: `stampStyle`'s dot setters no-op
  // on an id that doesn't resolve, so applying the style leaves the line tagged
  // over diverged values, and the next load's `pruneDanglingStyleRefs` strips
  // the tag — the style reads "Custom" again after every save/load and
  // re-picking it never sticks. Repoint at the designated default dot, the same
  // fallback a new line gets (`applyDefaultStopDotToLine`). Only a PRESENT id is
  // judged; an absent one is the pre-v20 shape `bakeLineStyleDotIds` owns.
  const resolvesToDot = (id: unknown): boolean =>
    typeof id === 'string' && nextStyles[id]?.kind === 'stopDot';
  for (const def of Object.values(nextStyles)) {
    if (def.kind !== 'line') continue;
    const props = def.props;
    const single = 'singletonDotStyleId' in props && !resolvesToDot(props.singletonDotStyleId);
    const multi = 'multiDotStyleId' in props && !resolvesToDot(props.multiDotStyleId);
    if (!single && !multi) continue;
    nextStyles = {
      ...nextStyles,
      [def.id]: {
        ...def,
        props: {
          ...props,
          ...(single ? { singletonDotStyleId: nextDefaults.stopDot } : {}),
          ...(multi ? { multiDotStyleId: nextDefaults.stopDot } : {}),
        },
      },
    };
    changed = true;
  }
  // Unknown extra keys in a hand-edited record are dropped by the rebuild —
  // flag the change even when all five real entries were valid.
  if (!changed && raw && Object.keys(raw).length !== KNOWN_STYLE_KINDS.size) changed = true;
  return {
    styles: nextStyles,
    styleDefaults: changed ? nextDefaults : (styleDefaults as Record<StyleKind, string>),
    changed,
  };
}

const KNOWN_STYLE_KINDS = new Set<StyleKind>([
  'line',
  'textLabel',
  'polygon',
  'routeBullet',
  'transfer',
  'station',
  'stopDot',
]);

const finiteNum = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const asString = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const asBool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);

// Validate one raw style-props value for `kind`. Wrong-typed or missing
// fields invalidate the whole def (all-or-nothing, mirroring
// sanitizeDotStyle); valid values then land on the canonical grids via the
// shared canonicalStyleProps, so a stamped item compares exactly equal to its
// style and the detach logic never misfires. Returns undefined when the value
// doesn't conform.
function sanitizeStyleProps(kind: StyleKind, raw: unknown): StyleDef['props'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  switch (kind) {
    case 'line': {
      // Dot TYPE (the stopDot library id per case) and dot SIZE are both covered.
      // A missing size is hand-edited garbage (app-written defs are canonical by
      // construction); a missing/garbage id heals to the stopDot ⭐ default via
      // canonicalStyleProps (the id can't be cross-checked against the styles map
      // here — a since-deleted one is untagged by pruneDanglingStyleRefs below).
      const singletonDotStyleId = asString(o.singletonDotStyleId) ?? DEFAULT_STOP_DOT_STYLE_ID;
      const multiDotStyleId = asString(o.multiDotStyleId) ?? DEFAULT_STOP_DOT_STYLE_ID;
      const singletonDotSize = finiteNum(o.singletonDotSize);
      const multiDotSize = finiteNum(o.multiDotSize);
      const width = finiteNum(o.width);
      const curveRadius = finiteNum(o.curveRadius);
      // Line end: 'square' for defs written before it was covered, and for a
      // hand-edited garbage value — it is the historical look, so healing to it
      // can never change how an older file paints.
      const endStyle = isLineEndStyle(o.endStyle) ? o.endStyle : LINE_END_STYLE_DEFAULT;
      const strokeWidth = finiteNum(o.strokeWidth);
      const strokeColor = asString(o.strokeColor);
      if (width === undefined) return undefined;
      if (singletonDotSize === undefined || multiDotSize === undefined) return undefined;
      if (curveRadius === undefined) return undefined;
      if (strokeWidth === undefined || strokeColor === undefined) return undefined;
      // dashLength / dashWidth / interlineGap / labelGap are OPTIONAL —
      // absent ⇒ derive / plain tangency / stock clearance; a malformed value
      // is dropped (treated as absent) rather than invalidating the whole
      // def. (Since-dropped keys — the retired seam trio among them — are
      // silently discarded by this rebuild.)
      const dashLength = finiteNum(o.dashLength);
      const dashWidth = finiteNum(o.dashWidth);
      const interlineGap = finiteNum(o.interlineGap);
      const labelGap = finiteNum(o.labelGap);
      // Passed straight through, undefined and all: `canonicalStyleProps`
      // rebuilds rather than spreading, so an optional that arrives undefined
      // comes back a missing key — see its test. Re-spelling the omission here
      // would be a second copy of a rule the funnel already owns, and one a
      // seventh optional field could be added to only one of.
      return canonicalStyleProps('line', {
        singletonDotStyleId,
        multiDotStyleId,
        singletonDotSize,
        multiDotSize,
        width,
        curveRadius,
        endStyle,
        strokeWidth,
        strokeColor,
        dashLength,
        dashWidth,
        interlineGap,
        labelGap,
      });
    }
    case 'stopDot': {
      // A stopDot style's props ARE a DotStyle — reuse the dot-style validator.
      const dot = sanitizeDotStyle(o);
      return dot === undefined ? undefined : canonicalStyleProps('stopDot', dot);
    }
    case 'textLabel': {
      const color = asString(o.color);
      const darkColor = asString(o.darkColor);
      const fontSize = finiteNum(o.fontSize);
      const italic = asBool(o.italic);
      if (color === undefined || darkColor === undefined || fontSize === undefined)
        return undefined;
      if (!isLabelWeight(o.weight) || italic === undefined) return undefined;
      if (!isTextLabelAlign(o.align)) return undefined;
      // Since-dropped keys from older saves (width/leading/tracking) are
      // silently discarded by this rebuild.
      return canonicalStyleProps('textLabel', {
        color,
        darkColor,
        fontSize,
        weight: o.weight,
        italic,
        align: o.align as TextLabelAlign,
      });
    }
    case 'polygon': {
      const fill = asString(o.fill);
      const stroke = asString(o.stroke);
      const darkFill = asString(o.darkFill);
      const darkStroke = asString(o.darkStroke);
      const strokeWidth = finiteNum(o.strokeWidth);
      const curveRadius = finiteNum(o.curveRadius);
      const closed = asBool(o.closed);
      if (fill === undefined || stroke === undefined) return undefined;
      if (darkFill === undefined || darkStroke === undefined) return undefined;
      if (strokeWidth === undefined || curveRadius === undefined || closed === undefined)
        return undefined;
      return canonicalStyleProps('polygon', {
        fill,
        stroke,
        darkFill,
        darkStroke,
        strokeWidth,
        curveRadius,
        closed,
      });
    }
    case 'routeBullet': {
      const size = finiteNum(o.size);
      if (!isRouteBulletShape(o.shape)) return undefined;
      if (size === undefined) return undefined;
      return canonicalStyleProps('routeBullet', { shape: o.shape, size });
    }
    case 'transfer': {
      const thickness = finiteNum(o.thickness);
      const color = sanitizeDayNightColor(o.color);
      const strokeWidth = finiteNum(o.strokeWidth);
      const strokeColor = sanitizeDayNightColor(o.strokeColor);
      if (thickness === undefined || color === undefined) return undefined;
      if (strokeWidth === undefined || strokeColor === undefined) return undefined;
      // The draw rung post-dates the other four, so a missing or out-of-ladder
      // value heals to 'under' rather than invalidating the whole def (same
      // treatment as DotStyle's strokeAlign).
      const draw = isTransferDrawOrder(o.draw) ? o.draw : TRANSFER_DRAW_DEFAULT;
      return canonicalStyleProps('transfer', { thickness, color, strokeWidth, strokeColor, draw });
    }
    case 'station': {
      // All five typography fields are required in a style def (concrete, even
      // for leading/tracking which are optional on the item).
      const fontSize = finiteNum(o.fontSize);
      const italic = asBool(o.italic);
      const leading = finiteNum(o.leading);
      const tracking = finiteNum(o.tracking);
      if (fontSize === undefined || italic === undefined) return undefined;
      if (leading === undefined || tracking === undefined) return undefined;
      if (!isLabelWeight(o.weight)) return undefined;
      return canonicalStyleProps('station', {
        fontSize,
        weight: o.weight,
        italic,
        leading,
        tracking,
      });
    }
  }
}

// Validate + normalize hand-edited / legacy style defs: drop defs with an
// unknown kind, an empty trimmed name, malformed props, or a same-kind name
// duplicate (first wins — upsert-by-name assumes per-kind uniqueness), and
// rewrite each def's id to its record key. File-import hygiene only —
// app-written styles are canonical by construction (saveStyleFromItem captures
// through the same clamps).
export function sanitizeStyles(styles: Record<string, StyleDef>): {
  styles: Record<string, StyleDef>;
  changed: boolean;
} {
  if (!styles || typeof styles !== 'object' || Array.isArray(styles)) {
    return { styles: {}, changed: true };
  }
  let changed = false;
  const next: Record<string, StyleDef> = {};
  const seenNames = new Set<string>();
  for (const key of Object.keys(styles)) {
    const raw = styles[key] as unknown;
    if (!raw || typeof raw !== 'object') {
      changed = true;
      continue;
    }
    const o = raw as Record<string, unknown>;
    const kind =
      typeof o.kind === 'string' && KNOWN_STYLE_KINDS.has(o.kind as StyleKind)
        ? (o.kind as StyleKind)
        : undefined;
    const name = typeof o.name === 'string' ? o.name.trim() : '';
    if (kind === undefined || !name || isReservedStyleName(name)) {
      changed = true;
      continue;
    }
    const nameKey = `${kind}\n${name}`;
    if (seenNames.has(nameKey)) {
      changed = true;
      continue;
    }
    const props = sanitizeStyleProps(kind, o.props);
    if (props === undefined) {
      changed = true;
      continue;
    }
    seenNames.add(nameKey);
    const cleaned = { id: key, name, kind, props } as StyleDef;
    // Keep the original reference when already canonical (stringify compare,
    // mirrors isCanonicalDotStyle — field order is fixed everywhere the app
    // writes defs).
    if (JSON.stringify(o) === JSON.stringify(cleaned)) {
      next[key] = styles[key];
    } else {
      next[key] = cleaned;
      changed = true;
    }
  }
  return { styles: next, changed };
}

// Strip every `styleId` tag that doesn't uphold the tagged ⇒ matches
// invariant: dangling ids (the def was dropped or never shipped with the
// file), wrong-kind ids, AND tags whose item values no longer equal the
// style's props — only a hand-edited file can carry the last kind, and
// loading it verbatim would show a style name over diverged values. Values
// are kept in every case, same outcome as deleting a style. Runs LAST in
// parse() so it compares the fully-sanitized items against the fully-
// sanitized defs. Returns the same doc reference when nothing changed.
export function pruneDanglingStyleRefs(doc: MapDoc): MapDoc {
  function pruneColl<T extends { styleId?: string }>(
    coll: Record<string, T>,
    kind: StyleKind,
  ): Record<string, T> {
    let changed = false;
    const next: Record<string, T> = {};
    for (const id of Object.keys(coll)) {
      const item = coll[id];
      const def = typeof item.styleId === 'string' ? doc.styles[item.styleId] : undefined;
      const props = def?.kind === kind ? captureStyleProps(doc, kind, id) : null;
      const keep = def !== undefined && props !== null && stylePropsEqual(kind, props, def.props);
      if (item.styleId !== undefined && !keep) {
        const { styleId: _gone, ...rest } = item;
        next[id] = rest as T;
        changed = true;
      } else {
        next[id] = item;
      }
    }
    return changed ? next : coll;
  }
  const lines = pruneColl(doc.lines, 'line');
  const textLabels = pruneColl(doc.textLabels, 'textLabel');
  const polygons = pruneColl(doc.polygons, 'polygon');
  const routeBullets = pruneColl(doc.routeBullets, 'routeBullet');
  const transfers = pruneColl(doc.transfers, 'transfer');
  const stations = pruneColl(doc.stations, 'station');
  if (
    lines === doc.lines &&
    textLabels === doc.textLabels &&
    polygons === doc.polygons &&
    routeBullets === doc.routeBullets &&
    transfers === doc.transfers &&
    stations === doc.stations
  ) {
    return doc;
  }
  return { ...doc, lines, textLabels, polygons, routeBullets, transfers, stations };
}

// Backfill `edges` for a line saved before the field existed: derive the edge
// set from the legacy linear `stations` order. Same reference when `edges` is
// already present (canonical new saves), matching the file-only per-line
// sanitizer convention (callers detect a change by identity).
export function backfillLineEdges(line: Line): Line {
  if (Array.isArray(line.edges)) return line;
  return { ...line, edges: edgesFromStations(line.stations) };
}

// Dict-level backfill shared with the localStorage rehydration path
// (migrateDoc). `changed` is the signal migrate uses to decide whether to
// re-spread the field. Parse uses the per-line `backfillLineEdges` in its own
// cleaning loop instead.
export function backfillLinesEdges(lines: Record<string, Line>): {
  lines: Record<string, Line>;
  changed: boolean;
} {
  let changed = false;
  const out: Record<string, Line> = {};
  for (const id of Object.keys(lines)) {
    const next = backfillLineEdges(lines[id]);
    if (next !== lines[id]) changed = true;
    out[id] = next;
  }
  return { lines: changed ? out : lines, changed };
}

// ---------- Import hardening: shape gate + referential repairs ----------
//
// A generated or hand-edited file can violate structure the app maintains by
// construction. The split of responsibilities:
//   - `docShapeError` (type-c): map SUBSTANCE of the wrong shape refuses to
//     load, with a message naming the entity.
//   - `repairCoreShapes` (type b): ABSENT per-entity substance fills with its
//     default, the same defaulting-by-merge rule the top-level fields follow.
//   - `sanitizeLineTopology` / `repairLineLinkages` / `sanitizeDocReferences`
//     (type b): references that cannot be honoured are dropped or rebuilt from
//     the redundant encodings the file itself carries — never guessed.
// All file-import-only; the localStorage rehydrate keeps its own disjoint,
// version-gated path (its only writer is the app).

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const finiteField = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v);

// The keyed record collections a doc may carry. `palettes` and `styles` are
// deliberately absent: sanitizePalettes and sanitizeStyles have always healed
// a malformed value ([] and the factory set respectively), and that behavior
// is pinned.
const RECORD_COLLECTIONS = [
  'stations',
  'lines',
  'lineTags',
  'routeBullets',
  'transferAnchors',
  'transfers',
  'textLabels',
  'polygons',
  'regionAssignments',
  'svgImages',
  'lineCircles',
] as const;

/**
 * Type-c gate over the RAW doc: substance that is PRESENT but of the wrong
 * shape refuses the whole file — silently dropping a station or inventing a
 * coordinate would hand back a plausible-looking map missing content, the
 * exact failure this gate exists to prevent. Absent fields are not judged
 * here (they heal — see repairCoreShapes; a sparse legacy stop without cells
 * heals to the origin cell); dangling references are not judged either (they
 * drop or rebuild — see repairLineLinkages).
 */
function docShapeError(doc: Record<string, unknown>): string | null {
  for (const field of RECORD_COLLECTIONS) {
    if (field in doc && !isRecord(doc[field])) return `\`${field}\` is not a keyed record`;
  }
  for (const field of ['lineOrder', 'backgroundOrder'] as const) {
    if (field in doc && !Array.isArray(doc[field])) return `\`${field}\` is not an array`;
  }
  if (isRecord(doc.stations)) {
    for (const id of Object.keys(doc.stations)) {
      const st = doc.stations[id];
      if (!isRecord(st)) return `station "${id}" is not an object`;
      if (!finiteField(st.x)) return `station "${id}": x is not a finite number`;
      if (!finiteField(st.y)) return `station "${id}": y is not a finite number`;
      if ('name' in st && typeof st.name !== 'string')
        return `station "${id}": name is not a string`;
      if ('rotation' in st && !finiteField(st.rotation))
        return `station "${id}": rotation is not a finite number`;
      if ('stops' in st) {
        if (!Array.isArray(st.stops)) return `station "${id}": stops is not an array`;
        for (const stop of st.stops) {
          if (!isRecord(stop)) return `station "${id}": a stop entry is not an object`;
          for (const f of ['row', 'col'] as const) {
            if (f in stop && !finiteField(stop[f]))
              return `station "${id}": a stop ${f} is not a finite number`;
          }
        }
      }
      if ('label' in st) {
        if (!isRecord(st.label)) return `station "${id}": label is not an object`;
        for (const f of ['row', 'col', 'rotation', 'offset'] as const) {
          if (f in st.label && !finiteField(st.label[f]))
            return `station "${id}": label ${f} is not a finite number`;
        }
      }
    }
  }
  if (isRecord(doc.lines)) {
    for (const id of Object.keys(doc.lines)) {
      const ln = doc.lines[id];
      if (!isRecord(ln)) return `line "${id}" is not an object`;
      if ('service' in ln && typeof ln.service !== 'string')
        return `line "${id}": service is not a string`;
      if ('color' in ln && typeof ln.color !== 'string')
        return `line "${id}": color is not a string`;
      if ('stations' in ln && !Array.isArray(ln.stations))
        return `line "${id}": stations is not an array`;
      if ('edges' in ln && !Array.isArray(ln.edges)) return `line "${id}": edges is not an array`;
    }
  }
  return null;
}

// The plain pre-wand label every legacy save carried — the heal target for a
// station that arrives without one (turning the wand ON for it would change
// how the file renders).
const PLAIN_LABEL: LabelCell = {
  row: 0,
  col: -1,
  rotation: 0,
  offset: 0,
  align: 'auto',
  valign: 'auto-down',
};

// Snap a (gate-guaranteed finite) rotation onto the legal octant ring.
const asOctant = (v: unknown): Rotation => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0;
  return rot8(n) as Rotation;
};

/**
 * Fill ABSENT per-entity substance with its default — the per-entity twin of
 * the `{...DEFAULT_DOC, ...doc}` merge, which only reaches top-level fields.
 * Wrong-typed values never get here (docShapeError refused the file), so this
 * pass only materializes what a sparse hand-written entity left out. Rotations
 * additionally snap onto the octant ring (a finite 45 means nothing to the
 * 8-step frame; `%8` at least keeps it deterministic).
 */
function repairCoreShapes(doc: MapDoc): MapDoc {
  let changed = false;

  const stations: Record<string, Station> = {};
  for (const id of Object.keys(doc.stations)) {
    const st = doc.stations[id] as Station & { label?: LabelCell };
    const rotation = asOctant(st.rotation);
    const label = st.label === undefined ? PLAIN_LABEL : { ...PLAIN_LABEL, ...st.label };
    const labelRotation = asOctant(label.rotation);
    const needsLabel =
      st.label === undefined ||
      labelRotation !== st.label.rotation ||
      Object.keys(PLAIN_LABEL).some((f) => !(f in st.label!));
    // A sparse legacy stop may omit its cell; it heals to the origin
    // (orientation is sanitizeStations' job — its migrate already reads
    // undefined as 'auto-vertical').
    const needsStops =
      st.stops === undefined || st.stops.some((c) => c.row === undefined || c.col === undefined);
    if (typeof st.name === 'string' && rotation === st.rotation && !needsStops && !needsLabel) {
      stations[id] = st;
      continue;
    }
    changed = true;
    stations[id] = {
      ...st,
      name: typeof st.name === 'string' ? st.name : '',
      rotation,
      stops: needsStops
        ? (st.stops ?? []).map((c) =>
            c.row === undefined || c.col === undefined
              ? { ...c, row: c.row ?? 0, col: c.col ?? 0 }
              : c,
          )
        : st.stops,
      label: needsLabel ? { ...label, rotation: labelRotation } : st.label!,
    };
  }

  const lines: Record<string, Line> = {};
  for (const id of Object.keys(doc.lines)) {
    const ln = doc.lines[id];
    if (typeof ln.service === 'string' && typeof ln.color === 'string' && ln.stations) {
      lines[id] = ln;
      continue;
    }
    changed = true;
    lines[id] = {
      ...ln,
      // A missing service reads best as the line's own key ("T" stays "T").
      service: typeof ln.service === 'string' ? ln.service : id,
      color: typeof ln.color === 'string' ? ln.color : FALLBACK_LINE_COLOR,
      stations: ln.stations ?? [],
    };
  }

  return changed ? { ...doc, stations, lines } : doc;
}

/**
 * Canonicalize one line's OWN topology fields from a hand-written file: edge
 * entries that aren't strings or don't split into two non-empty sides are
 * dropped, keys rewrite to canonical `pairKeyOf` order, self-loops and
 * duplicates collapse — and `segmentStyles` keys ride the same rewrites
 * (first writer wins on a collision), so a style keyed "b|a" survives where
 * sanitizeSegments (right after this in the chain) would have dropped it as a
 * non-adjacency. Membership entries that aren't strings drop and duplicates
 * collapse, order kept. Endpoint LIVENESS is cross-collection and belongs to
 * repairLineLinkages, not here. Same reference on a no-op, like every sibling
 * in the per-line clean.
 */
function sanitizeLineTopology(line: Line): Line {
  const members: StationId[] = [];
  const seenMembers = new Set<StationId>();
  let membersChanged = false;
  for (const s of line.stations) {
    if (typeof s !== 'string' || seenMembers.has(s)) {
      membersChanged = true;
      continue;
    }
    seenMembers.add(s);
    members.push(s);
  }

  const edges: string[] = [];
  const seenEdges = new Set<string>();
  const renames = new Map<string, string>();
  let edgesChanged = false;
  for (const e of line.edges) {
    if (typeof e !== 'string') {
      edgesChanged = true;
      continue;
    }
    const i = e.indexOf('|');
    if (i <= 0 || i >= e.length - 1) {
      edgesChanged = true;
      continue;
    }
    const a = e.slice(0, i);
    const b = e.slice(i + 1);
    if (a === b) {
      edgesChanged = true;
      continue;
    }
    const key = pairKeyOf(a, b);
    if (key !== e) {
      renames.set(e, key);
      edgesChanged = true;
    }
    if (seenEdges.has(key)) {
      edgesChanged = true;
      continue;
    }
    seenEdges.add(key);
    edges.push(key);
  }

  let segmentStyles = line.segmentStyles;
  if (segmentStyles && renames.size > 0) {
    const next: Record<string, LineStyle> = {};
    for (const k of Object.keys(segmentStyles)) {
      const nk = renames.get(k) ?? k;
      if (!(nk in next)) next[nk] = segmentStyles[k];
    }
    segmentStyles = next;
  }

  if (!membersChanged && !edgesChanged && segmentStyles === line.segmentStyles) return line;
  return {
    ...line,
    ...(membersChanged ? { stations: members } : {}),
    ...(edgesChanged ? { edges } : {}),
    ...(segmentStyles !== line.segmentStyles ? { segmentStyles } : {}),
  };
}

/**
 * Cross-collection closure over the three encodings of "line L serves station
 * S" — membership (`Line.stations`), the stop cell (`Station.stops`), and
 * edge incidence (`Line.edges`). App writers keep the three in step; a
 * generated file routinely doesn't. The motivating case: every line carrying
 * a full `edges` set but `stations: []` — bands render off edges while every
 * editor works off membership, so the map was renderable but not editable.
 * Repairs, in order:
 *   1. stops naming a line that doesn't exist drop, as do duplicate same-line
 *      stops (first wins);
 *   2. membership entries naming a dead station drop, and edges with a dead
 *      endpoint drop with them;
 *   3. membership rebuilds as its closure: surviving order first, then every
 *      edge endpoint and stop-bearing station not yet a member (a degree-0
 *      member is legal — deleteLine leaves stopless stations behind — so a
 *      stop is membership evidence in its own right);
 *   4. every member station missing a stop for the line gets one synthesized
 *      at the origin cell with the production defaults — membership without a
 *      stop cell has no dot and nothing for the packer to place. A collision
 *      with another stop at (0,0) is cosmetic and editable; a missing stop is
 *      not.
 * Silent by design: every repair reconstructs from redundant data the file
 * itself carries, never a guess.
 */
function repairLineLinkages(
  stationsIn: Record<string, Station>,
  linesIn: Record<string, Line>,
): { stations: Record<string, Station>; lines: Record<string, Line>; changed: boolean } {
  let changed = false;

  const stations: Record<string, Station> = {};
  for (const sid of Object.keys(stationsIn)) {
    const st = stationsIn[sid];
    const seen = new Set<LineId>();
    const stops = st.stops.filter((c) => {
      const keep = typeof c.lineId === 'string' && !!linesIn[c.lineId] && !seen.has(c.lineId);
      if (keep) seen.add(c.lineId);
      return keep;
    });
    if (stops.length !== st.stops.length) {
      changed = true;
      stations[sid] = { ...st, stops };
    } else {
      stations[sid] = st;
    }
  }

  // lineId → stop-bearing stations, in station iteration order.
  const stopBearers = new Map<LineId, StationId[]>();
  for (const sid of Object.keys(stations)) {
    for (const c of stations[sid].stops) {
      const arr = stopBearers.get(c.lineId);
      if (arr) arr.push(sid);
      else stopBearers.set(c.lineId, [sid]);
    }
  }

  const lines: Record<string, Line> = {};
  for (const lid of Object.keys(linesIn)) {
    const ln = linesIn[lid];
    const edges = ln.edges.filter((e) => {
      const [a, b] = edgeEndpoints(e);
      return !!stations[a] && !!stations[b];
    });

    const members: StationId[] = [];
    const seen = new Set<StationId>();
    const admit = (sid: StationId) => {
      if (!seen.has(sid) && stations[sid]) {
        seen.add(sid);
        members.push(sid);
      }
    };
    for (const s of ln.stations) admit(s);
    for (const e of edges) {
      const [a, b] = edgeEndpoints(e);
      admit(a);
      admit(b);
    }
    for (const s of stopBearers.get(lid) ?? []) admit(s);

    const sameMembers =
      members.length === ln.stations.length && members.every((m, i) => m === ln.stations[i]);
    if (edges.length === ln.edges.length && sameMembers) {
      lines[lid] = ln;
    } else {
      changed = true;
      lines[lid] = {
        ...ln,
        ...(sameMembers ? {} : { stations: members }),
        ...(edges.length === ln.edges.length ? {} : { edges }),
      };
    }

    for (const sid of members) {
      const st = stations[sid];
      if (!st.stops.some((c) => c.lineId === lid)) {
        changed = true;
        stations[sid] = {
          ...st,
          stops: [...st.stops, { lineId: lid, row: 0, col: 0, orientation: 'auto-vertical' }],
        };
      }
    }
  }

  return { stations, lines, changed };
}

// Rewrite each record entry's `id` to its key — the key IS the identity every
// reference resolves through, so a divergent inner id is always the wrong one.
// Same precedent as sanitizeStyles / sanitizeRegionAssignments. A non-object
// entry (a decoration collection can carry `null` or a bare string from a
// hand-written file) passes through untouched: each collection's own filter
// below drops it — reading `.id` here would throw the whole file into parse's
// catch-all instead.
function withIdsFromKeys<T extends { id: string }>(coll: Record<string, T>): Record<string, T> {
  let changed = false;
  const next: Record<string, T> = {};
  for (const key of Object.keys(coll)) {
    const item = coll[key];
    if (isRecord(item) && item.id !== key) {
      next[key] = { ...item, id: key };
      changed = true;
    } else {
      next[key] = item;
    }
  }
  return changed ? next : coll;
}

/**
 * The doc-wide reference sweep (type b throughout): inner ids rewrite to their
 * record keys; the two paint orders reconcile against their records; and every
 * decoration whose references or required numbers cannot be honoured drops —
 * the same repair sanitizeRegionAssignments and sanitizeImageHrefs have always
 * made, extended to the collections that had no load-time hygiene at all
 * (lineTags, transfers, routeBullets, textLabels, polygons, svgImages, free
 * transfer anchors). A route bullet's dead line is the one healable reference
 * (`lineId: null` is its legitimate "unset" state); a transfer end's dead
 * line heals to null the same way. Runs AFTER repairLineLinkages so liveness
 * is judged against the repaired stations/lines.
 */
function sanitizeDocReferences(doc: MapDoc): MapDoc {
  let changed = false;
  const out = { ...doc };

  // Inner ids ← record keys, across every id-carrying collection.
  const sweep = (field: keyof MapDoc) => {
    const coll = out[field] as unknown as Record<string, { id: string }>;
    const next = withIdsFromKeys(coll);
    if (next !== coll) {
      (out as unknown as Record<string, unknown>)[field] = next;
      changed = true;
    }
  };
  sweep('stations');
  sweep('lines');
  sweep('lineTags');
  sweep('routeBullets');
  sweep('transferAnchors');
  sweep('transfers');
  sweep('textLabels');
  sweep('polygons');
  sweep('svgImages');
  sweep('lineCircles');

  // Free transfer anchors: a bare {id, x, y} — drop on a non-finite point.
  // Before transfers, which judge anchor liveness against the survivors.
  {
    const next: Record<string, TransferAnchor> = {};
    let dropped = false;
    for (const id of Object.keys(out.transferAnchors)) {
      const a = out.transferAnchors[id];
      if (isRecord(a) && finiteField(a.x) && finiteField(a.y)) next[id] = a;
      else dropped = true;
    }
    if (dropped) {
      out.transferAnchors = next;
      changed = true;
    }
  }

  // Line circles: entry must be an object; value hygiene (finite center/radius)
  // stays with sanitizeLineCircles, which runs later and drops those itself.
  {
    const next: Record<string, LineCircle> = {};
    let dropped = false;
    for (const id of Object.keys(out.lineCircles)) {
      const c = out.lineCircles[id];
      if (isRecord(c)) next[id] = c;
      else dropped = true;
    }
    if (dropped) {
      out.lineCircles = next;
      changed = true;
    }
  }

  // Line tags: need a live line and a real edge to sit on. Stored endpoints
  // canonicalize (from < to always) — a swap flips anchorEnd so the tag keeps
  // measuring from the same physical station.
  {
    const next: Record<string, LineTag> = {};
    let tagsChanged = false;
    for (const id of Object.keys(out.lineTags)) {
      const t = out.lineTags[id];
      if (
        !isRecord(t) ||
        typeof t.lineId !== 'string' ||
        typeof t.fromStationId !== 'string' ||
        typeof t.toStationId !== 'string' ||
        !finiteField(t.distance) ||
        !out.lines[t.lineId]
      ) {
        tagsChanged = true;
        continue;
      }
      const swap = t.fromStationId > t.toStationId;
      const from = swap ? t.toStationId : t.fromStationId;
      const to = swap ? t.fromStationId : t.toStationId;
      if (!out.lines[t.lineId].edges.includes(pairKeyOf(from, to))) {
        tagsChanged = true;
        continue;
      }
      const orientation = (
        t.orientation === 1 || t.orientation === 2 || t.orientation === 3 ? t.orientation : 0
      ) as LineTag['orientation'];
      const kind = t.kind === 'chevron' || t.kind === 'text' ? t.kind : undefined;
      if (!swap && orientation === t.orientation && kind === t.kind) {
        next[id] = t;
        continue;
      }
      tagsChanged = true;
      next[id] = {
        ...t,
        fromStationId: from,
        toStationId: to,
        anchorEnd: swap ? (t.anchorEnd === 'from' ? 'to' : 'from') : t.anchorEnd,
        orientation,
        ...(kind === undefined ? {} : { kind }),
      };
      if (kind === undefined) delete (next[id] as { kind?: unknown }).kind;
    }
    if (tagsChanged) {
      out.lineTags = next;
      changed = true;
    }
  }

  // Transfers: both ends must resolve. A dead non-null lineId on a stop end
  // heals to null (the end's own "no specific line" state); everything else
  // dangling drops the transfer, matching the app's cascade-delete.
  {
    const next: Record<string, Transfer> = {};
    let transfersChanged = false;
    const healEnd = (end: unknown): TransferEnd | null => {
      if (!isRecord(end)) return null;
      if ('stationId' in end) {
        if (typeof end.stationId !== 'string' || !out.stations[end.stationId]) return null;
        if ('anchorId' in end) {
          const hosted = out.stations[end.stationId].transferAnchors;
          return typeof end.anchorId === 'string' && hosted?.some((a) => a.id === end.anchorId)
            ? (end as TransferEnd)
            : null;
        }
        const lineId = end.lineId;
        if (lineId === null || (typeof lineId === 'string' && out.lines[lineId])) {
          return end as TransferEnd;
        }
        return { stationId: end.stationId, lineId: null };
      }
      if ('anchorId' in end) {
        return typeof end.anchorId === 'string' && out.transferAnchors[end.anchorId]
          ? (end as TransferEnd)
          : null;
      }
      return null;
    };
    for (const id of Object.keys(out.transfers)) {
      const t = out.transfers[id];
      if (!isRecord(t)) {
        transfersChanged = true;
        continue;
      }
      const a = healEnd(t.a);
      const b = healEnd(t.b);
      if (a === null || b === null) {
        transfersChanged = true;
        continue;
      }
      if (a === t.a && b === t.b) {
        next[id] = t;
      } else {
        transfersChanged = true;
        next[id] = { ...t, a, b };
      }
    }
    if (transfersChanged) {
      out.transfers = next;
      changed = true;
    }
  }

  // Route bullets: a dead line heals to null (the placeholder state); a
  // non-finite position or size drops the bullet; an unknown shape heals to
  // the circle default.
  {
    const next: Record<string, RouteBullet> = {};
    let bulletsChanged = false;
    for (const id of Object.keys(out.routeBullets)) {
      const b = out.routeBullets[id];
      if (!isRecord(b) || !finiteField(b.x) || !finiteField(b.y) || !finiteField(b.size)) {
        bulletsChanged = true;
        continue;
      }
      const lineId = typeof b.lineId === 'string' && out.lines[b.lineId] ? b.lineId : null;
      const shape =
        b.shape === 'circle' || b.shape === 'square' || b.shape === 'diamond' ? b.shape : 'circle';
      const rotation = asOctant(b.rotation);
      if (lineId === b.lineId && shape === b.shape && rotation === b.rotation) {
        next[id] = b;
      } else {
        bulletsChanged = true;
        next[id] = { ...b, lineId, shape, rotation };
      }
    }
    if (bulletsChanged) {
      out.routeBullets = next;
      changed = true;
    }
  }

  // Text labels: position, size and text are the label's substance — no
  // faithful repair exists, so a bad one drops (decoration, not map content).
  {
    const next: Record<string, TextLabel> = {};
    let labelsChanged = false;
    for (const id of Object.keys(out.textLabels)) {
      const g = out.textLabels[id];
      if (
        !isRecord(g) ||
        !finiteField(g.x) ||
        !finiteField(g.y) ||
        !finiteField(g.fontSize) ||
        typeof g.text !== 'string'
      ) {
        labelsChanged = true;
        continue;
      }
      const rotation = asOctant(g.rotation);
      if (rotation === g.rotation) {
        next[id] = g;
      } else {
        labelsChanged = true;
        next[id] = { ...g, rotation };
      }
    }
    if (labelsChanged) {
      out.textLabels = next;
      changed = true;
    }
  }

  // Polygons: at least two finite vertices and real color strings, or the
  // shape drops; a non-finite strokeWidth heals to 0.
  {
    const next: Record<string, Polygon> = {};
    let polysChanged = false;
    for (const id of Object.keys(out.polygons)) {
      const p = out.polygons[id];
      const verticesOk =
        isRecord(p) &&
        Array.isArray(p.vertices) &&
        p.vertices.length >= 2 &&
        p.vertices.every((v) => isRecord(v) && finiteField(v.x) && finiteField(v.y));
      if (!verticesOk || typeof p.fill !== 'string' || typeof p.stroke !== 'string') {
        polysChanged = true;
        continue;
      }
      if (finiteField(p.strokeWidth)) {
        next[id] = p;
      } else {
        polysChanged = true;
        next[id] = { ...p, strokeWidth: 0 };
      }
    }
    if (polysChanged) {
      out.polygons = next;
      changed = true;
    }
  }

  // Svg images: geometry must be finite (the href allowlist runs later); a
  // malformed optional opacity strips rather than dropping the image.
  {
    const next: Record<string, SvgImage> = {};
    let imagesChanged = false;
    for (const id of Object.keys(out.svgImages)) {
      const img = out.svgImages[id];
      if (
        !isRecord(img) ||
        !finiteField(img.x) ||
        !finiteField(img.y) ||
        !finiteField(img.width) ||
        !finiteField(img.height) ||
        !finiteField(img.rotation)
      ) {
        imagesChanged = true;
        continue;
      }
      if ('opacity' in img && !finiteField(img.opacity)) {
        imagesChanged = true;
        const { opacity: _gone, ...rest } = img;
        next[id] = rest;
      } else {
        next[id] = img;
      }
    }
    if (imagesChanged) {
      out.svgImages = next;
      changed = true;
    }
  }

  // Paint orders: dedupe, then reconcile against the surviving records (drop
  // dead ids, append missed ones) — the same shape effectiveBackgroundOrder /
  // effectiveLineOrder tolerate at render, made canonical at the door.
  {
    const dedupe = (order: string[]): string[] => {
      const seen = new Set<string>();
      const next = order.filter((id) => !seen.has(id) && (seen.add(id), true));
      return next.length === order.length ? order : next;
    };
    const lineOrder = reconcileOrder(out.lines, dedupe(out.lineOrder));
    if (
      lineOrder.length !== out.lineOrder.length ||
      lineOrder.some((id, i) => id !== out.lineOrder[i])
    ) {
      out.lineOrder = lineOrder;
      changed = true;
    }
    const bg = reconcileOrder({ ...out.polygons, ...out.svgImages }, dedupe(out.backgroundOrder));
    if (
      bg.length !== out.backgroundOrder.length ||
      bg.some((id, i) => id !== out.backgroundOrder[i])
    ) {
      out.backgroundOrder = bg;
      changed = true;
    }
  }

  // Doc scalars: wrong-typed values take the DEFAULT_DOC value, the same
  // answer an absent field gets from the merge.
  if (typeof out.name !== 'string') {
    out.name = DEFAULT_DOC.name;
    changed = true;
  }
  if (typeof out.darkMode !== 'boolean') {
    out.darkMode = false;
    changed = true;
  }
  if (!finiteField(out.lineCounter) || out.lineCounter < 0) {
    out.lineCounter = 0;
    changed = true;
  } else if (!Number.isInteger(out.lineCounter)) {
    out.lineCounter = Math.round(out.lineCounter);
    changed = true;
  }

  return changed ? out : doc;
}

// The load-time twin of transforms' pruneOrphanLineOverrides: validate the
// line's topology-scoped overrides against what the file actually carries. A
// segment style needs its pair to be an edge; an end-style pin needs its
// station to still be ON the line — plus the value validation a hand-edited
// file makes necessary.
function sanitizeLineOverrides(line: Line): Line {
  return sanitizeLineEnds(sanitizeSegments(line));
}

// Per-line END style + per-station pins. Both are dropped at their default so
// the "never store a default" invariant survives a hand-edited file, and a pin
// on a station that has left the line is dropped outright.
//
// LIVENESS, not endedness. Whether a line ENDS at a station is geometric
// (`lineEndsAt`) and so moves with a station drag, a rotation, an orientation
// cycle — none of which pass through here or through any prune. Judging a
// STORED pin that way would make a save/reload delete what the user set while
// the geometry happened to be elsewhere. So a pin whose station is still on the
// line is kept however that station currently reads: inert while it is not an
// end (nothing paints it — see StopMarkerSpec.end), live again the moment it is.
function sanitizeLineEnds(line: Line): Line {
  const rawEnd = (line as Line & { endStyle?: unknown }).endStyle;
  const hasEnd = rawEnd !== undefined;
  const keepEnd = isLineEndStyle(rawEnd) && rawEnd !== LINE_END_STYLE_DEFAULT;
  const pins = line.stationEndStyles;
  const hasPins = pins !== undefined;
  if (!hasEnd && !hasPins) return line;

  let next = line;
  let changed = false;
  if (hasEnd && !keepEnd) {
    const { endStyle: _gone, ...rest } = next;
    next = rest as Line;
    changed = true;
  }
  if (hasPins) {
    const kept: Record<StationId, LineEndStyle> = {};
    let pinsChanged = false;
    // Read the line's own end from the CLEANED value above, so a pin is judged
    // redundant against what the line will actually paint.
    const lineEnd = lineEndStyleOf(next);
    const members = new Set<StationId>(next.stations);
    // `typeof null === 'object'`, and so is an array — a bare non-object guard
    // lets both ride along as a stored map holding no pin at all.
    const isPinMap = pins !== null && typeof pins === 'object' && !Array.isArray(pins);
    const valid = isPinMap ? pins : {};
    for (const stationId of Object.keys(valid)) {
      const pin = valid[stationId];
      if (!isLineEndStyle(pin) || pin === lineEnd || !members.has(stationId)) {
        pinsChanged = true;
        continue;
      }
      kept[stationId] = pin;
    }
    // Rewrite unless the field already IS a map with at least one pin to judge:
    // an empty one has nothing to change, but still has to go, so "no
    // overrides" keeps its single field-absent representation.
    if (!isPinMap || pinsChanged || Object.keys(valid).length === 0) {
      changed = true;
      next = withStationEndStyles(next, kept);
    }
  }
  return changed ? next : line;
}

function sanitizeSegments(line: Line): Line {
  // The retired per-segment z-layer field: files saved before the region
  // rework may still carry it — strip it so dead data never re-enters the
  // doc (regionAssignments replaced it; migrateDoc's v15 gate does the same
  // for localStorage docs).
  const carriesLegacyLayers = 'segmentLayers' in line;
  const styles = line.segmentStyles;
  if (!styles && !carriesLegacyLayers) return line;
  // Valid keys are exactly this line's edges — the single source of truth for
  // which station-pair corridors it occupies (see model/lineTopology.ts).
  const valid = new Set<string>(line.edges);
  let changed = carriesLegacyLayers;

  let nextStyles = styles;
  if (styles) {
    const next: Record<string, LineStyle> = {};
    let stylesChanged = false;
    for (const key of Object.keys(styles)) {
      const style = styles[key];
      if (!KNOWN_LINE_STYLES.has(style) || style === 'solid' || !valid.has(key)) {
        stylesChanged = true;
        continue;
      }
      next[key] = style;
    }
    if (stylesChanged) {
      nextStyles = next;
      changed = true;
    }
  }

  if (!changed) return line;
  const { segmentLayers: _retired, ...rest } = line as Line & { segmentLayers?: unknown };
  return { ...rest, segmentStyles: nextStyles };
}
