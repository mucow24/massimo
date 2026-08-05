# Massimo — Architecture

**Up to date as of commit `5173f7b` (2026-08-04, #445) — verified against the live source.** This
document describes the code as it stands; it is not a changelog. Use `git log` for history.

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
**Vitest** (jsdom) for unit tests, **Playwright** for e2e. No heavyweight UI framework — the
chrome is hand-rolled CSS over a set of **Radix primitives** (`@radix-ui/react-{dropdown-menu,
select, slider, checkbox, toggle, toggle-group, toast, dialog, hover-card, icons}`), with
`react-colorful` for the RGBA color picker. `js-angusj-clipper` (Clipper 6 compiled to WebAssembly;
integer-snapped polygon booleans/offsets) powers the region-layering geometry. It loads
asynchronously, so `main.tsx` awaits it before mounting and there is no second engine to draw
with meanwhile — a failure to load is reported instead of degraded.

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
     measurement. Never imports React, the store, or the model's _store_ (it does share some
     model types). Works entirely in **world coordinates**.
  3. **`src/state/`** + **`src/components/`** — Zustand stores wrap the transforms as actions;
     React components render the doc to SVG and dispatch actions.
- **Editing = pure transforms.** Store actions are thin wrappers: `set((s) => T.moveStation(s, …))`.
  Transforms return the **same object reference on no-op** — this is load-bearing for undo
  grouping. ([src/model/transforms.ts](src/model/transforms.ts) is the ~4050-line heart.)
- **The Vignelli look comes from "interlining"** ([src/geometry/interlining.ts](src/geometry/interlining.ts)):
  multiple lines sharing a station-pair corridor are merged into mean-centered parallel stripes.
  This is the single most intricate algorithm in the repo and is pinned by a **byte-exact golden
  snapshot**.
- **Performance spine:** gestures never re-render the SVG tree mid-flight. A pan translates a
  **composited wrapper div** (compositor-only — no layout/paint/raster, whatever the map size); a
  wheel zoom writes the SVG `viewBox` **imperatively and synchronously** (not via React, not rAF).
  Heavy geometry drags pipeline: when a synchronous region build crosses ~30ms mid-gesture, a
  worker with its own clipper computes frame N while the canvas paints frame N−1 from a coherent
  lagged snapshot (`state/renderDoc.ts` + `worker/`), converging through the ordinary commit at
  pointerup.
- **Persistence has two load paths that must stay in sync:** `parse()` (file import) and
  `migrateDoc()` (localStorage rehydration). There is **no `normalizeDoc()`** — absent fields
  fill from `DEFAULT_DOC`; legacy fixups are shared exported "backfill"/"sanitize" functions
  called by both paths.
- **CI gate:** `npm run pre-pr` = `format → lint → format:check → test → build → e2e`. The
  Playwright suite runs last (it's the slow step) so unit-level failures surface first.

---

## Tech stack & commands

| Concern        | Choice                                                                 |
| -------------- | ---------------------------------------------------------------------- |
| Build/dev      | Vite 5 ([vite.config.ts](vite.config.ts))                              |
| Language       | TypeScript 5.6, `strict` ([tsconfig.json](tsconfig.json))              |
| UI             | React 18 (StrictMode)                                                  |
| State          | Zustand 4                                                              |
| Undo/redo      | zundo 2 (`temporal` middleware)                                        |
| Unit tests     | Vitest 4 + jsdom ([vitest.config.ts](vitest.config.ts))                |
| Property tests | fast-check 4 (model/geometry only)                                     |
| E2E            | Playwright ([playwright.config.ts](playwright.config.ts))              |
| Lint/format    | ESLint 9 flat config ([eslint.config.js](eslint.config.js)) + Prettier |
| Icons          | `@radix-ui/react-icons`                                                |

Scripts ([package.json](package.json)):

```
npm run dev          # vite dev server
npm run build        # tsc -b && vite build
npm test             # vitest run (unit, jsdom)
npm run e2e          # playwright test (drives the dev server)
npm run pre-pr       # format → lint → format:check → test → build → e2e  (the PR gate)
```

`pre-pr` runs `format` (prettier --write, auto-fixes) **first** so formatting can't block, then
`format:check` later is the actual gate. It ends with the full Playwright suite (added after an
interaction-behavior change passed every unit gate but broke an e2e spec — PR #159/#160), so it
needs the Chromium binary installed once via `npm run e2e:install`.

---

## Repository layout

```
index.html                      # Vite entry; loads Inter (Google Fonts), mounts /src/main.tsx
src/
  main.tsx                      # ReactDOM root, imports styles.css
  App.tsx                       # 3-pane shell + ALL global keyboard/contextmenu/blur wiring
  styles.css                    # 17 @font-face (16 Helvetica Neue + 1 DejaVu fallback) + .app CSS grid + tokens
                                #   (~30 custom props on .app; dark mode = one reassignment block
                                #   under .app[data-theme='dark'])

  model/                        # PURE domain logic — no React, no store
    types.ts                    # MapDoc + every entity type (the canonical data shape)
    transforms.ts               # ~4050 lines: all (doc,…)→doc editing ops + DEFAULT_DOC + constants
    serialize.ts                # serialize()/parse() + shared backfill/sanitize helpers
    docAudit.ts                 # auditDoc(doc): referential audit (tests + the export doors)
    styles.ts                   # named per-kind formatting presets (StyleDef) + styleId tag/stamp
    ids.ts                      # IdFactory: crypto UUIDs (prod) / counter ids (tests)
    pairKey.ts                  # pairKeyOf(a,b): canonical station-pair key
    recordOrder.ts              # reconcileOrder/moveInOrder: shared z-order algebra
    palettes.ts                 # built-in PALETTES (name-keyed) + library assembly/sorting
    customPalette.ts            # palette files: parse both formats (ours + legacy "frrf"),
                                #   serialize the massimo-palette format (day/night, description)
    dotStyle.ts dotSize.ts      # procedural stop-dot style + size resolution
    dashSize.ts                 # TfL-tick ('dash' stop) length/thickness resolution (derive from line width)
    transferStyle.ts            # TRANSFER_STYLE_DEFAULTS + per-transfer override resolution
    transferAnchors.ts          # the ONLY place a TransferEnd's three-arm union is narrowed (all four guards)
    lineWidth.ts lineStroke.ts  # stripe width (GEOMETRY) + casing rails (PRESENTATION)
    lineCurve.ts                # per-line corner radius resolution (the fillet the router turns by)
    lineCircle.ts               # line-circle radius floor + canonicalizer (quarter grid)
    lineEnd.ts                  # line END style resolution (line default → per-end pin) + the round→short degrade
    stopMetrics.ts              # stopMetricsOf: the production StopMetrics lookup — everything the
                                #   label geometry knows about one PAINTED stop, resolved through the
                                #   helpers the canvas paints by (cached on slice identity, then on
                                #   derived content, so a drag frame re-renders no station)
    stationPacking.ts           # width-edit repack: keeps tangent stop chains packed
    lineOrder.ts                # z-order reconcile (lineOrder = the default stacking)
    lineNaming.ts               # nameForIndex/pickNextLineName + lineDisplayName (the ONE
                                #   user-facing name for a line, shared by every surface)
    lineTopology.ts             # the single owner of a Line's edge-set adjacency (degree/neighbours/incidence, add/remove edge, edgesFromStations, shortestPathOnLine); where a line ENDS is NOT here, it is geometric — see lineEndsAt
    appendGestures.ts           # pure Edit Stops gesture decisions ((line, cursor, click/delete target) → next doc edit); no React/store, so state/ and canvas/ both consume it
    matching.ts pathSelect.ts   # interlining-group matching + shortest-path selection
    autoOrient.ts               # rotate a just-added station to the line tangent (flipping 180° when the tangent would render its label upside down — same axis, right-side-up text)
    clipboard.ts                # ClipPayload union + read/write + SVG-href security guard
    svgImport.ts                # import external .svg or png/jpeg raster → intrinsic/decoded
                                #   size + data URI (+ href security allow-list)

  geometry/                     # PURE math — world coordinates, no React/store
    vec.ts orientation.ts       # vector primitives; rotation/local↔world; STOP_SIZE=14;
                                #   the station FRAME (stationFrameRad: octant, or a ring's own);
                                #   ORIENTATION_ANGLE (the drawn stop arrow's rotation, parallel
                                #   to travelDirLocal) + ANCHOR_HALF (a free anchor's footprint)
    router.ts                   # octolinear path solver + arc fillets + offset paths
    interlining.ts              # THE band algorithm: merge lines into parallel stripes
    appendRoutePreview.ts       # Edit Stops route preview: run the REAL connect/splice on a scratch doc, rebuild bands, keep the ADDED corridors
    snap.ts                     # the snap engine (line/equidistant/tens/all/grid modes) + the
                                #   SnapModes pref shape, whose `circle` mode the engine never reads
    lineCircle.ts               # circle math: project/tangent, rim capture, cardinal seats,
                                #   shorter-arc sweep,
                                #   arc tangent polygons (the fillet-walk-exact arc trick)
    lattice.ts                  # stop-placement lattice (orthogonal/diagonal)
    stationBoundary.ts          # selection silhouette + marquee hit rects
    stationDash.ts              # TfL-tick ('dash' stop) geometry: per-stop tick anchor/angle/length (label-side aware; emergent notched composite)
    stripeOutline.ts            # per-stripe edge/cap geometry (stroke-before-fill dots)
    markerEnd.ts                # non-square line-end shapes (path to paint, ring to cover, rails)
    polygon.ts polygonSnap.ts polygonUnion.ts rectPolygon.ts  # polygon geom + union + hit test
    clip.ts                     # typed wasm-clipper wrapper (booleans/offsets, integer-snapped); async load, one engine
    lineRegions.ts              # overlap-face PHASES (zone → components → cells → faces) + anchor binding + exclusion holes
    regionIncremental.ts        # the live region builder: per-component reuse across frames
    regionCache.ts              # sig-keyed cache of bands+markers+faces (render + reconcile)
    bodyMask.ts                 # per-body occupancy grid: the reject a whole-map bbox cannot give,
                                #   plus the cross-frame dirty-reach test (skips provable empties)
    regionReconcile.ts          # carries regionAssignments across geometry edits
    labelTokens.ts textMeasure.ts labelLayout.ts labelJustify.ts  # name → tokens → measured → placed
    lineTagGeometry.ts          # offset-path arc-length sampling for in-band tags
    svgImage.ts                 # svg-image corners/resize/rotate/snap geometry
    transferEnds.ts             # resolve a TransferEnd (stop / hosted anchor / free anchor) to its world point
    waypointLozenge.ts          # WP-lozenge pill geometry (shared drawn glyph + hit/selection box)
    itemBounds.ts contentBounds.ts  # per-item + whole-map world AABBs (camera fit)

  state/                        # Zustand stores (17 of them) + history
    store.ts                    # useDoc: temporal(persist(...)) + ~125 actions + migrateDoc
    history.ts                  # the ONLY module touching zundo internals
    renderDoc.ts                # useRenderDoc: the doc slice the canvas PAINTS from — mirrors
                                #   useDoc at rest, serves the pipelined drag frame while armed
    dragFrame.ts                # useDragFrame: the landed pipelined frame's holes + snap guides
    selection.ts                # useSelection: UiMode union + multi-select + reconcileWithDoc
    selectionOps.ts             # bulk selection gestures (delete/lock the unlocked subset)
    transferPick.ts             # pure transfer-endpoint pick/commit rules (no store)
    anchorVisibility.ts         # revealedAnchorStations: the hover/selection-scoped anchor
                                #   reveal that has no menu row of its own (no store)
    visibility.ts               # VISIBILITY_ITEMS registry: the View menu's layer toggles, which
                                #   of them gate exported ink, which nest under the network,
                                #   which modes reveal them, non-default detection
    mirrorDispatch.ts           # mirror-matching fan-out shared by every layout-edit surface
    viewportStore.ts            # useViewportStore (committed) + useLiveViewportStore (in-flight)
    fontEpoch.ts                # useFontEpoch: web-font load counter — a STORE so it crosses memo
    theme.ts                    # themeColors(darkMode, dayCanvasColor) table (no store; reads doc.darkMode)
    customPalettes.ts           # useCustomPalettes: the library's user half + stars + sort
    mapLibrary.ts               # saved maps + versions in IndexedDB (no store; opaque JSON)
    libraryPrefs.ts             # useLibraryPrefs: map-library UI prefs (sort mode; two star filters)
    libraryPointer.ts           # useLibraryPointer: which map + version the live doc came from
    saveBaseline.ts             # useSaveBaseline: baseline + tri-state clean/dirty/unsaved signal
                                #   (gates Save version + the toolbar dot; hash survives refresh)
    toastStore.ts               # useToasts: stacking status toasts (pushToast from anywhere)
    exportAudit.ts              # auditExportDoc: docAudit at the export doors (no store; toasts)
    snapPrefs.ts                # useSnapPrefs: snap toggles + the ten digit-keyed preset slots
                                #   (persist v2; migrates v0's boolean all/grid + fills modes
                                #   a blob predates)
    labelEditorPrefs.ts         # useLabelEditorPrefs: text-label editor UI prefs (wrapText)
    lineEditorPrefs.ts          # useLineEditorPrefs: line-popover style-detail collapsed?
    stationEditorPrefs.ts       # useStationEditorPrefs: station-popover typography detail
    stationNames.ts             # random station-name word lists
    funMode.ts                  # useFunMode: easter-egg phase off|live|exiting + the drop origin

  components/                   # React + SVG rendering and UI chrome
    MapCanvas.tsx               # the canvas hub: paint order + all pointer wiring
    Station*/Stop*/Label*/...   # per-entity SVG views (see Rendering section)
    selectionStyle.ts           # shared selection stroke/dash/wash constants (screen-px; ÷ zoom)
    Toolbar.tsx Sidebar.tsx Menu.tsx  # chrome
    BrandBullet.tsx             # the wordmark: an "M" route bullet (black disc/white M; night
                                #   inverts) — the toolbar badge, reused by the easter-egg ball
    MapLibraryDialog.tsx        # the library manager (maps | versions; Radix Dialog)
    PalettesDialog.tsx          # the palette manager (library | in this map; same Dialog shell)
    PaletteEditor.tsx           # the manager's second view: one palette's title/description/rows
    dialogRow.tsx               # shared dialog-row chrome: IconButton + the useSpeedBump two-click
    useRowDragReorder.ts        # pointer drag-to-reorder for fixed-height row lists (editor rows)
    MapVersionPill.tsx          # the live doc's version + save-status dot, beside the map name
    *Popover.tsx                # on-canvas item editors
    DayNightColorRow.tsx        # shared label + light/dark ColorField pair (every themed-color row)
    SegmentedToggle.tsx         # the ONE pick-one control (~13 inline Radix ToggleGroup clusters)
    FieldSelectContent.tsx      # shared Radix Select panel: portals popover Selects to .app (escapes
                                #   the .canvas-host isolate layer) + bounds/scrolls a long list
    canvas/                     # interaction layer: drag/placement/viewport hooks + overlay layers
    inspector/                  # LineInspector (hosted by the pinned on-canvas LinePopover; identity +
                                #   line-style fields — stop/topology editing is canvas-driven, see
                                #   appendGestures.ts) + StationInspector (hosted by the on-canvas
                                #   StationPopover) + pure math: stopGridDrag.ts, stationBandGeometry.ts

  worker/                       # the pipelined region worker (see Rendering: pipelined drags)
    regionFrame.ts              # the pure frame protocol: mirror identity-diffs, computeMirrorHoles
                                #   (byte-equal to the sync path), packed-hole codec
    regionWorker.ts             # the worker shell: own clipper WASM + region caches; SYNC/FRAME/ping
    regionPipeline.ts           # main-thread controller: arming, depth-1 coalescing, drain on every
                                #   gesture exit, timeout/error fallback to the synchronous path

  export/                       # exportCanvas.ts (SVG/PNG), fonts.ts, exportCanvasPdf.ts
                                #   + pure PDF-gap modules pdfHatch/pdfText/pdfGlyphs/
                                #   pdfDropShadow/pdfMask/pdfAlpha + embeddedSvg (shared image-href plumbing)
  fun/                          # ballPhysics.ts: the easter egg's rigid-disc simulation — bounce,
                                #   roll, kick, throw, and the pendulum a held ball hangs from.
                                #   Pure, in window pixels; no React, no store (BouncingBullet.tsx)
  util/                         # color.ts (hex math), fonts.ts (font stack + weight math),
                                #   grid.ts (clamp / roundClamp / snapToStep — the quarter-grid
                                #   canonicalizer primitives every dimensional setter shares)
  debug/                        # devHandle.ts: counters + the in-place resets (history / region
                                #   caches / doc round-trip) that let a slowed-down session be
                                #   bisected without the reload that cures it, plus the region
                                #   pipeline's flag/status/kill and the worker health probe. Read
                                #   three ways: the toolbar's Perf popover, window.__massimo, and
                                #   the .perf browser harnesses. Installed in EVERY build, not
                                #   just dev.
  test/                         # fixtures, jsdom setup, integration tests
e2e/                            # Playwright specs + seedAndOpen harness
public/fonts/                   # 16 Helvetica Neue .ttf faces + DejaVuSans.ttf (symbol fallback)
```

---

## Core mental model — the big ideas

Internalize these six and the rest of the codebase reads cleanly.

### 1. The document is everything saveable; nothing else is

`MapDoc` is the **only** thing that is undoable and persisted-per-file. Selection, camera
(viewport), grid size, snap prefs, and the palette **library** all live in
**separate Zustand stores** and are explicitly excluded from history and from saved files. A
saved `.massimo.json` is camera-agnostic and selection-agnostic.

The line is **"is this a property of the map, or of the session looking at it?"** — not "is it a
setting?". Day/night (`MapDoc.darkMode`) sits on the doc precisely because a night map is still a
night map tomorrow, on another machine, in an exported file. Grid size and `showWaypoints` are the
other side of that line: scaffolding for whoever is drawing right now.

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
  `DOC_FIELDS` key. It is sound _only because_ transforms allocate new objects exclusively when
  something actually changed. A transform that mutates in place would silently break undo.

### 3. Coordinate systems (memorize this table)

| Quantity                                                                                                                              | Frame                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `Station.x/y`, `Polygon.vertices`, `SvgImage.x/y`, `TextLabel.x/y`, `RouteBullet.x/y`                                                 | **World** (SVG user units)                                                                                               |
| `StopCell.row/col`, `LabelCell.row/col`                                                                                               | **Station-local grid cells** (unrotated; pitch = `STOP_SIZE` = 14)                                                       |
| `LabelCell.offset/offsetPerp`                                                                                                         | **Pixels in unrotated-station-local space**                                                                              |
| Snap guides, viewBox, redistribute, curveRadius, line width/stroke, transfer thickness                                                | **World**                                                                                                                |
| Drag thresholds (`DRAG_MOVE_THRESHOLD=4`), pointer start coords                                                                       | **Screen pixels**                                                                                                        |
| Snap engage radius (`SNAP_PERP_TOLERANCE=10`; `LINE_TAG_SNAP_TOLERANCE=10` in dragged-stripe arc length — both **world units at zoom 1**) | Call sites go through `snapToleranceAt(zoom)`, so the _effective_ radius is constant in screen px (the world tolerance shrinks as you zoom in) |
| Grid snap                                                                                                                             | **Hard world constraint** — unaffected by zoom                                                                           |

Screen y is **down** everywhere. `vec.leftNormal((x,y)) = (y,-x)` is "left of travel" in the
y-down frame and is what the router/interlining use; `vec.perp((x,y)) = (-y,x)` is the math
y-up convention and is **intentionally the negation** — using the wrong one flips stripe order.
1 lattice cell = `STOP_SIZE` = **14** world units.

### 4. Two rotation conventions (don't conflate them)

- **8-step octant** `Rotation = 0..7` (×45° clockwise) for **stations, labels, route bullets,
  text labels**. `r+1` = 45° CW.
- **Continuous degrees** for **`SvgImage.rotation` only** — a deliberate exception, because svg
  images rotate on a **22.5°** (half-octant) snap by default, freed by Shift. A round-trip test
  pins that `247.5°` survives serialization verbatim; do not "normalize" it to an octant.

### 5. Two opposite z-order conventions (don't conflate them either)

- **Lines:** `MapDoc.lineOrder`, **index 0 = top** (Photoshop-layers convention).
- **Polygons + svg images:** ONE shared `backgroundOrder`, **later in array = top** (painted
  later). The two kinds interleave in a single stack — a polygon can sit over an image or vice
  versa — and the kind is resolved by lookup (`polygons[id] ?? svgImages[id]`), since ids are
  UUIDs. Ids missing from the array fall back to insertion order, **polygons then images**, and
  render on top (via `effectiveBackgroundOrder`), so an add/order race never drops an item. That
  polygons-then-images fallback is also exactly the stacking of the retired
  `polygonOrder`/`svgImageOrder` pair, which pinned every image above every polygon.

Correspondingly `addLine` prepends (`[id, ...order]`, front), but `addPolygon`/`addSvgImage`
append (back of array = front by the opposite convention) — a new background item of either kind
lands on top of the whole band.

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
  name: string; // editable map title — drives toolbar/window title + save/export filename
  stations: Record<StationId, Station>;
  lines: Record<LineId, Line>;
  lineOrder: LineId[]; // index 0 = TOP
  lineCounter: number; // monotonic; advanced per addLine; drives palette color cycle
  lineTags: Record<string, LineTag>;
  routeBullets: Record<string, RouteBullet>;
  transferAnchors: Record<string, TransferAnchor>; // FREE anchors (hosted ones ride on their Station)
  transfers: Record<string, Transfer>;
  textLabels: Record<string, TextLabel>;
  polygons: Record<string, Polygon>;
  backgroundOrder: string[]; // polygons + svgImages in ONE stack; LATER = top (opposite of lineOrder)
  regionAssignments: Record<string, RegionAssignment>; // region paint choices ("paint by numbers")
  svgImages: Record<string, SvgImage>;
  lineCircles: Record<string, LineCircle>; // dashed guide circles stations bind to (never exported)
  palettes: Palette[]; // COPIES the map paints with, in picker/color-cycle order; may be empty.
  // A palette may carry a description; a swatch a night color (stored ONLY when ≠ its day color —
  // the collapse invariant — and unused by lines so far: the editor writes day == night)
  darkMode: boolean; // is this a NIGHT map? false = day. Travels in the saved/exported file
  styles: Record<string, StyleDef>; // named per-kind formatting presets ("Styles")
  styleDefaults: Record<StyleKind, string>; // per-kind DEFAULT designation (style id)
}
```

There are **no doc-level transfer settings** — transfers fall back to the constant
`TRANSFER_STYLE_DEFAULTS` (transferStyle.ts) with per-transfer overrides on top; the map-wide
knob is the designated default transfer style (edit it in the Styles panel and every transfer
wearing it follows). Pre-retirement saves carried `transferThickness/transferColor/
transferStrokeWidth/transferStrokeColor`; both load paths bake them into per-transfer overrides
(`bakeLegacyTransferSettings`, persist v10).

Likewise there are **no doc-level station-label settings** anymore — station name typography is
**per-station** (`Station.fontSize/weight/italic/leading/tracking`, each collapse-at-default) and
the map-wide knob is the designated default `'station'` style. Pre-retirement saves carried
`labelFontSize/labelWeight/labelItalic/labelLeading/labelTracking`; both load paths bake them into
per-station values and seed the default station style (`bakeLegacyLabelSettings`, persist v14),
mirroring the transfer retirement.

And there is **no doc-level `curveRadius`** anymore — corner rounding is per-line
(`Line.curveRadius`, missing ⇒ `LINE_CURVE_RADIUS_DEFAULT` = 24, [lineCurve.ts](src/model/lineCurve.ts)),
covered by line styles, and edited in the line inspector / line style presets. Legacy saves carried
the doc field; both load paths bake it onto every line and fill line style defs that predate the
covered field (`bakeDocCurveRadius`, persist v16). Where interlined lines disagree, the shared band
curves at the LARGEST member radius.

There is no branch-seam ("inner strokes") setting at all — which casing shows inside a branch
mouth or a self-crossing is a per-junction REGION choice (see Region layering below), not a line
style. Legacy saves carried per-line `seamColor`/`seamWidth`/`seamEdges` (and an even older
doc-level `seamEdges`); both load paths strip all of them from lines AND line style defs together
(`stripRetiredSeamFields`, persist v25 — both sides lose the fields at once, so tagged wearers
stay tagged). Unpainted junctions render with the BRANCH ARM in front by default — the old
"Branch" seam look — so stripped saves come back looking like themselves without repainting.

`DEFAULT_DOC` (in [transforms.ts](src/model/transforms.ts)) is the merge baseline: empty
collections, `name: 'Untitled map'`, `lineCounter: 0`, `palettes:
[a copy of MTA]`, `styles: DEFAULT_STYLES` — the six factory "Default" presets (one per styleable
kind: line, textLabel, polygon, routeBullet, transfer, station) **plus** the two seeded "Stop dots"
library styles (`stop-filled-black`, `stop-none`), since `stopDot` is a 7th styleable kind whose
styles live in a small doc-scoped library rather than as a single Default — and
`styleDefaults: FACTORY_STYLE_DEFAULTS` designating one per kind (`stopDot` → `stop-filled-black`). Styles are doc-scoped: applying one
stamps its props onto the item through the canonical setters and tags it (`styleId`, invariant:
tagged => the item's covered values equal the style's props); editing a covered field detaches
the item back to "Custom"; redefining a style (Styles-panel editor or "Save style..." over the
same name) re-stamps its tagged users in the same undo entry; new items are stamped with their
kind's DESIGNATED default style on creation. An optional prop that is OFF is **absent**, never
present-and-undefined, and `canonicalStyleProps` is the sole owner of that rule — it rebuilds a
props object field by field, so every producer (capture, the panel's edits, `sanitizeStyleProps`
over untyped file data) hands it an undefined and gets a missing key back rather than re-spelling
the omission. That matters because the tagged invariant is compared by `stylePropsEqual`, which
reads ABSENCE: one stray present-and-undefined key would read every wearer as "Custom" on load.
Defaultness is explicit and id-keyed, never name-derived: `styleDefaults` maps each kind to one of
its styles (`setDefaultStyle` re-assigns it — the panel's star), with three structural invariants
enforced on both load paths by `ensureStyleInvariants` (serialize.ts): every kind has >= 1 style
(empty kinds get their factory Default injected; `deleteStyle` refuses last-of-kind and re-points
the designation when the default itself is deleted), every `styleDefaults` entry resolves to a
style of its kind, and every line style's dot-TYPE ids (`singleton`/`multiDotStyleId`) name live
`stopDot` styles. That last one is what keeps dot type STAMPABLE: the setters no-op on an id that
doesn't resolve, so a def naming a deleted dot style is unmatchable — applying it leaves the line
tagged over diverged values and the next load strips the tag, i.e. the style silently reads "Custom"
again after every save/load. A present-but-dangling (or wrong-kind) id is re-pointed at the
designated default dot; `deleteStyle` re-points the defs it can see at delete time.
Both halves of a delete — the last-of-kind refusal and the fallback it re-points at — read
`selectableStylesOfKind`, which is `stylesOfKind` minus the reserved "None" stop dot. "None" is a
primitive the dot picker always offers but nobody chose, so promoting it to a kind's default (or
to a line style def's dot type) would stamp blank dots across every wearer. The picker itself
reads the unfiltered `stylesOfKind` — offering "None" is its job.
See [styles.ts](src/model/styles.ts).

### Entities (field-level)

**`Station`** — `id, name, x, y` (world center), `rotation: Rotation`, `stops: StopCell[]`,
`label: LabelCell`. Optional flags, **omitted when false/default** to keep saves clean:

- `isWaypoint?` — a "routing point": hide name + all bullet glyphs + drop the label hit rect;
  the station stays selectable/draggable via its stop-cell hit rect. Per-stop styles are **not**
  mutated when this toggles.
- `stopType?: 'singleton' | 'interchange'` — the station's OWN answer to which of each line's two
  split dot defaults its stops take, overriding the visible-stop count (`stationIsSingleton`; see
  `Line.singletonDotStyle` below). Absent ⇒ `'auto'`, the count. The count is only a proxy for how
  a station reads, and a poor one on a dense network where nearly everything is shared — so the
  declaration short-circuits it in both directions, ahead of even the blank-aware skip. Written in
  the station popover's Stop dots section ("Stop type") and **mirror-dispatched**, like dot type
  and size — Select Similar stands in for "stations of the same general purpose", which is what a
  stop type is. Deliberately NOT part of the match key (`stopsKey`, model/matching.ts): two
  stations that render alike still match while they disagree, which is what lets a broadcast bring
  them into line.
- `circleId?` — binds the station onto a line circle's circumference (see Line circles below).
  Bound stations sit ON the circle, drag ALONG it (`moveStation` projects), and keep `rotation`
  at the nearest-octant tangent with the label held right-side-up (`uprightTangentRotation`,
  shared with autoOrient). Their STOP cells do NOT resolve through that rounded angle — see the
  ring frame under Line circles. Dangling ids strip on load.
- `fontSize? / weight? / italic? / leading? / tracking?` — **per-station name typography**, each
  omitted at its `LABEL_*` default (fontSize→`LABEL_FONT_SIZE_DEFAULT`, weight→`LABEL_WEIGHT_DEFAULT`,
  italic→false, leading→`LABEL_LEADING_DEFAULT`, tracking→`LABEL_TRACKING_DEFAULT`). These are the
  five fields covered by the `'station'` StyleDef; editing any of them detaches the `styleId` tag.
  The hover bump and append-starter styling are applied at **paint time**, not stored here.
- `styleId?` — live link to a StyleDef of kind `'station'` (see MapDoc.styles); covers the
  typography above, not identity. Same contract as `Line.styleId`.
- `editorHeight?` — remembered CSS-px height of the inspector Name box (editing-UI only; never
  affects the rendered name). Mirrors `TextLabel.editorHeight`.
- `locked?` — **canvas protection**: can't be dragged, marquee-selected, group-towed, nudged,
  rotated (right-click rotate is a no-op; group rotate skips locked members), or deleted. A
  locked item is also **click-through while unselected** (its hit surfaces drop pointer-events,
  so clicks land on whatever is beneath — lock reads as "this is background"); while it IS
  selected it stays clickable, so the popover's unlock toggle remains reachable right after
  locking. For stations the click-through applies in **idle and layout-edit modes** — lock
  protects geometry, not mode participation, so a locked station is still a transfer endpoint
  and can still be toggled onto a line in append mode (those non-idle modes wipe the selection
  on entry, so without the gate locked stations would be unreachable there). The
  `editing-station-layout` mode is the exception that also gets click-through: a live locked hit
  rect would route the click to `selectStation`, whose `layoutEditReconcile` **retargets** the
  layout editor onto the locked station rather than letting the click fall through and exit — so
  a locked station must read as background there too. Accepted
  side-effect: idle-mode modifier clicks that _target_ a station (ctrl-click redistribute,
  ctrl+shift path-extend) can't target a locked, unselected station — unlock it first.
  Re-selecting a locked, deselected item: **Alt+click** (the deep-pick's geometric fallback
  reaches locked items) or **Alt+marquee** (includes locked items); stations also stay
  selectable from the sidebar, and the **station inspector stays fully enabled** — only
  stations get that. A locked, selected polygon/image renders its editing adornments
  **ghosted** (`data-*-adornments="inactive"`: 0.4 opacity, pointer-events none) so the
  selection is visible without inviting edits. Polygon, RouteBullet, TextLabel and SvgImage
  share the same canvas protections, but their popovers **disable every editing control
  except the lock toggle** while locked. **Bulk lock/unlock**: a multi-selection (≥2 items,
  any mix of the seven selectable kinds) mounts one shared `SelectionPopover` with Lock all /
  Unlock all / Delete all (`setItemsLocked` — one undo entry; delete shares the Delete key's
  unlocked-subset semantics via `state/selectionOps.ts`), so **Alt+marquee → Unlock all** is
  the mass-unlock path (and Lock all the mass-lock). Free transfer anchors are the one kind
  with **no `locked` field at all**, so Lock all counts them out (`lockableTotal`)
  while Delete all still counts them in. Line circles (the seventh kind) do lock — a locked
  circle refuses drag/resize/rotate/group-tow/delete and is click-through while unselected.

**`StopCell`** — one line's stop on a station. `lineId, row, col` (station-local grid;
**`row`/`col` are floats now**, since diagonal moves use ±√2/2 — equality uses `CELL_EPS=1e-4`),
`orientation: StopOrientation`. Optional, **dropped when equal to the line's effective default**:
`dotStyle?: DotStyle`, `dotSize?: number` (dot **diameter** in px), plus `dotStyleId?: string` —
the stopDot-library link whose stamped shadow is `dotStyle`, exactly analogous to `Line`'s
`singletonDotStyleId`/`multiDotStyleId`. `viaCircle?: boolean` (omitted when false) marks the
stop as "routed via the circle" its station is bound to — see Line circles below. It is the
FIFTH state of the stop's direction cycle: on a stop that can form a circular connection
(`stopCanRideCircle` — station bound AND a line-neighbor on the same circle, read off the
neighbor STATION's binding so two opted-out stops can't deadlock), `rotateStop` walks
Circle → V → NE/SW → H → NW/SE → Circle; ineligible stops keep the plain four-axis wrap, and
leaving the Circle state clears the flag either way. Shown as a ring where the axes show
arrows (stop rows, layout editor, hover badges).

**`LineCircle`** (`MapDoc.lineCircles`) — a perfect-circle guide: `id, x, y` (center),
`radius` (quarter-unit grid, ≥ `LINE_CIRCLE_RADIUS_MIN`, [model/lineCircle.ts](src/model/lineCircle.ts)),
`locked?`. **Editor scaffolding, never map ink**: rendered as a dashed guide ring with a ⊕ handle
at its centre — plus a resize knob on its east point while selected, and eight radial cardinal
ticks while the `circle` snap mode is on ([LineCircleView.tsx](src/components/LineCircleView.tsx),
`theme.guide`, export-excluded; the ticks come in as a prop, since the snap mode is a UI pref and
no part of the circle). The painted arcs come from line edges.

A circle has **two grab surfaces** — the rim's fat transparent stroke and the centre handle's
disc — because the rim is covered by construction (carrying a line is what a ring is for, and
this layer paints below all map content). Both select+move, both carry a `lineCircle` identity so
the alt-click deep-pick sees them, and they dedupe to one entry in its cycle — and to one hover,
wired on the wrapper `<g>` rather than per surface. The resize knob is rim-only. Every part
except that knob is a translation and tows the group. See the `LineCircleView` doc comment for
what the handle does and does not buy.

The concept splits in two, on purpose:

- **"On the circle geometrically"** is the STATION binding (`Station.circleId`): bind projects
  the station onto the circumference, rotates it to the tangent octant, and defaults every stop
  to `viaCircle` (binding happens by dragging/placing a station onto the rim — capture at the
  standard snap tolerance; a bound station escapes by being pulled `3×` tolerance off the rim, or
  instantly with Shift — see `useStationDrag`). Moving/resizing a circle carries bound stations
  rigidly/radially (`moveLineCircle`/`setLineCircleRadius`), and right-click ROTATES it: the ring
  is rotationally symmetric, so a circle's rotation IS its members' angular position —
  `rotateLineCircle` swings every bound station one 45° step round the rim and reseats it through
  `circleSeat` (45° is exactly one octant, so a seated station stays seated; a ring carrying
  nobody is a genuine no-op, same doc back). Deleting it strips bindings and
  leaves the stations standing (arcs simply re-route octolinearly — nothing moves, one undo
  restores). A bound station's LOCAL GRID is managed radially: the origin cell is the one point
  that sits ON the ring, so new stops stack radially OUTWARD (`spawnStopCellAt`'s bound branch —
  the naive "east of the rightmost" step points radially in at some angles and out at others, so
  two ring stations would spawn a second line's stops on opposite sides), and a stop removal
  re-homes the survivors (`rehomeCircleStops`: translate stops + label + hosted anchors rigidly
  so the nearest stop lands back at the origin — the move a user would make by hand).

  A stop spawned by a CONNECT or SPLICE inherits its LANE from the station it is wired from
  (`spawnStopCellAt`'s `from`), when both sit on the same ring and the source stop rides it.
  Without that, a line already running a lane out from the rim drops its next stop back ON the
  rim, leaving the corridor's two ends at different radii — `segCircleFit`'s `blocked` arm, so a
  chord plus the routing warning, on a layout the app placed itself. What carries across is the
  source stop's world RADIUS: not its cell, since the two seats need not share a frame, and not a
  lane INDEX, since pitch is `tangentGap` and index k is a different radius wherever the inner
  neighbours differ in width. A target spot within a `tangentGap` of an existing stop is occupied
  and falls back to the outward stack. `appendSpawnSource` names the same source station for the
  Edit Stops hover ring, so the preview cannot promise a lane the click will not use.

  A bound station's cells resolve through the **ring frame**, not `rotation`: `stationFrameRad`
  returns the quarter-turn of the radial frame nearest `rotation · 45°`, and `stationCellToWorld`
  rotates by that. The rounded angle is up to 22.5° off the true tangent, so resolving through it
  would put a lane-k stop at `R + k·pitch·cos(err)` — the same lane on a different radius at
  every angle around the ring, which BOTH concentric gates (`segCircleFit` for "does this edge arc",
  `forEachPackedRun` for "are these two lanes one band") then reject against `BAND_MERGE_TOL`.
  Lane 0 is immune, having no offset to foreshorten, which is why a single-line ring never showed
  it. Through the ring frame a lane sits at exactly `R + k·pitch` anywhere. Off a ring — and on
  one at an octant angle — the frame IS `rotation · 45°` and the bit-exact `rotateBy` path is
  taken, so nothing else moves. Hence `stopPosWorld` takes `lineCircles` as a REQUIRED param (the
  `tangentGap` idiom): a call site that skipped it would place a ring stop a lane off its own arc.
  The angle comes back UNWRAPPED — the candidates are `radial + k·90°` off a radial that may be
  negative, so the winner can name the octant's own direction from a full turn away. Compare it
  through `wrapAngleToPi`, never raw: that is how the module's own consumers read it
  (`stationDirToWorld`'s exactness gate, `radialLocalTurn`'s quarter-turn count), and a `===
  rotRad(rotation)` would be wrong over a quarter of the ring without looking it.

  EVERY cell of a station resolves through that one frame — stops, hosted anchors, and the name's
  label cell alike, along with everything derived from them: the painted label, its hit rect, the
  selection silhouette and marquee (`stationLocalToWorld` / `stationsForRect`), content bounds
  (`stationWorldAABB`), the layout editor and its ghost lattice, and the cursor→cell read-back
  (`stationDirToLocal`, the inverse). A surface left on `rotation · 45°` swings its cell off the
  lattice by `2·d·sin(Δ/2)` — ≈ `0.39·d` at the worst seat, where `d` is the cell's distance from
  the station origin, so an outer-lane label on a wide-line interchange lands a good 100 units from
  its own dot. `stationFrameDeg` is the one owner of the degree form those `<g>` transforms take,
  because `station.rotation * 45` reads like the same number and is right for seven seats in eight.
  The name's ANGLE comes along with its cell: a ring station's label reads at the arc's true
  tangent, parallel to the band it labels, rather than at the nearest 45°.

  Re-seating compensates for the uprightness flip. `circleSeat` turns `rotation` a full 180° where
  the name would otherwise read upside-down — judged on the RING frame it paints through (the polar
  angle `circleSeat` already holds), not the rounded octant, since a flip is a judgement about
  painted glyphs and the octant is up to 22.5° away from them. Judging the octant fires the flip
  early, spinning a name end-for-end mid-drag while it still reads at an upright 112.5°, and confines
  the reachable readings to a 180° window where the band leaves 270° free. So
  `uprightTangentRotation` takes the frame angle as an optional argument, omitted off a ring where
  the octant IS the frame. Cells are expressed in that frame, so the turn
  would mirror the whole layout through the anchor and send every lane across the rim. So every
  path that re-seats — `moveStation` for a drag, `rotateBoundStations` for a circle rotation,
  `bindStationToCircle` for a capture — goes through `reseatCircleLayout`, which negates the cells
  when `radialLocalTurn` REVERSES: stops, hosted anchors and the label CELL keep their world
  positions while `label.rotation` is left alone, which is what lets the 180° land on the name —
  the one thing the flip is for. Reversal exactly, not any change: between two seats it is the only
  difference reachable (a seat puts local ±x on the radial), but a bind arrives from a FREE station
  under no such constraint, and a quarter turn there is a real reorientation onto the ring — the
  one that lands a station's lanes concentric the moment it binds. A station that ESCAPED the rim
  mid-drag is neither: its cells are untouched but the rotation it carries is the seat it left, so
  `useStationDrag` keeps that pose for the rest of the gesture and hands it back as
  `bindStationToCircle`'s `seatFrom`, which reads the turn from where the cells were authored. The
  re-bind then lands exactly where the unbroken slide would have — the turn is a function of the
  seat ANGLE alone, so the answer can't depend on the path taken between the two. The other two
  member mutators need no compensation, both preserving each station's polar angle and so its
  frame: `moveLineCircle` translates rigidly, `setLineCircleRadius` reprojects radially.
- **"Routed via the circle"** is the per-stop `viaCircle` flag. An EDGE renders as a circular
  arc iff BOTH endpoint stops carry it, both stations bind to the SAME circle, and the stops sit
  at matching radial offsets. A deliberate opt-out (one end unflagged) degrades SILENTLY to the
  normal octolinear route — a crosstown chord is one direction-cycle step away, and the cycle
  wraps back to Circle — but an edge whose both stops ASKED to ride and can't (mismatched radial
  offsets, one stop a lattice cell off the ring) flags the band's routing WARNING
  (`segCircleFit`'s `blocked` arm), because the silent version reads as "circle routing is
  broken". **Always the SHORTER arc**
  (`wrapAngleToPi`; antipodal ties sweep clockwise). The longer way around is expressed by
  splicing a bound waypoint onto the circle, which splits the edge into two shorter arcs — the
  ordinary routing-override idiom, no stored sweep state.

The rendering trick that keeps this cheap: a circle band's centerline is the arc's **tangent
polygon** (`arcTangentPolygon`, [geometry/lineCircle.ts](src/geometry/lineCircle.ts)) — vertices
on the tangent lines, filleted at exactly the circle's radius, so the router's own fillet walk
reproduces the TRUE arc and offsets are exactly concentric. A circle band is therefore an
ordinary `SegmentBandSpec` (no new fields; every consumer, the region hash and PDF export work
unchanged). Ring-stop markers rotate to the EXACT tangent (continuous, not octant); a stop
that opted in but has NO ridable edge reverts to the plain octant square. A JOINT stop — where
an arc band meets an octolinear one — is the one place two band frames cross (octolinearity
puts every other station's corridors on one axis; turns happen mid-corridor), and a single
full square cannot stay flush with both: whichever frame it takes, its other half runs at the
wrong angle through the other band (a poking corner on one side, a bite on the other — both
up to `(w/2)·tan 22.5°`). So a joint marker is SPLIT BY SIDE
(`StopMarkerSpec.jointRotationDeg` + `jointArcOut`): the arc-side HALF-square in the tangent
frame, the straight-side half-square in the octant frame, and the cap-plane WEDGE between them
(the bowtie between the two butt-cap lines, corners exactly ON the band edges). Each piece is
flush with its own band; the residual is the ~`(w/2)²/2r` chord-vs-arc nub at the arc half's
corners. Like `end`, the joint fields reshape the painted footprint, so they join
`markerBodyRings` (halves as rects, the wedge as its two simple triangle lobes) and the
incremental-region unit hash. `jointMarkerPieces` is the one owner of the decomposition —
painter and region cover both call it, because a piece present in one and missing from the
other is a sliver of the neighbouring line showing through at every junction.
`sanitizeLineCircles` (serialize.ts) enforces the binding invariants on both load paths:
malformed circles drop, dangling `circleId`s and orphaned `viaCircle` flags strip, and a bound
station that drifted off its circle reprojects.

**`LabelCell`** — the station name's grid cell + placement. `row, col, rotation: Rotation`,
`offset` (px forward along reading direction), `offsetPerp?` (cross-axis, default 0 — back-compat
absent), `align: LabelAlign` (`auto|start|middle|end`), `valign: LabelValign`
(`auto-down|top|middle|bottom|auto-up`). `auto-down`/`auto-up` pin the block's top/bottom as a
multi-line label grows; identical to `middle` for single-line. `autoAlign?: boolean` (omitted
when off) overrides align **and** valign with transitmap.net typography derived from the label's
octant relative to the nearest stop, re-anchored along the reading axis at a cross (see
`labelLayoutLocal`); `offset`/`offsetPerp` still apply.
`autoHAlign?: 'start'|'middle'|'end'` / `autoVAlign?: 'up'|'down'` (omitted = derived) tune
autoAlign's multi-line handling: within-block line alignment, and which line anchors.

**`Line`** — `id, service` (the route code shown in bullets), `name, color`, `stations:
StationId[]`, and the required `edges: string[]`.

- `stations` are the line's **members** (one StopCell each). Their order is **DISPLAY ONLY** (the
  inspector list, "reverse", stable iteration); it does **not** define the route.
- `edges` is the route: the connectivity as an **EDGE SET** of canonical `pairKeyOf(a,b)` strings,
  each unique. This — not `stations` order — is what the renderer, interlining, tags, and
  per-segment overrides key off. A path is a chain of edges, a **loop** a cycle, a **branch** a
  station of **degree ≥ 3**. All adjacency (degree, neighbours, incidence, add/remove) is derived
  in the single owner module **[lineTopology.ts](src/model/lineTopology.ts)** so no consumer
  re-scans `stations`. Saves predating the field backfill `edges` from consecutive `stations`
  pairs on load (`edgesFromStations`; serialize.ts / migrateDoc — unconditional, see below).

All remaining fields optional and **never stored at default**:

- `segmentStyles?: Record<pairKey, LineStyle>` — per-segment style; missing ⇒ `'solid'`. Valid
  keys are exactly this line's `edges`.
- `singletonDotStyle?` / `multiDotStyle?: DotStyle` — the default dot style, **split by how the
  stop's station is shared**: `singletonDotStyle` for a stop that is the only VISIBLE stop at its
  station, `multiDotStyle` for a shared/interchange one (`stationIsSingleton`). "Visible" excludes
  a sibling whose EXPLICIT `dotStyle` override is blank (renders nothing) — the express+local
  pattern draws both lines through every station but blanks the express dot at skipped stops, and
  those must still read as singletons for the local line (only explicit overrides are inspected,
  never resolved defaults — that would be circular). That count is the DEFAULT answer: a station's
  own `Station.stopType` declaration outranks it outright, read before the count. Resolved live
  per stop (`resolveDotStyle(line, stop, isSingleton)`), so a station losing its other visible line
  adopts the singleton default with no rewrite; a per-stop `dotStyle` override always wins.
  Independent (editing one never moves the other); each missing ⇒ `DEFAULT_DOT_STYLE`
  (filled-black). Legacy saves carried one combined `defaultDotStyle` — baked into both on load
  (`bakeLineDotDefaults`, persist v18). Since the doc-scoped "Stop dots" library (persist v19) these
  two raw `DotStyle` fields are the **stamped shadow** of a library link: `singletonDotStyleId?` /
  `multiDotStyleId?` (persist v20 — also covered `LineStyleProps` fields) name the `'stopDot'`
  StyleDef, and the raw `DotStyle` here is its stamped props. The renderer reads the raw value;
  editing the library entry restamps it (same raw-value-plus-tag contract as `styleId`). **An absent
  id resolves to the module constant `DEFAULT_DOT_STYLE` (filled-black), NOT to the doc's designated
  default stopDot style** — `resolveDotStyle` never reads `doc.styles`/`doc.styleDefaults`. The two
  coincide only on a factory doc: re-designating the stopDot default via `setDefaultStyle` does not
  change what an untagged line draws.
- `singletonDotSize?` / `multiDotSize?: number` — dot diameter px, split the same way. **A missing
  size does NOT mean 8** — the default is **style-dependent**, resolved through
  `defaultDotDiameter(style)` ([dotSize.ts](src/model/dotSize.ts)): a service-code disc renders at
  `2×SERVICE_CODE_DOT_RADIUS` = **12**, everything else at `2×STOP_DOT_RADIUS` = 8
  (`DOT_SIZE_DEFAULT`). Every collapse / display / sanitizer path must route through
  `defaultDotDiameter`, never a flat `DOT_SIZE_DEFAULT`, or an explicitly-chosen 8 on a
  service-code dot silently snaps to 12. Legacy `defaultDotSize` baked into both.
- `width?: number` — **stripe width, GEOMETRY**; missing ⇒ `LINE_WIDTH_DEFAULT` (= `STOP_SIZE` =
  14); on a 0.25 (quarter-unit) grid, ≥ `LINE_WIDTH_MIN` (1) (`canonicalLineWidth`, `LINE_WIDTH_STEP`).
  Drives stop-cell tangency, band merging, stripe offsets.
  `setLineWidth` also **re-packs tangent stop chains** at every station hosting the line
  ([stationPacking.ts](src/model/stationPacking.ts)): stops packed edge-to-edge under the old
  width are rewritten to the new tangent gaps, chain-centroid preserved, label riding its
  nearest stop — so a width edit never un-merges an interlined band. Non-tangent spacing never
  moves. New stops likewise spawn one tangent gap (not one flat cell) from their anchor. A label
  parked _tangent_ to a stop of the edited line additionally **edge-carries** (`labelCarryDelta`,
  `dWidth/2` scaled by the marker square's support along the label's approach octant, plus
  `dGap` per axis for interline-gap edits) so it survives width **shrinks** and gap changes —
  without which the label detaches and jumps to the centered fallback. Both the renderer's
  adjacency test and this carry share `labelAdjacencyGate(half, gap)`
  ([geometry/orientation.ts](src/geometry/orientation.ts)), which floors adjacency at the
  historical 1-cell gate and widens it by the stop's interline gap (the ghost lattice parks a
  label against a gapped line at tangency + gap), so width and gap only ever WIDEN it. The gap
  reaches the renderer inside `StopMetrics` (see `stopMetricsOf` under Labels & text) — threaded
  at every `labelLayoutLocal` / `stationBoundaryRectsLocal` / `stationsForRect` /
  `stationWorldAABB` call site.
- `interlineGap?: number` — **extra spacing against interlined neighbors, GEOMETRY**; world
  units, missing ⇒ 0 (classic edge-to-edge tangency); on the 0.25 grid, ≥ 0 and **unbounded above**,
  dropped at 0 (`canonicalStrokeWidth` clamps the floor only; `lineInterlineGapOf` reads it).
  `LINE_INTERLINE_GAP_MAX` = `STOP_SIZE` is a **slider bound only** — the spinbutton may exceed it
  (`textboxAllowAboveMax`), the same pattern polygon stroke width and curve radius use. Lets a thin line carry stop dots
  fatter than its stripe without adjacent dots overlapping. Like `width` this is GEOMETRY: it feeds
  the single tangency choke point `tangentGap(wA, wB, gapA, gapB) = (wA+wB)/2 + max(gapA, gapB)` —
  used identically by the band merge gate, the stripe offsets, the packed-stop spawn, and the
  repack — so where two neighbors disagree the pair uses the **larger** gap, and editing the gap
  re-packs tangent stop chains via `repackStationForSpacing` (the width-edit repack, renamed and
  generalized from `repackStationForWidth`) so bands stay merged with dots centered; the label
  edge-carry rides the same edit (Δgap per axis), keeping a gap-parked label attached. Ghost
  overlap clearance deliberately stays width-only (dot bodies don't grow with the gap; only the
  pitch does), but the label **adjacency** gate does widen with the gap — see `width` above.
  `gap = 0` is a bit-exact identity — the interlining golden snapshot is unchanged.
- `labelGap?: number` — **clearance a station label keeps from this line's marker** (stripe, dot,
  tick or transfer cap, whichever reaches furthest along the approach); world units, missing ⇒ 3
  (the historical constant, now `LINE_LABEL_GAP_DEFAULT`); on the 0.25 grid, floored at
  `LINE_LABEL_GAP_MIN` (−10) — **0 and negative are real values** (text butted to, or ink into,
  the marker). Unlike `interlineGap`, `canonicalLineLabelGap`
  collapses the field at the DEFAULT, never at 0 — and style equality treats an absent key and an
  explicit 3 as the same gap, so defs predating the field don't detach their wearers on load.
  Reaches the label pins per-stop through `StopMetrics.labelGap`: each pin uses the gap of the
  line that blocks it (at a cross, each AXIS does), so a row of labels along one corridor stays
  consistent by construction. Pure label placement — no repack, no region reconcile.
- `strokeWidth?: number` — **casing rail, PRESENTATION**; centered on the body edges (half in /
  half out), missing ⇒ 0; rounded to a 0.25 grid (`LINE_STROKE_STEP`). Resolved live; never moves paths.
- `strokeColor?: string` — casing color; missing ⇒ `'#ffffff'`; lowercased. May instead be the
  sentinel `'line'` (`LINE_OWN_COLOR`) — "the line's OWN color", resolved at render time, mirroring
  a dot style's `'line'` fill/stroke. `lineStrokeColorStored` reads the raw value (capture-by-example
  and the editors' mode pickers); `lineCasingColor(line, lineColor)` resolves it for paint, taking
  the EFFECTIVE color so a line-colored casing desaturates with the body.
- `dashLength?` / `dashWidth?: number` — **TfL-tick dimensions for this line's `dash` stops**,
  world units. PRESENTATION (never moves band geometry, resolved at render). Both **unset** ⇒
  derive from the stripe width (`dashLength = width`, `dashWidth = width/2` — the TfL proportions;
  see [dashSize.ts](src/model/dashSize.ts), `dashRenderLength`/`dashRenderWidth`). Stored on the
  casing width's quarter-unit grid with drop-at-0 (0 = "auto" ⇒ field dropped, derivation takes
  over). `dashLength` is how far the tick protrudes from the stripe edge toward the label;
  `dashWidth` is its thickness along the travel axis. Covered by line styles.
- `endStyle?: LineEndStyle` — how the line is PAINTED wherever its ink stops (see **Where a line
  ENDS**): `'square'` (the full stop-marker square, missing ⇒ this), `'short'` (only the inward
  half, so the line stops flush at the stop center) or `'round'` (the outward half replaced by a
  half-disc of radius `width/2`). PRESENTATION — it never moves a band path — but unlike the casing
  it does change the marker's painted FOOTPRINT, so `regionGeometrySig` hashes it and the store
  actions reconcile regions. Covered by line styles. See [lineEnd.ts](src/model/lineEnd.ts).
- `stationEndStyles?: Record<StationId, LineEndStyle>` — per-END overrides of `endStyle`, edited in
  the station editor's stop row, and offered only where the line ENDS (`lineEndsAt` — see Where a
  line ENDS). **Valid keys are the stations this line still stops at** — LIVENESS, deliberately
  weaker than the rule that decides where a pin paints. That rule is geometric, so it moves under a
  station drag, a rotation or an orientation cycle, none of which pass through a prune; scoping the
  stored key to it would let a save/reload delete what the user set while the end was momentarily
  elsewhere. A pin whose station is no longer an end therefore sits INERT — nothing paints an end
  style where the line does not end — and revives when the stop does. Removing the stop or the
  station revokes it, in `pruneOrphanLineOverrides` (transforms) / `sanitizeLineEnds` (load),
  alongside `segmentStyles`' edge rule. A pin equal to the line's own `endStyle` is redundant and
  never stored. **Not** covered by line styles: a style carries the line's own end, never its
  per-station pins — the same split the per-stop dot overrides have.
- `styleId?` — live link to a StyleDef of kind `'line'` (covers the style fields above, not
  identity/topology).

**Region layering ("paint by numbers").** There is no per-segment z-order. Where painted bodies
overlap — another line's, or the line's OWN at a branch mouth or self-crossing (below) — the
planar arrangement's faces are derived live (`regionIncremental.buildRegionsIncremental`,
clipper-backed via `clip.ts`, cached in `regionCache.ts`); each face shows one coverer —
by default the `lineOrder` front-most LINE, overridable per face via `MapDoc.regionAssignments`
(Layering mode, `L`: click a face to cycle, right-click backward, landing on the default
deletes). **Shift-click floods instead of cycling**: it spreads the winner the clicked face
ALREADY shows out to its neighbours (`lineRegions.regionFloodTargets`), leaving the clicked
face itself untouched — one click carries a line over a whole crossing instead of one window
pane at a time, and what spreads is the color you can see rather than whatever the cycle would
have landed on. Both branches (and the empty-plan case, which must not burn an undo) are
decided by the one pure `lineRegions.regionPaintPlan`, which `MapCanvas.handleRegionClick`
feeds straight to the store. The flood walks faces that touch (within `REGION_ADJACENCY_TOL`;
band stripes are built mutually tangent, so a line crossing a trunk yields panes that abut
along each stripe seam), and stops at any face that either can't legally show the target (it
isn't in the cover) or already shows it — the latter is what keeps a flood from running away
along a line's whole length. All of it writes through the list-taking `assignRegions` so a
flood costs exactly one undo. An assignment is anchored IN THE LINES' OWN FRAME (`RegionAnchor`:
corridor + arc position + side offset per cover slice — a self face mints one anchor PER ARM,
pinned to that arm's own corridor) and is carried across every geometry
edit by `regionReconcile.ts` — rebinding corridor-identity-first (a face must run the anchors'
own corridors, so same-cover sibling crossings are not interchangeable; `bindAssignments` is
shared with rendering, whose per-frame re-binds during a drag see anchors whose arc positions
are stale until the commit reconcile re-mints them), falling back to nearest-compatible face
when no face runs those corridors (survives teleports and a crossing sliding past a station),
duplicating onto split halves, resolving merges by largest old face, going dormant when its
overlap temporarily vanishes. The reconcile runs inside `beginHistoryGroup.commit()` (drags,
sliders, nudge groups) or inline via `withRegionReconcile` (ungrouped one-shots), always in
the SAME undo entry as the edit. Rendering is SUBTRACTIVE (`buildExclusionHoles` +
`RegionExcludeClips`): losers are clipped out over the faces they lose — the winner is NEVER
repainted (repainting doubles antialiased edges; clip-abutting seams are impossible when the
winner is one continuous base stroke). Cased lines: the hole runs through the winner's white
ring (its rails are already painted beneath — uncovering them gives the natural bridges-over
look) and swallows the losers' fringes near the face. Only lines whose bodies cover the face
ever lose — an interlined neighbor's rail riding the shared boundary is the neighbor's own
crossing's business: painted for this winner, that crossing's holes punch the shared rail zone
and tile with the reveal; unpainted, the winner slides under it and the boundary stroke runs on
intact. Clipped areas take no pointer events,
so idle clicks land on the visible winner natively. Holes exist wherever a face's winner
differs from the raw base paint — assignment-free branch-arm DEFAULTS included — so a doc with
zero assignments still clips its unpainted mouths; a branch-free map pays nothing.
`buildExclusionHoles` is the cache-free reference; production renders go
through `buildExclusionHolesCached`, a per-face cross-frame cache whose entries are reused only
when every input is provably unchanged (face content key, no dirty geometry within a
conservative reach, winner/railW signature, shield-neighborhood signature, per-sliver
absorb-gate outcomes) — its output is pinned byte-equal to the reference by
`lineRegions.holeCache.test.ts`, and an unverifiable frame chain (an undo served from the
geometry LRU) flushes it to a full rebuild.

**Self-overlap: a line against itself.** A line's body is ONE unioned polygon, so the pairwise
stage cannot see the line overlapping itself — arms are what make it visible. The junction
pairing (`assignLineArms` in interlining.ts: at each station a line's band ends match into
through-runs, most opposed first then longest combined straight run, continuing past the first
run only while dead-opposed) doubles as a union-find gluing the line's bands into ARMS, baked
per stripe as `SegmentBandSpec.arms` (hashed by `hashUnits` — arms move ink). Arm-pair stripe
intersections join the zone as `a|a` pairParts entries, and the BAND-PAIR RULE adds `a|a|x`
ones: two bands of the SAME arm sharing no station cannot be corner-adjacent, so their overlap
is a genuine mid-edge self-crossing (the P-shape). Components hosting self parts subdivide that
line per SLICE — per-arm bodies at a mouth (each marker riding its smallest incident arm), per
involved band plus the bare-id rest at a crossing, arm partition winning when one component
hosts both — and lone slices collapse back to bare line ids, so every face outside a genuine
self-overlap keeps exactly its historical cover. Slice cover ids (`arm:`/`edge:` spellings,
`lineRegions.armCoverId`/`edgeCoverId`) are BUILD-LOCAL; the winner domain becomes "a line,
slices merged" or one slice of it. An unpainted MOUTH defaults to the BRANCH ARM in front
(`makeDefaultWinner`): at the junction the arms share, the glued through-run lands two band
ends and a branch exactly one, so the fewest-ends arm is the branch (smallest arm number on a
tie; all-through crossings, mid-edge crossings — edge-spelled covers — and multi-line faces
keep the front-most-line default). The boundary strokes then break in one piece wherever a
reveal crosses them — leaving a mouth merged beside painted reveals is what produced
half-width strokes, since the fused row arm kept co-painting boundaries its neighbors'
clipped rails had left to it. MERGED is a real stored choice instead of the resting state: a
single-line assignment with no `winnerPairKey` (reconcile keeps born-single assignments and
drops only covers SHRUNK to one line). The cycle offers distinct lines then slices, stepping
from the on-screen default, deleting on landing back on it; a slice choice persists as
`RegionAssignment.winnerPairKey` — an EDGE name, always
copied from the winning slice's own minted anchor, translated across splits/heals with the
anchors, re-spelled at every remint, and degrading to the merged line whenever it stops
resolving. Slice winners hole their sibling slices too (same z — either paint order must clip),
with the winner's footprint filtered to its own slice's stripes; hole keys are cover ids, so
`RegionExcludeClips` emits slice defs (each merged with its line-level holes — one clipPath per
element) that stripes reference finest-first (band, arm, line) while markers always take the
line def. All of it is pinned against the older workaround it replaces: modeling the branch as
a second line produces byte-identical faces and reveals (`lineRegions.selfOverlap.test.ts`).

**How the faces are actually built.** `lineRegions.ts` holds the pipeline as separable phases —
`buildLineBodies` → `overlapZoneParts` (pairwise body intersections; any ≥2-cover point is in one
of them; deliberately not unioned) → `zoneComponents` (ONE polytree union over the raw parts,
yielding the merged zone rings and its connected components in canonical content-key order —
iteration order is output-visible through per-component sliver emission, so it must be a pure
function of geometry; sub-`SLIVER_MIN_AREA` components — ~95% of them by count — are dropped
from the significant set, and `significantComponents` is the comps-only view of the same call) →
per component `restrictBodiesToZone` (a body's bbox spans most of the map, so the reject
that matters is its OCCUPANCY MASK — below) → `subdivideCells` (each cell carries its bbox;
strictly-disjoint cell/rings pairs skip the provably-empty clipper intersect) → `extractFaces` →
one `finalizeFaces` over the merged set. A cell can never span two components, so per-component
subdivision is equivalent to one global pass while keeping every clipper operand down to one
crossing's worth of geometry. Span sampling walks each covering stripe's arc grid only inside
precomputed windows where the path nears the face bbox, jumping the gaps between them — outside
a window a sample is provably rejected by `pointNearFace`'s own bbox gate, so the skips preserve
the interval output byte-for-byte. Stripe bodies, marker footprints and flattened stripe paths
all memoize per SPEC OBJECT, which is sound because interlining's reuse layer hands back the
same spec only when value-identical (see the Memo contract).

**Occupancy masks** ([geometry/bodyMask.ts](src/geometry/bodyMask.ts)) are the reject the
whole-map body shape forces. A line body is one polygon covering everywhere that line runs, so
its bounding box is a large fraction of the drawing and every test built on it waves through
operands that share a box and no territory — each one a thousand-vertex clipper call to learn
nothing. `bodyMask` is the set of `MASK_CELL`-sized grid cells a body occupies, memoized per
ring-ARRAY identity so a clean line never re-masks. It never changes what an operation returns,
only whether one that would have returned empty runs at all: the mask is a conservative SUPERSET
of its body (an edge pass for cells holding boundary, an even-odd scanline fill for cells wholly
inside a blob), so `masksMeet` returning false proves the intersection is empty. `dirtyReaches`
carries the same reasoning across frames — outside the dirty region both bodies cover what they
covered last frame, so their intersection can only differ at a cell that is dirty AND in both
bodies, and callers must ask this of the OLD masks too or an overlap that VACATED a dirty cell
goes unseen. What survives is the REGION, never the coordinates: clipper's output is a function
of the input vertex list, not of the region it describes, so a change that splits a boundary
edge re-rounds the surviving fragment onto the fixed-point grid and moves a crossing far outside
any dirty cell into the neighbouring integer. Nothing local predicts that, so no spatial reject
can promise identical rings, and every equivalence downstream is stated at clipper resolution
for the same reason. Both claims are property-tested against the clipper itself and
mutation-tested — deleting the fill, or dropping the old-mask term, each fails its own property
— and the old-mask term is pinned at its CALL SITE too, by a fixture where a crossing moves
fully away: the phantom that survives without it is single-cover, so it emits no face and only
the zone state can see it.

`buildOverlapRegions` composes exactly those phases and is the full-rebuild reference the
incremental builder is tested against — **production goes through
`regionIncremental.buildRegionsIncremental`**, which reuses three tiers across frames, each an
identity-proof pure memo: per-line bodies and per-pair zone intersections (a dirty pair whose
intersect comes out content-equal at clipper resolution keeps the cached array and does not
count as changed, and a dirty pair the DIRTY-REACH test clears never runs the intersect at all
— see the occupancy masks above); the zone's component split (a frame re-unions only the
super-region its changed pairs touch, via a per-ring membership index over EVERY component
including sub-sliver ones — membership upkeep is skipped when a frame changes more than a dozen
pairs, since a hub-scale frame unions most of the zone regardless, and forcing it on measures
2x SLOWER at a hub); and per-component faces, seeded from a module-level slot in
`regionCache.ts`. A component is reused only when its own ring hash matches
AND nothing that moved this frame lies near it; the second condition is load-bearing, because a
component's faces depend on the bodies restricted to it and not just on its outline. Face
**spans** are arc-length intervals of stripe-BODY overlap (not center-path containment — a
corner face off its stripes' centers still gets one per cover line, with `mintAnchors`
side-offsetting its anchors onto the face), measured per BAND from that band's own start — and
any band that can contribute a span to a component's face has a unit box overlapping the
component's box, so the same untouched test that proves the polygons reusable proves the spans
byte-identical too; they ride the reuse with no refresh pass. The per-stripe unit hash includes
the **line id**, because `bandKey` is built from sorted ids and two lines swapping stripe slots
is otherwise invisible while inverting the cover of every face the band crosses.

The marker unit hash has the same trap in its own form: it must include the **line end**
(`spec.end`), the one marker field that reshapes the painted footprint while `cx`/`cy`/
`rotationDeg`/`width`/`style`/`outward` all stay put. Miss it and the line never goes dirty, the
previous frame's square-footprint body is reused, and — because `regionGeometrySig` DOES see the
edit — the stale arrangement is then memoized under a cache key that says it is current. The rule
for both: a hash here must cover every input `markerBodyRings` and `stripeBodyPolys` branch on,
not merely every input that moves geometry.

> **Width is GEOMETRY, the stroke is PRESENTATION.** A `width` edit rebuilds band geometry; a
> `strokeWidth`/`strokeColor`/color/style edit is resolved at
> render time and never rebuilds. This split is exploited by the band-geometry memo (see
> Interaction layer).

**`DotStyle`** ([dotStyle.ts](src/model/dotStyle.ts)) — a procedural stop dot. Its **required**
fields (a deliberate divergence from the optional-field convention) let plain deep equality
`dotStylesEqual` work everywhere: `shape: DotBaseShape` (`circle|square|diamond|x|dash`), `fill:
DotFill` (`DayNightColor | 'line' | 'none'`), `strokeWidth` (0 = no stroke), `strokeColor:
DotStrokeColor` (`DayNightColor | 'line'`; **no `'none'`** — strokeWidth 0 expresses "no
stroke"), `strokeAlign: DotStrokeAlign` (`center|inside|outside` — where the stroke sits relative
to the dot's edge; persist v21 backfills the historical `'center'`), and `showServiceCode`. Two
**optional** fields refine the code, both meaningful only when `showServiceCode` and both kept
optional so every preset stays byte-identical. `serviceCodeColor?: DotServiceCodeColor`
(`DayNightColor | 'line'`): **absent ⇒ B/W auto-contrast** (pick whichever of black/white is
legible on the resolved fill), `'line'` paints the code in the owning line's color, a pair gives
an explicit per-theme color. `serviceCodeFirstLetterOnly?: boolean`: **absent ⇒ the whole code**,
`true` prints only its first character — a local/express pair (`"6"` / `"6X"`) drawn as variants
of one line then reads `"6"` on both — leaving the disc at its full code-disc size. Stored only
when ON, so `dotStylesEqual` reads its absence as `false` — the same absent-as-default rule
`strokeAlign` needs so the migration bakes keep value-matching legacy dots.
**Size is deliberately NOT part of style** — it is the orthogonal
`dotSize` / `singletonDotSize` / `multiDotSize` set, so picking a shape preset never clobbers a
size. **`dash` is the outlier shape** — a TfL-style tick protruding from the stripe edge toward
the label rather than a centered glyph. It ignores `dotSize` entirely (its size comes from the
per-line `dashLength` / `dashWidth`, see `Line` below) and of the style fields only `fill`
applies (`strokeWidth`/`strokeColor`/`showServiceCode` are inert). The tick is a **singleton** —
it knows only its own stripe and the label; on interlined stations the "notched" composite tick
is emergent (`geometry/stationDash.ts`), since the derived length equals one line width so
tangent ticks abut exactly. Which side it points is derived from the label anchor
(`dashOutward`, shared with the autoAlign label-clearance in `labelLayout.ts` so the two never
disagree). `DayNightColor = {day, night}` resolves per theme. The clean-persisted convention lives one
level up: in the _presence/absence_ of `StopCell.dotStyle` and `Line.singletonDotStyle` /
`Line.multiDotStyle` (the split singleton-vs-interchange line defaults).

**`LineTag`** — a movable label printed inside a line's color band. Anchored to a **station-pair
corridor**, not a segment index, so it survives line reordering. `id, lineId, fromStationId,
toStationId` (**invariant: `from < to`**, canonical/alphabetic, matching `pairKeyOf`),
`anchorEnd: 'from'|'to'`, `distance` (arc length in world units from the anchor along the stripe),
`orientation: 0|1|2|3` (line-traversal frame), `kind?: 'text'|'chevron'` (undefined ⇒ text).
Right-click cycles all six states: text up→right→down→left → chevron-forward → chevron-reverse.

**`Polygon`** — a free-floating background shape (river, park…), rendered **under all other map
content**, z-ordered against the svg images in the shared `backgroundOrder`. `id, vertices:
Vec2[]` (**world coords, ≥3, ordered; there is no center/rotation
field — rotation rewrites the vertices** around the centroid), `fill, stroke` (`#rrggbb`, or
`#rrggbbaa` when translucent — colors carry their own alpha now), `strokeWidth` (world units,
floored at 0 — the slider caps at 10, but the spinbutton/stored value is unbounded above),
`darkFill, darkStroke` (independent dark-mode colors, **backfilled to equal the light colors**
on load for legacy saves). Optional: `locked?`, `curveRadius?` (floored at 0, slider caps at
50, stored value unbounded above; missing ⇒ 0 = sharp), `closed?` (missing
⇒ true; false = **open** chain: stroke-only, no fill, hit-test follows the stroke).
`PolygonStylePatch` is the shared `Partial<Pick<…>>` used by both the transform and the store
action so they never drift.

**`SvgImage`** — an imported graphic — an `.svg` **or** a png/jpeg raster (the name predates raster
support) — placed as an **opaque** `<image href="data:image/…;base64,…">` in the background band,
z-ordered against the polygons in the shared `backgroundOrder` (so an image can sit under a
polygon, not just over it). `id, x, y` (world **center**), `width, height` (unrotated bbox,
post-scale), `rotation: number` (**continuous degrees CW**, snaps to 22.5° under Shift), `href`
(fixed at import, never edited), `locked?`. Optional: `opacity?` — an SVG-native **0..1** alpha
clamped at both ends, painted onto the `<image>`'s `opacity` attribute; missing ⇒ 1 (fully
opaque) and the attribute is omitted, so an untouched image's exported markup is unchanged. The
popover slider trades in whole **percent** (the doc stores the alpha). Only the artwork fades —
selection chrome and the hit area are unaffected, so a 0% image is still clickable.
`SvgImageStylePatch` is the shared patch type.

**`TextLabel`** — a free-floating, rotatable text annotation rendered **on top** of the map.
`id, x, y` (center), `rotation: Rotation`, `text` (multiline `\n`), `fontSize` (floored at
`TEXT_LABEL_FONT_SIZE_MIN`, snapped to the quarter-unit `FONT_SIZE_STEP` = 0.25 grid every
font-size control shares — the slider caps at 96, but the spinbutton/stored value is unbounded
above and may be a quarter-integer),
`weight: TextLabelWeight`, `italic`, `align: TextLabelAlign` (`left|center|right|justify`;
`justify` flushes both edges), `width?` (column width in world units; `0`/absent = Auto —
sizes to content and honors manual `\n`; `>0` = a fixed-width column that word-wraps, with
`\n` a hard break; clamped to a non-negative integer by `updateTextLabel`), `color/
darkColor` (day/night; **defaults DIFFER**: `#111111` / `#ffffff` for legibility — unlike a
polygon whose dark default equals its light; backfilled on load), `locked?`, plus optional
per-label `leading` (line-spacing multiplier) / `tracking` (em letter-spacing) — station labels
carry their own per-station `leading`/`tracking` (see `Station`); there is no doc-global pair.

**`RouteBullet`** — a free-floating route badge showing one line's service code in its color.
`id, x, y, rotation: Rotation, lineId: LineId | null` (null = unset placeholder), `shape:
RouteBulletShape` (`circle|square|diamond`), `size` (half-extent), `locked?`.

**`TransferAnchor`** (free) + **`AnchorCell`** (station-hosted) — a bare point that exists
only so a `TransferEnd` can bind to it. Two of them (or one plus a station stop) let a transfer
turn a corner: a 90° transfer is two segments meeting at one anchor. **Two homes, deliberately:**
a FREE anchor is `{id, x, y}` in `MapDoc.transferAnchors`, so every consumer that treats it like a
route bullet (group drag/rotate, the align pool, the camera hull) needs no variant narrowing;
a HOSTED anchor is `{id, row, col}` in `Station.transferAnchors?` (omitted when empty), so every
station-layout transform carries it for free — chief among them `rotateStationLayoutBy90`, which
rewrites cells through a local `rotateGrid`. An anchor held in a doc-level record would sit still
while the layout turned 90° around it, tearing apart the very elbow it was placed to make. Ids come
from one factory (`IdFactory.anchorId`) and are unique across both homes.

An anchor's **world footprint is one lattice cell**, `ANCHOR_HALF = STOP_SIZE / 2`
([geometry/orientation.ts](src/geometry/orientation.ts), beside the `STOP_SIZE` it derives from).
That single constant is what both the camera hull (`contentBounds`) and the marquee
(`transferAnchorsForRect`) measure, so a free anchor is **framed and grabbed by the same box** —
they used to compute it independently. It is deliberately **not** the painted disc: `AnchorLayer`
draws that at `ANCHOR_SIZE` = 10.5 (radius 5.25), _smaller_ than the footprint, so the mark reads
as scaffolding beside the stop dots while a near-miss still selects.

Anchors are **editor chrome, never map ink**: `AnchorLayer` mounts inside a `data-export-exclude`
subtree, so an anchor is absent from every SVG/PNG/PDF export while the transfer bound to it still
prints. The View menu's Anchors row (`useViewportStore.showAnchors`) shows them; it **defaults OFF**
(like `showWaypoints`, and persisted) so a finished map isn't cluttered, and its registry entry
carries `nestsUnderNetwork` since anchors are part of the transfer network. The two gestures that
are ABOUT anchors — picking a transfer end (`creating-transfer`) and placing one
(`placing-anchor`) — are its `revealedBy` modes, so they **reveal** anchors regardless of the
toggle by DERIVATION, never by writing the flag: a temporary write would need a matching revert on
every exit path, and a missed one would strand the user's own preference. Anchors are an ordinary
registry citizen in all of this — the reveal and the nesting are entries in `VISIBILITY_ITEMS`,
not a second module's private rule, so `kindVisible`/`kindVisibleNow` answer for them exactly as
for every other kind. The three doc-geometric consumers opt in by hand through
`kindVisibleNow('showAnchors')` exactly as they do for `showNetwork` (`anchorsForRectVisible`,
`liveSnapAnchors`, and `liveSnapHostedAnchors` for the cells a station carries).

There is a **third, narrower reveal** — the one with no menu row, which is why it is the sole
occupant of [anchorVisibility.ts](src/state/anchorVisibility.ts) (`revealedAnchorStations`):
pointing at a station — or selecting it — shows **that station's own** hosted anchors with the
toggle off, so you can see what a station carries without flipping the global switch and back.
Scoped to those stations on purpose; the rest of the network stays clean, and FREE anchors are
never revealed this way (they belong to no station, so pointing at one doesn't ask for them). The
hover half rides on `hoveredChrome`, so it appears and disappears with every other piece of
mouseover chrome and stays quiet mid-pan. **Idle-only**, for the reason the mode list above gives
from the other side: `creating-transfer` and `placing-anchor` already reveal EVERY anchor, and the
layout editor draws its own grab rings on the edited station. This is why `MapCanvas` gates the
anchor block on `showNetwork` and then PICKS the layer's inputs (whole network vs revealed
stations only) rather than gating on `anchorsVisible` — `AnchorLayer` already renders nothing when
both collections are empty, and a hosted anchor is already `pointer-events: none` outside
transfer-picking, so a revealed one can't steal the click meant for the station under it.

The same reveal set does double duty when the toggle is ON: on an idle canvas the whole network
paints, but HOSTED anchors rest at **half opacity** and come forward only while their station is
hovered or selected — so the mouseover still says "this mark belongs to THAT station" even though
everything is technically visible. `AnchorLayer` takes the full-opacity stations as
`dimHostedExcept` (null = no dimming regime: toggle off, the picking modes — where every endpoint
must be fully legible — and the layout editor). Free anchors never dim; they belong to no station,
so no mouseover could bring one forward.

FREE anchors are first-class canvas objects — multi-select, marquee, group drag, group rotate
(orbit-only: the polygon case reduced to a point, no orientation to step), arrow-nudge, Delete —
and are the **first selectable kind with no `locked` field** (`isItemLocked` returns false;
`SelectionPopover` gates Lock-all on a `lockableTotal` that subtracts them, while Delete-all still
counts them). They have **no popover**, but they ARE in `soleSelection` — that selector is also
`hitStack.currentHitEntity`'s source for alt-click cycling, so omitting them would stop the
deep-pick cycling rather than merely suppressing a panel. They are deliberately **not copyable**
(`ClipPayload` has no transfer kind, so a pasted anchor could never carry the transfer that gives
it meaning). HOSTED anchors are station internals like a stop dot: rendered `pointerEvents="none"`
(so alt-click reaches through them), edited only in the layout editor. Removal has two equivalent
doors: the popover's anchor row (×) and the Delete key while the cell is armed
(`selectedAnchorCellId` — the state the "Add transfer anchor" button leaves you in); both go
through `deleteStationAnchor`, which cascades any transfers bound to the cell.

In the lattice they ride as **passengers**: never in `stationLayoutNodes` (whose node identity is
`lineId: string | null`, where null already means "the label", and where a non-`isLabel` node would
become a lattice ORIGIN via `anchorPool`), but appended to `otherNodes` as width-0 blockers
(`anchorBlockerNodes`) so a stop can't be dropped on one. They drag and nudge on the LABEL's exact
parameters (`wSrc = STOP_SIZE`, `gSrc = 0`, `srcIsPoint` — renamed from `srcIsLabel` when anchors
became its second user). A hosted-anchor move **must not** fan out through `dispatchMirrored`:
`matching.ts`'s `stopsKey` ignores anchors, so two stations with different anchor sets still MATCH,
and every target would apply its own rotated delta to the same global anchorId — a 0/2 offset pair
cancels outright and the anchor wouldn't move at all.

**`Transfer`** + **`TransferEnd`** — a styled line connecting one station dot to another.
`Transfer = {id, a: TransferEnd, b: TransferEnd, thickness?, color?, strokeWidth?, strokeColor?}`;
`TransferEnd` is a three-arm **structural** union (no `kind` tag, so the stop arm is byte-identical
to what every existing saved file carries — no migration, no persist bump):
`{stationId, lineId}` (a stop; lineId picks _which_ dot at an interlined station, null ⇒ station
anchor) · `{stationId, anchorId}` (a station-hosted anchor — station-keyed so it resolves in one
lookup) · `{anchorId}` (a free anchor). **Narrow only through
[model/transferAnchors.ts](src/model/transferAnchors.ts)**, which owns all four guards:
`isAnchorEnd` / `isStopEnd` split on `'anchorId' in end`, and `isHostedAnchorEnd` /
`isFreeAnchorEnd` then split the two anchor arms on whether a `stationId` rides along. The subtle
part is that **`'stationId' in end` alone does NOT separate a stop from a hosted anchor** — two of
the three arms carry one — so a hand-rolled `in` check is correct only by accident of where it sits
in an if-chain. Ask the guards; they are total, and a test pins them against the naive spelling. That shared shape is what
keeps the station cascade a one-liner: `endStationId(e) === id` orphans a station's stops AND its
hosted anchors together. World resolution for all three is `geometry/transferEnds.transferEndWorld`,
which returns null for a dangling end — both paint passes and the in-progress preview all go
through it, and dropping the transfer on null is why neither load path needs a
transfer-endpoint sanitizer. **Cascade-deleted** when either endpoint's stop is removed (by
deleting the station/line or removing that line's stop).

A transfer whose two ends are the SAME stop is a **self-transfer**: a zero-length capsule, so it
paints as a disc of the transfer's full width centred on that dot. That is how a stop is folded
smoothly into a thick transfer bar arriving from elsewhere, and it is a real shape with no other
spelling. `addTransfer` still REFUSES the pair (`sameTransferEnd`) — in the two-click flow a repeat
click on the first dot must stay inert — so `addSelfTransfer` is the one deliberate way in, and the
station popover's Xfer picker is its one caller. At most one per stop, by construction: the picker
restyles or deletes whatever `selfTransferAt` finds instead of adding a second. Everything
downstream already reads it correctly — the cascade prunes it with its stop, `capsuleOutlinePath`
degenerates to a circle for the selection ring, and `stopMetrics` indexes both ends onto the one
stop (`bodyDir` null, so the label clears the plain disc). Default styling (thickness, color,
optional halo) comes from the constant `TRANSFER_STYLE_DEFAULTS` — there are **no doc-level
transfer settings** (see the MapDoc note above); the four optional fields are per-transfer
overrides with the dot-style contract — absent ⇒ track the default, and `updateTransferStyle`
drops a value equal to the default. `color`/`strokeColor` are **theme-aware `DayNightColor`s**
(`{day, night}`, the same abstraction dot fill/stroke use) — day paints on the light canvas,
night on the dark; the whole override drops only when **both** halves match the default
(black/black body, white/white outline). `TransferLayer` resolves them to hex per the active
theme via `resolveDayNight`. Map-wide restyling is the designated **Default** transfer
style preset in `doc.styles`, not a doc field
([transferStyle.ts](src/model/transferStyle.ts), `updateTransferStyle`).

**Small unions:** `StopOrientation` (`auto-vertical|auto-ne-sw|auto-horizontal|auto-nw-se` —
pins only the **axis**; the sign falls out of the world tangent from neighbors), `LineStyle`
(`solid|dashed|hatched|hatched-mirror|dotted|dashed-open`), `TextLabelWeight`
(`100|200|300|400|500|700|800|900` — **no 600**, no SemiBold face shipped), `DotShape` (16 legacy
preset ids — **no longer stored**, only the currency of shape pickers and legacy conversion).

> **These listings are a map, not a schema dump.** They name the fields that carry a *concept*
> worth explaining; two things are deliberately elided rather than repeated on every entity.
> **`styleId?`** rides on all six styleable kinds (`Station`, `Line`, `Transfer`, `RouteBullet`,
> `Polygon`, `TextLabel`) with the identical contract — a live link to a `StyleDef` of that kind,
> covering formatting but never identity, detaching on any covered-field edit — so it is spelled
> out under `Station`/`Line` and assumed thereafter. **`editorHeight?`** (remembered inspector
> textarea height; editing-UI only, never rendered) is on both `Station` and `TextLabel`. For the
> exhaustive, authoritative field set read [types.ts](src/model/types.ts) itself.

---

## Serialization, persistence & migration

Files: [serialize.ts](src/model/serialize.ts), [store.ts](src/state/store.ts) (`migrateDoc`).

### The governing strategy: defaulting-by-merge, NOT normalization

There is **no `normalizeDoc()`**. Absent fields fill from `DEFAULT_DOC`. The small number of
value-level fixups are **shared exported functions** — `sanitizeStations`, `backfillLineNames`,
`backfillPolygonDarkColors`, `backfillTextLabelColors`, `convertLegacyDotShapes` — each returning
`{...cleaned, changed}`, where the **`changed` flag is the signal** callers use (`migrateDoc`
re-spreads a field only when `changed` is true), and each called by **both** load paths.
(The two palette fixups are the exceptions, and neither returns a `changed` flag: both callers
assign `bakeActivePalettes`' bare `Palette[]` outright, each under its own presence gate — parse
when the file has `activePalettes` and no `palettes`, `migrateDoc` at `v<24` with `palettes` absent.
`sanitizePalettes` is **file-import only**, deliberately: it exists to keep a hand-edited or
foreign `.massimo.json` from reaching the renderer as garbage, and localStorage has no such author
— the app is its only writer, and the "≥1 valid palette" repair that used to run there
unconditionally was guarding dangling _ids_, which copies cannot have. Adding it to `migrateDoc`
would not close the gap either: a doc already at v24 never reaches `migrate` at all.)
Most dict-level backfills allocate a fresh container even on a no-op, so don't
rely on their reference identity — but not all: `convertLegacyDotShapes` hands back its **input**
references when `changed` is false. (The per-line / per-dot sanitizers _do_ return the same element
ref when unchanged — distinct from the transform "same-reference-on-no-op" invariant.)

**`sanitizeStopDotSizes` is NOT one of the shared pair** despite sitting beside them: its only call
site is inside `parse()`. It belongs to the file-only sanitizer family below, and `migrateDoc` does
not import it.

### Two load paths (keep them in sync)

**Path A — file import: `parse(json, custom)`** ([serialize.ts](src/model/serialize.ts)). Used
by the **Load…** menu. Pure, returns `{ok, doc}` or `{ok:false, error}` — and **never throws**:
the pipeline runs inside a catch that turns any internal failure into `{ok:false}`, because the
load handlers only surface a ParseResult (a raw throw out of the async file handler reads as a
silent no-op load). A generated or hand-edited file splits two ways: map SUBSTANCE of the wrong
shape refuses the whole file with a message naming the entity (step 1's gate), while ABSENT
fields heal to defaults and broken REFERENCES are dropped or rebuilt from the redundant encodings
the file itself carries (steps 3, 5, 6b/6c) — repair over guesswork, error over silent loss:

1. `JSON.parse`; reject non-object / `format !== 'massimo-map'` / missing `doc`. Then the
   substance shape gate (`docShapeError`): a collection of the wrong container type, a station
   entry that isn't an object, a non-finite coordinate/rotation/cell, a non-array
   `stops`/`stations`/`edges` — each refuses the whole file. (`palettes` and `styles` stay out of
   the gate: their sanitizers have always healed garbage wholesale, and that behavior is pinned.)
2. Two bakes **before** the merge: `migrateLegacyLabelBold` (so `labelBold` never leaks into the
   typed shape) and `bakeLegacyBackgroundOrder` (retired `polygonOrder` + `svgImageOrder` → the
   single `backgroundOrder`). The second MUST precede the merge — the merge fabricates
   `backgroundOrder: []`, and the bake is keyed off field presence, so afterwards it would find a
   `backgroundOrder` already there and discard the legacy stacking.
3. `merged = { ...DEFAULT_DOC, ...doc }` — the entire defaulting mechanism — then
   `repairCoreShapes`, its per-entity twin: ABSENT substance fills with defaults (stops `[]`, the
   plain legacy label, sparse stop cells to the origin, `service` ← the record key, the fallback
   line color), and rotations snap onto the octant ring.
4. `sanitizePalettes` if the file carries `palettes`, else `bakeActivePalettes` if it carries the
   retired `activePalettes` ids — a file with neither keeps the `DEFAULT_DOC` seed. Then
   `bakeDocCurveRadius` (retired doc-level `curveRadius` → per-line `Line.curveRadius` + fill line
   style defs; idempotent, keyed off field presence) and `stripRetiredSeamFields` (the retired
   seam trio leaves lines, line style defs and the doc key together) — **before** the per-line
   clean and style validation below, which expect the per-line/per-def form.
5. Per-line topology normalize — `backfillLineEdges` (derive `edges` from the legacy `stations`
   order for pre-topology saves — unconditional, since a missing `edges` white-screens the
   renderer) → `sanitizeLineTopology` (canonicalize hand-written edge keys to `pairKeyOf` order
   and drop malformed/self/duplicate edges and non-string/duplicate members — `segmentStyles`
   keys ride the rewrites). ONLY topology: the override + value clean waits until step 6d, so
   segment styles and end pins are judged against the REPAIRED topology/membership rather than
   the pre-closure one — which ate pins the closure was about to legitimize, and kept styles on
   edges it was about to drop (a non-idempotent parse).
6. `sanitizeStations` (legacy orientations + `valign:'auto'`→`'auto-down'`) → `snapStationCells`
   (stop/label/anchor cells within 1e-9 of an integer snap onto it — the drift the old
   trig-rotated ghost lattice wrote; ±k·√2/2 and width-derived pitches are real coordinates and
   are left alone), then the two referential repairs:
   - 6b. `repairLineLinkages` — the closure over the three encodings of "line L serves station
     S": stops of dead lines and duplicate same-line stops drop; edges with a dead endpoint drop;
     membership rebuilds as surviving order + edge endpoints + stop-bearing stations; a member
     station missing its stop gets one synthesized at the origin cell. The motivating case: a
     generated file with full `edges` but `stations: []` renders (bands key off edges) yet is
     uneditable (every editor works off membership).
   - 6c. `sanitizeDocReferences` — inner ids ← record keys everywhere;
     `lineOrder`/`backgroundOrder` deduped + reconciled against their records; every decoration
     whose references or required numbers can't be honoured drops (a lineTag off a dead pair, a
     transfer with a dead end, labels/polygons/images/free anchors with non-finite substance) or
     heals where a legitimate "unset" state exists (a route bullet's or transfer end's dead line
     → null; reversed tag endpoints → canonical order with `anchorEnd` flipped); wrong-typed doc
     scalars take their DEFAULT_DOC value.
   - 6d. The per-line override + value clean, now judged against the final topology/membership:
     `sanitizeSegments` (drop segment keys that aren't real adjacencies) → `sanitizeLineEnds`
     (drop pins for non-members and values at the line's own end default) → `sanitizeLineWidth` →
     `sanitizeLineCurve` → `sanitizeLineStroke`, each clamping to the canonical grid and dropping
     never-stored defaults — then `backfillLineNames`. **Dot size is deliberately NOT cleaned
     here**: its drop-at default is style-aware (a service-code disc defaults to 12, not 8), so it
     needs the baked split dot styles and runs as a **second per-line loop**
     (`sanitizeLineDotSize`) after step 7 — see step 7b.

   Then `sanitizeImageHrefs` (drop every svg image whose `href` is outside the inline-data
   allow-list, and its `backgroundOrder` entry with it — see "Every image href is inline data"),
   then `sanitizeRegionAssignments` (region-assignment hygiene — validates against the **cleaned**
   lines: dangling line ids drop the assignment, dangling pairKey anchors survive for reconcile).
7. `convertLegacyDotShapes` (preset ids → `DotStyle`) — **runs after** the line/station passes.
   Then `bakeLineDotDefaults` (retired single `defaultDotStyle`/`defaultDotSize` → the split
   `singletonDotStyle`/`multiDotStyle` + sizes, on lines AND line style defs) — **after**
   `convertLegacyDotShapes` (which materializes `defaultDotStyle` from any legacy `defaultDotShape`)
   and **before** the singleton-aware `sanitizeStopDotSizes` + style validation below.
   - 7b. `sanitizeLineDotSize` — the deferred per-line dot-size loop from step 5, run here because
     its drop-at default is style-aware and must see the baked split dot styles.
8. `sanitizeStopDotSizes` — **must run after** the per-line pass AND the dot-defaults bake (a stop
   compares against the _sanitized_ line default for its own singleton/shared case). Then
   `bakeStopDotLibrary(doc, hadStyles)` (seed the "Stop dots" library + tag every dot slot by
   value-match) — **before** `sanitizeStyles`, so the seeded defs are sanitized and the invariant
   pass sees the non-empty `stopDot` kind. Note the **two-part** no-op gate: it skips only when the
   FILE carried a `styles` record _and_ the merged doc already has `stopDot` styles. Testing the
   merged doc alone would short-circuit the bake on exactly the pre-Styles files it exists for —
   see the `hadStyles` gotcha below.
9. `backfillPolygonDarkColors`, then `foldPolygonFillOpacity` (legacy polygon `fillOpacity` → the
   alpha of `fill`/`darkFill`; **after** the dark-color backfill so `darkFill` exists to fold),
   then `backfillTextLabelColors`.
10. `sanitizeStyles` (validate/clamp style defs, per-kind name dedupe, id ← record key; its
    per-dot `sanitizeDotStyle` also defaults an absent `strokeAlign` to `'center'`) then
    `ensureStyleInvariants` (≥ 1 style per kind — factory Defaults injected into empty kinds —
    a `styleDefaults` entry resolving per kind, and every line style's dot-TYPE ids naming live
    `stopDot` styles). **Before** the transfer bake, which seeds the _designated_ default
    transfer style. Order matters for the third: `sanitizeStyles` runs first and heals an
    ABSENT dot id to the module constant `stop-filled-black`, which a map whose library no
    longer holds that preset would otherwise carry away as a dangling ref.
11. `bakeLegacyTransferSettings` (retired doc-level transfer settings → per-transfer overrides;
    idempotent, keyed off field presence) then `sanitizeTransferStyles`, then
    `bakeLegacyLabelSettings` (retired doc-level station-label settings → per-station typography +
    seed the designated default station style; idempotent, keyed off field presence).
12. `migrateLegacyBulletSyntax` — gated on the **file's own** `version < 2` (the one version-gated,
    non-idempotent step in Path A).
13. `pruneDanglingStyleRefs` — **last**, so dangling / wrong-kind / value-mismatched `styleId`
    tags compare fully-sanitized items against fully-sanitized defs.
14. `adoptDefaultStyles` — **only for files with no `styles` record at all** (pre-styles saves):
    untagged items whose values match their kind's designated default get tagged, so the Styles
    panel's Default editors act on the whole loaded map.

Path A does **more** than Path B because hand-edited files can be non-canonical (the file-only
sanitizers `sanitizeLineWidth/Stroke/DotSize/Segments/StopDotSizes` exist for this).

**Path B — localStorage rehydration: `migrateDoc(persisted, version)`** ([store.ts](src/state/store.ts)).
The zustand `persist` config: `name: 'vignelli-map-doc-v1'`, `version: 23`, `migrate:
migrateDoc`, `partialize: pickDocSnapshot`, plus a **custom `merge` hook** (below). Because the persist-merge already fills absent fields
from the initial state, `migrateDoc` only does **value-level legacy fixups, version-gated**, on
disjoint fields (order immaterial except where noted), never mutating the input:

| Gate        | Fixup                                                                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --- | ------------------------------------------------------ |
| `v<1`       | `backfillLineNames` (`"${service} line"`)                                                                                                  |
| `v<3`       | `labelBold:boolean` → `labelWeight` (700/400; explicit weight wins)                                                                        |
| `v<4`       | `sanitizeStations` (legacy stop orientations; `valign:'auto'`→`'auto-down'` — both fold into one runtime gate)                             |
| `v<5`       | `backfillPolygonDarkColors`                                                                                                                |
| `v<6`       | `backfillTextLabelColors`                                                                                                                  |
| `v<7`       | `convertLegacyDotShapes` (preset ids → procedural `DotStyle`)                                                                              |
| `v<8`       | `migrateLegacyBulletSyntax` (legacy `<X>` circle bullets / unescaped pipes → `                                                             | X   | ` inline-token syntax, on station names + text labels) |
| `v<9`       | `foldPolygonFillOpacity` (legacy polygon `fillOpacity` percent → the alpha of `fill`/`darkFill`; runs after the `v<5` dark-color backfill) |
| `v<10`      | `migrateV9Styles` (rebuild round-1 style defs on the canonical grids, materialize an explicit `styles` record), then — **after** the style-invariant pass below — `bakeLegacyTransferSettings` |
| `v<11`      | `adoptDefaultStyles` (tag untagged, default-looking items — mirrors Path A's step 14)                                                      |
| `v<12`      | nothing of its own — the bump just forces pre-designation storage through migrate so the style-invariant pass backfills `styleDefaults`    |
| `v<13`      | `backfillTransferDayNightColors` (transfer per-transfer overrides + transfer StyleDef props: legacy single-color strings → `{day, night}` pairs) — ordered **after** the `v<10` bake, **before** the `v<11` adoption (which now compares transfer props by `.day`/`.night`) |
| `v<14`      | `bakeLegacyLabelSettings` (retired doc-level `labelFontSize/labelWeight/labelItalic/labelLeading/labelTracking` → per-station typography + seed the designated default station style) — ordered **after** the `v<3` `labelBold`→`labelWeight` step (so it sees the materialized weight) and the edge/style invariant passes |
| `v<15`      | the **layering rework**: `stripLegacySegmentLayers` (drops the retired per-segment `segmentLayers` field from lines) + `sanitizeRegionAssignments` (region-assignment hygiene — a pre-v15 doc has none, but a tampered/newer-build one might). Path A runs `sanitizeRegionAssignments` unconditionally |
| `v<16`      | `bakeDocCurveRadius` (retired doc-level `curveRadius` → per-line `Line.curveRadius` + line-style-def fill). Ordered **before** the `v<10` style hygiene — `migrateV9Styles` rebuilds defs on the canonical grids, so a def missing `curveRadius` would heal to the constant default instead of the doc's legacy value. Idempotent, keyed off field presence |
| `v<17`      | `bakeLegacyBackgroundOrder` (the retired `polygonOrder` + `svgImageOrder` → the single `backgroundOrder`, polygons concatenated first — exactly the stacking the two separate arrays painted, so a legacy map renders unchanged). Each side is reconciled against its records before the concat. Idempotent, keyed off field presence; reference-stable when neither retired key is present |
| `v<18`      | `bakeLineDotDefaults` (the retired single `defaultDotStyle`/`defaultDotSize` → the split `singletonDotStyle`/`multiDotStyle` + sizes, on lines AND line style-def props — every stop used one default, now both the singleton and interchange cases carry it, so a legacy map renders unchanged). Ordered **after** the `v<7` `convertLegacyDotShapes` (which materializes `defaultDotStyle` from any legacy `defaultDotShape`) and **before** the `v<10` style hygiene, same as `bakeDocCurveRadius`. Idempotent, keyed off the retired keys' presence |
| `v<19`      | `bakeStopDotLibrary` (introduce the doc-scoped "Stop dots" style library: seed the factory dot styles and tag every dot slot — line split defaults + per-stop overrides — by value-match). Ordered **after** the `v<18` split bake (line values are in singleton/multi form) and **before** the style-invariant pass |
| `v<20`      | dot **type** became a covered `LineStyleProps` field: `bakeLineStyleDotIds` (backfill `singletonDotStyleId`/`multiDotStyleId` on line style defs, absent ⇒ the `stopDot` ⭐ default), then `pruneLineDotTypeTagMismatches` (untag any line whose split dot type differs from its now-fuller line style — keeping "tagged ⇒ matches"). Ordered **after** the `v<19` library bake; Path A prunes this via `pruneDanglingStyleRefs` instead |
| `v<21`      | `backfillDotStrokeAlign` (`DotStyle.strokeAlign` became a required field: backfill `'center'`, the historical SVG-native placement, across every dot-style home). Path A covers this via `sanitizeDotStyle` |
| `v<22`      | `backfillLineStyleEndStyle` (the line **end** became a required covered `LineStyleProps` field: heal absent/garbage `endStyle` on line defs to `'square'`, the historical full marker square, so nothing repaints). No tag prune follows — a line from those saves carries no end of its own, so it already paints what the heal writes. Path A covers this via `sanitizeStyleProps` |
| `v<25`      | `stripRetiredSeamFields` (the branch seam retired outright — self-overlaps are region faces now): `seamColor`/`seamWidth`/`seamEdges` leave every line AND every line style def together, plus any doc-level `seamEdges` remnant, so tagged wearers stay tagged; junctions come back with the branch-arm default in front — the old "Branch" seam look |
| (not gated) | `backfillLinesEdges` whenever `lines !== undefined` — **not** `v<14`-gated: an intermediate build bumped the persist version to 14 and re-saved lines BEFORE they carried `edges`, so a `v<14` gate could never recover those (`ln.edges.join(...)` white-screens on load). Reference-stable when every line already has an array. **But see the `merge` hook** — this call alone is not "every rehydrate" |
| (not gated) | `ensureStyleInvariants` whenever `styles !== undefined` — ordered between the `v<10` hygiene and the bake (the bake seeds the _designated_ default transfer style; adoption stamps designated defaults) |
| `v<24`      | `bakeActivePalettes` (retired `activePalettes` ids → the palette COPIES the map carries). Built-in ids resolve through `LEGACY_BUILTIN_IDS`; `custom:` ids resolve against the palette library by slugged name, the only place those definitions ever lived. Ids resolving to neither are dropped, and a map left carrying none is a legitimate outcome. Gated on `palettes` being absent as well, so it can never overwrite real palettes |
| (not gated) | `snapStationCells` whenever `stations !== undefined` — cell drift is not tied to a schema bump, so a gate could never catch it. **But see the `merge` hook** — for this repair that caveat is the main event, not a footnote |
| (not gated) | `sanitizeImageHrefs` whenever `svgImages !== undefined` — the guard had one caller (the clipboard) and neither doc load, so a remote href could be persisted at ANY version. **But see the `merge` hook** — same reasoning as `snapStationCells` |

A **corrupt/missing version is treated as v0** (all migrations run). The four non-gated repairs
(`backfillLinesEdges`, `ensureStyleInvariants`, `snapStationCells`, `sanitizeImageHrefs`) are
**not** tied to a schema bump — they run any time their field is present (an absent field is left
for the persist-merge).
`bakeActivePalettes`, which is gated, reads `useCustomPalettes.getState().palettes` to resolve
legacy `custom:` ids — the only place in either load path that reaches into a store.

> **`migrateDoc` does not run on every rehydrate** — zustand calls `migrate` only when the STORED
> version DIFFERS from the config version. A doc stranded at 14 by that intermediate build is
> already _at_ the version it claims, so it skips `migrateDoc` entirely, ungated repairs included,
> and the renderer crashes on `ln.edges.join(...)`. That is why the persist config carries a custom
> **`merge` hook** which runs the must-always-hold repairs — `backfillLinesEdges`,
> `snapStationCells` and `sanitizeImageHrefs` — **on every rehydrate**, whatever the version says.
> `migrateDoc`'s own ungated calls cover the version-changed path; `merge` covers the rest. All
> three are reference-stable on a canonical doc, so it still passes straight through the default
> merge. A must-always-hold invariant belongs in that hook, **not** in the ungated block in
> `migrateDoc` alone. `snapStationCells` shows why the distinction is not academic: the docs
> carrying cell drift were saved by the CURRENT build at the CURRENT version, so they are precisely
> the ones `migrate` never sees — and a remote image href is the same shape.

> **Do not "simplify" the two paths into one.** `storeMigrate.test.ts` pins reference-equality
> pass-through for already-canonical docs (`expect(out).toBe(input)`); adding a file-only width
> sanitizer to `migrateDoc` would break that. They share helper _functions_, not call sequences.

### Save / startup

- **Export → JSON** = `serialize(pickDocSnapshot(state))` → `${basename}.massimo.json`. A
  download is an export; **Save version** writes to the library instead. `serialize` does **no**
  sanitization (writers are canonical by construction; transforms maintain canonical form on every
  set). Every door where bytes LEAVE the app — this export, Save version, Save a copy, and the
  auto-save — first runs `auditExportDoc` ([exportAudit.ts](src/state/exportAudit.ts)):
  `auditDoc`'s referential audit ([docAudit.ts](src/model/docAudit.ts)), where any violation means
  an app writer corrupted the live doc. The bytes are still written — user work is never held
  hostage to a bug — but the failure surfaces as a persistent error toast now instead of a mangled
  file on some future load. Tests hold the complementary contract: `parse()` output always audits
  clean, and app-legal states (stopless stations, degree-0 members, region anchors awaiting
  reconcile) are not violations.
- **Startup**: no explicit load in `App.tsx` — zustand `persist` rehydrates from localStorage on
  boot, running `migrateDoc`.
- **Load → JSON…**: `parse(text, libraryPalettes)` then `adoptParsedDoc()` (below). The library
  is consulted only to resolve a LEGACY file's `custom:` palette ids; a current file is
  self-describing.
- File basename: `${sanitizedName} - v${version}` (clean) or `${sanitizedName} - v${version}d`
  (dirty — edited since that library version was saved), shared by every export via
  `mapFileBasename(name, version, dirty)` ([exportCanvas.ts](src/export/exportCanvas.ts)). A map
  with no library version yet — a fresh New map, or a loaded JSON file — has no number to stamp, so
  it falls back to a `YYYY-MM-DD` date stamp (the `dirty` flag is meaningless there and ignored).
  The map name leads so successive saves group together; it falls back to the literal `map` only
  when the name is empty or all-illegal after stripping filename-hostile characters.

### The map library ([mapLibrary.ts](src/state/mapLibrary.ts))

In-app saved maps with version history, in **IndexedDB** (`massimo-library`, schema **v3**). Reached
via Canvas → Save version and Canvas → Load → From library…

- **A row IS a file.** `payloads` holds opaque `serialize()` output, verbatim; loading goes
  through `parse()`. The module imports nothing from the model and knows nothing about `MapDoc` —
  so this is **not** a third ingestion path. Storing the structured object instead would bypass the
  version envelope (IndexedDB structured-clones, so the temptation is real).
- **Three unrelated things are called "version"**; only the first is a library concept. A row's
  `version` = the user-facing handle, the v32 in the toolbar. The **doc's** version = the schema
  stamp inside the payload string, owned by `serialize`/`parse` and never read here.
  `DB_SCHEMA_VERSION` = IndexedDB's own stamp, private to the upgrade path.
- **Schema (v3)**: `maps` (keyPath `id`; name, updatedAt, `createdAt`, optional `starred: true`,
  `nextVersion`) · `versions` (autoIncrement `id`, index `mapId`; savedAt, `source: 'user'|'auto'`,
  `version`, optional `name`, optional `starred: true`, thumb) · `payloads` (`id` === the version
  row's id; the JSON). Payloads are split off so listing never drags 256 KB/map through a clone.
  `saveVersion`'s upsert spreads the previous map row first, so the star and `createdAt` ride
  across every save rather than being shed by a freshly built row.
- **`nextVersion` is a counter, not a derivation.** A version number is a **handle** ("open v32"),
  so it must never move and never be reused — and every derivation moves it. `max(version) + 1`
  re-issues v3 the moment v3 is deleted; a count renumbers the map's whole history the first time
  the prune policy runs. The counter only climbs: `deleteVersion` deliberately leaves it alone (v3
  is spent forever), while `deleteMap` drops it along with the map's rows and payloads — an id
  that somehow returned would start at v1, which is not a reuse, because that map no longer exists.
- **v1 → v2 upgrade**: renames `revisions` → `versions` and backfills the numbering v1 never had —
  `version` per row (assigned in **id** order: the v1 id autoIncremented once per save, so it is
  chronological and stays total where two saves shared a millisecond, which `savedAt` does not) plus
  each map's `nextVersion`. Every row is carried across **with its original id**. Payloads are keyed
  by that id, so re-adding rows and letting the new store's generator mint fresh ones would orphan
  every payload in the library: each map would still list its whole history, and every entry in it
  would fail to open. Passing the id back through an autoIncrement store also drags the generator up
  past it, so the first save after the upgrade cannot collide with an inherited row. It stamps
  `createdAt` while it is rewriting every map row anyway, so a v1 library upgrades straight to v3.
- **v2 → v3 upgrade**: stamps `createdAt` on every map row — the earliest surviving version's
  `savedAt` (pruning may have taken older autos, so that is the best signal left), falling back to
  `updatedAt` for a map with no versions. Runs only when the database is exactly v2.
- **Keyed by a minted library id**, never by name — **two maps may share a name**, and a rename
  can't orphan history.
- **`onblocked` rejects rather than hanging.** Another tab holding an older schema open stalls the
  upgrade; every tab closes on `versionchange`, so reaching this needs one that never got to (frozen,
  bfcached). Unhandled, the open request settles NEITHER way and every save waits on a promise that
  never resolves — a silently dead Save menu instead of a message. Only reachable as of v2: v1 was
  the schema at creation, so no open request ever had an upgrade to be blocked on. The rejected
  request's late `onsuccess` closes its handle (an open connection is exactly what blocks the *next*
  upgrade) and `dbPromise` is nulled, so a retry re-opens once the other tab goes.
- **Promises settle on the transaction, never on a request.** The new row's id appears at the `add`
  request's `onsuccess`, which is where one reaches for `resolve` — but the transaction has not
  committed there, so a quota abort would be reported as a successful save and New would wipe a doc
  whose version does not exist. `saveVersion` resolves on `tx.oncomplete`, rejects on
  `onabort`/`onerror`. Pinned by a test that drives a real abort.
- **Prune policy**: `AUTO_VERSION_LIMIT = 50` per map, oldest-first, with their payloads inside the
  save's transaction. It takes only **prunable** rows — `source === 'auto' && !starred && !name`.
  An explicit save, a star and a name are all the same act ("keep this"), so **none of them is ever
  pruned**, however many there are. The cap counts only prunable rows, so protected versions never
  eat the budget — you keep a full 50 autos either way.
- **Star / name** (`setVersionStarred` / `setVersionName` / `setMapStarred`): read-modify-write on
  the row; a row that's gone is not an error (the dialog can be looking at a list a delete has moved
  past). All are **absent-when-off**, never `false`/`''` — a blank name is *deleted*, which keeps the
  row honest and is what `isPrunable` reads. **A star is a tag, never a position**: `listVersions`
  sorts plain **newest-first** (`id` breaking a same-millisecond tie, so the order is total), and a
  starred row sits wherever the order puts it. What the tag buys you is the dialog's per-column
  **star filter**, plus — for a version — the shield from the prune policy. A **map's** star is the
  filter alone (maps are never pruned).
- **Map ordering**: the pure `sortMaps(rows, sort)` owns what each mode means
  (`'updated' | 'created' | 'name'`, ties → newest-edited), while the chosen mode **and each
  column's star filter** are view preferences in `useLibraryPrefs`
  ([libraryPrefs.ts](src/state/libraryPrefs.ts), persisted localStorage — the labelEditorPrefs
  pattern). `listMaps` itself keeps returning newest-touched first; the dialog applies `sortMaps`,
  then the filter — so a filtered list keeps the chosen order. The selected map is looked up
  **before** the filter, so hiding its row never blanks the versions column beside it.
- **The pointer lives outside both** ([libraryPointer.ts](src/state/libraryPointer.ts)).
  `useLibraryPointer` holds `{ mapId, version }` — which library map the live doc belongs to, and
  which version it **came from** (not a claim about the canvas now: edit after opening v32 and it
  still reads v32 until the next save mints v33). Outside the **doc** because a downloaded file
  carries no id, so load-file → save-to-library forks a **new** map (as re-uploading a downloaded
  doc would) — and no `MapDoc` schema change. Outside **mapLibrary** because that module owns
  IndexedDB and knows nothing about React; this is a two-field pointer the toolbar re-renders on.
  Both halves move together, keeping the two states that matter distinct: a fresh map (`mapId` set,
  `version` null — nothing saved under it yet) vs. a loaded JSON file (both null — not a library
  map at all).
- **Persisted as JSON** under `localStorage['massimo-library-pointer']` (zustand `persist`). #265's
  bare string under `massimo-library-current` is **adopted once on boot, then the key is removed** —
  so an afternoon's saves don't fork a new map the first time this build runs, and it can only
  happen once. The adopted `version` is left null on purpose: nothing recorded which version that
  doc came from, and a guess would put a wrong number in the toolbar. JSON also retires the old
  `setItem(k, null)` trap (it stored the *string* `"null"` — truthy, and it survived `??`); with a
  JSON codec that is structurally impossible.
  - **Write the id through, THEN retire the key** — the order is load-bearing. `persist` writes on a
    *change* and skips the initial state when storage is empty, so an id adopted into the initial
    state lives in memory and nowhere else; retire the key beside it and one reload with nothing
    saved in between loses the map. The write is guarded on the adopted id having actually won the
    merge, so a real persisted pointer is never clobbered by a legacy key that outlived it. The
    failure needs a *reload* to show, so it hides from any test that only checks the boot.
- **The pill** ([MapVersionPill.tsx](src/components/MapVersionPill.tsx)) renders the pointer's
  `version` as a grey `.map-version-pill` beside the map name — and **shows nothing** when it is
  null: not "v0", not an empty pill. A pill showing a number the library cannot resolve is worse
  than no pill. The box stays mounted though (`data-empty` → `visibility: hidden`, with a `min-width`
  reserve), so a map's first save mints its version without shifting the toolbar — an unmount
  re-clamps scrollX in a narrow window, the same jolt the save-dot placeholder avoids. Beside it,
  the same component renders the **save-status dot** (below) whenever the doc is not clean — pill or
  no pill.

### The save baseline + tri-state status ([saveBaseline.ts](src/state/saveBaseline.ts))

`useSaveBaseline` holds what the live doc would have to look like to count as saved: the **bytes**
last written to the library or adopted from a load (`baselineJson` — drives the auto-save's exact
dedup gate), the **doc-field references** captured at that same moment (`baselineSnap` — drives the
reactive signal), and `backed` (do those bytes exist as a library version, or did they merely come
from a load?). `saveStatusOf` folds them into a tri-state:

- **`clean`** — references equal the baseline and `backed`: the canvas byte-for-byte matches a
  library version. **Save version is greyed out** (a save could only mint a duplicate) and no dot
  shows.
- **`dirty`** — references differ, or no baseline at all (which errs toward "save me"). Red dot
  (`--danger`), Save armed.
- **`unsaved`** — references equal the baseline but not `backed`: a loaded JSON file or a fresh
  New. Blue dot (`--accent`), Save armed — saving **imports** it as a new map (or mints an empty
  v1; saving an empty doc is allowed). This is the state that keeps load-file → save-to-library
  alive under the grey-out.

Load-bearing details:

- **The reference compare is undo-aware for free.** zundo snapshots share field references and
  undo restores them verbatim, so 3 edits + 3 undos compares equal again — the same
  transforms-allocate-only-on-change invariant the undo stack itself rests on. ~20 reference
  compares per doc change; no serialization on the drag path. Primitive `DOC_FIELDS` (name,
  darkMode…) compare by value, so a toggle-on/toggle-off round-trip reads clean without undo.
- **`markSaved`/`markAdopted` take `(json, snap)` captured together, BEFORE any await** — an edit
  landing while a save is in flight is not vouched for, and the doc stays dirty.
- **The baseline survives a refresh by hash.** `markSaved`/`markAdopted` persist
  `{hash(json), backed}` under `localStorage['massimo-save-baseline']`; on boot the rehydrated doc
  is re-serialized and compared (`bootBaselineState`). Match → baseline restored (blue survives a
  refresh too); mismatch → unset, which reads dirty — the erring direction that keeps data. The
  bytes themselves are not persisted (svg images carry data URIs; doubling the doc's footprint).
  With nothing recorded at all, an **empty** doc adopts itself as unsaved (a first boot shows the
  same blue a virgin New does), a non-empty one errs dirty.
- **A dirty reload recovers its Revert target from the library** (`bootRecovery`). A hash mismatch
  with a recorded `backed: true` means the baseline's bytes went down with the refresh but still
  exist as the library version the pointer names: fetch that payload, rebuild `(json, snap)` the
  way adoption does (DEFAULT_DOC merge → pick → serialize), and restore it **only if its hash IS
  the recorded one** — a stale pointer, a pruned row, or a format an app update now serializes
  differently declines, staying unset. Only the baseline store is written (the doc is untouched,
  status stays dirty); gates re-checked after the awaits so a mid-fetch save/load/`markUnbacked`
  keeps ownership.
- **`markUnbacked` (a delete under the live doc) nulls the baseline** rather than keeping it with
  `backed: false` — deliberately reading **dirty, not blue**: those bytes now exist nowhere but
  the canvas, and the auto-save's byte gate must not skip them (see below).
- **Undo-to-clean survives a refresh** because `undo`/`redo` flush persist (see _Undo/redo_
  below): the reverted doc reaches `localStorage`, so on boot its re-serialized hash still matches
  the saved baseline and the dot stays quiet. Without the flush, edit → undo → refresh would
  resurrect the edit from `localStorage` and read dirty.

### Document switches: `adoptParsedDoc` + `autoSaveCurrent` ([Toolbar.tsx](src/components/Toolbar.tsx))

Every path that replaces the live document — **New**, Load → JSON…, Load → From library — goes
through both, so none can drift:

- `adoptParsedDoc(doc, backed)`: selection resets → `loadDoc(doc)` → `clearHistory()` (which
  cancels any open history group _and_ wipes both stacks — undo must not splice two different
  documents, deliberately more than a bare `temporal.clear()`) → `fitCameraToDoc(doc)` falling
  back to the origin whenever the fit declines → anchor the save baseline to the **post-load store
  state** (`markSaved` when the bytes came from the library, `markAdopted` for a file or New — the
  difference between starting clean and starting unsaved-but-armed).
- `autoSaveCurrent()`: writes an `'auto'` version first. **Nothing that replaces the document may
  lose it.** It **throws** on storage failure and every caller aborts its switch — the auto-save is
  the whole backstop for New, which is not undoable.
  - The content gate is `serialize(...) === EMPTY_DOC_JSON` — an exact byte compare covering every
    `DOC_FIELDS` entry by construction, so a new field is covered the day it is added. **Do not**
    substitute `computeContentBounds`: that is a *camera hull* which reads 5 of them and omits
    lines deliberately, so a map whose work is entirely lines would read as empty, write nothing,
    and be wiped. Three clicks away (Add line ×2, Esc).
  - The dedup gate compares against the **retained baseline bytes** (`baselineJson`, saveBaseline.ts),
    not a DB read: id-keyed dedup is structurally inapplicable on the file-load path, which nulls
    the id. The byte compare deliberately ignores `backed` — an unedited loaded *file* is skipped
    ("browsing files deposits nothing"; the doc is safe on disk) even though it reads `unsaved`.
  - **A delete in the library nulls that baseline** (`markUnbacked`, called by the dialog), or the
    gate vouches for bytes that no longer exist and New — which is not undoable and clears
    history — wipes a document that is then in no file, no library row and no undo stack. It fires
    on **two** paths: deleting the live doc's map, and deleting the one *version* it came from
    (where the pointer deliberately does not move at all, so nothing else marks the loss). Nulling
    is a signal, not an inference: a cleared pointer looks identical to opening a JSON file, and
    *that* document is safe on disk. Pinned by an e2e test, because the delete happens in the
    dialog and the auto-save in the Toolbar — only the real pair over real IndexedDB proves they
    agree.
  - `onOpenVersion` reads and parses the payload **before** the auto-save, as the file-load path
    does. The auto-save writes an `'auto'` under the same map and prunes in the same transaction,
    and a well-used map sits at *exactly* `AUTO_VERSION_LIMIT` prunable autos — so the 51st prunes
    the oldest, which is the row at the bottom of the list the user just clicked Open on. Fetching
    first puts the bytes in hand before the prune can take them.
  - It deliberately does **not** move the pointer — it runs while a document is on its way *out*,
    and the map it writes keeps its history and stays reachable from the dialog, which is the whole
    job. Each caller then points at whatever is coming *in*: **New** → `(newMapId(), null)` (an id
    to save under, nothing saved yet), Load → JSON… → `(null, null)`, Load → From library → the
    opened row's `(mapId, version)`. **Save version** is not a switch: it sets
    `(id, saved.version)` itself and re-anchors the baseline (`markSaved`) — and it is **greyed
    out while the doc is `clean`**, so an unchanged doc can never mint a duplicate version.
- **Clear** is the exception: it stays in the *same* document, so it neither auto-saves nor clears
  history (Ctrl+Z is the backstop), and `clearAll` preserves everything that isn't drawn content:
  name / styles / styleDefaults / palettes / **darkMode** (a night map stays a night map
  when you empty it).
- Known gap: work that lives only in the undo stack (Clear → New) is lost — the gate sees an empty
  doc and `clearHistory()` then discards the stack. Pre-existing in kind.

### IDs

[ids.ts](src/model/ids.ts): production uses `defaultIdFactory()` → **crypto UUIDs**
(`crypto.randomUUID()`, 36-char). Tests use `counterIdFactory(seed)` → deterministic `s0, l0,
…`. (The old `Math.random().slice() + Date.now()` scheme was reworked: it could emit short random
parts and shared one millisecond suffix across kinds.)

---

## State management

Fourteen Zustand stores, split deliberately by lifecycle. The three that carry real application
state — `useDoc`, `useSelection`, `useViewportStore` (+ its in-flight twin `useLiveViewportStore`)
— get their own sections below. The rest are small and single-purpose: `useSnapPrefs`,
`useCustomPalettes`, `useSaveBaseline`, `useLibraryPointer`, `useToasts`, `useFontEpoch`, and four
persisted UI-preference stores that exist only so a panel's disclosure state survives a reload
(`useLabelEditorPrefs`, `useLineEditorPrefs`, `useStationEditorPrefs`, `useLibraryPrefs`). Files in
[src/state/](src/state/). Four modules sit alongside them **without** being stores — they own no
React state: `mapLibrary.ts` (IndexedDB; see the map-library section below), `theme.ts` (a pure
table), and `visibility.ts` / `anchorVisibility.ts` (derivations over the viewport and selection
stores).

**`useFontEpoch` is a store for one specific reason** — see the memo gotcha: a re-render signal
that must cross a `memo` boundary cannot live in App-local `useState`, because `StationView`'s
referentially-stable props make it bail out and keep every label's fallback-font geometry.

### `useDoc` — the document store ([store.ts](src/state/store.ts))

`create<DocState>()(temporal(persist((set, get) => ({...DEFAULT_DOC, ...actions}), persistCfg),
temporalCfg))`. **`temporal` is the outer wrapper, `persist` the inner**; both use the same
`partialize: pickDocSnapshot` over `DOC_FIELDS`. The ~125 actions are thin wrappers delegating to
pure transforms (`import * as T from '../model/transforms'`). Adders mint an id from the
module-level `ids` factory, call the transform, and return the id. Note that any action writing
**geometry** wraps with `withRegionReconcile` so region assignments ride the edit in the same undo
entry (see Region layering) — the real shape is
`moveStation: (id,x,y) => set(withRegionReconcile((s) => T.moveStation(s, id, x, y)))`, not a bare
`set`.

`temporalCfg`: `equality: docSnapshotsEqual`, `partialize: pickDocSnapshot`, `limit: HISTORY_LIMIT`
(1000, [store.ts](src/state/store.ts)).

The mutator method references live on the full state but are **not** in the snapshot; they never
change, so `Object.assign` on undo preserves them.

### Undo/redo ([history.ts](src/state/history.ts))

The **only** module that touches zundo's internals (`pastStates`/`futureStates`). Exposes
`pushHistory`, `pauseHistory`, `resumeHistory`, `undo`, `redo`, `historyDepth`, `redoDepth`, and
`clearHistory` (both stacks wiped — the file-load path, where undoing across a load would splice
two documents together).
**`undo`/`redo` also call `useSelection.getState().reconcileWithDoc(...)`** — the selection store
is separate and untouched by zundo, so after an undo restores the doc, dangling selection ids
must be pruned.
**Both no-op while a history group is open** (`if (isHistoryGrouping()) return;`) — undoing
mid-gesture would restore a snapshot the still-running gesture is about to overwrite, and the
group's own commit would then push an entry spanning two unrelated states.
**`undo`/`redo` also flush persist**: an empty-partial `useDoc.setState({})` right after the
zundo call routes the reverted snapshot into the debounced doc storage's pending slot, and a
synchronous `flushDocPersist()` writes it. zundo applies undo/redo through the raw `set` it
captured — which sits **above** `persist` in the `temporal(persist(...))` chain — so the
reverted doc never reaches persist's storage writer on its own, and `localStorage` would lag the
canvas until the next ordinary edit (edit → undo → refresh would resurrect the edit). The
empty-partial write changes nothing, so temporal's `equality` (`docSnapshotsEqual`) skips both
the history entry and the redo-stack wipe; the flush cancels any pre-undo debounce timer, so a
stale write can never land on top of the undo's.

**The doc storage write is debounced inside deferring gestures** (`debouncedDocStorage`,
store.ts): a history group opened with `deferPersist` — the canvas drag hooks' per-frame write
streams — hands persist the un-stringified `{state, version}` and the full-doc `JSON.stringify`
+ `localStorage.setItem` run once per ~300ms quiet period (one pending slot, last-write-wins;
stored bytes pinned identical to what `createJSONStorage` produced). Everything else — one-shot
edits and focus-scoped groups (numeric fields, the color picker, name editors) — writes
synchronously: a focus group stays open as long as focus does, so deferring under it would
leave storage arbitrarily stale behind a discrete, observable edit. Flush points close the
deferred window: gesture commit (durable at pointerup), the undo path above, and
pagehide/beforeunload/visibilitychange.

**Grouped edits — `beginHistoryGroup()`** ([store.ts](src/state/store.ts)). A drag is many
`moveStation` calls; a text edit is many `onChange`s; a slider drag is many ticks. The pattern:

1. Capture `snapshot = pickDocSnapshot(state)`, `pauseHistory()`.
2. Mutators run freely, no history recorded.
3. `commit()`: `resumeHistory()`, re-snapshot, and **only if changed** push the one captured
   pre-action snapshot — one entry for the whole gesture. A no-op group (focus→blur, click
   without drag) pushes nothing.
4. `cancel()`: resume without pushing.
5. `rollback()`: RESTORE the captured pre-group snapshot, then resume without pushing — aborts a
   mid-flight gesture that already wrote to the doc (the drag hooks' `pointercancel` path), where
   `cancel()` would strand the half-applied writes. All three are idempotent (`done` flag).

Groups **don't nest**: a caller that may fire from inside an already-open group (e.g. the mirror
broadcast dispatched from a focused numeric field's edit arc) gates on `isHistoryGrouping()`
([history.ts](src/state/history.ts)) and skips opening its own group — the outer one already
collapses its writes into the single entry. Opening a second group would `resumeHistory()`
mid-gesture and push a stray snapshot.

Groups **can overlap without nesting**, though — two independent gestures own their own
begin/end pairs, and pointer order is pointerdown → blur, so pressing a canvas drag handle opens
the drag's group _before_ a focused field's blur-commit lands. The contract is **the newer
gesture steals**: `beginHistoryGroup()` tracks the one open group in a module-level reference
(never a depth counter) and seals it on the next begin, exactly as its own commit would; the
elder's late `commit`/`cancel`/`rollback` is then a no-op via its `done` flag. This is also the
self-heal for leaked groups (a gesture that died without ending): the next begin recovers their
edits as a real entry, so recording can never stay paused forever. `clearHistory()` (file load)
cancels the open group too — its snapshot belongs to the replaced document, and undo must never
cross a file load.

**Coalesced bursts — `withCoalescedHistory(key, apply)`**. Wheel ticks over a slider or
spinbutton ([useNumericField.ts](src/components/useNumericField.ts)) are ungrouped one-shot
writes and a trackpad fires dozens per flick — one undo entry each, so Ctrl+Z after an accidental
scroll unwound a single 0.25 step and looked like it did nothing. This runs the write normally
and then **discards the entry it just added**, so the burst's FIRST entry (the pre-burst doc)
survives and one Ctrl+Z takes the whole scroll back. It never pauses recording — unlike a group,
nothing is held open between ticks, so undo/redo, unrelated actions and a file load all keep
working mid-burst. A run continues only while the same `key` (a stable per-field token, so
wheeling one field then another doesn't merge them) writes again within `COALESCE_WINDOW_MS`
(500) **and** the top of `pastStates` is still the exact entry the run owns — that identity check
is what stops an unrelated edit landing between two ticks from being swallowed. Inert inside an
open group: those writes record nothing of their own for it to fold.

### `useSelection` — ephemeral UI/mode state ([selection.ts](src/state/selection.ts))

Not persisted, not undoable. Two key pieces:

**`UiMode`** — a discriminated union, **exactly one editor mode active at a time**:
`idle | placing-station | creating-line-tag | creating-route-bullet | creating-transfer(firstEnd)
| placing-label | placing-anchor | creating-polygon | placing-svg(image)
| appending-to-line(lineId, cursor) | layering | editing-station-layout(stationId)`.
(`firstEnd: TransferEnd | null` is the transfer end picked by the first click — named `firstEnd`
rather than `anchor` because an end can now itself BE a transfer anchor, and `anchor.anchorId`
read like a riddle. `placing-anchor` is sticky click-to-place, like
placing-station: each click drops one anchor, Esc / right-click exits.)
(`cursor: AppendCursor` is the whole Edit Stops
mode state — a station cursor connects on the next click, an edge cursor splices into that edge,
`null` means nothing pending; see [appendGestures.ts](src/model/appendGestures.ts).)
Entering a
non-idle mode wipes
all selections — with one exception: `startEditingStationLayout` **preserves** the station
selection and mirror state (the mode edits the selected station in place). Adding a new mode is
one variant + handlers; its right-click policy is declared in one place,
`RIGHT_CLICK_PASSTHROUGH_MODES` (`{idle, layering, editing-station-layout, appending-to-line}` —
modes where right-click does **not** cancel). The cancel gesture is also scoped to the canvas, and
the gate is **positive**: `cancelModeOnContextMenu` (App.tsx) returns early unless the event target
`.closest('.canvas-host')`. So **all** chrome is exempt — toolbar (including the map-name field),
sidebar, popovers — not just the sidebar. Cancelling from chrome used to kick the user out of the
mode mid-flow (a `placing-svg` mode even lost its parsed file payload) while also suppressing the
native context menu they had asked for. During Edit Stops, right-click anywhere on
the canvas **exits** the mode (the mouse-only twin of Esc) and removes nothing — edge/stop removal
is the × chip or the Delete key. `appending-to-line` sits in the passthrough set so the
document-level cancel stands down and defers to the canvas's own `onContextMenu` exit handler
([MapCanvas.tsx](src/components/MapCanvas.tsx) — stations/segments deliberately leave contextmenu
unwired in the mode so every right-click bubbles to the SVG root), NOT because right-click keeps a
mid-mode removal gesture. Every non-idle mode announces itself on the canvas via
[canvas/EditingBanner.tsx](src/components/canvas/EditingBanner.tsx) (banner + 4-side mode frame:
accent for placement modes, the line's color for appending, orange for layering; an exhaustive
`switch` over the union with a compile-time `never` guard, so a new mode that forgets its banner
fails the build).

**Selection** — **seven parallel id-list fields** (multi-select; order meaningful; **last entry =
anchor**, in the "anchor of a multi-select" sense — not a transfer anchor):
`selectedStationIds` + `selectedRouteBulletIds`/`selectedLabelIds`/`selectedPolygonIds`/
`selectedSvgImageIds`/`selectedAnchorIds`/`selectedLineCircleIds` (anchors are FREE transfer
anchors; hosted ones are station internals and never appear here; line circles join a marquee
when the rect touches their RIM — `lineCirclesForRect`, a marquee wholly inside the ring grabs
nothing). The six generic lists' `select/toggle/set/add/xor`
actions are generated by one `makeIdListActions` factory (hand-copying them is exactly how a
cross-clear matrix drifted and caused a stale-line-highlight bug). Single primaries:
`selectedLineId`, `selectedLineTagId`, `selectedTransferId`, `selectedStopLineId`, plus
`selectedVertices` (a single polygon's id + a set of vertex indices — shift-click toggles more
in/out; independent of the polygon selection so the polygon stays selected while its vertex
handles are active) and `selectedAnchorCellId` (the station-HOSTED anchor armed inside the layout
editor — the third arm of the mutually-exclusive `selectedStopLineId`/`labelSelected` group, and
a different thing entirely from `selectedAnchorIds`). Selectors:
`soleSelection(s)` (non-null only when total across all seven lists === 1 — every list needs an
explicit arm; the tail is a bare `return null`, since the old unguarded svgImage
fallthrough would have answered `{svgImage, id: undefined}` for a new list) and
`getCopyableSelection(s)` (everything **except stations and anchors** — the clipboard has no
station payload, and `ClipPayload` has no transfer kind, so a pasted anchor could never carry
the transfer that gives it meaning).

Separately, `hoveredCanvasItem: HoveredCanvasItem | null` (`{kind: HoverKind, id}`) tracks the
item under the cursor so the canvas can preview each item's selection chrome at 50% opacity on
mouseover — a pure hover cue, independent of the selection lists above. Its Edit-Stops twin is
`appendHover: AppendHover`
(`{kind:'station', stationId} | {kind:'segment', pairKey} | {kind:'line', lineId} | null`),
the station/segment/foreign-line under the cursor _while editing a line's stops_. It drives the same
50%-opacity preview — but of the ring/halo a click would place next (gated through the click
matrix by `appendStationHoverPreview`/`appendSegmentHoverPreview`), painted in
`HighlightedLineLayer`. A hovered station that the click would ADD to the line (the **second
station** of the connect/splice the pen or the armed segment started) gets two more cues, both
gated on the one `appendRoutePreviewEdges` predicate — the edges the click adds — so they can
never promise different clicks: its NAME is promoted to the same line-colored `starter-label`
treatment the pen's own station wears (and the dimmed/white pass skips it, so the label is
painted once, not stacked), and the corridor(s) themselves preview at `ROUTE_PREVIEW_OPACITY`
= 0.5. That route is built by running the REAL `connectStationsOnLine`/`spliceStationIntoEdge`
and rebuilding bands ([appendRoutePreview.ts](src/geometry/appendRoutePreview.ts)), so it
carries the actual stop-cell spawn, auto-orientation, fillets and interlining; a splice previews
BOTH halves.
The predicate is empty for a click that merely walks the pen, including onto an
**already-connected** neighbour, where the connect transform no-ops — the ring still shows there
(the cursor does advance), but no route is drawn. A hovered STATION also gets the map-consistent `hover-zone` silhouette —
a solid two-tone ring over a light (white ~0.1) wash, white rather than the accent tint because the
editor dims the map to near-black even in day mode — on every station, member or not, independent
of the actionable-click ring. The `'line'` variant marks a stripe of a line _other_ than the edited
one: its preview lifts that whole line above the dim through the SAME renderer the edited line uses
(cased three-pass stripes plus its markers and dots, shared `lineRepaintNodes` /
`lineMarkerAndDotNodes`) at `HOVER_LINE_OPACITY` = 0.5, and clicking it switches the editor over to
it. Foreign stations are click-through exactly where the click matrix says a click means nothing
(`decideStationClick(...).kind === 'none'` — `useStationInteraction`'s `hitless`), so the click
falls to that line beneath. It is kept apart from `hoveredCanvasItem` (whose `hoveredChrome` gate is
idle-only); its setter `setAppendHover` no-ops on an unchanged target so a segment stripe's
per-frame `pointermove` stream doesn't churn re-renders. Ephemeral; cleared on pointer-leave and
on any mode exit.

### Viewport: committed vs live ([viewportStore.ts](src/state/viewportStore.ts))

**Two stores, intentionally:**

- `useViewportStore` — the **committed** camera (`x, y, zoom`) + `gridVisible`, `gridSize`
  (`GRID_SIZES = [5,10,20]`, default 10), the **nine layer-visibility flags** behind the View menu
  (`showNetwork` default true — see below; `showWaypoints` and `showAnchors` default false;
  `showLineCircles`, `showTransfers`, `showSvgImages`, `showTextLabels`, `showPolygons`,
  `showRouteBullets` default true), plus two **local chrome** preferences:
  `dayCanvasColor: DayCanvasColor`
  (`'white'|'gray'|'black'`, default white — the day-mode paper color, dimming glare without
  touching the map) and `darkUiInDay: boolean` (default false — a chrome-only dark UI while the
  **map** is still in day mode). The map's own day/night is **not** here — that is `MapDoc.darkMode`
  (a stale `darkMode` key in an existing persisted blob is ignored); `darkUiInDay` is orthogonal
  to it, so `App` drives `data-theme` off `chromeDark = darkMode || darkUiInDay`. **Persisted** as
  `'massimo-viewport'` (per-browser, **not** per-file) — except `showNetwork`, alone among the
  visibility flags, which `partialize` deliberately omits so a reload never opens onto an
  apparently-empty map. It is the broad one; the narrow toggles each clear a single kind, so a
  reload under them still shows a recognisable map. The giant SVG tree subscribes here and is
  re-rendered only on commit.
- `useLiveViewportStore` — the **in-flight** gesture viewport (`pending: Viewport | null`).
  **Not persisted, not undoable.** Only a small set of overlays subscribes — the selected-item
  handle overlays (`PolygonView`, `SvgImageView`) via the `useLiveZoom` selector — never the giant
  station/band tree. Exists solely
  so per-frame pan/zoom writes don't hammer localStorage or re-render the SVG. See the
  [Interaction layer](#canvas-interaction-layer) for how the gestures move the world imperatively
  (pan: composited pan-layer translate; zoom: viewBox write).

**Layer visibility — the View menu** ([ViewPopover.tsx](src/components/ViewPopover.tsx), one eye
button in the toolbar). Nine checkboxes in three groups: Lines and stations · Anchors, Line
circles, Transfers, Waypoints · Images / SVGs, Canvas labels, Polygons, Route bullets. The **grid**
is
deliberately not among them — a drawing aid rather than map content, and its button pairs with the
grid-size cycler beside it.

The two layers that default to hidden also answer to the keyboard: `A` flips anchors and `W`
waypoints (App.tsx, writing through `setVisibility` exactly as the checkboxes do — no second
opinion about where a flag lives), and the letter is a `shortcut` field on the registry entry so
the menu row can advertise it. `G` toggles the grid and `Shift+G` cycles its size, both straight
to the setters — the grid is not registry content.

[visibility.ts](src/state/visibility.ts) holds the set as one `VISIBILITY_ITEMS` registry, because
three consumers have to agree about it and each used to spell it out by hand: the menu, the export
snapshot's force-everything-on pass, and the button's hidden-content mark. A flag added to two of
the three fails silently — most cruelly at the export, which would ship a map missing whatever the
user had toggled off. Each entry carries `gatesExportedInk`, since only some of them do:
`exportVisibilityOverrides` forces those on around the capture and leaves the rest alone, their
layers being `data-export-exclude` anyway. `showWaypoints` is the one it would be actively WRONG to
force — it REVEALS scaffolding the export then strips. `setVisibility` derives the setter name
from the key rather than consulting a second table, and `anyLayerHidden` marks the toolbar button
whenever a layer that defaults to VISIBLE is switched off. Both of the obvious alternatives are
wrong: "some flag is false" marks a pristine canvas forever (anchors and waypoints default to
hidden), and "differs from the defaults" marks a menu with **every box ticked**, since checking
those same two departs from the default. Turning a reveal on hides nothing, so it never marks.

**Every rule a kind's visibility depends on is a FIELD on its entry**, never a line of code beside
the call — that is what makes "one entry point" true rather than aspirational, because a rule
spelled out at four call sites is a rule three of them will keep. Two such rules, both folded in
by `kindVisible` (render) and its non-reactive twin `kindVisibleNow` (pointer handlers and
doc-geometric pools):

- `revealedBy` — the modes that are ABOUT this kind, which show it whatever the menu says. Hiding
  a layer and then reaching for its own tool still shows what the click drops, instead of the tool
  reading as broken. A DERIVATION, never a write to the user's flag: a temporary write would need a
  matching revert on every exit path. It is a LIST because `showAnchors` has two
  (`creating-transfer` picks an anchor as a transfer end, `placing-anchor` needs the existing ones
  on screen); the rest name the single mode that places them. `showNetwork` has none at all — it
  is the deliberate get-out-of-my-way switch, and lifting the whole network back for one station
  placement would undo what the user asked for.
- `nestsUnderNetwork` — `showTransfers` and `showAnchors` ride with the master switch, a transfer
  running between stations and an anchor hanging off one. Checked FIRST, so a mode reveal lifts a
  kind's own box and never the master switch above it. `showLineCircles` deliberately does NOT
  nest: reaching a ring a line is sitting on top of means clearing the lines, so the master switch
  has to leave the guides standing. That is the whole reason the menu is finer-grained than the
  button it replaced.

Every consumer goes through `kindVisible` or `kindVisibleNow`, so the canvas, the marquee, the snap
pools and the popovers cannot drift into different opinions about what is on screen.

**`showNetwork` — the lines/stations toggle.** Off leaves only
the background art (polygons, svg images) and the grid on the canvas, so art buried under the
network can be clicked and dragged. Hidden content is **not rendered** rather than made invisible —
an invisible-but-present hit rect would still swallow the clicks the toggle exists to let through.
Six seams cover it, and a seventh rule governs anything new:

- **Stations** self-gate inside [StationView.tsx](src/components/StationView.tsx). That dispatcher
  is the chokepoint every station pass (wash, hit area, dots, labels, stroke, drag proxy) funnels
  through, in `MapCanvas` and the highlight/placing overlays alike — so one `return null` covers
  ~15 call sites and no future pass can miss it.
- **Lines** are already consolidated into `MapCanvas`'s single `renderables.map` block (stripes,
  casings, stop markers), so they gate at that one call site. Line tags, transfers, band
  warnings, the warning toasts, the layout editor, and `HighlightedLineLayer` gate beside it —
  that last one matters most, because it paints a **full-viewport dim** that would otherwise black
  out the background art with the network gone. `needRegions` folds in `showNetwork` too, which
  also skips the app's most expensive computation while hidden.
- **The four free kinds gate by EMPTYING their record** in `MapCanvas` (`polygons`, `svgImages`,
  `textLabels`, `routeBullets` — the `…All` reads are the ungated originals). Each renders
  across a
  body pass, a hover preview, a selection overlay and a top-z drag proxy, and a gate written four
  times is a gate that gets missed once. Only these four can be: `lineCircles` and `transfers` feed
  **geometry** (band routing and stop metrics respectively), so emptying either would move ink that
  is still on screen — those two gate at their paints instead.
- **Doc-geometric code must opt in by hand.** Not rendering kills DOM hit-testing, but anything
  reading geometry straight off the doc never notices: `useRectSelect` would sweep hidden stations
  into a marquee (an invisible selection that answers Delete), and the snap pool would align art
  to stations that aren't on screen. `hitsForRect` is the marquee's single gate — one function for
  both the per-frame preview and the commit on release, which ran as two copies of the same seven
  calls (a gate the preview honours and the commit does not looks right for the whole drag and
  selects the invisible thing anyway). It folds in `stationsForRectVisible` and
  `anchorsForRectVisible`. The snap side has three named gates: `liveAlignTargets` (the
  point-snapper pool, wrapping the still-pure `alignTargets`, emptying the four free kinds exactly
  as the canvas does), `liveSnapStations` (the station record handed to the snap **engine** — a
  bound route bullet stays draggable while the network is hidden, and without this it would align
  to invisible stops), `liveSnapAnchors` (free anchors, gated on `showNetwork` **and**
  `showAnchors`), and `liveSnapHostedAnchors` (the same anchor gate over the cells a station
  carries — it empties those, leaving the station's stops in the pool).
  Ring capture is the third: `liveCaptureCircles` gates the placement snap, its drop-side
  `bindDroppedStation`, and the drag-side capture in `useStationDrag`. Ungated, a station dropped
  near a hidden rim snaps onto it AND gets **bound** to it — the map acquires a binding to a guide
  nobody can see. Rings are a hard constraint rather than an align target, which is why they take a
  helper of their own instead of a slice in the pool.
  **Any new feature that reads the doc for interaction needs the same gate.** The one place that
  needs none is the locked-item deep-pick: `lockedHitsAt` probes geometry with no visibility
  opinion, but `lockedDispatchTarget` resolves through `document.querySelector`, so a hidden kind
  has no element and drops out before it can join the cycle.
- **Gestures aimed at the SELECTION gate too, and they read no geometry at all.**
  `unlockedSelectedItemIds` (selectionOps.ts) filters the selection for lock **and** visibility, so
  every gesture reading it skips members on a switched-off layer: the Delete key, arrow-nudge,
  Ctrl+X, the group tow (`collectGroupSiblings`) and the group panel's Delete all. Without it,
  hiding Polygons and pressing Delete removed one with nothing on screen to show a selection ever
  existed. The single-primary paths App owns take the same test by hand (a selected transfer, a
  polygon's vertex handles), since they never reach the shared helper, and Ctrl+D reads
  `visibleCopyableSelection` — duplicating a hidden item would mint an invisible clone that
  selects itself, which the Delete gate then refuses to remove. Ctrl+C stays unfiltered: copying
  is a read. Skipping is deliberately SILENT: these gestures repeat under a held key, so a notice
  per press would be noise.
- **Item popovers gate too, and they are not canvas content.** A panel is a DOM overlay, so
  hiding a layer does not take its editor away — it hangs there offering to edit, and Delete, an
  item no longer on screen. `ItemPopovers` gates every kind (the station's panel is HIDDEN rather
  than unmounted, keeping its measured width and scroll position across the excursion), and the
  multi-select `SelectionPopover` drops hidden kinds from its count and its bulk lock/delete.
  Items stay SELECTED throughout — hiding is a peek — so unhiding restores the same group.

### Preferences

- [theme.ts](src/state/theme.ts) — `themeColors(darkMode, dayCanvasColor = 'white'): ThemeColors`
  (pure table; in day mode `dayCanvasColor` picks the `DAY_PAPER` white/gray/black paper variant):
  `canvasBg, label, selectionStroke, grid, underlay, editorBg, editorText, phantomDot`, plus the
  interaction accent `accent`/`accentWash` — marquee, snap guides, selection washes, mode frames —
  and the line-edit dim `dim`/`dimOpacity`/`dimmedLabel`; light `#fafafa`, dark `#000000`).
  **No store of its own** — `useThemeColors()` reads `darkMode` off the **doc**, so loading a
  night map paints night with no extra wiring (unlike the camera, which needs an explicit
  `fitCameraToDoc`). Theming is split by what can
  consume CSS: **chrome** is themed by the design tokens on `.app` in styles.css (dark mode = one
  token-reassignment block), **canvas SVG** paint comes from this table. `accent` therefore exists
  as **two hand-maintained copies** — `ThemeColors.accent` and the `--accent` CSS token — pinned
  in sync by a test in [theme.test.ts](src/state/theme.test.ts) that reads styles.css off disk.
- [customPalettes.ts](src/state/customPalettes.ts) — `useCustomPalettes`: the user's half of the
  palette **library** in **global** localStorage (`'massimo-custom-palettes-v1'`, version 1) —
  imported definitions, the starred NAMES (built-ins included, so a star outlives a list they
  aren't in), and the library column's sort. `addPalette` upserts by exact name and refuses a
  built-in's name; the library is keyed by name, so nothing may appear twice.
  The split: **the library is global; what a map paints with is a set of COPIES in the doc.**
  Nothing crosses between them except by an explicit command in the palette manager, so deleting a
  palette here can never disturb a map. The palette editor honors the split: it edits exactly ONE
  copy — a library palette through these actions (outside undo), a map palette through the doc's
  (undoable) — never both.
- [snapPrefs.ts](src/state/snapPrefs.ts) — `useSnapPrefs`: snap-mode toggles plus the preset
  slots, persisted at **version 2** and migrated on rehydrate (v0's boolean `all`/`grid` become the
  directional enums, and **any key the blob predates is filled from `DEFAULT_SNAP_MODES`** —
  zustand's default merge replaces `modes` wholesale, so without that a mode added later reads
  `undefined` at runtime). Number keys **1–6** (and Numpad1–6, via `e.code` so they fire with
  NumLock off) each advance one toggle a single step, in toolbar order — the keyboard twin of a
  click on that button. Both paths route through the pure `advanceSnapToggle(modes, index)`
  ([SnapToggleBar.tsx](src/components/SnapToggleBar.tsx)) so a keypress is exactly one click
  (multi-state toggles cycle over repeated presses; a disabled toggle is a no-op). The bound key
  range is `SNAP_TOGGLE_COUNT`, derived from the toggle list, so a new toggle wires its own key.
  **Ten preset slots** (`presets`, keyed 0–9) snapshot the whole `modes` object: **Shift+digit**
  recalls a slot, **Ctrl/Cmd+Shift+digit** saves the live modes into it, both toasting what they
  did. Read off `e.code`, never `e.key` — with Shift held a US layout reports `!`/`@`/`#`, so the
  digit is only legible in the code — and matched **above** the plain-digit toggles so the preset
  wins wherever both could, with auto-repeats dropped (saving or recalling twice does nothing new).
  The map is **sparse on purpose**: a slot never saved is absent, which is how `recallPreset`
  knows to leave the live modes alone and return `false` for the caller to say so, rather than
  silently resetting someone's snapping because they reached for an empty slot. A recall spreads
  over `DEFAULT_SNAP_MODES` on the way out for the reason the migration exists at all — the
  persist migration cannot reach a value nested inside a preset, so a slot saved before a mode
  existed would otherwise land that mode `undefined`, or (worse) leave whatever the live modes
  held, making a recall depend on what it replaced.

---

## The geometry core

All pure, all world-coordinate, all in [src/geometry/](src/geometry/). No React, no store.

### Routing — `router.ts`

`route(start, startDir, end, endDir, R, waypoints?)` quantizes the endpoints' directions to the
nearest of 8 and picks the shortest valid octolinear path among the **0-bend / 1-bend / 2-bend Z/U**
candidates (min length, bend count as tiebreaker). The **3-bend U-turn is a fallback, not a
competitor** — it is only generated when the first three produce nothing at all (mostly the
anti-parallel `d_s == -d_e` case), so it never participates in the length sort. Then it fillets
each interior corner with a circular arc of radius from
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

1. **Collect** every line's segments by iterating **`line.edges`** — each edge string is already a
   canonical pair key, so the `SegInfo` is stored canon-first (`edgeEndpoints`) with no ternary
   shuffling, plus cell coords + a world direction hint. (Not "consecutive station pairs" — that
   is the pre-loops/branches model; `buildBandGeometry` never calls `pairKeyOf`.)
2. **Circle fork**: segs whose both stops are `viaCircle` on stations bound to the same line
   circle (radially consistent between the ends, `segCircleFit`) leave the pipeline here and
   build **concentric-arc bands** instead — the SAME sort + merge as the straight case (step 6,
   `forEachPackedRun`), reading "perp" ≡ radial and "parallel" ≡ arc position; centerline = the
   arc's tangent polygon at the stripes' mean radial distance. No marker-fit cap and no
   inner-stripe radius bump: the circle dictates the geometry. Everything else continues below.
3. **Bucket by axis** (`dirIndex % 4`) — lines traversing the corridor in **opposite** directions
   share an axis and can merge.
4. **Reference frame**: sign-flip so the band flows canonFrom→canonTo (else the router sees a
   U-turn).
5. **Project into the band frame** (`PackedSeg`): each seg's perpendicular and parallel position
   at both ends, plus its width and interline gap.
6. **Sort & greedy adjacency merge** (`forEachPackedRun` — one owner, shared with the circle fork
   at step 2). Sorting ascending by perpendicular projection assigns low indices to the
   right-of-motion side, matching `stripeOffsetsForWidths` order. Then two consecutive segments
   merge iff they are **exactly tangent** at both ends (perp step ≈
   `tangentGap(prevW, w, prevGap, gap)` within `BAND_MERGE_TOL` = 0.5 — the gap widens the tangent
   step by `max(prevGap, gap)`) and their parallel positions match. Otherwise flush and start a
   new band. (Mixed-width pairs at the legacy unit gap stay separate — they'd overlap.)
7. **`buildBandSpec`**: centerline endpoints = centroid of the group's stop positions;
   `stripeOffsets = stripeOffsetsForWidths(widths, gaps)` (mean-centered tangency positions —
   bit-exactly `(k−(n−1)/2)·STOP_SIZE` for uniform width 14); **radius bump** (`idealR = R +
maxAbsOffset` so the innermost stripe still curves at ≥ R); **marker-fit cap** (cap R so the
   post-fillet straight run ≥ the widest marker half-width — single-stripe bands may cap _below_
   R, multi-stripe bands floor _at_ R); then `offsetFilletPath` per stripe.
8. `assignLinePriorities` fills per-stripe z-priority from `lineOrder` **only** (per-segment layer
   overrides are gone — region assignments override the covering line per-face at render time
   instead, see Region layering); `buildOrderedRenderables` flattens to per-stripe + marker
   renderables sorted back-to-front, so a perpendicular middle-layer line can interleave _between_
   another band's stripes. Two stripes of ONE line tie on that priority, broken by a second key
   `subOrder` pursuing one goal: **a stop dot's style should be the style of the topmost segment of
   that line at that station**. A segment differing from a station's dot paints BEHIND its siblings
   there, keeping a through-route continuous wherever a line's own stripes coincide — a branch
   routed up its own trunk corridor, and equally a degree-2 station where the line DOUBLES BACK. It
   applies everywhere, being inert where consecutive bands merely abut. Differing at EITHER end
   demotes, so nothing is wrongly raised, but one scalar per stripe cannot serve two disagreeing
   stations: where every segment at a station is demoted by some OTHER station they tie again and
   `edges` order decides, so the goal holds only while each edge gets a consistent verdict at both
   ends. A separate key, never a fractional nudge to `priority` — the casing epsilon below is
   safe only because base priorities are integers; equal on both keys keeps `edges` order. The dot
   itself (`stationMarkerStyle`) is the **plurality** of the segment styles incident to that
   station, ties by canonical `LineStyle` order (`LINE_STYLES`, so `solid` wins any tie it is in),
   and therefore always a style some incident segment actually has.

A `SegmentBandSpec` carries **parallel arrays** (`lines`, `paths`, `stripeOffsets`,
`stripeWidths`, `linePriorities`, `arms` — index k = same stripe).
`stripeOffsets`/`stripeWidths`/`radius` are the **single source of truth**: every consumer (band
paint, stripe outline, label/tag placement, hit sampling) **must read them, never re-derive**, and
must use **`band.radius`** (the bumped/capped effective radius), **not** any line's raw
`curveRadius` (the configured R is the LARGEST member line's radius). `bandKey` (=
`pairKey#sortedLineIds`) is unique and stable regardless of input order — used for React keys and
as the "which band" identity. The band specs are pinned by a **byte-exact golden snapshot**
(`interlining.golden.test.ts`) guarding the zero-visual-change-for-legacy-docs invariant; never
update it without understanding why every painted path on every map would move.

**Where a new stop lands.** The merge gate is a rule about BOTH ends at once, so placing a new stop
has to be too. `spawnStopCellAt` ([transforms.ts](src/model/transforms.ts)) reproduces, at the
station a connect/splice extends INTO, the arrangement the line already has at the station it comes
FROM — and does it entirely in **world vectors**, converting back to a cell exactly once at the end
(`cellAtWorldPos`). That is the whole point: row/col name different world directions at every
station rotation, so any rule phrased as "a column over" changes answer depending on how the target
station happens to be turned. Two stations 180° apart (a hand rotation, or `autoOrient` flipping to
keep a label upright) put the stop on the wrong side of the band; two a QUARTER turn apart — a
station framed for an east–west corridor receiving a north–south line — put it along the corridor
instead of across it, which the router then cannot route at all.

Each line running that same corridor and stopping at both ends is a **peer**, and each proposes one
spot: its own position here, plus the world offset from it to the new line back at the source. Peers
usually agree, and a proposal satisfying every peer reproduces the arrangement exactly. Ranked by
peers reproduced, then not landing on an existing stop, then the NEAREST peer at the source — that
being the peer the new line is most likely already interlined with, so following it preserves the
band they share. A proposal within a `tangentGap` of an existing stop slides outward until clear.
The new stop's **travel axis** carries across the same way, by re-indexing `AXIS_CYCLE` through the
two rotations: the four orientations name local axes, so a station framed east–west calls
north–south travel `'auto-horizontal'`, and copying the enum would turn the line 90°. With no peer
there is nothing to reproduce and placement falls back to one tangent gap east of the rightmost
stop — but the travel axis still carries, since that needs no peer.

A consequence worth knowing: two stations whose frames differ by **45°** cannot both hold the stop
on the lattice. Reproducing a world offset exactly puts the new cell at `±√2/2` multiples — the same
real coordinates the diagonal lattice generates, correct but off-grid, and the only stops the app
itself places there.

**Casing passes.** [SegmentBand.tsx](src/components/SegmentBand.tsx) emits **two renderables per
stripe**, interleaved by z-priority: a `'silhouette'` pass (the fat under-stroke just behind the
body, `priority + CASING_EPS`) and the `'body'` pass (the inset colored stripe). The casing
widths come from [lineStroke.ts](src/model/lineStroke.ts) (`casingSilhouetteWidth` /
`casingInsetBodyWidth` for opaque styles so a line's own overlapping bands merge into ONE outer
casing; `CasingRails` centered rails for the two transparent "open" styles). Which casing shows
INSIDE a self-overlap — a branch mouth, a loop crossing — is not a paint pass at all: those are
region faces (see Region layering), and painting one clips the losing slice so the winner's
already-painted rails show through. Both passes read the same `lineStroke` helpers as the
highlight overlay so they can't drift.

**Which arm.** `assignLineArms` (interlining.ts) reads a line's arm partition off its JUNCTIONS,
never off a band's own shape: at each station the line's band ends are matched into THROUGH-RUNS,
most opposed first, and the pairs glue bands into arms (union-find), so anything left over — a
branch — starts an arm of its own. A station with two ends is a plain joint or a corner and
always pairs up, whichever way its bands bend; a lone end is a terminus and pairs with nothing,
which is not the same as branching. Matching continues past the first run only while a remaining
pair is DEAD opposed — a line that crosses itself at a station has two through-runs, two arms
crossing — while a second pair that is merely the best of what's left is a fork, not a crossing.

A run scores on how nearly its arms oppose each other; ties prefer a pair of BEND-FREE arms
(each straight all the way to its far station) over one containing an arm that curves away, then
the longest COMBINED straight length — the straight corridor the pair makes through the station.
The bend-free preference is what keeps a TANGENT branch out of the through-run: its departure is
dead opposite the far trunk too, and with a long enough lead-in (or a short enough trunk side)
the run sum alone would weld curve to trunk, making "curve on top" unpaintable at the mouth. The
run term is still what a real fork needs, because two arms can leave a junction along the SAME
axis and diverge only further on, so the one that peels off first is the branch (the A at Broad
Channel). Scoring a pair by its SHORTER arm instead saturates on the arm both candidate pairs
share, ties them, and hands the verdict to whatever order `line.edges` happens to be in. Asking
the band's own polyline instead of the junction is the older trap: a through corridor whose next
station sits off-axis doglegs to reach it, and answers "branch" from 300 units away.

**The hit box.** A stripe's pointer surface is normally the painted path itself, but the styles
that paint with GAPS (the dasharray ones — `dashed`, `dotted`, `dashed-open`) hit-test only their
painted pieces under `pointer-events: stroke`, which made half of such a segment dead to clicks.
An interactive/selectable stripe in one of those styles emits a fourth element: a
`data-band-hitbox` path tracing the same `d` at the same width as ONE continuous transparent
stroke, carrying the stripe's identity attributes and its whole pointer wiring. It is then the
stripe's only hit surface — the painted path drops to `pointer-events: none` but KEEPS its
handlers, since pointer-events blocks hit-testing, not dispatch — so `hitStack.ts` resolves band
stripes through `[data-band-stripe],[data-band-hitbox]`, and `data-export-exclude` keeps the
invisible stroke out of SVG/PNG/PDF.

**The Edit Stops lift.** While a line's stops are being edited, that line gets a SECOND pointer
surface: `SegmentBand`'s `pass="hit"` — one transparent stroke per stripe, carrying the same
`data-band-hitbox` identity plus `data-band-lift` — mounted in its own layer above the whole band
layer (paint-order step 3c). The mode dims the map and repaints the edited line over the dim, so
neither that line's z-priority nor the region overrides that clip pieces of it away are visible to
the user, yet both were what hit-testing followed: over a crossing where another line painted in
front, hovering the line being edited highlighted THAT line, and a click switched the editor to it.
The lift is drawn at `casingSilhouetteWidth`, the stripe's outer PAINTED extent, so the casing rim —
which the inset body never covered — answers as the line too. It stays BELOW the station hit areas,
so the pen still wins on a stop and a segment buried under its endpoints is still alt-pick territory.
An interlined NEIGHBOR's stripe is untouched by all this: it is a different line, and hovering it
still previews the switch (see `makeAppendBandHandlers`).

### Snapping — `snap.ts`, `polygonSnap.ts`

**The contract.** Two snappers exist, on purpose, and everything positional routes through one
of them:

- The **station engine** `snapDraggedStation(input)` (pure) is topology-aware: stations and
  line-bound route bullets. Modes `{line, equidistant, tens, all, grid}`. `equidistant` is
  engine-only and gated on `line`; `tens` ("Snap to grid length") notches the along-line cadence
  to a whole multiple of the **active grid size** from the prev-in-line neighbor (gated on `line`
  here too — but the flag is now shared with the point snapper, below). Flow: pick a target pool → generate candidate
  alignment pairs per target (line-mode requires a shared line + parallel travel dirs +
  adjacency; all-mode ignores topology; a stopless station participates via its anchor on
  either side; the pair's TARGET offset resolves through that station's frame — the ring's on a
  bound station, see Line circles — since the snap promises alignment with the dot that PAINTS,
  while the DRAGGED offset stays on the plain octant rotation, which IS its frame when unbound
  and would be circular when not, the frame depending on where the ring seats it) keeping those
  whose perpendicular distance is within tolerance → **consolidate
  interlined candidates by MEDIAN** offset (not mean — keeps the guide on a real stripe) → pick
  a primary + a non-parallel secondary axis → solve (2×2 intersection or projection) → apply
  grid as a **hard constraint** (when on, the result is always on-grid; an alignment fires only
  if reconcilable, else falls back to plain grid with no guide) → optional along-axis refinement
  (equidistant / tens; `excludedIds` also guards the cadence anchors) → build guides.
- The **point snapper** `snapPolygonPoint` (`polygonSnap.ts`, decomposed — no 2×2 solver) snaps
  one reference point against a target pool: polygon whole-drags + vertex drags, svg-image
  moves + axis-aligned resizes, text-label drags, unbound route bullets, and **most placement**
  (labels, polygons, svg images). Placement is **not** uniformly point-snapped: `placing-station`
  routes to the station engine, and `creating-route-bullet` does too whenever a default line
  exists — falling back to the point snapper only when there is none.
  `constrain: 'x' | 'y'` restricts it for single-DOF consumers (edge resizes) so guides never
  show a snap the caller discards. When `tens` is on **and grid is off**, an engaged alignment's
  free axis (the slide along the guide) is notched to a whole grid length from the target — the
  same "Snap to grid length" idea extended past the skeleton, so any snapped object lands a clean
  step from what it caught. Corners have no free DOF; grid (when on) owns quantization; edge
  resizes opt out via `constrain`.

**The redistribute (Ctrl-drag) pools split.** `redistributeAnchor` puts the engine in line mode
regardless of the user's toggle — it is an explicit modal gesture — and line mode then snaps
**exclusively to the anchor**, adjacency bypassed: the stations between anchor and grab are moving
targets for the whole gesture, so the anchor is the one fixed point on that line. Snap-to-all is
**not** narrowed the same way. It keeps every station the redistribute is not moving, and that set
is `redistributeMovingIds` — the interior of `shortestPathOnLine(anchor → dragged)` on every line
linking both, which is exactly the chain `redistributeBetween` rewrites on each move. Same edge-graph
walk in both, so the exclusion set cannot drift from what actually moves. Outside a redistribute the
two pools are the same set, so nothing else changes.

> **Everything "along the line" walks `edges`, never `line.stations` order.** Membership order is
> creation order, not track order, so an index slice miscounts on a loop, a branch, or any line
> whose stations were added out of order. Three places had to learn this the same way:
> `redistributeBetween` (which stations move), `spacingDivisor` (the Ctrl-drag spacing readout —
> it must divide by the same segment count the redistribute actually uses, or the number lies),
> and `refineAlongAxis`'s cadence step (which walks `neighborsOf`). All three route through
> [lineTopology.ts](src/model/lineTopology.ts).

Shared conventions, all paths: alignment tolerances are `/zoom` (constant screen px); grid is a
hard world constraint; **Shift bypasses all snapping** during any pointer gesture (svg rotation
included — it snaps 22.5° by default, Shift frees); every alignment snap draws a
distance-labeled guide through `SnapGuides`; grid snapping is silent.

The **target pool** (`alignTargets(doc, exclude)` in
[snapTargets.ts](src/components/canvas/snapTargets.ts)) is what "Snap to all" means for point-
snapper consumers: every station stop-center (anchor when stopless), every polygon vertex,
every svg image's rotated corners, three points per text label (visible-bbox UL corner, center,
LR corner — no hit pad), every route bullet center, and every transfer anchor — free ones from
the doc collection, hosted ones alongside their station's stops (an anchor cell is its own point
on the station lattice, so no stop centre stands in for one parked a few cells out). Per-kind
exclusion sets remove the dragged item and, in a group drag, its co-selected siblings — a
station's hosted anchors leave with it, since they ride on the same record. Stationary items
always remain valid targets. Pools are snapshotted at pointer-down. One deliberate asymmetry:
**stations are skeleton** — they snap only among themselves, never to decoration; and a bound
bullet's all-mode pool is station stops (engine-internal), not the decoration pool.

**Reference points** (grid + alignment use the same one per type, drag AND placement): station
anchor; bullet center; text label topmost-then-leftmost visible rotated corner; polygon
topmost-then-leftmost vertex; svg image topmost-then-leftmost rotated corner.

**Placement parity**: `snapPlacement` in
[usePlacementDispatch.ts](src/components/canvas/usePlacementDispatch.ts) is shared by every
placement mode's ghost preview and drop, so preview == commit by construction; Shift-click
places raw.

**Line tags** keep their own arc-length snapper (`snapNeighborTag` in `lineTagGeometry.ts`):
nearest in-tolerance neighbor tag in the corridor, **always on** (a tag lines up with its
interlined siblings — independent of the "Snap to all" pref), Shift bypasses,
`LINE_TAG_SNAP_TOLERANCE/zoom`, guide to the matched neighbor; the add-tag hover ghost and
click apply the same snap. Alignment is by **cross-section**, not fraction-of-own-stripe:
the neighbor's rendered point is projected onto the dragged stripe (closest point between
concentric/parallel offsets lies along the shared normal), so two aligned tags sit directly
across the corridor even where the band curves and the stripes differ in length.

**Line circles sit OUTSIDE both snappers**, as a hard constraint with its own capture rule
(`lineCircleAtPoint`, shared by the station drag, station placement and the Edit Stops
alt-create so "close enough to snap onto the ring" is one number): a free station carried
within the standard tolerance of a rim binds and projects onto it — the ring then owns the
position and the engine + grid are bypassed — and a bound station stays constrained until
pulled `3×` tolerance off the rim (escape hysteresis; Shift detaches instantly, the same
bypass convention as everything else). Guides don't fire while captured: the ring itself is
the feedback.

Which seat on the rim is `snapPointToCircle`'s call, the angular half of that constraint and the
one owner of it across all three entry points. Plain rim by default; under the **`circle` snap
mode** ("Snap to circle cardinals") the seat is also pulled to the nearest of the ring's eight
**cardinals** — 45° apart from due east — and the guide grows tick marks there. Two independent
axes, deliberately: radial distance is the capture/release test, angular distance the cardinal
one, and the cardinal window is an arc LENGTH measured against the same tolerance, so it spans a
constant number of screen px and a tight ring is far more magnetic than a huge one. There is no
"circle off" state — a ring always captures, and Shift is how you decline. Cardinals are part of
the rim constraint, not a layer on top, so whatever suspends that suspends them too: a `ringTowed`
drag (below) seats nothing at all. The pull travels
ALONG the rim, so it never disturbs the projection every downstream consumer depends on:
`circleSeat` reprojects whatever it is handed, the drop-side `bindDroppedStation` still
recognizes the seat at its tight tolerance, and circle move/resize preserve the polar angle — so
a bisected ring stays bisected through both. Cardinal-to-cardinal chords are octolinear only for
EVEN steps (diameters and quarter chords); odd steps come out at 22.5° and the router doglegs
them.

**Deliberately unsnapped** (documented, not bugs): arrow-key nudges (raw 1 / Shift 5 world
units — free fine-positioning); 45° group rotate (re-snapping would distort shapes); snapping
against a hidden grid (visibility is render-only); rotated (non-90°) svg-image resizes; the
exact midpoint of a polygon edge-add; the ghost-lattice drags (the station-layout editor),
which are a separate slot-based system where Shift flips the lattice basis.

### Labels & text — `labelTokens.ts`, `textMeasure.ts`, `labelLayout.ts`

- **`parseLabelLine`** tokenizes a label line into `text`/`bullet` segments. The delimiter picks
  the inline route bullet's shape — `|CODE|` circle, `[CODE]` square, `{CODE}` diamond — and
  doubling it (`||CODE||`, …) makes the bullet unfilled (line-color outline on a white/black
  interior by theme). Unclosed/mismatched delimiters and empty codes stay text; a backslash
  before a token escapes it to literal text (`\|a|` renders "|a|").
- **`parseFormattedLine`** additionally parses HTML-like formatting tags —
  `<b>` (two steps up the shipped weight ladder), `<i>`, `<u>`/`<s>` (drawn as explicit `<line>`s),
  `<color=…>` (named / `#hex` / `0xhex`), `<w=…>` font weight (a shipped weight name like
  `<w=Light>` = absolute, or `<w=+2>`/`<w=-1>` = signed ladder steps from the label's base weight;
  innermost `<w>` wins, invalid values stay literal — see `resolveRunWeight`/`parseWeightToken`),
  `<size=…>` font size (an absolute world-unit size like `<size=6>`, or `<size=+1>`/`<size=-2>` = a
  signed delta from the label's base size; innermost `<size>` wins, floored at the min font size,
  invalid values stay literal — see `resolveRunFontSize`/`parseSizeToken`),
  and the glyph shortcuts `<air>` ✈ / `<xfer>` ↔ / `<c>` © / `<tm>` ™ — threading
  the open-tag state across `\n` lines and column wraps until closed. Unknown tags stay literal
  text. Both free-floating text labels (`LabelView`) and station labels (`renderStationLabelText`)
  render these tags; the inline rename editor shows the raw tokens (`literalBullets`). Free-floating
  labels also carry optional `leading` (line-spacing multiplier) and `tracking` (em letter-spacing)
  per label; station labels carry the same two per-station (`Station.leading` / `Station.tracking`,
  collapse-at-default). Both are applied by the measurer. Legacy docs (`<X>` circle bullets, unescaped literal pipes) are
  rewritten once by `migrateLegacyInlineTokens`, gated by persist v8 / file `version` 2.
- **`measureTextLabel`** measures multi-line styled text **without a browser layout**: it lazily
  creates an offscreen 2D canvas and uses `ctx.measureText` (advance + ink bearings). **In jsdom
  there is no canvas backend**, so it falls back to a deliberate over-estimate
  `line.length * (fontSize * 0.55 + letterSpacingPx)` (the `0.55` core plus the per-character
  tracking term). There are **no font-metrics tables**. Exact-geometry tests
  inject a `measure` stub instead of trusting the default. Leading/trailing whitespace is a real
  historical bug source: canvas advance includes typed spaces but the ink box excludes them, so
  the measurer force-corrects bearings at segment ends. Line height **follows content**: each line
  is one `LINE_HEIGHT` of its largest run's size (`maxFontSize`), so an inline `<size>` grows or
  shrinks that line and the box; baselines are laid out cumulatively (`baselineFromTop` per line,
  shared by same-line runs) and reduce exactly to the uniform `fontSize*LINE_HEIGHT*(1+(n-1)*leading)`
  when nothing is resized. Results are cached (module-level LRU,
  limit 256) keyed by weight/style/parse-mode/size/width/leading/tracking/text — and that cache is
  cleared on web-font load (see `App.tsx`).
- **The vertical font model is three hardcoded fractions**, not measurement — no font tables exist.
  `BASELINE_FRACTION` (em-box top → baseline) is reached from the line's CENTRE everywhere, so it
  cancels out of the autoAlign pins and only slides glyphs inside their own hit rect;
  `CAP_FRACTION` is the **Core Type Area** height the transitmap.net rules align by, and the one
  the pins actually ride on; `DESCENDER_FRACTION` (= `1 - BASELINE_FRACTION`) is how far ink drops
  below the baseline, which the CTA does not describe at all and only the above-side pin consumes.
- **`capCenterDy(fontSize)`** places every **badge glyph** — a service code in a stop dot or route
  bullet, an inline bullet, the WP lozenge, a line tag, the snap readout, the layout editor's `L`
  handle — at `y = centre + capCenterDy(fontSize)` on the **alphabetic** baseline. **Never
  `dominant-baseline="central"`**: that centers the font's ascent..descent box, and Chrome resolves
  those from a **different metric table per platform** — usWinAscent/Descent on Windows, `hhea` via
  CoreText on macOS. The shipped Helvetica Neue leaves `USE_TYPO_METRICS` clear and its two sets
  disagree (904/−214 vs 714/−198), so `central` lands 0.345em above the baseline on Windows but
  0.258em on macOS: identical markup sits ~0.09em lower on a Mac, over half a world unit on a
  default 12-unit code disc, and it grows with zoom. `capCenterDy` centers the **cap box**, so it is
  valid only for text with no descenders and no fallback-font glyphs — `SegmentBand`'s
  routing-warning ⚠ (a DejaVu dingbat, not caps) is the one element on `dominant-baseline` anywhere
  in the app.
- **The label pipeline paints on the baseline it computes**, and it measures that baseline from the
  line's **center**. `stationLabelText`'s `firstLineBaselineY` is `firstLineCenterY +
  fontSize·(BASELINE_FRACTION − 0.5)` for every valign, and that one number is what the glyphs, the
  hover underline, the wash silhouette and the hit rect all key off. Center-relative is not a
  stylistic choice: `labelLayout` lays out in a **1.2em line box** (`LINE_HEIGHT`) while
  `BASELINE_FRACTION` measures down from the **1.0em em box** top, and the two share a center but
  not their top/bottom edges — 0.1em of half-leading sits at each end. Measuring from an edge drops
  it. That is why `LabelLayout.baseline` (`central`/`text-before-edge`/`text-after-edge`) and
  `firstLineDyPx` are **not** forwarded to the renderer: they name an edge, and `firstLineCenterY`
  already folds in both the valign and the multi-line first-line shift. The per-segment
  (bullet/tracked) path derives from the same number, which is what keeps a bulleted label on
  exactly the y its plain counterpart uses. `LabelView`'s per-run text works the same way: every run
  carries its shared baseline outright, so mixed inline `<size>` runs align with no per-size anchor
  back-off, and an inline bullet centers on its run's cap box (`capCenterDy`) rather than on a raw
  fraction of the line.
  `dominant-baseline` cannot do this job: Chrome derives its offset from the platform font metrics,
  so `central` measures 0.333em at fontSize 12 and 0.357em at 14 on Windows against 0.258em on
  macOS, versus the model's flat 0.3em — enough to put painted text ~1 world unit off the geometry
  that selects it, by a margin that varies per platform *and* per font size (the metrics round to
  whole device pixels). Anything positioned **relative to** label text keys off the same computed
  baseline for the same reason.
- **`StopMetrics`** ([geometry/labelLayout.ts](src/geometry/labelLayout.ts)) is everything the
  label geometry knows about one painted stop — stripe `half`, interline `gap`, `dash` tick, `dot`
  silhouette, the `transfers` landing on it — resolved together by
  `stopMetricsOf({ lines, transfers, stations })` ([model/stopMetrics.ts](src/model/stopMetrics.ts))
  and threaded to `labelLayoutLocal`, `stationBoundaryRectsLocal`, `cellsAABBLocal`,
  `stationsForRect` and `stationWorldAABB`. It is ONE bundle rather than a lookup per field
  precisely so a call site cannot pass four of five and drift off the paint; on the canvas it comes
  from `useStopMetrics()`, which reads the whole slice itself so no component has to know which
  parts are part of the answer — and so that `stopMetricsOf` can BE the selector, a module-level
  constant rather than a closure minted per render per component, with no way to hand it a `lines`
  that is not the store's (its cache holds one entry, so a foreign one would miss on every station
  on every frame). That hook runs once per STATION component (label, hit rect, drag proxy,
  silhouette) and it reaches the store from INSIDE `StationView`'s memo, so its SUBSCRIPTION, not
  just its build, is the cost. `stopMetricsOf` therefore keeps a **two-level cache**: first on the
  identity of its three slices, then on the derived CONTENT they produce. Identity serves every
  consumer in a frame off one build. Content is what makes a drag cheap — a station move mints a
  new `stations` record every pointermove, so identity can never hit mid-gesture, yet the only
  things the lookup reads out of `stations` are stop CELLS (which a move leaves alone) and the two
  booleans of `continues` (the SIGN of a neighbour projection, which a drag essentially never
  flips). Content-equal hands the previous function back by reference and re-binds the cache to the
  new slices, so `Object.is` bails inside zustand and no station re-renders. The hook selects the
  LOOKUP rather than the slices precisely so that bail-out is reachable; `StationView.decoupling`
  pins the outcome. (Same bargain `measureTextLabel` makes: the builder is pure, so reusing the
  previous function is invisible.) The lookup takes the whole **station**, not just the stop: the
  split singleton/interchange dot default is a property of the station's stop SET, and a transfer
  end names its station. A waypoint's `dash` and `dot` are neutralized inside
  `labelLayoutLocal` — hidden it paints nothing, revealed the overlay replaces every style with a
  fixed circle, so layout must not shift with Show-waypoints. `cellsAABBLocal` deliberately reads
  only `half`: growing it by the dot would move marquee hits, washes and Reset-view framing, which
  is a different change from where the label parks.
- **`labelLayoutLocal`** is the single source of truth for a station name's `<text>`
  anchor/baseline/hit-rect, all in **unrotated station-local** coords (the `label.rotation` is
  applied around the anchor at render). `'auto'` align snaps the text against an adjacent stop;
  `valign` drives the multi-line block math. **The renderer and the hit/silhouette geometry must
  pass the same `StopMetrics` lookup** or the wash drifts off the painted text.
  `label.autoAlign` overrides both: the octant of the label cell relative to the **nearest**
  adjacent stop (in the reading frame) picks the alignment per the transitmap.net tutorials —
  baseline sits above the marker, cap line hangs below it, the first line's Core
  Type Area (`CAP_FRACTION` in `textMeasure.ts`) centers beside it, corner octants pin the
  facing CTA corner — and maps onto the existing valign machinery, so the renderer is
  untouched. The beside case steps by `capCenterDy`, the same half-cap the badge glyphs center
  by, so an inline route bullet inside a beside-aligned name lands on the stop's row too. Those
  pins are asserted against the painted `<text>` baseline, not just the model
  ([stationLabel.autoAlign.test.tsx](src/components/stationLabel.autoAlign.test.tsx)).
  The base clearance of every pin is the blocking LINE's own gap — `StopMetrics.labelGap`, from
  `Line.labelGap` (default 3, the historical `LABEL_GAP` constant). An **above**-side label
  clears by that gap + a descender charge — half a
  `DESCENDER_FRACTION`, scaled by the vertical share of the approach (1 straight above, √2/2 on a
  corner) — every other side by the gap alone: the CTA stops at the baseline but ink does not,
  and a constant gap against a size-proportional descender put a "g" inside the route line above
  ~fontSize 15. Half rather than the full drop is a deliberate dial (full clearance read too far
  on real maps); the deepest ink may dip the other half into the gap. The charge is unconditional
  rather than measured per name — clearing only the names that own a descender is what leaves a
  row of labels on ragged baselines, which is the thing the tutorial rules out. Below and beside
  need none: there the block grows AWAY from the marker. A **beside** label against a stripe
  DIAGONAL to its reading axis clears at the text's near corner, not just the CTA-center row —
  the stripe advances one unit per unit of text height, so the pin charges the block's window
  (half a cap up; half a cap, the half-weight descender and any stacked lines down). The window
  charges only where line body actually CONTINUES (`StopMetrics.continues`, resolved from the
  line's edges and neighbour positions): at a terminus facing the other way the finite marker
  square is the honest obstacle. A stripe parallel to reading keeps that square model
  unconditionally, which is what lets a terminus label read along its own line.
  Multi-line blocks anchor by the **line nearest the marker** and stack away from
  it: bottom line above (`auto-up`), top line below (`auto-down`), first line beside/fallback
  (`auto-down` align-down, so added lines never move the line that sits level with the dot).
  `label.autoVAlign` overrides WHICH line anchors ('down' = top line, 'up' = bottom line; the
  octant still supplies the pinned typographic edge), and `label.autoHAlign` re-aligns the
  lines WITHIN the block — anchorX slides by the anchor line's pen advance so its pinned edge
  stays put, which makes both overrides no-ops for single-line labels.
  The pin clears whichever thing painted at the stop reaches furthest along the approach, each by
  its own support function and joined by MAX (`StopMetrics`): the stripe (a `half`-extent square
  rotated to the stop's **travel axis**), the TfL tick, the transfer cap, and the **dot** — which
  is not a subset of the stripe, since a service-code disc sizes itself for legibility and any dot
  size is settable, so a dot routinely reaches past a narrow line. The dot's silhouette is
  axis-aligned in the **world** frame — `StationDots` paints real dots at `stopPosWorld` inside an
  untransformed group, so only the phantom drag preview is station-rotated — and its support is per shape
  rather than by one circumscribing radius: a square is narrow on the cardinals and a diamond on
  the diagonals, so a single radius would over-clear one of them by √2. A **transfer** counts as
  the capsule it paints, not just the disc it ends in: its body is a band of the cap's half-width
  leaving the stop toward the other end, and an approach leaning into that band is cut at
  `r / sin θ` — √2·r at 45°, the corner a thick transfer closes off in a cross. The cap floors
  that (`slantHit` models a band, which is endless; the half the body does NOT occupy is edge
  line with no transfer on it), so a body running the other way charges the bare disc, as does an
  end whose heading is unknown. `StopMetrics.transfers` carries one entry per END, never merged to
  the fattest, because a slim slanted transfer can out-reach a fat square-on one; the heading
  resolves only when the other end is a stop of the SAME station, whose cell sits in the same
  lattice, and any other end needs the world resolver this lookup does not hold. All stop-relative
  on both axes.
  **Cross stations** break "the octant decides everything" twice, both times because a centering
  octant runs the text straight through a stripe. First, when the label parks squarely across the
  line from its stop (the centering octants) and a **crossing** line's stop is packed beside it —
  same reading-frame row within `BAND_MERGE_TOL`, different travel axis, on one side only
  (`crossingStop`) — the READING axis re-anchors against that crossing stop, so the text butts up
  to its stripe (`end`/`start`) instead of straddling it. Each axis stays measured against the stop
  that actually blocks it — extent AND `labelGap` alike: the perpendicular pin still comes from the
  label's own stop, so the baseline holds that line's gap off the line it labels (a row of labels
  stays level) no matter how wide the crossing line gets, while the butt clears by the crossing
  line's own gap. A DIAGONAL crossing stripe is measured where the text is, not on the stop row:
  the block sits wholly above/below the row, so the butt runs the same slant window over the
  block's ink (the above pin is already the half-descender ink bottom; the below pin the hanging
  cap line) and the nearest ink corner butts at the gap — pulled inward past the row-level support
  when the stripe retreats from the text, pushed out when it advances over it, with the same
  `continues` gate. Parallel neighbours are not crossings, and a label boxed in on both sides keeps
  centering. Second, the **corner park** — the commonest interchange label there is: the label sits
  in a quadrant of the cross, its own line's stop below it and another stop BESIDE it, in the
  label's OWN reading row rather than `ref`'s. Centering would run the text through that beside
  marker, so it takes the reference instead and the label reads AWAY from it, beside-pinned at its
  edge. Only the centering octants ask — every other octant already pins an END of the text rather
  than its middle — and distance never enters it, which is why this is not a tie-break in the
  reference pick: a wide beside line packs FURTHER out than the stop below, and centering on the
  nearer stop is exactly what puts the text over the further one. ANY marker in that row qualifies,
  not just a crossing line's: a stop whose stripe runs ALONG the reading row counts too, because if
  its line continues toward the label then the label CELL is already on that stripe and centering
  escapes nothing, and if it does not (a terminus facing away) reading off it is exactly right. A
  multi-line block then stacks AWAY from the stop the park dodged — entered from the N octant the
  BOTTOM line takes the beside pin and earlier lines lift off it — since growing into that stop
  would only trade which marker the text lands on; the same resolved default feeds the beside ink
  window, or the pin would be measured against ink on the wrong side of the row. Both breaks ask
  `oneSidedInRow` the same question — which single marker is in the way, and which way to read off
  it — and both take its null (boxed in on both sides, no side to escape to) as "keep centering".

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
  and the `*ForRect` marquee functions (which skip `locked` items unless `includeLocked` is set —
  the Alt-marquee recovery path for click-through locked items). `transferAnchorsForRect` is the
  exception with no such parameter: free anchors carry no `locked` field to skip on.
- `stripeOutline.ts` — per-stripe edge/cap geometry for the stroke-before-fill dots; reads the
  **baked** `stripeWidths`/`stripeOffsets`.
- `lineTagGeometry.ts` — arc-length sampling along an offset path; `snapNeighborTag` snaps a
  dragged tag to a same-corridor neighbor (matched by unordered `pairKeyOf`).
- `svgImage.ts` — corners, aspect-locked corner resize, single-axis edge resize, rotate-to-pointer
  (`atan2(dx, -dy)`; rotation snaps to `SNAP_ANGLE_STEP` = 22.5° **by default and Shift FREES it**
  — the inverse of every other snap in the app, and the drag hook passes `!e.shiftKey` accordingly),
  snap anchor — all in the image's local frame.
- `lattice.ts` — orthogonal/diagonal stop-placement lattices, disjoint except at the origin. The
  two are each other's 45° rotation and each is closed under 90°, so a lattice chosen in SCREEN
  terms and read in a rotated station's local frame is always still one of the two:
  `localLatticeOffsets` picks the basis (swapped at odd rotations, kept at even) instead of
  rotating the offsets. That is why a 45°-rotated station's cells are ±k·√2/2 rather than integers
  — the same values Shift-drag writes at rotation 0, not a third family — and why choosing beats
  rotating: generating the diagonal basis scales by √2/2 and turning 45° scales by it again, but
  √2/2 · √2/2 is 0.5000000000000001, so a rotated slot never landed on a storable cell.

---

## Rendering pipeline

[MapCanvas.tsx](src/components/MapCanvas.tsx) owns the entire paint order. `StationView`
([StationView.tsx](src/components/StationView.tsx)) is a `memo`'d `switch (layer)` dispatcher
instantiated **once per pass**. Top→bottom paint order (later = on top):

Before step 1, two non-content layers: the background `<rect data-bg>` and `Grid` (both
`data-export-exclude`). Two families also recur *throughout* the list rather than occupying a slot
of their own, and are omitted below to keep it readable:

- **Mouseover-preview twins.** Almost every selection-chrome layer has a hover twin mounted
  immediately after it — same component, `preview`, `opacity 0.5`, gated by `hoveredChrome` (so it
  stays quiet mid-pan). There are seven: station `wash` and `stroke`, transfer outline, route-bullet
  ring, label stroke, polygon outline, svg-image box. An eighth, the line circle's, is painted
  INSIDE `LineCircleView` instead: its selection chrome is a RECOLOUR of a guide that is always
  painted, not an outline added beside one, so a twin would have to re-render the whole component
  in a stripped `preview` variant — no grab surfaces, no knob, no `data-*` ids — where a second
  copy of the marks in place costs one `<g>`.
- **Mode-transient previews.** The in-progress transfer rubber-band `<line data-transfer-preview>`
  (between steps 7 and 8) and the Edit Stops alt-create ghost `StopGlyph`
  (`data-append-create-ghost`, between `HighlightedLineLayer` and `LineTagsLayer` — i.e. splitting
  step 10).

1. Background band — polygons and svg images in **ONE interleaved pass** over
   `backgroundRenderOrder`, resolving kind per id (they share `backgroundOrder`, so neither kind is
   structurally above the other; see the z-order gotcha). Under all map content.
2. Station `wash` (selection silhouette fill, behind bands).
3. Interleaved band renderables, ordered by per-stripe z-priority via `buildOrderedRenderables`,
   which emits **three** kinds: `casing` (at `priority + CASING_EPS`), `body` stripe, and
   `marker` (the `StopMarker` squares).
3b. Region overrides render SUBTRACTIVELY inside pass 3: a line that loses an
    overridden overlap face paints through an exclusion clipPath (RegionExcludeClips,
    holes over the faces it loses — see buildExclusionHoles), so the winner shows
    through as its own continuous base stroke. Real map paint (exported).
3c. **Edit Stops hit lift** (`appending-to-line` only) — the edited line's pointer surface
    repeated as transparent `data-band-lift` strokes over the whole band layer, so the line being
    edited wins the pointer over anything painted in front of it (see The hit box). Chrome:
    `data-export-exclude`.
4. Station `bg` (transparent hit areas).
5. Station `label` (after bg, so a selected wash never covers a neighbor's name).
6. `RegionModeOverlay layer="outlines"` (layering mode only — dashed overlap-face footprints).
7. `TransferLayer` (before dots).
8. Station `dots` (over transfers, so a dot click routes to the station — everything below
   this point still paints above the dots), then `AnchorLayer` (8b, below), then the
   **selected-transfer outline** (`TransferSelectionOutline`) — mounted just above the dots
   (unlike `TransferLayer`, step 7, which is below them) so a connected or crossing dot can't
   cover the selection chrome.
8b. `AnchorLayer` — transfer anchors, both homes, between the dots and the transfer outline.
    Above the dots so a free anchor stays grabbable where it overlaps one. Editor chrome, not
    map ink: mounted inside a `data-export-exclude` subtree, so no anchor reaches an SVG/PNG/PDF
    export while the transfer bound to it still prints. The whole block is gated on
    `showNetwork` (anchors are part of the transfer network); WHICH anchors it gets is the
    visibility rule described under `TransferAnchor` above — the full network when
    `kindVisible('showAnchors', …)`, otherwise just `revealedAnchorStations(...)`'s hosted ones
    and no free ones at all.
9. Placement previews (`*PlacingPreview` ghosts), route bullets, free text labels
   (`LabelView layer="bg"`).
10. `HighlightedLineLayer` (line-edit dim wash + the selected line repainted above it; in Edit
    Stops also the hovered station's `hover-zone` silhouette, the second station's line-colored
    name plus the corridors a click there would draw at `ROUTE_PREVIEW_OPACITY`, and, for a
    hovered FOREIGN line, that whole line repainted at `HOVER_LINE_OPACITY`) → `LineTagsLayer`.
    Within the layer the route preview paints straight after the edited line's own stripes, so
    the halos, stop dots and names pushed after it all stay on top of the maybe.
11. Station `match-stroke` → station/label `stroke` selection silhouettes.
12. **Selected-item drag-proxies** — transparent hit targets for each unlocked selected item,
    emitted in body paint order (`MapCanvas`'s `proxyLayerRef`). They sit above all map content so a
    selected item wins a _drag_ over anything stacked above it; a click/right-click on a proxy is
    re-routed to the real element beneath (`rerouteProxyEventBeneath`), so _selection_ still follows
    normal paint order. Placed **before** the handle overlays, so an item's own corner/vertex handles
    still beat its proxy.
13. Polygon/image `overlay` handles, then the marquee rect.
14. `SnapGuides` (dotted guides + measurement labels — above dots and everything else painted
    so far).
14b. **Layout-editor focus dim** (`<rect data-dim>`, editing-station-layout mode only) — painted
    HERE, low, not with the focus content at step 18. It has to sit below the warnings and the
    editor chrome that punch back through it.
15. `RegionModeOverlay layer="hit"` (layering mode only — hover halo + face click targets).
16. `BandWarning` ⚠ markers — painted after everything above, so a warning is never occluded by
    any stripe, dot, or label (deliberately NOT interleaved with the band pass; see the note in
    `buildOrderedRenderables`).
17. **Hover orientation arrows** (`StationView layer="hover-arrows"`, idle mode only) — when the
    cursor rests on a station, its stop dots wear the layout editor's axis arrow as a read-only
    orientation cue ([StationOrientationArrows.tsx](src/components/StationOrientationArrows.tsx)).
    The arrow is **drawn** (`orientationArrowPath`, rotated by `ORIENTATION_ANGLE`), not typeset
    from ↕ ⤢ ↔ ⤡ — no font puts the diagonal pair at a true 45°, so inside a rotated station
    frame the glyphs read as crooked vertical and horizontal arrows. It carries its axis in words
    as `data-arrow-axis`: a bare rotation is unreadable from a test or the elements panel, and the
    e2e orientation specs read it.
    Painted _after_ the routing-warning markers so a ⚠ frame can never cover the badges. Idle-only
    chrome, so it can't collide with the layout-edit focus content below.
18. **Layout-editor focus content** (editing-station-layout mode only) — painted last of all,
    _above_ the warnings, so the station being edited stays reachable: a white selection
    re-stroke over the focus dim (step 14b), its stops re-painted at full strength,
    `StationLayoutEditor` grab rings + direction arrows, then the drag's drop preview. That
    preview is one of two, never both: `GhostLattice` for a lattice drop (white candidate slots
    hung off the amber projection anchor), or `SwapPreview` once the drop resolves onto another
    stop — the dragged stop drawn standing at the target cell, its partner ghosted back at the
    cell being vacated, and a pair of blue arrows flanking the axis. A swap has already picked its
    winner, so all the highlight goes away entirely: the ghost lattice, and the editor's own amber
    projection-anchor gold with it.

Outside the `<svg>`, `WarningToasts` renders one clickable HTML toast per router-flagged band;
clicking it jumps the viewport to the band's center. It takes MapCanvas's memoized `bands`
as a prop specifically so it never rebuilds the router. The stack rests in the bottom-right
corner of the visible host on the same `useDock` measurement the popovers use at the top-right,
giving way only to the part of the open sidebar's strip actually in the window.

`StationView`'s props are referentially stable across a pan (immutable store refs, constant zoom,
stable `useCallback` handlers), so a mid-pan re-render — and the commit's own — does **not**
re-render every station subtree.

**A station name paints in three passes** ([StationLabel.tsx](src/components/StationLabel.tsx)) —
`starter` (the Edit Stops anchor station, in the line color), `highlight` (the selected line's
stations, above the dim), and `normal` — which paint the **same name in the same place** and differ
only in _how_ (fill, size, weight, stroke). Two shared helpers keep them from drifting:
`labelTextPosition` bundles the seven positioning fields read off `labelLayoutLocal`, and
`OverlayLabelFrame` bundles the frame the two above-the-dim passes share (hidden-waypoint skip,
station-rotated `<g>`, the "WP" lozenge that replaces a revealed waypoint's name). The `normal`
pass deliberately keeps its **own** frame — its inline rename editor must win over the lozenge, so
its branch order differs. Drift here is not subtle-but-harmless: the highlight pass paints _over_
the normal one, so a mismatch reads as a doubled label, and a test pins the cross-pass geometry.

**Stroke-before-fill dots (the headline render motif).** `StationDots` maps `['stroke','fill'] ×
dotStops` — `dash`-shaped stops are filtered out first and rendered as `DashGlyph` ahead of both
passes, since a TfL tick is a singleton with no silhouette/body split —
emitting **all stroke-pass glyphs before all fill-pass glyphs**, so overlapping dots share
**one continuous outer border** (every silhouette is painted before every body). `StopGlyph`
implements the split: the stroke pass is the silhouette drawn as a **filled** shape outset by
`strokeWidth/2` (`× √2` for a diamond); the fill pass is the body **inset** by the same amount and
carries the canonical `data-stop-*` E2E attributes. **Not split**: open rings (`fill:'none'`), the
`x` saltire (concave), borderless dots. A lone dot's outer edge is byte-identical to the old
centered stroke.

The three radii — silhouette, body, and the midpoint a single native stroke draws at — come from
`dotStrokeRadiusDeltas` ([model/dotStyle.ts](src/model/dotStyle.ts)), and that is the **one owner**
because the painter is not the only reader: `stopMetricsOf`'s `dot.r` is the radius a label pin has
to clear, so a second copy of the rule would let a label park where no ink was painted — the drift
`StopMetrics` exists to prevent, and unlike a dropped field it would not announce itself. The
`strokeAlign` cases and the diamond's `√2` live there; the hover affordance does not, because
that override belongs to the painter alone (a label that shifted on mouseover would be a bug).
The two sides are pinned together against the rendered DOM by
[StopGlyph.labelClearance.test.tsx](src/components/StopGlyph.labelClearance.test.tsx).

> Per project memory: this stroke-before-fill is **dot-internal** (`StopGlyph`). Reordering
> **line casings** to merge interlined separators was tried and **reverted** (it erased the
> separators). Do not conflate the two.

**`StopMarker`** is the colored **square** that sits _in_ the band at each stop (distinct from the
circular dot), sized to the line `width`, with casing rails centered on the travel-parallel edges
(so tangent neighbors' rails coincide into one separator) and a terminus end-cap. Hatched markers
**pre-rotate their corners into world space** (can't reuse the rotated `<rect>` — `userSpaceOnUse`
patterns would re-rotate the stripes). Dashed/dotted markers render nothing at interior stops
(the pattern flows through) and a half-width stub at an end.

**Where a line ENDS** is geometric, not topological: a stop is an end wherever every band incident
to it leaves the SAME way, so nothing covers the other half of its marker. Degree 1 is the usual
shape, but a line that BRANCHES at its own end sends two edges off down one shared corridor and is
exposed behind them in exactly the same way — as is a cusp in a loop — and each gets the same end
cap and the same end style. A band leaving the other way disqualifies a stop: a through stop, a
corner, a fork that splits both ways.

Two predicates answer that question, on purpose. `endOutwardFromBands` reads it off built band
CENTERLINES, which is what the paint needs (an end cap must sit on the path actually drawn, fillets
and interlining offsets included). `lineEndsAt` answers it from the DOC — before any band exists —
which is what the EDITORS need to know where offering a `stationEndStyles` pin means anything. They
cannot drift: both take the heading from `canonTravelDir`, the same vector `buildBands` hands the
router, and a test walks five shapes demanding they agree stop for stop, arcs included (an arc's
sampled centerline is nobody's travel axis, so it is the family most likely to come apart). One
case is exempt: a band the router gave up on paints a straight from station to station regardless
of travel axis, so at such a stop the doc-side answer may differ and the pin it offers is inert —
the ⚠ over that band is the fix being asked for.

Neither predicate is allowed to judge STORED data. Where a line ends moves under a station drag, a
rotation or an orientation cycle, and none of those pass through a prune — so a `stationEndStyles`
key scoped to endedness would be one a save/reload deletes behind the user's back. The stored key
is scoped to LIVENESS instead (is this station still on the line), and a pin whose stop is not
currently an end sits inert rather than dying. See `Line.stationEndStyles`.

**The marker's outward half at an end IS the line's painted end** — the stripe itself stops
dead at the stop center (butt cap), so `spec.end` reshapes exactly that half, and the three ends
are precisely SVG's three line caps taken there. `'short'` drops it, `'round'` replaces it with a
half-disc; both are one filled `<path>` from [markerEnd.ts](src/geometry/markerEnd.ts), never a
clip of the square (a clip rasterizes a hair off its path and snags the PDF exporter). The casing
follows: side rails shorten to the inward half and the straight end-cap bar moves back to the stop
center, or becomes the matching arc for a round end. A patterned terminus's stub is that same
outward half, so `'short'` simply omits it. Everything is built in the **outward frame** (the
band's own tangent, not the marker square's rotation) so a rounded end continues the stripe's
edges — the frame the end cap and dashed stub already used. `buildStopMarkers` resolves
`spec.end` ONCE (per-terminus pin over line default, then `resolveEndStyle`'s degrade) and both the
painter and `lineRegions.markerBodyRings` read it, so a cover can never disagree with its paint.
**`'round'` degrades to `'short'` on the three dash-pattern styles** (`dashed`, `dashed-open`,
`dotted`) — drawn as one dash-array stroke, they have no shape to round. The degrade is
render-time only: the stored value stays `'round'`, so cycling the segment back to solid brings it
straight back, and one line can round at a solid end while stopping short at a dashed one.

**`TransferLayer`** renders all transfers in **two flat passes** (user stroke halos → bodies) so
overlapping thick transfers trace one outer union. Bodies + halos are click targets
(`pointer-events="stroke"`). A transfer whose ends COINCIDE — a self-transfer — emits a `<circle>`
in each pass instead, hit by its `fill`, so it stays reachable by the alt-click deep-pick under its
own stop dot. The selected transfer's ring is **not** in this layer: it renders in a
separate `TransferSelectionOutline` mounted **above** the station dots (step 8), so a connected or
crossing dot can't cover it; `TransferLayer` itself sits below the dots so a dot click routes to the
station, not the transfer.

---

## Canvas interaction layer

Files in [src/components/canvas/](src/components/canvas/). `MapCanvas` composes ~10 hooks onto
**four** SVG pointer handlers.

### The viewport perf spine

Committed camera in persisted `useViewportStore`; in-flight in non-persisted
`useLiveViewportStore`. Neither gesture writes the doc or the committed store per frame → no React
re-render of the SVG tree mid-gesture — but the two move the world by different mechanisms:

- **Pan — composited translate.** The `<svg>` sits inside `.canvas-pan-layer`, a wrapper div half
  a viewport bigger than the host on every side (`inset: -50%`); the svg renders the matching 2×
  window (`panSurfaceViewBox`), so a half-viewport ring around the visible box is pre-painted.
  Each move, `applyPan(v)` does `setPending(v)` (live store) and sets a `translate(…)` on the
  layer — promoted via gesture-scoped `will-change: transform` at pointer-down — which the
  compositor executes without any style/layout/paint/raster work, whatever the map's node count.
  Blink has no such fast path for transforms on the svg element itself or an inner `<g>`, and
  letting svg ink overflow define the layer bounds also kills it — the margin must come from the
  oversized **element box**. Before a translate could outrun the margin (45% of a viewport
  dimension, `REANCHOR_FRAC`), the gesture **re-anchors**: commits the camera and zeroes the
  transform in the same synchronous handler — one repaint per half-viewport of travel. (A
  per-move `viewBox` write would re-lay-out, re-paint, and re-raster the whole svg every frame —
  ~20fps on a ~9k-node map on integrated graphics, where the translate runs at display rate.)
- **Zoom — imperative viewBox.** Each wheel tick, `applyViewBox(v)` does `setPending(v)` and
  `svgRef.current.setAttribute('viewBox', …)` (the pan-surface window) directly; the browser
  re-rasters. A transform zoom would scale the cached raster — blurry — so zoom keeps the
  repaint-per-tick path. Ticks are ignored while a pan gesture is active.

On gesture end (`commitPending`), `setViewport(pending)` then `setPending(null)` (clearing pending
**last** so overlays stay on the live viewport right up to commit — no jump); a pan also retires
its transform and `will-change` in the same handler, so the swap lands in one frame. The JSX
`viewBox` binds to the **committed** viewport (via `panSurfaceViewBox`), so a mid-gesture
re-render leaves that prop string unchanged and React skips the DOM write (never clobbering an
imperative zoom write, never moving the attribute mid-pan).

> The gesture writes are **synchronous, not rAF** — rAF was tried and reverted (synchronous tracks
> the cursor with zero added latency). Per-frame writes go to `useLiveViewportStore`, **never**
> `useViewportStore` (which is persisted — a per-frame write would hammer localStorage).

`screenToWorld` reads the **live** viewport and measures the **host** box (`.canvas-host` — the
svg's own rect rides the pan transform, so measuring it would double-count the gesture); the
returned `vb*` fields track the **committed** viewport. Both distinctions are explicitly tested
([useViewport.test.tsx](src/components/canvas/useViewport.test.tsx)). Pure math lives in
[viewportMath.ts](src/components/canvas/viewportMath.ts) (`viewBoxFor`, `panSurfaceViewBox`,
`overdrawnViewBox` — draws bg/grid/dim at a 3×3 tile so a mid-gesture camera can't reveal a bare
strip — `computeWheelZoom` clamps zoom to `[0.1, 64]`). Wheel zoom commits after a settle timer
(~90ms quiet); pan commits on pointer-up. The background `Grid` level-of-details its own spacing
(`gridStep` in [canvas/Grid.tsx](src/components/canvas/Grid.tsx): the drawn interval doubles in
powers of two so on-screen spacing stays ≥ 5px — snapping still reads the true `gridSize` from the
store).

### Pointer flow

`MapCanvas`'s `<svg>`'s main handlers (plus small utility ones: `onPointerLeave` clears
`cursorWorld`; `onClickCapture`/`onContextMenuCapture` do the alt+click deep-pick and the proxy
reroute described below; `onContextMenu`/`onDragStart` just `preventDefault`):

- `onPointerDown`: middle-button or hand-mode → `view.startPan`; else `rectSelect.onPointerDown`
  (self-gates). **Item drags start from the item's own pointer-down** (fired by the child view),
  not the canvas handler. A **selected** item additionally carries a top-z transparent drag-proxy
  (see the paint-order list) so its drag wins over higher-painted items; proxy clicks/right-clicks
  are re-routed to the element beneath via `rerouteProxyEventBeneath`, so hit-testing for _selection_
  stays on normal paint order while _dragging_ gets selected-item priority.
  - **Every proxy-aware pick goes through `hitTestBeneathProxies(probe)`** (`MapCanvas`), which
    hides the proxy layer, runs the probe, and restores it. Three call sites need that dance —
    the reroute above and both alt deep-picks — and a proxy left visible would shadow the very
    element the probe exists to find, so the hide/restore lives in exactly one place.
- `onPointerMove`/`onPointerUp`: fan out to every hook; each early-returns if its drag ref is null.
- `onPointerCancel` (browser-initiated: pen palm rejection, window switch, capture loss — a voided
  gesture with no matching pointerup): fans out to every drag hook's cancel path; each disarms its
  ref and `rollback()`s its history group so live writes revert instead of stranding. Pan and
  rect-select are intentionally omitted — neither opens a group or mutates the doc. The line-tag
  drag is window-wired, so it hooks window `pointercancel` itself instead of joining this fan-out.
- `onPointerDownCapture`: self-heals `dragState.suppressClick = false` at the start of every fresh
  gesture (recovers from a drag killed without pointerup).
- `onClick`: only on background; bails if `dragState.suppressClick`; else placement dispatch, else
  deselect-all.
- **Alt+click deep-pick** (`deepPickAltClick` in `onClickCapture`, idle arrow mode only): cycles
  the selection through the stack of selectable entities under the cursor, topmost first — the
  way to reach an element buried under other hit surfaces (a stripe under a station's hit rect, a
  polygon under a label). `document.elementsFromPoint` (proxy layer hidden, like the reroute) is
  resolved to entities by the pure [hitStack.ts](src/components/canvas/hitStack.ts)
  (`resolveHitStack` maps the existing `data-*` identity attrs, deduping multi-surface entities;
  `nextInStack` picks the entry after the current sole selection, wrapping — the selection itself
  is the cycle cursor, no positional state; `currentHitEntity` extends `soleSelection` with the
  line/transfer/line-tag primaries). The chosen element gets a synthetic plain click so its own
  handler runs (alt stripped — no recursion; shift preserved; ctrl/meta dropped). A selected line
  is pre-cleared before the dispatch so `exitLineEditorOnItemClick` can't eat the pick. Locked
  click-through items are invisible to `elementsFromPoint` (no pointer-events), so
  `lockedHitsAt` point-tests them geometrically (the marquee's `*ForRect` helpers with a
  4px/zoom pad) and `mergeLockedIntoStack` appends them BELOW the live stack — locked reads as
  background, so cycling reaches them last; their body handlers stay wired (dispatch ignores
  pointer-events), so `lockedDispatchTarget`'s synthetic click selects them normally.
  - **Edit Stops has a parallel alt-pick** (`appendDeepPick` in `MapCanvas`): while editing a
    line's stops, Alt+click cycles the same under-cursor stack, but scoped to what the line
    editor can _arm_ — member stations and the EDITED line's own segments (`resolveAppendStack`
    in [hitStack.ts](src/components/canvas/hitStack.ts), keyed by `data-pair-key` on the band
    stripes). It exists to reach a short segment buried under its two endpoint stations' hit
    rects. Unlike the idle pick it does NOT re-dispatch a plain click (a plain click MUTATES in
    Edit Stops — connect/splice); it arms the cursor directly — EXCEPT an alt-click that lands on
    the already-armed segment, which splices a new station into it mid-corridor via the shared
    `runAppendCreate` (the same create the empty-canvas alt-click makes; `decideSegmentClick`'s
    `alt` param decides). An alt-click that merely _cycles onto_ a not-yet-armed segment still just
    arms it, so a buried segment can be reached before a second alt-click splices. `appendCursorRef`
    maps the append cursor to a stack ref so `nextInStack` (now generic over `{kind,id}`) advances
    past whatever is armed.

**Shared drag lifecycle** ([dragGesture.ts](src/components/canvas/dragGesture.ts)): pointerdown
captures pre-drag state + `beginHistoryGroup()`; **pointer capture is deferred to first move** (so
the synthesized click still lands on the item); `trackDragMove` flips `moved` past
`DRAG_MOVE_THRESHOLD=4`px (sets `suppressClick`, captures); `finishDrag` commits one history entry
if moved (else cancels — a pure click recorded nothing). `dragState` (module singleton in
[store.ts](src/state/store.ts)) is the global click-suppression flag.

### Drag hooks

`useStationDrag` (runs the snap engine; Shift bypasses snap; Ctrl-drag = redistribute, re-read
live on every move so pressing/releasing Ctrl mid-drag engages/drops even-spacing on the next move),
`useStationLayoutDrag` (the editing-station-layout mode's stop/label handles; see UI chrome — its
ghost-lattice lifecycle scaffolding lives in
[useGhostDragEngine.ts](src/components/canvas/useGhostDragEngine.ts): overlay ref mirror,
live-projection ref, stationary Shift/Alt recompute, pointercancel rollback),
`useItemDrag` (bullets + labels — bound bullets via the engine's bullet mode, labels + unbound
bullets via the point snapper), `usePolygonDrag` (whole-move / vertex / edge-add),
`useSvgImageDrag` (move / resize / rotate — resize snaps only while axis-aligned, edge resizes
axis-`constrain`ed; rotation snaps 22.5° by default, Shift frees), `useLineTagDrag` (**the only
hook wired to window-level pointer listeners** — the rest use the SVG's React handlers — because
the drag wanders off the small tag rect; cursor→world via the shared `view.screenToWorld` like
every other hook; neighbor-tag snap per the contract above), `useRectSelect`
(marquee with per-frame preview of the resulting selection per type, through set/add/xor
modifiers).

Every hook that reaches the **point snapper** does so through
[useDragSnap.ts](src/components/canvas/useDragSnap.ts), which binds it to the live snap prefs, the
active grid size, and the camera zoom. Its callers keep their own pools and their own single-DOF
`constrain`; `snapPlacement` (a pure function, not a hook) is the placement side's equivalent.

The **engage tolerance itself** belongs to neither: `SNAP_PERP_TOLERANCE` is the value at zoom 1,
and every path must divide it by the zoom for the radius to be a constant number of screen pixels,
so that divide is `snapToleranceAt(zoom)` in [snap.ts](src/geometry/snap.ts) and nothing restates
it. Both engines ask there — the station engine's three sites (`useStationDrag`, `useItemDrag`'s
bullet mode, `snapPlacement`) as much as the point snapper's — because a site that passed the raw
world-unit constant would silently snap from twice as far out at 2× zoom, and that reads as
correct until you zoom.

**Group drag** ([groupDrag.ts](src/components/canvas/groupDrag.ts)): at pointerdown,
`collectGroupSiblings` snapshots every _other_ selected item — but only if the grabbed item is
itself selected (dragging an unselected item never tows; locked items never tow). Snap during a
group drag is **one rule for every master type**: the grabbed item snaps with its usual engine
against everything stationary, excluding only itself + everything MOVING with it
(`excludedIds` for the station engine, `groupAlignExclude` → `alignTargets` for the point
snapper); siblings then translate rigidly by the post-snap delta. Grid acts on the master's
reference point only — towed siblings keep their offsets verbatim.
A **line circle is a FRAME**, and that makes it the one member with a second list. It tows by its
center (`moveLineCircle`), which carries the stations bound to it — so those passengers go in
`carriedStations` (ids only, every station on a moving ring, selected or not) instead of
`stations`: they are excluded from the snap pools via `movingStationIds`, because they move, but
never translated, because a bound station's `moveStation` reseats it on its ring and the second
write would drift it round the rim. Same reason as `rotateItemsAround`'s `carriedByCircle`. The
mirror case lives in `useStationDrag`: grabbing a bound station whose ring is co-selected (`ringTowed`)
suspends the ring constraint entirely — no slide along the rim, no Shift/out-of-band detach — and
skips the station's own `moveStation`, because the towed ring is what carries it. A LOCKED ring
stays put, so its passengers tow normally and slide along the stationary rim.
A ring's rim and centre handle BOTH select at pointer-down (its own convention, so the resize knob
and the diameter popover appear as you grab it) — which must stand down for a ring already in the
selection, or a `selectLineCircle` that clears every other list would destroy the group drag
before it began, and for a Shift-grab, which the click's toggle owns. Every part except the knob
is a translation and tows the group; the hook spells that as "not the knob" rather than listing
the movers, so a grab added later tows by default instead of silently not.
**Group rotate** ([groupRotate.ts](src/components/canvas/groupRotate.ts)): right-click rotates the
whole multi-selection rigidly about the pivot via `rotateItemsAround` (fixed the bug where
per-type handlers omitted other types). Locked items are exempt: a locked pivot makes the
right-click a no-op, and locked co-selected members stay put while the rest rotate. A co-selected
line circle rotates as one rigid body with its passengers — center and bound stations take the
same rotation about the pivot — so a station that is BOTH a member and a ring passenger is skipped
by the station branch (rotating it twice would swing it 90°); the drag's `carriedStations` is the
same rule for translation.

### Placement & popovers

`usePlacementDispatch.handleCanvasPlace(e)` is a per-`uiMode` dispatch. `placing-station` /
`creating-route-bullet` / `placing-anchor` are **sticky** (click-click-click drops repeatedly,
Esc / right-click exits); `placing-label` /
`creating-polygon` / `placing-svg` are single-shot (drop, exit, auto-select to open the
popover/handles). Cursor-following ghost previews (`*PlacingPreview`, all `opacity 0.5`,
`pointerEvents none`) feed synthetic items to the real views. Every placement mode snaps ghost

- drop through the shared `snapPlacement` (see Snapping) — same reference point and prefs as
  the item's first drag, Shift-click bypasses, preview guides render through `SnapGuides`.

`ItemPopovers` mounts the single popover for the sole selection — including the station editor
(see UI chrome) and the transfer popover (whose selection is the single-id
`selectedTransferId` primary outside `soleSelection`) — plus the one shared `SelectionPopover`
when **≥2 items** are selected across the seven multi-select lists (idle only): a count summary +
Lock all / Unlock all / Delete all over the whole group.
Every panel — those, the line editor and the station layout editor — is **docked to the
top-right corner of what's visible of the host** by `usePinnedPopover`, right-aligned on the
panel's own measured width (248 for the item popovers, 320 for the station/line editors) 8px
off the top and right edges. Vertically the body clamps to the viewport and scrolls inside
itself, its footer sticky at the shell's bottom edge — the panel is pinned to the window, so
anything past its bottom edge would simply be unreachable. Nothing about the item or the camera
reaches the panel; its two inputs are `hostW` — the canvas host minus the open sidebar's
`SIDEBAR_WIDTH` strip (the sidebar paints ABOVE the popovers, so docking to the raw host width
would park a panel under it) — and the host's own box in the window. The second input is what a
window narrower than the app needs: the grid is floored at the toolbar's `max-content` width,
so the page scrolls sideways and the host's corner leaves the screen. The dock is then the
nearer of the two right edges — the window's while the host's is out of reach, the host's (or
the sidebar's) once it scrolls into view.

The **anchor is in window coordinates and `PopoverShell` is `position: fixed`**, which is what
makes that stable — `useDock` owns the measurement, shared with the routing-warning toasts that
dock to the opposite corner: through the whole first regime the anchor doesn't change, so the browser
holds the panel against the window edge and a scroll costs no re-render and no repositioning.
Only the second regime updates per scroll frame, because a panel giving way to the
document-positioned sidebar has to track it — `SIDEBAR_WIDTH` of travel with the sidebar open,
none without. (Absolute positioning plus a scroll listener was tried and visibly trailed: the
compositor scrolls without waiting for the main thread.) Fixed positioning changes nothing
about paint order — `.canvas-host`'s `isolation: isolate` still traps the shell's z-index in
the canvas layer, since a stacking context follows DOM ancestry, not the containing block. A
pan or zoom, by contrast, moves the map under a panel that stays put, and there is no drag
handle — the header is a title band. The station popover hides (`display:none`, not unmount) during non-idle
uiMode excursions, keeping its DOM node and measured width. Every popover renders inside
`PopoverShell`, which owns the floating frame (header + body) and the load-bearing event
swallowing — pointerdown/click/contextmenu inside a popover must never reach the canvas, which
would deselect the item (closing the popover) or right-click-rotate under it.

The dock **re-measures when one of its inputs changes** — the element it reads from, which can
attach a commit late, or the box being docked into — and never merely because a commit happened.
The page it measures can be MOVING, and an animated scroll gives a different answer every frame:
through the tracking regime a measurement per commit sets state into a page that has moved on,
commits, measures again, and React's nested-update limit tears the app down. Motion is the scroll
listener's job, where one event is one render.

Nothing should be animating the page sideways in the first place, and the one thing that could is
why that cadence matters. Selecting a station reveals its row in the sidebar's list, and the
sidebar rides the right edge of the same over-wide grid — so in a narrow window that row is
outside the window entirely. `scrollIntoView` would reach it by scrolling every scrollable
ancestor up to the document, dragging the whole page across; the reveal instead scrolls the
list's own box by the row's overhang — `block: 'nearest'` by hand, over one axis of one element.

### Memo contract (subtle but important)

`bandsGeometry` (`buildBandGeometry`) excludes ALL presentation from its signature — color AND
per-segment style, both the _values_ and the styled-segment _set_: band geometry is
presentation-BLIND, so each stripe resolves its style live at paint time (`resolveSegmentStyle`, the
single resolver shared by the geometry bake and the render-time refresh, so the two can never
disagree). **Width, by contrast, IS geometry (in the hash) — it moves the baked paths and changes
band merging.** So a color or casing edit — or a dashed→dotted change on an already-styled
segment — repaints without a band-geometry rebuild; the stop markers, whose footprint DOES depend on
style, rebuild instead via their own `stopMarkers` memo's direct `lines` dep (`renderables` just
orders bands + markers). Region layering keeps its own
parallel cache: the overlays read `regionCache.regionsFor` (sig-keyed on the same geometry fields,
presentation excluded), so cycling a region assignment reuses the cached faces/bands/markers and
doesn't re-run the per-face arc-length search (a single click on a busy map once burned
300–500ms). On a cache miss the render layer passes its own just-built geometry through
`regionsFor`'s prebuilt param — the PRISTINE `bandsGeometry` plus the `stopMarkers` memo — so
bands and markers are never built twice in one frame; marker priorities are invisible to region
geometry, which is what makes entries built from either side of the cache interchangeable
(pinned by `regionCache.prebuilt.test.ts`). During an open gesture the render passes
`regionsFor` a `transient` flag: mid-drag frames are never revisited, so the sig string and LRU
bookkeeping are skipped — which also preserves the pre-gesture entry for the commit reconcile's
old-geometry lookup instead of evicting it.

**Pipelined drags.** Everything that paints map positions reads through `useRenderDoc`
(`state/renderDoc.ts`), not `useDoc` — at rest the two are reference-identical, so this is free.
The rule is stronger than "painters": NO component holds a reactive `useDoc` subscription to the
seven towed collections at all. Input hooks (the drag hooks, `useStationInteraction`) read the
store at event time, and position-independent chrome (sidebar, popovers, the editing banner)
subscribes to the render source, so a mid-drag doc write re-renders nothing anywhere — pinned by
a zero-commits test in `MapCanvas.renderSource.test.tsx`. That is what keeps 60–125Hz pointer
input from taxing the same thread the worker's frames must land on.
When a synchronous region build reports over ~30ms while a `deferPersist` gesture is open (and
the `__massimo.regionPipeline` flag is on), `worker/regionPipeline.ts` arms: the render source
freezes at the current slice, and a persistent module worker — its own clipper WASM, its own
incremental region state and hole cache (`worker/regionWorker.ts`, all logic in the pure
`worker/regionFrame.ts`) — computes frame N's exclusion holes while the canvas paints frame N−1.
The gesture keeps writing `moveStation` per pointermove exactly as always; the worker's mirror is
kept current by identity-diffing the geometry slice and posting changed records whole (which is
what makes a mid-drag ring capture correct without the protocol knowing captures exist). Depth-1
with latest-wins coalescing: one frame in flight, newer input folds into the next. Each RESULT
lands the frame's doc slice, its packed holes, and the snap guides captured with its input in one
synchronous block — one React render, so strokes, clips and guides can never paint from different
frames (`state/dragFrame.ts`; the five drag hooks publish guides through `useRoutedSnapGuides`).
While holes are being served, MapCanvas's synchronous region build stands down entirely. Every
gesture exit — commit, cancel, rollback, and the steal — drains via the store's `onHistoryGroup`
events: disarm, bump the generation (late RESULTs are dropped), snap the render source back to
the live doc, resync the mirror. Worker errors and frame timeouts fall back to the synchronous
path mid-gesture; that path is never deleted — it is the at-rest path, the small-map path, and
the reference the worker's output is pinned byte-equal to (`regionFrame.test.ts`, plus an e2e
that replays sampled mid-drag frames at rest and requires identical paint).

**Specs are identity-stable.** Both interlining builders finish through a single-slot reuse
layer: a band/marker spec whose every compared field equals the previous build's comes back as
the SAME object (`BAND_SPEC_FIELDS`/`MARKER_SPEC_FIELDS` classify every field as
compared/derived/excluded, so adding a spec field fails to compile until classified). One
station's drag frame therefore re-renders only the corridors it touches — every other
`SegmentBand`/`StopMarker` memo bails on reference equality — and every identity-keyed cache
downstream (unit hashes, stripe paths, stripe bodies, marker footprints) survives the frame.
`assignLinePriorities` must consequently never touch a pristine spec: `bands` stamps priorities
through `withLinePriorities`, which clones per pristine spec and caches the clone so per-spec
identity stays stable across frames.

The stations side works the same way: `stationsGeometrySig` hashes only the station fields
`buildBandGeometry` / `buildStopMarkers` read (x, y, rotation, circleId, per-stop
lineId/row/col/orientation/viaCircle) and keys both the `bandsGeometry` and `renderables` memos —
NOT the raw `stations` reference. Label
edits (the whole `label` block) and per-stop `dotStyle`/`dotSize` are absent from the hash, so an
Alt label fine-drag streaming `setLabelOffset` per pointermove repaints the label without re-running
band routing or the marker sort. Pinned by `MapCanvas.stationsSig.test.tsx`. A third sig,
`circlesGeometrySig` (id/x/y/radius per line circle), joins the deps for the same reason the
interline gap is hashed: a viaCircle arc reads the circle's center + radius, and the hash must not
lean on the coupling that circle edits also move bound stations. `regionGeometrySig` hashes the
same three additions.

---

## UI chrome

- **[Toolbar.tsx](src/components/Toolbar.tsx)** — Canvas menu (New / **Make a copy** — forks the
  live doc into a new library map / Save version — greyed out while the doc is `clean`, see
  saveBaseline.ts / **Revert** — discard unsaved changes back to the last save/load, disabled
  when there's nothing to discard / Load → {JSON…, From library…} / Export → {PNG, SVG, PDF, JSON}
  / Clear), Add-item menu
  (toggles `uiMode`; includes **Image / SVG…** — imports `.svg`, `.png`, or `.jpg/.jpeg` via
  `svgImport.ts` into an `SvgImage`), tool buttons (arrow/hand), grid-size + grid-visible +
  dark-mode toggles, the **View menu** (`ViewPopover` — the eye button; see Viewport), the
  layering-mode button, Reset view, and the sidebar toggle. The Canvas menu also carries the two
  local chrome preferences — the **Dark UI in day** checkbox and the **Day canvas color** submenu
  (white/gray/black paper) — which live in `useViewportStore`, not the doc.
  Its leftmost element is the **`BrandBadge`** wordmark — the app name drawn as an "M" route
  bullet (`BrandBullet.tsx`) rather than text; alt-click knocks it loose into the easter egg (see
  `BouncingBullet`). Also embeds `MapNameField`, `MapVersionPill`, `SnapToggleBar`,
  `PalettesDialog`, `ViewPopover`,
  the **`⚡` `PerfPopover`**
  ([PerfPopover.tsx](src/components/PerfPopover.tsx) — a one-shot snapshot of `devCounters()`
  taken when it opens, for diagnosing a session that has grown slow; see the `debug/` folder),
  and the **`?` `HelpPopover`**
  ([HelpPopover.tsx](src/components/HelpPopover.tsx) — a quick-reference interaction guide, also
  opened by the `?` key). Owns **`captureExportSnapshot`** — a detached clone of the canvas as the
  export should see it, neutralizing **three** pieces of transient view state that would otherwise
  bake into the file, none of which is a decision about the map's content:
  1. a **selected line** desaturates every other line;
  2. **layering mode** fades labels, bullets and line tags to 25% — and that fade is an `opacity`
     on content groups, not chrome carrying `data-export-exclude`, so it CLONES;
  3. any **hidden layer** that gates exported ink, restored from the `VISIBILITY_ITEMS` registry
     via `exportVisibilityOverrides` rather than one hand-written line per flag — the hand-written
     version silently shipped exports missing whatever layer a later toggle added.

  Apply → clone → revert all happen inside **one synchronous task**: `flushSync` commits each
  repaint to the DOM immediately but the browser gets no frame in between, so nothing the user set
  is ever visibly disturbed. That is the whole reason for snapshotting rather than holding the LIVE
  canvas in the export state across the async work — font embedding, PNG rasterization and PDF
  generation run for seconds, which would flash a hidden network back on for the duration. Both the
  restore and the layering clear go through **bare `setState`, never the actions**: `selectLine`
  would kick an in-progress Edit Stops session back to idle, and `setUiMode` would wipe the
  selection on the way back in — the user's layering session must be restored, not re-entered. The
  same helper backs the library **thumbnail**, so a version saved with a line selected still
  pictures the finished map.
- **[PalettesDialog.tsx](src/components/PalettesDialog.tsx)** — the palette manager, opened by the
  toolbar's colour-wheel button: your **library** on the left, the palettes **this map** paints
  with on the right. Unlike the map library the two columns are independent lists rather than a
  master and its detail, so nothing is selected and every command lives in the row it acts on, as a
  fixed grid of icon slots — a built-in's missing edit and delete leave their slots open, which
  is what keeps the colour strips ending at one edge. The two transfer arrows are outermost in
  their rows, each against the column it points into; the map rows' last slot is a drag handle —
  the editor's reorder gesture on the same hook, one `reorderMapPalette` write at the drop. The
  manager and the map library share one
  **`.dialog-*`** shell in styles.css (backdrop, panel, black title band, column heads, lists,
  rows); what stays per-dialog is only what one list has and the other doesn't.
  Every command that destroys or displaces a palette takes the in-place speed bump
  ([dialogRow.tsx](src/components/dialogRow.tsx)'s `useSpeedBump`) — the same glyph washed red,
  with a title naming what the second click will cost — in **both**
  columns, whether or not undo could reach it. Undo-reachability is deliberately not the test:
  these buttons sit side by side in one row, and a gesture that changed meaning between adjacent
  glyphs would be worse than a redundant click. Only commands that displace nothing act on one
  click.
  A row's pencil (and the library head's **New…** menu — from empty, or from the map's custom
  colors, both landing in library and map like Load…) swaps the columns for the
  **[PaletteEditor](src/components/PaletteEditor.tsx)** view, a back arrow joining the title band:
  the palette's title and description (double-click to edit — renaming lives here now), then one
  fixed-height row per color — a drag handle
  ([useRowDragReorder](src/components/useRowDragReorder.ts), preview local, ONE upsert at the
  drop), the color as an index route bullet, a ColorField, the
  name, a speed-bumped delete — under an Add color row. Edits are live against the ONE copy the
  pencil named (New… opens on the map copy), and recoloring a MAP swatch also repaints the lines
  wearing the old color in the same write (`recolorMapPaletteColor`, matched via `normalizeHex`
  exactly as the picker matches) — so the canvas follows a picker drag live. Escape peels name
  edit → editor → dialog, gated through a ref because Radix hears Escape on a document listener;
  the dialog owns its own Ctrl+Z/Y (the app's global handler reads role=dialog as a form context),
  and the black band drags the window (a position:relative offset, never a transform — that would
  become the containing block for the ColorField popover's position:fixed).
- **[StatusToasts.tsx](src/components/StatusToasts.tsx)** — the status-message surface (Radix
  toasts sliding in over the canvas, lower-left). Actions report outcomes by calling `pushToast`
  ([state/toastStore.ts](src/state/toastStore.ts)) — a plain Zustand store (`useToasts`) so any
  module can report without threading a setter — rather than rendering their own message. Toasts
  **stack** (one failure never hides another): `push` appends with a unique incrementing id;
  `dismiss(id)` drops exactly that one. `error` persists until clicked; `info` self-expires
  (StatusToasts owns the timing). Distinct from `WarningToasts` (the router band-warning strip).
- **[BouncingBullet.tsx](src/components/BouncingBullet.tsx)** — an easter egg, and the only layer
  above the toasts (z-index 2000). Alt-clicking the toolbar's "M" badge knocks it loose as a ball
  that falls, bounces off the window edges and rolls, until a click on the map (or Escape) puts it
  back. **Modal**: a full-window scrim dims and swallows the app, and App's global key handler
  early-returns for the whole stretch, so nothing behind it can be reached. Its
  [state/funMode.ts](src/state/funMode.ts) store is `off | live | exiting` — three phases because
  both ends are crossfades — and is deliberately NOT a `useSelection` ui mode, whose mode-exit
  subscriptions a toy has no business entangling. The simulation is a pure module,
  [fun/ballPhysics.ts](src/fun/ballPhysics.ts), whose `DEFAULT_PARAMS` are hand-tuned feel rather
  than derivation: a test pinning a mechanism dials that param in explicitly instead of reading the
  tuned value, which may well be zero.
- **[Sidebar.tsx](src/components/Sidebar.tsx)** — Stations/Lines/**Styles** tabs (each showing a
  count; the reserved "None" stop-dot is hidden from the Styles list and excluded from its count),
  the latter two hosting `LinesPanel` and `StylesPanel`; a sortable station list
  (rows select/deselect; the station editor itself is an on-canvas popover), and a Lines list
  that is purely delete / pick-for-editing — clicking a row goes **straight into
  Edit Stops** (there is no selected-but-not-editing state) and the line editor rides in the
  pinned `LinePopover`, not the sidebar. It offers **no z-order control**: which line paints in
  front where two *bodies* overlap is settled per overlap by region painting, so stacking is not
  something the user reorders. `lineOrder` survives as the default winner for an unpainted face
  and as the source of stop-marker z-priority — it simply has no UI, and new lines land front-most
  by `addLine`. The station list sorts by clickable column headers (`SortHeader`, the active
  one flipping direction); the Lines list instead carries a sticky `.list-controls` bar — a "Sort
  by" dropdown (Name / # Stops, always ascending) beside a "Group by style" checkbox that files the
  rows under collapsible per-style subheaders, styles alphabetical, the untagged "Custom" bucket
  last, the sort applying WITHIN each group
  ([lineListOrder.ts](src/components/lineListOrder.ts) owns that whole ordering as a pure
  function). Those controls ride the TOP of the scroll box rather than a footer: a bar pinned to
  the bottom disappears under the horizontal scrollbar as soon as a long row widens the content.
  Those controls read [lineListPrefs.ts](src/state/lineListPrefs.ts) — a store, not panel state,
  and the one `*Prefs` store that is deliberately NOT persisted (a collapsed set of style ids
  restored into a different map would collapse groups at random). It has to outlive the panel:
  clicking a row hides the sidebar for Edit Stops, which unmounts `LinesPanel`, and a sort or
  grouping must not reset on every edit. The whole panel hides while either pinned
  top-right editor mode is active (`sidebarVisible`: `editing-station-layout` or
  `appending-to-line`), ceding the corner. Stop/topology editing is **canvas-driven**
  ([appendGestures.ts](src/model/appendGestures.ts)): click stations to connect,
  click a segment to insert into it, **alt-click** an empty spot — or the already-armed segment —
  to create a fresh station there (splicing it into the segment when that is what's armed)
  (manipulation-free mode — dragging/rotating a station is unwired from the editor, so a stray drag
  can't disturb the map), Delete/× removes the armed stop/edge, and right-click exits the mode
  (removing nothing). A segment's line style cycles three ways, all through the one `NEXT_STYLE` map:
  shift-clicking the band stripe, shift-clicking an armed segment's **endpoint station** (the
  `cycle-style` decision — how a segment buried under its endpoints stays restyleable; shift
  NEVER adds to the line), or clicking the **style-cycle chip** that flanks the × chip on the
  armed segment. Alt-click deep-picks a buried segment (see the Edit Stops alt-pick above), and a
  50%-opacity hover preview shows the ring/halo the next click will place — plus, on a station the
  click would actually ADD, its name in the line color and the corridor(s) the click would draw
  (see `appendHover` under Selection). **Double-clicking a
  station already on the line** hops out to that station's `editing-station-layout`
  (`startEditingStationLayout`) — the mode's answer to "this stop's dots are wrong"; a station NOT
  on the line has no dblclick at all. The two clicks underneath still run the append gesture, so a
  pen armed elsewhere connects first (deliberate: the click matrix means what it always means, and
  it stays undoable). Editing a line's topology happens HERE, on the canvas — there is no
  tree/graph editor in the sidebar.
- **[LinePopover.tsx](src/components/LinePopover.tsx)** — the line editor's home: mounted by
  `ItemPopovers` for the whole `appending-to-line` mode, hosting `LineInspector` (name, service
  code, color palette, style row, default dot type + **two** separate sizes — singleton and
  interchange, line width, **interline gap**, curve radius, **line ends**, stroke width/color,
  **dash length/width**) over a Delete-only `PopoverFooter` (lines have no `locked` field;
  Delete also exits the mode). The stroke color renders only while the stroke width is non-zero
  — a 0-width casing has no color to pick. (What shows inside a branch mouth is not here at
  all: that is a per-junction region choice, painted in Layering mode.) Identity
  (name/service/color) and the Style picker always show; everything from **Line width → Stroke
  color** collapses into a style-detail section so the panel stays compact while editing stops,
  and that open/closed choice is a persisted UI preference (`useLineEditorPrefs`, defaulting to
  collapsed) rather than document state — it sticks across lines and reloads, mirroring
  `useStationEditorPrefs`.
  Docked top-right like every other canvas panel
  ([usePinnedPopover.ts](src/components/canvas/usePinnedPopover.ts)); the sidebar cedes the
  corner for the whole mode. `reconcileWithDoc` exits the mode if undo removes the edited line.
- **[StationPopover.tsx](src/components/StationPopover.tsx)** — the station editor's home:
  mounted by `ItemPopovers` for a sole-selected station (idle mode, or that station's own
  layout-edit mode), hosting the full `StationInspector`. Its title band shows the
  station's SHORT name (`stationNameListText`, falling back to "Station"). Layout: a **button bar**
  (**Edit layout** button, then the **Select Similar** mirror-matching toggle, then a
  right-justified **WP** toggle; lock lives in the footer), then the Name field on its own row,
  labeled X/Y + a mirrored ±45° rotate icon pair, a **Stop dots** section (a
  Line/Type/Xfer/End/Size/Direction column header over the per-stop rows —
  [inspector/StopRows.tsx](src/components/inspector/StopRows.tsx): service badge + shape picker +
  **transfer** picker + **line-end** picker + dot size + a world-true orientation cycle button per
  stop. The three glyph pickers cluster first, so a row reads as a strip of what the dot LOOKS like
  before the numbers start; every control renders on every row, so the columns hold their positions
  down the list. The **Xfer** picker ([TransferPicker.tsx](src/components/TransferPicker.tsx)) is
  the ONLY way to give a stop a self-transfer or take it away: "None" plus every transfer style,
  each with a true-scale disc preview, over a glyph trigger that shows what is actually on the dot
  (`Custom` when the transfer has been hand-tuned off its preset). The **End** picker is DISABLED
  where the stop isn't one of its line's ends rather than absent (an empty slot read as a rendering
  fault); it shows the RESOLVED end, so picking the line's own value clears the pin instead of
  storing a redundant one. Neither is mirror-dispatched, unlike dot type and size — an end belongs
  to this line's shape here and a self-transfer to this interchange, not to a look worth spreading
  across matching stations.
  Hover cross-highlights the dot via `hoveredLineStop` — on NATIVE mouseenter/mouseleave, not
  React's synthetic pair, because the pickers' panels portal out to `.app` and so count as
  inside the row in the REACT tree: the pointer walking into it would re-enter rather than leave,
  and the panel then unmounts under the cursor with no leave left to fire, stranding a highlight on
  the canvas for good. **Double-clicking the badge** jumps to that line's editor
  (`startAppend`) — the reverse of the line editor's own station dblclick; an **Add-anchor** ghost
  button beside the rows parks a transfer anchor in this station's grid, and under it a **Stop
  type** dropdown writing `Station.stopType` (above) — it closes the loop the line inspector's
  split defaults open: the line says what each case looks like, this says which case a station IS.
  Auto reads as **"Auto (Singleton)"** / **"Auto (Interchange)"**, the count being the one thing
  the control can't show by looking; it asks for the count SPECIFICALLY
  (`stationIsSingletonByCount`), so a declared station reports what reverting would buy instead of
  echoing its own declaration back, and a station with no stops just says "Auto". Live on a
  stopless station on purpose — declaring one before wiring it to a line is a real order of work.
  Mirror-dispatched, unlike the End and Xfer pins beside it), and a Label row whose
  **magic-wand** Auto-placement toggle stays
  put and SWAPS the row between the manual align/valign controls (wand off) and the auto H/V tuning
  controls (wand on) — each a segmented select-one (Radix ToggleGroup, `.align-group`); the manual
  controls keep an explicit `auto` segment so legacy-auto labels stay editable. Beside them a
  **Rotate button** (steps the label's reading direction 45° through all 8 orientations via
  `rotateLabel` — the same action bound to `R` and the layout-editor right-click; it stays on the
  row in both setups, since rotation sets the reading axis that autoAlign still honors), then offset
  controls. The Name typography section keeps its style picker always visible with a collapsible,
  remembered (`useStationEditorPrefs`) Size→Tracking detail. New stations default to Auto placement
  ON (`makeStation` sets `label.autoAlign = true`). Inspectors dispatch transforms directly through **mirror matching**
  (`findMatchingStations` returns stations sharing a line + a layout under the model's 4-fold
  mirror symmetry — whole line, not adjacency; an edit broadcasts through
  [state/mirrorDispatch.ts](src/state/mirrorDispatch.ts), rotating local deltas through
  `rotateGridDelta`; orientation cycles and station rotation are relative steps so odd-offset
  matches stay world-equivalent). The **Select Similar** chip (button bar, between Edit layout and
  WP) drives `mirrorMatching`: off = every dispatch resolves to the source station alone; on =
  stop/label edits + station rotation + the Stop type declaration broadcast, while name, X/Y, and
  the per-station WP / lock / bold / italic flags stay local. Disabled at zero matches unless
  already on (so the mode can always be exited); MapCanvas highlights the match set while on.
- **The painted name on the main canvas is NOT a label handle** — grabbing a selected station
  anywhere on its footprint, name included, drags the whole STATION (StationHitArea gives the name
  rect the same station handlers as the cells rect). The name's own layout (cell / rotation /
  offsets) is edited only via the two surfaces below, never by a plain drag on the main canvas.
- **Station layout editing happens ON the canvas** (the sidebar mini-canvas "StopGrid" was
  retired in favor of these two surfaces; its pure drag/ghost math lives on in
  [inspector/stopGridDrag.ts](src/components/inspector/stopGridDrag.ts) — `computeGhosts`,
  `findDropTarget`, `nudgeTarget`, all choosing their lattice in screen terms and reading it back
  in station-local cells via `localLatticeOffsets`). Slots hang off an **anchor** node — the
  station node nearest the cursor — for pitch and phase. During a drag the WINDOW of slots rides
  on the CURSOR at `DRAG_GRID_RADIUS` (a 5×5 block; `computeGhosts`' `center`, `latticeOffsets`'
  window shift), so the slots always surround the pointer and a move of any length lands in one
  gesture. A keyboard nudge has no pointer, so it rides the moving node's own cell at the wider
  `GRID_RADIUS`, far enough for one press to clear a run of packed neighbors (a label hops past two
  tangent stops to the free slot beyond). Sliding the window never moves the lattice, so ring-1
  tangency and the anchor's axes survive, and a node sitting off-lattice heals when the window
  snaps to the nearest lattice point. The anchor's own cell is never a slot. While a drag is live
  the moving node's static handle is HIDDEN — it rides the cursor as the white ghost lattice plus,
  on the snapped slot, its OWN handle in the selected state (`LayoutNodeHandle`, the one component
  both the editor and the drop preview paint every node with, so the preview is the node as it will
  land). The projection anchor the lattice comes from is painted amber instead of white, marking the
  origin the slots hang off.
  Two surfaces:
  1. **`editing-station-layout` mode** ([canvas/StationLayoutEditor.tsx](src/components/canvas/StationLayoutEditor.tsx)
     - [useStationLayoutDrag.ts](src/components/canvas/useStationLayoutDrag.ts)): entered by
       **double-clicking the station** on the canvas, or via the inspector's **Edit layout** button
       (`startEditingStationLayout` preserves selection + mirror
       state; frames the camera if the station is off-screen). Clicking another station RETARGETS
       the mode to it (`layoutEditReconcile`: the mode follows the sole-selected station; a
       multi/empty selection exits to idle). Grab rings over each real dot (each wearing the
       drawn orientation arrow, sized to fit its own ring — not off the dot like the map's hover
       badge, where a service-code disc would scale the arrow past the ring it has to live in) +
       a label-cell ring. One node's ring + glyph is
       [LayoutNodeHandle.tsx](src/components/canvas/LayoutNodeHandle.tsx), which the editor and the
       drag's drop preview both paint through (`idle` white / `active` blue / `project` amber), so
       the two surfaces can't drift. A stop ring wraps its own line's STRIPE — half `lineWidthOf`,
       never inside the dot it covers, floored only at half `LINE_WIDTH_MIN` — not the lattice
       cell, which gave every thin line a DEFAULT-width ring: a 3-wide line with 3-wide dots wore
       a 14-wide handle that buried the stops it was there to grab. Each grab handle carries a native `<title>` — a stop ring names the
       line it serves, an anchor ring reads "Transfer anchor" — so an interchange's identical
       rings are distinguishable on hover without a legend. The stop tooltip is
       `lineDisplayName(line)`, the **same** helper the sidebar's line row and the inspector's
       stop badge use: a line's user-facing name is its own `name`, falling back to
       `"<service> line"`, and to `'Unknown line'` for a line that's gone. One helper because
       these strings sit side by side, and a user hovering the same stop on two surfaces must
       not be told two different names (the badge used to drop a named line's name). All of that chrome is in **world** units, geometry AND stroke weight,
       so it grows with the map and reads the same at every zoom; the component reads no zoom at
       all, because sizing off the COMMITTED zoom (`X / zoom`) held a screen size that went stale
       mid-gesture and snapped when the camera committed. Drag between ghost slots, drop on a
       stop swaps, right-click/R rotates, click selects the stop/label (arming the shape/size
       pickers). A transparent **shield rect** swallows near-miss presses so nothing falls through
       to the whole-station handlers (the mode is in `RIGHT_CLICK_PASSTHROUGH_MODES`).
  2. **Keyboard nudge** (App.tsx): with a stop/label selected, arrows hop one lattice slot in the
     pressed screen direction (`nudgeTarget`, Shift = diagonal), Alt+arrows fine-nudge label
     offsets (Shift ×5, live-writing `setLabelOffset`/`setLabelOffsetPerp` via
     `screenDeltaToLabelOffsets` — the inverse of labelLayout's offset axes), R rotates.
     Both surfaces share
     [state/mirrorDispatch.ts](src/state/mirrorDispatch.ts) — `dispatchMirrored` (one-shot
     controls, groups only when fanning out and no group is open — see the isHistoryGrouping
     gotcha) / `fanOutMirrored` (group-free, for explicit multi-write groups) — and capture mirror
     matches at gesture start (the first write to the source dissolves the match).
- **Numeric fields**: `useFieldHistory` opens a history group on focus and commits on blur (and on
  unmount, as a safety net); `useNumericField` wraps it with a local text mirror, a focus guard,
  and wheel-to-increment off the live value. `NumericFieldRow` pairs a slider + spinbutton sharing
  one group so a drag + typing collapse to one undo entry.
- **`StationNameEditor`** opens on **shift+double-click** on the canvas (plain double-click is the
  layout editor), and intercepts Ctrl+Z itself — native input undo would creep the doc back
  one char per press; it commits the rename group, runs doc-level undo/redo, then closes.

---

## Export pipeline

[exportCanvas.ts](src/export/exportCanvas.ts) + [fonts.ts](src/export/fonts.ts). Turns the canvas
`<svg>` into a standalone SVG, a 4× PNG, or a vector PDF
([exportCanvasPdf.ts](src/export/exportCanvasPdf.ts) + [pdfHatch.ts](src/export/pdfHatch.ts)).

**`source` is a DETACHED SNAPSHOT, not the mounted canvas** — the Toolbar's
`captureExportSnapshot` has already applied and reverted the export-only view state around a
synchronous clone (see UI chrome). So step 1's "clone, don't rebuild" is a clone of a clone; the
live canvas is never held in export state across the async work.

`buildExportSvg(source, {background, pixelScale, fitBox?, embedFonts?})` (async — awaits font
fetches; `fitBox` overrides `pixelScale`, `embedFonts` can skip the font inlining for callers that
don't need it, such as the library thumbnail):

1. **Clone, don't rebuild** (`source.cloneNode(true)`) — label/tag geometry is measured against
   the _live_ DOM, so cloning is the only faithful capture.
2. **Strip editing chrome**: remove `[data-bg]`, `[data-export-exclude]` (grid, highlights,
   ghosts, guides, handles — tagged in `MapCanvas`), and `foreignObject` (inline editors).
3. **Measure bounds offscreen** via `getBBox` (needs the element rendered → appended to an
   off-screen div, removed in `finally`).
4. **Empty guard is an AND** — throws only when _neither_ bbox dim is positive (`!(w>0) && !(h>0)`),
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
embedded SVG graphics kept as vectors (bar mask users, gap 7). Eight gaps svg2pdf/jsPDF can't bridge
are closed here:

1. **Fonts** — jsPDF ignores the SVG's `@font-face` and can only embed TrueType, so the map's used
   faces are fetched and registered in jsPDF's VFS (the reason the whole set ships `.ttf`).
2. **Hatch** — svg2pdf can't tile a `<pattern>` along a stroke, so every hatch paint (band strokes
   **and** the stop markers on them) is baked into clipped solid-stripe geometry; the stripe math
   lives in the pure, unit-tested [pdfHatch.ts](src/export/pdfHatch.ts) (`ribbonFromCenterline`,
   `hatchStripeRects`, phased off the world origin so a band and its marker read continuous).
3. **Image drop shadows** — svg2pdf re-parses an svg+xml `<image>` as vectors but ignores
   `<filter>`, so a logo's hard `feDropShadow` casing would silently drop; `bakeImageDropShadows`
   bakes it into a real offset silhouette (pure core in the unit-tested
   [pdfDropShadow.ts](src/export/pdfDropShadow.ts)).
4. **Text baseline** — svg2pdf never reads `dominant-baseline` (only `alignment-baseline`), so any run
   carrying one lands on the alphabetic baseline, too high. [pdfText.ts](src/export/pdfText.ts)
   `normalizeTextBaselines` measures each `<text>`'s box vs its forced-alphabetic box (`getBBox`,
   browser truth) and shifts `y` by the delta — exact for any baseline mode/font without metrics.
   **In practice it only fires for `SegmentBand`'s ⚠**: badge glyphs (`capCenterDy`) and label text
   (`firstLineBaselineY`) are already ON the alphabetic baseline, so the export inherits their
   platform-invariant position instead of re-deriving it from whatever the browser painted.
5. **Letter-spacing** — svg2pdf ignores the SVG `letter-spacing` property, so a tracked label would
   print at default spacing. `bakeLetterSpacing` ([pdfText.ts](src/export/pdfText.ts)) re-expresses
   each tracked run as an SVG `textLength` (which svg2pdf converts to a PDF `charSpace`); it runs on
   the attached clone (needs `getComputedTextLength`) and **AFTER** glyph outlining (gap 6). That
   order is load-bearing and easy to get backwards: outlining SPLITS a mixed `<text>` (an
   `<xfer>`/`<air>` glyph beside ordinary letters) into an outlined path plus a fresh covered run,
   so baking first would consume the tracking on the original node and leave the split run
   untracked — silently collapsing that label's spacing in the PDF.
6. **Uncovered glyphs** — characters Helvetica Neue lacks (✈, ↔, ★, …) are drawn on screen by the
   shipped fallback font in [`FONT_STACK`](src/util/fonts.ts) (`'Helvetica Neue', 'DejaVu Sans', …`),
   but svg2pdf only embeds HN and jsPDF can't even encode supplementary-plane chars. Because the app
   already renders these in DejaVu, the PDF just traces the **same** font:
   [pdfGlyphs.ts](src/export/pdfGlyphs.ts) `outlineUnsupportedText` (run after normalization, so
   positions are alphabetic) keeps HN-covered characters as positioned selectable text (`partitionRuns`
   in [pdfText.ts](src/export/pdfText.ts)) and replaces each uncovered one with a vector `<path>` from
   DejaVu via `opentype.getPath` at the browser's own pen position — 1:1, no fitting, since screen and
   PDF share the font. A character in neither HN nor DejaVu is dropped (renders nothing). `textMeasure`
   measures inline-bullet labels with the same `FONT_STACK` so a symbol's measured advance matches its
   drawn advance.
7. **Image masks** — that same svg+xml-image re-vectorizing has **no `<mask>` support** (`<mask>`/
   `<defs>` parse to no-op void nodes and the `mask="url(#…)"` attribute is never read), so a graphic
   using a mask exports at full opacity — the mask silently drops (it renders fine on screen via the
   browser's native `<image>`). A mask has no vector equivalent, so `rasterizeMaskedImages`
   ([pdfMask.ts](src/export/pdfMask.ts)) rasterizes **only** the mask-using graphics to a PNG (the
   browser applies the mask) that svg2pdf embeds verbatim; everything else stays vector. Runs before
   the drop-shadow bake, which then skips them (href is now a PNG). `svgUsesMask`, `rasterPixelSize`,
   and `sizeSvgRoot` (which injects a `viewBox` so a no-viewBox graphic scales to fill) are pure and
   unit-tested; the canvas rasterizer is browser-only (e2e-covered, incl. an `/SMask` guard that the
   mask survived).
8. **Translucent (hex8) colors** — svg2pdf.js truncates an 8-digit `#rrggbbaa` paint to its first 6
   digits and drops the alpha, so a translucent fill/stroke would print fully opaque; it _does_ honor
   a separate `fill-opacity`/`stroke-opacity` (jsPDF writes it as a real PDF `ExtGState /ca /CA`). So
   `splitAlphaColors` ([pdfAlpha.ts](src/export/pdfAlpha.ts)) rewrites every hex8 paint on the export
   clone into a 6-digit color plus the matching opacity attribute, composing (multiplying) with any
   opacity the element already carries. Runs **last**, after the other bakes, so hex8 colors those
   steps copy forward (a translucent line color baked into a hatch stripe, an outlined glyph
   inheriting a translucent label color, a drop-shadow flood) are caught too. Pure and unit-tested;
   the SVG/PNG paths need none of it (browser/canvas composite hex8 natively).
   Lazy-loaded on first PDF export (`import()` in the toolbar) so jsPDF + opentype.js stay out of the
   initial bundle.

[color.ts](src/util/color.ts): pure hex math — `legibleTextOn` (W3C luminance → `#000`/`#fff`),
`withAlpha`, `blendOver`, `desaturateColor`, plus the RGBA surface added with the react-colorful
picker: `parseHexA` (→ `[r,g,b,a]`, preserving alpha from `#rgba`/`#rrggbbaa`), `withHexAlpha`
(replace a color's alpha byte), and `normalizeHex` (canonical stored form — lowercase, shorthand
expanded, an opaque `ff` suffix stripped back to 6 digits so opaque colors still match palette
swatches). `parseHex` (module-private) and its exported companion `parseHexA` fall back to opaque black `[0,0,0(,255)]` for any
malformed input (e.g. a 7-hex-digit string from a hand-edited file), so NaN never reaches the
downstream luminance / `rgba()` math.

---

## Conventions & invariants (consolidated)

- **A palette is identified by its NAME** — in the library and in a map alike. Both upsert by
  name, so an add or a save that lands on an existing name REPLACES it (the manager asks first);
  built-in names are reserved against imports. A map carrying no palettes at all is legitimate,
  and so is a palette carrying no swatches (the editor mints them empty). A swatch's `night` is
  stored only when it differs from `color` (day) — parse, sanitize, and the editor all collapse
  the equal pair away — and a `description` is a real string or absent, never `''`. Swatch colors
  may carry alpha (`#rrggbbaa`, canonical `normalizeHex` form).
- **Transforms return the same reference on no-op** — the foundation of undo grouping
  (`docSnapshotsEqual` is reference equality). A mutate-in-place transform would silently break
  history.
- **Canonical stored form**: optional fields are **absent when equal to their default**; setters
  clamp/round/lowercase and drop at default. `DotStyle` objects are written in fixed field order
  so `JSON.stringify` equality is exact for app-written docs.
- **Referential integrity after every action**: `line.stations[i] ∈ stations`; `stop.lineId ∈
lines`; every `segmentStyles` key is a real, non-default adjacency; every `stationEndStyles`
  key is a station its line still STOPS at (liveness, not endedness — see
  `Line.stationEndStyles`; it never repeats the line's own end either); every
  tag/transfer endpoint and `routeBullet.lineId` resolves live-or-null. Maintained by cascade
  prunes after structural edits (`deleteStation`/`deleteLine`/`removeStationFromLine`/…).
- **`LineTag.fromStationId < toStationId`** always (canonical/alphabetic, = `pairKeyOf`).
- **`DOC_FIELDS` is the single source of truth** for persisted/undoable fields — it is **not**
  `Object.keys(DEFAULT_DOC)`; keep them in sync (a field in `DEFAULT_DOC` but not `DOC_FIELDS`
  would default but never persist/undo).
- **Parallel arrays in a band** (`lines`, `paths`, `stripeOffsets`, `stripeWidths`,
  `linePriorities`, `arms`) are index-aligned; `stripeOffsets`/`stripeWidths`/`radius` are the
  single source of truth — read them, never re-derive; sample with `band.radius`, not a line's raw
  `curveRadius`.
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
- **Two opposite z-order conventions** — `lineOrder` index 0 = top; `backgroundOrder` last = top.
  `addLine` prepends, `addPolygon`/`addSvgImage` append.
- **Polygons and svg images share ONE z-stack** (`backgroundOrder`) — they interleave, so neither
  kind is structurally above the other. Anything that walks the band must resolve kind per id
  rather than emit two kind-grouped blocks: the body pass, the drag-proxy pass (whose order is
  the grab-priority tiebreak between two overlapping SELECTED items), and `lockedHitsAt` all do.
  ([MapCanvas.tsx](src/components/MapCanvas.tsx), [hitStack.ts](src/components/canvas/hitStack.ts))
- **`resolveDotRender` size param trap** — pass `dotSizeOverride` (the override-only value,
  `undefined` when tracking defaults), **never** `resolveDotSize` (the resolved value), or
  default-tracking service-code discs shrink to r 4. ([dotStyle.ts](src/model/dotStyle.ts))
- **`width` is GEOMETRY, `strokeWidth` is PRESENTATION** — a width edit rebuilds bands; a stroke/
  color/style edit is resolved live. The band-geometry memo signature deliberately excludes
  everything but width. ([types.ts](src/model/types.ts), MapCanvas). A width edit also MOVES
  stop cells: tangent chains re-pack to the new gaps ([stationPacking.ts](src/model/stationPacking.ts)),
  so don't assume stop rows/cols survive `setLineWidth`.
- **Casing rails must stay centered on body edges** — adjacent stroked lines' facing rails occupy
  the same pixels so an interlined band reads as one uniform stroke. Reordering line casings to
  merge separators was **tried and reverted**. ([lineStroke.ts](src/model/lineStroke.ts))
- **The interlining golden snapshot is sacred** — a 1-ULP drift in offset math slides every
  painted path on every existing map while staying green elsewhere. (`interlining.golden.test.ts`)
- **`toFixed(6)` in the router is load-bearing** — lower precision caused band/marker hash-bleed.
  ([router.ts](src/geometry/router.ts))
- **`clipPath`/`mask` content is raster-snapped by Blink** — the browser rasterizes clip _resource_
  content on a ~1-unit grid in its local user space (zoom-independent), so a world-coordinate clip
  edge can snap by up to a whole world unit and erase the clipped line over exposed background.
  `RegionExcludeClips` defends by emitting clip content in ×64 local coords under
  `transform="scale(1/64)"` — the shared `CLIP_RASTER_SCALE`/inverse in
  [clipRaster.ts](src/components/canvas/clipRaster.ts) — shrinking the snap to 1/64 unit. Invisible
  under full tangency; the interline gap (which exposes bare background at hole edges) is what
  surfaced it. Relatedly, the region-exclude outer ring is a **content-sized AABB**
  (`regionClipBounds`, bands + markers, padded), not the old `±500000` constant whose device-space
  magnitude was itself a deep-zoom precision hazard; and `EXCLUSION_INSET` (the hole's retreat
  inside the winner) is `0.00625`, tuned near-flush so a loser can't bite the winner's edge once
  that edge faces open background instead of tangent paint.
- **Single- vs multi-stripe radius cap diverge** — single-stripe bands may cap _below_ the user's
  R (a tighter curve reads as intentional); multi-stripe bands floor _at_ R (dropping below
  collapses inner stripes). ([interlining.ts](src/geometry/interlining.ts))
- **`perp` vs `leftNormal` are intentionally negations** (different y conventions); using the
  wrong one flips stripe order. ([vec.ts](src/geometry/vec.ts))
- **Text measurement silently differs app vs test** — real canvas `measureText` vs a
  `length × (0.55·fontSize + letterSpacing)` over-estimate under jsdom. Exact tests inject a
  `measure` stub.
  ([textMeasure.ts](src/geometry/textMeasure.ts))
- **Web-font load invalidates the measure cache** — `App.tsx` clears `_clearTextMeasureCache()`
  and bumps a font epoch on `document.fonts.ready` + `loadingdone`; without it, first-paint labels
  (measured against the fallback font) stay a pixel off until the next edit. ([App.tsx](src/App.tsx))
- **The two load paths must not be merged** — `storeMigrate.test.ts` pins reference-equality
  pass-through for canonical docs; file-only sanitizers must not leak into `migrateDoc`.
- **Sanitizer ordering is load-bearing** — `convertLegacyDotShapes` and `sanitizeStopDotSizes` run
  _after_ the per-line clean (a stop compares against the _sanitized_ line default).
- **Polygon dark colors backfill to EQUAL light; text-label dark colors backfill to DIFFERENT
  defaults** (`#111111`/`#ffffff`) — for legibility. Don't assume symmetry.
- **`Polygon.closed`/`curveRadius` have no backfill** — absent is meaningful (closed/sharp), so
  legacy polygons render unchanged. The legacy `fillOpacity` percentage was folded into the
  `fill`/`darkFill` alpha and removed in the **v9** migration (`foldPolygonFillOpacity`, shared by
  `parse()` + `migrateDoc`).
- **An abandoned append placeholder rolls back `lineCounter` by 1** — "Add → Line" eagerly commits
  a placeholder line and bumps the counter to pick its color; abandoning it before placing a
  station must undo both in one atomic set, else repeated Add→Esc walks the color cycle forward.
  The rollback is **not** in `cancelAppendMode` (a one-liner that just clears the mode) — it lives
  in `collectAppendPlaceholder`, driven by the **mode-exit subscription**, so it fires on _every_
  exit from `appending-to-line`, not only the named cancel paths. **Real line deletion does not
  touch `lineCounter`.** ([store.ts](src/state/store.ts))
- **Placeholder-ness is MARKED at the creation site, never inferred from the doc.** An empty
  `stations[]` is not evidence: `toggleEdgeOnLine` drops endpoints that fall to degree 0, so
  deleting a two-station line's only edge in Edit Stops empties it too, and collecting that would
  delete a real line — its sidebar row, its tags, its region assignments, every route bullet
  pointing at it — with nothing on screen to say so. `startNewLineAppend` (store.ts, beside the
  GC) is the one way in: it exits any active append first, adds the line, records its id, and
  enters the mode. That single ownership is also what keeps the `lineCounter` rollback sound,
  since it is only correct while the collected placeholder is the last-added line. A doc
  subscription clears the mark the instant the line holds a station — from then on it is a line
  the user built, and emptying it again must not hand it back.
- **`addLine` guards the empty color cycle** — a map carrying no palettes makes `cyclingColors`
  return `[]`, and `n % 0` is NaN; it falls back to `FALLBACK_LINE_COLOR`.
- **`finishDrag`'s cancel branch does NOT reset `suppressClick`** — a never-moved gesture never set
  it; cross-gesture stranding is handled by the capture-phase self-heal instead.
- **Line-tag drag uses window listeners** — the only hook off the shared React-handler path,
  because the drag wanders off the small tag rect. It still converts cursor→world through the
  shared `view.screenToWorld` like every other hook; it does **not** roll its own
  `getScreenCTM().inverse()` (that appears only in the test helper).
- **History groups don't nest, but they do overlap** — zundo's pause/resume is a plain boolean.
  Nested one-shot callers gate on `isHistoryGrouping()` and skip their own group
  (`dispatchMirrored`; explicit multi-write groups use the group-free `fanOutMirrored` inside).
  Overlapping independent gestures (pointerdown fires before a focused field's blur) are resolved
  by `beginHistoryGroup` itself: the newer begin seals the still-open group and the elder's late
  end becomes a no-op — never gate a _gesture_ group, only nested one-shots.
  ([mirrorDispatch.ts](src/state/mirrorDispatch.ts), [store.ts](src/state/store.ts))
- **Mirror matches must be captured at gesture START for drags** — the first write to the source
  station changes its layout and dissolves the match, so a per-move `findMatchingStations` would
  find nothing after the first frame. One-shot controls (`dispatchMirrored`) compute at dispatch
  time, which is BEFORE their single write — equivalent and correct.
- **Export desaturation race** — `captureExportSnapshot` uses `flushSync` to drop/restore the
  transient view states (selected-line dim, layering's 25% content fade, every hidden layer that
  gates exported ink) synchronously so none is baked into the clone. The layering fade is the easy
  one to miss: it is
  an `opacity` on real content groups, not `data-export-exclude` chrome, so the strip pass does not
  catch it and every export **and library thumbnail** taken in layering mode came out
  quarter-strength. ([Toolbar.tsx](src/components/Toolbar.tsx))
- **One `pairKey` can carry SIBLING bands** — two lines sharing a corridor but reaching it on
  different world axes land in different axis buckets, so `buildStopMarkers` indexes bands into a
  `Record<string, SegmentBandSpec[]>` — a **list**, not a last-wins map. A map would hand a
  terminus the tangent of whichever sibling happened to be built last and point its dashed cap stub
  the wrong way. ([interlining.ts](src/geometry/interlining.ts))
- **An edgeless line is still real geometry** — a line with one station and no edges draws no band
  but DOES emit a `width × width` stop marker, which `buildLineBodies` folds into its body and
  which therefore produces overlap faces. `regionGeometrySig` must keep such a line's `width` in
  the hash or a width edit serves a stale face from the region cache. (It has no terminus, so no
  line end applies — a lone stop has no direction to end along, and stays a full square.)
  ([regionCache.ts](src/geometry/regionCache.ts))
- **`pre-pr` ends with the full Playwright suite** — it's the slow step, but interaction-behavior
  changes can invalidate e2e specs without failing any unit test (PR #159's layout-edit retarget
  did exactly that), and migration/rehydration is only covered by e2e (`e2e/migration.spec.ts`).
- **No 600 weight anywhere** — `TextLabelWeight`, the weight tables, and clipboard validation all
  omit 600 (no SemiBold face shipped).
- **Underlines are explicit `<line>` geometry, not `text-decoration`** — Chromium leaves 1px
  residue on rotated `<text>` when `text-decoration` toggles. ([stationLabelText.tsx](src/components/stationLabelText.tsx))
- **A service code is only safe to migrate when it's a valid bullet `CODE`** — `updateLine` rewrites
  `|code|`/`[code]`/`{code}` tokens across every station name and text label when a line is renamed.
  An EMPTY old code degenerates those patterns to the bare delimiters `||`/`[]`/`{}`, which match
  literal punctuation and both halves of another line's UNFILLED bullet. Gate on `isBulletCode`
  ([labelTokens.ts](src/geometry/labelTokens.ts) owns the grammar), and keep the inspector's field
  from writing an empty value through mid-edit.
- **`SIBLING_PRIMARY_CLEAR` must list every selection a foreign selection change invalidates** —
  `selectedVertices` is one: its handles only render for a selected polygon, so a marquee or
  shift-click that leaves it armed leaves it INVISIBLE, and Delete/arrows both give it top priority.
  ([selection.ts](src/state/selection.ts))
- **Dot-style "is this the line default?" is a VALUE question, not an id one** — deleting a stopDot
  style drops the tag but keeps the raw shadow, so a line can draw a style it no longer names.
  Compare against `resolveDotStyle(line, null, isSingleton)` — what the renderer reads.
  ([transforms.ts](src/model/transforms.ts), `setDotStyle`)
- **Editing a stopDot style can detach LINE styles** — dot diameter defaults are style-dependent
  (service-code discs 12px, plain dots 8), so a stopDot edit moves a tracking line's resolved size
  while its line style's props stand still. `updateStyleProps` re-stamps the affected line styles'
  wearers; `deleteStopDotStyle` already did. ([styles.ts](src/model/styles.ts))
- **`parse()`'s DEFAULT_DOC merge fabricates `styles` before the bakes run** — so any bake gated on
  "does this doc already have X" must be handed the pre-merge answer (`hadStyles`), or it no-ops on
  exactly the legacy files it exists for. ([serialize.ts](src/model/serialize.ts))
- **Alignment uses `LineMetrics.alignAdvance`, not `advanceWidth`** — tracking is emitted after
  EVERY glyph, so the pen ends one step past the last ink while the bbox is ink-sized; aligning by
  the raw advance pushes a right/centre-aligned tracked line out of its own selection ring and hit
  rect. The trailing step is reported per segment (0 where the measurer ignored `letter-spacing`),
  never assumed. Line POSITIONING is still pen-space — see `advanceWidth`.
  ([textMeasure.ts](src/geometry/textMeasure.ts))
- **A re-render signal that must cross `memo` has to be a STORE** — the web-font epoch lived in
  App-local `useState`, so `StationView` (memo'd, referentially-stable props) bailed out and every
  station label kept its fallback-font geometry. `state/fontEpoch.ts` is subscribed by MapCanvas
  (for the layers it renders directly) and by StationView (to punch through its memo).
- **Anything screen-px-over-zoom becomes an export bug** — it bakes the live camera into world
  geometry, so the exported file depends on what zoom happened to be committed. The chevron tag's
  edge bleed was exactly this. ([LineTagsLayer.tsx](src/components/canvas/LineTagsLayer.tsx))
- **The snap ENGINE needs its own visibility gate** — `liveAlignTargets` gates the point-snapper
  pool, `liveSnapStations` gates the station record handed to `snapDraggedStation`. A bound route
  bullet stays draggable while the network is hidden, and without the second gate it aligns to
  invisible stops. ([snapTargets.ts](src/components/canvas/snapTargets.ts))
- **`updateTextLabel` re-anchors on a resize**, so stamping a style onto a freshly created label
  MOVES it. Mint new labels already wearing their default style (`addTextLabelWith`) instead, or the
  drop lands half a size-delta from where the placement ghost and the snap agreed.
- **Every image href is inline data, on every way in** — `isAllowedImageHref` accepts only the
  three data-URI prefixes `data:image/{svg+xml,png,jpeg}`. That is what makes an image OPAQUE: a
  map paints without reaching the network, and an exported SVG/PNG/PDF is genuinely
  self-contained. Four entry points share the one allow-list so they cannot drift — the Add →
  Image import, `readClipboard`, and both doc loads via `sanitizeImageHrefs`, which DROPS an
  image (and its `backgroundOrder` entry) exactly as the sibling sanitizers drop a malformed line
  circle. The load repair also rides the persist **`merge`** hook, not just `migrateDoc`'s ungated
  block: a doc saved by the current build never reaches `migrate` at all.
  ([clipboard.ts](src/model/clipboard.ts), [svgImport.ts](src/model/svgImport.ts),
  [serialize.ts](src/model/serialize.ts))

---

## Testing strategy

- **Unit (Vitest + jsdom)** — colocated `*.test.ts(x)`. Heaviest in `model/` and `geometry/`.
  Patterns: **property-based** (fast-check) for serialize round-trips and transform invariants
  (`serialize.test.ts`, `transforms.invariants.test.ts` at up to 2000 runs for narrow cascades);
  **byte-exact golden snapshot** for interlining (`interlining.golden.test.ts`); **invariant
  assertions** (arc-length monotonicity, unit tangents, palette luminance, FONT_TABLE shape);
  **document-order assertions** (`compareDocumentPosition`) for the stroke-before-fill and
  flat-pass invariants (`StationDots.order.test.tsx`, `TransferLayer.dom.test.tsx`);
  **paint-vs-geometry seams**, which render the real component and measure the emitted SVG against
  the pure model value that is supposed to describe it — the way to pin a rule two layers must
  agree on, since matching hand-written expectations on each side would still both be wrong
  together (`StopGlyph.labelClearance.test.tsx`: the painted dot silhouette vs. the clearance
  `stopMetricsOf` reports for it).
- **Integration** ([src/test/](src/test/)) — `App.smoke`, `App.keyboard` (the two-tier form
  guard), `App.fontLoad`, `saveLoad` (round-trip through the real `pickDocSnapshot` path),
  `undoRedo` (value-restore, viewport-excluded-from-history, no-op equality, selection reconcile),
  `wandGalleryDoc` (one station per autoAlign placement case — readable label rotation × stripe
  axis × reading-frame octant mid-line, every exit ray × octant at termini, crossing-stripe
  configs incl. diagonals, plus fallback/phantom/stacking — asserted against `labelLayoutLocal`
  and kept in sync with the loadable gallery map `docs/wand-gallery.massimo.json`; regenerate
  with `UPDATE_WAND_GALLERY=1`).
  Shared helpers: `fixtures.ts` (`makeStation`/`makeLine`/…), `interaction.ts` (synthetic pointer/
  wheel events; a `fakeSvg` with an identity screen↔world CTM, paired by `fakeSvgRef` with a
  stationary host rect and an svg rect that rides the pan layer's transform, so `useViewport`'s
  host-vs-svg measurement is observable; `stubCanvasHostSize()` patches the prototype
  `clientWidth`/`clientHeight` jsdom reports as 0, which any test rendering the canvas needs),
  `setup.ts` (jsdom polyfills: ResizeObserver, pointer-capture, scrollIntoView).
- **E2E (Playwright, [e2e/](e2e/))** — single-worker, no retries locally (2 on CI), honors `PORT` for parallel
  worktrees. `seedAndOpen` seeds a localStorage doc (`Seed*` shapes omit fields to simulate legacy
  saves) and opens the app — **this is the only place the rehydrate/migrate path is exercised**.
  `migration.spec.ts` asserts **zero console errors** loading legacy docs; `export.spec.ts` checks
  the exported SVG is chrome-free with embedded `@font-face` and that PNG is genuinely 4× (reads
  IHDR bytes); `exportPdf.spec.ts` exports a hatch+text+image map and asserts the PDF embeds a
  TrueType CID font (`/FontFile2` + `/Type0`) rather than falling back to standard Helvetica.
- **Perf harness** ([.perf/](.perf/)) — a tracked-but-**ungated** performance layer, invisible to
  every `npm`/CI gate because `lint`/`test`/`build`/`e2e` are all scoped to `src/` and `e2e/`. It
  holds Vitest micro-benchmarks (`.perf/bench/*.perf.test.ts` under `.perf/vitest.bench.config.ts`)
  and Playwright production-build specs (`.perf/e2e/*.spec.ts` under
  `.perf/playwright.perf-prod.config.ts`), each driven against one committed real drawing
  (`.perf/mta-v23.massimo.json`, 464 stations — the single exception to the no-maps-in-repo rule,
  because the numbers cannot be reproduced without a real map's crossing density; override with
  `PERF_MAP`). `npm run perf:check` (`tsc -p tsconfig.perf.json`) type-checks the harness and is the
  only thing about it a gate touches. It is carried in the repo because the previous optimization
  run's harnesses died untracked with their worktree and cost more to rebuild than the optimization
  itself; `.perf/README.md` + `RESULTS.md` record what each measures and the still-open wasm-leak
  investigation behind the Perf popover.
- **Known gaps** (per the deep-dive): no pixel/visual golden for the merged-dot-border result;
  `MapCanvas`'s full pointer fan-out is only tested per-hook. (`Transfer`/`RouteBullet`/`LineTag`
  round-trips now live in `serialize.entities.test.ts`.)

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
  anchor for segment styles and line tags (per-segment layers are retired — see Region layering).
- **Casing / rail** — the thin outline ("stroke") along a line's body edges, MTA-style.
- **Dot vs marker** — the circular **dot** (`StopGlyph`) is the stop indicator; the **marker**
  (`StopMarker`) is the colored square sitting in the band at the same stop.
- **Line end** — how a line's paint terminates where its ink stops: the marker's outward half,
  kept (`square`), dropped (`short`) or rounded (`round`).
- **Wash / silhouette** — the soft selection-highlight fill behind a selected station.
- **Waypoint** — a routing-point station with name + bullets hidden.
- **Route bullet** — a free-floating badge showing a line's service code.
- **Service code** — the short route identifier on a line (e.g. `"A"`, `"7"`).
- **Day/night color** — a `{day, night}` pair resolved per the dark-mode theme.

