import { useCallback, useMemo, useRef } from 'react';
import { useDoc, useSelection } from '../../state/store';
import { dispatchMirrored } from '../../state/mirrorDispatch';
import type { StationId } from '../../model/types';
import { findMatchingStations, type LayoutOffset } from '../../model/matching';
import { LabelOffsetControl } from './LabelOffsetControl';
import { LabelAlignPicker, LabelValignPicker } from './LabelAlignButtons';
import { StopRows } from './StopRows';
import { useFieldHistory } from '../useFieldHistory';
import { useDismiss } from '../usePopover';
import { resolveOffsetPerp } from '../../model/transforms';

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
  const setStationWaypoint = useDoc((s) => s.setStationWaypoint);
  const setStationLocked = useDoc((s) => s.setStationLocked);
  const setStationLabelBold = useDoc((s) => s.setStationLabelBold);
  const setStationLabelItalic = useDoc((s) => s.setStationLabelItalic);
  const selection = useSelection();
  const nameField = useFieldHistory();
  const xField = useFieldHistory();
  const yField = useFieldHistory();
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
  // station in one history group (see state/mirrorDispatch.ts).
  const dispatchAll = (act: (sid: StationId, layoutOffset: LayoutOffset) => void) =>
    dispatchMirrored(id, act);

  const hasSelection = !!(selection.selectedStopLineId || selection.labelSelected);

  // Standard deselect for the canvas sub-selection (the layout-editor ring +
  // keyboard-nudge target): Escape, or mousedown outside the stop rows.
  // Canvas handle clicks re-assert the selection on pointerup (the layout-
  // editor and label-drag hooks select AFTER this document-level mousedown
  // clear), so acting on a stop from the map survives; clicks on other
  // inspector fields or the sidebar genuinely deselect.
  const clearStopSelection = useCallback(() => {
    selection.setSelectedStopLineId(null);
    selection.setLabelSelected(false);
  }, [selection]);
  useDismiss(hasSelection, clearStopSelection, [stopRowsRef]);

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
