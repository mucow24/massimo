# Performance and export harnesses

Benchmarks for the station-drag hot path, plus the export/PDF measurement
harnesses. **Nothing in here runs in CI or in any `npm` gate** — `lint`,
`format:check`, `test`, `build` and `e2e` are every one of them scoped to `src/`
or `e2e/`, so this directory is invisible to them. It is carried in the repo
because the previous optimization run's harnesses were left untracked and died
with their worktree, and rebuilding them cost more than the optimization did.

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

Both playwright configs point `testDir` at all of `.perf/e2e`, so a drag-perf run
picks the export harnesses up too (and vice versa). Name the spec, or filter with
`-g`, when you want one family:

```bash
PORT=5234 npx playwright test -c .perf/playwright.perf-dev.config.ts pdf-glyph-baseline
```

The export harnesses read their maps from `.perf/*.massimo.json` by filename —
`mta-v67d` and `furta-v34`, both gitignored — and `test.skip` themselves when the
file is absent, so a run without them is quiet rather than red. They also write
their results next to the maps as `.perf/*.local.json`. Never stage inputs or
results under `test-results/`: that is Playwright's `outputDir` and it is deleted
recursively before the first test of every run.

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
| `e2e/perf-gesture-start.spec.ts` | the gap BEFORE a gesture starts — hover, pan start (hand and middle), station press, alt+click deep-pick — measured with the Event Timing API on REAL mouse input, each gesture gated on the store field it is supposed to change. `PERF_PROFILE` adds a CPU profile per gesture, `PERF_TRACE` a renderer timeline (style/layout/paint/layerize), which is what you want when the CPU profile comes back empty |
| `e2e/perf-chrome-layer.spec.ts` | what a gesture's CHROME costs: `display` vs colour / `visibility` / `opacity`, on a sibling overlay and on a node inside the map svg, each with and without `will-change`. Every arm proves its mechanism is in force AND (for the painting ones) screenshots itself to prove the change reaches the screen. `CHROME_SVG_WHOLE=1` is the control for that proof; `CHROME_ROUNDS`, `CHROME_PRESSES` set the sampling |
| `e2e/perf-profile.spec.ts` | CDP CPU profile, bucketed by file and function |
| `e2e/perf-ab.spec.ts` | in-page interleaved A/B of a toggleable change |
| `e2e/perf-aging.spec.ts` | does a session get slower the longer it is edited, and which quantity grows. `PERF_PLANT_LEAK=1` proves the instrument; the RESET test says which reload-equivalent gives the time back. **Has never produced a valid run** — see below |
| `bench/wasmHeap.perf.test.ts` | does the clipper's wasm heap climb across a long session, and does frame time climb with it |
| `bench/wasmAttribution.perf.test.ts` | which clip.ts call the heap growth happens during — read its header before believing the answer |
| `bench/intersectLeak.perf.test.ts` | replays real `intersect` arguments — WRONG ANSWER, kept as a negative; read its header |
| `bench/wasmLive.perf.test.ts` | live bytes vs free: settles leak against high-water mark. The one that broke the case open |
| `bench/opLeak.perf.test.ts` | attributes LIVE growth per operation — this is the one that found the leak |
| `e2e/pdf-glyph-baseline.spec.ts` | PDF size + whole-token operator counts (`m l c f re W q Do`), each map measured as-is and with every station name / label blanked, so text's share of the output falls out of the diff. Tag a run with `PDF_BASELINE_TAG` |
| `e2e/pdf-glyph-parity.spec.ts` | rasterizes the exported **SVG** to raw RGBA at 2000px so two code versions can be diffed pixel-for-pixel. Tag with `PARITY_TAG`; a same-code control run must come back at 0 differing pixels or the instrument is lying |
| `e2e/pdf-raster-parity.spec.ts` | rasterizes the exported **PDF** itself via pdf.js — catches a fault svg2pdf introduces downstream of a correct SVG (glyphs misplaced by the form-object `cm`, clipped by a `/BBox`, or missing). Tag with `PDFRASTER_TAG`. Needs `npm i --no-save pdfjs-dist`, which is deliberately NOT a project dependency; skips without it |

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

**The dev machine is a laptop, and its CPU perf mode swings every number here.**
It is a Lenovo Legion, and its power mode (`quiet` / `balance` / `performance`)
changes CPU performance by a large factor. The mode is constant WITHIN a session
but varies BETWEEN sessions — so every number in a single run is mutually
comparable, and all the tables here are internally sound, but a figure carried
over from an earlier session must be RE-MEASURED before it is trusted or
compared against a fresh one. A 2x "regression" against a months-old number may
be nothing but a quieter power mode. The perf playwright configs stamp the mode
at the top of every run (`[perf] Lenovo power mode: …`, via a `globalSetup`), and
`powerMode.ts` reads it from Lenovo Legion Toolkit's CLI (`llt.exe feature get
power-mode`, needs LLT running with its CLI enabled; `unknown` anywhere that
does not hold, e.g. CI). The Windows power-overlay registry is NOT a reliable
source — it read "Best performance" while the real Legion mode was `quiet`.

## The gesture-start cliff (Aug 15 2026) — found and fixed

Every harness above measures the drag FRAME. The reported symptom was the gap
before a gesture starts, and nothing here could see it. On the committed
mta-v23 drawing, long-task ms, medians of 5:

| gesture | cap 256 | cap 5000 |
| ------- | ------- | -------- |
| hover a station | 531 | 0 |
| station press | 2045 | 131 |
| sweep then press | 2152 | 135 |
| alt+click a locked polygon | 3155 | 0 |
| pan start (hand, and middle) | 0 | 0 |

Pan start is on the list because it was the loudest complaint, and the cache had
nothing to do with it — it costs the same in both arms. What the user felt was
the hover storm fired by the cursor crossing stations on the way to the click,
which the press then queued behind.

That is not to say pan start is free. Timed properly (see the Event Timing
lesson below — the `0 ms` this table used to print for it was an absence, not a
measurement), a middle-press took **~87 ms** to reach paint against a 0.3 ms
control (same probe, same button, same page, the only difference being whether
the app arms a pan) and 0.5 ms probe floor. `longtask` is 0 throughout, so none
of it is main-thread JavaScript. What it is, and what was done about it, is the
next section.

Three instrument lessons, all paid for:

- **Synthetic events measure nothing.** The first cut dispatched
  `new PointerEvent(...)` and reported a flat ~15 ms for all four gestures. A
  synthesized `pointermove` fires no `pointerover`/`pointerenter`, so the hover
  never engaged, and a synthetic `pointerId` cannot be captured, so `startPan`
  threw. Real `page.mouse` input plus a per-gesture engagement gate is why
  `perf-gesture-start` reports numbers at all.
- **A gesture without a gate reports the wrong number, not no number.** The
  press gestures first ran a 3 px nudge and returned `true` for engagement. The
  nudge never crossed the drag threshold, so "press" measured a press that
  started no drag: 931 ms where the real figure was 2045 ms. Both press
  gestures now gate on the dragged station's position actually changing, and
  the gate was proved by setting the drag distance to zero — whereupon it goes
  red and the ungated arm cheerfully reports **0 ms**.
- **The Event Timing API is silent about events it does not consider
  interactions, and silence averaged as zero.** `handler ms` and `dur ms` came
  from `PerformanceObserver({type:'event'})`, which emits NOTHING for a
  middle-button press or a drag-style press — so `Math.max(0, ...entries)` over
  an empty list printed a confident `0`, and four of the six rows were
  unmeasured for three revisions while looking like the fastest in the table.
  Worse, the zeros corroborated a true story ("no JS in the handler; the cost is
  after it"), so they read as a finding. What caught it was building a SECOND
  instrument that disagreed — nothing in the first one could have.

  Latency is now timed by the page: a capture-phase window listener (which has
  no discretion about which events it sees) stamps `t0` before React's root
  handler, and `rAF -> setTimeout(0)` closes the interval after the next paint.
  The table prints a per-gesture SAMPLE COUNT and fails the run when a gesture
  produces none, on the same principle as the engagement gate — and every run
  reports the probe's own floor, so a number can be read against its noise.
- **An empty CPU profile is a result, not a dead end.** The sampling profiler
  charged 9 ms across 5 hovers while the long-task observer saw 744 ms — both
  true. The work was style/paint/compositing over a 16.7k-node SVG, plus GC, and
  only a renderer timeline (`PERF_TRACE`) shows it. That trace is what surfaced
  **2,144 `GetImageData` calls per alt+click, 1086 ms** of them.

The cause was `textMeasure.ts`'s measurement cache at `CACHE_LIMIT = 256`
against a working set of ~500 (one key per rendered label). A render measures
every label once in the same order, so past the cap the access pattern is a
cyclic scan and the hit rate is not merely low, it is ZERO. The cap had been
fine when a miss was two `measureText` calls; the ink raster probe made a miss
two canvas rasters plus two full `getImageData` readbacks, ~50× dearer, and the
cap was never revisited.

Cap swept on one build to locate the cliff, long-task ms (the press column of
this sweep predates the gate above and reads low; hover and alt+click locate it
unambiguously on their own):

| cap | hover | alt+click |
| --- | ----- | --------- |
| 256 (shipped) | 568-765 | 1414-1416 |
| 512 | 0 | 0 |
| 1024 | 51 | 0 |
| 2048 | 0 | 0 |
| 4096 | 51 | 0 |

The cliff is between 256 and 512 and the floor is flat above it — the working
set is the map's label count, and both drawings sat just over the old cap,
which is why it read as a property of whichever map was open. Shipped at 5000
for headroom; `src/geometry/textMeasure.cache.test.ts` holds both sides of the
number.

The residual ~131 ms on `station press` is compositing, not JavaScript (the CPU
profile is empty, `Layerize` / `PaintArtifactCompositor::Update` dominate the
timeline) — the pre-existing render floor, untouched by this.

### Gesture-start latency is `commits × nodes`, and the trigger is the lever

Once the measurement was honest, the shape fell out: press-to-paint is **linear
in painted SVG node count**, at ~3.8µs a node, and flat in what the gesture
actually does. Middle-press, one build, control (a press that arms nothing)
0.3ms at every size:

| stations | svgNodes | press -> painted |
| -------- | -------- | ---------------- |
| 30 | 1,392 | 6.3 ms |
| 60 | 2,201 | 8.8 ms |
| 120 | 4,330 | 17.1 ms |
| 250 | 9,288 | 36.5 ms |
| 464 | 15,073 | 55.6 ms |

The canvas is ONE composited layer, and Blink re-runs the compositing update
over the whole layer for any change inside it. So the cost is `commits ×
nodes`, and the cheap lever is not the node count (see the census below) but
whether a gesture triggers a commit at all. Pan start, paired, same map:

| | press -> painted |
| --- | --- |
| baseline | 49.1 ms |
| `will-change` held for the session instead of granted per press | 28.7 ms |
| `panning` moved out of React state (it re-rendered the whole canvas) | 22.2 ms |
| "grabbing" cursor moved off the svg onto a childless overlay | 7.6 ms |
| **SHIPPED** — the last two only, promotion left gesture-scoped | **21.7 ms** |

Each was isolated by ablation, not guessed. The cursor one is the surprising
one: it is not the class change (2.4ms with the class toggled and no rule
matching it) but the STYLE it applies — `cursor` is inherited, so a rule whose
subject is the map svg restyles all ~15k descendants. Moving the class to
`.canvas-host` does not help (same subject); a `display`-toggled overlay does
not either. Toggling `pointer-events` on an always-mounted childless overlay
does, because it changes neither box nor paint.

**The promotion row was measured on the OTHER side and rejected.** Holding
`will-change` for the session is worth ~14ms a press, but a permanently
promoted 4x surface is carried through every station-drag repaint. Interleaved
A/B on `perf-drag`, 12 rounds a side, rebuilding between arms, Times Sq:

| | drag frame med | fps | paired wins |
| --- | --- | --- | --- |
| held for the session | 19.3 ms | 51.9 | 2 of 12 |
| gesture-scoped (shipped) | **18.1 ms** | **55.4** | **10 of 12** |

~1.2ms on every frame against 20ms once per press: a three-second drag is ~165
frames, so it loses by an order of magnitude on volume. Sign test on the paired
rounds gives p≈0.04. Note the first four rounds alone pointed the WRONG way
(medians 52.9 held vs 50.5) — this harness's 25% spread eats a 5% effect at
n=4, and four rounds of it read as a clean refutation. Twelve was barely
enough.

The pan-start section left one question open: it closed with "any move-the-
chrome-to-its-own-layer plan has to promote that layer, and that is unmeasured."
The next section measures it. The answer is that promotion is not the lever.

### What costs a recomposite is the BOX, not the paint

`e2e/perf-chrome-layer.spec.ts`. The section above left one question open —
whether promoting the chrome to its own compositing layer would let hover,
selection and drag escape the whole-map recomposite, since unlike pan start
they genuinely change paint. It rested on reading the overlay's 22ms `display`
toggle as "a paint change re-composites the layer". That reading was wrong, and
the plan built on it does not work.

Eleven arms, each one way of making a piece of chrome appear, fired by a class
TOGGLE (`.perf-armed` on `.canvas-host`, flipped from JS) and interleaved in one
page. The trigger matters and is the lesson of this harness — see the note
below; a middle-press would confound the result on `main`. Timed class-add ->
paint, medians of 18, two runs, mta-v23, `performance` power mode:

| arm | vs baseline | what it does |
| --- | --- | --- |
| baseline (`pointer-events`, paints nothing) | 0 (≈4.8 ms abs) | the floor |
| `display` on the overlay — MOUNT a box | **+22 ms** | build a box |
| `display`, `will-change: transform` | +25 ms | " + promoted |
| `colour` / `visibility` / `opacity` on an always-laid-out ring | +1.5 ms | paint, outside the layer |
| the same repaint, `will-change: transform` | +3 ms | " + promoted |
| `opacity` on a rect INSIDE `.canvas-pan-layer` | +6 ms | paint, inside the layer |
| that rect, `will-change: transform` | +8 ms | " + promoted |
| `opacity` on a rect OUTSIDE the pan layer, in `.canvas-host` | +5 ms | paint, outside |
| `opacity` on ONE real `<path>` inside the map svg | +10 ms | paint a real map node |

Three things fall out, and the plan assumed none of them.

**Mounting is the whole cost.** Building a box (`display`) is +22ms; every way
of PAINTING a box that already exists is +1 to +10ms. So the lever is: keep the
chrome mounted and change its paint, never mount on demand — which is exactly
what React does by default.

**Promotion does nothing.** `display+layer` ≥ `display`, `sibling+layer` ≥
`sibling`, every pair. The promotion is real — CDP `LayerTree` reports 6 layers
unpromoted vs 11 promoted, checked per arm so a slow promoted arm cannot be
confused with a promotion that never happened — it just does not help.
`will-change` is not the lever and no amount of it will be.

**Leaving the pan layer buys almost nothing.** Painting inside `.canvas-pan-
layer` (+6ms) versus outside it in `.canvas-host` (+5ms) is a ~1ms difference,
inside the noise. A real map node is dearer (+10ms) because it drags a larger,
more complex repaint region with it, not because of the layer boundary. So the
"move the chrome out of the pan layer" idea — which needs the chrome re-
projected into screen space, since outside the layer it no longer rides the pan
transform — is not worth building. The single cheap win, **stop mounting**,
captures essentially all of it, and needs no re-projection.

**The trigger is the lesson.** The first cut of this harness fired each arm with
a real middle-press (a pan), and on `main` that reported the OPPOSITE: a flat
~31ms baseline with every paint arm at +0. The reason is `main`'s per-gesture
promotion — a middle-press promotes `.canvas-pan-layer` and re-composites it
wholesale (~21.7ms, the shipped pan-start cost), which ABSORBS the chrome paint
the harness is trying to isolate. That measurement was taken on the branch's
un-shipped base (which held `will-change` for the session, so a press promoted
nothing), and it did not survive re-measurement on `main`. A class toggle
promotes nothing, so it measures the paint in the layer's resting state — which
is the state hover and station-drag chrome actually paint into. Re-measuring
against the shipped code is what turned "two wins worth ~14ms each" into "one
win worth ~20ms and one worth ~1ms."

**Chrome carrying TEXT is a different conversion.** Always-mounting the
line-circle diameter chip — one `<text>`, hidden, at radius 0 — makes
`e2e/labelInkBox.spec.ts` destroy its execution context, reproducibly, and the
marquee conversion in the same commit does not. A `<text>` that is always
present participates in font readiness whether or not it is painted, and on an
otherwise text-free canvas that chip is the only thing asking for its face.
Bisected, not guessed: reverting only the chip turns the spec green with the
marquee change still in. Shape chrome and text chrome are not interchangeable
here, and the station hover chrome includes labels.

**What blocks the rest of it.** Converting a site needs the chrome to render
with no subject, and most of this chrome cannot: `SwapPreview` returns null
without a target, the hover rings each need their item, and the three station
hover sites are keyed `key={hoverStationId + ':hover-…'}`, which forces an
unmount and remount on every hover change by construction. Doing those needs a
retain-the-last-subject pattern plus dropping those keys, and the win is not
guaranteed, because a subtree whose node COUNT varies per subject is still
creating and destroying boxes when the subject changes. Measure per site rather
than assuming the ~22ms mount saving carries.

Every piece of gesture chrome in `MapCanvas.tsx` today is mounted on demand
INSIDE the svg, so each pays the ~22ms mount on every appearance (plus the few
ms of being inside the svg chunk rather than outside it):

| gate | what appears |
| ---- | ------------ |
| `hoverStationId` (three separate sites) | station hover chrome |
| `hoverBulletId`, `hoverLabelId`, `hoverPolygonId`, `hoverSvgImageId` | per-item hover chrome |
| `rectSelect.rect` | the marquee |
| `selection.altHeld && cursorWorld` | the alt-held deep-pick cursor |
| `circleDrag.resizingId` | line-circle resize handles |
| `guideDrag.pull` | the guide pull-out ghost |
| `inLayeringMode` (two sites) | region layering overlays |
| `layoutDrag.overlay` | the station layout drag overlay |

`SnapGuides` is mounted unconditionally in JSX but returns null while both its
lists are empty, so in DOM terms it is mount-on-demand as well — it pays when
the first guide of a drag appears.

All of this chrome is pointer-transparent, which is what makes moving it out
tractable: a layer over the map would otherwise have to choose between
swallowing every event beneath it and being unable to host anything
interactive. Station hover looks like an exception — its sites pass
`onStartDrag` — but the `wash` and `stroke` layers render a `StationSilhouette`,
which never takes the handler and is `pointerEvents="none"` throughout, and
`hover-arrows` renders orientation arrows with no handler at all. The prop is
dead weight at those three sites. `CircleDiameterLabel` is the one element with
no explicit `pointer-events`, so it needs one if it moves. If chrome ever does
need to be interactive on top, the selected-item drag proxies already solve it:
a top hit layer with capture-phase re-dispatch to the element beneath
(`rerouteProxyEventBeneath`).

Two instrument notes, both paid for:

- **`perfMapPath()` takes the alphabetically FIRST `.massimo.json` in
  `.perf/`.** A gitignored drawing left behind by an earlier session outranks
  the committed `mta-v23`, silently. The first run of this harness measured an
  81-station map while reporting against a 464-station table, and nothing in
  the output said so. It now prints the resolved path on every run — but the
  trap is in the resolver, so it applies to every harness here.
- **Computed style is not paint.** Three separate subjects inside the map svg
  had the rule apply, `getComputedStyle` report the new opacity, and not one
  pixel move: a group scissored away by `.canvas-host` (the pan layer is a 2x
  surface and the window also holds the sidebar), and `[data-station-id]`
  wrappers, which are hit targets — the ink lives in sibling layers keyed on
  the same id. Each reported a confident +14 to +24 ms for repainting nothing.
  The arm now screenshots its own subject before and after and fails unless the
  bytes differ, and the subject is chosen by trying candidates until one is
  PROVEN to paint rather than by a rule about which node ought to carry ink.
  `CHROME_SVG_WHOLE=1` fades the entire pan layer as the control for that
  proof: if even that shows no pixel change, the screenshot cannot see the
  layer and no in-tree verdict here means anything. It can.

### Where the 15k nodes are

Census (`PERF_CENSUS=1`), 464 stations. `<g>` looked like the free win and is
not: 5,820 groups, but only **220** carry no attributes and ≤1 child.

| nodes | share | nearest `data-` ancestor |
| ----- | ----- | ------------------------ |
| 3,363 | 22.3% | `data-region-excluded` |
| 2,017 | 13.4% | `data-marker-casing` |
| 1,384 | 9.2% | `data-station-id` |
| 1,084 | 7.2% | `data-label-line` |
| 1,942 | 12.9% | `data-band-casing` + `data-band-stripe` |
| 1,609 | 10.7% | `data-stop-shape` + `data-stop-code` |

Region exclusion is the biggest single block and is machinery rather than ink.
The casing passes (~26% combined) are the deliberate stroke-before-fill two-pass
— a design trade, not a cleanup. Viewport culling is NOT the lever here: zoomed
out to the whole map (a normal working view for a transit diagram) nothing is
off-screen, and the pan surface deliberately renders a 2× window anyway.

### The same storm, through a late webfont

`App.tsx` used to clear the whole cache on `document.fonts` `loadingdone`,
which fires whenever a label is the first to ask for a weight — so bolding one
label re-measured every label on the map. `perf-gesture-start` triggers a REAL
face load (`fonts.load()`; a dispatched event would prove only that the listener
runs) on a fully rendered map and times what follows: **587 ms → 92 ms** once
`invalidateMeasuredFaces` narrowed the drop to entries whose measurement
actually resolved to an arriving face. The residual is the font-epoch re-render,
which still walks every label — but now they hit the cache.

Entries record the faces they REQUESTED rather than deriving them from the
label's own weight, because an inline `<b>` / `<w=…>` run measures at a weight
the label's own key never mentions. An entry that recorded NO face (the
no-canvas fallback never builds a declaration) invalidates on anything, so
unknown provenance can never strand stale metrics — and because the record is
the request rather than what CSS matching served, the narrowing is sound only
while the stylesheet ships every rung of the weight ladder in both slopes,
which a test pins.

## The session-aging question (Aug 2026)

Reported symptom: after an hour or two of editing a complex map, station drags
fall to a few fps and a reload cures it; panning stays smooth once started but
the click-to-pan-start gap grows.

Read the section above before chasing this one: a large, CONSTANT gesture-start
cost was present from the moment a big map loaded, owed nothing to session
length, and is fixed. Whatever remains of this question has to be measured as
GROWTH against that floor, not as absolute slowness.

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
