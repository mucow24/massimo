/**
 * Low-level font primitives shared across every layer: the canonical font stack,
 * the shipped weight ladder, and the pure weight-math helpers that keep screen
 * CSS, canvas text measurement, inline-tag parsing, and the export outline
 * tracer all agreeing on the same set of real faces.
 *
 * These are pure and dependency-free (only the `TextLabelWeight` model type), so
 * they live here rather than in `export/fonts.ts` (font *embedding* — fetch,
 * base64, `@font-face`): geometry and model must reach these without depending on
 * the export layer.
 */

import type { TextLabelWeight } from '../model/types';
import { clamp } from './grid';

// The map's typeface. Söhne, licensed per-application from Klim — which is what
// lets its glyphs ride along in the SVG/PDF/PNG files the app produces. The
// on-screen font and the export outline tracer must read the SAME files or
// measured pen positions won't line up with the traced glyphs, so styles.css's
// `@font-face` blocks and `FONT_TABLE` (export/fonts.ts) point at these too.
// Spelled ASCII: the family name reaches CSS, the export tracer, and served
// URLs, and none of those gain anything from the umlaut.
export const FONT_FAMILY = 'Soehne';

// Font stack for all on-screen + exported map text. The map's type first, then
// two fallbacks in a deliberate order: Massimo Symbols carries the handful of
// pictograms we care about the LOOK of (today just ✈, drawn to match Söhne's cap
// height), and DejaVu Sans sits behind it as the broad coverage net for
// everything else Söhne lacks (★, ■, Greek, Cyrillic, …). Söhne itself covers ↔,
// © and ™, so those never reach a fallback at all.
//
// The order matters twice and must agree in both places: here (canvas text
// measurement, and the `font-family` the exported SVG carries) and in styles.css
// (the DOM). `SYMBOL_FONT_URLS` in export/pdfGlyphs.ts is the same chain for the
// outline tracer — reorder one and exports stop matching the screen.
export const FONT_STACK =
  "'Soehne', 'Massimo Symbols', 'DejaVu Sans', Helvetica, Arial, sans-serif";

/**
 * `font-feature-settings` for all map text — contextual alternates ON,
 * ligatures OFF.
 *
 * NOT `font-variant-ligatures`: Chrome silently drops that property's effect the
 * moment `letter-spacing` is non-zero, and essentially every map label carries a
 * little tracking. `font-feature-settings` keeps the feature on THROUGH tracking
 * (measured firing at −0.01em), which is the only reason the substitutions show
 * up on a real map at all.
 *
 * The split — `calt` on, `liga` off — is forced by the export tracer, which
 * draws one glyph per CHARACTER at the browser's own pen positions. Söhne's
 * contextual alternates are all 1:1 substitutions (a figure-height colon in
 * `12:30`, a multiplication sign in `3x3`), so the tracer can reproduce them
 * character for character — see `contextualAlternate` in `export/fonts.ts`. Its
 * `liga` feature is many-to-one, and would have the tracer emit two glyphs over
 * ink the browser drew as one. `styles.css` states the same value for on-screen
 * map text; the export clone lays out detached from that CSS and restates it.
 * Keep the two in step, or the screen and the tracer stop agreeing on the glyph
 * run.
 */
export const FONT_FEATURE_SETTINGS = '"calt" 1, "liga" 0';

/**
 * Minimum rendered font size, in world units. The label Size field floors here
 * (re-exported as `transforms.TEXT_LABEL_FONT_SIZE_MIN`), and inline `<size=…>`
 * resolution clamps to it too (see `labelTokens.resolveRunFontSize`), so a tiny
 * relative `<size=-N>` or absolute `<size=0.5>` can never drive a run's size to
 * zero or below.
 */
export const MIN_FONT_SIZE = 1;

// Display name ↔ shipped weight, ascending. THE weight ladder: the dropdowns,
// the `<w=Name>` inline label tag, the ±step math below, and the membership
// check every load path uses (`transforms.isLabelWeight`) all read this one
// list. The rungs ARE the shipped faces in /public/fonts, so a rung exists here
// exactly when there is a .ttf to render it. Re-exported as
// `transforms.LABEL_WEIGHT_NAMES`.
//
// The names stay English while the files are German: Söhne runs Extraleicht →
// Extrafett over 200–900, which lines up rung-for-rung with the ladder below
// (Thin=Extraleicht, Roman=Buch, Medium=Kräftig, SemiBold=Halbfett,
// Bold=Dreiviertelfett, Heavy=Fett, Black=Extrafett). Söhne has no 100, so
// UltraLight is retired — `bakeLegacyUltraLightWeight` (serialize.ts) folds a
// stored 100 onto Thin, and `parseWeightToken` still answers to the old name.
export const LABEL_WEIGHT_NAMES: readonly { value: TextLabelWeight; name: string }[] = [
  { value: 200, name: 'Thin' },
  { value: 300, name: 'Light' },
  { value: 400, name: 'Roman' },
  { value: 500, name: 'Medium' },
  { value: 600, name: 'SemiBold' },
  { value: 700, name: 'Bold' },
  { value: 800, name: 'Heavy' },
  { value: 900, name: 'Black' },
] as const;

/** Retired rung: Söhne's ladder starts at 200, so a stored/tagged UltraLight
 * resolves to the adjacent Thin rather than snapping to the 400 default. */
export const RETIRED_ULTRALIGHT_WEIGHT = 100;

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
 * both ends.
 *
 * Ordinal, not arithmetic: `steps` counts RUNGS. Adding ±100 to the number would
 * walk off the ends (900 + 100 is not a face) and would silently start skipping
 * or landing between rungs the moment the shipped set changes — which it just
 * did, when Söhne retired UltraLight and added SemiBold. Counting rungs keeps
 * every consumer — screen CSS, canvas measurement, the export outline tracer —
 * on the same real face, and makes the clamp at Thin/Black fall out for free.
 * Off-ladder input is first normalized to the nearest shipped weight.
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
 * Rungs between a weight and its bold counterpart: Roman → Bold, Medium →
 * Heavy, Light → SemiBold.
 *
 * THREE, not two, because the ladder carries a SemiBold rung at 600. Every jump
 * that means "make this Bold" reads this one constant — `<b>`, the
 * station-label hover bump, and the legacy `labelBold` migration — so inserting
 * or retiring a rung can't quietly demote bold text to the neighbour below it.
 * The shallower bold-ward tags `<sb>` and `<m>` are a different question and
 * carry their own counts; see `BOLDWARD_TAG_STEPS` (labelTokens.ts).
 */
export const BOLD_WEIGHT_STEPS = 3;

/**
 * Parse the value of a `<w=…>` inline label tag into either an absolute shipped
 * weight (a name from `LABEL_WEIGHT_NAMES`, case-insensitive) or a relative
 * ladder step (`+N` / `-N`, sign required). Anything else — an unknown name, a
 * bare/unsigned number like `700` or `2`, empty — returns null so the parser
 * keeps the tag as literal text, matching an invalid `<color=…>`.
 *
 * `<w=UltraLight>` is still answered, resolving to Thin: the rung retired with
 * the move to Söhne, and labels written against it would otherwise start
 * rendering the tag as literal text.
 */
export function parseWeightToken(value: string): { abs: number } | { rel: number } | null {
  if (/^[+-]\d+$/.test(value)) return { rel: Number(value) };
  const key = value.toLowerCase();
  if (key === 'ultralight') return { abs: LABEL_WEIGHT_VALUES[0] };
  const abs = WEIGHT_NAME_TO_VALUE.get(key);
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
 * numbers (e.g. 650) round to the nearest available weight, ties going low —
 * so 650, sitting between the SemiBold and Bold rungs, resolves to SemiBold.
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
