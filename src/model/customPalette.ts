import { uniqueSwatchNames, type Palette, type PaletteSwatch } from './palettes';
import { normalizeHex, parseHexA } from '../util/color';

export type ParsedCustomPalette =
  | {
      ok: true;
      name: string;
      swatches: PaletteSwatch[];
      description?: string;
      /** Present only for a design palette, mirroring `Palette.kind`. */
      kind?: 'design';
    }
  | { ok: false; error: string };

const HEX6 = /^#[0-9a-fA-F]{6}$/;
const HEX6OR8 = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;

/**
 * Parse a palette file. Two formats land here, told apart by a `format` key:
 *
 * The massimo-palette format — ours, what export writes:
 *
 *   { "format": "massimo-palette", "version": 1, "name": "My palette",
 *     "kind": "line", "description": "…", "colors": [ { "name": "Line 1",
 *     "day": "#C1272DFF", "night": "#C1272DFF" } ] }
 *
 * `kind` is `"line"` or `"design"` (see Palette.kind); in the file it is
 * always spelled out, in storage only `'design'` is kept — anything else,
 * including files predating the field, reads as a line palette.
 *
 * Colors are day/night pairs (both `#RRGGBB` or `#RRGGBBAA`); in storage the
 * night color is kept only when it differs from the day one, and both are
 * normalized to the canonical `normalizeHex` form. Entries with an invalid
 * `day` are skipped, and a file left with no color at all is rejected — a
 * palette carries at least one, whether it arrived empty or emptied itself.
 * `version` is ignored on read (forward-tolerant, like the map loader).
 *
 * The legacy "frrf" format — no `format` key:
 *
 *   { "name": "frrf", "colors": [ { "line": 1, "human": "#c1272d", ... } ] }
 *
 * Only the `human` color of each entry is used; `line` becomes the swatch name
 * (shown on hover). `cat` / `locked` are ignored. Entries whose `human` is
 * missing or not a 6-digit hex are skipped; the file is rejected only if no
 * valid color survives.
 */
export function parseCustomPalette(json: string): ParsedCustomPalette {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    return { ok: false, error: `Not valid JSON: ${(e as Error).message}` };
  }
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'File is not a JSON object' };
  }
  const obj = raw as {
    format?: unknown;
    name?: unknown;
    description?: unknown;
    colors?: unknown;
    kind?: unknown;
  };
  if ('format' in obj) {
    if (obj.format !== 'massimo-palette') {
      return { ok: false, error: 'Not a massimo palette file' };
    }
    return parseMassimoPalette(obj);
  }
  return parseLegacyPalette(obj);
}

function parseMassimoPalette(obj: {
  name?: unknown;
  description?: unknown;
  colors?: unknown;
  kind?: unknown;
}): ParsedCustomPalette {
  if (typeof obj.name !== 'string' || obj.name.trim().length === 0) {
    return { ok: false, error: 'Missing a palette `name`' };
  }
  if (!Array.isArray(obj.colors)) {
    return { ok: false, error: 'Missing a `colors` array' };
  }
  const swatches: PaletteSwatch[] = [];
  obj.colors.forEach((entry, i) => {
    // A hand-edited file can hold a null (or otherwise non-object) entry where
    // a color belongs; it is just one more color we can't use.
    if (entry === null || typeof entry !== 'object') return;
    const e = entry as { name?: unknown; day?: unknown; night?: unknown };
    if (typeof e.day !== 'string' || !HEX6OR8.test(e.day)) return;
    const color = normalizeHex(e.day);
    const night =
      typeof e.night === 'string' && HEX6OR8.test(e.night) ? normalizeHex(e.night) : undefined;
    const name = e.name == null ? String(i + 1) : String(e.name);
    swatches.push({ name, color, ...(night !== undefined && night !== color && { night }) });
  });
  if (swatches.length === 0) {
    // The two ways a file can describe no palette read differently to whoever
    // has to fix it: one wrote colors we couldn't use, the other wrote none.
    return {
      ok: false,
      error: obj.colors.length > 0 ? 'No valid colors found' : 'A palette needs at least one color',
    };
  }
  const description =
    typeof obj.description === 'string' && obj.description.trim().length > 0
      ? obj.description.trim()
      : undefined;
  return {
    ok: true,
    name: obj.name.trim(),
    // Names are the swatch-ref key: a file naming two colors alike is cleaned
    // here, before the manager ever shows it.
    swatches: uniqueSwatchNames(swatches),
    ...(description !== undefined && { description }),
    ...(obj.kind === 'design' && { kind: 'design' as const }),
  };
}

function parseLegacyPalette(obj: { name?: unknown; colors?: unknown }): ParsedCustomPalette {
  if (typeof obj.name !== 'string' || obj.name.trim().length === 0) {
    return { ok: false, error: 'Missing a palette `name`' };
  }
  if (!Array.isArray(obj.colors) || obj.colors.length === 0) {
    return { ok: false, error: 'Missing a non-empty `colors` array' };
  }
  const swatches: PaletteSwatch[] = [];
  obj.colors.forEach((entry, i) => {
    if (entry === null || typeof entry !== 'object') return;
    const e = entry as { line?: unknown; human?: unknown };
    if (typeof e.human !== 'string' || !HEX6.test(e.human)) return;
    const name = e.line == null ? String(i + 1) : String(e.line);
    swatches.push({ name, color: e.human.toLowerCase() });
  });
  if (swatches.length === 0) {
    return { ok: false, error: 'No valid `human` colors found' };
  }
  return { ok: true, name: obj.name.trim(), swatches: uniqueSwatchNames(swatches) };
}

// The file is the interchange form, so it is explicit where storage is terse:
// always 8 digits, alpha included, uppercase.
const fileHex = (hex: string): string => {
  const [r, g, b, a] = parseHexA(hex);
  const pair = (n: number) => n.toString(16).padStart(2, '0');
  return `#${pair(r)}${pair(g)}${pair(b)}${pair(a)}`.toUpperCase();
};

/**
 * Write a palette out in the massimo-palette format `parseCustomPalette`
 * reads, so an exported palette re-imports as itself (modulo hex
 * canonicalization). The night color is backfilled from the day one when the
 * palette stores none, and the kind is always named — the file spells out
 * what storage keeps terse.
 */
export function serializeCustomPalette({ name, swatches, description, kind }: Palette): string {
  return JSON.stringify(
    {
      format: 'massimo-palette',
      version: 1,
      name,
      kind: kind ?? 'line',
      ...(description !== undefined && { description }),
      colors: swatches.map((s) => ({
        name: s.name,
        day: fileHex(s.color),
        night: fileHex(s.night ?? s.color),
      })),
    },
    null,
    2,
  );
}
