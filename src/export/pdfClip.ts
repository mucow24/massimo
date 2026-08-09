/**
 * Clip-transform flattening for the PDF export.
 *
 * The region-layering exclusion clips defeat Blink's clip-raster snapping by
 * authoring the clip path at ×64 magnitude and pulling it back with a
 * `transform="scale(1/64)"` on the clipPath's child `<path>` (see the on-screen
 * region system / the SVG clip-raster note). Blink honors that transform when it
 * composites on screen — but svg2pdf, and the PDF viewers that open the result
 * (Edge, poppler, …), do NOT reliably apply a transform sitting on a clipPath
 * child: they collapse the clip and drop everything inside it, so every band
 * under a region-exclude clip renders as blank/white in the PDF.
 *
 * The fix is to bake that transform into the path coordinates: an identical clip
 * region, expressed as plain coordinates with no transform and no ×64
 * magnitudes, which every renderer handles. Because the shipped clips are a pure
 * uniform `scale` over `M`/`L`/`Z` paths, baking is just multiplying every
 * coordinate by the scale factor — nothing about the clipped region changes, so
 * the map's layering is byte-for-byte the same as on screen. Anything that isn't
 * a pure uniform scale, or a path with an arc (whose flag/angle params must not
 * be scaled), is left untouched rather than risk corrupting a clip.
 */

/**
 * Bake a `transform="scale(s)"` on every `<clipPath>` child `<path>` into its
 * coordinates, removing the transform. No-op for clips that don't use the trick.
 */
export function flattenClipPathTransforms(svg: SVGSVGElement): void {
  for (const child of svg.querySelectorAll('clipPath > path[transform]')) {
    const t = (child.getAttribute('transform') ?? '').trim();
    // Pure uniform scale only — `scale(s)` or `scale(s, s)`.
    const m = /^scale\(\s*(-?[\d.]+)\s*(?:,\s*(-?[\d.]+)\s*)?\)$/.exec(t);
    if (!m) continue;
    const sx = parseFloat(m[1]);
    const sy = m[2] !== undefined ? parseFloat(m[2]) : sx;
    if (sx !== sy) continue; // non-uniform: multiplying every number is invalid

    const d = child.getAttribute('d');
    if (!d) continue;
    // Arc params (rx ry x-axis-rotation large-arc sweep x y) mix coordinates with
    // flags/angles that must NOT be scaled, so skip any path with an arc.
    if (/[aA]/.test(d)) continue;

    child.setAttribute(
      'd',
      d.replace(/-?\d*\.?\d+(?:[eE][-+]?\d+)?/g, (n) => String(parseFloat(n) * sx)),
    );
    child.removeAttribute('transform');
  }
}
