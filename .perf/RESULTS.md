# Station-drag perf: what landed, what didn't

Aug 2 2026. Baseline `84613e2`. Measured on a 464-station, 29-line drawing of
the NYC subway (393 region assignments, 530 bands, 999 markers, 392 faces,
world box 2405 x 2850). See README.md for how to run any of this.

## The shape of the problem

The frame is TWO walls of comparable size, which is why no single change
reaches 2x. Emptying `regionAssignments` turns the region pipeline off
entirely, and what remains is a **flat 42-46ms** — the same for a one-stop leaf
as for a nine-line hub. Geometry is 63-77% of the frame; React/DOM/paint is the
rest. A control on the same map: idle 60fps, **pan 52fps**, so the retained SVG
tree composites at speed and the medium is not the problem.

Baseline, prod build, real drags: Times Sq 117.3ms (8.5fps),
Atlantic-Barclays 150.8ms (6.6fps), a one-stop leaf 95.4ms (10.5fps). Node
geometry only: 83.0 / 95.1 / 73.1ms, against a 14.8ms floor for a frame that
moves nothing (that gap is what the CONTROL asserts).

## Headline

**~1.3–1.6× on a hub drag, depending on machine load.** The plan going in
projected 2.1× from five workstreams; three of them turned out to be measured
negatives, and the projection had assumed they were independent. They were not:
two had their premise eaten by a workstream that landed earlier in the same
session. Re-measure a planned lever after each landing, not once at the start.

## Shipped

### W1 — stop-metrics subscription (render)

`useStopMetrics` subscribed to `stations` and is called from inside
`StationView`'s memo, so every pointermove re-rendered all 464 stations' hit
areas, labels and silhouettes for byte-identical output. `stopMetricsOf` now
compares derived CONTENT under the existing identity cache and hands back the
same function; the hook selects the lookup rather than the slices so zustand's
`Object.is` can bail.

Regions-off render floor, prod, measured repeatedly:

| station  | before | after |
| -------- | ------ | ----- |
| Times Sq | 42 ms  | 25 ms |
| Atlantic | 46 ms  | 29 ms |
| leaf     | 45 ms  | 27 ms |

### W2 — body occupancy masks (geometry)

A line body is one whole-map polygon, so its bbox is ~26% of the world box and
every reject built on it is nearly inert. Masks of the cells a body actually
occupies replace those rejects, plus a cross-frame dirty-reach test.

| | before | after |
| --- | --- | --- |
| pair intersects, Times Sq | 163/frame | 60 |
| pair intersects, Atlantic | 194 | 71 |
| pair intersects, leaf | 22 | 4 |
| restrictBodiesToZone | 1366 | 470 |

Node geometry (the low-noise instrument): Times Sq 83.0 → 53.7 ms, Atlantic
95.1 → 82.9 ms.

## Measured negatives — reverted, do not retry without new evidence

### W3 — clipper integer cache

`toInt` was 30% of clipper time when measured on the whole-body pair workload.
Implemented (WeakMap per ring array) and it worked — 79-82% hit by call, 84-90%
by vertex — but delivered **nothing**: interleaved A/B in one process gave
0.909× (Times Sq) and 0.990× (Atlantic), i.e. neutral to slightly harmful.

W2 ate its premise. The whole-body operands the cache would have served are
exactly the ones W2 stopped issuing; what remains are small freshly-minted
intermediates inside `subdivideCells`, which are cache misses by construction.

### W4 — local zone union

Hub drags take the global union every frame (`zoneUnionParts` ≈ 1965, ~9-10 ms)
while a leaf takes the fast path. The gate is
`wantMembership = changed.size + removed.length <= 12`, and hubs sit at 17
(Times Sq) / 48 (Atlantic) changed pairs, so membership is never built — and
because no membership means no index, it is self-perpetuating.

The hypothesis was that W2 had made the changed set geographically tight enough
for the local splice to work. **It has not.** Forcing membership on: seeds come
out at 690-850 of an index of ~1460 — genuinely more than half the zone, so the
seed gate correctly falls back — and frame time gets much WORSE, because
maintaining the per-ring home index across 1451 components costs far more than
the union it avoids:

| station  | gated (shipped) | membership forced |
| -------- | --------------- | ----------------- |
| Times Sq | 52.9 ms         | 112.0 ms          |
| Atlantic | 80.6 ms         | 131.9 ms          |

The existing gate and the comment justifying it are correct. The ~9-10 ms
global union is not reachable by tuning; it needs the shelved sub-component
stitching.

### W5 — station-layer element identity

The render floor scales with tree size (60 stations 16.5 ms = vsync-limited,
150 stations 16.6 ms, 464 stations 25.5 ms), so per-station element caching
looked like the lever — React bails a child on reference identity, ahead of
`memo`'s prop compare.

Implemented and measured over three repeats per arm: **neutral.**

| | with W5 | without |
| --- | --- | --- |
| Times Sq floor | 26.6 ms | 25.4 ms |
| Atlantic floor | 29.9 ms | 30.5 ms |

`StationView`'s memo was already bailing, so the only saving was the jsx call,
the props object and the comparison — about 1,400 of each, and worth ~1 ms, not
the ~9 ms the tree-size slope suggested. That slope is React's child
reconciliation walk plus native DOM/paint over the tree, which element identity
does not remove.

## End-to-end

Interleaved A/B, six rounds, rebuilding each arm each round (the machine was
contended during this run, which inflates both arms and compresses the ratio):

| station  | BASE median | HEAD median | ratio |
| -------- | ----------- | ----------- | ----- |
| Times Sq | 132.5 ms    | 104.7 ms    | 1.27× |
| Atlantic | 168.6 ms    | 122.0 ms    | 1.38× |

Earlier, on a quiet machine, single runs measured Times Sq 117.3 → 74.2 ms
(1.58×) and Atlantic 150.8 → 98.3 ms (1.53×). Treat 1.3–1.6× as the range and
the ratio, not the absolutes, as the claim.

## What the remaining frame is made of

Times Sq, prod, roughly: ~25 ms render floor + ~50-75 ms geometry.

- The geometry remainder is the arrangement itself — `subdivideCells` and the
  global zone union — plus `extractFaces`' sliver morphology. W4 establishes
  that the union is not tunable; the honest next frontier is the shelved
  sub-component stitching or a sweep-line arrangement, both weeks of work.
- The render remainder is React child reconciliation plus native DOM/paint over
  a 464-station tree, which W5 establishes is not element-creation cost.
  Reducing the NUMBER of nodes (viewport culling) is the untried lever there,
  and it is not output-identical for export or hit-testing.

How to run any of this, and how not to fool yourself: see `README.md`.

## The pipelined worker (Aug 3 2026)

The two walls above stopped being summed. During a heavy geometry drag a
worker (its own clipper, its own incremental state) computes frame N's
exclusion holes while the canvas paints frame N−1 from one coherent lagged
snapshot; every gesture exit converges through the untouched synchronous
commit. Exactness is pinned byte-equal to the synchronous path
(`src/worker/regionFrame.test.ts`) and at the DOM by an e2e that replays
sampled mid-drag frames at rest and requires identical paint.

Interleaved A/B (`e2e/perf-pipeline-ab.spec.ts`), prod build, six block pairs
per station in one warm page session, this machine on the iGPU:

| station  | main-thread rAF off → on | ratio  | paints/s off → on |
| -------- | ------------------------ | ------ | ----------------- |
| Times Sq | 213.9 → 17.0 ms          | 12.6×  | 4.8 → 4.5 (0.95×) |
| Atlantic | 158.4 → 17.1 ms          | 9.3×   | 6.7 → 6.8 (1.02×) |
| Halsey   | 80.4 → 18.2 ms           | 4.4×   | 12.3 → 14.6 (1.19×) |

Read the two columns separately — the pipeline moves cost rather than
shrinking it. Visual cadence is parity-or-better: the map advances exactly as
often as the synchronous path could manage, because the same geometry is being
computed at the same rate, one thread over. The main-thread column is the
point: input processing sits at the display floor instead of blocking
80–214 ms per move, which is the difference between CHUG and
smooth-but-trailing. The off-arm medians run higher than the July quiet-dGPU
numbers (this is the slower machine, and the per-rAF probe includes event
dispatch); per the house rule, the paired ratio is the claim, not the
absolutes.

The flag (`__massimo.regionPipeline`) defaults ON; arming still requires
regions in play AND a mid-gesture synchronous build over ~30 ms, so small and
regionless maps never leave the synchronous path. The worker dying mid-drag
times out and falls back synchronously (e2e-pinned).

## The rubber band, measured — and the freeze's other half (Aug 4 2026)

The "dragging one end of a rubber band" feel got an instrument
(`e2e/perf-drag-age.spec.ts`): how OLD is each painted position (matched back to the dispatch
that produced it), how far behind the cursor in px, and how many travel paints after the cursor
stops. Findings, prod build, MTA map:

- **No queue anywhere.** Post-stop convergence is ≤2 paints in every scenario, both arms. The
  trail is a delay line — each paint shows the newest COMPLETED frame, sampled one
  geometry+render wall ago — so trail px = hand speed × (G+R), which is why fast flicks read
  worst (~250px at 1500px/s vs ~80px at 500px/s, identical age).
- **Prod was already at the design floor**: age on ≈ off (~100–190 ms), snap / open popover /
  3× input rate all no-ops. The pipeline changed the trail's CHARACTER (smooth follow under a
  live cursor), not its magnitude.
- **Dev had inverted**: the pipelined arm ran 1.29–1.64× STALER than sync (ages 263–338 ms med)
  with the main thread saturated (rAF med 115–159 ms) — because the freeze contract had a
  second half nobody enforced. Every pointermove re-ran MapCanvas (the drag hooks' live
  `stations`/`lines`/`lineCircles` subscriptions), re-sorted the sidebar's full 464-station
  list (unmemoized, per-compare name cleaning), and rebuilt the open popover from the live
  record (whose readouts also LED the frozen paint) — 60–125 times a second, for byte-identical
  output. W1's bug, five more times.

Fixed by making input hooks read the store at event time (no reactive subscriptions to the
seven towed collections) and pointing the position-independent chrome — sidebar, popovers,
editing banner — at the render source. Pinned by a zero-commits-while-armed test
(`MapCanvas.renderSource.test.tsx`). Paired same-run A/B after the fix:

| dev, snap on         | before (on-arm)      | after (on-arm)      |
| -------------------- | -------------------- | ------------------- |
| rAF med, Times Sq    | 147 ms               | 17 ms               |
| rAF med, Atlantic    | 151 ms               | 17 ms               |
| age ratio on/off     | 1.29–1.64×           | 0.85–1.11×          |

Prod: unchanged (already leak-tolerant at 60Hz input — the ~8 ms/event tax fit in the slack),
which is exactly why the leak survived the prod-only A/B above. Run the dev config
(`playwright.perf-dev.config.ts`) before trusting any "no regression" claim about input-path
changes.
