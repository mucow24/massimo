import { useDoc, useSelection } from '../state/store';
import { useThemeColors } from '../state/theme';
import { useViewportStore } from '../state/viewportStore';
import type { Station } from '../model/types';
import { effectiveStationLabelStyle } from '../model/transforms';
import { stationBoundaryRectsLocal } from '../geometry/stationBoundary';
import { stopHalfOf } from '../model/lineWidth';
import { polygonsToPath, unionConvex } from '../geometry/polygonUnion';
import { SELECTION_STROKE_WIDTH, SELECTION_WASH_OPACITY } from './selectionStyle';

const SELECTION_CORNER_RADIUS = 5;
const MATCH_STROKE_COLOR = '#888';
const MATCH_STROKE_WIDTH = 1.5;

export type SilhouetteLayer = 'wash' | 'stroke' | 'match-stroke';

/**
 * A station's selection silhouette: the smoothed union of its cells AABB and
 * its (rotated) label rect. `wash` is the translucent accent fill, `stroke`
 * the selection outline, `match-stroke` the gray mirror-match outline.
 * Skipped while the station is being renamed — the inline editor draws its
 * own box, and the collapsed-label silhouette would overdraw the wider
 * editor.
 */
export function StationSilhouette({
  station,
  layer,
  strokeColor,
}: {
  station: Station;
  layer: SilhouetteLayer;
  /** Overrides the `stroke` layer's outline color (default: theme selection
   *  stroke). The layout-edit focus paints a white outline above its dim. */
  strokeColor?: string;
}) {
  const labelFontSize = useDoc((s) => s.labelFontSize);
  const labelWeight = useDoc((s) => s.labelWeight);
  const labelItalic = useDoc((s) => s.labelItalic);
  const labelLeading = useDoc((s) => s.labelLeading);
  const labelTracking = useDoc((s) => s.labelTracking);
  const lines = useDoc((s) => s.lines);
  const editingStationId = useSelection((s) => s.editingStationId);
  const themeColors = useThemeColors();
  // Committed zoom: the outline strokes divide by it so the ring weight stays
  // constant on screen (the 1/zoom idiom PolygonView established).
  const zoom = useViewportStore((s) => s.zoom);

  if (editingStationId === station.id) return null;

  const angle = station.rotation * 45;
  // Smooth the union of the cells rect + (rotated) label rect; smoothing
  // applies to the outer-boundary corners only, so the rects meet cleanly.
  const { cells, label: labelPoly } = stationBoundaryRectsLocal(
    station,
    effectiveStationLabelStyle(station, {
      fontSize: labelFontSize,
      weight: labelWeight,
      italic: labelItalic,
      leading: labelLeading,
      tracking: labelTracking,
    }),
    stopHalfOf(lines),
  );
  // Waypoint: no label polygon to merge, render the cells rect alone.
  const polygons = labelPoly ? unionConvex(cells, labelPoly) : [cells];
  const pathStr = polygonsToPath(polygons, SELECTION_CORNER_RADIUS);
  const transform = `translate(${station.x} ${station.y}) rotate(${angle})`;

  if (layer === 'wash') {
    return (
      <g data-station-wash={station.id} transform={transform} pointerEvents="none">
        <path
          d={pathStr}
          fill={themeColors.accent}
          fillOpacity={SELECTION_WASH_OPACITY}
          fillRule="nonzero"
        />
      </g>
    );
  }
  if (layer === 'match-stroke') {
    return (
      <g transform={transform} pointerEvents="none">
        <path
          d={pathStr}
          fill="none"
          stroke={MATCH_STROKE_COLOR}
          strokeWidth={MATCH_STROKE_WIDTH / zoom}
          strokeLinejoin="round"
        />
      </g>
    );
  }
  return (
    <g data-station-stroke={station.id} transform={transform} pointerEvents="none">
      <path
        d={pathStr}
        fill="none"
        stroke={strokeColor ?? themeColors.selectionStroke}
        strokeWidth={SELECTION_STROKE_WIDTH / zoom}
        strokeLinejoin="round"
      />
    </g>
  );
}
