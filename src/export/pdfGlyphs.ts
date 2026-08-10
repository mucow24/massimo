/**
 * Glyph outlining for the SVG/PNG/PDF exports.
 *
 * Every exported file carries vector outlines instead of text plus a font:
 * `outlineAllText` traces each glyph from the same face the browser drew it in,
 * at the browser's own measured pen position, so it lands 1:1 with no measuring,
 * centering, or scaling of our own. Glyphs the text face lacks (the dingbats —
 * ✈, ★, ⚠) trace from the shipped fallbacks, in the same order `FONT_STACK` puts
 * them behind Söhne on screen: Massimo Symbols, then DejaVu Sans.
 *
 * Each distinct glyph is traced ONCE, into a `<defs>` prototype at a fixed em
 * size, and every occurrence becomes a `<use>` that translates it to its pen
 * position and scales it to its font size. A real map draws its few dozen
 * shapes thousands of times — the MTA map is 4,751 characters over 71 distinct
 * (glyph, face, fill) combinations — so this is where the export's bulk lives.
 * It pays in the PDF as well as the SVG: svg2pdf turns a `<use>` into a PDF Form
 * XObject, so each shape becomes one shared content stream invoked by a `/Do`
 * per instance rather than a fresh copy of the outline every time.
 *
 * Runs AFTER `normalizeTextBaselines`, because `getStartPositionOfChar` must
 * report the alphabetic baseline that `getPath` expects. A character in neither
 * the text face nor a fallback is dropped (renders nothing).
 */
import * as opentype from 'opentype.js';
import { contextualAlternate, fontUrl, type FontFaceSpec } from './fonts';
import { XLINK_NS } from './embeddedSvg';
import { normalizeWeight } from '../util/fonts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';
// Base-relative paths (prefixed with BASE_URL via `fontUrl` at fetch time, so
// they resolve under subpath builds like GitHub Pages /massimo/).
// Outline sources for glyphs the text face lacks (the dingbats), tried in
// order — `symbolFontFor` takes the FIRST cover. Mirrors the on-screen font
// stack (`FONT_STACK`, util/fonts.ts, and the @font-face order in styles.css)
// so the export traces the same glyph the browser drew: Massimo Symbols for ✈,
// DejaVu Sans behind it for everything else Söhne lacks.
export const SYMBOL_FONT_URLS = ['fonts/MassimoSymbols.otf', 'fonts/DejaVuSans.ttf'];

const covers = (font: opentype.Font, cp: number): boolean =>
  font.charToGlyphIndex(String.fromCodePoint(cp)) !== 0;

/**
 * Round to `decimals` and stringify, never emitting `"-0"`.
 *
 * The `-0` guard is load-bearing wherever the result is concatenated into an SVG
 * attribute — see `glyphPathData` for how a negative that rounds to zero fuses
 * with the number before it. Shared by the path serializer and the `<use>`
 * transforms so the two can't drift on it.
 */
function num(v: number, decimals: number): string {
  const factor = 10 ** decimals;
  const r = Math.round(v * factor) / factor;
  return Object.is(r, -0) ? '0' : String(r);
}

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
  const n = (v: number): string => num(v, decimals);
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
 * weight/style combinations actually on the map are loaded. A single face that
 * fails to parse is skipped — its glyphs fall back to a near weight or the
 * symbol fonts — but if faces were REQUESTED and every one of them failed, that
 * is a broken deployment (404s, a wrong BASE_URL), not a degraded one: it
 * throws, so the export dies loudly instead of quietly producing a map with no
 * labels on it.
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
  if (faces.length > 0 && loaded.size === 0) {
    throw new Error(
      `Export failed: none of the ${faces.length} requested font faces could be loaded. ` +
        'Check that the licensed .ttf files are present in /public/fonts.',
    );
  }
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
 * Em size every glyph prototype is traced at. Instances scale by
 * `fontSize / GLYPH_EM`, so one prototype serves every size the map uses.
 *
 * Tracing in em space rather than at each label's own size is what makes the
 * prototype table small: keyed by size as well, the FURTA map's 275 shapes
 * become 530. 1000 also buys precision — `glyphPathData`'s two decimals land
 * ~50× finer here than they did tracing straight at an 8–11pt label size.
 */
const GLYPH_EM = 1000;

/**
 * Glyph index for a glyph the face exposes only by NAME — `colon.mid`, the
 * figure-height colon, has no codepoint — or 0 when this face has no such glyph.
 * A stand-in face, or one whose `post` table carries no names, answers 0 and the
 * caller traces the character's own glyph instead, so a missing alternate costs
 * an export the substitution, never the character.
 */
function glyphIndexByName(font: opentype.Font | null, name: string): number {
  if (!font || typeof font.nameToGlyphIndex !== 'function') return 0;
  try {
    const gid = font.nameToGlyphIndex(name);
    return gid > 0 ? gid : 0;
  } catch {
    return 0;
  }
}

/** A placed occurrence of a prototype: pen position plus size-to-em scale. */
interface GlyphUse {
  id: string;
  x: number;
  y: number;
  scale: number;
}

/**
 * Replace every `<text>` in the (attached, baseline-normalized) export clone with
 * vector outlines — a `<defs>` prototype per distinct glyph, and a `<use>` per
 * occurrence placed at the browser's own measured pen position. Covered glyphs
 * come from the main face for the run's weight/style; glyphs no face covers fall
 * back to the symbol fonts.
 *
 * Four properties worth keeping:
 *
 *   - **Measure everything first, mutate after.** Every `getStartPositionOfChar`
 *     read happens before the first DOM write, so the browser lays the tree out
 *     ONCE. Interleaving them invalidated layout per `<text>` and made the cost
 *     quadratic in label count — which SVG and PNG export never used to pay.
 *     Prototypes are therefore only ASSEMBLED in pass 1; nothing is appended to
 *     the document until pass 2.
 *   - **A `<text>` is only replaced if it actually produced glyphs.** A face that
 *     fails to load, or a codepoint nothing covers, leaves the original `<text>`
 *     in place to render in a fallback face. Deleting it unconditionally turned a
 *     font hiccup into a map with no labels at all, which nothing downstream can
 *     detect.
 *   - **The fill is baked onto the prototype, not the `<use>`.** svg2pdf builds a
 *     `<use>`'s render context from `AttributeState.default()`, so a fill on the
 *     instance never reaches the form object — every glyph would print black. It
 *     also means the prototype key spans (face, codepoint, fill): one shape in
 *     two colours is two prototypes.
 *   - **Instances stay where the `<text>` stood.** Pen positions are in the
 *     `<text>`'s own user space, so the `<use>` has to sit under the same
 *     (rotated, faded) ancestors the label did — exactly as the inline outline
 *     paths did before it. Inherited `opacity`/`fill-opacity` survive that move:
 *     svg2pdf's `applyAttributes` folds both into a gState it sets before
 *     invoking the form.
 *
 * One latent sharp edge comes with the `<use>`: an ancestor `fill="none"`
 * wrapping a `<text>` that sets its own fill would make the glyphs vanish from
 * the PDF while still rendering in the SVG and PNG. svg2pdf's use branch does
 * `fillOpacity *= attributeState.fill ? 1 : 0` (a workaround for symbols reused
 * at different paints), and the `<use>` inherits that `none` even though the
 * prototype it points at carries a real fill of its own. The inline paths were
 * immune because they carried their fill directly and took no such branch.
 * Nothing on the canvas paints a group `fill="none"` today — every such site is
 * leaf chrome — and a `<text>` that inherits `fill="none"` itself never reaches
 * here at all (`resolveTextStyle` reports it and the char is skipped). Worth
 * knowing before wrapping labels in a group that sets it.
 *
 * Must run while the SVG is in the document (needs `getStartPositionOfChar`) and
 * AFTER `normalizeTextBaselines`, so positions sit on the alphabetic baseline
 * `getPath` expects. Measured positions already fold in text-anchor, tracking,
 * and kerning, so each glyph lands exactly where the browser drew it.
 */
export function outlineAllText(svg: SVGSVGElement, fonts: OutlineFonts): void {
  const texts = [...svg.querySelectorAll('text')];

  // Prototype registry, keyed by (face, codepoint, fill). An empty id caches a
  // glyph with no contours (a space) so it is not re-traced on every occurrence.
  const protoId = new Map<string, string>();
  const protos: { id: string; d: string; fill: string }[] = [];
  const faceIds = new Map<opentype.Font, number>();
  const faceIdOf = (font: opentype.Font): number => {
    let id = faceIds.get(font);
    if (id === undefined) {
      id = faceIds.size;
      faceIds.set(font, id);
    }
    return id;
  };

  // Pass 1 — READ ONLY. No DOM writes, so layout is computed once for the tree.
  const measured = texts.map((text) => {
    const uses: GlyphUse[] = [];
    let drawable = 0; // chars that SHOULD have produced a glyph
    const chars = collectStyledChars(text);
    for (const [i, { cp, index, styleEl }] of chars.entries()) {
      const { weight, italic, fontSize, fill } = resolveTextStyle(styleEl);
      if (fill === 'none') continue;
      drawable++;
      let p: DOMPoint | null = null;
      try {
        p = text.getStartPositionOfChar(index);
      } catch {
        p = null;
      }
      if (!p) continue;
      // Contextual alternates need the characters either side, but only where
      // the browser shaped them as ONE run: a neighbour under a different
      // element is a different `<text>`/`<tspan>`, which every renderer here
      // uses to mark a new styled run or a new LINE. The map requests `calt`
      // through `font-feature-settings`, which stays on under tracking, so the
      // feature fires regardless of letter-spacing and there is nothing to gate.
      const neighbour = (j: number): number | null =>
        chars[j]?.styleEl === styleEl ? chars[j].cp : null;
      const alt = contextualAlternate(neighbour(i - 1), cp, neighbour(i + 1));
      // An alternate that HAS a codepoint (the multiplication sign) just replaces
      // the character and rides the ordinary path, symbol fallback included.
      const drawnCp = alt && 'cp' in alt ? alt.cp : cp;
      const face = pickFace(fonts.faces, weight, italic);
      // A named alternate comes from the face's own tables, so it needs no
      // coverage check — and 0 here means this face hasn't got it, which falls
      // straight back to the character's own glyph.
      const namedGid = alt && 'glyphName' in alt ? glyphIndexByName(face, alt.glyphName) : 0;
      const font =
        namedGid > 0
          ? face!
          : face && covers(face, drawnCp)
            ? face
            : symbolFontFor(fonts.symbols, drawnCp);
      if (!font) continue;
      const key = `${faceIdOf(font)}|${namedGid > 0 ? `@${namedGid}` : drawnCp}|${fill}`;
      let id = protoId.get(key);
      if (id === undefined) {
        const path =
          namedGid > 0
            ? font.glyphs.get(namedGid).getPath(0, 0, GLYPH_EM)
            : font.getPath(String.fromCodePoint(drawnCp), 0, 0, GLYPH_EM);
        const d = glyphPathData(path);
        id = d ? `mgly${protos.length}` : '';
        protoId.set(key, id);
        if (d) protos.push({ id, d, fill });
      }
      if (!id) continue;
      uses.push({ id, x: p.x, y: p.y, scale: fontSize / GLYPH_EM });
    }
    return { text, uses, drawable };
  });

  // Pass 2 — WRITE ONLY.
  if (protos.length > 0) {
    const defs = document.createElementNS(SVG_NS, 'defs');
    for (const g of protos) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('id', g.id);
      path.setAttribute('d', g.d);
      path.setAttribute('fill', g.fill);
      defs.appendChild(path);
    }
    svg.insertBefore(defs, svg.firstChild);
    // Declare xlink ONCE on the root. Every instance below carries an
    // `xlink:href` alongside the plain one, and without a root declaration
    // XMLSerializer would repeat `xmlns:xlink="…"` on all of them — 40+ wasted
    // bytes per glyph on a map that has thousands.
    svg.setAttributeNS(XMLNS_NS, 'xmlns:xlink', XLINK_NS);
  }
  for (const { text, uses, drawable } of measured) {
    const parent = text.parentNode;
    if (!parent) continue;
    // Nothing to draw (whitespace, fill:none) — drop it, it rendered nothing.
    // Something to draw but nothing traced — keep the <text> so the label
    // survives in a fallback face rather than vanishing.
    if (drawable > 0 && uses.length === 0) continue;
    for (const u of uses) {
      const use = document.createElementNS(SVG_NS, 'use');
      // BOTH href forms, as the app already does for embedded `<image>`s. The
      // SVG 2 `href` is what Chrome, the PNG rasterizer and svg2pdf read; the
      // SVG 1.1 `xlink:href` is the only one strict consumers (Illustrator,
      // older librsvg) resolve, and a standalone .svg export that reaches one of
      // those would otherwise render with every label missing.
      const ref = `#${u.id}`;
      use.setAttribute('href', ref);
      use.setAttributeNS(XLINK_NS, 'xlink:href', ref);
      // translate-then-scale — SVG applies these right to left, so the em-space
      // outline is scaled to its font size FIRST and then moved to the pen.
      use.setAttribute(
        'transform',
        `translate(${num(u.x, 3)},${num(u.y, 3)}) scale(${num(u.scale, 8)})`,
      );
      parent.insertBefore(use, text);
    }
    parent.removeChild(text);
  }
}
