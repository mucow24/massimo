import { useCallback, useMemo, useRef } from 'react';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  MagicWandIcon,
  RotateCounterClockwiseIcon,
} from '@radix-ui/react-icons';
import * as Select from '@radix-ui/react-select';
import { useDoc, useSelection } from '../../state/store';
import { useRenderDoc } from '../../state/renderDoc';
import { useStationEditorPrefs } from '../../state/stationEditorPrefs';
import { dispatchMirrored } from '../../state/mirrorDispatch';
import type { Station, StationId, StationStopType } from '../../model/types';
import { findMatchingStations, type LayoutOffset } from '../../model/matching';
import { FieldSelectContent } from '../FieldSelectContent';
import { LabelOffsetControl } from './LabelOffsetControl';
import {
  AutoHAlignButtons,
  AutoVAlignButtons,
  LabelAlignButtons,
  LabelValignButtons,
} from './LabelAlignButtons';
import { StopRows } from './StopRows';
import { spawnAnchorCell } from './stopGridDrag';
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
  stationIsSingleton,
} from '../../model/transforms';

// The Stop type dropdown's options, in escalating specificity. The two explicit
// names are the ones the line inspector's own split rows already use, so the
// surfaces read as one idea.
//
// Auto carries the answer it currently gives — the count is the one thing this
// control can't show you by looking, and it is exactly what a declaration is
// being weighed against. Read with any declaration stripped off, so an override
// still reports what reverting would buy. A station with no stops has no answer
// to report and just says "Auto".
function stopTypeOptions(station: Station): { value: StationStopType; name: string }[] {
  const auto =
    station.stops.length === 0
      ? 'Auto'
      : stationIsSingleton({ stops: station.stops })
        ? 'Auto (Singleton)'
        : 'Auto (Interchange)';
  return [
    { value: 'auto', name: auto },
    { value: 'singleton', name: 'Singleton' },
    { value: 'interchange', name: 'Interchange' },
  ];
}

export function StationInspector({ id }: { id: StationId }) {
  // Render source, not live doc: the x/y fields display the coordinates the
  // canvas is painting, and during a pipelined drag the live doc runs a frame
  // ahead — the number must never lead the picture. Write callbacks still
  // compose against useDoc.getState(), the state the write applies to.
  const station = useRenderDoc((s) => s.stations[id]);
  const stationsAll = useRenderDoc((s) => s.stations);
  const linesAll = useDoc((s) => s.lines);
  const renameStation = useDoc((s) => s.renameStation);
  const addStationAnchor = useDoc((s) => s.addStationAnchor);
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
  const setStationStopType = useDoc((s) => s.setStationStopType);
  const setStationEditorHeight = useDoc((s) => s.setStationEditorHeight);
  const updateStationLabelStyle = useDoc((s) => s.updateStationLabelStyle);
  const selection = useSelection();
  // Persisted "is the Style detail block open" pref (collapsed by default); the
  // style picker always shows, only the manual typography rows collapse.
  const styleExpanded = useStationEditorPrefs((s) => s.styleExpanded);
  const setStyleExpanded = useStationEditorPrefs((s) => s.setStyleExpanded);
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
  const autoAlignOn = resolveAutoAlign(station.label);
  // The station's OWN effective typography (stored ?? LABEL_* default) — the
  // style section's controls read/write these. Typography edits stay LOCAL to
  // this station (not dispatched through mirror), matching the pinned
  // "typography never mirrors" decision; the style picker is how you share it.
  const labelStyle = effectiveStationStyleProps(station);
  const locked = !!station.locked;
  // The Style detail collapses by preference, but a locked station always shows
  // it (read-only): the disclosure toggle lives inside the disabled fieldset, so
  // lock would otherwise both hide the typography AND disable the only control
  // that could reveal it. Lock freezes editing, not viewing.
  const styleDetailOpen = styleExpanded || locked;

  return (
    <section className="inspector">
      {/* One native disable for the whole panel: a locked station greys and
          freezes every editing control, like the other item popovers. The
          footer's lock toggle lives OUTSIDE this fieldset (in StationPopover),
          so unlocking stays reachable. Radix-rendered controls (sliders,
          selects) also get an explicit disabled prop — their thumbs are
          spans, which a fieldset can't reach. */}
      <fieldset className="inspector-fields" disabled={locked}>
        {/* Button bar: the panel's row of actions — enter the on-canvas layout
            editor, select similar stations, mark a waypoint (right-justified).
            Sits ABOVE the Name field so the name no longer shares a line with
            these buttons. */}
        <div className="field-row button-bar">
          {/* Enter/exit editing-station-layout: the full stop/label editor on
              the real station, on the main canvas. */}
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
          {/* Mirror-matching toggle. While on, layout edits (stops, label,
              rotation) and the Stop type declaration — but not name/position,
              and not the per-station styling flags WP/lock/bold/italic —
              broadcast to every station on a
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
              white WP): outline while off, filled while on. Right-justified. */}
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
        <div className="field">
          <label>Name</label>
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
          <label>Stop dots</label>
          {/* Column captions for the stop rows below. Purely explanatory — the
              actual editing happens in each row's controls; positions are set on
              the map via Edit layout. */}
          {station.stops.length > 0 && (
            <div className="stop-rows-header" aria-hidden="true">
              <span className="col-line">Line</span>
              <span className="col-type">Type</span>
              <span className="col-xfer">Xfer</span>
              <span className="col-end">End</span>
              <span className="col-size">Size</span>
              <span className="col-dir">Direction</span>
            </div>
          )}
          <div ref={stopRowsRef}>
            <StopRows station={station} lines={linesAll} />
          </div>
          <button
            type="button"
            className="ghost-btn add-anchor-btn"
            title="Park a transfer anchor in this station's grid — a corner a transfer can turn"
            onClick={() => {
              const [row, col] = spawnAnchorCell(station, linesAll);
              // Arm it immediately so the arrow keys can walk it into place
              // without a second click on the canvas handle.
              selection.setSelectedAnchorCellId(addStationAnchor(station.id, row, col));
            }}
          >
            Add transfer anchor
          </button>
          {/* Which of each line's two split dot defaults this station's stops
              take. Auto counts the visibly-occupied stops (the historical
              rule); the other two are the map's own reading and settle it
              outright — on a dense network almost every station is shared, so
              the count alone stops meaning anything. Mirror-dispatched, like
              dot type and size: Select Similar stands in for "stations of the
              same general purpose", which is precisely what a stop type is.
              Rotation-invariant, so the layoutOffset is nothing to apply. */}
          <div className="field-row stop-type-row">
            <label htmlFor={`station-stop-type-${station.id}`}>Stop type</label>
            <Select.Root
              value={station.stopType ?? 'auto'}
              disabled={locked}
              onValueChange={(v) =>
                dispatchAll((sid) => setStationStopType(sid, v as StationStopType))
              }
            >
              <Select.Trigger
                id={`station-stop-type-${station.id}`}
                className="field-select"
                aria-label="Stop type"
                title="Which dot default this station's stops take: Auto counts the stops that paint here, or declare it outright"
              >
                <Select.Value />
                <Select.Icon className="field-select-caret" aria-hidden="true">
                  <ChevronDownIcon />
                </Select.Icon>
              </Select.Trigger>
              <FieldSelectContent>
                {stopTypeOptions(station).map((o) => (
                  <Select.Item key={o.value} value={o.value} className="field-select-item">
                    <Select.ItemText>{o.name}</Select.ItemText>
                  </Select.Item>
                ))}
              </FieldSelectContent>
            </Select.Root>
          </div>
          {(station.stops.length === 0 || inLayoutEdit) && (
            <div className="field-hint">
              {station.stops.length === 0
                ? 'No stops yet — add this station to a line.'
                : 'Drag dots/label on the map; right-click or R rotates, arrows nudge.'}
            </div>
          )}
        </div>
        <div className="field">
          <label>Label</label>
          <div className="field-row">
            {/* Auto-placement toggle (the magic wand). While on, align/valign
              are overridden by transit-map typography (autoAlign) and this row
              swaps the manual align/valign controls for the auto H/V tuning
              controls. The wand stays put; clicking it toggles between the two
              setups. */}
            <button
              type="button"
              className={`chip-btn${autoAlignOn ? ' active' : ''}`}
              aria-pressed={autoAlignOn}
              aria-label="Auto placement"
              title={
                autoAlignOn
                  ? 'Auto placement on — alignment follows the nearest stop (transit-map typography); click for manual alignment'
                  : 'Auto placement: align to the nearest stop with transit-map typography (overrides align/v-align)'
              }
              onClick={() => {
                const next = !autoAlignOn;
                dispatchAll((sid) => setLabelAutoAlign(sid, next));
              }}
            >
              <MagicWandIcon />
            </button>
            {autoAlignOn ? (
              <>
                <AutoHAlignButtons
                  value={station.label.autoHAlign ?? null}
                  onSet={(v) => dispatchAll((sid) => setLabelAutoHAlign(sid, v))}
                />
                <AutoVAlignButtons
                  value={station.label.autoVAlign ?? null}
                  onSet={(v) => dispatchAll((sid) => setLabelAutoVAlign(sid, v))}
                />
              </>
            ) : (
              <>
                <LabelAlignButtons
                  align={station.label.align}
                  onSet={(v) => dispatchAll((sid) => setLabelAlign(sid, v))}
                />
                <LabelValignButtons
                  valign={station.label.valign}
                  onSet={(v) => dispatchAll((sid) => setLabelValign(sid, v))}
                />
              </>
            )}
            {/* Rotate the label's reading direction one 45° step (clockwise,
              like the ⟳ station button and the R shortcut). Rotation is
              orthogonal to Auto placement — it sets the reading axis, which
              autoAlign still honors — so this stays on the row in both setups.
              A relative step is frame-invariant, so the mirror broadcast keeps
              matches in sync. */}
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
          below" section (like the other item popovers). The picker always
          shows; the manual overrides (Size → Tracking) collapse under a
          disclosure (collapsed by default, remembered). Edits are LOCAL to this
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
          <button
            type="button"
            className="style-collapse-toggle"
            aria-expanded={styleDetailOpen}
            onClick={() => setStyleExpanded(!styleExpanded)}
          >
            {styleDetailOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}
            <span>Size &amp; spacing</span>
          </button>
          {styleDetailOpen && (
            <>
              <NumericFieldRow
                id={`station-size-${station.id}`}
                label="Size"
                min={LABEL_FONT_SIZE_MIN}
                max={LABEL_FONT_SIZE_MAX}
                step={FONT_SIZE_STEP}
                value={labelStyle.fontSize}
                onChange={(n) => updateStationLabelStyle(station.id, { fontSize: n })}
                getCurrent={() =>
                  effectiveStationStyleProps(useDoc.getState().stations[station.id] ?? station)
                    .fontSize
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
                  onToggle={() =>
                    updateStationLabelStyle(station.id, { italic: !labelStyle.italic })
                  }
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
                  effectiveStationStyleProps(useDoc.getState().stations[station.id] ?? station)
                    .leading
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
                  effectiveStationStyleProps(useDoc.getState().stations[station.id] ?? station)
                    .tracking
                }
                detent={LABEL_TRACKING_DEFAULT}
                textboxAllowAboveMax
                disabled={locked}
              />
            </>
          )}
        </div>
      </fieldset>
    </section>
  );
}
