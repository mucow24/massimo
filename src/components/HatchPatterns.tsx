import type { LineStyle } from '../model/types';

// Stable, deterministic SVG-id derived from a color string. Both the pattern
// emitter (this component) and any consumer (e.g. SegmentBand) call this so
// neither side has to know the format.
//
// SVG ids must start with a letter and contain only [A-Za-z0-9_-]; we replace
// every other char with '-'.
export function hatchPatternId(color: string): string {
  const safe = color.replace(/[^A-Za-z0-9]/g, '-');
  return `hatch-${safe || 'x'}`;
}

// Locked-in pattern geometry, both tuned visually against the NYC subway
// map's dashed-service convention.
//
//   hatched: 2px diagonal stripes separated by 2px white stripes, rotated
//            45° in world space.
//   dashed : 2px painted dashes separated by 2px gaps along the stroke,
//            backed by a solid white underlay so the gaps read as white.
export const HATCH_STRIPE_WIDTH = 2;
export const HATCH_GAP_WIDTH = 2;
const DASH_ON = 2;
const DASH_OFF = 2;

// Opaque fill painted in the "off" positions of dashed/hatched strokes so
// lines passing behind them are fully occluded instead of bleeding through.
const UNDERLAY_COLOR = '#fff';

// Resolve a per-segment line style into the SVG stroke attributes shared by
// every code path that paints a band-stroke (SegmentBand + the selected-line
// highlight overlay in MapCanvas). Keeps both call sites in lockstep.
//
// Note: dashed switches `strokeLinecap` to 'butt'. With the band's default
// 'square' caps, each dash is extended by strokeWidth/2 on each end; gaps
// shorter than strokeWidth would disappear and the line would render solid.
export function lineStyleStrokeAttrs(
  style: LineStyle,
  color: string,
): {
  stroke: string;
  strokeDasharray: string | undefined;
  strokeLinecap: 'butt' | 'square';
} {
  if (style === 'hatched') {
    return {
      stroke: `url(#${hatchPatternId(color)})`,
      strokeDasharray: undefined,
      strokeLinecap: 'square',
    };
  }
  if (style === 'dashed') {
    return {
      stroke: color,
      strokeDasharray: `${DASH_ON} ${DASH_OFF}`,
      strokeLinecap: 'butt',
    };
  }
  return { stroke: color, strokeDasharray: undefined, strokeLinecap: 'square' };
}

// Companion to lineStyleStrokeAttrs: when a style needs a solid underlay
// painted beneath the foreground stroke (so its "off" positions read as
// opaque white instead of letting the line behind show through), this
// returns the underlay's stroke attrs. Returns null when no underlay is
// needed (solid; hatched bakes white into the SVG <pattern> directly).
export function lineStyleUnderlayAttrs(
  style: LineStyle,
): { stroke: string; strokeLinecap: 'butt' | 'square' } | null {
  if (style === 'dashed') return { stroke: UNDERLAY_COLOR, strokeLinecap: 'butt' };
  return null;
}

interface Props {
  colors: string[];
}

// Tall enough that the rotated tile doesn't show edge artifacts at typical
// stroke widths (band stroke is STOP_SIZE = 14).
const TILE_HEIGHT = 32;

// Emits one <pattern> per color. Place inside an enclosing <svg>'s <defs>.
// Patterns reference each other only by id (via hatchPatternId) so consumers
// don't have to thread the registry around.
export function HatchPatterns({ colors }: Props) {
  const tileWidth = Math.max(1, HATCH_STRIPE_WIDTH + HATCH_GAP_WIDTH);
  return (
    <>
      {colors.map((color) => (
        <pattern
          key={color}
          id={hatchPatternId(color)}
          patternUnits="userSpaceOnUse"
          width={tileWidth}
          height={TILE_HEIGHT}
          patternTransform="rotate(45)"
        >
          <rect x={0} y={0} width={HATCH_STRIPE_WIDTH} height={TILE_HEIGHT} fill={color} />
          <rect
            x={HATCH_STRIPE_WIDTH}
            y={0}
            width={HATCH_GAP_WIDTH}
            height={TILE_HEIGHT}
            fill={UNDERLAY_COLOR}
          />
        </pattern>
      ))}
    </>
  );
}
