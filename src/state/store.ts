import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { temporal } from 'zundo';
import type { GridSnap } from '../geometry/snap';
import type {
  AutoHAlign,
  AutoVAlign,
  DotStyle,
  LabelAlign,
  LabelValign,
  Line,
  LineId,
  LineStyle,
  MapDoc,
  Polygon,
  PolygonStylePatch,
  RouteBullet,
  StationId,
  StyleDef,
  StyleKind,
  SvgImage,
  SvgImageStylePatch,
  TextLabel,
  TextLabelWeight,
  TransferStylePatch,
} from '../model/types';
import * as S from '../model/styles';
import { useSelection } from './selection';
import { effectiveLineOrder } from '../model/lineOrder';
import { pickNextLineName } from '../model/lineNaming';
import { defaultIdFactory, IdFactory } from '../model/ids';
import { DEFAULT_DOC } from '../model/transforms';
import * as T from '../model/transforms';
import { cyclingColors, FALLBACK_LINE_COLOR, type PaletteId } from '../model/palettes';
import { useCustomPalettes } from './customPalettes';
import {
  sanitizeStations,
  backfillLineNames,
  backfillLinesEdges,
  backfillPolygonDarkColors,
  backfillTextLabelColors,
  backfillTransferDayNightColors,
  bakeLegacyLabelSettings,
  bakeLegacyTransferSettings,
  convertLegacyDotShapes,
  ensureStyleInvariants,
  foldPolygonFillOpacity,
  migrateLegacyBulletSyntax,
  migrateV9Styles,
  validActivePalettes,
} from '../model/serialize';
import type { Station, Transfer } from '../model/types';
import { randomStationName } from './stationNames';
import { pauseHistory, pushHistory, resumeHistory } from './history';
import { useViewportStore } from './viewportStore';

// Re-export so callers (Sidebar, etc.) keep working with one source of truth.
export { effectiveLineOrder };

const ids: IdFactory = defaultIdFactory();

// Offset applied when pasting or duplicating any canvas item, so the copy lands
// just off the original instead of exactly on top of it. A single uniform
// (dx, dy) keeps a multi-item paste's relative layout intact.
const DROP_OFFSET = 15;

// Shared body for the four `duplicateX` actions: look up the source record by
// id, strip that id, and hand the rest to the matching paste action (which
// applies DROP_OFFSET and drops `locked`). Returns null when the id is gone.
function duplicateVia<T extends { id: string }>(
  record: Record<string, T>,
  id: string,
  paste: (data: Omit<T, 'id'>) => string,
): string | null {
  const item = record[id];
  if (!item) return null;
  const { id: _id, ...data } = item;
  return paste(data);
}

// Single source of truth for which MapDoc fields are part of the persisted /
// undoable document. Drives partialize (persist + zundo), DocSnapshot,
// pickDocSnapshot, and the change-detection equality check in
// beginHistoryGroup. Adding a new doc field is a one-line edit here.
const DOC_FIELDS = [
  'name',
  'stations',
  'lines',
  'lineOrder',
  'curveRadius',
  'lineCounter',
  'lineTags',
  'routeBullets',
  'transfers',
  'textLabels',
  'polygons',
  'polygonOrder',
  'svgImages',
  'svgImageOrder',
  // Named style presets + the per-kind default designations. Pre-styles saves
  // lack the keys, so zustand's shallow merge (and parse()'s DEFAULT_DOC
  // merge) backfills the factory set; docs persisted by earlier builds get
  // theirs repaired by the style-invariant pass in migrateDoc.
  'styles',
  'styleDefaults',
  'activePalettes',
] as const;
type DocFieldName = (typeof DOC_FIELDS)[number];
export type DocSnapshot = Pick<MapDoc, DocFieldName>;

// Undo-stack cap. zundo applies it to ungrouped writes via its `limit` option;
// pushHistory (the grouped-gesture path) must apply the same cap itself.
export const HISTORY_LIMIT = 1000;

export function pickDocSnapshot(s: DocSnapshot): DocSnapshot {
  const out = {} as Record<DocFieldName, unknown>;
  for (const k of DOC_FIELDS) out[k] = s[k];
  return out as DocSnapshot;
}

function docSnapshotsEqual(a: DocSnapshot, b: DocSnapshot): boolean {
  for (const k of DOC_FIELDS) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

/**
 * Persisted-document version migration (v0 → v14). Exported and pure so it can
 * be unit-tested in isolation; the persist config below just delegates here.
 * Never mutates `persisted` — returns a possibly-new doc snapshot.
 *
 * - v0 → v1: backfill `line.name` with `${service} line` for lines saved
 *   before the field existed.
 * - v1 → v2: migrate legacy stop orientations (`up`/`down`/`left`/`right` and
 *   any unknown garbage strings) to the four canonical auto-* axes. Without
 *   this, docs saved before the diagonal-stops migration shipped carry
 *   orientation values that no longer have switch arms in travelDirLocal —
 *   crashing on render. Runs via `sanitizeStations`, which `parse()` in
 *   serialize.ts also calls for the file-import path.
 * - v2 → v3: translate legacy `labelBold: boolean` to `labelWeight:
 *   TextLabelWeight` (true → 700, false → 400). Matches `parse()`.
 * - v3 → v4: translate legacy label `valign: 'auto'` to `'auto-down'` (the
 *   new mirror option `'auto-up'` didn't exist yet). Also in sanitizeStations.
 * - v4 → v5: backfill polygon `darkFill`/`darkStroke` (equal to the light
 *   colors) for polygons saved before the dark-mode fields existed. Mirrors
 *   `backfillPolygonDarkColors` in `parse()`.
 * - v5 → v6: backfill text-label `color`/`darkColor` (to the theme-matching
 *   #111111 / #ffffff defaults) for labels saved before the per-label color
 *   fields existed. Mirrors `backfillTextLabelColors` in `parse()`.
 * - v6 → v7: convert legacy `dotShape`/`defaultDotShape` preset ids to
 *   procedural `DotStyle` objects via the pinned preset table. Mirrors
 *   `convertLegacyDotShapes` in `parse()`.
 * - v7 → v8: rewrite the legacy inline bullet syntax in station names and
 *   text-label texts — `<X>` circle tokens become `|X|`, literal pipe text
 *   gets escaped. NOT idempotent (post-migration `<X>` is intentional
 *   literal text), hence version-gated. Mirrors the file-version gate in
 *   `parse()` (SCHEMA_VERSION 2).
 * - v8 → v9: fold the legacy per-polygon `fillOpacity` (0-100 percent) into the
 *   alpha channel of `fill` AND `darkFill`, then drop the field. Idempotent, so
 *   `parse()` runs the shared `foldPolygonFillOpacity` unconditionally (no file
 *   SCHEMA_VERSION bump) while this rehydrate path gates it on v<9.
 * - v9 → v10: style hygiene (`migrateV9Styles`) — rebuild persisted style
 *   defs through the canonical grids (stripping the since-dropped textLabel
 *   width/leading/tracking keys) — then bake the retired doc-level transfer
 *   settings
 *   (transferThickness/transferColor/transferStrokeWidth/transferStrokeColor)
 *   into per-transfer overrides, drop the fields, and seed the designated
 *   default transfer style from them when it still wears untouched factory
 *   props (the settings' map-wide role moved there). The bake is idempotent
 *   (keyed off field presence), so `parse()` runs the shared
 *   `bakeLegacyTransferSettings` unconditionally.
 * - v10 → v11: adopt untagged items whose values match their kind's default
 *   style (`adoptDefaultStyles`) — legacy maps are full of default-looking
 *   items that predate tags, and without them the Styles panel's Default
 *   editors act on nothing. `parse()` runs the same pass for files that
 *   never had a styles record.
 * - v11 → v12: `styleDefaults` (the explicit per-kind default designations)
 *   replaced defaultness-by-name. No gated step of its own — the
 *   non-version-gated `ensureStyleInvariants` pass below repairs coverage
 *   and designations for every doc that carries styles; the bump just forces
 *   pre-designation storage through migrate at all (the persist merge alone
 *   would leave `styleDefaults` pointing at factory ids that round-1/2 docs'
 *   styles records don't contain).
 * - v12 → v13: transfer `color`/`strokeColor` (per-transfer overrides AND
 *   transfer StyleDef props) gained day/night halves — convert the legacy
 *   single-color strings to `{day, night}` pairs (old colors are day colors)
 *   via `backfillTransferDayNightColors`. Ordered after the v<10 bake and
 *   before the v<11 adoption (which compares transfer props by `.day`/`.night`
 *   now). Idempotent; `parse()` does the same conversion in its sanitizers.
 * - v13 → v14: retire the five doc-level station-label font settings
 *   (labelFontSize/labelWeight/labelItalic/labelLeading/labelTracking). Bake
 *   each into per-station typography and the per-station labelBold (+2 weight)
 *   / labelItalic (OR) flags with them, moving the map-wide role to the seeded
 *   default station style — mirrors the transfer-settings retirement.
 *   Idempotent (keyed off field presence), so `parse()` runs the shared
 *   `bakeLegacyLabelSettings` unconditionally.
 */
export function migrateDoc(persisted: unknown, version: number): DocState {
  const s = persisted as {
    lines?: Record<LineId, Line>;
    stations?: Record<string, Station>;
    polygons?: Record<string, Polygon>;
    textLabels?: Record<string, TextLabel>;
    transfers?: Record<string, Transfer>;
    styles?: Record<string, StyleDef>;
    styleDefaults?: Record<StyleKind, string>;
    labelBold?: boolean;
    labelWeight?: TextLabelWeight;
    activePalettes?: PaletteId[];
  };
  // Corrupt or missing version is treated as v0 so all migrations run —
  // preferable to silently rendering with stale data.
  const v = typeof version === 'number' ? version : 0;
  // Some blocks write the same top-level field (v<1 and v<7 both touch lines;
  // v<4 and v<7 both touch stations), but each re-reads `out` and they touch
  // disjoint PROPERTIES within those records, so order is still immaterial.
  let out: typeof s = s;
  if (v < 1 && out.lines) {
    const { lines: cleaned, changed } = backfillLineNames(out.lines);
    if (changed) out = { ...out, lines: cleaned };
  }
  if (v < 4 && out.stations) {
    const { stations: cleaned, changed } = sanitizeStations(out.stations);
    if (changed) out = { ...out, stations: cleaned };
  }
  if (v < 5 && out.polygons) {
    const { polygons: cleaned, changed } = backfillPolygonDarkColors(out.polygons);
    if (changed) out = { ...out, polygons: cleaned };
  }
  if (v < 6 && out.textLabels) {
    const { textLabels: cleaned, changed } = backfillTextLabelColors(out.textLabels);
    if (changed) out = { ...out, textLabels: cleaned };
  }
  if (v < 7 && (out.stations || out.lines)) {
    // Legacy dotShape/defaultDotShape preset ids → DotStyle objects (same
    // converter parse() uses on the file-import path).
    const converted = convertLegacyDotShapes(out.stations ?? {}, out.lines ?? {});
    if (converted.changed) {
      out = {
        ...out,
        ...(out.stations ? { stations: converted.stations } : {}),
        ...(out.lines ? { lines: converted.lines } : {}),
      };
    }
  }
  if (v < 8 && (out.stations || out.textLabels)) {
    const migrated = migrateLegacyBulletSyntax(out.stations ?? {}, out.textLabels ?? {});
    if (migrated.changed) {
      out = {
        ...out,
        ...(out.stations ? { stations: migrated.stations } : {}),
        ...(out.textLabels ? { textLabels: migrated.textLabels } : {}),
      };
    }
  }
  if (v < 9 && out.polygons) {
    // Fold the legacy per-polygon fillOpacity percentage into the fill/darkFill
    // alpha and drop the field (the color now carries transparency directly).
    // Runs after the v<5 dark-color backfill above, so darkFill is present.
    const folded = foldPolygonFillOpacity(out.polygons);
    if (folded.changed) out = { ...out, polygons: folded.polygons };
  }
  if (v < 10) {
    // Style-def hygiene FIRST — strip round-1 defs' since-dropped keys, and
    // materialize an explicit (possibly empty) styles record so the invariant
    // pass below injects the factory Defaults that pre-styles docs never
    // persisted and the merge won't backfill.
    const styles = migrateV9Styles(out.styles ?? {});
    if (styles !== out.styles) out = { ...out, styles };
  }
  // Non-version-gated invariant, like the palette check below: every kind has
  // ≥ 1 style and a valid default designation. Must precede the v<10 bake
  // (which seeds the DESIGNATED default transfer style) and the v<11 adoption
  // (which stamps kinds' designated defaults). An ABSENT styles record is
  // left untouched — only pre-styles docs at v ≥ 10 lack one, which can't
  // exist (v10 materialized it).
  if (out.styles !== undefined) {
    const inv = ensureStyleInvariants(out.styles, out.styleDefaults);
    if (inv.changed) out = { ...out, styles: inv.styles, styleDefaults: inv.styleDefaults };
  }
  if (v < 10) {
    // Retired doc-level transfer settings → baked into per-transfer overrides
    // (no-op when the fields were never persisted, e.g. pre-PR-#220 docs).
    out = bakeLegacyTransferSettings(out);
  }
  if (v < 13) {
    // Transfer colors gained day/night halves. Convert legacy single-color
    // string overrides AND transfer StyleDef props to `{day, night}` pairs
    // (old colors are day colors, night matches). MUST run after the v<10 bake
    // (so a pre-#220 doc's freshly-baked overrides are already pairs) and
    // BEFORE the v<11 adoption below — adoption compares transfer props via
    // stylePropsEqual, which now reads `.day`/`.night`, so the colors have to
    // be pairs first. No-op (reference-stable) on already-converted docs.
    const converted = backfillTransferDayNightColors(out.transfers ?? {}, out.styles ?? {});
    if (converted.changed) {
      out = {
        ...out,
        ...(out.transfers ? { transfers: converted.transfers } : {}),
        ...(out.styles ? { styles: converted.styles } : {}),
      };
    }
  }
  if (v < 11) {
    // Adopt untagged, default-looking items into the default styles: legacy
    // maps are full of them, and without tags the Styles panel's Default
    // editors would act on nothing.
    out = S.adoptDefaultStyles(out as unknown as MapDoc) as typeof out;
  }
  // Non-version-gated invariant (like the palette/style repairs): every line
  // MUST carry an `edges` array — the renderer and interlining read it directly
  // (`ln.edges.join(...)`). Line topology moved from the ordered `stations`
  // list to an explicit `edges` set at v14; a pure version gate would suffice
  // for honestly-versioned docs, but an intermediate build bumped the persist
  // version to 14 and re-saved docs BEFORE lines carried `edges`, stranding
  // them at v14 with no edges — a `v < 14` gate can never recover those (14 is
  // not < 14) and the renderer crashes on load. So backfill it every time,
  // mirroring parse()'s unconditional per-line backfill. `backfillLinesEdges`
  // is reference-stable when every line already has an array, so this is a
  // no-op (preserving the already-canonical pass-through) on canonical docs.
  if (out.lines) {
    const { lines: cleaned, changed } = backfillLinesEdges(out.lines);
    if (changed) out = { ...out, lines: cleaned };
  }
  if (v < 3 && 'labelBold' in out) {
    const { labelBold, ...rest } = out;
    // Existing `labelWeight` wins if both fields are present.
    if (rest.labelWeight === undefined) {
      out = { ...rest, labelWeight: labelBold ? 700 : 400 };
    } else {
      out = rest;
    }
  }
  if (v < 14) {
    // Retired doc-level station-label font settings (labelFontSize/labelWeight/
    // labelItalic/labelLeading/labelTracking) → baked into per-station
    // typography, with the map-wide role moved to the seeded default station
    // style. Runs AFTER the v<3 labelBold→labelWeight step (so it sees the
    // materialized weight) and the invariant pass above (so styleDefaults.station
    // resolves). Idempotent — `parse()` runs the shared bake unconditionally.
    out = bakeLegacyLabelSettings(out);
  }
  // Non-version-gated invariant: at least one VALID active palette. Unlike the
  // migrations above, this isn't tied to a schema bump — a persisted doc with
  // an explicit empty / all-unknown `activePalettes` (tampering, or a
  // pre-invariant build) would otherwise rehydrate into the unreachable-from-UI
  // empty-palette state that `parse()` already guards on the file-import path,
  // via the shared `validActivePalettes`. An ABSENT field is left untouched —
  // zustand's persist merge fills it from the initial state.
  if (out.activePalettes !== undefined) {
    out = {
      ...out,
      activePalettes: validActivePalettes(
        out.activePalettes,
        useCustomPalettes.getState().palettes,
      ),
    };
  }
  return out as DocState;
}

interface DocState extends MapDoc {
  // mutators
  addStation: (x: number, y: number, name?: string) => StationId;
  renameStation: (id: StationId, name: string) => void;
  moveStation: (id: StationId, x: number, y: number) => void;
  setDotStyle: (stationId: StationId, lineId: LineId, style: DotStyle) => void;
  setDotSize: (stationId: StationId, lineId: LineId, size: number) => void;
  setStationWaypoint: (stationId: StationId, isWaypoint: boolean) => void;
  setStationLocked: (stationId: StationId, locked: boolean) => void;
  setStationEditorHeight: (stationId: StationId, height: number) => void;
  redistributeBetween: (
    startId: StationId,
    endId: StationId,
    mode?: 'arc-bends' | 'straight',
    gridMode?: GridSnap,
  ) => void;
  rotateStation: (id: StationId, dir?: -1 | 1) => void;
  rotateItemsAround: (pivot: T.ItemRef, members: T.ItemRef[]) => void;
  rotateStationAndLayout: (id: StationId, dir: -1 | 1) => void;
  deleteStation: (id: StationId) => void;
  moveStop: (stationId: StationId, lineId: LineId, dRow: number, dCol: number) => void;
  rotateStop: (stationId: StationId, lineId: LineId) => void;
  moveLabel: (stationId: StationId, dRow: number, dCol: number) => void;
  rotateLabel: (stationId: StationId) => void;
  flipLabel: (stationId: StationId) => void;
  mirrorLabel: (stationId: StationId) => void;
  setLabelOffset: (stationId: StationId, offset: number) => void;
  setLabelOffsetPerp: (stationId: StationId, offsetPerp: number) => void;
  setLabelAlign: (stationId: StationId, align: LabelAlign) => void;
  setLabelValign: (stationId: StationId, valign: LabelValign) => void;
  setLabelAutoAlign: (stationId: StationId, on: boolean) => void;
  setLabelAutoHAlign: (stationId: StationId, v: AutoHAlign | null) => void;
  setLabelAutoVAlign: (stationId: StationId, v: AutoVAlign | null) => void;

  addLine: () => LineId;
  updateLine: (id: LineId, patch: Partial<Pick<Line, 'service' | 'name' | 'color'>>) => void;
  toggleStationOnLine: (lineId: LineId, stationId: StationId, insertAfterIndex?: number) => void;
  addStationToLine: (lineId: LineId, stationId: StationId) => void;
  toggleEdgeOnLine: (lineId: LineId, a: StationId, b: StationId) => void;
  removeStationFromLine: (lineId: LineId, idx: number) => void;
  reorderLineStations: (lineId: LineId, stations: StationId[]) => void;
  setLineSegmentStyle: (
    lineId: LineId,
    fromStationId: StationId,
    toStationId: StationId,
    style: LineStyle,
  ) => void;
  cycleSegmentLayer: (
    lineId: LineId,
    fromStationId: StationId,
    toStationId: StationId,
    dir: -1 | 1,
  ) => void;
  setLineDefaultDotStyle: (lineId: LineId, style: DotStyle) => void;
  setLineDefaultDotSize: (lineId: LineId, size: number) => void;
  setLineWidth: (lineId: LineId, w: number) => void;
  setLineStrokeWidth: (lineId: LineId, w: number) => void;
  setLineStrokeColor: (lineId: LineId, c: string) => void;
  deleteLine: (id: LineId) => void;
  moveLineInOrder: (id: LineId, dir: -1 | 1) => void;

  addLineTag: (
    lineId: LineId,
    fromStationId: StationId,
    toStationId: StationId,
    anchorEnd: 'from' | 'to',
    distance: number,
    orientation: 0 | 1 | 2 | 3,
  ) => string;
  moveLineTag: (
    id: string,
    fromStationId: StationId,
    toStationId: StationId,
    anchorEnd: 'from' | 'to',
    distance: number,
  ) => void;
  cycleLineTagOrientation: (id: string) => void;
  deleteLineTag: (id: string) => void;

  addRouteBullet: (x: number, y: number, lineId: LineId | null) => string;
  addRouteBulletWith: (fields: Omit<RouteBullet, 'id'>) => string;
  duplicateRouteBullet: (id: string) => string | null;
  pasteRouteBullet: (data: Omit<RouteBullet, 'id'>) => string;
  moveRouteBullet: (id: string, x: number, y: number) => void;
  rotateRouteBullet: (id: string) => void;
  updateRouteBullet: (
    id: string,
    patch: Partial<Pick<RouteBullet, 'lineId' | 'shape' | 'size' | 'locked'>>,
  ) => void;
  deleteRouteBullet: (id: string) => void;

  addTransfer: (
    a: { stationId: StationId; lineId: LineId | null },
    b: { stationId: StationId; lineId: LineId | null },
  ) => string;
  updateTransferStyle: (id: string, patch: TransferStylePatch) => void;
  deleteTransfer: (id: string) => void;

  addTextLabel: (x: number, y: number) => string;
  addTextLabelWith: (fields: Omit<TextLabel, 'id'>) => string;
  pasteTextLabel: (data: Omit<TextLabel, 'id'>) => string;
  duplicateTextLabel: (id: string) => string | null;
  moveTextLabel: (id: string, x: number, y: number) => void;
  rotateTextLabel: (id: string) => void;
  updateTextLabel: (id: string, patch: Partial<Omit<TextLabel, 'id'>>) => void;
  deleteTextLabel: (id: string) => void;

  addPolygon: (x: number, y: number) => string;
  addPolygonWith: (fields: Omit<Polygon, 'id'>) => string;
  pastePolygon: (data: Omit<Polygon, 'id'>) => string;
  duplicatePolygon: (id: string) => string | null;
  setPolygonVertices: (id: string, vertices: Polygon['vertices']) => void;
  movePolygon: (id: string, dx: number, dy: number) => void;
  moveVertices: (id: string, indices: number[], dx: number, dy: number) => void;
  insertVertex: (id: string, edgeIndex: number) => void;
  deleteVertices: (id: string, indices: number[]) => void;
  updatePolygon: (id: string, patch: PolygonStylePatch) => void;
  rotatePolygon: (id: string) => void;
  movePolygonUp: (id: string) => void;
  movePolygonDown: (id: string) => void;
  deletePolygon: (id: string) => void;

  addSvgImage: (fields: Omit<SvgImage, 'id'>) => string;
  pasteSvgImage: (data: Omit<SvgImage, 'id'>) => string;
  duplicateSvgImage: (id: string) => string | null;
  moveSvgImage: (id: string, x: number, y: number) => void;
  updateSvgImage: (id: string, patch: SvgImageStylePatch) => void;
  rotateSvgImage45: (id: string) => void;
  moveSvgImageUp: (id: string) => void;
  moveSvgImageDown: (id: string) => void;
  deleteSvgImage: (id: string) => void;

  /** Define-by-example: capture `itemId`'s current EFFECTIVE formatting as
   *  the style named `name` — upsert-by-name per kind (à la addPalette), so
   *  saving under an existing name redefines that style and re-stamps its
   *  users in the same single undo entry. Returns the style id the name
   *  resolves to (nothing is written when the transform refuses — empty name
   *  or missing item). */
  saveStyle: (kind: StyleKind, name: string, itemId: string) => string;
  /** Stamp a style's props onto an item and tag it (one undo entry). */
  applyStyle: (styleId: string, itemId: string) => void;
  /** Detach an item to "Custom": drop the tag, keep the values. */
  clearStyleTag: (kind: StyleKind, itemId: string) => void;
  renameStyle: (styleId: string, name: string) => void;
  /** Delete a style def; its users keep their values but lose the tag. */
  deleteStyle: (styleId: string) => void;
  /** The Styles panel's "+ New style": a fresh def of `kind` with factory
   *  props under the first unused "New style N" name. Returns its id. */
  createStyle: (kind: StyleKind) => string;
  /** The Styles panel editor's write path: patch a def's props and re-stamp
   *  its tagged users live, all one undo entry. */
  updateStyleProps: (styleId: string, patch: S.StylePropsPatch) => void;
  /** The Styles panel's "make default": designate a style as its kind's
   *  default (new items of the kind are created wearing it). */
  setDefaultStyle: (styleId: string) => void;

  /** Replace the whole document (file load). Defaults fill any field the
   *  loaded doc omits. Callers should clearHistory() after — undo must not
   *  cross a file load. */
  loadDoc: (doc: MapDoc) => void;
  setDocName: (name: string) => void;
  setCurveRadius: (r: number) => void;
  /** The station popover's style section write path: patch a station's own
   *  typography (fontSize/weight/italic/leading/tracking), detaching its style
   *  tag when a covered value actually changes. */
  updateStationLabelStyle: (stationId: StationId, patch: T.StationLabelPatch) => void;
  setActivePalettes: (ids: PaletteId[]) => void;
  togglePalette: (id: PaletteId) => void;
  /** Delete a custom palette definition (from the custom-palette store) and
   *  prune it from this doc's active set, falling back to the default set if it
   *  was the only active palette. */
  deleteCustomPalette: (id: PaletteId) => void;
  clearAll: () => void;
}

export const useDoc = create<DocState>()(
  temporal(
    persist(
      (set, get) => ({
        ...DEFAULT_DOC,

        addStation: (x, y, name) => {
          const id = ids.stationId();
          const finalName = name ?? randomStationName();
          // Stamp + tag the new station with the designated default 'station'
          // style (its typography), like every other add action.
          set((s) => S.applyDefaultStyle(T.addStation(s, x, y, id, finalName), 'station', id));
          return id;
        },
        renameStation: (id, name) => set((s) => T.renameStation(s, id, name)),
        moveStation: (id, x, y) => set((s) => T.moveStation(s, id, x, y)),
        setDotStyle: (stationId, lineId, style) =>
          set((s) => T.setDotStyle(s, stationId, lineId, style)),
        setDotSize: (stationId, lineId, size) =>
          set((s) => T.setDotSize(s, stationId, lineId, size)),
        setStationWaypoint: (stationId, isWaypoint) =>
          set((s) => T.setStationWaypoint(s, stationId, isWaypoint)),
        setStationLocked: (stationId, locked) =>
          set((s) => T.setStationLocked(s, stationId, locked)),
        setStationEditorHeight: (stationId, height) =>
          set((s) => T.setStationEditorHeight(s, stationId, height)),
        redistributeBetween: (startId, endId, mode = 'arc-bends', gridMode = 'off') =>
          // gridMode is per-call intent (depends on Shift at the call site);
          // gridInterval is ambient, so read the active grid size from the
          // viewport store here rather than threading it through every caller.
          set((s) =>
            T.redistributeBetween(
              s,
              startId,
              endId,
              mode,
              gridMode,
              useViewportStore.getState().gridSize,
            ),
          ),
        rotateStation: (id, dir) => set((s) => T.rotateStation(s, id, dir)),
        rotateItemsAround: (pivot, members) => set((s) => T.rotateItemsAround(s, pivot, members)),
        rotateStationAndLayout: (id, dir) => set((s) => T.rotateStationAndLayout(s, id, dir)),
        deleteStation: (id) => set((s) => T.deleteStation(s, id)),

        moveStop: (stationId, lineId, dRow, dCol) =>
          set((s) => T.moveStop(s, stationId, lineId, dRow, dCol)),
        rotateStop: (stationId, lineId) => set((s) => T.rotateStop(s, stationId, lineId)),

        moveLabel: (stationId, dRow, dCol) => set((s) => T.moveLabel(s, stationId, dRow, dCol)),
        rotateLabel: (stationId) => set((s) => T.rotateLabel(s, stationId)),
        flipLabel: (stationId) => set((s) => T.flipLabel(s, stationId)),
        mirrorLabel: (stationId) => set((s) => T.mirrorLabel(s, stationId)),
        setLabelOffset: (stationId, offset) => set((s) => T.setLabelOffset(s, stationId, offset)),
        setLabelOffsetPerp: (stationId, offsetPerp) =>
          set((s) => T.setLabelOffsetPerp(s, stationId, offsetPerp)),
        setLabelAlign: (stationId, align) => set((s) => T.setLabelAlign(s, stationId, align)),
        setLabelValign: (stationId, valign) => set((s) => T.setLabelValign(s, stationId, valign)),
        setLabelAutoAlign: (stationId, on) => set((s) => T.setLabelAutoAlign(s, stationId, on)),
        setLabelAutoHAlign: (stationId, v) => set((s) => T.setLabelAutoHAlign(s, stationId, v)),
        setLabelAutoVAlign: (stationId, v) => set((s) => T.setLabelAutoVAlign(s, stationId, v)),

        addLine: () => {
          const id = ids.lineId();
          set((s) => {
            const cycle = cyclingColors(s.activePalettes, useCustomPalettes.getState().palettes);
            // Guard the empty cycle (e.g. every active id is a dangling custom
            // reference): `n % 0` is NaN, which would index `undefined`.
            const color = cycle.length ? cycle[s.lineCounter % cycle.length] : FALLBACK_LINE_COLOR;
            const service = pickNextLineName(s.lines);
            // New items wear the kind's "Default" style (composed into the
            // same set() so creation stays one undo entry). Color is identity,
            // not style — the cycled pick above survives the stamp.
            return S.applyDefaultStyle(T.addLine(s, id, service, color), 'line', id);
          });
          return id;
        },
        updateLine: (id, patch) => set((s) => T.updateLine(s, id, patch)),
        toggleStationOnLine: (lineId, stationId, insertAfterIndex) =>
          set((s) => T.toggleStationOnLine(s, lineId, stationId, insertAfterIndex)),
        addStationToLine: (lineId, stationId) =>
          set((s) => T.addStationToLine(s, lineId, stationId)),
        toggleEdgeOnLine: (lineId, a, b) => set((s) => T.toggleEdgeOnLine(s, lineId, a, b)),
        removeStationFromLine: (lineId, idx) => set((s) => T.removeStationFromLine(s, lineId, idx)),
        reorderLineStations: (lineId, stations) =>
          set((s) => T.reorderLineStations(s, lineId, stations)),
        setLineSegmentStyle: (lineId, fromStationId, toStationId, style) =>
          set((s) => T.setLineSegmentStyle(s, lineId, fromStationId, toStationId, style)),
        cycleSegmentLayer: (lineId, fromStationId, toStationId, dir) =>
          set((s) => T.cycleSegmentLayer(s, lineId, fromStationId, toStationId, dir)),
        setLineDefaultDotStyle: (lineId, style) =>
          set((s) => T.setLineDefaultDotStyle(s, lineId, style)),
        setLineDefaultDotSize: (lineId, size) =>
          set((s) => T.setLineDefaultDotSize(s, lineId, size)),
        setLineWidth: (lineId, w) => set((s) => T.setLineWidth(s, lineId, w)),
        setLineStrokeWidth: (lineId, w) => set((s) => T.setLineStrokeWidth(s, lineId, w)),
        setLineStrokeColor: (lineId, c) => set((s) => T.setLineStrokeColor(s, lineId, c)),
        deleteLine: (id) => set((s) => T.deleteLine(s, id)),
        moveLineInOrder: (id, dir) => set((s) => T.moveLineInOrder(s, id, dir)),

        addLineTag: (lineId, fromStationId, toStationId, anchorEnd, distance, orientation) => {
          const id = ids.lineTagId();
          set((s) =>
            T.addLineTag(
              s,
              id,
              lineId,
              fromStationId,
              toStationId,
              anchorEnd,
              distance,
              orientation,
            ),
          );
          return id;
        },
        moveLineTag: (id, fromStationId, toStationId, anchorEnd, distance) =>
          set((s) => T.moveLineTag(s, id, fromStationId, toStationId, anchorEnd, distance)),
        cycleLineTagOrientation: (id) => set((s) => T.cycleLineTagOrientation(s, id)),
        deleteLineTag: (id) => set((s) => T.deleteLineTag(s, id)),

        addRouteBullet: (x, y, lineId) => {
          const id = ids.routeBulletId();
          // New items wear the kind's "Default" style — same set(), one undo.
          set((s) => S.applyDefaultStyle(T.addRouteBullet(s, id, x, y, lineId), 'routeBullet', id));
          return id;
        },
        addRouteBulletWith: (fields) => {
          const id = ids.routeBulletId();
          set((s) => T.addRouteBulletWith(s, id, fields));
          return id;
        },
        // Add a bullet from a clipboard payload, nudged by the drop offset. The
        // fresh copy comes out UNLOCKED even if the source was locked, so it's
        // immediately movable (mirrors pastePolygon / pasteTextLabel). The
        // restamp pass repairs a stale tagged payload — the clipboard froze
        // the values, the style may have been redefined since the copy — in
        // the SAME set(), so a paste stays one undo entry.
        pasteRouteBullet: (data) => {
          const { locked: _locked, ...rest } = data;
          const id = ids.routeBulletId();
          set((s) =>
            S.restampStyleTag(
              T.addRouteBulletWith(s, id, {
                ...rest,
                x: data.x + DROP_OFFSET,
                y: data.y + DROP_OFFSET,
              }),
              'routeBullet',
              id,
            ),
          );
          return id;
        },
        // Duplicate an existing bullet at the drop offset; null if it's gone.
        duplicateRouteBullet: (id) => duplicateVia(get().routeBullets, id, get().pasteRouteBullet),
        moveRouteBullet: (id, x, y) => set((s) => T.moveRouteBullet(s, id, x, y)),
        rotateRouteBullet: (id) => set((s) => T.rotateRouteBullet(s, id)),
        updateRouteBullet: (id, patch) => set((s) => T.updateRouteBullet(s, id, patch)),
        deleteRouteBullet: (id) => set((s) => T.deleteRouteBullet(s, id)),

        addTransfer: (a, b) => {
          const id = ids.transferId();
          // New items wear the kind's "Default" style — same set(), one undo.
          // addTransfer can refuse (self-transfer); the stamp no-ops then.
          set((s) => S.applyDefaultStyle(T.addTransfer(s, id, a, b), 'transfer', id));
          return id;
        },

        updateTransferStyle: (id, patch) => set((s) => T.updateTransferStyle(s, id, patch)),

        deleteTransfer: (id) => set((s) => T.deleteTransfer(s, id)),

        addTextLabel: (x, y) => {
          const id = ids.textLabelId();
          // New items wear the kind's "Default" style — same set(), one undo.
          set((s) => S.applyDefaultStyle(T.addTextLabel(s, id, x, y), 'textLabel', id));
          return id;
        },
        addTextLabelWith: (fields) => {
          const id = ids.textLabelId();
          set((s) => T.addTextLabelWith(s, id, fields));
          return id;
        },
        // Add a label from a clipboard payload, nudged by the drop offset. The
        // fresh copy comes out UNLOCKED even if the source was locked, so it's
        // immediately movable (mirrors pastePolygon / pasteRouteBullet). The
        // restamp pass repairs a stale tagged payload in the same set() —
        // see pasteRouteBullet.
        pasteTextLabel: (data) => {
          const { locked: _locked, ...rest } = data;
          const id = ids.textLabelId();
          set((s) =>
            S.restampStyleTag(
              T.addTextLabelWith(s, id, {
                ...rest,
                x: data.x + DROP_OFFSET,
                y: data.y + DROP_OFFSET,
              }),
              'textLabel',
              id,
            ),
          );
          return id;
        },
        // Duplicate an existing label at the drop offset; null if it's gone.
        duplicateTextLabel: (id) => duplicateVia(get().textLabels, id, get().pasteTextLabel),
        moveTextLabel: (id, x, y) => set((s) => T.moveTextLabel(s, id, x, y)),
        rotateTextLabel: (id) => set((s) => T.rotateTextLabel(s, id)),
        updateTextLabel: (id, patch) => set((s) => T.updateTextLabel(s, id, patch)),
        deleteTextLabel: (id) => set((s) => T.deleteTextLabel(s, id)),

        addPolygon: (x, y) => {
          const id = ids.polygonId();
          // New items wear the kind's "Default" style — same set(), one undo.
          set((s) => S.applyDefaultStyle(T.addPolygon(s, id, x, y), 'polygon', id));
          return id;
        },
        addPolygonWith: (fields) => {
          const id = ids.polygonId();
          set((s) => T.addPolygonWith(s, id, fields));
          return id;
        },
        // Add a polygon from a clipboard payload, translating every vertex by
        // the drop offset (polygons have no center — geometry lives in
        // `vertices`, in world coords). The fresh copy comes out UNLOCKED even
        // if the source was locked, so it's immediately movable/editable. The
        // restamp pass repairs a stale tagged payload in the same set() —
        // see pasteRouteBullet.
        pastePolygon: (data) => {
          const { locked: _locked, ...rest } = data;
          const id = ids.polygonId();
          set((s) =>
            S.restampStyleTag(
              T.addPolygonWith(s, id, {
                ...rest,
                vertices: data.vertices.map((v) => ({
                  x: v.x + DROP_OFFSET,
                  y: v.y + DROP_OFFSET,
                })),
              }),
              'polygon',
              id,
            ),
          );
          return id;
        },
        // Duplicate an existing polygon at the drop offset; null if it's gone.
        duplicatePolygon: (id) => duplicateVia(get().polygons, id, get().pastePolygon),
        setPolygonVertices: (id, vertices) => set((s) => T.setPolygonVertices(s, id, vertices)),
        movePolygon: (id, dx, dy) => set((s) => T.movePolygon(s, id, dx, dy)),
        moveVertices: (id, indices, dx, dy) => set((s) => T.moveVertices(s, id, indices, dx, dy)),
        insertVertex: (id, edgeIndex) => set((s) => T.insertVertex(s, id, edgeIndex)),
        deleteVertices: (id, indices) => set((s) => T.deleteVertices(s, id, indices)),
        updatePolygon: (id, patch) => set((s) => T.updatePolygon(s, id, patch)),
        rotatePolygon: (id) => set((s) => T.rotatePolygon(s, id)),
        movePolygonUp: (id) => set((s) => T.movePolygonUp(s, id)),
        movePolygonDown: (id) => set((s) => T.movePolygonDown(s, id)),
        deletePolygon: (id) => set((s) => T.deletePolygon(s, id)),

        addSvgImage: (fields) => {
          const id = ids.svgImageId();
          set((s) => T.addSvgImage(s, id, fields));
          return id;
        },
        // Paste an svg image from a clipboard payload, offsetting its CENTER by
        // the drop offset (an image has a center, unlike a polygon's vertices).
        // The copy comes out UNLOCKED even if the source was locked.
        pasteSvgImage: (data) => {
          const { locked: _locked, ...rest } = data;
          return get().addSvgImage({ ...rest, x: data.x + DROP_OFFSET, y: data.y + DROP_OFFSET });
        },
        // Duplicate an existing svg image at the drop offset; null if it's gone.
        duplicateSvgImage: (id) => duplicateVia(get().svgImages, id, get().pasteSvgImage),
        // Absolute center move — used by whole-image drag, group-tow, and nudge.
        moveSvgImage: (id, x, y) => set((s) => T.setSvgImageCenter(s, id, x, y)),
        updateSvgImage: (id, patch) => set((s) => T.updateSvgImage(s, id, patch)),
        // Single 45°-clockwise step for the right-click rotate (mirrors
        // rotatePolygon); updateSvgImage normalizes the result into [0, 360).
        rotateSvgImage45: (id) =>
          set((s) => T.updateSvgImage(s, id, { rotation: (s.svgImages[id]?.rotation ?? 0) + 45 })),
        moveSvgImageUp: (id) => set((s) => T.moveSvgImageUp(s, id)),
        moveSvgImageDown: (id) => set((s) => T.moveSvgImageDown(s, id)),
        deleteSvgImage: (id) => set((s) => T.deleteSvgImage(s, id)),

        // Each style action is one atomic set() over one pure transform, so a
        // multi-item fan-out (save re-stamping every user, delete untagging
        // them) is exactly one undo entry — no history group needed.
        saveStyle: (kind, name, itemId) => {
          const trimmed = name.trim();
          const existing = Object.values(get().styles).find(
            (d) => d.kind === kind && d.name === trimmed,
          );
          const id = existing?.id ?? ids.styleId();
          set((s) => S.saveStyleFromItem(s, id, kind, trimmed, itemId));
          return id;
        },
        applyStyle: (styleId, itemId) => set((s) => S.applyStyleToItem(s, styleId, itemId)),
        clearStyleTag: (kind, itemId) => set((s) => S.clearStyleTag(s, kind, itemId)),
        renameStyle: (styleId, name) => set((s) => S.renameStyle(s, styleId, name)),
        deleteStyle: (styleId) => set((s) => S.deleteStyle(s, styleId)),
        createStyle: (kind) => {
          const id = ids.styleId();
          // First unused "New style N" within the kind, so create never
          // collides (the transform refuses duplicates).
          const taken = new Set(
            Object.values(get().styles)
              .filter((d) => d.kind === kind)
              .map((d) => d.name),
          );
          let name = 'New style';
          for (let n = 2; taken.has(name); n++) name = `New style ${n}`;
          set((s) => S.createStyle(s, id, kind, name));
          return id;
        },
        updateStyleProps: (styleId, patch) => set((s) => S.updateStyleProps(s, styleId, patch)),
        setDefaultStyle: (styleId) => set((s) => S.setDefaultStyle(s, styleId)),

        // A plain merge: doc fields are replaced, mutator methods survive.
        loadDoc: (doc) => set({ ...DEFAULT_DOC, ...doc }),
        setDocName: (name) => set((s) => T.setDocName(s, name)),
        setCurveRadius: (r) => set((s) => T.setCurveRadius(s, r)),
        updateStationLabelStyle: (stationId, patch) =>
          set((s) => T.updateStationLabelStyle(s, stationId, patch)),
        setActivePalettes: (idsArr) =>
          set((s) => T.setActivePalettes(s, idsArr, useCustomPalettes.getState().palettes)),
        togglePalette: (id) =>
          set((s) => T.togglePalette(s, id, useCustomPalettes.getState().palettes)),
        deleteCustomPalette: (id) => {
          useCustomPalettes.getState().removePalette(id);
          set((s) => {
            const custom = useCustomPalettes.getState().palettes;
            const next = s.activePalettes.filter((x) => x !== id);
            // Keep the "≥1 active palette" invariant: if deleting the sole active
            // palette would empty the set, fall back to the default.
            return T.setActivePalettes(
              s,
              next.length ? next : [...DEFAULT_DOC.activePalettes],
              custom,
            );
          });
        },
        clearAll: () => set((s) => T.clearAll(s)),
      }),
      {
        name: 'vignelli-map-doc-v1',
        storage: createJSONStorage(() => localStorage),
        version: 14,
        // Version migration chain v0 → v14 lives in `migrateDoc` (above), which
        // is exported and unit-tested. See its doc comment for each step.
        migrate: (persisted, version) => migrateDoc(persisted, version),
        partialize: (s) => pickDocSnapshot(s),
      },
    ),
    {
      // Track only the document data — viewport and selection are in their
      // own stores, and the mutator method references never change so they're
      // safe to leave in (Object.assign on undo preserves them).
      //
      // `equality` skips recording when the partialized snapshot is value-
      // identical to the previous one. zundo has no diff/equality by default,
      // and `pickDocSnapshot` allocates a fresh object on every `set`, so
      // without this an ungrouped mutator that no-ops (a transform that returns
      // the doc unchanged) would still push a redundant past entry — making one
      // Ctrl+Z appear to do nothing. The grouped path (beginHistoryGroup) runs
      // the same check before pushing; this extends it to the ungrouped writes.
      equality: docSnapshotsEqual,
      partialize: (state) => pickDocSnapshot(state),
      limit: HISTORY_LIMIT,
    },
  ),
);

// The one currently-open history group, if any — the ownership reference
// behind the steal-on-begin overlap contract documented on beginHistoryGroup.
let openHistoryGroup: { commit: () => void; cancel: () => void } | null = null;

/**
 * Cancel the currently-open history group, if any. Called by clearHistory():
 * a group open across a file load holds a snapshot of the REPLACED document,
 * so neither its own late end (a blur landing after the load) nor the next
 * begin's steal may push it — undo must never cross a file load.
 */
export function cancelOpenHistoryGroup(): void {
  openHistoryGroup?.cancel();
}

/**
 * Open a history "group" around a multi-step user action — a station drag
 * (many moveStation calls between pointerdown and pointerup), a text-input
 * edit (many onChange calls between focus and blur), a slider drag, etc.
 *
 * Captures the current doc state and pauses recording. Calling `commit()`
 * resumes recording and pushes exactly one history entry — the captured
 * pre-action snapshot — covering everything that happened in between.
 * If nothing actually changed (focus → blur with no edits, click without
 * drag), `commit()` is a no-op so we don't litter history with empty entries.
 * `cancel()` resumes without pushing anything; equivalent to commit() when
 * no changes occurred but explicit at the call site. `rollback()` goes
 * further: it RESTORES the captured pre-action snapshot before resuming, so a
 * gesture that already wrote to the doc (a live drag, a fine-mode offset edit)
 * is fully reverted, leaving neither a history entry nor a lingering mutation.
 * Use it to abort a mid-flight gesture (e.g. a browser pointercancel) — plain
 * cancel() would resume recording but strand the half-applied writes.
 *
 * Groups do NOT nest: callers that may run inside an already-open group (e.g.
 * a mirror broadcast fired from a focused numeric field's edit arc) must gate
 * on `isHistoryGrouping()` and skip opening their own group — the outer group
 * already collapses their writes into its single entry.
 *
 * Groups CAN overlap without nesting, though: two independent gestures own
 * their own begin/end pairs, and pointer order is pointerdown → blur, so
 * pressing a canvas drag handle opens the drag's group BEFORE a focused
 * field's blur-commit lands. The newer gesture steals: begin seals any
 * still-open group (committing it exactly as its own end would), and the
 * elder's late commit/cancel/rollback is a no-op via its `done` flag. Without
 * the steal, the elder's late commit would resume recording inside the newer
 * group — every write then records its own entry plus a stray snapshot on
 * top, leaving undo non-monotonic.
 */
export function beginHistoryGroup(): {
  commit: () => void;
  cancel: () => void;
  rollback: () => void;
} {
  // Seal any still-open group (see the overlap contract above). Also the
  // self-heal for LEAKED groups — a gesture that died without ending leaves
  // recording paused only until the next begin, which recovers its edits as a
  // real entry. openHistoryGroup is a last-writer-wins reference, never a
  // depth counter, so a leak can strand at most one group and never corrupts
  // later pairings.
  openHistoryGroup?.commit();

  const snapshot = pickDocSnapshot(useDoc.getState());
  pauseHistory();
  let done = false;
  // Shared first step of every ender: run once, and release ownership only if
  // this group still holds it (a stolen group must not null out its stealer).
  const finish = (): boolean => {
    if (done) return false;
    done = true;
    if (openHistoryGroup === group) openHistoryGroup = null;
    return true;
  };
  const group = {
    commit: () => {
      if (!finish()) return;
      resumeHistory();
      const cur = pickDocSnapshot(useDoc.getState());
      // Reference-equality check across every tracked doc field. Transforms
      // produce new objects only when something changes, so this is sound.
      if (docSnapshotsEqual(cur, snapshot)) return;
      // One entry covering the whole group; the adapter owns the zundo shape.
      pushHistory(snapshot);
    },
    cancel: () => {
      if (!finish()) return;
      resumeHistory();
    },
    rollback: () => {
      if (!finish()) return;
      // Restore the pre-group doc, then resume WITHOUT pushing. Still paused
      // here, so the restore itself records nothing (mirrors how zundo's own
      // undo reapplies a partialized snapshot). Skip the write when nothing
      // changed — a gesture that only drew overlays leaves the doc untouched.
      const cur = pickDocSnapshot(useDoc.getState());
      if (!docSnapshotsEqual(cur, snapshot)) useDoc.setState(snapshot);
      resumeHistory();
    },
  };
  openHistoryGroup = group;
  return group;
}

/**
 * Cancel append-to-line mode and garbage-collect a freshly-created empty
 * line. "Add → Line" commits the line eagerly so the inspector and banner
 * can preview its color/service letter; if the user cancels (Esc, right-
 * click, or canvas-background click) before adding any stations, that
 * placeholder has no presence on the map and should disappear with the mode.
 */
export function cancelAppendMode(): void {
  const sel = useSelection.getState();
  const cur = sel.uiMode;
  const lineId = cur.kind === 'appending-to-line' ? cur.lineId : null;
  if (lineId) {
    const doc = useDoc.getState();
    const line = doc.lines[lineId];
    if (line && line.stations.length === 0) {
      // The placeholder line was committed eagerly by addLine, which also
      // advanced lineCounter to pick its color. Cancelling before any station
      // is placed must undo BOTH in one atomic set, so repeated Add→Esc doesn't
      // walk the color cycle forward. (Real line deletion via T.deleteLine
      // leaves lineCounter alone, which is why the rollback lives here.)
      useDoc.setState((s) => ({
        ...T.deleteLine(s, lineId),
        lineCounter: Math.max(0, s.lineCounter - 1),
      }));
    }
  }
  sel.setAppending(null);
}

/**
 * The line editor is "open" when a line is selected (the LineInspector plus the
 * dim / direction-arrow highlight are showing) and no sub-mode is active. A
 * canvas click on some OTHER item then counts as "click off the line to exit":
 * it deselects the line and reports that it consumed the click, so the caller
 * does NOT select the item under the cursor. Returns false (caller proceeds
 * normally) otherwise.
 *
 * Stations and lines are exempt and never route through here: clicking a station
 * exits the editor and selects it (stations belong to the line), and clicking
 * another line stripe switches the editor to that line.
 */
export function exitLineEditorOnItemClick(): boolean {
  const sel = useSelection.getState();
  if (sel.selectedLineId == null || sel.uiMode.kind !== 'idle') return false;
  sel.selectLine(null);
  return true;
}

// ----- Drag-vs-click suppression (module-level, not persisted) -----
export const dragState = { suppressClick: false };

// Selection state lives in its own store (./selection); re-exported here so
// existing imports from this module keep working unchanged.
export { useSelection };
export {
  RIGHT_CLICK_PASSTHROUGH_MODES,
  soleSelection,
  getCopyableSelection,
  type SoleSelection,
  type UiMode,
  type LineTagHoverPreview,
  type SidebarTab,
} from './selection';
