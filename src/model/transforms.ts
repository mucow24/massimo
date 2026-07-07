import { autoOrientNewStation } from './autoOrient';
import { effectiveLineOrder } from './lineOrder';
import { reconcileOrder, moveInOrder } from './recordOrder';
import { LINE_WIDTH_DEFAULT, LINE_WIDTH_MIN } from './lineWidth';
import { DOT_SIZE_DEFAULT, DOT_SIZE_MIN } from './dotSize';
import {
  LINE_STROKE_COLOR_DEFAULT,
  LINE_STROKE_STEP,
  LINE_STROKE_WIDTH_DEFAULT,
  LINE_STROKE_WIDTH_MIN,
} from './lineStroke';
import { DEFAULT_DOT_STYLE, dotStylesEqual } from './dotStyle';
import { pairKeyOf } from './pairKey';
import { DIR_8, rotateBy, stopCenterAt } from '../geometry/orientation';
import { CELL_EPS, sameCell } from '../geometry/lattice';
import { GRID_INTERVAL, snapPointToGrid, type GridSnap } from '../geometry/snap';
import { polygonCentroid, edgeMidpoint } from '../geometry/polygon';
import { SVG_IMAGE_MIN_SIZE, normalizeRotation } from '../geometry/svgImage';
import { measureTextLabel } from '../geometry/textMeasure';
import type { LabelStyle } from '../geometry/labelLayout';
import type { Vec2 } from '../geometry/vec';
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
  SvgImage,
  SvgImageStylePatch,
  Rotation,
  RouteBullet,
  Station,
  StationId,
  StopCell,
  StopOrientation,
  TextLabel,
  TextLabelWeight,
  Transfer,
  TransferEnd,
} from './types';

export const LABEL_FONT_SIZE_MIN = 2;
export const LABEL_FONT_SIZE_MAX = 24;
export const LABEL_FONT_SIZE_DEFAULT = 12;

// Every font-size control (station labels + text labels) steps in quarters and
// stores values snapped to this grid. Mirrors `LINE_STROKE_STEP`'s role for
// the stroke-width field.
export const FONT_SIZE_STEP = 0.25;

export const TRANSFER_THICKNESS_MIN = 1;
export const TRANSFER_THICKNESS_MAX = 14;
export const TRANSFER_THICKNESS_DEFAULT = 2;
export const TRANSFER_COLOR_DEFAULT = '#000000';

export const TRANSFER_STROKE_WIDTH_MIN = 0;
export const TRANSFER_STROKE_WIDTH_MAX = 5;
export const TRANSFER_STROKE_WIDTH_DEFAULT = 0;
export const TRANSFER_STROKE_COLOR_DEFAULT = '#ffffff';

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

export const DEFAULT_DOC: MapDoc = {
  name: MAP_NAME_DEFAULT,
  stations: {},
  lines: {},
  lineOrder: [],
  curveRadius: 24,
  lineCounter: 0,
  lineTags: {},
  routeBullets: {},
  transfers: {},
  textLabels: {},
  polygons: {},
  polygonOrder: [],
  svgImages: {},
  svgImageOrder: [],
  labelFontSize: LABEL_FONT_SIZE_DEFAULT,
  labelWeight: LABEL_WEIGHT_DEFAULT,
  labelItalic: false,
  labelLeading: LABEL_LEADING_DEFAULT,
  labelTracking: LABEL_TRACKING_DEFAULT,
  activePalettes: ['mta'],
  transferThickness: TRANSFER_THICKNESS_DEFAULT,
  transferColor: TRANSFER_COLOR_DEFAULT,
  transferStrokeWidth: TRANSFER_STROKE_WIDTH_DEFAULT,
  transferStrokeColor: TRANSFER_STROKE_COLOR_DEFAULT,
};

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

/**
 * Resolve the rendered weight for a station label, given the doc default and
 * the station's per-station bold flag. `stationBold` true bumps two indices
 * heavier (Regular → Bold), saturating at Black.
 */
export function resolveStationLabelWeight(
  defaultWeight: TextLabelWeight,
  stationBold: boolean | undefined,
): TextLabelWeight {
  return stationBold ? bumpWeightByIndex(defaultWeight, 2) : defaultWeight;
}

/**
 * The effective `LabelStyle` for a single station: the doc-level label defaults
 * with the station's per-station bold flag folded into the weight. The measured
 * consumers — the silhouette, the hit area, the layout editor, and marquee
 * hit-testing — go through here so they agree with the painted label (which
 * resolves the same weight via `resolveStationLabelWeight`) on how a given
 * station's label is measured. `docStyle.weight` must be the *default* weight
 * (before any per-station bold); the bold bump is applied here.
 */
export function effectiveStationLabelStyle(
  station: Pick<Station, 'labelBold'>,
  docStyle: LabelStyle,
): LabelStyle {
  // `LabelStyle.weight` is loosely `number` (geometry measures at any weight),
  // but a station's doc-default weight is always one of the shipped ladder
  // values, so resolving it against the ladder is sound.
  const weight = resolveStationLabelWeight(docStyle.weight as TextLabelWeight, station.labelBold);
  return { ...docStyle, weight };
}

// TextLabel constants and defaults — exported so the popover, placement
// preview, and tests share a single source of truth.
export const TEXT_LABEL_FONT_SIZE_MIN = 1;
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

export function addStation(doc: MapDoc, x: number, y: number, id: StationId, name: string): MapDoc {
  const station: Station = {
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
  return { ...doc, lines: { ...doc.lines, [id]: nextLine }, stations };
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
  const norm = Math.max(DOT_SIZE_MIN, Math.round(size));
  const effDefault = doc.lines[lineId]?.defaultDotSize ?? DOT_SIZE_DEFAULT;
  const stored = norm === effDefault ? undefined : norm;
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
  const norm = Math.max(DOT_SIZE_MIN, Math.round(size));
  const stored = norm === DOT_SIZE_DEFAULT ? undefined : norm;
  if (cur.defaultDotSize === stored) return doc;
  let nextLine: Line;
  if (stored === undefined) {
    const { defaultDotSize: _gone, ...rest } = cur;
    nextLine = rest;
  } else {
    nextLine = { ...cur, defaultDotSize: stored };
  }
  // The cascade compares against `norm` (the new EFFECTIVE default), not
  // `stored` — resetting to the global default must also absorb overrides
  // that equal DOT_SIZE_DEFAULT.
  const stations = dropRedundantStopOverrides(
    doc.stations,
    id,
    'dotSize',
    (s) => s.dotSize === norm,
  );
  return { ...doc, lines: { ...doc.lines, [id]: nextLine }, stations };
}

// Per-line stripe width. Non-finite input is ignored; otherwise the value is
// rounded and clamped to ≥ LINE_WIDTH_MIN, and the field is dropped when the
// result lands on LINE_WIDTH_DEFAULT so the default is never stored (mirrors
// `setLineDefaultDotStyle` + DEFAULT_DOT_STYLE). Returns the input doc unchanged
// when the effective stored form wouldn't change — the slider fires this on
// every drag tick, and reference equality is what keeps no-op ticks out of
// the undo history.
export function setLineWidth(doc: MapDoc, id: LineId, w: number): MapDoc {
  const cur = doc.lines[id];
  if (!cur || !Number.isFinite(w)) return doc;
  const norm = Math.max(LINE_WIDTH_MIN, Math.round(w));
  const stored = norm === LINE_WIDTH_DEFAULT ? undefined : norm;
  if (cur.width === stored) return doc;
  let nextLine: Line;
  if (stored === undefined) {
    const { width: _gone, ...rest } = cur;
    nextLine = rest;
  } else {
    nextLine = { ...cur, width: stored };
  }
  return { ...doc, lines: { ...doc.lines, [id]: nextLine } };
}

// Per-line casing width. Same contract as setLineWidth except the grid:
// non-finite input is ignored, the value is rounded to the nearest
// LINE_STROKE_STEP (0.5) and clamped to ≥ LINE_STROKE_WIDTH_MIN, and the
// field is dropped when the result lands on the default (0 = no casing) so
// it is never stored. Reference-equal no-ops keep slider ticks out of the
// undo history.
export function setLineStrokeWidth(doc: MapDoc, id: LineId, w: number): MapDoc {
  const cur = doc.lines[id];
  if (!cur || !Number.isFinite(w)) return doc;
  const norm = Math.max(LINE_STROKE_WIDTH_MIN, Math.round(w / LINE_STROKE_STEP) * LINE_STROKE_STEP);
  const stored = norm === LINE_STROKE_WIDTH_DEFAULT ? undefined : norm;
  if (cur.strokeWidth === stored) return doc;
  let nextLine: Line;
  if (stored === undefined) {
    const { strokeWidth: _gone, ...rest } = cur;
    nextLine = rest;
  } else {
    nextLine = { ...cur, strokeWidth: stored };
  }
  return { ...doc, lines: { ...doc.lines, [id]: nextLine } };
}

// Per-line casing color. Normalized to lowercase before compare/store (the
// color input emits lowercase, but hand-edited files may carry `#FFFFFF`),
// and the field is dropped at the default so it is never stored — the
// invariant is "stored color is lowercase and never the default".
export function setLineStrokeColor(doc: MapDoc, id: LineId, c: string): MapDoc {
  const cur = doc.lines[id];
  if (!cur) return doc;
  const norm = c.toLowerCase();
  const stored = norm === LINE_STROKE_COLOR_DEFAULT ? undefined : norm;
  if (cur.strokeColor === stored) return doc;
  let nextLine: Line;
  if (stored === undefined) {
    const { strokeColor: _gone, ...rest } = cur;
    nextLine = rest;
  } else {
    nextLine = { ...cur, strokeColor: stored };
  }
  return { ...doc, lines: { ...doc.lines, [id]: nextLine } };
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

// Orbit a point 45° clockwise around a pivot, using precomputed cos/sin of the
// step angle. Shared by every branch of `rotateItemsAround`.
const orbitPoint = (
  x: number,
  y: number,
  px: number,
  py: number,
  cs: number,
  sn: number,
): { x: number; y: number } => {
  const dx = x - px;
  const dy = y - py;
  return { x: px + dx * cs - dy * sn, y: py + dx * sn + dy * cs };
};

/**
 * Reference to a member of a station+bullet+label multi-selection. Used by
 * `rotateItemsAround` to identify which doc collection each member lives
 * in without requiring callers to pre-split by type.
 */
export interface ItemRef {
  type: 'station' | 'bullet' | 'label' | 'polygon' | 'svgImage';
  id: string;
}

/**
 * Generalized version of `rotateStationsAround` that handles a mixed
 * station+bullet+label selection. Pivot can be any of the three types. Each
 * member's own rotation steps by one; non-pivot members orbit 45° clockwise
 * around the pivot's world position. Members whose ids are missing from the
 * doc are silently skipped — selection state can outlive a doc edit (undo).
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
  const ang = Math.PI / 4;
  const cs = Math.cos(ang);
  const sn = Math.sin(ang);

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
      const p = isPivot ? cur : orbitPoint(cur.x, cur.y, px, py, cs, sn);
      stations = {
        ...stations,
        [m.id]: { ...cur, rotation: stepRotation(cur.rotation), x: p.x, y: p.y },
      };
    } else if (m.type === 'bullet') {
      const cur = routeBullets[m.id];
      if (!cur) continue;
      const p = isPivot ? cur : orbitPoint(cur.x, cur.y, px, py, cs, sn);
      routeBullets = {
        ...routeBullets,
        [m.id]: { ...cur, rotation: stepRotation(cur.rotation), x: p.x, y: p.y },
      };
    } else if (m.type === 'label') {
      const cur = textLabels[m.id];
      if (!cur) continue;
      const p = isPivot ? cur : orbitPoint(cur.x, cur.y, px, py, cs, sn);
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
      const vertices = cur.vertices.map((vert) => orbitPoint(vert.x, vert.y, px, py, cs, sn));
      polygons = { ...polygons, [m.id]: { ...cur, vertices } };
    } else {
      // Svg image: orbit the center (held fixed when it IS the pivot) and step
      // its continuous rotation by 45° — a clean multiple of the 22.5° snap
      // grid, so a group rotate never desyncs an image from that grid.
      const cur = svgImages[m.id];
      if (!cur) continue;
      const p = isPivot ? { x: cur.x, y: cur.y } : orbitPoint(cur.x, cur.y, px, py, cs, sn);
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
 * consumes. Order is irrelevant to the rotation result. `polygonIds` is
 * optional so existing call sites (station+bullet+label) need no change.
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
  const rotateGrid = (col: number, row: number) =>
    dir === 1 ? { col: -row, row: col } : { col: row, row: -col };
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
    // Drop the station from the line, then prune any segment style/layer
    // override whose pair-key is no longer an adjacency — same contract as
    // removeStationFromLine / toggleStationOnLine / deleteLine.
    lines[lid] = pruneOrphanSegmentStyles({
      ...ln,
      stations: ln.stations.filter((x) => x !== id),
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
  const line: Line = { id, service, name: `${service} line`, color, stations: [] };
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

// Bump this segment's layer by `dir`. Uncapped — keep clicking to drive the
// value further positive or negative. Layer 0 is the default and is never
// stored, so when the bump lands on 0 the entry is dropped.
export function cycleSegmentLayer(
  doc: MapDoc,
  id: LineId,
  fromStationId: StationId,
  toStationId: StationId,
  dir: -1 | 1,
): MapDoc {
  const cur = doc.lines[id];
  if (!cur) return doc;
  const key = pairKeyOf(fromStationId, toStationId);
  const prev = cur.segmentLayers ?? {};
  const curLayer = prev[key] ?? 0;
  const nextLayer = curLayer + dir;
  let next: Record<string, number>;
  if (nextLayer === 0) {
    if (!(key in prev)) return doc;
    const { [key]: _gone, ...rest } = prev;
    next = rest;
  } else {
    if (prev[key] === nextLayer) return doc;
    next = { ...prev, [key]: nextLayer };
  }
  return { ...doc, lines: { ...doc.lines, [id]: { ...cur, segmentLayers: next } } };
}

export function toggleStationOnLine(
  doc: MapDoc,
  lineId: LineId,
  stationId: StationId,
  insertAfterIndex?: number,
): MapDoc {
  const ln = doc.lines[lineId];
  const st = doc.stations[stationId];
  if (!ln || !st) return doc;
  const inLine = ln.stations.includes(stationId);
  if (inLine) {
    // remove (all occurrences)
    const newStations = ln.stations.filter((x) => x !== stationId);
    const stillStops = newStations.includes(stationId);
    const newStops = stillStops ? st.stops : st.stops.filter((c) => c.lineId !== lineId);
    const stationsAfter = { ...doc.stations, [stationId]: { ...st, stops: newStops } };
    // When the (station, line) stop is dropped, delete transfers anchored at it.
    const transfersAfter = stillStops
      ? doc.transfers
      : pruneTransfers(doc.transfers, (e) => e.stationId === stationId && e.lineId === lineId);
    // Removal changes adjacencies, so prune overrides / tags keyed to edges
    // that no longer exist (same contract as removeStationFromLine).
    const updatedLine = pruneOrphanSegmentStyles({ ...ln, stations: newStations });
    return pruneOrphanLineTags({
      ...doc,
      lines: { ...doc.lines, [lineId]: updatedLine },
      // Removing a station never gives any station its first line, so nothing
      // is auto-oriented — every station here is already served.
      stations: stationsAfter,
      transfers: transfersAfter,
    });
  }
  const idx =
    insertAfterIndex === undefined
      ? ln.stations.length
      : Math.min(ln.stations.length, Math.max(0, insertAfterIndex + 1));
  const newStations = [...ln.stations.slice(0, idx), stationId, ...ln.stations.slice(idx)];
  // Add a stop cell if this line doesn't yet have one at the station.
  // Spawn one column east of the rightmost existing stop (or at (0, 0) when
  // empty). Anchoring on a real stop — not the bounding-box corner — keeps
  // the new cell 8-adjacent to that stop, so the layout never gains an
  // orphan even when existing stops sit at non-zero rows.
  const hasCell = st.stops.some((c) => c.lineId === lineId);
  let newStops = st.stops;
  let newLabel = st.label;
  if (!hasCell) {
    const anchor =
      st.stops.length === 0
        ? null
        : st.stops.reduce((best, c) => (c.col > best.col ? c : best), st.stops[0]);
    const newRow = anchor ? anchor.row : 0;
    const newCol = anchor ? anchor.col + 1 : 0;
    const newCell: StopCell = {
      lineId,
      row: newRow,
      col: newCol,
      orientation: 'auto-vertical',
    };
    newStops = [...st.stops, newCell];
    // If the auto-placed label sits exactly where the new stop is landing,
    // step it past the stop block so the new line doesn't paint over it.
    // We only nudge auto labels (legacy 'auto' align or autoAlign) — manual
    // alignments are user-pinned and shouldn't move out from under the user.
    if (
      (st.label.align === 'auto' || resolveAutoAlign(st.label)) &&
      sameCell(st.label, { row: newRow, col: newCol })
    ) {
      let lc = newCol;
      while (newStops.some((c) => sameCell(c, { row: newRow, col: lc }))) lc += 1;
      newLabel = { ...st.label, row: newRow, col: lc };
    }
  }
  const stationsAfter = {
    ...doc.stations,
    [stationId]: { ...st, stops: newStops, label: newLabel },
  };
  return {
    ...doc,
    lines: { ...doc.lines, [lineId]: { ...ln, stations: newStations } },
    // Auto-orient only a brand-new station (one with no prior line) to the line
    // tangent. A station already served by a line keeps the rotation the user
    // gave it — adding it to another line must not disturb it.
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
  const updatedLine = pruneOrphanSegmentStyles({ ...ln, stations: newStations });
  return pruneOrphanLineTags({
    ...doc,
    lines: { ...doc.lines, [lineId]: updatedLine },
    // No station gains its first line on removal, so nothing is auto-oriented.
    stations,
    transfers,
  });
}

export function reorderLineStations(doc: MapDoc, lineId: LineId, stations: StationId[]): MapDoc {
  const ln = doc.lines[lineId];
  if (!ln) return doc;
  // A reorder changes which station-pairs are adjacent, so per-segment style /
  // layer overrides and line tags keyed to the OLD adjacencies must be pruned
  // (same contract as removeStationFromLine) — otherwise a cleared override
  // resurrects if the corridor is reordered away and back.
  const updatedLine = pruneOrphanSegmentStyles({ ...ln, stations });
  return pruneOrphanLineTags({
    ...doc,
    lines: { ...doc.lines, [lineId]: updatedLine },
    // Reordering only rearranges already-served stations, so none re-rotate.
    stations: doc.stations,
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
  return { ...doc, lines: rest, stations, lineOrder: order, lineTags, routeBullets, transfers };
}

export function moveLineInOrder(doc: MapDoc, id: LineId, dir: -1 | 1): MapDoc {
  const order = effectiveLineOrder(doc.lineOrder, doc.lines);
  const next = moveInOrder(order, id, dir);
  if (next === order) return doc;
  return { ...doc, lineOrder: next };
}

// ---------- Misc ----------

export function setCurveRadius(doc: MapDoc, r: number): MapDoc {
  return { ...doc, curveRadius: r };
}

// Rename the document. No-op guard (returns the same reference) so an unchanged
// name — e.g. the field committing on blur without an edit — records no history
// entry, matching the other scalar setters.
export function setDocName(doc: MapDoc, name: string): MapDoc {
  if (name === doc.name) return doc;
  return { ...doc, name };
}

// Clamps at the bottom only; the spinbutton accepts sizes beyond the slider's
// range (LABEL_FONT_SIZE_MAX constrains the slider, not the value). Snaps to
// the FONT_SIZE_STEP (0.25) grid so the quarter-step controls round-trip cleanly.
export function setLabelFontSize(doc: MapDoc, n: number): MapDoc {
  const clamped = Math.max(LABEL_FONT_SIZE_MIN, Math.round(n / FONT_SIZE_STEP) * FONT_SIZE_STEP);
  if (clamped === doc.labelFontSize) return doc;
  return { ...doc, labelFontSize: clamped };
}

// Clamps at the bottom (MIN) so 0/negative are never persisted, but does NOT
// clamp at the top — the textbox lets users enter arbitrary thicknesses
// outside the slider's range. TRANSFER_THICKNESS_MAX constrains the slider
// only.
export function setTransferThickness(doc: MapDoc, n: number): MapDoc {
  if (!Number.isFinite(n)) return doc;
  const clamped = Math.max(TRANSFER_THICKNESS_MIN, Math.round(n));
  if (clamped === doc.transferThickness) return doc;
  return { ...doc, transferThickness: clamped };
}

export function setTransferColor(doc: MapDoc, c: string): MapDoc {
  if (c === doc.transferColor) return doc;
  return { ...doc, transferColor: c };
}

// Always-on outline around the colored body. Like thickness, clamps at the
// bottom only — the spinbutton accepts widths beyond the slider's range
// (TRANSFER_STROKE_WIDTH_MAX constrains the slider, not the value).
export function setTransferStrokeWidth(doc: MapDoc, n: number): MapDoc {
  if (!Number.isFinite(n)) return doc;
  const clamped = Math.max(TRANSFER_STROKE_WIDTH_MIN, Math.round(n));
  if (clamped === doc.transferStrokeWidth) return doc;
  return { ...doc, transferStrokeWidth: clamped };
}

export function setTransferStrokeColor(doc: MapDoc, c: string): MapDoc {
  if (c === doc.transferStrokeColor) return doc;
  return { ...doc, transferStrokeColor: c };
}

export function setLabelWeight(doc: MapDoc, w: TextLabelWeight): MapDoc {
  if (w === doc.labelWeight) return doc;
  return { ...doc, labelWeight: w };
}

// `false` is the default for these boolean station flags, so we store `true`
// and omit the field entirely when off — keeping persisted docs clean. All
// three setters share this through `updateStation` (returning `st` unchanged
// on a no-op so history grouping still sees an untouched doc).
function setStationBoolFlag(
  doc: MapDoc,
  stationId: StationId,
  field: 'labelBold' | 'labelItalic' | 'locked',
  value: boolean,
): MapDoc {
  return updateStation(doc, stationId, (st) => {
    if (!!st[field] === value) return st;
    if (value) return { ...st, [field]: true };
    const { [field]: _gone, ...rest } = st;
    return rest;
  });
}

export function setStationLabelBold(doc: MapDoc, stationId: StationId, bold: boolean): MapDoc {
  return setStationBoolFlag(doc, stationId, 'labelBold', bold);
}

export function setStationLabelItalic(doc: MapDoc, stationId: StationId, italic: boolean): MapDoc {
  return setStationBoolFlag(doc, stationId, 'labelItalic', italic);
}

export function setStationLocked(doc: MapDoc, stationId: StationId, locked: boolean): MapDoc {
  return setStationBoolFlag(doc, stationId, 'locked', locked);
}

export function setLabelItalic(doc: MapDoc, i: boolean): MapDoc {
  if (i === doc.labelItalic) return doc;
  return { ...doc, labelItalic: i };
}

// Snap a value to its slider's step and clamp at the bottom only (the
// spinbutton accepts values above the slider max). The three-decimal rounding
// kills float artifacts like 1.1500000000000001 while preserving the finest
// step in use (tracking's 0.001); the coarser 0.05 / 0.25 steps never carry a
// legitimate third decimal, so they're unaffected. Shared by the global
// leading/tracking setters and per-label updateTextLabel.
export function snapToStep(v: number, step: number, min: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.round(Math.round(v / step) * step * 1000) / 1000);
}

// Global station-label line spacing. Clamps/snaps like the per-label leading;
// mirrors setLabelFontSize's bottom-only clamp so the spinbutton can exceed the
// slider's max.
export function setLabelLeading(doc: MapDoc, n: number): MapDoc {
  const snapped = snapToStep(n, LABEL_LEADING_STEP, LABEL_LEADING_MIN);
  if (snapped === doc.labelLeading) return doc;
  return { ...doc, labelLeading: snapped };
}

export function setLabelTracking(doc: MapDoc, n: number): MapDoc {
  const snapped = snapToStep(n, LABEL_TRACKING_STEP, LABEL_TRACKING_MIN);
  if (snapped === doc.labelTracking) return doc;
  return { ...doc, labelTracking: snapped };
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
  const bullet: RouteBullet = { id, ...fields };
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
    return { ...cur, ...nextPatch };
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
  const label: TextLabel = { id, ...fields };
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
    // `setLabelFontSize`.
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
    return next;
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
  const polygon: Polygon = { id, ...fields };
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
    return { ...cur, ...nextPatch };
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
    const ang = Math.PI / 4;
    const cs = Math.cos(ang);
    const sn = Math.sin(ang);
    const vertices = cur.vertices.map((vert) => orbitPoint(vert.x, vert.y, c.x, c.y, cs, sn));
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

const clampSvgImageSize = (n: number): number => Math.max(SVG_IMAGE_MIN_SIZE, n);

export function updateSvgImage(doc: MapDoc, id: string, patch: SvgImageStylePatch): MapDoc {
  return updateRecord(doc, 'svgImages', id, (cur) => {
    let next = patch;
    if (typeof next.width === 'number') next = { ...next, width: clampSvgImageSize(next.width) };
    if (typeof next.height === 'number') next = { ...next, height: clampSvgImageSize(next.height) };
    if (typeof next.rotation === 'number') {
      next = { ...next, rotation: normalizeRotation(next.rotation) };
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

// Drop entries from `line.segmentStyles` and `line.segmentLayers` whose
// pair-key no longer corresponds to a station-pair adjacency on this line.
// Returns the input line unchanged if both maps are missing/empty or every
// key still maps to a real edge.
function pruneOrphanSegmentStyles(line: Line): Line {
  const styles = line.segmentStyles;
  const layers = line.segmentLayers;
  if (!styles && !layers) return line;
  const validKeys = new Set<string>();
  for (let i = 0; i < line.stations.length - 1; i++) {
    validKeys.add(pairKeyOf(line.stations[i], line.stations[i + 1]));
  }
  let changed = false;
  let nextStyles = styles;
  if (styles) {
    const filtered: Record<string, LineStyle> = {};
    let stylesChanged = false;
    for (const key of Object.keys(styles)) {
      if (validKeys.has(key)) filtered[key] = styles[key];
      else stylesChanged = true;
    }
    if (stylesChanged) {
      nextStyles = filtered;
      changed = true;
    }
  }
  let nextLayers = layers;
  if (layers) {
    const filtered: Record<string, number> = {};
    let layersChanged = false;
    for (const key of Object.keys(layers)) {
      if (validKeys.has(key)) filtered[key] = layers[key];
      else layersChanged = true;
    }
    if (layersChanged) {
      nextLayers = filtered;
      changed = true;
    }
  }
  return changed ? { ...line, segmentStyles: nextStyles, segmentLayers: nextLayers } : line;
}

function isLineEdge(line: Line, a: StationId, b: StationId): boolean {
  for (let i = 0; i < line.stations.length - 1; i++) {
    const x = line.stations[i];
    const y = line.stations[i + 1];
    if ((x === a && y === b) || (x === b && y === a)) return true;
  }
  return false;
}
