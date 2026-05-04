import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type {
  LabelCell,
  Line,
  LineId,
  MapDoc,
  Rotation,
  Station,
  StationId,
  StopCell,
  StopOrientation,
  Viewport,
} from './types';

const uid = () =>
  Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

const DEFAULT_DOC: MapDoc = {
  stations: {},
  lines: {},
  lineOrder: [],
  curveRadius: 24,
  viewport: { x: 0, y: 0, zoom: 1 },
};

// Returns lineOrder reconciled against `lines`: filters out missing IDs and
// appends any line IDs that aren't yet in the order. Use this everywhere you
// read order so older persisted docs (without lineOrder) still work.
export const effectiveLineOrder = (
  lineOrder: LineId[] | undefined,
  lines: Record<LineId, Line>,
): LineId[] => {
  const present = (lineOrder ?? []).filter((id) => lines[id]);
  const seen = new Set(present);
  for (const id of Object.keys(lines)) if (!seen.has(id)) present.push(id);
  return present;
};

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

let paletteCursor = 0;

// Auto-name sequence: A, B, ..., Z, 0, 1, ..., 9, AA, AB, ..., AZ, A0, ..., A9, BA, ...
// alphabet has 36 chars. After single-char names exhaust (36), use two-char.
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

interface DocState extends MapDoc {
  // mutators
  addStation: (x: number, y: number) => StationId;
  renameStation: (id: StationId, name: string) => void;
  moveStation: (id: StationId, x: number, y: number) => void;
  rotateStation: (id: StationId) => void;
  deleteStation: (id: StationId) => void;
  moveStop: (stationId: StationId, lineId: LineId, dRow: number, dCol: number) => void;
  rotateStop: (stationId: StationId, lineId: LineId) => void;
  moveLabel: (stationId: StationId, dRow: number, dCol: number) => void;
  rotateLabel: (stationId: StationId) => void;
  setLabelOffset: (stationId: StationId, offset: number) => void;

  addLine: () => LineId;
  updateLine: (id: LineId, patch: Partial<Pick<Line, 'service' | 'color' | 'stations'>>) => void;
  toggleStationOnLine: (lineId: LineId, stationId: StationId, insertAfterIndex?: number) => void;
  removeStationFromLine: (lineId: LineId, idx: number) => void;
  reorderLineStations: (lineId: LineId, stations: StationId[]) => void;
  deleteLine: (id: LineId) => void;
  moveLineInOrder: (id: LineId, dir: -1 | 1) => void;

  setCurveRadius: (r: number) => void;
  setViewport: (v: Viewport) => void;
}

export const useDoc = create<DocState>()(
  persist(
    (set) => ({
      ...DEFAULT_DOC,

      addStation: (x, y) => {
        const id = uid();
        const station: Station = {
          id,
          name: 'New Station',
          x,
          y,
          rotation: 0,
          stops: [],
          label: { row: 0, col: -1, rotation: 0, offset: 0 },
        };
        set((s) => ({ stations: { ...s.stations, [id]: station } }));
        return id;
      },

      renameStation: (id, name) => {
        set((s) => {
          const cur = s.stations[id];
          if (!cur) return s;
          return { stations: { ...s.stations, [id]: { ...cur, name } } };
        });
      },

      moveStation: (id, x, y) => {
        set((s) => {
          const cur = s.stations[id];
          if (!cur) return s;
          return { stations: { ...s.stations, [id]: { ...cur, x, y } } };
        });
      },

      rotateStation: (id) => {
        set((s) => {
          const cur = s.stations[id];
          if (!cur) return s;
          const next = ((cur.rotation + 1) % 8) as Rotation;
          return { stations: { ...s.stations, [id]: { ...cur, rotation: next } } };
        });
      },

      deleteStation: (id) => {
        set((s) => {
          const { [id]: _gone, ...rest } = s.stations;
          const lines: Record<LineId, Line> = {};
          for (const lid of Object.keys(s.lines)) {
            const ln = s.lines[lid];
            lines[lid] = { ...ln, stations: ln.stations.filter((x) => x !== id) };
          }
          return { stations: rest, lines };
        });
      },

      moveStop: (stationId, lineId, dRow, dCol) => {
        set((s) => {
          const st = s.stations[stationId];
          if (!st) return s;
          const i = st.stops.findIndex((c) => c.lineId === lineId);
          if (i < 0) return s;
          const cell = st.stops[i];
          const newRow = cell.row + dRow;
          const newCol = cell.col + dCol;
          // Stops can swap with another stop, but cannot enter the label cell.
          if (st.label.row === newRow && st.label.col === newCol) return s;
          const j = st.stops.findIndex((c) => c.row === newRow && c.col === newCol);
          const newStops = st.stops.slice();
          if (j >= 0 && j !== i) {
            newStops[j] = { ...newStops[j], row: cell.row, col: cell.col };
          }
          newStops[i] = { ...cell, row: newRow, col: newCol };
          return {
            stations: { ...s.stations, [stationId]: { ...st, stops: newStops } },
          };
        });
      },

      rotateStop: (stationId, lineId) => {
        set((s) => {
          const st = s.stations[stationId];
          if (!st) return s;
          const i = st.stops.findIndex((c) => c.lineId === lineId);
          if (i < 0) return s;
          const cur = st.stops[i];
          const next: StopOrientation = cur.orientation === 'vertical' ? 'horizontal' : 'vertical';
          const newStops = st.stops.slice();
          newStops[i] = { ...cur, orientation: next };
          return { stations: { ...s.stations, [stationId]: { ...st, stops: newStops } } };
        });
      },

      moveLabel: (stationId, dRow, dCol) => {
        set((s) => {
          const st = s.stations[stationId];
          if (!st) return s;
          const newRow = st.label.row + dRow;
          const newCol = st.label.col + dCol;
          // The label can only move into empty cells. If a stop occupies the
          // destination, the move is a no-op.
          const blocked = st.stops.some((c) => c.row === newRow && c.col === newCol);
          if (blocked) return s;
          return {
            stations: {
              ...s.stations,
              [stationId]: {
                ...st,
                label: { ...st.label, row: newRow, col: newCol },
              },
            },
          };
        });
      },

      rotateLabel: (stationId) => {
        set((s) => {
          const st = s.stations[stationId];
          if (!st) return s;
          const next = ((st.label.rotation + 1) % 8) as Rotation;
          return {
            stations: {
              ...s.stations,
              [stationId]: { ...st, label: { ...st.label, rotation: next } },
            },
          };
        });
      },

      setLabelOffset: (stationId, offset) => {
        set((s) => {
          const st = s.stations[stationId];
          if (!st) return s;
          return {
            stations: {
              ...s.stations,
              [stationId]: { ...st, label: { ...st.label, offset } },
            },
          };
        });
      },

      addLine: () => {
        const id = uid();
        const color = MTA_PALETTE[paletteCursor++ % MTA_PALETTE.length].color;
        set((s) => {
          const line: Line = {
            id,
            service: pickNextLineName(s.lines),
            color,
            stations: [],
          };
          // New line goes on top of the layer stack (front-most).
          const order = effectiveLineOrder(s.lineOrder, s.lines);
          return {
            lines: { ...s.lines, [id]: line },
            lineOrder: [id, ...order],
          };
        });
        return id;
      },

      updateLine: (id, patch) => {
        set((s) => {
          const cur = s.lines[id];
          if (!cur) return s;
          return { lines: { ...s.lines, [id]: { ...cur, ...patch } } };
        });
      },

      toggleStationOnLine: (lineId, stationId, insertAfterIndex) => {
        set((s) => {
          const ln = s.lines[lineId];
          const st = s.stations[stationId];
          if (!ln || !st) return s;
          const inLine = ln.stations.includes(stationId);
          if (inLine) {
            // remove (all occurrences)
            const newStations = ln.stations.filter((x) => x !== stationId);
            const stillStops = newStations.includes(stationId);
            const newStops = stillStops
              ? st.stops
              : st.stops.filter((c) => c.lineId !== lineId);
            return {
              lines: { ...s.lines, [lineId]: { ...ln, stations: newStations } },
              stations: { ...s.stations, [stationId]: { ...st, stops: newStops } },
            };
          } else {
            const idx =
              insertAfterIndex === undefined
                ? ln.stations.length
                : Math.min(ln.stations.length, Math.max(0, insertAfterIndex + 1));
            const newStations = [
              ...ln.stations.slice(0, idx),
              stationId,
              ...ln.stations.slice(idx),
            ];
            // Add a stop cell if this line doesn't yet have one at the station.
            // Spawn at (0, maxCol+1) of existing footprint; (0, 0) when empty.
            const hasCell = st.stops.some((c) => c.lineId === lineId);
            let newStops = st.stops;
            if (!hasCell) {
              const maxCol = st.stops.length === 0
                ? -1
                : st.stops.reduce((m, c) => (c.col > m ? c.col : m), -Infinity);
              const newCell: StopCell = {
                lineId,
                row: 0,
                col: maxCol + 1,
                orientation: 'vertical',
              };
              newStops = [...st.stops, newCell];
            }
            return {
              lines: { ...s.lines, [lineId]: { ...ln, stations: newStations } },
              stations: { ...s.stations, [stationId]: { ...st, stops: newStops } },
            };
          }
        });
      },

      removeStationFromLine: (lineId, idx) => {
        set((s) => {
          const ln = s.lines[lineId];
          if (!ln) return s;
          const removedStationId = ln.stations[idx];
          const newStations = [...ln.stations.slice(0, idx), ...ln.stations.slice(idx + 1)];
          // If the station is no longer on the line at all, drop its stop cell.
          const stillStops = newStations.includes(removedStationId);
          let stations = s.stations;
          if (!stillStops && stations[removedStationId]) {
            const st = stations[removedStationId];
            stations = {
              ...stations,
              [removedStationId]: {
                ...st,
                stops: st.stops.filter((c) => c.lineId !== lineId),
              },
            };
          }
          return {
            lines: { ...s.lines, [lineId]: { ...ln, stations: newStations } },
            stations,
          };
        });
      },

      reorderLineStations: (lineId, stations) => {
        set((s) => {
          const ln = s.lines[lineId];
          if (!ln) return s;
          return { lines: { ...s.lines, [lineId]: { ...ln, stations } } };
        });
      },

      deleteLine: (id) => {
        set((s) => {
          const { [id]: _gone, ...rest } = s.lines;
          const stations: Record<StationId, Station> = {};
          for (const sid of Object.keys(s.stations)) {
            const st = s.stations[sid];
            stations[sid] = { ...st, stops: st.stops.filter((c) => c.lineId !== id) };
          }
          const order = effectiveLineOrder(s.lineOrder, s.lines).filter((x) => x !== id);
          return { lines: rest, stations, lineOrder: order };
        });
      },

      moveLineInOrder: (id, dir) => {
        set((s) => {
          const order = effectiveLineOrder(s.lineOrder, s.lines).slice();
          const i = order.indexOf(id);
          if (i < 0) return s;
          const j = i + dir;
          if (j < 0 || j >= order.length) return s;
          [order[i], order[j]] = [order[j], order[i]];
          return { lineOrder: order };
        });
      },

      setCurveRadius: (r) => set({ curveRadius: r }),
      setViewport: (v) => set({ viewport: v }),
    }),
    {
      name: 'vignelli-map-doc-v1',
      version: 3,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        stations: s.stations,
        lines: s.lines,
        lineOrder: s.lineOrder,
        curveRadius: s.curveRadius,
        viewport: s.viewport,
      }),
      migrate: (persisted, fromVersion) => {
        const state = persisted as { stations?: Record<string, unknown> };
        // v0 -> v1: stopOrder array -> stops grid.
        if (fromVersion < 1 && state && state.stations) {
          const migratedStations: Record<string, Station> = {};
          for (const [id, raw] of Object.entries(state.stations)) {
            const oldSt = raw as Station & { stopOrder?: LineId[] };
            const stopOrder = oldSt.stopOrder ?? [];
            const stops: StopCell[] = stopOrder.map((lineId, i) => ({
              lineId,
              row: 0,
              col: i,
              orientation: 'vertical' as const,
            }));
            const { stopOrder: _drop, ...rest } = oldSt;
            void _drop;
            migratedStations[id] = { ...rest, stops } as Station;
          }
          state.stations = migratedStations;
        }
        // v1 -> v2: every station gains a label cell. Place it at
        // (0, minCol - 1) — one cell left of the leftmost stop — to match
        // the prior implicit "name to the left" rendering.
        if (fromVersion < 2 && state && state.stations) {
          const migratedStations: Record<string, Station> = {};
          for (const [id, raw] of Object.entries(state.stations)) {
            const st = raw as Station & { label?: LabelCell };
            if (st.label) {
              migratedStations[id] = st;
              continue;
            }
            const minCol = (st.stops ?? []).length === 0
              ? 0
              : Math.min(...st.stops.map((c) => c.col));
            const label: LabelCell = { row: 0, col: minCol - 1, rotation: 0, offset: 0 };
            migratedStations[id] = { ...st, label };
          }
          state.stations = migratedStations;
        }
        // v2 -> v3: label gains an `offset` field (default 0).
        if (fromVersion < 3 && state && state.stations) {
          const migratedStations: Record<string, Station> = {};
          for (const [id, raw] of Object.entries(state.stations)) {
            const st = raw as Station;
            const label: LabelCell = { ...st.label, offset: st.label.offset ?? 0 };
            migratedStations[id] = { ...st, label };
          }
          state.stations = migratedStations;
        }
        return state as MapDoc;
      },
    },
  ),
);

// ----- Drag-vs-click suppression (module-level, not persisted) -----
export const dragState = { suppressClick: false };

// ----- Selection (ephemeral, not persisted) -----

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
  selectStation: (id) =>
    set({
      selectedStationId: id,
      selectedLineId: null,
      selectedStopLineId: null,
      labelSelected: false,
      editingStationId: id === null ? null : get().editingStationId,
    }),
  selectLine: (id) => {
    const wasAppending = get().appendingToLineId !== null;
    const switchingToDifferent = wasAppending && id !== get().appendingToLineId;
    set({
      selectedLineId: id,
      selectedStationId: null,
      appendingToLineId: switchingToDifferent ? null : get().appendingToLineId,
      insertAfterIndex: switchingToDifferent ? null : get().insertAfterIndex,
    });
  },
  startAppendAt: (lineId, idx) =>
    set({
      appendingToLineId: lineId,
      insertAfterIndex: idx,
      selectedLineId: lineId,
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
    set({ labelSelected: selected, selectedStopLineId: selected ? null : get().selectedStopLineId }),
  setEditingStationId: (id) => set({ editingStationId: id }),
}));
