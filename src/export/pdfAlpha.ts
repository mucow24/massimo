// svg2pdf.js (2.7) truncates an 8-digit hex color (#rrggbbaa) to its first 6
// digits and discards the alpha, so a translucent fill/stroke prints fully
// OPAQUE in the exported PDF. It DOES honor a separate fill-opacity /
// stroke-opacity attribute (which jsPDF writes as a real PDF ExtGState /ca /CA),
// so this pass rewrites every hex8 paint on the offscreen export clone into a
// 6-digit color plus the matching opacity attribute — composing (multiplying)
// with any opacity the element already carries.
//
// The SVG and PNG export paths need none of this (the browser renders hex8 and
// the canvas rasterizer composites the alpha natively); it's the svg2pdf path
// only. Run it LAST, after the other bakes, so hex8 colors those steps copy
// forward (a translucent line color baked into a hatch stripe, an outlined glyph
// inheriting a translucent label color, a drop-shadow flood) are caught too.

const HEX8 = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})$/;

export function splitAlphaColors(svg: SVGSVGElement): void {
  const els: Element[] = [svg, ...Array.from(svg.querySelectorAll<SVGElement>('*'))];
  for (const el of els) {
    for (const paint of ['fill', 'stroke'] as const) {
      const m = HEX8.exec(el.getAttribute(paint) ?? '');
      if (!m) continue;
      const alpha = parseInt(m[2], 16) / 255;
      el.setAttribute(paint, `#${m[1]}`);
      const opacityAttr = `${paint}-opacity`;
      const prior = parseFloat(el.getAttribute(opacityAttr) ?? '1');
      const composed = (Number.isFinite(prior) ? prior : 1) * alpha;
      el.setAttribute(opacityAttr, String(composed));
    }
  }
}
