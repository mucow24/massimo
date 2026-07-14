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
  withTransferOverride,
} from './transforms';
import {
  TRANSFER_COLOR_DEFAULT,
  TRANSFER_STROKE_COLOR_DEFAULT,
  TRANSFER_STROKE_WIDTH_DEFAULT,
  TRANSFER_THICKNESS_DEFAULT,
  canonicalTransferColor,
  canonicalTransferStrokeWidth,
  canonicalTransferThickness,
  legacyColorToDayNight,
} from './transferStyle';
import { canonicalLineWidth } from './lineWidth';
import { DOT_SIZE_DEFAULT, canonicalDotSize } from './dotSize';
import { canonicalStrokeColor, canonicalStrokeWidth, canonicalSeamColor } from './lineStroke';
import { DEFAULT_DOT_STYLE, DOT_SHAPE_PRESETS, dotStylesEqual } from './dotStyle';
import {
  adoptDefaultStyles,
  canonicalStyleProps,
  captureStyleProps,
  isReservedStyleName,
  stylePropsEqual,
} from './styles';
import { edgesFromStations } from './lineTopology';
import { parseHexA, withHexAlpha } from '../util/color';
import { migrateLegacyInlineTokens } from '../geometry/labelTokens';
import { KNOWN_PALETTE_IDS, type Palette, type PaletteId } from './palettes';
import type {
  DayNightColor,
  DotBaseShape,
  DotFill,
  DotShape,
  DotStrokeColor,
  DotStyle,
  LabelValign,
  Line,
  LineStyle,
  MapDoc,
  Polygon,
  RegionAnchor,
  RegionAssignment,
  RouteBulletShape,
  Station,
  StationStyleProps,
  StopCell,
  StopOrientation,
  StyleDef,
  StyleKind,
  TextLabel,
  TextLabelAlign,
  TextLabelWeight,
  Transfer,
} from './types';

const KNOWN_LINE_STYLES = new Set<LineStyle>([
  'solid',
  'dashed',
  'hatched',
  'hatched-mirror',
  'dotted',
  'dashed-open',
]);

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

// Enforce the "at least one VALID active palette" invariant: drop unknown ids,
// and fall back to the default set when nothing valid remains. Shared by
// `parse()` (file import) and the zustand persist `migrate` hook (localStorage
// rehydration) so both load paths keep the invariant in step — a doc with an
// explicit empty / all-unknown `activePalettes` is unreachable from the UI.
export function validActivePalettes(
  active: readonly PaletteId[] | undefined,
  custom: readonly Palette[] = [],
): PaletteId[] {
  const customIds = new Set(custom.map((p) => p.id));
  const valid = (active ?? []).filter((id) => KNOWN_PALETTE_IDS.has(id) || customIds.has(id));
  return valid.length > 0 ? valid : [...DEFAULT_DOC.activePalettes];
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

export function parse(json: string, custom: readonly Palette[] = []): ParseResult {
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
  // Pre-migration: older saves stored `labelBold: boolean`; the schema now
  // uses `labelWeight: TextLabelWeight`. Translate before merging so the
  // typed shape is clean and `labelBold` doesn't leak through.
  const rawDoc = file.doc as unknown as Record<string, unknown>;
  const docWithMigratedWeight = migrateLegacyLabelBold(rawDoc);
  // Pre-styles saves get the factory Defaults via the merge below AND a
  // default-adoption pass at the end; a file that carries a styles record
  // keeps its explicit tag/Custom state (round-trip stability).
  const hadStyles = 'styles' in (docWithMigratedWeight as Record<string, unknown>);
  // Same presence gate for the default designations: the merge fabricates
  // factory-id styleDefaults for a pre-designation file, and a fabricated id
  // that happens to resolve would win over the repair-by-name path the
  // rehydrate uses — the two load paths must designate identically.
  const hadStyleDefaults = 'styleDefaults' in (docWithMigratedWeight as Record<string, unknown>);
  let merged: MapDoc = { ...DEFAULT_DOC, ...(docWithMigratedWeight as Partial<MapDoc>) };
  // Enforce the "at least one valid palette" invariant on load. A malformed
  // file with explicit `activePalettes: []` or only unknown ids would
  // otherwise leave the doc in an unreachable-from-UI state. Shared with the
  // localStorage rehydration path via `validActivePalettes`.
  merged.activePalettes = validActivePalettes(merged.activePalettes, custom);
  // Sanitize per-line segment styles AND layers: drop unknown style values,
  // drop the never-persisted defaults ('solid' / layer 0), and drop any entry
  // whose pair-key isn't a station-pair adjacency on the line. Also backfill
  // `name` for legacy files saved before the field existed.
  const cleanedLines: Record<string, Line> = {};
  let linesChanged = false;
  for (const id of Object.keys(merged.lines)) {
    const line = merged.lines[id];
    const cleaned = sanitizeLineDotSize(
      sanitizeLineStroke(sanitizeLineWidth(sanitizeSegments(backfillLineEdges(line)))),
    );
    if (cleaned !== line) linesChanged = true;
    cleanedLines[id] = cleaned;
  }
  const named = backfillLineNames(cleanedLines);
  if (linesChanged || named.changed) merged.lines = named.lines;
  const sanitized = sanitizeStations(merged.stations);
  if (sanitized.changed) merged.stations = sanitized.stations;
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
  // Sanitize per-stop dot sizes AFTER the line pass: the canonical stored
  // form depends on the line's effective default, so the comparison must use
  // sanitized line values.
  const sizes = sanitizeStopDotSizes(merged.stations, merged.lines);
  if (sizes.changed) merged.stations = sizes.stations;
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
    const pct = Math.max(0, Math.min(100, p.fillOpacity));
    const fold = (hex: string) => withHexAlpha(hex, (parseHexA(hex)[3] * pct) / 100);
    const { fillOpacity: _drop, ...rest } = p;
    next[id] = { ...rest, fill: fold(p.fill), darkFill: fold(p.darkFill) };
    changed = true;
  }
  return { polygons: next, changed };
}

const KNOWN_DOT_BASE_SHAPES = new Set<DotBaseShape>(['circle', 'square', 'diamond', 'x']);

// Validate + normalize one raw dot color from a hand-edited file: the 'line'
// sentinel, the 'none' sentinel (fills only), or a {day, night} string pair
// (lowercased). Returns undefined when the value doesn't conform.
function sanitizeDotColor(raw: unknown, allowNone: boolean): DotFill | undefined {
  if (raw === 'line') return 'line';
  if (raw === 'none') return allowNone ? 'none' : undefined;
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
  if (typeof o.shape !== 'string' || !KNOWN_DOT_BASE_SHAPES.has(o.shape as DotBaseShape)) {
    return undefined;
  }
  const fill = sanitizeDotColor(o.fill, true);
  if (fill === undefined) return undefined;
  const strokeColor = sanitizeDotColor(o.strokeColor, false) as DotStrokeColor | undefined;
  if (strokeColor === undefined) return undefined;
  if (typeof o.strokeWidth !== 'number' || !Number.isFinite(o.strokeWidth)) return undefined;
  if (typeof o.showServiceCode !== 'boolean') return undefined;
  return {
    shape: o.shape as DotBaseShape,
    fill,
    strokeWidth: Math.max(0, o.strokeWidth),
    strokeColor,
    showServiceCode: o.showServiceCode,
  };
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

function convertLineDotFields(line: Line): Line {
  let next = line;
  if ('defaultDotShape' in next) {
    const { defaultDotShape, ...rest } = next as Line & { defaultDotShape?: unknown };
    if (rest.defaultDotStyle === undefined) {
      const preset =
        typeof defaultDotShape === 'string'
          ? DOT_SHAPE_PRESETS[defaultDotShape as DotShape]
          : undefined;
      next = preset ? { ...rest, defaultDotStyle: preset } : rest;
    } else {
      next = rest;
    }
  }
  if (next.defaultDotStyle !== undefined) {
    const cleaned = sanitizeDotStyle(next.defaultDotStyle);
    // Drop when invalid, or when it lands on the default (never stored —
    // mirrors `setLineDefaultDotStyle`).
    if (cleaned === undefined || dotStylesEqual(cleaned, DEFAULT_DOT_STYLE)) {
      const { defaultDotStyle: _gone, ...rest } = next;
      next = rest;
    } else if (!isCanonicalDotStyle(next.defaultDotStyle, cleaned)) {
      next = { ...next, defaultDotStyle: cleaned };
    }
  }
  return next;
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

// Normalize a hand-edited / legacy `defaultDotSize` to the canonical stored
// form the transforms maintain: integer ≥ DOT_SIZE_MIN, and absent when it
// equals the default (the app never stores the default). Non-numbers and
// non-finite values are dropped. File-import hygiene only — localStorage
// rehydration never sees uncanonical sizes because every write goes through
// `setLineDefaultDotSize`'s clamp.
function sanitizeLineDotSize(line: Line): Line {
  if (!('defaultDotSize' in line)) return line;
  const raw = line.defaultDotSize as unknown;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const stored = canonicalDotSize(raw);
    if (stored !== undefined) {
      return stored === line.defaultDotSize ? line : { ...line, defaultDotSize: stored };
    }
  }
  const { defaultDotSize: _gone, ...rest } = line;
  return rest;
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
        const effDefault = lines[s.lineId]?.defaultDotSize ?? DOT_SIZE_DEFAULT;
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
// the transforms maintain: strokeWidth on the half-pixel grid and ≥
// LINE_STROKE_WIDTH_MIN, strokeColor a lowercase string, and each field
// absent when it equals its default (the app never stores defaults).
// Non-numbers / non-finite widths and non-string colors are dropped.
// File-import hygiene only — localStorage rehydration never sees
// uncanonical values because every write goes through the setters'
// normalization.
function sanitizeLineStroke(line: Line): Line {
  let next = line;
  if ('strokeWidth' in line) {
    const raw = line.strokeWidth as unknown;
    const stored =
      typeof raw === 'number' && Number.isFinite(raw) ? canonicalStrokeWidth(raw) : undefined;
    if (stored === undefined) {
      const { strokeWidth: _gone, ...rest } = next;
      next = rest;
    } else if (stored !== next.strokeWidth) {
      next = { ...next, strokeWidth: stored };
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
  if ('seamColor' in line) {
    const raw = line.seamColor as unknown;
    const stored = typeof raw === 'string' ? canonicalSeamColor(raw) : undefined;
    if (stored === undefined) {
      const { seamColor: _gone, ...rest } = next;
      next = rest;
    } else if (stored !== next.seamColor) {
      next = { ...next, seamColor: stored };
    }
  }
  if ('seamWidth' in line) {
    const raw = line.seamWidth as unknown;
    // Seam width shares the casing grid/floor + drop-at-0.
    const stored =
      typeof raw === 'number' && Number.isFinite(raw) ? canonicalStrokeWidth(raw) : undefined;
    if (stored === undefined) {
      const { seamWidth: _gone, ...rest } = next;
      next = rest;
    } else if (stored !== next.seamWidth) {
      next = { ...next, seamWidth: stored };
    }
  }
  return next;
}

// Normalize hand-edited / legacy per-transfer style overrides to the
// canonical stored form `updateTransferStyle` maintains: numeric fields
// rounded and floor-clamped, and every field absent when it equals the
// constant transfer default (the app never stores a redundant override).
// Non-numbers / non-finite numerics and non-string colors are dropped.
// File-import hygiene only — localStorage rehydration never sees uncanonical
// overrides because every write goes through `updateTransferStyle`.
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
// File-only hygiene (parse); the localStorage path gets the same strip via
// the persist migration gate.
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
    if (cleaned !== a) changed = true;
    next[id] = cleaned;
  }
  return changed ? { assignments: next, changed } : { assignments, changed };
}

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
 * Enforce the two structural style invariants every loaded doc must satisfy
 * (see MapDoc): every kind has ≥ 1 style — kinds with none get their factory
 * Default injected — and `styleDefaults` maps every kind to one of its
 * styles. A valid incoming designation is kept verbatim; a missing, dangling
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
      nextDefaults[kind] = (sorted.find((d) => d.name === 'Default') ?? sorted[0]).id;
      changed = true;
    }
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
]);
const KNOWN_TEXT_ALIGNS = new Set<TextLabelAlign>(['left', 'center', 'right', 'justify']);
const KNOWN_BULLET_SHAPES = new Set<RouteBulletShape>(['circle', 'square', 'diamond']);

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
      const dot = sanitizeDotStyle(o.defaultDotStyle);
      const dotSize = finiteNum(o.defaultDotSize);
      const width = finiteNum(o.width);
      const strokeWidth = finiteNum(o.strokeWidth);
      const strokeColor = asString(o.strokeColor);
      if (!dot || dotSize === undefined || width === undefined) return undefined;
      if (strokeWidth === undefined || strokeColor === undefined) return undefined;
      // seamColor / seamWidth are OPTIONAL — absent ⇒ no seam / inherit; a
      // malformed value is dropped (treated as absent) rather than invalidating
      // the whole def.
      const seamColor = asString(o.seamColor);
      const seamWidth = finiteNum(o.seamWidth);
      return canonicalStyleProps('line', {
        defaultDotStyle: dot,
        defaultDotSize: dotSize,
        width,
        strokeWidth,
        strokeColor,
        ...(seamColor !== undefined ? { seamColor } : {}),
        ...(seamWidth !== undefined ? { seamWidth } : {}),
      });
    }
    case 'textLabel': {
      const color = asString(o.color);
      const darkColor = asString(o.darkColor);
      const fontSize = finiteNum(o.fontSize);
      const italic = asBool(o.italic);
      if (color === undefined || darkColor === undefined || fontSize === undefined)
        return undefined;
      if (!isLabelWeight(o.weight) || italic === undefined) return undefined;
      if (typeof o.align !== 'string' || !KNOWN_TEXT_ALIGNS.has(o.align as TextLabelAlign))
        return undefined;
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
      if (typeof o.shape !== 'string' || !KNOWN_BULLET_SHAPES.has(o.shape as RouteBulletShape))
        return undefined;
      if (size === undefined) return undefined;
      return canonicalStyleProps('routeBullet', { shape: o.shape as RouteBulletShape, size });
    }
    case 'transfer': {
      const thickness = finiteNum(o.thickness);
      const color = sanitizeDayNightColor(o.color);
      const strokeWidth = finiteNum(o.strokeWidth);
      const strokeColor = sanitizeDayNightColor(o.strokeColor);
      if (thickness === undefined || color === undefined) return undefined;
      if (strokeWidth === undefined || strokeColor === undefined) return undefined;
      return canonicalStyleProps('transfer', { thickness, color, strokeWidth, strokeColor });
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
