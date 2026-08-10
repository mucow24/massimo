import { useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon } from '@radix-ui/react-icons';
import { useDoc } from '../../state/store';
import { useRenderDoc } from '../../state/renderDoc';
import { useLineEditorPrefs } from '../../state/lineEditorPrefs';
import type { LineId, LineStrokeColor } from '../../model/types';
import { DEFAULT_DOT_STYLE } from '../../model/dotStyle';
import { ColorPalette } from './ColorPalette';
import { DayNightColorRow } from '../DayNightColorRow';
import { useFieldHistory } from '../useFieldHistory';
import { StationShapePicker } from '../StationShapePicker';
import { NumericFieldRow } from '../NumericFieldRow';
import { StyleRow } from '../StyleRow';
import { LineEndSegmented } from '../LineEndPicker';
import { lineEndStyleOf } from '../../model/lineEnd';
import { SERVICE_CODE_MAX, serviceCodeDraft } from '../../model/lineNaming';
import { GLYPH_TAG_MAX_LEN } from '../../geometry/labelTokens';
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
  LINE_OWN_COLOR,
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
// context-dependent rows (dash dims, and the stroke color below its width)
// rendered only while relevant. (Which casing shows inside a branch mouth is
// no longer a line setting at all: self-overlaps are region faces, painted
// per junction in Layering mode.)
export function LineInspector({ id }: { id: LineId }) {
  const line = useDoc((s) => s.lines[id]);
  // Render source: the stop band below is a readout of painted stations, so it
  // must agree with the frozen canvas mid-drag, not run a frame ahead of it —
  // and a live subscription would re-render this panel per pointermove.
  const stations = useRenderDoc((s) => s.stations);
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
  const setLineDashLength = useDoc((s) => s.setLineDashLength);
  const setLineDashWidth = useDoc((s) => s.setLineDashWidth);
  const styleExpanded = useLineEditorPrefs((s) => s.styleExpanded);
  const setStyleExpanded = useLineEditorPrefs((s) => s.setStyleExpanded);
  const nameField = useFieldHistory();
  const serviceField = useFieldHistory();
  // Mid-edit mirror for the Service code, held for the WHOLE edit (null = not
  // mid-edit, show the store value — so no resync effect is needed). The code
  // is the search key for updateLine's inline-bullet migration, which rewrites
  // `|code|` tokens across every station name and text label, so each value the
  // field writes is a document-wide rewrite. Committing per keystroke walked the
  // doc through every INTERMEDIATE spelling: retyping "A1" as "A2" passed
  // through "A", folding this line's bullets onto a line actually CALLED A and
  // then dragging that line's bullets along to "A2". So the field commits once,
  // on blur or Enter, and the intermediates never reach the doc.
  const [serviceDraft, setServiceDraft] = useState<string | null>(null);

  if (!line) return null;

  /**
   * The pair one casing swatch writes. Normally each swatch moves its own half
   * and leaves the other stored value alone — but while the casing is the
   * `'line'` SENTINEL there is no other half to leave: it paints one hue on
   * both canvases, and reaching for either swatch means "stop following the
   * line, use this instead". So leaving the sentinel takes the picked color
   * into BOTH halves. Writing the line's CURRENT body color into the untouched
   * half instead would freeze a hue the user never chose — and it would stop
   * tracking the line the moment they recolored it, invisibly, on the one
   * canvas they weren't looking at.
   */
  const followsLine = lineStrokeColorStored(line) === LINE_OWN_COLOR;
  const nextCasing = (half: 'day' | 'night', c: string): LineStrokeColor =>
    followsLine
      ? { day: c, night: c }
      : half === 'day'
        ? { day: c, night: lineCasingColor(line, line.color, true) }
        : { day: lineCasingColor(line, line.color, false), night: c };

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
          // The bound on RAW text, not on the code: a shortcut being spelled out
          // (`<a_ne`) is briefly longer than the one character it becomes, so the
          // cap itself is enforced by serviceCodeDraft on the expanded value.
          maxLength={SERVICE_CODE_MAX + GLYPH_TAG_MAX_LEN}
          value={serviceDraft ?? line.service}
          onChange={(e) => {
            // null = over the cap; refuse the keystroke and let React restore
            // the controlled value, exactly as maxLength used to.
            const next = serviceCodeDraft(e.target.value);
            if (next !== null) setServiceDraft(next);
          }}
          onFocus={() => {
            setServiceDraft(line.service);
            serviceField.onFocus();
          }}
          // Enter commits without needing somewhere else to click, the same way
          // it does for every other useFieldHistory field: it blurs, and blur is
          // the one write.
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          onBlur={() => {
            // The single write, inside the history group serviceField opened on
            // focus. A value-identical patch is a no-op in updateLine, so simply
            // tabbing through the field costs nothing.
            if (serviceDraft !== null) updateLine(line.id, { service: serviceDraft });
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
            <label title="Stations with only one non-empty line stop (by default)">
              Singleton (One line stops)
            </label>
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
            <label title="Stations with more than one non-empty line stop (by default)">
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
            onChange={(n) => setLineStrokeWidth(line.id, n)}
            getCurrent={() => lineStrokeWidthOf(useDoc.getState().lines[id])}
            textboxAllowAboveMax
          />
          {/* Only while the casing is on — a 0-width stroke has no color to
              pick. RESOLVED, not stored: a line style can set the casing to the
              line's own color, and that sentinel is not a paintable pair — the
              swatches show what's actually on each canvas (the same hue twice,
              a line's body color being theme-blind). Picking a color here
              writes a fixed pair (and detaches from the style), which is
              exactly what reaching for a swatch means; the "follow the line"
              mode itself is chosen in the style editor. */}
          {lineStrokeWidthOf(line) > 0 && (
            <DayNightColorRow
              label="Stroke color"
              id={`line-stroke-color-${line.id}`}
              darkId={`line-dark-stroke-color-${line.id}`}
              lightAriaLabel="Stroke color"
              darkAriaLabel="Dark mode stroke color"
              titleNoun="stroke color"
              value={lineCasingColor(line, line.color, false)}
              darkValue={lineCasingColor(line, line.color, true)}
              onChange={(day) => setLineStrokeColor(line.id, nextCasing('day', day))}
              onDarkChange={(night) => setLineStrokeColor(line.id, nextCasing('night', night))}
            />
          )}
        </>
      )}
    </section>
  );
}
