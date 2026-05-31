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
  RouteBullet,
  StationId,
  TextLabel,
  TextLabelWeight,
} from '../model/types';
import type { Vec2 } from '../geometry/vec';
import { effectiveLineOrder } from '../model/lineOrder';
import { defaultIdFactory, IdFactory } from '../model/ids';
import { DEFAULT_DOC } from '../model/transforms';
import * as T from '../model/transforms';
import { cyclingColors, type PaletteId } from '../model/palettes';
import { sanitizeStations } from '../model/serialize';
import type { Station } from '../model/types';
import { randomStationName } from './stationNames';

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
type DocSnapshot = Pick<MapDoc, DocFieldName>;

function pickDocSnapshot(s: DocSnapshot): DocSnapshot {
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
  updateLine: (
    id: LineId,
    patch: Partial<Pick<Line, 'service' | 'name' | 'color' | 'stations'>>,
  ) => void;
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
      (set) => ({
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
  const temporal = useDoc.temporal.getState();
  temporal.pause();
  let done = false;
  return {
    commit: () => {
      if (done) return;
      done = true;
      temporal.resume();
      const cur = pickDocSnapshot(useDoc.getState());
      // Reference-equality check across every tracked doc field. Transforms
      // produce new objects only when something changes, so this is sound.
      if (docSnapshotsEqual(cur, snapshot)) return;
      // Manually push our snapshot as a single history entry. A new action
      // wipes the redo stack, mirroring zundo's default handler behavior.
      useDoc.temporal.setState((s) => ({
        pastStates: [...s.pastStates, snapshot],
        futureStates: [],
      }));
    },
    cancel: () => {
      if (done) return;
      done = true;
      temporal.resume();
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

// ----- Selection (ephemeral, not persisted) -----

export type SidebarTab = 'stations' | 'lines';

// Hover preview shown while in add-line-tag mode: tracks the candidate
// insertion point under the cursor on a line stripe, so the canvas can
// render a ghost tag without committing it to the doc.
export interface LineTagHoverPreview {
  lineId: LineId;
  service: string;
  fromStationId: StationId;
  toStationId: StationId;
  t: number;
  // Sampled position + tangent in world coords. Tangent is in canonical-band
  // direction; the ghost re-orients in line-traversal frame at render time.
  p: Vec2;
  tangent: Vec2;
  lineForwardMatchesCanon: boolean;
}

// Every mutually-exclusive editor mode lives in one discriminated union.
// Variant payloads carry data only meaningful in that mode (transfer anchor,
// append insertion-cursor). Adding a new mode is one variant + handlers — no
// other setters need to learn about it.
export type UiMode =
  | { kind: 'idle' }
  | { kind: 'placing-station' }
  | { kind: 'creating-line-tag' }
  | { kind: 'creating-route-bullet' }
  | {
      kind: 'creating-transfer';
      anchor: { stationId: StationId; lineId: LineId | null } | null;
    }
  | { kind: 'placing-label' }
  | { kind: 'appending-to-line'; lineId: LineId; insertAfterIndex: number | null }
  | { kind: 'layering' };

/**
 * UiMode kinds where a right-click does NOT cancel the mode. Lives next to
 * the {@link UiMode} union so adding a new mode that wants right-click for
 * its own gesture (layering uses it to decrement a segment's layer) is one
 * edit, not a hunt across handlers.
 */
export const RIGHT_CLICK_PASSTHROUGH_MODES: ReadonlySet<UiMode['kind']> = new Set([
  'idle',
  'layering',
]);

// Selection fields that get wiped whenever the user enters a non-idle uiMode
// or picks a primary selection of a different type. Centralized so adding a
// new selection type means one line here, not a cross-clearing matrix across
// every setter. Within-station inspector micro-state (stopLine, labelSelected,
// mirror, editingStation) belongs here too — it's bound to "which thing is
// the current primary selection."
const clearedSelections = () => ({
  selectedStationIds: [] as StationId[],
  selectedRouteBulletIds: [] as string[],
  selectedLabelIds: [] as string[],
  selectedLineId: null as LineId | null,
  selectedLineTagId: null as string | null,
  selectedTransferId: null as string | null,
  selectedStopLineId: null as LineId | null,
  labelSelected: false,
  editingStationId: null as StationId | null,
  mirrorMatching: false,
});

interface SelectionState {
  // Multi-station selection. Order is meaningful: the last entry is the
  // "anchor" (most recently single-clicked station), used as the source for
  // ctrl+shift+click path-extend and as the station shown in the inspector
  // when length === 1.
  selectedStationIds: StationId[];
  selectedLineId: LineId | null;
  // Exactly one editor mode is active. Entering a non-idle mode wipes all
  // selections; selecting a non-station primary item exits to idle (sticky
  // selectStation is the documented exception, since placing-station mode
  // calls it after each placement).
  uiMode: UiMode;
  hoveredStationId: StationId | null;
  // The (lineId, stationId) currently hovered in the line editor's station
  // list. Used to highlight the corresponding stop dot on the canvas.
  hoveredLineStop: { lineId: LineId; stationId: StationId } | null;
  // The segment whose style-divider button is currently being hovered/focused
  // in the line editor. While set, the canvas paints a soft white wash and
  // re-renders only this segment + its endpoint dots so the user can see
  // which corridor on the map the divider corresponds to.
  hoveredInspectorSegment: {
    lineId: LineId;
    fromStationId: StationId;
    toStationId: StationId;
  } | null;
  // The lineId of the currently-selected stop cell within the active station
  // inspector. Cleared whenever a different station is selected.
  selectedStopLineId: LineId | null;
  // True if the label cell is the current selection within the grid editor.
  // Mutually exclusive with selectedStopLineId.
  labelSelected: boolean;
  // The station whose name is being edited inline on the canvas.
  editingStationId: StationId | null;
  // Which sidebar tab is currently visible.
  activeTab: SidebarTab;
  selectedLineTagId: string | null;
  lineTagHoverPreview: LineTagHoverPreview | null;
  // Route bullet selection. Multi-selection: parallel to `selectedStationIds`,
  // with the same ordered-list semantics. The last entry is the anchor (used
  // by the popover when length === 1).
  selectedRouteBulletIds: string[];
  selectedTransferId: string | null;
  // Text-label selection. Multi-selection: parallel to `selectedStationIds` /
  // `selectedRouteBulletIds`. The last entry is the anchor used by the popover
  // when length === 1.
  selectedLabelIds: string[];
  // When true, edits made via the StationInspector (stop layout + label)
  // mirror to all directly-connected stations whose unrotated stop layouts
  // are identical. Resets to false whenever a different station is selected.
  mirrorMatching: boolean;
  // Canvas tool mode: 'arrow' for select/move, 'hand' for pan.
  toolMode: 'arrow' | 'hand';
  // Spacebar held → temporarily acts like hand mode.
  spaceHeld: boolean;
  setToolMode: (m: 'arrow' | 'hand') => void;
  setSpaceHeld: (v: boolean) => void;
  selectStation: (id: StationId | null) => void;
  toggleStationSelection: (id: StationId) => void;
  setStationSelection: (ids: StationId[]) => void;
  addStationsToSelection: (ids: StationId[]) => void;
  xorStationsToSelection: (ids: StationId[]) => void;
  selectLine: (id: LineId | null) => void;
  startAppendAt: (lineId: LineId, insertAfterIndex: number) => void;
  setAppending: (id: LineId | null) => void;
  // Narrowing helper: updates the appending-to-line variant's insertAfterIndex
  // in place. No-op when uiMode.kind isn't 'appending-to-line'.
  setInsertAfterIndex: (idx: number | null) => void;
  setUiMode: (mode: UiMode) => void;
  setHoveredStation: (id: StationId | null) => void;
  setHoveredLineStop: (v: { lineId: LineId; stationId: StationId } | null) => void;
  setHoveredInspectorSegment: (
    v: { lineId: LineId; fromStationId: StationId; toStationId: StationId } | null,
  ) => void;
  setSelectedStopLineId: (id: LineId | null) => void;
  setLabelSelected: (selected: boolean) => void;
  setEditingStationId: (id: StationId | null) => void;
  setActiveTab: (tab: SidebarTab) => void;
  selectLineTag: (id: string | null) => void;
  setLineTagHoverPreview: (preview: LineTagHoverPreview | null) => void;
  selectRouteBullet: (id: string | null) => void;
  toggleRouteBulletSelection: (id: string) => void;
  setRouteBulletSelection: (ids: string[]) => void;
  addRouteBulletsToSelection: (ids: string[]) => void;
  xorRouteBulletsToSelection: (ids: string[]) => void;
  selectTransfer: (id: string | null) => void;
  // Narrowing helper: updates the creating-transfer variant's anchor in place.
  // No-op when uiMode.kind isn't 'creating-transfer'.
  setTransferAnchor: (anchor: { stationId: StationId; lineId: LineId | null } | null) => void;
  setMirrorMatching: (on: boolean) => void;
  selectLabel: (id: string | null) => void;
  toggleLabelSelection: (id: string) => void;
  setLabelSelection: (ids: string[]) => void;
  addLabelsToSelection: (ids: string[]) => void;
  xorLabelsToSelection: (ids: string[]) => void;
}

export const useSelection = create<SelectionState>((set, get) => ({
  selectedStationIds: [],
  selectedLineId: null,
  uiMode: { kind: 'idle' },
  hoveredStationId: null,
  hoveredLineStop: null,
  hoveredInspectorSegment: null,
  selectedStopLineId: null,
  labelSelected: false,
  editingStationId: null,
  activeTab: 'stations',
  selectedLineTagId: null,
  lineTagHoverPreview: null,
  selectedRouteBulletIds: [],
  selectedTransferId: null,
  selectedLabelIds: [],
  mirrorMatching: false,
  toolMode: 'arrow',
  spaceHeld: false,
  setToolMode: (m) => set({ toolMode: m }),
  setSpaceHeld: (v) => set({ spaceHeld: v }),

  // The single source of truth for mode transitions. Entering any non-idle
  // mode wipes all primary selections; exiting just clears the line-tag
  // hover preview (which is only meaningful inside creating-line-tag).
  // Variant payloads (transferAnchor, insertAfterIndex) are updated in place
  // via setTransferAnchor / setInsertAfterIndex.
  setUiMode: (mode) =>
    set(
      mode.kind === 'idle'
        ? { uiMode: mode, lineTagHoverPreview: null }
        : { uiMode: mode, lineTagHoverPreview: null, ...clearedSelections() },
    ),

  // selectStation does NOT touch uiMode — placing-station and
  // creating-route-bullet modes are sticky (canvas clicks place repeatedly;
  // see MapCanvas onCanvasClick comments). The pure mode-cancellation rule
  // applies to every OTHER select* setter.
  selectStation: (id) =>
    set({
      ...clearedSelections(),
      selectedStationIds: id == null ? [] : [id],
      activeTab: id === null ? get().activeTab : 'stations',
      editingStationId: id === null ? null : get().editingStationId,
    }),
  toggleStationSelection: (id) =>
    set((s) => {
      const idx = s.selectedStationIds.indexOf(id);
      if (idx >= 0) {
        const next = s.selectedStationIds.slice();
        next.splice(idx, 1);
        return {
          selectedStationIds: next,
          // Multi-select implicitly clears the inspector-state pieces tied
          // to a single station's grid editor.
          selectedStopLineId: null,
          labelSelected: false,
          mirrorMatching: false,
          editingStationId: null,
          activeTab: 'stations',
        };
      }
      return {
        selectedStationIds: [...s.selectedStationIds, id],
        selectedLineId: null,
        selectedLineTagId: null,
        selectedStopLineId: null,
        labelSelected: false,
        editingStationId: null,
        activeTab: 'stations',
        mirrorMatching: false,
      };
    }),
  setStationSelection: (ids) =>
    set(() => {
      // Dedupe preserving each id's LAST occurrence (later position wins).
      const lastIdx = new Map<StationId, number>();
      ids.forEach((id, i) => lastIdx.set(id, i));
      const dedup: StationId[] = [];
      for (let i = 0; i < ids.length; i++) {
        if (lastIdx.get(ids[i]) === i) dedup.push(ids[i]);
      }
      return {
        selectedStationIds: dedup,
        selectedLineId: null,
        selectedLineTagId: null,
        selectedStopLineId: null,
        labelSelected: false,
        editingStationId: null,
        activeTab: 'stations',
        mirrorMatching: false,
      };
    }),
  addStationsToSelection: (ids) =>
    set((s) => {
      const have = new Set(s.selectedStationIds);
      const novel = ids.filter((id) => !have.has(id));
      if (novel.length === 0) return {};
      return {
        selectedStationIds: [...s.selectedStationIds, ...novel],
        selectedLineId: null,
        selectedLineTagId: null,
        mirrorMatching: false,
      };
    }),
  xorStationsToSelection: (ids) =>
    set((s) => {
      const have = new Set(s.selectedStationIds);
      const removeSet = new Set<StationId>();
      const appendList: StationId[] = [];
      for (const id of ids) {
        if (have.has(id)) removeSet.add(id);
        else appendList.push(id);
      }
      if (removeSet.size === 0 && appendList.length === 0) return {};
      const next = s.selectedStationIds.filter((id) => !removeSet.has(id));
      next.push(...appendList);
      return {
        selectedStationIds: next,
        selectedLineId: null,
        selectedLineTagId: null,
        mirrorMatching: false,
      };
    }),
  selectLine: (id) => {
    if (id === null) {
      // Null clear is gentle: drops line + tag, preserves other primaries
      // and uiMode (consistent with pre-refactor behavior at the call sites
      // that pass null — e.g. canvas-background click).
      set({
        selectedStationIds: [],
        selectedLineId: null,
        selectedLineTagId: null,
        lineTagHoverPreview: null,
      });
      return;
    }
    set({
      ...clearedSelections(),
      uiMode: { kind: 'idle' },
      selectedLineId: id,
      activeTab: 'lines',
      lineTagHoverPreview: null,
    });
  },
  startAppendAt: (lineId, insertAfterIndex) =>
    set({
      ...clearedSelections(),
      uiMode: { kind: 'appending-to-line', lineId, insertAfterIndex },
      selectedLineId: lineId,
      activeTab: 'lines',
      lineTagHoverPreview: null,
    }),
  setAppending: (lineId) => {
    const cur = get().uiMode;
    if (lineId === null) {
      if (cur.kind === 'appending-to-line') {
        set({ uiMode: { kind: 'idle' }, lineTagHoverPreview: null });
      }
      return;
    }
    // Preserve any in-progress insertion cursor only when re-entering the
    // SAME line; switching lines resets it.
    const insertAfterIndex =
      cur.kind === 'appending-to-line' && cur.lineId === lineId ? cur.insertAfterIndex : null;
    set({
      uiMode: { kind: 'appending-to-line', lineId, insertAfterIndex },
      selectedLineId: lineId,
      lineTagHoverPreview: null,
    });
  },
  setInsertAfterIndex: (idx) => {
    const cur = get().uiMode;
    if (cur.kind !== 'appending-to-line') return;
    set({ uiMode: { ...cur, insertAfterIndex: idx } });
  },
  setHoveredStation: (id) => set({ hoveredStationId: id }),
  setHoveredLineStop: (v) => set({ hoveredLineStop: v }),
  setHoveredInspectorSegment: (v) => set({ hoveredInspectorSegment: v }),
  setSelectedStopLineId: (id) =>
    set({ selectedStopLineId: id, labelSelected: id === null ? get().labelSelected : false }),
  setLabelSelected: (selected) =>
    set({
      labelSelected: selected,
      selectedStopLineId: selected ? null : get().selectedStopLineId,
    }),
  setEditingStationId: (id) => set({ editingStationId: id }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  selectLineTag: (id) =>
    set({
      ...clearedSelections(),
      uiMode: id === null ? get().uiMode : { kind: 'idle' },
      selectedLineTagId: id,
      lineTagHoverPreview: null,
    }),
  setLineTagHoverPreview: (preview) => set({ lineTagHoverPreview: preview }),
  selectRouteBullet: (id) =>
    set({
      ...clearedSelections(),
      uiMode: id == null ? get().uiMode : { kind: 'idle' },
      selectedRouteBulletIds: id == null ? [] : [id],
      lineTagHoverPreview: null,
    }),
  toggleRouteBulletSelection: (id) =>
    set((s) => {
      const idx = s.selectedRouteBulletIds.indexOf(id);
      if (idx >= 0) {
        const next = s.selectedRouteBulletIds.slice();
        next.splice(idx, 1);
        return { selectedRouteBulletIds: next };
      }
      return {
        selectedRouteBulletIds: [...s.selectedRouteBulletIds, id],
        selectedLineId: null,
        selectedLineTagId: null,
      };
    }),
  setRouteBulletSelection: (ids) =>
    set(() => {
      const lastIdx = new Map<string, number>();
      ids.forEach((id, i) => lastIdx.set(id, i));
      const dedup: string[] = [];
      for (let i = 0; i < ids.length; i++) {
        if (lastIdx.get(ids[i]) === i) dedup.push(ids[i]);
      }
      return { selectedRouteBulletIds: dedup };
    }),
  addRouteBulletsToSelection: (ids) =>
    set((s) => {
      const have = new Set(s.selectedRouteBulletIds);
      const novel = ids.filter((id) => !have.has(id));
      if (novel.length === 0) return {};
      return { selectedRouteBulletIds: [...s.selectedRouteBulletIds, ...novel] };
    }),
  xorRouteBulletsToSelection: (ids) =>
    set((s) => {
      const have = new Set(s.selectedRouteBulletIds);
      const removeSet = new Set<string>();
      const appendList: string[] = [];
      for (const id of ids) {
        if (have.has(id)) removeSet.add(id);
        else appendList.push(id);
      }
      if (removeSet.size === 0 && appendList.length === 0) return {};
      const next = s.selectedRouteBulletIds.filter((id) => !removeSet.has(id));
      next.push(...appendList);
      return { selectedRouteBulletIds: next };
    }),
  selectTransfer: (id) =>
    set({
      ...clearedSelections(),
      uiMode: id === null ? get().uiMode : { kind: 'idle' },
      selectedTransferId: id,
      lineTagHoverPreview: null,
    }),
  setTransferAnchor: (anchor) => {
    const cur = get().uiMode;
    if (cur.kind !== 'creating-transfer') return;
    set({ uiMode: { ...cur, anchor } });
  },
  setMirrorMatching: (on) => set({ mirrorMatching: on }),
  selectLabel: (id) =>
    set({
      ...clearedSelections(),
      uiMode: id == null ? get().uiMode : { kind: 'idle' },
      selectedLabelIds: id == null ? [] : [id],
      lineTagHoverPreview: null,
    }),
  toggleLabelSelection: (id) =>
    set((s) => {
      const idx = s.selectedLabelIds.indexOf(id);
      if (idx >= 0) {
        const next = s.selectedLabelIds.slice();
        next.splice(idx, 1);
        return { selectedLabelIds: next };
      }
      return {
        selectedLabelIds: [...s.selectedLabelIds, id],
        selectedLineId: null,
        selectedLineTagId: null,
      };
    }),
  setLabelSelection: (ids) =>
    set(() => {
      const lastIdx = new Map<string, number>();
      ids.forEach((id, i) => lastIdx.set(id, i));
      const dedup: string[] = [];
      for (let i = 0; i < ids.length; i++) {
        if (lastIdx.get(ids[i]) === i) dedup.push(ids[i]);
      }
      return { selectedLabelIds: dedup };
    }),
  addLabelsToSelection: (ids) =>
    set((s) => {
      const have = new Set(s.selectedLabelIds);
      const novel = ids.filter((id) => !have.has(id));
      if (novel.length === 0) return {};
      return { selectedLabelIds: [...s.selectedLabelIds, ...novel] };
    }),
  xorLabelsToSelection: (ids) =>
    set((s) => {
      const have = new Set(s.selectedLabelIds);
      const removeSet = new Set<string>();
      const appendList: string[] = [];
      for (const id of ids) {
        if (have.has(id)) removeSet.add(id);
        else appendList.push(id);
      }
      if (removeSet.size === 0 && appendList.length === 0) return {};
      const next = s.selectedLabelIds.filter((id) => !removeSet.has(id));
      next.push(...appendList);
      return { selectedLabelIds: next };
    }),
}));
