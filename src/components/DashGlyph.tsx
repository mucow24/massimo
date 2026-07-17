import { resolveDotRender } from '../model/dotStyle';
import { useDoc } from '../state/store';
import type { DotStyle } from '../model/types';
import type { DashSpec } from '../geometry/stationDash';

/**
 * One TfL-style tick: the canvas renderer for 'dash' stops. The geometry
 * (anchor on the stop's own stripe edge, outward angle toward the label,
 * width-derived dimensions) is entirely in `spec` (geometry/stationDash.ts);
 * this component only assembles the SVG, applies the hover affordance, and
 * tags the E2E data attributes. A plain transformed <rect> — the
 * svg2pdf-proven form (see StopMarker's solid branch).
 *
 * No stroke pass: dash ignores the style's stroke fields (see DotBaseShape),
 * so StationDots mounts it once, beneath the dot passes.
 */
export function DashGlyph({
  spec,
  style,
  lineColor,
  isHovered,
  stationId,
  lineId,
}: {
  spec: DashSpec;
  style: DotStyle;
  lineColor?: string;
  isHovered?: boolean;
  stationId?: string;
  lineId?: string;
}) {
  const darkMode = useDoc((s) => s.darkMode);
  // Honors the resolved fill ('line' in the preset; a hand-edited day/night
  // pair works too). Never null for a dash: the preset fill is 'line'.
  const params = resolveDotRender(style, lineColor, undefined, darkMode);
  if (!params) return null;
  return (
    <rect
      x={0}
      y={-spec.width / 2}
      width={spec.length}
      height={spec.width}
      fill={params.fill}
      transform={`translate(${spec.ax} ${spec.ay}) rotate(${spec.angleDeg})`}
      {...(isHovered ? { stroke: '#fff', strokeWidth: 3 } : {})}
      data-stop-shape="dash"
      {...(stationId ? { 'data-stop-station': stationId } : {})}
      {...(lineId ? { 'data-stop-line': lineId } : {})}
    />
  );
}
