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
import { ShapeIcon } from './RouteBulletPopover';
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
  lineStrokeRailWidth,
} from '../model/lineStroke';
import { withHexAlpha } from '../util/color';
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

/**
 * The "follow the line's color, or pick one" two-way switch, shared by the line
 * style's casing and seam rows. Same shape and wording as the stopDot editor's
 * fill/stroke/service-code mode pickers, so the two color systems read alike;
 * the caller conditionally renders the swatch row beneath when the mode is
 * 'custom'. `ariaPrefix` names the field the segments belong to ("Stroke color"
 * ⇒ "Stroke color line" / "Stroke color custom"), keeping the two rows'
 * segments distinguishable to tests and screen readers.
 */
function LineOrCustomToggle({
  mode,
  ariaPrefix,
  onSelect,
}: {
  mode: 'line' | 'custom';
  ariaPrefix: string;
  onSelect: (mode: 'line' | 'custom') => void;
}) {
  return (
    <div className="shape-group">
      <SegmentedToggle
        value={mode}
        onSelect={(v) => onSelect(v as 'line' | 'custom')}
        options={(['line', 'custom'] as const).map((m) => ({
          value: m,
          label: `${ariaPrefix} ${m}`,
          title: m === 'line' ? "The line's own color" : 'A fixed color',
          content: m === 'line' ? 'Line' : 'Custom',
        }))}
      />
    </div>
  );
}

function LineStyleEditor({ id, props }: { id: string; props: LineStyleProps }) {
  const patch = usePatch(id);
  const styles = useDoc((s) => s.styles);
  // Seam controls inherit the casing when unset (see Line.seamWidth / seamColor).
  const railW = lineStrokeRailWidth(props.strokeWidth, props.width);
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
  // Casing and seam each carry either a hex or the LINE_OWN_COLOR sentinel, so
  // one style can give differently-colored lines a casing in their own hue. An
  // UNSET seam is Custom, not Line: absent is the seam's off state, and the
  // swatch shows it as transparent (the same "drag the alpha up to enable" flow
  // the Line inspector has).
  const strokeMode: 'line' | 'custom' = props.strokeColor === LINE_OWN_COLOR ? 'line' : 'custom';
  const seamMode: 'line' | 'custom' = props.seamColor === LINE_OWN_COLOR ? 'line' : 'custom';
  // The hue the seam's off/transparent swatch is seeded from: the casing, unless
  // that's the sentinel — 'line' is not a hex and would poison the alpha math.
  const seamSeedHex = strokeMode === 'custom' ? props.strokeColor : LINE_STROKE_COLOR_DEFAULT;
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
        getCurrent={liveNumberProp(id, 'interlineGap', props.interlineGap ?? 0)}
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
      <div className="row">
        <label>Stroke color</label>
        <LineOrCustomToggle
          mode={strokeMode}
          ariaPrefix="Stroke color"
          // Leaving Line lands on the casing default rather than some remembered
          // hue — a style has no line of its own to take a color from.
          onSelect={(m) =>
            patch({ strokeColor: m === 'line' ? LINE_OWN_COLOR : LINE_STROKE_COLOR_DEFAULT })
          }
        />
      </div>
      {strokeMode === 'custom' && (
        <div className="row">
          <label htmlFor={`style-${id}-stroke-color`}>Stroke</label>
          <ColorField
            id={`style-${id}-stroke-color`}
            ariaLabel="Stroke color"
            value={props.strokeColor}
            onChange={(strokeColor) => patch({ strokeColor })}
          />
        </div>
      )}
      <div className="style-divider" />
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
        <label>Seam color</label>
        <LineOrCustomToggle
          mode={seamMode}
          ariaPrefix="Seam color"
          // Leaving Line drops to the transparent seed — which is never stored,
          // so the seam returns to plain OFF, exactly where a fresh style sits.
          onSelect={(m) =>
            patch({ seamColor: m === 'line' ? LINE_OWN_COLOR : withHexAlpha(seamSeedHex, 0) })
          }
        />
      </div>
      {seamMode === 'custom' && (
        <div className="row">
          <label htmlFor={`style-${id}-seam-color`}>Seam</label>
          <ColorField
            id={`style-${id}-seam-color`}
            ariaLabel="Seam color"
            value={props.seamColor ?? withHexAlpha(seamSeedHex, 0)}
            onChange={(seamColor) => patch({ seamColor })}
          />
        </div>
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
        getCurrent={liveNumberProp(id, 'dashLength', dashRenderLength(props))}
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
        getCurrent={liveNumberProp(id, 'dashWidth', dashRenderWidth(props))}
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
              label: s,
              title: s,
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
 * The editor for one stopDot library style: 5-way shape, fill (none/line/custom
 * day-night pair), stroke width + color (line/custom), show-service-code + its
 * day/night color, and a live preview. Every edit goes through updateStyleProps,
 * which restamps every dot slot wearing the style (Line inspector + per-stop).
 */
function StopDotStyleEditor({ id, props: p }: { id: string; props: DotStyle }) {
  const patch = usePatch(id);

  const fillMode: 'none' | 'line' | 'custom' =
    p.fill === 'none' ? 'none' : p.fill === 'line' ? 'line' : 'custom';
  const strokeMode: 'line' | 'custom' = p.strokeColor === 'line' ? 'line' : 'custom';
  // Service-code color has three modes: 'bw' (absent ⇒ auto-contrast, picks
  // black or white for legibility on the resolved fill), 'line' (the owning
  // line's color), or a custom day/night pair. Absent is the historical default,
  // so a fresh service-code dot lands on B/W.
  const codeMode: 'bw' | 'line' | 'custom' =
    p.serviceCodeColor === undefined ? 'bw' : p.serviceCodeColor === 'line' ? 'line' : 'custom';
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
      <div className="row">
        <label>Fill</label>
        <div className="shape-group">
          <SegmentedToggle
            value={fillMode}
            onSelect={(v) =>
              patch({ fill: v === 'none' ? 'none' : v === 'line' ? 'line' : fillPair })
            }
            options={(['none', 'line', 'custom'] as const).map((mode) => ({
              value: mode,
              label: `Fill ${mode}`,
              content: mode === 'none' ? 'None' : mode === 'line' ? 'Line' : 'Custom',
            }))}
          />
        </div>
      </div>
      {fillMode === 'custom' && (
        <DayNightColorRow
          label="Fill color"
          id={`style-${id}-fill-day`}
          darkId={`style-${id}-fill-night`}
          lightAriaLabel="Fill color"
          darkAriaLabel="Dark mode fill color"
          titleNoun="fill"
          value={fillPair.day}
          darkValue={fillPair.night}
          onChange={(day) => patch({ fill: { day, night: fillPair.night } })}
          onDarkChange={(night) => patch({ fill: { day: fillPair.day, night } })}
        />
      )}
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
          <div className={'row' + (strokeOff ? ' disabled' : '')}>
            <label>Stroke color</label>
            <div className="shape-group">
              <SegmentedToggle
                value={strokeMode}
                disabled={strokeOff}
                onSelect={(v) => patch({ strokeColor: v === 'line' ? 'line' : strokePair })}
                options={(['line', 'custom'] as const).map((mode) => ({
                  value: mode,
                  label: `Stroke ${mode}`,
                  content: mode === 'line' ? 'Line' : 'Custom',
                }))}
              />
            </div>
          </div>
          {strokeMode === 'custom' && (
            <DayNightColorRow
              label="Stroke"
              id={`style-${id}-stroke-day`}
              darkId={`style-${id}-stroke-night`}
              lightAriaLabel="Stroke color"
              darkAriaLabel="Dark mode stroke color"
              titleNoun="stroke"
              value={strokePair.day}
              darkValue={strokePair.night}
              disabled={strokeOff}
              onChange={(day) => patch({ strokeColor: { day, night: strokePair.night } })}
              onDarkChange={(night) => patch({ strokeColor: { day: strokePair.day, night } })}
            />
          )}
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
          <div className="row">
            <label htmlFor={`style-${id}-service-code`}>Service code</label>
            <FieldCheckbox
              id={`style-${id}-service-code`}
              ariaLabel="Show service code"
              title="Show the line's service code on the dot"
              checked={p.showServiceCode}
              onCheckedChange={(showServiceCode) => patch({ showServiceCode })}
            />
          </div>
          {p.showServiceCode && (
            <>
              <div className="row">
                <label>Code color</label>
                <div className="shape-group">
                  <SegmentedToggle
                    value={codeMode}
                    onSelect={(v) =>
                      patch({
                        serviceCodeColor: v === 'bw' ? undefined : v === 'line' ? 'line' : codePair,
                      })
                    }
                    options={(['bw', 'line', 'custom'] as const).map((mode) => ({
                      value: mode,
                      label: `Code color ${mode}`,
                      content: mode === 'bw' ? 'B/W' : mode === 'line' ? 'Line' : 'Custom',
                    }))}
                  />
                </div>
              </div>
              {codeMode === 'custom' && (
                <DayNightColorRow
                  label="Code"
                  id={`style-${id}-code-day`}
                  darkId={`style-${id}-code-night`}
                  lightAriaLabel="Service code color"
                  darkAriaLabel="Dark mode service code color"
                  titleNoun="service-code color"
                  value={codePair.day}
                  darkValue={codePair.night}
                  onChange={(day) => patch({ serviceCodeColor: { day, night: codePair.night } })}
                  onDarkChange={(night) =>
                    patch({ serviceCodeColor: { day: codePair.day, night } })
                  }
                />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
