import { useDoc, useSelection } from '../../state/store';
import type { StationId } from '../../model/types';
import { StopGrid } from './StopGrid';
import { LabelOffsetControl } from './LabelOffsetControl';
import { useFieldHistory } from '../useFieldHistory';

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
  const nameField = useFieldHistory();
  const xField = useFieldHistory();
  const yField = useFieldHistory();

  if (!station) return null;

  const selectedLineId = selection.selectedStopLineId;
  const labelSelected = selection.labelSelected;
  const selectedStopCell = selectedLineId
    ? station.stops.find((c) => c.lineId === selectedLineId)
    : null;
  const hasSelection = selectedStopCell || labelSelected;

  // Arrow buttons act in the displayed frame: clicking ↑ moves the cell
  // toward the top of the screen, regardless of how the grid is rotated.
  // For 90° rotations we remap the cardinal delta into unrotated grid
  // coords; at 45° offsets the rotation is purely visual and the arrows
  // continue to operate in unrotated grid coords (no clean cardinal
  // mapping exists for a half-turn).
  const quarterTurns = station.rotation % 2 === 0 ? station.rotation / 2 : 0;
  const toUnrotatedDelta = (dRow: number, dCol: number) => {
    let dr = dRow;
    let dc = dCol;
    for (let i = 0; i < quarterTurns; i++) {
      [dr, dc] = [-dc, dr];
    }
    return { dRow: dr, dCol: dc };
  };

  const onMove = (dRow: number, dCol: number) => {
    const m = toUnrotatedDelta(dRow, dCol);
    if (selectedStopCell) {
      moveStopAction(station.id, selectedStopCell.lineId, m.dRow, m.dCol);
    } else if (labelSelected) {
      moveLabelAction(station.id, m.dRow, m.dCol);
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
      const m = toUnrotatedDelta(dRow, dCol);
      const newRow = selectedStopCell.row + m.dRow;
      const newCol = selectedStopCell.col + m.dCol;
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
          {...nameField}
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
            {...xField}
          />
          <input
            type="number"
            value={Math.round(station.y)}
            onChange={(e) => moveStation(station.id, station.x, Number(e.target.value))}
            style={{ width: 70 }}
            {...yField}
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
        <label>Stop layout</label>
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
            >
              ↑
            </button>
            <span />
            <button
              className="btn-mini"
              disabled={!hasSelection || isBlocked(0, -1)}
              onClick={() => onMove(0, -1)}
            >
              ←
            </button>
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
            >
              →
            </button>
            <span />
            <button
              className="btn-mini"
              disabled={!hasSelection || isBlocked(1, 0)}
              onClick={() => onMove(1, 0)}
            >
              ↓
            </button>
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
