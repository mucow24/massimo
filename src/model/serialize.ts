import {
  DEFAULT_DOC,
  isLabelWeight,
  TEXT_LABEL_COLOR_DEFAULT,
  TEXT_LABEL_DARK_COLOR_DEFAULT,
} from './transforms';
import { pairKeyOf } from './pairKey';
import { KNOWN_PALETTE_IDS } from './palettes';
import type {
  LabelValign,
  Line,
  LineStyle,
  MapDoc,
  Polygon,
  Station,
  StopOrientation,
  TextLabel,
  TextLabelWeight,
} from './types';

const KNOWN_LINE_STYLES = new Set<LineStyle>(['solid', 'dashed', 'hatched', 'hatched-mirror']);

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

export interface SerializedFile {
  format: typeof SCHEMA_FORMAT;
  doc: MapDoc;
}

export type ParseResult = { ok: true; doc: MapDoc } | { ok: false; error: string };

export function serialize(doc: MapDoc): string {
  const file: SerializedFile = { format: SCHEMA_FORMAT, doc };
  return JSON.stringify(file, null, 2);
}

export function parse(json: string): ParseResult {
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
  const merged: MapDoc = { ...DEFAULT_DOC, ...(docWithMigratedWeight as Partial<MapDoc>) };
  // Enforce the "at least one valid palette" invariant on load. A malformed
  // file with explicit `activePalettes: []` or only unknown ids would
  // otherwise leave the doc in an unreachable-from-UI state.
  const validPalettes = (merged.activePalettes ?? []).filter((id) => KNOWN_PALETTE_IDS.has(id));
  if (validPalettes.length === 0) {
    merged.activePalettes = [...DEFAULT_DOC.activePalettes];
  } else {
    merged.activePalettes = validPalettes;
  }
  // Sanitize per-line segment styles: drop unknown style values, drop 'solid'
  // (never persisted), and drop any entry whose pair-key isn't a station-pair
  // adjacency on the line. Also backfill `name` for legacy files saved before
  // the field existed.
  const cleanedLines: Record<string, Line> = {};
  let linesChanged = false;
  for (const id of Object.keys(merged.lines)) {
    const line = merged.lines[id];
    let cleaned = sanitizeSegmentStyles(line);
    if (!cleaned.name) {
      cleaned = { ...cleaned, name: `${cleaned.service} line` };
    }
    if (cleaned !== line) linesChanged = true;
    cleanedLines[id] = cleaned;
  }
  if (linesChanged) merged.lines = cleanedLines;
  const sanitized = sanitizeStations(merged.stations);
  if (sanitized.changed) merged.stations = sanitized.stations;
  const cleanedPolygons = backfillPolygonDarkColors(merged.polygons);
  if (cleanedPolygons.changed) merged.polygons = cleanedPolygons.polygons;
  const cleanedLabels = backfillTextLabelColors(merged.textLabels);
  if (cleanedLabels.changed) merged.textLabels = cleanedLabels.textLabels;
  return { ok: true, doc: merged };
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

function sanitizeSegmentStyles(line: Line): Line {
  if (!line.segmentStyles) return line;
  const valid = new Set<string>();
  for (let i = 0; i < line.stations.length - 1; i++) {
    valid.add(pairKeyOf(line.stations[i], line.stations[i + 1]));
  }
  let changed = false;
  const next: Record<string, LineStyle> = {};
  for (const key of Object.keys(line.segmentStyles)) {
    const style = line.segmentStyles[key];
    if (!KNOWN_LINE_STYLES.has(style) || style === 'solid' || !valid.has(key)) {
      changed = true;
      continue;
    }
    next[key] = style;
  }
  return changed ? { ...line, segmentStyles: next } : line;
}
