import { create } from 'zustand';
import type { LineId, StationId } from '../model/types';
import type { Vec2 } from '../geometry/vec';

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
  | { kind: 'creating-polygon' }
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
  selectedPolygonIds: [] as string[],
  selectedVertex: null as { polygonId: string; index: number } | null,
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
  // Polygon selection. Multi-selection: parallel to the other id lists. The
  // last entry is the anchor used by the popover when length === 1.
  selectedPolygonIds: string[];
  // A single selected polygon vertex (for handle highlight + Delete). Set by
  // clicking a vertex handle; independent of `selectedPolygonIds` so the
  // polygon stays selected (and its popover open) while a vertex is active.
  selectedVertex: { polygonId: string; index: number } | null;
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
  selectPolygon: (id: string | null) => void;
  togglePolygonSelection: (id: string) => void;
  setPolygonSelection: (ids: string[]) => void;
  addPolygonsToSelection: (ids: string[]) => void;
  xorPolygonsToSelection: (ids: string[]) => void;
  // Select a single vertex of a polygon (or clear with null). Does NOT touch
  // selectedPolygonIds — the polygon remains the primary selection.
  selectVertex: (sel: { polygonId: string; index: number } | null) => void;
}

// ---- selection id-list algebra: pure helpers shared by all three kinds ----

// Dedupe preserving each id's LAST occurrence (later position wins).
function dedupeLastWins<Id extends string>(ids: Id[]): Id[] {
  const lastIdx = new Map<Id, number>();
  ids.forEach((id, i) => lastIdx.set(id, i));
  return ids.filter((id, i) => lastIdx.get(id) === i);
}

// Append the ids not already present, preserving order. Returns `prev`
// unchanged (same reference) when nothing is novel, so callers can collapse the
// set() to a no-op for free.
function unionAppendNovel<Id extends string>(prev: Id[], ids: Id[]): Id[] {
  const have = new Set(prev);
  const novel = ids.filter((id) => !have.has(id));
  return novel.length === 0 ? prev : [...prev, ...novel];
}

// Symmetric-difference toggle: ids already present are removed, the rest are
// appended. Returns `prev` unchanged when `ids` is empty.
function xorAppend<Id extends string>(prev: Id[], ids: Id[]): Id[] {
  if (ids.length === 0) return prev;
  const have = new Set(prev);
  const removeSet = new Set<Id>();
  const appendList: Id[] = [];
  for (const id of ids) {
    if (have.has(id)) removeSet.add(id);
    else appendList.push(id);
  }
  return [...prev.filter((id) => !removeSet.has(id)), ...appendList];
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
  selectedPolygonIds: [],
  selectedVertex: null,
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
    set(() => ({
      selectedStationIds: dedupeLastWins(ids),
      selectedLineId: null,
      selectedLineTagId: null,
      selectedStopLineId: null,
      labelSelected: false,
      editingStationId: null,
      activeTab: 'stations',
      mirrorMatching: false,
    })),
  addStationsToSelection: (ids) =>
    set((s) => {
      const next = unionAppendNovel(s.selectedStationIds, ids);
      if (next === s.selectedStationIds) return {};
      return {
        selectedStationIds: next,
        selectedLineId: null,
        selectedLineTagId: null,
        mirrorMatching: false,
      };
    }),
  xorStationsToSelection: (ids) =>
    set((s) => {
      const next = xorAppend(s.selectedStationIds, ids);
      if (next === s.selectedStationIds) return {};
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
  setRouteBulletSelection: (ids) => set(() => ({ selectedRouteBulletIds: dedupeLastWins(ids) })),
  addRouteBulletsToSelection: (ids) =>
    set((s) => {
      const next = unionAppendNovel(s.selectedRouteBulletIds, ids);
      return next === s.selectedRouteBulletIds ? {} : { selectedRouteBulletIds: next };
    }),
  xorRouteBulletsToSelection: (ids) =>
    set((s) => {
      const next = xorAppend(s.selectedRouteBulletIds, ids);
      return next === s.selectedRouteBulletIds ? {} : { selectedRouteBulletIds: next };
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
  setLabelSelection: (ids) => set(() => ({ selectedLabelIds: dedupeLastWins(ids) })),
  addLabelsToSelection: (ids) =>
    set((s) => {
      const next = unionAppendNovel(s.selectedLabelIds, ids);
      return next === s.selectedLabelIds ? {} : { selectedLabelIds: next };
    }),
  xorLabelsToSelection: (ids) =>
    set((s) => {
      const next = xorAppend(s.selectedLabelIds, ids);
      return next === s.selectedLabelIds ? {} : { selectedLabelIds: next };
    }),
  selectPolygon: (id) =>
    set({
      ...clearedSelections(),
      uiMode: id == null ? get().uiMode : { kind: 'idle' },
      selectedPolygonIds: id == null ? [] : [id],
      lineTagHoverPreview: null,
    }),
  togglePolygonSelection: (id) =>
    set((s) => {
      const idx = s.selectedPolygonIds.indexOf(id);
      if (idx >= 0) {
        const next = s.selectedPolygonIds.slice();
        next.splice(idx, 1);
        return { selectedPolygonIds: next, selectedVertex: null };
      }
      return {
        selectedPolygonIds: [...s.selectedPolygonIds, id],
        selectedLineId: null,
        selectedLineTagId: null,
        selectedVertex: null,
      };
    }),
  setPolygonSelection: (ids) => set(() => ({ selectedPolygonIds: dedupeLastWins(ids) })),
  addPolygonsToSelection: (ids) =>
    set((s) => {
      const next = unionAppendNovel(s.selectedPolygonIds, ids);
      return next === s.selectedPolygonIds ? {} : { selectedPolygonIds: next };
    }),
  xorPolygonsToSelection: (ids) =>
    set((s) => {
      const next = xorAppend(s.selectedPolygonIds, ids);
      return next === s.selectedPolygonIds ? {} : { selectedPolygonIds: next };
    }),
  selectVertex: (sel) => set({ selectedVertex: sel }),
}));
