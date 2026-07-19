import { useCallback, useMemo, useRef } from 'react';
import { MagicWandIcon, RotateCounterClockwiseIcon } from '@radix-ui/react-icons';
import { useDoc, useSelection } from '../../state/store';
import { dispatchMirrored } from '../../state/mirrorDispatch';
import type { StationId } from '../../model/types';
import { findMatchingStations, type LayoutOffset } from '../../model/matching';
import { LabelOffsetControl } from './LabelOffsetControl';
import {
  AutoHAlignCycleButton,
  AutoVAlignCycleButton,
  LabelAlignCycleButton,
  LabelValignCycleButton,
} from './LabelAlignButtons';
import { StopRows } from './StopRows';
import { StyleRow } from '../StyleRow';
import { NumericFieldRow } from '../NumericFieldRow';
import { WeightSelect, ItalicButton } from '../WeightItalicControls';
import { useFieldHistory } from '../useFieldHistory';
import { usePersistedTextareaHeight } from '../usePersistedTextareaHeight';
import { useNumericField } from '../useNumericField';
import { useDismiss } from '../usePopover';
import {
  FONT_SIZE_STEP,
  LABEL_FONT_SIZE_MAX,
  LABEL_FONT_SIZE_MIN,
  LABEL_LEADING_DEFAULT,
  LABEL_LEADING_MAX,
  LABEL_LEADING_MIN,
  LABEL_LEADING_STEP,
  LABEL_TRACKING_DEFAULT,
  LABEL_TRACKING_MAX,
  LABEL_TRACKING_MIN,
  LABEL_TRACKING_STEP,
  effectiveStationStyleProps,
  resolveAutoAlign,
  resolveOffsetPerp,
} from '../../model/transforms';

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
  const setLabelAutoHAlign = useDoc((s) => s.setLabelAutoHAlign);
  const setLabelAutoVAlign = useDoc((s) => s.setLabelAutoVAlign);
  const rotateLabel = useDoc((s) => s.rotateLabel);
  const setStationWaypoint = useDoc((s) => s.setStationWaypoint);
  const setStationEditorHeight = useDoc((s) => s.setStationEditorHeight);
  const updateStationLabelStyle = useDoc((s) => s.updateStationLabelStyle);
  const selection = useSelection();
  const nameField = useFieldHistory();
  // Remember the manually stretched height of the Name box, per station, so it
  // reopens at the size the user left it (see usePersistedTextareaHeight).
  const { attach: attachNameBox, onPointerUp: onNameBoxPointerUp } = usePersistedTextareaHeight(
    station?.editorHeight,
    (h) => setStationEditorHeight(id, h),
  );
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
  // (0–3): the source→candidate rotation callers apply to (dRow, dCol)
  // edits (rotateGridDelta) when broadcasting them to that match.
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
  const mirrorAvailable = matches.length > 0;
  const inLayoutEdit =
    selection.uiMode.kind === 'editing-station-layout' && selection.uiMode.stationId === station.id;
  // The station's OWN effective typography (stored ?? LABEL_* default) — the
  // style section's controls read/write these. Typography edits stay LOCAL to
  // this station (not dispatched through mirror), matching the pinned
  // "typography never mirrors" decision; the style picker is how you share it.
  const labelStyle = effectiveStationStyleProps(station);
  const locked = !!station.locked;

  return (
    <section className="inspector">
      {/* One native disable for the whole panel: a locked station greys and
          freezes every editing control, like the other item popovers. The
          footer's lock toggle lives OUTSIDE this fieldset (in StationPopover),
          so unlocking stays reachable. Radix-rendered controls (sliders,
          selects) also get an explicit disabled prop — their thumbs are
          spans, which a fieldset can't reach. */}
      <fieldset className="inspector-fields" disabled={locked}>
        <div className="field">
          <div className="field-header">
            <label>Name</label>
            {/* Mirror-matching toggle. While on, layout edits (stops, label,
              rotation — not name/position, and not the per-station styling
              flags WP/lock/bold/italic) broadcast to every station on a
              shared line that renders identically (model/matching.ts).
              Stays clickable while on even at zero matches so the mode can
              always be exited. */}
            <button
              type="button"
              className={`ghost-btn${mirrorOn ? ' active' : ''}`}
              aria-pressed={mirrorOn}
              disabled={!mirrorAvailable && !mirrorOn}
              title={
                mirrorOn
                  ? 'Similar stations selected — edits here apply to all of them; click to edit only this station'
                  : mirrorAvailable
                    ? `Select the ${matches.length} station${matches.length === 1 ? '' : 's'} on this line with this exact layout — edits here will apply to all of them`
                    : 'No other station on this line has an identical layout'
              }
              onClick={() => selection.setMirrorMatching(!mirrorOn)}
            >
              Select Similar
            </button>
            {/* The same lozenge the canvas draws for a waypoint (gray pill,
              white WP): outline while off, filled while on. */}
            <button
              type="button"
              className={`wp-pill-btn${station.isWaypoint ? ' active' : ''}`}
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
          <textarea
            ref={attachNameBox}
            value={station.name}
            onChange={(e) => renameStation(station.id, e.target.value)}
            onPointerUp={onNameBoxPointerUp}
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
            {/* One icon, mirrored, so the ± pair is visually identical.
              Rotation broadcasts under mirror matching (a relative step is
              frame-invariant, so matches stay in sync); position does not. */}
            <button
              className="chip-btn"
              onClick={() => dispatchAll((sid) => rotateStation(sid, -1))}
              title="Rotate −45°"
              aria-label="Rotate −45°"
            >
              <RotateCounterClockwiseIcon />
            </button>
            <button
              className="chip-btn"
              onClick={() => dispatchAll((sid) => rotateStation(sid))}
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
              className={`ghost-btn${inLayoutEdit ? ' active' : ''}`}
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
            {/* Multi-line tuning for Auto placement: within-block alignment
              and which line anchors. Only meaningful while the wand is on;
              inverse-disabled from the legacy align/valign cycles. */}
            <AutoHAlignCycleButton
              value={station.label.autoHAlign ?? null}
              disabled={!resolveAutoAlign(station.label)}
              onSet={(v) => dispatchAll((sid) => setLabelAutoHAlign(sid, v))}
            />
            <AutoVAlignCycleButton
              value={station.label.autoVAlign ?? null}
              disabled={!resolveAutoAlign(station.label)}
              onSet={(v) => dispatchAll((sid) => setLabelAutoVAlign(sid, v))}
            />
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
            {/* Rotate the label's reading direction one 45° step (clockwise,
              like the ⟳ station button and the R shortcut). Rotation is
              orthogonal to Auto placement — it sets the reading axis, which
              autoAlign still honors — so this stays enabled while the
              align/valign cycles disable. A relative step is frame-invariant,
              so the mirror broadcast keeps matches in sync. */}
            <button
              type="button"
              className="chip-btn"
              aria-label="Rotate label"
              title="Rotate the label 45°"
              onClick={() => dispatchAll((sid) => rotateLabel(sid))}
            >
              <RotateCounterClockwiseIcon style={{ transform: 'scaleX(-1)' }} />
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

        {/* Name typography — the standard "style picker on top, style options
          below" section (like the other item popovers). Edits are LOCAL to this
          station (never dispatchAll), preserving the pinned "typography never
          mirrors" decision. */}
        <div className="field">
          <StyleRow
            key={station.id}
            kind="station"
            itemId={station.id}
            styleId={station.styleId}
            disabled={locked}
          />
          <hr className="popover-divider" aria-hidden="true" />
          <NumericFieldRow
            id={`station-size-${station.id}`}
            label="Size"
            min={LABEL_FONT_SIZE_MIN}
            max={LABEL_FONT_SIZE_MAX}
            step={FONT_SIZE_STEP}
            value={labelStyle.fontSize}
            onChange={(n) => updateStationLabelStyle(station.id, { fontSize: n })}
            getCurrent={() =>
              effectiveStationStyleProps(useDoc.getState().stations[station.id] ?? station).fontSize
            }
            textboxAllowAboveMax
            disabled={locked}
          />
          <div className="field-row">
            <label htmlFor={`station-weight-${station.id}`}>Weight</label>
            <WeightSelect
              id={`station-weight-${station.id}`}
              value={labelStyle.weight}
              italic={labelStyle.italic}
              disabled={locked}
              onChange={(weight) => updateStationLabelStyle(station.id, { weight })}
            />
            <ItalicButton
              active={labelStyle.italic}
              disabled={locked}
              onToggle={() => updateStationLabelStyle(station.id, { italic: !labelStyle.italic })}
            />
          </div>
          {/* Line-spacing multiplier (1 = normal); the tick marks the neutral 1. */}
          <NumericFieldRow
            id={`station-leading-${station.id}`}
            label="Leading"
            min={LABEL_LEADING_MIN}
            max={LABEL_LEADING_MAX}
            step={LABEL_LEADING_STEP}
            value={labelStyle.leading}
            onChange={(n) => updateStationLabelStyle(station.id, { leading: n })}
            getCurrent={() =>
              effectiveStationStyleProps(useDoc.getState().stations[station.id] ?? station).leading
            }
            detent={LABEL_LEADING_DEFAULT}
            textboxAllowAboveMax
            disabled={locked}
          />
          {/* Letter-spacing in em (0 = normal); the tick marks the neutral 0. */}
          <NumericFieldRow
            id={`station-tracking-${station.id}`}
            label="Tracking"
            min={LABEL_TRACKING_MIN}
            max={LABEL_TRACKING_MAX}
            step={LABEL_TRACKING_STEP}
            value={labelStyle.tracking}
            onChange={(n) => updateStationLabelStyle(station.id, { tracking: n })}
            getCurrent={() =>
              effectiveStationStyleProps(useDoc.getState().stations[station.id] ?? station).tracking
            }
            detent={LABEL_TRACKING_DEFAULT}
            textboxAllowAboveMax
            disabled={locked}
          />
        </div>
      </fieldset>
    </section>
  );
}
