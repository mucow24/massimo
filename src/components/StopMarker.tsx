import { memo } from 'react';
import { rotatedRectCorners, v } from '../geometry/vec';
import {
  jointHalfSquareCorners,
  jointStraightOut,
  jointWedgeCorners,
} from '../geometry/lineCircle';
import {
  markerEndCapCenter,
  markerEndPath,
  markerEndRailArc,
  markerEndSides,
} from '../geometry/markerEnd';
import type { StopMarkerSpec } from '../geometry/interlining';
import { lineCasingColor, lineStrokeRailWidth, lineStrokeWidthOf } from '../model/lineStroke';
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
// THE LINE END. At a terminus the marker's outward half IS the line's painted
// end, so `spec.end` (already resolved — see lineEnd.ts) reshapes exactly that
// half: 'square' keeps everything below untouched, 'short' drops the outward
// half so the line stops flush at the stop center, and 'round' replaces it with
// a half-disc. Both non-square ends are one filled <path> from markerEnd.ts,
// per style — never a clip of the square (a clip would rasterize a hair off its
// path and snag the PDF exporter). A patterned terminus's stub IS the outward
// half, so 'short' simply drops it.
//
// A stroked line's marker additionally paints two casing rails CENTERED on
// the edges parallel to the travel axis (local +x after rotationDeg),
// immediately after the body — continuing the stripe rails through the
// station and out to the line end at termini. Centering makes tangent
// neighbors' facing rails coincide and anchors the separator to the edge
// regardless of draw order or layering (see lineStroke.ts); rails only
// ever run ALONG the marker, never across its ends. A non-square end shortens
// them to the inward half and closes with a cap at the new end — a straight bar
// at the stop center for 'short', the matching arc for 'round'.
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
  const ow = spec.outward;
  // The reshaped end, or null for the classic full square — which keeps every
  // branch below on exactly the geometry it has always emitted. `end` is only
  // meaningful alongside `outward` (the spec bakes 'square' without it); the
  // guard also covers a hand-built spec that pairs one with the other.
  const center = v(spec.cx, spec.cy);
  const endShape = ow && spec.end !== 'square' ? spec.end : null;
  const casingColor = lineCasingColor(live, color);
  // What makes an element part of the casing rather than the body: the
  // marker-casing tag plus its line id (how the rails are picked out of the
  // tree), and no hit area of its own. Shared by every rail and cap below so a
  // new one cannot be added half-tagged.
  const casingId = {
    'data-marker-casing': true,
    'data-line-id': spec.lineId,
    pointerEvents: 'none',
  } as const;
  // The stroked casing elements add the resolved color at the rail width, butt
  // caps throughout so meeting rails abut instead of overshooting.
  const casingStroke = {
    ...casingId,
    stroke: casingColor,
    strokeWidth: railW,
    strokeLinecap: 'butt',
  } as const;
  // Two rails along the travel axis straddling local y = ±half, rendered in
  // the marker's rotated frame — or, for a reshaped end, along the inward half
  // of the marker's side edges in the OUTWARD frame (which is the frame that
  // end follows; see markerEnd.ts).
  const rails =
    railW > 0 &&
    (endShape && ow
      ? markerEndSides(center, ow, half).map(([from, to], i) => (
          <line key={i} {...casingStroke} x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
        ))
      : [half - railW / 2, -half - railW / 2].map((y) => (
          <rect
            key={y}
            {...casingId}
            x={-half}
            y={y}
            width={spec.width}
            height={railW}
            fill={casingColor}
            transform={`translate(${spec.cx} ${spec.cy}) rotate(${spec.rotationDeg})`}
          />
        )));
  // End cap: at a terminus (outward set), one rail straddling the line's
  // outer end edge, perpendicular to the band tangent and spanning the
  // full cased width (width + railW) so it meets the side rails' corners
  // cleanly — the casing closes around the line's end. A 'short' end moves
  // that bar back to the stop center (where the line now stops); a 'round' one
  // replaces it with the arc, stroked on the same boundary the side rails sit
  // on, so the three meet tangentially instead of at a corner.
  const cap =
    railW > 0 && ow && !noEndCap ? (
      endShape === 'round' ? (
        <path {...casingStroke} d={markerEndRailArc(center, ow, half)} fill="none" />
      ) : (
        (() => {
          const e = markerEndCapCenter(center, ow, half, spec.end);
          const reach = half + railW / 2;
          return (
            <line
              {...casingStroke}
              x1={e.x - ow.y * reach}
              y1={e.y + ow.x * reach}
              x2={e.x + ow.y * reach}
              y2={e.y - ow.x * reach}
            />
          );
        })()
      )
    ) : null;
  // A joint stop (arc meets octolinear — see StopMarkerSpec.jointRotationDeg)
  // paints SPLIT BY SIDE: the arc-side half-square in the tangent frame, the
  // straight-side half-square in the octant frame, and the cap-plane WEDGE
  // between them (corners exactly on the stripes' edges) — each piece flush
  // with its own band, so nothing pokes past a silhouette and nothing gaps.
  // Body ink only — the casing rails stay on the primary (tangent) frame.
  const isJoint = spec.jointRotationDeg !== null && spec.jointArcOut !== null && !endShape;
  const toPoints = (corners: readonly { x: number; y: number }[] | null) =>
    corners ? corners.map((p) => `${p.x},${p.y}`).join(' ') : null;
  const jointPoints = isJoint
    ? toPoints(jointWedgeCorners(center, spec.rotationDeg, spec.jointRotationDeg!, spec.width))
    : null;
  const arcHalfPoints = isJoint
    ? toPoints(jointHalfSquareCorners(center, spec.jointArcOut!, spec.width))
    : null;
  const straightHalfPoints = isJoint
    ? toPoints(
        jointHalfSquareCorners(
          center,
          jointStraightOut(spec.jointRotationDeg!, spec.jointArcOut!),
          spec.width,
        ),
      )
    : null;
  if (spec.style === 'hatched' || spec.style === 'hatched-mirror') {
    const fill = `url(#${hatchPatternId(color, spec.style)})`;
    const pts = rotatedSquareCorners(spec.cx, spec.cy, half, spec.rotationDeg)
      .map((p) => `${p.x},${p.y}`)
      .join(' ');
    return (
      <>
        {endShape && ow ? (
          <path d={markerEndPath(center, ow, half, endShape)} fill={fill} pointerEvents="none" />
        ) : isJoint ? (
          <>
            <polygon
              data-marker-half="arc"
              points={arcHalfPoints!}
              fill={fill}
              pointerEvents="none"
            />
            <polygon
              data-marker-half="straight"
              points={straightHalfPoints!}
              fill={fill}
              pointerEvents="none"
            />
            <polygon
              data-marker-joint={spec.stationId}
              points={jointPoints!}
              fill={fill}
              pointerEvents="none"
            />
          </>
        ) : (
          <polygon points={pts} fill={fill} pointerEvents="none" />
        )}
        {rails}
        {cap}
      </>
    );
  }
  if (spec.style !== 'solid') {
    if (!spec.outward) return null;
    // The stub IS this style's outward half, so a short end is exactly "no
    // stub": the patterned corridor stops at the stop center, and only the
    // casing's end cap moves back to close it there. (A round end can't reach
    // here — resolveEndStyle degraded it to short before the spec was baked.)
    if (endShape) return <>{cap}</>;
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
              {...casingStroke}
              x1={x1 + px * o}
              y1={y1 + py * o}
              x2={x2 + px * o}
              y2={y2 + py * o}
            />
          ))}
        {cap}
      </>
    );
  }
  return (
    <>
      {endShape && ow ? (
        <path d={markerEndPath(center, ow, half, endShape)} fill={color} pointerEvents="none" />
      ) : isJoint ? (
        <>
          <polygon
            data-marker-half="arc"
            points={arcHalfPoints!}
            fill={color}
            pointerEvents="none"
          />
          <polygon
            data-marker-half="straight"
            points={straightHalfPoints!}
            fill={color}
            pointerEvents="none"
          />
          <polygon
            data-marker-joint={spec.stationId}
            points={jointPoints!}
            fill={color}
            pointerEvents="none"
          />
        </>
      ) : (
        <rect
          x={-half}
          y={-half}
          width={spec.width}
          height={spec.width}
          fill={color}
          transform={`translate(${spec.cx} ${spec.cy}) rotate(${spec.rotationDeg})`}
          pointerEvents="none"
        />
      )}
      {rails}
      {cap}
    </>
  );
});

function rotatedSquareCorners(cx: number, cy: number, half: number, deg: number) {
  return rotatedRectCorners(v(cx, cy), half, half, (deg * Math.PI) / 180);
}
