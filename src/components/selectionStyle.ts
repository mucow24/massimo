/**
 * One vocabulary for "this item is selected" on the canvas, shared by the
 * station silhouette, route bullets, text labels, polygons, svg images, and
 * line tags.
 *
 * The selection outline is a two-tone ring: the theme's selection ink as a
 * narrow CORE over a wider opposite-color UNDERLAY (selectionOutlineTones),
 * leaving SELECTION_EDGE_WIDTH of the underlay on each side of the core. It
 * flips with the theme — black core / white halo (white-black-white) on the
 * light canvas, white core / black halo (black-white-black) on the dark one —
 * so the dominant center stroke always matches the theme's ink while the
 * opposite-color halo keeps it legible against a same-colored item. A single
 * theme-colored ring vanished around black/white items; this pair never does.
 * First shipped on the transfer selection outline (#223).
 *
 * The no-snap contract: chrome sized off the COMMITTED zoom (`X / zoom`) scales
 * with the map during a pan/zoom gesture and then snaps back when the gesture
 * commits — which reads as broken. So the rings hold their screen weight with
 * `vectorEffect="non-scaling-stroke"` (the browser recomputes the stroke
 * against the live viewBox, no zoom subscription, nothing to snap) and their
 * geometry stays in world units — a pad growing/shrinking with the map reads as
 * "attached to the item", not as a glitch. vector-effect only compensates
 * stroke WIDTH, so the rings carry no dashes (a dash pattern would scale with
 * the map) and no geometry is divided by zoom. Interactive handles, whose body
 * size vector-effect can't touch, instead size off the LIVE gesture zoom (see
 * useLiveZoom) so they too stay screen-constant without snapping.
 *
 * The wash is the translucent accent fill marking a selected station or tag;
 * its color comes from ThemeColors.accent so it matches the marquee and mode
 * banners in both themes.
 */
import type { ThemeColors } from '../state/theme';

export const SELECTION_WASH_OPACITY = 0.2;
/** Weight of a single-color selection stroke (screen px). Held constant by
 *  vectorEffect="non-scaling-stroke" at the render site. Used for the one-tone
 *  cases (the layout-edit white focus border); the two-tone rings use
 *  selectionOutlineTones() below. */
export const SELECTION_STROKE_WIDTH = 2;
/** Gap between a route bullet's shape and its ring, in WORLD units — so it
 *  scales with the map and never divides by the committed zoom (no snap). */
export const SELECTION_RING_PAD = 3;

/** The core (ink) stroke's screen width in the two-tone outline. */
export const SELECTION_CORE_WIDTH = 2;
/** The underlay showing past each side of the core, in screen px. */
export const SELECTION_EDGE_WIDTH = 1;

/**
 * The two stacked strokes of the two-tone selection outline for the active
 * theme, in paint order: the wider UNDERLAY first (theme `underlay` — white in
 * day, black in night), then the CORE on top (theme `selectionStroke` — black
 * in day, white in night). So the ring reads white-black-white on the light
 * canvas and black-white-black on the dark one. Each render site maps this over
 * its own shape (circle / rect / path / polygon), spreading `stroke` +
 * `strokeWidth` and always adding `vectorEffect="non-scaling-stroke"` +
 * `fill="none"` so the widths stay screen-constant with no zoom subscription.
 */
export function selectionOutlineTones(theme: Pick<ThemeColors, 'selectionStroke' | 'underlay'>) {
  return [
    {
      tone: 'edge',
      stroke: theme.underlay,
      strokeWidth: SELECTION_CORE_WIDTH + 2 * SELECTION_EDGE_WIDTH,
    },
    { tone: 'core', stroke: theme.selectionStroke, strokeWidth: SELECTION_CORE_WIDTH },
  ] as const;
}

/**
 * Dash pattern ("on off") for the rings that carry one — route bullets, text
 * labels, polygons, and svg images. Applied to BOTH tones (they share geometry,
 * so the dashes align). Deliberately NOT baked into SELECTION_OUTLINE_TONES:
 * stations, line tags, and transfers stay solid, matching their pre-two-tone
 * look. Caveat: vector-effect="non-scaling-stroke" holds the stroke WIDTH
 * screen-constant but (in Chromium) not the dash pattern — so the dash spacing
 * scales with the map. Values are screen px at zoom 1 (the old `4/zoom 3/zoom`
 * at zoom 1), so the ring reads the same as it always did at rest.
 */
export const SELECTION_DASH = '4 3';
