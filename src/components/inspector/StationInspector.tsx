import { useCallback, useMemo, useRef } from 'react';
import { useDoc, useSelection } from '../../state/store';
import { dispatchMirrored } from '../../state/mirrorDispatch';
import type { StationId } from '../../model/types';
import { findMatchingStations, type LayoutOffset } from '../../model/matching';
import { rotateGridDelta } from '../../geometry/orientation';
import { StopGrid } from './StopGrid';
import { LabelOffsetControl } from './LabelOffsetControl';
import { LabelAlignPicker, LabelValignPicker } from './LabelAlignButtons';
import { useFieldHistory } from '../useFieldHistory';
import { useNumericField } from '../useNumericField';
import { useDismiss } from '../usePopover';
import { StationShapePicker } from '../StationShapePicker';
import { resolveDotStyle, resolveOffsetPerp } from '../../model/transforms';
import { DEFAULT_DOT_STYLE, DOT_SHAPE_PRESETS } from '../../model/dotStyle';
import { DOT_SIZE_DEFAULT, DOT_SIZE_MIN, resolveDotSize } from '../../model/dotSize';

export function StationInspector({ id }: { id: StationId }) {
  const station = useDoc((s) => s.stations[id]);
  const stationsAll = useDoc((s) => s.stations);
  const linesAll = useDoc((s) => s.lines);
  const renameStation = useDoc((s) => s.renameStation);
  const rotateStation = useDoc((s) => s.rotateStation);
  const moveStation = useDoc((s) => s.moveStation);
  const moveStopAction = useDoc((s) => s.moveStop);
  const rotateStopAction = useDoc((s) => s.rotateStop);
  const moveLabelAction = useDoc((s) => s.moveLabel);
  const rotateLabelAction = useDoc((s) => s.rotateLabel);
  const setLabelOffset = useDoc((s) => s.setLabelOffset);
  const setLabelOffsetPerp = useDoc((s) => s.setLabelOffsetPerp);
  const setLabelAlign = useDoc((s) => s.setLabelAlign);
  const setLabelValign = useDoc((s) => s.setLabelValign);
  const setDotStyle = useDoc((s) => s.setDotStyle);
  const setDotSize = useDoc((s) => s.setDotSize);
  const setStationWaypoint = useDoc((s) => s.setStationWaypoint);
  const setStationLocked = useDoc((s) => s.setStationLocked);
  const setStationLabelBold = useDoc((s) => s.setStationLabelBold);
  const setStationLabelItalic = useDoc((s) => s.setStationLabelItalic);
  const selection = useSelection();
  const nameField = useFieldHistory();
  const xField = useFieldHistory();
  const yField = useFieldHistory();
  const stopAreaRef = useRef<HTMLDivElement | null>(null);
  const shapePickerRef = useRef<HTMLDivElement | null>(null);

  // Stations that render identically to this one (across the model's 4-fold
  // mirror symmetry) AND share a line with it. Each carries a layoutOffset
  // (0–3) describing how its unrotated grid maps to the source's, so callers
  // that propagate (dRow, dCol) edits can rotate them to match.
  const matches = useMemo(
    () => findMatchingStations({ stations: stationsAll, lines: linesAll }, id),
    [stationsAll, linesAll, id],
  );

  // Mirror-aware dispatch: with mirror on, `act` fans out to every matching
  // station in one history group (see state/mirrorDispatch.ts).
  const dispatchAll = (act: (sid: StationId, layoutOffset: LayoutOffset) => void) =>
    dispatchMirrored(id, act);

  const selectedLineId = selection.selectedStopLineId;
  const labelSelected = selection.labelSelected;
  const hasSelection = !!(selectedLineId || labelSelected);

  // Temporary per-stop size override control (a picker UI comes later).
  // Shows the selected stop's RESOLVED size; writing the line's effective
  // default back clears the override via `setDotSize`'s contract.
  const dotSizeDisabled = selectedLineId === null || labelSelected;
  const dotSizeField = useNumericField(
    selectedLineId === null
      ? DOT_SIZE_DEFAULT
      : resolveDotSize(
          linesAll[selectedLineId],
          station?.stops.find((s) => s.lineId === selectedLineId),
        ),
    (n) => {
      if (selectedLineId === null) return;
      // dotSize is rotation-invariant — no per-match transform.
      dispatchAll((sid) => setDotSize(sid, selectedLineId, n));
    },
    () => {
      const lid = useSelection.getState().selectedStopLineId;
      if (lid === null) return DOT_SIZE_DEFAULT;
      const docNow = useDoc.getState();
      return resolveDotSize(
        docNow.lines[lid],
        docNow.stations[id]?.stops.find((s) => s.lineId === lid),
      );
    },
  );

  // Standard deselect: Escape, or mousedown anywhere outside the stop area
  // (the StopGrid). Clicks on canvas/sidebar already deselect via
  // selectStation; this covers the remaining "click on something else
  // within the inspector" case.
  // Clicks inside the StopGrid (stopAreaRef) and the shape picker
  // (shapePickerRef) act on the selected stop, so they must not deselect.
  const clearStopSelection = useCallback(() => {
    selection.setSelectedStopLineId(null);
    selection.setLabelSelected(false);
  }, [selection]);
  useDismiss(hasSelection, clearStopSelection, [stopAreaRef, shapePickerRef]);

  if (!station) return null;

  const mirrorOn = selection.mirrorMatching;
  const mirrorAvailable = matches.length > 0;
  const inLayoutEdit =
    selection.uiMode.kind === 'editing-station-layout' && selection.uiMode.stationId === station.id;

  return (
    <section className="inspector">
      <div className="field">
        <label>Name</label>
        <textarea
          value={station.name}
          onChange={(e) => renameStation(station.id, e.target.value)}
          rows={Math.max(1, station.name.split('\n').length)}
          style={{ resize: 'vertical', whiteSpace: 'pre', overflow: 'auto' }}
          {...nameField}
        />
      </div>
      <div className="field">
        <label>Position &amp; rotation</label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="axis-label" aria-hidden>
            X
          </span>
          <input
            type="number"
            aria-label="X"
            value={Math.round(station.x)}
            onChange={(e) => moveStation(station.id, Number(e.target.value), station.y)}
            style={{ width: 44 }}
            {...xField}
          />
          <span className="axis-label" aria-hidden>
            Y
          </span>
          <input
            type="number"
            aria-label="Y"
            value={Math.round(station.y)}
            onChange={(e) => moveStation(station.id, station.x, Number(e.target.value))}
            style={{ width: 44 }}
            {...yField}
          />
          <button
            className="btn-mini"
            onClick={() => {
              for (let i = 0; i < 7; i++) rotateStation(station.id);
            }}
            title="Rotate −45°"
            aria-label="Rotate −45°"
          >
            ⟲
          </button>
          <button
            className="btn-mini"
            onClick={() => rotateStation(station.id)}
            title="Rotate +45°"
            aria-label="Rotate +45°"
          >
            ⟳
          </button>
          <span className="axis-label" title="Station rotation">
            {station.rotation * 45}°
          </span>
          <button
            className={`btn-mini${mirrorOn ? ' mirror-on' : ''}`}
            onClick={() => selection.setMirrorMatching(!mirrorOn)}
            disabled={!mirrorAvailable && !mirrorOn}
            title={
              mirrorAvailable
                ? `Mirror layout edits to ${matches.length} matching neighbor${matches.length === 1 ? '' : 's'}`
                : 'No directly-connected stations share this layout'
            }
            aria-pressed={mirrorOn}
          >
            {mirrorAvailable ? `Mirror ×${matches.length}` : 'Mirror'}
          </button>
          <div
            ref={shapePickerRef}
            style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}
          >
            <StationShapePicker
              disabled={selectedLineId === null || labelSelected}
              currentStyle={
                selectedLineId === null
                  ? DEFAULT_DOT_STYLE
                  : resolveDotStyle(
                      linesAll[selectedLineId],
                      station.stops.find((s) => s.lineId === selectedLineId),
                    )
              }
              lineColor={selectedLineId === null ? undefined : linesAll[selectedLineId]?.color}
              serviceCode={selectedLineId === null ? undefined : linesAll[selectedLineId]?.service}
              onPick={(shape) => {
                if (selectedLineId === null) return;
                dispatchAll((sid) => setDotStyle(sid, selectedLineId, DOT_SHAPE_PRESETS[shape]));
                // dotStyle is rotation-invariant — no per-match transform.
              }}
            />
            {/* Inside shapePickerRef so useDismiss treats clicks here as
                acting on the selected stop rather than deselecting it. */}
            <input
              type="number"
              aria-label="Stop dot size"
              min={DOT_SIZE_MIN}
              step={1}
              style={{ width: 44 }}
              disabled={dotSizeDisabled}
              value={dotSizeField.text}
              title={dotSizeDisabled ? 'Stop dot size — select a stop first' : 'Stop dot size (px)'}
              onFocus={dotSizeField.onNumberFocus}
              onChange={dotSizeField.onNumberChange}
              onWheel={dotSizeField.onNumberWheel}
              onBlur={dotSizeField.onNumberBlur}
            />
          </div>
          <button
            type="button"
            className={`btn-mini${station.isWaypoint ? ' wp-on' : ''}`}
            aria-pressed={!!station.isWaypoint}
            aria-label="Waypoint"
            title={
              station.isWaypoint
                ? 'Waypoint on — name + bullets hidden'
                : 'Mark as waypoint (hide name + bullets)'
            }
            onClick={() => setStationWaypoint(station.id, !station.isWaypoint)}
          >
            WP
          </button>
          <button
            type="button"
            className={`btn-mini${station.locked ? ' lock-on' : ''}`}
            aria-pressed={!!station.locked}
            aria-label={station.locked ? 'Unlock station' : 'Lock station'}
            title={
              station.locked
                ? 'Unlock — allow dragging, marquee-select, and delete'
                : 'Lock (prevents dragging, marquee-select, and delete)'
            }
            onClick={() => setStationLocked(station.id, !station.locked)}
          >
            {station.locked ? '🔒' : '🔓'}
          </button>
        </div>
      </div>
      <div className="field">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <label>Stop layout</label>
          {/* Enter/exit editing-station-layout: the full stop/label editor
              on the real station, on the main canvas. */}
          <button
            type="button"
            className={`btn-mini${inLayoutEdit ? ' active' : ''}`}
            aria-pressed={inLayoutEdit}
            title={
              inLayoutEdit
                ? 'Exit the on-canvas layout editor (Esc)'
                : 'Edit stops + label on the map: drag between slots, right-click or R rotates, arrows nudge'
            }
            onClick={() =>
              inLayoutEdit
                ? selection.setUiMode({ kind: 'idle' })
                : selection.startEditingStationLayout(station.id)
            }
          >
            {inLayoutEdit ? 'Done' : 'Edit layout'}
          </button>
        </div>
        <div ref={stopAreaRef} style={{ display: 'flex', justifyContent: 'center' }}>
          <StopGrid
            key={id}
            station={station}
            lines={linesAll}
            selectedLineId={selectedLineId}
            labelSelected={labelSelected}
            onSelectStop={(lid) => selection.setSelectedStopLineId(lid)}
            onSelectLabel={() => selection.setLabelSelected(true)}
            onRotateStop={(lid) => dispatchAll((sid) => rotateStopAction(sid, lid))}
            onRotateLabel={() => dispatchAll((sid) => rotateLabelAction(sid))}
            onMoveStop={(lid, dRow, dCol) =>
              dispatchAll((sid, k) => {
                // Local-frame deltas must be rotated by the match's
                // layoutOffset so the world-frame edit matches the source.
                const d = rotateGridDelta(dRow, dCol, k);
                moveStopAction(sid, lid, d.dRow, d.dCol);
              })
            }
            onMoveLabel={(dRow, dCol) =>
              dispatchAll((sid, k) => {
                const d = rotateGridDelta(dRow, dCol, k);
                moveLabelAction(sid, d.dRow, d.dCol);
              })
            }
          />
        </div>
      </div>
      <div className="field">
        <label>Label</label>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {/* Clicks are absolute (set, not cycle), so mirror mode is a plain
              broadcast of the same value — matching stations can't diverge. */}
          <LabelAlignPicker
            align={station.label.align}
            onSet={(v) => dispatchAll((sid) => setLabelAlign(sid, v))}
          />
          <button
            type="button"
            className={`btn-mini${station.labelBold ? ' active' : ''}`}
            aria-pressed={!!station.labelBold}
            aria-label="Bold"
            title={
              station.labelBold
                ? 'Bold on — text renders two weights heavier than the default'
                : 'Bold this station (renders two weights heavier than the default)'
            }
            onClick={() => setStationLabelBold(station.id, !station.labelBold)}
          >
            <strong>B</strong>
          </button>
          <button
            type="button"
            className={`btn-mini${station.labelItalic ? ' active' : ''}`}
            aria-pressed={!!station.labelItalic}
            aria-label="Italic"
            title={
              station.labelItalic
                ? 'Italic on — this station’s name renders italic'
                : 'Italicize this station’s name'
            }
            onClick={() => setStationLabelItalic(station.id, !station.labelItalic)}
          >
            <em>I</em>
          </button>
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          <LabelValignPicker
            valign={station.label.valign}
            onSet={(v) => dispatchAll((sid) => setLabelValign(sid, v))}
          />
        </div>
        <div className="field-hint">Offset (along reading direction)</div>
        <LabelOffsetControl
          value={station.label.offset}
          onChange={(v) => dispatchAll((sid) => setLabelOffset(sid, v))}
          indeterminate={
            mirrorOn &&
            matches.some((m) => stationsAll[m.id]?.label.offset !== station.label.offset)
          }
        />
        <div className="field-hint">Offset (perpendicular to reading direction)</div>
        <LabelOffsetControl
          value={resolveOffsetPerp(station.label)}
          onChange={(v) => dispatchAll((sid) => setLabelOffsetPerp(sid, v))}
          indeterminate={
            mirrorOn &&
            matches.some(
              (m) =>
                resolveOffsetPerp(stationsAll[m.id]?.label) !== resolveOffsetPerp(station.label),
            )
          }
        />
      </div>
    </section>
  );
}
