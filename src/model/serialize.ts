import { DEFAULT_DOC } from './transforms';
import type { LabelCell, Line, LineId, LineTag, MapDoc, Station, StopCell } from './types';
import { buildBands } from '../geometry/interlining';
import { offsetPathLength } from '../geometry/lineTagGeometry';
import { STOP_SIZE } from '../geometry/orientation';

export const SCHEMA_VERSION = 12;
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
    lineTags?: Record<string, unknown>;
    routeBullets?: Record<string, unknown>;
    transfers?: Record<string, unknown>;
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
      const minCol = (st.stops ?? []).length === 0 ? 0 : Math.min(...st.stops.map((c) => c.col));
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

  // v6 -> v7: lineTags introduced. Default to {} for older files.
  if (fromVersion < 7 && state) {
    if (!state.lineTags) state.lineTags = {};
  }

  // v7 -> v8: line tag position changes from fractional `t` (line-traversal
  // frame) to (anchorEnd, distance) — anchored to a canonical endpoint with
  // arc-length distance along the stripe. This makes tags stay put as the
  // corridor lengthens or shortens.
  //
  // Migration needs the live band geometry to convert: walk the doc, find
  // each tag's band, compute the stripe arc length, and split the canonical
  // arc length into (nearer endpoint, distance).
  if (fromVersion < 8 && state) {
    state.lineTags = migrateLineTagsToAnchored(
      (state.lineTags ?? {}) as Record<string, V7LineTag>,
      (state.stations ?? {}) as Record<string, Station>,
      (state.lines ?? {}) as Record<string, Line>,
      state.lineOrder ?? [],
      typeof state.curveRadius === 'number' ? state.curveRadius : 24,
    );
  }

  // v8 -> v9: routeBullets introduced. Default to {} for older files.
  if (fromVersion < 9 && state) {
    if (!state.routeBullets) state.routeBullets = {};
  }

  // v9 -> v10: transfers introduced. Default to {} for older files.
  if (fromVersion < 10 && state) {
    if (!state.transfers) state.transfers = {};
  }

  // v10 -> v11: transfer endpoints become {stationId, lineId} pairs so
  // they can pin to a specific dot at interlined stations. Convert
  // {stationA, stationB} into {a: {stationId, lineId: null}, b: ...}.
  if (fromVersion < 11 && state && state.transfers) {
    const next: Record<string, unknown> = {};
    for (const [id, raw] of Object.entries(state.transfers)) {
      const t = raw as { stationA?: unknown; stationB?: unknown; a?: unknown; b?: unknown };
      if (t.a && t.b) {
        next[id] = t;
      } else if (typeof t.stationA === 'string' && typeof t.stationB === 'string') {
        next[id] = {
          id,
          a: { stationId: t.stationA, lineId: null },
          b: { stationId: t.stationB, lineId: null },
        };
      }
    }
    state.transfers = next;
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
    lineTags: out.lineTags ?? {},
    routeBullets: out.routeBullets ?? {},
    transfers: out.transfers ?? {},
  };
}

// Pre-v8 line-tag shape, captured for typed migration.
interface V7LineTag {
  id: string;
  lineId: LineId;
  fromStationId: string;
  toStationId: string;
  t: number;
  orientation: 0 | 1 | 2 | 3;
}

/**
 * Convert pre-v8 fractional-t tags to (anchorEnd, distance). Builds the band
 * geometry from the doc to recover each tag's stripe length, then splits the
 * canonical arc length to whichever endpoint is nearer.
 *
 * Tags whose band can't be reconstructed (line missing, corridor not an
 * edge, line not in any band) are dropped.
 */
function migrateLineTagsToAnchored(
  oldTags: Record<string, V7LineTag>,
  stations: Record<string, Station>,
  lines: Record<string, Line>,
  lineOrder: string[],
  curveRadius: number,
): Record<string, LineTag> {
  if (Object.keys(oldTags).length === 0) return {};
  const bands = buildBands(stations, lines, curveRadius, lineOrder);
  const next: Record<string, LineTag> = {};
  for (const tid of Object.keys(oldTags)) {
    const old = oldTags[tid];
    if (typeof old.t !== 'number') {
      // Already migrated or never had a `t` — leave as-is (best-effort).
      next[tid] = old as unknown as LineTag;
      continue;
    }
    const pairKey =
      old.fromStationId < old.toStationId
        ? `${old.fromStationId}|${old.toStationId}`
        : `${old.toStationId}|${old.fromStationId}`;
    const band = bands.find(
      (b) => b.pairKey === pairKey && b.lines.some((l) => l.id === old.lineId),
    );
    if (!band) continue; // orphaned, drop
    const k = band.lines.findIndex((l) => l.id === old.lineId);
    const n = band.lines.length;
    const offset = (k - (n - 1) / 2) * STOP_SIZE;
    const stripeTotal = offsetPathLength(band.centerline, curveRadius, offset);
    if (stripeTotal <= 0) continue;
    // Old `t` was in line-traversal frame; convert to canonical-t.
    const line = lines[old.lineId];
    const forward = line && lineForwardCanon(line, old.fromStationId, old.toStationId);
    const canonT = forward ? old.t : 1 - old.t;
    const arcLen = Math.max(0, Math.min(stripeTotal, canonT * stripeTotal));
    const anchorEnd: 'from' | 'to' = arcLen <= stripeTotal / 2 ? 'from' : 'to';
    const distance = anchorEnd === 'from' ? arcLen : stripeTotal - arcLen;
    next[tid] = {
      id: old.id,
      lineId: old.lineId,
      fromStationId: old.fromStationId,
      toStationId: old.toStationId,
      anchorEnd,
      distance,
      orientation: old.orientation,
    };
  }
  return next;
}

function lineForwardCanon(line: Line, from: string, to: string): boolean {
  for (let i = 0; i < line.stations.length - 1; i++) {
    const a = line.stations[i];
    const b = line.stations[i + 1];
    if (a === from && b === to) return true;
    if (a === to && b === from) return false;
  }
  return true;
}
