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
import { randomStationName } from './stationNames';

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

// After a line's station list changes, re-pick each station's rotation so the
// line travels through it cleanly. Each station's local +y points along the
// line's world travel direction at that station.
//
// Skips stations that carry other lines' stops too — those are transfer hubs
// where the user has presumably set rotation deliberately, and clobbering it
// from one of the participating lines would just thrash.
const autoOrientLineStops = (
  stationsIn: Record<StationId, Station>,
  lineId: LineId,
  lineStations: StationId[],
): Record<StationId, Station> => {
  if (lineStations.length < 2) return stationsIn;
  const out = { ...stationsIn };
  for (let i = 0; i < lineStations.length; i++) {
    const sid = lineStations[i];
    const st = out[sid];
    if (!st) continue;
    if (st.stops.some((c) => c.lineId !== lineId)) continue;
    const prev = i > 0 ? out[lineStations[i - 1]] : null;
    const next = i < lineStations.length - 1 ? out[lineStations[i + 1]] : null;
    if (!prev && !next) continue;
    let wx = 0;
    let wy = 0;
    if (prev && next) {
      const ix = st.x - prev.x;
      const iy = st.y - prev.y;
      const ox = next.x - st.x;
      const oy = next.y - st.y;
      const inN = Math.hypot(ix, iy) || 1;
      const outN = Math.hypot(ox, oy) || 1;
      wx = ix / inN + ox / outN;
      wy = iy / inN + oy / outN;
    } else if (prev) {
      wx = st.x - prev.x;
      wy = st.y - prev.y;
    } else if (next) {
      wx = next.x - st.x;
      wy = next.y - st.y;
    }
    if (wx === 0 && wy === 0) continue;
    // Rotation r ∈ 0..7 such that local +y, after rotation, points along
    // (wx, wy). Derivation: rotateBy((0,1), r·π/4) = (−sin a, cos a); set
    // that equal to the unit travel vector and solve.
    const theta = Math.atan2(wy, wx);
    const r = (((Math.round((4 * theta) / Math.PI - 2) % 8) + 8) % 8) as Rotation;
    if (st.rotation === r) continue;
    out[sid] = { ...st, rotation: r };
  }
  return out;
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

  setCurveRadius: (r: number) => void;
  setViewport: (v: Viewport) => void;
  clearAll: () => void;
}

export const useDoc = create<DocState>()(
  persist(
    (set) => ({
      ...DEFAULT_DOC,

      addStation: (x, y) => {
        const id = uid();
        const station: Station = {
          id,
          name: randomStationName(),
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

      // Rotate the layout (col/row of every stop + label) 90° while rotating
      // the station the OPPOSITE way, so the world appearance stays the same
      // but the editor view of the unrotated grid is reoriented. Stop
      // orientations and label rotation are transformed in lockstep so world
      // tangent directions stay invariant too.
      //
      // dir = +1: layout rotates clockwise; station rotates CCW (rotation += 6).
      // dir = -1: layout rotates CCW; station rotates CW (rotation += 2).
      // CW maps (col, row) → (-row, col); CCW maps (col, row) → (row, -col).
      rotateStationAndLayout: (id, dir) => {
        set((s) => {
          const cur = s.stations[id];
          if (!cur) return s;
          const stationStep = dir === 1 ? 6 : 2; // CCW for R+, CW for R-
          const nextRot = ((cur.rotation + stationStep) % 8) as Rotation;
          const rotateGrid = (col: number, row: number) =>
            dir === 1 ? { col: -row, row: col } : { col: row, row: -col };
          // Orientation maps so that the WORLD tangent direction is preserved
          // across the change in station rotation.
          // R+ (station CCW 90°): up→right, right→down, down→left, left→up.
          // R− (station CW 90°): up→left, left→down, down→right, right→up.
          const rotOrient = (o: StopOrientation): StopOrientation => {
            if (o === 'auto-vertical') return 'auto-horizontal';
            if (o === 'auto-horizontal') return 'auto-vertical';
            if (dir === 1) {
              if (o === 'up') return 'right';
              if (o === 'right') return 'down';
              if (o === 'down') return 'left';
              return 'up'; // o === 'left'
            } else {
              if (o === 'up') return 'left';
              if (o === 'left') return 'down';
              if (o === 'down') return 'right';
              return 'up'; // o === 'right'
            }
          };
          const stops = cur.stops.map((c) => {
            const r = rotateGrid(c.col, c.row);
            return { ...c, col: r.col, row: r.row, orientation: rotOrient(c.orientation) };
          });
          const lr = rotateGrid(cur.label.col, cur.label.row);
          // Label rotation is in the unrotated local frame; to keep its world
          // orientation, advance it the inverse of the station's step.
          const labelStep = dir === 1 ? 2 : 6;
          const labelRot = ((cur.label.rotation + labelStep) % 8) as Rotation;
          const label = { ...cur.label, col: lr.col, row: lr.row, rotation: labelRot };
          return {
            stations: { ...s.stations, [id]: { ...cur, rotation: nextRot, stops, label } },
          };
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
          // Cycle: auto-vertical → up → down → auto-horizontal → left → right
          const cycle: StopOrientation[] = [
            'auto-vertical',
            'up',
            'down',
            'auto-horizontal',
            'left',
            'right',
          ];
          const idx = cycle.indexOf(cur.orientation);
          const next = cycle[(idx + 1) % cycle.length];
          const newStops = st.stops.slice();
          newStops[i] = { ...cur, orientation: next };
          return { stations: { ...s.stations, [stationId]: { ...st, stops: newStops } } };
        });
      },

      moveLabel: (stationId, dRow, dCol) => {
        set((s) => {
          const st = s.stations[stationId];
          if (!st) return s;
          if (dRow === 0 && dCol === 0) return s;
          // Step in the requested direction; if a stop occupies the
          // destination, keep stepping until we land on an empty cell. So
          // [Label] O O O + → ends up O O O [Label].
          let newRow = st.label.row + dRow;
          let newCol = st.label.col + dCol;
          while (st.stops.some((c) => c.row === newRow && c.col === newCol)) {
            newRow += dRow;
            newCol += dCol;
          }
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

      flipLabel: (stationId) => {
        set((s) => {
          const st = s.stations[stationId];
          if (!st) return s;
          const next = ((st.label.rotation + 4) % 8) as Rotation;
          return {
            stations: {
              ...s.stations,
              [stationId]: { ...st, label: { ...st.label, rotation: next } },
            },
          };
        });
      },

      mirrorLabel: (stationId) => {
        set((s) => {
          const st = s.stations[stationId];
          if (!st) return s;
          if (st.stops.length === 0) {
            // Just flip the rotation; nothing to mirror around.
            const next = ((st.label.rotation + 4) % 8) as Rotation;
            return {
              stations: {
                ...s.stations,
                [stationId]: { ...st, label: { ...st.label, rotation: next } },
              },
            };
          }
          // Direction from the label to the stops' centroid (quantized to
          // a single dominant cardinal axis). The mirrored label sits one
          // step past the FURTHEST stop along that direction (and any
          // stops beyond), so a label on one side ends up on the opposite
          // side of the entire footprint.
          const cx = st.stops.reduce((a, c) => a + c.col, 0) / st.stops.length;
          const cy = st.stops.reduce((a, c) => a + c.row, 0) / st.stops.length;
          const drRaw = cy - st.label.row;
          const dcRaw = cx - st.label.col;
          let dRow = 0;
          let dCol = 0;
          if (Math.abs(drRaw) > Math.abs(dcRaw)) dRow = Math.sign(drRaw) || 1;
          else dCol = Math.sign(dcRaw) || 1;
          // Furthest stop along (dRow, dCol).
          const proj = (r: number, c: number) => r * dRow + c * dCol;
          const maxProj = st.stops.reduce(
            (m, cell) => Math.max(m, proj(cell.row, cell.col)),
            -Infinity,
          );
          // Step past the max-projected stop (and any other stops at the
          // same projection level beyond) until we land on an empty cell.
          let newRow = st.label.row;
          let newCol = st.label.col;
          // March until we're past maxProj AND on an empty cell.
          // Safety bound just in case.
          for (let k = 0; k < 1000; k++) {
            newRow += dRow;
            newCol += dCol;
            const beyond = proj(newRow, newCol) > maxProj;
            const empty = !st.stops.some(
              (c) => c.row === newRow && c.col === newCol,
            );
            if (beyond && empty) break;
          }
          const next = ((st.label.rotation + 4) % 8) as Rotation;
          return {
            stations: {
              ...s.stations,
              [stationId]: {
                ...st,
                label: { ...st.label, row: newRow, col: newCol, rotation: next },
              },
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
            const stationsAfter = {
              ...s.stations,
              [stationId]: { ...st, stops: newStops },
            };
            return {
              lines: { ...s.lines, [lineId]: { ...ln, stations: newStations } },
              stations: autoOrientLineStops(stationsAfter, lineId, newStations),
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
                orientation: 'auto-vertical',
              };
              newStops = [...st.stops, newCell];
            }
            const stationsAfter = {
              ...s.stations,
              [stationId]: { ...st, stops: newStops },
            };
            return {
              lines: { ...s.lines, [lineId]: { ...ln, stations: newStations } },
              stations: autoOrientLineStops(stationsAfter, lineId, newStations),
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
            stations: autoOrientLineStops(stations, lineId, newStations),
          };
        });
      },

      reorderLineStations: (lineId, stations) => {
        set((s) => {
          const ln = s.lines[lineId];
          if (!ln) return s;
          return {
            lines: { ...s.lines, [lineId]: { ...ln, stations } },
            stations: autoOrientLineStops(s.stations, lineId, stations),
          };
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
      clearAll: () => {
        paletteCursor = 0;
        set({ ...DEFAULT_DOC });
      },
    }),
    {
      name: 'vignelli-map-doc-v1',
      version: 5,
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
              orientation: 'auto-vertical' as const,
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
        // v3/v4 -> v5: stop orientation enum widens. Map legacy `vertical`/
        // `horizontal` to the new `auto-vertical`/`auto-horizontal` so the
        // direction is now line-derived (previously it was hard-coded +axis).
        // For docs whose stations were already auto-rotated to make the line
        // travel in the +axis direction, this is identical behavior.
        //
        // The version was bumped through 4 during dev HMR before this
        // migration existed, leaving some persisted docs at v4 with the old
        // string values. Running this whenever fromVersion < 5 catches both.
        // The rename is a no-op on already-migrated values.
        if (fromVersion < 5 && state && state.stations) {
          const migratedStations: Record<string, Station> = {};
          for (const [id, raw] of Object.entries(state.stations)) {
            const st = raw as Station;
            const stops = st.stops.map((c) => {
              const o = c.orientation as unknown as string;
              if (o === 'vertical') return { ...c, orientation: 'auto-vertical' as const };
              if (o === 'horizontal') return { ...c, orientation: 'auto-horizontal' as const };
              return c;
            });
            migratedStations[id] = { ...st, stops };
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
    set({ labelSelected: selected, selectedStopLineId: selected ? null : get().selectedStopLineId }),
  setEditingStationId: (id) => set({ editingStationId: id }),
  setActiveTab: (tab) => set({ activeTab: tab }),
}));
