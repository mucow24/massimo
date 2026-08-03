import { autoOrientNewStation, uprightTangentRotation } from './autoOrient';
import { LINE_CIRCLE_RADIUS_DEFAULT, canonicalLineCircleRadius } from './lineCircle';
import {
  circleAngleAt,
  pointAtAngle,
  projectToCircle,
  stationCircle,
  tangentAtAngle,
  type CircleSpec,
} from '../geometry/lineCircle';
import {
  endStationId,
  isAnchorEnd,
  isStopEnd,
  stationAnchorCell,
  transferEndResolves,
} from './transferAnchors';
import { effectiveLineOrder } from './lineOrder';
import { reconcileOrder, moveInOrder, moveToEndInOrder } from './recordOrder';
import {
  LINE_INTERLINE_GAP_DEFAULT,
  LINE_WIDTH_DEFAULT,
  canonicalLineLabelGap,
  canonicalLineWidth,
  lineInterlineGapOf,
  lineWidthOf,
} from './lineWidth';
import { LINE_CURVE_RADIUS_DEFAULT, canonicalLineCurveRadius } from './lineCurve';
import { LINE_END_STYLE_DEFAULT, lineEndStyleOf, withStationEndStyles } from './lineEnd';
import { repackStationForSpacing } from './stationPacking';
import { DOT_SIZE_DEFAULT, canonicalDotSize } from './dotSize';
import {
  LINE_SEAM_EDGES_DEFAULT,
  LINE_STROKE_COLOR_DEFAULT,
  LINE_STROKE_WIDTH_DEFAULT,
  canonicalStrokeColor,
  canonicalSeamColor,
  canonicalSeamEdges,
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
import {
  DEFAULT_DOT_STYLE,
  DEFAULT_STOP_DOT_STYLE_ID,
  STOP_DOT_SEED_STYLES,
  defaultDotDiameter,
  dotStylesEqual,
  isBlankDotStyle,
  resolveDotStyle,
} from './dotStyle';

// `resolveDotStyle` now lives in the leaf `dotStyle` module (so `dotSize` can
// resolve the style-aware default without an import cycle); keep the historical
// import path working for its existing callers.
export { resolveDotStyle } from './dotStyle';
// `snapToStep` is a leaf grid util (in util/grid) so lower-level model modules
// like `dotStyle` can share it without importing `transforms`; keep the
// historical import path working for its existing callers.
import { clamp, roundClamp, snapToStep } from '../util/grid';
export { snapToStep };
import { pairKeyOf } from './pairKey';
import {
  addEdge,
  degreeOf,
  edgeNeighbors,
  edgesWithout,
  isLineTerminus,
  lineHasEdge,
  removeEdge,
  shortestPathOnLine,
} from './lineTopology';
import {
  BAND_MERGE_TOL,
  STOP_SIZE,
  nz,
  radialLocalTurn,
  rotateBy,
  stationCellToWorld,
  stationDirToLocal,
  stopCenterAt,
  tangentGap,
} from '../geometry/orientation';
import { CELL_EPS, sameCell } from '../geometry/lattice';
import { GRID_INTERVAL, snapPointToGrid, type GridSnap } from '../geometry/snap';
import { polygonCentroid, edgeMidpoint } from '../geometry/polygon';
import { clampSize as clampSvgImageSize, normalizeRotation } from '../geometry/svgImage';
import { measureTextLabel } from '../geometry/textMeasure';
import { isBulletCode } from '../geometry/labelTokens';
import type { LabelStyle } from '../geometry/labelLayout';
import { add, dot, eq, leftNormal, len, norm, rotateAround, sub, type Vec2 } from '../geometry/vec';
import { copyPalette, PALETTES, type Palette } from './palettes';
import type {
  AutoHAlign,
  AutoVAlign,
  DotStyle,
  LabelAlign,
  LabelCell,
  LabelValign,
  Line,
  LineCircle,
  LineEndStyle,
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
  const next = clamp(i + delta, 0, LABEL_WEIGHT_VALUES.length - 1);
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
    fontSize: snapToStep(props.fontSize, FONT_SIZE_STEP, LABEL_FONT_SIZE_MIN),
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
  | 'transferAnchors'
  | 'transfers'
  | 'lineCircles';

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
 *
 * The label defaults to auto placement (the magic wand on) with the H/V
 * tuning on auto, so a fresh label lays itself out transit-map style. The
 * stored `align`/`valign` are the overridden fallbacks a user gets if they
 * turn the wand off.
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
      autoAlign: true,
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

/**
 * Where a station BOUND to `circle` sits when aimed at `at`: projected onto the
 * circumference, rotated to the tangent octant there, with the label kept
 * right-side-up. THE one statement of "on the ring" as a station pose — binding
 * and moving a bound station both go through it, so the seat a bind produces
 * and the seat a drag produces can never disagree. (Circle move/resize preserve
 * the polar angle by construction and so reproject without re-deriving it.)
 *
 * `theta` IS the un-flipped seat's ring frame: `stationFrameRad` takes the
 * quarter-turn of the radial nearest the octant, and with the octant sitting on
 * the tangent that is the radial itself. So it goes to `uprightTangentRotation`
 * as the angle the name will really be painted at — the flip is a typographic
 * judgement about painted glyphs, and the rounded octant is up to 22.5° away
 * from them.
 */
function circleSeat(
  circle: CircleSpec,
  at: Vec2,
  labelRotation: Rotation,
): { x: number; y: number; rotation: Rotation } {
  const theta = circleAngleAt(circle, at);
  const p = pointAtAngle(circle, theta);
  const t = tangentAtAngle(theta);
  return { x: p.x, y: p.y, rotation: uprightTangentRotation(t.x, t.y, labelRotation, theta) };
}

export function moveStation(doc: MapDoc, id: StationId, x: number, y: number): MapDoc {
  return updateStation(doc, id, (st) => {
    const circle = stationCircle(st, doc.lineCircles);
    if (!circle) return { ...st, x, y };
    // Bound stations move ALONG their circle. Detaching is the caller's move
    // (unbind first) — see the drag hysteresis in the interaction layer.
    return reseatCircleLayout(
      st,
      { ...st, ...circleSeat(circle, { x, y }, st.label.rotation) },
      circle,
    );
  });
}

/**
 * Keep a re-seated station's layout on the SAME SIDE of its ring.
 *
 * `circleSeat` turns `rotation` a full 180° when the label would otherwise read
 * upside-down, and the cell frame turns with it (see `radialLocalTurn`). Cells
 * are unchanged by that turn, so their radial meaning inverts underneath them:
 * a `col: 1` lane painted OUTSIDE the ring lands inside it the moment a drag
 * crosses an uprightness boundary. Every stop of that station jumps a lane
 * across the rim, which reads as the arc breaking (its far end is still on the
 * old radius, so the concentric-arc gate rejects the pair) — the label flip is
 * supposed to be about type, not geometry.
 *
 * Negating the cells restores exactly what the turn took: stops, hosted anchors
 * and the label cell all keep their world positions, while `rotation` keeps the
 * seat's choice — so the NAME still flips right-side-up, which is the one thing
 * the flip exists to do. `label.rotation` is deliberately untouched: the label's
 * world angle is `rotation + label.rotation`, so leaving it is what lets the
 * 180° land on the type. Stop orientations are axes, invariant under 180°.
 *
 * Only the exact REVERSAL is compensated. Between two seats that is the only
 * difference reachable — a seat puts local ±x on the radial, so the turn is 0 or
 * 2 and never a quarter — but `bindStationToCircle` also arrives here from a
 * FREE station, whose rotation is under no such constraint. A quarter turn there
 * is a genuine reorientation onto the ring, and the layout is meant to ride it:
 * that is what lands a station's lanes concentric the moment it binds.
 */
function reseatCircleLayout(before: Station, after: Station, circle: CircleSpec): Station {
  const turn = radialLocalTurn(after, circle) - radialLocalTurn(before, circle);
  if (((turn % 4) + 4) % 4 !== 2) return after;
  const flip = <T extends { row: number; col: number }>(cell: T): T => ({
    ...cell,
    row: nz(-cell.row),
    col: nz(-cell.col),
  });
  return {
    ...after,
    stops: after.stops.map(flip),
    label: flip(after.label),
    ...(after.transferAnchors ? { transferAnchors: after.transferAnchors.map(flip) } : {}),
  };
}

/**
 * A station is a "singleton" for dot-styling when exactly one stop VISIBLY
 * occupies it — i.e. picks the line's singleton default rather than its
 * interchange default. A stop whose EXPLICIT `dotStyle` override is blank
 * (renders nothing) does NOT count: the express+local pattern draws both lines
 * through every station but blanks the express dot at stops it skips, and those
 * skipped stations should still read as singletons for the local line. Only
 * explicit overrides are inspected, never resolved defaults — resolving a
 * default-tracking stop's style would itself depend on this result, so counting
 * it would be circular. This is a per-STATION property (every non-blank stop
 * shares it), recomputed live so a station losing its other visible line
 * immediately adopts the singleton default. Zero visible stops is not a
 * singleton (nothing to style).
 */
export function stationIsSingleton(
  station: { stops: readonly { dotStyle?: DotStyle }[] } | undefined,
): boolean {
  const stops = station?.stops;
  if (!stops) return false;
  let visible = 0;
  for (const s of stops) {
    if (s.dotStyle !== undefined && isBlankDotStyle(s.dotStyle)) continue;
    if (++visible > 1) return false;
  }
  return visible === 1;
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

/**
 * Set a stop's per-stop dot override to a stopDot library style (by id):
 * stamp the style's props as the raw shadow the renderer reads AND tag the
 * stop with the style id (so editing the style restamps it). Picking the line's
 * effective default for the stop's case (singleton/shared) instead CLEARS the
 * override — both the raw value and the tag — so the stop tracks the line
 * default going forward and persisted state stays clean. Same
 * reference-on-no-op contract undo grouping relies on.
 */
export function setDotStyle(
  doc: MapDoc,
  stationId: StationId,
  lineId: LineId,
  styleId: string,
): MapDoc {
  const def = doc.styles[styleId];
  if (def?.kind !== 'stopDot') return doc;
  const props = def.props;
  const line = doc.lines[lineId];
  return updateStation(doc, stationId, (cur) => {
    // "Does this pick equal the line default?" — decided by VALUE against the
    // default the RENDERER resolves, matching how the line-default setters
    // prune redundant overrides. An id comparison against the factory constant
    // lies whenever the line's split default is an ORPHANED raw shadow (a
    // stopDot style deleted out from under it keeps the drawn value and drops
    // the tag): the line still paints, say, a diamond, but reads as untagged,
    // so picking "Filled black" would clear the override and leave the stop on
    // the diamond it was trying to leave.
    const lineDefault = resolveDotStyle(line, null, stationIsSingleton(cur));
    const clears = dotStylesEqual(props, lineDefault);
    let changed = false;
    const stops = cur.stops.map((s) => {
      if (s.lineId !== lineId) return s;
      if (clears) {
        if (s.dotStyle === undefined && s.dotStyleId === undefined) return s;
        changed = true;
        const { dotStyle: _a, dotStyleId: _b, ...rest } = s;
        return rest;
      }
      if (s.dotStyleId === styleId && s.dotStyle !== undefined && dotStylesEqual(s.dotStyle, props))
        return s;
      changed = true;
      return { ...s, dotStyle: props, dotStyleId: styleId };
    });
    return changed ? { ...cur, stops } : cur;
  });
}

/**
 * Drop every per-stop override of `field` on `lineId` that has become
 * redundant — `isRedundant(stop, station)` decides when a stop now equals the
 * line's new effective default. The station is passed so the predicate can gate
 * on the stop's singleton/shared case (a singleton-default edit only makes
 * overrides on singleton stops redundant, and vice versa). Shared by the four
 * "set line default" setters so the override-pruning rule — which keeps
 * persisted docs clean and makes those stops track the default going forward —
 * can never drift between dot-style and dot-size. Returns the same `stations`
 * reference when nothing was pruned.
 */
function dropRedundantStopOverrides(
  stations: Record<StationId, Station>,
  lineId: LineId,
  field: 'dotStyle' | 'dotSize',
  isRedundant: (stop: StopCell, station: Station) => boolean,
): Record<StationId, Station> {
  let out = stations;
  for (const sid of Object.keys(out)) {
    const st = out[sid];
    let stopsChanged = false;
    const stops = st.stops.map((s) => {
      if (s.lineId !== lineId || !isRedundant(s, st)) return s;
      stopsChanged = true;
      const { [field]: _gone, ...rest } = s;
      return rest;
    });
    if (stopsChanged) out = { ...out, [sid]: { ...st, stops } };
  }
  return out;
}

// Shared body of the two split default-dot-style setters (by stopDot style id).
// Stamps the referenced style's props as the raw shadow the renderer reads AND
// tags the line default with the style id. Unlike per-stop overrides, line
// defaults are ALWAYS stored (never dropped at the designated default): a
// default-tracking line must stay tagged so editing the referenced style
// restamps it. Dot TYPE IS a covered LINE-style field, so a real change here
// detaches the line's own style preset (stripStyleId) — the "tagged ⇒ matches"
// rule, same as every other covered setter; the value-identical early-out below
// keeps it. `wantSingleton` selects which stop case the redundant-override
// cascade prunes.
function setLineCaseDotStyle(
  doc: MapDoc,
  id: LineId,
  styleId: string,
  rawField: 'singletonDotStyle' | 'multiDotStyle',
  tagField: 'singletonDotStyleId' | 'multiDotStyleId',
  wantSingleton: boolean,
): MapDoc {
  const cur = doc.lines[id];
  if (!cur) return doc;
  const def = doc.styles[styleId];
  if (def?.kind !== 'stopDot') return doc;
  const props = def.props;
  // Value-identical early-out. An ABSENT raw shadow resolves as filled-black —
  // the same resolution the renderer uses (resolveDotStyle) — because the v19
  // library bake tagged legacy lines' split defaults WITHOUT materializing the
  // raw; re-picking such a line's current dot type must stay a no-op, not
  // detach it from its line style.
  const existingRaw = cur[rawField];
  if (cur[tagField] === styleId && dotStylesEqual(existingRaw ?? DEFAULT_DOT_STYLE, props)) {
    return doc;
  }
  // Real change (the value-identical case returned above) ⇒ detach the line's
  // own style preset, like every other covered-field setter.
  const nextLine: Line = stripStyleId({ ...cur, [rawField]: props, [tagField]: styleId });
  // A per-stop override on a stop of the MATCHING case (singleton vs. shared)
  // tagged with the SAME style now equals the new line default → drop it (both
  // raw + tag) so the stop tracks the default going forward. Overrides on the
  // OTHER case keep their pin.
  let stations = doc.stations;
  for (const sid of Object.keys(stations)) {
    const st = stations[sid];
    let stopsChanged = false;
    const stops = st.stops.map((s) => {
      if (s.lineId !== id || stationIsSingleton(st) !== wantSingleton || s.dotStyleId !== styleId)
        return s;
      stopsChanged = true;
      const { dotStyle: _a, dotStyleId: _b, ...rest } = s;
      return rest;
    });
    if (stopsChanged) stations = { ...stations, [sid]: { ...st, stops } };
  }
  return { ...doc, lines: { ...doc.lines, [id]: nextLine }, stations };
}

export function setLineSingletonDotStyle(doc: MapDoc, id: LineId, styleId: string): MapDoc {
  return setLineCaseDotStyle(doc, id, styleId, 'singletonDotStyle', 'singletonDotStyleId', true);
}

export function setLineMultiDotStyle(doc: MapDoc, id: LineId, styleId: string): MapDoc {
  return setLineCaseDotStyle(doc, id, styleId, 'multiDotStyle', 'multiDotStyleId', false);
}

/**
 * Stamp a line's split dot defaults with the doc's designated default stopDot
 * style — composed into the store's addLine so every new line (and its future
 * stops) starts on the current ⭐ default. Re-designating the default changes
 * what subsequent new lines get.
 */
export function applyDefaultStopDotToLine(doc: MapDoc, id: LineId): MapDoc {
  const styleId = doc.styleDefaults.stopDot;
  return setLineMultiDotStyle(setLineSingletonDotStyle(doc, id, styleId), id, styleId);
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
  const line = doc.lines[lineId];
  return updateStation(doc, stationId, (cur) => {
    // The default this stop tracks is its station's singleton or shared size;
    // setting exactly that clears the override, any other value pins. When the
    // line default is itself unset, the tracked size is the stop STYLE's own
    // default diameter (12 for a service-code disc, 8 otherwise) — NOT a flat
    // DOT_SIZE_DEFAULT, or an explicit 8 on a service-code dot would collapse
    // and snap to 12.
    const isSingleton = stationIsSingleton(cur);
    const stop = cur.stops.find((s) => s.lineId === lineId);
    const effDefault =
      (isSingleton ? line?.singletonDotSize : line?.multiDotSize) ??
      defaultDotDiameter(resolveDotStyle(line, stop, isSingleton));
    const stored = canonicalDotSize(size, effDefault);
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

// Shared body of the two split default-dot-size setters (DIAMETER in px). Same
// normalization grid as `setLineWidth` (non-finite ignored, rounded,
// floor-clamped, dropped at the default, reference-equal no-ops) PLUS the
// split-aware cascade: any per-stop override on a stop of the matching case
// (`wantSingleton`) equal to the NEW effective default is now redundant — drop
// it so those stops track the default going forward.
function setLineCaseDotSize(
  doc: MapDoc,
  id: LineId,
  size: number,
  field: 'singletonDotSize' | 'multiDotSize',
  wantSingleton: boolean,
): MapDoc {
  const cur = doc.lines[id];
  if (!cur || !Number.isFinite(size)) return doc;
  // Collapse to "tracking" only at the size this case's DEFAULT STYLE actually
  // renders when untracked (12 for a service-code disc, 8 otherwise) — an
  // explicit 8 on a service-code line is a real, distinct size, not the default.
  const defaultStyle =
    (wantSingleton ? cur.singletonDotStyle : cur.multiDotStyle) ?? DEFAULT_DOT_STYLE;
  const stored = canonicalDotSize(size, defaultDotDiameter(defaultStyle));
  if (cur[field] === stored) return doc;
  const nextLine = writeLineField(cur, field, stored);
  // A per-stop override is redundant when dropping it renders the same size.
  // With the line default now `stored` (a number), that means the override
  // equals `stored`. When `stored` collapsed to undefined, the stop would fall
  // back to ITS OWN style default, so compare against that per-stop diameter —
  // only on stops of the matching case; the other case keeps its pin.
  const stations = dropRedundantStopOverrides(
    doc.stations,
    id,
    'dotSize',
    (s, st) =>
      stationIsSingleton(st) === wantSingleton &&
      s.dotSize === (stored ?? defaultDotDiameter(resolveDotStyle(cur, s, wantSingleton))),
  );
  // Fall-through = the stored default-dot-size changed → detach from the
  // line's style preset.
  return { ...doc, lines: { ...doc.lines, [id]: stripStyleId(nextLine) }, stations };
}

export function setLineSingletonDotSize(doc: MapDoc, id: LineId, size: number): MapDoc {
  return setLineCaseDotSize(doc, id, size, 'singletonDotSize', true);
}

export function setLineMultiDotSize(doc: MapDoc, id: LineId, size: number): MapDoc {
  return setLineCaseDotSize(doc, id, size, 'multiDotSize', false);
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
// `setLineSingletonDotStyle`/`setLineMultiDotStyle` + DEFAULT_DOT_STYLE).
// Returns the input doc unchanged when the effective stored form wouldn't
// change — the slider fires this on every drag tick, and reference equality is
// what keeps no-op ticks out of the undo history.
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
  const gap = lineInterlineGapOf(cur);
  const stations = mapRecord(doc.stations, (st) =>
    repackStationForSpacing(
      st,
      doc.lines,
      id,
      lineWidthOf(cur),
      stored ?? LINE_WIDTH_DEFAULT,
      gap,
      gap,
    ),
  );
  // Fall-through = the stored width changed → detach from the style preset.
  return {
    ...doc,
    lines: { ...doc.lines, [id]: stripStyleId(writeLineField(cur, 'width', stored)) },
    stations,
  };
}

// Per-line interline gap: extra spacing against each interlined neighbor
// (the pair uses the LARGER of the two lines' gaps). Same storage contract
// as setLineStrokeWidth (quarter-unit grid, floor at 0, dropped at 0), but
// like `width` this is GEOMETRY: the packed stop spacing and the band merge
// gate include it, so a bare write would strand packed layouts and un-merge
// their bands. Each edit therefore also re-packs the packed stop chains at
// every station hosting this line (see stationPacking.ts), exactly like a
// width edit — one doc write, one undo entry.
export function setLineInterlineGap(doc: MapDoc, id: LineId, v: number): MapDoc {
  const cur = doc.lines[id];
  if (!cur || !Number.isFinite(v)) return doc;
  const stored = canonicalStrokeWidth(v);
  if (cur.interlineGap === stored) return doc;
  const width = lineWidthOf(cur);
  const stations = mapRecord(doc.stations, (st) =>
    repackStationForSpacing(
      st,
      doc.lines,
      id,
      width,
      width,
      lineInterlineGapOf(cur),
      stored ?? LINE_INTERLINE_GAP_DEFAULT,
    ),
  );
  // Fall-through = the stored gap changed → detach from the style preset.
  return {
    ...doc,
    lines: { ...doc.lines, [id]: stripStyleId(writeLineField(cur, 'interlineGap', stored)) },
    stations,
  };
}

// Per-line station-label clearance. Same storage contract as setLineWidth
// (quarter-unit grid, collapse at the DEFAULT — here 3, and 0 is a real
// stored value). Pure label placement: nothing packs or re-routes, so no
// repack and no region reconcile — the derived label layout follows the doc.
export function setLineLabelGap(doc: MapDoc, id: LineId, v: number): MapDoc {
  const cur = doc.lines[id];
  if (!cur || !Number.isFinite(v)) return doc;
  const stored = canonicalLineLabelGap(v);
  if (cur.labelGap === stored) return doc;
  // Fall-through = the stored gap changed → detach from the style preset.
  return {
    ...doc,
    lines: { ...doc.lines, [id]: stripStyleId(writeLineField(cur, 'labelGap', stored)) },
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

// Per-line END style — what the line's painted ends look like at every one of
// its termini (see model/lineEnd.ts). Same contract as the other plain style
// setters: the field is dropped at the default ('square', the historical full
// marker square) so it is never stored, and a real change detaches the line
// from its style preset. PRESENTATION for band geometry, but it moves the stop
// markers' painted FOOTPRINT, so store actions wrap this in withRegionReconcile
// like the geometry writers.
// Also canonicalizes the per-terminus pins against the NEW end, the way the four
// "set line default" dot setters prune per-stop overrides the new default just
// made redundant: a pin equal to the line's own end is not an override at all,
// and leaving one stored would make the doc render differently after a
// save/load round-trip, since the file loader drops it (see sanitizeLineEnds).
export function setLineEndStyle(doc: MapDoc, id: LineId, end: LineEndStyle): MapDoc {
  const next = setLineStyleField(
    doc,
    id,
    'endStyle',
    end === LINE_END_STYLE_DEFAULT ? undefined : end,
  );
  if (next === doc) return doc;
  const line = next.lines[id];
  const pins = line.stationEndStyles;
  if (!pins) return next;
  const kept: Record<StationId, LineEndStyle> = {};
  let changed = false;
  for (const stationId of Object.keys(pins)) {
    if (pins[stationId] === end) changed = true;
    else kept[stationId] = pins[stationId];
  }
  if (!changed) return next;
  return { ...next, lines: { ...next.lines, [id]: withStationEndStyles(line, kept) } };
}

/**
 * Pin ONE terminus's end style, overriding the line's own. Setting the line's
 * effective default clears the pin instead — so the station tracks the line
 * going forward and persisted state stays clean (the same contract
 * `setDotStyle` / `setDotSize` use for per-stop dot overrides).
 *
 * No-ops unless `stationId` is currently an END of the line: the override has no
 * meaning anywhere else, and admitting one would leave a key that the very next
 * topology change prunes. Not a covered style field, so unlike `setLineEndStyle`
 * this does NOT detach the line from its preset — a line style carries the
 * line's own end, never its per-station pins.
 */
export function setStationEndStyle(
  doc: MapDoc,
  lineId: LineId,
  stationId: StationId,
  end: LineEndStyle,
): MapDoc {
  const line = doc.lines[lineId];
  if (!line || !isLineTerminus(line, stationId)) return doc;
  const cur = line.stationEndStyles;
  const stored = end === lineEndStyleOf(line) ? undefined : end;
  if ((cur?.[stationId] ?? undefined) === stored) return doc;
  const next: Record<StationId, LineEndStyle> = { ...cur };
  if (stored === undefined) delete next[stationId];
  else next[stationId] = stored;
  return { ...doc, lines: { ...doc.lines, [lineId]: withStationEndStyles(line, next) } };
}

// Per-line casing width. Same contract as setLineWidth except the grid:
// non-finite input is ignored, the value is rounded to the nearest
// LINE_STROKE_STEP (0.25) and clamped to ≥ LINE_STROKE_WIDTH_MIN, and the
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

// Which arm of this line's branch notch gets painted (see model/lineStroke.ts).
// Same contract as the other plain style setters: the field is dropped at
// 'both' (the full notch) so the default is never stored, and a real change
// detaches the line from its preset. PRESENTATION — it only picks which of a
// band's seam edges draw, so no region reconcile is needed.
export function setLineSeamEdges(doc: MapDoc, id: LineId, v: SeamEdges): MapDoc {
  return setLineStyleField(doc, id, 'seamEdges', canonicalSeamEdges(v));
}

// Per-line tick length for 'dash' stops. Shares the casing width's canonical
// grid/floor and drop-at-0; an unset (dropped) value derives from the line
// width at render time (see dashSize.ts). A change detaches the line from
// its preset.
export function setLineDashLength(doc: MapDoc, id: LineId, v: number): MapDoc {
  if (!Number.isFinite(v)) return doc;
  return setLineStyleField(doc, id, 'dashLength', canonicalStrokeWidth(v));
}

// Per-line tick thickness for 'dash' stops. Same contract as setLineDashLength.
export function setLineDashWidth(doc: MapDoc, id: LineId, v: number): MapDoc {
  if (!Number.isFinite(v)) return doc;
  return setLineStyleField(doc, id, 'dashWidth', canonicalStrokeWidth(v));
}

export function setStationWaypoint(doc: MapDoc, stationId: StationId, isWaypoint: boolean): MapDoc {
  return updateStation(doc, stationId, (st) =>
    !!st.isWaypoint === isWaypoint ? st : { ...st, isWaypoint },
  );
}

// For every line that links both startId and endId, evenly redistribute the
// stops along that line's edge path between them — by arc length along the
// existing polyline through those stops. A loop takes its shorter arc, and
// stations on branches off the path are untouched. If a station is intervening
// on multiple matching lines (its new position would be ambiguous), it is left
// untouched.
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
    // The chain between the endpoints comes from the line's EDGE graph —
    // `stations` is a pure membership list whose order is creation order, not
    // track order, so an index slice can grab the wrong stations entirely and
    // leave the real intermediates stuck.
    const tail = shortestPathOnLine(line, startId, endId);
    if (!tail || tail.length < 2) continue; // not both members / unlinked / adjacent
    const ids = [startId, ...tail];
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
        const angle = Math.acos(clamp(cosA, -1, 1));
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
  type: 'station' | 'bullet' | 'label' | 'polygon' | 'svgImage' | 'anchor' | 'lineCircle';
  id: string;
}

/**
 * Exhaustiveness guard for {@link ItemRef} dispatch chains. Both chains in
 * `rotateItemsAround` (pivot resolution and the member loop) used to end in a
 * catch-all that assumed the last type — so widening `ItemRef` compiled cleanly
 * and wrote the new type into `textLabels` / `svgImages`. Routing the tail
 * through this instead makes that a compile error at both sites.
 */
function assertNeverItemType(t: never): never {
  throw new Error(`rotateItemsAround: unhandled item type ${String(t)}`);
}

/**
 * Rotate a mixed station/bullet/label/polygon/svgImage/anchor/lineCircle
 * selection 45° clockwise about the pivot. Non-pivot members orbit the pivot's
 * world position; each type also advances its own orientation:
 * stations/bullets/labels step their rotation field by one 45° index, svg images
 * add 45° to their continuous rotation, and polygons carry no rotation field
 * (orbiting every vertex about the pivot IS their rotation). A line circle is
 * the polygon case with passengers: the ring is rotationally symmetric, so
 * rotating it means orbiting its bound stations (see `rotateBoundStations`).
 * The pivot may be any of the seven types. Members whose ids are missing from
 * the doc are silently skipped — selection state can outlive a doc edit (undo).
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
  } else if (pivot.type === 'anchor') {
    const pv = doc.transferAnchors[pivot.id];
    if (!pv) return doc;
    px = pv.x;
    py = pv.y;
  } else if (pivot.type === 'lineCircle') {
    const pv = doc.lineCircles[pivot.id];
    if (!pv) return doc;
    px = pv.x;
    py = pv.y;
  } else {
    // Each remaining type named explicitly. The tail used to be a bare
    // `: doc.textLabels[pivot.id]`, so a new ItemRef type would have been looked
    // up in the text-label collection and silently pivoted about the wrong item
    // (or bailed, if the id happened not to resolve there).
    const pivotItem =
      pivot.type === 'station'
        ? doc.stations[pivot.id]
        : pivot.type === 'bullet'
          ? doc.routeBullets[pivot.id]
          : pivot.type === 'label'
            ? doc.textLabels[pivot.id]
            : assertNeverItemType(pivot.type);
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
  let transferAnchors = doc.transferAnchors;
  let lineCircles = doc.lineCircles;

  // Stations carried by a co-selected line circle: the lineCircle branch below
  // rotates them (keeping them ON their ring), so the station branch must leave
  // them alone. Without this a station that is BOTH a member and a ring
  // passenger would be rotated twice — 90° instead of 45°.
  const carriedByCircle = new Set<string>();
  for (const m of members) {
    if (m.type !== 'lineCircle') continue;
    for (const sid of Object.keys(doc.stations)) {
      if (doc.stations[sid].circleId === m.id) carriedByCircle.add(sid);
    }
  }

  for (const m of members) {
    const isPivot = m.type === pivot.type && m.id === pivot.id;
    if (m.type === 'station') {
      if (carriedByCircle.has(m.id)) continue;
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
    } else if (m.type === 'anchor') {
      // Position only. An anchor has no orientation to advance — it is the
      // polygon case (orbiting IS the rotation) collapsed to a single point,
      // which also makes an anchor-as-pivot a natural no-op via `isPivot`.
      const cur = transferAnchors[m.id];
      if (!cur) continue;
      const p = isPivot
        ? { x: cur.x, y: cur.y }
        : rotateAround({ x: cur.x, y: cur.y }, pivotPt, ORBIT_STEP_RAD);
      transferAnchors = { ...transferAnchors, [m.id]: { ...cur, x: p.x, y: p.y } };
    } else if (m.type === 'svgImage') {
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
    } else if (m.type === 'lineCircle') {
      // Line circle: orbit the center (held fixed when it IS the pivot) and
      // carry its bound stations through the SAME rotation, so ring and
      // passengers stay one rigid body. A circle-as-pivot is not a no-op like
      // an anchor's: the center holds still while the members swing round it.
      const cur = lineCircles[m.id];
      if (!cur) continue;
      const c = isPivot
        ? { x: cur.x, y: cur.y }
        : rotateAround({ x: cur.x, y: cur.y }, pivotPt, ORBIT_STEP_RAD);
      const moved = { ...cur, x: c.x, y: c.y };
      lineCircles = { ...lineCircles, [m.id]: moved };
      stations = rotateBoundStations(stations, moved, pivotPt) ?? stations;
    } else {
      assertNeverItemType(m.type);
    }
  }
  return {
    ...doc,
    stations,
    routeBullets,
    textLabels,
    polygons,
    svgImages,
    transferAnchors,
    lineCircles,
  };
}

/**
 * Flatten the selection id lists into the ItemRef[] that `rotateItemsAround`
 * consumes. Order is irrelevant to the rotation result. Everything past
 * `labelIds` is optional so call sites that never select those types can
 * omit them.
 */
export function buildRotateMembers(
  stationIds: string[],
  bulletIds: string[],
  labelIds: string[],
  polygonIds: string[] = [],
  svgImageIds: string[] = [],
  anchorIds: string[] = [],
  lineCircleIds: string[] = [],
): ItemRef[] {
  return [
    ...stationIds.map((id): ItemRef => ({ type: 'station', id })),
    ...bulletIds.map((id): ItemRef => ({ type: 'bullet', id })),
    ...labelIds.map((id): ItemRef => ({ type: 'label', id })),
    ...polygonIds.map((id): ItemRef => ({ type: 'polygon', id })),
    ...svgImageIds.map((id): ItemRef => ({ type: 'svgImage', id })),
    ...anchorIds.map((id): ItemRef => ({ type: 'anchor', id })),
    ...lineCircleIds.map((id): ItemRef => ({ type: 'lineCircle', id })),
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
  // Hosted transfer anchors turn with the layout. They are plain cells (no
  // orientation, no rotation of their own), so they only need the grid map —
  // but they DO need it: an anchor left behind while the stops rotated 90°
  // around it would tear apart the elbowed transfer bound to it. This is the
  // whole reason they live on the Station rather than in a doc-level record.
  const transferAnchors = station.transferAnchors?.map((a) => {
    const r = rotateGrid(a.col, a.row);
    return { ...a, col: r.col, row: r.row };
  });
  return {
    ...station,
    rotation: nextRot,
    stops,
    label,
    ...(transferAnchors ? { transferAnchors } : {}),
  };
}

export function rotateStationAndLayout(doc: MapDoc, id: StationId, dir: -1 | 1): MapDoc {
  const cur = doc.stations[id];
  if (!cur) return doc;
  return {
    ...doc,
    stations: { ...doc.stations, [id]: rotateStationLayoutBy90(cur, dir) },
  };
}

// Drop every transfer with an endpoint the caller is removing. `orphaned`
// decides whether an endpoint now points at something that no longer exists —
// matched by (stationId, lineId) for a single stop, by lineId for a whole line,
// by stationId for a whole station (which orphans its hosted anchors too), or
// by anchorId for a single anchor.
//
// Returns the SAME record reference when nothing was pruned. Change detection is
// per-DOC_FIELDS reference equality (docSnapshotsEqual), and the anchor deletes
// call this on every removal — allocating unconditionally would mark `transfers`
// dirty for an anchor that never had one.
function pruneTransfers(
  transfers: Record<string, Transfer>,
  orphaned: (end: TransferEnd) => boolean,
): Record<string, Transfer> {
  const next: Record<string, Transfer> = {};
  let pruned = false;
  for (const xid of Object.keys(transfers)) {
    const t = transfers[xid];
    if (!orphaned(t.a) && !orphaned(t.b)) next[xid] = t;
    else pruned = true;
  }
  return pruned ? next : transfers;
}

export function deleteStation(doc: MapDoc, id: StationId): MapDoc {
  const { [id]: _gone, ...rest } = doc.stations;
  const lines: Record<LineId, Line> = {};
  for (const lid of Object.keys(doc.lines)) {
    const ln = doc.lines[lid];
    // Drop the station from the line (healing a degree-2 gap so the line stays
    // connected), then prune any segment style/layer override whose pair-key is
    // no longer an edge — same contract as removeStationFromLine / deleteLine.
    lines[lid] = pruneOrphanLineOverrides({
      ...ln,
      stations: ln.stations.filter((x) => x !== id),
      edges: edgesAfterRemoveStation(ln.edges, id),
    });
  }
  // Cascade-delete transfers that referenced the removed station.
  // One predicate covers both station-keyed end shapes: the station's stops AND
  // the transfer anchors hosted in its cell grid (which go with the station).
  const transfers = pruneTransfers(doc.transfers, (e) => endStationId(e) === id);
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

/**
 * Can this stop's direction cycle offer the CIRCLE state? True when the
 * station is bound to a line circle AND at least one of the line's neighbors
 * at this station sits on the same circle — i.e. opting in could actually
 * form a circular connection. Deliberately reads the neighbor STATION's
 * binding, never its stop's viaCircle flag: eligibility must not depend on
 * the neighbor's own opt-in, or two opted-out stops would deadlock each
 * other with no way back. Drives the five-state rotateStop cycle and the
 * direction control's circle glyph.
 */
export function stopCanRideCircle(doc: MapDoc, stationId: StationId, lineId: LineId): boolean {
  const st = doc.stations[stationId];
  const cid = st?.circleId;
  if (cid === undefined || !doc.lineCircles[cid]) return false;
  const line = doc.lines[lineId];
  if (!line) return false;
  return edgeNeighbors(line.edges, stationId).some((nid) => doc.stations[nid]?.circleId === cid);
}

export function rotateStop(doc: MapDoc, stationId: StationId, lineId: LineId): MapDoc {
  return updateStation(doc, stationId, (st) => {
    const i = st.stops.findIndex((c) => c.lineId === lineId);
    if (i < 0) return st;
    const cur = st.stops[i];
    const newStops = st.stops.slice();
    // Stops that can form a circular connection cycle through FIVE states:
    // Circle → V → NE → H → NW → Circle. The Circle state is the viaCircle
    // flag (the stored octant is pinned to auto-vertical, the quantized
    // tangent on a bound station, so every travel-axis consumer keeps a
    // coherent fallback). Everything else keeps the plain four-axis wrap —
    // and leaving the Circle state clears the flag either way (the opt-out
    // gesture).
    if (cur.viaCircle) {
      const { viaCircle: _via, ...rest } = cur;
      newStops[i] = { ...rest, orientation: 'auto-vertical' };
      return { ...st, stops: newStops };
    }
    const idx = AXIS_CYCLE.indexOf(cur.orientation);
    if (idx === 3 && stopCanRideCircle(doc, stationId, lineId)) {
      newStops[i] = { ...cur, orientation: 'auto-vertical', viaCircle: true };
      return { ...st, stops: newStops };
    }
    const next = AXIS_CYCLE[(idx + 1) % 4];
    if (next === cur.orientation) return st;
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

export function setLabelOffset(doc: MapDoc, stationId: StationId, offset: number): MapDoc {
  // Value guard, like every sibling here (setLabelOffsetPerp/Align/Valign):
  // without it a slider gesture that never leaves its current detent still
  // allocates, so the group commit's reference check sees a change and spends
  // an undo entry on nothing — the next Ctrl+Z then appears to do nothing.
  return updateLabel(doc, stationId, (label) =>
    label.offset === offset ? label : { ...label, offset },
  );
}

export function setLabelOffsetPerp(doc: MapDoc, stationId: StationId, offsetPerp: number): MapDoc {
  return updateLabel(doc, stationId, (label) =>
    resolveOffsetPerp(label) === offsetPerp ? label : { ...label, offsetPerp },
  );
}

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
  // Same-reference-on-no-op (ARCHITECTURE §2). This is an UNGROUPED store
  // write, so a value-identical patch that allocated would push a dead undo
  // entry AND wipe the redo stack — re-clicking the already-selected color
  // swatch is the everyday way to hit it. The gesture-group commit is no
  // backstop: its change check is reference equality too.
  if (
    (patch.service === undefined || patch.service === cur.service) &&
    (patch.name === undefined || patch.name === cur.name) &&
    (patch.color === undefined || patch.color === cur.color)
  ) {
    return doc;
  }
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
  // token is literal TEXT, not a bullet, so the lookbehind skips it.
  //
  // Both codes must be valid bullet CODEs (labelTokens owns that grammar) or
  // there is nothing safe to do: a code containing a delimiter can never
  // appear in a token, and an EMPTY one collapses the patterns below to the
  // bare delimiter pairs `||`/`[]`/`{}` — which match literal punctuation and
  // both halves of another line's UNFILLED bullet, so a single keystroke would
  // rewrite every station name and text label in the document. An empty
  // service is one Backspace away, since the inspector's field writes through
  // on every keystroke. Skip the rewrite; the rename itself still lands.
  if (!isBulletCode(cur.service) || !isBulletCode(nextLine.service)) {
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

// Unit cell-space step pointing radially OUT of `circle` at bound station
// `st` — the axis every ring LANE is measured along. Derived from
// `radialLocalTurn` (the ring frame) rather than the raw octant, so spawn and
// the renderer can't disagree about which way "out" is at a given seat.
function radialOutCell(
  st: { x: number; y: number; rotation: Rotation },
  circle: CircleSpec,
): { dRow: number; dCol: number } {
  switch (radialLocalTurn(st, circle)) {
    case 0:
      return { dRow: 0, dCol: 1 };
    case 1:
      return { dRow: 1, dCol: 0 };
    case 2:
      return { dRow: 0, dCol: -1 };
    default:
      return { dRow: -1, dCol: 0 };
  }
}

// Centre-to-centre distance below which a new stop for `lineId` would paint
// through an existing stop of `other`. Two stops are packed at exactly
// `tangentGap`, so anything closer overlaps — less the shared BAND_MERGE_TOL
// slack, or float drift in a computed position would read an exactly-packed
// neighbour as a blocker. The one place that number is written; both the ring
// branch (which has cells, and cell distance × STOP_SIZE IS world distance
// under a rigid frame) and the world-space walk below measure against it.
const overlapDistance = (lineId: LineId, other: LineId, lines: Record<LineId, Line>): number =>
  tangentGap(
    lineWidthOf(lines[lineId]),
    lineWidthOf(lines[other]),
    lineInterlineGapOf(lines[lineId]),
    lineInterlineGapOf(lines[other]),
  ) - BAND_MERGE_TOL;

// A stop centre in WORLD coordinates, and its inverse: the cell whose centre
// lands on a world point. Station rotation is undone in ONE place — here — so
// everything reasoning about where a stop goes relative to another can work in
// world vectors and never touch a local axis.
const stopWorldPos = (cell: { row: number; col: number }, st: Station, circle: CircleSpec | null) =>
  stationCellToWorld(stopCenterAt(cell.row, cell.col), st, circle);

function cellAtWorldPos(
  world: Vec2,
  st: Station,
  circle: CircleSpec | null,
): { row: number; col: number } {
  const local = stationDirToLocal(sub(world, st), st, circle);
  return { row: nz(local.y / STOP_SIZE), col: nz(local.x / STOP_SIZE) };
}

// The stop overlapping `at`, if any — the one FURTHEST along `dir` when several
// do, so a walk that steps past it clears the whole cluster in one hop instead
// of ping-ponging between members in array order (which carries no meaning).
function blockingStopNear(
  st: Station,
  lineId: LineId,
  lines: Record<LineId, Line>,
  circle: CircleSpec | null,
  at: Vec2,
  dir: Vec2,
): StopCell | undefined {
  let worst: StopCell | undefined;
  let furthest = -Infinity;
  for (const c of st.stops) {
    const delta = sub(stopWorldPos(c, st, circle), at);
    if (len(delta) >= overlapDistance(lineId, c.lineId, lines)) continue;
    const along = dot(delta, dir);
    if (along > furthest) {
      furthest = along;
      worst = c;
    }
  }
  return worst;
}

// Push `start` along `dir` until no existing stop overlaps it, clearing each
// blocker by exactly the step that packs against it — so the walk comes to rest
// tangent to whatever it ends up beside rather than at an arbitrary distance.
// The bound is iteration count, not a convergence proof: stops at a station lie
// along one axis in every layout the app itself builds, where one hop per stop
// is ample, but a hand-placed scatter could in principle exhaust it and return
// a spot still overlapping. `corridorOrderCell` re-checks rather than trusting
// this, which is what makes that acceptable.
function slideClearOfStops(
  st: Station,
  lineId: LineId,
  lines: Record<LineId, Line>,
  circle: CircleSpec | null,
  start: Vec2,
  dir: Vec2,
): Vec2 {
  let at = start;
  for (let i = 0; i <= st.stops.length; i++) {
    const hit = blockingStopNear(st, lineId, lines, circle, at, dir);
    if (!hit) break;
    const gap = overlapDistance(lineId, hit.lineId, lines) + BAND_MERGE_TOL;
    at = add(stopWorldPos(hit, st, circle), { x: dir.x * gap, y: dir.y * gap });
  }
  return at;
}

// The orientation at `st` naming the same WORLD axis `ref` travels at `from`.
// The four orientations name the same four axes at every station, but they name
// them in the station's LOCAL frame — so carrying "which way this line runs"
// across a corridor means re-indexing, not copying the enum: a station framed
// for an east–west corridor calls north–south travel 'auto-horizontal'.
// Straight off `AXIS_CYCLE`'s own identity (index k's local axis paints as the
// world axis at (k + rotation) % 4): solve (k + from.rotation) ≡ (k' +
// st.rotation) for k'. `StopRows` reads the same identity the other way round.
function travelAxisMatching(ref: StopCell, from: Station, st: Station): StopOrientation {
  const k = AXIS_CYCLE.indexOf(ref.orientation);
  return AXIS_CYCLE[(((k + from.rotation - st.rotation) % 4) + 4) % 4];
}

// Place `lineId`'s new stop on `st` by reproducing, in WORLD terms, the
// arrangement it already has at `from` — the station it is being extended from.
//
// Everything here is world vectors, converted back to a cell exactly once at
// the end (`cellAtWorldPos`). That is the whole point: a cell's row/col mean
// different world directions at every station rotation, so any rule phrased as
// "a column over" is a rule that changes answer depending on how the target
// station happens to be turned. Two stations 180° apart put the new stop on the
// wrong side of the band; two a quarter turn apart — a station framed for an
// east–west corridor receiving a north–south line — put it along the corridor
// instead of across it, which the router then can't route at all.
//
// Each line running this SAME corridor and stopping at both ends is a PEER, and
// each proposes one spot: its own position here, plus the world offset from it
// to `lineId` back at `from`. Peers usually agree, and a proposal that satisfies
// every peer reproduces the whole arrangement exactly. Ranking:
//
//   1. most peers whose world offset it reproduces,
//   2. does not sit on top of an existing stop — the backstop for
//      `slideClearOfStops` being iteration-bounded rather than convergent,
//   3. the nearest peer at `from`, which keeps the tightest relationship: that
//      is the peer this line is most likely actually interlined WITH, and
//      following it preserves the band they already share.
//
// Returns null when there is nothing to reproduce — no stop at `from`, or no
// peer — leaving the caller's fallback in charge.
function corridorOrderCell(
  st: Station,
  lineId: LineId,
  lines: Record<LineId, Line>,
  lineCircles: Record<string, LineCircle>,
  from: Station,
): StopCell | null {
  const mine = from.stops.find((c) => c.lineId === lineId);
  const canon = sub(st, from);
  if (!mine || (canon.x === 0 && canon.y === 0)) return null;

  // `st` is off-ring by construction — the only caller gates on that, and the
  // ring gets its own radial-lane branch above. `from` is not so constrained:
  // a line can run off a ring onto a free station.
  const stCircle = null;
  const fromCircle = stationCircle(from, lineCircles);
  const mineWorld = stopWorldPos(mine, from, fromCircle);

  const peers = st.stops
    .filter(
      (here) =>
        here.lineId !== lineId &&
        lines[here.lineId] !== undefined &&
        lineHasEdge(lines[here.lineId], from.id, st.id),
    )
    .map((here) => ({ here, there: from.stops.find((f) => f.lineId === here.lineId) }))
    .filter((p): p is { here: StopCell; there: StopCell } => p.there !== undefined)
    // Nearest peer at `from` first, so it wins any tie left at the end.
    .map((p) => ({ ...p, want: sub(mineWorld, stopWorldPos(p.there, from, fromCircle)) }))
    .sort((a, b) => len(a.want) - len(b.want));
  if (peers.length === 0) return null;

  const orientation = travelAxisMatching(mine, from, st);
  const proposals = peers.map((p) => {
    const anchor = stopWorldPos(p.here, st, stCircle);
    const target = add(anchor, p.want);
    // Away from the proposing peer — the direction that keeps the new stop on
    // the side it was proposed for if the spot has to give way.
    const away = len(p.want) > 0 ? norm(p.want) : norm(leftNormal(canon));
    return slideClearOfStops(st, lineId, lines, stCircle, target, away);
  });

  const reproduced = (at: Vec2) =>
    peers.filter((p) => eq(sub(at, stopWorldPos(p.here, st, stCircle)), p.want, BAND_MERGE_TOL))
      .length;
  const clear = (at: Vec2) =>
    blockingStopNear(st, lineId, lines, stCircle, at, canon) === undefined;

  const best = Math.max(...proposals.map(reproduced));
  let short = proposals.filter((at) => reproduced(at) === best);
  if (short.some(clear)) short = short.filter(clear);
  // `peers` is sorted nearest-first and `proposals` is parallel to it, so the
  // survivor at index 0 IS the nearest peer's — rank 3 needs no second sort.
  return { lineId, ...cellAtWorldPos(short[0], st, stCircle), orientation };
}

// The lattice cell a fresh stop for `lineId` would occupy on station `st`: one
// tangent gap east of the rightmost existing stop (exactly one column at
// default widths), or the origin (0,0) when the station has no stops yet.
// Spawning at tangency — not a flat column step — is what makes a new stop on a
// non-default-width line land packed against its neighbor, matching the
// width-aware ghost lattice the layout editor offers; anchoring on a real stop
// (not the bounding box) keeps the new cell adjacent so the layout never gains
// an orphan. Pure and side-effect-free, so the Edit Stops hover preview can
// call it to ring exactly where a connect/splice would drop the stop — the
// promised spot can't drift from the committed one (spawnStopCell below).
//
// `from` is the station the new stop is being wired FROM (the connect pen, or
// a splice endpoint); pass null where there is none. It only matters on a
// ring — see the lane inheritance below.
export function spawnStopCellAt(
  st: Station,
  lineId: LineId,
  lines: Record<LineId, Line>,
  lineCircles: Record<string, LineCircle> = {},
  from: Station | null = null,
): StopCell {
  const circle = stationCircle(st, lineCircles);
  // LANE INHERITANCE. A ring's lanes are radii, and `segCircleFit` only lets a
  // seg ride the circle when both its ends sit on the SAME one (within
  // BAND_MERGE_TOL). So extending a line that already runs a lane out from the
  // rim must land the new stop on that lane: dropping it on the rim instead —
  // which is what a bare station with no stops used to get — leaves the two
  // ends a lane apart, and the corridor degrades to a chord AND lights the
  // band's routing warning, on a layout the app placed itself.
  //
  // What carries across is the source stop's world RADIUS, not its cell: the
  // gate measures radii, and the two seats need not share a frame — the
  // uprightness flip in `circleSeat` inverts `radialLocalTurn` over part of
  // the ring, so the same lane is `col: +1` at one station and `col: -1` at
  // another. Reproducing an integer lane INDEX would be wrong for a second
  // reason: lane pitch is `tangentGap`, so index k is a different radius
  // wherever the inner neighbours differ in width.
  const src =
    circle && from && from.circleId === st.circleId
      ? from.stops.find((c) => c.lineId === lineId)
      : undefined;
  if (circle && from && src?.viaCircle) {
    const out = radialOutCell(st, circle);
    const p = stationCellToWorld(stopCenterAt(src.row, src.col), from, circle);
    const cells = (Math.hypot(p.x - circle.x, p.y - circle.y) - circle.radius) / STOP_SIZE;
    // `nz`, as in the rotation matrices: a rim-lane source on a negative
    // radial axis multiplies out to -0, which is numerically fine everywhere
    // but compares unequal to 0 under Object.is.
    const row = nz(out.dRow * cells);
    const col = nz(out.dCol * cells);
    // Only when the spot is free (see `overlapDistance` for why "free" is a
    // collision test rather than cell equality). Occupied ⇒ fall through and
    // stack outward, which routes no worse than before.
    const taken = st.stops.some(
      (c) =>
        Math.hypot(c.row - row, c.col - col) * STOP_SIZE < overlapDistance(lineId, c.lineId, lines),
    );
    if (!taken) return { lineId, row, col, orientation: 'auto-vertical', viaCircle: true };
  }
  // On a circle-bound station, new stops stack RADIALLY OUTWARD from the
  // ring. The naive "east of the rightmost" step below has no consistent
  // radial meaning — local +x points radially IN at some angles and OUT at
  // others (the label-uprightness flip alone inverts it), so two stations on
  // the same ring would spawn a second line's stops on opposite sides and the
  // concentric-arc gate could never hold. Radial-out is the one direction
  // that means the same thing at every angle.
  if (circle && st.stops.length > 0) {
    const step = radialOutCell(st, circle);
    // Anchor on the radially-OUTERMOST existing stop and step one tangent
    // gap further out.
    const anchor = st.stops.reduce((best, c) =>
      c.row * step.dRow + c.col * step.dCol > best.row * step.dRow + best.col * step.dCol
        ? c
        : best,
    );
    const gapCells =
      tangentGap(
        lineWidthOf(lines[lineId]),
        lineWidthOf(lines[anchor.lineId]),
        lineInterlineGapOf(lines[lineId]),
        lineInterlineGapOf(lines[anchor.lineId]),
      ) / STOP_SIZE;
    return {
      lineId,
      row: anchor.row + step.dRow * gapCells,
      col: anchor.col + step.dCol * gapCells,
      orientation: 'auto-vertical',
      viaCircle: true,
    };
  }
  // Off a ring, a station already served by this corridor has an arrangement
  // worth reproducing — see `corridorOrderCell`. It answers null when there
  // isn't one, and the plain step east below takes over.
  if (!circle && from) {
    const ordered = corridorOrderCell(st, lineId, lines, lineCircles, from);
    if (ordered) return ordered;
  }
  const anchor =
    st.stops.length === 0
      ? null
      : st.stops.reduce((best, c) => (c.col > best.col ? c : best), st.stops[0]);
  const newRow = anchor ? anchor.row : 0;
  const newCol = anchor
    ? anchor.col +
      tangentGap(
        lineWidthOf(lines[lineId]),
        lineWidthOf(lines[anchor.lineId]),
        lineInterlineGapOf(lines[lineId]),
        lineInterlineGapOf(lines[anchor.lineId]),
      ) /
        STOP_SIZE
    : 0;
  // Even with no arrangement to reproduce, the travel axis still has to be
  // named in THIS station's frame: a station already carrying stops keeps its
  // rotation (autoOrient only fires on one gaining its first line), so a
  // station framed for a crossing corridor calls this line's axis something
  // other than 'auto-vertical'. On an EMPTY station the rotation is about to be
  // set from this very edge, and 'auto-vertical' is the axis it is chosen to
  // make correct — matching against the frame it is about to leave behind would
  // be reading the wrong frame.
  const source = from?.stops.find((c) => c.lineId === lineId);
  const orientation: StopOrientation =
    source && from && st.stops.length > 0 ? travelAxisMatching(source, from, st) : 'auto-vertical';
  return {
    lineId,
    row: newRow,
    col: newCol,
    orientation,
    // A stop born on a circle-bound station defaults to riding the circle —
    // the always-arc default; explicitly flipping the orientation is the
    // opt-out (rotateStop clears the flag).
    ...(st.circleId !== undefined ? { viaCircle: true } : {}),
  };
}

// Spawn a stop cell for `lineId` on station `st` when it doesn't have one
// (placed by spawnStopCellAt), and nudge an auto-placed label out from under
// it. Returns the originals unchanged when a stop already exists. Shared by the
// linear-append and lone-member add paths so the two never drift.
function spawnStopCell(
  st: Station,
  lineId: LineId,
  lines: Record<LineId, Line>,
  lineCircles: Record<string, LineCircle> = {},
  from: Station | null = null,
): { stops: StopCell[]; label: LabelCell } {
  if (st.stops.some((c) => c.lineId === lineId)) return { stops: st.stops, label: st.label };
  const newCell = spawnStopCellAt(st, lineId, lines, lineCircles, from);
  const { row: newRow, col: newCol } = newCell;
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
  const { stops: newStops, label: newLabel } = spawnStopCell(
    st,
    lineId,
    doc.lines,
    doc.lineCircles,
  );
  const newStations = [...ln.stations, stationId];
  const stationsAfter = {
    ...doc.stations,
    [stationId]: { ...st, stops: newStops, label: newLabel },
  };
  return {
    ...doc,
    lines: { ...doc.lines, [lineId]: { ...ln, stations: newStations } },
    // A bound station skips the first-line auto-orientation: the circle owns
    // its rotation (the tangent octant), and the neighbor-derived travel
    // direction would swing it off the ring's tangent.
    stations:
      st.stops.length === 0 && st.circleId === undefined
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
      [removedStationId]: rehomeCircleStops({
        ...st,
        stops: st.stops.filter((c) => c.lineId !== lineId),
      }),
    };
    // The (station, line) stop is gone — delete transfers anchored at it. Stop
    // ends only: the station itself survives, so its hosted anchors do too.
    transfers = pruneTransfers(
      transfers,
      (e) => isStopEnd(e) && e.stationId === removedStationId && e.lineId === lineId,
    );
  }
  const updatedLine = pruneOrphanLineOverrides({
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
//
// Cutting an edge can strand an endpoint with no remaining edges (a terminus
// whose only track this was). Such a station is dropped from the line entirely
// — same cleanup as a right-click "remove station" on it — so removing a
// segment never leaves an edgeless orphan stop behind.
export function toggleEdgeOnLine(doc: MapDoc, lineId: LineId, a: StationId, b: StationId): MapDoc {
  const ln = doc.lines[lineId];
  if (!ln || a === b) return doc;
  if (!ln.stations.includes(a) || !ln.stations.includes(b)) return doc;
  const removing = lineHasEdge(ln, a, b);
  const nextEdges = removing ? removeEdge(ln.edges, a, b) : addEdge(ln.edges, a, b);
  if (nextEdges === ln.edges) return doc;
  const updatedLine = pruneOrphanLineOverrides({ ...ln, edges: nextEdges });
  let out = pruneOrphanLineTags({ ...doc, lines: { ...doc.lines, [lineId]: updatedLine } });
  if (removing) {
    for (const endpoint of [a, b]) {
      const line = out.lines[lineId];
      if (degreeOf(line, endpoint) === 0) {
        out = removeStationFromLine(out, lineId, line.stations.indexOf(endpoint));
      }
    }
  }
  return out;
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
    // The pen station seeds the new stop's ring lane (see spawnStopCellAt).
    const { stops, label } = spawnStopCell(
      to,
      lineId,
      doc.lines,
      doc.lineCircles,
      doc.stations[fromStationId] ?? null,
    );
    newStations = [...ln.stations, toStationId];
    stationsAfter = { ...doc.stations, [toStationId]: { ...to, stops, label } };
  }
  const edges = addEdge(ln.edges, fromStationId, toStationId);
  return {
    ...doc,
    // Wiring an edge can only ADD adjacency, so no segment style is orphaned —
    // but the station it wires FROM just stopped being an end, and its end-style
    // override goes with it.
    lines: {
      ...doc.lines,
      [lineId]: pruneOrphanLineOverrides({ ...ln, stations: newStations, edges }),
    },
    // Only a station gaining its first line is auto-oriented; anything already
    // served keeps the rotation the user gave it. Circle-bound stations skip
    // it too — the circle owns their rotation (the tangent octant).
    stations:
      !isMember && to.stops.length === 0 && to.circleId === undefined
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
    // Ring lane seed (see spawnStopCellAt): the edge's `from` end — the pen
    // side, exactly as for a connect. Deliberately NOT "whichever endpoint is
    // on the same ring": `appendSpawnSource` has to name this station without
    // knowing the target's binding, and a preview that rings a lane the click
    // then declines to use is worse than not inheriting. A corridor that
    // already ARCS has both ends at one radius anyway, so the two endpoints
    // only differ where the edge has a foot off the ring — and there the
    // fallback is the old placement, no worse than before.
    const { stops, label } = spawnStopCell(
      st,
      lineId,
      doc.lines,
      doc.lineCircles,
      doc.stations[fromStationId] ?? null,
    );
    newStations = [...ln.stations, stationId];
    stationsAfter = { ...doc.stations, [stationId]: { ...st, stops, label } };
  }
  let edges = removeEdge(ln.edges, fromStationId, toStationId);
  edges = addEdge(edges, fromStationId, stationId);
  edges = addEdge(edges, stationId, toStationId);
  const updatedLine = pruneOrphanLineOverrides({ ...ln, stations: newStations, edges });
  return pruneOrphanLineTags({
    ...doc,
    lines: { ...doc.lines, [lineId]: updatedLine },
    stations:
      // Circle-bound stations keep the tangent octant (see connect above).
      !isMember && st.stops.length === 0 && st.circleId === undefined
        ? autoOrientNewStation(stationsAfter, [fromStationId, stationId, toStationId], stationId)
        : stationsAfter,
  });
}

export function deleteLine(doc: MapDoc, id: LineId): MapDoc {
  const { [id]: _gone, ...rest } = doc.lines;
  const stations: Record<StationId, Station> = {};
  for (const sid of Object.keys(doc.stations)) {
    const st = doc.stations[sid];
    const stops = st.stops.filter((c) => c.lineId !== id);
    stations[sid] = stops.length === st.stops.length ? st : rehomeCircleStops({ ...st, stops });
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
  // Stop ends only: an anchor end has no lineId, and must not be swept up here.
  const transfers = pruneTransfers(doc.transfers, (e) => isStopEnd(e) && e.lineId === id);
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

// Lock/unlock a single station. A thin wrapper over the multi-item
// setItemsLocked below (defined further down) — it owns the one canonical
// "store true / drop the field when off, same-reference on no-op" convention,
// so single- and multi-select locking can't drift apart.
export function setStationLocked(doc: MapDoc, stationId: StationId, locked: boolean): MapDoc {
  return setItemsLocked(doc, { stations: [stationId] }, locked);
}

// A mixed multi-selection's ids, one list per lockable kind. Absent/empty
// lists leave that collection untouched.
export interface LockableItemIds {
  stations?: readonly StationId[];
  bullets?: readonly string[];
  labels?: readonly string[];
  polygons?: readonly string[];
  svgImages?: readonly string[];
  lineCircles?: readonly string[];
}

// Flip `locked` on the listed members of one collection, allocating a new
// record only when at least one member actually changes state. THE canonical
// lock convention: `false` is the default, so we store `true` and omit the
// field entirely when off (keeping persisted docs clean), and a member already
// at the requested state is skipped so an all-no-op batch returns `rec` itself
// (reference equality → history grouping sees an untouched doc).
function setLockedIn<T extends { locked?: boolean }>(
  rec: Record<string, T>,
  ids: readonly string[] | undefined,
  locked: boolean,
): Record<string, T> {
  if (!ids || ids.length === 0) return rec;
  let out: Record<string, T> | null = null;
  for (const id of ids) {
    const cur = rec[id];
    if (!cur || !!cur.locked === locked) continue;
    let next: T;
    if (locked) {
      next = { ...cur, locked: true };
    } else {
      const { locked: _gone, ...rest } = cur;
      next = rest as T;
    }
    out ??= { ...rec };
    out[id] = next;
  }
  return out ?? rec;
}

// Lock/unlock a mixed multi-selection in ONE doc write, so the whole batch is
// a single undo entry. Unknown ids and members already at the requested state
// are skipped; when nothing flips, the input doc comes back unchanged.
export function setItemsLocked(doc: MapDoc, ids: LockableItemIds, locked: boolean): MapDoc {
  const stations = setLockedIn(doc.stations, ids.stations, locked);
  const routeBullets = setLockedIn(doc.routeBullets, ids.bullets, locked);
  const textLabels = setLockedIn(doc.textLabels, ids.labels, locked);
  const polygons = setLockedIn(doc.polygons, ids.polygons, locked);
  const svgImages = setLockedIn(doc.svgImages, ids.svgImages, locked);
  const lineCircles = setLockedIn(doc.lineCircles, ids.lineCircles, locked);
  if (
    stations === doc.stations &&
    routeBullets === doc.routeBullets &&
    textLabels === doc.textLabels &&
    polygons === doc.polygons &&
    svgImages === doc.svgImages &&
    lineCircles === doc.lineCircles
  ) {
    return doc;
  }
  return { ...doc, stations, routeBullets, textLabels, polygons, svgImages, lineCircles };
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

function palettesEqual(a: Palette, b: Palette): boolean {
  if (a.name !== b.name || a.swatches.length !== b.swatches.length) return false;
  return a.swatches.every(
    (s, i) => s.name === b.swatches[i].name && s.color === b.swatches[i].color,
  );
}

/**
 * Add a palette to the map, upserting by name: adding a name the map already
 * holds replaces its swatches where it stands, which is also how a map picks up
 * a corrected palette from the library. Adding what the map already has changes
 * nothing.
 */
export function addPaletteToMap(doc: MapDoc, palette: Palette): MapDoc {
  const next = copyPalette(palette);
  const idx = doc.palettes.findIndex((p) => p.name === next.name);
  if (idx < 0) return { ...doc, palettes: [...doc.palettes, next] };
  if (palettesEqual(doc.palettes[idx], next)) return doc;
  const palettes = doc.palettes.slice();
  palettes[idx] = next;
  return { ...doc, palettes };
}

/** Drop a palette from the map. The map may end up holding none. */
export function removePaletteFromMap(doc: MapDoc, name: string): MapDoc {
  const palettes = doc.palettes.filter((p) => p.name !== name);
  if (palettes.length === doc.palettes.length) return doc;
  return { ...doc, palettes };
}

/**
 * Rename one of the map's palettes. Free to do — the map holds a copy, so a
 * built-in renamed here leaves the library's untouched. Refuses a name the map
 * already uses, since name is the key.
 */
export function renameMapPalette(doc: MapDoc, from: string, to: string): MapDoc {
  const name = to.trim();
  if (!name || name === from) return doc;
  if (doc.palettes.some((p) => p.name === name)) return doc;
  const idx = doc.palettes.findIndex((p) => p.name === from);
  if (idx < 0) return doc;
  const palettes = doc.palettes.slice();
  palettes[idx] = { ...palettes[idx], name };
  return { ...doc, palettes };
}

/**
 * Move a palette one place up (-1) or down (+1) the map's list — the order the
 * color picker sections and the `addLine` color cycle follow.
 */
export function movePaletteInMap(doc: MapDoc, name: string, delta: -1 | 1): MapDoc {
  const idx = doc.palettes.findIndex((p) => p.name === name);
  const to = idx + delta;
  if (idx < 0 || to < 0 || to >= doc.palettes.length) return doc;
  const palettes = doc.palettes.slice();
  [palettes[idx], palettes[to]] = [palettes[to], palettes[idx]];
  return { ...doc, palettes };
}

/**
 * Make this a night map (or a day map again) — see MapDoc.darkMode. Returns the
 * input doc unchanged when the value is unchanged (so undo doesn't record a
 * no-op).
 */
export function setDarkMode(doc: MapDoc, darkMode: boolean): MapDoc {
  if (doc.darkMode === darkMode) return doc;
  return { ...doc, darkMode };
}

/**
 * Empty the canvas, keeping the document. Clear is not New: it stays in the
 * same map, so everything that isn't drawn content survives — the title, the
 * define-by-example styles, the palettes it paints with, and whether this is
 * a night map. DEFAULT_DOC supplies the emptied collections; the spread below
 * re-imposes the settings on top of them.
 */
export function clearAll(doc: MapDoc): MapDoc {
  return {
    ...DEFAULT_DOC,
    name: doc.name,
    styles: doc.styles,
    styleDefaults: doc.styleDefaults,
    palettes: doc.palettes,
    darkMode: doc.darkMode,
  };
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
// Sizes live on a quarter-unit grid: the slider/steppers move in 0.25
// increments and the clamp rounds to the nearest step (like line width).
export const ROUTE_BULLET_SIZE_STEP = 0.25;

// Snaps to the quarter-unit grid and clamps at the bottom only; the spinbutton
// accepts sizes beyond the slider's range (ROUTE_BULLET_SIZE_MAX constrains the
// slider, not the value).
export function clampRouteBulletSize(n: number): number {
  return roundClamp(n, ROUTE_BULLET_SIZE_STEP, ROUTE_BULLET_SIZE_MIN);
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
      const clamped = roundClamp(patch.fontSize, FONT_SIZE_STEP, TEXT_LABEL_FONT_SIZE_MIN);
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
// Stroke width steps in quarter units, like the line stroke-width control
// (LINE_STROKE_STEP). The slider/spinbutton/wheel all move by this.
export const POLYGON_STROKE_STEP = 0.25;
export const POLYGON_FILL_DEFAULT = '#cfe3f2';
export const POLYGON_STROKE_DEFAULT = '#000000';
// Corner-rounding radius in world units; missing ⇒ 0 (sharp corners).
export const POLYGON_CURVE_RADIUS_MIN = 0;
export const POLYGON_CURVE_RADIUS_MAX = 50;
export const POLYGON_CURVE_RADIUS_DEFAULT = 0;
// Slider granularity only: the radius is stored free-form (clampPolygonCurveRadius
// clamps the floor but never rounds), so this just sets the slider/stepper/wheel
// increment to a quarter unit.
export const POLYGON_CURVE_RADIUS_STEP = 0.25;
// Half-side of the default square, in world units.
export const POLYGON_DEFAULT_HALF = 30;
// A polygon never drops below a triangle, so deleting a vertex is a no-op here.
export const POLYGON_MIN_VERTICES = 3;

// Stroke width snaps to the POLYGON_STROKE_STEP (0.25) grid and clamps at the
// bottom only; its spinbutton accepts values beyond the slider max
// (POLYGON_STROKE_WIDTH_MAX constrains the slider, not the value). Mirrors the
// line stroke-width control.
const clampPolygonStrokeWidth = (w: number): number =>
  roundClamp(w, POLYGON_STROKE_STEP, POLYGON_STROKE_WIDTH_MIN);
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
    backgroundOrder: [...doc.backgroundOrder, id],
  };
}

// Insert a fully-specified polygon (used by duplicate + paste).
export function addPolygonWith(doc: MapDoc, id: string, fields: Omit<Polygon, 'id'>): MapDoc {
  const polygon = sanitizeIncomingStyleId(doc, 'polygon', { id, ...fields });
  return {
    ...doc,
    polygons: { ...doc.polygons, [id]: polygon },
    backgroundOrder: [...doc.backgroundOrder, id],
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
  return {
    ...doc,
    polygons: rest,
    backgroundOrder: doc.backgroundOrder.filter((bid) => bid !== id),
  };
}

/**
 * The background band's ids in paint order — polygons and svg images in ONE
 * stack, so either kind can sit over the other. Stored `backgroundOrder`
 * filtered to ids that still exist, then any record missing from it appended
 * (legacy saves, or a race between add and order update) so nothing ever drops
 * out. Later = on top. The append order is polygons then images, which is the
 * stacking these two kinds had when their orders were separate arrays.
 */
export function effectiveBackgroundOrder(
  polygons: Record<string, Polygon>,
  svgImages: Record<string, SvgImage>,
  order: string[],
): string[] {
  return reconcileOrder({ ...polygons, ...svgImages }, order);
}

// Restack a background item — polygon OR svg image — within the shared paint
// order, `move` deciding how far it travels. Reconciles a legacy/partial order
// first so the move is always well-defined. No-op for an id that is neither
// kind, and whenever `move` itself no-ops (already at the respective end) —
// the same-reference return is what tells the caller nothing changed.
function moveBackgroundVia(
  doc: MapDoc,
  id: string,
  move: (order: string[], id: string) => string[],
): MapDoc {
  if (!doc.polygons[id] && !doc.svgImages[id]) return doc;
  const order = effectiveBackgroundOrder(doc.polygons, doc.svgImages, doc.backgroundOrder);
  const next = move(order, id);
  if (next === order) return doc;
  return { ...doc, backgroundOrder: next };
}

// One step toward the top (rendered in front of the rest of the background band).
export function moveBackgroundUp(doc: MapDoc, id: string): MapDoc {
  return moveBackgroundVia(doc, id, (o, i) => moveInOrder(o, i, 1));
}

// One step toward the bottom (rendered behind the rest of the background band).
export function moveBackgroundDown(doc: MapDoc, id: string): MapDoc {
  return moveBackgroundVia(doc, id, (o, i) => moveInOrder(o, i, -1));
}

// All the way to the top, clearing the whole band in one click.
export function moveBackgroundToTop(doc: MapDoc, id: string): MapDoc {
  return moveBackgroundVia(doc, id, (o, i) => moveToEndInOrder(o, i, 1));
}

// All the way to the bottom, clearing the whole band in one click.
export function moveBackgroundToBottom(doc: MapDoc, id: string): MapDoc {
  return moveBackgroundVia(doc, id, (o, i) => moveToEndInOrder(o, i, -1));
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
  clamp(o, SVG_IMAGE_OPACITY_MIN, SVG_IMAGE_OPACITY_MAX);

// Insert a fully-specified imported svg image. Used by the placement drop and
// by duplicate/paste (the store actions supply all fields).
export function addSvgImage(doc: MapDoc, id: string, fields: Omit<SvgImage, 'id'>): MapDoc {
  const image: SvgImage = { id, ...fields };
  return {
    ...doc,
    svgImages: { ...doc.svgImages, [id]: image },
    backgroundOrder: [...doc.backgroundOrder, id],
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
    backgroundOrder: doc.backgroundOrder.filter((bid) => bid !== id),
  };
}

// ---------- Transfers ----------

/** Do two ends name the exact same point? A zero-length transfer is rejected. */
export function sameTransferEnd(a: TransferEnd, b: TransferEnd): boolean {
  const aAnchor = isAnchorEnd(a);
  const bAnchor = isAnchorEnd(b);
  if (aAnchor !== bAnchor) return false;
  if (aAnchor && bAnchor) return a.anchorId === b.anchorId;
  // Both stop ends. Same station + DIFFERENT lineIds is fine — a short transfer
  // between two dots of an interlined station is a valid use case.
  return isStopEnd(a) && isStopEnd(b) && a.stationId === b.stationId && a.lineId === b.lineId;
}

/**
 * Join two transfer ends. Either end may be a station stop, a station-hosted
 * transfer anchor, or a free anchor — an anchor end is what lets a transfer turn
 * a corner (two segments meeting at one anchor is a 90° transfer).
 */
export function addTransfer(doc: MapDoc, id: string, a: TransferEnd, b: TransferEnd): MapDoc {
  if (sameTransferEnd(a, b)) return doc;
  if (!transferEndResolves(doc, a) || !transferEndResolves(doc, b)) return doc;
  const transfer: Transfer = { id, a, b };
  return { ...doc, transfers: { ...doc.transfers, [id]: transfer } };
}

export function deleteTransfer(doc: MapDoc, id: string): MapDoc {
  if (!doc.transfers[id]) return doc;
  const { [id]: _gone, ...rest } = doc.transfers;
  return { ...doc, transfers: rest };
}

// ---------- Transfer anchors ----------
//
// Two homes, one purpose: give a transfer end something to bind to that isn't a
// station stop. FREE anchors are world points in `doc.transferAnchors`; HOSTED
// anchors are cells in `Station.transferAnchors` (see model/transferAnchors.ts
// for why the split is load-bearing). Both cascade their transfers on delete —
// a transfer needs both ends, so orphaning one removes the segment.

export function addTransferAnchor(doc: MapDoc, id: string, x: number, y: number): MapDoc {
  return { ...doc, transferAnchors: { ...doc.transferAnchors, [id]: { id, x, y } } };
}

export function moveTransferAnchor(doc: MapDoc, id: string, x: number, y: number): MapDoc {
  return updateRecord(doc, 'transferAnchors', id, (cur) => ({ ...cur, x, y }));
}

export function deleteTransferAnchor(doc: MapDoc, id: string): MapDoc {
  if (!doc.transferAnchors[id]) return doc;
  const { [id]: _gone, ...rest } = doc.transferAnchors;
  return {
    ...doc,
    transferAnchors: rest,
    // Reference-stable when this anchor carried no transfers, so a stray delete
    // doesn't also mark `transfers` dirty.
    transfers: pruneTransfers(doc.transfers, (e) => isAnchorEnd(e) && e.anchorId === id),
  };
}

/** Park a new anchor cell in a station's grid. */
// ---------- Line circles ----------
//
// A LineCircle is a dumb guide circle (see types.ts). The binding invariants
// these transforms maintain:
//   - a bound station (Station.circleId) sits ON its circle's circumference,
//     rotated to the nearest-octant tangent (label kept right-side-up);
//   - `StopCell.viaCircle` only ever appears on stops of bound stations;
//   - deleting a circle strips bindings and leaves stations where they stand.

export function addLineCircle(
  doc: MapDoc,
  id: string,
  x: number,
  y: number,
  radius: number = LINE_CIRCLE_RADIUS_DEFAULT,
): MapDoc {
  const circle: LineCircle = { id, x, y, radius: canonicalLineCircleRadius(radius) };
  return { ...doc, lineCircles: { ...doc.lineCircles, [id]: circle } };
}

// Rewrite every station bound to `circleId` through `fn`, allocating only if
// one actually changed. The shared walk behind circle move/resize/rotate/delete.
function mapBoundStations(
  stations: Record<StationId, Station>,
  circleId: string,
  fn: (st: Station) => Station,
): Record<StationId, Station> | null {
  let out: Record<StationId, Station> | null = null;
  for (const sid of Object.keys(stations)) {
    const st = stations[sid];
    if (st.circleId !== circleId) continue;
    const next = fn(st);
    if (next === st) continue;
    if (!out) out = { ...stations };
    out[sid] = next;
  }
  return out;
}

/**
 * Rotate `circle`'s bound stations one 45° step about `pivotPt` and reseat them
 * on the (possibly already moved) ring. THE statement of "a circle's rotation
 * is the angular position of its members": the ring itself is rotationally
 * symmetric, so there is nothing else to turn. A rotation preserves each
 * station's distance from the center, so orbiting about ANY pivot that the ring
 * turned about too lands it back exactly on the rim; `circleSeat` then
 * re-derives the tangent octant and the label flip rather than guessing them —
 * and 45° is exactly one octant, so a seated station stays seated. Null when the
 * ring carries nobody (see mapBoundStations).
 */
function rotateBoundStations(
  stations: Record<StationId, Station>,
  circle: LineCircle,
  pivotPt: Vec2,
): Record<StationId, Station> | null {
  return mapBoundStations(stations, circle.id, (st) => {
    const p = rotateAround({ x: st.x, y: st.y }, pivotPt, ORBIT_STEP_RAD);
    // Through reseatCircleLayout for the same reason moveStation is: one 45°
    // step advances the tangent octant by one, but the label flip can add
    // another 180° on top, and that turns the cell frame under a layout that
    // did not move. Uncompensated, a rotation mirrors the station's lanes
    // across the rim.
    return reseatCircleLayout(st, { ...st, ...circleSeat(circle, p, st.label.rotation) }, circle);
  });
}

export function moveLineCircle(doc: MapDoc, id: string, x: number, y: number): MapDoc {
  const cur = doc.lineCircles[id];
  if (!cur || (cur.x === x && cur.y === y)) return doc;
  const dx = x - cur.x;
  const dy = y - cur.y;
  // Bound stations ride the center rigidly: angle (and so tangent rotation)
  // is preserved by a pure translation.
  const stations = mapBoundStations(doc.stations, id, (st) => ({
    ...st,
    x: st.x + dx,
    y: st.y + dy,
  }));
  return {
    ...doc,
    lineCircles: { ...doc.lineCircles, [id]: { ...cur, x, y } },
    ...(stations ? { stations } : {}),
  };
}

export function setLineCircleRadius(doc: MapDoc, id: string, radius: number): MapDoc {
  const cur = doc.lineCircles[id];
  if (!cur || !Number.isFinite(radius)) return doc;
  const r = canonicalLineCircleRadius(radius);
  if (r === cur.radius) return doc;
  const next = { ...cur, radius: r };
  // Reproject members radially — angle preserved, so the tangent (and the
  // station's rotation) is unchanged.
  const stations = mapBoundStations(doc.stations, id, (st) => {
    const p = projectToCircle(next, st);
    return p.x === st.x && p.y === st.y ? st : { ...st, x: p.x, y: p.y };
  });
  return {
    ...doc,
    lineCircles: { ...doc.lineCircles, [id]: next },
    ...(stations ? { stations } : {}),
  };
}

/**
 * Rotate a circle in place: its bound stations swing one 45° step around the
 * rim (the ring is rotationally symmetric, so that IS its rotation), each
 * reseated at the tangent octant it lands on. The single-item half of the
 * shared right-click rotate gesture, exactly as `rotateItemsAround` treats a
 * line circle that is its own pivot. Returns the same doc when the ring carries
 * nobody — there is genuinely nothing to turn.
 */
export function rotateLineCircle(doc: MapDoc, id: string): MapDoc {
  const circle = doc.lineCircles[id];
  if (!circle) return doc;
  const stations = rotateBoundStations(doc.stations, circle, { x: circle.x, y: circle.y });
  return stations ? { ...doc, stations } : doc;
}

// Thin wrapper over the canonical multi-item setItemsLocked (see
// setStationLocked) so single- and multi-select locking can't drift apart.
export function setLineCircleLocked(doc: MapDoc, id: string, locked: boolean): MapDoc {
  return setItemsLocked(doc, { lineCircles: [id] }, locked);
}

/**
 * Keep a circle-bound station's layout HOMED: at least one stop touches the
 * origin cell, which is the one point of the local grid that sits ON the ring
 * (the station anchor is projected onto the circumference). When a stop
 * removal leaves the survivors floating radially off the ring — the removed
 * ring line was at the origin, the rest packed outward — translate the WHOLE
 * layout (stops, label, hosted anchors) rigidly so the nearest stop lands
 * back at the origin, exactly the move a user would make by hand on a normal
 * station. Unbound stations are left alone: off-anchor layouts there are a
 * legitimate manual choice.
 */
function rehomeCircleStops(st: Station): Station {
  if (st.circleId === undefined || st.stops.length === 0) return st;
  const nearest = st.stops.reduce((best, c) =>
    Math.hypot(c.row, c.col) < Math.hypot(best.row, best.col) ? c : best,
  );
  if (Math.hypot(nearest.row, nearest.col) < CELL_EPS) return st;
  const dRow = -nearest.row;
  const dCol = -nearest.col;
  const shift = <T extends { row: number; col: number }>(cell: T): T => ({
    ...cell,
    row: cell.row + dRow,
    col: cell.col + dCol,
  });
  return {
    ...st,
    stops: st.stops.map(shift),
    label: shift(st.label),
    ...(st.transferAnchors ? { transferAnchors: st.transferAnchors.map(shift) } : {}),
  };
}

// Strip a station's circle binding: drop `circleId` and every stop's
// `viaCircle` flag (the flag is only meaningful on a bound station). Position
// and rotation stay — the station stands where it stood.
function withoutCircleBinding(st: Station): Station {
  const { circleId: _gone, ...rest } = st;
  const stops = st.stops.some((c) => c.viaCircle)
    ? st.stops.map((c) => {
        if (!c.viaCircle) return c;
        const { viaCircle: _via, ...cellRest } = c;
        return cellRest;
      })
    : st.stops;
  return { ...rest, stops };
}

export function deleteLineCircle(doc: MapDoc, id: string): MapDoc {
  if (!doc.lineCircles[id]) return doc;
  const { [id]: _gone, ...rest } = doc.lineCircles;
  const stations = mapBoundStations(doc.stations, id, withoutCircleBinding);
  return { ...doc, lineCircles: rest, ...(stations ? { stations } : {}) };
}

/**
 * Bind a station to a circle: project it onto the rim, take the tangent seat,
 * and default every stop to riding the ring.
 *
 * `seatFrom` is the pose the station's CELLS were authored in, and is what a
 * drag hands back when it re-captures a ring it escaped mid-gesture (see
 * `useStationDrag`). A detached station keeps its cells but carries the
 * rotation of the seat it LEFT, so by the time it comes back that rotation
 * names a frame a quarter turn out of true and the plain bind re-reads the
 * whole layout through it — every lane crosses the rim. Reading the turn from
 * the seat it left instead makes the re-bind land exactly where the unbroken
 * slide would have: the turn is a function of the seat angle alone, so "did the
 * frame reverse between these two angles" is the same question either way, and
 * the answer doesn't depend on the path between them. Omitted, this is an
 * ordinary bind of a station that was never on the ring.
 */
export function bindStationToCircle(
  doc: MapDoc,
  stationId: StationId,
  circleId: string,
  seatFrom?: { x: number; y: number; rotation: Rotation },
): MapDoc {
  const circle = doc.lineCircles[circleId];
  if (!circle) return doc;
  return updateStation(doc, stationId, (st) => {
    const seat = circleSeat(circle, st, st.label.rotation);
    // Binding defaults every stop to riding the circle (the always-arc
    // default the ring exists for); flipping a stop's orientation opts it
    // back out per line.
    const stops = st.stops.every((c) => c.viaCircle)
      ? st.stops
      : st.stops.map((c) => (c.viaCircle ? c : { ...c, viaCircle: true }));
    if (
      st.circleId === circleId &&
      st.x === seat.x &&
      st.y === seat.y &&
      st.rotation === seat.rotation &&
      stops === st.stops
    )
      return st;
    return reseatCircleLayout(
      seatFrom ? { ...st, ...seatFrom } : st,
      { ...st, circleId, ...seat, stops },
      circle,
    );
  });
}

export function unbindStationFromCircle(doc: MapDoc, stationId: StationId): MapDoc {
  return updateStation(doc, stationId, (st) =>
    st.circleId === undefined ? st : withoutCircleBinding(st),
  );
}

export function setStopViaCircle(
  doc: MapDoc,
  stationId: StationId,
  lineId: LineId,
  via: boolean,
): MapDoc {
  return updateStation(doc, stationId, (st) => {
    const idx = st.stops.findIndex((c) => c.lineId === lineId);
    if (idx === -1) return st;
    const cell = st.stops[idx];
    if (via) {
      // Invariant: the flag only lives on stops of BOUND stations.
      if (st.circleId === undefined || cell.viaCircle) return st;
      const stops = st.stops.slice();
      stops[idx] = { ...cell, viaCircle: true };
      return { ...st, stops };
    }
    if (cell.viaCircle === undefined) return st;
    const { viaCircle: _off, ...cellRest } = cell;
    const stops = st.stops.slice();
    stops[idx] = cellRest;
    return { ...st, stops };
  });
}

export function addStationAnchor(
  doc: MapDoc,
  stationId: StationId,
  id: string,
  row: number,
  col: number,
): MapDoc {
  return updateStation(doc, stationId, (st) => ({
    ...st,
    transferAnchors: [...(st.transferAnchors ?? []), { id, row, col }],
  }));
}

/** Nudge a hosted anchor by a (dRow, dCol) delta — the moveStop convention. */
export function moveStationAnchor(
  doc: MapDoc,
  stationId: StationId,
  anchorId: string,
  dRow: number,
  dCol: number,
): MapDoc {
  if (dRow === 0 && dCol === 0) return doc;
  const st = doc.stations[stationId];
  if (!stationAnchorCell(st, anchorId)) return doc;
  return updateStation(doc, stationId, (s) => ({
    ...s,
    transferAnchors: (s.transferAnchors ?? []).map((a) =>
      a.id === anchorId ? { ...a, row: a.row + dRow, col: a.col + dCol } : a,
    ),
  }));
}

export function deleteStationAnchor(doc: MapDoc, stationId: StationId, anchorId: string): MapDoc {
  const st = doc.stations[stationId];
  if (!stationAnchorCell(st, anchorId)) return doc;
  const kept = (st.transferAnchors ?? []).filter((a) => a.id !== anchorId);
  const withoutAnchor = updateStation(doc, stationId, (s) => {
    // Drop the array entirely at zero, per the omitted-when-empty convention —
    // a station that never grew one, and one that lost its last, must persist
    // identically.
    const { transferAnchors: _gone, ...rest } = s;
    return kept.length > 0 ? { ...rest, transferAnchors: kept } : rest;
  });
  return {
    ...withoutAnchor,
    transfers: pruneTransfers(
      withoutAnchor.transfers,
      (e) => isAnchorEnd(e) && e.anchorId === anchorId,
    ),
  };
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

// Drop the line's TOPOLOGY-SCOPED overrides that its current edge set no longer
// admits. Two maps qualify, and they share this one choke point because they
// share a lifetime — an override outlives the thing it overrides for exactly as
// long as nobody looks:
//
//   segmentStyles     — keyed by pair-key; valid while that pair is an edge.
//   stationEndStyles  — keyed by station; valid while that station is an END
//                       (degree 1). Appending past a terminus, closing a loop,
//                       branching at it, or dropping the stop all revoke it.
//
// Returns the input line unchanged when nothing needed dropping (the
// reference-on-no-op contract undo grouping relies on).
function pruneOrphanLineOverrides(line: Line): Line {
  let next = line;
  const styles = next.segmentStyles;
  if (styles) {
    // Valid keys are exactly this line's edges — the topology source of truth.
    const validKeys = new Set<string>(next.edges);
    const filtered: Record<string, LineStyle> = {};
    let changed = false;
    for (const key of Object.keys(styles)) {
      if (validKeys.has(key)) filtered[key] = styles[key];
      else changed = true;
    }
    if (changed) next = { ...next, segmentStyles: filtered };
  }
  const ends = next.stationEndStyles;
  if (ends) {
    const filtered: Record<StationId, LineEndStyle> = {};
    let changed = false;
    for (const stationId of Object.keys(ends)) {
      if (isLineTerminus(next, stationId)) filtered[stationId] = ends[stationId];
      else changed = true;
    }
    if (changed) next = withStationEndStyles(next, filtered);
  }
  return next;
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
      singletonDotStyleId: DEFAULT_STOP_DOT_STYLE_ID,
      multiDotStyleId: DEFAULT_STOP_DOT_STYLE_ID,
      singletonDotSize: DOT_SIZE_DEFAULT,
      multiDotSize: DOT_SIZE_DEFAULT,
      width: LINE_WIDTH_DEFAULT,
      curveRadius: LINE_CURVE_RADIUS_DEFAULT,
      endStyle: LINE_END_STYLE_DEFAULT,
      strokeWidth: LINE_STROKE_WIDTH_DEFAULT,
      strokeColor: LINE_STROKE_COLOR_DEFAULT,
      seamEdges: LINE_SEAM_EDGES_DEFAULT,
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
  // The stopDot SEED — pruned all the way back to Filled black + the reserved
  // None (STOP_DOT_SEED_STYLES). A fresh map's "Stop dots" list starts there;
  // every other known preset stays recognizable on import but isn't seeded. The
  // designated default among the seed is FACTORY_STYLE_DEFAULTS.stopDot.
  ...STOP_DOT_SEED_STYLES,
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
  stopDot: DEFAULT_STOP_DOT_STYLE_ID,
};

export const DEFAULT_DOC: MapDoc = {
  name: MAP_NAME_DEFAULT,
  stations: {},
  lines: {},
  lineOrder: [],
  lineCounter: 0,
  lineTags: {},
  routeBullets: {},
  transferAnchors: {},
  transfers: {},
  textLabels: {},
  polygons: {},
  backgroundOrder: [],
  regionAssignments: {},
  svgImages: {},
  lineCircles: {},
  styles: DEFAULT_STYLES,
  styleDefaults: FACTORY_STYLE_DEFAULTS,
  // A fresh map is seeded with MTA — copied in, like every palette in a map.
  palettes: PALETTES.filter((p) => p.name === 'MTA').map(copyPalette),
  darkMode: false,
};
