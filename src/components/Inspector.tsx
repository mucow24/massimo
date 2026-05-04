import { MTA_PALETTE, useDoc, useSelection } from '../state/store';
import type { LineId, StationId } from '../state/types';

export function Inspector() {
  const selection = useSelection();
  // While appending to a line, the line inspector is sticky — even if a
  // station gets selected (e.g. via the sidebar), the line editor stays open.
  if (selection.appendingToLineId) return <LineInspector id={selection.appendingToLineId} />;
  if (selection.selectedStationId) return <StationInspector id={selection.selectedStationId} />;
  if (selection.selectedLineId) return <LineInspector id={selection.selectedLineId} />;
  return null;
}

export function StationInspector({ id }: { id: StationId }) {
  const station = useDoc((s) => s.stations[id]);
  const lines = useDoc((s) => s.lines);
  const renameStation = useDoc((s) => s.renameStation);
  const rotateStation = useDoc((s) => s.rotateStation);
  const rotateStationAndLayout = useDoc((s) => s.rotateStationAndLayout);
  const moveStation = useDoc((s) => s.moveStation);
  const moveStopAction = useDoc((s) => s.moveStop);
  const rotateStopAction = useDoc((s) => s.rotateStop);
  const moveLabelAction = useDoc((s) => s.moveLabel);
  const rotateLabelAction = useDoc((s) => s.rotateLabel);
  const mirrorLabelAction = useDoc((s) => s.mirrorLabel);
  const flipLabelAction = useDoc((s) => s.flipLabel);
  const setLabelOffset = useDoc((s) => s.setLabelOffset);
  const selection = useSelection();

  if (!station) return null;

  const selectedLineId = selection.selectedStopLineId;
  const labelSelected = selection.labelSelected;
  const selectedStopCell = selectedLineId
    ? station.stops.find((c) => c.lineId === selectedLineId)
    : null;
  const hasSelection = selectedStopCell || labelSelected;

  const onMove = (dRow: number, dCol: number) => {
    if (selectedStopCell) {
      moveStopAction(station.id, selectedStopCell.lineId, dRow, dCol);
    } else if (labelSelected) {
      moveLabelAction(station.id, dRow, dCol);
    }
  };
  const onRotateCell = () => {
    if (selectedStopCell) rotateStopAction(station.id, selectedStopCell.lineId);
    else if (labelSelected) rotateLabelAction(station.id);
  };

  // Disable arrows only for stop moves whose target is the label cell —
  // stops can swap with each other but can't enter the label cell. Label
  // moves never get disabled now (they jump past blocking stops).
  const isBlocked = (dRow: number, dCol: number): boolean => {
    if (selectedStopCell) {
      const newRow = selectedStopCell.row + dRow;
      const newCol = selectedStopCell.col + dCol;
      return station.label.row === newRow && station.label.col === newCol;
    }
    return false;
  };

  return (
    <section className="inspector">
      <div className="field">
        <label>Name</label>
        <input
          type="text"
          value={station.name}
          onChange={(e) => renameStation(station.id, e.target.value)}
        />
      </div>
      <div className="field">
        <label>Position</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type="number"
            value={Math.round(station.x)}
            onChange={(e) => moveStation(station.id, Number(e.target.value), station.y)}
            style={{ width: 70 }}
          />
          <input
            type="number"
            value={Math.round(station.y)}
            onChange={(e) => moveStation(station.id, station.x, Number(e.target.value))}
            style={{ width: 70 }}
          />
        </div>
      </div>
      <div className="field">
        <label>Rotation: {station.rotation * 45}°</label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className="btn-mini" onClick={() => rotateStation(station.id)}>
            Rotate +45°
          </button>
          <button
            className="btn-mini"
            onClick={() => {
              for (let i = 0; i < 7; i++) rotateStation(station.id);
            }}
          >
            Rotate −45°
          </button>
          <button
            className="btn-mini"
            onClick={() => {
              const need = (8 - station.rotation) % 8;
              for (let i = 0; i < need; i++) rotateStation(station.id);
            }}
          >
            Reset
          </button>
          <button
            className="btn-mini"
            onClick={() => {
              for (let i = 0; i < 4; i++) rotateStation(station.id);
              mirrorLabelAction(station.id);
            }}
            title="Rotate the station 180° and mirror the label so it stays on the same side"
          >
            Flip station
          </button>
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          <button
            className="btn-mini"
            onClick={() => rotateStationAndLayout(station.id, -1)}
            title="Rotate the station and stop layout 90° counter-clockwise"
          >
            R−
          </button>
          <button
            className="btn-mini"
            onClick={() => rotateStationAndLayout(station.id, 1)}
            title="Rotate the station and stop layout 90° clockwise"
          >
            R+
          </button>
        </div>
      </div>
      <div className="field">
        <label>Stop layout (unrotated)</label>
        <div style={{ marginBottom: 6, display: 'flex', gap: 4 }}>
          <button
            className="btn-mini"
            onClick={() => mirrorLabelAction(station.id)}
            title="Move the label to the opposite side of the stops and flip 180°"
          >
            Mirror label
          </button>
          <button
            className="btn-mini"
            onClick={() => flipLabelAction(station.id)}
            title="Rotate the label 180° (without moving it)"
          >
            Flip label
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          {/* Controls FIRST, grid second — so the controls don't jump
              around as the grid resizes when stops/label move. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 22px)', gap: 2 }}>
            <span />
            <button
              className="btn-mini"
              disabled={!hasSelection || isBlocked(-1, 0)}
              onClick={() => onMove(-1, 0)}
            >↑</button>
            <span />
            <button
              className="btn-mini"
              disabled={!hasSelection || isBlocked(0, -1)}
              onClick={() => onMove(0, -1)}
            >←</button>
            <button
              className="btn-mini"
              disabled={!hasSelection}
              onClick={onRotateCell}
              title={labelSelected ? 'Rotate label' : 'Rotate stop'}
            >
              ⟳
            </button>
            <button
              className="btn-mini"
              disabled={!hasSelection || isBlocked(0, 1)}
              onClick={() => onMove(0, 1)}
            >→</button>
            <span />
            <button
              className="btn-mini"
              disabled={!hasSelection || isBlocked(1, 0)}
              onClick={() => onMove(1, 0)}
            >↓</button>
            <span />
          </div>
          <StopGrid
            station={station}
            lines={lines}
            selectedLineId={selectedLineId}
            labelSelected={labelSelected}
            onSelectStop={(lid) => selection.setSelectedStopLineId(lid)}
            onSelectLabel={() => selection.setLabelSelected(true)}
          />
        </div>
      </div>
      <div className="field">
        <label>Label offset (along reading direction)</label>
        <LabelOffsetControl
          value={station.label.offset}
          onChange={(v) => setLabelOffset(station.id, v)}
        />
      </div>
    </section>
  );
}

function LabelOffsetControl({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  // Slider [-100, 100] with detent at 0; textbox accepts any number.
  // Snap to 0 when the slider sits within ±2 of zero.
  const clampedSlider = Math.max(-100, Math.min(100, value));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <input
        type="range"
        min={-100}
        max={100}
        step={1}
        value={clampedSlider}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(Math.abs(n) <= 2 ? 0 : n);
        }}
        style={{ flex: 1 }}
      />
      <input
        type="number"
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
        style={{ width: 56 }}
      />
    </div>
  );
}

type GridStopOrientation =
  | 'up'
  | 'down'
  | 'auto-vertical'
  | 'left'
  | 'right'
  | 'auto-horizontal';

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

function StopGrid({
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
      const selected =
        (isLabel && labelSelected) ||
        (!!stop && stop.lineId === selectedLineId);
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

function ColorPalette({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const v = value.toLowerCase();
  const isCustom = !MTA_PALETTE.some((p) => p.color.toLowerCase() === v);
  const swatchBase: React.CSSProperties = {
    width: 22,
    height: 22,
    borderRadius: 3,
    cursor: 'pointer',
    padding: 0,
    boxSizing: 'border-box',
  };
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {MTA_PALETTE.map((p) => {
        const selected = v === p.color.toLowerCase();
        return (
          <button
            key={p.color}
            type="button"
            title={p.name}
            onClick={() => onChange(p.color)}
            style={{
              ...swatchBase,
              background: p.color,
              border: selected ? '2px solid #000' : '1px solid rgba(0,0,0,0.2)',
            }}
          />
        );
      })}
      <label
        title={isCustom ? `Custom (${value})` : 'Custom'}
        style={{
          ...swatchBase,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: isCustom ? value : '#fff',
          border: isCustom ? '2px solid #000' : '1px dashed rgba(0,0,0,0.4)',
          fontSize: 12,
          color: isCustom ? '#fff' : '#666',
          fontWeight: 700,
          textShadow: isCustom ? '0 0 2px rgba(0,0,0,0.5)' : undefined,
        }}
      >
        ?
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{
            position: 'absolute',
            width: 0,
            height: 0,
            opacity: 0,
            pointerEvents: 'none',
          }}
        />
      </label>
    </div>
  );
}

export function LineInspector({ id }: { id: LineId }) {
  const line = useDoc((s) => s.lines[id]);
  const stations = useDoc((s) => s.stations);
  const updateLine = useDoc((s) => s.updateLine);
  const removeStationFromLine = useDoc((s) => s.removeStationFromLine);
  const reorderLineStations = useDoc((s) => s.reorderLineStations);
  const selection = useSelection();

  if (!line) return null;

  const moveSt = (idx: number, dir: -1 | 1) => {
    const arr = [...line.stations];
    const j = idx + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    reorderLineStations(line.id, arr);
  };

  const isAppending = selection.appendingToLineId === line.id;

  return (
    <section className="inspector">
      <h2>Line</h2>
      <div className="field">
        <label>Service code</label>
        <input
          type="text"
          maxLength={3}
          value={line.service}
          onChange={(e) => updateLine(line.id, { service: e.target.value.toUpperCase() })}
        />
      </div>
      <div className="field">
        <label>Color</label>
        <ColorPalette
          value={line.color}
          onChange={(c) => updateLine(line.id, { color: c })}
        />
      </div>
      <div className="field">
        <label>Stations ({line.stations.length})</label>
        {line.stations.length === 0 && (
          <button
            className="btn-mini"
            onClick={() => selection.startAppendAt(line.id, -1)}
            style={
              isAppending
                ? { background: line.color, color: '#fff', borderColor: line.color }
                : undefined
            }
          >
            {isAppending ? 'Stop adding' : 'Add stations from map'}
          </button>
        )}
        {line.stations.map((sid, i) => {
          const st = stations[sid];
          if (!st) return null;
          const isActiveCursor = isAppending && selection.insertAfterIndex === i;
          return (
            <div key={i + ':' + sid}>
              <div className="list-row" style={{ paddingLeft: 0 }}>
                <span style={{ width: 18, color: '#999' }}>{i + 1}.</span>
                <span className="grow">{st.name}</span>
                <button className="btn-mini icon" disabled={i === 0} onClick={() => moveSt(i, -1)}>↑</button>
                <button
                  className="btn-mini icon"
                  disabled={i === line.stations.length - 1}
                  onClick={() => moveSt(i, 1)}
                >↓</button>
                {isActiveCursor ? (
                  <button
                    className="btn-mini icon"
                    onClick={() => selection.setAppending(null)}
                    style={{ background: line.color, color: '#fff', borderColor: line.color }}
                    title="Stop adding stations"
                  >
                    ■
                  </button>
                ) : (
                  <button
                    className="btn-mini icon"
                    onClick={() => selection.startAppendAt(line.id, i)}
                    title={`Insert stations after ${st.name}`}
                  >
                    +
                  </button>
                )}
                <button className="btn-mini danger" onClick={() => removeStationFromLine(line.id, i)}>×</button>
              </div>
              {isActiveCursor && (
                <div
                  style={{
                    height: 3,
                    background: line.color,
                    margin: '2px 0',
                    borderRadius: 1.5,
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
