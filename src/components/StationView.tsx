import { Line, Station } from '../state/types';
import { dragState, useDoc, useSelection } from '../state/store';
import { STOP_SIZE, stopCenterLocal } from '../geometry/orientation';

interface Props {
  station: Station;
  lines: Record<string, Line>;
  zoom: number;
  onStartDrag: (id: string, ev: React.PointerEvent) => void;
  // 'bg'  = hit area, name, colored stop squares (rendered under the snap guide)
  // 'dots' = the black dots only (rendered over the snap guide so the line passes
  //          visibly across the stop's colored square but tucks under each dot)
  layer: 'bg' | 'dots';
}

export function StationView({ station, lines, onStartDrag, layer }: Props) {
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

  const stopCount = Math.max(1, stops.length);
  const lastCenter = stopCenterLocal(stopCount - 1);
  // Generous estimate so the hit rect always covers the rendered name.
  const nameWidth = Math.max(60, station.name.length * 9);
  const localMinX = -STOP_SIZE / 2 - 6 - nameWidth;
  const localMaxX = lastCenter.x + STOP_SIZE / 2 + 4;
  const localMinY = -STOP_SIZE / 2 - 8;
  const localMaxY = STOP_SIZE / 2 + 8;
  const hitW = localMaxX - localMinX;
  const hitH = localMaxY - localMinY;

  const isSelected = selection.selectedStationId === station.id;
  const isHovered = selection.hoveredStationId === station.id;

  if (layer === 'bg') {
    return (
      <g
        transform={`translate(${station.x} ${station.y}) rotate(${angle})`}
        style={{ cursor: 'move' }}
      >
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
        {stops.map((lineId, i) => {
          const line = lines[lineId];
          if (!line) return null;
          const c = stopCenterLocal(i);
          const half = STOP_SIZE / 2;
          return (
            <rect
              key={lineId}
              x={c.x - half}
              y={c.y - half}
              width={STOP_SIZE}
              height={STOP_SIZE}
              fill={line.color}
              pointerEvents="none"
            />
          );
        })}
      </g>
    );
  }

  // layer === 'dots'
  return (
    <g
      transform={`translate(${station.x} ${station.y}) rotate(${angle})`}
      pointerEvents="none"
    >
      {stops.length === 0 ? (
        <circle cx={0} cy={0} r={3.5} fill="#000" />
      ) : (
        stops.map((lineId, i) => {
          const c = stopCenterLocal(i);
          return <circle key={lineId} cx={c.x} cy={c.y} r={STOP_SIZE * 0.28} fill="#000" />;
        })
      )}
    </g>
  );
}
