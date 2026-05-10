import { DEFAULT_DOC } from './transforms';
import { pairKeyOf } from './pairKey';
import { PALETTES, type PaletteId } from './palettes';
import type { Line, LineStyle, MapDoc } from './types';

const KNOWN_LINE_STYLES = new Set<LineStyle>(['solid', 'dashed', 'hatched', 'hatched-mirror']);

const KNOWN_PALETTE_IDS = new Set<PaletteId>(PALETTES.map((p) => p.id));

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
  // adjacency on the line.
  const cleanedLines: Record<string, Line> = {};
  let linesChanged = false;
  for (const id of Object.keys(merged.lines)) {
    const line = merged.lines[id];
    const cleaned = sanitizeSegmentStyles(line);
    if (cleaned !== line) linesChanged = true;
    cleanedLines[id] = cleaned;
  }
  if (linesChanged) merged.lines = cleanedLines;
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
