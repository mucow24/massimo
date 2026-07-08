import { memo } from 'react';
import { rotatedRectCorners, v } from '../geometry/vec';
import type { StopMarkerSpec } from '../geometry/interlining';
import { lineStrokeColorOf, lineStrokeRailWidth, lineStrokeWidthOf } from '../model/lineStroke';
import { hatchPatternId, lineStyleStrokeAttrs, lineStyleUnderlayAttrs } from './HatchPatterns';

interface Props {
  spec: StopMarkerSpec;
  // Optional override (selection desaturation). Pattern id is derived from
  // the effective color so the pattern emitter and consumer agree.
  effectiveColor?: string;
  // Gap/underlay color for the dashed terminus stub; matches the canvas
  // background. Defaults to white.
  underlayColor?: string;
  // Live line map for the per-line stroke (casing rails). Optional: when
  // absent, the marker renders without rails — the spec bakes everything
  // else the marker needs, and stroke is presentation resolved live, like
  // SegmentBand's color.
  lines?: Record<string, { strokeWidth?: number; strokeColor?: string } | undefined>;
  // Suppress the terminus end-cap rail. The highlight layer sets this at
  // the arrow-tip station, where the cased arrowhead replaces the line's
  // end — otherwise the cap would slice between the body and the arrow.
  noEndCap?: boolean;
}

// One stop-square marker for one line at one station, sized to the line's
// effective width (spec.width × spec.width; 14 for default-width lines).
//
//   solid   → rotated <rect> (current default).
//   hatched → polygon with corners pre-rotated into world space + hatch
//             pattern fill. We can't reuse the rotated <rect> path:
//             userSpaceOnUse patterns inherit the parent transform, which
//             would re-rotate the stripes and break alignment with the
//             surrounding band.
//   dashed / dotted / dashed-open
//           → at an interior station (no `outward`), renders nothing so
//             the two patterned corridors meet cleanly at the stop center
//             without a solid square breaking up the pattern rhythm. At a
//             TERMINUS (`outward` set), paints a width/2-long stub in the
//             same pattern continuing outward, so the pattern also fills
//             the outer half of the dot area.
//
// A stroked line's marker additionally paints two casing rails CENTERED on
// the edges parallel to the travel axis (local +x after rotationDeg),
// immediately after the body — continuing the stripe rails through the
// station and out to the line end at termini. Centering makes tangent
// neighbors' facing rails coincide and anchors the separator to the edge
// regardless of draw order or layering (see lineStroke.ts); rails only
// ever run ALONG the marker, never across its ends.
//
// Memoized: there's one marker per line per station and all props are
// referentially/value-stable across a viewport pan (spec is from a doc-keyed
// memo; effectiveColor/underlayColor are strings; lines is an immutable store
// ref; no callbacks), so React bails out of re-rendering markers on a pan.
export const StopMarker = memo(function StopMarker({
  spec,
  effectiveColor,
  underlayColor,
  lines,
  noEndCap,
}: Props) {
  const color = effectiveColor ?? spec.color;
  const half = spec.width / 2;
  const live = lines?.[spec.lineId];
  const railW = lineStrokeRailWidth(lineStrokeWidthOf(live), spec.width);
  // Two rails along the travel axis straddling local y = ±half, rendered in
  // the marker's rotated frame.
  const rails =
    railW > 0 &&
    [half - railW / 2, -half - railW / 2].map((y) => (
      <rect
        key={y}
        data-marker-casing
        data-line-id={spec.lineId}
        x={-half}
        y={y}
        width={spec.width}
        height={railW}
        fill={lineStrokeColorOf(live)}
        transform={`translate(${spec.cx} ${spec.cy}) rotate(${spec.rotationDeg})`}
        pointerEvents="none"
      />
    ));
  // End cap: at a terminus (outward set), one rail straddling the line's
  // outer end edge, perpendicular to the band tangent and spanning the
  // full cased width (width + railW) so it meets the side rails' corners
  // cleanly — the casing closes around the line's end.
  const ow = spec.outward;
  const cap =
    railW > 0 && ow && !noEndCap
      ? (() => {
          const ex = spec.cx + ow.x * half;
          const ey = spec.cy + ow.y * half;
          const reach = half + railW / 2;
          return (
            <line
              data-marker-casing
              data-line-id={spec.lineId}
              x1={ex - ow.y * reach}
              y1={ey + ow.x * reach}
              x2={ex + ow.y * reach}
              y2={ey - ow.x * reach}
              stroke={lineStrokeColorOf(live)}
              strokeWidth={railW}
              strokeLinecap="butt"
              pointerEvents="none"
            />
          );
        })()
      : null;
  if (spec.style === 'hatched' || spec.style === 'hatched-mirror') {
    const pts = rotatedSquareCorners(spec.cx, spec.cy, half, spec.rotationDeg)
      .map((p) => `${p.x},${p.y}`)
      .join(' ');
    return (
      <>
        <polygon
          points={pts}
          fill={`url(#${hatchPatternId(color, spec.style)})`}
          pointerEvents="none"
        />
        {rails}
        {cap}
      </>
    );
  }
  if (spec.style !== 'solid') {
    if (!spec.outward) return null;
    const { stroke, strokeDasharray, strokeLinecap } = lineStyleStrokeAttrs(
      spec.style,
      color,
      spec.width,
    );
    const underlay = lineStyleUnderlayAttrs(spec.style, underlayColor);
    const x1 = spec.cx;
    const y1 = spec.cy;
    const x2 = spec.cx + spec.outward.x * half;
    const y2 = spec.cy + spec.outward.y * half;
    // Stub rails: straddle the outward stub's edges, perpendicular offsets
    // ±width/2.
    const px = -spec.outward.y;
    const py = spec.outward.x;
    const railOff = spec.width / 2;
    return (
      <>
        {underlay && (
          <line
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={underlay.stroke}
            strokeWidth={spec.width}
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
          strokeWidth={spec.width}
          strokeLinecap={strokeLinecap}
          strokeDasharray={strokeDasharray}
          pointerEvents="none"
        />
        {railW > 0 &&
          [railOff, -railOff].map((o) => (
            <line
              key={o}
              data-marker-casing
              data-line-id={spec.lineId}
              x1={x1 + px * o}
              y1={y1 + py * o}
              x2={x2 + px * o}
              y2={y2 + py * o}
              stroke={lineStrokeColorOf(live)}
              strokeWidth={railW}
              strokeLinecap="butt"
              pointerEvents="none"
            />
          ))}
        {cap}
      </>
    );
  }
  return (
    <>
      <rect
        x={-half}
        y={-half}
        width={spec.width}
        height={spec.width}
        fill={color}
        transform={`translate(${spec.cx} ${spec.cy}) rotate(${spec.rotationDeg})`}
        pointerEvents="none"
      />
      {rails}
      {cap}
    </>
  );
});

function rotatedSquareCorners(cx: number, cy: number, half: number, deg: number) {
  return rotatedRectCorners(v(cx, cy), half, half, (deg * Math.PI) / 180);
}
