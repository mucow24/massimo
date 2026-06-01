import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { temporal } from 'zundo';
import type {
  DotShape,
  LabelAlign,
  LabelValign,
  Line,
  LineId,
  LineStyle,
  MapDoc,
  Polygon,
  RouteBullet,
  StationId,
  TextLabel,
  TextLabelWeight,
} from '../model/types';
import { useSelection } from './selection';
import { effectiveLineOrder } from '../model/lineOrder';
import { defaultIdFactory, IdFactory } from '../model/ids';
import { DEFAULT_DOC } from '../model/transforms';
import * as T from '../model/transforms';
import { cyclingColors, type PaletteId } from '../model/palettes';
import { sanitizeStations } from '../model/serialize';
import type { Station } from '../model/types';
import { randomStationName } from './stationNames';
import { pauseHistory, pushHistory, resumeHistory } from './history';

// Re-export so callers (Sidebar, etc.) keep working with one source of truth.
export { effectiveLineOrder };

// Auto-name sequence: A, B, ..., Z, 0, 1, ..., 9, AA, AB, ..., AZ, A0, ..., A9, BA, ...
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const nameForIndex = (n: number): string => {
  const len = ALPHABET.length; // 36
  if (n < len) return ALPHABET[n];
  const m = n - len;
  const first = Math.floor(m / len);
  const second = m % len;
  if (first < 26) return ALPHABET[first] + ALPHABET[second];
  return '?'; // overflow; unlikely for v1
};

const pickNextLineName = (lines: Record<LineId, Line>): string => {
  const taken = new Set(Object.values(lines).map((l) => l.service));
  for (let i = 0; i < 26 * 36 + 36; i++) {
    const candidate = nameForIndex(i);
    if (!taken.has(candidate)) return candidate;
  }
  return '?';
};

const ids: IdFactory = defaultIdFactory();

// Offset applied when pasting or duplicating a route bullet, so the copy lands
// just off the original instead of exactly on top of it.
const ROUTE_BULLET_DROP_OFFSET = 15;

// Single source of truth for which MapDoc fields are part of the persisted /
// undoable document. Drives partialize (persist + zundo), DocSnapshot,
// pickDocSnapshot, and the change-detection equality check in
// beginHistoryGroup. Adding a new doc field is a one-line edit here.
const DOC_FIELDS = [
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

interface DocState extends MapDoc {
  // mutators
  addStation: (x: number, y: number, name?: string) => StationId;
  renameStation: (id: StationId, name: string) => void;
  moveStation: (id: StationId, x: number, y: number) => void;
  setDotShape: (stationId: StationId, lineId: LineId, shape: DotShape) => void;
  setStationWaypoint: (stationId: StationId, isWaypoint: boolean) => void;
  redistributeBetween: (
    startId: StationId,
    endId: StationId,
    mode?: 'arc-bends' | 'straight',
  ) => void;
  rotateStation: (id: StationId) => void;
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
  cycleLabelAlign: (stationId: StationId) => void;
  setLabelAlign: (stationId: StationId, align: LabelAlign) => void;
  cycleLabelValign: (stationId: StationId) => void;
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
  setLineDefaultDotShape: (lineId: LineId, shape: DotShape) => void;
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
    patch: Partial<Pick<RouteBullet, 'lineId' | 'shape' | 'size'>>,
  ) => void;
  deleteRouteBullet: (id: string) => void;

  addTransfer: (
    a: { stationId: StationId; lineId: LineId | null },
    b: { stationId: StationId; lineId: LineId | null },
  ) => string;
  deleteTransfer: (id: string) => void;

  addTextLabel: (x: number, y: number) => string;
  addTextLabelWith: (fields: Omit<TextLabel, 'id'>) => string;
  moveTextLabel: (id: string, x: number, y: number) => void;
  rotateTextLabel: (id: string) => void;
  updateTextLabel: (id: string, patch: Partial<Omit<TextLabel, 'id'>>) => void;
  deleteTextLabel: (id: string) => void;

  addPolygon: (x: number, y: number) => string;
  addPolygonWith: (fields: Omit<Polygon, 'id'>) => string;
  setPolygonVertices: (id: string, vertices: Polygon['vertices']) => void;
  moveVertex: (id: string, index: number, x: number, y: number) => void;
  insertVertex: (id: string, edgeIndex: number) => void;
  deleteVertex: (id: string, index: number) => void;
  updatePolygon: (
    id: string,
    patch: Partial<
      Pick<Polygon, 'fill' | 'stroke' | 'strokeWidth' | 'fillOpacity' | 'locked' | 'vertices'>
    >,
  ) => void;
  rotatePolygon: (id: string) => void;
  movePolygonUp: (id: string) => void;
  movePolygonDown: (id: string) => void;
  deletePolygon: (id: string) => void;

  setCurveRadius: (r: number) => void;
  setLabelFontSize: (n: number) => void;
  setLabelWeight: (w: TextLabelWeight) => void;
  setStationLabelBold: (stationId: StationId, bold: boolean) => void;
  setStationLabelItalic: (stationId: StationId, italic: boolean) => void;
  setLabelItalic: (i: boolean) => void;
  setActivePalettes: (ids: PaletteId[]) => void;
  togglePalette: (id: PaletteId) => void;
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
        setDotShape: (stationId, lineId, shape) =>
          set((s) => T.setDotShape(s, stationId, lineId, shape)),
        setStationWaypoint: (stationId, isWaypoint) =>
          set((s) => T.setStationWaypoint(s, stationId, isWaypoint)),
        redistributeBetween: (startId, endId, mode = 'arc-bends') =>
          set((s) => T.redistributeBetween(s, startId, endId, mode)),
        rotateStation: (id) => set((s) => T.rotateStation(s, id)),
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
        cycleLabelAlign: (stationId) => set((s) => T.cycleLabelAlign(s, stationId)),
        setLabelAlign: (stationId, align) => set((s) => T.setLabelAlign(s, stationId, align)),
        cycleLabelValign: (stationId) => set((s) => T.cycleLabelValign(s, stationId)),
        setLabelValign: (stationId, valign) => set((s) => T.setLabelValign(s, stationId, valign)),

        addLine: () => {
          const id = ids.lineId();
          set((s) => {
            const cycle = cyclingColors(s.activePalettes);
            const color = cycle[s.lineCounter % cycle.length];
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
        setLineDefaultDotShape: (lineId, shape) =>
          set((s) => T.setLineDefaultDotShape(s, lineId, shape)),
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
        // Add a bullet from a clipboard payload, nudged by the drop offset.
        pasteRouteBullet: (data) =>
          get().addRouteBulletWith({
            ...data,
            x: data.x + ROUTE_BULLET_DROP_OFFSET,
            y: data.y + ROUTE_BULLET_DROP_OFFSET,
          }),
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
        setPolygonVertices: (id, vertices) => set((s) => T.setPolygonVertices(s, id, vertices)),
        moveVertex: (id, index, x, y) => set((s) => T.moveVertex(s, id, index, x, y)),
        insertVertex: (id, edgeIndex) => set((s) => T.insertVertex(s, id, edgeIndex)),
        deleteVertex: (id, index) => set((s) => T.deleteVertex(s, id, index)),
        updatePolygon: (id, patch) => set((s) => T.updatePolygon(s, id, patch)),
        rotatePolygon: (id) => set((s) => T.rotatePolygon(s, id)),
        movePolygonUp: (id) => set((s) => T.movePolygonUp(s, id)),
        movePolygonDown: (id) => set((s) => T.movePolygonDown(s, id)),
        deletePolygon: (id) => set((s) => T.deletePolygon(s, id)),

        setCurveRadius: (r) => set((s) => T.setCurveRadius(s, r)),
        setLabelFontSize: (n) => set((s) => T.setLabelFontSize(s, n)),
        setLabelWeight: (w) => set((s) => T.setLabelWeight(s, w)),
        setStationLabelBold: (stationId, bold) =>
          set((s) => T.setStationLabelBold(s, stationId, bold)),
        setStationLabelItalic: (stationId, italic) =>
          set((s) => T.setStationLabelItalic(s, stationId, italic)),
        setLabelItalic: (i) => set((s) => T.setLabelItalic(s, i)),
        setActivePalettes: (idsArr) => set((s) => T.setActivePalettes(s, idsArr)),
        togglePalette: (id) => set((s) => T.togglePalette(s, id)),
        setTransferThickness: (n) => set((s) => T.setTransferThickness(s, n)),
        setTransferColor: (c) => set((s) => T.setTransferColor(s, c)),
        setTransferStrokeWidth: (n) => set((s) => T.setTransferStrokeWidth(s, n)),
        setTransferStrokeColor: (c) => set((s) => T.setTransferStrokeColor(s, c)),
        clearAll: () => set((s) => T.clearAll(s)),
      }),
      {
        name: 'vignelli-map-doc-v1',
        storage: createJSONStorage(() => localStorage),
        version: 4,
        // v0 → v1: backfill `line.name` with `${service} line` for lines saved
        // before the field existed.
        // v1 → v2: migrate legacy stop orientations (`up`/`down`/`left`/`right`
        //   and any unknown garbage strings) to the four canonical auto-*
        //   axes. Without this, docs that were saved before the diagonal-
        //   stops migration shipped would carry orientation values that no
        //   longer have switch arms in travelDirLocal — crashing on render.
        //   `parse()` in serialize.ts runs the same migration for the
        //   file-import path; here we run it for the localStorage path.
        // v2 → v3: translate legacy `labelBold: boolean` to `labelWeight:
        //   TextLabelWeight` (true → 700, false → 400). Matches the
        //   labelBold-migration path in `parse()` for file imports.
        // v3 → v4: translate legacy label `valign: 'auto'` to `'auto-down'`
        //   (the new mirror option `'auto-up'` didn't exist yet). Lives in
        //   sanitizeStations so the file-import path picks it up too.
        migrate: (persisted, version) => {
          const s = persisted as {
            lines?: Record<LineId, Line>;
            stations?: Record<string, Station>;
            labelBold?: boolean;
            labelWeight?: TextLabelWeight;
          };
          // Corrupt or missing version is treated as v0 so all migrations
          // run — preferable to silently rendering with stale data.
          const v = typeof version === 'number' ? version : 0;
          let out: typeof s = s;
          if (v < 1 && out.lines) {
            const next: Record<LineId, Line> = {};
            for (const id of Object.keys(out.lines)) {
              const ln = out.lines[id];
              next[id] = ln.name ? ln : { ...ln, name: `${ln.service} line` };
            }
            out = { ...out, lines: next };
          }
          if (v < 4 && out.stations) {
            const { stations: cleaned, changed } = sanitizeStations(out.stations);
            if (changed) out = { ...out, stations: cleaned };
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
          return out as DocState;
        },
        partialize: (s) => pickDocSnapshot(s),
      },
    ),
    {
      // Track only the document data — viewport and selection are in their
      // own stores, and the mutator method references never change so they're
      // safe to leave in (Object.assign on undo preserves them).
      partialize: (state) => pickDocSnapshot(state),
      limit: 200,
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
 * no changes occurred but explicit at the call site.
 */
export function beginHistoryGroup(): { commit: () => void; cancel: () => void } {
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
      doc.deleteLine(lineId);
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
  type UiMode,
  type LineTagHoverPreview,
  type SidebarTab,
} from './selection';
