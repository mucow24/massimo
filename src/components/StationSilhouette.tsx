import { useDoc, useSelection } from '../state/store';
import { useThemeColors } from '../state/theme';
import { useViewportStore } from '../state/viewportStore';
import type { Station } from '../model/types';
import { effectiveStationLabelStyle } from '../model/transforms';
import { stationBoundaryRectsLocal } from '../geometry/stationBoundary';
import { stopHalfOf } from '../model/lineWidth';
import { polygonsToPath, unionConvex } from '../geometry/polygonUnion';
import {
  SELECTION_STROKE_WIDTH,
  SELECTION_WASH_OPACITY,
  selectionOutlineTones,
} from './selectionStyle';
import { useDocLabelStyle } from './useDocLabelStyle';

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
  preview = false,
}: {
  station: Station;
  layer: SilhouetteLayer;
  /** Overrides the `stroke` layer's outline color (default: theme selection
   *  stroke). The layout-edit focus paints a white outline above its dim. */
  strokeColor?: string;
  /** Rendered as a 50%-opacity mouseover PREVIEW, not a real selection. Swaps
   *  the identity attributes to `data-station-*-preview` so `data-station-wash`
   *  / `data-station-stroke` stay pure "this station is selected" markers. */
  preview?: boolean;
}) {
  const docStyle = useDocLabelStyle();
  const lines = useDoc((s) => s.lines);
  const editingStationId = useSelection((s) => s.editingStationId);
  const themeColors = useThemeColors();
  // Paint toggle: reveal waypoint stations (widens the silhouette to wrap the
  // revealed name). The outline no longer reads zoom — its weight is held by
  // vector-effect, so nothing here snaps on gesture commit.
  const showWaypoints = useViewportStore((s) => s.showWaypoints);

  if (editingStationId === station.id) return null;

  const angle = station.rotation * 45;
  // Smooth the union of the cells rect + (rotated) label rect; smoothing
  // applies to the outer-boundary corners only, so the rects meet cleanly. A
  // revealed waypoint gets its label rect (its name is painted, so the ring
  // must wrap it).
  const { cells, label: labelPoly } = stationBoundaryRectsLocal(
    station,
    effectiveStationLabelStyle(station, docStyle),
    stopHalfOf(lines),
    showWaypoints,
  );
  // Hidden waypoint: no label polygon to merge, render the cells rect alone.
  const polygons = labelPoly ? unionConvex(cells, labelPoly) : [cells];
  const pathStr = polygonsToPath(polygons, SELECTION_CORNER_RADIUS);
  const transform = `translate(${station.x} ${station.y}) rotate(${angle})`;

  if (layer === 'wash') {
    return (
      <g
        data-station-wash={preview ? undefined : station.id}
        data-station-wash-preview={preview ? station.id : undefined}
        transform={transform}
        pointerEvents="none"
      >
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
          strokeWidth={MATCH_STROKE_WIDTH}
          // Screen-constant weight with no zoom subscription (nothing to snap
          // when a gesture commits).
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
      </g>
    );
  }
  // The layout-edit focus passes an explicit white outline over the dim — a
  // single stroke, not the two-tone ring, which reads as one clean focus border
  // on the darkened backdrop. Everything else gets the shared two-tone selection
  // outline: a black core over a white underlay, legible around a station of
  // any color on any canvas without a theme flip.
  if (strokeColor) {
    return (
      <g data-station-stroke={station.id} transform={transform} pointerEvents="none">
        <path
          d={pathStr}
          fill="none"
          stroke={strokeColor}
          strokeWidth={SELECTION_STROKE_WIDTH}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
      </g>
    );
  }
  return (
    <g
      data-station-stroke={preview ? undefined : station.id}
      data-station-stroke-preview={preview ? station.id : undefined}
      transform={transform}
      pointerEvents="none"
    >
      {selectionOutlineTones(themeColors).map(({ tone, stroke, strokeWidth }) => (
        <path
          key={tone}
          d={pathStr}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
      ))}
    </g>
  );
}
