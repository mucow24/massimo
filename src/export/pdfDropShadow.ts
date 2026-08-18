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

type PaintProp = 'fill' | 'stroke';

/** One `<style>`-block rule, as far as a silhouette cares about it. */
interface PaintRule {
  selector: string;
  fill: string | null;
  stroke: string | null;
}

/** The value `prop` is given in a block of CSS text (a `style` attribute or a
 *  rule body), or null if that block doesn't declare it. `fill-opacity` and
 *  friends can't match — a `-` is not a `:`. */
const declIn = (css: string, prop: PaintProp): string | null =>
  new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;}]+)`).exec(css)?.[1].trim() ?? null;

/** `matches` throws on a selector its parser rejects; an imported graphic's
 *  hand-written sheet is not worth an aborted export. */
const matchesSelector = (el: Element, selector: string): boolean => {
  try {
    return el.matches(selector);
  } catch {
    return false;
  }
};

/** The paint rules the markup's own `<style>` blocks declare, in document
 *  order. Drawing editors emit flat `.st0{fill:#d92626}` sheets and that is
 *  what this reads; an at-rule wrapper's inner rules are read as if they
 *  always applied, which for a color is close enough to leave alone. */
function sheetPaintRules(root: Element): PaintRule[] {
  const rules: PaintRule[] = [];
  for (const style of root.querySelectorAll('style')) {
    for (const [, selector, body] of (style.textContent ?? '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = selector.trim();
      if (sel === '' || sel.startsWith('@')) continue;
      rules.push({ selector: sel, fill: declIn(body, 'fill'), stroke: declIn(body, 'stroke') });
    }
  }
  return rules;
}

/** What an element paints for `prop` if left alone: its own `style` attribute
 *  first, then the last matching `<style>` rule, then the presentation
 *  attribute — the order svg2pdf resolves paint in. Null when nothing declares
 *  it and the value is inherited. */
function declaredPaint(el: Element, prop: PaintProp, rules: PaintRule[]): string | null {
  const inline = declIn(el.getAttribute('style') ?? '', prop);
  if (inline !== null) return inline;
  for (let i = rules.length - 1; i >= 0; i--) {
    const value = rules[i][prop];
    if (value !== null && matchesSelector(el, rules[i].selector)) return value;
  }
  return el.getAttribute(prop);
}

/** Force `prop` to the flood color in BOTH channels that can carry it. The
 *  attribute alone is not enough: the clone keeps its class and its `style`
 *  attribute, and either of those outranks an attribute in svg2pdf — an
 *  attribute-only repaint exports the artwork's own colors as the shadow. */
function setPaint(el: Element, prop: PaintProp, color: string): void {
  el.setAttribute(prop, color);
  const style = el.getAttribute('style') ?? '';
  const decl = new RegExp(`((?:^|[;\\s])${prop}\\s*:\\s*)[^;]+`);
  el.setAttribute(
    'style',
    decl.test(style)
      ? style.replace(decl, `$1${color}`)
      : `${style === '' ? '' : `${style};`}${prop}:${color}`,
  );
}

/** Repaint a cloned subtree as a solid silhouette in `color` (feDropShadow floods
 * the source alpha), and drop ids so the clone can't collide with the original. */
function paintSilhouette(el: Element, color: string, rules: PaintRule[]): void {
  const recolor = (e: Element) => {
    for (const prop of ['fill', 'stroke'] as const) {
      const declared = declaredPaint(e, prop, rules);
      // Nothing declared: the value is inherited, and whichever ancestor does
      // declare it is inside this clone and gets recolored too. `none` draws
      // nothing, so it floods nothing.
      if (declared !== null && declared !== 'none') setPaint(e, prop, color);
    }
    e.removeAttribute('id');
  };
  recolor(el);
  el.querySelectorAll('*').forEach(recolor);
  // Shapes that paint via the inherited default (no fill declared anywhere)
  // still cast a shadow, so force the flood color at the clone root.
  if (declaredPaint(el, 'fill', rules) === null) el.setAttribute('fill', color);
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
  const rules = sheetPaintRules(root);
  for (const el of [...root.querySelectorAll('[filter]')]) {
    const id = /url\(#([^)]+)\)/.exec(el.getAttribute('filter') ?? '')?.[1];
    const shadow = id ? hard.get(id) : undefined;
    if (!shadow) continue;

    const clone = el.cloneNode(true) as Element;
    clone.removeAttribute('filter');
    paintSilhouette(clone, shadow.floodColor, rules);
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
