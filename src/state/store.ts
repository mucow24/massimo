import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Line, LineId, MapDoc, StationId } from '../model/types';
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
  toggleStationOnLine: (
    lineId: LineId,
    stationId: StationId,
    insertAfterIndex?: number,
  ) => void;
  removeStationFromLine: (lineId: LineId, idx: number) => void;
  reorderLineStations: (lineId: LineId, stations: StationId[]) => void;
  deleteLine: (id: LineId) => void;
  moveLineInOrder: (id: LineId, dir: -1 | 1) => void;

  setCurveRadius: (r: number) => void;
  clearAll: () => void;
}

export const useDoc = create<DocState>()(
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
      }),
      // Single source of truth for migrations — see model/serialize.ts.
      migrate: (persisted, fromVersion) => migrateDoc(persisted, fromVersion),
    },
  ),
);

// ----- Drag-vs-click suppression (module-level, not persisted) -----
export const dragState = { suppressClick: false };

// ----- Selection (ephemeral, not persisted) -----

export type SidebarTab = 'stations' | 'lines';

interface SelectionState {
  selectedStationId: StationId | null;
  selectedLineId: LineId | null;
  appendingToLineId: LineId | null;
  // Insertion cursor for append-from-map. -1 means "insert at start".
  // The inserted station ends up at index (insertAfterIndex + 1).
  insertAfterIndex: number | null;
  placingStation: boolean;
  hoveredStationId: StationId | null;
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
  selectStation: (id: StationId | null) => void;
  selectLine: (id: LineId | null) => void;
  startAppendAt: (lineId: LineId, insertAfterIndex: number) => void;
  setAppending: (id: LineId | null) => void;
  setInsertAfterIndex: (idx: number | null) => void;
  setPlacingStation: (placing: boolean) => void;
  setHoveredStation: (id: StationId | null) => void;
  setSelectedStopLineId: (id: LineId | null) => void;
  setLabelSelected: (selected: boolean) => void;
  setEditingStationId: (id: StationId | null) => void;
  setActiveTab: (tab: SidebarTab) => void;
}

export const useSelection = create<SelectionState>((set, get) => ({
  selectedStationId: null,
  selectedLineId: null,
  appendingToLineId: null,
  insertAfterIndex: null,
  placingStation: false,
  hoveredStationId: null,
  selectedStopLineId: null,
  labelSelected: false,
  editingStationId: null,
  activeTab: 'stations',
  selectStation: (id) =>
    set({
      selectedStationId: id,
      selectedLineId: null,
      selectedStopLineId: null,
      labelSelected: false,
      editingStationId: id === null ? null : get().editingStationId,
      activeTab: id === null ? get().activeTab : 'stations',
    }),
  selectLine: (id) => {
    const wasAppending = get().appendingToLineId !== null;
    const switchingToDifferent = wasAppending && id !== get().appendingToLineId;
    set({
      selectedLineId: id,
      selectedStationId: null,
      appendingToLineId: switchingToDifferent ? null : get().appendingToLineId,
      insertAfterIndex: switchingToDifferent ? null : get().insertAfterIndex,
      activeTab: id === null ? get().activeTab : 'lines',
    });
  },
  startAppendAt: (lineId, idx) =>
    set({
      appendingToLineId: lineId,
      insertAfterIndex: idx,
      selectedLineId: lineId,
      activeTab: 'lines',
    }),
  setAppending: (id) =>
    set({
      appendingToLineId: id,
      insertAfterIndex: id === null ? null : get().insertAfterIndex,
      selectedLineId: id ?? get().selectedLineId,
    }),
  setInsertAfterIndex: (idx) => set({ insertAfterIndex: idx }),
  setPlacingStation: (placing) => set({ placingStation: placing }),
  setHoveredStation: (id) => set({ hoveredStationId: id }),
  setSelectedStopLineId: (id) =>
    set({ selectedStopLineId: id, labelSelected: id === null ? get().labelSelected : false }),
  setLabelSelected: (selected) =>
    set({
      labelSelected: selected,
      selectedStopLineId: selected ? null : get().selectedStopLineId,
    }),
  setEditingStationId: (id) => set({ editingStationId: id }),
  setActiveTab: (tab) => set({ activeTab: tab }),
}));
