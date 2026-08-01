import { useViewportStore } from './viewportStore';
import { useSelection, type UiMode } from './selection';

/**
 * The canvas visibility toggles, in one registry.
 *
 * Three consumers have to agree about this set and they used to be written out
 * by hand in three places: the View menu, the export snapshot's force-everything-
 * on pass, and the toolbar's hidden-content mark. A flag added to two of the
 * three fails silently — most cruelly at the export, which would quietly ship a
 * map missing whatever the user had toggled off. So the list is the source and
 * all three read it.
 *
 * The grid is NOT here. It is a drawing aid rather than map content, and its
 * button is paired with the grid-size cycler next to it in the toolbar.
 */
export type VisibilityKey =
  | 'showNetwork'
  | 'showAnchors'
  | 'showLineCircles'
  | 'showTransfers'
  | 'showWaypoints'
  | 'showSvgImages'
  | 'showTextLabels'
  | 'showPolygons'
  | 'showRouteBullets';

export interface VisibilityItem {
  key: VisibilityKey;
  label: string;
  /**
   * Menu grouping — a divider is drawn wherever this changes. 0 is the master
   * lines/stations switch, 1 the network scaffolding that hangs off it, 2 the
   * free-standing annotation layers.
   */
  group: number;
  /**
   * True when this flag can hide ink that REACHES an export. Those must be
   * forced on around an export capture (see exportVisibilityOverrides); the
   * others gate editor scaffolding that carries `data-export-exclude` and is
   * stripped from the clone regardless.
   *
   * `showWaypoints` is the one that would be actively WRONG to force: it
   * REVEALS normally-hidden waypoint stations, and their overlay is
   * export-excluded (StationDots), so forcing it on before a capture would ask
   * for ink the export then throws away.
   */
  gatesExportedInk: boolean;
  /**
   * The mode that REVEALS this kind whatever the menu says — the one that places
   * it. Without this, hiding a layer and then reaching for its own tool drops an
   * item onto the canvas that cannot be seen, which reads as the tool being
   * broken. A DERIVATION, never a write to the user's toggle: a temporary write
   * would need a matching revert on every exit path (commit, Esc, right-click,
   * mode switch, undo-driven reconcile) and one missed would strand the
   * preference — the reasoning `anchorsRevealedByMode` sets out at length.
   *
   * Anchors are absent because two modes reveal them and their own module
   * ([anchorVisibility.ts](src/state/anchorVisibility.ts)) already owns the rule.
   * `showNetwork` is absent on purpose: it is the deliberate get-out-of-my-way
   * switch, and lifting the WHOLE network back for a station placement would
   * undo exactly what the user asked for.
   */
  revealedBy?: UiMode['kind'];
}

export const VISIBILITY_ITEMS: readonly VisibilityItem[] = [
  { key: 'showNetwork', label: 'Lines and stations', group: 0, gatesExportedInk: true },
  { key: 'showAnchors', label: 'Anchors', group: 1, gatesExportedInk: false },
  {
    key: 'showLineCircles',
    label: 'Line circles',
    group: 1,
    gatesExportedInk: false,
    revealedBy: 'placing-line-circle',
  },
  {
    key: 'showTransfers',
    label: 'Transfers',
    group: 1,
    gatesExportedInk: true,
    revealedBy: 'creating-transfer',
  },
  { key: 'showWaypoints', label: 'Waypoints', group: 1, gatesExportedInk: false },
  {
    key: 'showSvgImages',
    label: 'Images / SVGs',
    group: 2,
    gatesExportedInk: true,
    revealedBy: 'placing-svg',
  },
  {
    key: 'showTextLabels',
    label: 'Canvas labels',
    group: 2,
    gatesExportedInk: true,
    revealedBy: 'placing-label',
  },
  {
    key: 'showPolygons',
    label: 'Polygons',
    group: 2,
    gatesExportedInk: true,
    revealedBy: 'creating-polygon',
  },
  {
    key: 'showRouteBullets',
    label: 'Route bullets',
    group: 2,
    gatesExportedInk: true,
    revealedBy: 'creating-route-bullet',
  },
];

/**
 * Is this kind on screen right now — its toggle, OR the mode that places it?
 *
 * The render-path entry point (canvas, item popovers); `kindVisibleNow` is the
 * same question for code outside render. Everything that has an opinion about a
 * kind being visible goes through one of the two, so no consumer can acquire a
 * menu row without its reveal, and none can drift from the canvas.
 */
export function kindVisible(key: VisibilityKey, flag: boolean, modeKind: UiMode['kind']): boolean {
  if (flag) return true;
  return VISIBILITY_ITEMS.find((i) => i.key === key)?.revealedBy === modeKind;
}

/**
 * {@link kindVisible} over the LIVE stores — non-reactive, for the pointer
 * handlers and doc-geometric pools that run outside render (the marquee, the
 * snap pools, ring capture on placement and drag).
 *
 * Those paths read geometry straight off the doc, so nothing about hiding a kind
 * removes it from them; each has to opt in, and each opting in through THIS
 * function is what keeps the canvas, the marquee and the snappers from drifting
 * into three different opinions about what is on screen. Mirrors
 * `anchorsVisibleNow`, which owns the same rule for anchors.
 */
export function kindVisibleNow(key: VisibilityKey): boolean {
  return kindVisible(key, useViewportStore.getState()[key], useSelection.getState().uiMode.kind);
}

/**
 * Write one flag. Non-reactive (click handlers call it), and the setter name is
 * DERIVED from the key rather than looked up in a second table — a per-key map
 * of setters is exactly the hand-written list this registry exists to delete,
 * and a mis-paste in one would silently point two menu rows at one flag.
 * `visibility.test.ts` pins that every key resolves to a real setter.
 */
export function setVisibility(key: VisibilityKey, value: boolean): void {
  const setter =
    `set${(key[0].toUpperCase() + key.slice(1)) as Capitalize<VisibilityKey>}` as const;
  useViewportStore.getState()[setter](value);
}

/** The store's pristine value for a flag — the initializer's, never whatever
 *  the session has since written (see anyLayerHidden). */
function defaultOf(key: VisibilityKey): boolean {
  return useViewportStore.getInitialState()[key];
}

/**
 * Is something the canvas would normally paint missing right now?
 *
 * The mark on the toolbar means "content you expect to see isn't there", so this
 * counts only layers that default to VISIBLE and have been turned off. Two rules
 * that look reasonable and are both wrong:
 *
 * - "some flag is false" marks a pristine app forever, because `showAnchors` and
 *   `showWaypoints` default to hidden;
 * - "differs from the default" marks a FULLY CHECKED menu, because checking those
 *   same two is a departure from the default — and a menu with every box ticked
 *   reading as "layers are hidden" is nonsense.
 *
 * Turning a reveal ON hides nothing, so it never marks.
 */
export function anyLayerHidden(state: Record<VisibilityKey, boolean>): boolean {
  return VISIBILITY_ITEMS.some((item) => defaultOf(item.key) && !state[item.key]);
}

/**
 * The flag writes an export capture must apply, and the writes that put them
 * back — `{}` when the current view already shows every exportable layer.
 *
 * An export renders the finished map, never the view someone happened to be
 * working in, so anything gating exported ink goes on for the clone. Scaffolding
 * flags are left exactly as the user has them: their layers are export-excluded,
 * so touching them would re-render the canvas for no change to the output.
 */
export function exportVisibilityOverrides(state: Record<VisibilityKey, boolean>): {
  apply: Partial<Record<VisibilityKey, boolean>>;
  restore: Partial<Record<VisibilityKey, boolean>>;
} {
  const apply: Partial<Record<VisibilityKey, boolean>> = {};
  const restore: Partial<Record<VisibilityKey, boolean>> = {};
  for (const item of VISIBILITY_ITEMS) {
    if (!item.gatesExportedInk || state[item.key]) continue;
    apply[item.key] = true;
    restore[item.key] = false;
  }
  return { apply, restore };
}
