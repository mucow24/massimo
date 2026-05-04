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

const PALETTE = [
  '#EE352E', // red
  '#0039A6', // blue
  '#FF6319', // orange
  '#6CBE45', // green
  '#996633', // brown
  '#A626A4', // magenta
  '#00933C', // dark green
  '#FCCC0A', // yellow
  '#B933AD', // purple
  '#00ADD0', // cyan
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
  toggleStationOnLine: (lineId: LineId, stationId: StationId) => void;
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
        const color = PALETTE[paletteCursor++ % PALETTE.length];
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

      toggleStationOnLine: (lineId, stationId) => {
        set((s) => {
          const ln = s.lines[lineId];
          const st = s.stations[stationId];
          if (!ln || !st) return s;
          const inLine = ln.stations.includes(stationId);
          if (inLine) {
            // remove (all occurrences)
            const newStations = ln.stations.filter((x) => x !== stationId);
            // remove from station's stopOrder if line no longer stops there
            const stillStops = newStations.includes(stationId);
            const newOrder = stillStops ? st.stopOrder : st.stopOrder.filter((x) => x !== lineId);
            return {
              lines: { ...s.lines, [lineId]: { ...ln, stations: newStations } },
              stations: { ...s.stations, [stationId]: { ...st, stopOrder: newOrder } },
            };
          } else {
            const newStations = [...ln.stations, stationId];
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
  placingStation: boolean;
  hoveredStationId: StationId | null;
  selectStation: (id: StationId | null) => void;
  selectLine: (id: LineId | null) => void;
  setAppending: (id: LineId | null) => void;
  setPlacingStation: (placing: boolean) => void;
  setHoveredStation: (id: StationId | null) => void;
}

export const useSelection = create<SelectionState>((set, get) => ({
  selectedStationId: null,
  selectedLineId: null,
  appendingToLineId: null,
  placingStation: false,
  hoveredStationId: null,
  selectStation: (id) => set({ selectedStationId: id, selectedLineId: null }),
  selectLine: (id) => {
    const wasAppending = get().appendingToLineId !== null;
    set({
      selectedLineId: id,
      selectedStationId: null,
      // While in append mode, switching the active line transfers append.
      appendingToLineId: wasAppending && id !== null ? id : get().appendingToLineId,
    });
  },
  setAppending: (id) =>
    set({
      appendingToLineId: id,
      // Keep sidebar selection synced with the line being edited.
      selectedLineId: id ?? get().selectedLineId,
    }),
  setPlacingStation: (placing) => set({ placingStation: placing }),
  setHoveredStation: (id) => set({ hoveredStationId: id }),
}));
