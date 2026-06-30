/**
 * Canvas → vector PDF export.
 *
 * Reuses the SVG pipeline (`buildExportSvg`) — same content framing, background,
 * and chrome-stripping as the SVG/PNG paths — then renders that SVG into a true
 * vector PDF with svg2pdf.js + jsPDF: selectable text in the real Helvetica Neue
 * weights, vector line work, embedded SVG graphics kept as vectors.
 *
 * Gaps svg2pdf/jsPDF can't bridge are closed by dedicated steps in the pipeline:
 *
 *   Fonts — jsPDF embeds TrueType (`glyf`) but not PostScript-outline fonts, and
 *   svg2pdf ignores the SVG's own `@font-face` rules. `registerFonts` loads the
 *   map's used faces into jsPDF's VFS (the app ships `.ttf`, so they embed cleanly).
 *
 *   Hatch — svg2pdf can't tile a `<pattern>` along a stroke, so hatched bands and
 *   the stop markers on them are baked into clipped solid stripe geometry
 *   (`bakeHatchedPaints`; pure math in the unit-tested `pdfHatch`).
 *
 *   Image shadows — svg2pdf re-parses an svg+xml `<image>` as vectors but ignores
 *   `<filter>`, so a logo's hard `feDropShadow` casing would drop; it's baked into
 *   a real offset silhouette (`bakeImageDropShadows`; pure core in `pdfDropShadow`).
 *
 *   Text baseline — svg2pdf ignores `dominant-baseline`, so text lands too high;
 *   `normalizeTextBaselines` (pdfText) shifts each run onto the alphabetic baseline.
 *
 *   Uncovered glyphs — characters Helvetica Neue lacks (✈, ↔, …) are outlined to a
 *   `<path>` from the shipped fallback font (`outlineUnsupportedText`; pdfGlyphs).
 */

import { jsPDF } from 'jspdf';
import { svg2pdf } from 'svg2pdf.js';
import { HATCH_GAP_WIDTH, HATCH_STRIPE_WIDTH } from '../components/HatchPatterns';
import type { Vec2 } from '../geometry/vec';
import { buildExportSvg, downloadBlob, mapFileBasename } from './exportCanvas';
import {
  bytesToBase64,
  collectUsedFontFaces,
  FONT_FAMILY,
  fontUrl,
  type FontFaceSpec,
} from './fonts';
import { hatchStripeRects, patternRotation, ribbonFromCenterline, type Bounds } from './pdfHatch';
import { normalizeTextBaselines } from './pdfText';
import { loadGlyphFonts, needsGlyphOutlining, outlineUnsupportedText } from './pdfGlyphs';
import { bakeImageDropShadows } from './pdfDropShadow';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Register the map's used font faces with the jsPDF document so svg2pdf can
 * emit real text instead of falling back to built-in Helvetica. Each face is
 * fetched, base64-encoded, dropped into jsPDF's virtual FS, and bound to the
 * 'Helvetica Neue' family at its weight/style. A face whose file fails to load
 * is skipped (that text will fall back) so the export still produces a PDF.
 */
async function registerFonts(
  doc: jsPDF,
  faces: FontFaceSpec[],
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  for (const face of faces) {
    try {
      const res = await fetchFn(fontUrl(face.file));
      if (!res.ok) continue;
      const b64 = bytesToBase64(new Uint8Array(await res.arrayBuffer()));
      // VFS filename just has to be unique per face.
      const vfsName = face.file.split('/').pop() ?? `${face.weight}-${face.italic}.font`;
      doc.addFileToVFS(vfsName, b64);
      doc.addFont(vfsName, FONT_FAMILY, face.italic ? 'italic' : 'normal', face.weight);
    } catch {
      // Skip this face; its text falls back to the PDF's default font.
    }
  }
}

/** Sample a path's centerline into ~2px-spaced world points (for ribbon offset). */
function samplePathCenterline(path: SVGPathElement): Vec2[] {
  const len = path.getTotalLength();
  if (!(len > 0)) return [];
  const n = Math.max(2, Math.ceil(len / 2));
  const points: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const p = path.getPointAtLength((len * i) / n);
    points.push({ x: p.x, y: p.y });
  }
  return points;
}

/**
 * Replace one hatch-painted element with baked stripe geometry, clipped to
 * `clipChild` (the band ribbon for a stroke, the shape itself for a fill). The
 * stripe columns/phase come from the pure `hatchStripeRects`; here we only emit
 * the clip, the gap-colored backing, and the rotated stripe rects.
 */
function bakeOne(
  el: Element,
  defs: Element,
  clipId: string,
  clipChild: Element,
  bounds: Bounds,
  pattern: SVGPatternElement,
): void {
  const patRects = pattern.querySelectorAll('rect');
  const stripeColor = patRects[0]?.getAttribute('fill') ?? '#000000';
  const gapColor = patRects[1]?.getAttribute('fill') ?? '#ffffff';
  const angle = patternRotation(pattern.getAttribute('patternTransform'));

  const clip = document.createElementNS(SVG_NS, 'clipPath');
  clip.setAttribute('id', clipId);
  clip.setAttribute('clipPathUnits', 'userSpaceOnUse');
  clip.appendChild(clipChild);
  defs.appendChild(clip);

  const group = document.createElementNS(SVG_NS, 'g');
  group.setAttribute('clip-path', `url(#${clipId})`);

  const { minX, minY, maxX, maxY } = bounds;
  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('x', String(minX));
  bg.setAttribute('y', String(minY));
  bg.setAttribute('width', String(maxX - minX));
  bg.setAttribute('height', String(maxY - minY));
  bg.setAttribute('fill', gapColor);
  group.appendChild(bg);

  // Stripes are vertical in a frame rotated about the origin (matching the
  // pattern's userSpaceOnUse + patternTransform).
  const stripes = document.createElementNS(SVG_NS, 'g');
  stripes.setAttribute('transform', `rotate(${angle})`);
  for (const r of hatchStripeRects(bounds, angle, HATCH_STRIPE_WIDTH, HATCH_GAP_WIDTH)) {
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', String(r.x));
    rect.setAttribute('y', String(r.y));
    rect.setAttribute('width', String(r.width));
    rect.setAttribute('height', String(r.height));
    rect.setAttribute('fill', stripeColor);
    stripes.appendChild(rect);
  }
  group.appendChild(stripes);

  el.parentNode?.replaceChild(group, el);
}

/**
 * svg2pdf can't faithfully convert hatch `<pattern>` paints — pattern strokes
 * collapse or drop. Re-express every hatched element on the offscreen export
 * clone as primitive stripe geometry the converter handles natively. Covers
 * both hatch users: band stripes (`stroke="url(#hatch…)"` on a path → clip to
 * the band ribbon) and stop markers (`fill="url(#hatch…)"` on a polygon → clip
 * to the shape itself). Operates in world units; geometry-agnostic. No-op when
 * the map has no hatching.
 */
function bakeHatchedPaints(svg: SVGSVGElement): void {
  const targets = Array.from(svg.querySelectorAll<SVGElement>('*')).filter(
    (el) =>
      (el.getAttribute('stroke') ?? '').startsWith('url(#hatch') ||
      (el.getAttribute('fill') ?? '').startsWith('url(#hatch'),
  );
  if (targets.length === 0) return;

  let defs = svg.querySelector('defs');
  if (!defs) {
    defs = document.createElementNS(SVG_NS, 'defs');
    svg.insertBefore(defs, svg.firstChild);
  }

  let seq = 0;
  for (const el of targets) {
    const stroked = (el.getAttribute('stroke') ?? '').startsWith('url(#hatch');
    const paint = (stroked ? el.getAttribute('stroke') : el.getAttribute('fill')) ?? '';
    const ref = /url\(#([^)]+)\)/.exec(paint)?.[1];
    const pattern = ref ? svg.querySelector(`pattern[id="${ref}"]`) : null;
    if (!(pattern instanceof SVGPatternElement)) continue;

    let clipChild: Element;
    let bounds: Bounds;
    if (stroked && el instanceof SVGPathElement) {
      // Band stripe: the painted region is the stroke ribbon.
      const width = parseFloat(el.getAttribute('stroke-width') ?? '0');
      if (!(width > 0)) continue;
      const ribbon = ribbonFromCenterline(samplePathCenterline(el), width);
      if (!ribbon) continue;
      const poly = document.createElementNS(SVG_NS, 'polygon');
      poly.setAttribute('points', ribbon.points);
      clipChild = poly;
      bounds = ribbon.bounds;
    } else {
      // Filled marker: the painted region is the shape itself.
      const bb = (el as SVGGraphicsElement).getBBox();
      if (!(bb.width > 0) && !(bb.height > 0)) continue;
      const clone = el.cloneNode(true) as Element;
      clone.removeAttribute('fill');
      clone.removeAttribute('stroke');
      clipChild = clone;
      bounds = { minX: bb.x, minY: bb.y, maxX: bb.x + bb.width, maxY: bb.y + bb.height };
    }
    bakeOne(el, defs, `pdf-hatch-clip-${seq++}`, clipChild, bounds, pattern);
  }
}

/**
 * Build the standalone export SVG, render it into a vector PDF, and trigger a
 * browser download. Same signature as `exportCanvasSvg`/`exportCanvasPng` so it
 * drops into the toolbar's `runExport` helper unchanged.
 */
export async function exportCanvasPdf(source: SVGSVGElement, background: string): Promise<void> {
  const { svg, width, height } = await buildExportSvg(source, { background });

  // svg2pdf walks a live element, not a string — reparse and attach offscreen
  // so geometry measurement (getBBox/getTotalLength) resolves.
  const el = new globalThis.DOMParser().parseFromString(svg, 'image/svg+xml')
    .documentElement as unknown as SVGSVGElement;
  const holder = document.createElement('div');
  holder.setAttribute('style', 'position:absolute;left:-99999px;top:0;');
  holder.appendChild(el);
  document.body.appendChild(holder);

  try {
    // Bake hatch pattern paints into stripe geometry svg2pdf can convert (must
    // run while attached — it samples path/shape geometry).
    bakeHatchedPaints(el);

    // Bake hard drop-shadow filters inside embedded svg+xml logos into real
    // offset geometry — svg2pdf renders those images as vectors but ignores
    // <filter>, so their casing/shadow would otherwise vanish.
    bakeImageDropShadows(el);

    // svg2pdf ignores dominant-baseline and renders every run on the alphabetic
    // baseline; re-baseline text with a measured y-shift so it lands where the
    // browser drew it (also needs the attached clone for getBBox).
    normalizeTextBaselines(el);

    // Outline characters Helvetica Neue can't render (and jsPDF can't encode,
    // e.g. astral symbols) into vector paths from the fallback font, so they
    // appear without rasterizing. Runs AFTER normalization so getStartPositionOfChar
    // gives the alphabetic baseline the outline placement expects.
    if (needsGlyphOutlining(el)) {
      outlineUnsupportedText(el, await loadGlyphFonts());
    }

    // Page sized to the content. Orientation tracks the aspect so jsPDF doesn't
    // swap the custom [width,height] format on us.
    const doc = new jsPDF({
      unit: 'pt',
      format: [width, height],
      orientation: width >= height ? 'landscape' : 'portrait',
    });
    await registerFonts(doc, collectUsedFontFaces(el));
    await svg2pdf(el, doc, { x: 0, y: 0, width, height });
    downloadBlob(doc.output('blob'), `${mapFileBasename()}.pdf`);
  } finally {
    document.body.removeChild(holder);
  }
}
