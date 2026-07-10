/**
 * Bake hard SVG drop-shadows into real geometry for the PDF export.
 *
 * Map logos are embedded as `<image href="data:image/svg+xml,…">`, and some of
 * those inner SVGs use an `<feDropShadow>` filter to draw a contrasting casing
 * (a hard, un-blurred offset silhouette — the "white shadow on the left"). svg2pdf
 * renders an svg+xml `<image>` by re-parsing it as vectors through a node tree
 * with NO filter support, so the shadow silently vanishes from the PDF.
 *
 * A hard drop-shadow (`stdDeviation=0`) is exactly the filtered shape duplicated,
 * offset by (dx,dy), recolored to the flood color, and drawn behind — so we
 * re-express it as that literal geometry, which svg2pdf renders natively. Stays
 * vector, no rasterizing, pixel-faithful to the browser. Blurred shadows
 * (`stdDeviation>0`) can't be baked to exact geometry and are left as-is (warned).
 */

import { decodeEmbeddedSvgImage, setEmbeddedImageHref } from './embeddedSvg';

interface HardShadow {
  dx: number;
  dy: number;
  floodColor: string;
  floodOpacity: number;
}

/** Hard-drop-shadow params for a `<filter>` whose sole primitive is a zero-blur
 * `<feDropShadow>`; null if it's anything else (blurred, multi-primitive, …). */
function hardShadowOf(filter: Element): HardShadow | null {
  const kids = [...filter.children];
  if (kids.length !== 1 || kids[0].tagName.toLowerCase() !== 'fedropshadow') return null;
  const fe = kids[0];
  // feDropShadow's stdDeviation defaults to 2 (blurred); only an explicit,
  // all-zero value is the hard offset we can reproduce exactly.
  const std = fe.getAttribute('stdDeviation');
  if (
    std === null ||
    !std
      .trim()
      .split(/[\s,]+/)
      .every((n) => parseFloat(n) === 0)
  )
    return null;
  return {
    dx: parseFloat(fe.getAttribute('dx') ?? '2'),
    dy: parseFloat(fe.getAttribute('dy') ?? '2'),
    floodColor: fe.getAttribute('flood-color') ?? '#000000',
    floodOpacity: parseFloat(fe.getAttribute('flood-opacity') ?? '1'),
  };
}

/** Repaint a cloned subtree as a solid silhouette in `color` (feDropShadow floods
 * the source alpha), and drop ids so the clone can't collide with the original. */
function paintSilhouette(el: Element, color: string): void {
  const recolor = (e: Element) => {
    if (e.getAttribute('fill') !== 'none' && e.getAttribute('fill') !== null) {
      e.setAttribute('fill', color);
    }
    if (e.getAttribute('stroke') !== 'none' && e.getAttribute('stroke') !== null) {
      e.setAttribute('stroke', color);
    }
    e.removeAttribute('id');
  };
  recolor(el);
  el.querySelectorAll('*').forEach(recolor);
  // Shapes that paint via the inherited default (no fill attr) still cast a
  // shadow, so force the flood color at the clone root.
  if (el.getAttribute('fill') === null) el.setAttribute('fill', color);
}

/**
 * Rewrite every hard `feDropShadow` in an inner SVG markup string into baked
 * geometry. Returns the input unchanged when there's nothing bakeable (no
 * drop-shadow, or only blurred ones — which are warned about).
 */
export function bakeHardDropShadow(markup: string): string {
  if (!markup.includes('feDropShadow')) return markup; // fast path: nothing to do
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  const root = doc.documentElement;

  const hard = new Map<string, HardShadow>();
  let sawBlurred = false;
  for (const filter of root.querySelectorAll('filter')) {
    const id = filter.getAttribute('id');
    const shadow = hardShadowOf(filter);
    if (id && shadow) hard.set(id, shadow);
    else if ([...filter.children].some((c) => c.tagName.toLowerCase() === 'fedropshadow')) {
      sawBlurred = true;
    }
  }
  if (hard.size === 0) {
    if (sawBlurred && typeof console !== 'undefined') {
      console.warn(
        'PDF export: a blurred drop-shadow on an embedded image cannot be baked to vectors and will be omitted.',
      );
    }
    return markup;
  }

  let baked = false;
  for (const el of [...root.querySelectorAll('[filter]')]) {
    const id = /url\(#([^)]+)\)/.exec(el.getAttribute('filter') ?? '')?.[1];
    const shadow = id ? hard.get(id) : undefined;
    if (!shadow) continue;

    const clone = el.cloneNode(true) as Element;
    clone.removeAttribute('filter');
    paintSilhouette(clone, shadow.floodColor);
    if (shadow.floodOpacity !== 1) clone.setAttribute('opacity', String(shadow.floodOpacity));
    // Offset in the element's own user space (append after its transform), which
    // is where feDropShadow's userSpaceOnUse offset applies.
    const base = el.getAttribute('transform');
    clone.setAttribute(
      'transform',
      `${base ? base + ' ' : ''}translate(${shadow.dx} ${shadow.dy})`,
    );

    el.parentNode!.insertBefore(clone, el); // drawn behind the original
    el.removeAttribute('filter');
    baked = true;
  }
  if (!baked) return markup;

  // Drop the now-unreferenced filter defs we baked.
  for (const filter of [...root.querySelectorAll('filter')]) {
    const id = filter.getAttribute('id');
    if (id && hard.has(id)) filter.remove();
  }
  return new XMLSerializer().serializeToString(root);
}

/**
 * Walk the export SVG and bake hard drop-shadows inside every embedded
 * `data:image/svg+xml` image, rewriting the href in place. Raster images and
 * shadow-free SVGs are left untouched. Re-encodes as a URL-encoded data-URI
 * (svg2pdf decodes both base64 and URL-encoded forms).
 */
export function bakeImageDropShadows(svg: SVGSVGElement): void {
  for (const image of svg.querySelectorAll('image')) {
    const markup = decodeEmbeddedSvgImage(image);
    if (markup === null) continue;

    const baked = bakeHardDropShadow(markup);
    if (baked === markup) continue;

    setEmbeddedImageHref(image, `data:image/svg+xml,${encodeURIComponent(baked)}`);
  }
}
