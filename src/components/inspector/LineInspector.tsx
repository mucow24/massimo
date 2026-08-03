import { useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon } from '@radix-ui/react-icons';
import { beginHistoryGroup, useDoc } from '../../state/store';
import { isHistoryGrouping } from '../../state/history';
import { useLineEditorPrefs } from '../../state/lineEditorPrefs';
import type { LineId } from '../../model/types';
import { DEFAULT_DOT_STYLE } from '../../model/dotStyle';
import { ColorPalette } from './ColorPalette';
import { ColorField } from '../ColorField';
import { useFieldHistory } from '../useFieldHistory';
import { StationShapePicker } from '../StationShapePicker';
import { withHexAlpha } from '../../util/color';
import { NumericFieldRow } from '../NumericFieldRow';
import { StyleRow } from '../StyleRow';
import { LineEndSegmented } from '../LineEndPicker';
import { InnerStrokesSegmented, innerStrokesOf } from '../InnerStrokesPicker';
import { lineEndStyleOf } from '../../model/lineEnd';
import {
  LINE_INTERLINE_GAP_MAX,
  LINE_LABEL_GAP_MAX,
  LINE_LABEL_GAP_MIN,
  LINE_WIDTH_MAX,
  LINE_WIDTH_MIN,
  LINE_WIDTH_SLIDER_MIN,
  LINE_WIDTH_STEP,
  lineInterlineGapOf,
  lineLabelGapOf,
  lineWidthOf,
} from '../../model/lineWidth';
import {
  LINE_CURVE_RADIUS_MAX,
  LINE_CURVE_RADIUS_MIN,
  LINE_CURVE_RADIUS_STEP,
  lineCurveRadiusOf,
} from '../../model/lineCurve';
import {
  DOT_SIZE_MAX,
  DOT_SIZE_MIN,
  DOT_SIZE_STEP,
  lineSingletonDotSizeOf,
  lineMultiDotSizeOf,
} from '../../model/dotSize';
import {
  DASH_LENGTH_MAX,
  DASH_WIDTH_MAX,
  dashRenderLength,
  dashRenderWidth,
  lineUsesDashTicks,
} from '../../model/dashSize';
import {
  LINE_STROKE_STEP,
  LINE_STROKE_WIDTH_MAX,
  LINE_STROKE_WIDTH_MIN,
  lineCasingColor,
  lineStrokeColorStored,
  lineStrokeWidthOf,
} from '../../model/lineStroke';

// The line's identity + style fields, hosted by the pinned LinePopover while
// the line is being edited (picking a line goes straight into Edit Stops —
// there is no selected-but-not-editing state). Stop/topology editing happens
// ON THE CANVAS (see appendGestures.ts): click stations to connect, click a
// segment to insert into it, Delete/× removes, shift-click a segment cycles
// its style.
//
// Identity (name/service/color) and the Style preset row always show; the
// full parameter stack below them collapses behind a remembered disclosure
// (useLineEditorPrefs), grouped geometry → stop dots → stroke, with
// context-dependent rows (dash dims, and the whole stroke tail below its width)
// rendered only while relevant.
//
// The stroke is presented as ONE thing here — a width and a color that the
// outer casing and the inner strokes at a junction share — even though the doc
// keeps the seam's width and color as their own fields. Every write below that
// crosses that line is marked. The line STYLE editor presents the same three
// rows over the same five props (see LineStyleEditor); what differs is only the
// write path, separate setters here against one patch there.
export function LineInspector({ id }: { id: LineId }) {
  const line = useDoc((s) => s.lines[id]);
  const stations = useDoc((s) => s.stations);
  const updateLine = useDoc((s) => s.updateLine);
  const setLineSingletonDotStyle = useDoc((s) => s.setLineSingletonDotStyle);
  const setLineMultiDotStyle = useDoc((s) => s.setLineMultiDotStyle);
  const setLineSingletonDotSize = useDoc((s) => s.setLineSingletonDotSize);
  const setLineMultiDotSize = useDoc((s) => s.setLineMultiDotSize);
  const setLineWidth = useDoc((s) => s.setLineWidth);
  const setLineInterlineGap = useDoc((s) => s.setLineInterlineGap);
  const setLineLabelGap = useDoc((s) => s.setLineLabelGap);
  const setLineCurveRadius = useDoc((s) => s.setLineCurveRadius);
  const setLineEndStyle = useDoc((s) => s.setLineEndStyle);
  const setLineStrokeWidth = useDoc((s) => s.setLineStrokeWidth);
  const setLineStrokeColor = useDoc((s) => s.setLineStrokeColor);
  const setLineSeamColor = useDoc((s) => s.setLineSeamColor);
  const setLineSeamWidth = useDoc((s) => s.setLineSeamWidth);
  const setLineSeamEdges = useDoc((s) => s.setLineSeamEdges);
  const setLineDashLength = useDoc((s) => s.setLineDashLength);
  const setLineDashWidth = useDoc((s) => s.setLineDashWidth);
  const styleExpanded = useLineEditorPrefs((s) => s.styleExpanded);
  const setStyleExpanded = useLineEditorPrefs((s) => s.setStyleExpanded);
  const nameField = useFieldHistory();
  const serviceField = useFieldHistory();
  // Mid-edit mirror for the Service code ONLY while it is empty (null = not
  // mid-edit, show the store value — so no resync effect is needed). The
  // service code is the search key for updateLine's inline-bullet migration,
  // and an empty code can neither be searched for nor written, so letting the
  // empty intermediate of a backspace-then-retype write through would strand
  // every bullet wearing the old code. Non-empty keystrokes still commit live.
  const [serviceDraft, setServiceDraft] = useState<string | null>(null);

  if (!line) return null;

  // The four-way this editor shows for the line's inner strokes — the same
  // derivation the style editor reads off a def's props (see innerStrokesOf).
  const innerStrokes = innerStrokesOf(line);

  return (
    <section className="inspector">
      <div className="field">
        <label htmlFor={`line-name-${line.id}`}>Line name</label>
        <input
          id={`line-name-${line.id}`}
          type="text"
          value={line.name}
          onChange={(e) => updateLine(line.id, { name: e.target.value })}
          {...nameField}
        />
      </div>
      <div className="field">
        <label htmlFor={`line-service-${line.id}`}>Service code</label>
        <input
          id={`line-service-${line.id}`}
          type="text"
          maxLength={3}
          value={serviceDraft ?? line.service}
          onChange={(e) => {
            const v = e.target.value.toUpperCase();
            setServiceDraft(v === '' ? '' : null);
            if (v !== '') updateLine(line.id, { service: v });
          }}
          onFocus={serviceField.onFocus}
          onBlur={() => {
            // A deliberate clear still reaches the doc — just once, on blur,
            // inside the same history group.
            if (serviceDraft === '') updateLine(line.id, { service: '' });
            setServiceDraft(null);
            serviceField.onBlur();
          }}
        />
      </div>
      <div className="field">
        <label>Color</label>
        <ColorPalette value={line.color} onChange={(c) => updateLine(line.id, { color: c })} />
      </div>
      {/* Name/service/color above are identity, not style — the style row
          heads the covered formatting controls (dot, width, stroke). */}
      <StyleRow key={line.id} kind="line" itemId={line.id} styleId={line.styleId} />
      <hr className="popover-divider" aria-hidden="true" />
      <button
        type="button"
        className="style-collapse-toggle"
        aria-expanded={styleExpanded}
        onClick={() => setStyleExpanded(!styleExpanded)}
      >
        {styleExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
        <span>Style detail</span>
      </button>
      {styleExpanded && (
        <>
          <NumericFieldRow
            id={`line-width-${line.id}`}
            label="Line width"
            min={LINE_WIDTH_SLIDER_MIN}
            max={LINE_WIDTH_MAX}
            step={LINE_WIDTH_STEP}
            value={lineWidthOf(line)}
            onChange={(n) => setLineWidth(line.id, n)}
            getCurrent={() => lineWidthOf(useDoc.getState().lines[id])}
            textboxAllowAboveMax
            textboxMin={LINE_WIDTH_MIN}
          />
          {/* Extra spacing against each interlined neighbor (the pair uses the
              larger of the two lines' gaps). 0 = classic edge-to-edge tangency.
              Editing re-packs the stops, so bands stay merged with dots centered. */}
          <NumericFieldRow
            id={`line-interline-gap-${line.id}`}
            label="Interline gap"
            min={0}
            max={LINE_INTERLINE_GAP_MAX}
            step={LINE_WIDTH_STEP}
            value={lineInterlineGapOf(line)}
            onChange={(n) => setLineInterlineGap(line.id, n)}
            getCurrent={() => lineInterlineGapOf(useDoc.getState().lines[id])}
            textboxAllowAboveMax
          />
          {/* Clearance station labels keep from this line's marker (stripe,
              dot, tick or transfer cap). 0 butts the text to the marker;
              negative pulls the ink into it. */}
          <NumericFieldRow
            id={`line-label-gap-${line.id}`}
            label="Label gap"
            min={LINE_LABEL_GAP_MIN}
            max={LINE_LABEL_GAP_MAX}
            step={LINE_WIDTH_STEP}
            value={lineLabelGapOf(line)}
            onChange={(n) => setLineLabelGap(line.id, n)}
            getCurrent={() => lineLabelGapOf(useDoc.getState().lines[id])}
            textboxAllowAboveMax
          />
          <NumericFieldRow
            id={`line-curve-${line.id}`}
            label="Curve radius"
            min={LINE_CURVE_RADIUS_MIN}
            max={LINE_CURVE_RADIUS_MAX}
            step={LINE_CURVE_RADIUS_STEP}
            value={lineCurveRadiusOf(line)}
            onChange={(n) => setLineCurveRadius(line.id, n)}
            getCurrent={() => lineCurveRadiusOf(useDoc.getState().lines[id])}
            textboxAllowAboveMax
          />
          {/* How the line's ends are painted at every terminus. Individual
              termini can override this in the station editor's stop row. */}
          <div className="options-popover-row">
            <label className="options-popover-label">Line ends</label>
            <LineEndSegmented
              value={lineEndStyleOf(line)}
              onSelect={(end) => setLineEndStyle(line.id, end)}
            />
          </div>
          <hr className="popover-divider" aria-hidden="true" />
          <div className="popover-section-header">Station stop dot types and sizes</div>
          {/* Default stop dot, split by how the stop's station is shared: a
              "singleton" stop is the only line stopping there; an interchange
              stop shares its station with other lines. The two are independent,
              resolved live per stop, and always overridable per-stop in the
              station editor; the label tooltips explain each case. */}
          <div className="field dot-field">
            <label title="Stations with only one line stop">Singleton (One line stops)</label>
            <NumericFieldRow
              id={`line-singleton-dot-size-${line.id}`}
              label="Singleton dot size"
              leading={
                <StationShapePicker
                  disabled={false}
                  ariaLabel="Singleton stop shape"
                  currentStyle={line.singletonDotStyle ?? DEFAULT_DOT_STYLE}
                  lineColor={line.color}
                  serviceCode={line.service}
                  onPick={(styleId) => setLineSingletonDotStyle(line.id, styleId)}
                />
              }
              min={DOT_SIZE_MIN}
              max={DOT_SIZE_MAX}
              step={DOT_SIZE_STEP}
              value={lineSingletonDotSizeOf(line)}
              onChange={(n) => setLineSingletonDotSize(line.id, n)}
              getCurrent={() => lineSingletonDotSizeOf(useDoc.getState().lines[id])}
              textboxAllowAboveMax
            />
          </div>
          <div className="field dot-field">
            <label title="Stations with more than one line stop">
              Interchange (Multiple lines stop)
            </label>
            <NumericFieldRow
              id={`line-multi-dot-size-${line.id}`}
              label="Interchange dot size"
              leading={
                <StationShapePicker
                  disabled={false}
                  ariaLabel="Interchange stop shape"
                  currentStyle={line.multiDotStyle ?? DEFAULT_DOT_STYLE}
                  lineColor={line.color}
                  serviceCode={line.service}
                  onPick={(styleId) => setLineMultiDotStyle(line.id, styleId)}
                />
              }
              min={DOT_SIZE_MIN}
              max={DOT_SIZE_MAX}
              step={DOT_SIZE_STEP}
              value={lineMultiDotSizeOf(line)}
              onChange={(n) => setLineMultiDotSize(line.id, n)}
              getCurrent={() => lineMultiDotSizeOf(useDoc.getState().lines[id])}
              textboxAllowAboveMax
            />
          </div>
          {/* TfL-tick dimensions for this line's 'dash' stops — rendered only
              while a dash dot is actually in use (either line default, or any
              member stop's override). Unset derives from the line width
              (length = width, thickness = width/2); the sliders show the
              resolved value and an explicit 0 returns to auto. */}
          {lineUsesDashTicks(line, stations) && (
            <>
              <NumericFieldRow
                id={`line-dash-length-${line.id}`}
                label="Dash length"
                min={0}
                max={DASH_LENGTH_MAX}
                step={LINE_STROKE_STEP}
                value={dashRenderLength(line)}
                onChange={(n) => setLineDashLength(line.id, n)}
                getCurrent={() => dashRenderLength(useDoc.getState().lines[id])}
                textboxAllowAboveMax
              />
              <NumericFieldRow
                id={`line-dash-width-${line.id}`}
                label="Dash width"
                min={0}
                max={DASH_WIDTH_MAX}
                step={LINE_STROKE_STEP}
                value={dashRenderWidth(line)}
                onChange={(n) => setLineDashWidth(line.id, n)}
                getCurrent={() => dashRenderWidth(useDoc.getState().lines[id])}
                textboxAllowAboveMax
              />
            </>
          )}
          <hr className="popover-divider" aria-hidden="true" />
          <NumericFieldRow
            id={`line-stroke-${line.id}`}
            label="Stroke width"
            min={LINE_STROKE_WIDTH_MIN}
            max={LINE_STROKE_WIDTH_MAX}
            step={LINE_STROKE_STEP}
            value={lineStrokeWidthOf(line)}
            // ONE width for the whole stroke. The outer casing and the inner
            // strokes at a junction stay separate DOC fields — a line style
            // carries both, and the style editor still dials them apart — but
            // this editor writes them together.
            //
            // NB a nudge that RETURNS to the starting width still detaches a
            // line whose stored seam width differed: strokeWidth no-ops, but
            // seamWidth really did move onto it. That is the unification being
            // honest — the width shown is now the seam's too.
            onChange={(n) => {
              // Two writes, one edit. Gated because the focused slider or
              // spinbutton already holds a group and groups don't nest; an
              // UNFOCUSED wheel tick holds none, and would otherwise undo in
              // two halves (withCoalescedHistory folds a burst, but only ever
              // one entry deep).
              const group = isHistoryGrouping() ? null : beginHistoryGroup();
              setLineStrokeWidth(line.id, n);
              setLineSeamWidth(line.id, n);
              group?.commit();
            }}
            getCurrent={() => lineStrokeWidthOf(useDoc.getState().lines[id])}
            textboxAllowAboveMax
          />
          {/* Only while the casing is on — a 0-width stroke has no color to pick
              and no ink to carry into a junction. */}
          {lineStrokeWidthOf(line) > 0 && (
            <>
              <div className="options-popover-row">
                <label htmlFor={`line-stroke-color-${line.id}`} className="options-popover-label">
                  Stroke color
                </label>
                {/* RESOLVED, not stored: a line style can set the casing to the
                    line's own color, and that sentinel is not a paintable hex —
                    the swatch shows what's actually on the canvas. Picking a
                    color here writes a fixed one (and detaches from the style),
                    which is exactly what reaching for the swatch means; the
                    "follow the line" mode itself is chosen in the style editor.
                    The inner strokes follow this color, but only while they are
                    ON: the seam color IS their on/off switch, so writing one to
                    a line set to None would switch them on behind the user. */}
                <ColorField
                  id={`line-stroke-color-${line.id}`}
                  ariaLabel="Stroke color"
                  value={lineCasingColor(line, line.color)}
                  onChange={(c) => {
                    setLineStrokeColor(line.id, c);
                    if (innerStrokes !== 'none') setLineSeamColor(line.id, c);
                  }}
                />
              </div>
              {/* Where the line meets ITSELF — a branch or a loop — the casing
                  merges away; this draws it back through the junction. The full
                  notch, or just the main line's arm / the branch's own. Picking
                  an arm hands the seam this stroke's color and width, which is
                  what makes the two rows above cover it. */}
              <div className="options-popover-row">
                <label className="options-popover-label">Inner strokes</label>
                <InnerStrokesSegmented
                  value={innerStrokes}
                  onSelect={(v) => {
                    // A segmented toggle carries no history group of its own, so
                    // this opens one: up to three writes, and an undo that
                    // stopped between them would land on inner strokes the user
                    // never picked. Gated like the width row above.
                    const group = isHistoryGrouping() ? null : beginHistoryGroup();
                    if (v === 'none') {
                      // A fully transparent seam color canonicalizes to "no
                      // seam": the field is dropped, not stored as clear.
                      setLineSeamColor(line.id, withHexAlpha(lineCasingColor(line, line.color), 0));
                    } else {
                      // STORED, not resolved: a casing that follows the line's
                      // own color hands the seam that same sentinel, so the two
                      // track the line together.
                      setLineSeamColor(line.id, lineStrokeColorStored(line));
                      setLineSeamWidth(line.id, lineStrokeWidthOf(line));
                      setLineSeamEdges(line.id, v);
                    }
                    group?.commit();
                  }}
                />
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
