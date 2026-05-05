import { useEffect, useRef } from 'react';
import { Line, Station } from '../model/types';
import { beginHistoryGroup, dragState, useDoc, useSelection } from '../state/store';
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
  // Visual gap so the text never butts right against the adjacent stop.
  const LABEL_GAP = 5;
  const readAngle = (label.rotation * Math.PI) / 4;
  const readCos = Math.cos(readAngle);
  const readSin = Math.sin(readAngle);
  if (adjPlus) {
    labelTextAnchor = 'end';
    // Anchor sits at the +readingDir edge of the cell, then back off by
    // LABEL_GAP in -readingDir so the text isn't touching the stop.
    labelAnchorX = labelCenter.x + dirPlus.anchor.x - LABEL_GAP * readCos;
    labelAnchorY = labelCenter.y + dirPlus.anchor.y - LABEL_GAP * readSin;
  } else if (adjMinus) {
    labelTextAnchor = 'start';
    labelAnchorX = labelCenter.x + dirMinus.anchor.x + LABEL_GAP * readCos;
    labelAnchorY = labelCenter.y + dirMinus.anchor.y + LABEL_GAP * readSin;
  }
  // Per-label offset: shifts along the reading direction.
  if (label.offset) {
    labelAnchorX += label.offset * readCos;
    labelAnchorY += label.offset * readSin;
  }

  // Hit shapes: a rect tight to the cells (axis-aligned in local coords) and
  // a rect tight to the label text (rotated about the label anchor to match
  // the label's reading direction). Two tight rects beat one big union AABB:
  // a long diagonal label's AABB blows up well past the visible text.
  const HIT_PAD = 2;
  const cellsHitX = stopCenterAt(0, minCol).x - half - HIT_PAD;
  const cellsHitY = stopCenterAt(minRow, 0).y - half - HIT_PAD;
  const cellsHitW = stopCenterAt(0, maxCol).x + half + HIT_PAD - cellsHitX;
  const cellsHitH = stopCenterAt(maxRow, 0).y + half + HIT_PAD - cellsHitY;
  const textW = Math.max(20, station.name.length * 7);
  const textHalfH = 7;
  let textXMin: number;
  if (labelTextAnchor === 'start') textXMin = labelAnchorX;
  else if (labelTextAnchor === 'end') textXMin = labelAnchorX - textW;
  else textXMin = labelAnchorX - textW / 2;
  const labelHitX = textXMin - HIT_PAD;
  const labelHitY = labelAnchorY - textHalfH - HIT_PAD;
  const labelHitW = textW + 2 * HIT_PAD;
  const labelHitH = 2 * textHalfH + 2 * HIT_PAD;
  const labelHitTransform = `rotate(${label.rotation * 45} ${labelAnchorX} ${labelAnchorY})`;

  const isSelected = selection.selectedStationId === station.id;
  const isEditing = selection.editingStationId === station.id;

  if (layer === 'bg') {
    const hitProps = {
      fill: 'transparent',
      pointerEvents: 'all' as const,
      onPointerDown,
      onClick,
      onDoubleClick,
      onContextMenu,
      style: isSelected ? { stroke: '#1a4ea8', strokeDasharray: '3 3' } : undefined,
    };
    return (
      <g
        transform={`translate(${station.x} ${station.y}) rotate(${angle})`}
        style={{ cursor: 'move' }}
      >
        <rect x={cellsHitX} y={cellsHitY} width={cellsHitW} height={cellsHitH} {...hitProps} />
        <rect
          x={labelHitX}
          y={labelHitY}
          width={labelHitW}
          height={labelHitH}
          transform={labelHitTransform}
          {...hitProps}
        />
        {isEditing ? (
          <NameEditor
            x={labelCenter.x - (textW + 8) / 2}
            y={labelCenter.y - 10}
            width={textW + 8}
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
            fontSize={12}
            fontWeight={selection.hoveredStationId === station.id ? 700 : 400}
            textDecoration={selection.hoveredStationId === station.id ? 'underline' : undefined}
            pointerEvents="none"
            fill="#111"
            transform={`rotate(${label.rotation * 45} ${labelAnchorX} ${labelAnchorY})`}
          >
            {station.name}
          </text>
        )}
        {/* Colored stop squares are rendered by MapCanvas alongside bands so
            that per-line z-order is honored. */}
      </g>
    );
  }

  // layer === 'dots'
  return (
    <g transform={`translate(${station.x} ${station.y}) rotate(${angle})`} pointerEvents="none">
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
  // Open a history group on mount. Doing this in useEffect (rather than via
  // an onFocus handler) sidesteps any uncertainty about whether the synthetic
  // focus event fires for an input inside a foreignObject when el.focus() is
  // called programmatically. Group is committed on blur, Enter, or unmount.
  const groupRef = useRef<ReturnType<typeof beginHistoryGroup> | null>(null);
  useEffect(() => {
    groupRef.current = beginHistoryGroup();
    const el = ref.current;
    el?.focus();
    el?.select();
    return () => {
      groupRef.current?.commit();
      groupRef.current = null;
    };
  }, []);

  const closeEditor = () => {
    groupRef.current?.commit();
    groupRef.current = null;
    onCommit();
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      closeEditor();
      e.stopPropagation();
      return;
    }
    // Intercept Cmd/Ctrl+Z and friends. The browser's native input undo
    // would only revert one keystroke at a time AND fire onChange, creeping
    // the doc back one char per Ctrl-Z. Commit the rename group, run our
    // doc-level undo/redo, then close — one Ctrl-Z reverts the whole rename.
    const mod = e.metaKey || e.ctrlKey;
    if (mod && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      closeEditor();
      const temporal = useDoc.temporal.getState();
      if (e.shiftKey) temporal.redo();
      else temporal.undo();
      e.stopPropagation();
      return;
    }
    if (mod && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      closeEditor();
      useDoc.temporal.getState().redo();
      e.stopPropagation();
      return;
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
        onBlur={closeEditor}
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
