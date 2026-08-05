import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';
import { temporal } from 'zundo';
import type { GridSnap } from '../geometry/snap';
import type {
  AutoHAlign,
  AutoVAlign,
  LabelAlign,
  LabelValign,
  Line,
  LineCircle,
  LineEndStyle,
  LineId,
  LineStyle,
  MapDoc,
  Polygon,
  PolygonStylePatch,
  RegionAssignment,
  Rotation,
  RouteBullet,
  StationId,
  StationStopType,
  StyleDef,
  StyleKind,
  SvgImage,
  SvgImageStylePatch,
  TextLabel,
  TextLabelWeight,
  TransferEnd,
  TransferStylePatch,
} from '../model/types';
import * as S from '../model/styles';
import { useSelection } from './selection';
import { effectiveLineOrder } from '../model/lineOrder';
import { pickNextLineName } from '../model/lineNaming';
import { defaultIdFactory, IdFactory } from '../model/ids';
import { DEFAULT_DOC } from '../model/transforms';
import * as T from '../model/transforms';
import { cyclingColors, FALLBACK_LINE_COLOR, type Palette } from '../model/palettes';
import { useCustomPalettes } from './customPalettes';
import {
  sanitizeImageHrefs,
  sanitizeLineCircles,
  sanitizeStations,
  snapStationCells,
  backfillLineNames,
  backfillLinesEdges,
  backfillPolygonDarkColors,
  backfillTextLabelColors,
  backfillTransferDayNightColors,
  backfillDotStrokeAlign,
  backfillLineStyleEndStyle,
  bakeDocCurveRadius,
  bakeLegacyBackgroundOrder,
  bakeLegacyLabelSettings,
  bakeLegacyTransferSettings,
  bakeLineDotDefaults,
  bakeLineStyleDotIds,
  bakeStopDotLibrary,
  convertLegacyDotShapes,
  ensureStyleInvariants,
  pruneLineDotTypeTagMismatches,
  foldPolygonFillOpacity,
  migrateLegacyBulletSyntax,
  migrateV9Styles,
  sanitizeRegionAssignments,
  stripLegacySegmentLayers,
  stripRetiredSeamFields,
  bakeActivePalettes,
} from '../model/serialize';
import type { Station, Transfer } from '../model/types';
import { randomStationName } from './stationNames';
import { isHistoryGrouping, pauseHistory, pushHistory, resumeHistory } from './history';
import { reconcileRegionAssignments } from '../geometry/regionReconcile';
import { regionGeometrySig, type GeometrySlice } from '../geometry/regionCache';
import { useViewportStore } from './viewportStore';

// Re-export so callers (Sidebar, etc.) keep working with one source of truth.
export { effectiveLineOrder };

const ids: IdFactory = defaultIdFactory();

// Offset applied when pasting or duplicating any canvas item, so the copy lands
// just off the original instead of exactly on top of it. A single uniform
// (dx, dy) keeps a multi-item paste's relative layout intact.
const DROP_OFFSET = 15;

// Shared body for the four `duplicateX` actions: look up the source record by
// id, strip that id, and hand the rest to the matching paste action (which
// applies DROP_OFFSET and drops `locked`). Returns null when the id is gone.
function duplicateVia<T extends { id: string }>(
  record: Record<string, T>,
  id: string,
  paste: (data: Omit<T, 'id'>) => string,
): string | null {
  const item = record[id];
  if (!item) return null;
  const { id: _id, ...data } = item;
  return paste(data);
}

// Single source of truth for which MapDoc fields are part of the persisted /
// undoable document. Drives partialize (persist + zundo), DocSnapshot,
// pickDocSnapshot, and the change-detection equality check in
// beginHistoryGroup. Adding a new doc field is a one-line edit here.
const DOC_FIELDS = [
  'name',
  'stations',
  'lines',
  'lineOrder',
  'lineCounter',
  'lineTags',
  'routeBullets',
  // Free transfer anchors (the station-hosted ones ride inside `stations`). New
  // field: absent in older saves, backfilled to {} by the shallow merge on both
  // load paths — no migration, no persist version bump. Adding it here DOES
  // change EMPTY_DOC_JSON's bytes, so every persisted save-baseline hash is
  // invalidated once on the first boot of this build and the doc reads dirty.
  // That is the byte gate working as designed (saveBaseline.ts), not a bug —
  // and it is exactly why an anchors-only doc is correctly treated as non-empty
  // by the auto-save gate instead of being silently wiped by New.
  'transferAnchors',
  'transfers',
  'textLabels',
  'polygons',
  // The shared polygon + svg-image z-stack. Replaced the separate
  // polygonOrder/svgImageOrder pair (persist v17); both load paths merge the
  // retired fields into it via `bakeLegacyBackgroundOrder`.
  'backgroundOrder',
  // Region paint choices ("paint by numbers" layering). New field: absent in
  // older saves, backfilled to {} by the shallow merge on both load paths.
  'regionAssignments',
  'svgImages',
  // Line circles (dashed guide circles stations bind to). New field: absent in
  // older saves, backfilled to {} by the shallow merge on both load paths.
  'lineCircles',
  // Named style presets + the per-kind default designations. Pre-styles saves
  // lack the keys, so zustand's shallow merge (and parse()'s DEFAULT_DOC
  // merge) backfills the factory set; docs persisted by earlier builds get
  // theirs repaired by the style-invariant pass in migrateDoc.
  'styles',
  'styleDefaults',
  // The palette COPIES the map paints with. Replaced the `activePalettes` id
  // list (persist v24); both load paths resolve the retired ids to copies via
  // `bakeActivePalettes`.
  'palettes',
  // Whether this is a night map. Lived in useViewportStore (session state)
  // until it became clear a night map is a property of the MAP: it has to
  // travel in the exported file. Absent in older saves, backfilled to false by
  // the shallow merge on both load paths — no migration.
  'darkMode',
] as const;
type DocFieldName = (typeof DOC_FIELDS)[number];
export type DocSnapshot = Pick<MapDoc, DocFieldName>;

// Undo-stack cap. zundo applies it to ungrouped writes via its `limit` option;
// pushHistory (the grouped-gesture path) must apply the same cap itself.
export const HISTORY_LIMIT = 1000;

export function pickDocSnapshot(s: DocSnapshot): DocSnapshot {
  const out = {} as Record<DocFieldName, unknown>;
  for (const k of DOC_FIELDS) out[k] = s[k];
  return out as DocSnapshot;
}

// Reference-equality per tracked field. Sound because transforms allocate new
// objects only when something actually changed — the same invariant zundo's
// `equality` guard and the history-group commit rely on. Exported for the
// save-status signal (saveBaseline.ts), which compares the live doc against
// the snapshot captured at the last save/load.
export function docSnapshotsEqual(a: DocSnapshot, b: DocSnapshot): boolean {
  for (const k of DOC_FIELDS) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

// --- Debounced doc persistence ----------------------------------------------
//
// persist runs its storage write on EVERY set() — i.e. every pointermove of a
// drag. With createJSONStorage that meant a full-doc JSON.stringify plus a
// synchronous localStorage.setItem per frame (~3-6ms on large maps). This
// custom PersistStorage debounces ABOVE the stringify: zustand hands a custom
// storage the UN-stringified `{ state, version }` object, so holding the
// latest one in `pendingPersist` is free, and the stringify + setItem run once
// per quiet period. State updates (and hence undo, rendering, everything
// in-memory) stay synchronous — only the storage write trails.
//
// The debounce applies ONLY while a group opened with `deferPersist` is
// open — the canvas drag hooks' per-frame write streams, where the whole
// win lives. Everything else (one-shot edits, focus-scoped field groups,
// the color picker) writes synchronously, exactly as createJSONStorage
// did: a focus group stays open as long as focus does, so deferring under
// it would leave storage arbitrarily stale behind a discrete, observable
// edit — anything reading localStorage as ground truth (the e2e helpers
// do) keeps its contract. Only mid-drag intermediates — states nobody
// should durably observe — trail.
//
// Flush points close the ≤PERSIST_DEBOUNCE_MS durability window where it
// matters: gesture commit (beginHistoryGroup's commit below), undo/redo
// (history.ts flushPersist), and the page-hide listeners at the bottom of this
// block. A flush cancels the pending timer before writing, and there is only
// ONE pending slot (last-write-wins), so a stale debounced write can never
// land after — and overwrite — a flushed one.

const PERSIST_DEBOUNCE_MS = 300;

let pendingPersist: { name: string; value: StorageValue<DocSnapshot> } | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function cancelPersistTimer(): void {
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
}

function writePendingPersist(): void {
  if (!pendingPersist) return;
  // Byte-identical to what createJSONStorage produced: a plain JSON.stringify
  // of the same { state, version } StorageValue, on the same key.
  localStorage.setItem(pendingPersist.name, JSON.stringify(pendingPersist.value));
  pendingPersist = null;
}

const debouncedDocStorage: PersistStorage<DocSnapshot> = {
  getItem: (name) => {
    // Reads stay synchronous (rehydrate timing is unchanged from
    // createJSONStorage over localStorage).
    const raw = localStorage.getItem(name);
    return raw ? (JSON.parse(raw) as StorageValue<DocSnapshot>) : null;
  },
  setItem: (name, value) => {
    // The snapshot inside `value` is immutable (transforms replace objects),
    // so holding the reference and stringifying later cannot tear.
    pendingPersist = { name, value };
    if (openHistoryGroup === null || !openGroupDefersPersist) {
      // Discrete or focus-scoped edit: write now, synchronously — the
      // pre-debounce contract. Only pointer-stream gestures defer.
      flushDocPersist();
      return;
    }
    cancelPersistTimer();
    persistTimer = setTimeout(() => {
      persistTimer = null;
      writePendingPersist();
    }, PERSIST_DEBOUNCE_MS);
  },
  removeItem: (name) => {
    // Drop any pending write too — a debounced write must not resurrect a
    // deliberately cleared key.
    cancelPersistTimer();
    pendingPersist = null;
    localStorage.removeItem(name);
  },
};

/** Write any pending debounced doc-storage write synchronously, cancelling its
 *  timer. Safe to call when nothing is pending. */
export function flushDocPersist(): void {
  cancelPersistTimer();
  writePendingPersist();
}

// Close the debounce window when the tab goes away or to the background.
// localStorage is synchronous, so writing inside these handlers is reliable.
// `pagehide` covers unload AND bfcache navigations; `beforeunload` is belt and
// braces for the odd browser path that skips pagehide.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushDocPersist);
  window.addEventListener('beforeunload', flushDocPersist);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushDocPersist();
  });
}

/**
 * Persisted-document version migration (v0 → v24). Exported and pure so it can
 * be unit-tested in isolation; the persist config below just delegates here.
 * Never mutates `persisted` — returns a possibly-new doc snapshot.
 *
 * - v0 → v1: backfill `line.name` with `${service} line` for lines saved
 *   before the field existed.
 * - v1 → v2: migrate legacy stop orientations (`up`/`down`/`left`/`right` and
 *   any unknown garbage strings) to the four canonical auto-* axes. Without
 *   this, docs saved before the diagonal-stops migration shipped carry
 *   orientation values that no longer have switch arms in travelDirLocal —
 *   crashing on render. Runs via `sanitizeStations`, which `parse()` in
 *   serialize.ts also calls for the file-import path.
 * - v2 → v3: translate legacy `labelBold: boolean` to `labelWeight:
 *   TextLabelWeight` (true → 700, false → 400). Matches `parse()`.
 * - v3 → v4: translate legacy label `valign: 'auto'` to `'auto-down'` (the
 *   new mirror option `'auto-up'` didn't exist yet). Also in sanitizeStations.
 * - v4 → v5: backfill polygon `darkFill`/`darkStroke` (equal to the light
 *   colors) for polygons saved before the dark-mode fields existed. Mirrors
 *   `backfillPolygonDarkColors` in `parse()`.
 * - v5 → v6: backfill text-label `color`/`darkColor` (to the theme-matching
 *   #111111 / #ffffff defaults) for labels saved before the per-label color
 *   fields existed. Mirrors `backfillTextLabelColors` in `parse()`.
 * - v6 → v7: convert legacy `dotShape`/`defaultDotShape` preset ids to
 *   procedural `DotStyle` objects via the pinned preset table. Mirrors
 *   `convertLegacyDotShapes` in `parse()`.
 * - v7 → v8: rewrite the legacy inline bullet syntax in station names and
 *   text-label texts — `<X>` circle tokens become `|X|`, literal pipe text
 *   gets escaped. NOT idempotent (post-migration `<X>` is intentional
 *   literal text), hence version-gated. Mirrors the file-version gate in
 *   `parse()` (SCHEMA_VERSION 2).
 * - v8 → v9: fold the legacy per-polygon `fillOpacity` (0-100 percent) into the
 *   alpha channel of `fill` AND `darkFill`, then drop the field. Idempotent, so
 *   `parse()` runs the shared `foldPolygonFillOpacity` unconditionally (no file
 *   SCHEMA_VERSION bump) while this rehydrate path gates it on v<9.
 * - v9 → v10: style hygiene (`migrateV9Styles`) — rebuild persisted style
 *   defs through the canonical grids (stripping the since-dropped textLabel
 *   width/leading/tracking keys) — then bake the retired doc-level transfer
 *   settings
 *   (transferThickness/transferColor/transferStrokeWidth/transferStrokeColor)
 *   into per-transfer overrides, drop the fields, and seed the designated
 *   default transfer style from them when it still wears untouched factory
 *   props (the settings' map-wide role moved there). The bake is idempotent
 *   (keyed off field presence), so `parse()` runs the shared
 *   `bakeLegacyTransferSettings` unconditionally.
 * - v10 → v11: adopt untagged items whose values match their kind's default
 *   style (`adoptDefaultStyles`) — legacy maps are full of default-looking
 *   items that predate tags, and without them the Styles panel's Default
 *   editors act on nothing. `parse()` runs the same pass for files that
 *   never had a styles record.
 * - v11 → v12: `styleDefaults` (the explicit per-kind default designations)
 *   replaced defaultness-by-name. No gated step of its own — the
 *   non-version-gated `ensureStyleInvariants` pass below repairs coverage
 *   and designations for every doc that carries styles; the bump just forces
 *   pre-designation storage through migrate at all (the persist merge alone
 *   would leave `styleDefaults` pointing at factory ids that round-1/2 docs'
 *   styles records don't contain).
 * - v12 → v13: transfer `color`/`strokeColor` (per-transfer overrides AND
 *   transfer StyleDef props) gained day/night halves — convert the legacy
 *   single-color strings to `{day, night}` pairs (old colors are day colors)
 *   via `backfillTransferDayNightColors`. Ordered after the v<10 bake and
 *   before the v<11 adoption (which compares transfer props by `.day`/`.night`
 *   now). Idempotent; `parse()` does the same conversion in its sanitizers.
 * - v13 → v14: retire the five doc-level station-label font settings
 *   (labelFontSize/labelWeight/labelItalic/labelLeading/labelTracking). Bake
 *   each into per-station typography and the per-station labelBold (+2 weight)
 *   / labelItalic (OR) flags with them, moving the map-wide role to the seeded
 *   default station style — mirrors the transfer-settings retirement.
 *   Idempotent (keyed off field presence), so `parse()` runs the shared
 *   `bakeLegacyLabelSettings` unconditionally.
 * - v15 → v16: retire the doc-level `curveRadius` — bake it onto every line
 *   (`Line.curveRadius`, dropped at the historical default 24) and fill line
 *   style defs that predate the covered field, via the shared
 *   `bakeDocCurveRadius`. Idempotent (keyed off field presence), so `parse()`
 *   runs it unconditionally. Ordered BEFORE the v<10 style hygiene — see the
 *   gate's comment.
 * - v16 → v17: merge the retired `polygonOrder` + `svgImageOrder` into the
 *   single `backgroundOrder` (polygons first — the stacking the two arrays
 *   painted), via `bakeLegacyBackgroundOrder`. Idempotent, keyed off field
 *   presence.
 * - v17 → v18: split the single `defaultDotStyle`/`defaultDotSize` into the
 *   `singletonDotStyle`/`multiDotStyle` (+ sizes) pair — on lines AND line
 *   style-def props — via the shared `bakeLineDotDefaults`. Ordered AFTER the
 *   v<7 `convertLegacyDotShapes` (which materializes `defaultDotStyle` from any
 *   legacy `defaultDotShape`) and BEFORE the v<10 style hygiene, same as
 *   `bakeDocCurveRadius`. Idempotent, keyed off the retired keys' presence.
 * - v18 → v19: introduce the doc-scoped stopDot style library — seed the factory
 *   dot styles and tag every dot slot (line split defaults + per-stop overrides)
 *   by value-match, via `bakeStopDotLibrary`. Ordered after the v<18 split bake
 *   (line values are in singleton/multi form) and before the invariant pass.
 * - v19 → v20: the dot TYPE (the stopDot-library id per case) became a covered
 *   LINE-style field — backfill `singletonDotStyleId`/`multiDotStyleId` on line
 *   style defs (`bakeLineStyleDotIds`), then untag any line whose split dot type
 *   differs from its now-fuller line style (`pruneLineDotTypeTagMismatches`),
 *   keeping "tagged ⇒ matches". Ordered after the v<19 library bake.
 * - v20 → v21: `strokeAlign` became a REQUIRED DotStyle field (center/inside/
 *   outside); backfill 'center' (the historical SVG-native placement) across
 *   every dot-style home via `backfillDotStrokeAlign` so the invariant holds.
 * - v21 → v22: the line END became a REQUIRED covered field of line style defs;
 *   heal absent/garbage values to 'square' (the historical full marker square)
 *   via `backfillLineStyleEndStyle`. No tag prune follows it — a line from those
 *   saves carries no end of its own, so it already paints what the heal writes.
 * - v22 → v23: (superseded by v25) the doc-level `seamEdges` was baked onto
 *   lines when the seam went per-line; the whole seam has since retired, so
 *   the v<25 strip below removes every seam field wherever this bake would
 *   have written one — the gate itself is gone.
 * - v23 → v24: retire `activePalettes` — the id list of which palettes were
 *   switched on becomes the palette COPIES the map carries (`MapDoc.palettes`),
 *   so a map needs no companion library to open with the right colors. Built-in
 *   ids resolve through the retired-id table, `custom:` ids against the palette
 *   library, via the shared `bakeActivePalettes`; ids resolving to neither are
 *   dropped, and a map carrying no palettes is a legitimate outcome. Gated on
 *   the new field being ABSENT as well, so it can never overwrite real palettes.
 * - v24 → v25: the branch seam retired outright — self-overlaps are region
 *   faces painted per junction now — so strip `seamColor`/`seamWidth`/
 *   `seamEdges` from lines AND line style defs (plus any doc-level remnant)
 *   via the shared `stripRetiredSeamFields`. Both sides lose the fields
 *   together, so tagged wearers stay tagged; `parse()` runs the same strip
 *   unconditionally.
 */
export function migrateDoc(persisted: unknown, version: number): DocState {
  const s = persisted as {
    lines?: Record<LineId, Line>;
    stations?: Record<string, Station>;
    polygons?: Record<string, Polygon>;
    textLabels?: Record<string, TextLabel>;
    transfers?: Record<string, Transfer>;
    styles?: Record<string, StyleDef>;
    styleDefaults?: Record<StyleKind, string>;
    regionAssignments?: Record<string, RegionAssignment>;
    lineCircles?: Record<string, LineCircle>;
    svgImages?: Record<string, SvgImage>;
    backgroundOrder?: string[];
    labelBold?: boolean;
    labelWeight?: TextLabelWeight;
    activePalettes?: string[];
    palettes?: Palette[];
  };
  // Corrupt or missing version is treated as v0 so all migrations run —
  // preferable to silently rendering with stale data.
  const v = typeof version === 'number' ? version : 0;
  // Some blocks write the same top-level field (v<1 and v<7 both touch lines;
  // v<4 and v<7 both touch stations), but each re-reads `out` and they touch
  // disjoint PROPERTIES within those records, so order is still immaterial.
  let out: typeof s = s;
  if (v < 1 && out.lines) {
    const { lines: cleaned, changed } = backfillLineNames(out.lines);
    if (changed) out = { ...out, lines: cleaned };
  }
  if (v < 4 && out.stations) {
    const { stations: cleaned, changed } = sanitizeStations(out.stations);
    if (changed) out = { ...out, stations: cleaned };
  }
  if (v < 5 && out.polygons) {
    const { polygons: cleaned, changed } = backfillPolygonDarkColors(out.polygons);
    if (changed) out = { ...out, polygons: cleaned };
  }
  if (v < 6 && out.textLabels) {
    const { textLabels: cleaned, changed } = backfillTextLabelColors(out.textLabels);
    if (changed) out = { ...out, textLabels: cleaned };
  }
  if (v < 7 && (out.stations || out.lines)) {
    // Legacy dotShape/defaultDotShape preset ids → DotStyle objects (same
    // converter parse() uses on the file-import path).
    const converted = convertLegacyDotShapes(out.stations ?? {}, out.lines ?? {});
    if (converted.changed) {
      out = {
        ...out,
        ...(out.stations ? { stations: converted.stations } : {}),
        ...(out.lines ? { lines: converted.lines } : {}),
      };
    }
  }
  if (v < 8 && (out.stations || out.textLabels)) {
    const migrated = migrateLegacyBulletSyntax(out.stations ?? {}, out.textLabels ?? {});
    if (migrated.changed) {
      out = {
        ...out,
        ...(out.stations ? { stations: migrated.stations } : {}),
        ...(out.textLabels ? { textLabels: migrated.textLabels } : {}),
      };
    }
  }
  if (v < 9 && out.polygons) {
    // Fold the legacy per-polygon fillOpacity percentage into the fill/darkFill
    // alpha and drop the field (the color now carries transparency directly).
    // Runs after the v<5 dark-color backfill above, so darkFill is present.
    const folded = foldPolygonFillOpacity(out.polygons);
    if (folded.changed) out = { ...out, polygons: folded.polygons };
  }
  if (v < 16) {
    // Retired doc-level curveRadius → per-line fields, plus the line-style-def
    // fill. MUST run before the v<10 style hygiene below: migrateV9Styles
    // rebuilds defs through the canonical grids, and a def missing
    // `curveRadius` would heal to the constant default instead of the doc's
    // legacy value.
    out = bakeDocCurveRadius(out);
  }
  if (v < 25) {
    // The branch seam retired outright (self-overlaps are region faces now):
    // strip seamColor/seamWidth/seamEdges from lines AND line style defs,
    // plus the even older doc-level seamEdges the v<23 bake used to spread.
    // Lines and defs lose the fields together, so tagged wearers stay tagged.
    out = stripRetiredSeamFields(out);
  }
  if (v < 18) {
    // Split the retired single `defaultDotStyle` / `defaultDotSize` into the
    // singleton/multi pair (per-line + line style-def props). Ordered AFTER the
    // v<7 convertLegacyDotShapes (which materializes `defaultDotStyle` from any
    // legacy `defaultDotShape`) and BEFORE the v<10 style hygiene below, same
    // as bakeDocCurveRadius: migrateV9Styles rebuilds defs through the canonical
    // grids, which now read the split props. Idempotent (keyed off the retired
    // keys' presence).
    out = bakeLineDotDefaults(out);
  }
  if (v < 10) {
    // Style-def hygiene FIRST — strip round-1 defs' since-dropped keys, and
    // materialize an explicit (possibly empty) styles record so the invariant
    // pass below injects the factory Defaults that pre-styles docs never
    // persisted and the merge won't backfill.
    const styles = migrateV9Styles(out.styles ?? {});
    if (styles !== out.styles) out = { ...out, styles };
  }
  if (v < 19) {
    // Introduce the stopDot style library: seed the factory dot styles + tag
    // every dot slot (line split defaults + per-stop overrides) by value-match.
    // AFTER the v<18 split bake (line raw values are in singleton/multi form)
    // and the v<10 style rebuild (so seeded defs aren't re-mangled), BEFORE the
    // invariant pass below (so it sees the non-empty stopDot kind + designation).
    out = bakeStopDotLibrary(out as unknown as MapDoc) as typeof out;
  }
  // Non-version-gated invariant, like the palette check below: every kind has
  // ≥ 1 style and a valid default designation. Must precede the v<10 bake
  // (which seeds the DESIGNATED default transfer style) and the v<11 adoption
  // (which stamps kinds' designated defaults). An ABSENT styles record is
  // left untouched — only pre-styles docs at v ≥ 10 lack one, which can't
  // exist (v10 materialized it).
  if (out.styles !== undefined) {
    const inv = ensureStyleInvariants(out.styles, out.styleDefaults);
    if (inv.changed) out = { ...out, styles: inv.styles, styleDefaults: inv.styleDefaults };
  }
  if (v < 10) {
    // Retired doc-level transfer settings → baked into per-transfer overrides
    // (no-op when the fields were never persisted, e.g. pre-PR-#220 docs).
    out = bakeLegacyTransferSettings(out);
  }
  if (v < 13) {
    // Transfer colors gained day/night halves. Convert legacy single-color
    // string overrides AND transfer StyleDef props to `{day, night}` pairs
    // (old colors are day colors, night matches). MUST run after the v<10 bake
    // (so a pre-#220 doc's freshly-baked overrides are already pairs) and
    // BEFORE the v<11 adoption below — adoption compares transfer props via
    // stylePropsEqual, which now reads `.day`/`.night`, so the colors have to
    // be pairs first. No-op (reference-stable) on already-converted docs.
    const converted = backfillTransferDayNightColors(out.transfers ?? {}, out.styles ?? {});
    if (converted.changed) {
      out = {
        ...out,
        ...(out.transfers ? { transfers: converted.transfers } : {}),
        ...(out.styles ? { styles: converted.styles } : {}),
      };
    }
  }
  if (v < 11) {
    // Adopt untagged, default-looking items into the default styles: legacy
    // maps are full of them, and without tags the Styles panel's Default
    // editors would act on nothing.
    out = S.adoptDefaultStyles(out as unknown as MapDoc) as typeof out;
  }
  // Non-version-gated invariant (like the palette/style repairs): every line
  // MUST carry an `edges` array — the renderer and interlining read it directly
  // (`ln.edges.join(...)`). Line topology moved from the ordered `stations`
  // list to an explicit `edges` set at v14; a pure version gate would suffice
  // for honestly-versioned docs, but an intermediate build bumped the persist
  // version to 14 and re-saved docs BEFORE lines carried `edges`, stranding
  // them at v14 with no edges — a `v < 14` gate can never recover those (14 is
  // not < 14) and the renderer crashes on load. So backfill it every time,
  // mirroring parse()'s unconditional per-line backfill. `backfillLinesEdges`
  // is reference-stable when every line already has an array, so this is a
  // no-op (preserving the already-canonical pass-through) on canonical docs.
  if (out.lines) {
    const { lines: cleaned, changed } = backfillLinesEdges(out.lines);
    if (changed) out = { ...out, lines: cleaned };
  }
  if (v < 3 && 'labelBold' in out) {
    const { labelBold, ...rest } = out;
    // Existing `labelWeight` wins if both fields are present.
    if (rest.labelWeight === undefined) {
      out = { ...rest, labelWeight: labelBold ? 700 : 400 };
    } else {
      out = rest;
    }
  }
  if (v < 14) {
    // Retired doc-level station-label font settings (labelFontSize/labelWeight/
    // labelItalic/labelLeading/labelTracking) → baked into per-station
    // typography, with the map-wide role moved to the seeded default station
    // style. Runs AFTER the v<3 labelBold→labelWeight step (so it sees the
    // materialized weight) and the invariant pass above (so styleDefaults.station
    // resolves). Idempotent — `parse()` runs the shared bake unconditionally.
    out = bakeLegacyLabelSettings(out);
  }
  if (v < 15) {
    // The layering rework: per-segment z-layers retired in favor of region
    // assignments. Strip the dead field from persisted lines, and run the
    // region-assignment hygiene parse() applies (a pre-v15 doc can't have
    // assignments, but a tampered/newer-build one might).
    if (out.lines) {
      const stripped = stripLegacySegmentLayers(out.lines);
      if (stripped.changed) out = { ...out, lines: stripped.lines };
    }
    if (out.regionAssignments && out.lines) {
      const cleaned = sanitizeRegionAssignments(out.regionAssignments, out.lines);
      if (cleaned.changed) out = { ...out, regionAssignments: cleaned.assignments };
    }
  }
  if (v < 17) {
    // Polygons and svg images share ONE z-stack now: merge the retired
    // `polygonOrder`/`svgImageOrder` into `backgroundOrder`, polygons first,
    // which is exactly the stacking the two separate arrays produced. Keyed off
    // field presence, so it no-ops (by reference) on a doc that has neither.
    out = bakeLegacyBackgroundOrder(out);
  }
  if (v < 20 && out.styles) {
    // Dot TYPE (the stopDot library id per case) became a covered LINE-style
    // field. Backfill the two ids on line style defs (absent ⇒ the stopDot ⭐
    // default), then untag any line whose split dot type differs from its
    // now-fuller line style — keeping "tagged ⇒ matches". Ordered after the v<19
    // library bake (lines carry their split ids). The file-import path prunes
    // this via pruneDanglingStyleRefs in parse().
    out = bakeLineStyleDotIds(out);
    const styles = out.styles;
    if (out.lines && styles) {
      out = { ...out, lines: pruneLineDotTypeTagMismatches(out.lines, styles) };
    }
  }
  if (v < 21) {
    // `strokeAlign` became a REQUIRED DotStyle field (center/inside/outside);
    // persisted dot styles predate it. Backfill 'center' — the historical,
    // SVG-native stroke placement — across every dot-style home so the
    // required-field invariant holds. The file-import path covers this via
    // `sanitizeDotStyle`.
    out = backfillDotStrokeAlign(out);
  }
  if (v < 22 && out.styles) {
    // The line END became a REQUIRED covered field of line style defs; defs
    // persisted before it lack the key. Heal to 'square' — the historical look,
    // so nothing repaints. No tag pruning after it (unlike the v<20 dot-type
    // backfill): a line from those saves carries no end of its own, so it
    // already paints square and matches the healed def.
    out = backfillLineStyleEndStyle(out);
  }
  // Non-version-gated repair: station cells that drifted off the integer
  // lattice. Like the palette invariant below and unlike the migrations above,
  // this isn't tied to a schema bump — the editor's old trig-rotated ghost
  // lattice wrote sub-ulp drift into cells at EVERY store version, including
  // the current one, so a gate would skip the docs most likely to carry it.
  // Idempotent and value-keyed; shared with the file-import path via
  // `snapStationCells`.
  if (out.stations) {
    const snapped = snapStationCells(out.stations);
    if (snapped.changed) out = { ...out, stations: snapped.stations };
  }
  // Non-version-gated invariant: line-circle bindings resolve, viaCircle flags
  // only live on bound stations, bound stations sit on their circle. Idempotent
  // and value-keyed; shared with the file-import path via `sanitizeLineCircles`.
  if (out.stations || out.lineCircles) {
    const circles = sanitizeLineCircles(out.lineCircles ?? {}, out.stations ?? {});
    if (circles.changed) {
      out = {
        ...out,
        ...(out.lineCircles ? { lineCircles: circles.lineCircles } : {}),
        ...(out.stations ? { stations: circles.stations } : {}),
      };
    }
  }
  // Non-version-gated invariant: every svg image's href is inline data. The
  // guard had one caller (the clipboard) and neither doc-load path, so a doc
  // persisted at ANY store version can carry a remote href that fetches on
  // every paint and rides into every export. Idempotent and value-keyed; shared
  // with the file-import path via `sanitizeImageHrefs`.
  if (out.svgImages) {
    const hrefs = sanitizeImageHrefs(out.svgImages, out.backgroundOrder ?? []);
    if (hrefs.changed) {
      out = {
        ...out,
        svgImages: hrefs.svgImages,
        ...(out.backgroundOrder ? { backgroundOrder: hrefs.backgroundOrder } : {}),
      };
    }
  }
  if (v < 24 && out.palettes === undefined && out.activePalettes !== undefined) {
    const { activePalettes, ...rest } = out;
    out = {
      ...rest,
      palettes: bakeActivePalettes(activePalettes, useCustomPalettes.getState().palettes),
    };
  }
  return out as DocState;
}

interface DocState extends MapDoc {
  // mutators
  addStation: (x: number, y: number, name?: string) => StationId;
  renameStation: (id: StationId, name: string) => void;
  moveStation: (id: StationId, x: number, y: number) => void;
  setDotStyle: (stationId: StationId, lineId: LineId, styleId: string) => void;
  setDotSize: (stationId: StationId, lineId: LineId, size: number) => void;
  setStationWaypoint: (stationId: StationId, isWaypoint: boolean) => void;
  setStationStopType: (stationId: StationId, stopType: StationStopType) => void;
  setStationLocked: (stationId: StationId, locked: boolean) => void;
  // Bulk lock/unlock across every lockable kind — ONE undo entry.
  setItemsLocked: (ids: T.LockableItemIds, locked: boolean) => void;
  setStationEditorHeight: (stationId: StationId, height: number) => void;
  redistributeBetween: (
    startId: StationId,
    endId: StationId,
    mode?: 'arc-bends' | 'straight',
    gridMode?: GridSnap,
  ) => void;
  rotateStation: (id: StationId, dir?: -1 | 1) => void;
  rotateItemsAround: (pivot: T.ItemRef, members: T.ItemRef[]) => void;
  rotateStationAndLayout: (id: StationId, dir: -1 | 1) => void;
  deleteStation: (id: StationId) => void;
  moveStop: (stationId: StationId, lineId: LineId, dRow: number, dCol: number) => void;
  rotateStop: (stationId: StationId, lineId: LineId) => void;
  moveLabel: (stationId: StationId, dRow: number, dCol: number) => void;
  rotateLabel: (stationId: StationId) => void;
  setLabelOffset: (stationId: StationId, offset: number) => void;
  setLabelOffsetPerp: (stationId: StationId, offsetPerp: number) => void;
  setLabelAlign: (stationId: StationId, align: LabelAlign) => void;
  setLabelValign: (stationId: StationId, valign: LabelValign) => void;
  setLabelAutoAlign: (stationId: StationId, on: boolean) => void;
  setLabelAutoHAlign: (stationId: StationId, v: AutoHAlign | null) => void;
  setLabelAutoVAlign: (stationId: StationId, v: AutoVAlign | null) => void;

  addLine: () => LineId;
  updateLine: (id: LineId, patch: Partial<Pick<Line, 'service' | 'name' | 'color'>>) => void;
  connectStationsOnLine: (lineId: LineId, fromStationId: StationId, toStationId: StationId) => void;
  spliceStationIntoEdge: (
    lineId: LineId,
    fromStationId: StationId,
    toStationId: StationId,
    stationId: StationId,
  ) => void;
  addStationToLine: (lineId: LineId, stationId: StationId) => void;
  toggleEdgeOnLine: (lineId: LineId, a: StationId, b: StationId) => void;
  removeStationFromLine: (lineId: LineId, idx: number) => void;
  setLineSegmentStyle: (
    lineId: LineId,
    fromStationId: StationId,
    toStationId: StationId,
    style: LineStyle,
  ) => void;
  setLineSingletonDotStyle: (lineId: LineId, styleId: string) => void;
  setLineMultiDotStyle: (lineId: LineId, styleId: string) => void;
  setLineSingletonDotSize: (lineId: LineId, size: number) => void;
  setLineMultiDotSize: (lineId: LineId, size: number) => void;
  setLineWidth: (lineId: LineId, w: number) => void;
  setLineInterlineGap: (lineId: LineId, v: number) => void;
  setLineLabelGap: (lineId: LineId, v: number) => void;
  setLineCurveRadius: (lineId: LineId, r: number) => void;
  setLineEndStyle: (lineId: LineId, end: LineEndStyle) => void;
  setStationEndStyle: (lineId: LineId, stationId: StationId, end: LineEndStyle) => void;
  setLineStrokeWidth: (lineId: LineId, w: number) => void;
  setLineStrokeColor: (lineId: LineId, c: string) => void;
  setLineDashLength: (lineId: LineId, v: number) => void;
  setLineDashWidth: (lineId: LineId, v: number) => void;
  deleteLine: (id: LineId) => void;

  // Region paint choices. `assignRegions` is the click writer: per entry, id
  // null mints a fresh one and assignment null deletes (back to the lineOrder
  // default). It takes a LIST because one shift-click floods a winner across
  // every face of a crossing — they must land as one undo entry.
  // `setRegionAssignments` is the wholesale writer used by the geometry
  // reconcile step.
  assignRegions: (entries: { id: string | null; assignment: RegionAssignment | null }[]) => void;
  setRegionAssignments: (next: Record<string, RegionAssignment>) => void;

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
  duplicateRouteBullet: (id: string) => string | null;
  pasteRouteBullet: (data: Omit<RouteBullet, 'id'>) => string;
  moveRouteBullet: (id: string, x: number, y: number) => void;
  rotateRouteBullet: (id: string) => void;
  updateRouteBullet: (
    id: string,
    patch: Partial<Pick<RouteBullet, 'lineId' | 'shape' | 'size' | 'locked'>>,
  ) => void;
  deleteRouteBullet: (id: string) => void;

  // Transfer anchors. FREE ones are a free-floating x/y item like a bullet;
  // HOSTED ones are cells in a station's grid, so they move by a (dRow, dCol)
  // delta like a stop. Both deletes cascade the transfers bound to them.
  addTransferAnchor: (x: number, y: number) => string;
  moveTransferAnchor: (id: string, x: number, y: number) => void;
  deleteTransferAnchor: (id: string) => void;
  addStationAnchor: (stationId: StationId, row: number, col: number) => string;
  moveStationAnchor: (stationId: StationId, anchorId: string, dRow: number, dCol: number) => void;
  deleteStationAnchor: (stationId: StationId, anchorId: string) => void;

  addTransfer: (a: TransferEnd, b: TransferEnd) => string;
  /** The station popover's transfer picker: give one stop dot its SELF-transfer
   *  (see `addSelfTransfer`), restyle the one it already has, or — with `null`,
   *  the picker's "None" — remove it. */
  setStopSelfTransfer: (stationId: StationId, lineId: LineId, styleId: string | null) => void;
  updateTransferStyle: (id: string, patch: TransferStylePatch) => void;
  deleteTransfer: (id: string) => void;

  addTextLabel: (x: number, y: number) => string;
  addTextLabelWith: (fields: Omit<TextLabel, 'id'>) => string;
  pasteTextLabel: (data: Omit<TextLabel, 'id'>) => string;
  duplicateTextLabel: (id: string) => string | null;
  moveTextLabel: (id: string, x: number, y: number) => void;
  rotateTextLabel: (id: string) => void;
  updateTextLabel: (id: string, patch: Partial<Omit<TextLabel, 'id'>>) => void;
  deleteTextLabel: (id: string) => void;

  addPolygon: (x: number, y: number) => string;
  addPolygonWith: (fields: Omit<Polygon, 'id'>) => string;
  pastePolygon: (data: Omit<Polygon, 'id'>) => string;
  duplicatePolygon: (id: string) => string | null;
  setPolygonVertices: (id: string, vertices: Polygon['vertices']) => void;
  movePolygon: (id: string, dx: number, dy: number) => void;
  moveVertices: (id: string, indices: number[], dx: number, dy: number) => void;
  insertVertex: (id: string, edgeIndex: number) => void;
  deleteVertices: (id: string, indices: number[]) => void;
  updatePolygon: (id: string, patch: PolygonStylePatch) => void;
  rotatePolygon: (id: string) => void;
  deletePolygon: (id: string) => void;

  addSvgImage: (fields: Omit<SvgImage, 'id'>) => string;
  pasteSvgImage: (data: Omit<SvgImage, 'id'>) => string;
  duplicateSvgImage: (id: string) => string | null;
  moveSvgImage: (id: string, x: number, y: number) => void;
  updateSvgImage: (id: string, patch: SvgImageStylePatch) => void;
  rotateSvgImage45: (id: string) => void;
  deleteSvgImage: (id: string) => void;

  addLineCircle: (x: number, y: number, radius?: number) => string;
  moveLineCircle: (id: string, x: number, y: number) => void;
  rotateLineCircle: (id: string) => void;
  setLineCircleRadius: (id: string, radius: number) => void;
  setLineCircleLocked: (id: string, locked: boolean) => void;
  deleteLineCircle: (id: string) => void;
  bindStationToCircle: (
    stationId: StationId,
    circleId: string,
    seatFrom?: { x: number; y: number; rotation: Rotation },
  ) => void;
  unbindStationFromCircle: (stationId: StationId) => void;
  setStopViaCircle: (stationId: StationId, lineId: LineId, via: boolean) => void;

  /** Restack a background item — polygon OR svg image — within the shared
   *  background z-stack (`backgroundOrder`): one step up/down, or all the way
   *  to either end. One set of actions for both kinds, since they share the
   *  one stack. */
  moveBackgroundUp: (id: string) => void;
  moveBackgroundDown: (id: string) => void;
  moveBackgroundToTop: (id: string) => void;
  moveBackgroundToBottom: (id: string) => void;

  /** Define-by-example: capture `itemId`'s current EFFECTIVE formatting as
   *  the style named `name` — upsert-by-name per kind (à la addPalette), so
   *  saving under an existing name redefines that style and re-stamps its
   *  users in the same single undo entry. Returns the style id the name
   *  resolves to (nothing is written when the transform refuses — empty name
   *  or missing item). */
  saveStyle: (kind: StyleKind, name: string, itemId: string) => string;
  /** Stamp a style's props onto an item and tag it (one undo entry). */
  applyStyle: (styleId: string, itemId: string) => void;
  /** Detach an item to "Custom": drop the tag, keep the values. */
  clearStyleTag: (kind: StyleKind, itemId: string) => void;
  renameStyle: (styleId: string, name: string) => void;
  /** Delete a style def; its users keep their values but lose the tag. */
  deleteStyle: (styleId: string) => void;
  /** The Styles panel's "+ New style": a fresh def of `kind` with factory
   *  props under the first unused "New style N" name. Returns its id. */
  createStyle: (kind: StyleKind) => string;
  /** The Styles panel's "duplicate": a fresh copy of an existing style —
   *  same kind and props, a new id, and the first unused "{name} copy" name.
   *  Not made default and worn by no items. Returns the new style's id (or the
   *  source id unchanged when it doesn't resolve). */
  duplicateStyle: (styleId: string) => string;
  /** The Styles panel editor's write path: patch a def's props and re-stamp
   *  its tagged users live, all one undo entry. */
  updateStyleProps: (styleId: string, patch: S.StylePropsPatch) => void;
  /** The Styles panel's "make default": designate a style as its kind's
   *  default (new items of the kind are created wearing it). */
  setDefaultStyle: (styleId: string) => void;

  /** Replace the whole document (file load). Defaults fill any field the
   *  loaded doc omits. Callers should clearHistory() after — undo must not
   *  cross a file load. */
  loadDoc: (doc: MapDoc) => void;
  setDocName: (name: string) => void;
  /** The station popover's style section write path: patch a station's own
   *  typography (fontSize/weight/italic/leading/tracking), detaching its style
   *  tag when a covered value actually changes. */
  updateStationLabelStyle: (stationId: StationId, patch: T.StationLabelPatch) => void;
  /** Take a palette into the map — a copy, upserted by name. Also how a map
   *  picks up a palette corrected in the library. */
  addPaletteToMap: (palette: Palette) => void;
  removePaletteFromMap: (name: string) => void;
  renameMapPalette: (from: string, to: string) => void;
  /** Recolor one swatch of a map palette, repainting the lines wearing the
   *  old color in the same write — the palette editor's recolor gesture. */
  recolorMapPaletteColor: (name: string, index: number, color: string) => void;
  /** Move a palette from one slot to another in the map's list — the order
   *  the picker's sections and the `addLine` color cycle follow. */
  reorderMapPalette: (from: number, to: number) => void;
  /** Make this a night map (or a day map again). A document edit like any
   *  other — undoable, and saved with the file. */
  setDarkMode: (darkMode: boolean) => void;
  clearAll: () => void;
}

export const useDoc = create<DocState>()(
  temporal(
    persist(
      (set, get) => ({
        ...DEFAULT_DOC,

        addStation: (x, y, name) => {
          const id = ids.stationId();
          const finalName = name ?? randomStationName();
          // Stamp + tag the new station with the designated default 'station'
          // style (its typography), like every other add action.
          set((s) => S.applyDefaultStyle(T.addStation(s, x, y, id, finalName), 'station', id));
          return id;
        },
        renameStation: (id, name) => set((s) => T.renameStation(s, id, name)),
        moveStation: (id, x, y) => set(withRegionReconcile((s) => T.moveStation(s, id, x, y))),
        setDotStyle: (stationId, lineId, styleId) =>
          set((s) => T.setDotStyle(s, stationId, lineId, styleId)),
        setDotSize: (stationId, lineId, size) =>
          set((s) => T.setDotSize(s, stationId, lineId, size)),
        setStationWaypoint: (stationId, isWaypoint) =>
          set((s) => T.setStationWaypoint(s, stationId, isWaypoint)),
        setStationStopType: (stationId, stopType) =>
          set((s) => T.setStationStopType(s, stationId, stopType)),
        setStationLocked: (stationId, locked) =>
          set((s) => T.setStationLocked(s, stationId, locked)),
        setItemsLocked: (ids, locked) => set((s) => T.setItemsLocked(s, ids, locked)),
        setStationEditorHeight: (stationId, height) =>
          set((s) => T.setStationEditorHeight(s, stationId, height)),
        redistributeBetween: (startId, endId, mode = 'arc-bends', gridMode = 'off') =>
          // gridMode is per-call intent (depends on Shift at the call site);
          // gridInterval is ambient, so read the active grid size from the
          // viewport store here rather than threading it through every caller.
          set(
            withRegionReconcile((s) =>
              T.redistributeBetween(
                s,
                startId,
                endId,
                mode,
                gridMode,
                useViewportStore.getState().gridSize,
              ),
            ),
          ),
        rotateStation: (id, dir) => set(withRegionReconcile((s) => T.rotateStation(s, id, dir))),
        rotateItemsAround: (pivot, members) =>
          set(withRegionReconcile((s) => T.rotateItemsAround(s, pivot, members))),
        rotateStationAndLayout: (id, dir) =>
          set(withRegionReconcile((s) => T.rotateStationAndLayout(s, id, dir))),
        deleteStation: (id) => set(withRegionReconcile((s) => T.deleteStation(s, id))),

        moveStop: (stationId, lineId, dRow, dCol) =>
          set(withRegionReconcile((s) => T.moveStop(s, stationId, lineId, dRow, dCol))),
        rotateStop: (stationId, lineId) =>
          set(withRegionReconcile((s) => T.rotateStop(s, stationId, lineId))),

        moveLabel: (stationId, dRow, dCol) => set((s) => T.moveLabel(s, stationId, dRow, dCol)),
        rotateLabel: (stationId) => set((s) => T.rotateLabel(s, stationId)),
        setLabelOffset: (stationId, offset) => set((s) => T.setLabelOffset(s, stationId, offset)),
        setLabelOffsetPerp: (stationId, offsetPerp) =>
          set((s) => T.setLabelOffsetPerp(s, stationId, offsetPerp)),
        setLabelAlign: (stationId, align) => set((s) => T.setLabelAlign(s, stationId, align)),
        setLabelValign: (stationId, valign) => set((s) => T.setLabelValign(s, stationId, valign)),
        setLabelAutoAlign: (stationId, on) => set((s) => T.setLabelAutoAlign(s, stationId, on)),
        setLabelAutoHAlign: (stationId, v) => set((s) => T.setLabelAutoHAlign(s, stationId, v)),
        setLabelAutoVAlign: (stationId, v) => set((s) => T.setLabelAutoVAlign(s, stationId, v)),

        addLine: () => {
          const id = ids.lineId();
          set((s) => {
            const cycle = cyclingColors(s.palettes);
            // Guard the empty cycle (a map may carry no palettes at all):
            // `n % 0` is NaN, which would index `undefined`.
            const color = cycle.length ? cycle[s.lineCounter % cycle.length] : FALLBACK_LINE_COLOR;
            const service = pickNextLineName(s.lines);
            // New items wear the kind's "Default" style (composed into the
            // same set() so creation stays one undo entry). Color is identity,
            // not style — the cycled pick above survives the stamp. Dot TYPE is
            // a covered line-style field now, so seed the ⭐ stopDot default on
            // the still-untagged line FIRST (nothing to detach), THEN stamp the
            // default line style: it either matches (tag only) or restamps the
            // dot to its own — the line style wins for a new line's dot.
            return S.applyDefaultStyle(
              T.applyDefaultStopDotToLine(T.addLine(s, id, service, color), id),
              'line',
              id,
            );
          });
          return id;
        },
        updateLine: (id, patch) => set((s) => T.updateLine(s, id, patch)),
        addStationToLine: (lineId, stationId) =>
          set(withRegionReconcile((s) => T.addStationToLine(s, lineId, stationId))),
        connectStationsOnLine: (lineId, fromStationId, toStationId) =>
          set(
            withRegionReconcile((s) =>
              T.connectStationsOnLine(s, lineId, fromStationId, toStationId),
            ),
          ),
        spliceStationIntoEdge: (lineId, fromStationId, toStationId, stationId) =>
          set(
            withRegionReconcile((s) =>
              T.spliceStationIntoEdge(s, lineId, fromStationId, toStationId, stationId),
            ),
          ),
        toggleEdgeOnLine: (lineId, a, b) =>
          set(withRegionReconcile((s) => T.toggleEdgeOnLine(s, lineId, a, b))),
        removeStationFromLine: (lineId, idx) =>
          set(withRegionReconcile((s) => T.removeStationFromLine(s, lineId, idx))),
        setLineSegmentStyle: (lineId, fromStationId, toStationId, style) =>
          set(
            withRegionReconcile((s) =>
              T.setLineSegmentStyle(s, lineId, fromStationId, toStationId, style),
            ),
          ),
        setLineSingletonDotStyle: (lineId, styleId) =>
          set((s) => T.setLineSingletonDotStyle(s, lineId, styleId)),
        setLineMultiDotStyle: (lineId, styleId) =>
          set((s) => T.setLineMultiDotStyle(s, lineId, styleId)),
        setLineSingletonDotSize: (lineId, size) =>
          set((s) => T.setLineSingletonDotSize(s, lineId, size)),
        setLineMultiDotSize: (lineId, size) => set((s) => T.setLineMultiDotSize(s, lineId, size)),
        setLineWidth: (lineId, w) => set(withRegionReconcile((s) => T.setLineWidth(s, lineId, w))),
        setLineInterlineGap: (lineId, v) =>
          set(withRegionReconcile((s) => T.setLineInterlineGap(s, lineId, v))),
        // Pure label placement — no bands or marker footprints move, so no
        // region reconcile.
        setLineLabelGap: (lineId, v) => set((s) => T.setLineLabelGap(s, lineId, v)),
        setLineCurveRadius: (lineId, r) =>
          set(withRegionReconcile((s) => T.setLineCurveRadius(s, lineId, r))),
        // End style leaves band paths alone but reshapes the stop markers at
        // termini, and marker footprints are what the region arrangement is
        // built from — so both writers reconcile, like the geometry writers.
        setLineEndStyle: (lineId, end) =>
          set(withRegionReconcile((s) => T.setLineEndStyle(s, lineId, end))),
        setStationEndStyle: (lineId, stationId, end) =>
          set(withRegionReconcile((s) => T.setStationEndStyle(s, lineId, stationId, end))),
        setLineStrokeWidth: (lineId, w) => set((s) => T.setLineStrokeWidth(s, lineId, w)),
        setLineStrokeColor: (lineId, c) => set((s) => T.setLineStrokeColor(s, lineId, c)),
        setLineDashLength: (lineId, v) => set((s) => T.setLineDashLength(s, lineId, v)),
        setLineDashWidth: (lineId, v) => set((s) => T.setLineDashWidth(s, lineId, v)),
        deleteLine: (id) => set(withRegionReconcile((s) => T.deleteLine(s, id))),

        assignRegions: (entries) =>
          set((s) =>
            entries.reduce<MapDoc>((doc, e) => {
              const realId = e.id ?? ids.regionAssignmentId();
              return T.assignRegion(doc, realId, e.assignment && { ...e.assignment, id: realId });
            }, s),
          ),
        setRegionAssignments: (next) => set((s) => T.setRegionAssignments(s, next)),

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
          // New items wear the kind's "Default" style — same set(), one undo.
          set((s) => S.applyDefaultStyle(T.addRouteBullet(s, id, x, y, lineId), 'routeBullet', id));
          return id;
        },
        addRouteBulletWith: (fields) => {
          const id = ids.routeBulletId();
          set((s) => T.addRouteBulletWith(s, id, fields));
          return id;
        },
        // Add a bullet from a clipboard payload, nudged by the drop offset. The
        // fresh copy comes out UNLOCKED even if the source was locked, so it's
        // immediately movable (mirrors pastePolygon / pasteTextLabel). The
        // restamp pass repairs a stale tagged payload — the clipboard froze
        // the values, the style may have been redefined since the copy — in
        // the SAME set(), so a paste stays one undo entry.
        pasteRouteBullet: (data) => {
          const { locked: _locked, ...rest } = data;
          const id = ids.routeBulletId();
          set((s) =>
            S.restampStyleTag(
              T.addRouteBulletWith(s, id, {
                ...rest,
                x: data.x + DROP_OFFSET,
                y: data.y + DROP_OFFSET,
              }),
              'routeBullet',
              id,
            ),
          );
          return id;
        },
        // Duplicate an existing bullet at the drop offset; null if it's gone.
        duplicateRouteBullet: (id) => duplicateVia(get().routeBullets, id, get().pasteRouteBullet),
        moveRouteBullet: (id, x, y) => set((s) => T.moveRouteBullet(s, id, x, y)),
        rotateRouteBullet: (id) => set((s) => T.rotateRouteBullet(s, id)),
        updateRouteBullet: (id, patch) => set((s) => T.updateRouteBullet(s, id, patch)),
        deleteRouteBullet: (id) => set((s) => T.deleteRouteBullet(s, id)),

        addTransferAnchor: (x, y) => {
          const id = ids.anchorId();
          // No applyDefaultStyle: anchors carry no styleId — there is nothing
          // about them to style, and they never reach an export.
          set((s) => T.addTransferAnchor(s, id, x, y));
          return id;
        },
        // Plain set, NOT withRegionReconcile: an anchor move changes no line
        // geometry, and reconciling regions on every pointermove of a group
        // drag would be a real cost for no effect.
        moveTransferAnchor: (id, x, y) => set((s) => T.moveTransferAnchor(s, id, x, y)),
        deleteTransferAnchor: (id) => set((s) => T.deleteTransferAnchor(s, id)),
        addStationAnchor: (stationId, row, col) => {
          const id = ids.anchorId();
          set((s) => T.addStationAnchor(s, stationId, id, row, col));
          return id;
        },
        moveStationAnchor: (stationId, anchorId, dRow, dCol) =>
          set((s) => T.moveStationAnchor(s, stationId, anchorId, dRow, dCol)),
        deleteStationAnchor: (stationId, anchorId) =>
          set((s) => T.deleteStationAnchor(s, stationId, anchorId)),

        addTransfer: (a, b) => {
          const id = ids.transferId();
          // New items wear the kind's "Default" style — same set(), one undo.
          // addTransfer can refuse (self-transfer); the stamp no-ops then.
          set((s) => S.applyDefaultStyle(T.addTransfer(s, id, a, b), 'transfer', id));
          return id;
        },

        // One set() per pick, so create-and-stamp is a single undo entry (same
        // shape as addTransfer above). The id is minted outside the updater
        // like every other add; on the reuse and remove paths it simply goes
        // unused, which costs nothing but a counter tick.
        setStopSelfTransfer: (stationId, lineId, styleId) => {
          const newId = ids.transferId();
          set((s) => {
            const existing = T.selfTransferAt(s, stationId, lineId);
            if (styleId === null) return existing ? T.deleteTransfer(s, existing.id) : s;
            if (existing) return S.applyStyleToItem(s, styleId, existing.id);
            // addSelfTransfer refuses an absent stop; the stamp then no-ops on
            // the missing item, exactly as addTransfer's does.
            return S.applyStyleToItem(
              T.addSelfTransfer(s, newId, stationId, lineId),
              styleId,
              newId,
            );
          });
        },

        updateTransferStyle: (id, patch) => set((s) => T.updateTransferStyle(s, id, patch)),

        deleteTransfer: (id) => set((s) => T.deleteTransfer(s, id)),

        addTextLabel: (x, y) => {
          const id = ids.textLabelId();
          // New items wear the kind's "Default" style — same set(), one undo.
          // MINTED with those props rather than created factory-sized and then
          // patched: updateTextLabel re-anchors on a font-size change (the box
          // grows from a pinned edge, not the center), so stamping afterwards
          // would slide the label half a size-delta away from the point the
          // ghost previewed and the snap solved for. applyDefaultStyle then
          // only has to attach the tag — applyStyleToItem skips the stamp when
          // the values already match.
          set((s) => {
            const props = S.defaultStyleProps(s, 'textLabel');
            const seeded = T.addTextLabelWith(s, id, { ...T.TEXT_LABEL_DEFAULTS, ...props, x, y });
            return S.applyDefaultStyle(seeded, 'textLabel', id);
          });
          return id;
        },
        addTextLabelWith: (fields) => {
          const id = ids.textLabelId();
          set((s) => T.addTextLabelWith(s, id, fields));
          return id;
        },
        // Add a label from a clipboard payload, nudged by the drop offset. The
        // fresh copy comes out UNLOCKED even if the source was locked, so it's
        // immediately movable (mirrors pastePolygon / pasteRouteBullet). The
        // restamp pass repairs a stale tagged payload in the same set() —
        // see pasteRouteBullet.
        pasteTextLabel: (data) => {
          const { locked: _locked, ...rest } = data;
          const id = ids.textLabelId();
          set((s) =>
            S.restampStyleTag(
              T.addTextLabelWith(s, id, {
                ...rest,
                x: data.x + DROP_OFFSET,
                y: data.y + DROP_OFFSET,
              }),
              'textLabel',
              id,
            ),
          );
          return id;
        },
        // Duplicate an existing label at the drop offset; null if it's gone.
        duplicateTextLabel: (id) => duplicateVia(get().textLabels, id, get().pasteTextLabel),
        moveTextLabel: (id, x, y) => set((s) => T.moveTextLabel(s, id, x, y)),
        rotateTextLabel: (id) => set((s) => T.rotateTextLabel(s, id)),
        updateTextLabel: (id, patch) => set((s) => T.updateTextLabel(s, id, patch)),
        deleteTextLabel: (id) => set((s) => T.deleteTextLabel(s, id)),

        addPolygon: (x, y) => {
          const id = ids.polygonId();
          // New items wear the kind's "Default" style — same set(), one undo.
          set((s) => S.applyDefaultStyle(T.addPolygon(s, id, x, y), 'polygon', id));
          return id;
        },
        addPolygonWith: (fields) => {
          const id = ids.polygonId();
          set((s) => T.addPolygonWith(s, id, fields));
          return id;
        },
        // Add a polygon from a clipboard payload, translating every vertex by
        // the drop offset (polygons have no center — geometry lives in
        // `vertices`, in world coords). The fresh copy comes out UNLOCKED even
        // if the source was locked, so it's immediately movable/editable. The
        // restamp pass repairs a stale tagged payload in the same set() —
        // see pasteRouteBullet.
        pastePolygon: (data) => {
          const { locked: _locked, ...rest } = data;
          const id = ids.polygonId();
          set((s) =>
            S.restampStyleTag(
              T.addPolygonWith(s, id, {
                ...rest,
                vertices: data.vertices.map((v) => ({
                  x: v.x + DROP_OFFSET,
                  y: v.y + DROP_OFFSET,
                })),
              }),
              'polygon',
              id,
            ),
          );
          return id;
        },
        // Duplicate an existing polygon at the drop offset; null if it's gone.
        duplicatePolygon: (id) => duplicateVia(get().polygons, id, get().pastePolygon),
        setPolygonVertices: (id, vertices) => set((s) => T.setPolygonVertices(s, id, vertices)),
        movePolygon: (id, dx, dy) => set((s) => T.movePolygon(s, id, dx, dy)),
        moveVertices: (id, indices, dx, dy) => set((s) => T.moveVertices(s, id, indices, dx, dy)),
        insertVertex: (id, edgeIndex) => set((s) => T.insertVertex(s, id, edgeIndex)),
        deleteVertices: (id, indices) => set((s) => T.deleteVertices(s, id, indices)),
        updatePolygon: (id, patch) => set((s) => T.updatePolygon(s, id, patch)),
        rotatePolygon: (id) => set((s) => T.rotatePolygon(s, id)),
        deletePolygon: (id) => set((s) => T.deletePolygon(s, id)),

        addSvgImage: (fields) => {
          const id = ids.svgImageId();
          set((s) => T.addSvgImage(s, id, fields));
          return id;
        },
        // Paste an svg image from a clipboard payload, offsetting its CENTER by
        // the drop offset (an image has a center, unlike a polygon's vertices).
        // The copy comes out UNLOCKED even if the source was locked.
        pasteSvgImage: (data) => {
          const { locked: _locked, ...rest } = data;
          return get().addSvgImage({ ...rest, x: data.x + DROP_OFFSET, y: data.y + DROP_OFFSET });
        },
        // Duplicate an existing svg image at the drop offset; null if it's gone.
        duplicateSvgImage: (id) => duplicateVia(get().svgImages, id, get().pasteSvgImage),
        // Absolute center move — used by whole-image drag, group-tow, and nudge.
        moveSvgImage: (id, x, y) => set((s) => T.setSvgImageCenter(s, id, x, y)),
        updateSvgImage: (id, patch) => set((s) => T.updateSvgImage(s, id, patch)),
        // Single 45°-clockwise step for the right-click rotate (mirrors
        // rotatePolygon); updateSvgImage normalizes the result into [0, 360).
        rotateSvgImage45: (id) =>
          set((s) => T.updateSvgImage(s, id, { rotation: (s.svgImages[id]?.rotation ?? 0) + 45 })),
        deleteSvgImage: (id) => set((s) => T.deleteSvgImage(s, id)),

        // Line circles. A bare circle carries no painted geometry, so add /
        // lock skip the region reconcile; everything that moves bound stations
        // or flips an edge between arc and octolinear routing reconciles.
        addLineCircle: (x, y, radius) => {
          const id = ids.lineCircleId();
          set((s) => T.addLineCircle(s, id, x, y, radius));
          return id;
        },
        moveLineCircle: (id, x, y) =>
          set(withRegionReconcile((s) => T.moveLineCircle(s, id, x, y))),
        // The single-item half of the right-click rotate: bound stations swing
        // 45° round the rim (the ring itself has no orientation to advance).
        rotateLineCircle: (id) => set(withRegionReconcile((s) => T.rotateLineCircle(s, id))),
        setLineCircleRadius: (id, radius) =>
          set(withRegionReconcile((s) => T.setLineCircleRadius(s, id, radius))),
        setLineCircleLocked: (id, locked) => set((s) => T.setLineCircleLocked(s, id, locked)),
        deleteLineCircle: (id) => set(withRegionReconcile((s) => T.deleteLineCircle(s, id))),
        bindStationToCircle: (stationId, circleId, seatFrom) =>
          set(withRegionReconcile((s) => T.bindStationToCircle(s, stationId, circleId, seatFrom))),
        unbindStationFromCircle: (stationId) =>
          set(withRegionReconcile((s) => T.unbindStationFromCircle(s, stationId))),
        setStopViaCircle: (stationId, lineId, via) =>
          set(withRegionReconcile((s) => T.setStopViaCircle(s, stationId, lineId, via))),

        moveBackgroundUp: (id) => set((s) => T.moveBackgroundUp(s, id)),
        moveBackgroundDown: (id) => set((s) => T.moveBackgroundDown(s, id)),
        moveBackgroundToTop: (id) => set((s) => T.moveBackgroundToTop(s, id)),
        moveBackgroundToBottom: (id) => set((s) => T.moveBackgroundToBottom(s, id)),

        // Each style action is one atomic set() over one pure transform, so a
        // multi-item fan-out (save re-stamping every user, delete untagging
        // them) is exactly one undo entry — no history group needed.
        saveStyle: (kind, name, itemId) => {
          const trimmed = name.trim();
          const existing = Object.values(get().styles).find(
            (d) => d.kind === kind && d.name === trimmed,
          );
          const id = existing?.id ?? ids.styleId();
          set(withRegionReconcile((s) => S.saveStyleFromItem(s, id, kind, trimmed, itemId)));
          return id;
        },
        applyStyle: (styleId, itemId) =>
          set(withRegionReconcile((s) => S.applyStyleToItem(s, styleId, itemId))),
        clearStyleTag: (kind, itemId) => set((s) => S.clearStyleTag(s, kind, itemId)),
        renameStyle: (styleId, name) => set((s) => S.renameStyle(s, styleId, name)),
        deleteStyle: (styleId) => set((s) => S.deleteStyle(s, styleId)),
        createStyle: (kind) => {
          const id = ids.styleId();
          // First unused "New style N" within the kind, so create never
          // collides (the transform refuses duplicates).
          const taken = new Set(
            Object.values(get().styles)
              .filter((d) => d.kind === kind)
              .map((d) => d.name),
          );
          let name = 'New style';
          for (let n = 2; taken.has(name); n++) name = `New style ${n}`;
          set((s) => S.createStyle(s, id, kind, name));
          return id;
        },
        duplicateStyle: (styleId) => {
          const src = get().styles[styleId];
          if (!src) return styleId;
          const id = ids.styleId();
          // First unused "{name} copy" / "{name} copy N" within the kind, so
          // the copy never collides (the transform refuses duplicates).
          const taken = new Set(
            Object.values(get().styles)
              .filter((d) => d.kind === src.kind)
              .map((d) => d.name),
          );
          let name = `${src.name} copy`;
          for (let n = 2; taken.has(name); n++) name = `${src.name} copy ${n}`;
          set((s) => S.duplicateStyle(s, id, styleId, name));
          return id;
        },
        updateStyleProps: (styleId, patch) =>
          set(withRegionReconcile((s) => S.updateStyleProps(s, styleId, patch))),
        setDefaultStyle: (styleId) => set((s) => S.setDefaultStyle(s, styleId)),

        // A plain merge: doc fields are replaced, mutator methods survive.
        loadDoc: (doc) => set({ ...DEFAULT_DOC, ...doc }),
        setDocName: (name) => set((s) => T.setDocName(s, name)),
        updateStationLabelStyle: (stationId, patch) =>
          set((s) => T.updateStationLabelStyle(s, stationId, patch)),
        addPaletteToMap: (palette) => set((s) => T.addPaletteToMap(s, palette)),
        removePaletteFromMap: (name) => set((s) => T.removePaletteFromMap(s, name)),
        renameMapPalette: (from, to) => set((s) => T.renameMapPalette(s, from, to)),
        recolorMapPaletteColor: (name, index, color) =>
          set((s) => T.recolorMapPaletteColor(s, name, index, color)),
        reorderMapPalette: (from, to) => set((s) => T.reorderMapPalette(s, from, to)),
        setDarkMode: (darkMode) => set((s) => T.setDarkMode(s, darkMode)),
        clearAll: () => set((s) => T.clearAll(s)),
      }),
      {
        name: 'vignelli-map-doc-v1',
        storage: debouncedDocStorage,
        version: 25,
        // Version migration chain v0 → v25 lives in `migrateDoc` (above), which
        // is exported and unit-tested. See its doc comment for each step.
        migrate: (persisted, version) => migrateDoc(persisted, version),
        // `migrate` only runs when the STORED version differs from the config
        // version — so a doc stranded at 14 (an intermediate build re-saved docs
        // at the bumped version BEFORE lines carried `edges`) skips migrateDoc's
        // unconditional edge backfill entirely, and the renderer crashes on
        // `ln.edges.join(...)`. `merge` runs on EVERY rehydrate, so repair those
        // invariants here too. Both are reference-stable on a canonical doc, so
        // it passes straight through the default merge.
        //
        // Cell-dust snapping needs `merge` for a sharper reason than `edges`
        // does: the drift is still being carried by docs saved at the CURRENT
        // version, which by definition never reach `migrate` at all. The image
        // href guard is the same shape — a remote href could be persisted by
        // any build, this one included.
        merge: (persisted, current) => {
          const doc = (persisted ?? {}) as Partial<DocState>;
          const patch: Partial<DocState> = {};
          if (doc.lines) {
            const { lines, changed } = backfillLinesEdges(doc.lines);
            if (changed) patch.lines = lines;
          }
          if (doc.stations) {
            const { stations, changed } = snapStationCells(doc.stations);
            if (changed) patch.stations = stations;
          }
          if (doc.svgImages) {
            const hrefs = sanitizeImageHrefs(doc.svgImages, doc.backgroundOrder ?? []);
            if (hrefs.changed) {
              patch.svgImages = hrefs.svgImages;
              if (doc.backgroundOrder) patch.backgroundOrder = hrefs.backgroundOrder;
            }
          }
          return { ...current, ...doc, ...patch };
        },
        partialize: (s) => pickDocSnapshot(s),
      },
    ),
    {
      // Track only the document data — viewport and selection are in their
      // own stores, and the mutator method references never change so they're
      // safe to leave in (Object.assign on undo preserves them).
      //
      // `equality` skips recording when the partialized snapshot is value-
      // identical to the previous one. zundo has no diff/equality by default,
      // and `pickDocSnapshot` allocates a fresh object on every `set`, so
      // without this an ungrouped mutator that no-ops (a transform that returns
      // the doc unchanged) would still push a redundant past entry — making one
      // Ctrl+Z appear to do nothing. The grouped path (beginHistoryGroup) runs
      // the same check before pushing; this extends it to the ungrouped writes.
      equality: docSnapshotsEqual,
      partialize: (state) => pickDocSnapshot(state),
      limit: HISTORY_LIMIT,
    },
  ),
);

// The one currently-open history group, if any — the ownership reference
// behind the steal-on-begin overlap contract documented on beginHistoryGroup.
let openHistoryGroup: { commit: () => void; cancel: () => void } | null = null;
// Whether the open group's write stream defers the storage write (see
// beginHistoryGroup's deferPersist). Reset whenever ownership is released.
let openGroupDefersPersist = false;

/**
 * Cancel the currently-open history group, if any. Called by clearHistory():
 * a group open across a file load holds a snapshot of the REPLACED document,
 * so neither its own late end (a blur landing after the load) nor the next
 * begin's steal may push it — undo must never cross a file load.
 */
export function cancelOpenHistoryGroup(): void {
  openHistoryGroup?.cancel();
}

/**
 * Group lifecycle events, for machinery that must track gestures without the
 * store importing it (the region worker pipeline arms on begin and drains on
 * end). `end` fires exactly once per group on EVERY exit — commit, cancel,
 * rollback, and the steal (whose seal routes through the elder's commit) — so
 * a listener that disarms on `end` can never be stranded by an unusual exit.
 */
export type HistoryGroupEvent = { kind: 'begin'; deferPersist: boolean } | { kind: 'end' };
const historyGroupListeners = new Set<(e: HistoryGroupEvent) => void>();
export function onHistoryGroup(listener: (e: HistoryGroupEvent) => void): () => void {
  historyGroupListeners.add(listener);
  return () => historyGroupListeners.delete(listener);
}
const emitHistoryGroup = (e: HistoryGroupEvent): void => {
  for (const l of [...historyGroupListeners]) l(e);
};

/**
 * Rewrite region assignments against the post-edit geometry, so the paint
 * choices track their regions through the edit. `prev` supplies the pre-edit
 * geometry (a live state or a history-group snapshot). Cheap gates first:
 * no assignments, untouched geometry fields, or an unchanged geometry sig
 * (renames, presentation edits) all skip the clipper work entirely.
 */
function applyRegionReconcile<T extends MapDoc>(prev: GeometrySlice, next: T): T {
  const assignments = next.regionAssignments;
  if (!Object.keys(assignments).length) return next;
  if (prev.stations === next.stations && prev.lines === next.lines) {
    return next;
  }
  const oldGeom: GeometrySlice = {
    stations: prev.stations,
    lines: prev.lines,
    lineCircles: prev.lineCircles,
  };
  const newGeom: GeometrySlice = {
    stations: next.stations,
    lines: next.lines,
    lineCircles: next.lineCircles,
  };
  if (regionGeometrySig(oldGeom) === regionGeometrySig(newGeom)) return next;
  const reconciled = reconcileRegionAssignments(oldGeom, newGeom, assignments, () =>
    ids.regionAssignmentId(),
  );
  return reconciled === assignments ? next : { ...next, regionAssignments: reconciled };
}

/**
 * Compose the region reconcile into a geometry-writing action's updater.
 * Inside a history group it is a deliberate no-op — streamed writes (drags,
 * slider ticks, nudge fan-outs) defer to the single reconcile in the group's
 * commit; ungrouped one-shots (wheel ticks, sidebar deletes, edge toggles)
 * reconcile inline so their one undo entry stays self-consistent.
 */
function withRegionReconcile<T extends MapDoc>(updater: (s: DocState) => T): (s: DocState) => T {
  return (s) => {
    const next = updater(s);
    if ((next as MapDoc) === (s as MapDoc)) return next;
    if (isHistoryGrouping()) return next;
    return applyRegionReconcile(s, next);
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
 * no changes occurred but explicit at the call site. `rollback()` goes
 * further: it RESTORES the captured pre-action snapshot before resuming, so a
 * gesture that already wrote to the doc (a live drag, a fine-mode offset edit)
 * is fully reverted, leaving neither a history entry nor a lingering mutation.
 * Use it to abort a mid-flight gesture (e.g. a browser pointercancel) — plain
 * cancel() would resume recording but strand the half-applied writes.
 *
 * Groups do NOT nest: callers that may run inside an already-open group (e.g.
 * a mirror broadcast fired from a focused numeric field's edit arc) must gate
 * on `isHistoryGrouping()` and skip opening their own group — the outer group
 * already collapses their writes into its single entry.
 *
 * Groups CAN overlap without nesting, though: two independent gestures own
 * their own begin/end pairs, and pointer order is pointerdown → blur, so
 * pressing a canvas drag handle opens the drag's group BEFORE a focused
 * field's blur-commit lands. The newer gesture steals: begin seals any
 * still-open group (committing it exactly as its own end would), and the
 * elder's late commit/cancel/rollback is a no-op via its `done` flag. Without
 * the steal, the elder's late commit would resume recording inside the newer
 * group — every write then records its own entry plus a stray snapshot on
 * top, leaving undo non-monotonic.
 */
export function beginHistoryGroup(opts?: {
  /**
   * Trailing-debounce the localStorage write for this group's write stream
   * (see the persistence block above). Pass it from POINTER-DRIVEN per-frame
   * streams — the canvas drag hooks — where a full-doc stringify per move is
   * real money. Focus-scoped groups (numeric fields, the color picker, name
   * editors) must NOT defer: their writes come at typing cadence, and the
   * group stays open as long as focus does, so deferral would leave storage
   * arbitrarily stale behind a discrete, observable edit.
   */
  deferPersist?: boolean;
}): {
  commit: () => void;
  cancel: () => void;
  rollback: () => void;
} {
  // Seal any still-open group (see the overlap contract above). Also the
  // self-heal for LEAKED groups — a gesture that died without ending leaves
  // recording paused only until the next begin, which recovers its edits as a
  // real entry. openHistoryGroup is a last-writer-wins reference, never a
  // depth counter, so a leak can strand at most one group and never corrupts
  // later pairings.
  openHistoryGroup?.commit();

  const snapshot = pickDocSnapshot(useDoc.getState());
  pauseHistory();
  openGroupDefersPersist = opts?.deferPersist ?? false;
  let done = false;
  // Shared first step of every ender: run once, and release ownership only if
  // this group still holds it (a stolen group must not null out its stealer).
  const finish = (): boolean => {
    if (done) return false;
    done = true;
    if (openHistoryGroup === group) {
      openHistoryGroup = null;
      openGroupDefersPersist = false;
    }
    return true;
  };
  const group = {
    commit: () => {
      if (!finish()) return;
      try {
        // Region reconcile fold-in: recording is still paused here, so the
        // assignment rewrite lands inside this group's single history entry.
        // The snapshot is the pre-group doc — exactly the "old geometry".
        const live = useDoc.getState();
        const reconciled = applyRegionReconcile(snapshot, live);
        if (reconciled !== live) {
          useDoc.setState({ regionAssignments: reconciled.regionAssignments });
        }
        resumeHistory();
        const cur = pickDocSnapshot(useDoc.getState());
        // Reference-equality check across every tracked doc field. Transforms
        // produce new objects only when something changes, so this is sound.
        if (docSnapshotsEqual(cur, snapshot)) return;
        // One entry covering the whole group; the adapter owns the zundo shape.
        pushHistory(snapshot);
        // Persist-debounce flush point: the gesture's result is durable at
        // pointerup — one storage write per gesture instead of per frame. (A
        // net-no-change gesture returns above without flushing; its pending
        // write, if any, equals what a flush would produce and trails in.)
        flushDocPersist();
      } finally {
        // After the reconcile, so an `end` listener resyncing external state
        // sees the post-commit doc, assignments included.
        emitHistoryGroup({ kind: 'end' });
      }
    },
    cancel: () => {
      if (!finish()) return;
      resumeHistory();
      emitHistoryGroup({ kind: 'end' });
    },
    rollback: () => {
      if (!finish()) return;
      try {
        // Restore the pre-group doc, then resume WITHOUT pushing. Still paused
        // here, so the restore itself records nothing (mirrors how zundo's own
        // undo reapplies a partialized snapshot). Skip the write when nothing
        // changed — a gesture that only drew overlays leaves the doc untouched.
        const cur = pickDocSnapshot(useDoc.getState());
        if (!docSnapshotsEqual(cur, snapshot)) useDoc.setState(snapshot);
        resumeHistory();
      } finally {
        emitHistoryGroup({ kind: 'end' });
      }
    },
  };
  openHistoryGroup = group;
  emitHistoryGroup({ kind: 'begin', deferPersist: openGroupDefersPersist });
  return group;
}

/**
 * Cancel append-to-line mode. "Add → Line" commits an empty placeholder line
 * eagerly so the inspector and banner can preview its color/service letter;
 * the placeholder is garbage-collected by the mode-exit subscription below,
 * so this is just the named mode-exit entry point (Esc, right-click,
 * canvas-background click).
 */
export function cancelAppendMode(): void {
  useSelection.getState().setAppending(null);
}

// The line "Add → Line" committed eagerly, still awaiting its first stop — the
// ONLY line the GC below may collect. Placeholder-ness is a fact about how a
// line came into being, so it is marked at the creation site rather than
// inferred from the doc: an empty `stations[]` looks the same whether the line
// was never used or was emptied on purpose, and toggleEdgeOnLine empties a
// two-station line whenever its only edge goes (it drops endpoints that fall to
// degree 0). Held here rather than on the appending-to-line UiMode payload,
// which is constructed and compared in a dozen places that have no opinion
// about this.
let pendingPlaceholderLineId: LineId | null = null;

// The placeholder stops being one the instant it holds a station: from then on
// it is a line the user built, and emptying it again must not hand it back to
// the GC. Costs one null compare per doc write, and the marker is non-null only
// between Add → Line and that mode's first exit.
useDoc.subscribe((s) => {
  const id = pendingPlaceholderLineId;
  if (id !== null && (s.lines[id]?.stations.length ?? 0) > 0) pendingPlaceholderLineId = null;
});

/**
 * Add → Line: commit the placeholder and open Edit Stops on it. The whole
 * placeholder lifecycle lives in this module — created here, collected by the
 * mode-exit subscription below — so the ordering the lineCounter rollback
 * depends on can't drift away from the GC that relies on it.
 */
export function startNewLineAppend(): LineId {
  const sel = useSelection.getState();
  // Exit any active Edit Stops FIRST: the GC rolls lineCounter back, which is
  // only sound while the placeholder it collects is still the last-added line.
  sel.setAppending(null);
  const id = useDoc.getState().addLine();
  pendingPlaceholderLineId = id;
  sel.startAppend(id);
  return id;
}

// GC a still-empty append placeholder. The placeholder was committed eagerly
// by addLine, which also advanced lineCounter to pick its color; discarding it
// must undo BOTH in one atomic set, so repeated Add→Esc doesn't walk the color
// cycle forward. (Real line deletion via T.deleteLine leaves lineCounter
// alone, which is why the rollback lives here.) The rollback is only sound
// while the placeholder is the last-added line, which is exactly what the
// creation-site marker guarantees — startNewLineAppend exits any active append
// before creating the next line.
function collectAppendPlaceholder(lineId: LineId): void {
  if (lineId !== pendingPlaceholderLineId) return;
  // One shot: whatever happens below, this line has now had its exit, and a
  // later visit to Edit Stops must find an ordinary line.
  pendingPlaceholderLineId = null;
  const line = useDoc.getState().lines[lineId];
  if (!line || line.stations.length !== 0) return;
  useDoc.setState((s) => ({
    ...T.deleteLine(s, lineId),
    lineCounter: Math.max(0, s.lineCounter - 1),
  }));
}

// The GC must run on EVERY exit from appending-to-line — not just the
// Esc/background-click paths that call cancelAppendMode. The T/L shortcuts,
// toolbar mode toggles, and item-click exits all flip the mode directly, which
// used to leak the station-less placeholder into the doc (ghost sidebar row,
// serialized into saves, lineCounter left advanced). Watching the transition
// makes the GC unconditional; switching straight from one append to another
// (a foreign-stripe click) collects the elder placeholder too. Re-entrancy is
// impossible: the GC writes only the doc store, never selection.
useSelection.subscribe((sel, prev) => {
  const was = prev.uiMode;
  if (was.kind !== 'appending-to-line') return;
  const is = sel.uiMode;
  if (is.kind === 'appending-to-line' && is.lineId === was.lineId) return;
  collectAppendPlaceholder(was.lineId);
});

// ----- Drag-vs-click suppression (module-level, not persisted) -----
export const dragState = { suppressClick: false };

// Selection state lives in its own store (./selection); re-exported here so
// existing imports from this module keep working unchanged.
export { useSelection };
export {
  RIGHT_CLICK_PASSTHROUGH_MODES,
  soleSelection,
  getCopyableSelection,
  type SoleSelection,
  type UiMode,
  type LineTagHoverPreview,
  type SidebarTab,
} from './selection';
