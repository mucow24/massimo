import type { Line } from '../model/types';
import { badgeColors } from './badge';

interface Props {
  /** Service code from the user's text (`<CODE>`). */
  code: string;
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
 * Inline route bullet rendered inside a label's text flow. A filled circle
 * in the line's color with the service code centered inside it. Used by
 * both TextLabel (LabelView) and station-name (StationView) rendering.
 */
export function InlineBullet({ code, diameter, cx, cy, lineByService }: Props) {
  const r = diameter / 2;
  const { fill, textColor, code: display } = badgeColors(lineByService.get(code));
  return (
    <g transform={`translate(${cx} ${cy})`} pointerEvents="none" data-inline-bullet={code}>
      <circle cx={0} cy={0} r={r} fill={fill} />
      <text
        x={0}
        y={0}
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="'Helvetica Neue', Helvetica, Arial, sans-serif"
        fontSize={r * 1.1}
        fontWeight={700}
        fill={textColor}
        style={{ userSelect: 'none' }}
      >
        {display}
      </text>
    </g>
  );
}
