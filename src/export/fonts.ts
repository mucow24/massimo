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
 * declares a DejaVu Sans fallback face, deliberately absent here: pdfGlyphs
 * loads it as the symbol source.)
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
