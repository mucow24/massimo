# Inner strokes → region painting — design (Aug 4 2026)

> Replace the per-line "Inner strokes" control (the branch-seam subsystem: `seamColor` /
> `seamWidth` / `seamEdges`) with the region-painting system: make a line's self-overlaps
> (branch mouths, loop crossings) real, clickable overlap faces, painted per junction in
> Layering mode like any other overlap. Written against main @ 5f45192 (post-#441, worker
> pipeline default-on). Every file:line below was verified against source this session.
> Companion inventories (agent reports, this session): seam deletion sites, Layering-mode UI
> flow, styles/persistence coverage — folded in below where load-bearing.

## 0. The idea, one paragraph

The region system already handles "two same-color cased lines overlap; pick whose casing shows"
— the user built branches that way before branches existed (two lines + a moved/hidden stop
dot), and painted them with the existing tool. A real branch renders identically; the ONLY
reason it isn't paintable is that `buildLineBodies` unions each line into ONE polygon before
the pairwise-overlap pass, erasing self-overlap (lineRegions.ts:209-251, union at :247). The
design: partition each line's edges into **arms** at its branch junctions (reusing the seam
system's junction classifier), feed the region pipeline per-arm bodies for same-line pairs
only, let the resulting faces flow through the EXISTING cover/anchor/winner/hole/UI machinery
with a widened winner type, and delete the entire seam render/model/UI surface. Defaults are
unchanged everywhere: an unpainted branch mouth stays merged (today's look), and a map with no
branches/loops produces byte-identical output.

## 1. Current state (what exists, and the one wall)

**The seam system** (deleted by this design): per-stripe `'seam'` render pass in SegmentBand
(:164-215) drawing edge-centered strokes clipped to the line's OTHER band corridors
(SeamClips.tsx), gated per line by `seamEdges` ∈ both/straight/curved via `band.seamArms[k]`,
which `assignSeamArms` (interlining.ts:824-886) bakes at band-build time from junction
topology: at each (line, station), band-ends pair into through-runs (opposition score, ties by
summed straight run, `OPPOSITION_TIE`), leftovers are branches. Fields covered by line styles
(seamEdges REQUIRED in LineStyleProps); persist v23 baked the retired doc-level field.
The current editors already fuse seam width/color to the casing's (LineInspector.tsx:342,
:371, :398-400; StyleEditor.tsx:291, :330-345), so independent seam styling is UI-unreachable
today — deleting it deletes nothing reachable.

**The region system** (extended by this design): bodies per line → pairwise zone parts
(`pairParts` keyed `a|b`, regionIncremental.ts:433-478) → polytree components → per-component
`restrictBodiesToZone` → `subdivideCells` (cover accumulation, generic over id strings) →
`extractFaces` (cover ≥ 2 gate at :780; span computation keyed `${lineId}|${pairKey}` at
:508) → `finalizeFaces`. Assignments `{id, lineId, lines[], anchors[]}` bind corridor-first
(`anchorCorridorOk` tests `face.spans.has(`${lineId}|${pairKey}`)`, :1182-1188) — the binder
ALREADY discriminates at edge granularity, and `anchors[]` already tolerates two same-line
anchors with different pairKeys. Winners resolve per face (assignment's line, else
lineOrder-front-most); holes are built ONLY for faces with a bound non-default assignment
(`overridden`, :1491-1496), keyed per loser line, applied as one clipPath per line that each
stripe/marker renderable individually references (MapCanvas.tsx:1468-1483 — there is NO
per-line group; the clip id is resolved per renderable). Zero assignments + Layering mode off
⇒ the pipeline never runs (`needRegions`, MapCanvas.tsx:500-502).

**The wall**: `buildLineBodies` unions per line, so cover ids are distinct-line sets and a
branch mouth is a 1-cover cell, dropped at extractFaces:780. Everything else is ready.

## 2. The design

### 2.1 Arms (the splitter)

`assignSeamArms` reshapes into `assignLineArms` (same file, same call site interlining.ts:763,
same junction bookkeeping): instead of reducing the through-run pairing to a per-stripe
straight/curved verdict, keep the PAIRING and union-find the line's bands into **arms** —
bands glued iff paired as a through-run at a shared junction. Output: per band-stripe, the arm
index of that stripe's line, baked as `SegmentBandSpec.arms: number[]` (replacing
`seamArms: SeamArm[]`; per stripe, parallel to `lines`, same as today). Properties:

- A line with no branch junction (every station degree ≤ 2 for it) = ONE arm. No self parts,
  no new faces, zero change. This is what keeps plain corners face-free: arms only split at
  degree-≥3 junctions, so same-line pairs never include two sides of an ordinary bend.
- A branch junction: through-run glues (trunk continues as one arm), each leftover branch is
  its own arm. A self-crossing AT a station (4 ends, two through-runs) = two arms — the X
  becomes paintable.
- Arm indices are canonical per build (order arms by smallest contained pairKey) but are
  NEVER persisted — persistence speaks pairKeys (2.4).
- Determinism: arm assignment is a pure function of the line's own band geometry + its own
  end-set per station, all of which already feeds `hashUnits`. Any topology or angle change
  that can flip a pairing dirties the line's units first. Belt AND braces: mix the stripe's
  arm index into its unit hash in `hashUnits` — today's comment "seamArms … moves no ink of
  its own, so it stays out of hashUnits" (interlining.ts:104-106) inverts: arms now move ink.
- The reuse layer already value-compares the field (`BAND_SPEC_FIELDS`/`bandSpecEqual`,
  interlining.ts:226-288): rename the entry, keep `'compared'`.

### 2.2 Self parts (the new zone-part source)

In `buildZoneCached`'s pair loop (regionIncremental.ts:433-478), after the `i<j` pairs, add a
per-line SELF entry for every multi-arm line, keyed `` `${id}|${id}` `` in the SAME
`pairParts` map (impossible today, so no collision; `changed`/`removed`/`partHome`/seed
splicing are generic over the key). Content:

    selfParts(L) = ⋃ over arm pairs (i<j) of intersect(armStripeRings_i, armStripeRings_j)

- **Stripe rings only — markers excluded.** Marker footprints at the junction belong to the
  line, not an arm; including them would manufacture phantom self-cover (and the golden
  fixture — the two-line workaround with the hidden dot — is marker-free at the junction, so
  stripe-only is also what byte-parity demands). Arm ring groups are the same
  `stripeBodyPolys(band, k)` outputs `buildLineBodies` already collects, grouped by
  `band.arms[k]` instead of unioned across the line; `unionAll` per arm for the intersect
  operands and `bodyMask` rejects.
- Reuse: gated on `dirtyLines.has(id)` exactly like a pair entry (both "sides" are the line).
- Whole-line `bodies` stay EXACTLY as today for inter-line pairs — no change to any `a|b`
  entry, its caching, or its dirty-reach logic.

### 2.3 Covers: slice ids, collapsed outside self-overlap

Within a component whose zone includes `L|L` parts (partHome tells you), `restrictBodiesToZone`
replaces L's single entry with its per-arm entries, ids `` `${L}#${armIdx}` `` (SliceId).
`subdivideCells` needs no change (generic over id strings). After cell extraction, **collapse**:
for each line in a cell's cover, if only one of its arms is present, rewrite the slice id back
to the bare line id. Results:

- Faces with no self-overlap keep EXACTLY today's cover ids, keys, spans, and (in components
  untouched by self parts) today's bytes.
- A pure self face covers `[L#0, L#1]`; a mixed face (another line crossing at the mouth)
  covers `[L#0, L#1, B]`.
- Components NOT containing L's self parts keep using L's whole-line body — restriction is
  component-local, so the no-branch map is byte-identical by construction, and a branchy map
  changes bytes only in components that genuinely gained geometry.

Type: `CoverId = LineId | SliceId` (branded string), with `lineOfCover(id)` /
`armOfCover(id)`. `RegionFace.lineIds` becomes `CoverId[]` — every consumer is enumerated in
§2.8.

### 2.4 Winner domain and persistence

Per-face winner candidates = **distinct lines of the cover** (each meaning "this line, arms
merged" — today's semantics) **plus each slice present in the cover**. Runtime winner type:
`{ lineId, armIdx? }`. Rules:

- `regionDefaultWinner` is LINE-domain everywhere EXCEPT a pure self face spelled as arms: an
  unpainted mouth defaults to the BRANCH ARM in front (`makeDefaultWinner` — fewest band-ends
  at the junction the arms share; smallest arm number on a branch tie; all-through crossings,
  edge-spelled covers and multi-line faces keep the front-most line). Holes therefore build for
  assignment-free default winners too. MERGED is a stored choice, not the resting state: a
  single-line assignment with no `winnerPairKey` (reconcile keeps born-single assignments,
  dropping only covers SHRUNK to one line).
- `regionClickAction` cycle order: distinct lines by lineOrder (today's order), then slices
  (by line z, then arm index), stepping from the ON-SCREEN default. Landing back on the
  default deletes; landing on merged stores.
- **Persisted schema**: `RegionAssignment` gains ONE optional field, `winnerPairKey?: string`
  — present iff the winner is an arm; it is the pairKey of the winner-slice's own minted
  anchor (so it is always also present in `anchors`). `lines[]` stays DISTINCT LINE ids
  (dedup slices at mint) — legacy sanitizer rules (winner ∈ lines, all live) hold verbatim.
  `mintAnchors` iterates cover entries; for slices it restricts the span scan to span keys
  whose pairKey's arm matches, so a self face mints TWO same-line anchors with different
  pairKeys — which pass-1 binding already treats as "the face must run BOTH corridors"
  (`anchorCorridorOk`), pinning the face with zero binder changes. `bindAssignments` needs
  only cover-mask normalization (`maskOf`/`facesByLine` index by `lineOfCover`).
- Winner resolution at render: slice = the arm of the bound face's cover whose pairKeys (via
  `band.arms`) include `winnerPairKey`. Unresolvable (hand-edited file, stale key) degrades
  to the merged-line winner — never a crash, never a wrong clip.
- `sanitizeRegionAssignments` (serialize.ts:1819): accept `winnerPairKey` as
  string-or-absent, drop non-strings; deliberately NOT validated against edges (same
  philosophy as anchor pairKeys, :1814-1816 — reconcile translates).

### 2.5 Reconcile

`reconcileRegionAssignments` (regionReconcile.ts:162-296) needs two touches: (1) step 0
translates `winnerPairKey` through the same edge split/heal mapping `translateAnchor` uses;
(2) step 4's remint re-derives it — winner slice in the NEW build = the arm containing the
translated key; new `winnerPairKey` = that slice's fresh anchor's pairKey. A vanished branch
arm leaves the assignment unbindable → existing dormancy/merge steps apply unchanged. Step 2
split-inheritance and `translatedCoverCompatible` compare in the line domain via
`lineOfCover`.

### 2.6 Holes and clips

`makeHoleContext.contributionFor` (lineRegions.ts:1425-1489) generalizes:

- **Losers**: today `cover lines above the winner in z` (:1431-1433). Add: when the winner is
  a slice, its SIBLING slices of the same line are always losers (same z; both paint orders
  must clip). When the winner is a merged line, its own slices are never losers.
- **Operands**: `paintNear(lineId, …)` gains an optional arm filter — stripes of the arm only
  (`band.arms[k]`), markers only for line-level losers/winners. An arm winner's cased
  footprint = its own arm's silhouette (rails revealed across the mouth — the identical
  "bridges-over" reveal the inter-line path produces, proven by the two-line workaround).
- **Output keying**: `Map<HoleKey, Ring[]>` where HoleKey = `lineId` (line-level loss —
  today's shape, unchanged for every existing map) or `` `${lineId}#${armIdx}` `` (arm-level
  loss). The packed worker codec's index widens the same way (holes-only payload discipline
  unchanged; faces still never cross mid-drag).
- **Render**: `RegionExcludeClips` emits one def per HoleKey; an arm def's content = that
  line's line-level holes ∪ the arm's holes (an element references exactly ONE clipPath).
  `withExcludeClip` (MapCanvas.tsx:1468-1483) resolves per renderable: stripe → arm key if a
  def for it exists, else line key; marker → always line key. This is an id-mapping change at
  the one existing site — the paint tree already wraps per renderable, no restructure.
- **Cache** (`buildExclusionHolesCached`): `inputSig` strings gain the winner arm and the
  slice-loser set; everything else (dirty-reach, neighbor sig, sliver gates) is untouched.
  `holeCache.test.ts`'s byte-pin extends to self-face scenarios.
- Slivers: `RegionSliver.lineIds` becomes `CoverId[]`; the absorb gate's "every above-winner
  line is already a loser" test normalizes through `lineOfCover`.

### 2.7 UI (Layering mode)

`RegionModeOverlay` renders whatever faces exist — self faces appear as click targets with no
component change (`data-line-ids` now prints slice ids; cosmetic). `regionPaintPlan` /
`regionClickAction` / `regionSetAction` widen to the winner domain (§2.4).
`regionFloodTargets`: legality for a line target = cover contains any cover-id of that line
(normalize); for a slice target = cover contains that slice (naturally confines a flood to
the arm's own overlap faces); walls compare in the widened domain. Flooding never crosses
between the two domains. Everything else (banner, fade, hover halo, hit-testing, one-undo
`assignRegions`) is untouched.

### 2.8 The cover-id consumer checklist

Compile-time enforced where typed (`CoverId` brand), grep-verified for string keys:
`extractFaces`/`pushFace`/`addSliver` (cover propagation — no logic change), `computeSpans`
(cover set membership — normalize to lines; spans stay `${lineId}|${pairKey}`),
`finalizeFaces` (key join — strings, fine), `mintAnchors` (§2.4), `bindAssignments` (masks +
facesByLine normalize), `anchorCorridorOk` (unchanged), `regionDefaultWinner` (line domain),
`regionClickAction`/`regionSetAction`/`regionPaintPlan` (§2.4), `regionFloodTargets` (§2.7),
`resolveRegionWinners` (widened winner), `makeHoleContext`/`buildExclusionHoles`/cached
(§2.6), `RegionSliver.lineIds`, `reconcileRegionAssignments`/`translatedCoverCompatible`
(§2.5), `sanitizeRegionAssignments` (§2.4), `RegionExcludeClips`/`regionExcludeClipId`/
`withExcludeClip` (§2.6), `RegionModeOverlay` `data-line-ids` (cosmetic), worker codec index
(§2.6), `regionCache` (types only — sig is doc-side, unchanged).

## 3. What gets deleted (and what survives)

Deleted wholesale: SeamClips.tsx (+test), InnerStrokesPicker.tsx, SegmentBand's seam pass
(:164-215) + `pass='seam'` + `SEAM_EPS` z-slot + the `'seam'` renderable kind,
HighlightedLineLayer's seam pass (the `passes` param collapses), the three `Line` fields +
`SeamEdges` type + the ~10 lineStroke.ts helpers, the three transforms + store actions, the
LineInspector rows/wiring + StyleEditor rows/fusion, the three LineStyleProps fields
(seamEdges is REQUIRED — removal must be ATOMIC across `captureStyleProps`,
`stylePropsEqual`, `canonicalStyleProps`, `stampStyle`, `sanitizeStyleProps`, or
`pruneDanglingStyleRefs` mass-detaches tagged lines on file load), `bakeDocSeamEdges` + the
v<23 gate (repointed to strip), `sanitizeLineStroke`'s seam branches (replaced by explicit
strip-unknown-keys), fixtures' `seamEdges`/`seamArms` entries, and the seam test inventory
(two whole files + ~10 seam-only describe blocks + ~15 mixed edits — full file:line list in
the session's deletion-inventory report; ARCHITECTURE.md sections listed there too).

Survives, relocated: the junction classifier (through-run pairing, opposition scoring, summed
straight-run tiebreak, the Broad Channel case) — as `assignLineArms`' pairing core. Its
straight/curved LABELING dies; its pairing IS the arm partition.

Persistence: bump zustand persist `version` 24 → 25; v<25 gate strips `seamColor`/`seamWidth`/
`seamEdges` from lines and line-style defs (precedent: `stripLegacySegmentLayers` at v<15,
serialize.ts:1793-1810, wired on both paths). File path: parse's rebuild sanitizers already
drop unknown def keys; add the explicit line-field strip in `sanitizeLineStroke`'s successor.
NO synthesis of assignments from old seam settings — the branch-arm DEFAULT stands in for
them: an unpainted junction renders with the branch arm in front (the old "Branch" look), so
upgraded maps come back looking like themselves; only non-Branch seam modes need repainting.
`.perf/mta-v23.massimo.json` / `docs/wand-gallery.massimo.json` need no edits (parse drops).

## 4. Behavior changes, edge cases, accepted losses

- **Per-junction instead of per-line**: each mouth paintable individually; new branches start
  with the branch arm in front (paint to merge or to flip the arm). Styles no longer carry
  branch appearance. (Accepted; per-area control was the point.)
- **'both' (the full notch) is gone** — winner-per-face cannot draw both edges. (Accepted.)
- **Uncased/custom-color seams are gone** — were UI-unreachable already.
- **Mid-edge self-crossing within one arm** (P-shape): invisible to arms alone; covered by
  the band-pair rule, which is IN SCOPE (stage 3, §7). Crossings AT stations work (two arms).
- **Near-tangent mouths**: a wedge that erodes away under `SLIVER_ERODE` (0.15) falls into
  the sliver pool like any hairline face — same class as existing tangency behavior.
- **Byte identity**: no-branch maps byte-identical. Branchy maps: components that gain self
  parts can merge with neighboring inter-line components → face keys/bytes shift there;
  anchors rebind corridor-first; visual output for existing assignments unchanged.
- Layering-mode clicking a pure self face in PR1 (before PR2's winner domain) cycles a
  1-line domain → plan empties → no write. Harmless intermediate state.

## 5. Performance

Idle: `needRegions` gate unchanged — zero assignments + mode off ⇒ nothing runs. Steady
state: self parts are per-line entries with the same reuse discipline as pair entries;
recompute only for DIRTY multi-arm lines (a handful of small ribbon intersects, mask/bbox
rejected). Faces grow by one small component per branch mouth. All off-main-thread mid-drag
(worker, #441); the synchronous commit path pays the same marginal cost. Arm grouping/unions
≈ the same ring volume the line union already pays, partitioned. Measure before/after on the
MTA v3 map (drag near a painted junction + the `.perf` harness's interleaved A/B rule) in
PR2; expected: noise.

## 6. Test plan (red-first)

- **Golden parity (the cornerstone, PR1)**: the user's three-station construction — L1
  S1→SM, L2 S1→(bend)→SB, same color, dot moved+hidden — versus the SAME shape as one real
  branching line. Assert identical face geometry (rings, areas, spans modulo cover-id
  spelling). Red first: the branch version currently yields zero faces.
- Splitter unit tests: corner (2 ends) → one arm; branch (3) → two arms glued through;
  station X-crossing (4) → two arms; Broad Channel same-axis fork → summed-run tiebreak
  (port the existing assignSeamArms cases from interlining.seam.test.ts before deleting).
- No-junk invariant: a multi-corner single-arm line yields ZERO self faces.
- Byte-identity: no-branch map ⇒ `buildOverlapRegions` + holes byte-equal pre/post (extend
  the existing reference-equality doctrine).
- Winner/cycle/flood: pure self face cycles merged→arm0→arm1→delete; mixed face cycles
  lines-then-slices; flood of an arm target confined to the mouth; landing default deletes.
- Holes: arm winner reveals its rails at full width across the mouth (compare against the
  two-line construction's holes byte-for-byte — hidden-dot fixture makes this exact);
  sibling-arm loser clipped both z-directions; cached path byte-equals reference
  (holeCache.test.ts extension).
- Binding/reconcile: two same-line anchors pin the mouth through a junction drag; edge split
  at the trunk translates `winnerPairKey`; deleting the branch edge → dormant then deleted;
  undo/redo round-trips.
- Sanitizer: winnerPairKey round-trip, junk-drop, degrade-to-merged on unresolvable.
- Persist v25: seam fields stripped from lines + defs on BOTH load paths; tagged lines stay
  tagged through the strip (the mass-detach trap test).
- e2e: paint a branch mouth in Layering mode, assert the mainline casing crosses (existing
  region e2e patterns; PORT per worktree); export PDF with a painted mouth and eyeball in
  Edge (clip-based, same class as existing region clips).

## 7. Staged landing — ONE PR, four commits (user decision, Aug 4)

One PR on this branch; each stage below is a commit (or a small commit train) that leaves the
tree green (`npm run pre-pr`). The band-pair rule lands BEFORE the deletion so there is never
a window where the P-shape look is unreachable.

1. **Commit 1 — arms + faces** (no winner changes): junction pairing extended to emit arm
   indices (`SegmentBandSpec.arms`, seamArms kept alongside until commit 4), hash mix, self
   parts, slice covers + collapse, golden parity + splitter + no-junk + byte-identity tests.
   Branch mouths appear as (inert) Layering-mode faces.
2. **Commit 2 — paintable**: winner domain, `winnerPairKey`, mintAnchors/bind normalization,
   holes + def splitting + `withExcludeClip` mapping, worker codec key widening, cycle/
   flood/plan, sanitizer + reconcile, perf A/B. Feature-complete; seam still coexists.
3. **Commit 3 — band-pair rule**: admit same-line band pairs sharing no station as self
   parts (catches mid-edge P-shape crossings). Slices already speak pairKeys; the admission
   predicate + per-band hole keys are the whole change.
4. **Commit 4 — the nuke**: full deletion inventory, persist v25 strip, atomic style-field
   removal, ARCHITECTURE.md rewrite (sections listed in the inventory), test pruning.

## 8. Decisions (resolved Aug 4)

1. Band-pair rule IS in scope (commit 3, before the deletion).
2. Migration is strip-and-repaint: no auto-synthesis of assignments from seam settings;
   existing seamed junctions come back merged and get repainted by hand.
3. Mixed faces get the full widened cycle (lines first, then arm slices).

## 9. Adversarial pass — what was challenged, what held

- *"Just split real Lines into pseudo-lines"* — rejected: line identity feeds selection,
  stops, labels, styles, exports; blast radius unbounded. Slices stay inside the pipeline.
- *"Per-band bodies everywhere, no arm concept"* — rejected: marker ownership junkifies
  every shared station, and covers/keys/assignments would churn on EVERY face of a branchy
  line; arm collapse preserves today's identities except where self-overlap is real.
- *"Winner as armIdx"* — rejected: build-local, unstable. pairKey is the persisted spelling
  (already the anchor identity; reconcile already translates it).
- *"seamArms stays out of hashUnits" doctrine* — inverted deliberately (arms now move ink);
  purity argument says the mix is redundant, mixed anyway as insurance.
- *Corner junk faces* — structurally impossible (arms don't split at degree-2 stations), and
  pinned by the no-junk test rather than trusted.
- *Hole-cache byte drift* — the cached path's signatures gain arm identity; the pin test
  extends; an unverifiable chain still flushes (existing over-invalidation doctrine).
- *Sliver-dropped mouths* — real but bounded: SLIVER_MIN_AREA (0.02) is dust; erosion-class
  tangency behavior is unchanged from the inter-line case.
- *Worker payload bloat* — none: holes-only discipline unchanged; only key strings widen.
