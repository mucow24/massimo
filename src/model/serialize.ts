import { DEFAULT_DOC } from './transforms';
import { PALETTES, type PaletteId } from './palettes';
import type { MapDoc } from './types';

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
  return { ok: true, doc: merged };
}
