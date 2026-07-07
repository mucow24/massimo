import { useCallback, useMemo, useRef } from 'react';
import {
  FontBoldIcon,
  FontItalicIcon,
  LockClosedIcon,
  LockOpen1Icon,
  MagicWandIcon,
  RotateCounterClockwiseIcon,
} from '@radix-ui/react-icons';
import { useDoc, useSelection } from '../../state/store';
import { dispatchMirrored } from '../../state/mirrorDispatch';
import type { StationId } from '../../model/types';
import { findMatchingStations, type LayoutOffset } from '../../model/matching';
import { LabelOffsetControl } from './LabelOffsetControl';
import { LabelAlignCycleButton, LabelValignCycleButton } from './LabelAlignButtons';
import { StopRows } from './StopRows';
import { useFieldHistory } from '../useFieldHistory';
import { useNumericField } from '../useNumericField';
import { useDismiss } from '../usePopover';
import { resolveAutoAlign, resolveOffsetPerp } from '../../model/transforms';

export function StationInspector({ id }: { id: StationId }) {
  const station = useDoc((s) => s.stations[id]);
  const stationsAll = useDoc((s) => s.stations);
  const linesAll = useDoc((s) => s.lines);
  const renameStation = useDoc((s) => s.renameStation);
  const rotateStation = useDoc((s) => s.rotateStation);
  const moveStation = useDoc((s) => s.moveStation);
  const setLabelOffset = useDoc((s) => s.setLabelOffset);
  const setLabelOffsetPerp = useDoc((s) => s.setLabelOffsetPerp);
  const setLabelAlign = useDoc((s) => s.setLabelAlign);
  const setLabelValign = useDoc((s) => s.setLabelValign);
  const setLabelAutoAlign = useDoc((s) => s.setLabelAutoAlign);
  const setStationWaypoint = useDoc((s) => s.setStationWaypoint);
  const setStationLocked = useDoc((s) => s.setStationLocked);
  const setStationLabelBold = useDoc((s) => s.setStationLabelBold);
  const setStationLabelItalic = useDoc((s) => s.setStationLabelItalic);
  const selection = useSelection();
  const nameField = useFieldHistory();
  // useNumericField (not bare inputs): its text mirror ignores an emptied
  // field mid-edit — Number('') === 0 would teleport the station to the axis.
  const xField = useNumericField(
    Math.round(station?.x ?? 0),
    (n) => moveStation(id, n, useDoc.getState().stations[id].y),
    () => Math.round(useDoc.getState().stations[id]?.x ?? 0),
  );
  const yField = useNumericField(
    Math.round(station?.y ?? 0),
    (n) => moveStation(id, useDoc.getState().stations[id].x, n),
    () => Math.round(useDoc.getState().stations[id]?.y ?? 0),
  );
  const stopRowsRef = useRef<HTMLDivElement | null>(null);

  // Stations that render identically to this one (across the model's 4-fold
  // mirror symmetry) AND share a line with it. Each carries a layoutOffset
  // (0–3) describing how its unrotated grid maps to the source's, so callers
  // that propagate (dRow, dCol) edits can rotate them to match.
  const matches = useMemo(
    () => findMatchingStations({ stations: stationsAll, lines: linesAll }, id),
    [stationsAll, linesAll, id],
  );

  // Mirror-aware dispatch: with mirror on, `act` fans out to every matching
  // station in one history group (see state/mirrorDispatch.ts — including
  // the isHistoryGrouping gate from #146 for focused-field edit arcs).
  const dispatchAll = (act: (sid: StationId, layoutOffset: LayoutOffset) => void) =>
    dispatchMirrored(id, act);

  const hasSelection = !!(selection.selectedStopLineId || selection.labelSelected);

  // Standard deselect for the canvas sub-selection (the layout-editor ring +
  // keyboard-nudge target): mousedown outside the stop rows. Canvas handle
  // clicks re-assert the selection on pointerup (the layout-editor and
  // label-drag hooks select AFTER this document-level mousedown clear), so
  // acting on a stop from the map survives; clicks on other inspector fields
  // or the sidebar genuinely deselect. Escape is handled by the hosting
  // StationPopover's step-out ladder, NOT here — two Escape listeners over
  // the same state would race on attachment order.
  const clearStopSelection = useCallback(() => {
    selection.setSelectedStopLineId(null);
    selection.setLabelSelected(false);
  }, [selection]);
  useDismiss(hasSelection, clearStopSelection, [stopRowsRef], { escape: false });

  if (!station) return null;

  const mirrorOn = selection.mirrorMatching;
  const inLayoutEdit =
    selection.uiMode.kind === 'editing-station-layout' && selection.uiMode.stationId === station.id;

  return (
    <section className="inspector">
      <div className="field">
        <div className="field-header">
          <label>Name</label>
          <button
            type="button"
            className={`chip-btn${station.isWaypoint ? ' wp-on' : ''}`}
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
            className={`chip-btn${station.locked ? ' lock-on' : ''}`}
            aria-pressed={!!station.locked}
            aria-label={station.locked ? 'Unlock station' : 'Lock station'}
            title={
              station.locked
                ? 'Unlock — allow dragging, marquee-select, and delete'
                : 'Lock (prevents dragging, marquee-select, and delete)'
            }
            onClick={() => setStationLocked(station.id, !station.locked)}
          >
            {station.locked ? <LockClosedIcon /> : <LockOpen1Icon />}
          </button>
        </div>
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
        <div className="field-row">
          <span className="axis-label" aria-hidden>
            X
          </span>
          <input
            type="number"
            aria-label="X"
            value={xField.text}
            onChange={xField.onNumberChange}
            onFocus={xField.onNumberFocus}
            onBlur={xField.onNumberBlur}
            style={{ width: 56 }}
          />
          <span className="axis-label" aria-hidden>
            Y
          </span>
          <input
            type="number"
            aria-label="Y"
            value={yField.text}
            onChange={yField.onNumberChange}
            onFocus={yField.onNumberFocus}
            onBlur={yField.onNumberBlur}
            style={{ width: 56 }}
          />
          {/* One icon, mirrored, so the ± pair is visually identical. */}
          <button
            className="chip-btn"
            onClick={() => rotateStation(station.id, -1)}
            title="Rotate −45°"
            aria-label="Rotate −45°"
          >
            <RotateCounterClockwiseIcon />
          </button>
          <button
            className="chip-btn"
            onClick={() => rotateStation(station.id)}
            title="Rotate +45°"
            aria-label="Rotate +45°"
          >
            <RotateCounterClockwiseIcon style={{ transform: 'scaleX(-1)' }} />
          </button>
        </div>
      </div>
      <div className="field">
        <div className="field-header">
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
        <div ref={stopRowsRef}>
          <StopRows station={station} lines={linesAll} />
        </div>
        <div className="field-hint">
          {station.stops.length === 0
            ? 'No stops yet — add this station to a line.'
            : inLayoutEdit
              ? 'Drag dots/label on the map; right-click or R rotates, arrows nudge.'
              : 'Positions are edited on the map — click Edit layout.'}
        </div>
      </div>
      <div className="field">
        <label>Label</label>
        <div className="field-row">
          {/* Cycle buttons dispatch the computed next value as an absolute
              set, so mirror mode is a plain broadcast of the same value —
              matching stations can't diverge. The Auto-placement toggle
              follows the same absolute-value dispatch; while it's on the
              align/valign cycles are overridden, so they disable. */}
          <button
            type="button"
            className={`chip-btn${resolveAutoAlign(station.label) ? ' active' : ''}`}
            aria-pressed={resolveAutoAlign(station.label)}
            aria-label="Auto placement"
            title={
              resolveAutoAlign(station.label)
                ? 'Auto placement on — alignment follows the nearest stop (transit-map typography), overriding align/v-align'
                : 'Auto placement: align to the nearest stop with transit-map typography (overrides align/v-align)'
            }
            onClick={() => {
              const next = !resolveAutoAlign(station.label);
              dispatchAll((sid) => setLabelAutoAlign(sid, next));
            }}
          >
            <MagicWandIcon />
          </button>
          <LabelAlignCycleButton
            align={station.label.align}
            disabled={resolveAutoAlign(station.label)}
            onSet={(v) => dispatchAll((sid) => setLabelAlign(sid, v))}
          />
          <LabelValignCycleButton
            valign={station.label.valign}
            disabled={resolveAutoAlign(station.label)}
            onSet={(v) => dispatchAll((sid) => setLabelValign(sid, v))}
          />
          <button
            type="button"
            className={`chip-btn${station.labelBold ? ' active' : ''}`}
            aria-pressed={!!station.labelBold}
            aria-label="Bold"
            title={
              station.labelBold
                ? 'Bold on — text renders two weights heavier than the default'
                : 'Bold this station (renders two weights heavier than the default)'
            }
            onClick={() => setStationLabelBold(station.id, !station.labelBold)}
          >
            <FontBoldIcon />
          </button>
          <button
            type="button"
            className={`chip-btn${station.labelItalic ? ' active' : ''}`}
            aria-pressed={!!station.labelItalic}
            aria-label="Italic"
            title={
              station.labelItalic
                ? 'Italic on — this station’s name renders italic'
                : 'Italicize this station’s name'
            }
            onClick={() => setStationLabelItalic(station.id, !station.labelItalic)}
          >
            <FontItalicIcon />
          </button>
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
