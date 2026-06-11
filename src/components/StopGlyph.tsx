import { DEFAULT_DOT_STYLE, resolveDotRender, type DotRenderParams } from '../model/dotStyle';
import { useViewportStore } from '../state/viewportStore';
import type { DotStyle } from '../model/types';

interface Props {
  cx: number;
  cy: number;
  // Resolved procedural style; undefined falls back to DEFAULT_DOT_STYLE
  // (callers like picker previews don't always have a style in hand).
  style: DotStyle | undefined;
  // Resolves 'line' fills/strokes; falls back to black when the caller has no
  // line in scope (e.g. a picker preview outside any line context).
  lineColor?: string;
  // Text for styles with showServiceCode; falls back to '?' when the caller
  // has no line in scope (same convention as badgeColors).
  serviceCode?: string;
  // Explicit dot DIAMETER from the stop/line override chain — pass
  // `dotSizeOverride(line, stop)`, NOT the resolved size, or
  // default-tracking service-code discs would shrink from r 6 to r 4.
  sizeOverride?: number;
  isHovered?: boolean;
  // Tagged for E2E selection. The test seam is more reliable than guessing
  // by element type + fill, especially for invisible styles (where there's
  // no element).
  stationId?: string;
  lineId?: string;
}

export const DIAMOND_POINTS = (cx: number, cy: number, r: number) =>
  `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`;

// Arm thickness of the X glyph as a fraction of its pre-rotation arm length.
// Lowering this both thins AND lengthens the arms: the saltire always spans
// the same 2r box, so thinner arms reach further into its corners.
const X_ARM_RATIO = 0.2;

// 12-vertex saltire spanning the same 2r box as the other shapes: a plus
// polygon rotated 45°, scaled so the rotated corners land on the box edges.
// A filled polygon (not two crossed strokes) keeps fill/stroke semantics
// uniform across base shapes.
export const X_POINTS = (cx: number, cy: number, r: number): string => {
  const s = (r * Math.SQRT2) / (1 + X_ARM_RATIO);
  const w = X_ARM_RATIO * s;
  const plus: [number, number][] = [
    [-w, -s],
    [w, -s],
    [w, -w],
    [s, -w],
    [s, w],
    [w, w],
    [w, s],
    [-w, s],
    [-w, w],
    [-s, w],
    [-s, -w],
    [-w, -w],
  ];
  return plus
    .map(([x, y]) => `${cx + (x - y) / Math.SQRT2},${cy + (x + y) / Math.SQRT2}`)
    .join(' ');
};

function shapeElement(
  params: DotRenderParams,
  cx: number,
  cy: number,
  attrs: Record<string, unknown>,
) {
  const { shape, r } = params;
  switch (shape) {
    case 'circle':
      return <circle cx={cx} cy={cy} r={r} {...attrs} />;
    case 'square':
      return <rect x={cx - r} y={cy - r} width={2 * r} height={2 * r} {...attrs} />;
    case 'diamond':
      return <polygon points={DIAMOND_POINTS(cx, cy, r)} {...attrs} />;
    case 'x':
      return <polygon points={X_POINTS(cx, cy, r)} {...attrs} />;
  }
}

/**
 * One stop dot, rendered procedurally: `resolveDotRender` makes every styling
 * decision (colors, radius, code legibility); this component only assembles
 * SVG, applies the hover affordance, and tags the E2E data attributes.
 */
export function StopGlyph({
  cx,
  cy,
  style,
  lineColor,
  serviceCode,
  sizeOverride,
  isHovered,
  stationId,
  lineId,
}: Props) {
  const darkMode = useViewportStore((s) => s.darkMode);
  const params = resolveDotRender(
    style ?? DEFAULT_DOT_STYLE,
    lineColor,
    serviceCode,
    darkMode,
    sizeOverride,
  );
  if (!params) return null;

  const dataAttrs = {
    'data-stop-shape': params.shape,
    ...(stationId ? { 'data-stop-station': stationId } : {}),
    ...(lineId ? { 'data-stop-line': lineId } : {}),
  };

  // Hover overrides any base stroke with a 3px white outline so the
  // affordance is uniform across shapes.
  const strokeAttrs = isHovered
    ? { stroke: '#fff', strokeWidth: 3 }
    : params.stroke !== undefined
      ? { stroke: params.stroke, strokeWidth: params.strokeWidth }
      : {};

  const { code } = params;
  // With a code, the data attrs live on the wrapping <g> so the test seam
  // stays one element per stop.
  const el = shapeElement(params, cx, cy, {
    fill: params.fill,
    ...strokeAttrs,
    ...(code ? {} : dataAttrs),
  });
  if (!code) return el;

  return (
    <g {...dataAttrs}>
      {el}
      <text
        x={cx}
        y={cy}
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="'Helvetica Neue', Helvetica, Arial, sans-serif"
        fontSize={params.r * 1.2}
        fontWeight={700}
        fill={code.color}
        pointerEvents="none"
        style={{ userSelect: 'none' }}
      >
        {code.text}
      </text>
    </g>
  );
}
