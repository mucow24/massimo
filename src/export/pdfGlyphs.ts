/**
 * Glyph fallback for the PDF export.
 *
 * svg2pdf renders text only in the embedded Helvetica Neue, and jsPDF can't even
 * encode supplementary-plane characters — so glyphs HN lacks (✈, ↔, ★, …) would
 * vanish from the PDF. The app renders those on screen with the SAME shipped
 * fallback font (DejaVu Sans, listed after Helvetica Neue in `FONT_STACK`), so we
 * just trace each one to a vector `<path>` from that font at the browser's own
 * pen position. Because screen and PDF use one font, it lands 1:1 — no measuring,
 * centering, or scaling.
 *
 * Covered characters stay as explicitly-positioned, selectable Helvetica Neue
 * text; only the symbol glyphs lose selectability, and the surrounding text never
 * reflows. Runs AFTER `normalizeTextBaselines`, so `getStartPositionOfChar`
 * reports the alphabetic baseline `getPath` expects. A character in neither HN
 * nor a fallback font is dropped (renders nothing).
 */
import * as opentype from 'opentype.js';
import { fontUrl } from './fonts';
import { partitionRuns, type CharPos } from './pdfText';

const SVG_NS = 'http://www.w3.org/2000/svg';
// Base-relative paths (prefixed with BASE_URL via `fontUrl` at fetch time, so
// they resolve under subpath builds like GitHub Pages /massimo/).
// A representative Helvetica Neue face — coverage is uniform across weights.
const COVERAGE_FONT_URL = 'fonts/HelveticaNeueRoman.ttf';
// Outline sources for glyphs HN lacks, tried in order. Mirrors the on-screen
// font stack so the PDF traces the same glyph the browser drew.
const SYMBOL_FONT_URLS = ['fonts/DejaVuSans.ttf'];

export interface GlyphFonts {
  /** Coverage oracle. */
  hn: opentype.Font;
  /** Outline sources for uncovered glyphs, tried in order. */
  symbols: opentype.Font[];
}

const covers = (font: opentype.Font, cp: number): boolean =>
  font.charToGlyphIndex(String.fromCodePoint(cp)) !== 0;

/** First symbol font that contains a glyph for `cp`, or null. */
export function symbolFontFor(fonts: opentype.Font[], cp: number): opentype.Font | null {
  for (const f of fonts) if (covers(f, cp)) return f;
  return null;
}

/** True if any text run contains a character outside Latin-1 (which HN fully
 * covers) — i.e. worth loading the fonts to check for uncovered glyphs. */
export function needsGlyphOutlining(svg: SVGSVGElement): boolean {
  for (const text of svg.querySelectorAll('text')) {
    const s = text.textContent ?? '';
    for (let i = 0; i < s.length; i++) {
      if (s.charCodeAt(i) > 0xff) return true;
    }
  }
  return false;
}

/** Fetch + parse the coverage and symbol fonts. */
export async function loadGlyphFonts(fetchFn: typeof fetch = fetch): Promise<GlyphFonts> {
  const parse = async (url: string) =>
    opentype.parse(await (await fetchFn(fontUrl(url))).arrayBuffer());
  const [hn, ...symbols] = await Promise.all([
    parse(COVERAGE_FONT_URL),
    ...SYMBOL_FONT_URLS.map(parse),
  ]);
  return { hn, symbols };
}

/**
 * Replace every Helvetica-Neue-uncovered character in the (attached) export
 * clone with a vector outline path from the fallback font, keeping covered
 * characters as positioned selectable text. No-op for text whose characters are
 * all covered. Uses `getStartPositionOfChar`, so the SVG must be in the document
 * and already baseline-normalized (alphabetic).
 */
export function outlineUnsupportedText(svg: SVGSVGElement, fonts: GlyphFonts): void {
  for (const text of [...svg.querySelectorAll('text')]) {
    const content = text.textContent ?? '';
    // Each codepoint with its on-canvas pen position (alphabetic baseline).
    const chars: CharPos[] = [];
    let hasUncovered = false;
    let i = 0;
    while (i < content.length) {
      const cp = content.codePointAt(i) ?? 0;
      const len = cp > 0xffff ? 2 : 1;
      let p: DOMPoint | null = null;
      try {
        p = text.getStartPositionOfChar(i);
      } catch {
        p = null;
      }
      if (p) {
        chars.push({ cp, x: p.x, y: p.y });
        if (!covers(fonts.hn, cp)) hasUncovered = true;
      }
      i += len;
    }
    if (!hasUncovered || chars.length === 0) continue;

    const cs = getComputedStyle(text);
    const fontSize = parseFloat(cs.fontSize) || 16;
    const fill = text.getAttribute('fill') || cs.fill || '#000';
    const fontWeight = text.getAttribute('font-weight') || cs.fontWeight || '400';
    const fontStyle = text.getAttribute('font-style') || cs.fontStyle || 'normal';

    const parent = text.parentNode;
    if (!parent) continue;
    for (const piece of partitionRuns(chars, (cp) => covers(fonts.hn, cp))) {
      let node: SVGElement | null = null;
      if (piece.kind === 'glyph') {
        // Trace the glyph from the first fallback font that has it (same font the
        // browser drew), at the same pen position — so it lands 1:1. Skip when no
        // fallback has it (then it's simply absent, matching nothing to embed).
        const sf = symbolFontFor(fonts.symbols, piece.cp);
        if (!sf) continue;
        const d = sf
          .getPath(String.fromCodePoint(piece.cp), piece.x, piece.y, fontSize)
          .toPathData(2);
        if (!d) continue;
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', d);
        path.setAttribute('fill', fill);
        node = path;
      } else {
        // Covered run: positioned selectable HN text on the alphabetic baseline
        // (font-family inherits from the root).
        const t = document.createElementNS(SVG_NS, 'text');
        t.setAttribute('x', String(piece.x));
        t.setAttribute('y', String(piece.y));
        t.setAttribute('text-anchor', 'start');
        t.setAttribute('font-size', String(fontSize));
        t.setAttribute('font-weight', fontWeight);
        t.setAttribute('font-style', fontStyle);
        t.setAttribute('fill', fill);
        t.textContent = piece.text;
        node = t;
      }
      parent.insertBefore(node, text);
    }
    parent.removeChild(text);
  }
}
