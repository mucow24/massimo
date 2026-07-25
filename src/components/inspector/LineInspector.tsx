import { useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon } from '@radix-ui/react-icons';
import { useDoc } from '../../state/store';
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
import {
  LINE_INTERLINE_GAP_MAX,
  LINE_WIDTH_MAX,
  LINE_WIDTH_MIN,
  LINE_WIDTH_SLIDER_MIN,
  LINE_WIDTH_STEP,
  lineInterlineGapOf,
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
  lineSeamColor,
  lineSeamWidthOf,
  lineStrokeRailWidth,
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
// (useLineEditorPrefs), grouped geometry → stop dots → stroke → seam, with
// context-dependent rows (dash dims, stroke color) rendered only while
// relevant.
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
  const setLineCurveRadius = useDoc((s) => s.setLineCurveRadius);
  const setLineStrokeWidth = useDoc((s) => s.setLineStrokeWidth);
  const setLineStrokeColor = useDoc((s) => s.setLineStrokeColor);
  const setLineSeamColor = useDoc((s) => s.setLineSeamColor);
  const setLineSeamWidth = useDoc((s) => s.setLineSeamWidth);
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
            onChange={(n) => setLineStrokeWidth(line.id, n)}
            getCurrent={() => lineStrokeWidthOf(useDoc.getState().lines[id])}
            textboxAllowAboveMax
          />
          {/* Only while the casing is on — a color for a 0-width stroke would
              be a dead control. */}
          {lineStrokeWidthOf(line) > 0 && (
            <div className="options-popover-row">
              <label htmlFor={`line-stroke-color-${line.id}`} className="options-popover-label">
                Stroke color
              </label>
              {/* RESOLVED, not stored: a line style can set the casing to the
                  line's own color, and that sentinel is not a paintable hex —
                  the swatch shows what's actually on the canvas. Picking a
                  color here writes a fixed one (and detaches from the style),
                  which is exactly what reaching for the swatch means; the
                  "follow the line" mode itself is chosen in the style editor. */}
              <ColorField
                id={`line-stroke-color-${line.id}`}
                ariaLabel="Stroke color"
                value={lineCasingColor(line, line.color)}
                onChange={(c) => setLineStrokeColor(line.id, c)}
              />
            </div>
          )}
          <hr className="popover-divider" aria-hidden="true" />
          <NumericFieldRow
            id={`line-seam-${line.id}`}
            label="Seam width"
            min={LINE_STROKE_WIDTH_MIN}
            max={LINE_STROKE_WIDTH_MAX}
            step={LINE_STROKE_STEP}
            // Unset inherits the casing width (so a seam-color-only line shows a
            // seam matched to its casing); the slider overrides.
            value={
              lineSeamWidthOf(line) ??
              lineStrokeRailWidth(lineStrokeWidthOf(line), lineWidthOf(line))
            }
            onChange={(n) => setLineSeamWidth(line.id, n)}
            getCurrent={() => {
              const l = useDoc.getState().lines[id];
              return (
                lineSeamWidthOf(l) ?? lineStrokeRailWidth(lineStrokeWidthOf(l), lineWidthOf(l))
              );
            }}
            textboxAllowAboveMax
          />
          <div className="options-popover-row">
            <label htmlFor={`line-seam-color-${line.id}`} className="options-popover-label">
              Seam color
            </label>
            {/* Interior branch/loop overlap indicator, shown where a line overlaps
                itself. Off by default: seeded at the casing hue with zero alpha, so
                the swatch reads transparent ("off") and dragging the picker's alpha
                up enables a translucent seam. Needs a seam width (inherits the
                casing width when unset). */}
            <ColorField
              id={`line-seam-color-${line.id}`}
              ariaLabel="Seam color"
              value={
                lineSeamColor(line, line.color) ??
                withHexAlpha(lineCasingColor(line, line.color), 0)
              }
              onChange={(c) => setLineSeamColor(line.id, c)}
            />
          </div>
        </>
      )}
    </section>
  );
}
