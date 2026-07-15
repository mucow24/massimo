import { autoOrientNewStation } from './autoOrient';
import { effectiveLineOrder } from './lineOrder';
import { reconcileOrder, moveInOrder } from './recordOrder';
import { LINE_WIDTH_DEFAULT, canonicalLineWidth, lineWidthOf } from './lineWidth';
import { LINE_CURVE_RADIUS_DEFAULT, canonicalLineCurveRadius } from './lineCurve';
import { repackStationForWidth } from './stationPacking';
import { DOT_SIZE_DEFAULT, canonicalDotSize } from './dotSize';
import {
  LINE_STROKE_COLOR_DEFAULT,
  LINE_STROKE_WIDTH_DEFAULT,
  canonicalStrokeColor,
  canonicalSeamColor,
  canonicalStrokeWidth,
} from './lineStroke';
import {
  TRANSFER_COLOR_DEFAULT,
  TRANSFER_STROKE_COLOR_DEFAULT,
  TRANSFER_STROKE_WIDTH_DEFAULT,
  TRANSFER_THICKNESS_DEFAULT,
  canonicalTransferColor,
  canonicalTransferStrokeWidth,
  canonicalTransferThickness,
} from './transferStyle';
import { DEFAULT_DOT_STYLE, dotStylesEqual } from './dotStyle';
import { pairKeyOf } from './pairKey';
import { addEdge, edgeNeighbors, edgesWithout, lineHasEdge, removeEdge } from './lineTopology';
import { DIR_8, STOP_SIZE, rotateBy, stopCenterAt, tangentGap } from '../geometry/orientation';
import { CELL_EPS, sameCell } from '../geometry/lattice';
import { GRID_INTERVAL, snapPointToGrid, type GridSnap } from '../geometry/snap';
import { polygonCentroid, edgeMidpoint } from '../geometry/polygon';
import { clampSize as clampSvgImageSize, normalizeRotation } from '../geometry/svgImage';
import { measureTextLabel } from '../geometry/textMeasure';
import type { LabelStyle } from '../geometry/labelLayout';
import { rotateAround, type Vec2 } from '../geometry/vec';
import { normalizePaletteIds, type Palette, type PaletteId } from './palettes';
import type {
  AutoHAlign,
  AutoVAlign,
  DotStyle,
  LabelAlign,
  LabelCell,
  LabelValign,
  Line,
  LineId,
  LineStyle,
  LineTag,
  MapDoc,
  Polygon,
  PolygonStylePatch,
  RegionAssignment,
  SvgImage,
  SvgImageStylePatch,
  Rotation,
  RouteBullet,
  SeamEdges,
  Station,
  StationId,
  StationStyleProps,
  StopCell,
  StopOrientation,
  StyleDef,
  StyleKind,
  TextLabel,
  TextLabelWeight,
  Transfer,
  TransferEnd,
  TransferStylePatch,
} from './types';

export const LABEL_FONT_SIZE_MIN = 2;
export const LABEL_FONT_SIZE_MAX = 24;
export const LABEL_FONT_SIZE_DEFAULT = 12;

// Every font-size control (station labels + text labels) steps in quarters and
// stores values snapped to this grid. Mirrors `LINE_STROKE_STEP`'s role for
// the stroke-width field.
export const FONT_SIZE_STEP = 0.25;

// Helvetica Neue weights we ship in /public/fonts/. No 600 — we don't have a
// SemiBold face. Single source of truth for both the text-label popover and
// the station-label settings dropdown.
export const LABEL_WEIGHT_VALUES: readonly TextLabelWeight[] = [
  100, 200, 300, 400, 500, 700, 800, 900,
] as const;

// The single membership check for "is this a shippable Helvetica Neue weight"
// (note: no 600). Used by the serialize migration and the label popover's
// <select>, neither of which re-derives the 8-way comparison.
export function isLabelWeight(v: unknown): v is TextLabelWeight {
  return typeof v === 'number' && (LABEL_WEIGHT_VALUES as readonly number[]).includes(v);
}

// Weight display names live with the other font primitives in util/fonts (the
// names ARE the shipped faces); re-exported here so the popovers keep importing
// weight-related constants from transforms alongside the label style defaults.
export { LABEL_WEIGHT_NAMES } from '../util/fonts';
import { MIN_FONT_SIZE } from '../util/fonts';

export const LABEL_WEIGHT_DEFAULT: TextLabelWeight = 400;

// Global station-label leading (line-spacing multiplier, detent at the neutral
// 1) and tracking (letter-spacing in em, detent at the neutral 0). Same slider
// ranges the per-label popover uses (TEXT_LABEL_LEADING_* / _TRACKING_*), kept
// as their own LABEL_* family to match the station/text font-size split and so
// they can sit above DEFAULT_DOC. Leading clamps at 0 (the spinbutton accepts
// values above the slider max); tracking's floor is a hard clamp — below about
// -0.1em glyphs pile up unreadably.
export const LABEL_LEADING_MIN = 0;
export const LABEL_LEADING_MAX = 2;
export const LABEL_LEADING_STEP = 0.05;
export const LABEL_LEADING_DEFAULT = 1;
export const LABEL_TRACKING_MIN = -0.1;
export const LABEL_TRACKING_MAX = 0.5;
export const LABEL_TRACKING_STEP = 0.001;
export const LABEL_TRACKING_DEFAULT = 0;

// Default document name for a fresh (or nameless legacy) map. Also the value the
// name field falls back to when the user clears it. Single source of truth for
// the DEFAULT_DOC merge, the toolbar field, and the empty-name guard.
export const MAP_NAME_DEFAULT = 'Untitled map';

// NOTE: DEFAULT_STYLES + DEFAULT_DOC live at the BOTTOM of this file — their
// initializers reference per-kind default constants (polygon, route bullet)
// that are declared further down, and module-level consts aren't hoisted.

/**
 * Shift a weight `delta` positions along LABEL_WEIGHT_VALUES (clamped at the
 * ends). Used by the per-station bold flag (+2) and the hover bump (+2 from
 * whatever the station currently resolves to).
 *
 * Unknown weights pass through unchanged — keeps the function tolerant if a
 * file ever lands with an out-of-band value.
 */
export function bumpWeightByIndex(weight: TextLabelWeight, delta: number): TextLabelWeight {
  const i = LABEL_WEIGHT_VALUES.indexOf(weight);
  if (i < 0) return weight;
  const next = Math.max(0, Math.min(LABEL_WEIGHT_VALUES.length - 1, i + delta));
  return LABEL_WEIGHT_VALUES[next];
}

// The per-station typography defaults — the LABEL_* family as one object, so
// effective-value resolution, the collapse-at-default writer, and the factory
// 'station' style all read from a single source. A station stores only the
// fields that differ from these.
export const STATION_LABEL_STYLE_DEFAULTS: StationStyleProps = {
  fontSize: LABEL_FONT_SIZE_DEFAULT,
  weight: LABEL_WEIGHT_DEFAULT,
  italic: false,
  leading: LABEL_LEADING_DEFAULT,
  tracking: LABEL_TRACKING_DEFAULT,
};

/**
 * The EFFECTIVE per-station typography (stored value ?? its LABEL_* default) as
 * a self-contained `StationStyleProps` — the define-by-example capture for the
 * 'station' style kind. Absent fields resolve to the defaults, so a station
 * carrying no typography fields reads as the factory look.
 */
export function effectiveStationStyleProps(
  station: Pick<Station, 'fontSize' | 'weight' | 'italic' | 'leading' | 'tracking'>,
): StationStyleProps {
  return {
    fontSize: station.fontSize ?? LABEL_FONT_SIZE_DEFAULT,
    weight: station.weight ?? LABEL_WEIGHT_DEFAULT,
    italic: station.italic ?? false,
    leading: station.leading ?? LABEL_LEADING_DEFAULT,
    tracking: station.tracking ?? LABEL_TRACKING_DEFAULT,
  };
}

/**
 * The effective `LabelStyle` for a single station — its own per-station
 * typography, resolved through the defaults. Every measured consumer (the
 * painted label's layout, the silhouette, the hit area, the layout editor, and
 * marquee hit-testing) goes through here so they all agree on how a given
 * station's label is measured. `StationStyleProps` is structurally a
 * `LabelStyle` (weight narrowed to the shipped ladder), so this is a
 * type-facing view of `effectiveStationStyleProps`.
 */
export function effectiveStationLabelStyle(
  station: Pick<Station, 'fontSize' | 'weight' | 'italic' | 'leading' | 'tracking'>,
): LabelStyle {
  return effectiveStationStyleProps(station);
}

/**
 * Clamp/snap a full StationStyleProps onto the canonical grids (fontSize on the
 * FONT_SIZE_STEP grid floored at LABEL_FONT_SIZE_MIN; leading/tracking snapped
 * to their slider steps). The ONE canonicalizer shared by
 * `updateStationLabelStyle` (the per-station writer) and
 * `canonicalStyleProps('station')` (the style def), so a def edited in the panel
 * compares exactly equal to what stamping it stores back. `weight`/`italic` pass
 * through (validated as a shipped ladder value / boolean upstream).
 */
export function canonicalStationLabelStyle(props: StationStyleProps): StationStyleProps {
  return {
    fontSize: Math.max(
      LABEL_FONT_SIZE_MIN,
      Math.round(props.fontSize / FONT_SIZE_STEP) * FONT_SIZE_STEP,
    ),
    weight: props.weight,
    italic: props.italic,
    leading: snapToStep(props.leading, LABEL_LEADING_STEP, LABEL_LEADING_MIN),
    tracking: snapToStep(props.tracking, LABEL_TRACKING_STEP, LABEL_TRACKING_MIN),
  };
}

// TextLabel constants and defaults — exported so the popover, placement
// preview, and tests share a single source of truth.
// Shares the low-level MIN_FONT_SIZE primitive: the label Size field floor and
// the inline `<size=…>` resolution floor (resolveRunFontSize) are the same
// concept, so they read from one constant.
export const TEXT_LABEL_FONT_SIZE_MIN = MIN_FONT_SIZE;
export const TEXT_LABEL_FONT_SIZE_MAX = 96;
// Column-width slider ceiling (world units). 0 = Auto (size to content, manual
// line breaks). The spinbutton accepts larger values; updateTextLabel clamps
// only at 0.
export const TEXT_LABEL_WIDTH_MAX = 800;
// Default day/night text colors for new labels. Kept as independent literals
// (not imported from state/theme.ts — the pure model must not pull in the
// zustand store) but chosen to match the historical theme label colors so
// existing labels are visually unchanged once backfilled.
export const TEXT_LABEL_COLOR_DEFAULT = '#111111';
export const TEXT_LABEL_DARK_COLOR_DEFAULT = '#ffffff';
// Leading: multiplier on the default 1.2em line spacing. Slider range with a
// detent at the neutral 1; the spinbutton accepts values above the max.
export const TEXT_LABEL_LEADING_MIN = 0;
export const TEXT_LABEL_LEADING_MAX = 2;
export const TEXT_LABEL_LEADING_STEP = 0.05;
export const TEXT_LABEL_LEADING_DEFAULT = 1;
// Tracking: extra letter-spacing in em (0 = font-normal, negative = tighter).
// The floor is a hard clamp — below about -0.1em glyphs pile up unreadably.
export const TEXT_LABEL_TRACKING_MIN = -0.1;
export const TEXT_LABEL_TRACKING_MAX = 0.5;
export const TEXT_LABEL_TRACKING_STEP = 0.001;
export const TEXT_LABEL_TRACKING_DEFAULT = 0;
export const TEXT_LABEL_DEFAULTS: Omit<TextLabel, 'id' | 'x' | 'y'> = {
  rotation: 0,
  text: 'New Label',
  fontSize: 16,
  weight: 400,
  italic: false,
  align: 'left',
  color: TEXT_LABEL_COLOR_DEFAULT,
  darkColor: TEXT_LABEL_DARK_COLOR_DEFAULT,
  leading: TEXT_LABEL_LEADING_DEFAULT,
  tracking: TEXT_LABEL_TRACKING_DEFAULT,
};

// ---------- Stations ----------

// --- single-record immutable-update helpers ---
// Collapse the recurring "fetch by id, bail if absent, spread the one changed
// field back through doc -> collection -> record" dance. The mapper returns the
// SAME reference to signal a no-op, so a setter's early-out (return `doc`
// unchanged — which history grouping relies on for change detection) is just
// `return cur`/`return st`. Multi-record edits (redistribute, cascade deletes)
// keep their own bespoke loops.

type RecordCollectionKey =
  | 'lines'
  | 'routeBullets'
  | 'textLabels'
  | 'polygons'
  | 'svgImages'
  | 'lineTags'
  | 'transfers';

function updateRecord<K extends RecordCollectionKey>(
  doc: MapDoc,
  key: K,
  id: string,
  fn: (cur: MapDoc[K][string]) => MapDoc[K][string],
): MapDoc {
  // The cast pins the value type across the generic key index — TS can't prove
  // `doc[key][id]` is `MapDoc[K][string]` on its own.
  const coll = doc[key] as Record<string, MapDoc[K][string]>;
  const cur = coll[id];
  if (!cur) return doc;
  const next = fn(cur);
  if (next === cur) return doc;
  return { ...doc, [key]: { ...coll, [id]: next } } as MapDoc;
}

// Detach an item from its style preset. Editing a covered style field breaks
// the styleId tag's "tagged ⇒ matches" invariant (see types.ts), so the
// transforms below clear the tag whenever a covered value ACTUALLY changes —
// value-identical re-writes (a slider tick, re-clicking the active align
// button) must keep it. Same reference when untagged.
function stripStyleId<T extends { styleId?: string }>(item: T): T {
  if (item.styleId === undefined) return item;
  const { styleId: _gone, ...rest } = item;
  return rest as T;
}

// Paste/duplicate hygiene for the add*With constructors: an incoming styleId
// is kept only when it resolves to a style of the matching kind in THIS doc —
// cross-document paste can carry a foreign or wrong-kind id. Values are kept
// either way (same outcome as deleting a style).
function sanitizeIncomingStyleId<T extends { styleId?: string }>(
  doc: MapDoc,
  kind: StyleKind,
  item: T,
): T {
  if (item.styleId === undefined || doc.styles[item.styleId]?.kind === kind) return item;
  return stripStyleId(item);
}

function updateStation(doc: MapDoc, id: StationId, fn: (st: Station) => Station): MapDoc {
  const cur = doc.stations[id];
  if (!cur) return doc;
  const next = fn(cur);
  if (next === cur) return doc;
  return { ...doc, stations: { ...doc.stations, [id]: next } };
}

function updateLabel(doc: MapDoc, id: StationId, fn: (label: LabelCell) => LabelCell): MapDoc {
  return updateStation(doc, id, (st) => {
    const next = fn(st.label);
    return next === st.label ? st : { ...st, label: next };
  });
}

/**
 * Build a fresh, default-shaped station. The canonical source of the
 * new-station skeleton (rotation, empty stops, and the auto-placed label
 * cell) — used by `addStation` and by the on-canvas placement ghost so the
 * preview can never drift from the station that actually drops.
 */
export function makeStation(id: StationId, x: number, y: number, name: string): Station {
  return {
    id,
    name,
    x,
    y,
    rotation: 0,
    stops: [],
    label: {
      row: 0,
      col: -1,
      rotation: 0,
      offset: 0,
      offsetPerp: 0,
      align: 'auto',
      valign: 'auto-down',
    },
  };
}

export function addStation(doc: MapDoc, x: number, y: number, id: StationId, name: string): MapDoc {
  const station = makeStation(id, x, y, name);
  return { ...doc, stations: { ...doc.stations, [id]: station } };
}

export function renameStation(doc: MapDoc, id: StationId, name: string): MapDoc {
  return updateStation(doc, id, (st) => ({ ...st, name }));
}

export function moveStation(doc: MapDoc, id: StationId, x: number, y: number): MapDoc {
  return updateStation(doc, id, (st) => ({ ...st, x, y }));
}

/**
 * Resolve the style for a stop: explicit per-stop `dotStyle` wins, else the
 * line's `defaultDotStyle`, else DEFAULT_DOT_STYLE (the historical
 * filled-black).
 */
export function resolveDotStyle(line: Line | undefined, stop: StopCell | undefined): DotStyle {
  return stop?.dotStyle ?? line?.defaultDotStyle ?? DEFAULT_DOT_STYLE;
}

/**
 * Effective perpendicular label offset. The field defaults to 0 when absent
 * (older saves) or when the label is missing — one named home for that default
 * so read-sites stop re-spelling `?? 0`.
 */
export function resolveOffsetPerp(label: LabelCell | undefined): number {
  return label?.offsetPerp ?? 0;
}

/**
 * Effective autoAlign flag. Optional and omitted when off (like the other
 * boolean flags), so read-sites use this instead of re-spelling `?? false`.
 */
export function resolveAutoAlign(label: LabelCell | undefined): boolean {
  return !!label?.autoAlign;
}

export function setDotStyle(
  doc: MapDoc,
  stationId: StationId,
  lineId: LineId,
  style: DotStyle,
): MapDoc {
  // Picking the line's effective default for a stop clears the per-stop
  // override so the stop tracks the default going forward (and so persisted
  // state stays clean — same pattern as `segmentStyles` + 'solid'). Style
  // equality is structural (`dotStylesEqual`), never reference identity.
  const lineDefault = doc.lines[lineId]?.defaultDotStyle ?? DEFAULT_DOT_STYLE;
  const clears = dotStylesEqual(style, lineDefault);
  return updateStation(doc, stationId, (cur) => {
    let changed = false;
    const stops = cur.stops.map((s) => {
      if (s.lineId !== lineId) return s;
      if (clears) {
        if (s.dotStyle === undefined) return s;
        changed = true;
        const { dotStyle: _gone, ...rest } = s;
        return rest;
      }
      if (s.dotStyle !== undefined && dotStylesEqual(s.dotStyle, style)) return s;
      changed = true;
      return { ...s, dotStyle: style };
    });
    return changed ? { ...cur, stops } : cur;
  });
}

/**
 * Drop every per-stop override of `field` on `lineId` that has become
 * redundant — `isRedundant(stop)` decides when a stop now equals the line's
 * new effective default. Shared by the two "set line default" setters
 * (`setLineDefaultDotStyle` / `setLineDefaultDotSize`) so the override-pruning
 * rule — which keeps persisted docs clean and makes those stops track the
 * default going forward — can never drift between dot-style and dot-size.
 * Returns the same `stations` reference when nothing was pruned.
 */
function dropRedundantStopOverrides(
  stations: Record<StationId, Station>,
  lineId: LineId,
  field: 'dotStyle' | 'dotSize',
  isRedundant: (stop: StopCell) => boolean,
): Record<StationId, Station> {
  let out = stations;
  for (const sid of Object.keys(out)) {
    const st = out[sid];
    let stopsChanged = false;
    const stops = st.stops.map((s) => {
      if (s.lineId !== lineId || !isRedundant(s)) return s;
      stopsChanged = true;
      const { [field]: _gone, ...rest } = s;
      return rest;
    });
    if (stopsChanged) out = { ...out, [sid]: { ...st, stops } };
  }
  return out;
}

export function setLineDefaultDotStyle(doc: MapDoc, id: LineId, style: DotStyle): MapDoc {
  const cur = doc.lines[id];
  if (!cur) return doc;
  // DEFAULT_DOT_STYLE is the historical default; omit the field so persisted
  // state stays clean (mirrors `setLineSegmentStyle` + 'solid').
  let nextLine: Line;
  if (dotStylesEqual(style, DEFAULT_DOT_STYLE)) {
    if (cur.defaultDotStyle === undefined) return doc;
    const { defaultDotStyle: _gone, ...rest } = cur;
    nextLine = rest;
  } else {
    if (cur.defaultDotStyle !== undefined && dotStylesEqual(cur.defaultDotStyle, style)) {
      return doc;
    }
    nextLine = { ...cur, defaultDotStyle: style };
  }
  // Any per-stop override on this line that matches the NEW default is now
  // redundant — drop it so the stop tracks the default going forward.
  const stations = dropRedundantStopOverrides(
    doc.stations,
    id,
    'dotStyle',
    (s) => s.dotStyle !== undefined && dotStylesEqual(s.dotStyle, style),
  );
  // Every fall-through past the early-returns above is a real covered-field
  // change → detach from the line's style preset.
  return { ...doc, lines: { ...doc.lines, [id]: stripStyleId(nextLine) }, stations };
}

// Per-stop dot size override — the dot's DIAMETER in px. Non-finite input is
// ignored; otherwise the value is rounded and clamped to ≥ DOT_SIZE_MIN.
// Setting the line's EFFECTIVE default clears the override so the stop
// tracks the default going forward (same contract as `setDotStyle`).
// Reference-equal no-ops keep textbox keystrokes out of the undo history.
export function setDotSize(
  doc: MapDoc,
  stationId: StationId,
  lineId: LineId,
  size: number,
): MapDoc {
  if (!Number.isFinite(size)) return doc;
  const effDefault = doc.lines[lineId]?.defaultDotSize ?? DOT_SIZE_DEFAULT;
  const stored = canonicalDotSize(size, effDefault);
  return updateStation(doc, stationId, (cur) => {
    let changed = false;
    const stops = cur.stops.map((s) => {
      if (s.lineId !== lineId || s.dotSize === stored) return s;
      changed = true;
      if (stored === undefined) {
        const { dotSize: _gone, ...rest } = s;
        return rest;
      }
      return { ...s, dotSize: stored };
    });
    return changed ? { ...cur, stops } : cur;
  });
}

// Per-line default dot size (DIAMETER in px). Same normalization grid as
// `setLineWidth` (non-finite ignored, rounded, floor-clamped, dropped at the
// default, reference-equal no-ops) PLUS the `setLineDefaultDotStyle`
// cascade: any per-stop override equal to the NEW effective default is now
// redundant — drop it so those stops track the default going forward.
export function setLineDefaultDotSize(doc: MapDoc, id: LineId, size: number): MapDoc {
  const cur = doc.lines[id];
  if (!cur || !Number.isFinite(size)) return doc;
  const stored = canonicalDotSize(size);
  if (cur.defaultDotSize === stored) return doc;
  let nextLine: Line;
  if (stored === undefined) {
    const { defaultDotSize: _gone, ...rest } = cur;
    nextLine = rest;
  } else {
    nextLine = { ...cur, defaultDotSize: stored };
  }
  // The cascade compares against the new EFFECTIVE default — `stored`, or the
  // global DOT_SIZE_DEFAULT when `stored` collapsed to undefined (`stored` is
  // undefined ONLY at that default). Resetting to the global default must also
  // absorb overrides that equal DOT_SIZE_DEFAULT.
  const effDefault = stored ?? DOT_SIZE_DEFAULT;
  const stations = dropRedundantStopOverrides(
    doc.stations,
    id,
    'dotSize',
    (s) => s.dotSize === effDefault,
  );
  // Fall-through = the stored default-dot-size changed → detach from the
  // line's style preset.
  return { ...doc, lines: { ...doc.lines, [id]: stripStyleId(nextLine) }, stations };
}

// Write optional style field `field` onto a line: set it to `stored`, or drop
// it entirely when `stored` is undefined — a field at its default is never
// persisted (see the per-field canonicalizers). Pure; the caller owns the
// styleId detach and the doc splice.
function writeLineField<K extends keyof Line>(
  line: Line,
  field: K,
  stored: Line[K] | undefined,
): Line {
  if (stored !== undefined) return { ...line, [field]: stored };
  const { [field]: _gone, ...rest } = line;
  return rest as Line;
}

// The shared body of every plain per-line style setter: bail if the line is
// gone or the canonical stored value is unchanged (reference-equal no-ops keep
// slider ticks out of undo history), otherwise write the field, detach from the
// style preset, and splice back. Callers own canonicalization and any
// finiteness guard. `setLineWidth` opts out — it also re-packs station layouts.
function setLineStyleField<K extends keyof Line>(
  doc: MapDoc,
  id: LineId,
  field: K,
  stored: Line[K] | undefined,
): MapDoc {
  const cur = doc.lines[id];
  if (!cur || cur[field] === stored) return doc;
  return {
    ...doc,
    lines: { ...doc.lines, [id]: stripStyleId(writeLineField(cur, field, stored)) },
  };
}

// Per-line stripe width. Non-finite input is ignored; otherwise the value is
// rounded and clamped to ≥ LINE_WIDTH_MIN, and the field is dropped when the
// result lands on LINE_WIDTH_DEFAULT so the default is never stored (mirrors
// `setLineDefaultDotStyle` + DEFAULT_DOT_STYLE). Returns the input doc unchanged
// when the effective stored form wouldn't change — the slider fires this on
// every drag tick, and reference equality is what keeps no-op ticks out of
// the undo history.
//
// Width is GEOMETRY: the interlining merge gate keys on stops sitting exactly
// tangentGap(wA, wB) apart, so a bare width write would strand every packed
// layout at its old spacing and un-merge its bands. Each width change
// therefore also re-packs the tangent stop chains at every station hosting
// this line (see stationPacking.ts) — packed stays packed, spread stays
// spread, and the whole edit is one doc write (one undo entry).
export function setLineWidth(doc: MapDoc, id: LineId, w: number): MapDoc {
  const cur = doc.lines[id];
  if (!cur || !Number.isFinite(w)) return doc;
  const stored = canonicalLineWidth(w);
  if (cur.width === stored) return doc;
  const stations = mapRecord(doc.stations, (st) =>
    repackStationForWidth(st, doc.lines, id, lineWidthOf(cur), stored ?? LINE_WIDTH_DEFAULT),
  );
  // Fall-through = the stored width changed → detach from the style preset.
  return {
    ...doc,
    lines: { ...doc.lines, [id]: stripStyleId(writeLineField(cur, 'width', stored)) },
    stations,
  };
}

// Per-line corner-rounding radius. Same contract as setLineStrokeWidth:
// non-finite input is ignored, the value is rounded to an integer and clamped
// to ≥ LINE_CURVE_RADIUS_MIN, and the field is dropped when the result lands
// on LINE_CURVE_RADIUS_DEFAULT so it is never stored. Reference-equal no-ops
// keep slider ticks out of the undo history. Curve radius is GEOMETRY (it
// moves band paths), so store actions wrap this in withRegionReconcile like
// the other geometry writers.
export function setLineCurveRadius(doc: MapDoc, id: LineId, r: number): MapDoc {
  if (!Number.isFinite(r)) return doc;
  return setLineStyleField(doc, id, 'curveRadius', canonicalLineCurveRadius(r));
}

// Per-line casing width. Same contract as setLineWidth except the grid:
// non-finite input is ignored, the value is rounded to the nearest
// LINE_STROKE_STEP (0.5) and clamped to ≥ LINE_STROKE_WIDTH_MIN, and the
// field is dropped when the result lands on the default (0 = no casing) so
// it is never stored. Reference-equal no-ops keep slider ticks out of the
// undo history.
export function setLineStrokeWidth(doc: MapDoc, id: LineId, w: number): MapDoc {
  if (!Number.isFinite(w)) return doc;
  return setLineStyleField(doc, id, 'strokeWidth', canonicalStrokeWidth(w));
}

// Per-line casing color. Normalized to lowercase before compare/store (the
// color input emits lowercase, but hand-edited files may carry `#FFFFFF`),
// and the field is dropped at the default so it is never stored — the
// invariant is "stored color is lowercase and never the default".
export function setLineStrokeColor(doc: MapDoc, id: LineId, c: string): MapDoc {
  return setLineStyleField(doc, id, 'strokeColor', canonicalStrokeColor(c));
}

// Per-line seam color (the interior branch/loop overlap indicator). Like the
// casing color it is normalized to lowercase and dropped at the "off" state
// (unset / fully transparent) so it is never stored; a change detaches the line
// from its preset.
export function setLineSeamColor(doc: MapDoc, id: LineId, c: string): MapDoc {
  return setLineStyleField(doc, id, 'seamColor', canonicalSeamColor(c));
}

// Per-line seam width. Shares the casing width's canonical grid/floor and
// drop-at-0 (`canonicalStrokeWidth`); an unset (dropped) value inherits the
// casing width at render time. A change detaches the line from its preset.
export function setLineSeamWidth(doc: MapDoc, id: LineId, w: number): MapDoc {
  if (!Number.isFinite(w)) return doc;
  return setLineStyleField(doc, id, 'seamWidth', canonicalStrokeWidth(w));
}

export function setStationWaypoint(doc: MapDoc, stationId: StationId, isWaypoint: boolean): MapDoc {
  return updateStation(doc, stationId, (st) =>
    !!st.isWaypoint === isWaypoint ? st : { ...st, isWaypoint },
  );
}

// For every line that contains both startId and endId, evenly redistribute
// the intervening stops by arc length along the existing polyline through
// those stops. If a station is intervening on multiple matching lines (its
// new position would be ambiguous), it is left untouched.
export type RedistributeMode =
  // Arc length along the existing polyline; corner stations are treated as
  // additional anchors. Used for ctrl-click (one-shot).
  | 'arc-bends'
  // Straight-line interpolation between A and B's stop positions. Used for
  // ctrl-drag — gives predictable, wiggle-free even spacing as B moves.
  | 'straight';

// Shared per-station noise floor (world px) for redistributeBetween: one floor
// for both the arc-mode drift-skip (ignore a proposed move smaller than this)
// and the multi-line conflict-dedup (treat two lines' proposals for one shared
// station as agreeing when they're within this). In arc modes the two must not
// disagree — a move the drift-skip ignores must not then be flagged a conflict.
// (The conflict check runs in all modes; the drift-skip is arc-only.)
const REDISTRIBUTE_EPS = 1;

export function redistributeBetween(
  doc: MapDoc,
  startId: StationId,
  endId: StationId,
  mode: RedistributeMode = 'arc-bends',
  // When set, each redistributed station's center is rounded to the nearest
  // grid point — keeping the hard-grid invariant (a thing placed with grid on
  // never falls off the grid). This trades perfectly-even spacing for staying
  // on grid; an infrequent, accepted approximation.
  gridMode: GridSnap = 'off',
  // Grid cell size in world units (defaults to the standard 10). The store
  // wrapper threads the active grid size here so redistribute stays on the
  // same lattice as everything else.
  gridInterval: number = GRID_INTERVAL,
): MapDoc {
  if (startId === endId) return doc;
  if (!doc.stations[startId] || !doc.stations[endId]) return doc;

  const proposals = new Map<StationId, { x: number; y: number }>();
  const conflicted = new Set<StationId>();

  for (const line of Object.values(doc.lines)) {
    const iStart = line.stations.indexOf(startId);
    const iEnd = line.stations.indexOf(endId);
    if (iStart < 0 || iEnd < 0) continue;

    const iLow = Math.min(iStart, iEnd);
    const iHigh = Math.max(iStart, iEnd);
    const n = iHigh - iLow - 1;
    if (n < 1) continue;

    const ids = line.stations.slice(iLow, iHigh + 1);
    const sts = ids.map((id) => doc.stations[id]);
    if (sts.some((p) => !p)) continue;

    // The visible route runs through this line's STOPS, not station centers.
    // At interlined stations the stop is offset from the center, so a polyline
    // through centers can zigzag even when the stops are perfectly aligned.
    // Use stop world positions to drive the redistribution, then derive each
    // new station center from the new stop position.
    const stopOffsets = sts.map((st) => {
      const cell = st.stops.find((c) => c.lineId === line.id);
      if (!cell) return { x: 0, y: 0 };
      return rotateBy(stopCenterAt(cell.row, cell.col), st.rotation);
    });
    const stopPts = sts.map((st, i) => ({
      x: st.x + stopOffsets[i].x,
      y: st.y + stopOffsets[i].y,
    }));

    // Build the list of anchor indices (positions whose stop is fixed).
    // Always anchor the endpoints; arc-bends mode also anchors any intervening
    // station that sits at a real bend in the existing polyline.
    const anchors: number[] = [0];
    if (mode === 'arc-bends') {
      const ANGLE_THRESHOLD = (5 * Math.PI) / 180;
      for (let k = 1; k < stopPts.length - 1; k++) {
        const ax = stopPts[k].x - stopPts[k - 1].x;
        const ay = stopPts[k].y - stopPts[k - 1].y;
        const bx = stopPts[k + 1].x - stopPts[k].x;
        const by = stopPts[k + 1].y - stopPts[k].y;
        const aLen = Math.hypot(ax, ay);
        const bLen = Math.hypot(bx, by);
        if (aLen === 0 || bLen === 0) continue;
        const cosA = (ax * bx + ay * by) / (aLen * bLen);
        const angle = Math.acos(Math.max(-1, Math.min(1, cosA)));
        if (angle > ANGLE_THRESHOLD) anchors.push(k);
      }
    }
    anchors.push(stopPts.length - 1);

    // Redistribute within each anchor-to-anchor sub-chain.
    for (let a = 0; a < anchors.length - 1; a++) {
      const from = anchors[a];
      const to = anchors[a + 1];
      const subN = to - from - 1;
      if (subN < 1) continue;

      // Compute the target stop position for each non-anchor station k.
      const targets: { x: number; y: number }[] = [];
      if (mode === 'straight') {
        // Straight-line interpolation between the anchor endpoints.
        const ax = stopPts[from].x;
        const ay = stopPts[from].y;
        const bx = stopPts[to].x;
        const by = stopPts[to].y;
        for (let k = 1; k <= subN; k++) {
          const t = k / (subN + 1);
          targets.push({ x: ax + t * (bx - ax), y: ay + t * (by - ay) });
        }
      } else {
        // Arc length along the existing sub-polyline.
        const subSegLens: number[] = [];
        for (let i = from; i < to; i++) {
          subSegLens.push(
            Math.hypot(stopPts[i + 1].x - stopPts[i].x, stopPts[i + 1].y - stopPts[i].y),
          );
        }
        const subTotal = subSegLens.reduce((s, v) => s + v, 0);
        if (subTotal === 0) continue;
        for (let k = 1; k <= subN; k++) {
          const target = (k * subTotal) / (subN + 1);
          let acc = 0;
          let sx = stopPts[from].x;
          let sy = stopPts[from].y;
          for (let i = 0; i < subSegLens.length; i++) {
            if (acc + subSegLens[i] >= target) {
              const t = subSegLens[i] === 0 ? 0 : (target - acc) / subSegLens[i];
              sx = stopPts[from + i].x + t * (stopPts[from + i + 1].x - stopPts[from + i].x);
              sy = stopPts[from + i].y + t * (stopPts[from + i + 1].y - stopPts[from + i].y);
              break;
            }
            acc += subSegLens[i];
          }
          targets.push({ x: sx, y: sy });
        }
      }

      for (let k = 1; k <= subN; k++) {
        const idx = from + k;
        const t = targets[k - 1];
        const cx = t.x - stopOffsets[idx].x;
        const cy = t.y - stopOffsets[idx].y;
        // Hard-grid: round the station center to the grid. Done before the
        // drift-skip and conflict-dedup below so both compare the snapped
        // value (and two lines proposing within a grid cell agree).
        const snapped =
          gridMode === 'off' ? { x: cx, y: cy } : snapPointToGrid(cx, cy, gridMode, gridInterval);
        const px = snapped.x;
        const py = snapped.y;
        const cur = sts[idx];
        // In arc modes, skip sub-pixel drift to avoid breaking perfect snap
        // alignments via floating-point error. Straight-line is exact by
        // construction — and in drag mode tiny per-frame shifts must apply
        // or stations near the anchor lag behind and wobble off the line.
        // With grid on, the snapped proposal is itself exact, so only a true
        // no-op is skipped — a station sitting slightly off-grid (< eps from
        // its target) still gets pulled onto the grid.
        const skipEps = gridMode === 'off' ? REDISTRIBUTE_EPS : 1e-9;
        if (mode !== 'straight' && Math.hypot(px - cur.x, py - cur.y) < skipEps) continue;
        const stationId = ids[idx];
        const existing = proposals.get(stationId);
        if (existing) {
          if (Math.hypot(existing.x - px, existing.y - py) > REDISTRIBUTE_EPS) {
            conflicted.add(stationId);
          }
        } else {
          proposals.set(stationId, { x: px, y: py });
        }
      }
    }
  }

  for (const id of conflicted) proposals.delete(id);
  if (proposals.size === 0) return doc;

  let stations = doc.stations;
  for (const [id, p] of proposals) {
    const cur = stations[id];
    if (!cur) continue;
    stations = { ...stations, [id]: { ...cur, x: p.x, y: p.y } };
  }
  return { ...doc, stations };
}

// One 45° step of the station's rotation — clockwise by default, counter-
// clockwise with dir: -1 (wraps 0 → 7).
export function rotateStation(doc: MapDoc, id: StationId, dir: -1 | 1 = 1): MapDoc {
  const cur = doc.stations[id];
  if (!cur) return doc;
  const next = ((cur.rotation + dir + 8) % 8) as Rotation;
  return { ...doc, stations: { ...doc.stations, [id]: { ...cur, rotation: next } } };
}

// One 45°-clockwise step of an entity's own rotation field (wraps 7 → 0).
const stepRotation = (r: Rotation): Rotation => ((r + 1) % 8) as Rotation;

// The 45°-clockwise orbit step used by group/polygon rotation — the same angle
// `stepRotation` advances an entity's own rotation field by. Points orbit the
// pivot via `vec.rotateAround` (the single home for pivoted rotation).
const ORBIT_STEP_RAD = Math.PI / 4;

/**
 * Reference to a member of a mixed multi-selection. Used by `rotateItemsAround`
 * to identify which doc collection each member lives in without requiring
 * callers to pre-split by type.
 */
export interface ItemRef {
  type: 'station' | 'bullet' | 'label' | 'polygon' | 'svgImage';
  id: string;
}

/**
 * Rotate a mixed station/bullet/label/polygon/svgImage selection 45° clockwise
 * about the pivot. Non-pivot members orbit the pivot's world position; each
 * type also advances its own orientation: stations/bullets/labels step their
 * rotation field by one 45° index, svg images add 45° to their continuous
 * rotation, and polygons carry no rotation field (orbiting every vertex about
 * the pivot IS their rotation). The pivot may be any of the five types.
 * Members whose ids are missing from the doc are silently skipped — selection
 * state can outlive a doc edit (undo).
 */
export function rotateItemsAround(doc: MapDoc, pivot: ItemRef, members: ItemRef[]): MapDoc {
  // Pivot world point. Stations/bullets/labels carry an (x, y); a polygon
  // pivots about its vertex centroid.
  let px: number;
  let py: number;
  if (pivot.type === 'polygon') {
    const pv = doc.polygons[pivot.id];
    if (!pv) return doc;
    const c = polygonCentroid(pv.vertices);
    px = c.x;
    py = c.y;
  } else if (pivot.type === 'svgImage') {
    const pv = doc.svgImages[pivot.id];
    if (!pv) return doc;
    px = pv.x;
    py = pv.y;
  } else {
    const pivotItem =
      pivot.type === 'station'
        ? doc.stations[pivot.id]
        : pivot.type === 'bullet'
          ? doc.routeBullets[pivot.id]
          : doc.textLabels[pivot.id];
    if (!pivotItem) return doc;
    px = pivotItem.x;
    py = pivotItem.y;
  }
  const pivotPt = { x: px, y: py };

  let stations = doc.stations;
  let routeBullets = doc.routeBullets;
  let textLabels = doc.textLabels;
  let polygons = doc.polygons;
  let svgImages = doc.svgImages;

  for (const m of members) {
    const isPivot = m.type === pivot.type && m.id === pivot.id;
    if (m.type === 'station') {
      const cur = stations[m.id];
      if (!cur) continue;
      const p = isPivot ? cur : rotateAround({ x: cur.x, y: cur.y }, pivotPt, ORBIT_STEP_RAD);
      stations = {
        ...stations,
        [m.id]: { ...cur, rotation: stepRotation(cur.rotation), x: p.x, y: p.y },
      };
    } else if (m.type === 'bullet') {
      const cur = routeBullets[m.id];
      if (!cur) continue;
      const p = isPivot ? cur : rotateAround({ x: cur.x, y: cur.y }, pivotPt, ORBIT_STEP_RAD);
      routeBullets = {
        ...routeBullets,
        [m.id]: { ...cur, rotation: stepRotation(cur.rotation), x: p.x, y: p.y },
      };
    } else if (m.type === 'label') {
      const cur = textLabels[m.id];
      if (!cur) continue;
      const p = isPivot ? cur : rotateAround({ x: cur.x, y: cur.y }, pivotPt, ORBIT_STEP_RAD);
      textLabels = {
        ...textLabels,
        [m.id]: { ...cur, rotation: stepRotation(cur.rotation), x: p.x, y: p.y },
      };
    } else if (m.type === 'polygon') {
      // Polygon: orbit every vertex about the pivot. When the polygon IS the
      // pivot, orbiting about its own centroid is exactly an in-place 45°
      // rotation — no separate rotation field to step.
      const cur = polygons[m.id];
      if (!cur) continue;
      const vertices = cur.vertices.map((vert) => rotateAround(vert, pivotPt, ORBIT_STEP_RAD));
      polygons = { ...polygons, [m.id]: { ...cur, vertices } };
    } else {
      // Svg image: orbit the center (held fixed when it IS the pivot) and step
      // its continuous rotation by 45° — a clean multiple of the 22.5° snap
      // grid, so a group rotate never desyncs an image from that grid.
      const cur = svgImages[m.id];
      if (!cur) continue;
      const p = isPivot
        ? { x: cur.x, y: cur.y }
        : rotateAround({ x: cur.x, y: cur.y }, pivotPt, ORBIT_STEP_RAD);
      svgImages = {
        ...svgImages,
        [m.id]: { ...cur, x: p.x, y: p.y, rotation: normalizeRotation(cur.rotation + 45) },
      };
    }
  }
  return { ...doc, stations, routeBullets, textLabels, polygons, svgImages };
}

/**
 * Flatten the selection id lists into the ItemRef[] that `rotateItemsAround`
 * consumes. Order is irrelevant to the rotation result. `polygonIds` and
 * `svgImageIds` are optional so call sites that never select those types can
 * omit them.
 */
export function buildRotateMembers(
  stationIds: string[],
  bulletIds: string[],
  labelIds: string[],
  polygonIds: string[] = [],
  svgImageIds: string[] = [],
): ItemRef[] {
  return [
    ...stationIds.map((id): ItemRef => ({ type: 'station', id })),
    ...bulletIds.map((id): ItemRef => ({ type: 'bullet', id })),
    ...labelIds.map((id): ItemRef => ({ type: 'label', id })),
    ...polygonIds.map((id): ItemRef => ({ type: 'polygon', id })),
    ...svgImageIds.map((id): ItemRef => ({ type: 'svgImage', id })),
  ];
}

/**
 * Pure helper: rotate the layout (col/row of every stop + label) 90° while
 * rotating the station the OPPOSITE way, so world appearance stays the same
 * but the editor view of the unrotated grid is reoriented. Stop orientations
 * and label rotation are transformed in lockstep so world tangent directions
 * stay invariant too.
 *
 * dir = +1: layout rotates clockwise; station rotates CCW (rotation += 6).
 * dir = -1: layout rotates CCW; station rotates CW (rotation += 2).
 *
 * Exported so that `matching.ts` can use the same transform to canonicalize
 * a station's structural identity across the 4-fold mirror symmetry.
 */
export function rotateStationLayoutBy90(station: Station, dir: -1 | 1): Station {
  const stationStep = dir === 1 ? 6 : 2; // CCW for R+, CW for R-
  const nextRot = ((station.rotation + stationStep) % 8) as Rotation;
  const rotateGrid = (col: number, row: number) => {
    const g = dir === 1 ? { col: -row, row: col } : { col: row, row: -col };
    // Normalize -0 → 0 (as rotateGridDelta does) so the canonicalized layout
    // matching.ts derives compares cleanly under strict / deep equality.
    return { col: g.col === 0 ? 0 : g.col, row: g.row === 0 ? 0 : g.row };
  };
  // Orientation maps so that the WORLD tangent direction is preserved across
  // the change in station rotation. A ±90° rotation swaps each axis with its
  // perpendicular partner: N/S ↔ E/W, NE/SW ↔ NW/SE.
  const rotOrient = (o: StopOrientation): StopOrientation => {
    if (o === 'auto-vertical') return 'auto-horizontal';
    if (o === 'auto-horizontal') return 'auto-vertical';
    if (o === 'auto-ne-sw') return 'auto-nw-se';
    return 'auto-ne-sw';
  };
  const stops = station.stops.map((c) => {
    const r = rotateGrid(c.col, c.row);
    return { ...c, col: r.col, row: r.row, orientation: rotOrient(c.orientation) };
  });
  const lr = rotateGrid(station.label.col, station.label.row);
  // Label rotation is in the unrotated local frame; to keep its world
  // orientation, advance it the inverse of the station's step.
  const labelStep = dir === 1 ? 2 : 6;
  const labelRot = ((station.label.rotation + labelStep) % 8) as Rotation;
  const label = { ...station.label, col: lr.col, row: lr.row, rotation: labelRot };
  return { ...station, rotation: nextRot, stops, label };
}

export function rotateStationAndLayout(doc: MapDoc, id: StationId, dir: -1 | 1): MapDoc {
  const cur = doc.stations[id];
  if (!cur) return doc;
  return {
    ...doc,
    stations: { ...doc.stations, [id]: rotateStationLayoutBy90(cur, dir) },
  };
}

// Drop every transfer that has an endpoint anchored at a stop the caller is
// removing. `orphaned` decides whether an endpoint now points at a stop that
// no longer exists — matched by (stationId, lineId) for a single stop, by
// lineId for a whole line, or by stationId for a whole station.
function pruneTransfers(
  transfers: Record<string, Transfer>,
  orphaned: (end: TransferEnd) => boolean,
): Record<string, Transfer> {
  const next: Record<string, Transfer> = {};
  for (const xid of Object.keys(transfers)) {
    const t = transfers[xid];
    if (!orphaned(t.a) && !orphaned(t.b)) next[xid] = t;
  }
  return next;
}

export function deleteStation(doc: MapDoc, id: StationId): MapDoc {
  const { [id]: _gone, ...rest } = doc.stations;
  const lines: Record<LineId, Line> = {};
  for (const lid of Object.keys(doc.lines)) {
    const ln = doc.lines[lid];
    // Drop the station from the line (healing a degree-2 gap so the line stays
    // connected), then prune any segment style/layer override whose pair-key is
    // no longer an edge — same contract as removeStationFromLine / deleteLine.
    lines[lid] = pruneOrphanSegmentStyles({
      ...ln,
      stations: ln.stations.filter((x) => x !== id),
      edges: edgesAfterRemoveStation(ln.edges, id),
    });
  }
  // Cascade-delete transfers that referenced the removed station.
  const transfers = pruneTransfers(doc.transfers, (e) => e.stationId === id);
  return pruneOrphanLineTags({ ...doc, stations: rest, lines, transfers });
}

// ---------- Stops ----------

export function moveStop(
  doc: MapDoc,
  stationId: StationId,
  lineId: LineId,
  dRow: number,
  dCol: number,
): MapDoc {
  return updateStation(doc, stationId, (st) => {
    const i = st.stops.findIndex((c) => c.lineId === lineId);
    if (i < 0) return st;
    const cell = st.stops[i];
    const newRow = cell.row + dRow;
    const newCol = cell.col + dCol;
    const target = { row: newRow, col: newCol };
    // Stops can swap with another stop, but cannot enter the label cell.
    if (sameCell(st.label, target)) return st;
    const j = st.stops.findIndex((c) => sameCell(c, target));
    const newStops = st.stops.slice();
    if (j >= 0 && j !== i) {
      newStops[j] = { ...newStops[j], row: cell.row, col: cell.col };
    }
    newStops[i] = { ...cell, row: newRow, col: newCol };
    return { ...st, stops: newStops };
  });
}

// Exported for the per-stop orientation picker: index k's LOCAL axis paints
// as the WORLD axis at index (k + station.rotation) % 4 — consecutive
// entries are 45° CW apart, matching the station rotation step.
export const AXIS_CYCLE: StopOrientation[] = [
  'auto-vertical', // 0 — N/S
  'auto-ne-sw', // 1 — NE/SW
  'auto-horizontal', // 2 — E/W
  'auto-nw-se', // 3 — NW/SE
];

export function rotateStop(doc: MapDoc, stationId: StationId, lineId: LineId): MapDoc {
  return updateStation(doc, stationId, (st) => {
    const i = st.stops.findIndex((c) => c.lineId === lineId);
    if (i < 0) return st;
    const cur = st.stops[i];
    const idx = AXIS_CYCLE.indexOf(cur.orientation);
    const next = AXIS_CYCLE[(idx + 1) % 4];
    if (next === cur.orientation) return st;
    const newStops = st.stops.slice();
    newStops[i] = { ...cur, orientation: next };
    return { ...st, stops: newStops };
  });
}

// ---------- Label ----------

export function moveLabel(doc: MapDoc, stationId: StationId, dRow: number, dCol: number): MapDoc {
  if (Math.abs(dRow) < CELL_EPS && Math.abs(dCol) < CELL_EPS) return doc;
  return updateStation(doc, stationId, (st) => {
    // Step in the requested direction; if a stop occupies the destination, keep
    // stepping until we land on an empty cell. So [Label] O O O + → ends up
    // O O O [Label]. Bounded by stop count so a degenerate step (all zeros)
    // can't spin — already guarded above, but belt + suspenders.
    let newRow = st.label.row + dRow;
    let newCol = st.label.col + dCol;
    for (let safety = 0; safety < st.stops.length + 1; safety++) {
      if (!st.stops.some((c) => sameCell(c, { row: newRow, col: newCol }))) break;
      newRow += dRow;
      newCol += dCol;
    }
    return { ...st, label: { ...st.label, row: newRow, col: newCol } };
  });
}

export function rotateLabel(doc: MapDoc, stationId: StationId): MapDoc {
  return updateLabel(doc, stationId, (label) => ({
    ...label,
    rotation: ((label.rotation + 1) % 8) as Rotation,
  }));
}

export function flipLabel(doc: MapDoc, stationId: StationId): MapDoc {
  return updateLabel(doc, stationId, (label) => ({
    ...label,
    rotation: ((label.rotation + 4) % 8) as Rotation,
  }));
}

export function mirrorLabel(doc: MapDoc, stationId: StationId): MapDoc {
  return updateStation(doc, stationId, (st) => {
    if (st.stops.length === 0) {
      // Just flip the rotation; nothing to mirror around.
      const next = ((st.label.rotation + 4) % 8) as Rotation;
      return { ...st, label: { ...st.label, rotation: next } };
    }
    // Direction from the label to the stops' centroid (quantized to a single
    // dominant cardinal axis). The mirrored label sits one step past the
    // FURTHEST stop along that direction (and any stops beyond), so a label on
    // one side ends up on the opposite side of the entire footprint.
    const cx = st.stops.reduce((a, c) => a + c.col, 0) / st.stops.length;
    const cy = st.stops.reduce((a, c) => a + c.row, 0) / st.stops.length;
    const drRaw = cy - st.label.row;
    const dcRaw = cx - st.label.col;
    let dRow = 0;
    let dCol = 0;
    if (drRaw === 0 && dcRaw === 0) {
      // Label sits exactly on the centroid (e.g. a symmetric vertical/horizontal
      // stop pair): there is no centroid direction to mirror along, so fall back
      // to the label's own facing direction (DIR_8[rotation]) instead of always
      // defaulting east.
      const read = DIR_8[st.label.rotation];
      dRow = read.dRow;
      dCol = read.dCol;
    } else if (Math.abs(drRaw) > Math.abs(dcRaw)) {
      dRow = Math.sign(drRaw) || 1;
    } else {
      dCol = Math.sign(dcRaw) || 1;
    }
    // Furthest stop along (dRow, dCol).
    const proj = (r: number, c: number) => r * dRow + c * dCol;
    const maxProj = st.stops.reduce((m, cell) => Math.max(m, proj(cell.row, cell.col)), -Infinity);
    // Step past the max-projected stop (and any other stops at the same
    // projection level beyond) until we land on an empty cell. Safety bound.
    let newRow = st.label.row;
    let newCol = st.label.col;
    for (let k = 0; k < 1000; k++) {
      newRow += dRow;
      newCol += dCol;
      const beyond = proj(newRow, newCol) > maxProj + CELL_EPS;
      const empty = !st.stops.some((c) => sameCell(c, { row: newRow, col: newCol }));
      if (beyond && empty) break;
    }
    const next = ((st.label.rotation + 4) % 8) as Rotation;
    return { ...st, label: { ...st.label, row: newRow, col: newCol, rotation: next } };
  });
}

export function setLabelOffset(doc: MapDoc, stationId: StationId, offset: number): MapDoc {
  return updateLabel(doc, stationId, (label) => ({ ...label, offset }));
}

export function setLabelOffsetPerp(doc: MapDoc, stationId: StationId, offsetPerp: number): MapDoc {
  return updateLabel(doc, stationId, (label) =>
    resolveOffsetPerp(label) === offsetPerp ? label : { ...label, offsetPerp },
  );
}

// Canonical display order for the align/valign segmented pickers.
export const ALIGN_CYCLE: LabelAlign[] = ['auto', 'start', 'middle', 'end'];

export function setLabelAlign(doc: MapDoc, stationId: StationId, align: LabelAlign): MapDoc {
  return updateLabel(doc, stationId, (label) =>
    label.align === align ? label : { ...label, align },
  );
}

export function setLabelAutoAlign(doc: MapDoc, stationId: StationId, on: boolean): MapDoc {
  return updateLabel(doc, stationId, (label) => {
    if (resolveAutoAlign(label) === on) return label;
    if (on) return { ...label, autoAlign: true };
    // Off = remove the key, keeping saves clean (omitted-when-false, same
    // contract as the station-level boolean flags).
    const { autoAlign: _gone, ...rest } = label;
    return rest;
  });
}

/**
 * Multi-line tuning for autoAlign labels (see LabelCell.autoHAlign /
 * autoVAlign). `null` = back to auto (octant-derived); the key is removed so
 * saves stay clean, matching the other omitted-when-default label fields.
 */
export function setLabelAutoHAlign(
  doc: MapDoc,
  stationId: StationId,
  v: AutoHAlign | null,
): MapDoc {
  return updateLabel(doc, stationId, (label) => {
    if ((label.autoHAlign ?? null) === v) return label;
    if (v) return { ...label, autoHAlign: v };
    const { autoHAlign: _gone, ...rest } = label;
    return rest;
  });
}

export function setLabelAutoVAlign(
  doc: MapDoc,
  stationId: StationId,
  v: AutoVAlign | null,
): MapDoc {
  return updateLabel(doc, stationId, (label) => {
    if ((label.autoVAlign ?? null) === v) return label;
    if (v) return { ...label, autoVAlign: v };
    const { autoVAlign: _gone, ...rest } = label;
    return rest;
  });
}

// Cycle orders for the inspector's auto-tuning chips; null = auto (derived
// from the label's octant).
export const AUTO_HALIGN_CYCLE: (AutoHAlign | null)[] = [null, 'start', 'middle', 'end'];
export const AUTO_VALIGN_CYCLE: (AutoVAlign | null)[] = [null, 'up', 'down'];

// Canonical display order, geometrically symmetric: auto-down (block top
// pinned, grows down) → top → middle → bottom → auto-up (block bottom
// pinned, grows up). The default 'auto-down' sits at index 0.
export const VALIGN_CYCLE: LabelValign[] = ['auto-down', 'top', 'middle', 'bottom', 'auto-up'];

export function setLabelValign(doc: MapDoc, stationId: StationId, valign: LabelValign): MapDoc {
  return updateLabel(doc, stationId, (label) =>
    label.valign === valign ? label : { ...label, valign },
  );
}

// ---------- Lines ----------

export function addLine(doc: MapDoc, id: LineId, service: string, color: string): MapDoc {
  const line: Line = { id, service, name: `${service} line`, color, stations: [], edges: [] };
  // New line goes on top of the layer stack (front-most).
  const order = effectiveLineOrder(doc.lineOrder, doc.lines);
  return {
    ...doc,
    lines: { ...doc.lines, [id]: line },
    lineOrder: [id, ...order],
    lineCounter: doc.lineCounter + 1,
  };
}

export function updateLine(
  doc: MapDoc,
  id: LineId,
  patch: Partial<Pick<Line, 'service' | 'name' | 'color'>>,
): MapDoc {
  const cur = doc.lines[id];
  if (!cur) return doc;
  const nextLine = { ...cur, ...patch };
  const lines = { ...doc.lines, [id]: nextLine };
  if (patch.service === undefined || patch.service === cur.service) {
    return { ...doc, lines };
  }
  // Service code changed — rewrite any inline-bullet tokens for the old code
  // in station names and text labels so bullet glyphs keep referring to the
  // same line. Match is on the literal single-delimiter forms: per
  // parseLabelLine a bullet code can't contain any delimiter character, so a
  // `|code|` / `[code]` / `{code}` substring is always parsed as a bullet —
  // no false hits — and the doubled (unfilled) forms contain their single
  // form, so rewriting the singles covers them too. A backslash-escaped
  // token is literal TEXT, not a bullet, so the lookbehind skips it. A
  // service that itself contains a delimiter can never appear in a token;
  // skip the rewrite rather than mangle literal text.
  if (/[|<>[\]{}\n]/.test(cur.service)) {
    return { ...doc, lines };
  }
  const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tokenRes = ['||', '[]', '{}'].map((d): [RegExp, string] => [
    new RegExp(`(?<!\\\\)${escapeRe(`${d[0]}${cur.service}${d[1]}`)}`, 'g'),
    `${d[0]}${nextLine.service}${d[1]}`,
  ]);
  // Function replacement so a '$' in the new service isn't a replace pattern.
  const rewrite = (s: string): string =>
    tokenRes.reduce((acc, [re, n]) => acc.replace(re, () => n), s);
  const stations = mapRecord(doc.stations, (st) => {
    const name = rewrite(st.name);
    return name === st.name ? st : { ...st, name };
  });
  const textLabels = mapRecord(doc.textLabels, (lbl) => {
    const text = rewrite(lbl.text);
    return text === lbl.text ? lbl : { ...lbl, text };
  });
  return { ...doc, lines, stations, textLabels };
}

function mapRecord<T>(rec: Record<string, T>, f: (v: T) => T): Record<string, T> {
  let changed = false;
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(rec)) {
    const nv = f(v);
    if (nv !== v) changed = true;
    out[k] = nv;
  }
  return changed ? out : rec;
}

export function setLineSegmentStyle(
  doc: MapDoc,
  id: LineId,
  fromStationId: StationId,
  toStationId: StationId,
  style: LineStyle,
): MapDoc {
  const cur = doc.lines[id];
  if (!cur) return doc;
  const key = pairKeyOf(fromStationId, toStationId);
  const prev = cur.segmentStyles ?? {};
  let next: Record<string, LineStyle>;
  if (style === 'solid') {
    if (!(key in prev)) return doc;
    const { [key]: _gone, ...rest } = prev;
    next = rest;
  } else {
    if (prev[key] === style) return doc;
    next = { ...prev, [key]: style };
  }
  return { ...doc, lines: { ...doc.lines, [id]: { ...cur, segmentStyles: next } } };
}

// Edge-set maintenance when `stationId` leaves the line: drop its incident
// edges, and heal a degree-2 gap with a direct edge between its two neighbours
// (so removing an intermediate stop keeps the line running — the historical
// linear behaviour). Termini and junctions just lose their incident edges.
function edgesAfterRemoveStation(edges: string[], stationId: StationId): string[] {
  const nbrs = edgeNeighbors(edges, stationId);
  const e = edgesWithout(edges, stationId);
  return nbrs.length === 2 ? addEdge(e, nbrs[0], nbrs[1]) : e;
}

// Spawn a stop cell for `lineId` on station `st` when it doesn't have one,
// placed one tangent gap east of the rightmost existing stop (exactly one
// column at default widths; (0,0) when empty), and nudge an auto-placed label
// out from under it. Spawning at tangency — not a flat column step — is what
// makes a new stop on a non-default-width line land packed against its
// neighbor, matching the width-aware ghost lattice the layout editor offers.
// Anchoring on a real stop — not the bounding box — keeps the new cell
// adjacent so the layout never gains an orphan. Returns the originals
// unchanged when a stop already exists. Shared by the linear-append and
// lone-member add paths so the two never drift.
function spawnStopCell(
  st: Station,
  lineId: LineId,
  lines: Record<LineId, Line>,
): { stops: StopCell[]; label: LabelCell } {
  if (st.stops.some((c) => c.lineId === lineId)) return { stops: st.stops, label: st.label };
  const anchor =
    st.stops.length === 0
      ? null
      : st.stops.reduce((best, c) => (c.col > best.col ? c : best), st.stops[0]);
  const newRow = anchor ? anchor.row : 0;
  const newCol = anchor
    ? anchor.col +
      tangentGap(lineWidthOf(lines[lineId]), lineWidthOf(lines[anchor.lineId])) / STOP_SIZE
    : 0;
  const newCell: StopCell = { lineId, row: newRow, col: newCol, orientation: 'auto-vertical' };
  const stops = [...st.stops, newCell];
  let label = st.label;
  // Only nudge auto labels (legacy 'auto' align or autoAlign) — manual
  // alignments are user-pinned and shouldn't move out from under the user.
  if (
    (st.label.align === 'auto' || resolveAutoAlign(st.label)) &&
    sameCell(st.label, { row: newRow, col: newCol })
  ) {
    let lc = newCol;
    while (stops.some((c) => sameCell(c, { row: newRow, col: lc }))) lc += 1;
    label = { ...st.label, row: newRow, col: lc };
  }
  return { stops, label };
}

// Add `stationId` to the line as a MEMBER (with a stop cell) WITHOUT drawing an
// edge or splicing the display chain — it's appended to the end of the member
// list as a degree-0 station. Used by the draw tool before connecting it (and
// for a lone seed stop). No-op (same doc reference) when it's already a member.
export function addStationToLine(doc: MapDoc, lineId: LineId, stationId: StationId): MapDoc {
  const ln = doc.lines[lineId];
  const st = doc.stations[stationId];
  if (!ln || !st || ln.stations.includes(stationId)) return doc;
  const { stops: newStops, label: newLabel } = spawnStopCell(st, lineId, doc.lines);
  const newStations = [...ln.stations, stationId];
  const stationsAfter = {
    ...doc.stations,
    [stationId]: { ...st, stops: newStops, label: newLabel },
  };
  return {
    ...doc,
    lines: { ...doc.lines, [lineId]: { ...ln, stations: newStations } },
    stations:
      st.stops.length === 0
        ? autoOrientNewStation(stationsAfter, newStations, stationId)
        : stationsAfter,
  };
}

export function removeStationFromLine(doc: MapDoc, lineId: LineId, idx: number): MapDoc {
  const ln = doc.lines[lineId];
  if (!ln) return doc;
  const removedStationId = ln.stations[idx];
  const newStations = [...ln.stations.slice(0, idx), ...ln.stations.slice(idx + 1)];
  // If the station is no longer on the line at all, drop its stop cell.
  const stillStops = newStations.includes(removedStationId);
  let stations = doc.stations;
  let transfers = doc.transfers;
  if (!stillStops && stations[removedStationId]) {
    const st = stations[removedStationId];
    stations = {
      ...stations,
      [removedStationId]: { ...st, stops: st.stops.filter((c) => c.lineId !== lineId) },
    };
    // The (station, line) stop is gone — delete transfers anchored at it.
    transfers = pruneTransfers(
      transfers,
      (e) => e.stationId === removedStationId && e.lineId === lineId,
    );
  }
  const updatedLine = pruneOrphanSegmentStyles({
    ...ln,
    stations: newStations,
    edges: edgesAfterRemoveStation(ln.edges, removedStationId),
  });
  return pruneOrphanLineTags({
    ...doc,
    lines: { ...doc.lines, [lineId]: updatedLine },
    // No station gains its first line on removal, so nothing is auto-oriented.
    stations,
    transfers,
  });
}

// Add or remove a single track segment between two members (both must already
// be on the line). This is how loops close (an edge back to an existing member)
// and branches form (an edge from an interior member). Toggles: adds the
// canonical edge when absent, removes it (pruning its overrides/tag) when
// present. No-op (same doc reference) when either station isn't a member or the
// two are the same.
export function toggleEdgeOnLine(doc: MapDoc, lineId: LineId, a: StationId, b: StationId): MapDoc {
  const ln = doc.lines[lineId];
  if (!ln || a === b) return doc;
  if (!ln.stations.includes(a) || !ln.stations.includes(b)) return doc;
  const nextEdges = lineHasEdge(ln, a, b) ? removeEdge(ln.edges, a, b) : addEdge(ln.edges, a, b);
  if (nextEdges === ln.edges) return doc;
  const updatedLine = pruneOrphanSegmentStyles({ ...ln, edges: nextEdges });
  return pruneOrphanLineTags({ ...doc, lines: { ...doc.lines, [lineId]: updatedLine } });
}

/**
 * Canvas "connect" primitive (station cursor → station click): wire an edge
 * from a member station to any station, adding the target to the line first
 * when it isn't a member (stop cell spawned; a brand-new station orients along
 * the WIRED edge [from, to] — not the member array, whose tail may be nowhere
 * near the new edge). Idempotent: an already-connected pair returns the doc
 * unchanged, so a re-click never destroys an edge — removal is its own gesture.
 */
export function connectStationsOnLine(
  doc: MapDoc,
  lineId: LineId,
  fromStationId: StationId,
  toStationId: StationId,
): MapDoc {
  const ln = doc.lines[lineId];
  const to = doc.stations[toStationId];
  if (!ln || !to || fromStationId === toStationId) return doc;
  if (!ln.stations.includes(fromStationId)) return doc;
  if (lineHasEdge(ln, fromStationId, toStationId)) return doc;
  const isMember = ln.stations.includes(toStationId);
  let stationsAfter = doc.stations;
  let newStations = ln.stations;
  if (!isMember) {
    const { stops, label } = spawnStopCell(to, lineId, doc.lines);
    newStations = [...ln.stations, toStationId];
    stationsAfter = { ...doc.stations, [toStationId]: { ...to, stops, label } };
  }
  const edges = addEdge(ln.edges, fromStationId, toStationId);
  return {
    ...doc,
    lines: { ...doc.lines, [lineId]: { ...ln, stations: newStations, edges } },
    // Only a station gaining its first line is auto-oriented; anything already
    // served keeps the rotation the user gave it.
    stations:
      !isMember && to.stops.length === 0
        ? autoOrientNewStation(stationsAfter, [fromStationId, toStationId], toStationId)
        : stationsAfter,
  };
}

/**
 * Canvas "splice" primitive (edge cursor → station click): subdivide the edge
 * from–to with `stationId` — remove from–to, wire from–station and station–to.
 * A non-member is added to the line first (stop cell spawned; a brand-new
 * station orients on the [from, station, to] bisector). The split edge's style
 * override and any line tag anchored on it are pruned — the halves inherit the
 * line style. No-op (same reference) when the edge is missing or the station
 * is one of its endpoints.
 */
export function spliceStationIntoEdge(
  doc: MapDoc,
  lineId: LineId,
  fromStationId: StationId,
  toStationId: StationId,
  stationId: StationId,
): MapDoc {
  const ln = doc.lines[lineId];
  const st = doc.stations[stationId];
  if (!ln || !st) return doc;
  if (stationId === fromStationId || stationId === toStationId) return doc;
  if (!lineHasEdge(ln, fromStationId, toStationId)) return doc;
  const isMember = ln.stations.includes(stationId);
  let stationsAfter = doc.stations;
  let newStations = ln.stations;
  if (!isMember) {
    const { stops, label } = spawnStopCell(st, lineId, doc.lines);
    newStations = [...ln.stations, stationId];
    stationsAfter = { ...doc.stations, [stationId]: { ...st, stops, label } };
  }
  let edges = removeEdge(ln.edges, fromStationId, toStationId);
  edges = addEdge(edges, fromStationId, stationId);
  edges = addEdge(edges, stationId, toStationId);
  const updatedLine = pruneOrphanSegmentStyles({ ...ln, stations: newStations, edges });
  return pruneOrphanLineTags({
    ...doc,
    lines: { ...doc.lines, [lineId]: updatedLine },
    stations:
      !isMember && st.stops.length === 0
        ? autoOrientNewStation(stationsAfter, [fromStationId, stationId, toStationId], stationId)
        : stationsAfter,
  });
}

export function deleteLine(doc: MapDoc, id: LineId): MapDoc {
  const { [id]: _gone, ...rest } = doc.lines;
  const stations: Record<StationId, Station> = {};
  for (const sid of Object.keys(doc.stations)) {
    const st = doc.stations[sid];
    stations[sid] = { ...st, stops: st.stops.filter((c) => c.lineId !== id) };
  }
  const order = effectiveLineOrder(doc.lineOrder, doc.lines).filter((x) => x !== id);
  // Drop tags whose lineId matches; the rest are valid by construction.
  const lineTags: Record<string, LineTag> = {};
  for (const tid of Object.keys(doc.lineTags)) {
    if (doc.lineTags[tid].lineId !== id) lineTags[tid] = doc.lineTags[tid];
  }
  // Null out any route bullets that referenced this line; the bullet stays
  // on the canvas but reverts to "unset" until the user picks a new line.
  const routeBullets: Record<string, RouteBullet> = {};
  for (const bid of Object.keys(doc.routeBullets)) {
    const b = doc.routeBullets[bid];
    routeBullets[bid] = b.lineId === id ? { ...b, lineId: null } : b;
  }
  // Deleting the line removes all its stops, so delete every transfer anchored
  // at one — an endpoint with lineId === id pointed at a stop that's now gone.
  const transfers = pruneTransfers(doc.transfers, (e) => e.lineId === id);
  const regionAssignments = pruneRegionAssignmentsForLine(doc.regionAssignments, id);
  return {
    ...doc,
    lines: rest,
    stations,
    lineOrder: order,
    lineTags,
    routeBullets,
    transfers,
    regionAssignments,
  };
}

// ---------- Region assignments ("paint by numbers" layering) ----------

// Wholesale replacement, used by the store's reconcile step. Same-reference
// no-op when the record is shallow-equal (reconcile returns the input record
// untouched when nothing changed, so this collapses to a reference check plus
// a key sweep for safety).
export function setRegionAssignments(doc: MapDoc, next: Record<string, RegionAssignment>): MapDoc {
  const prev = doc.regionAssignments;
  if (prev === next) return doc;
  const prevKeys = Object.keys(prev);
  const nextKeys = Object.keys(next);
  if (prevKeys.length === nextKeys.length && nextKeys.every((k) => prev[k] === next[k])) {
    return doc;
  }
  return { ...doc, regionAssignments: next };
}

// Upsert (assignment) or delete (null) one region assignment — the click
// writer. Same-reference no-op when deleting a missing id or re-writing an
// identical value.
export function assignRegion(doc: MapDoc, id: string, assignment: RegionAssignment | null): MapDoc {
  const prev = doc.regionAssignments;
  if (assignment === null) {
    if (!(id in prev)) return doc;
    const { [id]: _gone, ...rest } = prev;
    return { ...doc, regionAssignments: rest };
  }
  if (prev[id] === assignment) return doc;
  return { ...doc, regionAssignments: { ...prev, [id]: assignment } };
}

// deleteLine cascade for region assignments. An assignment whose CHOSEN line
// died is meaningless — dropped. A dead cover MEMBER only shrinks the cover
// (the user's "X above Y" intent survives losing an incidental third line;
// the store's reconcile step rebinds it to the merged face): the dead id and
// its anchor are stripped, and the assignment is dropped only when fewer
// than two cover lines (no overlap to arbitrate) or zero anchors remain.
function pruneRegionAssignmentsForLine(
  assignments: Record<string, RegionAssignment>,
  lineId: LineId,
): Record<string, RegionAssignment> {
  let changed = false;
  const out: Record<string, RegionAssignment> = {};
  for (const id of Object.keys(assignments)) {
    const a = assignments[id];
    if (a.lineId === lineId) {
      changed = true;
      continue;
    }
    if (!a.lines.includes(lineId)) {
      out[id] = a;
      continue;
    }
    const lines = a.lines.filter((l) => l !== lineId);
    const anchors = a.anchors.filter((anchor) => anchor.lineId !== lineId);
    if (lines.length < 2 || anchors.length === 0) {
      changed = true;
      continue;
    }
    out[id] = { ...a, lines, anchors };
    changed = true;
  }
  return changed ? out : assignments;
}

export function moveLineInOrder(doc: MapDoc, id: LineId, dir: -1 | 1): MapDoc {
  const order = effectiveLineOrder(doc.lineOrder, doc.lines);
  const next = moveInOrder(order, id, dir);
  if (next === order) return doc;
  return { ...doc, lineOrder: next };
}

// ---------- Misc ----------

// Rename the document. No-op guard (returns the same reference) so an unchanged
// name — e.g. the field committing on blur without an edit — records no history
// entry, matching the other scalar setters.
export function setDocName(doc: MapDoc, name: string): MapDoc {
  if (name === doc.name) return doc;
  return { ...doc, name };
}

// `false` is the default for `locked`, so we store `true` and omit the field
// entirely when off — keeping persisted docs clean. No-op (returns `st`
// unchanged) when already at the requested state, so history grouping still
// sees an untouched doc.
export function setStationLocked(doc: MapDoc, stationId: StationId, locked: boolean): MapDoc {
  return updateStation(doc, stationId, (st) => {
    if (!!st.locked === locked) return st;
    if (locked) return { ...st, locked: true };
    const { locked: _gone, ...rest } = st;
    return rest;
  });
}

// The covered per-station typography fields a station style controls. The patch
// shape shared by the inspector's style section, the style stamp
// (model/styles.ts stampStyle), and updateStationLabelStyle, so the three never
// drift.
export type StationLabelPatch = Partial<
  Pick<Station, 'fontSize' | 'weight' | 'italic' | 'leading' | 'tracking'>
>;

// Rebuild a station's five typography fields from a resolved StationStyleProps,
// COLLAPSING each to omission when it equals its LABEL_* default — so a station
// wearing the factory look stores none of them (mirrors the transfer-override
// and bool-flag collapse). Every non-typography station field is preserved.
function withStationLabelStyle(st: Station, props: StationStyleProps): Station {
  const { fontSize: _f, weight: _w, italic: _i, leading: _l, tracking: _t, ...rest } = st;
  const out: Station = { ...rest };
  if (props.fontSize !== STATION_LABEL_STYLE_DEFAULTS.fontSize) out.fontSize = props.fontSize;
  if (props.weight !== STATION_LABEL_STYLE_DEFAULTS.weight) out.weight = props.weight;
  if (props.italic !== STATION_LABEL_STYLE_DEFAULTS.italic) out.italic = props.italic;
  if (props.leading !== STATION_LABEL_STYLE_DEFAULTS.leading) out.leading = props.leading;
  if (props.tracking !== STATION_LABEL_STYLE_DEFAULTS.tracking) out.tracking = props.tracking;
  return out;
}

/**
 * Write one or more per-station typography fields (the 'station' style fields).
 * Each provided field is clamped/snapped to the same canonical grid the style
 * def uses (so a stamped station compares exactly equal to its style), then the
 * whole set is rebuilt with collapse-at-default. Detaches the styleId tag
 * whenever a covered EFFECTIVE value actually changes — a value-identical
 * rewrite (a slider tick landing on the same value) keeps the tag and the same
 * reference. The single write path for the inspector controls and the style
 * stamp, mirroring `updateTextLabel`'s covered-change detach.
 */
export function updateStationLabelStyle(
  doc: MapDoc,
  id: StationId,
  patch: StationLabelPatch,
): MapDoc {
  return updateStation(doc, id, (st) => {
    const before = effectiveStationStyleProps(st);
    const after = canonicalStationLabelStyle({
      fontSize: patch.fontSize ?? before.fontSize,
      weight: patch.weight ?? before.weight,
      italic: patch.italic ?? before.italic,
      leading: patch.leading ?? before.leading,
      tracking: patch.tracking ?? before.tracking,
    });
    const coveredChanged =
      after.fontSize !== before.fontSize ||
      after.weight !== before.weight ||
      after.italic !== before.italic ||
      after.leading !== before.leading ||
      after.tracking !== before.tracking;
    // No effective change: keep the station verbatim (tag and reference intact).
    if (!coveredChanged) return st;
    return stripStyleId(withStationLabelStyle(st, after));
  });
}

/**
 * Remember the manually stretched height (CSS px) of the station Name box in
 * the inspector. Clamped to a positive integer; a no-op when unchanged (so a
 * plain click that reads back the same height doesn't churn history). Mirrors
 * `updateTextLabel`'s `editorHeight` clamp for text labels.
 */
export function setStationEditorHeight(doc: MapDoc, stationId: StationId, height: number): MapDoc {
  const next = Math.max(1, Math.round(height));
  return updateStation(doc, stationId, (st) =>
    st.editorHeight === next ? st : { ...st, editorHeight: next },
  );
}

// Snap a value to its slider's step and clamp at the bottom only (the
// spinbutton accepts values above the slider max). The three-decimal rounding
// kills float artifacts like 1.1500000000000001 while preserving the finest
// step in use (tracking's 0.001); the coarser 0.05 / 0.25 steps never carry a
// legitimate third decimal, so they're unaffected. Shared by the per-station
// updateStationLabelStyle (leading/tracking) and per-label updateTextLabel.
export function snapToStep(v: number, step: number, min: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.round(Math.round(v / step) * step * 1000) / 1000);
}

function arraysEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Replace the active palette set. Empty input (or input containing only
 * unknown ids) is rejected — the doc must always have at least one active
 * palette. Input is deduplicated and normalised to PALETTES declaration order.
 */
export function setActivePalettes(
  doc: MapDoc,
  ids: readonly PaletteId[],
  custom: readonly Palette[] = [],
): MapDoc {
  const next = normalizePaletteIds(ids, custom);
  if (next.length === 0) return doc;
  if (arraysEqual(next, doc.activePalettes)) return doc;
  return { ...doc, activePalettes: next };
}

/**
 * Toggle a single palette in/out of the active set. Refuses to remove the
 * last active palette (returns input doc unchanged), preserving the
 * "non-empty" invariant in one place.
 */
export function togglePalette(doc: MapDoc, id: PaletteId, custom: readonly Palette[] = []): MapDoc {
  const present = doc.activePalettes.includes(id);
  const next = present ? doc.activePalettes.filter((x) => x !== id) : [...doc.activePalettes, id];
  return setActivePalettes(doc, next, custom);
}

/**
 * Set the global branch-seam inner-edge mode (see MapDoc.seamEdges). Returns
 * the input doc unchanged when the value is unchanged (so undo doesn't record a
 * no-op).
 */
export function setSeamEdges(doc: MapDoc, seamEdges: SeamEdges): MapDoc {
  if (doc.seamEdges === seamEdges) return doc;
  return { ...doc, seamEdges };
}

export function clearAll(_doc: MapDoc): MapDoc {
  // DEFAULT_DOC already supplies empty lineTags (and every other collection);
  // no field needs special re-zeroing here.
  return { ...DEFAULT_DOC };
}

// ---------- Line tags ----------

export function addLineTag(
  doc: MapDoc,
  id: string,
  lineId: LineId,
  fromStationId: StationId,
  toStationId: StationId,
  anchorEnd: 'from' | 'to',
  distance: number,
  orientation: 0 | 1 | 2 | 3,
): MapDoc {
  const tag: LineTag = {
    id,
    lineId,
    fromStationId,
    toStationId,
    anchorEnd,
    distance,
    orientation,
  };
  return { ...doc, lineTags: { ...doc.lineTags, [id]: tag } };
}

export function moveLineTag(
  doc: MapDoc,
  id: string,
  fromStationId: StationId,
  toStationId: StationId,
  anchorEnd: 'from' | 'to',
  distance: number,
): MapDoc {
  return updateRecord(doc, 'lineTags', id, (cur) => ({
    ...cur,
    fromStationId,
    toStationId,
    anchorEnd,
    distance,
  }));
}

// Six-state right-click cycle: text up → right → down → left →
// chevron-forward → chevron-reverse → back to text up. Chevrons only use
// orientations 0 (line-forward) and 2 (line-reverse).
export function cycleLineTagOrientation(doc: MapDoc, id: string): MapDoc {
  return updateRecord(doc, 'lineTags', id, (cur) => {
    const kind = cur.kind ?? 'text';
    let next: Pick<LineTag, 'kind' | 'orientation'>;
    if (kind === 'text') {
      next =
        cur.orientation < 3
          ? { kind: 'text', orientation: ((cur.orientation + 1) % 4) as 0 | 1 | 2 | 3 }
          : { kind: 'chevron', orientation: 0 };
    } else {
      next =
        cur.orientation === 0
          ? { kind: 'chevron', orientation: 2 }
          : { kind: 'text', orientation: 0 };
    }
    return { ...cur, ...next };
  });
}

export function deleteLineTag(doc: MapDoc, id: string): MapDoc {
  if (!doc.lineTags[id]) return doc;
  const { [id]: _gone, ...rest } = doc.lineTags;
  return { ...doc, lineTags: rest };
}

// ---------- Route bullets ----------

// Half-extent in world units (radius for circle, half-side for square/diamond).
export const ROUTE_BULLET_SIZE_MIN = 6;
export const ROUTE_BULLET_SIZE_MAX = 48;
export const ROUTE_BULLET_SIZE_DEFAULT = 14;

// Clamps at the bottom only; the spinbutton accepts sizes beyond the slider's
// range (ROUTE_BULLET_SIZE_MAX constrains the slider, not the value).
export function clampRouteBulletSize(n: number): number {
  return Math.max(ROUTE_BULLET_SIZE_MIN, Math.round(n));
}

export function addRouteBullet(
  doc: MapDoc,
  id: string,
  x: number,
  y: number,
  lineId: LineId | null,
): MapDoc {
  const bullet: RouteBullet = {
    id,
    x,
    y,
    rotation: 0,
    lineId,
    shape: 'circle',
    size: ROUTE_BULLET_SIZE_DEFAULT,
  };
  return { ...doc, routeBullets: { ...doc.routeBullets, [id]: bullet } };
}

// Insert a fully-specified bullet (used by duplicate + paste).
export function addRouteBulletWith(
  doc: MapDoc,
  id: string,
  fields: Omit<RouteBullet, 'id'>,
): MapDoc {
  const bullet = sanitizeIncomingStyleId(doc, 'routeBullet', { id, ...fields });
  return { ...doc, routeBullets: { ...doc.routeBullets, [id]: bullet } };
}

export function moveRouteBullet(doc: MapDoc, id: string, x: number, y: number): MapDoc {
  return updateRecord(doc, 'routeBullets', id, (cur) => ({ ...cur, x, y }));
}

export function rotateRouteBullet(doc: MapDoc, id: string): MapDoc {
  return updateRecord(doc, 'routeBullets', id, (cur) => ({
    ...cur,
    rotation: ((cur.rotation + 1) % 8) as Rotation,
  }));
}

export function updateRouteBullet(
  doc: MapDoc,
  id: string,
  patch: Partial<Pick<RouteBullet, 'lineId' | 'shape' | 'size' | 'locked'>>,
): MapDoc {
  return updateRecord(doc, 'routeBullets', id, (cur) => {
    // Clamp size so callers (slider, spinbutton, paste, duplicate) can't push
    // it out of band. Mirrors updatePolygon's clamps.
    const nextPatch =
      typeof patch.size === 'number' ? { ...patch, size: clampRouteBulletSize(patch.size) } : patch;
    const next = { ...cur, ...nextPatch };
    // Covered style fields are shape + size (NOT lineId/locked); a real change
    // to either detaches the bullet from its style preset.
    return next.shape !== cur.shape || next.size !== cur.size ? stripStyleId(next) : next;
  });
}

export function deleteRouteBullet(doc: MapDoc, id: string): MapDoc {
  if (!doc.routeBullets[id]) return doc;
  const { [id]: _gone, ...rest } = doc.routeBullets;
  return { ...doc, routeBullets: rest };
}

// ---------- Text labels ----------

export function addTextLabel(doc: MapDoc, id: string, x: number, y: number): MapDoc {
  const label: TextLabel = { id, x, y, ...TEXT_LABEL_DEFAULTS };
  return { ...doc, textLabels: { ...doc.textLabels, [id]: label } };
}

// Insert a fully-specified label (used by duplicate + paste).
export function addTextLabelWith(doc: MapDoc, id: string, fields: Omit<TextLabel, 'id'>): MapDoc {
  const label = sanitizeIncomingStyleId(doc, 'textLabel', { id, ...fields });
  return { ...doc, textLabels: { ...doc.textLabels, [id]: label } };
}

export function moveTextLabel(doc: MapDoc, id: string, x: number, y: number): MapDoc {
  return updateRecord(doc, 'textLabels', id, (cur) => ({ ...cur, x, y }));
}

export function rotateTextLabel(doc: MapDoc, id: string): MapDoc {
  return updateRecord(doc, 'textLabels', id, (cur) => ({
    ...cur,
    rotation: ((cur.rotation + 1) % 8) as Rotation,
  }));
}

export function updateTextLabel(
  doc: MapDoc,
  id: string,
  patch: Partial<Omit<TextLabel, 'id'>>,
): MapDoc {
  return updateRecord(doc, 'textLabels', id, (cur) => {
    // Clamp font size at the bottom only so callers (slider, spinbutton,
    // paste) can't push it to 0/negative; the spinbutton accepts sizes beyond
    // the slider's range. Snaps to the FONT_SIZE_STEP (0.25) grid. Mirrors
    // `canonicalStationLabelStyle`'s fontSize clamp.
    let nextPatch = patch;
    if (typeof patch.fontSize === 'number') {
      const clamped = Math.max(
        TEXT_LABEL_FONT_SIZE_MIN,
        Math.round(patch.fontSize / FONT_SIZE_STEP) * FONT_SIZE_STEP,
      );
      nextPatch = { ...nextPatch, fontSize: clamped };
    }
    // Clamp the column width to a non-negative integer (0 = Auto). Callers
    // (slider, spinbutton, paste) can't push it negative or fractional.
    if (typeof patch.width === 'number') {
      nextPatch = { ...nextPatch, width: Math.max(0, Math.round(patch.width)) };
    }
    // Clamp the editor-box height to a positive integer. It's a stored px
    // dimension for the popover textarea, never below one pixel.
    if (typeof patch.editorHeight === 'number') {
      nextPatch = { ...nextPatch, editorHeight: Math.max(1, Math.round(patch.editorHeight)) };
    }
    // Leading/tracking snap to their slider steps and clamp at the bottom only,
    // mirroring fontSize. Shared with the global station-label setters.
    if (typeof patch.leading === 'number') {
      nextPatch = {
        ...nextPatch,
        leading: snapToStep(patch.leading, TEXT_LABEL_LEADING_STEP, TEXT_LABEL_LEADING_MIN),
      };
    }
    if (typeof patch.tracking === 'number') {
      nextPatch = {
        ...nextPatch,
        tracking: snapToStep(patch.tracking, TEXT_LABEL_TRACKING_STEP, TEXT_LABEL_TRACKING_MIN),
      };
    }
    let next = { ...cur, ...nextPatch };
    // Re-anchor whenever a resize-affecting property changes — text content,
    // font size, weight, italic, or the column width (which changes both the
    // box width and, via re-wrapping, the height). The label's (x, y) is the
    // bbox CENTER, so without this the box would grow symmetrically out of the
    // center and drift on every edit. Skipped when the caller explicitly sets x
    // or y (e.g. a drag): then the move is intentional.
    const resizes =
      nextPatch.text !== undefined ||
      nextPatch.fontSize !== undefined ||
      nextPatch.weight !== undefined ||
      nextPatch.italic !== undefined ||
      nextPatch.width !== undefined ||
      nextPatch.leading !== undefined ||
      nextPatch.tracking !== undefined;
    const movedExplicitly = nextPatch.x !== undefined || nextPatch.y !== undefined;
    if (resizes && !movedExplicitly) {
      const before = measureTextLabel(cur);
      const after = measureTextLabel(next);
      const dW = after.width - before.width;
      // Pin the edge that horizontal alignment keys off, so a width change grows
      // the box away from that edge rather than recentering it. Otherwise editing
      // one line of a multiline label drags its siblings sideways (each line is
      // placed relative to that same edge). Left → left edge (+dW/2); right →
      // right edge (-dW/2); center → the center stays put (no x shift).
      // Vertically the block is always top-anchored, so pin the top edge.
      const dx = next.align === 'center' ? 0 : next.align === 'right' ? -dW / 2 : dW / 2;
      next = {
        ...next,
        x: cur.x + dx,
        y: cur.y + (after.height - before.height) / 2,
      };
    }
    // Detach from the style preset when a covered style field ACTUALLY
    // changes. Width/leading/tracking are per-label layout tuning, not style
    // — like content, position, lock and editorHeight they never detach.
    const coveredChanged =
      next.color !== cur.color ||
      next.darkColor !== cur.darkColor ||
      next.fontSize !== cur.fontSize ||
      next.weight !== cur.weight ||
      next.italic !== cur.italic ||
      next.align !== cur.align;
    return coveredChanged ? stripStyleId(next) : next;
  });
}

export function deleteTextLabel(doc: MapDoc, id: string): MapDoc {
  if (!doc.textLabels[id]) return doc;
  const { [id]: _gone, ...rest } = doc.textLabels;
  return { ...doc, textLabels: rest };
}

// Pick the text color for the active theme: the night color in dark mode, the
// day color otherwise. Mirrors `resolvePolygonColors`. Pure — exported for the
// renderer and unit tests.
export function resolveTextLabelColor(
  label: Pick<TextLabel, 'color' | 'darkColor'>,
  darkMode: boolean,
): string {
  return darkMode ? label.darkColor : label.color;
}

// ---------- Polygons ----------

export const POLYGON_STROKE_WIDTH_MIN = 0;
export const POLYGON_STROKE_WIDTH_MAX = 10;
export const POLYGON_STROKE_WIDTH_DEFAULT = 1;
// Stroke width steps in halves, like the line stroke-width control
// (LINE_STROKE_STEP). The slider/spinbutton/wheel all move by this.
export const POLYGON_STROKE_STEP = 0.5;
export const POLYGON_FILL_DEFAULT = '#cfe3f2';
export const POLYGON_STROKE_DEFAULT = '#000000';
// Corner-rounding radius in world units; missing ⇒ 0 (sharp corners).
export const POLYGON_CURVE_RADIUS_MIN = 0;
export const POLYGON_CURVE_RADIUS_MAX = 50;
export const POLYGON_CURVE_RADIUS_DEFAULT = 0;
// Half-side of the default square, in world units.
export const POLYGON_DEFAULT_HALF = 30;
// A polygon never drops below a triangle, so deleting a vertex is a no-op here.
export const POLYGON_MIN_VERTICES = 3;

// Stroke width snaps to the POLYGON_STROKE_STEP (0.5) grid and clamps at the
// bottom only; its spinbutton accepts values beyond the slider max
// (POLYGON_STROKE_WIDTH_MAX constrains the slider, not the value). Mirrors the
// line stroke-width control.
const clampPolygonStrokeWidth = (w: number): number =>
  Math.max(POLYGON_STROKE_WIDTH_MIN, Math.round(w / POLYGON_STROKE_STEP) * POLYGON_STROKE_STEP);
// Curve radius clamps at the bottom only (no rounding) — a free-form world-unit
// value whose spinbutton accepts values beyond the slider max.
const clampPolygonCurveRadius = (r: number): number => Math.max(POLYGON_CURVE_RADIUS_MIN, r);

// The default-square vertices centered on (x, y), clockwise from the top-left
// in the y-down screen frame. Shared by `addPolygon` and the placement ghost so
// the preview matches exactly what gets dropped.
export function starterPolygonVertices(x: number, y: number): Vec2[] {
  const h = POLYGON_DEFAULT_HALF;
  return [
    { x: x - h, y: y - h },
    { x: x + h, y: y - h },
    { x: x + h, y: y + h },
    { x: x - h, y: y + h },
  ];
}

// Default square centered on (x, y).
export function addPolygon(doc: MapDoc, id: string, x: number, y: number): MapDoc {
  const polygon: Polygon = {
    id,
    vertices: starterPolygonVertices(x, y),
    fill: POLYGON_FILL_DEFAULT,
    stroke: POLYGON_STROKE_DEFAULT,
    // Dark colors start equal to the light colors; independent once edited.
    darkFill: POLYGON_FILL_DEFAULT,
    darkStroke: POLYGON_STROKE_DEFAULT,
    strokeWidth: POLYGON_STROKE_WIDTH_DEFAULT,
  };
  return {
    ...doc,
    polygons: { ...doc.polygons, [id]: polygon },
    polygonOrder: [...doc.polygonOrder, id],
  };
}

// Insert a fully-specified polygon (used by duplicate + paste).
export function addPolygonWith(doc: MapDoc, id: string, fields: Omit<Polygon, 'id'>): MapDoc {
  const polygon = sanitizeIncomingStyleId(doc, 'polygon', { id, ...fields });
  return {
    ...doc,
    polygons: { ...doc.polygons, [id]: polygon },
    polygonOrder: [...doc.polygonOrder, id],
  };
}

// Absolute vertex setter — used by whole-polygon drag and group-tow, which
// recompute the full vertex list from the gesture's start snapshot each frame.
export function setPolygonVertices(doc: MapDoc, id: string, vertices: Vec2[]): MapDoc {
  return updateRecord(doc, 'polygons', id, (cur) => ({ ...cur, vertices }));
}

// Relative translation of the whole polygon. Polygons have no center anchor —
// their geometry is the vertex list in world coords — so the polygon analogue
// of moveStation/moveRouteBullet/moveTextLabel shifts every vertex by (dx, dy).
// (Whole-polygon drag uses setPolygonVertices instead, since it re-derives from
// a start snapshot each frame to avoid per-frame accumulation drift.)
export function movePolygon(doc: MapDoc, id: string, dx: number, dy: number): MapDoc {
  return updateRecord(doc, 'polygons', id, (cur) => ({
    ...cur,
    vertices: cur.vertices.map((v) => ({ x: v.x + dx, y: v.y + dy })),
  }));
}

// Relative translation of a SUBSET of vertices — the multi-vertex analogue of
// movePolygon (which shifts all of them). Used by the arrow-key nudge of a
// vertex selection; the drag path re-derives the full list via
// setPolygonVertices each frame to stay drift-free (see usePolygonDrag). A
// single-element `indices` is the old moveVertex, expressed relatively.
export function moveVertices(
  doc: MapDoc,
  id: string,
  indices: number[],
  dx: number,
  dy: number,
): MapDoc {
  const set = new Set(indices);
  return updateRecord(doc, 'polygons', id, (cur) => ({
    ...cur,
    vertices: cur.vertices.map((v, i) => (set.has(i) ? { x: v.x + dx, y: v.y + dy } : v)),
  }));
}

// Split the edge `edgeIndex -> (edgeIndex + 1) % n` by inserting its midpoint
// right after `edgeIndex` (wraps the last edge back to the first vertex).
export function insertVertex(doc: MapDoc, id: string, edgeIndex: number): MapDoc {
  return updateRecord(doc, 'polygons', id, (cur) => {
    const n = cur.vertices.length;
    if (edgeIndex < 0 || edgeIndex >= n) return cur;
    const mid = edgeMidpoint(cur.vertices, edgeIndex);
    const vertices = cur.vertices.slice();
    vertices.splice(edgeIndex + 1, 0, mid);
    return { ...cur, vertices };
  });
}

// Remove a set of vertices at once; refuses entirely (returns the same doc) if
// the removal would drop the polygon below the 3-vertex floor, so it never
// degenerates. Out-of-range and duplicate indices are ignored; an empty (or
// all-invalid) set is a no-op. A single-element `indices` is the old
// deleteVertex.
export function deleteVertices(doc: MapDoc, id: string, indices: number[]): MapDoc {
  return updateRecord(doc, 'polygons', id, (cur) => {
    const set = new Set(indices.filter((i) => i >= 0 && i < cur.vertices.length));
    if (set.size === 0) return cur;
    if (cur.vertices.length - set.size < POLYGON_MIN_VERTICES) return cur;
    return { ...cur, vertices: cur.vertices.filter((_, i) => !set.has(i)) };
  });
}

export function updatePolygon(doc: MapDoc, id: string, patch: PolygonStylePatch): MapDoc {
  return updateRecord(doc, 'polygons', id, (cur) => {
    let nextPatch = patch;
    if (typeof nextPatch.strokeWidth === 'number') {
      nextPatch = { ...nextPatch, strokeWidth: clampPolygonStrokeWidth(nextPatch.strokeWidth) };
    }
    if (typeof nextPatch.curveRadius === 'number') {
      nextPatch = { ...nextPatch, curveRadius: clampPolygonCurveRadius(nextPatch.curveRadius) };
    }
    const next = { ...cur, ...nextPatch };
    // Detach from the style preset when a covered style field ACTUALLY
    // changes (vertices/locked are not style). curveRadius/closed compare as
    // EFFECTIVE values (absent ⇒ 0 / true).
    const coveredChanged =
      next.fill !== cur.fill ||
      next.stroke !== cur.stroke ||
      next.darkFill !== cur.darkFill ||
      next.darkStroke !== cur.darkStroke ||
      next.strokeWidth !== cur.strokeWidth ||
      (next.curveRadius ?? 0) !== (cur.curveRadius ?? 0) ||
      (next.closed !== false) !== (cur.closed !== false);
    return coveredChanged ? stripStyleId(next) : next;
  });
}

// The effective fill/stroke for the active theme — the dark colors in dark
// mode, the light colors otherwise. Both are always concrete (initialized at
// creation, backfilled on load), so there is no fallback here.
export function resolvePolygonColors(
  polygon: Pick<Polygon, 'fill' | 'stroke' | 'darkFill' | 'darkStroke'>,
  darkMode: boolean,
): { fill: string; stroke: string } {
  return darkMode
    ? { fill: polygon.darkFill, stroke: polygon.darkStroke }
    : { fill: polygon.fill, stroke: polygon.stroke };
}

// Rotate every vertex 45° clockwise about the polygon's centroid.
export function rotatePolygon(doc: MapDoc, id: string): MapDoc {
  return updateRecord(doc, 'polygons', id, (cur) => {
    const c = polygonCentroid(cur.vertices);
    const vertices = cur.vertices.map((vert) => rotateAround(vert, c, ORBIT_STEP_RAD));
    return { ...cur, vertices };
  });
}

export function deletePolygon(doc: MapDoc, id: string): MapDoc {
  if (!doc.polygons[id]) return doc;
  const { [id]: _gone, ...rest } = doc.polygons;
  return { ...doc, polygons: rest, polygonOrder: doc.polygonOrder.filter((pid) => pid !== id) };
}

/**
 * The polygon ids in paint order: stored `polygonOrder` filtered to ones that
 * still exist, then any polygons missing from it appended (legacy saves, or a
 * race between add and order update) so nothing ever drops out. Later = on top.
 */
export function effectivePolygonOrder(
  polygons: Record<string, Polygon>,
  order: string[],
): string[] {
  return reconcileOrder(polygons, order);
}

// Shift a polygon one step toward the top (`dir: +1`) or bottom (`dir: -1`) of
// the polygon paint order. Reconciles legacy/partial order first so the swap is
// always well-defined. No-op at the respective end.
function movePolygonBy(doc: MapDoc, id: string, dir: 1 | -1): MapDoc {
  if (!doc.polygons[id]) return doc;
  const order = effectivePolygonOrder(doc.polygons, doc.polygonOrder);
  const next = moveInOrder(order, id, dir);
  if (next === order) return doc;
  return { ...doc, polygonOrder: next };
}

// Toward the top (rendered in front of the other polygons).
export function movePolygonUp(doc: MapDoc, id: string): MapDoc {
  return movePolygonBy(doc, id, 1);
}

// Toward the bottom (rendered behind the other polygons).
export function movePolygonDown(doc: MapDoc, id: string): MapDoc {
  return movePolygonBy(doc, id, -1);
}

// ---------- Svg images ----------

// Image opacity is an SVG-native 0..1 alpha (the popover slider trades in
// percent). Missing ⇒ SVG_IMAGE_OPACITY_DEFAULT = fully opaque. Size clamping
// lives in geometry/svgImage.ts because the resize gestures share it; opacity
// is presentation only, so it stays here.
export const SVG_IMAGE_OPACITY_MIN = 0;
export const SVG_IMAGE_OPACITY_MAX = 1;
export const SVG_IMAGE_OPACITY_DEFAULT = 1;

// Clamps at BOTH ends (unlike the polygon widths, whose spinbuttons run past
// the slider): an alpha outside 0..1 has no meaning to render.
const clampSvgImageOpacity = (o: number): number =>
  Math.min(SVG_IMAGE_OPACITY_MAX, Math.max(SVG_IMAGE_OPACITY_MIN, o));

// Insert a fully-specified imported svg image. Used by the placement drop and
// by duplicate/paste (the store actions supply all fields).
export function addSvgImage(doc: MapDoc, id: string, fields: Omit<SvgImage, 'id'>): MapDoc {
  const image: SvgImage = { id, ...fields };
  return {
    ...doc,
    svgImages: { ...doc.svgImages, [id]: image },
    svgImageOrder: [...doc.svgImageOrder, id],
  };
}

export function updateSvgImage(doc: MapDoc, id: string, patch: SvgImageStylePatch): MapDoc {
  return updateRecord(doc, 'svgImages', id, (cur) => {
    let next = patch;
    if (typeof next.width === 'number') next = { ...next, width: clampSvgImageSize(next.width) };
    if (typeof next.height === 'number') next = { ...next, height: clampSvgImageSize(next.height) };
    if (typeof next.rotation === 'number') {
      next = { ...next, rotation: normalizeRotation(next.rotation) };
    }
    if (typeof next.opacity === 'number') {
      next = { ...next, opacity: clampSvgImageOpacity(next.opacity) };
    }
    return { ...cur, ...next };
  });
}

// Absolute center setter — used by whole-image drag and group-tow, which
// recompute the center from the gesture's start snapshot each frame.
export function setSvgImageCenter(doc: MapDoc, id: string, x: number, y: number): MapDoc {
  return updateRecord(doc, 'svgImages', id, (cur) => ({ ...cur, x, y }));
}

export function deleteSvgImage(doc: MapDoc, id: string): MapDoc {
  if (!doc.svgImages[id]) return doc;
  const { [id]: _gone, ...rest } = doc.svgImages;
  return {
    ...doc,
    svgImages: rest,
    svgImageOrder: doc.svgImageOrder.filter((iid) => iid !== id),
  };
}

/**
 * The svg-image ids in paint order: stored `svgImageOrder` filtered to ones
 * that still exist, then any missing from it appended (legacy saves, races) so
 * nothing drops out. Later = on top. Mirrors `effectivePolygonOrder`.
 */
export function effectiveSvgImageOrder(
  svgImages: Record<string, SvgImage>,
  order: string[],
): string[] {
  return reconcileOrder(svgImages, order);
}

function moveSvgImageBy(doc: MapDoc, id: string, dir: 1 | -1): MapDoc {
  if (!doc.svgImages[id]) return doc;
  const order = effectiveSvgImageOrder(doc.svgImages, doc.svgImageOrder);
  const next = moveInOrder(order, id, dir);
  if (next === order) return doc;
  return { ...doc, svgImageOrder: next };
}

// Toward the top (rendered in front of the other images).
export function moveSvgImageUp(doc: MapDoc, id: string): MapDoc {
  return moveSvgImageBy(doc, id, 1);
}

// Toward the bottom (rendered behind the other images).
export function moveSvgImageDown(doc: MapDoc, id: string): MapDoc {
  return moveSvgImageBy(doc, id, -1);
}

// ---------- Transfers ----------

export function addTransfer(
  doc: MapDoc,
  id: string,
  a: { stationId: StationId; lineId: LineId | null },
  b: { stationId: StationId; lineId: LineId | null },
): MapDoc {
  // Same station + same lineId is a self-transfer (zero-length); reject.
  // Same station + DIFFERENT lineIds is fine — a short transfer between
  // two dots of an interlined station is a valid use case.
  if (a.stationId === b.stationId && a.lineId === b.lineId) return doc;
  if (!doc.stations[a.stationId] || !doc.stations[b.stationId]) return doc;
  const transfer: Transfer = {
    id,
    a: { stationId: a.stationId, lineId: a.lineId },
    b: { stationId: b.stationId, lineId: b.lineId },
  };
  return { ...doc, transfers: { ...doc.transfers, [id]: transfer } };
}

export function deleteTransfer(doc: MapDoc, id: string): MapDoc {
  if (!doc.transfers[id]) return doc;
  const { [id]: _gone, ...rest } = doc.transfers;
  return { ...doc, transfers: rest };
}

// Write one canonicalized style override onto a transfer: `undefined` (the
// "track the doc setting" sentinel) deletes the field, a concrete value sets
// it. Returns the same reference when nothing changes. Exported for
// serialize's `sanitizeTransferStyles`, which normalizes hand-edited files
// to the same stored form.
export function withTransferOverride<
  K extends 'thickness' | 'color' | 'strokeWidth' | 'strokeColor',
>(t: Transfer, field: K, stored: Transfer[K]): Transfer {
  if (t[field] === stored) return t;
  if (stored === undefined) {
    // Spread + delete rather than a destructuring omit: TS can't prove
    // `Omit<Transfer, K>` keeps the required fields for a generic K.
    const rest = { ...t };
    delete rest[field];
    return rest;
  }
  return { ...t, [field]: stored };
}

/**
 * Patch a transfer's per-transfer style overrides. Each provided field is
 * canonicalized against the constant transfer default: numeric values are
 * rounded and floor-clamped, and a value equal to the default drops the
 * field so it is never stored (same contract as `setDotStyle` /
 * `setDotSize`). Non-finite numeric fields are ignored. Reference-equal
 * no-ops keep textbox keystrokes out of the undo history.
 */
export function updateTransferStyle(doc: MapDoc, id: string, patch: TransferStylePatch): MapDoc {
  const cur = doc.transfers[id];
  if (!cur) return doc;
  let next = cur;
  if (patch.thickness !== undefined && Number.isFinite(patch.thickness)) {
    const stored = canonicalTransferThickness(patch.thickness, TRANSFER_THICKNESS_DEFAULT);
    next = withTransferOverride(next, 'thickness', stored);
  }
  if (patch.color !== undefined) {
    next = withTransferOverride(
      next,
      'color',
      canonicalTransferColor(patch.color, TRANSFER_COLOR_DEFAULT),
    );
  }
  if (patch.strokeWidth !== undefined && Number.isFinite(patch.strokeWidth)) {
    const stored = canonicalTransferStrokeWidth(patch.strokeWidth, TRANSFER_STROKE_WIDTH_DEFAULT);
    next = withTransferOverride(next, 'strokeWidth', stored);
  }
  if (patch.strokeColor !== undefined) {
    const stored = canonicalTransferColor(patch.strokeColor, TRANSFER_STROKE_COLOR_DEFAULT);
    next = withTransferOverride(next, 'strokeColor', stored);
  }
  if (next === cur) return doc;
  // Any override actually changed → detach from the style preset (all four
  // fields are covered).
  return { ...doc, transfers: { ...doc.transfers, [id]: stripStyleId(next) } };
}

/**
 * Drop any line tag whose corridor (fromStationId, toStationId) is no longer
 * a connected edge on the tag's line. Called after structural edits that
 * could orphan a tag — deleting a station, removing one from a line, etc.
 */
function pruneOrphanLineTags(doc: MapDoc): MapDoc {
  const next: Record<string, LineTag> = {};
  let changed = false;
  for (const tid of Object.keys(doc.lineTags)) {
    const tag = doc.lineTags[tid];
    const ln = doc.lines[tag.lineId];
    if (!ln || !isLineEdge(ln, tag.fromStationId, tag.toStationId)) {
      changed = true;
      continue;
    }
    next[tid] = tag;
  }
  return changed ? { ...doc, lineTags: next } : doc;
}

// Drop entries from `line.segmentStyles` whose pair-key no longer corresponds
// to a station-pair adjacency on this line. Returns the input line unchanged
// if the map is missing/empty or every key still maps to a real edge.
function pruneOrphanSegmentStyles(line: Line): Line {
  const styles = line.segmentStyles;
  if (!styles) return line;
  // Valid keys are exactly this line's edges — the topology source of truth.
  const validKeys = new Set<string>(line.edges);
  const filtered: Record<string, LineStyle> = {};
  let changed = false;
  for (const key of Object.keys(styles)) {
    if (validKeys.has(key)) filtered[key] = styles[key];
    else changed = true;
  }
  return changed ? { ...line, segmentStyles: filtered } : line;
}

function isLineEdge(line: Line, a: StationId, b: StationId): boolean {
  return lineHasEdge(line, a, b);
}

// ---------- Default styles + the default document ----------
// Both live at the bottom of the file so their initializers can reference the
// per-kind default constants declared in the sections above (module consts
// aren't hoisted).

// The five built-in "Default" style presets — one per styleable kind, each
// initialized to that kind's factory look (field order matches serialize's
// sanitizeStyleProps rebuild so file round-trips are stringify-stable). Fresh
// docs, and pre-styles saves via the DEFAULT_DOC merge, start with exactly
// these; they are ordinary styles thereafter: editable in the Styles panel,
// renamable, deletable. New items are stamped with their kind's style NAMED
// "Default" on creation (applyDefaultStyle in model/styles.ts, composed into
// the store's add actions), so redefining Default changes what new items
// look like.
export const DEFAULT_STYLES: Record<string, StyleDef> = {
  'default-line': {
    id: 'default-line',
    name: 'Default',
    kind: 'line',
    props: {
      defaultDotStyle: DEFAULT_DOT_STYLE,
      defaultDotSize: DOT_SIZE_DEFAULT,
      width: LINE_WIDTH_DEFAULT,
      curveRadius: LINE_CURVE_RADIUS_DEFAULT,
      strokeWidth: LINE_STROKE_WIDTH_DEFAULT,
      strokeColor: LINE_STROKE_COLOR_DEFAULT,
    },
  },
  'default-textLabel': {
    id: 'default-textLabel',
    name: 'Default',
    kind: 'textLabel',
    props: {
      color: TEXT_LABEL_DEFAULTS.color,
      darkColor: TEXT_LABEL_DEFAULTS.darkColor,
      fontSize: TEXT_LABEL_DEFAULTS.fontSize,
      weight: TEXT_LABEL_DEFAULTS.weight,
      italic: TEXT_LABEL_DEFAULTS.italic,
      align: TEXT_LABEL_DEFAULTS.align,
    },
  },
  'default-polygon': {
    id: 'default-polygon',
    name: 'Default',
    kind: 'polygon',
    props: {
      fill: POLYGON_FILL_DEFAULT,
      stroke: POLYGON_STROKE_DEFAULT,
      darkFill: POLYGON_FILL_DEFAULT,
      darkStroke: POLYGON_STROKE_DEFAULT,
      strokeWidth: POLYGON_STROKE_WIDTH_DEFAULT,
      curveRadius: POLYGON_CURVE_RADIUS_DEFAULT,
      closed: true,
    },
  },
  'default-routeBullet': {
    id: 'default-routeBullet',
    name: 'Default',
    kind: 'routeBullet',
    props: { shape: 'circle', size: ROUTE_BULLET_SIZE_DEFAULT },
  },
  'default-transfer': {
    id: 'default-transfer',
    name: 'Default',
    kind: 'transfer',
    props: {
      thickness: TRANSFER_THICKNESS_DEFAULT,
      color: TRANSFER_COLOR_DEFAULT,
      strokeWidth: TRANSFER_STROKE_WIDTH_DEFAULT,
      strokeColor: TRANSFER_STROKE_COLOR_DEFAULT,
    },
  },
  'default-station': {
    id: 'default-station',
    name: 'Default',
    kind: 'station',
    props: STATION_LABEL_STYLE_DEFAULTS,
  },
};

// The factory per-kind default designations — each kind's shipped style is
// its default until the user re-assigns one (setDefaultStyle). Frozen shape:
// exactly one entry per StyleKind, always.
export const FACTORY_STYLE_DEFAULTS: Record<StyleKind, string> = {
  line: 'default-line',
  textLabel: 'default-textLabel',
  polygon: 'default-polygon',
  routeBullet: 'default-routeBullet',
  transfer: 'default-transfer',
  station: 'default-station',
};

export const DEFAULT_DOC: MapDoc = {
  name: MAP_NAME_DEFAULT,
  stations: {},
  lines: {},
  lineOrder: [],
  lineCounter: 0,
  lineTags: {},
  routeBullets: {},
  transfers: {},
  textLabels: {},
  polygons: {},
  polygonOrder: [],
  regionAssignments: {},
  svgImages: {},
  svgImageOrder: [],
  styles: DEFAULT_STYLES,
  styleDefaults: FACTORY_STYLE_DEFAULTS,
  activePalettes: ['mta'],
  seamEdges: 'both',
};
