import { create } from 'zustand';
import type { LineId, MapDoc, StationId } from '../model/types';
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
  // Carries the parsed svg payload (data URI + intrinsic size) read from the
  // file at import time; the next canvas click drops it at the cursor.
  | { kind: 'placing-svg'; image: { href: string; width: number; height: number } }
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
export const clearedSelections = () => ({
  selectedStationIds: [] as StationId[],
  selectedRouteBulletIds: [] as string[],
  selectedLabelIds: [] as string[],
  selectedPolygonIds: [] as string[],
  selectedSvgImageIds: [] as string[],
  selectedVertex: null as { polygonId: string; index: number } | null,
  selectedLineId: null as LineId | null,
  selectedLineTagId: null as string | null,
  selectedTransferId: null as string | null,
  selectedStopLineId: null as LineId | null,
  labelSelected: false,
  editingStationId: null as StationId | null,
  mirrorMatching: false,
});

// The "primary" selections a NON-primary selection change (adding a bullet /
// label / polygon to the set) must drop, so a stale line / tag / transfer /
// mirror state can't linger behind a now-foreign selection. Spread into the
// append branch of the list toggles and into replace/add/xor for every list
// kind — one shared home so the cross-clear matrix can't drift per item type
// (the source of the stale-line highlight bug it replaced).
const SIBLING_PRIMARY_CLEAR = {
  selectedLineId: null as LineId | null,
  selectedLineTagId: null as string | null,
  selectedTransferId: null as string | null,
  mirrorMatching: false,
};

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
  // Svg-image selection. Multi-selection: parallel to the other id lists. The
  // last entry is the anchor used by the popover when length === 1.
  selectedSvgImageIds: string[];
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
  selectSvgImage: (id: string | null) => void;
  toggleSvgImageSelection: (id: string) => void;
  setSvgImageSelection: (ids: string[]) => void;
  addSvgImagesToSelection: (ids: string[]) => void;
  xorSvgImagesToSelection: (ids: string[]) => void;
  // Select a single vertex of a polygon (or clear with null). Does NOT touch
  // selectedPolygonIds — the polygon remains the primary selection.
  selectVertex: (sel: { polygonId: string; index: number } | null) => void;
  // Replace the whole selection with a mixed set of bullets/labels/polygons in
  // one atomic update (used after a multi-item paste/duplicate). Clears every
  // other selection and exits to idle, like the single-type select* setters.
  setMixedSelection: (ids: {
    bullets?: string[];
    labels?: string[];
    polygons?: string[];
    svgImages?: string[];
  }) => void;
  // Drop any selection ids that no longer resolve in `doc`. Called after
  // undo/redo, which restore the doc store without touching this (separate)
  // selection store — so an entity the undo removed would otherwise leave a
  // dangling id behind (a null-deref hazard for consumers that index the doc
  // by the selected id). A no-op when everything still resolves.
  reconcileWithDoc: (doc: MapDoc) => void;
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

// The four parallel id-list selection fields. Their select/toggle/set/add/xor
// actions are identical except for the field they touch (and polygons' extra
// vertex clear), so they're generated by one factory rather than hand-copied
// per kind — which is how the cross-clear matrix drifted in the first place.
type IdListField =
  | 'selectedRouteBulletIds'
  | 'selectedLabelIds'
  | 'selectedPolygonIds'
  | 'selectedSvgImageIds';

type SelectionSet = (
  partial: Partial<SelectionState> | ((s: SelectionState) => Partial<SelectionState>),
) => void;
type SelectionGet = () => SelectionState;

/**
 * Build the five list-selection actions for one id-list field. `extraToggleClear`
 * is folded into BOTH branches of toggle (polygons clear their active vertex).
 * `SIBLING_PRIMARY_CLEAR` is folded into the append branch of toggle and into
 * replace/add/xor so a multi-item selection always drops a stale
 * line/tag/transfer/mirror — the one rule, in one place, for every kind.
 * `add`/`xor` keep the reference-equality no-op short-circuit (return `prev`
 * unchanged); `replace` always sets (it's an explicit "make it exactly this").
 */
function makeIdListActions<
  Sel extends keyof SelectionState,
  Tog extends keyof SelectionState,
  Rep extends keyof SelectionState,
  Add extends keyof SelectionState,
  Xor extends keyof SelectionState,
>(
  set: SelectionSet,
  get: SelectionGet,
  field: IdListField,
  names: { select: Sel; toggle: Tog; replace: Rep; add: Add; xor: Xor },
  extraToggleClear: Partial<SelectionState> = {},
): Pick<SelectionState, Sel | Tog | Rep | Add | Xor> {
  const read = (s: SelectionState) => s[field] as string[];
  const patch = (rest: Partial<SelectionState>, ids: string[]): Partial<SelectionState> =>
    ({ ...rest, [field]: ids }) as Partial<SelectionState>;
  return {
    [names.select]: (id: string | null) =>
      set(
        patch(
          {
            ...clearedSelections(),
            // Selecting a non-station primary exits any non-idle mode; a null
            // clear leaves the current mode alone (matches the prior setters).
            uiMode: id == null ? get().uiMode : { kind: 'idle' },
            lineTagHoverPreview: null,
          },
          id == null ? [] : [id],
        ),
      ),
    [names.toggle]: (id: string) =>
      set((s) => {
        const cur = read(s);
        const idx = cur.indexOf(id);
        if (idx >= 0) {
          const next = cur.slice();
          next.splice(idx, 1);
          // Remove branch: keep the line/tag (deselecting one item shouldn't
          // wipe an unrelated primary); only the kind's own extra clear applies.
          return patch({ ...extraToggleClear }, next);
        }
        return patch({ ...SIBLING_PRIMARY_CLEAR, ...extraToggleClear }, [...cur, id]);
      }),
    [names.replace]: (ids: string[]) =>
      set(patch({ ...SIBLING_PRIMARY_CLEAR }, dedupeLastWins(ids))),
    [names.add]: (ids: string[]) =>
      set((s) => {
        const next = unionAppendNovel(read(s), ids);
        return next === read(s) ? {} : patch({ ...SIBLING_PRIMARY_CLEAR }, next);
      }),
    [names.xor]: (ids: string[]) =>
      set((s) => {
        const next = xorAppend(read(s), ids);
        return next === read(s) ? {} : patch({ ...SIBLING_PRIMARY_CLEAR }, next);
      }),
  } as Pick<SelectionState, Sel | Tog | Rep | Add | Xor>;
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
  selectedSvgImageIds: [],
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
        selectedTransferId: null,
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
      selectedTransferId: null,
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
      return { selectedStationIds: next, ...SIBLING_PRIMARY_CLEAR };
    }),
  xorStationsToSelection: (ids) =>
    set((s) => {
      const next = xorAppend(s.selectedStationIds, ids);
      if (next === s.selectedStationIds) return {};
      return { selectedStationIds: next, ...SIBLING_PRIMARY_CLEAR };
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
  ...makeIdListActions(set, get, 'selectedRouteBulletIds', {
    select: 'selectRouteBullet',
    toggle: 'toggleRouteBulletSelection',
    replace: 'setRouteBulletSelection',
    add: 'addRouteBulletsToSelection',
    xor: 'xorRouteBulletsToSelection',
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
  ...makeIdListActions(set, get, 'selectedLabelIds', {
    select: 'selectLabel',
    toggle: 'toggleLabelSelection',
    replace: 'setLabelSelection',
    add: 'addLabelsToSelection',
    xor: 'xorLabelsToSelection',
  }),
  ...makeIdListActions(
    set,
    get,
    'selectedPolygonIds',
    {
      select: 'selectPolygon',
      toggle: 'togglePolygonSelection',
      replace: 'setPolygonSelection',
      add: 'addPolygonsToSelection',
      xor: 'xorPolygonsToSelection',
    },
    // A polygon selection change drops any active vertex handle (the vertex is
    // bound to a single polygon's edit session).
    { selectedVertex: null },
  ),
  ...makeIdListActions(set, get, 'selectedSvgImageIds', {
    select: 'selectSvgImage',
    toggle: 'toggleSvgImageSelection',
    replace: 'setSvgImageSelection',
    add: 'addSvgImagesToSelection',
    xor: 'xorSvgImagesToSelection',
  }),
  selectVertex: (sel) => set({ selectedVertex: sel }),
  setMixedSelection: (ids) =>
    set({
      ...clearedSelections(),
      uiMode: { kind: 'idle' },
      selectedRouteBulletIds: dedupeLastWins(ids.bullets ?? []),
      selectedLabelIds: dedupeLastWins(ids.labels ?? []),
      selectedPolygonIds: dedupeLastWins(ids.polygons ?? []),
      selectedSvgImageIds: dedupeLastWins(ids.svgImages ?? []),
    }),
  reconcileWithDoc: (doc) => {
    const s = get();
    const next: Partial<SelectionState> = {};
    // Filter an id list against the doc; return the kept list only when it
    // actually shrank, so an all-resolving list keeps its reference.
    const prune = <T extends string>(ids: T[], exists: (id: T) => boolean): T[] | undefined => {
      const kept = ids.filter(exists);
      return kept.length === ids.length ? undefined : kept;
    };
    const stations = prune(s.selectedStationIds, (id) => !!doc.stations[id]);
    if (stations) next.selectedStationIds = stations;
    const bullets = prune(s.selectedRouteBulletIds, (id) => !!doc.routeBullets[id]);
    if (bullets) next.selectedRouteBulletIds = bullets;
    const labels = prune(s.selectedLabelIds, (id) => !!doc.textLabels[id]);
    if (labels) next.selectedLabelIds = labels;
    const polygons = prune(s.selectedPolygonIds, (id) => !!doc.polygons[id]);
    if (polygons) next.selectedPolygonIds = polygons;
    const svgImages = prune(s.selectedSvgImageIds, (id) => !!doc.svgImages[id]);
    if (svgImages) next.selectedSvgImageIds = svgImages;
    // Single primaries.
    if (s.selectedLineId && !doc.lines[s.selectedLineId]) next.selectedLineId = null;
    if (s.selectedLineTagId && !doc.lineTags[s.selectedLineTagId]) next.selectedLineTagId = null;
    if (s.selectedTransferId && !doc.transfers[s.selectedTransferId])
      next.selectedTransferId = null;
    // Within-station inspector + hover state bound to a specific entity.
    if (s.editingStationId && !doc.stations[s.editingStationId]) next.editingStationId = null;
    if (s.selectedStopLineId && !doc.lines[s.selectedStopLineId]) next.selectedStopLineId = null;
    if (s.hoveredStationId && !doc.stations[s.hoveredStationId]) next.hoveredStationId = null;
    // A vertex handle dangles if its polygon is gone OR shrank past its index.
    if (s.selectedVertex) {
      const poly = doc.polygons[s.selectedVertex.polygonId];
      if (!poly || s.selectedVertex.index >= poly.vertices.length) next.selectedVertex = null;
    }
    // Skip the set() entirely when nothing dangled — zustand notifies
    // subscribers on every set (even an empty patch), so this keeps the common
    // undo/redo path a true no-op rather than re-running every selector.
    if (Object.keys(next).length > 0) set(next);
  },
}));

// ---- derived-selection selectors: one named home for "what is selected" ----

// The single selected item across ALL four item-type lists, or null when the
// total count isn't exactly one. Lets the inspector + item popovers gate on one
// shared notion instead of each hand-checking the other three lists' lengths
// (which had drifted — a co-selected bullet used to leak its popover open).
export type SoleSelection =
  | { type: 'station'; id: StationId }
  | { type: 'bullet'; id: string }
  | { type: 'label'; id: string }
  | { type: 'polygon'; id: string }
  | { type: 'svgImage'; id: string }
  | null;

export function soleSelection(s: SelectionState): SoleSelection {
  const total =
    s.selectedStationIds.length +
    s.selectedRouteBulletIds.length +
    s.selectedLabelIds.length +
    s.selectedPolygonIds.length +
    s.selectedSvgImageIds.length;
  if (total !== 1) return null;
  if (s.selectedStationIds.length === 1) return { type: 'station', id: s.selectedStationIds[0] };
  if (s.selectedRouteBulletIds.length === 1)
    return { type: 'bullet', id: s.selectedRouteBulletIds[0] };
  if (s.selectedLabelIds.length === 1) return { type: 'label', id: s.selectedLabelIds[0] };
  if (s.selectedPolygonIds.length === 1) return { type: 'polygon', id: s.selectedPolygonIds[0] };
  return { type: 'svgImage', id: s.selectedSvgImageIds[0] };
}

// The copyable/duplicable selection: every item type EXCEPT stations (the
// clipboard has no station payload, so copy/paste/duplicate skip them). One
// home for that asymmetry, instead of an inline comment at each keyboard branch.
export function getCopyableSelection(s: SelectionState): {
  bullets: string[];
  labels: string[];
  polygons: string[];
  svgImages: string[];
} {
  return {
    bullets: s.selectedRouteBulletIds,
    labels: s.selectedLabelIds,
    polygons: s.selectedPolygonIds,
    svgImages: s.selectedSvgImageIds,
  };
}
