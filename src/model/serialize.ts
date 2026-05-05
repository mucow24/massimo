import { DEFAULT_DOC } from './transforms';
import type { LabelCell, LineId, MapDoc, Station, StopCell } from './types';

export const SCHEMA_VERSION = 6;
export const SCHEMA_FORMAT = 'massimo-map';

export interface SerializedFile {
  format: typeof SCHEMA_FORMAT;
  version: number;
  doc: MapDoc;
}

export type ParseResult = { ok: true; doc: MapDoc } | { ok: false; error: string };

/**
 * Produce a JSON string suitable for writing to a `.massimo.json` file.
 * Pretty-printed for human readability.
 */
export function serialize(doc: MapDoc): string {
  const file: SerializedFile = {
    format: SCHEMA_FORMAT,
    version: SCHEMA_VERSION,
    doc,
  };
  return JSON.stringify(file, null, 2);
}

/**
 * Parse + validate + migrate a saved file. Returns either a current-version
 * `MapDoc` or a descriptive error. Never throws on user input.
 */
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
  if (typeof file.version !== 'number') {
    return { ok: false, error: 'Missing or invalid `version` field' };
  }
  if (file.version > SCHEMA_VERSION) {
    return {
      ok: false,
      error: `File version ${file.version} is newer than this app supports (${SCHEMA_VERSION}). Update Massimo to open it.`,
    };
  }
  if (!file.doc || typeof file.doc !== 'object') {
    return { ok: false, error: 'Missing `doc` field' };
  }
  try {
    const doc = migrate(file.doc, file.version);
    return { ok: true, doc };
  } catch (e) {
    return { ok: false, error: `Migration failed: ${(e as Error).message}` };
  }
}

/**
 * Run the chain of historical migrations from `fromVersion` up to
 * `SCHEMA_VERSION`. The persist middleware calls this for `localStorage` data
 * too — single source of truth.
 */
export function migrate(raw: unknown, fromVersion: number): MapDoc {
  const state = raw as {
    stations?: Record<string, unknown>;
    lines?: Record<string, unknown>;
    lineOrder?: string[];
    curveRadius?: number;
    lineCounter?: number;
    viewport?: unknown;
  };

  // v0 -> v1: stopOrder array -> stops grid.
  if (fromVersion < 1 && state && state.stations) {
    const migratedStations: Record<string, Station> = {};
    for (const [id, rawSt] of Object.entries(state.stations)) {
      const oldSt = rawSt as Station & { stopOrder?: LineId[] };
      const stopOrder = oldSt.stopOrder ?? [];
      const stops: StopCell[] = stopOrder.map((lineId, i) => ({
        lineId,
        row: 0,
        col: i,
        orientation: 'auto-vertical' as const,
      }));
      const { stopOrder: _drop, ...rest } = oldSt;
      void _drop;
      migratedStations[id] = { ...rest, stops } as Station;
    }
    state.stations = migratedStations;
  }

  // v1 -> v2: every station gains a label cell. Place it at (0, minCol - 1).
  if (fromVersion < 2 && state && state.stations) {
    const migratedStations: Record<string, Station> = {};
    for (const [id, rawSt] of Object.entries(state.stations)) {
      const st = rawSt as Station & { label?: LabelCell };
      if (st.label) {
        migratedStations[id] = st;
        continue;
      }
      const minCol =
        (st.stops ?? []).length === 0 ? 0 : Math.min(...st.stops.map((c) => c.col));
      const label: LabelCell = { row: 0, col: minCol - 1, rotation: 0, offset: 0 };
      migratedStations[id] = { ...st, label };
    }
    state.stations = migratedStations;
  }

  // v2 -> v3: label gains an `offset` field (default 0).
  if (fromVersion < 3 && state && state.stations) {
    const migratedStations: Record<string, Station> = {};
    for (const [id, rawSt] of Object.entries(state.stations)) {
      const st = rawSt as Station;
      const label: LabelCell = { ...st.label, offset: st.label.offset ?? 0 };
      migratedStations[id] = { ...st, label };
    }
    state.stations = migratedStations;
  }

  // v3/v4 -> v5: stop orientation enum widens. Map legacy `vertical` /
  // `horizontal` to `auto-vertical` / `auto-horizontal`.
  if (fromVersion < 5 && state && state.stations) {
    const migratedStations: Record<string, Station> = {};
    for (const [id, rawSt] of Object.entries(state.stations)) {
      const st = rawSt as Station;
      const stops = st.stops.map((c) => {
        const o = c.orientation as unknown as string;
        if (o === 'vertical') return { ...c, orientation: 'auto-vertical' as const };
        if (o === 'horizontal') return { ...c, orientation: 'auto-horizontal' as const };
        return c;
      });
      migratedStations[id] = { ...st, stops };
    }
    state.stations = migratedStations;
  }

  // v5 -> v6: viewport leaves MapDoc; lineCounter is added (best-effort
  // initial value = current line count so the palette cursor doesn't reset).
  if (fromVersion < 6 && state) {
    if (state.lineCounter === undefined) {
      state.lineCounter = state.lines ? Object.keys(state.lines).length : 0;
    }
    delete state.viewport;
  }

  // Fill in any fields that newer code expects but the migration chain
  // didn't touch (e.g. an older file with no curveRadius or lineOrder).
  const out = state as unknown as MapDoc;
  return {
    ...DEFAULT_DOC,
    ...out,
    stations: out.stations ?? {},
    lines: out.lines ?? {},
    lineOrder: out.lineOrder ?? Object.keys(out.lines ?? {}),
  };
}
