import { DEFAULT_DOC } from './transforms';
import { pairKeyOf } from './pairKey';
import { PALETTES, type PaletteId } from './palettes';
import type { Line, LineStyle, MapDoc, Station, StopOrientation } from './types';

const KNOWN_LINE_STYLES = new Set<LineStyle>(['solid', 'dashed', 'hatched', 'hatched-mirror']);

const KNOWN_PALETTE_IDS = new Set<PaletteId>(PALETTES.map((p) => p.id));

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

function sanitizeStations(stations: Record<string, Station>): {
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
    if (stopsChanged) {
      changed = true;
      out[id] = { ...st, stops };
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
  const merged: MapDoc = { ...DEFAULT_DOC, ...file.doc };
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
  return { ok: true, doc: merged };
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
