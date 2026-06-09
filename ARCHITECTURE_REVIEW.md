# massimo — Architectural Review

_Full-codebase assessment: abstraction quality, complexity, duplication, brittleness, code-health smells._

Method: 6 parallel domain surveys → triage/dedup → adversarial verification of each candidate against the real code → synthesis. 46 raw findings → 40 candidates → **38 verified, 2 rejected**. The three highest-stakes findings (two reachable behavior bugs + one data-loss bug) were re-verified by hand against the source.

---

## Executive summary

**Grade: B+** — a deliberately good pure-core / thin-shell architecture with one well-contained, recurring under-abstraction (per-item-type copy-paste) that has begun to spawn real divergence bugs in the interaction layer.

The through-line of the whole project is one idea applied relentlessly: **pure functions own all change, and everything else is a thin, dumb shell around them.** Document mutation lives entirely in `transforms.ts` as `(doc, ...) => MapDoc` pure functions that return the input unchanged on no-ops; the Zustand store is a near-mechanical `set(s => T.fn(s, ...))` wrapper; geometry is genuinely model-agnostic pure math; history, persistence, and color math each have exactly one home. **This factoring is the thing to protect** — it is why the test suite can be property-based, why export can clone the live SVG instead of re-deriving it, and why referential integrity (cascade-deletes, orphan pruning) is centralized rather than scattered. Do not tear any of it out.

The debt is almost entirely **one shape, and it is under-abstraction, not over-abstraction**: the codebase has four selectable/movable item types (stations, route bullets, text labels, polygons) and the "do the same thing per item type" logic was copy-pasted instead of factored. This single theme produces the ~20-action explosion in `selection.ts`, the four near-identical click/contextmenu handlers and three popover blocks in the `MapCanvas` god component, the four-way fan-out in `App.tsx`'s keydown effect, the four drag hooks that re-implement one pointer-gesture lifecycle, and the quadruplicated group-drag sibling-towing.

Crucially, this copy-paste has **already produced two reachable behavior bugs** where the copies silently diverged. **The single highest-leverage move** is to give "the current multi-selection across all four item types" exactly one named home and route the duplicated sites through it; that one investment closes the divergence bugs and removes the dominant merge-conflict surface at once. A long tail of small, genuine-but-low-urgency tidies rounds out the picture.

---

## ⚠️ Confirmed bugs (verified against source)

These are not stylistic — they are reachable defects produced by the copy-paste, found and re-confirmed by hand.

1. **Stale `selectedLineId` after a shift-rubber-band of non-station items.** `selectLine(id)` sets `selectedLineId` and clears the id-lists. A shift- (add) or ctrl+shift- (xor) rubber-band over a region containing **only** bullets/labels/polygons routes through `addRouteBulletsToSelection`/`addLabelsToSelection`/`addPolygonsToSelection`, which clear *nothing* (`selection.ts:424-433, 469-478, 502-511`), while `addStationsToSelection([])` early-returns `{}`. So `selectedLineId` survives → `MapCanvas.tsx:94` keeps the line highlighted (others desaturated) and `inspector/index.tsx:22` opens the **Line** inspector even though the user selected bullets. (Masked on the plain non-modifier path because `setStationSelection` clears the line first.) **Fixed by roadmap #1.**

2. **Group-rotate silently drops co-selected polygons; bullet popover shows in a mixed selection.** `onBulletContextMenu`/`onLabelContextMenu` (`MapCanvas.tsx:297-347`) compute `total` and call `buildRotateMembers(stIds, blIds, lbIds)` — **omitting `pgIds`** — so right-click-rotating a bullet while polygons are co-selected rotates everything *except* the polygons (only `onPolygonContextMenu:362-379` includes them). Separately, the bullet popover gate (`MapCanvas.tsx:1015-1017`) checks only `selectedStationIds.length === 0`, not labels/polygons — so a bullet's popover renders during a 2-item bullet+label/polygon selection, unlike the stricter label/polygon gates. **Fixed by roadmap #1.**

3. **Clipboard silently drops `Polygon.curveRadius` on paste.** `polygonPayload` writes the field via `{ id, ...data }` spread, but the hand-written reader `parsePolygonData` (`clipboard.ts:151-186`) validates/copies `fillOpacity` and `locked` yet never reads `curveRadius`. The `Omit<Polygon,'id'>` return type can't catch it because `curveRadius` is *optional*, and the test fixture omits it, so the suite is green while lossy. Copy a rounded polygon → paste → **sharp corners.** Same hand-written-reader pattern threatens every optional field on `RouteBullet`/`TextLabel`/`Polygon`. **Fixed by roadmap #2.**

---

## What's genuinely good (preserve this)

- **Pure-transforms + thin-store split, applied with rare consistency.** ~80 transforms honor `(doc, ...) => MapDoc`, return the input unchanged on no-ops, never mutate inputs; the store is a mechanical `set(s => T.fn(s, ...))` wrapper. This is the foundation.
- **Referential integrity is centralized, not scattered.** `deleteStation`/`deleteLine` cascade through shared orphan-pruning helpers reused by every adjacency-changing edit (`transforms.ts:616-630, 1111-1141, 1731-1786`).
- **Backfill/sanitize is genuinely DRY across both entry points.** `parse()` and the persist `migrate()` import and call the *same* exported sanitizers (`sanitizeStations`, `backfillPolygonDarkColors`, `backfillTextLabelColors`). The dual-path hazard is correctly factored — `line.name` backfill is the **one** un-shared exception (see roadmap #12).
- **`DOC_FIELDS` is a true single source of truth** (`store.ts:70-105`): one array drives persist partialize, zundo partialize, `DocSnapshot`, `pickDocSnapshot`, and `docSnapshotsEqual`. Adding a persisted/undoable field is one line.
- **History internals confined to one adapter module** (`history.ts`): only it touches zundo's `pastStates`/`futureStates`. Reference-equality history grouping (`store.ts:538-560`) is sound *because* transforms return new objects only on change.
- **`UiMode` is one discriminated union with a centralized transition rule**, and `clearedSelections()` is the single canonical full-wipe (the *partial* sibling-clear is the part that drifted — see #1).
- **`vec.ts` is a clean, well-documented 2D primitive** with intentional sign conventions (`perp` vs `leftNormal` for y-down screen space) and a single `SQRT2_2` home. The problem is it's *bypassed*, not its design.
- **Geometry is genuinely model-agnostic** (type-only model imports everywhere except one pure value-import in `interlining.ts`), and sampled tag/label geometry reuses the exact renderer walker so positions structurally cannot desync from painted SVG.
- **Band geometry is deliberately split from layer-priority assignment** (`interlining.ts:141-150`; `MapCanvas.tsx:123-149`) so the geometry memo survives layer-cycle edits — a real, well-reasoned boundary, not accidental.
- **`exportCanvas` clones the live SVG** rather than re-rendering, so export structurally cannot drift from on-screen Views (`exportCanvas.ts:64-139`).
- **Color math is a single source of truth** (`util/color.ts`); leaf layer components are small, pure-prop, single-purpose; pure helpers (`stopGridDrag.ts`, `stationBandGeometry.ts`) export their constants and are unit-testable without RTL.
- **Shared UI hooks are the right shape where adopted**: `useDismiss`/`usePopover`, `useFieldHistory` (commits its open group on unmount so focused-input edits aren't lost from undo), `useNumericField`.
- **The test suite is unusually disciplined**: property-based invariants over random action sequences (`transforms.invariants.test.ts`), behavior-pinning DOM tests with inline rationale, and e2e that exercises the **real** localStorage migration on every seed (persists `version:4`) plus injects legacy orientation strings. 73 test files to 99 source files; **zero** `TODO`/`FIXME`/`HACK` markers in non-test source.

---

## Assessment by the five lenses

### 1. Abstraction quality

Good in the core, weak in exactly one place: **there is no single named concept for "the current multi-selection across all four item types."** That absent abstraction is the root of most of the duplication below — `App.tsx`, `MapCanvas`, `selection.ts`, and `buildRotateMembers` each re-derive the selection by hand. The fix is not a framework; it's one or two small selectors (`soleSelection()` → `{type,id}|null` when exactly one item across all types is selected; `getCopyableSelection()` for the stations-excluded copy/paste set) plus a shared `SIBLING_PRIMARY_CLEAR` constant.

Two minor geometry under-abstractions: `vec.ts` is treated as a types-and-constants module rather than the function library it is, so `perp`/`dot`/`cross`/`leftNormal` are re-inlined in `snap.ts`, `stripeOutline.ts`, `lineTagGeometry.ts`. One mild misplacement: `darkMode`/`gridVisible` (display prefs) live in `viewportStore` (documented as "camera state only"), forcing `theme.ts` to reach into a camera-named store — cosmetic.

> Explicitly **not** a problem: extracting `layerPriority` math out of `interlining.ts` — that code is pure model math and the band-vs-priority split is load-bearing for memo stability.

### 2. Unnecessary complexity ("dumb, simple, stupid")

Accidental complexity is **concentrated, not pervasive**, and it's the copy-paste kind rather than the clever-abstraction kind.

- **`MapCanvas.tsx` (~1067 lines) is a true god component**: ~26 store subscriptions, four near-identical per-item click handlers, three near-identical contextmenu/rotate handlers, a 14-branch placement dispatch (`onCanvasClick:388-461`), and three structurally identical popover-gating blocks. The fix is **incremental peel-off following the existing `useStationInteraction.ts` precedent** — not a rewrite.
- **`snapDraggedStation` (~375 lines, `snap.ts:204-580`)** bundles ~6 phases, but the framing is overstated: the hard math is already in named helpers and the solve/guide phases share mutated locals. Only the two genuinely pure phases (candidate collection, primary/secondary selection) are worth lifting.

> De-prioritize: the ~55 trivial `store.ts` pass-through delegates are boring-but-correct and fully type-checked — codegen would erode type safety for near-zero gain (**decline**). The `App.tsx` keydown dep-array is harmless and slightly *more* correct than a `[]`-deps version.

### 3. Duplication / redundancy

**The dominant theme, tracing almost entirely to per-item-type fan-out.**

Highest-value because they hid **reachable bugs** (see ⚠️ above): the drifted cross-clear matrix in `selection.ts:262-512`, and the drifted rotate/popover predicates in `MapCanvas.tsx:297-379, 1015-1062`.

Pure-tidy duplication (maintenance tax, no bug):
- **Four drag hooks re-implement one threshold/capture/suppressClick/commit lifecycle** — the commit block alone is **6 copies** (`use*Drag.ts`) — plus **quadruplicated group-drag sibling collection + towing**.
- Two draggable popovers copy the entire frozen-anchor + header-drag mechanism (`TextLabelPopover.tsx`, `PolygonPopover.tsx`; the polygon source comment even admits it "mirrors" the label one).
- Single-record immutable update is open-coded **~38 times** in `transforms.ts`.
- The font-weight `<select>` + its type-narrowing guard live in **3 places** despite a canonical `LABEL_WEIGHT_NAMES` export; palette known-ids + canonical-order normalization is defined **3 times**.
- `App.tsx`'s keydown effect re-derives the selection four times with a documented (intentional) stations asymmetry that belongs in a selector, not a comment.

### 4. Architectural brittleness

Real but bounded — **none corrupts saved documents.**

- **Clipboard drops `Polygon.curveRadius`** (⚠️ #3) — textbook instance of the project's own "writer-via-spread stays correct while hand-written reader drifts" hazard; recurs for every optional field on `RouteBullet`/`TextLabel`/`Polygon`.
- **Test-side list-drift**: `saveLoad.test.tsx` hand-copies the 19-field `DOC_FIELDS` payload twice (so it no longer mirrors the real `onSave`, which uses `pickDocSnapshot`); the selection-reset object is hand-rolled and incomplete in two files, diverging from the unexported `clearedSelections()`. These guards give *false confidence*.
- Lower-severity, defended-by-discipline: module-level `dragState.suppressClick` has no `pointercancel` cleanup (a cancelled mid-drag strands the flag until the next drag); selection holds ids the doc deleted after undo/redo (guarded ad-hoc at every read site); `migrate()` runs the v3 block last, contradicting its ascending doc-comment (provably order-independent today); `DEFAULT_DOC` shares nested mutable empties guarded only by the never-mutate-in-place convention.
- `RouteBulletPopover`'s size control skips `useNumericField`, so one slider drag pushes **~42 undo entries**, and hard-codes 6/48 with no transform-side clamp — the lone control that broke the standard idiom.

### 5. Other smells

Small, low-risk, do opportunistically:
- **Dead code**: `clearAll` redundantly re-zeros `lineTags` (`transforms.ts:1271-1273`); `lineTagGeometry.ts` ships four dead `vec` imports kept alive with `void` while hand-inlining the same primitives; `useLineTagDrag` carries a dead `viewportZoom` param + `useSelection` import.
- **Convention drift**: the e2e `Seed` type's `valign` union omits the two `auto-*` members the model now has (`e2e/fixtures.ts:19`); two unnamed sine thresholds (`0.1`, `1e-3`) in `snap.ts` encode related concepts with no link.

> Two candidates **correctly rejected**: the dual SVG point formatters (6dp vs 3dp) feed entirely separate subsystems that never composite; `updateTextLabel`'s re-anchoring is explicitly gated so a color-only edit never measures or moves. Neither is real coupling. A shared `GEOM_EPS` module is also rejected — the named tolerances live in different unit spaces and centralizing invites incorrect-reuse.

---

## Prioritized roadmap (ordered by leverage = impact ÷ effort)

| # | Change | Cat | Sev | Effort | Impact |
|---|--------|-----|-----|--------|--------|
| 1 | **Unify multi-item selection** — `SIBLING_PRIMARY_CLEAR` + `makeListSelectionActions` factory + `soleSelection()`/`getCopyableSelection()` selectors. **Fixes bugs #1 & #2.** | dup | med | med | **high** |
| 2 | **Fix clipboard `curveRadius` drop** + add the regression fixture. **Fixes bug #3.** | brittle | med | small | med |
| 3 | **Derive the persisted-field-set tests from the source of truth** (`pickDocSnapshot`, exported `clearedSelections`). | brittle | med | small | med |
| 4 | **Extract `useDragGesture` + `groupDrag` helpers** across the four drag hooks. | dup | med | med | med |
| 5 | **Peel `MapCanvas` apart** along the `useStationInteraction` precedent. | complexity | med | med | med |
| 6 | **Collapse single-record immutable-update boilerplate** in `transforms.ts`. | dup | med | small | med |
| 7 | **Route `RouteBulletPopover` size through `useNumericField`** + exported size constants/clamp. | brittle | low | small | med |
| 8 | **Extract `useDraggablePopover`** (frozen-anchor + header-drag). | dup | med | small | med |
| 9 | **Consolidate font-weight select + palette-id normalization** to their canonical sources. | dup | low | small | med |
| 10 | **Make `dragState.suppressClick` self-healing** (capture-phase reset). | brittle | low | small | med |
| 11 | **Reduce `vec.ts` bypass** — `stripeOutline` (anti-desync) first; `snap.ts` conservatively. | dup | med | med | med |
| 12 | **Opportunistic micro-cleanups** (dead code, `migrate()` ordering, `backfillLineNames`, e2e `valign`, named epsilons). | other | low | small | low |

### Item 1 — the keystone (do this first)

In `selection.ts`:
```
const SIBLING_PRIMARY_CLEAR = { selectedLineId: null, selectedLineTagId: null, mirrorMatching: false }
```
Add `makeListSelectionActions(idField, { extraClear })` that builds `select/toggle/set/add/xor` for one kind from the existing `dedupeLastWins`/`unionAppendNovel`/`xorAppend` + `clearedSelections()`. **Spread `SIBLING_PRIMARY_CLEAR` into the append branch of `toggle` AND into `add`/`xor`** (the currently-empty bullet/label/polygon `add*`/`xor*` bodies are bug #1). Per-kind `extraClear` carries differences: polygon → `{ selectedVertex: null }`; stations keep the inspector micro-state clears. Keep `selectStation`'s sticky-uiMode override as the one documented exception.

Add `soleSelection()` (returns `{type,id}|null` when exactly one item across all four lists is selected) and `getCopyableSelection()` (stations-excluded). Then:
- In `MapCanvas`, replace the three popover-gating triplets with `soleSelection()`, and collapse the three contextmenu rotate handlers into one `makeRotateContextMenu(type, rotateSingle)` that always reads all four arrays through `buildRotateMembers` (fixes bug #2).
- In `inspector/index.tsx`, gate the station inspector on `soleSelection()`.
- In `App.tsx`, route copy/duplicate through `getCopyableSelection()` so the documented stations asymmetry lives in the selection layer.

**Risks / verification:** the behavior changes are intentional but observable (`add`/`xor` of non-station items now clears the line; group-rotate now includes polygons; bullet popover/station inspector stop showing in mixed selections). The factory must preserve "clear only on append, never on the toggle-*remove* branch" so deselecting an item doesn't wipe the line. Existing `selection.test.ts` suites pin current behavior; add tests for the add/xor-clears-line and `soleSelection`-returns-null cases. Interaction regressions (rotate/popover/placement ordering) are Playwright-only — `npm run pre-pr` won't catch them, so this needs a manual checklist (place each item type, shift-click multi-select, right-click group-rotate, single-item popover open/close, canvas-click deselect).

### Scope discipline (explicitly do NOT)

- Build a full `{kind, move, delete, duplicate, pastePayload}` item-kind registry — the per-kind move/paste bodies genuinely differ (polygon uses `setPolygonVertices`+map; `pastePolygon` drops `locked`; stations have no copy path), so a registry trades four readable loops for indirection + four closures. Do the small `getCopyableSelection()` + extracted locked-polygon filter instead.
- Codegen the `store.ts` pass-through delegates (erodes type safety).
- Force `useLineTagDrag` onto the shared drag transport (it uses window listeners + `getScreenCTM` deliberately — share only the state machine).
- Merge `snap.projectOntoAxis` with `polygonSnap.projectOntoAxis` (different return shapes), or introduce a shared `GEOM_EPS`.
- Extract `layerPriority` from `interlining.ts`.

---

## Sequencing suggestion

1. **Correctness first, cheap:** #2 (clipboard) and #3 (test guards) — tiny diffs, real payoff, restore the guards that should have caught #2.
2. **The keystone:** #1 — closes both interaction bugs and removes the dominant duplication surface. Land with the Playwright checklist.
3. **Tidy on the cleared ground:** #5 (MapCanvas peel) becomes much smaller after #1; #4/#8 (drag + popover primitives) and #6 (transforms boilerplate) are independent, reviewable per-family.
4. **Opportunistic:** #7, #9, #10, #11, #12 as you next touch those files.
