import { STOP_DOT_RADIUS } from '../geometry/orientation';
import type { DotShape } from '../model/types';

interface Props {
  cx: number;
  cy: number;
  shape: DotShape | undefined;
  // Fill for 'filled-line-color'; falls back to black when the caller has no
  // line in scope (e.g. a picker preview outside any line context).
  lineColor?: string;
  isHovered?: boolean;
  // Tagged for E2E selection. The test seam is more reliable than guessing
  // by element type + fill, especially for "none" (where there's no element).
  stationId?: string;
  lineId?: string;
}

const DIAMOND_POINTS = (cx: number, cy: number, r: number) =>
  `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`;

export function StopGlyph({ cx, cy, shape, lineColor, isHovered, stationId, lineId }: Props) {
  const resolved: DotShape = shape ?? 'filled-black';
  if (resolved === 'none') return null;

  const r = STOP_DOT_RADIUS;
  const dataAttrs = {
    'data-stop-shape': resolved,
    ...(stationId ? { 'data-stop-station': stationId } : {}),
    ...(lineId ? { 'data-stop-line': lineId } : {}),
  };

  // Hover overrides any base stroke with a 3px white outline so the
  // affordance is uniform across shapes.
  const hoverStroke = isHovered ? { stroke: '#fff', strokeWidth: 3 } : null;

  if (resolved === 'filled-black-diamond' || resolved === 'filled-white-diamond') {
    const fill = resolved === 'filled-black-diamond' ? '#000' : '#fff';
    return (
      <polygon
        points={DIAMOND_POINTS(cx, cy, r)}
        fill={fill}
        {...(hoverStroke ?? {})}
        {...dataAttrs}
      />
    );
  }

  // Circle variants
  let fill = '#000';
  let stroke: string | undefined;
  let strokeWidth: number | undefined;
  switch (resolved) {
    case 'filled-black':
      fill = '#000';
      break;
    case 'open-black':
      fill = 'none';
      stroke = '#000';
      strokeWidth = 1.5;
      break;
    case 'filled-black-white-stroke':
      fill = '#000';
      stroke = '#fff';
      strokeWidth = 2;
      break;
    case 'filled-white':
      fill = '#fff';
      break;
    case 'open-white':
      fill = 'none';
      stroke = '#fff';
      strokeWidth = 1.5;
      break;
    case 'filled-white-black-stroke':
      fill = '#fff';
      stroke = '#000';
      strokeWidth = 2;
      break;
    case 'filled-line-color':
      fill = lineColor ?? '#000';
      break;
  }

  if (hoverStroke) {
    stroke = hoverStroke.stroke;
    strokeWidth = hoverStroke.strokeWidth;
  }

  return (
    <circle
      cx={cx}
      cy={cy}
      r={r}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      {...dataAttrs}
    />
  );
}
