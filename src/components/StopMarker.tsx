import type { StopMarkerSpec } from '../geometry/interlining';
import { hatchPatternId, lineStyleStrokeAttrs, lineStyleUnderlayAttrs } from './HatchPatterns';
import { STOP_SIZE } from '../geometry/orientation';

const HALF = STOP_SIZE / 2;

interface Props {
  spec: StopMarkerSpec;
  // Optional override (selection desaturation). Pattern id is derived from
  // the effective color so the pattern emitter and consumer agree.
  effectiveColor?: string;
}

// One stop-square marker for one line at one station.
//
//   solid   → rotated <rect> (current default).
//   hatched → polygon with corners pre-rotated into world space + hatch
//             pattern fill. We can't reuse the rotated <rect> path:
//             userSpaceOnUse patterns inherit the parent transform, which
//             would re-rotate the stripes and break alignment with the
//             surrounding band.
//   dashed  → at an interior station (no `outward`), renders nothing so
//             the two dashed corridors meet cleanly at the stop center
//             without a solid square breaking up the dash rhythm. At a
//             TERMINUS (`outward` set), paints a 7-unit dashed stub
//             continuing outward, so the dashes also fill the outer half
//             of the dot area.
export function StopMarker({ spec, effectiveColor }: Props) {
  const color = effectiveColor ?? spec.color;
  if (spec.style === 'hatched') {
    const pts = rotatedSquareCorners(spec.cx, spec.cy, HALF, spec.rotationDeg)
      .map((p) => `${p.x},${p.y}`)
      .join(' ');
    return <polygon points={pts} fill={`url(#${hatchPatternId(color)})`} pointerEvents="none" />;
  }
  if (spec.style === 'dashed') {
    if (!spec.outward) return null;
    const { stroke, strokeDasharray, strokeLinecap } = lineStyleStrokeAttrs('dashed', color);
    const underlay = lineStyleUnderlayAttrs('dashed');
    const x1 = spec.cx;
    const y1 = spec.cy;
    const x2 = spec.cx + spec.outward.x * HALF;
    const y2 = spec.cy + spec.outward.y * HALF;
    return (
      <>
        {underlay && (
          <line
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={underlay.stroke}
            strokeWidth={STOP_SIZE}
            strokeLinecap={underlay.strokeLinecap}
            pointerEvents="none"
          />
        )}
        <line
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke={stroke}
          strokeWidth={STOP_SIZE}
          strokeLinecap={strokeLinecap}
          strokeDasharray={strokeDasharray}
          pointerEvents="none"
        />
      </>
    );
  }
  return (
    <rect
      x={-HALF}
      y={-HALF}
      width={STOP_SIZE}
      height={STOP_SIZE}
      fill={color}
      transform={`translate(${spec.cx} ${spec.cy}) rotate(${spec.rotationDeg})`}
      pointerEvents="none"
    />
  );
}

function rotatedSquareCorners(cx: number, cy: number, half: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const rot = (x: number, y: number) => ({
    x: cx + x * c - y * s,
    y: cy + x * s + y * c,
  });
  return [rot(-half, -half), rot(half, -half), rot(half, half), rot(-half, half)];
}
