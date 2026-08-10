/**
 * Glyph outlining for the SVG/PNG/PDF exports.
 *
 * Every exported file carries vector `<path>` outlines instead of text plus a
 * font: `outlineAllText` traces each glyph from the same face the browser drew
 * it in, at the browser's own measured pen position, so it lands 1:1 with no
 * measuring, centering, or scaling of our own. Glyphs the text face lacks (the
 * dingbats — ✈, ★, ⚠) trace from the shipped DejaVu Sans fallback, which is the
 * same face `FONT_STACK` puts behind Söhne on screen.
 *
 * Runs AFTER `normalizeTextBaselines`, because `getStartPositionOfChar` must
 * report the alphabetic baseline that `getPath` expects. A character in neither
 * the text face nor a fallback is dropped (renders nothing).
 */
import * as opentype from 'opentype.js';
import { fontUrl, type FontFaceSpec } from './fonts';
import { normalizeWeight } from '../util/fonts';

const SVG_NS = 'http://www.w3.org/2000/svg';
// Base-relative paths (prefixed with BASE_URL via `fontUrl` at fetch time, so
// they resolve under subpath builds like GitHub Pages /massimo/).
// Outline sources for glyphs the text face lacks (the dingbats), tried in
// order. Mirrors the on-screen font stack so the export traces the same glyph
// the browser drew.
const SYMBOL_FONT_URLS = ['fonts/DejaVuSans.ttf'];

const covers = (font: opentype.Font, cp: number): boolean =>
  font.charToGlyphIndex(String.fromCodePoint(cp)) !== 0;

/**
 * Serialize an opentype glyph `Path` to SVG path data with explicit separators.
 *
 * We can't use opentype's own `toPathData`: it decides whether to emit a space
 * before a coordinate from the *raw* sign (`v >= 0`) but formats the *rounded*
 * value, so a small negative that rounds to "0" (e.g. -0.003 → "0") loses its
 * separator and fuses with the previous number — `-1.55` + `0` → `-1.550`. That
 * malformed `d` is silently recovered by Blink/Chromium but rejected outright by
 * stricter SVG parsers (e.g. some Edge builds), dropping the glyph from the PDF.
 * Emitting one space between every coordinate is always valid and can't fuse.
 *
 * TrueType glyphs are **quadratic** (`Q`). PDF has no quadratic operator, and
 * svg2pdf bridges the gap by FLATTENING every `Q` into a fan of tiny line
 * segments — which bloats a text-heavy map PDF by ~10× (hundreds of thousands of
 * `l` ops) and faceting the curves at zoom. So we convert each `Q` to the exact
 * cubic `C` it equals (`C1 = P0 + ⅔(Q−P0)`, `C2 = P2 + ⅔(Q−P2)`), which maps 1:1
 * to a PDF curve — no flattening, smooth outlines, a fraction of the size. This
 * needs the current pen point, so we track it across commands.
 */
export function glyphPathData(path: opentype.Path, decimals = 2): string {
  const factor = 10 ** decimals;
  const n = (v: number): string => {
    const r = Math.round(v * factor) / factor;
    return Object.is(r, -0) ? '0' : String(r);
  };
  let d = '';
  let cx = 0; // current pen point
  let cy = 0;
  let sx = 0; // current subpath start (where Z returns to)
  let sy = 0;
  for (const c of path.commands) {
    if (c.type === 'M') {
      d += `M${n(c.x)} ${n(c.y)}`;
      cx = sx = c.x;
      cy = sy = c.y;
    } else if (c.type === 'L') {
      d += `L${n(c.x)} ${n(c.y)}`;
      cx = c.x;
      cy = c.y;
    } else if (c.type === 'C') {
      d += `C${n(c.x1)} ${n(c.y1)} ${n(c.x2)} ${n(c.y2)} ${n(c.x)} ${n(c.y)}`;
      cx = c.x;
      cy = c.y;
    } else if (c.type === 'Q') {
      const c1x = cx + (2 / 3) * (c.x1 - cx);
      const c1y = cy + (2 / 3) * (c.y1 - cy);
      const c2x = c.x + (2 / 3) * (c.x1 - c.x);
      const c2y = c.y + (2 / 3) * (c.y1 - c.y);
      d += `C${n(c1x)} ${n(c1y)} ${n(c2x)} ${n(c2y)} ${n(c.x)} ${n(c.y)}`;
      cx = c.x;
      cy = c.y;
    } else if (c.type === 'Z') {
      d += 'Z';
      cx = sx;
      cy = sy;
    }
  }
  return d;
}

/** First symbol font that contains a glyph for `cp`, or null. */
export function symbolFontFor(fonts: opentype.Font[], cp: number): opentype.Font | null {
  for (const f of fonts) if (covers(f, cp)) return f;
  return null;
}

// ---------------------------------------------------------------------------
// Full text outlining.
//
// The licence Massimo ships under permits the font in exported files only when
// the end user can't edit the fonts in the result — so exports carry no font
// data at all: every glyph is traced to a vector `<path>`. This one pass serves
// both the SVG and PDF exporters, replacing the old SVG `@font-face` embed and
// the PDF jsPDF font registration. Because it only ever READS glyph contours, it
// is font-format-agnostic (any `.ttf`/`.otf` opentype.js can parse) — it never
// embeds or reformats the font file.
// ---------------------------------------------------------------------------

/** Parsed faces for full outlining. */
export interface OutlineFonts {
  /** Main text faces, keyed by `weightKey(weight, italic)`. */
  faces: Map<string, opentype.Font>;
  /** Fallback outline sources for glyphs no main face covers, tried in order. */
  symbols: opentype.Font[];
}

const weightKey = (weight: number, italic: boolean): string => `${weight}:${italic}`;

/**
 * Fetch + parse every used main face (keyed by weight/style) plus the symbol
 * fallback fonts. Faces come from `collectUsedFontFaces`, so only the
 * weight/style combinations actually on the map are loaded. A face that fails to
 * parse is skipped — its glyphs fall back to a near weight or the symbol fonts.
 */
export async function loadOutlineFonts(
  faces: FontFaceSpec[],
  fetchFn: typeof fetch = fetch,
): Promise<OutlineFonts> {
  const parse = async (url: string) =>
    opentype.parse(await (await fetchFn(fontUrl(url))).arrayBuffer());
  const loaded = new Map<string, opentype.Font>();
  await Promise.all(
    faces.map(async (f) => {
      try {
        loaded.set(weightKey(f.weight, f.italic), await parse(f.file));
      } catch {
        // Skip a face that won't load; pickFace falls back so glyphs still trace.
      }
    }),
  );
  const symbols = (
    await Promise.all(
      SYMBOL_FONT_URLS.map(async (url) => {
        try {
          return await parse(url);
        } catch {
          return null; // A missing fallback drops those glyphs, never the export.
        }
      }),
    )
  ).filter((f): f is opentype.Font => f !== null);
  return { faces: loaded, symbols };
}

/** Resolved typography for a text-bearing element. */
export interface TextStyle {
  weight: number;
  italic: boolean;
  fontSize: number;
  /** `fill` attribute value, or the default; `'none'` means draw nothing. */
  fill: string;
}

/**
 * Effective font-weight/style/size/fill for an element, reading presentation
 * attributes and walking ancestors when absent — the export SVG carries these as
 * attributes, so this matches what the browser drew without needing computed
 * style (and works headlessly). Mirrors `collectUsedFontFaces`'s weight/style
 * resolution so the face picked here is the face that was measured.
 */
export function resolveTextStyle(el: Element, defaultFill = '#000'): TextStyle {
  let weightAttr: string | null = null;
  let styleAttr: string | null = null;
  let sizeAttr: string | null = null;
  let fillAttr: string | null = null;
  let cur: Element | null = el;
  while (cur) {
    weightAttr ??= cur.getAttribute('font-weight');
    styleAttr ??= cur.getAttribute('font-style');
    sizeAttr ??= cur.getAttribute('font-size');
    fillAttr ??= cur.getAttribute('fill');
    cur = cur.parentElement;
  }
  return {
    weight: normalizeWeight(weightAttr),
    italic: (styleAttr ?? '').trim().toLowerCase() === 'italic',
    fontSize: sizeAttr ? parseFloat(sizeAttr) || 16 : 16,
    fill: fillAttr ?? defaultFill,
  };
}

/** A codepoint paired with its UTF-16 index in the root `<text>` and the element
 * whose typography governs it (nearest `<text>`/`<tspan>` ancestor). */
export interface StyledChar {
  cp: number;
  /** UTF-16 index into the root `<text>` — for `getStartPositionOfChar`. */
  index: number;
  styleEl: Element;
}

/**
 * Walk a `<text>`'s content in document order, pairing each codepoint with its
 * UTF-16 index (for `getStartPositionOfChar` on the root, which addresses every
 * descendant character in order) and the element whose style governs it. This is
 * what lets a single `<text>` with mixed-weight / mixed-color `<tspan>` runs
 * outline each run in its own face and fill.
 */
export function collectStyledChars(root: Element): StyledChar[] {
  const out: StyledChar[] = [];
  let index = 0;
  const walk = (node: Node, styleEl: Element): void => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        for (const ch of child.textContent ?? '') {
          out.push({ cp: ch.codePointAt(0) ?? 0, index, styleEl });
          index += ch.length; // UTF-16 units: 2 for astral, 1 otherwise
        }
      } else if (child.nodeType === 1) {
        walk(child, child as Element);
      }
    }
  };
  walk(root, root);
  return out;
}

/**
 * Best available main face for a weight/style: exact match, else the nearest
 * weight in the same style, else any loaded face. Keeps a glyph from dropping
 * when the exact face didn't load (or the map uses a weight we didn't fetch).
 */
export function pickFace(
  faces: Map<string, opentype.Font>,
  weight: number,
  italic: boolean,
): opentype.Font | null {
  const exact = faces.get(weightKey(weight, italic));
  if (exact) return exact;
  let best: opentype.Font | null = null;
  let bestDist = Infinity;
  for (const [key, font] of faces) {
    const [w, it] = key.split(':');
    if ((it === 'true') !== italic) continue;
    const dist = Math.abs(Number(w) - weight);
    if (dist < bestDist) {
      bestDist = dist;
      best = font;
    }
  }
  return best ?? faces.values().next().value ?? null;
}

/**
 * Replace every `<text>` in the (attached, baseline-normalized) export clone with
 * vector outline `<path>`s — one per glyph, traced from the matching face at the
 * browser's own measured pen position. Covered glyphs come from the main face for
 * the run's weight/style; glyphs no face covers fall back to the symbol fonts.
 * The result contains no `<text>` and no font data — only paths.
 *
 * Must run while the SVG is in the document (needs `getStartPositionOfChar`) and
 * AFTER `normalizeTextBaselines`, so positions sit on the alphabetic baseline
 * `getPath` expects. Measured positions already fold in text-anchor, tracking,
 * and kerning, so each glyph lands exactly where the browser drew it.
 */
export function outlineAllText(svg: SVGSVGElement, fonts: OutlineFonts): void {
  for (const text of [...svg.querySelectorAll('text')]) {
    const parent = text.parentNode;
    if (!parent) continue;
    const paths: SVGPathElement[] = [];
    for (const { cp, index, styleEl } of collectStyledChars(text)) {
      const { weight, italic, fontSize, fill } = resolveTextStyle(styleEl);
      if (fill === 'none') continue;
      let p: DOMPoint | null = null;
      try {
        p = text.getStartPositionOfChar(index);
      } catch {
        p = null;
      }
      if (!p) continue;
      const face = pickFace(fonts.faces, weight, italic);
      const font = face && covers(face, cp) ? face : symbolFontFor(fonts.symbols, cp);
      if (!font) continue;
      const d = glyphPathData(font.getPath(String.fromCodePoint(cp), p.x, p.y, fontSize));
      if (!d) continue;
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill', fill);
      paths.push(path);
    }
    for (const path of paths) parent.insertBefore(path, text);
    parent.removeChild(text);
  }
}
