type GridStopOrientation = 'up' | 'down' | 'auto-vertical' | 'left' | 'right' | 'auto-horizontal';

type GridStation = {
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

export function StopGrid({
  station,
  lines,
  selectedLineId,
  labelSelected,
  onSelectStop,
  onSelectLabel,
}: {
  station: GridStation;
  lines: Record<string, { color: string; service: string }>;
  selectedLineId: string | null;
  labelSelected: boolean;
  onSelectStop: (lineId: string | null) => void;
  onSelectLabel: () => void;
}) {
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
      const selected = (isLabel && labelSelected) || (!!stop && stop.lineId === selectedLineId);
      cells.push(
        <div
          key={`${r},${c}`}
          onClick={() => {
            if (isLabel) onSelectLabel();
            else if (stop) onSelectStop(stop.lineId);
            else onSelectStop(null);
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
            cursor: isLabel || stop ? 'pointer' : 'default',
            textShadow: isLabel ? undefined : '0 0 2px rgba(0,0,0,0.6)',
            boxSizing: 'border-box',
            transform: isLabel ? `rotate(${label.rotation * 45}deg)` : undefined,
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
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, ${cellSize}px)`,
        gap: 2,
      }}
    >
      {cells}
    </div>
  );
}
