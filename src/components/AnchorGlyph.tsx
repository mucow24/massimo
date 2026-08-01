// The anchor mark, in one place, for the three surfaces that draw it: the
// inspector's anchor row badge, the canvas anchor layer, and the station
// layout editor's grab handle.
//
// Authored in a 15×15 box to match the @radix-ui/react-icons the chrome uses,
// so the badge reads as one of that set. The canvas scales the same paths by
// `size / ANCHOR_ICON_BOX` rather than re-drawing them at world scale — a
// second hand-tuned copy is exactly how two surfaces drift apart.
//
// Stroked in `currentColor` with no fill, so every caller controls the color
// by setting `color` (or `stroke` on a wrapping <g>) instead of threading a
// prop through.

/** Side of the authoring box. Scale factor for a target size S is S / this. */
export const ANCHOR_ICON_BOX = 15;

/**
 * The mark itself: ring, shank, stock (crossbar), and the fluke arc. Renders
 * bare SVG children, so it drops into a `<g>` on the canvas as readily as into
 * an `<svg>` in the chrome.
 *
 * `strokeWidth` is in AUTHORING units — a caller drawing at world size S sees
 * an effective weight of `strokeWidth * S / ANCHOR_ICON_BOX`, which is what
 * keeps the mark's proportions identical at every size.
 */
export function AnchorMark({ strokeWidth = 1.4 }: { strokeWidth?: number }) {
  return (
    <g
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Ring */}
      <circle cx={7.5} cy={2.8} r={1.7} />
      {/* Shank, from just under the ring down past the fluke arc's low point */}
      <line x1={7.5} y1={4.5} x2={7.5} y2={12.4} />
      {/* Stock (the crossbar) */}
      <line x1={4.4} y1={6.2} x2={10.6} y2={6.2} />
      {/* Flukes: a shallow arc (r > half-chord, so it is not a semicircle and
          stays inside the box) sweeping BELOW the chord — sweep-flag 0. */}
      <path d="M 3.3 9.4 A 5 5 0 0 0 11.7 9.4" />
    </g>
  );
}

/** Toolbar-sized icon, matching the 15×15 Radix icons beside it. */
export function AnchorGlyph() {
  return (
    <svg
      width={ANCHOR_ICON_BOX}
      height={ANCHOR_ICON_BOX}
      viewBox={`0 0 ${ANCHOR_ICON_BOX} ${ANCHOR_ICON_BOX}`}
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      <AnchorMark />
    </svg>
  );
}
