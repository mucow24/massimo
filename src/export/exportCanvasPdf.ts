/**
 * Canvas → vector PDF export.
 *
 * Reuses the SVG pipeline (`buildExportSvg`) — same content framing, background,
 * and chrome-stripping as the SVG/PNG paths, INCLUDING its text-to-outline pass —
 * then renders that SVG into a true vector PDF with svg2pdf.js + jsPDF: vector
 * line work, outlined text (no font embedded), embedded SVG graphics kept as
 * vectors (except the mask users, which must rasterize — see below).
 *
 * Because `buildExportSvg` already outlines every glyph — a `<defs>` prototype
 * per distinct glyph, a `<use>` per occurrence — the PDF carries no font data and
 * svg2pdf never touches text: no font registration, no baseline correction, no
 * letter-spacing bake, no glyph fallback — the browser's measured pen positions
 * ride on the `<use>` transforms. The licence permits the font in output files
 * only when the end user can't edit the fonts in the result, and outlines satisfy
 * that. svg2pdf renders each `<use>` as a PDF Form XObject, so the shared shapes
 * cost one content stream each however often the map draws them. What remains
 * here are the non-text gaps svg2pdf can't bridge:
 *
 *   Hatch — svg2pdf can't tile a `<pattern>` along a stroke, so hatched bands and
 *   the stop markers on them are baked into clipped solid stripe geometry
 *   (`bakeHatchedPaints`; pure math in the unit-tested `pdfHatch`).
 *
 *   Image shadows — svg2pdf re-parses an svg+xml `<image>` as vectors but ignores
 *   `<filter>`, so a logo's hard `feDropShadow` casing would drop; it's baked into
 *   a real offset silhouette (`bakeImageDropShadows`; pure core in `pdfDropShadow`).
 *
 *   Image masks — that same re-vectorizing has no `<mask>` support, so a graphic
 *   using a mask exports unmasked. A mask has no vector equivalent, so those
 *   graphics (only) are rasterized to a PNG the browser masks correctly
 *   (`rasterizeMaskedImages` in `pdfMask`).
 */

import { jsPDF } from 'jspdf';
import { svg2pdf } from 'svg2pdf.js';
import { HATCH_GAP_WIDTH, HATCH_STRIPE_WIDTH } from '../components/HatchPatterns';
import type { Vec2 } from '../geometry/vec';
import { buildExportSvg, downloadBlob } from './exportCanvas';
import { hatchStripeRects, patternRotation, ribbonFromCenterline, type Bounds } from './pdfHatch';
import { bakeImageDropShadows } from './pdfDropShadow';
import { rasterizeMaskedImages } from './pdfMask';
import { splitAlphaColors } from './pdfAlpha';
import { hoistClipPathTransforms } from './pdfClip';
import { dropUndecodableImages } from './embeddedSvg';
import { pushToast } from '../state/toastStore';

const SVG_NS = 'http://www.w3.org/2000/svg';

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
export function bakeHatchedPaints(svg: SVGSVGElement): void {
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
 * Run every SVG-level bake the PDF converter needs, in order, on the attached
 * export clone. Exported so the sequence — whose ordering is load-bearing in
 * several places — can be tested without driving a full render + download.
 *
 * `el` must already be attached to the document: several steps measure geometry
 * (`getBBox` / `getTotalLength`).
 *
 * Text needs no step here — `buildExportSvg` already outlined it, so nothing is
 * left for svg2pdf to mis-baseline, mis-track, or fail to embed a font for.
 */
export async function prepareSvgForPdf(el: SVGSVGElement): Promise<void> {
  // First, images svg2pdf cannot survive: it decodes every data: href itself,
  // outside its internal try, so a malformed one (a hand-edited doc's literal
  // `%`, a truncated base64 run) would throw away the WHOLE export. One image
  // we cannot rewrite costs that image, not the PDF — and not silently.
  const droppedImages = dropUndecodableImages(el);
  if (droppedImages > 0) {
    if (typeof console !== 'undefined') {
      console.warn(`PDF export: skipped ${droppedImages} image(s) with an undecodable data URI.`);
    }
    pushToast(
      'error',
      `${droppedImages} image${droppedImages === 1 ? '' : 's'} could not be decoded and ${droppedImages === 1 ? 'was' : 'were'} left out of the PDF.`,
    );
  }

  // Move the clip-raster scale(1/64) off region-exclude clip CHILDREN onto the
  // clipPath itself. svg2pdf memoizes each node's parsed path and transforms it
  // in place, so a transform on a clip child compounds once per referencing
  // element — the 2nd user clips at 1/64, the 3rd at 1/4096 — and every band
  // under a reused region-exclude clip renders blank. Hoisting leaves the clip
  // region (and the layering) identical. Runs first, on the cloned canvas.
  hoistClipPathTransforms(el);

  // Bake hatch pattern paints into stripe geometry svg2pdf can convert (must
  // run while attached — it samples path/shape geometry).
  bakeHatchedPaints(el);

  // svg2pdf re-vectorizes svg+xml images and has no <mask> support, so an
  // imported graphic that uses a mask would export unmasked. Rasterize just
  // those to a PNG (the browser applies the mask) svg2pdf embeds verbatim.
  // Must run BEFORE the drop-shadow bake, which then skips them (now PNG).
  await rasterizeMaskedImages(el);

  // Bake hard drop-shadow filters inside embedded svg+xml logos into real
  // offset geometry — svg2pdf renders those images as vectors but ignores
  // <filter>, so their casing/shadow would otherwise vanish.
  bakeImageDropShadows(el);

  // svg2pdf drops the alpha of an 8-digit hex color, so split every #rrggbbaa
  // fill/stroke into a 6-digit color + fill-opacity/stroke-opacity (which it
  // honors). Runs LAST so colors the bakes above copied forward are covered.
  splitAlphaColors(el);
}

/**
 * Build the standalone export SVG, render it into a vector PDF, and trigger a
 * browser download. Same signature as `exportCanvasSvg`/`exportCanvasPng` so it
 * drops into the toolbar's `runExport` helper unchanged.
 */
export async function exportCanvasPdf(
  source: SVGSVGElement,
  background: string,
  basename: string,
): Promise<void> {
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
    await prepareSvgForPdf(el);

    // Page sized to the content. Orientation tracks the aspect so jsPDF doesn't
    // swap the custom [width,height] format on us.
    const doc = new jsPDF({
      unit: 'pt',
      format: [width, height],
      orientation: width >= height ? 'landscape' : 'portrait',
      // FlateDecode the content streams — an outlined map is tens of thousands of
      // vector ops, uncompressed by default; compression shrinks it several-fold.
      compress: true,
    });
    await svg2pdf(el, doc, { x: 0, y: 0, width, height });
    downloadBlob(doc.output('blob'), `${basename}.pdf`);
  } finally {
    document.body.removeChild(holder);
  }
}
