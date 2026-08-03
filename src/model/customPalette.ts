import type { Palette, PaletteSwatch } from './palettes';

export type ParsedCustomPalette =
  | { ok: true; name: string; swatches: PaletteSwatch[] }
  | { ok: false; error: string };

const HEX6 = /^#[0-9a-fA-F]{6}$/;

/**
 * Parse a user-supplied custom-palette JSON file (the "frrf" format):
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
  const obj = raw as { name?: unknown; colors?: unknown };
  if (typeof obj.name !== 'string' || obj.name.trim().length === 0) {
    return { ok: false, error: 'Missing a palette `name`' };
  }
  if (!Array.isArray(obj.colors) || obj.colors.length === 0) {
    return { ok: false, error: 'Missing a non-empty `colors` array' };
  }
  const swatches: PaletteSwatch[] = [];
  obj.colors.forEach((entry, i) => {
    const e = entry as { line?: unknown; human?: unknown };
    if (typeof e.human !== 'string' || !HEX6.test(e.human)) return;
    const name = e.line == null ? String(i + 1) : String(e.line);
    swatches.push({ name, color: e.human.toLowerCase() });
  });
  if (swatches.length === 0) {
    return { ok: false, error: 'No valid `human` colors found' };
  }
  return { ok: true, name: obj.name.trim(), swatches };
}

/**
 * Write a palette back out in the same "frrf" format `parseCustomPalette`
 * reads, so an exported palette re-imports as itself. Only the two fields that
 * survive a parse are written — `cat` / `locked` were never read, so a palette
 * that came from such a file exports without them.
 */
export function serializeCustomPalette({ name, swatches }: Palette): string {
  return JSON.stringify(
    {
      name,
      colors: swatches.map((s) => ({ line: s.name, human: s.color.toLowerCase() })),
    },
    null,
    2,
  );
}
