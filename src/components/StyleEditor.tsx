import {
  TextAlignCenterIcon,
  TextAlignJustifyIcon,
  TextAlignLeftIcon,
  TextAlignRightIcon,
} from '@radix-ui/react-icons';
import { useDoc } from '../state/store';
import { ColorField } from './ColorField';
import { DayNightColorRow } from './DayNightColorRow';
import { NumericFieldRow } from './NumericFieldRow';
import { WeightSelect, ItalicButton } from './WeightItalicControls';
import { StationShapePicker } from './StationShapePicker';
import { ShapeIcon } from './RouteBulletPopover';
import type { StylePropsPatch } from '../model/styles';
import { DOT_SHAPE_PRESETS } from '../model/dotStyle';
import { DOT_SIZE_MAX, DOT_SIZE_MIN } from '../model/dotSize';
import {
  DASH_LENGTH_MAX,
  DASH_WIDTH_MAX,
  dashRenderLength,
  dashRenderWidth,
} from '../model/dashSize';
import {
  LINE_WIDTH_MAX,
  LINE_WIDTH_MIN,
  LINE_WIDTH_SLIDER_MIN,
  LINE_WIDTH_STEP,
} from '../model/lineWidth';
import {
  LINE_CURVE_RADIUS_MAX,
  LINE_CURVE_RADIUS_MIN,
  LINE_CURVE_RADIUS_STEP,
} from '../model/lineCurve';
import {
  LINE_STROKE_STEP,
  LINE_STROKE_WIDTH_MAX,
  LINE_STROKE_WIDTH_MIN,
  lineStrokeRailWidth,
} from '../model/lineStroke';
import { withHexAlpha } from '../util/color';
import {
  TRANSFER_STROKE_WIDTH_MAX,
  TRANSFER_STROKE_WIDTH_MIN,
  TRANSFER_STROKE_WIDTH_STEP,
  TRANSFER_THICKNESS_MAX,
  TRANSFER_THICKNESS_MIN,
} from '../model/transferStyle';
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
  POLYGON_CURVE_RADIUS_MAX,
  POLYGON_CURVE_RADIUS_MIN,
  POLYGON_CURVE_RADIUS_STEP,
  POLYGON_STROKE_STEP,
  POLYGON_STROKE_WIDTH_MAX,
  POLYGON_STROKE_WIDTH_MIN,
  ROUTE_BULLET_SIZE_MAX,
  ROUTE_BULLET_SIZE_MIN,
  TEXT_LABEL_FONT_SIZE_MAX,
  TEXT_LABEL_FONT_SIZE_MIN,
} from '../model/transforms';
import { FieldCheckbox } from './FieldCheckbox';
import type {
  LineStyleProps,
  PolygonStyleProps,
  RouteBulletShape,
  RouteBulletStyleProps,
  StationStyleProps,
  StyleDef,
  TextLabelAlign,
  TextLabelStyleProps,
  TransferStyleProps,
} from '../model/types';

/**
 * The expanded body of a Styles-panel row: the style's parameters as direct
 * controls — the same widgets its item popover uses. Every edit goes through
 * `updateStyleProps`, which re-stamps the style's tagged items in the same
 * store write, so the map previews live under a slider drag (and the drag
 * still collapses to one undo entry via the fields' own history groups).
 */
export function StyleEditor({ def }: { def: StyleDef }) {
  switch (def.kind) {
    case 'line':
      return <LineStyleEditor id={def.id} props={def.props} />;
    case 'textLabel':
      return <TextLabelStyleEditor id={def.id} props={def.props} />;
    case 'polygon':
      return <PolygonStyleEditor id={def.id} props={def.props} />;
    case 'routeBullet':
      return <RouteBulletStyleEditor id={def.id} props={def.props} />;
    case 'transfer':
      return <TransferStyleEditor id={def.id} props={def.props} />;
    case 'station':
      return <StationStyleEditor id={def.id} props={def.props} />;
  }
}

// Live read of one numeric prop for the sliders' wheel ticks (they must step
// from the authoritative store value, not the render-stale prop).
function liveNumberProp(id: string, key: string, fallback: number) {
  return () => {
    const def = useDoc.getState().styles[id];
    const value = def ? (def.props as unknown as Record<string, unknown>)[key] : undefined;
    return typeof value === 'number' ? value : fallback;
  };
}

function usePatch(id: string): (patch: StylePropsPatch) => void {
  const updateStyleProps = useDoc((s) => s.updateStyleProps);
  return (patch) => updateStyleProps(id, patch);
}

function LineStyleEditor({ id, props }: { id: string; props: LineStyleProps }) {
  const patch = usePatch(id);
  // Seam controls inherit the casing when unset (see Line.seamWidth / seamColor).
  const railW = lineStrokeRailWidth(props.strokeWidth, props.width);
  return (
    <div className="style-editor">
      {/* Split default dot: singleton (only line at the station) vs.
          interchange (shared with another line). Independent; resolved live per
          stop. The picker fills the row's label column, so each row gets its
          own caption above it (tooltip explains the case). */}
      <div className="style-editor-caption" title="Stations with only one line stop">
        Singleton stop dot
      </div>
      <NumericFieldRow
        id={`style-${id}-singleton-dot`}
        label="Singleton dot size"
        leading={
          <StationShapePicker
            disabled={false}
            ariaLabel="Singleton stop shape"
            currentStyle={props.singletonDotStyle}
            onPick={(shape) => patch({ singletonDotStyle: DOT_SHAPE_PRESETS[shape] })}
          />
        }
        min={DOT_SIZE_MIN}
        max={DOT_SIZE_MAX}
        step={1}
        value={props.singletonDotSize}
        onChange={(singletonDotSize) => patch({ singletonDotSize })}
        getCurrent={liveNumberProp(id, 'singletonDotSize', props.singletonDotSize)}
        textboxAllowAboveMax
      />
      <div className="style-editor-caption" title="Stations with more than one line stop">
        Interchange stop dot
      </div>
      <NumericFieldRow
        id={`style-${id}-multi-dot`}
        label="Interchange dot size"
        leading={
          <StationShapePicker
            disabled={false}
            ariaLabel="Interchange stop shape"
            currentStyle={props.multiDotStyle}
            onPick={(shape) => patch({ multiDotStyle: DOT_SHAPE_PRESETS[shape] })}
          />
        }
        min={DOT_SIZE_MIN}
        max={DOT_SIZE_MAX}
        step={1}
        value={props.multiDotSize}
        onChange={(multiDotSize) => patch({ multiDotSize })}
        getCurrent={liveNumberProp(id, 'multiDotSize', props.multiDotSize)}
        textboxAllowAboveMax
      />
      <NumericFieldRow
        id={`style-${id}-width`}
        label="Line width"
        min={LINE_WIDTH_SLIDER_MIN}
        max={LINE_WIDTH_MAX}
        step={LINE_WIDTH_STEP}
        value={props.width}
        onChange={(width) => patch({ width })}
        getCurrent={liveNumberProp(id, 'width', props.width)}
        textboxAllowAboveMax
        textboxMin={LINE_WIDTH_MIN}
      />
      <NumericFieldRow
        id={`style-${id}-curve`}
        label="Curve radius"
        min={LINE_CURVE_RADIUS_MIN}
        max={LINE_CURVE_RADIUS_MAX}
        step={LINE_CURVE_RADIUS_STEP}
        value={props.curveRadius}
        onChange={(curveRadius) => patch({ curveRadius })}
        getCurrent={liveNumberProp(id, 'curveRadius', props.curveRadius)}
        textboxAllowAboveMax
      />
      <NumericFieldRow
        id={`style-${id}-stroke`}
        label="Stroke width"
        min={LINE_STROKE_WIDTH_MIN}
        max={LINE_STROKE_WIDTH_MAX}
        step={LINE_STROKE_STEP}
        value={props.strokeWidth}
        onChange={(strokeWidth) => patch({ strokeWidth })}
        getCurrent={liveNumberProp(id, 'strokeWidth', props.strokeWidth)}
        textboxAllowAboveMax
      />
      <div className="row">
        <label htmlFor={`style-${id}-stroke-color`}>Stroke color</label>
        <ColorField
          id={`style-${id}-stroke-color`}
          ariaLabel="Stroke color"
          value={props.strokeColor}
          onChange={(strokeColor) => patch({ strokeColor })}
        />
      </div>
      <NumericFieldRow
        id={`style-${id}-seam`}
        label="Seam width"
        min={LINE_STROKE_WIDTH_MIN}
        max={LINE_STROKE_WIDTH_MAX}
        step={LINE_STROKE_STEP}
        value={props.seamWidth ?? railW}
        onChange={(seamWidth) => patch({ seamWidth })}
        getCurrent={liveNumberProp(id, 'seamWidth', props.seamWidth ?? railW)}
        textboxAllowAboveMax
      />
      <div className="row">
        <label htmlFor={`style-${id}-seam-color`}>Seam color</label>
        <ColorField
          id={`style-${id}-seam-color`}
          ariaLabel="Seam color"
          value={props.seamColor ?? withHexAlpha(props.strokeColor, 0)}
          onChange={(seamColor) => patch({ seamColor })}
        />
      </div>
      {/* TfL-tick dimensions for 'dash' stops. Unset derives from the style's
          line width (length = width, thickness = width/2) — props is
          structurally a {width, dashLength, dashWidth} line, so the shared
          resolvers apply. */}
      <NumericFieldRow
        id={`style-${id}-dash-length`}
        label="Dash length"
        min={0}
        max={DASH_LENGTH_MAX}
        step={LINE_STROKE_STEP}
        value={dashRenderLength(props)}
        onChange={(dashLength) => patch({ dashLength })}
        getCurrent={liveNumberProp(id, 'dashLength', dashRenderLength(props))}
        textboxAllowAboveMax
      />
      <NumericFieldRow
        id={`style-${id}-dash-width`}
        label="Dash width"
        min={0}
        max={DASH_WIDTH_MAX}
        step={LINE_STROKE_STEP}
        value={dashRenderWidth(props)}
        onChange={(dashWidth) => patch({ dashWidth })}
        getCurrent={liveNumberProp(id, 'dashWidth', dashRenderWidth(props))}
        textboxAllowAboveMax
      />
    </div>
  );
}

function TextLabelStyleEditor({ id, props }: { id: string; props: TextLabelStyleProps }) {
  const patch = usePatch(id);
  const aligns: { value: TextLabelAlign; label: string; icon: React.ReactNode }[] = [
    { value: 'left', label: 'Align left', icon: <TextAlignLeftIcon /> },
    { value: 'center', label: 'Align center', icon: <TextAlignCenterIcon /> },
    { value: 'right', label: 'Align right', icon: <TextAlignRightIcon /> },
    { value: 'justify', label: 'Justify', icon: <TextAlignJustifyIcon /> },
  ];
  return (
    <div className="style-editor">
      <DayNightColorRow
        label="Color"
        id={`style-${id}-color`}
        darkId={`style-${id}-dark-color`}
        lightAriaLabel="Label color"
        darkAriaLabel="Dark mode label color"
        titleNoun="color"
        value={props.color}
        darkValue={props.darkColor}
        onChange={(color) => patch({ color })}
        onDarkChange={(darkColor) => patch({ darkColor })}
      />
      <NumericFieldRow
        id={`style-${id}-size`}
        label="Size"
        min={TEXT_LABEL_FONT_SIZE_MIN}
        max={TEXT_LABEL_FONT_SIZE_MAX}
        step={FONT_SIZE_STEP}
        value={props.fontSize}
        onChange={(fontSize) => patch({ fontSize })}
        getCurrent={liveNumberProp(id, 'fontSize', props.fontSize)}
        textboxAllowAboveMax
      />
      <div className="row">
        <label htmlFor={`style-${id}-weight`}>Weight</label>
        <WeightSelect
          id={`style-${id}-weight`}
          value={props.weight}
          italic={props.italic}
          onChange={(weight) => patch({ weight })}
        />
      </div>
      <div className="row">
        <label>Align</label>
        <div className="shape-group">
          {aligns.map((a) => (
            <button
              key={a.value}
              type="button"
              className={'align-btn' + (props.align === a.value ? ' active' : '')}
              title={a.label}
              aria-label={a.label}
              aria-pressed={props.align === a.value}
              onClick={() => patch({ align: a.value })}
            >
              {a.icon}
            </button>
          ))}
        </div>
        <ItalicButton active={props.italic} onToggle={() => patch({ italic: !props.italic })} />
      </div>
    </div>
  );
}

function PolygonStyleEditor({ id, props }: { id: string; props: PolygonStyleProps }) {
  const patch = usePatch(id);
  return (
    <div className="style-editor">
      <DayNightColorRow
        label="Fill color"
        id={`style-${id}-fill`}
        darkId={`style-${id}-dark-fill`}
        lightAriaLabel="Polygon color"
        darkAriaLabel="Dark mode color"
        titleNoun="fill"
        value={props.fill}
        darkValue={props.darkFill}
        onChange={(fill) => patch({ fill })}
        onDarkChange={(darkFill) => patch({ darkFill })}
      />
      <DayNightColorRow
        label="Stroke color"
        id={`style-${id}-stroke-color`}
        darkId={`style-${id}-dark-stroke`}
        lightAriaLabel="Stroke color"
        darkAriaLabel="Dark mode stroke color"
        titleNoun="stroke"
        value={props.stroke}
        darkValue={props.darkStroke}
        onChange={(stroke) => patch({ stroke })}
        onDarkChange={(darkStroke) => patch({ darkStroke })}
      />
      <NumericFieldRow
        id={`style-${id}-stroke-width`}
        label="Stroke width"
        min={POLYGON_STROKE_WIDTH_MIN}
        max={POLYGON_STROKE_WIDTH_MAX}
        step={POLYGON_STROKE_STEP}
        value={props.strokeWidth}
        onChange={(strokeWidth) => patch({ strokeWidth })}
        getCurrent={liveNumberProp(id, 'strokeWidth', props.strokeWidth)}
        textboxAllowAboveMax
      />
      <NumericFieldRow
        id={`style-${id}-curve`}
        label="Curve radius"
        min={POLYGON_CURVE_RADIUS_MIN}
        max={POLYGON_CURVE_RADIUS_MAX}
        step={POLYGON_CURVE_RADIUS_STEP}
        value={props.curveRadius}
        onChange={(curveRadius) => patch({ curveRadius })}
        getCurrent={liveNumberProp(id, 'curveRadius', props.curveRadius)}
        textboxAllowAboveMax
      />
      <div className="row">
        <label htmlFor={`style-${id}-closed`}>Closed</label>
        <FieldCheckbox
          id={`style-${id}-closed`}
          ariaLabel="Closed"
          title="Closed (uncheck for an open, stroke-only polygon)"
          checked={props.closed}
          onCheckedChange={(closed) => patch({ closed })}
        />
      </div>
    </div>
  );
}

function RouteBulletStyleEditor({ id, props }: { id: string; props: RouteBulletStyleProps }) {
  const patch = usePatch(id);
  const shapes: RouteBulletShape[] = ['circle', 'square', 'diamond'];
  return (
    <div className="style-editor">
      <div className="row">
        <label>Shape</label>
        <div className="shape-group">
          {shapes.map((s) => (
            <button
              key={s}
              type="button"
              className={'shape-btn' + (props.shape === s ? ' active' : '')}
              title={s}
              aria-label={s}
              onClick={() => patch({ shape: s })}
            >
              <ShapeIcon shape={s} />
            </button>
          ))}
        </div>
      </div>
      <NumericFieldRow
        id={`style-${id}-size`}
        label="Size"
        min={ROUTE_BULLET_SIZE_MIN}
        max={ROUTE_BULLET_SIZE_MAX}
        step={1}
        value={props.size}
        onChange={(size) => patch({ size })}
        getCurrent={liveNumberProp(id, 'size', props.size)}
        textboxAllowAboveMax
      />
    </div>
  );
}

function TransferStyleEditor({ id, props }: { id: string; props: TransferStyleProps }) {
  const patch = usePatch(id);
  return (
    <div className="style-editor">
      <NumericFieldRow
        id={`style-${id}-thickness`}
        label="Thickness"
        min={TRANSFER_THICKNESS_MIN}
        max={TRANSFER_THICKNESS_MAX}
        step={1}
        value={props.thickness}
        onChange={(thickness) => patch({ thickness })}
        getCurrent={liveNumberProp(id, 'thickness', props.thickness)}
        textboxAllowAboveMax
      />
      <DayNightColorRow
        label="Color"
        id={`style-${id}-color`}
        darkId={`style-${id}-dark-color`}
        lightAriaLabel="Transfer color"
        darkAriaLabel="Transfer dark color"
        titleNoun="color"
        value={props.color.day}
        darkValue={props.color.night}
        onChange={(day) => patch({ color: { day, night: props.color.night } })}
        onDarkChange={(night) => patch({ color: { day: props.color.day, night } })}
      />
      <NumericFieldRow
        id={`style-${id}-stroke-width`}
        label="Stroke width"
        min={TRANSFER_STROKE_WIDTH_MIN}
        max={TRANSFER_STROKE_WIDTH_MAX}
        step={TRANSFER_STROKE_WIDTH_STEP}
        value={props.strokeWidth}
        onChange={(strokeWidth) => patch({ strokeWidth })}
        getCurrent={liveNumberProp(id, 'strokeWidth', props.strokeWidth)}
        textboxAllowAboveMax
      />
      <DayNightColorRow
        label="Stroke color"
        id={`style-${id}-stroke-color`}
        darkId={`style-${id}-dark-stroke-color`}
        lightAriaLabel="Transfer stroke color"
        darkAriaLabel="Transfer dark stroke color"
        titleNoun="stroke"
        value={props.strokeColor.day}
        darkValue={props.strokeColor.night}
        onChange={(day) => patch({ strokeColor: { day, night: props.strokeColor.night } })}
        onDarkChange={(night) => patch({ strokeColor: { day: props.strokeColor.day, night } })}
      />
    </div>
  );
}

function StationStyleEditor({ id, props }: { id: string; props: StationStyleProps }) {
  const patch = usePatch(id);
  return (
    <div className="style-editor">
      <NumericFieldRow
        id={`style-${id}-size`}
        label="Size"
        min={LABEL_FONT_SIZE_MIN}
        max={LABEL_FONT_SIZE_MAX}
        step={FONT_SIZE_STEP}
        value={props.fontSize}
        onChange={(fontSize) => patch({ fontSize })}
        getCurrent={liveNumberProp(id, 'fontSize', props.fontSize)}
        textboxAllowAboveMax
      />
      <div className="row">
        <label htmlFor={`style-${id}-weight`}>Weight</label>
        <WeightSelect
          id={`style-${id}-weight`}
          value={props.weight}
          italic={props.italic}
          onChange={(weight) => patch({ weight })}
        />
        <ItalicButton active={props.italic} onToggle={() => patch({ italic: !props.italic })} />
      </div>
      <NumericFieldRow
        id={`style-${id}-leading`}
        label="Leading"
        min={LABEL_LEADING_MIN}
        max={LABEL_LEADING_MAX}
        step={LABEL_LEADING_STEP}
        value={props.leading}
        onChange={(leading) => patch({ leading })}
        getCurrent={liveNumberProp(id, 'leading', props.leading)}
        detent={LABEL_LEADING_DEFAULT}
        textboxAllowAboveMax
      />
      <NumericFieldRow
        id={`style-${id}-tracking`}
        label="Tracking"
        min={LABEL_TRACKING_MIN}
        max={LABEL_TRACKING_MAX}
        step={LABEL_TRACKING_STEP}
        value={props.tracking}
        onChange={(tracking) => patch({ tracking })}
        getCurrent={liveNumberProp(id, 'tracking', props.tracking)}
        detent={LABEL_TRACKING_DEFAULT}
        textboxAllowAboveMax
      />
    </div>
  );
}
