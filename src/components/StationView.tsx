import { useEffect, useRef } from 'react';
import { Line, Station } from '../state/types';
import { dragState, useDoc, useSelection } from '../state/store';
import { DIR_8, STOP_SIZE, stopCenterAt } from '../geometry/orientation';

interface Props {
  station: Station;
  lines: Record<string, Line>;
  zoom: number;
  onStartDrag: (id: string, ev: React.PointerEvent) => void;
  layer: 'bg' | 'dots';
}

export function StationView({ station, lines, onStartDrag, layer }: Props) {
  const selection = useSelection();
  const rotateStation = useDoc((s) => s.rotateStation);
  const renameStation = useDoc((s) => s.renameStation);
  const toggleStationOnLine = useDoc((s) => s.toggleStationOnLine);

  const stops = station.stops;
  const angle = station.rotation * 45;

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    onStartDrag(station.id, e);
  };

  const onClick = (e: React.MouseEvent) => {
    if (dragState.suppressClick) return;
    e.stopPropagation();
    if (selection.appendingToLineId) {
      const ln = lines[selection.appendingToLineId];
      const wasInLine = ln?.stations.includes(station.id) ?? false;
      const cursor = selection.insertAfterIndex ?? -1;
      toggleStationOnLine(selection.appendingToLineId, station.id, cursor);
      if (!wasInLine) {
        selection.setInsertAfterIndex(cursor + 1);
      }
    } else {
      selection.selectStation(station.id);
    }
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    rotateStation(station.id);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    selection.selectStation(station.id);
    selection.setEditingStationId(station.id);
  };

  const half = STOP_SIZE / 2;
  // Empty stations get a single phantom dot one cell to the right of the
  // label, so there's something visible and the name has an anchor.
  const label = station.label;
  const phantomDot = stops.length === 0 ? { row: label.row, col: label.col + 1 } : null;

  const allCells: { row: number; col: number }[] = [...stops, label];
  if (phantomDot) allCells.push(phantomDot);
  const minRow = Math.min(...allCells.map((c) => c.row));
  const maxRow = Math.max(...allCells.map((c) => c.row));
  const minCol = Math.min(...allCells.map((c) => c.col));
  const maxCol = Math.max(...allCells.map((c) => c.col));

  const isAdjacent = (row: number, col: number) => {
    if (stops.some((s) => s.row === row && s.col === col)) return true;
    if (phantomDot && phantomDot.row === row && phantomDot.col === col) return true;
    return false;
  };

  // Label render: figure out which side of the label cell the text anchors to.
  const labelCenter = stopCenterAt(label.row, label.col);
  const dirPlus = DIR_8[label.rotation];
  const dirMinus = DIR_8[(label.rotation + 4) % 8];
  const adjPlus = isAdjacent(label.row + dirPlus.dRow, label.col + dirPlus.dCol);
  const adjMinus = isAdjacent(label.row + dirMinus.dRow, label.col + dirMinus.dCol);
  let labelTextAnchor: 'start' | 'middle' | 'end' = 'middle';
  let labelAnchorX = labelCenter.x;
  let labelAnchorY = labelCenter.y;
  if (adjPlus) {
    labelTextAnchor = 'end';
    labelAnchorX = labelCenter.x + dirPlus.anchor.x;
    labelAnchorY = labelCenter.y + dirPlus.anchor.y;
  } else if (adjMinus) {
    labelTextAnchor = 'start';
    labelAnchorX = labelCenter.x + dirMinus.anchor.x;
    labelAnchorY = labelCenter.y + dirMinus.anchor.y;
  }

  // Hit rect: union of cell bounding box, the rotated label-text bounding
  // box, and the origin (where the no-stops fallback dot lives).
  const bbMinX = stopCenterAt(0, minCol).x - half;
  const bbMaxX = stopCenterAt(0, maxCol).x + half;
  const bbMinY = stopCenterAt(minRow, 0).y - half;
  const bbMaxY = stopCenterAt(maxRow, 0).y + half;
  const textW = Math.max(20, station.name.length * 7);
  const textHalfH = 7;
  let textXMin: number;
  let textXMax: number;
  if (labelTextAnchor === 'start') {
    textXMin = labelAnchorX;
    textXMax = labelAnchorX + textW;
  } else if (labelTextAnchor === 'end') {
    textXMin = labelAnchorX - textW;
    textXMax = labelAnchorX;
  } else {
    textXMin = labelAnchorX - textW / 2;
    textXMax = labelAnchorX + textW / 2;
  }
  const textCorners = [
    { x: textXMin, y: labelAnchorY - textHalfH },
    { x: textXMax, y: labelAnchorY - textHalfH },
    { x: textXMin, y: labelAnchorY + textHalfH },
    { x: textXMax, y: labelAnchorY + textHalfH },
  ];
  const labelAngle = (label.rotation * Math.PI) / 4;
  const cosA = Math.cos(labelAngle);
  const sinA = Math.sin(labelAngle);
  const rotatedCorners = textCorners.map((p) => {
    const dx = p.x - labelAnchorX;
    const dy = p.y - labelAnchorY;
    return {
      x: labelAnchorX + dx * cosA - dy * sinA,
      y: labelAnchorY + dx * sinA + dy * cosA,
    };
  });
  const textMinX = Math.min(...rotatedCorners.map((p) => p.x));
  const textMaxX = Math.max(...rotatedCorners.map((p) => p.x));
  const textMinY = Math.min(...rotatedCorners.map((p) => p.y));
  const textMaxY = Math.max(...rotatedCorners.map((p) => p.y));
  const localMinX = Math.min(bbMinX, textMinX) - 2;
  const localMaxX = Math.max(bbMaxX, textMaxX) + 2;
  const localMinY = Math.min(bbMinY, textMinY) - 2;
  const localMaxY = Math.max(bbMaxY, textMaxY) + 2;
  const hitW = localMaxX - localMinX;
  const hitH = localMaxY - localMinY;

  const isSelected = selection.selectedStationId === station.id;
  const isHovered = selection.hoveredStationId === station.id;
  const isEditing = selection.editingStationId === station.id;

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
          onDoubleClick={onDoubleClick}
          onContextMenu={onContextMenu}
          style={isSelected ? { stroke: '#1a4ea8', strokeDasharray: '3 3' } : undefined}
        />
        {isEditing ? (
          <NameEditor
            x={labelCenter.x - half}
            y={labelCenter.y - half}
            width={STOP_SIZE}
            value={station.name}
            onChange={(v) => renameStation(station.id, v)}
            onCommit={() => selection.setEditingStationId(null)}
          />
        ) : (
          <text
            x={labelAnchorX}
            y={labelAnchorY}
            textAnchor={labelTextAnchor}
            dominantBaseline="central"
            fontSize={11}
            fontWeight={isHovered ? 800 : 600}
            textDecoration={isHovered ? 'underline' : undefined}
            pointerEvents="none"
            fill="#111"
            transform={`rotate(${label.rotation * 45} ${labelAnchorX} ${labelAnchorY})`}
          >
            {station.name}
          </text>
        )}
        {stops.map((cell) => {
          const line = lines[cell.lineId];
          if (!line) return null;
          const c = stopCenterAt(cell.row, cell.col);
          return (
            <rect
              key={cell.lineId}
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
      {phantomDot &&
        (() => {
          const c = stopCenterAt(phantomDot.row, phantomDot.col);
          return <circle cx={c.x} cy={c.y} r={STOP_SIZE * 0.28} fill="#000" />;
        })()}
      {stops.map((cell) => {
        const c = stopCenterAt(cell.row, cell.col);
        return <circle key={cell.lineId} cx={c.x} cy={c.y} r={STOP_SIZE * 0.28} fill="#000" />;
      })}
    </g>
  );
}

function NameEditor({
  x,
  y,
  width,
  value,
  onChange,
  onCommit,
}: {
  x: number;
  y: number;
  width: number;
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      onCommit();
    }
    e.stopPropagation();
  };
  return (
    <foreignObject x={x} y={y} width={width} height={20} style={{ overflow: 'visible' }}>
      <input
        ref={ref}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={onKey}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          fontSize: 11,
          fontWeight: 600,
          padding: '1px 3px',
          border: '1px solid #1a4ea8',
          borderRadius: 2,
          background: '#fff',
          textAlign: 'right',
          fontFamily: 'inherit',
          boxSizing: 'border-box',
        }}
      />
    </foreignObject>
  );
}
