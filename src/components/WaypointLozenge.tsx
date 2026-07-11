import { measureAdvance } from '../geometry/textMeasure';
import { FONT_STACK } from '../util/fonts';

// The on-canvas twin of the sidebar's `.wp-pill` (styles.css): a gray,
// fully-rounded "WP" pill. Fixed gray/white like the CSS pill — theme-blind, so
// it reads on both the light and dark canvas. Sizes derive from the host label's
// font size so the pill scales with the name it prefixes.
const WP_PILL_FILL = '#6b7280';
const WP_PILL_TEXT = '#ffffff';
// Pill text size as a fraction of the label font, plus padding fractions of that
// pill text. Tuned to echo the sidebar pill's proportions.
const PILL_FONT_RATIO = 0.72;
const PILL_PAD_X_RATIO = 0.5;
const PILL_PAD_Y_RATIO = 0.28;

/**
 * A "WP" lozenge sized to sit before a station name on the canvas. It grows
 * LEFTWARD from `rightX` (the name's left edge minus a gap) and centers on
 * `centerY`, so the caller only needs the label's left edge + vertical middle
 * and can wrap this in the same rotation the name uses.
 */
export function WaypointLozenge({
  rightX,
  centerY,
  fontSize,
}: {
  /** X of the pill's right edge (typically the label's left edge minus a gap). */
  rightX: number;
  /** Y the pill centers on (the label block's vertical middle). */
  centerY: number;
  /** The host label's font size; the pill scales off it. */
  fontSize: number;
}) {
  const pillFont = fontSize * PILL_FONT_RATIO;
  const padX = pillFont * PILL_PAD_X_RATIO;
  const padY = pillFont * PILL_PAD_Y_RATIO;
  const textW = measureAdvance('WP', pillFont, 600, false);
  const w = textW + 2 * padX;
  const h = pillFont + 2 * padY;
  const x = rightX - w;
  const y = centerY - h / 2;
  return (
    <g pointerEvents="none" data-waypoint-lozenge="">
      <rect x={x} y={y} width={w} height={h} rx={h / 2} ry={h / 2} fill={WP_PILL_FILL} />
      <text
        x={rightX - w / 2}
        y={centerY}
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily={FONT_STACK}
        fontSize={pillFont}
        fontWeight={600}
        fill={WP_PILL_TEXT}
        style={{ userSelect: 'none' }}
      >
        WP
      </text>
    </g>
  );
}
