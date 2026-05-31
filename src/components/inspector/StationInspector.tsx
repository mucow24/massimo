import { useCallback, useMemo, useRef } from 'react';
import { beginHistoryGroup, useDoc, useSelection } from '../../state/store';
import type { StationId } from '../../model/types';
import { findMatchingStations, type LayoutOffset } from '../../model/matching';
import { rotateGridDelta } from '../../geometry/orientation';
import { StopGrid } from './StopGrid';
import { LabelOffsetControl } from './LabelOffsetControl';
import { LabelAlignButton, LabelValignButton } from './LabelAlignButtons';
import { useFieldHistory } from '../useFieldHistory';
import { useDismiss } from '../usePopover';
import { StationShapePicker } from '../StationShapePicker';
import { resolveDotShape, resolveOffsetPerp } from '../../model/transforms';

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
  const cycleLabelAlign = useDoc((s) => s.cycleLabelAlign);
  const setLabelAlign = useDoc((s) => s.setLabelAlign);
  const cycleLabelValign = useDoc((s) => s.cycleLabelValign);
  const setLabelValign = useDoc((s) => s.setLabelValign);
  const setDotShape = useDoc((s) => s.setDotShape);
  const setStationWaypoint = useDoc((s) => s.setStationWaypoint);
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

  // When mirror is on, apply `act` to the selected station (offset 0) and
  // every matching station (with its own offset). Wrapped in a single
  // history group so undo collapses the batch into one entry. When off,
  // behaves like a direct call.
  const dispatchAll = (act: (sid: StationId, layoutOffset: LayoutOffset) => void) => {
    if (!selection.mirrorMatching || matches.length === 0) {
      act(id, 0);
      return;
    }
    const group = beginHistoryGroup();
    act(id, 0);
    for (const m of matches) act(m.id, m.layoutOffset);
    group.commit();
  };

  const selectedLineId = selection.selectedStopLineId;
  const labelSelected = selection.labelSelected;
  const hasSelection = !!(selectedLineId || labelSelected);

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
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <input
            type="number"
            value={Math.round(station.x)}
            onChange={(e) => moveStation(station.id, Number(e.target.value), station.y)}
            style={{ width: 44 }}
            {...xField}
          />
          <input
            type="number"
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
            all
          </button>
          <div ref={shapePickerRef} style={{ display: 'inline-flex' }}>
            <StationShapePicker
              disabled={selectedLineId === null || labelSelected}
              currentShape={
                selectedLineId === null
                  ? 'filled-black'
                  : resolveDotShape(
                      linesAll[selectedLineId],
                      station.stops.find((s) => s.lineId === selectedLineId),
                    )
              }
              onPick={(shape) => {
                if (selectedLineId === null) return;
                dispatchAll((sid) => setDotShape(sid, selectedLineId, shape));
                // dotShape is rotation-invariant — no per-match transform.
              }}
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
        </div>
      </div>
      <div className="field">
        <label>Stop layout</label>
        <div ref={stopAreaRef} style={{ display: 'flex', justifyContent: 'center' }}>
          <StopGrid
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
        <div style={{ display: 'flex', gap: 6 }}>
          <LabelAlignButton
            align={station.label.align}
            onCycle={() => {
              // Cycle the primary station; in mirror mode, force matching
              // stations to the SAME resulting align so the group stays in
              // sync (per-station cycle would diverge if their starts differ).
              // Whole batch becomes one undo entry.
              const useMirror = selection.mirrorMatching && matches.length > 0;
              const group = useMirror ? beginHistoryGroup() : null;
              cycleLabelAlign(station.id);
              if (useMirror) {
                const next = useDoc.getState().stations[station.id]?.label.align;
                if (next) {
                  for (const m of matches) setLabelAlign(m.id, next);
                }
              }
              group?.commit();
            }}
          />
          <LabelValignButton
            valign={station.label.valign}
            onCycle={() => {
              const useMirror = selection.mirrorMatching && matches.length > 0;
              const group = useMirror ? beginHistoryGroup() : null;
              cycleLabelValign(station.id);
              if (useMirror) {
                const next = useDoc.getState().stations[station.id]?.label.valign;
                if (next) {
                  for (const m of matches) setLabelValign(m.id, next);
                }
              }
              group?.commit();
            }}
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
