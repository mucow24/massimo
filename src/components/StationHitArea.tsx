import { Line, Station } from '../model/types';
import { useDoc } from '../state/store';
import { labelLayoutLocal } from '../geometry/labelLayout';
import { cellsAABBLocal } from '../geometry/stationBoundary';
import { stopHalfOf } from '../model/lineWidth';
import { resolveStationLabelWeight } from '../model/transforms';
import { useStationInteraction } from './useStationInteraction';

/**
 * A station's transparent hit area, painted in the 'bg' pass beneath
 * everything visible: an axis-aligned rect over the cells AABB plus a rotated
 * rect over the label, both forwarding pointer events to the shared station
 * interaction handlers so any pixel of the station's footprint is clickable.
 * Waypoints omit the label rect (no painted name to click).
 */
export function StationHitArea({
  station,
  lines,
  onStartDrag,
  proxy = false,
}: {
  station: Station;
  lines: Record<string, Line>;
  onStartDrag: (id: string, ev: React.PointerEvent, redistributeAnchor?: string) => void;
  // When true, render as the selected-on-top drag PROXY: the same geometry +
  // interaction, but keyed under data-station-hit (not data-station-id) so it
  // doesn't duplicate the body's id-locators, and WITHOUT data-locked — the
  // proxy is only ever rendered for unlocked stations, and carrying data-locked
  // would make the rect-select gate treat a pointerdown on it as marquee
  // background and swallow the drag.
  proxy?: boolean;
}) {
  const labelFontSize = useDoc((s) => s.labelFontSize);
  const labelWeight = useDoc((s) => s.labelWeight);
  const labelItalic = useDoc((s) => s.labelItalic);
  const { handlers, cursor, inHitlessMode } = useStationInteraction(station, onStartDrag, lines);

  const angle = station.rotation * 45;
  const isWp = !!station.isWaypoint;
  const label = station.label;
  const stopHalf = stopHalfOf(lines);
  const cellsBox = cellsAABBLocal(station, stopHalf);
  const {
    anchorX: labelAnchorX,
    anchorY: labelAnchorY,
    hitX,
    hitY,
    hitW,
    hitH,
  } = labelLayoutLocal(
    station,
    {
      fontSize: labelFontSize,
      weight: resolveStationLabelWeight(labelWeight, station.labelBold),
      italic: labelItalic,
    },
    undefined,
    stopHalf,
  );
  const labelHitTransform = `rotate(${label.rotation * 45} ${labelAnchorX} ${labelAnchorY})`;

  const hitProps = {
    ...handlers,
    fill: 'transparent',
    pointerEvents: inHitlessMode ? ('none' as const) : ('all' as const),
  };
  return (
    <g
      data-station-id={proxy ? undefined : station.id}
      data-station-hit={proxy ? station.id : undefined}
      // Generic lock marker (shared with polygons): the rect-select gate keys
      // off [data-locked] so a drag starting on a locked station begins a
      // marquee instead of doing nothing. Never set in proxy mode (see prop doc).
      data-locked={proxy ? undefined : station.locked || undefined}
      transform={`translate(${station.x} ${station.y}) rotate(${angle})`}
      style={{ cursor }}
    >
      <rect x={cellsBox.x} y={cellsBox.y} width={cellsBox.w} height={cellsBox.h} {...hitProps} />
      {!isWp && (
        <rect
          x={hitX}
          y={hitY}
          width={hitW}
          height={hitH}
          transform={labelHitTransform}
          {...hitProps}
        />
      )}
    </g>
  );
}
