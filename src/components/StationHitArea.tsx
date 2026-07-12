import { Line, Station } from '../model/types';
import { labelLayoutLocal } from '../geometry/labelLayout';
import { cellsAABBLocal } from '../geometry/stationBoundary';
import { waypointLabelRectLocal } from '../geometry/waypointLozenge';
import { stopHalfOf } from '../model/lineWidth';
import { effectiveStationLabelStyle } from '../model/transforms';
import { useViewportStore } from '../state/viewportStore';
import { useStationInteraction } from './useStationInteraction';

/**
 * A station's transparent hit area, painted in the 'bg' pass beneath
 * everything visible: an axis-aligned rect over the cells AABB plus a rotated
 * rect over the label, both forwarding pointer events to the shared station
 * interaction handlers so any pixel of the station's footprint — dots, body,
 * or painted name — is a grab handle for the whole STATION.
 * A hidden waypoint omits the label rect (no painted name to click); a revealed
 * one (Show-waypoints overlay) gets it back so its name is clickable.
 *
 * The name's OWN layout (its cell/rotation/offsets) is edited in the
 * station-layout editor, not on the main canvas — so here the label rect is a
 * plain part of the station, identical to the cells rect.
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
  const { handlers, cursor, hitless } = useStationInteraction(station, onStartDrag, lines);
  const showWaypoints = useViewportStore((s) => s.showWaypoints);

  const angle = station.rotation * 45;
  const revealedWaypoint = !!station.isWaypoint && showWaypoints;
  // A revealed waypoint (overlay on) gets a label hit rect so its lozenge is
  // clickable like a regular station's name.
  const hideLabelRect = !!station.isWaypoint && !showWaypoints;
  const stopHalf = stopHalfOf(lines);
  const cellsBox = cellsAABBLocal(station, stopHalf, showWaypoints);
  const effStyle = effectiveStationLabelStyle(station);
  const lay = labelLayoutLocal(station, effStyle, undefined, stopHalf);
  const labelHitTransform = `rotate(${station.label.rotation * 45} ${lay.anchorX} ${lay.anchorY})`;
  // A revealed waypoint's label is the WP lozenge, so its clickable rect is the
  // pill's box (matching the paint), not the invisible name's.
  const labelRect = revealedWaypoint
    ? waypointLabelRectLocal(lay, effStyle.fontSize)
    : { x: lay.hitX, y: lay.hitY, w: lay.hitW, h: lay.hitH };

  const hitProps = {
    fill: 'transparent',
    pointerEvents: hitless ? ('none' as const) : ('all' as const),
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
      <rect
        x={cellsBox.x}
        y={cellsBox.y}
        width={cellsBox.w}
        height={cellsBox.h}
        {...handlers}
        {...hitProps}
      />
      {!hideLabelRect && (
        <rect
          x={labelRect.x}
          y={labelRect.y}
          width={labelRect.w}
          height={labelRect.h}
          transform={labelHitTransform}
          {...handlers}
          {...hitProps}
        />
      )}
    </g>
  );
}
