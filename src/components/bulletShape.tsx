import type { RouteBulletShape } from '../model/types';

interface Props {
  shape: RouteBulletShape;
  /** Half-extent in local units (radius for circle, half-side for square,
   *  half-diagonal for diamond), centered on the local origin. */
  r: number;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
}

/**
 * The badge shape shared by route bullets: a circle, square, or diamond
 * centered on (0, 0) with half-extent `r`. Used by both the free-floating
 * RouteBulletView and the inline-text InlineBullet so the two stay
 * geometrically identical.
 */
export function BulletShape({ shape, r, fill, stroke, strokeWidth }: Props) {
  const strokeProps = stroke ? { stroke, strokeWidth } : {};
  if (shape === 'square') {
    return <rect x={-r} y={-r} width={r * 2} height={r * 2} fill={fill} {...strokeProps} />;
  }
  if (shape === 'diamond') {
    return <polygon points={`0,${-r} ${r},0 0,${r} ${-r},0`} fill={fill} {...strokeProps} />;
  }
  return <circle cx={0} cy={0} r={r} fill={fill} {...strokeProps} />;
}
