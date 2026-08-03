import type { ComponentPropsWithoutRef } from 'react';
import { FONT_STACK } from '../util/fonts';
import { capCenterDy } from '../geometry/textMeasure';

/** Diameter of the brand bullet, matching the height the "Massimo" wordmark
 *  occupied (13px text in its em box). */
export const BRAND_BULLET_SIZE = 18;

interface Props extends ComponentPropsWithoutRef<'svg'> {
  /** Diameter in px. The badge uses the default; the easter-egg ball scales. */
  size?: number;
  /** Drops the role and the <title>, for a copy that isn't the wordmark — the
   *  loose bouncing ball, which must not read as a second "Massimo". */
  decorative?: boolean;
}

/**
 * The app's wordmark: an "M" route bullet, drawn the way the canvas draws
 * inline bullets — cap-centered on the alphabetic baseline rather than
 * `dominantBaseline`, whose metrics are platform-dependent. The two colors are
 * CSS vars so dark mode swaps them: black disc / white M by day, the inverse
 * by night.
 *
 * The viewBox is centered on the disc, so a rotation applied by an ancestor
 * turns the glyph about the ball's middle with nothing further to arrange.
 */
export function BrandBullet({ size = BRAND_BULLET_SIZE, decorative, className, ...rest }: Props) {
  const r = size / 2;
  const fontSize = r * 1.1;
  return (
    <svg
      className={className ? `brand-bullet ${className}` : 'brand-bullet'}
      width={size}
      height={size}
      viewBox={`${-r} ${-r} ${size} ${size}`}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative || undefined}
      {...rest}
    >
      {/* Both the hover tooltip and the accessible name — the badge is the only
          place the app's name still appears in the bar. */}
      {!decorative && <title>Massimo</title>}
      <circle r={r} fill="var(--brand-disc)" />
      <text
        x={0}
        y={capCenterDy(fontSize)}
        textAnchor="middle"
        fontFamily={FONT_STACK}
        fontSize={fontSize}
        fontWeight={700}
        fill="var(--brand-glyph)"
      >
        M
      </text>
    </svg>
  );
}
