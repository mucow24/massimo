import { Line, Station } from '../state/types';
import { dragState, useDoc, useSelection } from '../state/store';
import { STOP_SIZE, stopCenterLocal } from '../geometry/orientation';
import { LineStop } from './LineStop';

interface Props {
  station: Station;
  lines: Record<string, Line>;
  zoom: number;
  onStartDrag: (id: string, ev: React.PointerEvent) => void;
}

export function StationView({ station, lines, onStartDrag }: Props) {
  const selection = useSelection();
  const rotateStation = useDoc((s) => s.rotateStation);
  const toggleStationOnLine = useDoc((s) => s.toggleStationOnLine);

  const stops = station.stopOrder;
  const angle = station.rotation * 45;

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    onStartDrag(station.id, e);
  };

  const onClick = (e: React.MouseEvent) => {
    if (dragState.suppressClick) return;
    e.stopPropagation();
    if (selection.appendingToLineId) {
      toggleStationOnLine(selection.appendingToLineId, station.id);
    } else {
      selection.selectStation(station.id);
    }
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    rotateStation(station.id);
  };

  // Compute hit-area bounds in local coords (rotation=0 frame), to be rotated.
  // Extend left past stop 0 to cover the station name text, and add a small
  // margin in y so the hit area is comfortable.
  const stopCount = Math.max(1, stops.length);
  const lastCenter = stopCenterLocal(stopCount - 1);
  const nameWidth = Math.max(40, station.name.length * 7);
  const localMinX = -STOP_SIZE / 2 - 6 - nameWidth;
  const localMaxX = lastCenter.x + STOP_SIZE / 2 + 4;
  const localMinY = -STOP_SIZE / 2 - 6;
  const localMaxY = STOP_SIZE / 2 + 6;
  const hitW = localMaxX - localMinX;
  const hitH = localMaxY - localMinY;

  const isSelected = selection.selectedStationId === station.id;
  const isHovered = selection.hoveredStationId === station.id;

  return (
    <g
      transform={`translate(${station.x} ${station.y}) rotate(${angle})`}
      style={{ cursor: 'move' }}
    >
      {/* hit area (transparent, but receives pointer events) */}
      <rect
        x={localMinX}
        y={localMinY}
        width={hitW}
        height={hitH}
        fill="transparent"
        pointerEvents="all"
        onPointerDown={onPointerDown}
        onClick={onClick}
        onContextMenu={onContextMenu}
        style={isSelected ? { stroke: '#1a4ea8', strokeDasharray: '3 3' } : undefined}
      />
      {/* station name (placed left of stop 0) */}
      <text
        x={-STOP_SIZE / 2 - 4}
        y={4}
        textAnchor="end"
        fontSize={11}
        fontWeight={isHovered ? 800 : 600}
        textDecoration={isHovered ? 'underline' : undefined}
        pointerEvents="none"
        fill="#111"
      >
        {station.name}
      </text>
      {/* line stops, or single black dot if no lines stop here */}
      {stops.length === 0 ? (
        <circle cx={0} cy={0} r={3.5} fill="#000" pointerEvents="none" />
      ) : (
        stops.map((lineId, i) => {
          const line = lines[lineId];
          if (!line) return null;
          const c = stopCenterLocal(i);
          return <LineStop key={lineId} cx={c.x} cy={c.y} color={line.color} />;
        })
      )}
    </g>
  );
}
