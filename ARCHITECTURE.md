# Massimo — Architecture

**Up to date as of commit `2b44c86` (2026-07-27, #357) — verified against the live source. This PR: the Edit Stops hover gained a SECOND-station cue and a route preview. Pointing at a station a click would put on the line now promotes its name to the same line-colored `starter-label` treatment the pen's own station wears — REPLACING its dimmed/white pass rather than stacking a second label on it — and paints the corridor(s) the click would draw at `ROUTE_PREVIEW_OPACITY` = 0.5, over the dim (which shows through at 1 − `dimOpacity` = 0.3) and under the fully-bright line being edited, beneath the halos/dots/names so no committed chrome is hidden by a maybe. The route is NOT an approximation: [appendRoutePreview.ts](src/geometry/appendRoutePreview.ts) runs the ACTUAL `connectStationsOnLine` / `spliceStationIntoEdge` over a `DEFAULT_DOC` scratch shell (the transforms read only `lines`/`stations`, plus `lineTags` for the splice's orphan prune, and band geometry reads nothing else — so the paint layer never has to thread the whole doc down) and rebuilds bands from the result, inheriting the stop-cell spawn (a new stop on an interchange lands OFF the anchor), `autoOrientNewStation`, the fillet radius and any interlining for free; it cannot promise a shape the click won't deliver, and the tests pin each preview band against that ground truth. A splice previews BOTH halves — the click cuts the corridor it subdivides, so previewing only the near half would promise a dogleg that keeps the original straight run. The seam pass is deliberately dropped: its clip is keyed on a REAL band (`SeamClips`), which an undrawn corridor has no entry for, and a dangling `url(#…)` risks the same "treated as no clip" ambiguity `SeamClips` already pads its EMPTY clips against — an unclipped seam would paint the preview's full length. ONE gate feeds both cues — `appendRoutePreviewEdges` (appendGestures), the edges a click ADDS — so the name and the route can never disagree; it is empty for a click that only walks the pen, INCLUDING onto an already-connected neighbour, where `connectStationsOnLine` no-ops (the hover ring still shows, since the click does advance the cursor, but no route is promised). `HighlightedLineLayer` also stopped re-deriving `ln` / `append` / `validCursor` once per block (three times over) and `lineRepaintNodes` took a `passes` argument instead of hard-coding all three. A code-health pass before it (#357): four documented claims this file had outlived, plus the `TransferEnd` narrowing seam and the anchor footprint behind them. The doc was still describing `UiMode` with a `creating-transfer(anchor)` payload and no `placing-anchor` at all, the selection as **five** id-lists when #352 made it six (`selectedAnchorIds`, plus the `selectedAnchorCellId` sub-selection), and its exhaustive 18-step paint order never mentioned `AnchorLayer` — a whole layer, mounted between the dots and the transfer outline since #352. #355 shipped without touching this file at all, so the per-station hover/selection reveal (`revealedAnchorStations`, the reason `MapCanvas` gates its anchor block on `showNetwork` and PICKS the layer's inputs rather than gating on `anchorsVisible`) was undocumented; it is written down beside the two mode reveals now. Code: `model/transferAnchors.ts` OWNS the three-arm narrowing and warns that `'stationId' in end` is the subtle test — two arms carry one — yet four sites hand-rolled exactly that check ([MapCanvas](src/components/MapCanvas.tsx), [AnchorLayer](src/components/canvas/AnchorLayer.tsx) via a private `isHosted`, [transferEnds](src/geometry/transferEnds.ts), and the module itself), each correct only because of where it sat in an if-chain; they now ask `isHostedAnchorEnd` / `isFreeAnchorEnd`, total guards pinned by a test that fails on the naive spelling. The same module's `endAnchorId`/`endLineId` are gone — exported accessors with zero callers, since every consumer narrows with a guard and reads the field directly. `ANCHOR_HALF` (a free anchor's one-cell world footprint) moved to [geometry/orientation](src/geometry/orientation.ts) beside the `STOP_SIZE` it derives from: content bounds computed it while the marquee (`transferAnchorsForRect`) carried a bare `7`, and BOTH docstrings misdescribed it — the marquee claimed to measure “their painted disc” and itemBounds called that disc “deliberately larger” when it is smaller (radius 5.25 vs 7) — so a boundary test now pins framing and grabbing to the one constant. Tests: `soleSelection`'s and `currentHitEntity`'s `anchor` arm gained the coverage its own comment said it needed — it exists for hitStack's alt-click cycle, not for a popover, so dropping it fails silently; both new tests go red when the arm is removed. Also corrected three comments #352 outran: `setUiMode` clears **five** hover channels, not four (`hoveredAnchorKey`), `ItemPopovers` groups **six** multi-select lists, and `setTransferFirstEnd` no longer claims to update “the variant's anchor”. Since #351 (`4caa741`): a transfer end can be something other than a stop dot — `TransferEnd` became a three-arm STRUCTURAL union (stop · station-hosted anchor · free anchor, no `kind` tag, so the stop arm stays byte-identical to every saved file and needs no migration), anchors got two deliberate homes (`MapDoc.transferAnchors` for free ones, `Station.transferAnchors` cells for hosted ones so `rotateStationLayoutBy90` carries them), free anchors became first-class canvas objects (multi-select, marquee, group drag/rotate, nudge, Delete — and the first selectable kind with no `locked` field), and `AnchorLayer` paints both homes as export-excluded chrome (#352); a post-merge audit of that work followed (#354); pointing at or selecting a station now reveals ITS anchors only, leaving the rest of the network clean (#355); and a burst of wheel ticks over a slider or spinbutton coalesces into ONE undo entry (`withCoalescedHistory`, a 500ms window keyed per field, discarding the entry it just added rather than pausing recording) (#356). A code-health pass in between (#353): two stale documents, and three claims inside them that the source had already contradicted. This file still described the station-layout editor's chrome as **zoom-floored** rings wearing **orientation glyphs** — #347 made every handle world-sized (geometry AND stroke weight, so the component reads no zoom at all) and replaced the typeset ↕ ⤢ ↔ ⤡ with a drawn, `ORIENTATION_ANGLE`-rotated path, because no font puts that diagonal pair at a true 45° — and it said nothing about #350's redistribute pool split, now written down beside the two snappers. [docs/loops-and-branches.md](docs/loops-and-branches.md) told the reader right-click REMOVES a segment in Edit Stops and never exits the mode, the exact reverse of #326, and still listed `redistributeBetween` + `snap.refineAlongAxis` as open display-order gaps though both walk the edge graph now (#329/#334/#346). Code: `ORIENTATION_ANGLE` moved from [inspector/stopGridDrag.ts](src/components/inspector/stopGridDrag.ts) to [geometry/orientation.ts](src/geometry/orientation.ts), beside the `travelDirLocal` it has to agree with — a canvas component was reaching into an inspector leaf for a rotation table whose key type `StopAxis` was a second spelling of `StopOrientation` — and a new test pins the two tables parallel, since a stop's STRIPE follows `travelDirLocal` while the arrow drawn on it follows `ORIENTATION_ANGLE`, nothing else compared them, and a swapped entry would point every badge across its own line. Four exported label-align cycle constants (`ALIGN_CYCLE`, `VALIGN_CYCLE`, `AUTO_HALIGN_CYCLE`, `AUTO_VALIGN_CYCLE`) are gone: each one's comment claimed to be the canonical display order for the inspector's pickers, which have listed their own options (with icons) since the `SegmentedToggle` extraction, so all four were dead constants fronted by a comment that invited an edit with no effect. And two docstrings asserting contracts the code does not hold — `orientationArrowSize` said the layout editor shares it so “entering the mode must not resize the arrows” (the editor deliberately fits the arrow to its ring instead, and says so ten lines away), and `buildOverlapRegions` described “the many geometry-only callers” it no longer has, being the full-rebuild reference the incremental builder is tested against with no production caller at all. Since #346 (`89d15c7`): the station-layout editor's handles became map-fixed and its arrows drawn rather than typeset (#347); a double-click navigates between the line editor and a station's layout (#349); the region rebuild went component-wise plus incrementally reused behind a single WASM clipper engine, ~144ms per frame down to 12–54ms (#348); snap-to-all works during a Ctrl-drag redistribute, against every station the redistribute isn't moving (#350); and the magic wand butts a label to the crossing stripe at a cross station instead of straddling it (#351). A code-health pass in between (#345): the Edit Stops hit gate stopped re-deriving the click matrix — `useStationInteraction`'s `appendForeignInert` hand-rolled `decideStationClick`'s dead-click case (non-empty line + no valid cursor + non-member) inline and now simply ASKS it (`decideStationClick(...).kind === 'none'`, still AND-ed with `hasStripeBeneath`), so the hit surface and the click can't disagree about which stations are dead, with the previously-uncovered edge-cursor arm pinned by a new test; a line's user-facing name became one shared `lineDisplayName(line)` ([lineNaming.ts](src/model/lineNaming.ts)) — the sidebar row, the layout editor's stop tooltip, and the inspector's stop badge each spelled it their own way and the badge DISAGREED (`Line <service>`, dropping a named line's name), so the same stop now reads the same on every surface; the three station-label passes ([StationLabel.tsx](src/components/StationLabel.tsx) — starter / highlight / normal) stopped re-listing the seven positioning fields and the overlay frame (hidden-waypoint skip, station-rotated `<g>`, "WP" lozenge), now sharing `labelTextPosition` + `OverlayLabelFrame`, with the cross-pass geometry agreement pinned by a test (the highlight pass paints OVER the normal one, so drift reads as a doubled label); and two comments were corrected — [HighlightedLineLayer](src/components/canvas/HighlightedLineLayer.tsx)'s hover-zone note still called the ring "dashed" (solid since #342) and sat above the wrong declaration, and [StationSilhouette](src/components/StationSilhouette.tsx)'s docstring never listed its `hover-zone` layer. Since #344 (`d7b6591`): a 20-bug fix pass from an adversarial audit; each fix ships with the failing test that found it. The load-bearing ones, all of which changed a documented invariant: `updateLine`'s inline-bullet migration now gates on `isBulletCode` (labelTokens owns that grammar) — an EMPTY old service code used to collapse its search patterns to the bare delimiter pairs and rewrite every station name and text label in the doc, and the Line inspector no longer writes an empty service through mid-edit; `SIBLING_PRIMARY_CLEAR` gained `selectedVertices` so a marquee/shift-click can't strand an invisible armed vertex that Delete and the arrows then obey; `updateLine`/`setLabelOffset` regained the same-reference-on-no-op guard; `setDotStyle` decides "equals the line default" by VALUE against the resolved default (an id compare lied once a stopDot style was deleted out from under a line); `updateStyleProps` re-asserts the line-style contract after a stopDot edit (dot diameter is style-dependent, so it can drift a tagged line off its style); `parse()` gates `bakeStopDotLibrary` on whether the FILE carried styles, not the merge-fabricated record; `refineAlongAxis` walks the edge graph via `neighborsOf` instead of `line.stations` order; `buildStopMarkers` indexes bands by pairKey into a LIST and picks the one its own line rides; `regionGeometrySig` keeps an edgeless-but-stopped line's width; `LineMetrics.alignAdvance` (advance minus the ONE trailing letter-spacing step, reported per segment so an untracked measurer isn't over-corrected) is now the alignment reference so tracked labels stay inside their own box; the font-load epoch moved to a store (`state/fontEpoch.ts`) because App-local state could never reach memo'd `StationView`; the export snapshot neutralizes layering mode; the chevron edge bleed is world units, not screen-px-over-zoom; `bakeLetterSpacing` runs AFTER glyph outlining and the splitter carries `letter-spacing`; `liveSnapStations` gates the snap ENGINE the way `liveAlignTargets` gates the pool; and a text label is minted already wearing its default style so the drop lands where the ghost promised. Since #340 (`b35d064`): each stop grab-handle in the on-canvas station layout editor gained a native `<title>` naming its line (#341); the Edit Stops hover behavior got three fixes — the station hover-zone now matches the main map (SOLID two-tone ring over a light white wash instead of a dashed outline, white because the editor's dim would swallow an accent tint), foreign stations go click-through exactly where `decideStationClick` returns 'none' so the click reaches the line beneath, and a hovered foreign line lifts above the dim through the edited line's own renderer — cased three-pass stripes PLUS its markers and dots — at `HOVER_LINE_OPACITY` = 0.5, replacing a body-only 0.55 overlay that carried no casing and dropped the dots (#342); the Edit Stops hover ring moved off the station anchor to `spawnStopCellAt` — where a click actually DROPS the new stop, which on an interchange is not the anchor (#343); and shift-click in layering mode floods the color a region already shows (#344). Previously (#339 and earlier): the drag-proxy hide/restore dance around DOM hit-tests (`element(s)FromPoint`), copy-pasted across `rerouteProxyEventBeneath` and both alt deep-picks in [MapCanvas](src/components/MapCanvas.tsx), collapsed into one `hitTestBeneathProxies(probe)` helper; the `appending-to-line` branch of `handleCanvasPlace` plus `runAppendCreate`'s seed/connect arms ([usePlacementDispatch.ts](src/components/canvas/usePlacementDispatch.ts)) — the empty-canvas alt-click half of the Edit Stops create path, whose splice half was already covered through MapCanvas — gained direct tests (create/connect, one-undo grouping, cursor back-out, mode exit, deleted-line guard); and two needless single-call wrappers in [interlining.ts](src/geometry/interlining.ts) — `bandCentroid` (an EXPORTED alias over `vec.centroid`) and `worldToStationLocal` — were inlined, dropping `bandCentroid`'s non-load-bearing alias test. Since #335 (`0b95649`): a prior code-health pass extracted the shared `clamp(v, lo, hi)` primitive into [util/grid](src/util/grid.ts) (backing the ~25 hand-rolled `Math.max(lo, Math.min(hi, …))` sites across every layer), routed `clampPolygonStrokeWidth` ([transforms.ts](src/model/transforms.ts)) through `roundClamp` (restoring its dropped float-artifact scrub), and dropped `segmentStyles` from both `buildBandGeometry`'s docstring and MapCanvas's `linesGeometrySig` hash — band geometry is presentation-BLIND, so a segment-style edit now repaints WITHOUT a needless band rebuild, pinned by a style-independence test (#336); an alt-click on the ALREADY-armed Edit Stops segment now splices a station mid-segment (a new `alt` param on `decideSegmentClick`) instead of doing nothing, routed through the same `runAppendCreate` as the empty-canvas alt-click so both mint+wire the station identically (#337); the ctrl-drag redistribute now toggles LIVE mid-drag — pressing/releasing Ctrl during a station drag engages/drops even-spacing on the next move (`useStationDrag`) rather than being latched at grab (#338); and `autoOrientNewStation` ([autoOrient.ts](src/model/autoOrient.ts)) flips 180° to the axis-equivalent rotation when the raw tangent would land the label upside-down (screen octants 3/4/5) — same stripe through the same centered stop, right-side-up text (#339). Since #333 (`55fec33`): a prior code-health pass fixed the ctrl-drag redistribute readout (`spacingDivisor`, [snap.ts](src/geometry/snap.ts)) to count segments over the edge graph via `shortestPathOnLine` (the old `line.stations` index slice miscounted on loops/branches/out-of-order lines), extracted the `roundClamp` primitive shared by the ~8 quarter-grid canonicalizers, moved `appendGestures.ts` from `components/canvas/` to `model/` (undoing the store→component inversion `state/selection.ts` had triggered), and corrected the `bindAssignments` docstring to *world* distance (#334); and line casing/seam colors can now follow the line's OWN color — `Line.strokeColor`/`seamColor` and the matching `LineStyleProps` fields accept the `'line'` sentinel (`LINE_OWN_COLOR`), resolved at render time and mirroring a dot style's `'line'` fill/stroke, so the raw accessors `lineStrokeColorOf`/`lineSeamColorOf` were renamed to `lineStrokeColorStored`/`lineSeamColorStored` (capture-by-example and the editors keep the sentinel) while new `lineCasingColor`/`lineSeamColor` resolve it to a paintable hue; no migration (#335). Since #324 (`832e2a2`): export filenames now version-stamp (`<name> - v<version>[d]`, date only as a no-library fallback) instead of date-stamping (#325); the Edit Stops (`appending-to-line`) mode got a usability overhaul — it is now manipulation-free (station drag/rotate unwired), **alt-click** creates a fresh station under the cursor, right-click anywhere **exits** the mode (removing nothing; removal is the × chip or Delete) rather than removing an edge, `appendHover` gained a `{kind:'line'}` variant that previews/switches to a foreign line's stripe, and the line-popover's style detail collapses via a new persisted `useLineEditorPrefs` store (#326); label adjacency recognizes interline-gap parks (#327); ctrl-click redistribute walks edge topology via `shortestPathOnLine` rather than membership order (#329); and hovering a station in idle mode paints its stop dots' orientation glyphs (a new `hover-arrows` paint layer above the routing-warning markers) (#330/#331). Earlier, since #321: a per-line `interlineGap` (GEOMETRY, 0.25 grid, drop-at-0) inserts spacing between interlined neighbors — `tangentGap` now takes both widths AND both gaps (`(wA+wB)/2 + max(gapA,gapB)`), threaded through the band merge gate, stripe offsets, spawn, and the width-edit repack (`repackStationForWidth` → `repackStationForSpacing`); `gap=0` is a bit-exact identity (#323). Its exposed hole/seam edges surfaced two clip-precision fixes: clip content is emitted in ×64 local coords to beat Blink's ~1-unit clip-resource raster snap (shared `clipRaster.ts`, used by both `SeamClips` and `RegionExcludeClips`), and the region-exclude outer ring is a content-sized AABB (`regionClipBounds`) rather than a ±500000 constant (#323/#324). Earlier changes since `f2b8a1a` (#304), the big one being the doc-scoped "Stop dots" style library: `stopDot` is now a 7th styleable kind whose styles live in a small per-doc library (`bakeStopDotLibrary`, persist v19), the per-line/per-stop dot TYPE became a covered `LineStyleProps` field (`singletonDotStyleId`/`multiDotStyleId`, persist v20), and `DotStyle` gained a required `strokeAlign` (center/inside/outside, persist v21) and an optional `serviceCodeColor` (absent ⇒ B/W auto-contrast). Persist `version` is now `21`. The viewport store gained two local chrome preferences — `dayCanvasColor` (white/gray/black day paper) and `darkUiInDay` (chrome-only dark UI while the map stays in day mode, driving `chromeDark`) — and `themeColors` takes `dayCanvasColor`. All dimensional inputs (dot size, transfer thickness, route-bullet size) unified onto the 0.25 quarter grid (#321). This code-health pass also extracted the shared `SegmentedToggle` (one implementation for the ~13 inline pick-one Radix `ToggleGroup` clusters) and moved `snapToStep` to a leaf `util/grid` shared by every quarter-grid canonicalizer.**

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
  grouping. ([src/model/transforms.ts](src/model/transforms.ts) is the ~2800-line heart.)
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
    transforms.ts               # ~2800 lines: all (doc,…)→doc editing ops + DEFAULT_DOC + constants
    serialize.ts                # serialize()/parse() + shared backfill/sanitize helpers
    styles.ts                   # named per-kind formatting presets (StyleDef) + styleId tag/stamp
    ids.ts                      # IdFactory: crypto UUIDs (prod) / counter ids (tests)
    pairKey.ts                  # pairKeyOf(a,b): canonical station-pair key
    recordOrder.ts              # reconcileOrder/moveInOrder: shared z-order algebra
    palettes.ts                 # built-in PALETTES + resolution; PaletteId = open string
    customPalette.ts            # parse imported palette JSON; makeCustomPaletteId
    dotStyle.ts dotSize.ts      # procedural stop-dot style + size resolution
    dashSize.ts                 # TfL-tick ('dash' stop) length/thickness resolution (derive from line width)
    transferStyle.ts            # TRANSFER_STYLE_DEFAULTS + per-transfer override resolution
    lineWidth.ts lineStroke.ts  # stripe width (GEOMETRY) + casing rails (PRESENTATION)
    stationPacking.ts           # width-edit repack: keeps tangent stop chains packed
    lineOrder.ts                # z-order reconcile (lineOrder = the default stacking)
    lineNaming.ts               # nameForIndex/pickNextLineName (next free letter name)
    lineTopology.ts             # the single owner of a Line's edge-set adjacency (degree/neighbours/incidence, add/remove edge, edgesFromStations, shortestPathOnLine)
    appendGestures.ts           # pure Edit Stops gesture decisions ((line, cursor, click/delete target) → next doc edit); no React/store, so state/ and canvas/ both consume it
    matching.ts pathSelect.ts   # interlining-group matching + shortest-path selection
    autoOrient.ts               # rotate a just-added station to the line tangent (flipping 180° when the tangent would render its label upside down — same axis, right-side-up text)
    clipboard.ts                # ClipPayload union + read/write + SVG-href security guard
    svgImport.ts                # import external .svg or png/jpeg raster → intrinsic/decoded
                                #   size + data URI (+ href security allow-list)

  geometry/                     # PURE math — world coordinates, no React/store
    vec.ts orientation.ts       # vector primitives; rotation/local↔world; STOP_SIZE=14
    router.ts                   # octolinear path solver + arc fillets + offset paths
    interlining.ts              # THE band algorithm: merge lines into parallel stripes
    appendRoutePreview.ts       # Edit Stops route preview: run the REAL connect/splice on a scratch doc, rebuild bands, keep the ADDED corridors
    snap.ts                     # the snap engine (line/equidistant/tens/all/grid modes)
    lattice.ts                  # stop-placement lattice (orthogonal/diagonal)
    stationBoundary.ts          # selection silhouette + marquee hit rects
    stationDash.ts              # TfL-tick ('dash' stop) geometry: per-stop tick anchor/angle/length (label-side aware; emergent notched composite)
    stripeOutline.ts            # per-stripe edge/cap geometry (stroke-before-fill dots)
    polygon.ts polygonSnap.ts polygonUnion.ts rectPolygon.ts  # polygon geom + union + hit test
    clip.ts                     # typed wasm-clipper wrapper (booleans/offsets, integer-snapped); async load, one engine
    lineRegions.ts              # overlap-face PHASES (zone → components → cells → faces) + anchor binding + exclusion holes
    regionIncremental.ts        # the live region builder: per-component reuse across frames
    regionCache.ts              # sig-keyed cache of bands+markers+faces (render + reconcile)
    regionReconcile.ts          # carries regionAssignments across geometry edits
    labelTokens.ts textMeasure.ts labelLayout.ts labelJustify.ts  # name → tokens → measured → placed
    lineTagGeometry.ts          # offset-path arc-length sampling for in-band tags
    svgImage.ts                 # svg-image corners/resize/rotate/snap geometry
    waypointLozenge.ts          # WP-lozenge pill geometry (shared drawn glyph + hit/selection box)
    itemBounds.ts contentBounds.ts  # per-item + whole-map world AABBs (popover spawn + camera fit)

  state/                        # Zustand stores (10 of them) + history
    store.ts                    # useDoc: temporal(persist(...)) + ~110 actions + migrateDoc
    history.ts                  # the ONLY module touching zundo internals
    selection.ts                # useSelection: UiMode union + multi-select + reconcileWithDoc
    selectionOps.ts             # bulk selection gestures (delete/lock the unlocked subset)
    mirrorDispatch.ts           # mirror-matching fan-out shared by every layout-edit surface
    viewportStore.ts            # useViewportStore (committed) + useLiveViewportStore (in-flight)
    theme.ts                    # themeColors(darkMode, dayCanvasColor) table (no store; reads doc.darkMode)
    customPalettes.ts           # useCustomPalettes: imported palettes (global localStorage)
    mapLibrary.ts               # saved maps + versions in IndexedDB (no store; opaque JSON)
    libraryPrefs.ts             # useLibraryPrefs: map-library UI prefs (list sort mode)
    libraryPointer.ts           # useLibraryPointer: which map + version the live doc came from
    saveBaseline.ts             # useSaveBaseline: baseline + tri-state clean/dirty/unsaved signal
                                #   (gates Save version + the toolbar dot; hash survives refresh)
    toastStore.ts               # useToasts: stacking status toasts (pushToast from anywhere)
    snapPrefs.ts                # useSnapPrefs: snap toggles (+ v0→v1 migration)
    labelEditorPrefs.ts         # useLabelEditorPrefs: text-label editor UI prefs (wrapText)
    stationNames.ts             # random station-name word lists

  components/                   # React + SVG rendering and UI chrome
    MapCanvas.tsx               # the canvas hub: paint order + all pointer wiring
    Station*/Stop*/Label*/...   # per-entity SVG views (see Rendering section)
    selectionStyle.ts           # shared selection stroke/dash/wash constants (screen-px; ÷ zoom)
    Toolbar.tsx Sidebar.tsx Menu.tsx  # chrome
    MapLibraryDialog.tsx        # the library manager (maps | versions; Radix Dialog)
    MapVersionPill.tsx          # the live doc's version + save-status dot, beside the map name
    *Popover.tsx                # on-canvas item editors
    DayNightColorRow.tsx        # shared label + light/dark ColorField pair (every themed-color row)
    FieldSelectContent.tsx      # shared Radix Select panel: portals popover Selects to .app (escapes
                                #   the .canvas-host isolate layer) + bounds/scrolls a long list (#304)
    canvas/                     # interaction layer: drag/placement/viewport hooks + overlay layers
    inspector/                  # LineInspector (hosted by the pinned on-canvas LinePopover; identity +
                                #   line-style fields — stop/topology editing is canvas-driven, see
                                #   appendGestures.ts) + StationInspector (hosted by the on-canvas
                                #   StationPopover) + pure math: stopGridDrag.ts, stationBandGeometry.ts

  export/                       # exportCanvas.ts (SVG/PNG), fonts.ts, exportCanvasPdf.ts
                                #   + pure PDF-gap modules pdfHatch/pdfText/pdfGlyphs/
                                #   pdfDropShadow/pdfMask/pdfAlpha + embeddedSvg (shared image-href plumbing)
  util/                         # color.ts (hex math), fonts.ts (font stack + weight math)
  test/                         # fixtures, jsdom setup, integration tests
e2e/                            # Playwright specs + seedAndOpen harness
public/fonts/                   # 16 Helvetica Neue .ttf faces + DejaVuSans.ttf (symbol fallback)
```

---

## Core mental model — the big ideas

Internalize these six and the rest of the codebase reads cleanly.

### 1. The document is everything saveable; nothing else is

`MapDoc` is the **only** thing that is undoable and persisted-per-file. Selection, camera
(viewport), grid size, snap prefs, and custom-palette **definitions** all live in
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
| Snap engage radius (`SNAP_PERP_TOLERANCE=10`; `LINE_TAG_SNAP_TOLERANCE=10` in dragged-stripe arc length — both **world units at zoom 1**) | Call sites pass `/zoom`, so the _effective_ radius is constant in screen px (the world tolerance shrinks as you zoom in) |
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
  activePalettes: PaletteId[]; // INVARIANT: never empty
  seamEdges: SeamEdges; // global branch-seam inner-edge mode: 'both' | 'straight' | 'curved'
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
covered by line styles, and edited in the line inspector / line style presets (the Options popover
holds palettes and the global branch-seam-edge control, not curve radius). Legacy saves carried the
doc field; both load paths bake it onto every line
and fill line style defs that predate the covered field (`bakeDocCurveRadius`, persist v16).
Where interlined lines disagree, the shared band curves at the LARGEST member radius.

`DEFAULT_DOC` (in [transforms.ts](src/model/transforms.ts)) is the merge baseline: empty
collections, `name: 'Untitled map'`, `lineCounter: 0`, `activePalettes:
['mta']`, `styles: DEFAULT_STYLES` — the six factory "Default" presets (one per styleable kind:
line, textLabel, polygon, routeBullet, transfer, station) **plus** the two seeded "Stop dots"
library styles (`stop-filled-black`, `stop-none`), since `stopDot` is a 7th styleable kind whose
styles live in a small doc-scoped library rather than as a single Default — and
`styleDefaults: FACTORY_STYLE_DEFAULTS` designating one per kind (`stopDot` → `stop-filled-black`). Styles are doc-scoped: applying one
stamps its props onto the item through the canonical setters and tags it (`styleId`, invariant:
tagged => the item's covered values equal the style's props); editing a covered field detaches
the item back to "Custom"; redefining a style (Styles-panel editor or "Save style..." over the
same name) re-stamps its tagged users in the same undo entry; new items are stamped with their
kind's DESIGNATED default style on creation. Defaultness is explicit and id-keyed, never
name-derived: `styleDefaults` maps each kind to one of its styles (`setDefaultStyle` re-assigns
it — the panel's star), with two structural invariants enforced on both load paths by
`ensureStyleInvariants` (serialize.ts): every kind has >= 1 style (empty kinds get their
factory Default injected; `deleteStyle` refuses last-of-kind and re-points the designation when
the default itself is deleted), and every `styleDefaults` entry resolves to a style of its
kind. See [styles.ts](src/model/styles.ts).

### Entities (field-level)

**`Station`** — `id, name, x, y` (world center), `rotation: Rotation`, `stops: StopCell[]`,
`label: LabelCell`. Optional flags, **omitted when false/default** to keep saves clean:

- `isWaypoint?` — a "routing point": hide name + all bullet glyphs + drop the label hit rect;
  the station stays selectable/draggable via its stop-cell hit rect. Per-stop styles are **not**
  mutated when this toggles.
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
  any mix of the five kinds) mounts one shared `SelectionPopover` with Lock all / Unlock all /
  Delete all (`setItemsLocked` — one undo entry; delete shares the Delete key's
  unlocked-subset semantics via `state/selectionOps.ts`), so **Alt+marquee → Unlock all** is
  the mass-unlock path (and Lock all the mass-lock).

**`StopCell`** — one line's stop on a station. `lineId, row, col` (station-local grid;
**`row`/`col` are floats now**, since diagonal moves use ±√2/2 — equality uses `CELL_EPS=1e-4`),
`orientation: StopOrientation`. Optional, **dropped when equal to the line's effective default**:
`dotStyle?: DotStyle`, `dotSize?: number` (dot **diameter** in px).

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
  never resolved defaults — that would be circular). Resolved live per stop
  (`resolveDotStyle(line, stop, isSingleton)`), so a station losing its other visible line adopts
  the singleton default with no rewrite; a per-stop `dotStyle` override always wins. Independent
  (editing one never moves the other); each missing ⇒ `DEFAULT_DOT_STYLE` (filled-black). Legacy
  saves carried one combined `defaultDotStyle` — baked into both on load (`bakeLineDotDefaults`,
  persist v18). Since the doc-scoped "Stop dots" library (persist v19) these two raw `DotStyle`
  fields are the **stamped shadow** of a library link: `singletonDotStyleId?` / `multiDotStyleId?`
  (persist v20 — also covered `LineStyleProps` fields) name the `'stopDot'` StyleDef, and the raw
  `DotStyle` here is its stamped props. The renderer reads the raw value; editing the library entry
  restamps it (same raw-value-plus-tag contract as `styleId`; an absent id ⇒ the doc's designated
  default stopDot style).
- `singletonDotSize?` / `multiDotSize?: number` — dot diameter px, split the same way; each
  missing ⇒ `DOT_SIZE_DEFAULT` (= 2×`STOP_DOT_RADIUS` = 8). Legacy `defaultDotSize` baked into both.
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
  reaches the renderer through `stopGapOf(lines)` — threaded at every `labelLayoutLocal` /
  `stationBoundaryRectsLocal` / `stationsForRect` / `stationWorldAABB` call site alongside
  `stopHalfOf`/`stopDashOf` (same must-agree contract).
- `interlineGap?: number` — **extra spacing against interlined neighbors, GEOMETRY**; world
  units, missing ⇒ 0 (classic edge-to-edge tangency); on the 0.25 grid, ≥ 0, ≤ `STOP_SIZE`,
  dropped at 0 (`canonicalStrokeWidth` idiom, `lineInterlineGapOf`). Lets a thin line carry stop dots
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
- `strokeWidth?: number` — **casing rail, PRESENTATION**; centered on the body edges (half in /
  half out), missing ⇒ 0; rounded to a 0.25 grid (`LINE_STROKE_STEP`). Resolved live; never moves paths.
- `strokeColor?: string` — casing color; missing ⇒ `'#ffffff'`; lowercased. May instead be the
  sentinel `'line'` (`LINE_OWN_COLOR`) — "the line's OWN color", resolved at render time, mirroring
  a dot style's `'line'` fill/stroke. `lineStrokeColorStored` reads the raw value (capture-by-example
  and the editors' mode pickers); `lineCasingColor(line, lineColor)` resolves it for paint, taking
  the EFFECTIVE color so a line-colored casing desaturates with the body.
- `seamColor?: string` — **interior seam** for a branch/loop: where a line's OWN bands overlap (a
  self-junction) the casing normally merges away; set this to paint a subtle stroke there so the
  overlap still reads as two tracks. Lowercase hex, may carry alpha (`#rrggbbaa`), or `'line'` (see
  `strokeColor`; raw = `lineSeamColorStored`, resolved = `lineSeamColor`). Missing ⇒ no
  seam; dropped when unset or fully transparent (the "off" state). PRESENTATION, like the casing.
- `seamWidth?: number` — seam width per side, world units. Stored like `strokeWidth` (drop at 0),
  but an **unset** value inherits the casing width at render time (`seamRenderWidth`) so a
  seam-color-only line still shows a seam. Only takes effect alongside a non-transparent `seamColor`.
- `dashLength?` / `dashWidth?: number` — **TfL-tick dimensions for this line's `dash` stops**,
  world units. PRESENTATION (never moves band geometry, resolved at render). Both **unset** ⇒
  derive from the stripe width (`dashLength = width`, `dashWidth = width/2` — the TfL proportions;
  see [dashSize.ts](src/model/dashSize.ts), `dashRenderLength`/`dashRenderWidth`). Stored on the
  casing width's quarter-unit grid with drop-at-0 (0 = "auto" ⇒ field dropped, derivation takes
  over). `dashLength` is how far the tick protrudes from the stripe edge toward the label;
  `dashWidth` is its thickness along the travel axis. Covered by line styles.
- `styleId?` — live link to a StyleDef of kind `'line'` (covers the style fields above, not
  identity/topology).

**Region layering ("paint by numbers").** There is no per-segment z-order. Where line bodies
overlap, the planar arrangement's faces are derived live (`regionIncremental.buildRegionsIncremental`,
clipper-backed via `clip.ts`, cached in `regionCache.ts`); each face shows one covering line —
by default the `lineOrder` front-most, overridable per face via `MapDoc.regionAssignments`
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
flood costs exactly one undo. An assignment is anchored IN THE LINES' OWN FRAME (`RegionAnchor`: arc position +
side offset per covering line) and is carried across every geometry edit by
`regionReconcile.ts` — rebinding by nearest-compatible face (survives drags/teleports),
duplicating onto split halves, resolving merges by largest old face, going dormant when its
overlap temporarily vanishes. The reconcile runs inside `beginHistoryGroup.commit()` (drags,
sliders, nudge groups) or inline via `withRegionReconcile` (ungrouped one-shots), always in
the SAME undo entry as the edit. Rendering is SUBTRACTIVE (`buildExclusionHoles` +
`RegionExcludeClips`): losers are clipped out over the faces they lose — the winner is NEVER
repainted (repainting doubles antialiased edges; clip-abutting seams are impossible when the
winner is one continuous base stroke). Cased lines: the hole runs through the winner's white
ring (its rails are already painted beneath — uncovering them gives the natural bridges-over
look) and swallows the losers' fringes near the face. Clipped areas take no pointer events,
so idle clicks land on the visible winner natively. Zero assignments ⇒ zero cost and
byte-identical output.

**How the faces are actually built.** `lineRegions.ts` holds the pipeline as separable phases —
`buildLineBodies` → `buildOverlapZone` (pairwise body intersections; any ≥2-cover point is in one
of them) → `significantComponents` (the zone's connected components, dropping sub-`SLIVER_MIN_AREA`
ones, which are ~98% of them by count and can reach neither output) → per component
`restrictBodiesToZone` → `subdivideCells` → `extractFaces` → one `finalizeFaces` over the merged
set. A cell can never span two components, so per-component subdivision is equivalent to one
global pass while keeping every clipper operand down to one crossing's worth of geometry.
`buildOverlapRegions` composes exactly those phases and is the full-rebuild reference the
incremental builder is tested against — **production goes through
`regionIncremental.buildRegionsIncremental`**, which caches per component across frames and is
seeded from a module-level slot in `regionCache.ts`. A component is reused only when its own ring
hash matches AND nothing that moved this frame lies near it; the second condition is load-bearing,
because a component's faces depend on the bodies restricted to it and not just on its outline.
Two subtleties worth knowing before touching it: face **spans** are arc lengths measured from each
stripe's start, so they go stale on a face whose polygon never moved (each cached component carries
a `spanHash` of its cover and re-measures when that changes — writing the result *back* into the
cache, not just into the copy handed out); and the per-stripe unit hash includes the **line id**,
because `bandKey` is built from sorted ids and two lines swapping stripe slots is otherwise
invisible while inverting the cover of every face the band crosses.

> **Width is GEOMETRY, stroke/seam are PRESENTATION.** A `width` edit rebuilds band geometry; a
> `strokeWidth`/`strokeColor`/`seamColor`/`seamWidth`/color/style edit is resolved at render time
> and never rebuilds. This split is exploited by the band-geometry memo (see Interaction layer).

**`DotStyle`** ([dotStyle.ts](src/model/dotStyle.ts)) — a procedural stop dot. Its **required**
fields (a deliberate divergence from the optional-field convention) let plain deep equality
`dotStylesEqual` work everywhere: `shape: DotBaseShape` (`circle|square|diamond|x|dash`), `fill:
DotFill` (`DayNightColor | 'line' | 'none'`), `strokeWidth` (0 = no stroke), `strokeColor:
DotStrokeColor` (`DayNightColor | 'line'`; **no `'none'`** — strokeWidth 0 expresses "no
stroke"), `strokeAlign: DotStrokeAlign` (`center|inside|outside` — where the stroke sits relative
to the dot's edge; persist v21 backfills the historical `'center'`), and `showServiceCode`. The
one **optional** field is `serviceCodeColor?: DotServiceCodeColor` (`DayNightColor | 'line'`, only
meaningful when `showServiceCode`): **absent ⇒ B/W auto-contrast** (pick whichever of black/white
is legible on the resolved fill), `'line'` paints the code in the owning line's color, a pair
gives an explicit per-theme color — kept optional so every preset stays byte-identical.
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
`TEXT_LABEL_FONT_SIZE_MIN`, snapped to a 0.5 step — the slider caps at 96, but the
spinbutton/stored value is unbounded above and may be a half-integer),
`weight: TextLabelWeight`, `italic`, `align: TextLabelAlign` (`left|center|right|justify`;
`justify` flushes both edges), `width?` (column width in world units; `0`/absent = Auto —
sizes to content and honors manual `\n`; `>0` = a fixed-width column that word-wraps, with
`\n` a hard break; clamped to a non-negative integer by `updateTextLabel`), `color/
darkColor` (day/night; **defaults DIFFER**: `#111111` / `#ffffff` for legibility — unlike a
polygon whose dark default equals its light; backfilled on load), `locked?`, plus optional
per-label `leading` (line-spacing multiplier) / `tracking` (em letter-spacing) — station labels
carry their own per-station `leading`/`tracking` (see `Station`), no longer any doc-global.

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

Anchors are **editor chrome, never map ink**: `AnchorLayer` mounts inside a `data-export-exclude`
subtree, so an anchor is absent from every SVG/PNG/PDF export while the transfer bound to it still
prints. The toolbar's anchor button (`useViewportStore.showAnchors`) shows them; it **defaults OFF**
(like `showWaypoints`, and persisted) so a finished map isn't cluttered, gated together with
`showNetwork` since anchors are part of the transfer network. The two gestures that are ABOUT anchors
— picking a transfer end (`creating-transfer`) and placing one (`placing-anchor`) — **reveal** them
regardless of the toggle by DERIVATION (`anchorsRevealedByMode`), never by writing the flag: a
temporary write would need a matching revert on every exit path, and a missed one would strand the
user's own preference. The two doc-geometric consumers opt in by hand through `anchorsVisibleNow`
exactly as they do for `showNetwork` (`anchorsForRectVisible`, `liveSnapAnchors`).

There is a **third, narrower reveal** (`revealedAnchorStations`, [anchorVisibility.ts](src/state/anchorVisibility.ts)):
pointing at a station — or selecting it — shows **that station's own** hosted anchors with the
toggle off, so you can see what a station carries without flipping the global switch and back.
Scoped to those stations on purpose; the rest of the network stays clean, and FREE anchors are
never revealed this way (they belong to no station, so pointing at one doesn't ask for them). The
hover half rides on `hoveredChrome`, so it appears and disappears with every other piece of
mouseover chrome and stays quiet mid-pan. **Idle-only**, for the reason the mode list above gives
from the other side: `creating-transfer` and `placing-anchor` already reveal EVERY anchor, and the
layout editor draws its own grab rings on the edited station. This is why `MapCanvas` gates the
anchor block on `showNetwork` and then PICKS the layer's inputs (whole network vs revealed
stations only) rather than gating on `anchorsVisible` — `AnchorLayer` itself is unchanged by the
feature, since it already renders nothing when both collections are empty, and a hosted anchor is
already `pointer-events: none` outside transfer-picking, so a revealed one can't steal the click
meant for the station under it.

FREE anchors are first-class canvas objects — multi-select, marquee, group drag, group rotate
(orbit-only: the polygon case reduced to a point, no orientation to step), arrow-nudge, Delete —
and are the **first selectable kind with no `locked` field** (`isItemLocked` returns false;
`SelectionPopover` gates Lock-all on a `lockableTotal` that subtracts them, while Delete-all still
counts them). They have **no popover**, but they ARE in `soleSelection` — that selector is also
`hitStack.currentHitEntity`'s source for alt-click cycling, so omitting them would stop the
deep-pick cycling rather than merely suppressing a panel. They are deliberately **not copyable**
(`ClipPayload` has no transfer kind, so a pasted anchor could never carry the transfer that gives
it meaning). HOSTED anchors are station internals like a stop dot: rendered `pointerEvents="none"`
(so alt-click reaches through them), edited only in the layout editor.

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
lookup) · `{anchorId}` (a free anchor). Narrow via `model/transferAnchors.ts`, testing
`'anchorId' in end` FIRST — two of the three arms carry a `stationId`. That shared shape is what
keeps the station cascade a one-liner: `endStationId(e) === id` orphans a station's stops AND its
hosted anchors together. World resolution for all three is `geometry/transferEnds.transferEndWorld`,
which returns null for a dangling end — both paint passes, the popover spawn and the in-progress
preview all go through it, and dropping the transfer on null is why neither load path needs a
transfer-endpoint sanitizer. **Cascade-deleted** when either endpoint's stop is removed (by
deleting the station/line or removing that line's stop). Default styling (thickness, color,
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
(`100|200|300|400|500|700|800|900` — **no 600**, no SemiBold face shipped), `DotShape` (13 legacy
preset ids — **no longer stored**, only the currency of shape pickers and legacy conversion).

---

## Serialization, persistence & migration

Files: [serialize.ts](src/model/serialize.ts), [store.ts](src/state/store.ts) (`migrateDoc`).

### The governing strategy: defaulting-by-merge, NOT normalization

There is **no `normalizeDoc()`**. Absent fields fill from `DEFAULT_DOC`. The small number of
value-level fixups are **shared exported functions** — `sanitizeStations`, `backfillLineNames`,
`backfillPolygonDarkColors`, `backfillTextLabelColors`, `convertLegacyDotShapes`,
`sanitizeStopDotSizes` — each returning `{...cleaned, changed}`, where the
**`changed` flag is the signal** callers use (`migrateDoc` re-spreads a field only when `changed` is
true). (`validActivePalettes` is the exception — it returns a bare `PaletteId[]` that both callers
assign unconditionally.) The dict-level backfills allocate a fresh container even on a no-op, so don't rely on their
reference identity (the per-line / per-dot sanitizers _do_ return the same element ref when
unchanged — distinct from the transform "same-reference-on-no-op" invariant). They are called by
**both** load paths.

### Two load paths (keep them in sync)

**Path A — file import: `parse(json, custom)`** ([serialize.ts](src/model/serialize.ts)). Used
by the **Load…** menu. Pure, returns `{ok, doc}` or `{ok:false, error}`:

1. `JSON.parse`; reject non-object / `format !== 'massimo-map'` / missing `doc`.
2. `migrateLegacyLabelBold` **before** the merge (so `labelBold` never leaks into the typed shape).
3. `merged = { ...DEFAULT_DOC, ...doc }` — the entire defaulting mechanism.
4. `validActivePalettes` (enforce ≥1 valid palette), then `bakeDocCurveRadius` (retired doc-level
   `curveRadius` → per-line `Line.curveRadius` + fill line style defs; idempotent, keyed off field
   presence) — **before** the per-line clean and style validation below, which expect the
   per-line/per-def form.
5. Per-line clean (clamp width/dotSize/stroke, drop never-stored defaults, drop segment keys that
   aren't real adjacencies) + `backfillLineEdges` (derive `edges` from the legacy `stations` order
   for pre-topology saves — unconditional, since a missing `edges` white-screens the renderer) +
   `backfillLineNames`.
6. `sanitizeStations` (legacy orientations + `valign:'auto'`→`'auto-down'`), then
   `sanitizeRegionAssignments` (region-assignment hygiene — validates against the **cleaned**
   lines: dangling line ids drop the assignment, dangling pairKey anchors survive for reconcile).
7. `convertLegacyDotShapes` (preset ids → `DotStyle`) — **runs after** the line/station passes.
   Then `bakeLineDotDefaults` (retired single `defaultDotStyle`/`defaultDotSize` → the split
   `singletonDotStyle`/`multiDotStyle` + sizes, on lines AND line style defs) — **after**
   `convertLegacyDotShapes` (which materializes `defaultDotStyle` from any legacy `defaultDotShape`)
   and **before** the singleton-aware `sanitizeStopDotSizes` + style validation below.
8. `sanitizeStopDotSizes` — **must run after** the per-line pass AND the dot-defaults bake (a stop
   compares against the _sanitized_ line default for its own singleton/shared case). Then
   `bakeStopDotLibrary` (seed the "Stop dots" library + tag every dot slot by value-match; no-op on
   a doc that already has `stopDot` styles) — **before** `sanitizeStyles`, so the seeded defs are
   sanitized and the invariant pass sees the non-empty `stopDot` kind.
9. `backfillPolygonDarkColors`, then `foldPolygonFillOpacity` (legacy polygon `fillOpacity` → the
   alpha of `fill`/`darkFill`; **after** the dark-color backfill so `darkFill` exists to fold),
   then `backfillTextLabelColors`.
10. `sanitizeStyles` (validate/clamp style defs, per-kind name dedupe, id ← record key; its
    per-dot `sanitizeDotStyle` also defaults an absent `strokeAlign` to `'center'`) then
    `ensureStyleInvariants` (≥ 1 style per kind — factory Defaults injected into empty kinds —
    and a `styleDefaults` entry resolving per kind). **Before** the transfer bake, which seeds
    the _designated_ default transfer style.
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
The zustand `persist` config: `name: 'vignelli-map-doc-v1'`, `version: 21`, `migrate:
migrateDoc`, `partialize: pickDocSnapshot`. Because the persist-merge already fills absent fields
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
| (not gated) | `backfillLinesEdges` whenever `lines !== undefined` — every rehydrate, **not** `v<14`-gated: an intermediate build bumped the persist version to 14 and re-saved lines BEFORE they carried `edges`, so a `v<14` gate could never recover those (`ln.edges.join(...)` white-screens on load). Reference-stable when every line already has an array |
| (not gated) | `ensureStyleInvariants` whenever `styles !== undefined` — ordered between the `v<10` hygiene and the bake (the bake seeds the _designated_ default transfer style; adoption stamps designated defaults) |
| (not gated) | `validActivePalettes` whenever `activePalettes !== undefined`                                                                              |

A **corrupt/missing version is treated as v0** (all migrations run). The three non-gated
repairs (`backfillLinesEdges`, `ensureStyleInvariants`, `validActivePalettes`) are **not** tied to
a schema bump — they run any time their field is present (an absent field is left for the
persist-merge). `validActivePalettes` reads `useCustomPalettes.getState().palettes` to validate
custom ids.

> **Do not "simplify" the two paths into one.** `storeMigrate.test.ts` pins reference-equality
> pass-through for already-canonical docs (`expect(out).toBe(input)`); adding a file-only width
> sanitizer to `migrateDoc` would break that. They share helper _functions_, not call sequences.

### Save / startup

- **Export → JSON** = `serialize(pickDocSnapshot(state))` → `${basename}.massimo.json`. A
  download is an export; **Save version** writes to the library instead. `serialize` does **no**
  sanitization (writers are canonical by construction; transforms maintain canonical form on every
  set).
- **Startup**: no explicit load in `App.tsx` — zustand `persist` rehydrates from localStorage on
  boot, running `migrateDoc`.
- **Load → JSON…**: `parse(text, customPalettes)` then `adoptParsedDoc()` (below).
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
  row honest and is what `isPrunable` reads. `listVersions` sorts **starred first, then newest-first
  within each group** (`id` breaking a same-millisecond tie, so the order is total). That order is
  the list's own structure, not a view preference: the dialog draws its `.after-starred` divider at
  the boundary it creates. A **map's** star is a pin only (maps are never pruned).
- **Map ordering** is split the same way: the pure `sortMaps(rows, sort)` owns what each mode means
  (`'updated' | 'created' | 'name'`, starred block always first, ties → newest-edited), while the
  chosen mode is a view preference in `useLibraryPrefs`
  ([libraryPrefs.ts](src/state/libraryPrefs.ts), persisted localStorage — the labelEditorPrefs
  pattern). `listMaps` itself keeps returning newest-touched first; the dialog applies `sortMaps`.
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
  history (Ctrl+Z is the backstop), and `clearAll` preserves name/styles/styleDefaults/
  activePalettes/seamEdges.
- Known gap: work that lives only in the undo stack (Clear → New) is lost — the gate sees an empty
  doc and `clearHistory()` then discards the stack. Pre-existing in kind.

### IDs

[ids.ts](src/model/ids.ts): production uses `defaultIdFactory()` → **crypto UUIDs**
(`crypto.randomUUID()`, 36-char). Tests use `counterIdFactory(seed)` → deterministic `s0, l0,
…`. (The old `Math.random().slice() + Date.now()` scheme was reworked: it could emit short random
parts and shared one millisecond suffix across kinds.)

---

## State management

Ten Zustand stores, split deliberately by lifecycle (`useDoc`, `useSelection`, `useViewportStore`,
`useLiveViewportStore`, `useSnapPrefs`, `useCustomPalettes`, `useLabelEditorPrefs`,
`useLibraryPointer`, `useSaveBaseline`, `useToasts`). Files in [src/state/](src/state/).
(`mapLibrary.ts` sits alongside them but is IndexedDB, not a store — it owns no React state; see
the map-library section below.)

### `useDoc` — the document store ([store.ts](src/state/store.ts))

`create<DocState>()(temporal(persist((set, get) => ({...DEFAULT_DOC, ...actions}), persistCfg),
temporalCfg))`. **`temporal` is the outer wrapper, `persist` the inner**; both use the same
`partialize: pickDocSnapshot` over `DOC_FIELDS`. The ~110 actions are thin wrappers delegating to
pure transforms (`import * as T from '../model/transforms'`): `moveStation: (id,x,y) => set((s)
=> T.moveStation(s, id, x, y))`. Adders mint an id from the module-level `ids` factory, call the
transform, and return the id.

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
**`undo`/`redo` also flush persist** with an empty-partial `useDoc.setState({})` right after the
zundo call. zundo applies undo/redo through the raw `set` it captured — which sits **above**
`persist` in the `temporal(persist(...))` chain — so the reverted doc never reaches persist's
storage writer on its own, and `localStorage` would lag the canvas until the next ordinary edit
(edit → undo → refresh would resurrect the edit). The empty-partial write changes nothing, so
temporal's `equality` (`docSnapshotsEqual`) skips both the history entry and the redo-stack wipe.

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
rather than `anchor` since #352, because an end can now itself BE a transfer anchor and
`anchor.anchorId` read like a riddle. `placing-anchor` is sticky click-to-place, like
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
modes where right-click does **not** cancel). The cancel gesture is also scoped to the canvas: a
right-click landing inside `.sidebar` is exempt (`cancelModeOnContextMenu` in App.tsx), so sidebar
controls keep their own right-click semantics mid-mode. During Edit Stops, right-click anywhere on
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

**Selection** — **six parallel id-list fields** (multi-select; order meaningful; **last entry =
anchor**, in the "anchor of a multi-select" sense — not a transfer anchor):
`selectedStationIds` + `selectedRouteBulletIds`/`selectedLabelIds`/`selectedPolygonIds`/
`selectedSvgImageIds`/`selectedAnchorIds` (the last being FREE transfer anchors; hosted ones are
station internals and never appear here). The five generic lists' `select/toggle/set/add/xor`
actions are generated by one `makeIdListActions` factory (hand-copying them is exactly how a
cross-clear matrix drifted and caused a stale-line-highlight bug). Single primaries:
`selectedLineId`, `selectedLineTagId`, `selectedTransferId`, `selectedStopLineId`, plus
`selectedVertices` (a single polygon's id + a set of vertex indices — shift-click toggles more
in/out; independent of the polygon selection so the polygon stays selected while its vertex
handles are active) and `selectedAnchorCellId` (the station-HOSTED anchor armed inside the layout
editor — the third arm of the mutually-exclusive `selectedStopLineId`/`labelSelected` group, and
a different thing entirely from `selectedAnchorIds`). Selectors:
`soleSelection(s)` (non-null only when total across all six lists === 1 — every list needs an
explicit arm; the tail is a bare `return null`, since the old unguarded svgImage fallthrough
would have answered `{svgImage, id: undefined}` for a new list) and
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
BOTH halves, and the seam pass is skipped (its clip is keyed on a real band — see `SeamClips`).
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
  (`GRID_SIZES = [5,10,20]`, default 10), `showWaypoints` (default
  false — a pure paint toggle that reveals waypoint stations), `showNetwork` (default true — see
  below), plus two **local chrome** preferences: `dayCanvasColor: DayCanvasColor`
  (`'white'|'gray'|'black'`, default white — the day-mode paper color, dimming glare without
  touching the map) and `darkUiInDay: boolean` (default false — a chrome-only dark UI while the
  **map** is still in day mode). The map's own day/night is **not** here — that is `MapDoc.darkMode`
  (a stale `darkMode` key in an existing persisted blob is ignored); `darkUiInDay` is orthogonal
  to it, so `App` drives `data-theme` off `chromeDark = darkMode || darkUiInDay`. **Persisted** as
  `'massimo-viewport'` (per-browser, **not** per-file) — except
  `showNetwork`, which `partialize` deliberately omits so a reload never opens onto an
  apparently-empty map. The giant SVG tree subscribes here and is re-rendered only on commit.
- `useLiveViewportStore` — the **in-flight** gesture viewport (`pending: Viewport | null`).
  **Not persisted, not undoable.** Only the small popover-overlay layer subscribes. Exists solely
  so per-frame pan/zoom writes don't hammer localStorage or re-render the SVG. See the
  [Interaction layer](#canvas-interaction-layer) for how the viewBox is written imperatively.

**`showNetwork` — the lines/stations toggle** (toolbar eye button, right of `WP`). Off leaves only
the background art (polygons, svg images) and the grid on the canvas, so art buried under the
network can be clicked and dragged. Hidden content is **not rendered** rather than made invisible —
an invisible-but-present hit rect would still swallow the clicks the toggle exists to let through.
Three seams cover it, and a fourth rule governs anything new:

- **Stations** self-gate inside [StationView.tsx](src/components/StationView.tsx). That dispatcher
  is the chokepoint every station pass (wash, hit area, dots, labels, stroke, drag proxy) funnels
  through, in `MapCanvas` and the highlight/placing overlays alike — so one `return null` covers
  ~15 call sites and no future pass can miss it.
- **Lines** are already consolidated into `MapCanvas`'s single `renderables.map` block (stripes,
  casings, seams, stop markers), so they gate at that one call site. Line tags, transfers, band
  warnings, the warning toasts, the layout editor, and `HighlightedLineLayer` gate beside it —
  that last one matters most, because it paints a **full-viewport dim** that would otherwise black
  out the background art with the network gone. `needRegions` folds in `showNetwork` too, which
  also skips the app's most expensive computation while hidden.
- **Doc-geometric code must opt in by hand.** Not rendering kills DOM hit-testing, but anything
  reading geometry straight off the doc never notices: `useRectSelect` would sweep hidden stations
  into a marquee (an invisible selection that answers Delete), and the snap pool would align art
  to stations that aren't on screen. Both go through explicit gates —
  `stationsForRectVisible` and `liveAlignTargets` (which wraps the still-pure `alignTargets`).
  **Any new feature that reads `doc.stations`/`doc.lines` for interaction needs the same gate.**

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
- [customPalettes.ts](src/state/customPalettes.ts) — `useCustomPalettes`: imported palette
  **definitions** in **global** localStorage (`'massimo-custom-palettes-v1'`), available to every
  map. `addPalette` upserts by exact name (reusing id + position so active state survives reload).
  The split: **definitions are global; the active set (`activePalettes`) is per-map in the doc.**
  Resolution helpers take the custom palettes as an **explicit param** (the pure model never
  reaches into a store); `deleteCustomPalette` is the cross-store coordinator.
- [snapPrefs.ts](src/state/snapPrefs.ts) — `useSnapPrefs`: snap-mode toggles, with a v0→v1
  boolean→enum migration. Number keys **1–5** (and Numpad1–5, via `e.code` so they fire with
  NumLock off) each advance one toggle a single step, in toolbar order — the keyboard twin of a
  click on that button. Both paths route through the pure `advanceSnapToggle(modes, index)`
  ([SnapToggleBar.tsx](src/components/SnapToggleBar.tsx)) so a keypress is exactly one click
  (multi-state toggles cycle over repeated presses; a disabled toggle is a no-op).

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
   both ends (perp step ≈ `tangentGap(prevW, w, prevGap, gap)` within `BAND_MERGE_TOL` = 0.5 —
   the gap widens the tangent step by `max(prevGap, gap)`) and their parallel positions
   match. Otherwise flush and start a new band. (Mixed-width pairs at the legacy unit gap stay
   separate — they'd overlap.)
6. **`buildBandSpec`**: centerline endpoints = centroid of the group's stop positions;
   `stripeOffsets = stripeOffsetsForWidths(widths, gaps)` (mean-centered tangency positions —
   bit-exactly `(k−(n−1)/2)·STOP_SIZE` for uniform width 14); **radius bump** (`idealR = R +
maxAbsOffset` so the innermost stripe still curves at ≥ R); **marker-fit cap** (cap R so the
   post-fillet straight run ≥ the widest marker half-width — single-stripe bands may cap _below_
   R, multi-stripe bands floor _at_ R); then `offsetFilletPath` per stripe.
7. `assignLinePriorities` fills per-stripe z-priority from `lineOrder` **only** (per-segment layer
   overrides are gone — region assignments override the covering line per-face at render time
   instead, see Region layering); `buildOrderedRenderables` flattens to per-stripe + marker
   renderables sorted back-to-front, so a perpendicular middle-layer line can interleave _between_
   another band's stripes.

A `SegmentBandSpec` carries **parallel arrays** (`lines`, `paths`, `stripeOffsets`,
`stripeWidths`, `linePriorities` — index k = same stripe). `stripeOffsets`/`stripeWidths`/`radius`
are the **single source of truth**: every consumer (band paint, stripe outline, label/tag
placement, hit sampling) **must read them, never re-derive**, and must use **`band.radius`** (the
bumped/capped effective radius), **not** any line's raw `curveRadius` (the configured R is the
LARGEST member line's radius). `bandKey` (= `pairKey#sortedLineIds`)
is unique and stable regardless of input order — used for React keys and as the "which band"
identity. The band specs are pinned by a **byte-exact golden snapshot**
(`interlining.golden.test.ts`) guarding the zero-visual-change-for-legacy-docs invariant; never
update it without understanding why every painted path on every map would move.

**Casing & seam passes.** [SegmentBand.tsx](src/components/SegmentBand.tsx) emits **three
renderables per stripe**, interleaved by z-priority: a `'silhouette'` pass (the fat under-stroke
just behind the body, `priority + CASING_EPS`), the `'body'` pass (the inset colored stripe), and
a `'seam'` pass (the branch/loop overlap indicator just in front, `priority − SEAM_EPS`). The
casing widths come from [lineStroke.ts](src/model/lineStroke.ts) (`casingSilhouetteWidth` /
`casingInsetBodyWidth` for opaque styles so a line's own overlapping bands merge into ONE outer
casing; `CasingRails` centered rails for the two transparent "open" styles). The seam is two
edge-centered strokes CLIPPED to the line's OTHER band corridors (`SeamClips.tsx`), so it only
shows where a line crosses itself. The global `MapDoc.seamEdges` mode filters which seam edges
draw — `'both'` (default), `'straight'` only (`'line'` edges), or `'curved'` only (`'arc'` edges);
`SegmentBand` keeps just the matching edge kind. All three passes read the same `lineStroke`
helpers as the highlight overlay so they can't drift.

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
  either side) keeping those whose perpendicular distance is within tolerance → **consolidate
  interlined candidates by MEDIAN** offset (not mean — keeps the guide on a real stripe) → pick
  a primary + a non-parallel secondary axis → solve (2×2 intersection or projection) → apply
  grid as a **hard constraint** (when on, the result is always on-grid; an alignment fires only
  if reconcilable, else falls back to plain grid with no guide) → optional along-axis refinement
  (equidistant / tens; `excludedIds` also guards the cadence anchors) → build guides.
- The **point snapper** `snapPolygonPoint` (`polygonSnap.ts`, decomposed — no 2×2 solver) snaps
  one reference point against a target pool: polygon whole-drags + vertex drags, svg-image
  moves + axis-aligned resizes, text-label drags, unbound route bullets, and **all placement**.
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

Shared conventions, all paths: alignment tolerances are `/zoom` (constant screen px); grid is a
hard world constraint; **Shift bypasses all snapping** during any pointer gesture (svg rotation
included — it snaps 22.5° by default, Shift frees); every alignment snap draws a
distance-labeled guide through `SnapGuides`; grid snapping is silent.

The **target pool** (`alignTargets(doc, exclude)` in
[snapTargets.ts](src/components/canvas/snapTargets.ts)) is what "Snap to all" means for point-
snapper consumers: every station stop-center (anchor when stopless), every polygon vertex,
every svg image's rotated corners, three points per text label (visible-bbox UL corner, center,
LR corner — no hit pad), and every route bullet center. Per-kind exclusion sets remove the
dragged item and, in a group drag, its co-selected siblings — stationary items always remain
valid targets. Pools are snapshotted at pointer-down. One deliberate asymmetry: **stations are
skeleton** — they snap only among themselves, never to decoration; and a bound bullet's
all-mode pool is station stops (engine-internal), not the decoration pool.

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
- **`capCenterDy(fontSize)`** places every **badge glyph** — a service code in a stop dot or route
  bullet, an inline bullet, the WP lozenge, a line tag, the snap readout, the layout editor's `L`
  handle — at `y = centre + capCenterDy(fontSize)` on the **alphabetic** baseline. **Never
  `dominant-baseline="central"`**: that centers the font's ascent..descent box, and Chrome resolves
  those from a **different metric table per platform** — usWinAscent/Descent on Windows, `hhea` via
  CoreText on macOS. The shipped Helvetica Neue leaves `USE_TYPO_METRICS` clear and its two sets
  disagree (904/−214 vs 714/−198), so `central` lands 0.345em above the baseline on Windows but
  0.258em on macOS — identical markup rendered ~0.09em lower on a Mac (over half a world unit on a
  default 12-unit code disc, and it grows with zoom). It centers the **cap box**, so it is valid
  only for text with no descenders and no fallback-font glyphs: `SegmentBand`'s routing-warning ⚠ (a
  DejaVu dingbat, not caps) is deliberately left on `central`. **`labelLayout` is the open
  exception** — it still emits `central`/`text-before-edge`/`text-after-edge` while deriving its
  hit-rect, wash, and autoAlign pin from fixed `BASELINE_FRACTION`/`CAP_FRACTION`, so on macOS a
  painted station name can drift from the geometry that selects it.
- **`labelLayoutLocal`** is the single source of truth for a station name's `<text>`
  anchor/baseline/hit-rect, all in **unrotated station-local** coords (the `label.rotation` is
  applied around the anchor at render). `'auto'` align snaps the text against an adjacent stop;
  `valign` drives the multi-line block math. **The renderer and the hit/silhouette geometry must
  pass the same `stopHalf` width lookup** or the wash drifts off the painted text.
  `label.autoAlign` overrides both: the octant of the label cell relative to the **nearest**
  adjacent stop (in the reading frame) picks the alignment per the transitmap.net tutorials —
  baseline sits `LABEL_GAP` above the marker, cap line hangs below it, the first line's Core
  Type Area (`CAP_FRACTION` in `textMeasure.ts`) centers beside it, corner octants pin the
  facing CTA corner — and maps onto the existing valign machinery, so the renderer is
  untouched. Multi-line blocks anchor by the **line nearest the marker** and stack away from
  it: bottom line above (`auto-up`), top line below (`auto-down`), first line beside/fallback
  (`auto-down` align-down, so added lines never move the line that sits level with the dot).
  `label.autoVAlign` overrides WHICH line anchors ('down' = top line, 'up' = bottom line; the
  octant still supplies the pinned typographic edge), and `label.autoHAlign` re-aligns the
  lines WITHIN the block — anchorX slides by the anchor line's pen advance so its pinned edge
  stays put, which makes both overrides no-ops for single-line labels.
  The pin clears the marker's support-function extent along the approach (a `half`-extent
  square rotated to the stop's travel axis), stop-relative on both axes.
  **Cross stations** are the one exception to "the octant decides everything": when the label
  parks squarely across the line from its stop (the centering octants) and a **crossing** line's
  stop is packed beside it — same reading-frame row within `BAND_MERGE_TOL`, different travel
  axis, on one side only (`crossingStop`) — the READING axis re-anchors against that crossing
  stop, so the text butts up to its stripe (`end`/`start`) instead of straddling it. Each axis
  stays measured against the stop that actually blocks it: the perpendicular pin still comes
  from the label's own stop, so the baseline holds its `LABEL_GAP` off the line it labels (a row
  of labels stays level) no matter how wide the crossing line gets. Parallel neighbours are not
  crossings, and a label boxed in on both sides keeps centering.

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
  and the `*ForRect` marquee functions (all skip `locked` items unless `includeLocked` is set —
  the Alt-marquee recovery path for click-through locked items).
- `stripeOutline.ts` — per-stripe edge/cap geometry for the stroke-before-fill dots; reads the
  **baked** `stripeWidths`/`stripeOffsets`.
- `lineTagGeometry.ts` — arc-length sampling along an offset path; `snapNeighborTag` snaps a
  dragged tag to a same-corridor neighbor (matched by unordered `pairKeyOf`).
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
3. Interleaved band stripes + `StopMarker` squares (ordered by per-stripe z-priority via
   `buildOrderedRenderables`).
3b. Region overrides render SUBTRACTIVELY inside pass 3: a line that loses an
    overridden overlap face paints through an exclusion clipPath (RegionExcludeClips,
    holes over the faces it loses — see buildExclusionHoles), so the winner shows
    through as its own continuous base stroke. Real map paint (exported).
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
    `useAnchorsVisible()`, otherwise just `revealedAnchorStations(...)`'s hosted ones and no
    free ones at all.
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
    re-stroke over the focus dim, its stops re-painted at full strength, `StationLayoutEditor`
    grab rings + direction arrows, then `GhostLattice` during a drag.

Outside the `<svg>`, `WarningToasts` renders one clickable HTML toast per router-flagged band;
clicking it jumps the viewport to the band's center. It takes MapCanvas's memoized `bands`
as a prop specifically so it never rebuilds the router.

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

**`StopMarker`** is the colored **square** that sits _in_ the band at each stop (distinct from the
circular dot), sized to the line `width`, with casing rails centered on the travel-parallel edges
(so tangent neighbors' rails coincide into one separator) and a terminus end-cap. Hatched markers
**pre-rotate their corners into world space** (can't reuse the rotated `<rect>` — `userSpaceOnUse`
patterns would re-rotate the stripes). Dashed/dotted markers render nothing at interior stops
(the pattern flows through) and a half-width stub at termini.

**`TransferLayer`** renders all transfers in **two flat passes** (user stroke halos → bodies) so
overlapping thick transfers trace one outer union. Bodies + halos are click targets
(`pointer-events="stroke"`). The selected transfer's ring is **not** in this layer: it renders in a
separate `TransferSelectionOutline` mounted **above** the station dots (step 8), so a connected or
crossing dot can't cover it; `TransferLayer` itself sits below the dots so a dot click routes to the
station, not the transfer.

---

## Canvas interaction layer

Files in [src/components/canvas/](src/components/canvas/). `MapCanvas` composes ~10 hooks onto
**four** SVG pointer handlers.

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
pointer-up. The background `Grid` level-of-details its own spacing (`gridStep` in
[canvas/Grid.tsx](src/components/canvas/Grid.tsx): the drawn interval doubles in powers of two so
on-screen spacing stays ≥ 5px — snapping still reads the true `gridSize` from the store).

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

**Group drag** ([groupDrag.ts](src/components/canvas/groupDrag.ts)): at pointerdown,
`collectGroupSiblings` snapshots every _other_ selected item — but only if the grabbed item is
itself selected (dragging an unselected item never tows; locked items never tow). Snap during a
group drag is **one rule for every master type**: the grabbed item snaps with its usual engine
against everything stationary, excluding only itself + the co-selected siblings
(`excludedIds` for the station engine, `groupAlignExclude` → `alignTargets` for the point
snapper); siblings then translate rigidly by the post-snap delta. Grid acts on the master's
reference point only — towed siblings keep their offsets verbatim.
**Group rotate** ([groupRotate.ts](src/components/canvas/groupRotate.ts)): right-click rotates the
whole multi-selection rigidly about the pivot via `rotateItemsAround` (fixed the bug where
per-type handlers omitted other types). Locked items are exempt: a locked pivot makes the
right-click a no-op, and locked co-selected members stay put while the rest rotate.

### Placement & popovers

`usePlacementDispatch.handleCanvasPlace(e)` is a per-`uiMode` dispatch. `placing-station` /
`creating-route-bullet` are **sticky** (click-click-click drops repeatedly); `placing-label` /
`creating-polygon` / `placing-svg` are single-shot (drop, exit, auto-select to open the
popover/handles). Cursor-following ghost previews (`*PlacingPreview`, all `opacity 0.5`,
`pointerEvents none`) feed synthetic items to the real views. Every placement mode snaps ghost

- drop through the shared `snapPlacement` (see Snapping) — same reference point and prefs as
  the item's first drag, Shift-click bypasses, preview guides render through `SnapGuides`.

`ItemPopovers` mounts the single popover for the sole selection — including the station editor
(see UI chrome) and the transfer popover (whose selection is the single-id
`selectedTransferId` primary outside `soleSelection`) — plus the one shared `SelectionPopover`
when **≥2 items** are selected across the five lists (idle only): a count summary + Lock all /
Unlock all / Delete all over the whole group, spawned beside the members' **union AABB** and
keyed by membership so it re-places when the selection changes. All of them reproject through
`useLiveView` so they track the canvas during pan/zoom.
`useDraggablePopover` **freezes the popover's spawn position as one world point** (item
projection + 14px gap, clamped into the host, then inverted through `screenToWorldPoint`) and
renders `projectToScreen(that point + drag)` with **nothing added after projection** — the
top-left corner is glued to the canvas point where the panel appeared (any per-render
screen-px term reintroduces the wandering-popovers bug; invariant pinned by
`popoverCanvasLock.test.tsx`). Freezing at spawn also means a size slider editing the item
can't feed its own position back. Header-drag accumulates in **world units**; the freeze
re-runs when the selection `id` changes (one popover instance reused across selections) and
defers while hidden or unmeasured (the station popover hides — `display:none`, not unmount —
during non-idle uiMode excursions so its anchor survives). Every item popover renders inside
`DraggablePopoverShell`, which owns the floating frame (header drag strip + body) and the
load-bearing event swallowing — pointerdown/click/contextmenu inside a popover must never reach
the canvas, which would deselect the item (closing the popover) or right-click-rotate under it.

### Memo contract (subtle but important)

`bandsGeometry` (`buildBandGeometry`) excludes ALL presentation from its signature — color AND
per-segment style, both the _values_ and the styled-segment _set_: band geometry is
presentation-BLIND, so each stripe resolves its style live at paint time (`resolveSegmentStyle`, the
single resolver shared by the geometry bake and the render-time refresh, so the two can never
disagree). **Width, by contrast, IS geometry (in the hash) — it moves the baked paths and changes
band merging.** So a color or casing edit — or a dashed→dotted change on an already-styled
segment — repaints without a band-geometry rebuild; the stop markers, whose footprint DOES depend on
style, rebuild instead via the `renderables` memo's direct `lines` dep. Region layering keeps its own
parallel cache: the overlays read `regionCache.regionsFor` (sig-keyed on the same geometry fields,
presentation excluded), so cycling a region assignment reuses the cached faces/bands/markers and
doesn't re-run the per-face arc-length search (a single click on a busy map once burned
300–500ms). `assignLinePriorities` mutates in place, so `bands` clones each spec.

The stations side works the same way: `stationsGeometrySig` hashes only the station fields
`buildBandGeometry` / `buildStopMarkers` read (x, y, rotation, per-stop lineId/row/col/orientation)
and keys both the `bandsGeometry` and `renderables` memos — NOT the raw `stations` reference. Label
edits (the whole `label` block) and per-stop `dotStyle`/`dotSize` are absent from the hash, so an
Alt label fine-drag streaming `setLabelOffset` per pointermove repaints the label without re-running
band routing or the marker sort. Pinned by `MapCanvas.stationsSig.test.tsx`.

---

## UI chrome

- **[Toolbar.tsx](src/components/Toolbar.tsx)** — Canvas menu (New / **Make a copy** — forks the
  live doc into a new library map / Save version — greyed out while the doc is `clean`, see
  saveBaseline.ts / **Revert** — discard unsaved changes back to the last save/load, disabled
  when there's nothing to discard / Load → {JSON…, From library…} / Export → {PNG, SVG, PDF, JSON}
  / Clear), Add-item menu
  (toggles `uiMode`; includes **Image / SVG…** — imports `.svg`, `.png`, or `.jpg/.jpeg` via
  `svgImport.ts` into an `SvgImage`), tool buttons (arrow/hand), grid-size + grid-visible +
  dark-mode toggles; embeds `MapNameField`, `MapVersionPill`, `SnapToggleBar`, `OptionsPopover`,
  and the **`?` `HelpPopover`**
  ([HelpPopover.tsx](src/components/HelpPopover.tsx) — a quick-reference interaction guide, also
  opened by the `?` key). Owns the **export desaturation flush**: before export it drops the
  selected-line desaturation via `flushSync(() => selectLine(null))` so it isn't baked into the
  clone, then restores the id with a bare `setState` in `finally` (the selectLine ACTION would
  kick an in-progress Edit Stops session back to idle).
- **[StatusToasts.tsx](src/components/StatusToasts.tsx)** — the status-message surface (Radix
  toasts sliding in over the canvas, lower-left). Actions report outcomes by calling `pushToast`
  ([state/toastStore.ts](src/state/toastStore.ts)) — a plain Zustand store (`useToasts`) so any
  module can report without threading a setter — rather than rendering their own message. Toasts
  **stack** (one failure never hides another): `push` appends with a unique incrementing id;
  `dismiss(id)` drops exactly that one. `error` persists until clicked; `info` self-expires
  (StatusToasts owns the timing). Distinct from `WarningToasts` (the router band-warning strip).
- **[Sidebar.tsx](src/components/Sidebar.tsx)** — Stations/Lines tabs, a sortable station list
  (rows select/deselect; the station editor itself is an on-canvas popover), and a Lines list
  that is purely reorder (↑/↓) / delete / pick-for-editing — clicking a row goes **straight into
  Edit Stops** (there is no selected-but-not-editing state) and the line editor rides in the
  pinned `LinePopover`, not the sidebar. The whole panel hides while either pinned top-right
  editor mode is active (`sidebarVisible`: `editing-station-layout` or `appending-to-line`),
  ceding the corner. Stop/topology editing is **canvas-driven**
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
  it stays undoable). (This replaced the old in-sidebar git-graph tree editor,
  `StationGraph`/`lineGraphLayout`, both retired.)
- **[LinePopover.tsx](src/components/LinePopover.tsx)** — the line editor's home: mounted by
  `ItemPopovers` for the whole `appending-to-line` mode, hosting `LineInspector` (name, service
  code, color palette, style row, default dot type/size, line width, curve radius, stroke
  width/color, seam width/color) over a Delete-only `PopoverFooter` (lines have no `locked`
  field; Delete also exits the mode). HARD-PINNED to the host's top-right via `pinnedTopRight`
  (shared with the station layout editor's pin, [DraggablePopoverShell.tsx](src/components/DraggablePopoverShell.tsx))
  — a line has no single on-canvas anchor to spawn beside, so the header is a title band, not a
  drag handle. `reconcileWithDoc` exits the mode if undo removes the edited line.
- **[StationPopover.tsx](src/components/StationPopover.tsx)** — the station editor's home:
  mounted by `ItemPopovers` for a sole-selected station (idle mode, or that station's own
  layout-edit mode), hosting the full `StationInspector`. Its drag-handle title band shows the
  station's SHORT name (`stationNameListText`, falling back to "Station"). Layout: a **button bar**
  (**Edit layout** button, then the **Select Similar** mirror-matching toggle, then a
  right-justified **WP** toggle; lock lives in the footer), then the Name field on its own row,
  labeled X/Y + a mirrored ±45° rotate icon pair, a **Stop dots** section (a Line/Type/Size/Direction
  column header over the per-stop rows —
  [inspector/StopRows.tsx](src/components/inspector/StopRows.tsx): service badge + always-enabled
  shape picker + dot size + a world-true orientation cycle button per stop; hover cross-highlights
  the dot via `hoveredLineStop`, and **double-clicking the badge** jumps to that line's editor
  (`startAppend`) — the reverse of the line editor's own station dblclick), and a Label row whose
  **magic-wand** Auto-placement toggle stays
  put and SWAPS the row between the manual align/valign controls (wand off) and the auto H/V tuning
  controls (wand on) — each a segmented select-one (Radix ToggleGroup, `.align-group`); the manual
  controls keep an explicit `auto` segment so legacy-auto labels stay editable. Beside them a
  **Rotate button** (steps the label's reading direction 45° through all 8 orientations via
  `rotateLabel` — the same action bound to `R` and the layout-editor right-click; it stays on the
  row in both setups, since rotation sets the reading axis that autoAlign still honors), then offset
  controls. The Name typography section keeps its style picker always visible with a collapsible,
  remembered (`useStationEditorPrefs`) Size→Tracking detail. New stations default to Auto placement
  ON (`makeStation` sets `label.autoAlign = true`). The anchor is CLAMPED into the canvas host so
  sidebar-selecting an off-screen station
  still shows the editor. Inspectors dispatch transforms directly through **mirror matching**
  (`findMatchingStations` returns stations sharing a line + a layout under the model's 4-fold
  mirror symmetry — whole line, not adjacency; an edit broadcasts through
  [state/mirrorDispatch.ts](src/state/mirrorDispatch.ts), rotating local deltas through
  `rotateGridDelta`; orientation cycles and station rotation are relative steps so odd-offset
  matches stay world-equivalent). The **Select Similar** chip (button bar, between Edit layout and
  WP) drives `mirrorMatching`: off = every dispatch resolves to the source station alone; on = stop/label
  edits + station rotation broadcast, while name, X/Y, and the per-station WP / lock /
  bold / italic flags stay local. Disabled at zero matches unless already on (so the mode can
  always be exited); MapCanvas highlights the current match set while on.
- **The painted name on the main canvas is NOT a label handle** — grabbing a selected station
  anywhere on its footprint, name included, drags the whole STATION (StationHitArea gives the name
  rect the same station handlers as the cells rect). The name's own layout (cell / rotation /
  offsets) is edited only via the two surfaces below, never by a plain drag on the main canvas.
- **Station layout editing happens ON the canvas** (the sidebar mini-canvas "StopGrid" was
  retired in favor of these two surfaces; its pure drag/ghost math lives on in
  [inspector/stopGridDrag.ts](src/components/inspector/stopGridDrag.ts) — `computeGhosts`,
  `findDropTarget`, `nudgeTarget`, all screen-frame-generated and projected to station-local):
  1. **`editing-station-layout` mode** ([canvas/StationLayoutEditor.tsx](src/components/canvas/StationLayoutEditor.tsx)
     - [useStationLayoutDrag.ts](src/components/canvas/useStationLayoutDrag.ts)): entered via the
       inspector's **Edit layout** button (`startEditingStationLayout` preserves selection + mirror
       state; frames the camera if the station is off-screen). Clicking another station RETARGETS
       the mode to it (`layoutEditReconcile`: the mode follows the sole-selected station; a
       multi/empty selection exits to idle). Grab rings over each real dot (each wearing the
       drawn orientation arrow, sized to fit its own ring — not off the dot like the map's hover
       badge, where a service-code disc would scale the arrow past the ring it has to live in) +
       a label-cell ring. All of that chrome is in **world** units, geometry AND stroke weight,
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
- **`StationNameEditor`** intercepts Ctrl+Z itself — native input undo would creep the doc back
  one char per press; it commits the rename group, runs doc-level undo/redo, then closes.

---

## Export pipeline

[exportCanvas.ts](src/export/exportCanvas.ts) + [fonts.ts](src/export/fonts.ts). Turns the **live
in-DOM** `<svg>` into a standalone SVG, a 4× PNG, or a vector PDF
([exportCanvasPdf.ts](src/export/exportCanvasPdf.ts) + [pdfHatch.ts](src/export/pdfHatch.ts)).

`buildExportSvg(source, {background, pixelScale})` (async — awaits font fetches):

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
4. **Text baseline** — svg2pdf never reads `dominant-baseline` (only `alignment-baseline`), so every
   run still carrying one — station names use `central`/`text-before-edge`/`text-after-edge`, free
   labels `hanging` — lands on the alphabetic baseline, too high. [pdfText.ts](src/export/pdfText.ts)
   `normalizeTextBaselines` measures each `<text>`'s box vs its forced-alphabetic box (`getBBox`,
   browser truth) and shifts `y` by the delta — exact for any baseline mode/font without metrics.
   Badge glyphs carry no `dominant-baseline` at all (`capCenterDy` already put them on the alphabetic
   baseline), so this pass is a no-op for them and the PDF inherits their platform-invariant position.
5. **Letter-spacing** — svg2pdf ignores the SVG `letter-spacing` property, so a tracked label would
   print at default spacing. `bakeLetterSpacing` ([pdfText.ts](src/export/pdfText.ts)) re-expresses
   each tracked run as an SVG `textLength` (which svg2pdf converts to a PDF `charSpace`); it runs on
   the attached clone (needs `getComputedTextLength`) and **before** glyph outlining so char
   positions are read from the final spacing.
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

- **`activePalettes` is never empty** — enforced on both load paths, in transforms, and in
  `deleteCustomPalette`'s fallback.
- **Transforms return the same reference on no-op** — the foundation of undo grouping
  (`docSnapshotsEqual` is reference equality). A mutate-in-place transform would silently break
  history.
- **Canonical stored form**: optional fields are **absent when equal to their default**; setters
  clamp/round/lowercase and drop at default. `DotStyle` objects are written in fixed field order
  so `JSON.stringify` equality is exact for app-written docs.
- **Referential integrity after every action**: `line.stations[i] ∈ stations`; `stop.lineId ∈
lines`; every `segmentStyles` key is a real, non-default adjacency; every
  tag/transfer endpoint and `routeBullet.lineId` resolves live-or-null. Maintained by cascade
  prunes after structural edits (`deleteStation`/`deleteLine`/`removeStationFromLine`/…).
- **`LineTag.fromStationId < toStationId`** always (canonical/alphabetic, = `pairKeyOf`).
- **`DOC_FIELDS` is the single source of truth** for persisted/undoable fields — it is **not**
  `Object.keys(DEFAULT_DOC)`; keep them in sync (a field in `DEFAULT_DOC` but not `DOC_FIELDS`
  would default but never persist/undo).
- **Parallel arrays in a band** (`lines`, `paths`, `stripeOffsets`, `stripeWidths`,
  `linePriorities`) are index-aligned; `stripeOffsets`/`stripeWidths`/`radius` are the single
  source of truth — read them, never re-derive; sample with `band.radius`, not a line's raw
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
  edge can snap by up to a whole world unit and erase the clipped line over exposed background. Both
  `SeamClips` and `RegionExcludeClips` defend by emitting clip content in ×64 local coords under
  `transform="scale(1/64)"` — the shared `CLIP_RASTER_SCALE`/inverse in
  [clipRaster.ts](src/components/canvas/clipRaster.ts) — shrinking the snap to 1/64 unit. Invisible
  under full tangency; the interline gap (which exposes bare background at hole/seam edges) is what
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
- **Export desaturation race** — `Toolbar.runExport` uses `flushSync` to drop/restore the selected-
  line desaturation synchronously so it isn't baked into the clone.
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
- **E2E (Playwright, [e2e/](e2e/))** — single-worker, no retries locally (2 on CI), honors `PORT` for parallel
  worktrees. `seedAndOpen` seeds a localStorage doc (`Seed*` shapes omit fields to simulate legacy
  saves) and opens the app — **this is the only place the rehydrate/migrate path is exercised**.
  `migration.spec.ts` asserts **zero console errors** loading legacy docs; `export.spec.ts` checks
  the exported SVG is chrome-free with embedded `@font-face` and that PNG is genuinely 4× (reads
  IHDR bytes); `exportPdf.spec.ts` exports a hatch+text+image map and asserts the PDF embeds a
  TrueType CID font (`/FontFile2` + `/Type0`) rather than falling back to standard Helvetica.
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
- **Wash / silhouette** — the soft selection-highlight fill behind a selected station.
- **Waypoint** — a routing-point station with name + bullets hidden.
- **Route bullet** — a free-floating badge showing a line's service code.
- **Service code** — the short route identifier on a line (e.g. `"A"`, `"7"`).
- **Day/night color** — a `{day, night}` pair resolved per the dark-mode theme.

```

```
