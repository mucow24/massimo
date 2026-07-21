/**
 * Blink rasterizes clipPath/mask resource content on a coarse grid in the
 * resource's LOCAL user space (~1 unit): a hole edge at x = -250.741 landed
 * snapped near -250.0 on screen, erasing up to a full world unit of the
 * clipped line beyond the geometric hole — visible as white notches wherever
 * the snapped boundary crosses exposed background (first seen at interline
 * gaps, where hole edges stopped being buried under tangent neighbor paint).
 * The snap is zoom-independent in local units, so it scales like geometry on
 * screen and survives every zoom level. Emitting the SAME geometry in
 * ×CLIP_RASTER_SCALE local coordinates under an inverse scale() transform
 * shrinks the snap to 1/CLIP_RASTER_SCALE world units — invisible at any
 * practical zoom. Verified live: the notch reproduces with plain world
 * coordinates (clip AND mask, nonzero AND evenodd) and vanishes with the
 * scaled form. Applies to every clipPath whose content is world geometry
 * (region exclusion holes, branch-seam corridors).
 */
export const CLIP_RASTER_SCALE = 64;

/** `transform` undoing the ×CLIP_RASTER_SCALE emission on clip path content. */
export const CLIP_RASTER_INVERSE_TRANSFORM = `scale(${1 / CLIP_RASTER_SCALE})`;
