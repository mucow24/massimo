/**
 * Low-level font primitives shared across every layer: the canonical font stack,
 * the shipped Helvetica Neue weight ladder, and the pure weight-math helpers that
 * keep screen CSS, canvas text measurement, inline-tag parsing, and PDF face
 * embedding all agreeing on the same set of real faces.
 *
 * These are pure and dependency-free (only the `TextLabelWeight` model type), so
 * they live here rather than in `export/fonts.ts` (font *embedding* — fetch,
 * base64, `@font-face`): geometry and model must reach these without depending on
 * the export layer.
 */

import type { TextLabelWeight } from '../model/types';
import { clamp } from './grid';

export const FONT_FAMILY = 'Helvetica Neue';

// Font stack for all on-screen + exported map text. Helvetica Neue first (the
// map's type); DejaVu Sans then catches the symbol/dingbat/arrow glyphs HN lacks
// (✈, ↔, ★, ■, …) so they render identically on screen and in the PDF.
export const FONT_STACK = "'Helvetica Neue', 'DejaVu Sans', Helvetica, Arial, sans-serif";

/**
 * Minimum rendered font size, in world units. The label Size field floors here
 * (re-exported as `transforms.TEXT_LABEL_FONT_SIZE_MIN`), and inline `<size=…>`
 * resolution clamps to it too (see `labelTokens.resolveRunFontSize`), so a tiny
 * relative `<size=-N>` or absolute `<size=0.5>` can never drive a run's size to
 * zero or below.
 */
export const MIN_FONT_SIZE = 1;

// Display name ↔ shipped Helvetica Neue weight, ascending. THE weight ladder:
// the dropdowns, the `<w=Name>` inline label tag, the ±step math below, and the
// membership check every load path uses (`transforms.isLabelWeight`) all read
// this one list. The names ARE the shipped faces in /public/fonts, so a rung
// exists here exactly when there is a .ttf to render it — no 600 entry, because
// there is no SemiBold face. Re-exported as `transforms.LABEL_WEIGHT_NAMES`.
export const LABEL_WEIGHT_NAMES: readonly { value: TextLabelWeight; name: string }[] = [
  { value: 100, name: 'UltraLight' },
  { value: 200, name: 'Thin' },
  { value: 300, name: 'Light' },
  { value: 400, name: 'Roman' },
  { value: 500, name: 'Medium' },
  { value: 700, name: 'Bold' },
  { value: 800, name: 'Heavy' },
  { value: 900, name: 'Black' },
] as const;

// The ladder's values alone — derived, never re-typed, so the rungs the weight
// math walks are by construction the rungs the dropdowns offer.
export const LABEL_WEIGHT_VALUES: readonly TextLabelWeight[] = LABEL_WEIGHT_NAMES.map(
  (w) => w.value,
);

const WEIGHT_NAME_TO_VALUE = new Map(
  LABEL_WEIGHT_NAMES.map((w) => [w.name.toLowerCase(), w.value]),
);

/**
 * Shift a weight `steps` positions along the SHIPPED weight ladder, clamped at
 * both ends. Stepping the ladder (rather than adding ±100) is what keeps every
 * consumer — screen CSS, canvas measurement, PDF face embedding — on one real
 * face: the set has no 600, so a numeric ±200 from Regular would land between
 * Medium and Bold and each consumer would snap it differently. Off-ladder input
 * is first normalized to the nearest shipped weight.
 */
export function stepWeight(weight: number, steps: number): number {
  // Widened to `number`: the input is a raw CSS/SVG weight, off-ladder until
  // normalizeWeight has had a look at it.
  const ladder = LABEL_WEIGHT_VALUES as readonly number[];
  const i = ladder.indexOf(weight);
  const from = i >= 0 ? i : ladder.indexOf(normalizeWeight(String(weight)));
  return ladder[clamp(from + steps, 0, ladder.length - 1)];
}

/**
 * The `<b>` formatting tag's weight: two steps up the shipped ladder (400 → 700,
 * 300 → 500, 500 → 800), clamped at Black.
 */
export function bolderWeight(weight: number): number {
  return stepWeight(weight, 2);
}

/**
 * Parse the value of a `<w=…>` inline label tag into either an absolute shipped
 * weight (a name from `LABEL_WEIGHT_NAMES`, case-insensitive) or a relative
 * ladder step (`+N` / `-N`, sign required). Anything else — an unknown name, a
 * bare/unsigned number like `700` or `2`, empty — returns null so the parser
 * keeps the tag as literal text, matching an invalid `<color=…>`.
 */
export function parseWeightToken(value: string): { abs: number } | { rel: number } | null {
  if (/^[+-]\d+$/.test(value)) return { rel: Number(value) };
  const abs = WEIGHT_NAME_TO_VALUE.get(value.toLowerCase());
  return abs !== undefined ? { abs } : null;
}

/**
 * Parse the value of a `<size=…>` inline label tag into either an absolute font
 * size (an unsigned positive number) or a relative delta (`+N` / `-N`, sign
 * required — added to the label's base size). Decimals are allowed in either
 * form. Anything else — zero, a negative absolute, a unit suffix like `6px`, a
 * bare sign, empty — returns null so the parser keeps the tag as literal text,
 * matching an invalid `<w=…>`/`<color=…>`. Unlike weight there is no ladder: font
 * size is continuous, so a signed value is a plain additive delta (mirroring
 * `<w=±N>`'s innermost-wins-no-compounding stacking, resolved in
 * `resolveRunFontSize`).
 */
export function parseSizeToken(value: string): { abs: number } | { rel: number } | null {
  if (/^[+-]\d+(\.\d+)?$/.test(value)) return { rel: Number(value) };
  if (/^\d+(\.\d+)?$/.test(value)) {
    const n = Number(value);
    return n > 0 ? { abs: n } : null;
  }
  return null;
}

/**
 * Normalize a raw SVG/CSS `font-weight` value to the nearest weight the font
 * set actually ships. Keywords map to their canonical numbers; off-table
 * numbers (e.g. 600) round to the nearest available weight, ties going low.
 */
export function normalizeWeight(raw: string | null | undefined): number {
  if (!raw) return 400;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === 'normal') return 400;
  if (trimmed === 'bold') return 700;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return 400;
  let best = LABEL_WEIGHT_VALUES[0];
  for (const w of LABEL_WEIGHT_VALUES) {
    if (Math.abs(w - n) < Math.abs(best - n)) best = w;
  }
  return best;
}
