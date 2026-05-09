import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { temporal } from 'zundo';
import type {
  DotShape,
  LabelAlign,
  LabelValign,
  Line,
  LineId,
  MapDoc,
  RouteBullet,
  StationId,
} from '../model/types';
import type { Vec2 } from '../geometry/vec';
import { effectiveLineOrder } from '../model/lineOrder';
import { defaultIdFactory, IdFactory } from '../model/ids';
import { DEFAULT_DOC } from '../model/transforms';
import * as T from '../model/transforms';
import { cyclingColors, type PaletteId } from '../model/palettes';
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

interface DocState extends MapDoc {
  // mutators
  addStation: (x: number, y: number, name?: string) => StationId;
  renameStation: (id: StationId, name: string) => void;
  moveStation: (id: StationId, x: number, y: number) => void;
  setDotShape: (stationId: StationId, lineId: LineId, shape: DotShape) => void;
  redistributeBetween: (
    startId: StationId,
    endId: StationId,
    mode?: 'arc-bends' | 'straight',
  ) => void;
  rotateStation: (id: StationId) => void;
  rotateStationsAround: (pivotId: StationId, ids: StationId[]) => void;
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
  cycleLabelAlign: (stationId: StationId) => void;
  setLabelAlign: (stationId: StationId, align: LabelAlign) => void;
  cycleLabelValign: (stationId: StationId) => void;
  setLabelValign: (stationId: StationId, valign: LabelValign) => void;

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

  setCurveRadius: (r: number) => void;
  setLabelFontSize: (n: number) => void;
  setLabelBold: (b: boolean) => void;
  setLabelItalic: (i: boolean) => void;
  setActivePalettes: (ids: PaletteId[]) => void;
  togglePalette: (id: PaletteId) => void;
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
        redistributeBetween: (startId, endId, mode = 'arc-bends') =>
          set((s) => T.redistributeBetween(s, startId, endId, mode)),
        rotateStation: (id) => set((s) => T.rotateStation(s, id)),
        rotateStationsAround: (pivotId, ids) => set((s) => T.rotateStationsAround(s, pivotId, ids)),
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

        setCurveRadius: (r) => set((s) => T.setCurveRadius(s, r)),
        setLabelFontSize: (n) => set((s) => T.setLabelFontSize(s, n)),
        setLabelBold: (b) => set((s) => T.setLabelBold(s, b)),
        setLabelItalic: (i) => set((s) => T.setLabelItalic(s, i)),
        setActivePalettes: (idsArr) => set((s) => T.setActivePalettes(s, idsArr)),
        togglePalette: (id) => set((s) => T.togglePalette(s, id)),
        clearAll: () => set((s) => T.clearAll(s)),
      }),
      {
        name: 'vignelli-map-doc-v1',
        storage: createJSONStorage(() => localStorage),
        partialize: (s) => ({
          stations: s.stations,
          lines: s.lines,
          lineOrder: s.lineOrder,
          curveRadius: s.curveRadius,
          lineCounter: s.lineCounter,
          lineTags: s.lineTags,
          routeBullets: s.routeBullets,
          transfers: s.transfers,
          labelFontSize: s.labelFontSize,
          labelBold: s.labelBold,
          labelItalic: s.labelItalic,
          activePalettes: s.activePalettes,
        }),
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
        routeBullets: state.routeBullets,
        transfers: state.transfers,
        labelFontSize: state.labelFontSize,
        labelBold: state.labelBold,
        labelItalic: state.labelItalic,
        activePalettes: state.activePalettes,
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
  | 'stations'
  | 'lines'
  | 'lineOrder'
  | 'curveRadius'
  | 'lineCounter'
  | 'lineTags'
  | 'routeBullets'
  | 'transfers'
  | 'labelFontSize'
  | 'labelBold'
  | 'labelItalic'
  | 'activePalettes'
>;

function snapshotDoc(s: DocState): DocSnapshot {
  return {
    stations: s.stations,
    lines: s.lines,
    lineOrder: s.lineOrder,
    curveRadius: s.curveRadius,
    lineCounter: s.lineCounter,
    lineTags: s.lineTags,
    routeBullets: s.routeBullets,
    transfers: s.transfers,
    labelFontSize: s.labelFontSize,
    labelBold: s.labelBold,
    labelItalic: s.labelItalic,
    activePalettes: s.activePalettes,
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
  // Multi-station selection. Order is meaningful: the last entry is the
  // "anchor" (most recently single-clicked station), used as the source for
  // ctrl+shift+click path-extend and as the station shown in the inspector
  // when length === 1.
  selectedStationIds: StationId[];
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
  // Route bullet selection + creation. Multi-selection: parallel to
  // `selectedStationIds`, with the same ordered-list semantics. The
  // last entry is the anchor (used by the popover when length === 1).
  creatingRouteBullet: boolean;
  selectedRouteBulletIds: string[];
  // Transfer selection + creation. While `creatingTransfer` is true and
  // `transferAnchor` is null, the next station-click picks the first dot.
  // Once set, the next station-click picks the second dot and commits.
  // The anchor records the specific dot (lineId) the user clicked on so
  // the transfer pins to that stop.
  creatingTransfer: boolean;
  transferAnchor: { stationId: StationId; lineId: LineId | null } | null;
  selectedTransferId: string | null;
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
  selectRouteBullet: (id: string | null) => void;
  toggleRouteBulletSelection: (id: string) => void;
  setRouteBulletSelection: (ids: string[]) => void;
  addRouteBulletsToSelection: (ids: string[]) => void;
  xorRouteBulletsToSelection: (ids: string[]) => void;
  setCreatingRouteBullet: (creating: boolean) => void;
  selectTransfer: (id: string | null) => void;
  setCreatingTransfer: (creating: boolean) => void;
  setTransferAnchor: (anchor: { stationId: StationId; lineId: LineId | null } | null) => void;
  setMirrorMatching: (on: boolean) => void;
}

export const useSelection = create<SelectionState>((set, get) => ({
  selectedStationIds: [],
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
  creatingRouteBullet: false,
  selectedRouteBulletIds: [],
  creatingTransfer: false,
  transferAnchor: null,
  selectedTransferId: null,
  mirrorMatching: false,
  toolMode: 'arrow',
  spaceHeld: false,
  setToolMode: (m) => set({ toolMode: m }),
  setSpaceHeld: (v) => set({ spaceHeld: v }),
  selectStation: (id) =>
    set({
      selectedStationIds: id == null ? [] : [id],
      // Plain click is exclusive across types: clears bullets too.
      selectedRouteBulletIds: [],
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
  toggleStationSelection: (id) =>
    set((s) => {
      const idx = s.selectedStationIds.indexOf(id);
      if (idx >= 0) {
        const next = s.selectedStationIds.slice();
        next.splice(idx, 1);
        return {
          selectedStationIds: next,
          // Multi-select implicitly clears the inspector-state pieces tied
          // to a single station's grid editor. The line-tag preview is
          // also stale.
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
    const wasAppending = get().appendingToLineId !== null;
    const switchingToDifferent = wasAppending && id !== get().appendingToLineId;
    set({
      selectedLineId: id,
      selectedStationIds: [],
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
      selectedStationIds: [],
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
      selectedStationIds: creating ? [] : get().selectedStationIds,
      selectedLineId: creating ? null : get().selectedLineId,
      selectedLineTagId: creating ? null : get().selectedLineTagId,
      lineTagHoverPreview: creating ? get().lineTagHoverPreview : null,
    }),
  setLineTagHoverPreview: (preview) => set({ lineTagHoverPreview: preview }),
  selectRouteBullet: (id) =>
    set({
      selectedRouteBulletIds: id == null ? [] : [id],
      // Selecting a bullet clears other selections + placement modes.
      selectedStationIds: id === null ? get().selectedStationIds : [],
      selectedLineId: id === null ? get().selectedLineId : null,
      selectedLineTagId: id === null ? get().selectedLineTagId : null,
      labelSelected: false,
      editingStationId: null,
      creatingLineTag: id === null ? get().creatingLineTag : false,
      placingStation: id === null ? get().placingStation : false,
      appendingToLineId: id === null ? get().appendingToLineId : null,
      insertAfterIndex: id === null ? get().insertAfterIndex : null,
      creatingRouteBullet: id === null ? get().creatingRouteBullet : false,
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
  setCreatingRouteBullet: (creating) =>
    set({
      creatingRouteBullet: creating,
      // Entering bullet-creation mode clears all other modes + selections.
      placingStation: creating ? false : get().placingStation,
      creatingLineTag: creating ? false : get().creatingLineTag,
      appendingToLineId: creating ? null : get().appendingToLineId,
      insertAfterIndex: creating ? null : get().insertAfterIndex,
      creatingTransfer: creating ? false : get().creatingTransfer,
      transferAnchor: creating ? null : get().transferAnchor,
      selectedStationIds: creating ? [] : get().selectedStationIds,
      selectedLineId: creating ? null : get().selectedLineId,
      selectedLineTagId: creating ? null : get().selectedLineTagId,
      selectedRouteBulletIds: creating ? [] : get().selectedRouteBulletIds,
      selectedTransferId: creating ? null : get().selectedTransferId,
    }),
  selectTransfer: (id) =>
    set({
      selectedTransferId: id,
      selectedStationIds: id === null ? get().selectedStationIds : [],
      selectedLineId: id === null ? get().selectedLineId : null,
      selectedLineTagId: id === null ? get().selectedLineTagId : null,
      selectedRouteBulletIds: id === null ? get().selectedRouteBulletIds : [],
      labelSelected: false,
      editingStationId: null,
      placingStation: id === null ? get().placingStation : false,
      creatingLineTag: id === null ? get().creatingLineTag : false,
      creatingRouteBullet: id === null ? get().creatingRouteBullet : false,
      creatingTransfer: id === null ? get().creatingTransfer : false,
      transferAnchor: id === null ? get().transferAnchor : null,
      appendingToLineId: id === null ? get().appendingToLineId : null,
      insertAfterIndex: id === null ? get().insertAfterIndex : null,
    }),
  setCreatingTransfer: (creating) =>
    set({
      creatingTransfer: creating,
      transferAnchor: null,
      placingStation: creating ? false : get().placingStation,
      creatingLineTag: creating ? false : get().creatingLineTag,
      creatingRouteBullet: creating ? false : get().creatingRouteBullet,
      appendingToLineId: creating ? null : get().appendingToLineId,
      insertAfterIndex: creating ? null : get().insertAfterIndex,
      selectedStationIds: creating ? [] : get().selectedStationIds,
      selectedLineId: creating ? null : get().selectedLineId,
      selectedLineTagId: creating ? null : get().selectedLineTagId,
      selectedRouteBulletIds: creating ? [] : get().selectedRouteBulletIds,
      selectedTransferId: creating ? null : get().selectedTransferId,
    }),
  setTransferAnchor: (anchor) => set({ transferAnchor: anchor }),
  setMirrorMatching: (on) => set({ mirrorMatching: on }),
}));
