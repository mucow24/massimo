import type { LineStyle } from '../model/types';

// Stable, deterministic SVG-id derived from a color string. Both the pattern
// emitter (this component) and any consumer (e.g. SegmentBand) call this so
// neither side has to know the format. The `variant` selects between the two
// hatch directions: `'hatched'` is the +45° pattern, `'hatched-mirror'` is the
// -45° (mirrored) pattern. Defaults to `'hatched'` so existing callers don't
// have to change.
//
// SVG ids must start with a letter and contain only [A-Za-z0-9_-]; we replace
// every other char with '-'.
export function hatchPatternId(
  color: string,
  variant: 'hatched' | 'hatched-mirror' = 'hatched',
): string {
  const safe = color.replace(/[^A-Za-z0-9]/g, '-');
  const prefix = variant === 'hatched-mirror' ? 'hatch-m' : 'hatch';
  return `${prefix}-${safe || 'x'}`;
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
// All styles use `strokeLinecap: 'butt'`. Dashed needs it so dashes aren't
// extended by strokeWidth/2 (which would collapse the gaps). Solid and
// hatched use it so the linecap extension doesn't poke past the colored
// stop-marker square at the marker's perpendicular edge — a sub-pixel
// rasterization artifact that flickered with the band's hatch pattern.
export function lineStyleStrokeAttrs(
  style: LineStyle,
  color: string,
): {
  stroke: string;
  strokeDasharray: string | undefined;
  strokeLinecap: 'butt';
} {
  if (style === 'hatched' || style === 'hatched-mirror') {
    return {
      stroke: `url(#${hatchPatternId(color, style)})`,
      strokeDasharray: undefined,
      strokeLinecap: 'butt',
    };
  }
  if (style === 'dashed') {
    return {
      stroke: color,
      strokeDasharray: `${DASH_ON} ${DASH_OFF}`,
      strokeLinecap: 'butt',
    };
  }
  return { stroke: color, strokeDasharray: undefined, strokeLinecap: 'butt' };
}

// Companion to lineStyleStrokeAttrs: when a style needs a solid underlay
// painted beneath the foreground stroke (so its "off" positions read as
// opaque background color instead of letting the line behind show through),
// this returns the underlay's stroke attrs. Returns null when no underlay is
// needed (solid; hatched bakes the gap color into the SVG <pattern> directly).
// `underlayColor` matches the canvas background — white normally, black in
// dark mode — so the gaps read as empty canvas, not a stale white.
export function lineStyleUnderlayAttrs(
  style: LineStyle,
  underlayColor: string = UNDERLAY_COLOR,
): { stroke: string; strokeLinecap: 'butt' } | null {
  if (style === 'dashed') return { stroke: underlayColor, strokeLinecap: 'butt' };
  return null;
}

interface Props {
  colors: string[];
  // Gap color baked into each hatch tile; matches the canvas background so
  // the "off" stripes read as empty canvas. Defaults to white.
  underlayColor?: string;
}

// Tall enough that the rotated tile doesn't show edge artifacts at typical
// stroke widths (band stroke is STOP_SIZE = 14).
const TILE_HEIGHT = 32;

// Emits both hatch <pattern> variants (+45° and -45°) per color. Place inside
// an enclosing <svg>'s <defs>. Patterns reference each other only by id (via
// hatchPatternId) so consumers don't have to thread the registry around.
// Always emitting both variants is cheap (a few <pattern> defs) and keeps the
// caller from having to know which variants are in use.
export function HatchPatterns({ colors, underlayColor = UNDERLAY_COLOR }: Props) {
  const tileWidth = Math.max(1, HATCH_STRIPE_WIDTH + HATCH_GAP_WIDTH);
  const variants: Array<{ variant: 'hatched' | 'hatched-mirror'; rotate: number }> = [
    { variant: 'hatched', rotate: 45 },
    { variant: 'hatched-mirror', rotate: -45 },
  ];
  return (
    <>
      {colors.flatMap((color) =>
        variants.map(({ variant, rotate }) => (
          <pattern
            key={`${variant}-${color}`}
            id={hatchPatternId(color, variant)}
            patternUnits="userSpaceOnUse"
            width={tileWidth}
            height={TILE_HEIGHT}
            patternTransform={`rotate(${rotate})`}
          >
            <rect x={0} y={0} width={HATCH_STRIPE_WIDTH} height={TILE_HEIGHT} fill={color} />
            <rect
              x={HATCH_STRIPE_WIDTH}
              y={0}
              width={HATCH_GAP_WIDTH}
              height={TILE_HEIGHT}
              fill={underlayColor}
            />
          </pattern>
        )),
      )}
    </>
  );
}
