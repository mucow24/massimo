import { useDoc } from '../../state/store';
import type { LineId } from '../../model/types';
import { DEFAULT_DOT_STYLE, DOT_SHAPE_PRESETS } from '../../model/dotStyle';
import { ColorPalette } from './ColorPalette';
import { ColorField } from '../ColorField';
import { useFieldHistory } from '../useFieldHistory';
import { StationShapePicker } from '../StationShapePicker';
import { withHexAlpha } from '../../util/color';
import { NumericFieldRow } from '../NumericFieldRow';
import { StyleRow } from '../StyleRow';
import {
  LINE_WIDTH_MAX,
  LINE_WIDTH_MIN,
  LINE_WIDTH_SLIDER_MIN,
  LINE_WIDTH_STEP,
  lineWidthOf,
} from '../../model/lineWidth';
import {
  LINE_CURVE_RADIUS_MAX,
  LINE_CURVE_RADIUS_MIN,
  LINE_CURVE_RADIUS_STEP,
  lineCurveRadiusOf,
} from '../../model/lineCurve';
import { DOT_SIZE_MAX, DOT_SIZE_MIN, lineDefaultDotSizeOf } from '../../model/dotSize';
import {
  LINE_STROKE_STEP,
  LINE_STROKE_WIDTH_MAX,
  LINE_STROKE_WIDTH_MIN,
  lineSeamColorOf,
  lineSeamWidthOf,
  lineStrokeColorOf,
  lineStrokeRailWidth,
  lineStrokeWidthOf,
} from '../../model/lineStroke';

// The line's identity + style fields, shown while the line is being edited
// (picking a line goes straight into Edit Stops — there is no selected-but-
// not-editing state). Stop/topology editing happens ON THE CANVAS (see
// appendGestures.ts): click stations to connect, click a segment to insert
// into it, Delete/× removes, shift-click a segment cycles its style.
export function LineInspector({ id }: { id: LineId }) {
  const line = useDoc((s) => s.lines[id]);
  const updateLine = useDoc((s) => s.updateLine);
  const setLineDefaultDotStyle = useDoc((s) => s.setLineDefaultDotStyle);
  const setLineDefaultDotSize = useDoc((s) => s.setLineDefaultDotSize);
  const setLineWidth = useDoc((s) => s.setLineWidth);
  const setLineCurveRadius = useDoc((s) => s.setLineCurveRadius);
  const setLineStrokeWidth = useDoc((s) => s.setLineStrokeWidth);
  const setLineStrokeColor = useDoc((s) => s.setLineStrokeColor);
  const setLineSeamColor = useDoc((s) => s.setLineSeamColor);
  const setLineSeamWidth = useDoc((s) => s.setLineSeamWidth);
  const nameField = useFieldHistory();
  const serviceField = useFieldHistory();

  if (!line) return null;

  return (
    <section className="inspector">
      <div className="field">
        <label>Line name</label>
        <input
          type="text"
          value={line.name}
          onChange={(e) => updateLine(line.id, { name: e.target.value })}
          {...nameField}
        />
      </div>
      <div className="field">
        <label>Service code</label>
        <input
          type="text"
          maxLength={3}
          value={line.service}
          onChange={(e) => updateLine(line.id, { service: e.target.value.toUpperCase() })}
          {...serviceField}
        />
      </div>
      <div className="field">
        <label>Color</label>
        <ColorPalette value={line.color} onChange={(c) => updateLine(line.id, { color: c })} />
      </div>
      {/* Name/service/color above are identity, not style — the style row
          heads the covered formatting controls (dot, width, stroke). */}
      <StyleRow key={line.id} kind="line" itemId={line.id} styleId={line.styleId} />
      <div className="field dot-field">
        <label>Default stop dot type and size</label>
        <NumericFieldRow
          id={`line-dot-size-${line.id}`}
          label="Dot size"
          leading={
            <StationShapePicker
              disabled={false}
              currentStyle={line.defaultDotStyle ?? DEFAULT_DOT_STYLE}
              lineColor={line.color}
              serviceCode={line.service}
              onPick={(shape) => setLineDefaultDotStyle(line.id, DOT_SHAPE_PRESETS[shape])}
            />
          }
          min={DOT_SIZE_MIN}
          max={DOT_SIZE_MAX}
          step={1}
          value={lineDefaultDotSizeOf(line)}
          onChange={(n) => setLineDefaultDotSize(line.id, n)}
          getCurrent={() => lineDefaultDotSizeOf(useDoc.getState().lines[id])}
          textboxAllowAboveMax
        />
      </div>
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
      <div className="options-popover-row">
        <label htmlFor={`line-stroke-color-${line.id}`} className="options-popover-label">
          Stroke color
        </label>
        <ColorField
          id={`line-stroke-color-${line.id}`}
          ariaLabel="Stroke color"
          value={lineStrokeColorOf(line)}
          onChange={(c) => setLineStrokeColor(line.id, c)}
        />
      </div>
      <NumericFieldRow
        id={`line-seam-${line.id}`}
        label="Seam width"
        min={LINE_STROKE_WIDTH_MIN}
        max={LINE_STROKE_WIDTH_MAX}
        step={LINE_STROKE_STEP}
        // Unset inherits the casing width (so a seam-color-only line shows a
        // seam matched to its casing); the slider overrides.
        value={
          lineSeamWidthOf(line) ?? lineStrokeRailWidth(lineStrokeWidthOf(line), lineWidthOf(line))
        }
        onChange={(n) => setLineSeamWidth(line.id, n)}
        getCurrent={() => {
          const l = useDoc.getState().lines[id];
          return lineSeamWidthOf(l) ?? lineStrokeRailWidth(lineStrokeWidthOf(l), lineWidthOf(l));
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
          value={lineSeamColorOf(line) ?? withHexAlpha(lineStrokeColorOf(line), 0)}
          onChange={(c) => setLineSeamColor(line.id, c)}
        />
      </div>
    </section>
  );
}
