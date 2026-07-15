import type { ReactNode } from 'react';
import { DEFAULT_DOT_STYLE, resolveDotRender, type DotRenderParams } from '../model/dotStyle';
import { useDoc } from '../state/store';
import type { DotStyle } from '../model/types';
import { FONT_STACK } from '../util/fonts';

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
  // Two-pass split. StationDots paints all dot strokes ('stroke') and then all
  // dot fills ('fill'), so overlapping dots share one continuous outer border
  // (each fill covers the inner half of every stroke beneath it). Omitted by
  // isolated callers (pickers/inspector previews) that never overlap — they get
  // the combined fill+stroke element as before.
  pass?: 'stroke' | 'fill';
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
  pass,
}: Props) {
  const darkMode = useDoc((s) => s.darkMode);
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
  // affordance is uniform across shapes. Null = this dot has no stroke.
  const strokeAttrs = isHovered
    ? { stroke: '#fff', strokeWidth: 3 }
    : params.stroke !== undefined
      ? // resolveDotRender always sets strokeWidth alongside stroke; `?? 0` is
        // only here to satisfy the optional type on DotRenderParams.
        { stroke: params.stroke, strokeWidth: params.strokeWidth ?? 0 }
      : null;

  // A filled, stroked dot's outline shows as a band of width strokeWidth
  // straddling radius r (a centered SVG stroke spans r ± strokeWidth/2). The
  // two-pass split reproduces that band as a FILLED silhouette outset by
  // strokeWidth/2 (stroke pass) with the body INSET by the same amount (fill
  // pass) — identical to the centered stroke for a lone dot (outer edge still
  // r + strokeWidth/2), but overlapping dots now merge into one outer border
  // because every silhouette is painted before every body.
  const h = strokeAttrs ? strokeAttrs.strokeWidth / 2 : 0;
  // Outset/inset in RADIUS units so the visible band is a uniform strokeWidth on
  // every edge. A circle/square has its edges at radius r (delta = h), but a
  // diamond's edges are only r/√2 from center, so moving them by h needs √2×
  // the radius delta.
  const off = params.shape === 'diamond' ? h * Math.SQRT2 : h;
  // Only filled, stroked, non-x dots split into a silhouette + inset body.
  // Everything else keeps its outline on the single fill-pass element:
  //   - open rings (fill='none'): no fill to merge against, and the seam
  //     element must carry the stroke so it stays selectable + matches the
  //     pre-split render;
  //   - the saltire 'x': concave, so no single radius delta offsets it
  //     uniformly (overlapping stroked X dots are rare, so they don't merge);
  //   - borderless dots: nothing to split.
  const splitBorder = !!strokeAttrs && params.fill !== 'none' && params.shape !== 'x';

  // Stroke pass: the silhouette only, painted UNDER every fill. Carries
  // data-stop-stroke (a separate seam) — the canonical data-stop-* attrs stay
  // on the fill pass so they remain one element per dot. data-stop-stroke's
  // VALUE is the station id: the alt+click deep-pick resolver (hitStack.ts)
  // must map a hit on the border ring back to its station, and a second
  // data-stop-station element per dot would break the one-per-dot locators.
  if (pass === 'stroke') {
    if (!splitBorder || !strokeAttrs) return null;
    return shapeElement({ ...params, r: params.r + off }, cx, cy, {
      fill: strokeAttrs.stroke,
      'data-stop-stroke': stationId ?? '',
      ...(lineId ? { 'data-stop-line': lineId } : {}),
    });
  }

  const { code } = params;
  // With a code, the data attrs live on the wrapping <g> so the test seam
  // stays one element per stop.
  const withCode = (el: ReactNode) =>
    !code ? (
      el
    ) : (
      <g {...dataAttrs}>
        {el}
        <text
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily={FONT_STACK}
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

  // Fill pass: the body fill (+ service code), painted OVER every stroke.
  if (pass === 'fill') {
    // Open ring, stroked X, or a borderless dot: the whole glyph (fill +
    // any outline) stays on this one element — there's no separate silhouette
    // to inset against, so it renders exactly like a lone combined dot.
    if (!splitBorder) {
      return withCode(
        shapeElement(params, cx, cy, {
          fill: params.fill,
          ...(strokeAttrs ?? {}),
          ...(code ? {} : dataAttrs),
        }),
      );
    }
    // Filled dot body, inset by the same amount the silhouette was outset so the
    // silhouette beneath shows exactly strokeWidth of outline.
    return withCode(
      shapeElement({ ...params, r: params.r - off }, cx, cy, {
        fill: params.fill,
        ...(code ? {} : dataAttrs),
      }),
    );
  }

  // Combined (default): fill + centered stroke on one element — unchanged for
  // the isolated previews that never overlap.
  return withCode(
    shapeElement(params, cx, cy, {
      fill: params.fill,
      ...(strokeAttrs ?? {}),
      ...(code ? {} : dataAttrs),
    }),
  );
}
