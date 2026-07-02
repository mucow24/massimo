/**
 * Font embedding for canvas export. When a browser rasterizes an SVG loaded as
 * an `<img>` (the PNG path), it renders in an isolated context with no access
 * to the page's `@font-face` rules — so the map's Helvetica Neue text would
 * silently fall back to a system font. To keep exports faithful we re-emit the
 * needed faces as `@font-face` rules with the font files inlined as base64
 * data-URIs, embedded in a `<style>` inside the exported SVG.
 *
 * Only the weight/style combinations actually present in the map are fetched
 * and embedded, so the payload stays small.
 *
 * Every shipped face is a TrueType `.ttf` (jsPDF, used by PDF export, can only
 * embed TrueType outlines — not PostScript/CFF OpenType). `FONT_TABLE` mirrors
 * the Helvetica Neue `@font-face` blocks in styles.css 1:1 — keep the two in
 * sync if the shipped font set changes. (styles.css also declares a DejaVu
 * Sans fallback face, deliberately absent here: pdfGlyphs handles it.)
 *
 * File paths are stored base-relative (no leading slash) and prefixed with
 * Vite's `BASE_URL` when fetched (see `fontUrl`). A hardcoded `/fonts/…` 404s
 * when the app is served from a subpath (e.g. GitHub Pages at /massimo/): Vite
 * rewrites the `url()` in styles.css to be base-aware, but a literal fetch
 * string is left untouched, so each runtime font fetch must apply the base.
 */

export const FONT_FAMILY = 'Helvetica Neue';

// Font stack for all on-screen + exported map text. Helvetica Neue first (the
// map's type); DejaVu Sans then catches the symbol/dingbat/arrow glyphs HN lacks
// (✈, ↔, ★, ■, …) so they render identically on screen and in the PDF.
export const FONT_STACK = "'Helvetica Neue', 'DejaVu Sans', Helvetica, Arial, sans-serif";

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

export const FONT_TABLE: FontFaceSpec[] = [
  ttf(100, false, 'HelveticaNeueUltraLight'),
  ttf(200, false, 'HelveticaNeueThin'),
  ttf(300, false, 'HelveticaNeueLight'),
  ttf(400, false, 'HelveticaNeueRoman'),
  ttf(500, false, 'HelveticaNeueMedium'),
  ttf(700, false, 'HelveticaNeueBold'),
  ttf(800, false, 'HelveticaNeueHeavy'),
  ttf(900, false, 'HelveticaNeueBlack'),
  ttf(100, true, 'HelveticaNeueUltraLightItalic'),
  ttf(200, true, 'HelveticaNeueThinItalic'),
  ttf(300, true, 'HelveticaNeueLightItalic'),
  // Weight-400 italic ships under the bare "Italic" filename, not "RomanItalic".
  ttf(400, true, 'HelveticaNeueItalic'),
  ttf(500, true, 'HelveticaNeueMediumItalic'),
  ttf(700, true, 'HelveticaNeueBoldItalic'),
  ttf(800, true, 'HelveticaNeueHeavyItalic'),
  ttf(900, true, 'HelveticaNeueBlackItalic'),
];

const AVAILABLE_WEIGHTS = [100, 200, 300, 400, 500, 700, 800, 900];

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
  let best = AVAILABLE_WEIGHTS[0];
  for (const w of AVAILABLE_WEIGHTS) {
    if (Math.abs(w - n) < Math.abs(best - n)) best = w;
  }
  return best;
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

export function bytesToBase64(bytes: Uint8Array): string {
  // btoa needs a binary string; chunk to avoid blowing the call-stack arg cap
  // on multi-hundred-KB font files.
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Build a CSS string of `@font-face` rules with each face's font file inlined
 * as a base64 data-URI. Fetches run in parallel; a face whose file fails to
 * load is skipped so export still succeeds (with partial font fidelity) rather
 * than throwing.
 *
 * `base` (Vite's `BASE_URL`, e.g. `/` in dev, `./` or `/massimo/` in prod) is
 * prefixed to each face's base-relative path so the fetch resolves under the
 * subpath the app is served from.
 */
export async function buildEmbeddedFontCss(
  faces: FontFaceSpec[],
  fetchFn: typeof fetch = fetch,
  base: string = import.meta.env.BASE_URL,
): Promise<string> {
  const rules = await Promise.all(
    faces.map(async (face) => {
      try {
        const res = await fetchFn(fontUrl(face.file, base));
        if (!res.ok) return '';
        const buf = new Uint8Array(await res.arrayBuffer());
        const b64 = bytesToBase64(buf);
        const mime = face.format === 'truetype' ? 'font/ttf' : 'font/otf';
        return [
          '@font-face {',
          `  font-family: '${FONT_FAMILY}';`,
          `  font-weight: ${face.weight};`,
          `  font-style: ${face.italic ? 'italic' : 'normal'};`,
          `  src: url(data:${mime};base64,${b64}) format('${face.format}');`,
          '}',
        ].join('\n');
      } catch {
        return '';
      }
    }),
  );
  return rules.filter(Boolean).join('\n');
}
