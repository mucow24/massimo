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
import { LineEndSegmented } from './LineEndPicker';
import { WeightSelect, ItalicButton } from './WeightItalicControls';
import { StopGlyph } from './StopGlyph';
import { StationShapePicker } from './StationShapePicker';
import { ROUTE_BULLET_SHAPE_LABEL, ShapeIcon } from './RouteBulletPopover';
import { SegmentedToggle } from './SegmentedToggle';
import type { StylePropsPatch } from '../model/styles';
import { DOT_SIZE_MAX, DOT_SIZE_MIN, DOT_SIZE_STEP } from '../model/dotSize';
import {
  DASH_LENGTH_MAX,
  DASH_WIDTH_MAX,
  dashRenderLength,
  dashRenderWidth,
} from '../model/dashSize';
import {
  LINE_INTERLINE_GAP_MAX,
  LINE_LABEL_GAP_DEFAULT,
  LINE_LABEL_GAP_MAX,
  LINE_LABEL_GAP_MIN,
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
  LINE_OWN_COLOR,
  LINE_STROKE_COLOR_DEFAULT,
  LINE_STROKE_STEP,
  LINE_STROKE_WIDTH_MAX,
  LINE_STROKE_WIDTH_MIN,
} from '../model/lineStroke';
import {
  TRANSFER_STROKE_WIDTH_MAX,
  TRANSFER_STROKE_WIDTH_MIN,
  TRANSFER_STROKE_WIDTH_STEP,
  TRANSFER_THICKNESS_MAX,
  TRANSFER_THICKNESS_MIN,
  TRANSFER_THICKNESS_STEP,
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
  ROUTE_BULLET_SIZE_STEP,
  TEXT_LABEL_FONT_SIZE_MAX,
  TEXT_LABEL_FONT_SIZE_MIN,
} from '../model/transforms';
import { FieldCheckbox } from './FieldCheckbox';
import { BLACK_PAIR, DEFAULT_DOT_STYLE, DOT_STROKE_STEP, WHITE_PAIR } from '../model/dotStyle';
import type {
  DayNightColor,
  DotBaseShape,
  DotStyle,
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
    case 'stopDot':
      return <StopDotStyleEditor id={def.id} props={def.props} />;
  }
}

// Live read of one numeric prop for the sliders' wheel ticks (they must step
// from the authoritative store value, not the render-stale prop). `fallback`
// resolves the field's EFFECTIVE value when the live key is ABSENT — which a
// canonical write can make it mid-scroll, by collapsing an optional field at
// its default (labelGap at 3, interlineGap/dash at 0). It must therefore
// be the field's own default — a constant, or a function of the LIVE props for
// derived defaults — never a render-time snapshot of the value: that is the
// value the scroll just left, and stepping from it stalls the wheel for a
// frame at every collapse point and then double-jumps past it.
function liveNumberProp(
  id: string,
  key: string,
  fallback: number | ((liveProps: Record<string, unknown>) => number),
) {
  return () => {
    const def = useDoc.getState().styles[id];
    const props = def ? (def.props as unknown as Record<string, unknown>) : undefined;
    const value = props ? props[key] : undefined;
    if (typeof value === 'number') return value;
    return typeof fallback === 'number' ? fallback : fallback(props ?? {});
  };
}

function usePatch(id: string): (patch: StylePropsPatch) => void {
  const updateStyleProps = useDoc((s) => s.updateStyleProps);
  return (patch) => updateStyleProps(id, patch);
}

/**
 * The "follow the line's color, or pick one" two-way switch for the line
 * style's casing row — the same Line/Color question the stopDot editor's
 * `DotColorTypeRow` asks, so the two color systems read alike. It stays its own
 * component because a line's casing is a single hex, not a day/night pair, so
 * the swatch row it reveals is a plain `ColorField` the caller renders.
 *
 * `label` names the FIELD ("Stroke"), and segments take "<label> type <type>"
 * so they stay distinct from the swatch row's own name ("Stroke color").
 */
function LineOrColorToggle({
  type,
  label,
  onSelect,
}: {
  type: 'line' | 'color';
  label: string;
  onSelect: (type: 'line' | 'color') => void;
}) {
  return (
    <div className="shape-group">
      <SegmentedToggle
        value={type}
        onSelect={(v) => onSelect(v as 'line' | 'color')}
        options={(['line', 'color'] as const).map((t) => ({
          value: t,
          label: `${label} type ${t}`,
          title: t === 'line' ? "The line's own color" : 'A fixed color',
          content: t === 'line' ? 'Line' : 'Color',
        }))}
      />
    </div>
  );
}

function LineStyleEditor({ id, props }: { id: string; props: LineStyleProps }) {
  const patch = usePatch(id);
  const styles = useDoc((s) => s.styles);
  // Resolve each split default's stopDot library entry — drives the type
  // picker's trigger preview and the dash-only gating below (a dot renders TfL
  // ticks iff its shape is 'dash'). A since-deleted id falls back to the factory
  // look (canonicalStyleProps re-points it on the next load).
  const dotStyleOf = (styleId: string): DotStyle => {
    const def = styles[styleId];
    return def?.kind === 'stopDot' ? (def.props as DotStyle) : DEFAULT_DOT_STYLE;
  };
  const singletonDot = dotStyleOf(props.singletonDotStyleId);
  const multiDot = dotStyleOf(props.multiDotStyleId);
  // Dash length/width only bite on 'dash' stops, so grey them out unless one of
  // the split defaults is a dash dot.
  const dashActive = singletonDot.shape === 'dash' || multiDot.shape === 'dash';
  // The casing color carries either a hex or the LINE_OWN_COLOR sentinel, so one
  // style can give differently-colored lines a casing in their own hue.
  const strokeType: 'line' | 'color' = props.strokeColor === LINE_OWN_COLOR ? 'line' : 'color';
  return (
    <div className="style-editor">
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
      {/* Extra spacing against interlined neighbors (max-of-pair). Absent ⇒ 0
          = classic tangency; stamping re-packs wearers' stations. */}
      <NumericFieldRow
        id={`style-${id}-interline-gap`}
        label="Interline gap"
        min={0}
        max={LINE_INTERLINE_GAP_MAX}
        step={LINE_WIDTH_STEP}
        value={props.interlineGap ?? 0}
        onChange={(interlineGap) => patch({ interlineGap })}
        getCurrent={liveNumberProp(id, 'interlineGap', 0)}
        textboxAllowAboveMax
      />
      {/* Station-label clearance off the marker. Absent ⇒ the default 3;
          0 butts the text to the marker, negative pulls the ink into it. */}
      <NumericFieldRow
        id={`style-${id}-label-gap`}
        label="Label gap"
        min={LINE_LABEL_GAP_MIN}
        max={LINE_LABEL_GAP_MAX}
        step={LINE_WIDTH_STEP}
        value={props.labelGap ?? LINE_LABEL_GAP_DEFAULT}
        onChange={(labelGap) => patch({ labelGap })}
        getCurrent={liveNumberProp(id, 'labelGap', LINE_LABEL_GAP_DEFAULT)}
        textboxAllowAboveMax
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
      {/* The wearer's painted ends. Covered like every other field here, so a
          style can force square back onto a line someone rounded by hand. The
          per-terminus pins are NOT covered — they stay with the line. */}
      <div className="row">
        <label>Line ends</label>
        <LineEndSegmented value={props.endStyle} onSelect={(endStyle) => patch({ endStyle })} />
      </div>
      <div className="style-divider" />
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
      {/* Only while the casing is on — a 0-width stroke has no color to
          pick. */}
      {props.strokeWidth > 0 && (
        <>
          <div className="row">
            <label>Stroke</label>
            <LineOrColorToggle
              type={strokeType}
              label="Stroke"
              // Leaving Line lands on the casing default rather than some remembered
              // hue — a style has no line of its own to take a color from.
              onSelect={(t) =>
                patch({ strokeColor: t === 'line' ? LINE_OWN_COLOR : LINE_STROKE_COLOR_DEFAULT })
              }
            />
          </div>
          {strokeType === 'color' && (
            <div className="row">
              <label htmlFor={`style-${id}-stroke-color`}>Stroke color</label>
              <ColorField
                id={`style-${id}-stroke-color`}
                ariaLabel="Stroke color"
                value={props.strokeColor}
                onChange={(strokeColor) => patch({ strokeColor })}
              />
            </div>
          )}
        </>
      )}

      <div className="style-section">Stop dots</div>
      {/* Dot TYPE + SIZE per station case, split by singleton (only line at the
          station) vs. interchange (shared). The picker points the split default
          at a stopDot library style; the slider sets its diameter — same combined
          row the Line inspector uses. */}
      <div className="dot-field">
        <label htmlFor={`style-${id}-singleton-dot`}>Singleton dot</label>
        <NumericFieldRow
          id={`style-${id}-singleton-dot`}
          label="Singleton dot size"
          leading={
            <StationShapePicker
              disabled={false}
              ariaLabel="Singleton stop shape"
              currentStyle={singletonDot}
              lineColor={PREVIEW_LINE_COLOR}
              serviceCode="A"
              onPick={(singletonDotStyleId) => patch({ singletonDotStyleId })}
            />
          }
          min={DOT_SIZE_MIN}
          max={DOT_SIZE_MAX}
          step={DOT_SIZE_STEP}
          value={props.singletonDotSize}
          onChange={(singletonDotSize) => patch({ singletonDotSize })}
          getCurrent={liveNumberProp(id, 'singletonDotSize', props.singletonDotSize)}
          textboxAllowAboveMax
        />
      </div>
      <div className="dot-field">
        <label htmlFor={`style-${id}-multi-dot`}>Interchange dot</label>
        <NumericFieldRow
          id={`style-${id}-multi-dot`}
          label="Interchange dot size"
          leading={
            <StationShapePicker
              disabled={false}
              ariaLabel="Interchange stop shape"
              currentStyle={multiDot}
              lineColor={PREVIEW_LINE_COLOR}
              serviceCode="A"
              onPick={(multiDotStyleId) => patch({ multiDotStyleId })}
            />
          }
          min={DOT_SIZE_MIN}
          max={DOT_SIZE_MAX}
          step={DOT_SIZE_STEP}
          value={props.multiDotSize}
          onChange={(multiDotSize) => patch({ multiDotSize })}
          getCurrent={liveNumberProp(id, 'multiDotSize', props.multiDotSize)}
          textboxAllowAboveMax
        />
      </div>
      {/* TfL-tick dimensions for 'dash' stops. Unset derives from the style's
          line width (length = width, thickness = width/2) — props is
          structurally a {width, dashLength, dashWidth} line, so the shared
          resolvers apply. Greyed unless a split default is a dash dot. */}
      <NumericFieldRow
        id={`style-${id}-dash-length`}
        label="Dash length"
        min={0}
        max={DASH_LENGTH_MAX}
        step={LINE_STROKE_STEP}
        value={dashRenderLength(props)}
        onChange={(dashLength) => patch({ dashLength })}
        getCurrent={liveNumberProp(id, 'dashLength', (p) => dashRenderLength(p))}
        textboxAllowAboveMax
        disabled={!dashActive}
      />
      <NumericFieldRow
        id={`style-${id}-dash-width`}
        label="Dash width"
        min={0}
        max={DASH_WIDTH_MAX}
        step={LINE_STROKE_STEP}
        value={dashRenderWidth(props)}
        onChange={(dashWidth) => patch({ dashWidth })}
        getCurrent={liveNumberProp(id, 'dashWidth', (p) => dashRenderWidth(p))}
        textboxAllowAboveMax
        disabled={!dashActive}
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
          <SegmentedToggle
            value={props.align}
            onSelect={(v) => patch({ align: v as TextLabelAlign })}
            options={aligns.map((a) => ({
              value: a.value,
              label: a.label,
              title: a.label,
              content: a.icon,
            }))}
          />
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
          <SegmentedToggle
            value={props.shape}
            itemClassName="shape-btn"
            onSelect={(v) => patch({ shape: v as RouteBulletShape })}
            options={shapes.map((s) => ({
              value: s,
              label: ROUTE_BULLET_SHAPE_LABEL[s],
              title: ROUTE_BULLET_SHAPE_LABEL[s],
              content: <ShapeIcon shape={s} />,
            }))}
          />
        </div>
      </div>
      <NumericFieldRow
        id={`style-${id}-size`}
        label="Size"
        min={ROUTE_BULLET_SIZE_MIN}
        max={ROUTE_BULLET_SIZE_MAX}
        step={ROUTE_BULLET_SIZE_STEP}
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
        step={TRANSFER_THICKNESS_STEP}
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

const DOT_SHAPES: { shape: DotBaseShape; label: string }[] = [
  { shape: 'circle', label: 'Circle' },
  { shape: 'square', label: 'Square' },
  { shape: 'diamond', label: 'Diamond' },
  { shape: 'x', label: 'X' },
  { shape: 'dash', label: 'Dash (tick)' },
];

// A stand-in line color for the editor previews — 'line' fills/strokes/dash
// need *some* color to show; the real color comes from each line at paint time.
const PREVIEW_LINE_COLOR = '#3b7dd8';

/**
 * The four ways a dot's mark can be colored. Not a model type — it's the
 * EDITOR's vocabulary, which each row translates to and from its own field(s):
 * 'none' and 'bw' are the `DotFill` / `DotStrokeColor` sentinels for fill and
 * stroke, but the service code spells 'none' as `showServiceCode: false` and
 * 'bw' as an ABSENT `serviceCodeColor`. Rows offer only the types they have a
 * meaning for — a stroke has no 'none' because `strokeWidth: 0` says that.
 */
type DotColorType = 'none' | 'bw' | 'line' | 'color';

const DOT_COLOR_TYPE_LABEL: Record<DotColorType, string> = {
  none: 'None',
  bw: 'B/W',
  line: 'Line',
  color: 'Color',
};

/**
 * One "how is this colored?" row, plus the day/night swatch row that only
 * 'color' reveals beneath it. Fill, stroke and service code are all this same
 * shape, so they share one component rather than three near-copies that drift.
 *
 * `label` names the FIELD ("Fill"), and the swatch row derives its own label
 * from it ("Fill color") — which is why the segments are named "<label> type
 * <type>": "Fill type color" and the "Fill color" swatch must stay distinct
 * accessible names. Generic in `T` so each caller's `types` narrow what its
 * `onPickType` has to handle (the stroke never sees 'none').
 */
function DotColorTypeRow<T extends DotColorType>({
  label,
  idBase,
  types,
  type,
  onPickType,
  bwTitle,
  pair,
  onPair,
  disabled,
}: {
  label: string;
  /** Swatch ids are `${idBase}-day` / `-night`. */
  idBase: string;
  types: readonly T[];
  type: T;
  onPickType: (type: T) => void;
  /** Tooltip for the B/W segment — each row contrasts against something different. */
  bwTitle?: string;
  pair: DayNightColor;
  onPair: (pair: DayNightColor) => void;
  disabled?: boolean;
}) {
  const noun = label.toLowerCase();
  return (
    <>
      <div className={'row' + (disabled ? ' disabled' : '')}>
        <label>{label}</label>
        <div className="shape-group">
          <SegmentedToggle
            value={type}
            disabled={disabled}
            onSelect={(v) => onPickType(v as T)}
            options={types.map((t) => ({
              value: t,
              label: `${label} type ${t}`,
              title: t === 'bw' ? bwTitle : undefined,
              content: DOT_COLOR_TYPE_LABEL[t],
            }))}
          />
        </div>
      </div>
      {type === 'color' && (
        <DayNightColorRow
          label={`${label} color`}
          id={`${idBase}-day`}
          darkId={`${idBase}-night`}
          lightAriaLabel={`${label} color`}
          darkAriaLabel={`Dark mode ${noun} color`}
          titleNoun={`${noun} color`}
          value={pair.day}
          darkValue={pair.night}
          disabled={disabled}
          onChange={(day) => onPair({ day, night: pair.night })}
          onDarkChange={(night) => onPair({ day: pair.day, night })}
        />
      )}
    </>
  );
}

// `viewSize` is the world-unit window; a size larger than it magnifies the
// glyph (the big Preview row renders at 2×).
function DotPreview({
  style,
  size = 20,
  viewSize = size,
}: {
  style: DotStyle;
  size?: number;
  viewSize?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`${-viewSize / 2} ${-viewSize / 2} ${viewSize} ${viewSize}`}
      aria-hidden="true"
    >
      <StopGlyph cx={0} cy={0} style={style} lineColor={PREVIEW_LINE_COLOR} serviceCode="A" />
    </svg>
  );
}

/**
 * The editor for one stopDot library style: 5-way shape, a live preview, stroke
 * width and alignment, and three DotColorTypeRow rows — Fill (None/B/W/Line/
 * Color), Stroke (no None; width 0 says that) and Service code (None/B/W/Line/
 * Color, where None IS `showServiceCode: false`), each revealing its own swatch
 * row under Color. Every edit goes through updateStyleProps, which restamps
 * every dot slot wearing the style (Line inspector + per-stop).
 */
function StopDotStyleEditor({ id, props: p }: { id: string; props: DotStyle }) {
  const patch = usePatch(id);

  // Each row's model field(s), read back as an editor type (see DotColorType).
  const fillType: DotColorType =
    p.fill === 'none' ? 'none' : p.fill === 'bw' ? 'bw' : p.fill === 'line' ? 'line' : 'color';
  // The stroke has no 'none' — strokeWidth 0 is how a style says that.
  const strokeType: 'bw' | 'line' | 'color' =
    p.strokeColor === 'bw' ? 'bw' : p.strokeColor === 'line' ? 'line' : 'color';
  // The code's off state is showServiceCode, and its B/W is an ABSENT color
  // (the historical default), so a fresh code dot lands on B/W.
  const codeType: DotColorType = !p.showServiceCode
    ? 'none'
    : p.serviceCodeColor === undefined
      ? 'bw'
      : p.serviceCodeColor === 'line'
        ? 'line'
        : 'color';
  const fillPair: DayNightColor = typeof p.fill === 'object' ? p.fill : BLACK_PAIR;
  const strokePair: DayNightColor = typeof p.strokeColor === 'object' ? p.strokeColor : WHITE_PAIR;
  const codePair: DayNightColor =
    typeof p.serviceCodeColor === 'object' ? p.serviceCodeColor : WHITE_PAIR;
  // A dash is a TfL tick: it takes its size AND outline from the owning line and
  // never carries a service code, so only shape + fill do anything (see
  // DashGlyph / resolveDotRender). Don't offer the inert controls.
  const isDash = p.shape === 'dash';
  // No stroke ⇒ its color and alignment are inert; grey them out (don't hide —
  // the controls keep their place so the editor doesn't reflow while sliding
  // the width through 0).
  const strokeOff = p.strokeWidth === 0;

  return (
    <div className="style-editor">
      <div className="row">
        <label>Preview</label>
        <DotPreview style={p} size={56} viewSize={28} />
      </div>
      <div className="row">
        <label>Shape</label>
        <div className="shape-group">
          <SegmentedToggle
            value={p.shape}
            itemClassName="shape-btn"
            onSelect={(v) => patch({ shape: v as DotBaseShape })}
            options={DOT_SHAPES.map(({ shape, label }) => ({
              value: shape,
              label,
              title: label,
              content: <DotPreview style={{ ...p, shape }} size={18} />,
            }))}
          />
        </div>
      </div>
      <DotColorTypeRow
        label="Fill"
        idBase={`style-${id}-fill`}
        types={['none', 'bw', 'line', 'color'] as const}
        type={fillType}
        onPickType={(t) => patch({ fill: t === 'color' ? fillPair : t })}
        bwTitle="Black or white, whichever reads on the line"
        pair={fillPair}
        onPair={(fill) => patch({ fill })}
      />
      {isDash ? (
        <div className="style-editor-caption">
          A dash is a tick — it takes its size and outline from the line, so only shape and color
          apply.
        </div>
      ) : (
        <>
          <div className="style-divider" />
          <NumericFieldRow
            id={`style-${id}-dot-stroke`}
            label="Stroke width"
            min={0}
            max={6}
            step={DOT_STROKE_STEP}
            value={p.strokeWidth}
            onChange={(strokeWidth) => patch({ strokeWidth })}
            getCurrent={liveNumberProp(id, 'strokeWidth', p.strokeWidth)}
            textboxAllowAboveMax
          />
          <DotColorTypeRow
            label="Stroke"
            idBase={`style-${id}-stroke`}
            types={['bw', 'line', 'color'] as const}
            type={strokeType}
            onPickType={(t) => patch({ strokeColor: t === 'color' ? strokePair : t })}
            bwTitle="Black or white, whichever reads on the fill"
            pair={strokePair}
            onPair={(strokeColor) => patch({ strokeColor })}
            disabled={strokeOff}
          />
          <div className={'row' + (strokeOff ? ' disabled' : '')}>
            <label>Stroke align</label>
            <div className="shape-group">
              <SegmentedToggle
                value={p.strokeAlign}
                disabled={strokeOff}
                onSelect={(v) => patch({ strokeAlign: v as DotStyle['strokeAlign'] })}
                options={(['center', 'inside', 'outside'] as const).map((mode) => ({
                  value: mode,
                  label: `Align ${mode}`,
                  title: `Stroke ${mode === 'center' ? 'straddles the edge' : mode === 'inside' ? 'grows inward' : 'grows outward'}`,
                  content: mode === 'center' ? 'Center' : mode === 'inside' ? 'Inside' : 'Outside',
                }))}
              />
            </div>
          </div>
          <div className="style-divider" />
          <DotColorTypeRow
            label="Service code"
            idBase={`style-${id}-code`}
            types={['none', 'bw', 'line', 'color'] as const}
            type={codeType}
            // 'none' drops BOTH code-only fields rather than leaving them
            // dangling: a color and a first-letter flag for a code that isn't
            // drawn are invisible state that would make two identical-looking
            // dots compare unequal through dotStylesEqual.
            onPickType={(t) =>
              patch(
                t === 'none'
                  ? {
                      showServiceCode: false,
                      serviceCodeColor: undefined,
                      serviceCodeFirstLetterOnly: undefined,
                    }
                  : {
                      showServiceCode: true,
                      serviceCodeColor: t === 'bw' ? undefined : t === 'line' ? 'line' : codePair,
                    },
              )
            }
            bwTitle="Black or white, whichever reads on the fill"
            pair={codePair}
            onPair={(serviceCodeColor) => patch({ serviceCodeColor })}
          />
          {codeType !== 'none' && (
            <div className="row">
              <label htmlFor={`style-${id}-first-letter`}>First letter only</label>
              <FieldCheckbox
                id={`style-${id}-first-letter`}
                ariaLabel="Show first letter of the service code only"
                title="Print only the code's first letter — a local/express pair reads as one line"
                checked={p.serviceCodeFirstLetterOnly ?? false}
                onCheckedChange={(v) => patch({ serviceCodeFirstLetterOnly: v })}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
