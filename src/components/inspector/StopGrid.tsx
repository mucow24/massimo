import { useState } from 'react';

type GridStopOrientation = 'up' | 'down' | 'auto-vertical' | 'left' | 'right' | 'auto-horizontal';

type GridStation = {
  rotation: number;
  stops: { lineId: string; row: number; col: number; orientation: GridStopOrientation }[];
  label: { row: number; col: number; rotation: number };
};

const ORIENTATION_GLYPH: Record<GridStopOrientation, string> = {
  'auto-vertical': '↕',
  up: '↑',
  down: '↓',
  'auto-horizontal': '↔',
  left: '←',
  right: '→',
};

type CellKind = 'label' | 'stop' | 'empty';

type DragSource =
  | { kind: 'stop'; lineId: string; row: number; col: number }
  | { kind: 'label'; row: number; col: number };

type DragState = {
  source: DragSource;
  startX: number;
  startY: number;
  isDragging: boolean;
  // null when the pointer is over an invalid drop target (e.g. label drag
  // hovering a stop, or pointer outside the grid).
  overCell: { row: number; col: number } | null;
};

const DRAG_THRESHOLD_PX = 4;

// A target cell kind is a valid drop for a given source. Labels can only
// land on empty cells; stops can land on empty cells (move) or other stops
// (swap). Neither kind can land on the label cell.
const isValidDropTarget = (sourceKind: 'stop' | 'label', targetKind: CellKind): boolean => {
  if (targetKind === 'label') return false;
  if (sourceKind === 'label') return targetKind === 'empty';
  return true;
};

export function StopGrid({
  station,
  lines,
  selectedLineId,
  labelSelected,
  onSelectStop,
  onSelectLabel,
  onRotateStop,
  onRotateLabel,
  onMoveStop,
  onMoveLabel,
}: {
  station: GridStation;
  lines: Record<string, { color: string; service: string }>;
  selectedLineId: string | null;
  labelSelected: boolean;
  onSelectStop: (lineId: string | null) => void;
  onSelectLabel: () => void;
  onRotateStop: (lineId: string) => void;
  onRotateLabel: () => void;
  onMoveStop: (lineId: string, dRow: number, dCol: number) => void;
  onMoveLabel: (dRow: number, dCol: number) => void;
}) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const stops = station.stops;
  const label = station.label;
  const occupied: { row: number; col: number }[] = [
    ...stops.map((c) => ({ row: c.row, col: c.col })),
    { row: label.row, col: label.col },
  ];
  // Bounding box, padded one cell on each side.
  const minRow = Math.min(...occupied.map((c) => c.row)) - 1;
  const maxRow = Math.max(...occupied.map((c) => c.row)) + 1;
  const minCol = Math.min(...occupied.map((c) => c.col)) - 1;
  const maxCol = Math.max(...occupied.map((c) => c.col)) + 1;
  const stopByPos: Record<string, (typeof stops)[number]> = {};
  for (const c of stops) stopByPos[`${c.row},${c.col}`] = c;
  const cellSize = 22;

  const cells: React.ReactElement[] = [];
  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      const isLabel = label.row === r && label.col === c;
      const stop = !isLabel ? stopByPos[`${r},${c}`] : undefined;
      const line = stop ? lines[stop.lineId] : null;
      const cellKind: CellKind = isLabel ? 'label' : stop ? 'stop' : 'empty';
      const selected = (isLabel && labelSelected) || (!!stop && stop.lineId === selectedLineId);
      const isDragSource =
        !!drag &&
        ((drag.source.kind === 'stop' && cellKind === 'stop' && drag.source.lineId === stop!.lineId) ||
          (drag.source.kind === 'label' && cellKind === 'label'));
      const isDropTarget =
        !!drag &&
        drag.isDragging &&
        !!drag.overCell &&
        drag.overCell.row === r &&
        drag.overCell.col === c &&
        !isDragSource;
      const startDrag = (e: React.PointerEvent, source: DragSource) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        setDrag({
          source,
          startX: e.clientX,
          startY: e.clientY,
          isDragging: false,
          overCell: null,
        });
      };
      cells.push(
        <div
          key={`${r},${c}`}
          data-cell-row={r}
          data-cell-col={c}
          data-cell-kind={cellKind}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            if (cellKind === 'stop') {
              startDrag(e, { kind: 'stop', lineId: stop!.lineId, row: stop!.row, col: stop!.col });
            } else if (cellKind === 'label') {
              startDrag(e, { kind: 'label', row: label.row, col: label.col });
            }
          }}
          onPointerMove={(e) => {
            if (!drag || !isDragSource) return;
            const dx = e.clientX - drag.startX;
            const dy = e.clientY - drag.startY;
            const isDragging = drag.isDragging || Math.hypot(dx, dy) > DRAG_THRESHOLD_PX;
            let overCell: DragState['overCell'] = null;
            if (isDragging) {
              const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
              const cellEl = el?.closest('[data-cell-row]') as HTMLElement | null;
              if (cellEl) {
                const tRow = Number(cellEl.dataset.cellRow);
                const tCol = Number(cellEl.dataset.cellCol);
                const tKind = (cellEl.dataset.cellKind ?? 'empty') as CellKind;
                if (isValidDropTarget(drag.source.kind, tKind)) {
                  overCell = { row: tRow, col: tCol };
                }
              }
            }
            if (
              isDragging !== drag.isDragging ||
              overCell?.row !== drag.overCell?.row ||
              overCell?.col !== drag.overCell?.col
            ) {
              setDrag({ ...drag, isDragging, overCell });
            }
          }}
          onPointerUp={() => {
            if (!drag || !isDragSource) return;
            if (drag.isDragging) {
              if (drag.overCell) {
                const dRow = drag.overCell.row - drag.source.row;
                const dCol = drag.overCell.col - drag.source.col;
                if (dRow !== 0 || dCol !== 0) {
                  if (drag.source.kind === 'stop') onMoveStop(drag.source.lineId, dRow, dCol);
                  else onMoveLabel(dRow, dCol);
                }
              }
            } else {
              // Click-without-drag: select.
              if (drag.source.kind === 'stop') onSelectStop(drag.source.lineId);
              else onSelectLabel();
            }
            setDrag(null);
          }}
          onPointerCancel={() => {
            if (drag && isDragSource) setDrag(null);
          }}
          onClick={() => {
            // Stops and label are handled in onPointerUp (so we can
            // distinguish click from drag). Only empty cells fall through.
            if (cellKind === 'empty') onSelectStop(null);
          }}
          onContextMenu={(e) => {
            if (isLabel) {
              e.preventDefault();
              onSelectLabel();
              onRotateLabel();
            } else if (stop) {
              e.preventDefault();
              onSelectStop(stop.lineId);
              onRotateStop(stop.lineId);
            }
          }}
          style={{
            width: cellSize,
            height: cellSize,
            background: isLabel ? '#fff' : stop && line ? line.color : 'transparent',
            border: selected
              ? '2px solid #000'
              : isLabel
                ? '1px solid rgba(0,0,0,0.4)'
                : stop
                  ? '1px solid rgba(0,0,0,0.2)'
                  : '1px dashed rgba(0,0,0,0.12)',
            borderRadius: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: isLabel ? '#222' : '#fff',
            fontSize: 12,
            fontWeight: 700,
            cursor:
              cellKind === 'stop' || cellKind === 'label'
                ? isDragSource && drag?.isDragging
                  ? 'grabbing'
                  : 'grab'
                : 'default',
            textShadow: isLabel ? undefined : '0 0 2px rgba(0,0,0,0.6)',
            boxSizing: 'border-box',
            transform: isLabel ? `rotate(${label.rotation * 45}deg)` : undefined,
            opacity: isDragSource && drag.isDragging ? 0.4 : 1,
            outline: isDropTarget ? '2px solid #1a4ea8' : undefined,
            outlineOffset: isDropTarget ? '-2px' : undefined,
            touchAction: cellKind === 'stop' || cellKind === 'label' ? 'none' : undefined,
            userSelect: 'none',
            WebkitUserSelect: 'none',
          }}
          title={
            isLabel
              ? `Label at (${r}, ${c}) rot ${label.rotation * 45}°`
              : stop
                ? `${line?.service ?? ''} at (${r}, ${c}) ${stop.orientation}`
                : `(${r}, ${c}) empty`
          }
        >
          {isLabel ? 'L' : stop ? ORIENTATION_GLYPH[stop.orientation] : ''}
        </div>,
      );
    }
  }

  const cols = maxCol - minCol + 1;
  const rows = maxRow - minRow + 1;
  const gap = 2;
  const gridW = cols * cellSize + (cols - 1) * gap;
  const gridH = rows * cellSize + (rows - 1) * gap;
  const angleDeg = station.rotation * 45;
  // Reserve space for the largest bounding box across all 8 rotations so the
  // controls below the grid never reflow when the station is rotated. The
  // worst case at 45° offsets is (gridW + gridH) * √2/2; orthogonal cases
  // can win for very elongated grids, so take the max of all three.
  const wrapSize = Math.max(gridW, gridH, (gridW + gridH) * Math.SQRT1_2);
  return (
    <div style={{ position: 'relative', width: wrapSize, height: wrapSize }}>
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: `translate(-50%, -50%) rotate(${angleDeg}deg)`,
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, ${cellSize}px)`,
          gap,
        }}
      >
        {cells}
      </div>
    </div>
  );
}
