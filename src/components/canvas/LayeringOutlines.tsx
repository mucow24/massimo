import type { LineId } from '../../model/types';
import {
  closedPerimeterPath,
  computeStripeOutline,
  type SegmentBandSpec,
} from '../../geometry/interlining';

// Dashed outline applied to every stripe except the hovered one.
const DASHED_STROKE_WIDTH = 1.5;
const DASHED_OPACITY = 0.2;
const DASHED_DASH = '4 2';

// Solid black + white halo applied only to the hovered stripe. Black is the
// inner stroke (visible against any background); white halo frames it 1px
// out on each side so the stroke reads against arbitrary line colors.
const HOVER_BLACK_STROKE_WIDTH = 1;
const HOVER_HALO_STROKE_WIDTH = 2;

interface Props {
  bands: SegmentBandSpec[];
  hovered: { bandKey: string; lineId: LineId } | null;
}

/**
 * Layering-mode outlines: a 1.5px dashed black border tracing every band
 * stripe's perimeter, and a 1px-black + 2px-white-halo solid border around
 * the hovered stripe. The hovered outline paints in a separate pass below
 * the dashed ones so it always sits on top — visible even when the stripe
 * itself is buried under a higher-layer crossing.
 *
 * The interior of each stripe is never repainted, so this overlay never
 * occludes a line that's currently in front of the stripe being outlined.
 */
export function LayeringOutlines({ bands, hovered }: Props) {
  return (
    <>
      {bands.flatMap((band) =>
        band.lines.map((stripeLine, k) => {
          const isHovered =
            !!hovered && hovered.bandKey === band.bandKey && hovered.lineId === stripeLine.id;
          // The hovered stripe paints in the later pass.
          if (isHovered) return null;
          const outline = computeStripeOutline(band, k);
          if (!outline) return null;
          return (
            <g
              key={'outline:' + band.bandKey + ':' + stripeLine.id}
              data-layering-outline
              data-band-key={band.bandKey}
              data-line-id={stripeLine.id}
              pointerEvents="none"
              stroke="#000"
              strokeWidth={DASHED_STROKE_WIDTH}
              strokeOpacity={DASHED_OPACITY}
              strokeLinecap="butt"
              strokeDasharray={DASHED_DASH}
            >
              <path d={outline.edgeAPath} fill="none" strokeLinejoin="round" />
              <path d={outline.edgeBPath} fill="none" strokeLinejoin="round" />
              <line
                x1={outline.capStart.x1}
                y1={outline.capStart.y1}
                x2={outline.capStart.x2}
                y2={outline.capStart.y2}
              />
              <line
                x1={outline.capEnd.x1}
                y1={outline.capEnd.y1}
                x2={outline.capEnd.x2}
                y2={outline.capEnd.y2}
              />
            </g>
          );
        }),
      )}
      {hovered && <HoveredStripeOutline bands={bands} hovered={hovered} />}
    </>
  );
}

function HoveredStripeOutline({
  bands,
  hovered,
}: {
  bands: SegmentBandSpec[];
  hovered: { bandKey: string; lineId: LineId };
}) {
  const band = bands.find((b) => b.bandKey === hovered.bandKey);
  if (!band) return null;
  const k = band.lines.findIndex((l) => l.id === hovered.lineId);
  if (k < 0) return null;
  const outline = computeStripeOutline(band, k);
  if (!outline) return null;
  const d = closedPerimeterPath(outline.segsA, outline.segsB);
  if (!d) return null;
  return (
    <g
      data-layering-hover-outline
      data-band-key={band.bandKey}
      data-line-id={hovered.lineId}
      pointerEvents="none"
      strokeLinejoin="round"
      strokeLinecap="butt"
      fill="none"
    >
      <path d={d} stroke="#fff" strokeWidth={HOVER_HALO_STROKE_WIDTH} />
      <path d={d} stroke="#000" strokeWidth={HOVER_BLACK_STROKE_WIDTH} />
    </g>
  );
}
