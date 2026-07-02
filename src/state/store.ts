import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { temporal } from 'zundo';
import type { GridSnap } from '../geometry/snap';
import type {
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
  SvgImage,
  SvgImageStylePatch,
  TextLabel,
  TextLabelWeight,
} from '../model/types';
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
  backfillPolygonDarkColors,
  backfillTextLabelColors,
  convertLegacyDotShapes,
  validActivePalettes,
} from '../model/serialize';
import type { Station } from '../model/types';
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
  'labelFontSize',
  'labelWeight',
  'labelItalic',
  'activePalettes',
  'transferThickness',
  'transferColor',
  'transferStrokeWidth',
  'transferStrokeColor',
] as const;
type DocFieldName = (typeof DOC_FIELDS)[number];
export type DocSnapshot = Pick<MapDoc, DocFieldName>;

// Undo-stack cap. zundo applies it to ungrouped writes via its `limit` option;
// pushHistory (the grouped-gesture path) must apply the same cap itself.
export const HISTORY_LIMIT = 200;

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
 * Persisted-document version migration (v0 → v7). Exported and pure so it can
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
 */
export function migrateDoc(persisted: unknown, version: number): DocState {
  const s = persisted as {
    lines?: Record<LineId, Line>;
    stations?: Record<string, Station>;
    polygons?: Record<string, Polygon>;
    textLabels?: Record<string, TextLabel>;
    labelBold?: boolean;
    labelWeight?: TextLabelWeight;
    activePalettes?: PaletteId[];
  };
  // Corrupt or missing version is treated as v0 so all migrations run —
  // preferable to silently rendering with stale data.
  const v = typeof version === 'number' ? version : 0;
  // Blocks operate on disjoint fields, so order is immaterial.
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
  if (v < 3 && 'labelBold' in out) {
    const { labelBold, ...rest } = out;
    // Existing `labelWeight` wins if both fields are present.
    if (rest.labelWeight === undefined) {
      out = { ...rest, labelWeight: labelBold ? 700 : 400 };
    } else {
      out = rest;
    }
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

  addLine: () => LineId;
  updateLine: (id: LineId, patch: Partial<Pick<Line, 'service' | 'name' | 'color'>>) => void;
  toggleStationOnLine: (lineId: LineId, stationId: StationId, insertAfterIndex?: number) => void;
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
  moveVertex: (id: string, index: number, x: number, y: number) => void;
  insertVertex: (id: string, edgeIndex: number) => void;
  deleteVertex: (id: string, index: number) => void;
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

  /** Replace the whole document (file load). Defaults fill any field the
   *  loaded doc omits. Callers should clearHistory() after — undo must not
   *  cross a file load. */
  loadDoc: (doc: MapDoc) => void;
  setDocName: (name: string) => void;
  setCurveRadius: (r: number) => void;
  setLabelFontSize: (n: number) => void;
  setLabelWeight: (w: TextLabelWeight) => void;
  setStationLabelBold: (stationId: StationId, bold: boolean) => void;
  setStationLabelItalic: (stationId: StationId, italic: boolean) => void;
  setLabelItalic: (i: boolean) => void;
  setActivePalettes: (ids: PaletteId[]) => void;
  togglePalette: (id: PaletteId) => void;
  /** Delete a custom palette definition (from the custom-palette store) and
   *  prune it from this doc's active set, falling back to the default set if it
   *  was the only active palette. */
  deleteCustomPalette: (id: PaletteId) => void;
  setTransferThickness: (n: number) => void;
  setTransferColor: (c: string) => void;
  setTransferStrokeWidth: (n: number) => void;
  setTransferStrokeColor: (c: string) => void;
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
          set((s) => T.addStation(s, x, y, id, finalName));
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

        addLine: () => {
          const id = ids.lineId();
          set((s) => {
            const cycle = cyclingColors(s.activePalettes, useCustomPalettes.getState().palettes);
            // Guard the empty cycle (e.g. every active id is a dangling custom
            // reference): `n % 0` is NaN, which would index `undefined`.
            const color = cycle.length ? cycle[s.lineCounter % cycle.length] : FALLBACK_LINE_COLOR;
            const service = pickNextLineName(s.lines);
            return T.addLine(s, id, service, color);
          });
          return id;
        },
        updateLine: (id, patch) => set((s) => T.updateLine(s, id, patch)),
        toggleStationOnLine: (lineId, stationId, insertAfterIndex) =>
          set((s) => T.toggleStationOnLine(s, lineId, stationId, insertAfterIndex)),
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
          set((s) => T.addRouteBullet(s, id, x, y, lineId));
          return id;
        },
        addRouteBulletWith: (fields) => {
          const id = ids.routeBulletId();
          set((s) => T.addRouteBulletWith(s, id, fields));
          return id;
        },
        // Add a bullet from a clipboard payload, nudged by the drop offset. The
        // fresh copy comes out UNLOCKED even if the source was locked, so it's
        // immediately movable (mirrors pastePolygon / pasteTextLabel).
        pasteRouteBullet: (data) => {
          const { locked: _locked, ...rest } = data;
          return get().addRouteBulletWith({
            ...rest,
            x: data.x + DROP_OFFSET,
            y: data.y + DROP_OFFSET,
          });
        },
        // Duplicate an existing bullet at the drop offset; null if it's gone.
        duplicateRouteBullet: (id) => {
          const b = get().routeBullets[id];
          if (!b) return null;
          const { id: _id, ...data } = b;
          return get().pasteRouteBullet(data);
        },
        moveRouteBullet: (id, x, y) => set((s) => T.moveRouteBullet(s, id, x, y)),
        rotateRouteBullet: (id) => set((s) => T.rotateRouteBullet(s, id)),
        updateRouteBullet: (id, patch) => set((s) => T.updateRouteBullet(s, id, patch)),
        deleteRouteBullet: (id) => set((s) => T.deleteRouteBullet(s, id)),

        addTransfer: (a, b) => {
          const id = ids.transferId();
          set((s) => T.addTransfer(s, id, a, b));
          return id;
        },

        deleteTransfer: (id) => set((s) => T.deleteTransfer(s, id)),

        addTextLabel: (x, y) => {
          const id = ids.textLabelId();
          set((s) => T.addTextLabel(s, id, x, y));
          return id;
        },
        addTextLabelWith: (fields) => {
          const id = ids.textLabelId();
          set((s) => T.addTextLabelWith(s, id, fields));
          return id;
        },
        // Add a label from a clipboard payload, nudged by the drop offset. The
        // fresh copy comes out UNLOCKED even if the source was locked, so it's
        // immediately movable (mirrors pastePolygon / pasteRouteBullet).
        pasteTextLabel: (data) => {
          const { locked: _locked, ...rest } = data;
          return get().addTextLabelWith({
            ...rest,
            x: data.x + DROP_OFFSET,
            y: data.y + DROP_OFFSET,
          });
        },
        // Duplicate an existing label at the drop offset; null if it's gone.
        duplicateTextLabel: (id) => {
          const l = get().textLabels[id];
          if (!l) return null;
          const { id: _id, ...data } = l;
          return get().pasteTextLabel(data);
        },
        moveTextLabel: (id, x, y) => set((s) => T.moveTextLabel(s, id, x, y)),
        rotateTextLabel: (id) => set((s) => T.rotateTextLabel(s, id)),
        updateTextLabel: (id, patch) => set((s) => T.updateTextLabel(s, id, patch)),
        deleteTextLabel: (id) => set((s) => T.deleteTextLabel(s, id)),

        addPolygon: (x, y) => {
          const id = ids.polygonId();
          set((s) => T.addPolygon(s, id, x, y));
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
        // if the source was locked, so it's immediately movable/editable.
        pastePolygon: (data) => {
          const { locked: _locked, ...rest } = data;
          return get().addPolygonWith({
            ...rest,
            vertices: data.vertices.map((v) => ({ x: v.x + DROP_OFFSET, y: v.y + DROP_OFFSET })),
          });
        },
        // Duplicate an existing polygon at the drop offset; null if it's gone.
        duplicatePolygon: (id) => {
          const p = get().polygons[id];
          if (!p) return null;
          const { id: _id, ...data } = p;
          return get().pastePolygon(data);
        },
        setPolygonVertices: (id, vertices) => set((s) => T.setPolygonVertices(s, id, vertices)),
        movePolygon: (id, dx, dy) => set((s) => T.movePolygon(s, id, dx, dy)),
        moveVertex: (id, index, x, y) => set((s) => T.moveVertex(s, id, index, x, y)),
        insertVertex: (id, edgeIndex) => set((s) => T.insertVertex(s, id, edgeIndex)),
        deleteVertex: (id, index) => set((s) => T.deleteVertex(s, id, index)),
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
        duplicateSvgImage: (id) => {
          const im = get().svgImages[id];
          if (!im) return null;
          const { id: _id, ...data } = im;
          return get().pasteSvgImage(data);
        },
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

        // A plain merge: doc fields are replaced, mutator methods survive.
        loadDoc: (doc) => set({ ...DEFAULT_DOC, ...doc }),
        setDocName: (name) => set((s) => T.setDocName(s, name)),
        setCurveRadius: (r) => set((s) => T.setCurveRadius(s, r)),
        setLabelFontSize: (n) => set((s) => T.setLabelFontSize(s, n)),
        setLabelWeight: (w) => set((s) => T.setLabelWeight(s, w)),
        setStationLabelBold: (stationId, bold) =>
          set((s) => T.setStationLabelBold(s, stationId, bold)),
        setStationLabelItalic: (stationId, italic) =>
          set((s) => T.setStationLabelItalic(s, stationId, italic)),
        setLabelItalic: (i) => set((s) => T.setLabelItalic(s, i)),
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
        setTransferThickness: (n) => set((s) => T.setTransferThickness(s, n)),
        setTransferColor: (c) => set((s) => T.setTransferColor(s, c)),
        setTransferStrokeWidth: (n) => set((s) => T.setTransferStrokeWidth(s, n)),
        setTransferStrokeColor: (c) => set((s) => T.setTransferStrokeColor(s, c)),
        clearAll: () => set((s) => T.clearAll(s)),
      }),
      {
        name: 'vignelli-map-doc-v1',
        storage: createJSONStorage(() => localStorage),
        version: 7,
        // Version migration chain v0 → v7 lives in `migrateDoc` (above), which
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
 * already collapses their writes into its single entry. Opening a second group
 * here would resume recording mid-gesture and push a stray snapshot.
 */
export function beginHistoryGroup(): {
  commit: () => void;
  cancel: () => void;
  rollback: () => void;
} {
  const snapshot = pickDocSnapshot(useDoc.getState());
  pauseHistory();
  let done = false;
  return {
    commit: () => {
      if (done) return;
      done = true;
      resumeHistory();
      const cur = pickDocSnapshot(useDoc.getState());
      // Reference-equality check across every tracked doc field. Transforms
      // produce new objects only when something changes, so this is sound.
      if (docSnapshotsEqual(cur, snapshot)) return;
      // One entry covering the whole group; the adapter owns the zundo shape.
      pushHistory(snapshot);
    },
    cancel: () => {
      if (done) return;
      done = true;
      resumeHistory();
    },
    rollback: () => {
      if (done) return;
      done = true;
      // Restore the pre-group doc, then resume WITHOUT pushing. Still paused
      // here, so the restore itself records nothing (mirrors how zundo's own
      // undo reapplies a partialized snapshot). Skip the write when nothing
      // changed — a gesture that only drew overlays leaves the doc untouched.
      const cur = pickDocSnapshot(useDoc.getState());
      if (!docSnapshotsEqual(cur, snapshot)) useDoc.setState(snapshot);
      resumeHistory();
    },
  };
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
