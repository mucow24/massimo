import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Line, LineId, MapDoc, Rotation, Station, StationId, Viewport } from './types';

const uid = () =>
  Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

const DEFAULT_DOC: MapDoc = {
  stations: {},
  lines: {},
  curveRadius: 24,
  viewport: { x: 0, y: 0, zoom: 1 },
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
  reorderStops: (id: StationId, stopOrder: LineId[]) => void;

  addLine: () => LineId;
  updateLine: (id: LineId, patch: Partial<Pick<Line, 'service' | 'color' | 'stations'>>) => void;
  toggleStationOnLine: (lineId: LineId, stationId: StationId, insertAfterIndex?: number) => void;
  removeStationFromLine: (lineId: LineId, idx: number) => void;
  reorderLineStations: (lineId: LineId, stations: StationId[]) => void;
  deleteLine: (id: LineId) => void;

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
          stopOrder: [],
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

      reorderStops: (id, stopOrder) => {
        set((s) => {
          const cur = s.stations[id];
          if (!cur) return s;
          return { stations: { ...s.stations, [id]: { ...cur, stopOrder } } };
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
          return { lines: { ...s.lines, [id]: line } };
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
            const newOrder = stillStops ? st.stopOrder : st.stopOrder.filter((x) => x !== lineId);
            return {
              lines: { ...s.lines, [lineId]: { ...ln, stations: newStations } },
              stations: { ...s.stations, [stationId]: { ...st, stopOrder: newOrder } },
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
            const newOrder = st.stopOrder.includes(lineId)
              ? st.stopOrder
              : [...st.stopOrder, lineId];
            return {
              lines: { ...s.lines, [lineId]: { ...ln, stations: newStations } },
              stations: { ...s.stations, [stationId]: { ...st, stopOrder: newOrder } },
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
          // If station is no longer on the line at all, remove from its stopOrder.
          const stillStops = newStations.includes(removedStationId);
          let stations = s.stations;
          if (!stillStops && stations[removedStationId]) {
            const st = stations[removedStationId];
            stations = {
              ...stations,
              [removedStationId]: {
                ...st,
                stopOrder: st.stopOrder.filter((x) => x !== lineId),
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
            stations[sid] = { ...st, stopOrder: st.stopOrder.filter((x) => x !== id) };
          }
          return { lines: rest, stations };
        });
      },

      setCurveRadius: (r) => set({ curveRadius: r }),
      setViewport: (v) => set({ viewport: v }),
    }),
    {
      name: 'vignelli-map-doc-v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        stations: s.stations,
        lines: s.lines,
        curveRadius: s.curveRadius,
        viewport: s.viewport,
      }),
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
  selectStation: (id: StationId | null) => void;
  selectLine: (id: LineId | null) => void;
  startAppendAt: (lineId: LineId, insertAfterIndex: number) => void;
  setAppending: (id: LineId | null) => void;
  setInsertAfterIndex: (idx: number | null) => void;
  setPlacingStation: (placing: boolean) => void;
  setHoveredStation: (id: StationId | null) => void;
}

export const useSelection = create<SelectionState>((set, get) => ({
  selectedStationId: null,
  selectedLineId: null,
  appendingToLineId: null,
  insertAfterIndex: null,
  placingStation: false,
  hoveredStationId: null,
  selectStation: (id) => set({ selectedStationId: id, selectedLineId: null }),
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
}));
