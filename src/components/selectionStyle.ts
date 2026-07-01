/**
 * One vocabulary for "this item is selected" on the canvas, shared by the
 * station silhouette, route bullets, text labels, and line tags. Polygons and
 * svg images share the dash rhythm (selectionDash) but keep their own 1.5px
 * outline weight — their selection box doubles as handle chrome, which reads
 * deliberately lighter than the item rings.
 *
 * Stroke widths and dash lengths are SCREEN pixels — divide by the committed
 * zoom at the render site so the ring holds a constant weight at any zoom.
 * World-unit rings degrade to sub-pixel ghosts at fit-map zooms and bloat
 * into slabs zoomed in.
 *
 * The wash is the translucent accent fill marking a selected station or tag;
 * its color comes from ThemeColors.accent so it matches the marquee and mode
 * banners in both themes.
 */
export const SELECTION_WASH_OPACITY = 0.2;
export const SELECTION_STROKE_WIDTH = 2;
/** Gap between a route bullet's shape and its ring, in screen px. */
export const SELECTION_RING_PAD = 3;

/** The shared "4 3" selection dash at a constant screen scale. */
export function selectionDash(zoom: number): string {
  return `${4 / zoom} ${3 / zoom}`;
}
