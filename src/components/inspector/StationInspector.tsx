import { useEffect, useMemo, useRef } from 'react';
import { beginHistoryGroup, useDoc, useSelection } from '../../state/store';
import type { StationId } from '../../model/types';
import { findMatchingStations } from '../../model/matching';
import { StopGrid } from './StopGrid';
import { LabelOffsetControl } from './LabelOffsetControl';
import { useFieldHistory } from '../useFieldHistory';
import { StationShapePicker } from '../StationShapePicker';

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
  const selection = useSelection();
  const nameField = useFieldHistory();
  const xField = useFieldHistory();
  const yField = useFieldHistory();
  const stopAreaRef = useRef<HTMLDivElement | null>(null);

  // Stations whose unrotated stop layout is identical to this one and are
  // adjacent on at least one line. Recomputed when stops/lines change.
  const matchingIds = useMemo(
    () => findMatchingStations({ stations: stationsAll, lines: linesAll }, id),
    [stationsAll, linesAll, id],
  );

  // When mirror is on, apply `act` to the selected station and every
  // matching station — wrapped in a single history group so undo collapses
  // the batch into one entry. When off, behaves like a direct call.
  const dispatchAll = (act: (sid: StationId) => void) => {
    if (!selection.mirrorMatching || matchingIds.length === 0) {
      act(id);
      return;
    }
    const group = beginHistoryGroup();
    act(id);
    for (const sid of matchingIds) act(sid);
    group.commit();
  };

  const selectedLineId = selection.selectedStopLineId;
  const labelSelected = selection.labelSelected;
  const hasSelection = !!(selectedLineId || labelSelected);

  // Standard deselect: Escape, or mousedown anywhere outside the stop area
  // (the StopGrid). Clicks on canvas/sidebar already deselect via
  // selectStation; this covers the remaining "click on something else
  // within the inspector" case.
  useEffect(() => {
    if (!hasSelection) return;
    const clear = () => {
      selection.setSelectedStopLineId(null);
      selection.setLabelSelected(false);
    };
    const onMouseDown = (e: MouseEvent) => {
      const root = stopAreaRef.current;
      if (root && root.contains(e.target as Node)) return;
      clear();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clear();
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [hasSelection, selection]);

  if (!station) return null;

  const mirrorOn = selection.mirrorMatching;
  const mirrorAvailable = matchingIds.length > 0;

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
        <label>Position &amp; rotation</label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
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
                ? `Mirror layout edits to ${matchingIds.length} matching neighbor${matchingIds.length === 1 ? '' : 's'}`
                : 'No directly-connected stations share this layout'
            }
            aria-pressed={mirrorOn}
          >
            all
          </button>
          <StationShapePicker />
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
              dispatchAll((sid) => moveStopAction(sid, lid, dRow, dCol))
            }
            onMoveLabel={(dRow, dCol) => dispatchAll((sid) => moveLabelAction(sid, dRow, dCol))}
          />
        </div>
      </div>
      <div className="field">
        <label>Label offset (along reading direction)</label>
        <LabelOffsetControl
          value={station.label.offset}
          onChange={(v) => dispatchAll((sid) => setLabelOffset(sid, v))}
          indeterminate={
            mirrorOn &&
            matchingIds.some((sid) => stationsAll[sid]?.label.offset !== station.label.offset)
          }
        />
      </div>
    </section>
  );
}
