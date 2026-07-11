import { waypointLozengeSize } from '../geometry/waypointLozenge';
import { FONT_STACK } from '../util/fonts';

// The on-canvas twin of the sidebar's `.wp-pill` (styles.css): a gray,
// fully-rounded "WP" pill. Fixed gray/white like the CSS pill — theme-blind, so
// it reads on both the light and dark canvas. Its size (shared with the hit /
// selection geometry via waypointLozengeSize) derives from the host label's
// font size so the pill scales with the label it stands in for.
const WP_PILL_FILL = '#6b7280';
const WP_PILL_TEXT = '#ffffff';

/**
 * A "WP" lozenge, drawn growing LEFTWARD from `rightX` and centered on
 * `centerY`, so the caller positions it from the label box's right edge +
 * vertical middle and wraps it in the label's rotation.
 */
export function WaypointLozenge({
  rightX,
  centerY,
  fontSize,
}: {
  /** X of the pill's right edge. */
  rightX: number;
  /** Y the pill centers on (the label block's vertical middle). */
  centerY: number;
  /** The host label's font size; the pill scales off it. */
  fontSize: number;
}) {
  const { w, h, pillFont } = waypointLozengeSize(fontSize);
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
