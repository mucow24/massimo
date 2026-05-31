import { useDoc, useSelection } from '../state/store';
import { useThemeColors } from '../state/theme';
import type { Station } from '../model/types';
import { resolveStationLabelWeight } from '../model/transforms';
import { stationBoundaryRectsLocal } from '../geometry/stationBoundary';
import { polygonsToPath, unionConvex } from '../geometry/polygonUnion';

const SELECTION_WASH_COLOR = '#f0ff00';
const SELECTION_WASH_OPACITY = 0.2;
const SELECTION_STROKE_WIDTH = 2;
const SELECTION_CORNER_RADIUS = 5;
const MATCH_STROKE_COLOR = '#888';
const MATCH_STROKE_WIDTH = 1.5;

export type SilhouetteLayer = 'wash' | 'stroke' | 'match-stroke';

/**
 * A station's selection silhouette: the smoothed union of its cells AABB and
 * its (rotated) label rect. `wash` is the yellow fill, `stroke` the selection
 * outline, `match-stroke` the gray mirror-match outline. Skipped while the
 * station is being renamed — the inline editor draws its own box, and the
 * collapsed-label silhouette would overdraw the wider editor.
 */
export function StationSilhouette({
  station,
  layer,
}: {
  station: Station;
  layer: SilhouetteLayer;
}) {
  const labelFontSize = useDoc((s) => s.labelFontSize);
  const labelWeight = useDoc((s) => s.labelWeight);
  const labelItalic = useDoc((s) => s.labelItalic);
  const editingStationId = useSelection((s) => s.editingStationId);
  const themeColors = useThemeColors();

  if (editingStationId === station.id) return null;

  const angle = station.rotation * 45;
  // Smooth the union of the cells rect + (rotated) label rect; smoothing
  // applies to the outer-boundary corners only, so the rects meet cleanly.
  const { cells, label: labelPoly } = stationBoundaryRectsLocal(station, {
    fontSize: labelFontSize,
    weight: resolveStationLabelWeight(labelWeight, station.labelBold),
    italic: labelItalic,
  });
  // Waypoint: no label polygon to merge, render the cells rect alone.
  const polygons = labelPoly ? unionConvex(cells, labelPoly) : [cells];
  const pathStr = polygonsToPath(polygons, SELECTION_CORNER_RADIUS);
  const transform = `translate(${station.x} ${station.y}) rotate(${angle})`;

  if (layer === 'wash') {
    return (
      <g data-station-wash={station.id} transform={transform} pointerEvents="none">
        <path
          d={pathStr}
          fill={SELECTION_WASH_COLOR}
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
          strokeWidth={MATCH_STROKE_WIDTH}
          strokeLinejoin="round"
        />
      </g>
    );
  }
  return (
    <g transform={transform} pointerEvents="none">
      <path
        d={pathStr}
        fill="none"
        stroke={themeColors.selectionStroke}
        strokeWidth={SELECTION_STROKE_WIDTH}
        strokeLinejoin="round"
      />
    </g>
  );
}
