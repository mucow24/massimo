# Massimo — Architecture

> A fast-bootstrap reference for understanding the codebase: the ins, outs, gotchas, and
> caveats. Written for an AI assistant (or new contributor) who needs the full picture
> quickly. Read the **TL;DR** and **Core mental model** first; treat the rest as reference.

---

## What this is

**Massimo** is a single-user, browser-based **Vignelli-style transit-map editor** — you draw
metro/subway maps in the visual language of Massimo Vignelli's 1972 NYC subway diagram:
octolinear (45°-step) colored line "stripes", interlined into parallel bands, with circular
stop dots, route bullets, and crisp Helvetica Neue labels. It renders entirely to **SVG**,
runs fully client-side (no backend), and persists to `localStorage`. It is alpha software with
essentially one user (the developer).

Stack: **React 18 + TypeScript + Vite**, **Zustand** for state, **zundo** for undo/redo,
**Vitest** (jsdom) for unit tests, **Playwright** for e2e. No UI framework beyond React +
hand-rolled CSS; `@radix-ui/react-icons` is the only UI dependency.

---

## TL;DR — the 60-second orientation

- **One document, `MapDoc`** ([src/model/types.ts](src/model/types.ts)), is the entire saved
  state: keyed record collections (`stations`, `lines`, `polygons`, …) plus z-order arrays and
  global style fields. Everything else (selection, camera, prefs) lives **outside** the doc and
  is neither undoable nor saved-per-file.
- **Three layers, strict separation:**
  1. **`src/model/`** — pure domain logic. Types + immutable transforms `(doc, …args) → doc`.
     Never imports React or the store.
  2. **`src/geometry/`** — pure math. Routing, interlining, snapping, label layout, text
     measurement. Never imports React, the store, or the model's *store* (it does share some
     model types). Works entirely in **world coordinates**.
  3. **`src/state/`** + **`src/components/`** — Zustand stores wrap the transforms as actions;
     React components render the doc to SVG and dispatch actions.
- **Editing = pure transforms.** Store actions are thin wrappers: `set((s) => T.moveStation(s, …))`.
  Transforms return the **same object reference on no-op** — this is load-bearing for undo
  grouping. ([src/model/transforms.ts](src/model/transforms.ts) is the ~2000-line heart.)
- **The Vignelli look comes from "interlining"** ([src/geometry/interlining.ts](src/geometry/interlining.ts)):
  multiple lines sharing a station-pair corridor are merged into mean-centered parallel stripes.
  This is the single most intricate algorithm in the repo and is pinned by a **byte-exact golden
  snapshot**.
- **Performance spine:** pan/zoom writes the SVG `viewBox` **imperatively and synchronously**
  (not via React, not via rAF) so the ~2,700-node SVG tree is never re-rendered mid-gesture.
- **Persistence has two load paths that must stay in sync:** `parse()` (file import) and
  `migrateDoc()` (localStorage rehydration). There is **no `normalizeDoc()`** — absent fields
  fill from `DEFAULT_DOC`; legacy fixups are shared exported "backfill"/"sanitize" functions
  called by both paths.
- **CI gate:** `npm run pre-pr` = `format → lint → format:check → test → build`. It does **not**
  run Playwright, so migration/rehydration bugs only surface in e2e.

---

## Tech stack & commands

| Concern | Choice |
|---|---|
| Build/dev | Vite 5 ([vite.config.ts](vite.config.ts)) |
| Language | TypeScript 5.6, `strict` ([tsconfig.json](tsconfig.json)) |
| UI | React 18 (StrictMode) |
| State | Zustand 4 |
| Undo/redo | zundo 2 (`temporal` middleware) |
| Unit tests | Vitest 4 + jsdom ([vitest.config.ts](vitest.config.ts)) |
| Property tests | fast-check 4 (model/geometry only) |
| E2E | Playwright ([playwright.config.ts](playwright.config.ts)) |
| Lint/format | ESLint 9 flat config ([eslint.config.js](eslint.config.js)) + Prettier |
| Icons | `@radix-ui/react-icons` |

Scripts ([package.json](package.json)):

```
npm run dev          # vite dev server
npm run build        # tsc -b && vite build
npm test             # vitest run (unit, jsdom)
npm run e2e          # playwright test (drives the dev server)
npm run pre-pr       # format → lint → format:check → test → build  (the PR gate)
```

`pre-pr` runs `format` (prettier --write, auto-fixes) **first** so formatting can't block, then
`format:check` later is the actual gate. **`pre-pr` does NOT run e2e** — rehydration/migration
is only covered by Playwright.

---

## Repository layout

```
index.html                      # Vite entry; loads Inter (Google Fonts), mounts /src/main.tsx
src/
  main.tsx                      # ReactDOM root, imports styles.css
  App.tsx                       # 3-pane shell + ALL global keyboard/contextmenu/blur wiring
  styles.css                    # 16 @font-face (Helvetica Neue) + .app CSS grid + dark mode

  model/                        # PURE domain logic — no React, no store
    types.ts                    # MapDoc + every entity type (the canonical data shape)
    transforms.ts               # ~2000 lines: all (doc,…)→doc editing ops + DEFAULT_DOC + constants
    serialize.ts                # serialize()/parse() + shared backfill/sanitize helpers
    ids.ts                      # IdFactory: crypto UUIDs (prod) / counter ids (tests)
    pairKey.ts                  # pairKeyOf(a,b): canonical station-pair key
    recordOrder.ts              # reconcileOrder/moveInOrder: shared z-order algebra
    palettes.ts                 # built-in PALETTES + resolution; PaletteId = open string
    customPalette.ts            # parse imported palette JSON; makeCustomPaletteId
    dotStyle.ts dotSize.ts      # procedural stop-dot style + size resolution
    lineWidth.ts lineStroke.ts  # stripe width (GEOMETRY) + casing rails (PRESENTATION)
    lineOrder.ts layerPriority.ts  # z-order reconcile + per-segment layer math
    matching.ts pathSelect.ts   # interlining-group matching + shortest-path selection
    autoOrient.ts               # rotate a just-added station to the line tangent
    clipboard.ts                # ClipPayload union + read/write + SVG-href security guard
    svgImport.ts                # parse external .svg → intrinsic size + data URI

  geometry/                     # PURE math — world coordinates, no React/store
    vec.ts orientation.ts       # vector primitives; rotation/local↔world; STOP_SIZE=14
    router.ts                   # octolinear path solver + arc fillets + offset paths
    interlining.ts              # THE band algorithm: merge lines into parallel stripes
    snap.ts                     # the snap engine (line/equidistant/tens/all/grid modes)
    lattice.ts                  # stop-placement lattice (orthogonal/diagonal)
    stationBoundary.ts          # selection silhouette + marquee hit rects
    stripeOutline.ts            # per-stripe edge/cap geometry (stroke-before-fill dots)
    polygon.ts polygonSnap.ts polygonUnion.ts rectPolygon.ts  # polygon geom + union + hit test
    labelTokens.ts textMeasure.ts labelLayout.ts  # name → tokens → measured → placed
    layerLabelPlacement.ts      # where to put a stripe's layer-number label
    lineTagGeometry.ts          # offset-path arc-length sampling for in-band tags
    svgImage.ts                 # svg-image corners/resize/rotate/snap geometry

  state/                        # Zustand stores (6 of them) + history
    store.ts                    # useDoc: temporal(persist(...)) + ~95 actions + migrateDoc
    history.ts                  # the ONLY module touching zundo internals
    selection.ts                # useSelection: UiMode union + multi-select + reconcileWithDoc
    viewportStore.ts            # useViewportStore (committed) + useLiveViewportStore (in-flight)
    theme.ts                    # themeColors(darkMode) table (no store; reads viewportStore)
    customPalettes.ts           # useCustomPalettes: imported palettes (global localStorage)
    snapPrefs.ts                # useSnapPrefs: snap toggles (+ v0→v1 migration)
    stationNames.ts             # random station-name word lists

  components/                   # React + SVG rendering and UI chrome
    MapCanvas.tsx               # the canvas hub: paint order + all pointer wiring
    Station*/Stop*/Label*/...   # per-entity SVG views (see Rendering section)
    Toolbar.tsx Sidebar.tsx Menu.tsx  # chrome
    *Popover.tsx                # on-canvas item editors
    canvas/                     # interaction layer: drag/placement/viewport hooks + overlay layers
    inspector/                  # sidebar inspectors + stopGridDrag.ts (pure lattice-edit math)

  export/                       # exportCanvas.ts (SVG/PNG), exportCanvasPdf.ts + pdfHatch.ts (vector PDF), fonts.ts
  util/                         # color.ts (hex math)
  test/                         # fixtures, jsdom setup, integration tests
e2e/                            # Playwright specs + seedAndOpen harness
public/fonts/                   # 16 Helvetica Neue .ttf faces
```

---

## Core mental model — the big ideas

Internalize these six and the rest of the codebase reads cleanly.

### 1. The document is everything saveable; nothing else is

`MapDoc` is the **only** thing that is undoable and persisted-per-file. Selection, camera
(viewport), grid size, dark mode, snap prefs, and custom-palette **definitions** all live in
**separate Zustand stores** and are explicitly excluded from history and from saved files. A
saved `.massimo.json` is camera-agnostic and selection-agnostic.

The exact set of persisted/undoable fields is the hand-maintained `DOC_FIELDS` tuple in
[src/state/store.ts](src/state/store.ts) — the single source of truth that drives `partialize`
(both persist and zundo), `DocSnapshot`, `pickDocSnapshot`, and the change-detection equality
check. **Adding a doc field is a one-line edit there** (plus adding it to `DEFAULT_DOC`).

### 2. Purity, and "same reference on no-op"

Every model transform and every geometry function is pure. Transforms have the shape
`(doc, …args) → doc` and **return the input `doc` (same reference) when nothing changed**. This
is not a micro-optimization — it is the foundation of undo grouping:

- zundo's `temporal` has **no diffing by default**. The store sets a freshly-allocated snapshot
  on every action. Without a guard, a no-op action would push a redundant history entry, making
  one Ctrl+Z appear to do nothing.
- The guard is `equality: docSnapshotsEqual`, a **reference-equality** comparison over each
  `DOC_FIELDS` key. It is sound *only because* transforms allocate new objects exclusively when
  something actually changed. A transform that mutates in place would silently break undo.

### 3. Coordinate systems (memorize this table)

| Quantity | Frame |
|---|---|
| `Station.x/y`, `Polygon.vertices`, `SvgImage.x/y`, `TextLabel.x/y`, `RouteBullet.x/y` | **World** (SVG user units) |
| `StopCell.row/col`, `LabelCell.row/col` | **Station-local grid cells** (unrotated; pitch = `STOP_SIZE` = 14) |
| `LabelCell.offset/offsetPerp` | **Pixels in unrotated-station-local space** |
| Snap guides, viewBox, redistribute, curveRadius, line width/stroke, transfer thickness | **World** |
| Drag thresholds (`DRAG_MOVE_THRESHOLD=4`), pointer start coords | **Screen pixels** |
| Snap engage radius (`SNAP_PERP_TOLERANCE=10`, **world units at zoom 1**) | Call sites pass `/zoom`, so the *effective* radius is constant in screen px (the world tolerance shrinks as you zoom in) |
| Grid snap | **Hard world constraint** — unaffected by zoom |

Screen y is **down** everywhere. `vec.leftNormal((x,y)) = (y,-x)` is "left of travel" in the
y-down frame and is what the router/interlining use; `vec.perp((x,y)) = (-y,x)` is the math
y-up convention and is **intentionally the negation** — using the wrong one flips stripe order.
1 lattice cell = `STOP_SIZE` = **14** world units.

### 4. Two rotation conventions (don't conflate them)

- **8-step octant** `Rotation = 0..7` (×45° clockwise) for **stations, labels, route bullets,
  text labels**. `r+1` = 45° CW.
- **Continuous degrees** for **`SvgImage.rotation` only** — a deliberate exception, because svg
  images snap to **22.5°** (half an octant) under Shift. A round-trip test pins that `247.5°`
  survives serialization verbatim; do not "normalize" it to an octant.

### 5. Two opposite z-order conventions (don't conflate them either)

- **Lines:** `MapDoc.lineOrder`, **index 0 = top** (Photoshop-layers convention).
- **Polygons / svg images:** `polygonOrder` / `svgImageOrder`, **later in array = top** (painted
  later). Ids missing from these arrays fall back to insertion order and render **on top** (via
  `effectivePolygonOrder` / `effectiveSvgImageOrder`), so an add/order race never drops an item.

Correspondingly `addLine` prepends (`[id, ...order]`, front), but `addPolygon`/`addSvgImage`
append (back of array = front by the opposite convention).

### 6. The rendering pipeline is a fixed, interleaved z-order of passes

[MapCanvas.tsx](src/components/MapCanvas.tsx) instantiates `StationView` **once per pass** with
a different `layer` prop and interleaves those passes with bands, markers, transfers, and
overlays in one fixed paint order (detailed in [Rendering](#rendering-pipeline)). Two motifs
recur: **stroke-before-fill** (all dot silhouettes drawn before all dot bodies, so overlapping
dots share one continuous outer border) and **flat passes** (all transfer halos before all
transfer bodies, so overlapping transfers trace one union outline).

---

## The domain model

All types in [src/model/types.ts](src/model/types.ts). This is the reference heart — when in
doubt, read that file; its doc-comments are extensive and authoritative.

### `MapDoc` — the document

```ts
interface MapDoc {
  name: string;                    // editable map title — drives toolbar/window title + save/export filename
  stations: Record<StationId, Station>;
  lines: Record<LineId, Line>;
  lineOrder: LineId[];              // index 0 = TOP
  curveRadius: number;             // global corner radius, world units (default 24)
  lineCounter: number;             // monotonic; advanced per addLine; drives palette color cycle
  lineTags: Record<string, LineTag>;
  routeBullets: Record<string, RouteBullet>;
  transfers: Record<string, Transfer>;
  textLabels: Record<string, TextLabel>;
  polygons: Record<string, Polygon>;
  polygonOrder: string[];          // LATER = top (opposite of lineOrder)
  svgImages: Record<string, SvgImage>;
  svgImageOrder: string[];         // LATER = top
  labelFontSize: number;           // global station-name styling
  labelWeight: TextLabelWeight;
  labelItalic: boolean;
  activePalettes: PaletteId[];     // INVARIANT: never empty
  transferThickness: number; transferColor: string;       // global transfer styling
  transferStrokeWidth: number; transferStrokeColor: string;  // optional halo (0 = none)
}
```

`DEFAULT_DOC` (in [transforms.ts](src/model/transforms.ts)) is the merge baseline: empty
collections, `name: 'Untitled map'`, `curveRadius: 24`, `lineCounter: 0`, `activePalettes:
['mta']`, `labelItalic: false`, transfer defaults from named constants.

### Entities (field-level)

**`Station`** — `id, name, x, y` (world center), `rotation: Rotation`, `stops: StopCell[]`,
`label: LabelCell`. Optional flags, **omitted when false/default** to keep saves clean:
- `isWaypoint?` — a "routing point": hide name + all bullet glyphs + drop the label hit rect;
  the station stays selectable/draggable via its stop-cell hit rect. Per-stop styles are **not**
  mutated when this toggles.
- `labelBold?` — bump rendered weight **two steps** heavier along the weight table (clamped at
  900).
- `labelItalic?` — OR'd with the doc-global `labelItalic`.
- `locked?` — **canvas-protection only**: can't be dragged, marquee-selected, group-towed,
  nudged, or deleted; **can** still be click-selected and is **fully editable in the inspector**
  (the inspector is never disabled). This `locked` semantics is mirrored by Polygon, RouteBullet,
  TextLabel, SvgImage.

**`StopCell`** — one line's stop on a station. `lineId, row, col` (station-local grid;
**`row`/`col` are floats now**, since diagonal moves use ±√2/2 — equality uses `CELL_EPS=1e-4`),
`orientation: StopOrientation`. Optional, **dropped when equal to the line's effective default**:
`dotStyle?: DotStyle`, `dotSize?: number` (dot **diameter** in px).

**`LabelCell`** — the station name's grid cell + placement. `row, col, rotation: Rotation`,
`offset` (px forward along reading direction), `offsetPerp?` (cross-axis, default 0 — back-compat
absent), `align: LabelAlign` (`auto|start|middle|end`), `valign: LabelValign`
(`auto-down|top|middle|bottom|auto-up`). `auto-down`/`auto-up` pin the block's top/bottom as a
multi-line label grows; identical to `middle` for single-line.

**`Line`** — `id, service` (the route code shown in bullets), `name, color`, `stations:
StationId[]` (ordered path), `waypoints?`. All other fields optional and **never stored at
default**:
- `segmentStyles?: Record<pairKey, LineStyle>` — per-segment style; missing ⇒ `'solid'`.
- `segmentLayers?: Record<pairKey, number>` — per-segment z-layer; missing ⇒ 0; **uncapped** ±.
- `defaultDotStyle?: DotStyle` — missing ⇒ `DEFAULT_DOT_STYLE` (filled-black).
- `defaultDotSize?: number` — dot diameter px; missing ⇒ `DOT_SIZE_DEFAULT` (= 2×`STOP_DOT_RADIUS` = 8).
- `width?: number` — **stripe width, GEOMETRY**; missing ⇒ `LINE_WIDTH_DEFAULT` (= `STOP_SIZE` =
  14); integer ≥ `LINE_WIDTH_MIN` (1). Drives stop-cell tangency, band merging, stripe offsets.
- `strokeWidth?: number` — **casing rail, PRESENTATION**; centered on the body edges (half in /
  half out), missing ⇒ 0; rounded to a 0.5 grid. Resolved live; never moves paths.
- `strokeColor?: string` — casing color; missing ⇒ `'#ffffff'`; lowercased.

> **Width is GEOMETRY, stroke is PRESENTATION.** A `width` edit rebuilds band geometry; a
> `strokeWidth`/`strokeColor`/color/style edit is resolved at render time and never rebuilds.
> This split is exploited by the band-geometry memo (see Interaction layer).

**`DotStyle`** ([dotStyle.ts](src/model/dotStyle.ts)) — a procedural stop dot. **All fields
required** (a deliberate divergence from the optional-field convention) so plain deep equality
`dotStylesEqual` works everywhere: `shape: DotBaseShape` (`circle|square|diamond|x`), `fill:
DotFill` (`DayNightColor | 'line' | 'none'`), `strokeWidth` (0 = no stroke), `strokeColor:
DotStrokeColor` (`DayNightColor | 'line'`; **no `'none'`** — strokeWidth 0 expresses "no
stroke"), `showServiceCode`. **Size is deliberately NOT part of style** — it is the orthogonal
`dotSize`/`defaultDotSize` pair, so picking a shape preset never clobbers a size. `DayNightColor
= {day, night}` resolves per theme. The clean-persisted convention lives one level up: in the
*presence/absence* of `StopCell.dotStyle` and `Line.defaultDotStyle`.

**`LineTag`** — a movable label printed inside a line's color band. Anchored to a **station-pair
corridor**, not a segment index, so it survives line reordering. `id, lineId, fromStationId,
toStationId` (**invariant: `from < to`**, canonical/alphabetic, matching `pairKeyOf`),
`anchorEnd: 'from'|'to'`, `distance` (arc length in world units from the anchor along the stripe),
`orientation: 0|1|2|3` (line-traversal frame), `kind?: 'text'|'chevron'` (undefined ⇒ text).
Right-click cycles all six states: text up→right→down→left → chevron-forward → chevron-reverse.

**`Polygon`** — a free-floating background shape (river, park…), rendered **under all other map
content**. `id, vertices: Vec2[]` (**world coords, ≥3, ordered; there is no center/rotation
field — rotation rewrites the vertices** around the centroid), `fill, stroke` (`#rrggbb`),
`strokeWidth` (world units, floored at 0 — the slider caps at 10, but the spinbutton/stored
value is unbounded above), `darkFill, darkStroke` (independent dark-mode colors,
**backfilled to equal the light colors** on load for legacy saves). Optional: `fillOpacity?`
(genuinely clamped 0–100, missing ⇒ 100), `locked?`, `curveRadius?` (floored at 0, slider caps at
50, stored value unbounded above; missing ⇒ 0 = sharp), `closed?` (missing
⇒ true; false = **open** chain: stroke-only, no fill, hit-test follows the stroke).
`PolygonStylePatch` is the shared `Partial<Pick<…>>` used by both the transform and the store
action so they never drift.

**`SvgImage`** — an imported `.svg` placed as an **opaque** `<image href="data:image/svg+xml;
base64,…">` in the polygon band. `id, x, y` (world **center**), `width, height` (unrotated bbox,
post-scale), `rotation: number` (**continuous degrees CW**, snaps to 22.5° under Shift), `href`
(fixed at import, never edited), `locked?`. `SvgImageStylePatch` is the shared patch type.

**`TextLabel`** — a free-floating, rotatable text annotation rendered **on top** of the map.
`id, x, y` (center), `rotation: Rotation`, `text` (multiline `\n`), `fontSize` (floored at
`TEXT_LABEL_FONT_SIZE_MIN`, snapped to a 0.5 step — the slider caps at 96, but the
spinbutton/stored value is unbounded above and may be a half-integer),
`weight: TextLabelWeight`, `italic`, `align: TextLabelAlign` (`left|center|right|justify`;
`justify` flushes both edges), `width?` (column width in world units; `0`/absent = Auto —
sizes to content and honors manual `\n`; `>0` = a fixed-width column that word-wraps, with
`\n` a hard break; clamped to a non-negative integer by `updateTextLabel`), `color/
darkColor` (day/night; **defaults DIFFER**: `#111111` / `#ffffff` for legibility — unlike a
polygon whose dark default equals its light; backfilled on load), `locked?`.

**`RouteBullet`** — a free-floating route badge showing one line's service code in its color.
`id, x, y, rotation: Rotation, lineId: LineId | null` (null = unset placeholder), `shape:
RouteBulletShape` (`circle|square|diamond`), `size` (half-extent), `locked?`.

**`Transfer`** + **`TransferEnd`** — a thin black line connecting one station dot to another.
`Transfer = {id, a: TransferEnd, b: TransferEnd}`; `TransferEnd = {stationId, lineId: LineId |
null}` (lineId picks *which* dot at an interlined station; null ⇒ station anchor). **Cascade-
deleted** when either endpoint's stop is removed (by deleting the station/line or removing that
line's stop). Global styling (thickness, color, optional halo) lives on `MapDoc`.

**Small unions:** `StopOrientation` (`auto-vertical|auto-ne-sw|auto-horizontal|auto-nw-se` —
pins only the **axis**; the sign falls out of the world tangent from neighbors), `LineStyle`
(`solid|dashed|hatched|hatched-mirror|dotted|dashed-open`), `TextLabelWeight`
(`100|200|300|400|500|700|800|900` — **no 600**, no SemiBold face shipped), `DotShape` (13 legacy
preset ids — **no longer stored**, only the currency of shape pickers and legacy conversion).

---

## Serialization, persistence & migration

Files: [serialize.ts](src/model/serialize.ts), [store.ts](src/state/store.ts) (`migrateDoc`).

### The governing strategy: defaulting-by-merge, NOT normalization

There is **no `normalizeDoc()`**. Absent fields fill from `DEFAULT_DOC`. The small number of
value-level fixups are **shared exported functions** — `sanitizeStations`, `backfillLineNames`,
`backfillPolygonDarkColors`, `backfillTextLabelColors`, `convertLegacyDotShapes`,
`sanitizeStopDotSizes`, `validActivePalettes` — each returning `{...cleaned, changed}`, where the
**`changed` flag is the signal** callers use (`migrateDoc` re-spreads a field only when `changed` is
true). The dict-level backfills allocate a fresh container even on a no-op, so don't rely on their
reference identity (the per-line / per-dot sanitizers *do* return the same element ref when
unchanged — distinct from the transform "same-reference-on-no-op" invariant). They are called by
**both** load paths.

### Two load paths (keep them in sync)

**Path A — file import: `parse(json, custom)`** ([serialize.ts](src/model/serialize.ts)). Used
by the **Load…** menu. Pure, returns `{ok, doc}` or `{ok:false, error}`:
1. `JSON.parse`; reject non-object / `format !== 'massimo-map'` / missing `doc`.
2. `migrateLegacyLabelBold` **before** the merge (so `labelBold` never leaks into the typed shape).
3. `merged = { ...DEFAULT_DOC, ...doc }` — the entire defaulting mechanism.
4. `validActivePalettes` (enforce ≥1 valid palette).
5. Per-line clean (clamp width/dotSize/stroke, drop never-stored defaults, drop segment keys that
   aren't real adjacencies) + `backfillLineNames`.
6. `sanitizeStations` (legacy orientations + `valign:'auto'`→`'auto-down'`).
7. `convertLegacyDotShapes` (preset ids → `DotStyle`) — **runs after** the line/station passes.
8. `sanitizeStopDotSizes` — **must run after** the per-line pass (a stop compares against the
   *sanitized* line default).
9. `backfillPolygonDarkColors`, `backfillTextLabelColors`.

Path A does **more** than Path B because hand-edited files can be non-canonical (the file-only
sanitizers `sanitizeLineWidth/Stroke/DotSize/Segments/StopDotSizes` exist for this).

**Path B — localStorage rehydration: `migrateDoc(persisted, version)`** ([store.ts](src/state/store.ts)).
The zustand `persist` config: `name: 'vignelli-map-doc-v1'`, `version: 7`, `migrate:
migrateDoc`, `partialize: pickDocSnapshot`. Because the persist-merge already fills absent fields
from the initial state, `migrateDoc` only does **value-level legacy fixups, version-gated**, on
disjoint fields (order immaterial), never mutating the input:

| Gate | Fixup |
|---|---|
| `v<1` | `backfillLineNames` (`"${service} line"`) |
| `v<3` | `labelBold:boolean` → `labelWeight` (700/400; explicit weight wins) |
| `v<4` | `sanitizeStations` (legacy stop orientations; `valign:'auto'`→`'auto-down'` — both fold into one runtime gate) |
| `v<5` | `backfillPolygonDarkColors` |
| `v<6` | `backfillTextLabelColors` |
| `v<7` | `convertLegacyDotShapes` (preset ids → procedural `DotStyle`) |
| (not gated) | `validActivePalettes` whenever `activePalettes !== undefined` |

A **corrupt/missing version is treated as v0** (all migrations run). The `validActivePalettes`
repair is **not** tied to a schema bump — it runs any time the field is present (an absent field
is left for the persist-merge). It reads `useCustomPalettes.getState().palettes` to validate
custom ids.

> **Do not "simplify" the two paths into one.** `storeMigrate.test.ts` pins reference-equality
> pass-through for already-canonical docs (`expect(out).toBe(input)`); adding a file-only width
> sanitizer to `migrateDoc` would break that. They share helper *functions*, not call sequences.

### Save / startup

- **Save** = `serialize(pickDocSnapshot(state))` → `${basename}.massimo.json`. `serialize` does
  **no** sanitization (writers are canonical by construction; transforms maintain canonical form
  on every set).
- **Startup**: no explicit load in `App.tsx` — zustand `persist` rehydrates from localStorage on
  boot, running `migrateDoc`.
- **Manual Load…**: `parse(text, customPalettes)` then `useDoc.setState({ ...DEFAULT_DOC,
  ...doc })` and `temporal.clear()` (wipe history).
- File basename: `${sanitizedName} - YYYY-MM-DD` (e.g. `My Subway Map - 2026-07-01`), shared by
  save + export via `mapFileBasename` ([exportCanvas.ts](src/export/exportCanvas.ts)). The map
  name leads so successive saves group together; it falls back to the literal `map` only when the
  name is empty or all-illegal after stripping filename-hostile characters.

### IDs

[ids.ts](src/model/ids.ts): production uses `defaultIdFactory()` → **crypto UUIDs**
(`crypto.randomUUID()`, 36-char). Tests use `counterIdFactory(seed)` → deterministic `s0, l0,
…`. (The old `Math.random().slice() + Date.now()` scheme was reworked: it could emit short random
parts and shared one millisecond suffix across kinds.)

---

## State management

Six Zustand stores, split deliberately by lifecycle (`useDoc`, `useSelection`, `useViewportStore`
+ `useLiveViewportStore`, `useSnapPrefs`, `useCustomPalettes`). Files in [src/state/](src/state/).

### `useDoc` — the document store ([store.ts](src/state/store.ts))

`create<DocState>()(temporal(persist((set, get) => ({...DEFAULT_DOC, ...actions}), persistCfg),
temporalCfg))`. **`temporal` is the outer wrapper, `persist` the inner**; both use the same
`partialize: pickDocSnapshot` over `DOC_FIELDS`. The ~95 actions are thin wrappers delegating to
pure transforms (`import * as T from '../model/transforms'`): `moveStation: (id,x,y) => set((s)
=> T.moveStation(s, id, x, y))`. Adders mint an id from the module-level `ids` factory, call the
transform, and return the id.

`temporalCfg`: `equality: docSnapshotsEqual`, `partialize: pickDocSnapshot`, `limit: 200`.

The mutator method references live on the full state but are **not** in the snapshot; they never
change, so `Object.assign` on undo preserves them.

### Undo/redo ([history.ts](src/state/history.ts))

The **only** module that touches zundo's internals (`pastStates`/`futureStates`). Exposes
`pushHistory`, `pauseHistory`, `resumeHistory`, `undo`, `redo`, `historyDepth`, `redoDepth`.
**`undo`/`redo` also call `useSelection.getState().reconcileWithDoc(...)`** — the selection store
is separate and untouched by zundo, so after an undo restores the doc, dangling selection ids
must be pruned.

**Grouped edits — `beginHistoryGroup()`** ([store.ts](src/state/store.ts)). A drag is many
`moveStation` calls; a text edit is many `onChange`s; a slider drag is many ticks. The pattern:
1. Capture `snapshot = pickDocSnapshot(state)`, `pauseHistory()`.
2. Mutators run freely, no history recorded.
3. `commit()`: `resumeHistory()`, re-snapshot, and **only if changed** push the one captured
   pre-action snapshot — one entry for the whole gesture. A no-op group (focus→blur, click
   without drag) pushes nothing.
4. `cancel()`: resume without pushing. Both are idempotent (`done` flag).

### `useSelection` — ephemeral UI/mode state ([selection.ts](src/state/selection.ts))

Not persisted, not undoable. Two key pieces:

**`UiMode`** — a discriminated union, **exactly one editor mode active at a time**:
`idle | placing-station | creating-line-tag | creating-route-bullet | creating-transfer(anchor)
| placing-label | creating-polygon | placing-svg(image) | appending-to-line(lineId,
insertAfterIndex) | layering`. Entering any non-idle mode wipes all selections. Adding a new mode
is one variant + handlers; its right-click policy is declared in one place,
`RIGHT_CLICK_PASSTHROUGH_MODES` (`{idle, layering}` — modes where right-click does **not** cancel).

**Selection** — **five parallel id-list fields** (multi-select; order meaningful; **last entry =
anchor**): `selectedStationIds` + `selectedRouteBulletIds`/`selectedLabelIds`/`selectedPolygonIds`/
`selectedSvgImageIds`. The four generic lists' `select/toggle/set/add/xor` actions are generated
by one `makeIdListActions` factory (hand-copying them is exactly how a cross-clear matrix drifted
and caused a stale-line-highlight bug). Single primaries: `selectedLineId`, `selectedLineTagId`,
`selectedTransferId`, `selectedStopLineId`, plus `selectedVertex` (independent of the polygon
selection so the polygon stays selected while a vertex handle is active). Selectors:
`soleSelection(s)` (non-null only when total across all five lists === 1) and
`getCopyableSelection(s)` (everything **except stations** — the clipboard has no station payload).

### Viewport: committed vs live ([viewportStore.ts](src/state/viewportStore.ts))

**Two stores, intentionally:**
- `useViewportStore` — the **committed** camera (`x, y, zoom`) + `gridVisible`, `gridSize`
  (`GRID_SIZES = [5,10,20]`, default 10), `darkMode` (default false). **Persisted** as
  `'massimo-viewport'` (per-browser, **not** per-file). The giant SVG tree subscribes here and is
  re-rendered only on commit.
- `useLiveViewportStore` — the **in-flight** gesture viewport (`pending: Viewport | null`).
  **Not persisted, not undoable.** Only the small popover-overlay layer subscribes. Exists solely
  so per-frame pan/zoom writes don't hammer localStorage or re-render the SVG. See the
  [Interaction layer](#canvas-interaction-layer) for how the viewBox is written imperatively.

### Preferences

- [theme.ts](src/state/theme.ts) — `themeColors(darkMode): ThemeColors` (pure table:
  `canvasBg, label, selectionStroke, grid, underlay, editorBg, editorText, phantomDot`; light
  `#fafafa`, dark `#000000`). **No store of its own** — `darkMode` lives in `useViewportStore`.
- [customPalettes.ts](src/state/customPalettes.ts) — `useCustomPalettes`: imported palette
  **definitions** in **global** localStorage (`'massimo-custom-palettes-v1'`), available to every
  map. `addPalette` upserts by exact name (reusing id + position so active state survives reload).
  The split: **definitions are global; the active set (`activePalettes`) is per-map in the doc.**
  Resolution helpers take the custom palettes as an **explicit param** (the pure model never
  reaches into a store); `deleteCustomPalette` is the cross-store coordinator.
- [snapPrefs.ts](src/state/snapPrefs.ts) — `useSnapPrefs`: snap-mode toggles, with a v0→v1
  boolean→enum migration.

---

## The geometry core

All pure, all world-coordinate, all in [src/geometry/](src/geometry/). No React, no store.

### Routing — `router.ts`

`route(start, startDir, end, endDir, R, waypoints?)` quantizes the endpoints' directions to the
nearest of 8 and picks the shortest valid octolinear path among **0-bend / 1-bend / 2-bend Z/U /
3-bend U-turn** candidates, then fillets each interior corner with a circular arc of radius from
`computeArcRadii` (per-edge tangent-budget scaling so adjacent corners never overshoot a short
edge). If any corner turns ≥135° or a post-budget fillet collapses below `R·0.5`, the route is
flagged `warning` and degraded to a straight `M…L…`.

- **The router prefers a chamfered 2-bend Z over a clean L** when the diagonal middle leg is
  shorter — so e.g. east→south can yield a 4-vertex path, not a single corner. (An old test
  asserting "exactly one corner" was a lie; tests accept ≥3 vertices.)
- Path coordinates are formatted with **`toFixed(6)`** — this precision is **load-bearing**:
  lower precision caused a sub-pixel offset between band stroke and stop marker (flickery "hash
  bleed").
- `offsetFilletPath(verts, R, offset)` produces a path offset by a constant perpendicular
  distance (offset 0 is byte-identical to `filletPath`); `emitOffsetSegments` yields the same
  geometry as `OffsetPathSegment[]` (a `line`/`arc` union) — used by both the renderer and the
  line-tag/hit samplers so painted and sampled geometry can never drift.

### Interlining — `interlining.ts` (THE core algorithm)

This produces the Vignelli parallel-stripe look. `buildBandGeometry` (the heart):

1. **Collect** every line's consecutive station-pair as a `SegInfo` keyed by `pairKeyOf(a,b)`
   (canonical), storing canonical cell coords + a world direction hint.
2. **Bucket by axis** (`dirIndex % 4`) — lines traversing the corridor in **opposite** directions
   share an axis and can merge.
3. **Reference frame**: sign-flip so the band flows canonFrom→canonTo (else the router sees a
   U-turn).
4. **Enrich & sort** ascending by perpendicular projection — this assigns low indices to the
   right-of-motion side, matching `stripeOffsetsForWidths` order.
5. **Greedy adjacency merge**: two consecutive segments merge iff they are **exactly tangent** at
   both ends (perp step ≈ `tangentGap(prevW, w)` within `TOL=0.5`) and their parallel positions
   match. Otherwise flush and start a new band. (Mixed-width pairs at the legacy unit gap stay
   separate — they'd overlap.)
6. **`buildBandSpec`**: centerline endpoints = centroid of the group's stop positions;
   `stripeOffsets = stripeOffsetsForWidths(widths)` (mean-centered tangency positions —
   bit-exactly `(k−(n−1)/2)·STOP_SIZE` for uniform width 14); **radius bump** (`idealR = R +
   maxAbsOffset` so the innermost stripe still curves at ≥ R); **marker-fit cap** (cap R so the
   post-fillet straight run ≥ the widest marker half-width — single-stripe bands may cap *below*
   R, multi-stripe bands floor *at* R); then `offsetFilletPath` per stripe.
7. `assignLinePriorities` fills per-stripe z-priority from `lineOrder` + segment-layer overrides;
   `buildOrderedRenderables` flattens to per-stripe + marker renderables sorted back-to-front, so
   a perpendicular middle-layer line can interleave *between* another band's stripes.

A `SegmentBandSpec` carries **parallel arrays** (`lines`, `paths`, `stripeOffsets`,
`stripeWidths`, `linePriorities` — index k = same stripe). `stripeOffsets`/`stripeWidths`/`radius`
are the **single source of truth**: every consumer (band paint, stripe outline, label/tag
placement, hit sampling) **must read them, never re-derive**, and must use **`band.radius`** (the
bumped/capped effective radius), **not** `doc.curveRadius`. `bandKey` (= `pairKey#sortedLineIds`)
is unique and stable regardless of input order — used for React keys and as the "which band"
identity. The band specs are pinned by a **byte-exact golden snapshot**
(`interlining.golden.test.ts`) guarding the zero-visual-change-for-legacy-docs invariant; never
update it without understanding why every painted path on every map would move.

### Snapping — `snap.ts`

`snapDraggedStation(input)` (pure) supports modes `{line, equidistant, tens, all, grid}`
(`equidistant`/`tens` are gated on `line`). Flow: pick a target pool → generate candidate
alignment pairs per target (line-mode requires a shared line + parallel travel dirs + adjacency;
all-mode ignores topology) keeping those whose perpendicular distance is within tolerance
(`SNAP_PERP_TOLERANCE` = 10 world units at zoom 1, passed as `/zoom` so the engage radius is
constant in screen px) → **consolidate interlined candidates by MEDIAN** offset (not mean — keeps the guide on a real
stripe) → pick a primary + a non-parallel secondary axis → solve (2×2 intersection or projection)
→ apply grid as a **hard constraint** (when on, the result is always on-grid; an alignment fires
only if reconcilable, else falls back to plain grid with no guide) → optional along-axis
refinement (equidistant / tens) → build guides. Polygon vertices get their own decomposed snapper
`snapPolygonPoint` (no 2×2 solver) in `polygonSnap.ts`.

### Labels & text — `labelTokens.ts`, `textMeasure.ts`, `labelLayout.ts`

- **`parseLabelLine`** tokenizes a label line into `text`/`bullet` segments via `<CODE>` syntax
  (an inline route bullet); unclosed `<`, stray `>`, empty `<>` stay text.
- **`measureTextLabel`** measures multi-line styled text **without a browser layout**: it lazily
  creates an offscreen 2D canvas and uses `ctx.measureText` (advance + ink bearings). **In jsdom
  there is no canvas backend**, so it falls back to a deliberate over-estimate
  `line.length * fontSize * 0.55`. There are **no font-metrics tables**. Exact-geometry tests
  inject a `measure` stub instead of trusting the default. Leading/trailing whitespace is a real
  historical bug source: canvas advance includes typed spaces but the ink box excludes them, so
  the measurer force-corrects bearings at segment ends. Results are cached (module-level LRU,
  limit 256) keyed by weight/style/size/text — and that cache is cleared on web-font load (see
  `App.tsx`).
- **`labelLayoutLocal`** is the single source of truth for a station name's `<text>`
  anchor/baseline/hit-rect, all in **unrotated station-local** coords (the `label.rotation` is
  applied around the anchor at render). `'auto'` align snaps the text against an adjacent stop;
  `valign` drives the multi-line block math. **The renderer and the hit/silhouette geometry must
  pass the same `stopHalf` width lookup** or the wash drifts off the painted text.

### Polygons — `polygon.ts`, `polygonUnion.ts`, `rectPolygon.ts`, `polygonSnap.ts`

`unionConvex(A, B)` merges two convex polygons (split edges at shared crossings — **store one
shared `(x,y)` per crossing**, recomputing per-polygon drifts ~0.01 in fp and breaks stitching;
keep outside sub-segments; stitch into rings; fall back to `[A, B]` "visually approximate, never
silent" on failure). `polygonsToPath` / `openPolylinePath` are the **shared rounded-corner SVG
renderers** (one pass rounds convex corners and fillets concave junctions).
`rectIntersectsPolygon` is the inclusive marquee hit test (supports open chains).
`polygonCentroid` is the **vertex mean**, not the area centroid (fine for the rotation-pivot use).

### Other geometry

- `stationBoundary.ts` — builds a station's cells-AABB ∪ rotated label rect (the wash silhouette)
  and the `*ForRect` marquee functions (all skip `locked` items).
- `stripeOutline.ts` — per-stripe edge/cap geometry for the stroke-before-fill dots; reads the
  **baked** `stripeWidths`/`stripeOffsets`.
- `lineTagGeometry.ts` — arc-length sampling along an offset path; `snapNeighborTag` snaps a
  dragged tag to a same-corridor neighbor (matched by unordered `pairKeyOf`).
- `layerLabelPlacement.ts` — picks the arc-length `t` for a stripe's layer-number label at max
  clearance from other bands; **requires a pre-built sample cache** by design (to force callers to
  cache — uncached layer-cycling on busy maps was a real bottleneck).
- `svgImage.ts` — corners, aspect-locked corner resize, single-axis edge resize, rotate-to-pointer
  (`atan2(dx, -dy)`, Shift snaps 22.5°), snap anchor — all in the image's local frame.
- `lattice.ts` — orthogonal/diagonal stop-placement lattices, disjoint except at the origin.

---

## Rendering pipeline

[MapCanvas.tsx](src/components/MapCanvas.tsx) owns the entire paint order. `StationView`
([StationView.tsx](src/components/StationView.tsx)) is a `memo`'d `switch (layer)` dispatcher
instantiated **once per pass**. Top→bottom paint order (later = on top):

1. Polygon `body` → SvgImage `body` (under all map content).
2. Station `wash` (selection silhouette fill, behind bands).
3. Interleaved band stripes + `StopMarker` squares + `BandWarning` (ordered by per-stripe
   z-priority via `buildOrderedRenderables`).
4. Station `bg` (transparent hit areas).
5. Station `label` (after bg, so a selected wash never covers a neighbor's name).
6. Layering dashed outlines (layering mode only).
7. `TransferLayer` (before dots).
8. Station `dots` (**last** — dots paint over transfers and snap guides).
9. **Selected-item drag-proxies** — transparent hit targets for each unlocked selected item,
   emitted in body paint order (`MapCanvas`'s `proxyLayerRef`). They sit above all map content so a
   selected item wins a *drag* over anything stacked above it; a click/right-click on a proxy is
   re-routed to the real element beneath (`rerouteProxyEventBeneath`), so *selection* still follows
   normal paint order. Placed **before** the handle overlays, so an item's own corner/vertex handles
   still beat its proxy.
10. Overlays: `match-stroke`/`stroke` silhouettes, label/polygon/image `overlay` handles, placement
   previews.

`StationView`'s props are referentially stable across a pan (immutable store refs, constant zoom,
stable `useCallback` handlers), so an imperative pan that rewrites the viewBox does **not**
re-render every station subtree.

**Stroke-before-fill dots (the headline render motif).** `StationDots` maps `['stroke','fill'] ×
stops`, emitting **all stroke-pass glyphs before all fill-pass glyphs**, so overlapping dots share
**one continuous outer border** (every silhouette is painted before every body). `StopGlyph`
implements the split: the stroke pass is the silhouette drawn as a **filled** shape outset by
`strokeWidth/2` (`× √2` for a diamond); the fill pass is the body **inset** by the same amount and
carries the canonical `data-stop-*` E2E attributes. **Not split**: open rings (`fill:'none'`), the
`x` saltire (concave), borderless dots. A lone dot's outer edge is byte-identical to the old
centered stroke.

> Per project memory: this stroke-before-fill is **dot-internal** (`StopGlyph`). Reordering
> **line casings** to merge interlined separators was tried and **reverted** (it erased the
> separators). Do not conflate the two.

**`StopMarker`** is the colored **square** that sits *in* the band at each stop (distinct from the
circular dot), sized to the line `width`, with casing rails centered on the travel-parallel edges
(so tangent neighbors' rails coincide into one separator) and a terminus end-cap. Hatched markers
**pre-rotate their corners into world space** (can't reuse the rotated `<rect>` — `userSpaceOnUse`
patterns would re-rotate the stripes). Dashed/dotted markers render nothing at interior stops
(the pattern flows through) and a half-width stub at termini.

**`TransferLayer`** renders all transfers in **three flat passes** (selection rings → user
strokes/halos → bodies) so overlapping thick transfers trace one outer union. Bodies + halos are
click targets (`pointer-events="stroke"`); rings are decorative; dots paint above so a dot click
routes to the station, not the transfer.

---

## Canvas interaction layer

Files in [src/components/canvas/](src/components/canvas/). `MapCanvas` composes ~10 hooks onto
**three** SVG pointer handlers.

### The viewport perf spine

Committed camera in persisted `useViewportStore`; in-flight in non-persisted
`useLiveViewportStore`. During a gesture, `applyViewBox(v)` does two things: `setPending(v)` (live
store) **and** `svgRef.current.setAttribute('viewBox', …)` directly. No doc/committed-store write
→ no React re-render of the SVG tree per frame; the browser just re-rasters the moved region. On
gesture end (`commitPending`), `setViewport(pending)` then `setPending(null)` (clearing pending
**last** so overlays stay on the live viewport right up to commit — no jump). The JSX `viewBox`
binds to the **committed** viewport, so a mid-pan re-render leaves that prop string unchanged and
React skips the DOM write (never clobbering the imperative pan).

> The viewBox write is **synchronous, not rAF** — rAF was tried and reverted (synchronous tracks
> the cursor with zero added latency). Per-frame writes go to `useLiveViewportStore`, **never**
> `useViewportStore` (which is persisted — a per-frame write would hammer localStorage).

`screenToWorld` reads the **live** viewport (so a cursor-following overlay doesn't drift
mid-gesture); the returned `vb*` fields track the **committed** viewport (so a mid-pan re-render
can't clobber the imperative pan). Both distinctions are explicitly tested
([useViewport.test.tsx](src/components/canvas/useViewport.test.tsx)). Pure math lives in
[viewportMath.ts](src/components/canvas/viewportMath.ts) (`viewBoxFor`, `overdrawnViewBox` —
draws bg/grid/dim at a 3×3 tile so an imperative pan can't reveal a bare strip — `computeWheelZoom`
clamps zoom to `[0.1, 64]`). Wheel zoom commits after a settle timer (~90ms quiet); pan commits on
pointer-up.

### Pointer flow

`MapCanvas`'s `<svg>` has exactly:
- `onPointerDown`: middle-button or hand-mode → `view.startPan`; else `rectSelect.onPointerDown`
  (self-gates). **Item drags start from the item's own pointer-down** (fired by the child view),
  not the canvas handler. A **selected** item additionally carries a top-z transparent drag-proxy
  (see the paint-order list) so its drag wins over higher-painted items; proxy clicks/right-clicks
  are re-routed to the element beneath via `rerouteProxyEventBeneath`, so hit-testing for *selection*
  stays on normal paint order while *dragging* gets selected-item priority.
- `onPointerMove`/`onPointerUp`: fan out to every hook; each early-returns if its drag ref is null.
- `onPointerDownCapture`: self-heals `dragState.suppressClick = false` at the start of every fresh
  gesture (recovers from a drag killed without pointerup).
- `onClick`: only on background; bails if `dragState.suppressClick`; else placement dispatch, else
  deselect-all.

**Shared drag lifecycle** ([dragGesture.ts](src/components/canvas/dragGesture.ts)): pointerdown
captures pre-drag state + `beginHistoryGroup()`; **pointer capture is deferred to first move** (so
the synthesized click still lands on the item); `trackDragMove` flips `moved` past
`DRAG_MOVE_THRESHOLD=4`px (sets `suppressClick`, captures); `finishDrag` commits one history entry
if moved (else cancels — a pure click recorded nothing). `dragState` (module singleton in
[store.ts](src/state/store.ts)) is the global click-suppression flag.

### Drag hooks

`useStationDrag` (runs the snap engine; Shift bypasses snap; Ctrl-drag = redistribute),
`useLabelDrag` (the sole-selected station's painted name; see UI chrome), `useStationLayoutDrag`
(the editing-station-layout mode's stop/label handles; see UI chrome),
`useItemDrag` (bullets + labels), `usePolygonDrag` (whole-move / vertex / edge-add), `useSvgImageDrag`
(move / resize / rotate — resize only snaps while axis-aligned; rotation only snaps to 22.5°),
`useLineTagDrag` (**uses window-level listeners + `getScreenCTM().inverse()`** — the only hook that
does, because the drag wanders off the small tag rect), `useRectSelect` (marquee with per-frame
preview of the resulting selection per type, through set/add/xor modifiers).

**Group drag** ([groupDrag.ts](src/components/canvas/groupDrag.ts)): at pointerdown,
`collectGroupSiblings` snapshots every *other* selected item — but only if the grabbed item is
itself selected (dragging an unselected item never tows; locked items never tow). Snap during a
group drag **splits by type**: a **station** keeps the full snap engine, merely excluding the
moving siblings as targets (`excludedIds` in [useStationDrag.ts](src/components/canvas/useStationDrag.ts));
a **bullet** drops its line-snap engine to a grid-only fallback (the `!inGroupDrag` gate in
[useItemDrag.ts](src/components/canvas/useItemDrag.ts)), since its targets would be unstable.
**Group rotate** ([groupRotate.ts](src/components/canvas/groupRotate.ts)): right-click rotates the
whole multi-selection rigidly about the pivot via `rotateItemsAround` (fixed the bug where
per-type handlers omitted other types).

### Placement & popovers

`usePlacementDispatch.handleCanvasPlace(e)` is a per-`uiMode` dispatch. `placing-station` /
`creating-route-bullet` are **sticky** (click-click-click drops repeatedly); `placing-label` /
`creating-polygon` / `placing-svg` are single-shot (drop, exit, auto-select to open the
popover/handles). Cursor-following ghost previews (`*PlacingPreview`, all `opacity 0.5`,
`pointerEvents none`) feed synthetic items to the real views.

`ItemPopovers` mounts the single popover for the sole selection and reprojects through
`useLiveView` so it tracks the canvas during pan/zoom. `useDraggablePopover` **freezes the item's
world position at mount** (so a size slider editing the item can't feed its own position back),
accumulates header-drag in **world units**, and re-freezes when the selection `id` changes (one
popover instance reused across selections).

### Memo contract (subtle but important)

`bandsGeometry` (`buildBandGeometry`) excludes `segmentLayers`, color, and style from its
signature — **width is geometry (in the hash); everything else is resolved live by stripe
consumers**. So a color/layer edit repaints without a geometry rebuild, and the geometry-only
array (not the priority-assigned `bands`) is passed to layering overlays so a layer cycle doesn't
churn the reference and re-run the per-stripe `t` search (a single click on a busy map once burned
300–500ms). `assignLinePriorities` mutates in place, so `bands` clones each spec.

---

## UI chrome

- **[Toolbar.tsx](src/components/Toolbar.tsx)** — file menu (Save/Load/Export), Add-item menu
  (toggles `uiMode`), tool buttons (arrow/hand), grid-size + grid-visible + dark-mode toggles;
  embeds `SnapToggleBar` and `OptionsPopover`. Owns the **export desaturation flush**: before
  export it drops the selected-line desaturation via `flushSync(() => selectLine(null))` so it
  isn't baked into the clone, then restores it in `finally`.
- **[Sidebar.tsx](src/components/Sidebar.tsx)** — Stations/Lines tabs, a sortable station list,
  and the inline-expanded inspector.
- **[inspector/index.tsx](src/components/inspector/index.tsx)** — chooses the inspector: sticky
  `LineInspector` while appending; `StationInspector` iff a station is the **sole** selection;
  else `LineInspector` for the selected line. Inspectors dispatch transforms directly and own
  **mirror matching** (`findMatchingStations` returns neighbors sharing layout under the model's
  4-fold mirror symmetry; an edit broadcasts to all of them inside one history group, rotating
  local deltas through `rotateGridDelta`).
- **Station layout editing happens ON the canvas** (the sidebar mini-canvas "StopGrid" was
  retired in favor of these three surfaces; its pure drag/ghost math lives on in
  [inspector/stopGridDrag.ts](src/components/inspector/stopGridDrag.ts) — `computeGhosts`,
  `findDropTarget`, `nudgeTarget`, all screen-frame-generated and projected to station-local):
  1. **On-canvas label drag** ([canvas/useLabelDrag.ts](src/components/canvas/useLabelDrag.ts)):
     while a station is the SOLE selection, its painted name's hit rect becomes the LABEL's own
     handle (StationHitArea forks; dots/body still drag the station). Plain drag = ghost-lattice
     cell placement (Shift = diagonal basis); **Alt = fine mode**, live-writing
     `setLabelOffset`/`setLabelOffsetPerp` via `screenDeltaToLabelOffsets` (exact inverse of
     labelLayout's offset axes; leaving Alt restores gesture-start offsets); right-click rotates
     the label; double-click still renames. Disarmed in hand mode / non-idle modes / mid-rename.
  2. **`editing-station-layout` mode** ([canvas/StationLayoutEditor.tsx](src/components/canvas/StationLayoutEditor.tsx)
     + [useStationLayoutDrag.ts](src/components/canvas/useStationLayoutDrag.ts)): entered via the
     inspector's **Edit layout** button (`startEditingStationLayout` preserves selection + mirror
     state; frames the camera if the station is off-screen). Zoom-floored grab rings over each
     real dot (orientation glyph badges) + a label-cell ring; drag between ghost slots, drop on a
     stop swaps, right-click/R rotates, click selects the stop/label (arming the shape/size
     pickers). A transparent **shield rect** swallows near-miss presses so nothing falls through
     to the whole-station handlers (the mode is in `RIGHT_CLICK_PASSTHROUGH_MODES`).
  3. **Keyboard nudge** (App.tsx): with a stop/label selected, arrows hop one lattice slot in the
     pressed screen direction (`nudgeTarget`, Shift = diagonal), Alt+arrows fine-nudge label
     offsets (Shift ×5), R rotates. All three surfaces share
     [state/mirrorDispatch.ts](src/state/mirrorDispatch.ts) — `dispatchMirrored` (one-shot
     controls, groups only when fanning out) / `fanOutMirrored` (group-free, for call sites
     already holding a history group; `beginHistoryGroup` is NOT reentrant) — and capture mirror
     matches at gesture start (the first write to the source dissolves the match).
- **Numeric fields**: `useFieldHistory` opens a history group on focus and commits on blur (and on
  unmount, as a safety net); `useNumericField` wraps it with a local text mirror, a focus guard,
  and wheel-to-increment off the live value. `NumericFieldRow` pairs a slider + spinbutton sharing
  one group so a drag + typing collapse to one undo entry.
- **`StationNameEditor`** intercepts Ctrl+Z itself — native input undo would creep the doc back
  one char per press; it commits the rename group, runs doc-level undo/redo, then closes.

---

## Export pipeline

[exportCanvas.ts](src/export/exportCanvas.ts) + [fonts.ts](src/export/fonts.ts). Turns the **live
in-DOM** `<svg>` into a standalone SVG, a 4× PNG, or a vector PDF
([exportCanvasPdf.ts](src/export/exportCanvasPdf.ts) + [pdfHatch.ts](src/export/pdfHatch.ts)).

`buildExportSvg(source, {background, pixelScale})` (async — awaits font fetches):
1. **Clone, don't rebuild** (`source.cloneNode(true)`) — label/tag geometry is measured against
   the *live* DOM, so cloning is the only faithful capture.
2. **Strip editing chrome**: remove `[data-bg]`, `[data-export-exclude]` (grid, highlights,
   ghosts, guides, handles — tagged in `MapCanvas`), and `foreignObject` (inline editors).
3. **Measure bounds offscreen** via `getBBox` (needs the element rendered → appended to an
   off-screen div, removed in `finally`).
4. **Empty guard is an AND** — throws only when *neither* bbox dim is positive (`!(w>0) && !(h>0)`),
   so a zero-height positive-width strip (a single horizontal line) is still exportable.
5. **Frame** to content + `PADDING=24`; set `viewBox` to the frame and `width`/`height` to
   `frame × pixelScale` (**pixels**). For PNG, baking 4× into the SVG's own size rasterizes the
   vector natively at 4× (scaling the canvas context instead would upscale a 1× bitmap — blurry).
6. Set root `font-family` (standalone SVG has no page CSS to inherit from).
7. Insert the background `<rect>` as `firstChild`.
8. **Embed fonts**: `collectUsedFontFaces` walks `text`/`tspan`, resolves each weight/style to a
   `FONT_TABLE` face, and `buildEmbeddedFontCss` fetches the files and inlines base64
   `@font-face`. A failed fetch is **skipped silently** (best-effort fidelity, never fatal).

`FONT_TABLE` (16 faces = 8 weights × {normal, italic}; **all `.ttf`** — jsPDF, used by PDF export,
can only embed TrueType outlines, not PostScript/CFF OpenType) **must stay 1:1 with the 16
Helvetica Neue `@font-face` blocks in [styles.css](src/styles.css)** —
two hand-maintained copies. (styles.css has a **17th** `@font-face`, the `DejaVu Sans` symbol/dingbat
fallback; it is a screen-only fallback for glyphs Helvetica Neue lacks and is intentionally **absent**
from `FONT_TABLE` — don't "sync" it in.) `normalizeWeight` ties go **low** (600 → 500). PNG raster uses
`img.decode()` (not `onload`) so embedded data-URI fonts are ready before the draw.

**PDF** ([exportCanvasPdf.ts](src/export/exportCanvasPdf.ts)) reuses `buildExportSvg`, then renders
that SVG to a true vector PDF with **svg2pdf.js + jsPDF** — selectable text, vector line work,
embedded SVG graphics kept as vectors. Four gaps svg2pdf/jsPDF can't bridge are closed here:
1. **Fonts** — jsPDF ignores the SVG's `@font-face` and can only embed TrueType, so the map's used
   faces are fetched and registered in jsPDF's VFS (the reason the whole set ships `.ttf`).
2. **Hatch** — svg2pdf can't tile a `<pattern>` along a stroke, so every hatch paint (band strokes
   **and** the stop markers on them) is baked into clipped solid-stripe geometry; the stripe math
   lives in the pure, unit-tested [pdfHatch.ts](src/export/pdfHatch.ts) (`ribbonFromCenterline`,
   `hatchStripeRects`, phased off the world origin so a band and its marker read continuous).
3. **Text baseline** — svg2pdf never reads `dominant-baseline` (only `alignment-baseline`), so every
   run — bullets/labels use `central`, free labels `hanging` — lands on the alphabetic baseline, too
   high. [pdfText.ts](src/export/pdfText.ts) `normalizeTextBaselines` measures each `<text>`'s box vs
   its forced-alphabetic box (`getBBox`, browser truth) and shifts `y` by the delta — exact for any
   baseline mode/font without metrics.
4. **Uncovered glyphs** — characters Helvetica Neue lacks (✈, ↔, ★, …) are drawn on screen by the
   shipped fallback font in [`FONT_STACK`](src/export/fonts.ts) (`'Helvetica Neue', 'DejaVu Sans', …`),
   but svg2pdf only embeds HN and jsPDF can't even encode supplementary-plane chars. Because the app
   already renders these in DejaVu, the PDF just traces the **same** font:
   [pdfGlyphs.ts](src/export/pdfGlyphs.ts) `outlineUnsupportedText` (run after normalization, so
   positions are alphabetic) keeps HN-covered characters as positioned selectable text (`partitionRuns`
   in [pdfText.ts](src/export/pdfText.ts)) and replaces each uncovered one with a vector `<path>` from
   DejaVu via `opentype.getPath` at the browser's own pen position — 1:1, no fitting, since screen and
   PDF share the font. A character in neither HN nor DejaVu is dropped (renders nothing). `textMeasure`
   measures inline-bullet labels with the same `FONT_STACK` so a symbol's measured advance matches its
   drawn advance.
Lazy-loaded on first PDF export (`import()` in the toolbar) so jsPDF + opentype.js stay out of the
initial bundle.

[color.ts](src/util/color.ts): pure hex math — `legibleTextOn` (W3C luminance → `#000`/`#fff`),
`withAlpha`, `blendOver`, `desaturateColor`. `parseHex` returns `[0,0,0]` (black) for any
malformed input (the discriminating case is a 7-hex-digit string, reachable via hand-edited files).

---

## Conventions & invariants (consolidated)

- **`activePalettes` is never empty** — enforced on both load paths, in transforms, and in
  `deleteCustomPalette`'s fallback.
- **Transforms return the same reference on no-op** — the foundation of undo grouping
  (`docSnapshotsEqual` is reference equality). A mutate-in-place transform would silently break
  history.
- **Canonical stored form**: optional fields are **absent when equal to their default**; setters
  clamp/round/lowercase and drop at default. `DotStyle` objects are written in fixed field order
  so `JSON.stringify` equality is exact for app-written docs.
- **Referential integrity after every action**: `line.stations[i] ∈ stations`; `stop.lineId ∈
  lines`; every `segmentStyles`/`segmentLayers` key is a real, non-default adjacency; every
  tag/transfer endpoint and `routeBullet.lineId` resolves live-or-null. Maintained by cascade
  prunes after structural edits (`deleteStation`/`deleteLine`/`removeStationFromLine`/…).
- **`LineTag.fromStationId < toStationId`** always (canonical/alphabetic, = `pairKeyOf`).
- **`DOC_FIELDS` is the single source of truth** for persisted/undoable fields — it is **not**
  `Object.keys(DEFAULT_DOC)`; keep them in sync (a field in `DEFAULT_DOC` but not `DOC_FIELDS`
  would default but never persist/undo).
- **Parallel arrays in a band** (`lines`, `paths`, `stripeOffsets`, `stripeWidths`,
  `linePriorities`) are index-aligned; `stripeOffsets`/`stripeWidths`/`radius` are the single
  source of truth — read them, never re-derive; sample with `band.radius`, not `doc.curveRadius`.
- **One history entry per gesture**; the selection store is reconciled (not restored) after
  undo/redo.
- **Paste/duplicate always unlock the copy** even if the source was `locked`, and offset by
  `DROP_OFFSET=15` world units (polygons offset every vertex; others offset the center).

---

## Gotchas & footguns (the high-value section)

Each is confirmed in source/tests; file pointers included.

- **`SvgImage.rotation` is continuous degrees, not an octant** — never snap it to a `Rotation`. A
  serialize test pins `247.5°` surviving verbatim. ([types.ts](src/model/types.ts),
  `serialize.svgImage.test.ts`)
- **Two opposite z-order conventions** — `lineOrder` index 0 = top; `polygonOrder`/`svgImageOrder`
  last = top. `addLine` prepends, `addPolygon`/`addSvgImage` append.
- **`resolveDotRender` size param trap** — pass `dotSizeOverride` (the override-only value,
  `undefined` when tracking defaults), **never** `resolveDotSize` (the resolved value), or
  default-tracking service-code discs shrink to r 4. ([dotStyle.ts](src/model/dotStyle.ts))
- **`width` is GEOMETRY, `strokeWidth` is PRESENTATION** — a width edit rebuilds bands; a stroke/
  color/style edit is resolved live. The band-geometry memo signature deliberately excludes
  everything but width. ([types.ts](src/model/types.ts), MapCanvas).
- **Casing rails must stay centered on body edges** — adjacent stroked lines' facing rails occupy
  the same pixels so an interlined band reads as one uniform stroke. Reordering line casings to
  merge separators was **tried and reverted**. ([lineStroke.ts](src/model/lineStroke.ts))
- **The interlining golden snapshot is sacred** — a 1-ULP drift in offset math slides every
  painted path on every existing map while staying green elsewhere. (`interlining.golden.test.ts`)
- **`toFixed(6)` in the router is load-bearing** — lower precision caused band/marker hash-bleed.
  ([router.ts](src/geometry/router.ts))
- **Single- vs multi-stripe radius cap diverge** — single-stripe bands may cap *below* the user's
  R (a tighter curve reads as intentional); multi-stripe bands floor *at* R (dropping below
  collapses inner stripes). ([interlining.ts](src/geometry/interlining.ts))
- **`perp` vs `leftNormal` are intentionally negations** (different y conventions); using the
  wrong one flips stripe order. ([vec.ts](src/geometry/vec.ts))
- **Text measurement silently differs app vs test** — real canvas `measureText` vs a
  `length × 0.55` over-estimate under jsdom. Exact tests inject a `measure` stub.
  ([textMeasure.ts](src/geometry/textMeasure.ts))
- **Web-font load invalidates the measure cache** — `App.tsx` clears `_clearTextMeasureCache()`
  and bumps a font epoch on `document.fonts.ready` + `loadingdone`; without it, first-paint labels
  (measured against the fallback font) stay a pixel off until the next edit. ([App.tsx](src/App.tsx))
- **The two load paths must not be merged** — `storeMigrate.test.ts` pins reference-equality
  pass-through for canonical docs; file-only sanitizers must not leak into `migrateDoc`.
- **Sanitizer ordering is load-bearing** — `convertLegacyDotShapes` and `sanitizeStopDotSizes` run
  *after* the per-line clean (a stop compares against the *sanitized* line default).
- **Polygon dark colors backfill to EQUAL light; text-label dark colors backfill to DIFFERENT
  defaults** (`#111111`/`#ffffff`) — for legibility. Don't assume symmetry.
- **`Polygon.closed`/`fillOpacity`/`curveRadius` have no backfill** — absent is meaningful
  (closed/opaque/sharp), so legacy polygons render unchanged.
- **`cancelAppendMode` rolls back `lineCounter` by 1** — "Add → Line" eagerly commits a placeholder
  line and bumps the counter to pick its color; cancelling before placing a station must undo
  both, else repeated Add→Esc walks the color cycle forward. **Real line deletion does not touch
  `lineCounter`.** ([store.ts](src/state/store.ts))
- **`addLine` guards the empty color cycle** — if every active palette is a dangling custom
  reference, `cyclingColors` returns `[]` and `n % 0` is NaN; it falls back to `FALLBACK_LINE_COLOR`.
- **`finishDrag`'s cancel branch does NOT reset `suppressClick`** — a never-moved gesture never set
  it; cross-gesture stranding is handled by the capture-phase self-heal instead.
- **Line-tag drag uses window listeners + `getScreenCTM().inverse()`** — the only hook off the
  shared React-handler path.
- **`beginHistoryGroup` is NOT reentrant** — zundo's pause/resume is a plain boolean, so a group
  inside a group resumes recording mid-gesture. Call sites already holding a group must fan out
  mirror edits via `fanOutMirrored`, never `dispatchMirrored`. ([mirrorDispatch.ts](src/state/mirrorDispatch.ts))
- **Mirror matches must be captured at gesture START for drags** — the first write to the source
  station changes its layout and dissolves the match, so a per-move `findMatchingStations` would
  find nothing after the first frame. One-shot controls (`dispatchMirrored`) compute at dispatch
  time, which is BEFORE their single write — equivalent and correct.
- **Export desaturation race** — `Toolbar.runExport` uses `flushSync` to drop/restore the selected-
  line desaturation synchronously so it isn't baked into the clone.
- **`pre-pr` does NOT run e2e** — migration/rehydration is only covered by Playwright
  (`e2e/migration.spec.ts`). A broken `migrateDoc` passes `pre-pr`.
- **No 600 weight anywhere** — `TextLabelWeight`, the weight tables, and clipboard validation all
  omit 600 (no SemiBold face shipped).
- **Underlines are explicit `<line>` geometry, not `text-decoration`** — Chromium leaves 1px
  residue on rotated `<text>` when `text-decoration` toggles. ([stationLabelText.tsx](src/components/stationLabelText.tsx))
- **Clipboard has an SVG-href security guard** — `readClipboard` rejects any svg-image `href` not
  starting `data:image/svg+xml` (a crafted remote/script href would break the opaque sandbox).
  ([clipboard.ts](src/model/clipboard.ts))

---

## Testing strategy

- **Unit (Vitest + jsdom)** — colocated `*.test.ts(x)`. Heaviest in `model/` and `geometry/`.
  Patterns: **property-based** (fast-check) for serialize round-trips and transform invariants
  (`serialize.test.ts`, `transforms.invariants.test.ts` at up to 2000 runs for narrow cascades);
  **byte-exact golden snapshot** for interlining (`interlining.golden.test.ts`); **invariant
  assertions** (arc-length monotonicity, unit tangents, palette luminance, FONT_TABLE shape);
  **document-order assertions** (`compareDocumentPosition`) for the stroke-before-fill and
  flat-pass invariants (`StationDots.order.test.tsx`, `TransferLayer.dom.test.tsx`).
- **Integration** ([src/test/](src/test/)) — `App.smoke`, `App.keyboard` (the two-tier form
  guard), `App.fontLoad`, `saveLoad` (round-trip through the real `pickDocSnapshot` path),
  `undoRedo` (value-restore, viewport-excluded-from-history, no-op equality, selection reconcile).
  Shared helpers: `fixtures.ts` (`makeStation`/`makeLine`/…), `interaction.ts` (synthetic pointer/
  wheel events + a `fakeSvg` with an identity screen↔world CTM), `setup.ts` (jsdom polyfills:
  ResizeObserver, pointer-capture, scrollIntoView).
- **E2E (Playwright, [e2e/](e2e/))** — single-worker, no retries, honors `PORT` for parallel
  worktrees. `seedAndOpen` seeds a localStorage doc (`Seed*` shapes omit fields to simulate legacy
  saves) and opens the app — **this is the only place the rehydrate/migrate path is exercised**.
  `migration.spec.ts` asserts **zero console errors** loading legacy docs; `export.spec.ts` checks
  the exported SVG is chrome-free with embedded `@font-face` and that PNG is genuinely 4× (reads
  IHDR bytes); `exportPdf.spec.ts` exports a hatch+text+image map and asserts the PDF embeds a
  TrueType CID font (`/FontFile2` + `/Type0`) rather than falling back to standard Helvetica.
- **Known gaps** (per the deep-dive): `Transfer`/`RouteBullet`/`LineTag` lack dedicated serialize
  round-trip tests; no pixel/visual golden for the merged-dot-border result; `MapCanvas`'s full
  pointer fan-out is only tested per-hook.

---

## Cookbook — how to make common changes

- **Add a field to `MapDoc`**: add it to `DEFAULT_DOC` ([transforms.ts](src/model/transforms.ts))
  **and** `DOC_FIELDS` ([store.ts](src/state/store.ts)). If it needs no legacy fixup it "rides
  along untouched" — no migration. If it does, write a shared backfill in
  [serialize.ts](src/model/serialize.ts) and call it from **both** `parse()` and `migrateDoc`
  (bump the persist `version` and add a gated block). Add a round-trip test.
- **Add an editing operation**: write a pure `T.xxx(doc, …) → doc` in
  [transforms.ts](src/model/transforms.ts) (return `doc` unchanged on no-op, maintain canonical
  form and referential integrity), expose a thin action in [store.ts](src/state/store.ts), and
  write a **red-first** behavioral test (per [CLAUDE.md](CLAUDE.md): the red test must fail on
  behavior, not on a missing import).
- **Add an editor mode**: add a `UiMode` variant + its handlers in
  [selection.ts](src/state/selection.ts), declare its right-click policy in
  `RIGHT_CLICK_PASSTHROUGH_MODES`, add a placement branch in `usePlacementDispatch`, and a Toolbar
  entry.
- **Add an entity type**: a `types.ts` interface + `DEFAULT_DOC`/`DOC_FIELDS` collection + order
  array (mind the z-order convention) + transforms + store actions + a `*View` component wired
  into the `MapCanvas` paint order + a selection id-list (via `makeIdListActions`) + serialize
  coverage. This is a large change touching every layer — expect it.
- **Tune the Vignelli geometry**: it lives in [interlining.ts](src/geometry/interlining.ts) /
  [router.ts](src/geometry/router.ts). Expect the golden snapshot to move; review the diff
  deliberately and regenerate only when you understand the visual change.

---

## Glossary

- **Band / stripe** — a band is a merged corridor of parallel line stripes between two stations;
  a stripe is one line's path within it.
- **Interlining** — merging multiple lines sharing a corridor into mean-centered parallel stripes
  (the Vignelli look).
- **pairKey** — `pairKeyOf(a, b)` = canonical sorted `"${min}|${max}"` station-pair key; the
  anchor for segment styles/layers and line tags.
- **Casing / rail** — the thin outline ("stroke") along a line's body edges, MTA-style.
- **Dot vs marker** — the circular **dot** (`StopGlyph`) is the stop indicator; the **marker**
  (`StopMarker`) is the colored square sitting in the band at the same stop.
- **Wash / silhouette** — the soft selection-highlight fill behind a selected station.
- **Waypoint** — a routing-point station with name + bullets hidden.
- **Route bullet** — a free-floating badge showing a line's service code.
- **Service code** — the short route identifier on a line (e.g. `"A"`, `"7"`).
- **Day/night color** — a `{day, night}` pair resolved per the dark-mode theme.
```
