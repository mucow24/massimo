# Architectural Review — `massimo`

_Vignelli-style transit-map editor · React + TypeScript + Vite + Zustand · ~17.7k LOC prod, ~17k LOC test._

Produced by a 5-phase agent workflow: **map** 10 subsystems in parallel → **synthesize** 5 cross-cutting themes → **consolidate** into 29 proposals → **adversarially challenge** every one → **rank**. The challenge phase mattered: it killed/scoped ~half the proposals because they were plausible-but-wrong (a fictional dependency cycle, an unbuildable lint gate, a multi-select-breaking refactor, several "unify everything" over-reaches).

---

## TL;DR

**The pure core is excellent and should be left almost entirely alone.** A normalized `MapDoc`, ~69 dumb `(doc) => doc` transforms, the geometry math (snap/router/interlining/orientation), `DOC_FIELDS` as a single source of persisted-field truth, and a dense behavioral test suite over all of it. That core is a refactor _enabler_ — you can rewrite algorithms against it fearlessly.

**The rot is concentrated at three boundaries, and it is almost entirely _accidental_ (copy-paste accretion), not essential to a transit-map editor:**

1. **A geometry kernel that exists but nobody is forced to use.** `vec.ts`, `rotateBy`, and `localToWorld` get re-derived inline 3–6× each. The y-down perpendicular is hand-inlined, the atan2→8-way quantizer is written twice, cos/sin rotation matrices are open-coded where `orientation.localToWorld` already exists, and `SQRT2_2` is declared 3× with two spellings. Every copy is a latent sign-slip.
2. **The view/state shell.** A 1478-line `MapCanvas` with 13 anonymous JSX IIFEs and two inline drag refs the file itself apologizes for, plus a 952-line `store.ts` hosting two unrelated stores where the selection array-algebra is written 3×.
3. **"Convention, not structure."** A correct helper exists and callers bypass it — default-omission, prune-after-adjacency, `clearedSelections`, migration, `usePopover`, `resolveSegmentStyle`.

**The honest plan is smaller and dumber than the raw proposals.** Do the mechanical, test-pinned consolidations; add the missing tests for the gnarly untested code; then — _only behind those tests_ — extract the one genuinely valuable god-component seam. **Resist the framework-building.**

---

## Direct answers to your questions

**Is the code clean and readable?** Bimodal. The pure core reads beautifully; four god-files (`MapCanvas` 1478, `transforms` 1525, `StationView` 1055, `store` 952) and 13 anonymous JSX IIFEs in `MapCanvas` alone are where comprehension goes to die. **C+**

**Are the abstractions clear, strong, and well-respected?** Clear and strong — but routinely _not respected_. `vec.ts`, `localToWorld`, `clearedSelections`, `usePopover`, `resolveSegmentStyle` all exist and get bypassed inline. Boundaries held by convention erode. **B−**

**Unnecessary complexity or duplication?** Yes, and it's real (not superficial): selection array-algebra ×3, orbit math ×4, stripe-offset across 8 sites/6 files, atan2-quantizer ×2, `SQRT2_2` ×3, dead `SegmentStyleDivider`, duplicate `DOT_SHAPES`. ~60% of the god-file sizes is inline accretion, not inherent. **Complexity C+ / Duplication C**

**Is the code testable?** Sharply bimodal. Model/geometry is densely, behaviorally tested and _enables_ refactoring; the view/state shell is barely unit-tested and the single most complex pure function (`redistributeBetween`) has **zero** direct tests. **B**

**What can be made dumber/simpler?** One geometry kernel instead of inline re-derivations; free selection helpers instead of triplicated quartets; one `orbitPoint`; one `stripeOffset`; delete dead/duplicate UI. See ranked plan #1, #3, #5, #6, #7.

**What can be enhanced?** Tests-first safety net for the gnarly code; a named, testable `<HighlightedLineLayer>`; an honest drag-hook split; one pinned layering direction. See ambitious bets.

**What major changes?** See the ranked plan. The biggest _honest_ swings are the geometry-kernel consolidation (#1) and the `MapCanvas` highlight extraction (#9) — both behind the test investment (#2). The most _tempting_ big swings (regenerate the store, decompose snap, carve transforms, fold pan into the mode machine) were examined and **rejected** — see "Do not touch."

---

## Scorecard

| Dimension | Grade | One-line |
|---|:---:|---|
| Readability | **C+** | Pure core reads great; four god-files + 13 anon IIFEs are where it dies. |
| Abstractions | **B−** | Clear & strong, but bypassed inline — boundaries held by convention erode. |
| Complexity | **C+** | Essential complexity handled well in isolation; accidental complexity dominates the shell. |
| Duplication | **C** | Verified, collapsible: selection ×3, orbit ×4, stripe-offset ×8, atan2 ×2, `SQRT2_2` ×3. |
| Testability | **B** | Core is densely tested (enabler); shell is barely tested; gnarliest fn has zero tests. |

---

## The ranked plan

Ordered by risk-adjusted payoff. Effort: S/M/L/XL. **Do them roughly in this order** — #2 (tests) is the safety net that de-risks everything below it.

### 1. Consolidate the geometry kernel into `vec.ts` + `orientation.ts` (NOT a new `frame.ts`) — `impact: high · effort: M · risk: low`
**Why:** the single most-cited finding. Primitives already exist but get re-derived inline, each copy a latent y-down sign-slip: `stopPosWorld` ([interlining.ts:90](src/geometry/interlining.ts:90)) hand-rolls a cos/sin matrix that _is_ `localToWorld` ([orientation.ts:130](src/geometry/orientation.ts:130)); `worldToStationLocal` ([interlining.ts:103](src/geometry/interlining.ts:103)) is `localToWorld` with a negated angle; `dirIndex8` ([interlining.ts:117](src/geometry/interlining.ts:117)) == `dirIndex` ([router.ts:18](src/geometry/router.ts:18)); `SQRT2_2` is declared 3×.
**What:** centralize `SQRT2_2` to one `Math.SQRT1_2`; export one `dirIndex`/`DIRS_8`/`axisOf`; replace the open-coded matrices with the existing helper (add a `worldToLocal` inverse); add `leftNormal`/`rightNormal` to `vec.ts` and replace bare `{x:d.y,y:-d.x}`. **Leave `autoOrient.tangentRotation` alone** (its `−2` phase targets local +y — different function). **Do NOT create `frame.ts`** (redundant fourth home), and land the perp-touching change as its own commit so a bisect can isolate any sign regression.
**Payoff:** exactly one place to do 2D + octolinear rotation math; reviewers stop re-deriving "which perpendicular is this."

### 2. Add direct tests for `redistributeBetween` + a serialize round-trip property — _before_ touching geometry — `impact: high · effort: S · risk: low`
**Why:** test investment is inverted relative to risk. `redistributeBetween` ([transforms.ts:245](src/model/transforms.ts:245)) is the most complex pure function in the repo (arc-length interpolation, per-anchor sub-chains, multi-line conflict detection) and has **zero** direct tests.
**What:** cover even 3-stop spacing (straight + arc), the multi-line conflict skip, arc-bend anchor detection at a >5° corner, the sub-pixel skip, and `toBe()` reference-equality on the no-op short-circuit. Add one fast-check property: `parse(serialize(x)).doc` deep-equals `x`. **Drop** the proposals' mis-stated properties (the "snap never moves beyond tolerance" property is false for the 2-axis solve; the rotate-identity is already tested at 8×).
**Payoff:** the gnarliest algorithm gets an executable contract, so you can rewrite snap/transforms internals without fear.

### 3. Delete dead `SegmentStyleDivider.tsx` and the duplicate `DOT_SHAPES` — `impact: med · effort: S · risk: low`
**Why:** cheapest win, pure subtraction. [SegmentStyleDivider.tsx](src/components/inspector/SegmentStyleDivider.tsx) is referenced only by itself; `LineInspector`'s `DOT_SHAPES` is a byte-duplicate of `StationShapePicker`'s `SHAPES` (already imported in the same file).
**What:** `rm` the file; delete the array and import `SHAPES`. **Do not** try to reuse `StationShapePicker` wholesale for the per-stop popover (its CSS-relative positioning can't model the computed pixel coords) — the safe win is just the array dedupe.
**Payoff:** ~100+ lines of dead/duplicate code gone.

### 4. Make prune-after-adjacency structural for reorder/toggle; delete `updateLine`'s dead `stations` branch — `impact: high · effort: S · risk: low`
**Why:** live latent footgun. `reorderLineStations` ([transforms.ts:1051](src/model/transforms.ts:1051)) rewrites `ln.stations` wholesale and prunes **nothing**, so `segmentStyles`/`segmentLayers`/`lineTags` keyed to old adjacencies become orphans — user-visible as a cleared override resurrecting after reorder-away-and-back.
**What:** add the existing `pruneOrphanSegmentStyles` + `pruneOrphanLineTags` calls to `reorderLineStations` and `toggleStationOnLine`'s removal branch; delete the unused `stations` field from `updateLine`'s patch type (zero production callers — erase the footgun, don't route it); add a reorder-then-reorder-back regression test. **Do NOT** build a universal `setLineStations()` funnel — the callers differ in stop-cell/auto-orient work a list-only setter can't carry.
**Payoff:** cleared overrides stay cleared; "prune after adjacency change" stops being a rule each new mutator must remember.

### 5. Extract free selection helpers (`dedupeLastWins`/`unionAppend`/`xorAppend`) — NOT a factory, NOT `clearedSelections` routing — `impact: med · effort: S · risk: low`
**Why:** the set/add/xor array bodies for stations/bullets/labels ([store.ts:712](src/state/store.ts:712)) are byte-identical except the field name. But the per-type _clears_ diverge (station toggle wipes a 6-field inspector block incl. `activeTab`; bullet/label wipe 2), so that divergence is essential. The proposed factory would re-inject the divergence behind config, and routing through `clearedSelections()` would zero `selectedStationIds` mid-build and **break multi-select** (verified).
**What:** extract three typed free helpers; have all 9 setters call them while keeping their explicit per-type clear literals inline. Touches only `store.ts`. The 179 green selection tests pin it.
**Payoff:** a dedupe/xor bugfix lands in one helper instead of three; the divergent clears stay visible and dumb.

### 6. Extract one `orbitPoint()` + `stepRotation()`; delete the redundant `rotateStationsAround` path — `impact: med · effort: M · risk: low`
**Why:** `rotateItemsAround` ([transforms.ts:446](src/model/transforms.ts:446)) copy-pastes the identical orbit body + `(rotation+1)%8` across all three branches; `rotateStationsAround` is a 4th near-copy kept alive only as a station-only fast path (still live at [StationView.tsx:474](src/components/StationView.tsx:474)) with no direct tests.
**What:** add `orbitPoint` + `stepRotation`; keep the three explicit branches (3 typed Records = essential dispatch) but have each call the helpers; delete `rotateStationsAround` and reroute `StationView`. Add 1–2 station-only tests _before_ deleting (that path is currently uncovered). Extract one `buildRotateMembers()` for the 3 copied call-sites.
**Payoff:** ~70 lines of orbit math → ~25; one rotate entry point instead of two.

### 7. Hoist `stripeOffset(k,n)` into one helper across all 8 sites — `impact: low · effort: S · risk: low`
**Why:** `(k-(n-1)/2)*STOP_SIZE` is a cross-module invariant — it _must_ agree between band paint, outline, label placement, layer-number labels, and three hit/drag paths or geometry silently desyncs. Verified at 8 sites across 6 files.
**What:** add `stripeOffset(k,n)` to `orientation.ts` (already home of `STOP_SIZE`) and route all 8 through it. **Drop** the bundled "centralize the transform string" half — the `*45` angle is already hoisted per-component, and 6 of those sites use atan2-tangent angles, not `rotation*45`.
**Payoff:** stripe geometry can't drift between the places that paint vs hit-test it.

### 8. Split the drag-lifecycle primitive + item-drag hook from line-tag drag (do NOT "unify all four") — `impact: med · effort: M · risk: med`
**Why:** two of four drag systems are inline refs in `MapCanvas` with a self-admitting comment ([:207](src/components/MapCanvas.tsx:207), [:222](src/components/MapCanvas.tsx:222)); the 4px-threshold/suppressClick/setPointerCapture/`setTimeout(0)` lifecycle is copy-pasted across 5 sites. But `useLineTagDrag` is a fundamentally different gesture (window listeners, `getScreenCTM`, rebuilds bands every move) with **zero** tests — forcing it under a shared signature is the leaky-abstraction trap.
**What:** extract `useDragGesture` (lifecycle only, 5 sites); lift the inline refs into a `useItemDrag` shaped like `useStationDrag`. **Before** landing it, add snap-path tests for bullet/label drag that don't hold Shift (current tests all bypass snap). **Drop** migrating `useLineTagDrag`.
**Payoff:** `MapCanvas` sheds the two apologized-for inline refs; the lifecycle dance lives once; the risky gesture is left untouched.

### 9. Extract `MapCanvas`'s 300-line highlight IIFE into `<HighlightedLineLayer>` — `impact: med · effort: L · risk: med`
**Why:** `MapCanvas` is the worst readability hotspot; the highlight block ([:1039–1344](src/components/MapCanvas.tsx:1039)) fuses triangle/arrowhead geometry, dim/matched compositing, and append-mode overlays with no name, props, or test seam. The proposal claimed this "depends on demoting SVG tests first" — that dependency is **fictional** (the attribute tests render child components, not `MapCanvas`).
**What:** extract _only_ the highlight IIFE into `canvas/HighlightedLineLayer.tsx` with explicit props + `data-*` hooks + a unit test for the dim/matched bucketing and triangle direction. Mirror the existing `LayeringOutlines`/`StationPlacingPreview` precedent. **Drop** the speculative `<Bands>`/`<Stops>`/`<Annotations>` split and the "MapCanvas < 400 LOC" target — those `.map()` passes are already readable; wrapping them just relocates code behind ~10-prop plumbing.
**Payoff:** the single most opaque block in the repo becomes a named, testable component.

### 10. Finish the field-resolver set at the genuine read-sites (no lint rule, no relocation) — `impact: med · effort: S · risk: low`
**Why:** "missing = default" is open-coded at scattered sites; resolvers exist for some fields and even those get bypassed (`resolveSegmentStyle` lives in [interlining.ts:132](src/geometry/interlining.ts:132) yet `LineInspector` re-hand-rolls `?? 'solid'` 3×). But ~half the cited `?? 0` sites are terms _inside_ the MAX-incident/consensus algorithms — wrapping those just adds cross-layer imports.
**What:** add `resolveOffsetPerp` and `resolveSegmentLayer` beside `resolveDotShape`; replace the genuine read-sites (and `LineInspector`'s three `?? 'solid'` with the existing resolver). **Do NOT** move `resolveSegmentStyle` out of geometry (model already imports geometry; the move inverts the arrow). **Do NOT** add the ESLint literal-ban (it misfires on switch arms, cycle tables, `DEFAULT_DOC`, fixtures). **Do NOT** touch the algorithm-internal `??` terms.
**Payoff:** each optional field's default lives in one named read fn.

---

## Quick wins (S-effort, do-this-week)

- Delete `SegmentStyleDivider.tsx` + the duplicate `DOT_SHAPES` (≈100+ LOC, zero behavior change). _(plan #3)_
- Centralize `SQRT2_2` → one `Math.SQRT1_2` (3 inline decls, two spellings).
- Merge the two identical atan2 8-way quantizers: delete `interlining.dirIndex8` in favor of `router.dirIndex` — **leave `autoOrient.tangentRotation` alone**.
- Fix the reorder-orphan bug (≈3 lines each in two mutators + a regression test). _(plan #4)_
- Delete `updateLine`'s unused `stations` patch branch (zero production callers).
- Have `legibleTextOn` ([util/color.ts:5](src/util/color.ts:5)) call the existing `parseHex` instead of re-implementing hex expansion.
- Hoist `stripeOffset(k,n)` and route the 8 sites through it. _(plan #7)_
- Export `ALIGN_CYCLE`/`VALIGN_CYCLE` from `transforms` and derive `LabelAlignButtons`' tooltip maps from them, killing the second source of truth that makes the tooltip lie if the cycle reorders.
- Mechanically move `useSelection` + `UiMode` out of `store.ts` into `state/selection.ts` (already has a `selection.test.ts` with no SUT); drops `store.ts` to ~480 LOC, no behavior change.

## Ambitious bets (the big swings worth making)

- **Tests first.** Direct `redistributeBetween` tests + serialize round-trip property + bullet/label snap tests that don't bypass snap. The prerequisite that makes every geometry/drag refactor safe. _(plan #2)_
- **Extract the `MapCanvas` highlight IIFE** into a named, prop-driven, `data-*`-hooked `<HighlightedLineLayer>` with the first-ever test of its triangle/dim/matched geometry. _(plan #9)_
- **Split the drag system honestly:** a `useDragGesture` primitive + a `useItemDrag` for x/y items, explicitly leaving the divergent, untested `useLineTagDrag` alone. _(plan #8)_
- **Pin one layering direction:** delete the duplicate `Rotation` type (keep `model/types` as the single home) and verify acyclicity. **Skip** the unbuildable "geometry cannot import model" ESLint gate and the uninstalled-`madge` pre-pr wiring — six geometry files legitimately import model types, and `npx madge --circular src` already reports clean.

---

## Do NOT touch (genuinely good — resist the urge)

A brutal review still names what works. These were examined and the refactors **rejected**:

- **The pure `(doc) => doc` transform layer.** ~50 of ~69 functions are exactly the "dumb-as-rocks" setters you want. **Do not** do the geometry/commands 3-way carve — the seam isn't clean (`flipStation` → `mirrorLabel`, shared private `CELL_EPS`/`sameCell` straddle both buckets). At most extract a `constants.ts`.
- **The normalized `MapDoc`, `DOC_FIELDS`, and `pickDocSnapshot`** — the strong data-model spine. **Do not** generate the store mutators from transforms (the one outright-**dropped** proposal): it trades flat, greppable wrappers for a runtime binder + novel `Tail<Parameters>` mapped types + dual skip/override lists, and adds an unguarded reference-stability invariant that zundo depends on.
- **The `UiMode` discriminated-union state machine and its orthogonal pan/tool axis.** **Do not** fold pan into `UiMode` — pan must coexist with every editor mode (it's a product, not a sum), the orthogonality is a tested invariant, and `spaceHeld`'s transient nature would re-add the variable the proposal claims to remove.
- **`snap.ts` as a whole** — the densest, best-commented, most-tested geometry file. **Do not** do the full `collectCandidates`/`solveSnap`/`buildGuides` carve (it promotes a function-local type to public API and threads 6+ params) or the `SnapRequest` discriminated-union rewrite (~96 call-site churn for documentation-only payoff).
- **`polygonUnion.ts`** — never failed (2 commits, 0 bug fixes), and its merged silhouette _is_ the visible feature (two rects leave a seam on stroke layers). **Do not** rewrite it.
- **The fast-check model-invariants test and the dense core unit suites** — the asset that makes everything else refactorable. Expand it; don't demote it. **Resist** the urge to mass-demote SVG-attribute tests as a "prerequisite" — git history shows `StationView` was rewritten across 8 PRs without its tests blocking it.

---

## Appendix — all 29 proposals & verdicts

The challenge phase produced **1 drop** and **28 modifies** (many scoped down hard). `worth` = the skeptic's net "worth doing as written" judgment.

| # | Proposal | Verdict | Worth as-written | Where it landed |
|---|---|---|:---:|---|
| 1 | One geometry kernel (vec + frame + direction8 + lint) | modify | ✅ | **Plan #1** — minus `frame.ts` & the lint gate |
| 2 | Fix model↔geometry layering + circular-dep gate | modify | ✅ | **Ambitious bet** — cycle claim was FALSE; dedupe `Rotation` only; no madge/lint |
| 3 | Unify all four drag systems | modify | ❌ | **Plan #8** — split honestly; leave `useLineTagDrag` |
| 4 | Decompose `MapCanvas` (thin shell + layers) | modify | ✅ | **Plan #9** — only the highlight IIFE |
| 5 | Decompose `StationView` (9-way dispatcher) | modify | ✅ | Deferred — valuable but XL; do after #2/#9 set precedent |
| 6 | Selection factory + `clearedSelections` routing | modify | ❌ | **Plan #5** — free helpers only; routing breaks multi-select |
| 7 | Extract `useSelection` into `state/selection.ts` | modify | ✅ | **Quick win** — mechanical move |
| 8 | `setOrOmit` default-write helper | modify | ❌ | Skip — the 6 shapes differ enough; complexity is essential |
| 9 | Field-resolvers per optional field | modify | ✅ | **Plan #10** — read-sites only; no relocation/lint |
| 10 | Structural prune-after-adjacency | modify | ✅ | **Plan #4** — inline the prune; no universal funnel |
| 11 | Unify the two migration paths | modify | ❌ | Scope to just de-duping the `labelBold→labelWeight` rule |
| 12 | Unify rotate-around onto `orbitPoint` | modify | ✅ | **Plan #6** |
| 13 | Delete dead/duplicate inspector UI | modify | ✅ | **Plan #3** |
| 14 | Decompose `LineInspector`'s 280-line IIFE | modify | ❌ | Deferred — real but lower-priority than #9 |
| 15 | Declarative `<Field>`/`useDocField` binding | modify | ✅ | Promising — but L effort; start with the `NumericFieldRow` ×3 dedupe + `ALIGN_CYCLE` export |
| 16 | Adopt `usePopover` in the 3 hand-rolled popovers | modify | ✅ | Good med-effort cleanup; bundle the `Toolbar.onSave` 18-field-list fix |
| 17 | `<Badge>` + `<StyledTextBlock>` primitives | modify | ❌ | Deferred — real duplication but med-risk; pairs with #18 |
| 18 | Inject `textMeasure`; collapse em/px round-trip | modify | ❌ | Deferred — purity win, but touches snapshot tests; do behind #20 |
| 19 | Demote ~85–250 SVG-attribute tests | modify | ❌ | **Rejected as a "prerequisite"** — history shows it never blocked rewrites |
| 20 | `redistributeBetween` + property-test coverage | modify | ✅ | **Plan #2** — the keystone |
| 21 | History adapter around zundo internals | modify | ❌ | Deferred — real coupling, but med-risk; do if you bump zundo |
| 22 | `resetStores()` + serializer-backed `seedDoc()` | modify | ✅ | **Quick win** — test hygiene; also replaces the weak `MapCanvas.warning` test |
| 23 | Generate store mutators from transforms | **drop** | ❌ | **Dropped** — trades greppable wrappers for scary mapped types |
| 24 | Carve `transforms.ts` by seam | modify | ❌ | **Do not** — seam isn't clean; at most extract `constants.ts` |
| 25 | Fold pan/hand into `UiMode` | modify | ❌ | **Do not** — pan is orthogonal (product, not sum) |
| 26 | Decompose `snap.ts` into phases | modify | ❌ | **Do not** — promotes private types; ~96 call-site churn |
| 27 | Extract band-radius math + replace `polygonUnion` | modify | ✅ | Take the **radius-extraction half**; **do not** rewrite the union |
| 28 | Centralize station-transform string + stripe-offset | modify | ✅ | Take the **stripe-offset half** (Plan #7); transform string already hoisted |
| 29 | Move clipboard logic out of `App.tsx`; reuse `parseHex` | modify | ✅ | Small clean extraction + a quick win |

---

## Suggested sequencing

1. **Quick wins** (a day): #3, `SQRT2_2`, atan2 merge, reorder-orphan fix, `updateLine` branch delete, `parseHex` reuse, `stripeOffset`, `ALIGN_CYCLE` export, move `useSelection`.
2. **Safety net** (the keystone): #2 — `redistributeBetween` tests + serialize property + snap-path tests.
3. **Mechanical consolidations** behind the net: #1 (geometry kernel), #5 (selection helpers), #6 (orbit), #10 (resolvers).
4. **The structural fix:** #4 (prune-after-adjacency).
5. **The one god-component seam:** #9 (`<HighlightedLineLayer>`), then #8 (drag split).
6. **Then reassess** the deferred medium bets (#15, #16, #27-radius, `StationView` split) with fresh eyes.

_Everything in "Do not touch" stays put._
