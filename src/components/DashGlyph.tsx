import { resolveDotRender } from '../model/dotStyle';
import { lineStrokeColorOf, lineStrokeRailWidth, lineStrokeWidthOf } from '../model/lineStroke';
import { lineWidthOf } from '../model/lineWidth';
import { useDoc } from '../state/store';
import type { DotStyle } from '../model/types';
import type { DashSpec } from '../geometry/stationDash';

// Extra base overlap INTO the line body, world units. Two same-color rects
// that merely ABUT leave an antialiasing hairline of whatever lies beneath
// the shared edge (the casing ring, or the canvas); burying the base one
// unit inside the body — same color underneath, so invisible — keeps any
// rect edge from coinciding with the body edge. Clamped so a hairline-thin
// line's tick never pokes out the far side.
const DASH_WELD = 1;

/**
 * One TfL-style tick: the canvas renderer for 'dash' stops. The geometry
 * (anchor on the stop's own stripe edge, outward angle toward the label,
 * width-derived dimensions) is entirely in `spec` (geometry/stationDash.ts);
 * this component only assembles the SVG, applies the line's casing, the
 * hover affordance, and the E2E data attributes. Plain transformed <rect>s —
 * the svg2pdf-proven form (see StopMarker's solid branch).
 *
 * Casing (PRESENTATION, resolved live from `line` like StopMarker's rails):
 * a cased line's visible colored core ends railW/2 INSIDE the nominal body
 * edge (silhouette + inset body, see lineStroke.ts), so the tick's base
 * extends railW/2 inward to weld onto the core with no white between. The
 * tick itself then wears a three-sided casing — both long edges and the
 * outer tip, never the base — as a strokeColor silhouette outset railW/2
 * under a body inset railW/2, reproducing the centered-stroke look and
 * merging seamlessly into the line's own ring.
 */
export function DashGlyph({
  spec,
  style,
  lineColor,
  line,
  isHovered,
  stationId,
  lineId,
}: {
  spec: DashSpec;
  style: DotStyle;
  lineColor?: string;
  // The owning line's casing fields; undefined ⇒ no casing (picker-less
  // callers). Width is the STRIPE width (rail clamp), not the tick's.
  line?: { width?: number; strokeWidth?: number; strokeColor?: string } | null;
  isHovered?: boolean;
  stationId?: string;
  lineId?: string;
}) {
  const darkMode = useDoc((s) => s.darkMode);
  // Honors the resolved fill ('line' in the preset; a hand-edited day/night
  // pair works too). Never null for a dash: the preset fill is 'line'.
  const params = resolveDotRender(style, lineColor, undefined, darkMode);
  if (!params) return null;

  const transform = `translate(${spec.ax} ${spec.ay}) rotate(${spec.angleDeg})`;
  const halfT = spec.width / 2;
  const hoverAttrs = isHovered ? { stroke: '#fff', strokeWidth: 3 } : {};
  const dataAttrs = {
    'data-stop-shape': 'dash',
    ...(stationId ? { 'data-stop-station': stationId } : {}),
    ...(lineId ? { 'data-stop-line': lineId } : {}),
  };

  const railW = lineStrokeRailWidth(lineStrokeWidthOf(line), lineWidthOf(line));
  // Base intrusion past the nominal stripe edge: through the casing ring's
  // inner half (railW/2, so the tick meets the visible core) plus the weld
  // overlap — capped at the stripe's center so thin lines never bleed out
  // the far side.
  const baseInset = Math.min(railW / 2 + DASH_WELD, lineWidthOf(line) / 2);
  // The colored tip: the nominal length, pulled in by half a rail when cased
  // (centered-stroke look — the tip ring straddles the nominal end).
  const tipX = spec.length - railW / 2;
  if (railW <= 0) {
    // Uncased: one rect from inside the line body out to the tip.
    return (
      <rect
        x={-baseInset}
        y={-halfT}
        width={tipX + baseInset}
        height={spec.width}
        fill={params.fill}
        transform={transform}
        {...hoverAttrs}
        {...dataAttrs}
      />
    );
  }

  const h = railW / 2;
  return (
    <>
      {/* Silhouette: outset railW/2 on the long sides + tip, flush with the
          ring's inner edge at the base — no stroke where the tick joins the
          line. Carries the data-stop-stroke seam (station id as VALUE) like
          StopGlyph's stroke pass, so the alt+click deep-pick resolves hits
          on the ring. */}
      <rect
        x={-h}
        y={-halfT - h}
        width={spec.length + railW}
        height={spec.width + railW}
        fill={lineStrokeColorOf(line)}
        transform={transform}
        data-stop-stroke={stationId ?? ''}
        {...(lineId ? { 'data-stop-line': lineId } : {})}
      />
      {/* Body: base buried in the line's visible core (weld overlap, no
          hairline); inset railW/2 on the three stroked sides. */}
      <rect
        x={-baseInset}
        y={-halfT + h}
        width={tipX + baseInset}
        height={Math.max(0, spec.width - railW)}
        fill={params.fill}
        transform={transform}
        {...hoverAttrs}
        {...dataAttrs}
      />
    </>
  );
}
