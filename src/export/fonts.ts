/**
 * The map's font faces and their URLs, feeding the export outline tracer.
 *
 * `collectUsedFontFaces` walks the export SVG and returns the distinct
 * weight/style faces in use; `loadOutlineFonts` (pdfGlyphs) then fetches and
 * parses each with opentype.js to trace glyphs to vector paths. Because the
 * tracer parses the file, every face must be a format opentype.js reads — a
 * TrueType/OpenType `.ttf`/`.otf`, never `.woff2` (Brotli + table transforms it
 * can't decode). `FONT_TABLE` mirrors the `@font-face` blocks in styles.css 1:1
 * — keep the two in sync if the shipped font set changes. (styles.css also
 * declares the Massimo Symbols and DejaVu Sans fallback faces, deliberately
 * absent here: pdfGlyphs loads those as the symbol sources.)
 *
 * File paths are stored base-relative (no leading slash) and prefixed with
 * Vite's `BASE_URL` when fetched (see `fontUrl`). A hardcoded `/fonts/…` 404s
 * when the app is served from a subpath (e.g. GitHub Pages at /massimo/): Vite
 * rewrites the `url()` in styles.css to be base-aware, but a literal fetch
 * string is left untouched, so each runtime font fetch must apply the base.
 */

import { normalizeWeight } from '../util/fonts';

export interface FontFaceSpec {
  weight: number;
  italic: boolean;
  /** Font file path relative to the app base (e.g. `fonts/Foo.ttf`), served
   * from /public/fonts/. Prefixed with `BASE_URL` at fetch time via `fontUrl`. */
  file: string;
  format: 'opentype' | 'truetype';
}

const ttf = (weight: number, italic: boolean, name: string): FontFaceSpec => ({
  weight,
  italic,
  file: `fonts/${name}.ttf`,
  format: 'truetype',
});

// Söhne's German face names against the app's English rungs. The files are
// ASCII-folded from Klim's originals (`Söhne-Kräftig.ttf` → `soehne-kraftig.ttf`)
// so the served URLs need no percent-encoding and CI's Linux filesystem can't
// disagree with Windows over unicode normalisation.
export const FONT_TABLE: FontFaceSpec[] = [
  ttf(200, false, 'soehne-extraleicht'), // Thin
  ttf(300, false, 'soehne-leicht'), // Light
  ttf(400, false, 'soehne-buch'), // Roman
  ttf(500, false, 'soehne-kraftig'), // Medium
  ttf(600, false, 'soehne-halbfett'), // SemiBold
  ttf(700, false, 'soehne-dreiviertelfett'), // Bold
  ttf(800, false, 'soehne-fett'), // Heavy
  ttf(900, false, 'soehne-extrafett'), // Black
  ttf(200, true, 'soehne-extraleicht-kursiv'),
  ttf(300, true, 'soehne-leicht-kursiv'),
  ttf(400, true, 'soehne-buch-kursiv'),
  ttf(500, true, 'soehne-kraftig-kursiv'),
  ttf(600, true, 'soehne-halbfett-kursiv'),
  ttf(700, true, 'soehne-dreiviertelfett-kursiv'),
  ttf(800, true, 'soehne-fett-kursiv'),
  ttf(900, true, 'soehne-extrafett-kursiv'),
];

/**
 * A glyph the browser's contextual-alternate shaping puts on screen in place of
 * the one the character maps to. Either a plain codepoint — the multiplication
 * sign has one — or a glyph the face exposes ONLY by name: `colon.mid`, the
 * figure-height colon, carries no codepoint at all, which is why the export
 * tracer cannot reach it the way it reaches every other glyph.
 */
export type ContextualAlternate = { cp: number } | { glyphName: string };

// The map can only ever type ASCII figures into Söhne's `calt` context classes.
// Those classes also list `zero.slash` and the tabular `.lt` figures, but both
// are reachable only through the `zero`/`tnum` features, which the map never
// enables — so plain 0–9 is the whole of the context in practice.
const isFigure = (cp: number | null): boolean => cp !== null && cp >= 0x30 && cp <= 0x39;

const COLON = 0x3a;
const LOWER_X = 0x78;
const UPPER_X = 0x58;
const MULTIPLY = 0x00d7;

/**
 * The glyph Söhne's `calt` feature substitutes for `cp` between `prev` and
 * `next` — a figure-height colon in `12:30`, a multiplication sign in `3x3` —
 * or null where it substitutes nothing. `prev`/`next` are null at a run edge.
 *
 * Both rules are 1:1 SINGLE substitutions, and that is the whole reason the
 * export tracer can follow them: the glyph count still equals the character
 * count, so `getStartPositionOfChar` keeps reporting one pen position per
 * character and every position stays where the browser put it. Söhne's `liga`
 * feature is many-to-one (a single f+ï ligature) and could not be followed this
 * way, which is why the map turns common ligatures off and leaves contextual
 * alternates on (see `styles.css`).
 *
 * Deliberately narrower than the font in one place: `calt` also raises the
 * multiplication sign in the SPACED `3 x 3`, which is not reproduced here.
 */
export function contextualAlternate(
  prev: number | null,
  cp: number,
  next: number | null,
): ContextualAlternate | null {
  if (!isFigure(prev) || !isFigure(next)) return null;
  if (cp === COLON) return { glyphName: 'colon.mid' };
  if (cp === LOWER_X || cp === UPPER_X) return { cp: MULTIPLY };
  return null;
}

/**
 * Resolve a base-relative font path (e.g. `fonts/Foo.ttf`) to a fetchable URL by
 * prefixing Vite's `BASE_URL`. Every runtime font fetch — the `@font-face` embed
 * and the PDF export's face/glyph loads — goes through here so it resolves under
 * whatever subpath the app is served from (Vite only base-rewrites `url()` in
 * CSS, not literal fetch strings). `base` is injectable for testing.
 */
export function fontUrl(file: string, base: string = import.meta.env.BASE_URL): string {
  return `${base}${file}`;
}

/** Effective `font-weight`/`font-style` for an element, walking ancestors. */
function effectiveFont(el: Element): { weight: number; italic: boolean } {
  let weightAttr: string | null = null;
  let styleAttr: string | null = null;
  let cur: Element | null = el;
  while (cur && (weightAttr === null || styleAttr === null)) {
    if (weightAttr === null) weightAttr = cur.getAttribute('font-weight');
    if (styleAttr === null) styleAttr = cur.getAttribute('font-style');
    cur = cur.parentElement;
  }
  return {
    weight: normalizeWeight(weightAttr),
    italic: (styleAttr ?? '').trim().toLowerCase() === 'italic',
  };
}

/**
 * Walk every `<text>`/`<tspan>` in the subtree and return the distinct
 * `FontFaceSpec`s in use. Reads the `font-weight`/`font-style` attributes the
 * renderer sets explicitly (inheriting from ancestors when absent), so the
 * result is deterministic and independent of whether `root` is attached.
 */
export function collectUsedFontFaces(root: Element): FontFaceSpec[] {
  const nodes = root.querySelectorAll('text, tspan');
  const seen = new Set<string>();
  const out: FontFaceSpec[] = [];
  for (const node of nodes) {
    const { weight, italic } = effectiveFont(node);
    const key = `${weight}:${italic}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const spec = FONT_TABLE.find((f) => f.weight === weight && f.italic === italic);
    if (spec) out.push(spec);
  }
  return out;
}
