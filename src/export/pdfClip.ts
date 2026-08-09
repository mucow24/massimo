/**
 * Clip-transform hoisting for the PDF export.
 *
 * The region-layering exclusion clips defeat Blink's clip-raster snapping by
 * emitting the clip path at ×`CLIP_RASTER_SCALE` and pulling it back with
 * `CLIP_RASTER_INVERSE_TRANSFORM` (`scale(1/64)`) on the clipPath's child — see
 * [clipRaster.ts](src/components/canvas/clipRaster.ts). On screen that is exact.
 * Through svg2pdf it corrupts every clip that is referenced more than once:
 *
 *   - `GeometryNode.getCachedPath()` parses a node's path ONCE and memoizes it
 *     on the node (`this.cachedPath`).
 *   - Inside a clipPath, `renderCore` applies the transform with
 *     `path.transform(context.transform)` — and `Path.prototype.transform`
 *     mutates the segment coordinates **in place**.
 *   - `ClipPath.apply` re-renders its children on every `applyClipPath`, i.e.
 *     once per referencing element.
 *
 * So the scale compounds against the same cached object: the first user clips
 * correctly, the second at 1/64 of that, the third at 1/4096, and the region
 * collapses to a speck at the origin. Everything under it disappears. Because
 * one region-exclude def is referenced by many renderables, all but the first
 * render blank — which is why most of a map's lines vanished from the PDF.
 *
 * The fix is to move the transform off the child and onto the `<clipPath>`
 * element. svg2pdf folds a clipPath-level transform into the CTM
 * (`setCurrentTransformationMatrix`, undone with `.inversed()`) and never into
 * the cached child path, so it is stable across unlimited references and the
 * clip region is unchanged. Hoisting is also general in a way that rewriting
 * coordinates is not: it is exact for arcs, rotate/translate/matrix, non-uniform
 * scale, and non-`<path>` children (`<rect>`, `<circle>`, `<polygon>`) alike,
 * because it never touches geometry.
 */

/**
 * Move a `transform` from every `<clipPath>`'s children onto the `<clipPath>`
 * itself, composing with any transform it already carries. No-op for clips whose
 * children carry none.
 *
 * Children must agree: hoisting one child's transform would silently move any
 * sibling that doesn't share it, so a disagreeing clipPath is left alone and
 * warned about rather than quietly mis-clipped.
 */
export function hoistClipPathTransforms(svg: SVGSVGElement): void {
  for (const clip of svg.querySelectorAll('clipPath')) {
    const children = [...clip.children];
    if (children.length === 0) continue;

    const transforms = children.map((c) => (c.getAttribute('transform') ?? '').trim());
    if (transforms.every((t) => t === '')) continue;

    const shared = transforms[0];
    if (!transforms.every((t) => t === shared)) {
      // Not hoistable. Left as-is, so it still compounds on reuse — say so
      // instead of implying "untouched" means "fine".
      console.warn(
        `PDF export: clipPath "${clip.id}" has children with differing transforms, so the ` +
          'transform cannot be hoisted; this clip will mis-render wherever it is referenced ' +
          'more than once.',
      );
      continue;
    }

    // An SVG transform list applies left to right, so appending the child's
    // transform to the clipPath's own reproduces the order the child saw.
    const existing = (clip.getAttribute('transform') ?? '').trim();
    clip.setAttribute('transform', existing ? `${existing} ${shared}` : shared);
    for (const child of children) child.removeAttribute('transform');
  }
}
