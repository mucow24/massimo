import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { temporal } from 'zundo';
import type { Line, LineId, MapDoc, StationId } from '../model/types';
import type { Vec2 } from '../geometry/vec';
import { effectiveLineOrder } from '../model/lineOrder';
import { defaultIdFactory, IdFactory } from '../model/ids';
import { DEFAULT_DOC } from '../model/transforms';
import * as T from '../model/transforms';
import { migrate as migrateDoc, SCHEMA_VERSION } from '../model/serialize';
import { randomStationName } from './stationNames';

// Re-export so callers (Sidebar, etc.) keep working with one source of truth.
export { effectiveLineOrder };

// Official MTA NYC subway line trunk colors. Per the MTA developer
// resources / NYC Subway nomenclature: each service's color corresponds to
// the trunk line it primarily uses below 60th Street in Manhattan.
export const MTA_PALETTE: { name: string; color: string }[] = [
  { name: 'Blue (A·C·E)', color: '#0039A6' },
  { name: 'Orange (B·D·F·M)', color: '#FF6319' },
  { name: 'Lime (G)', color: '#6CBE45' },
  { name: 'Gray (L)', color: '#A7A9AC' },
  { name: 'Brown (J·Z)', color: '#996633' },
  { name: 'Yellow (N·Q·R·W)', color: '#FCCC0A' },
  { name: 'Red (1·2·3)', color: '#EE352E' },
  { name: 'Green (4·5·6)', color: '#00933C' },
  { name: 'Purple (7)', color: '#B933AD' },
  { name: 'Turquoise (T)', color: '#00ADD0' },
  { name: 'Dark Gray (S)', color: '#808183' },
];

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

interface DocState extends MapDoc {
  // mutators
  addStation: (x: number, y: number) => StationId;
  renameStation: (id: StationId, name: string) => void;
  moveStation: (id: StationId, x: number, y: number) => void;
  redistributeBetween: (
    startId: StationId,
    endId: StationId,
    mode?: 'arc-bends' | 'straight',
  ) => void;
  rotateStation: (id: StationId) => void;
  rotateStationAndLayout: (id: StationId, dir: -1 | 1) => void;
  deleteStation: (id: StationId) => void;
  moveStop: (stationId: StationId, lineId: LineId, dRow: number, dCol: number) => void;
  rotateStop: (stationId: StationId, lineId: LineId) => void;
  moveLabel: (stationId: StationId, dRow: number, dCol: number) => void;
  rotateLabel: (stationId: StationId) => void;
  flipLabel: (stationId: StationId) => void;
  mirrorLabel: (stationId: StationId) => void;
  setLabelOffset: (stationId: StationId, offset: number) => void;

  addLine: () => LineId;
  updateLine: (id: LineId, patch: Partial<Pick<Line, 'service' | 'color' | 'stations'>>) => void;
  toggleStationOnLine: (lineId: LineId, stationId: StationId, insertAfterIndex?: number) => void;
  removeStationFromLine: (lineId: LineId, idx: number) => void;
  reorderLineStations: (lineId: LineId, stations: StationId[]) => void;
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

  setCurveRadius: (r: number) => void;
  clearAll: () => void;
}

export const useDoc = create<DocState>()(
  temporal(
    persist(
      (set) => ({
        ...DEFAULT_DOC,

        addStation: (x, y) => {
          const id = ids.stationId();
          const name = randomStationName();
          set((s) => T.addStation(s, x, y, id, name));
          return id;
        },
        renameStation: (id, name) => set((s) => T.renameStation(s, id, name)),
        moveStation: (id, x, y) => set((s) => T.moveStation(s, id, x, y)),
        redistributeBetween: (startId, endId, mode = 'arc-bends') =>
          set((s) => T.redistributeBetween(s, startId, endId, mode)),
        rotateStation: (id) => set((s) => T.rotateStation(s, id)),
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

        addLine: () => {
          const id = ids.lineId();
          set((s) => {
            const color = MTA_PALETTE[s.lineCounter % MTA_PALETTE.length].color;
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

        setCurveRadius: (r) => set((s) => T.setCurveRadius(s, r)),
        clearAll: () => set((s) => T.clearAll(s)),
      }),
      {
        name: 'vignelli-map-doc-v1',
        version: SCHEMA_VERSION,
        storage: createJSONStorage(() => localStorage),
        partialize: (s) => ({
          stations: s.stations,
          lines: s.lines,
          lineOrder: s.lineOrder,
          curveRadius: s.curveRadius,
          lineCounter: s.lineCounter,
          lineTags: s.lineTags,
        }),
        // Single source of truth for migrations — see model/serialize.ts.
        migrate: (persisted, fromVersion) => migrateDoc(persisted, fromVersion),
      },
    ),
    {
      // Track only the document data — viewport and selection are in their
      // own stores, and the mutator method references never change so they're
      // safe to leave in (Object.assign on undo preserves them).
      partialize: (state) => ({
        stations: state.stations,
        lines: state.lines,
        lineOrder: state.lineOrder,
        curveRadius: state.curveRadius,
        lineCounter: state.lineCounter,
        lineTags: state.lineTags,
      }),
      limit: 200,
    },
  ),
);

/**
 * Snapshot of the partialized doc fields tracked by zundo.
 * Matches the `partialize` config above.
 */
type DocSnapshot = Pick<
  MapDoc,
  'stations' | 'lines' | 'lineOrder' | 'curveRadius' | 'lineCounter' | 'lineTags'
>;

function snapshotDoc(s: DocState): DocSnapshot {
  return {
    stations: s.stations,
    lines: s.lines,
    lineOrder: s.lineOrder,
    curveRadius: s.curveRadius,
    lineCounter: s.lineCounter,
    lineTags: s.lineTags,
  };
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
 * no changes occurred but explicit at the call site.
 */
export function beginHistoryGroup(): { commit: () => void; cancel: () => void } {
  const snapshot = snapshotDoc(useDoc.getState());
  const temporal = useDoc.temporal.getState();
  temporal.pause();
  let done = false;
  return {
    commit: () => {
      if (done) return;
      done = true;
      temporal.resume();
      const cur = snapshotDoc(useDoc.getState());
      // Reference-equality check on the partialized fields: transforms
      // produce new objects only when something changes, so this is sound.
      if (
        cur.stations === snapshot.stations &&
        cur.lines === snapshot.lines &&
        cur.lineOrder === snapshot.lineOrder &&
        cur.curveRadius === snapshot.curveRadius &&
        cur.lineCounter === snapshot.lineCounter &&
        cur.lineTags === snapshot.lineTags
      ) {
        return;
      }
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

interface SelectionState {
  selectedStationId: StationId | null;
  selectedLineId: LineId | null;
  appendingToLineId: LineId | null;
  // Insertion cursor for append-from-map. -1 means "insert at start".
  // The inserted station ends up at index (insertAfterIndex + 1).
  insertAfterIndex: number | null;
  placingStation: boolean;
  hoveredStationId: StationId | null;
  // The (lineId, stationId) currently hovered in the line editor's station
  // list. Used to highlight the corresponding stop dot on the canvas.
  hoveredLineStop: { lineId: LineId; stationId: StationId } | null;
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
  // Line tag selection + creation.
  creatingLineTag: boolean;
  selectedLineTagId: string | null;
  lineTagHoverPreview: LineTagHoverPreview | null;
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
  selectLine: (id: LineId | null) => void;
  startAppendAt: (lineId: LineId, insertAfterIndex: number) => void;
  setAppending: (id: LineId | null) => void;
  setInsertAfterIndex: (idx: number | null) => void;
  setPlacingStation: (placing: boolean) => void;
  setHoveredStation: (id: StationId | null) => void;
  setHoveredLineStop: (v: { lineId: LineId; stationId: StationId } | null) => void;
  setSelectedStopLineId: (id: LineId | null) => void;
  setLabelSelected: (selected: boolean) => void;
  setEditingStationId: (id: StationId | null) => void;
  setActiveTab: (tab: SidebarTab) => void;
  selectLineTag: (id: string | null) => void;
  setCreatingLineTag: (creating: boolean) => void;
  setLineTagHoverPreview: (preview: LineTagHoverPreview | null) => void;
  setMirrorMatching: (on: boolean) => void;
}

export const useSelection = create<SelectionState>((set, get) => ({
  selectedStationId: null,
  selectedLineId: null,
  appendingToLineId: null,
  insertAfterIndex: null,
  placingStation: false,
  hoveredStationId: null,
  hoveredLineStop: null,
  selectedStopLineId: null,
  labelSelected: false,
  editingStationId: null,
  activeTab: 'stations',
  creatingLineTag: false,
  selectedLineTagId: null,
  lineTagHoverPreview: null,
  mirrorMatching: false,
  toolMode: 'arrow',
  spaceHeld: false,
  setToolMode: (m) => set({ toolMode: m }),
  setSpaceHeld: (v) => set({ spaceHeld: v }),
  selectStation: (id) =>
    set({
      selectedStationId: id,
      selectedLineId: null,
      selectedLineTagId: null,
      selectedStopLineId: null,
      labelSelected: false,
      editingStationId: id === null ? null : get().editingStationId,
      activeTab: id === null ? get().activeTab : 'stations',
      creatingLineTag: id === null ? get().creatingLineTag : false,
      lineTagHoverPreview: null,
      // Each new selection opts into mirror mode fresh.
      mirrorMatching: false,
    }),
  selectLine: (id) => {
    const wasAppending = get().appendingToLineId !== null;
    const switchingToDifferent = wasAppending && id !== get().appendingToLineId;
    set({
      selectedLineId: id,
      selectedStationId: null,
      selectedLineTagId: null,
      appendingToLineId: switchingToDifferent ? null : get().appendingToLineId,
      insertAfterIndex: switchingToDifferent ? null : get().insertAfterIndex,
      activeTab: id === null ? get().activeTab : 'lines',
      creatingLineTag: id === null ? get().creatingLineTag : false,
      lineTagHoverPreview: null,
    });
  },
  startAppendAt: (lineId, idx) =>
    set({
      appendingToLineId: lineId,
      insertAfterIndex: idx,
      selectedLineId: lineId,
      selectedLineTagId: null,
      activeTab: 'lines',
      creatingLineTag: false,
      lineTagHoverPreview: null,
    }),
  setAppending: (id) =>
    set({
      appendingToLineId: id,
      insertAfterIndex: id === null ? null : get().insertAfterIndex,
      selectedLineId: id ?? get().selectedLineId,
      creatingLineTag: id === null ? get().creatingLineTag : false,
      lineTagHoverPreview: id === null ? get().lineTagHoverPreview : null,
    }),
  setInsertAfterIndex: (idx) => set({ insertAfterIndex: idx }),
  setPlacingStation: (placing) =>
    set({
      placingStation: placing,
      // Entering place-station mode clears tag mode + tag selection.
      creatingLineTag: placing ? false : get().creatingLineTag,
      selectedLineTagId: placing ? null : get().selectedLineTagId,
      lineTagHoverPreview: placing ? null : get().lineTagHoverPreview,
    }),
  setHoveredStation: (id) => set({ hoveredStationId: id }),
  setHoveredLineStop: (v) => set({ hoveredLineStop: v }),
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
      selectedLineTagId: id,
      selectedStationId: null,
      selectedLineId: null,
      selectedStopLineId: null,
      labelSelected: false,
      editingStationId: null,
      // Selecting a tag exits placement modes.
      creatingLineTag: id === null ? get().creatingLineTag : false,
      placingStation: id === null ? get().placingStation : false,
      appendingToLineId: id === null ? get().appendingToLineId : null,
      insertAfterIndex: id === null ? get().insertAfterIndex : null,
      lineTagHoverPreview: null,
    }),
  setCreatingLineTag: (creating) =>
    set({
      creatingLineTag: creating,
      // Entering tag mode clears all other modes + selections.
      placingStation: creating ? false : get().placingStation,
      appendingToLineId: creating ? null : get().appendingToLineId,
      insertAfterIndex: creating ? null : get().insertAfterIndex,
      selectedStationId: creating ? null : get().selectedStationId,
      selectedLineId: creating ? null : get().selectedLineId,
      selectedLineTagId: creating ? null : get().selectedLineTagId,
      lineTagHoverPreview: creating ? get().lineTagHoverPreview : null,
    }),
  setLineTagHoverPreview: (preview) => set({ lineTagHoverPreview: preview }),
  setMirrorMatching: (on) => set({ mirrorMatching: on }),
}));
