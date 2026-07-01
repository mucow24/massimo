import type { Line, LineId } from '../../model/types';
import { useThemeColors } from '../../state/theme';
import { stripeEndpointFate } from '../../model/layerPriority';
import type { SegmentBandSpec } from '../../geometry/interlining';
import { computeStripeOutline, type StripeOutlineAdjust } from '../../geometry/stripeOutline';
import type { OffsetPathSegment } from '../../geometry/router';

// Dashed outline applied to every stripe except the hovered one.
const DASHED_STROKE_WIDTH = 1.5;
const DASHED_OPACITY = 0.2;
const DASHED_DASH = '4 2';

// Solid black + white halo applied only to the hovered stripe. Black is the
// inner stroke (visible against any background); white halo frames it 1px
// out on each side so the stroke reads against arbitrary line colors.
const HOVER_BLACK_STROKE_WIDTH = 1;
const HOVER_HALO_STROKE_WIDTH = 2;

// Compute the per-endpoint outline adjustment for one band stripe. At each
// endpoint we look at how the line's two adjacencies (if any) compare under
// the {@link stripeEndpointFate} rule. The shift magnitude is half the
// stripe's own width — the stop-dot square is width × width, so half a dot
// in each direction puts the cap line exactly at the outer or inner edge of
// the dot square:
//   - 'win'  → +width/2 (extend outward; full dot inside outline)
//   - 'lose' → -width/2 (retreat inward; dot outside outline)
//   - 'tie'  → 0 (cap at station center; dot split, prior behavior)
function adjustmentFor(
  band: SegmentBandSpec,
  stripeIndex: number,
  line: Line | undefined,
): StripeOutlineAdjust {
  if (!line) return {};
  const endpointAdjust = band.stripeWidths[stripeIndex] / 2;
  const fateToDelta = (fate: ReturnType<typeof stripeEndpointFate>): number => {
    if (fate === 'win') return endpointAdjust;
    if (fate === 'lose') return -endpointAdjust;
    return 0;
  };
  return {
    start: fateToDelta(stripeEndpointFate(line, band.pairKey, band.fromId)),
    end: fateToDelta(stripeEndpointFate(line, band.pairKey, band.toId)),
  };
}

interface Props {
  bands: SegmentBandSpec[];
  lines: Record<LineId, Line>;
  hovered: { bandKey: string; lineId: LineId } | null;
}

/**
 * The dashed-outline pass of layering mode: a 1.5px theme-label border at
 * 20% opacity tracing every band stripe's perimeter except the hovered one
 * (which goes through {@link LayeringHoverOutline}). The stroke flips with
 * the theme — a translucent black dash was invisible on the pure-black dark
 * canvas, leaving the mode with no visible click targets. Rendered BELOW
 * transfers and station dots so those keep their visual primacy and the
 * dashed outline reads as a soft footprint on the band.
 *
 * The interior of each stripe is never repainted, so this overlay never
 * occludes a line that's currently in front of the stripe being outlined.
 */
export function LayeringDashedOutlines({ bands, lines, hovered }: Props) {
  const themeColors = useThemeColors();
  return (
    <>
      {bands.flatMap((band) =>
        band.lines.map((stripeLine, k) => {
          const isHovered =
            !!hovered && hovered.bandKey === band.bandKey && hovered.lineId === stripeLine.id;
          // The hovered stripe paints via LayeringHoverOutline.
          if (isHovered) return null;
          const outline = computeStripeOutline(
            band,
            k,
            adjustmentFor(band, k, lines[stripeLine.id]),
          );
          if (!outline) return null;
          return (
            <g
              key={'outline:' + band.bandKey + ':' + stripeLine.id}
              data-layering-outline
              data-band-key={band.bandKey}
              data-line-id={stripeLine.id}
              pointerEvents="none"
              stroke={themeColors.label}
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
    </>
  );
}

/**
 * The solid-outline pass of layering mode: a 1px black border + 2px white
 * halo tracing the hovered stripe's full perimeter as a single closed path
 * (so `strokeLinejoin="round"` joins every corner smoothly). Rendered ABOVE
 * everything else — including station dots and transfers — so the click
 * target stays visible no matter how busy the underlying canvas is.
 */
export function LayeringHoverOutline({ bands, lines, hovered }: Props) {
  if (!hovered) return null;
  const band = bands.find((b) => b.bandKey === hovered.bandKey);
  if (!band) return null;
  const k = band.lines.findIndex((l) => l.id === hovered.lineId);
  if (k < 0) return null;
  const outline = computeStripeOutline(band, k, adjustmentFor(band, k, lines[hovered.lineId]));
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

/**
 * Build a single closed `M ... Z` SVG path that traces a stripe's whole
 * perimeter — edge A forward, the end cap, edge B in reverse, the start cap
 * (implicit via `Z`). With `strokeLinejoin="round"` this produces smoothly
 * joined corners that four separate strokes can't.
 *
 * Reversal rule: each arc segment keeps its radius but flips its sweep
 * flag, and `from` / `to` swap; line segments just swap `from` / `to`.
 */
function closedPerimeterPath(segsA: OffsetPathSegment[], segsB: OffsetPathSegment[]): string {
  if (segsA.length === 0 || segsB.length === 0) return '';
  const fmt = (v: number) => v.toFixed(2);
  const cmdFwd = (s: OffsetPathSegment): string => {
    if (s.kind === 'line') return ` L ${fmt(s.to.x)} ${fmt(s.to.y)}`;
    const sweep = s.sign === 1 ? 1 : 0;
    return ` A ${fmt(s.r)} ${fmt(s.r)} 0 0 ${sweep} ${fmt(s.to.x)} ${fmt(s.to.y)}`;
  };
  const cmdRev = (s: OffsetPathSegment): string => {
    if (s.kind === 'line') return ` L ${fmt(s.from.x)} ${fmt(s.from.y)}`;
    const sweep = s.sign === 1 ? 0 : 1;
    return ` A ${fmt(s.r)} ${fmt(s.r)} 0 0 ${sweep} ${fmt(s.from.x)} ${fmt(s.from.y)}`;
  };
  const startA = segsA[0].from;
  let d = `M ${fmt(startA.x)} ${fmt(startA.y)}`;
  for (const s of segsA) d += cmdFwd(s);
  // Jump along the end cap to edge B's far end, then walk B back.
  const endB = segsB[segsB.length - 1].to;
  d += ` L ${fmt(endB.x)} ${fmt(endB.y)}`;
  for (let i = segsB.length - 1; i >= 0; i--) d += cmdRev(segsB[i]);
  d += ' Z';
  return d;
}
