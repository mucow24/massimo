import { offsetFilletPath } from '../geometry/router';
import type { Vec2 } from '../geometry/vec';
import type { LineId } from '../model/types';

interface Props {
  // The band centerline the body path was baked from — the rails reuse it so
  // they hug the exact same fillets.
  centerline: Vec2[];
  // The band's effective radius (bumped/capped), NOT any line's raw curveRadius.
  radius: number;
  // This stripe's centerline offset; the two rails sit at offset ± bodyWidth/2.
  offset: number;
  // The body (stripe) width — the rails are centered on its two edges.
  bodyWidth: number;
  // Rail stroke width, already clamped to the body via lineStrokeRailWidth.
  railW: number;
  color: string;
  // When set, tags each rail with data-band-casing/data-line-id for DOM lookup.
  // The base band paint (SegmentBand) needs it for hit/order tests; the
  // selected-line highlight overlay renders inside a pointer-events:none group
  // and doesn't, so it passes nothing.
  lineId?: LineId;
}

// The two casing rails for one stripe: railW-wide paths CENTERED on the body's
// edges (offset ± bodyWidth/2 — half in, half out, like SVG's own stroke on a
// shape boundary), built by the same offsetFilletPath machinery that baked the
// body so they hug its fillets exactly. Centering makes two tangent stroked
// neighbors' facing rails COINCIDE — one separator, not two stacked — so an
// interlined band reads with uniform stroke weight on every edge, and the
// separator's position can never depend on draw order or layering (see
// lineStroke.ts). Solid regardless of the body's dashed/hatched style. Shared
// by SegmentBand and the selected-line highlight overlay so the two can't
// drift. Renders nothing when there's no casing (railW ≤ 0).
export function CasingRails({
  centerline,
  radius,
  offset,
  bodyWidth,
  railW,
  color,
  lineId,
}: Props) {
  if (railW <= 0) return null;
  return (
    <>
      {[-1, 1].map((side) => (
        <path
          key={side}
          d={offsetFilletPath(centerline, radius, offset + (side * bodyWidth) / 2)}
          data-band-casing={lineId != null ? '' : undefined}
          data-line-id={lineId}
          fill="none"
          stroke={color}
          strokeWidth={railW}
          strokeLinecap="butt"
          strokeLinejoin="round"
          pointerEvents="none"
        />
      ))}
    </>
  );
}
