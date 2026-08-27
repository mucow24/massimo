import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { LineId, MapDoc, StationId, TransferEnd } from '../model/types';
import { transferEndResolves } from '../model/transferAnchors';
import type { Vec2 } from '../geometry/vec';
// The append cursor/hover types and the hover-equality helper live in the pure
// appendGestures model module (no store or component import, so no cycle).
import type { AppendCursor, AppendHover } from '../model/appendGestures';
import { sameAppendHover } from '../model/appendGestures';
import { healPersistedUnion } from './persistedUnion';

// ----- Selection (ephemeral, except the two persisted sidebar fields:
//       `sidebarOpen` and `activeTab`) -----

/**
 * The sidebar's tabs, in the order they sit in the strip. The ARRAY is the
 * source of truth and the type is derived from it, so the membership guard
 * below can judge a stored value without re-spelling the members — the same
 * ladder-and-guard shape every other stored union in the app uses.
 */
export const SIDEBAR_TABS = ['stations', 'lines', 'styles'] as const;

export type SidebarTab = (typeof SIDEBAR_TABS)[number];

/** The tab a fresh session opens on, and what a stored non-member heals to. */
export const DEFAULT_SIDEBAR_TAB: SidebarTab = 'stations';

export const isSidebarTab = (v: unknown): v is SidebarTab =>
  typeof v === 'string' && (SIDEBAR_TABS as readonly string[]).includes(v);

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
      // The FIRST end picked, or null before the first click. Named `firstEnd`
      // rather than `anchor` because a transfer end can now BE a transfer
      // anchor — `anchor.anchorId` was going to read like a riddle.
      firstEnd: TransferEnd | null;
    }
  | { kind: 'placing-label' }
  // Sticky click-to-place for transfer anchors, like placing-station: each
  // click drops one, Esc / right-click exits.
  | { kind: 'placing-anchor' }
  | { kind: 'creating-polygon' }
  // Two-click placement: the first click sets the CENTER (stored here), the
  // second sets the radius from the cursor's distance — with a live ghost ring
  // + diameter readout in between. `center: null` is the first phase.
  | { kind: 'placing-line-circle'; center: Vec2 | null }
  // Carries the parsed svg payload (data URI + intrinsic size) read from the
  // file at import time; the next canvas click drops it at the cursor.
  | { kind: 'placing-svg'; image: { href: string; width: number; height: number } }
  // Edit Stops: all line editing happens on the canvas, driven by the CURSOR
  // (see appendGestures.ts — station cursor connects, edge cursor splices,
  // null is "nothing pending"). The cursor is updated in place via
  // setAppendCursor.
  | { kind: 'appending-to-line'; lineId: LineId; cursor: AppendCursor }
  | { kind: 'layering' }
  // Edit the station's stop/label layout in place on the canvas: drag the
  // real dots/label between ghost-lattice slots, right-click to rotate.
  | { kind: 'editing-station-layout'; stationId: StationId };

// Every canvas item type that shows a selection highlight, and thus a
// 50%-opacity mouseover PREVIEW of it. Lines are excluded on purpose — line
// "selection" is a whole-map dim/repaint mode, not a per-item ring.
export type HoverKind =
  | 'station'
  | 'transfer'
  | 'bullet'
  | 'label'
  | 'polygon'
  | 'svgImage'
  | 'lineTag'
  | 'lineCircle'
  | 'guide';

export interface HoveredCanvasItem {
  kind: HoverKind;
  id: string;
}

/**
 * UiMode kinds where a right-click does NOT cancel the mode. Lives next to
 * the {@link UiMode} union so adding a new mode that wants right-click for
 * its own gesture (layering uses it to decrement a segment's layer) is one
 * edit, not a hunt across handlers.
 */
export const RIGHT_CLICK_PASSTHROUGH_MODES: ReadonlySet<UiMode['kind']> = new Set([
  'idle',
  'layering',
  // Right-click rotates the stop/label under the cursor.
  'editing-station-layout',
  // Right-click EXITS Edit Stops via the canvas's own onContextMenu handler
  // (MapCanvas), so the document-level cancel must stand down here and defer
  // to it — removal is the × chip or the Delete key, not a right-click.
  'appending-to-line',
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
  selectedAnchorIds: [] as string[],
  selectedLineCircleIds: [] as string[],
  selectedGuideIds: [] as string[],
  selectedVertices: null as { polygonId: string; indices: number[] } | null,
  selectedLineId: null as LineId | null,
  selectedLineTagId: null as string | null,
  selectedTransferId: null as string | null,
  selectedStopLineId: null as LineId | null,
  labelSelected: false,
  selectedAnchorCellId: null as string | null,
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
  // A vertex set belongs to ONE polygon's edit session, and its handles only
  // render for a polygon that is itself selected — so any selection change
  // that doesn't keep that polygon alone leaves an INVISIBLE armed vertex.
  // Delete and the arrow keys both give it top priority, so a marquee or a
  // shift-click would silently amputate or nudge a vertex of a polygon the
  // user can no longer see selected. (The toggle-REMOVE branch clears it via
  // the polygon kind's own `extraToggleClear`.)
  selectedVertices: null as { polygonId: string; indices: number[] } | null,
  mirrorMatching: false,
};

// editing-station-layout is bound to ONE station: the mode follows the sole
// selected station. A station-selection mutation that lands on exactly one
// OTHER station retargets the editor to it (clicking a neighbor keeps you in
// layout editing); any multi/empty result exits, so the payload can never
// dangle behind a marquee/shift-click selection made while the mode's canvas
// chrome is up. Spread into every station-selection mutation; selectStation
// applies the same rule inline.
const layoutEditReconcile = (
  cur: UiMode,
  nextIds: readonly StationId[],
): { uiMode: UiMode } | Record<string, never> => {
  if (cur.kind !== 'editing-station-layout') return {};
  if (nextIds.length !== 1) return { uiMode: { kind: 'idle' } };
  if (nextIds[0] === cur.stationId) return {};
  return { uiMode: { kind: 'editing-station-layout', stationId: nextIds[0] } };
};

export interface SelectionState {
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
  // The canvas item (station, transfer, bullet, label, polygon, svg image, or
  // line tag) the pointer is currently over. Drives a 50%-opacity preview of
  // that item's selection chrome (a "you can click this" affordance). Kept
  // separate from hoveredStationId, which is the sidebar/inspector-driven
  // label-emphasis hover — canvas mouseover must not bold every name the cursor
  // sweeps past. Ephemeral (never persisted); the hoveredChrome selector gates
  // whether it actually paints (idle mode, not panning, not already selected).
  hoveredCanvasItem: HoveredCanvasItem | null;
  // Edit Stops mouseover target: the station or segment under the cursor while
  // editing a line's stops. Drives a 50%-opacity preview of the chrome a click
  // would produce (the "what will I select" affordance), painted in
  // HighlightedLineLayer. Kept apart from hoveredCanvasItem, whose whole reason
  // for being is the idle-mode preview (and whose hoveredChrome gate suppresses
  // non-idle modes); this one is meaningful ONLY in appending-to-line. Ephemeral
  // (never persisted); cleared on pointer leave and on any mode exit.
  appendHover: AppendHover;
  // The (lineId, stationId) currently hovered in the transfer-creation flow.
  // Used to highlight the corresponding stop dot on the canvas.
  hoveredLineStop: { lineId: LineId; stationId: StationId } | null;
  // The transfer ANCHOR hovered in that same flow — the anchor twin of
  // hoveredLineStop, giving both kinds of endpoint the same "you can click
  // this" affordance. Keyed by the layer's own render key (`anchorId` for a
  // free anchor, `stationId:anchorId` for a hosted one) so one nullable string
  // covers both homes. Ephemeral; dropped on every mode transition, because
  // committing or cancelling unmounts the anchor under the cursor and no
  // pointerout ever fires.
  hoveredAnchorKey: string | null;
  // The lineId of the currently-selected stop cell within the active station
  // inspector. Cleared whenever a different station is selected.
  selectedStopLineId: LineId | null;
  // True if the label cell is the current selection within the grid editor.
  // Mutually exclusive with selectedStopLineId and selectedAnchorCellId.
  labelSelected: boolean;
  // The station-HOSTED transfer anchor armed within the layout editor, if any.
  // The third arm of the same mutually-exclusive sub-selection: whichever of
  // the three is set is what the arrow keys nudge and what the editor rings.
  // Distinct from `selectedAnchorIds` — that is the canvas selection of FREE
  // anchors, which are a different thing living in a different collection.
  selectedAnchorCellId: string | null;
  // The station whose name is being edited inline on the canvas.
  editingStationId: StationId | null;
  // Which sidebar tab is currently visible.
  activeTab: SidebarTab;
  // Whether the sidebar's Stations/Lines list is expanded. When false the tab
  // bar still shows, but no list below it. Clicking the shown tab collapses it;
  // clicking the other tab (or any tab while collapsed) opens that tab's list.
  sidebarOpen: boolean;
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
  // Selected polygon vertices (for handle highlight + Delete/nudge/drag). Set
  // by clicking a vertex handle (shift-click toggles more in/out). All indices
  // belong to ONE polygon — vertex editing is single-polygon. Independent of
  // `selectedPolygonIds` so the polygon stays selected (and its popover open)
  // while vertices are active. Never empty: an empty set collapses to null.
  selectedVertices: { polygonId: string; indices: number[] } | null;
  // Svg-image selection. Multi-selection: parallel to the other id lists. The
  // last entry is the anchor used by the popover when length === 1.
  selectedSvgImageIds: string[];
  // FREE transfer-anchor selection. Multi-selection: parallel to the other id
  // lists. Station-HOSTED anchors never appear here — they are station
  // internals, edited only in the layout editor, exactly like a stop dot.
  // Anchors are the one selectable kind with no `locked` field and no popover,
  // so they are deliberately absent from getCopyableSelection (nothing to
  // paste that would carry its transfer) while still answering Delete, the
  // arrow keys, the marquee, and group drag/rotate.
  selectedAnchorIds: string[];
  // Line-circle selection (the dashed guide rings). A marquee picks one up
  // only when the rect touches its RIM (lineCirclesForRect) — a box-select
  // dragged inside the ring must not grab the guide. Sole selection opens the
  // tiny LineCirclePopover (diameter + lock/delete); absent from
  // getCopyableSelection.
  selectedLineCircleIds: string[];
  // Alignment-guide selection. Click / shift-click only — the marquee NEVER
  // sweeps guides, since an infinite line would join nearly every rect. Sole
  // selection opens the GuidePopover (position + lock/delete); absent from
  // getCopyableSelection.
  selectedGuideIds: string[];
  // When true (the inspector's Select Similar toggle), layout edits (stop
  // layout + label + station rotation) mirror to every station sharing a
  // line whose layout renders identically (model/matching.ts — whole line,
  // not adjacency). Resets to false whenever a different station is selected.
  mirrorMatching: boolean;
  // Canvas tool mode: 'arrow' for select/move, 'hand' for pan.
  toolMode: 'arrow' | 'hand';
  // Spacebar held → temporarily acts like hand mode.
  spaceHeld: boolean;
  // Alt held → Edit Stops previews the create-station ghost under the cursor
  // (alt-click is the create gesture there). Tracked like spaceHeld: set on
  // keydown, cleared on keyup AND window blur (alt-tab eats the keyup).
  altHeld: boolean;
  setToolMode: (m: 'arrow' | 'hand') => void;
  setSpaceHeld: (v: boolean) => void;
  setAltHeld: (v: boolean) => void;
  selectStation: (id: StationId | null) => void;
  toggleStationSelection: (id: StationId) => void;
  setStationSelection: (ids: StationId[]) => void;
  addStationsToSelection: (ids: StationId[]) => void;
  xorStationsToSelection: (ids: StationId[]) => void;
  selectLine: (id: LineId | null) => void;
  // Enter editing-station-layout with the station selected and mirror
  // matching preserved — a vanilla setUiMode would wipe both (the mode's
  // whole UI depends on them; same re-assert pattern as startAppend).
  startEditingStationLayout: (stationId: StationId) => void;
  startAppend: (lineId: LineId) => void;
  setAppending: (id: LineId | null) => void;
  // Narrowing helper: updates the appending-to-line variant's cursor (the
  // pending connect/splice anchor) in place. No-op when uiMode.kind isn't
  // 'appending-to-line'.
  setAppendCursor: (cursor: AppendCursor) => void;
  setUiMode: (mode: UiMode) => void;
  setHoveredStation: (id: StationId | null) => void;
  setHoveredCanvasItem: (item: HoveredCanvasItem | null) => void;
  // Update the Edit Stops hover target. A no-op when the target is unchanged, so
  // a segment stripe's pointermove stream (fires every frame) doesn't churn
  // re-renders — only an actual change of station/segment notifies subscribers.
  setAppendHover: (hover: AppendHover) => void;
  setHoveredLineStop: (v: { lineId: LineId; stationId: StationId } | null) => void;
  setHoveredAnchorKey: (key: string | null) => void;
  setSelectedStopLineId: (id: LineId | null) => void;
  setLabelSelected: (selected: boolean) => void;
  setSelectedAnchorCellId: (id: string | null) => void;
  setEditingStationId: (id: StationId | null) => void;
  // Tab click from the sidebar: collapse if it's the shown tab, otherwise open
  // that tab's list (see `sidebarOpen`).
  toggleTab: (tab: SidebarTab) => void;
  // The single toolbar arrow: collapse/expand the whole panel without changing
  // which tab is active, so reopening returns to the last-shown list.
  toggleSidebar: () => void;
  selectLineTag: (id: string | null) => void;
  setLineTagHoverPreview: (preview: LineTagHoverPreview | null) => void;
  selectRouteBullet: (id: string | null) => void;
  toggleRouteBulletSelection: (id: string) => void;
  setRouteBulletSelection: (ids: string[]) => void;
  addRouteBulletsToSelection: (ids: string[]) => void;
  xorRouteBulletsToSelection: (ids: string[]) => void;
  selectTransfer: (id: string | null) => void;
  // Narrowing helper: updates the creating-transfer variant's FIRST PICKED END
  // in place — not an "anchor" in either sense the word now carries here.
  // No-op when uiMode.kind isn't 'creating-transfer'.
  setTransferFirstEnd: (end: TransferEnd | null) => void;
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
  selectAnchor: (id: string | null) => void;
  toggleAnchorSelection: (id: string) => void;
  setAnchorSelection: (ids: string[]) => void;
  addAnchorsToSelection: (ids: string[]) => void;
  xorAnchorsToSelection: (ids: string[]) => void;
  selectLineCircle: (id: string | null) => void;
  toggleLineCircleSelection: (id: string) => void;
  setLineCircleSelection: (ids: string[]) => void;
  addLineCirclesToSelection: (ids: string[]) => void;
  xorLineCirclesToSelection: (ids: string[]) => void;
  selectGuide: (id: string | null) => void;
  toggleGuideSelection: (id: string) => void;
  setGuideSelection: (ids: string[]) => void;
  addGuidesToSelection: (ids: string[]) => void;
  xorGuidesToSelection: (ids: string[]) => void;
  // Replace the vertex selection (or clear with null). Does NOT touch
  // selectedPolygonIds — the polygon remains the primary selection.
  selectVertices: (sel: { polygonId: string; indices: number[] } | null) => void;
  // Shift-click a vertex handle: add/remove one index within its polygon. A
  // vertex on a DIFFERENT polygon resets the set to just that vertex (vertex
  // editing is single-polygon); emptying the set collapses to null.
  toggleVertexSelection: (sel: { polygonId: string; index: number }) => void;
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
  // Wipe the entire selection — every list, every primary, and the
  // within-station micro-state — in one shot (the `clearedSelections()` set).
  // Leaves `uiMode` untouched: the multi-select callers (cut, delete-all) run
  // only in idle, and the Clear-canvas caller resets the mode itself. Replaces
  // the old habit of chaining `select*(null)` calls, most of which were no-ops
  // anyway since each one already spreads `clearedSelections()`.
  clearAllSelections: () => void;
}

// ---- selection id-list algebra: pure helpers shared by every id-list kind
//      (the four free-item lists — bullets/labels/polygons/svgImages — and stations) ----

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
  | 'selectedSvgImageIds'
  | 'selectedAnchorIds'
  | 'selectedLineCircleIds'
  | 'selectedGuideIds';

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
            // clear leaves the current mode alone (callers that pass null —
            // e.g. the canvas-background click — expect the mode preserved).
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

export const useSelection = create<SelectionState>()(
  persist(
    (set, get) => ({
      selectedStationIds: [],
      selectedLineId: null,
      uiMode: { kind: 'idle' },
      hoveredStationId: null,
      hoveredCanvasItem: null,
      appendHover: null,
      hoveredLineStop: null,
      hoveredAnchorKey: null,
      selectedStopLineId: null,
      labelSelected: false,
      selectedAnchorCellId: null,
      editingStationId: null,
      activeTab: DEFAULT_SIDEBAR_TAB,
      sidebarOpen: true,
      selectedLineTagId: null,
      lineTagHoverPreview: null,
      selectedRouteBulletIds: [],
      selectedTransferId: null,
      selectedLabelIds: [],
      selectedPolygonIds: [],
      selectedSvgImageIds: [],
      selectedAnchorIds: [],
      selectedLineCircleIds: [],
      selectedGuideIds: [],
      selectedVertices: null,
      mirrorMatching: false,
      toolMode: 'arrow',
      spaceHeld: false,
      altHeld: false,
      setToolMode: (m) => set({ toolMode: m }),
      setSpaceHeld: (v) => set({ spaceHeld: v }),
      setAltHeld: (v) => set({ altHeld: v }),

      // The single source of truth for mode transitions. Entering any non-idle
      // mode wipes all primary selections; every transition (either direction)
      // also drops all five ephemeral hover channels — lineTagHoverPreview,
      // hoveredCanvasItem, appendHover, hoveredLineStop, and hoveredAnchorKey —
      // since each is meaningful only in a particular mode and must not linger
      // behind a switch (a hoveredLineStop surviving a transfer-mode exit left
      // the white dot ring painted with nothing left to clear it; an anchor's
      // hover ring has the same failure, and no pointerout ever fires because
      // committing the transfer unmounts the anchor under the cursor). Variant
      // payloads (the transfer's first end, the append cursor) are updated in
      // place via setTransferFirstEnd / setAppendCursor.
      setUiMode: (mode) =>
        set(
          // A deliberate mode switch drops the canvas hover-preview outright
          // (re-syncs on the next pointer move) so it can't linger, unrendered,
          // behind a mode and then reappear when idle returns.
          mode.kind === 'idle'
            ? {
                uiMode: mode,
                lineTagHoverPreview: null,
                hoveredCanvasItem: null,
                appendHover: null,
                hoveredLineStop: null,
                hoveredAnchorKey: null,
              }
            : {
                uiMode: mode,
                lineTagHoverPreview: null,
                hoveredCanvasItem: null,
                appendHover: null,
                hoveredLineStop: null,
                hoveredAnchorKey: null,
                ...clearedSelections(),
              },
        ),

      // selectStation does NOT touch uiMode — placing-station and
      // creating-route-bullet modes are sticky (canvas clicks place repeatedly;
      // see MapCanvas onCanvasClick comments). The pure mode-cancellation rule
      // applies to every OTHER select* setter. One exception, shared with the
      // multi-select mutators below: layoutEditReconcile exits
      // editing-station-layout whenever the selection stops being exactly the
      // edited station.
      selectStation: (id) => {
        const nextIds = id == null ? [] : [id];
        // Re-selecting the already-sole-selected station is NOT a primary-
        // selection change: mirror matching survives it (a plain canvas click
        // on the inspected station must not silently drop Select Similar). Any
        // other transition — different id, multi→single collapse — resets it
        // with the rest of clearedSelections.
        const cur = get().selectedStationIds;
        const sameSole = id != null && cur.length === 1 && cur[0] === id;
        set({
          ...clearedSelections(),
          ...(sameSole ? { mirrorMatching: get().mirrorMatching } : {}),
          ...layoutEditReconcile(get().uiMode, nextIds),
          selectedStationIds: nextIds,
          activeTab: id === null ? get().activeTab : 'stations',
          editingStationId: id === null ? null : get().editingStationId,
        });
      },
      toggleStationSelection: (id) =>
        set((s) => {
          const idx = s.selectedStationIds.indexOf(id);
          if (idx >= 0) {
            const next = s.selectedStationIds.slice();
            next.splice(idx, 1);
            return {
              selectedStationIds: next,
              ...layoutEditReconcile(s.uiMode, next),
              // Multi-select implicitly clears the inspector-state pieces tied
              // to a single station's grid editor.
              selectedStopLineId: null,
              labelSelected: false,
              mirrorMatching: false,
              editingStationId: null,
              activeTab: 'stations',
            };
          }
          const next = [...s.selectedStationIds, id];
          return {
            selectedStationIds: next,
            ...layoutEditReconcile(s.uiMode, next),
            // Adding a station to the set makes it foreign to any selected line /
            // tag / transfer / mirror — clear them from the one shared home so the
            // matrix can't drift (see SIBLING_PRIMARY_CLEAR).
            ...SIBLING_PRIMARY_CLEAR,
            selectedStopLineId: null,
            labelSelected: false,
            editingStationId: null,
            activeTab: 'stations',
          };
        }),
      setStationSelection: (ids) =>
        set((s) => {
          const next = dedupeLastWins(ids);
          return {
            selectedStationIds: next,
            ...layoutEditReconcile(s.uiMode, next),
            ...SIBLING_PRIMARY_CLEAR,
            selectedStopLineId: null,
            labelSelected: false,
            editingStationId: null,
            // Same shape as selectStation: showing the stations is the point of
            // SELECTING stations, but an empty list isn't a station selection.
            // The marquee commits all seven kinds on every sweep, so rubber-
            // banding a polygon would otherwise throw the sidebar off Lines.
            activeTab: next.length === 0 ? s.activeTab : 'stations',
          };
        }),
      addStationsToSelection: (ids) =>
        set((s) => {
          const next = unionAppendNovel(s.selectedStationIds, ids);
          if (next === s.selectedStationIds) return {};
          return {
            selectedStationIds: next,
            ...layoutEditReconcile(s.uiMode, next),
            ...SIBLING_PRIMARY_CLEAR,
          };
        }),
      xorStationsToSelection: (ids) =>
        set((s) => {
          const next = xorAppend(s.selectedStationIds, ids);
          if (next === s.selectedStationIds) return {};
          return {
            selectedStationIds: next,
            ...layoutEditReconcile(s.uiMode, next),
            ...SIBLING_PRIMARY_CLEAR,
          };
        }),
      selectLine: (id) => {
        if (id === null) {
          // Null clear is gentle by design: drops line + tag, preserves other
          // primaries and uiMode (callers that pass null — e.g. the canvas-
          // background click — expect the rest of the selection untouched).
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
          // The editor is a pinned on-canvas popover, so the sidebar's
          // visibility is none of this action's business — only the active tab
          // follows, so a reopened panel shows the relevant list.
          activeTab: 'lines',
          lineTagHoverPreview: null,
        });
      },
      startEditingStationLayout: (stationId) =>
        set({
          ...clearedSelections(),
          uiMode: { kind: 'editing-station-layout', stationId },
          selectedStationIds: [stationId],
          mirrorMatching: get().mirrorMatching,
          activeTab: 'stations',
          lineTagHoverPreview: null,
          // Edit Stops double-click hops straight in here with the pointer
          // still over the station, so no pointerleave will clear its hover
          // target — this transition drops it like setUiMode would.
          appendHover: null,
        }),
      // THE way into the line editor — there is no "selected but not editing"
      // state: picking a line (sidebar row, badge, or canvas stripe) goes
      // straight into Edit Stops. The editor itself is the pinned LinePopover
      // (the sidebar cedes the corner while the mode is active — see
      // sidebarVisible), so no sidebar revealing happens here.
      startAppend: (lineId) =>
        set({
          ...clearedSelections(),
          uiMode: { kind: 'appending-to-line', lineId, cursor: null },
          selectedLineId: lineId,
          activeTab: 'lines',
          lineTagHoverPreview: null,
          appendHover: null,
        }),
      setAppending: (lineId) => {
        const cur = get().uiMode;
        if (lineId === null) {
          if (cur.kind === 'appending-to-line') {
            // Exiting the editor goes straight back to the MAIN view — the
            // line deselects with the mode (there is no selected-not-editing
            // state to land on). Drop the hover so no stale preview lingers.
            set({
              uiMode: { kind: 'idle' },
              selectedLineId: null,
              lineTagHoverPreview: null,
              appendHover: null,
            });
          }
          return;
        }
        // Preserve any in-progress cursor only when re-entering the SAME
        // line; switching lines resets it.
        const cursor =
          cur.kind === 'appending-to-line' && cur.lineId === lineId ? cur.cursor : null;
        set({
          uiMode: { kind: 'appending-to-line', lineId, cursor },
          selectedLineId: lineId,
          lineTagHoverPreview: null,
          appendHover: null,
        });
      },
      setAppendCursor: (cursor) => {
        const cur = get().uiMode;
        if (cur.kind !== 'appending-to-line') return;
        set({ uiMode: { ...cur, cursor } });
      },
      setHoveredStation: (id) => set({ hoveredStationId: id }),
      setHoveredCanvasItem: (item) => set({ hoveredCanvasItem: item }),
      setAppendHover: (hover) => {
        if (sameAppendHover(get().appendHover, hover)) return;
        set({ appendHover: hover });
      },
      setHoveredLineStop: (v) => set({ hoveredLineStop: v }),
      setHoveredAnchorKey: (key) => set({ hoveredAnchorKey: key }),
      // The three sub-selection arms are mutually exclusive: arming one clears
      // the others, clearing one leaves the rest alone.
      setSelectedStopLineId: (id) =>
        set({
          selectedStopLineId: id,
          labelSelected: id === null ? get().labelSelected : false,
          selectedAnchorCellId: id === null ? get().selectedAnchorCellId : null,
        }),
      setLabelSelected: (selected) =>
        set({
          labelSelected: selected,
          selectedStopLineId: selected ? null : get().selectedStopLineId,
          selectedAnchorCellId: selected ? null : get().selectedAnchorCellId,
        }),
      setSelectedAnchorCellId: (id) =>
        set({
          selectedAnchorCellId: id,
          selectedStopLineId: id === null ? get().selectedStopLineId : null,
          labelSelected: id === null ? get().labelSelected : false,
        }),
      setEditingStationId: (id) => set({ editingStationId: id }),
      toggleTab: (tab) =>
        set((s) =>
          s.sidebarOpen && s.activeTab === tab
            ? { sidebarOpen: false }
            : { activeTab: tab, sidebarOpen: true },
        ),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
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
      setTransferFirstEnd: (end) => {
        const cur = get().uiMode;
        if (cur.kind !== 'creating-transfer') return;
        set({ uiMode: { ...cur, firstEnd: end } });
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
        // A polygon selection change drops any active vertex handles (they're
        // bound to a single polygon's edit session).
        { selectedVertices: null },
      ),
      ...makeIdListActions(set, get, 'selectedSvgImageIds', {
        select: 'selectSvgImage',
        toggle: 'toggleSvgImageSelection',
        replace: 'setSvgImageSelection',
        add: 'addSvgImagesToSelection',
        xor: 'xorSvgImagesToSelection',
      }),
      ...makeIdListActions(set, get, 'selectedAnchorIds', {
        select: 'selectAnchor',
        toggle: 'toggleAnchorSelection',
        replace: 'setAnchorSelection',
        add: 'addAnchorsToSelection',
        xor: 'xorAnchorsToSelection',
      }),
      ...makeIdListActions(set, get, 'selectedLineCircleIds', {
        select: 'selectLineCircle',
        toggle: 'toggleLineCircleSelection',
        replace: 'setLineCircleSelection',
        add: 'addLineCirclesToSelection',
        xor: 'xorLineCirclesToSelection',
      }),
      ...makeIdListActions(set, get, 'selectedGuideIds', {
        select: 'selectGuide',
        toggle: 'toggleGuideSelection',
        replace: 'setGuideSelection',
        add: 'addGuidesToSelection',
        xor: 'xorGuidesToSelection',
      }),
      selectVertices: (sel) => set({ selectedVertices: sel }),
      toggleVertexSelection: ({ polygonId, index }) =>
        set((s) => {
          const cur = s.selectedVertices;
          // No set, or a set on another polygon → start fresh (single-polygon).
          if (!cur || cur.polygonId !== polygonId) {
            return { selectedVertices: { polygonId, indices: [index] } };
          }
          const has = cur.indices.includes(index);
          const indices = has ? cur.indices.filter((i) => i !== index) : [...cur.indices, index];
          // An emptied set collapses to null (never a { indices: [] }).
          return { selectedVertices: indices.length ? { polygonId, indices } : null };
        }),
      setMixedSelection: (ids) =>
        set({
          ...clearedSelections(),
          uiMode: { kind: 'idle' },
          selectedRouteBulletIds: dedupeLastWins(ids.bullets ?? []),
          selectedLabelIds: dedupeLastWins(ids.labels ?? []),
          selectedPolygonIds: dedupeLastWins(ids.polygons ?? []),
          selectedSvgImageIds: dedupeLastWins(ids.svgImages ?? []),
        }),
      // Also drops the canvas hover channels: delete/cut call this with the
      // cursor still over the (unmounting) item, so no pointerleave will ever
      // clear them — and a surviving id resolves again after undo, painting
      // ghost hover chrome over empty background.
      clearAllSelections: () =>
        set({ ...clearedSelections(), hoveredCanvasItem: null, hoveredLineStop: null }),
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
        // Free anchors only — a hosted anchor id can never be in this list.
        const anchors = prune(s.selectedAnchorIds, (id) => !!doc.transferAnchors[id]);
        if (anchors) next.selectedAnchorIds = anchors;
        const circles = prune(s.selectedLineCircleIds, (id) => !!doc.lineCircles[id]);
        if (circles) next.selectedLineCircleIds = circles;
        const guides = prune(s.selectedGuideIds, (id) => !!doc.guides[id]);
        if (guides) next.selectedGuideIds = guides;
        // Single primaries.
        if (s.selectedLineId && !doc.lines[s.selectedLineId]) next.selectedLineId = null;
        // Edit Stops is bound to one line the same way selectedLineId is: if
        // the undo removed it, exit the mode too — otherwise the banner and
        // pinned popover null themselves out while canvas clicks keep routing
        // through append gestures against a dead lineId.
        if (s.uiMode.kind === 'appending-to-line' && !doc.lines[s.uiMode.lineId])
          next.uiMode = { kind: 'idle' };
        // A transfer anchor bound to an undone station resets to the
        // first-pick state — the mode survives, and the banner reverts to
        // "Click the first station" instead of promising a second click that
        // can only silently no-op against the dead id.
        if (
          s.uiMode.kind === 'creating-transfer' &&
          s.uiMode.firstEnd &&
          !transferEndResolves(doc, s.uiMode.firstEnd)
        )
          next.uiMode = { kind: 'creating-transfer', firstEnd: null };
        if (s.selectedLineTagId && !doc.lineTags[s.selectedLineTagId])
          next.selectedLineTagId = null;
        if (s.selectedTransferId && !doc.transfers[s.selectedTransferId])
          next.selectedTransferId = null;
        // Within-station inspector + hover state bound to a specific entity.
        if (s.editingStationId && !doc.stations[s.editingStationId]) next.editingStationId = null;
        if (s.selectedStopLineId && !doc.lines[s.selectedStopLineId])
          next.selectedStopLineId = null;
        // The armed anchor cell belongs to the edited station; it dangles when
        // an undo removes the anchor (or the station) out from under it.
        if (s.selectedAnchorCellId) {
          const host = s.selectedStationIds[0];
          const live = host
            ? doc.stations[host]?.transferAnchors?.some((a) => a.id === s.selectedAnchorCellId)
            : false;
          if (!live) next.selectedAnchorCellId = null;
        }
        if (s.hoveredStationId && !doc.stations[s.hoveredStationId]) next.hoveredStationId = null;
        // The canvas hover channels dangle the same way (the hovered element
        // unmounts with no pointerleave); a dangling id RESOLVES again after
        // undo restores the entity and paints ghost hover chrome.
        if (s.hoveredCanvasItem && !hoverTargetExists(doc, s.hoveredCanvasItem))
          next.hoveredCanvasItem = null;
        if (
          s.hoveredLineStop &&
          (!doc.stations[s.hoveredLineStop.stationId] || !doc.lines[s.hoveredLineStop.lineId])
        )
          next.hoveredLineStop = null;
        // Vertex handles dangle if the polygon is gone OR shrank past their index.
        // Prune just the out-of-range indices; drop to null only if none survive.
        if (s.selectedVertices) {
          const poly = doc.polygons[s.selectedVertices.polygonId];
          if (!poly) next.selectedVertices = null;
          else {
            const kept = s.selectedVertices.indices.filter((i) => i < poly.vertices.length);
            if (kept.length !== s.selectedVertices.indices.length) {
              next.selectedVertices = kept.length
                ? { polygonId: s.selectedVertices.polygonId, indices: kept }
                : null;
            }
          }
        }
        // Skip the set() entirely when nothing dangled — zustand notifies
        // subscribers on every set (even an empty patch), so this keeps the common
        // undo/redo path a true no-op rather than re-running every selector.
        if (Object.keys(next).length > 0) set(next);
      },
    }),
    {
      // Only the sidebar's visibility (open/closed + which tab) is persisted —
      // the rest of this store is ephemeral selection state that must NOT
      // survive a reload.
      name: 'massimo-sidebar-v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ sidebarOpen: s.sidebarOpen, activeTab: s.activeTab }),
      // `activeTab` is a union, so it goes through the one rule every stored
      // union pref does. It needs the gate more than most: the toggles heal
      // themselves on the next click (their readers fall back to off, and the
      // cycle's next step writes a member back), but Sidebar.tsx matches this
      // one against the three names with `===` — a non-member marks no tab
      // active and renders no panel body, and no tab button can ever write it
      // back, so the blank sidebar survives every reload.
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as Partial<SelectionState>;
        return {
          ...current,
          ...stored,
          activeTab: healPersistedUnion(
            stored.activeTab,
            current.activeTab,
            isSidebarTab,
            DEFAULT_SIDEBAR_TAB,
          ),
        };
      },
    },
  ),
);

// ---- canvas hover-preview selector -----------------------------------------

// Does the hovered entity still exist in this doc? (reconcileWithDoc's prune.)
function hoverTargetExists(doc: MapDoc, h: HoveredCanvasItem): boolean {
  switch (h.kind) {
    case 'station':
      return !!doc.stations[h.id as StationId];
    case 'transfer':
      return !!doc.transfers[h.id];
    case 'bullet':
      return !!doc.routeBullets[h.id];
    case 'label':
      return !!doc.textLabels[h.id];
    case 'polygon':
      return !!doc.polygons[h.id];
    case 'svgImage':
      return !!doc.svgImages[h.id];
    case 'lineTag':
      return !!doc.lineTags[h.id];
    case 'lineCircle':
      return !!doc.lineCircles[h.id];
    case 'guide':
      return !!doc.guides[h.id];
  }
}

// Is this hovered item already part of the current selection? Its full chrome
// is then already up, so a 50% hover copy on top would only double the ink.
function isHoverSelected(s: SelectionState, h: HoveredCanvasItem): boolean {
  switch (h.kind) {
    case 'station':
      return s.selectedStationIds.includes(h.id as StationId);
    case 'transfer':
      return s.selectedTransferId === h.id;
    case 'bullet':
      return s.selectedRouteBulletIds.includes(h.id);
    case 'label':
      return s.selectedLabelIds.includes(h.id);
    case 'polygon':
      return s.selectedPolygonIds.includes(h.id);
    case 'svgImage':
      return s.selectedSvgImageIds.includes(h.id);
    case 'lineTag':
      return s.selectedLineTagId === h.id;
    case 'lineCircle':
      return s.selectedLineCircleIds.includes(h.id);
    case 'guide':
      return s.selectedGuideIds.includes(h.id);
  }
}

// The canvas item whose selection chrome the mouseover should preview at 50%
// opacity (wired in MapCanvas + LineTagsLayer), or null. Suppressed outside
// idle mode, while panning (hand tool / space held), and for an already-
// selected item. One home for the gate so every item type stays consistent.
export function hoveredChrome(s: SelectionState): HoveredCanvasItem | null {
  if (s.uiMode.kind !== 'idle' || s.toolMode === 'hand' || s.spaceHeld) return null;
  const h = s.hoveredCanvasItem;
  if (!h) return null;
  return isHoverSelected(s, h) ? null : h;
}

// ---- derived-selection selectors: one named home for "what is selected" ----

// The single selected item across EVERY multi-select item list, or null when
// the total count isn't exactly one. Lets the inspector + item popovers gate on
// one shared notion instead of each hand-checking the other lists' lengths
// (which had drifted — a co-selected bullet used to leak its popover open).
export type SoleSelection =
  | { type: 'station'; id: StationId }
  | { type: 'bullet'; id: string }
  | { type: 'label'; id: string }
  | { type: 'polygon'; id: string }
  | { type: 'svgImage'; id: string }
  // Anchors have NO popover, so ItemPopovers returns null for this arm. It is
  // here because soleSelection is ALSO hitStack's "what is currently picked"
  // source for alt-click cycling — leaving anchors out doesn't mean "no
  // popover", it means the deep-pick can't find the current entry and stops
  // cycling entirely.
  | { type: 'anchor'; id: string }
  | { type: 'lineCircle'; id: string }
  | { type: 'guide'; id: string }
  | null;

export function soleSelection(s: SelectionState): SoleSelection {
  const total =
    s.selectedStationIds.length +
    s.selectedRouteBulletIds.length +
    s.selectedLabelIds.length +
    s.selectedPolygonIds.length +
    s.selectedSvgImageIds.length +
    s.selectedAnchorIds.length +
    s.selectedLineCircleIds.length +
    s.selectedGuideIds.length;
  if (total !== 1) return null;
  if (s.selectedStationIds.length === 1) return { type: 'station', id: s.selectedStationIds[0] };
  if (s.selectedRouteBulletIds.length === 1)
    return { type: 'bullet', id: s.selectedRouteBulletIds[0] };
  if (s.selectedLabelIds.length === 1) return { type: 'label', id: s.selectedLabelIds[0] };
  if (s.selectedPolygonIds.length === 1) return { type: 'polygon', id: s.selectedPolygonIds[0] };
  if (s.selectedSvgImageIds.length === 1) return { type: 'svgImage', id: s.selectedSvgImageIds[0] };
  if (s.selectedAnchorIds.length === 1) return { type: 'anchor', id: s.selectedAnchorIds[0] };
  if (s.selectedLineCircleIds.length === 1)
    return { type: 'lineCircle', id: s.selectedLineCircleIds[0] };
  if (s.selectedGuideIds.length === 1) return { type: 'guide', id: s.selectedGuideIds[0] };
  // Every list checked explicitly, then null. This used to END in an unguarded
  // `return { type: 'svgImage', id: s.selectedSvgImageIds[0] }`. The `total`
  // guard kept that honest while svgImages was the last list — but it was a
  // footgun: adding a new list (as this PR's `selectedAnchorIds` did) to `total`
  // without an arm here would have returned `{ svgImage, id: undefined }`, which
  // hitStack.currentHitEntity feeds into the alt-click cycle, where `findIndex`
  // misses and the deep-pick stops cycling (ItemPopovers just returns null, so
  // nothing fails loudly). A new list MUST add its arm above; until it does,
  // null degrades to "no sole selection", which is safe on both consumers.
  return null;
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
