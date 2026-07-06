import type { Line, RouteBulletShape } from '../model/types';
import { FONT_STACK } from '../util/fonts';
import { useThemeColors } from '../state/theme';
import { badgeColors } from './badge';
import { BulletShape } from './bulletShape';

/** Outline thickness of an unfilled bullet, as a fraction of its diameter. */
const HOLLOW_STROKE_RATIO = 0.12;

interface Props {
  /** Service code from the user's text (`<CODE>`, `[CODE]`, `{CODE}`). */
  code: string;
  /** Badge silhouette — picked by the token's delimiter. */
  shape: RouteBulletShape;
  /** Filled = line-color shape. Unfilled (doubled delimiter) = line-color
   *  outline around a canvas-matched (white/black) interior. */
  filled: boolean;
  /** Bullet diameter in world units — set by the host label's measurement. */
  diameter: number;
  /** Center of the bullet in the host's local frame. */
  cx: number;
  cy: number;
  /** Lookup from service code → line. When the code doesn't resolve, a gray
   *  bullet with a "?" is rendered. */
  lineByService: Map<string, Line>;
}

/**
 * Inline route bullet rendered inside a label's text flow. A circle, square,
 * or diamond in the line's color with the service code centered inside it.
 * Used by both TextLabel (LabelView) and station-name (StationView)
 * rendering.
 */
export function InlineBullet({ code, shape, filled, diameter, cx, cy, lineByService }: Props) {
  const themeColors = useThemeColors();
  const r = diameter / 2;
  const { fill: lineColor, textColor, code: display } = badgeColors(lineByService.get(code));
  const strokeWidth = filled ? undefined : diameter * HOLLOW_STROKE_RATIO;
  return (
    <g transform={`translate(${cx} ${cy})`} pointerEvents="none" data-inline-bullet={code}>
      <BulletShape
        shape={shape}
        // Centered stroke: inset the outline by half its width so the hollow
        // bullet's outer edge matches the filled silhouette (and the measured
        // advance).
        r={filled ? r : r - strokeWidth! / 2}
        fill={filled ? lineColor : themeColors.underlay}
        stroke={filled ? undefined : lineColor}
        strokeWidth={strokeWidth}
      />
      <text
        x={0}
        y={0}
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily={FONT_STACK}
        fontSize={r * 1.1}
        fontWeight={700}
        fill={filled ? textColor : lineColor}
        style={{ userSelect: 'none' }}
      >
        {display}
      </text>
    </g>
  );
}
