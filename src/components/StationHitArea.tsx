import { Line, Station } from '../model/types';
import { dragState, soleSelection, useDoc, useSelection } from '../state/store';
import { dispatchMirrored } from '../state/mirrorDispatch';
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
 *
 * Label-edit fork: while this station is the SOLE selection (idle mode, not
 * renaming, not hand-panning), the label rect stops acting as a station
 * grab and becomes the LABEL's own handle — drag moves the label
 * (useLabelDrag), right-click rotates it, click arms the label
 * sub-selection for keyboard nudging. The cells rect always keeps station
 * behavior, so a selected station is still draggable by its dots/body.
 * Works on locked stations too: lock protects against canvas drags of the
 * STATION, while label-layout edits stay allowed (inspector-parity).
 */
export function StationHitArea({
  station,
  lines,
  onStartDrag,
  onStartLabelDrag,
  proxy = false,
}: {
  station: Station;
  lines: Record<string, Line>;
  onStartDrag: (id: string, ev: React.PointerEvent, redistributeAnchor?: string) => void;
  onStartLabelDrag?: (id: string, ev: React.PointerEvent) => void;
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
  const labelLeading = useDoc((s) => s.labelLeading);
  const labelTracking = useDoc((s) => s.labelTracking);
  const rotateLabel = useDoc((s) => s.rotateLabel);
  const { handlers, cursor, inHitlessMode } = useStationInteraction(station, onStartDrag, lines);
  const selection = useSelection();

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
      leading: labelLeading,
      tracking: labelTracking,
    },
    undefined,
    stopHalf,
  );
  const labelHitTransform = `rotate(${label.rotation * 45} ${labelAnchorX} ${labelAnchorY})`;

  const sole = soleSelection(selection);
  const labelEditArmed =
    !!onStartLabelDrag &&
    !isWp &&
    selection.uiMode.kind === 'idle' &&
    !(selection.toolMode === 'hand' || selection.spaceHeld) &&
    sole?.type === 'station' &&
    sole.id === station.id &&
    selection.editingStationId !== station.id;

  const labelHandlers = labelEditArmed
    ? {
        onPointerDown: (e: React.PointerEvent) => {
          if (e.button !== 0) return;
          // Claim the gesture for the label: no station drag, no marquee.
          e.stopPropagation();
          onStartLabelDrag(station.id, e);
        },
        onClick: (e: React.MouseEvent) => {
          if (dragState.suppressClick) return;
          // Modified clicks keep station-selection semantics (shift = toggle
          // membership, ctrl = redistribute, ctrl+shift = path extend) —
          // only a PLAIN click claims the label sub-selection.
          if (e.shiftKey || e.ctrlKey || e.metaKey) {
            handlers.onClick?.(e);
            return;
          }
          e.stopPropagation();
          selection.setLabelSelected(true);
        },
        onContextMenu: (e: React.MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          dispatchMirrored(station.id, (sid) => rotateLabel(sid));
        },
        // Double-click keeps opening the inline rename editor.
        onDoubleClick: handlers.onDoubleClick,
      }
    : handlers;

  const hitProps = {
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
      <rect
        x={cellsBox.x}
        y={cellsBox.y}
        width={cellsBox.w}
        height={cellsBox.h}
        {...handlers}
        {...hitProps}
      />
      {!isWp && (
        <rect
          x={hitX}
          y={hitY}
          width={hitW}
          height={hitH}
          transform={labelHitTransform}
          {...labelHandlers}
          {...hitProps}
          style={labelEditArmed ? { cursor: 'move' } : undefined}
        />
      )}
    </g>
  );
}
