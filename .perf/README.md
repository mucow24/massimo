# Drag-performance harnesses

Benchmarks for the station-drag hot path. **Nothing in here runs in CI or in any
`npm` gate** — `lint`, `format:check`, `test`, `build` and `e2e` are every one of
them scoped to `src/` or `e2e/`, so this directory is invisible to them. It is
carried in the repo because the previous optimization run's harnesses were left
untracked and died with their worktree, and rebuilding them cost more than the
optimization did.

## The map

`.perf/mta-v23.massimo.json` is committed — a 464-station, 29-line NYC subway
drawing, and the one every number below was measured on. It is the single
exception to the "no maps in the repo" rule (see .gitignore): the harnesses are
worthless without a real drawing's crossing density, and a result that cannot
be re-checked after a fix is not much of a result.

Harnesses pick it up automatically. To measure a different one:

```bash
export PERF_MAP=.perf/other-map.massimo.json
```

Other `.perf/*.massimo.json` files stay gitignored, so dropping one in here is
still the path of least resistance. Every harness fails with this instruction
if no map resolves, rather than with a stack trace.

Numbers below were taken on a 464-station, 29-line drawing of the NYC subway.
Anything much smaller will not reproduce them.

## Running

Geometry only — fast, low-noise, the trustworthy instrument:

```bash
PERF=1 npx vitest run -c .perf/vitest.bench.config.ts --disableConsoleIntercept
```

One harness at a time, with `-t 'per-frame drag cost'` to pick a test.

Browser, production build (run `npm run build` first):

```bash
PORT=5234 npx playwright test -c .perf/playwright.perf-prod.config.ts
```

Typecheck the harnesses after refactoring the geometry they reach into — they
import deep internals on purpose, and nothing else will tell you they have
rotted:

```bash
npm run perf:check
```

## What's here

| file | what it answers |
| --- | --- |
| `bench/dragPerf.perf.test.ts` | per-frame geometry cost by phase, plus the no-op CONTROL |
| `bench/clipAttribution.perf.test.ts` | every clipper call attributed to its source line |
| `bench/maskEquality.perf.test.ts` | byte-exactness gate: faces + winners + holes over a drag |
| `bench/maskSpike.perf.test.ts` | occupancy-mask and dirty-reach census |
| `bench/zoneLocality.perf.test.ts` | is the zone union going global or local this frame |
| `bench/bodyStats.perf.test.ts` | how big line bodies are and how little of one changes |
| `bench/chunkExact.perf.test.ts` | the chunked-body negative result (keeps it from being re-proposed) |
| `bench/chunkSpike.perf.test.ts` | chunk census and pair-intersect cost |
| `bench/marshalling.perf.test.ts` | toInt / clipToPaths / fromInt split |
| `e2e/perf-drag.spec.ts` | real-drag browser cost. `PERF_NO_REGIONS=1` isolates the render floor; `PERF_KEEP=n` trims the map to test tree-size scaling |
| `e2e/perf-drag-age.spec.ts` | paint-time staleness: how far (ms, px) the painted station trails the cursor, and post-stop convergence (travel paints, settle time), pipeline on vs off. `PERF_SNAP=1` runs the real per-event snap; `PERF_POPOVER=1` drags with the popover open; `PERF_SPEED`, `PERF_EVENTS_PER_TICK` scale cursor speed and input rate. Run it against `playwright.perf-dev.config.ts` too: the dev server is where the pipelined arm goes STALER than sync (Aug 2026 finding), and a prod-only run hides that |
| `e2e/perf-profile.spec.ts` | CDP CPU profile, bucketed by file and function |
| `e2e/perf-ab.spec.ts` | in-page interleaved A/B of a toggleable change |
| `e2e/perf-aging.spec.ts` | does a session get slower the longer it is edited, and which quantity grows. `PERF_PLANT_LEAK=1` proves the instrument; the RESET test says which reload-equivalent gives the time back. **Has never produced a valid run** — see below |
| `bench/wasmHeap.perf.test.ts` | does the clipper's wasm heap climb across a long session, and does frame time climb with it |
| `bench/wasmAttribution.perf.test.ts` | which clip.ts call the heap growth happens during — read its header before believing the answer |
| `bench/intersectLeak.perf.test.ts` | replays real `intersect` arguments — WRONG ANSWER, kept as a negative; read its header |
| `bench/wasmLive.perf.test.ts` | live bytes vs free: settles leak against high-water mark. The one that broke the case open |
| `bench/opLeak.perf.test.ts` | attributes LIVE growth per operation — this is the one that found the leak |

## Read this before trusting a number

**The CONTROL in `dragPerf` is not decoration.** It asserts that a frame moving
nothing is far cheaper than a drag frame. If that ratio collapses, the
incremental chain is not live and every other number in the run is a cold
build. Three of this harness's ancestors were wrong before they were right —
one measured drags that never engaged (a hub move gets snapped back, so a small
oscillation is invisible in the DOM), one tiled post-union bodies where one ring
IS the whole body, and one built "masks" from ring bboxes, which for a
whole-map body is exactly the bbox it was meant to refine. Each reported a
confident, wrong answer. Keep the gates.

**Run `perf-aging` with `PERF_PLANT_LEAK=1` before believing a clean run.** A
leak harness that has never been seen to go red is not evidence that there is
no leak — it is no evidence at all. The planted leak accretes painted nodes in
the composited pan layer, which should move `svgNodes`, CDP `Nodes`, and the
pan-start stall together. If it does not, the instrument is broken, and a flat
table from it means nothing. Its other gate is the undo depth: if that does not
climb across rounds, the aging gestures never committed and the run is six
measurements of the same state — it fails rather than printing a flat table.

**`perf-aging.spec.ts` has never produced a valid run.** It is kept for its
structure and for four instrument bugs already fixed in it — gestures
dispatched at the svg root that engaged nothing, a station that walked off its
own hit point, a `warning-toasts` overlay silently intercepting every press,
and a cold first drag that swamped the trend. Its last run still failed its own
engagement gate at 69%. It fails loudly rather than printing a flat table, so
it will tell you; do not treat any number it has produced so far as evidence.

**The browser harness has 25%+ run-to-run variance, worse under load.** Never
compare across runs. Rebuild and re-measure both arms in the same session, take
several rounds, and treat anything under ~1.3x as unresolved. `perf-ab.spec.ts`
interleaves within one page for changes that can be toggled at runtime — but
note that the region pipeline carries an incremental cache, so interleaved arms
contaminate each other's state and both get slower. For geometry, prefer the
node harness.

## The session-aging question (Aug 2026)

Reported symptom: after an hour or two of editing a complex map, station drags
fall to a few fps and a reload cures it; panning stays smooth once started but
the click-to-pan-start gap grows.

What the harnesses above establish:

- **The geometry pipeline does not degrade.** 3000 constant-size frames on the
  464-station map: frame time 72.6 -> 75.9 ms (1.05x). Whatever is slowing the
  drag in a long session, it is not the region/interlining math getting slower.
- **The clipper's wasm heap grows without bound.** 19 -> 207 MB over those same
  3000 frames (10.7x), +87 MB in the second half alone, and it never comes
  back — an emscripten heap only ever grows. Roughly 60 MB per 1000 drag
  frames.
- **It is a REAL LEAK, not fragmentation.** `wasmLive` measures live bytes as
  heap minus what the allocator can hand back (probe validated at 94% free on a
  fresh heap). Live bytes go 0.3 MB -> 71.1 MB over 1200 frames, climbing
  linearly at ~59 KB per frame. Memory is being retained, not scattered.
- **All of it is `splitIntoFaces`: 340 bytes per call.** `opLeak` replays every
  clip.ts operation on its real arguments and measures live growth. Every other
  operation is exactly 0.0 bytes/call. `splitIntoFaces` is the only caller of
  `clipToPolyTree`.

Two earlier answers to this question were WRONG, both from watching heap SIZE
instead of live bytes. `wasmAttribution` charged 100% to `intersect` — heap
size only moves when free space runs out, so it names the biggest allocator
whatever the truth is. `intersectLeak` then "cleared" intersect by replaying
16,000 calls and seeing no movement; at tens of bytes per call that is well
under the probe's resolution against a heap with 15 MB free. Both harnesses are
kept, with headers saying what they cannot answer.

**OPEN: the exact upstream line, and the fix.** Reading js-angusj-clipper 1.3.1
(the current release), `PolyNode.fillFromNativePolyNode` abandons embind
handles — the `childs` vector, and one per child from `childs.get(i)`, passed
on with `freeNativePolyNode = false`; the author's own comment there reads "do
we need to clear the object ourselves? for now let's assume so (seems to
work)". That is code reading, NOT a measurement. `polyTreeFix` tried to
confirm it by freeing those handles and crashed, but that crash is ambiguous
between "the handles are owning" and "the Proxy broke embind", so it settles
nothing.
- **In the browser, nothing else grows.** Over ~1100 station drags: DOM nodes,
  `<defs>`, clipPaths, CDP `Nodes`, `JSEventListeners` and the JS heap were all
  flat. The wasm heap went 16 -> 83 MB.

NOT established: that the wasm growth is what the user feels. At 200 MB it
costs nothing measurable. The open hypothesis is memory pressure at multi-GB
sizes — which an hour of dragging would reach at 60 MB per 1000 frames — where
every fresh allocation (drag frames, and the pan-start layer raster, which is
exactly the pan symptom) gets slow while an already-composited pan stays
smooth, and a reload frees it instantly. Confirming that needs a run long
enough to reach GBs with drag cost sampled throughout.

See `RESULTS.md` for what has been measured, what shipped, and the four ideas
that were built and thrown away.
