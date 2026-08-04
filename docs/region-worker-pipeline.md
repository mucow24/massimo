# Pipelined region worker — design mapping (Aug 3 2026)

> The design document the implementation followed — a map of how the thing works, with every
> discovered gotcha named and resolved or registered. Written against main @ 5a202c0
> (post-#416/#437); the implementation lives in `src/worker/` + `src/state/renderDoc.ts` and is
> summarized at the doc's altitude in ARCHITECTURE.md ("Pipelined drags"). Companion
> measurements: `.perf/RESULTS.md`. The iGPU raster attribution the text below calls PENDING was
> resolved before implementation began: the iGPU machine is compute-bound (pan ~74fps), so no
> raster workstream was needed.

## 0. The idea, one paragraph

During a geometry-writing drag, a persistent Web Worker owns a warm mirror of the region
pipeline (its own clipper WASM, its own incremental state, its own hole cache). Per frame the
main thread sends it a tiny position delta; the worker computes the frame's exclusion holes
and posts them back; the main thread renders frame N−1 — strokes, dots, labels, clips, all
from ONE lagged doc-slice snapshot — while the worker computes frame N. Every painted frame
is internally exact (clips and strokes from the same geometry, computed by the same engine,
byte-for-byte what the synchronous path would produce for that geometry); the map simply
trails the cursor by one compute-frame, which it already does today — in jumps instead of
smoothly. At pointerup the pipeline drains and everything converges through the EXISTING
synchronous commit machinery, untouched.

**Constraint compliance:** no freeze, no throttle, no level-of-detail, no deferral of
exactness — each frame is the exact arrangement of its snapshot. No hysteresis — frames are
pure functions of their snapshots. WYSIWYG — the drained final frame is the committed doc.
The vetoed failure modes (clips tearing off strokes; mid-drag diverging from the drop) are
structurally impossible: clips and strokes always come from the same snapshot, and the last
snapshot IS the drop.

## 1. Why this is the right lever now (measured)

Current main, 464-station drawing, node geometry per drag frame (this session):
Atlantic ~81ms, Canal ~77, Times Sq ~53, Union Sq ~36, **a 2-stop leaf ~64** — the geometry
wall is everywhere now, not just hubs. Render floor ~25-30ms (post-#416; W5 proved it is
child reconciliation + native paint, not React element cost). Frames are therefore
sum-of-two-walls: ~60-110ms prod.

Pipelining changes the frame period from `G + R` to `max(G, R) + messaging`:

| station | today (G+R) | pipelined | ratio |
|---|---|---|---|
| Union Sq | ~61ms | ~38ms | 1.6× |
| Times Sq | ~79ms | ~56ms | 1.4× |
| leaf (Halsey) | ~91ms | ~66ms | 1.4× |
| Atlantic | ~112ms | ~84ms | 1.3× |

The throughput ratio is the *smaller* half of the win. The larger half is **liveness**: the
main thread never blocks longer than the render floor, so input processing, hover, popovers,
sidebar and the cursor itself stay responsive — the difference between CHUG and
smooth-but-trailing. On a slower CPU both walls inflate proportionally; the ratio holds and
the liveness win grows. (What this does NOT fix: raster cost on a weak GPU — pending the
iGPU measurement — and the absolute size of G: a hub mid-drag caps near ~12fps, up from ~9.)

Also in scope of "why now": the perf panel's wasm-heap-only-grows counter. A worker makes the
geometry engine's heap disposable — an idle worker restart resets it without a page reload.

## 2. Architecture

### 2.1 Two variants considered; A chosen

**A — lagged render source (chosen).** Doc writes stay exactly as today (`moveStation` etc.
per frame, `deferPersist` groups, reconcile at commit). Only what the canvas READS changes:
mid-drag it renders from a lagged doc-slice snapshot paired with the worker's matching region
output. Confined to read paths; all gesture semantics, undo, persist, reconcile untouched.

**B — live-gesture store (rejected for now).** The pan-spine pattern taken literally: per-frame
positions live outside the doc; the doc is written once at commit. Philosophically cleanest
(rollback becomes "discard"; deferPersist becomes unnecessary) but it re-routes every mid-drag
mutator — including semantic ones like `bindStationToCircle` firing when a ring captures a
station mid-drag — into frame-space reimplementations. That is where its cost explodes.
Registered as the from-scratch shape, not the retrofit.

### 2.2 The pieces (variant A)

1. **`regionWorker.ts`** (new, `src/worker/` or beside regionCache): a thin `onmessage` shell
   over a pure `computeFrame(workerState, msg)` module. Owns per-worker copies of the module
   state that today lives main-side: clipper instance, `lastIncremental`-equivalent, the
   exclusion-hole cache with its WeakMaps. The whole compute chain is verified DOM-free and
   store-free (purity audit, agent report §5.3), so it runs unmodified.
2. **A doc mirror**: the worker holds the committed geometry slice
   (`{stations, lines, lineCircles}` + `lineOrder`, `regionAssignments`, and the per-line
   rail widths it needs to rebuild `railWOf` — functions don't cross). Kept warm by a small
   main-side subscriber that posts committed changes (commit boundaries only, not per-frame;
   payload = the changed records). Warm mirror ⇒ drag arming is instant, no cold build.
3. **`useDragFrame`** (new, tiny zustand store or plain module + subscription): the in-flight
   frame slot. `null` at rest. Mid-drag holds
   `{ doc: LaggedSlice, holes: HolePayload, guides: SnapGuide[], seq }` — one coherent frame.
4. **The render-source swap**: a real store, `useRenderDoc` — not inline
   `dragFrame ?? live` composition. Two reasons (amendments 2 and 6): (a) while a drag frame
   is armed, live doc writes must cause ZERO canvas renders — the render source
   equality-bails until a new worker frame lands, or the per-input no-op render at 60-125Hz
   eats the liveness win the design exists for (doc writes continue per pointermove;
   coalescing covers sends, not writes); (b) `stopMetricsOf` is a module-constant selector
   with a one-entry content cache and no way to pass a slice in — the render source must be
   subscribable by the same selector machinery, or the cache thrashes and re-renders ~1000
   station components, undoing #416's W1. At rest `useRenderDoc` IS the live doc
   (`Object.is`-equal selections, zero overhead). Mid-drag it serves the lagged doc-slice —
   all SEVEN towed collections (stations, lineCircles, polygons, svgImages, routeBullets,
   textLabels, transferAnchors), since group drags mutate all of them.
   `regionGeom`/`regionExcludeHoles` mid-drag come from `dragFrame.holes` instead of
   calling `regionsFor`. Everything downstream — bands (via the identity-reuse layer, which
   is what makes rendering a snapshot cheap), markers, renderables, SeamClips,
   RegionExcludeClips, warnings — just works, because it all flows from that one fix-point.
   **Arming needs no seeded hand-off**: freezing the render source at the current slice
   also freezes the canvas's own region memos, which keep serving that slice's synchronous
   holes until the first RESULT lands — doc-slice and holes resolve from one source in
   every frame bar none, with nothing to seed and therefore nothing to get wrong.
5. **Live-read leak migrations** (the audit's ~8): each one moves a component from "reads the
   store directly" to "reads the same source MapCanvas renders from" — generalizing the
   AnchorLayer precedent (which already takes all three records as props and is the one layer
   that needs no change):
   - `useStopMetrics` (useStopMetrics.ts:37): select via the render source, not the live doc
     — kills the audit's latent tear #3 (a `continues` bit flipping one frame early).
   - `lineCircles` live reads in StationDots/HitArea/Silhouette/Label/OrientationArrows/
     TransferLayer/TransferSelectionOutline: thread as props from MapCanvas (mechanical; the
     AnchorLayer shape) or read the render-source hook.
   - `StationInspector` x/y fields (StationInspector.tsx:79-88): subscribe to the render
     source so the number never leads the picture (decision, not accident — audit #5). Its
     stop rows (StopRows.tsx:166) get the same treatment: a mid-drag ring capture changes
     stops/rotation, so they can lead a frame too.
   - `WarningToasts` (WarningToasts.tsx:31): reads stations live for names only — visually
     benign, but it re-renders per mid-drag write; migrate with the rest.
   - `SelectionPopover`: reads six collections live but its output is position-independent —
     verified benign, no change.
   - Sidebar: already decoupled (renders no positional field). No change.
6. **Snap guides ride the frame** (the audit's one guaranteed tear): `useStationDrag` computes
   guides at input time N as today, but instead of `setSnapGuides` immediately, the guides are
   attached to frame N's submission and surface only when frame N renders. The halo ring then
   always encircles the dot it belongs to.
7. **Drain on EVERY gesture exit** (amendment 3 — `finishDrag` is NOT the only exit): all
   five hooks' cancel paths call `history.rollback()` directly, and `beginHistoryGroup`'s
   steal-on-begin can seal a leaked group outside `finishDrag`. Disarm — clear `dragFrame`,
   bump the generation, resync the mirror — hooks into commit AND rollback AND the steal,
   or a canceled drag strands a stale frame over a reverted doc. On a normal release the
   drained render equals the final worker frame's snapshot for slow, careful drags (trail
   ≈ 0 — the lifeblood case); a release while moving fast snaps forward by the trailing
   distance, which today's synchronous path does not do (registered as downside #2). The
   existing commit machinery (reconcile via `regionsFor(old)` LRU hit + `regionsFor(new)`
   rebuild, one history entry, persist flush) runs untouched.

### 2.3 Protocol

Depth-1 pipelining with latest-wins coalescing:

```
main → worker  SYNC     { changed geometry records }   (one mechanism, two cadences)
worker → main  RESULT   { gen, seq, holes: packed }    (applies as dragFrame)
```

- **One diff mechanism, not per-hook deltas** (adversarial-review amendment 1+4): main keeps
  a `lastPosted` geometry slice; `syncMirror()` identity-diffs the current slice against it
  and posts the CHANGED RECORDS whole (stations, lineCircles, lines — records are small).
  Mid-drag that runs at frame cadence (this IS the frame message); at rest it runs on every
  non-transient doc change and is re-verified on arm, never assumed warm. Deriving the
  payload from the slice rather than from what each hook thinks it wrote is what makes
  ring-capture correct by construction: `bindStationToCircle` mid-drag changes `circleId`,
  rotation and stop cells — sig-hashed geometry no position-delta schema can express — and a
  radius resize reprojects N bound stations in one call. The diff sees all of it because the
  records changed, no matter who changed them.
- Main sends frame k+1 only after RESULT k arrives (natural backpressure); pointermoves
  between sends coalesce to the latest state — identical to today's event coalescing.
- `gen` is a gesture-generation stamp, `seq` a frame counter: a RESULT from a previous
  generation — including the in-flight last frame arriving AFTER pointerup drained the
  pipeline — is dropped, not applied (amendment 3).
- **Payload discipline** (agent report §6): faces NEVER cross mid-drag (UUID-string bloat
  makes them ~1MB/frame; nothing renders them mid-drag — layering mode is never concurrent
  with a station drag). The drag payload is holes only: ~500 rings packed as one
  transferable Float64Array + a small index (`lineId → ring offsets`) ≈ 150-300KB,
  transferred (zero-copy), ~1ms end-to-end. `regionClipOuter` is recomputed main-side from
  local bands (free). Winners/faces stay worker-side entirely.
- Error envelope: worker exceptions cross as `{kind, message, stack}` (structured clone
  demotes Error subclasses — agent report §6.2).

### 2.4 Arming policy and fallback

- Pipeline arms only when: `needRegions` AND a deferPersist geometry gesture is open AND the
  last synchronous frame cost exceeded a threshold (~30ms, self-calibrating). Small maps and
  regionless maps keep today's fully-synchronous path — zero regression there.
- All five per-frame geometry gestures are covered by the same arming site (they share the
  dragFrame submission): station drag, line-circle move/resize, and the three group-drag
  hooks that tow stations/circles (item/polygon/svg — agent report §3.4).
- Layout drag writes once at pointerup — never pipelined. Keyboard nudges are discrete —
  synchronous. Layering mode — synchronous (needs faces + click services; never mid-drag).
- **Fallback**: worker error, RESULT timeout (>2× expected frame), or wasm-load failure ⇒
  disarm, clear `dragFrame`, resume the synchronous path on the next pointermove. One-frame
  snap-forward, no data loss (the doc was always live). The synchronous path is never
  deleted — it remains the reference, the fallback, and the at-rest path.

### 2.5 Convergence and the caches

Mid-drag, main does no region builds: its `lastIncremental` and hole cache idle at the
pre-drag state; the LRU keeps the pre-drag entry (the `transient` machinery already
guarantees this). At commit, `regionsFor(new)` pays one real incremental build whose dirty
delta is the whole drag, plus the hole-cache flush and a full render: ~50-120ms on a hub.
Be honest about what this is: **new cost, not today's cost relocated** — today's commit
build seeds from `lastIncremental` already advanced to the final frame by the transient
mid-drag builds, so it is a warm near-no-op (~15-20ms). The pipelined design trades ~60-80
blocking frames per drag for one release-time hitch; if the hitch reads badly on the flag
build, the specced mitigation is the worker shipping its final state. The hole-chain identity check
sees the break and flushes to a full hole rebuild — over-invalidation, never staleness
(existing behavior). The worker's mirror then syncs from the COMMIT message and both sides
are warm again.

Worker lifecycle: booted at the first deferPersist gesture on a map with assignments (so
spawn + wasm compile + the full-slice sync overlap the gesture's cheap early frames), and
terminated/recreated across fallbacks and the kill switch. Its wasm heap only grows for
the session; a restart policy (idle timer, or a heap bound via the dev handle) is a
registered follow-up, not shipped.

## 3. The four questions, answered

### How major is the surgery?

**Comparable to one of the July workstreams (M-to-L; roughly one to two focused weeks), with
no research-grade risk.** The compute chain runs in a worker unmodified (verified pure). The
new code is: the worker shell + protocol/lifecycle (~300-500 lines), the mirror subscriber,
the dragFrame store, the render-source swap (one binding + six collections), ~8 small
live-reader migrations, the guide buffering, arming/drain/fallback in the drag hooks, and the
test suites. Nothing in the geometry engine, the caches, the reconcile, undo, or persist
changes. The riskiest single item is the render-source swap's completeness — and the audit
is the checklist that de-risks it.

### Clean fit or permanent hack?

**Clean fit, with two honest permanent complexities.** The pattern generalizes the repo's own
committed-vs-live doctrine (viewport spine: committed camera in one store, in-flight in
another; pan never writes the doc per frame). The audit shows the render tree is already
90% coherent-by-construction from one fix-point, and each live-reader migration makes an
implicit invariant explicit (AnchorLayer is the existing example of the target shape). The
permanent costs to own honestly: (1) two warm copies of region state with a commit-time
convergence step — reasoned about once, tested forever; (2) a protocol/lifecycle module —
new infrastructural surface with failure modes. Neither is a hack; both are real second
moving parts.

### Better or worse than expected, perf-wise — the signs

Better-than-expected signs:
- Every station class benefits now (the leaf is 64ms of geometry) — July's version of this
  idea would have helped only hubs.
- The identity-reuse layer (July) makes lagged-snapshot rendering cheap — bands rebuild
  main-side at ~6ms with full memo retention. This design gets cheaper BECAUSE of the
  earlier optimizations, the reverse of the usual premise-eaten story.
- The liveness win is not in the frame-rate arithmetic at all: today's worst chug is input
  starvation (a 100ms block queues 6-12 coalesced events); pipelining bounds main-thread
  occupancy at the render floor.
- Worker restart gives a free fix for session-long wasm-heap growth.

Worse-than-expected risks:
- postMessage/structured-clone on the potato CPU — budget ~1-3ms; the packed-transferable
  codec caps it; MEASURE on the iGPU machine before believing it.
- The pointerup hitch (one frame's geometry) lands exactly when the user expects crispness;
  if it reads badly, the mitigation (worker ships its final state) is real work.
- If the iGPU attribution shows a material raster share, pipelining's ceiling on that
  machine is the raster wall, not the render floor — the ratio shrinks. (Pan fps on the
  iGPU is the discriminator; pending.)
- Dev-mode StrictMode double-invocation around worker lifecycle effects — dev-only care,
  standard cleanup discipline.

### User-visible downsides and regressions — the register

1. **Cursor trail**: the map trails the pointer by one compute-frame (~40-85ms at speed).
   Not new — today's latency is identical — but today it trails in jumps; pipelined it
   trails smoothly, which reads as "following" rather than "janking". Honest change of
   character, same magnitude.
2. **Pointerup hitch** ~50-120ms while the cold-seeded commit build + hole flush + full
   render run — NEW cost vs today's warm ~15-20ms commit (see §2.5), traded against ~60-80
   blocking frames per drag. A fast-moving release also snaps forward by the trailing
   distance (today's synchronous path renders the final move before pointerup processes, so
   it does not). Judged on the flag build; mitigation specced if felt.
3. **Any unmigrated live reader leads by one frame** — the audit's list is the checklist;
   after migration, expected residue: none known.
4. **Rare worker-failure snap-forward** (one frame) — fallback artifact, logged.
5. **Memory**: a second wasm instance + mirror (~20-40MB) — bounded by restart policy.
6. **Battery/thermals**: two busy threads instead of one alternating — real but small; the
   same total work, overlapped.

## 4. Testing strategy (the byte-exactness doctrine, extended)

- `computeFrame` is a pure function unit-tested WITHOUT a real worker: drive the same frame
  sequences through it and the synchronous path; assert holes byte-equal (describeHoles
  pattern). Same-engine determinism makes this exact, not approximate.
- Protocol pins: seq ordering, latest-wins coalescing, stale-drop, fallback-on-timeout —
  simulated shell tests.
- The audit's accidental invariants get pinned: hover-chrome-clears-on-capture (audit #6),
  guides-ride-the-frame, inspector-reads-render-source.
- e2e: real worker, prod build — drag scenarios asserting final doc + final DOM equal the
  synchronous path's; a kill-the-worker-mid-drag fault-injection spec; and a MID-DRAG
  coherence probe — one same-rAF DOM read asserting the dragged dot's position, the
  exclusion-clip path near it, and the snap-guide halo all resolve from one snapshot — with
  the probe proven able to go red by temporarily reverting one live-reader migration (the
  suspect-the-probe rule; final-state equality alone cannot see a mid-drag tear).
- Spike S1 (before anything else): clipper WASM instantiating inside a Vite `type: 'module'`
  worker in dev AND prod build under `base: './'` (GH Pages subpath) — the one packaging
  unknown (agent report §5.5). One day; if it fails, the design stops here.

## 5. Staged landing

1. **S1** wasm-in-worker spike (day). Go/no-go.
2. Live-reader migrations + guide buffering, SHIPPED SYNCHRONOUSLY FIRST (they are
   correctness hygiene with zero behavior change today — and they make the later swap a
   one-binding diff). Each is small and independently testable.
3. Worker shell + mirror + dragFrame + swap, behind a dev-handle flag; A/B in the perf
   harness (interleaved, per the ledger's method rule).
4. Fallback/lifecycle hardening; fault-injection e2e; flag default-on.
5. `.perf/RESULTS.md` entry + ARCHITECTURE.md sections in the landing PR.

## 6. Open questions

1. **iGPU raster share — RESOLVED (Aug 3, measured on the machine in Hybrid-iGPU mode).**
   Pan 73.9 fps, idle 234 fps on the full 464-station map: the iGPU composites the retained
   SVG at full speed, so raster is NOT the wall. Drags: Times Sq 68.3ms (14.6fps), Atlantic
   94.9ms (10.5fps), a 1-stop leaf 65.8ms (15.2fps), with ~28 long tasks per drag averaging
   61-91ms — the chug is pure main-thread blocking, exactly what pipelining removes. No
   raster workstream needed; the plan's projections apply to this machine as-is (pipelined
   period ≈ max wall ⇒ roughly 15-25fps with a never-blocked main thread, vs 10-15fps with
   60-90ms freezes today).
2. Packed-holes codec vs plain structured clone: measure first on the potato; plain Maps may
   already be under budget.
3. Pointerup-hitch tolerance: judge on the flag build; mitigation (final-state shipping)
   specced only if felt.
4. Whether the mirror should also serve LAYERING-mode clicks someday (worker-side
   regionPaintPlan) — out of scope; layering is never mid-drag.
5. Logged S-sized follow-up independent of this plan: incrementalize the winners bind
   (rebind only assignments touching dirty faces) — ~5-8ms off the geometry wall on both
   the worker and synchronous paths. Real, ~1.1×, not a substitute for pipelining.
