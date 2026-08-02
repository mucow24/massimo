# Drag-performance harnesses

Benchmarks for the station-drag hot path. **Nothing in here runs in CI or in any
`npm` gate** — `lint`, `format:check`, `test`, `build` and `e2e` are every one of
them scoped to `src/` or `e2e/`, so this directory is invisible to them. It is
carried in the repo because the previous optimization run's harnesses were left
untracked and died with their worktree, and rebuilding them cost more than the
optimization did.

## You need a map

The harnesses measure a real document; a toy fixture does not have the crossing
density that makes any of this expensive. Maps are NOT committed (they are
drawings, not fixtures, and run to megabytes), so point the harnesses at one:

```bash
export PERF_MAP=.perf/my-map.massimo.json   # any exported .massimo.json
```

`.perf/*.massimo.json` is gitignored, so dropping one in here is the path of
least resistance. Every harness fails with this instruction if the file is
missing, rather than with a stack trace.

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
| `e2e/perf-profile.spec.ts` | CDP CPU profile, bucketed by file and function |
| `e2e/perf-ab.spec.ts` | in-page interleaved A/B of a toggleable change |

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

**The browser harness has 25%+ run-to-run variance, worse under load.** Never
compare across runs. Rebuild and re-measure both arms in the same session, take
several rounds, and treat anything under ~1.3x as unresolved. `perf-ab.spec.ts`
interleaves within one page for changes that can be toggled at runtime — but
note that the region pipeline carries an incremental cache, so interleaved arms
contaminate each other's state and both get slower. For geometry, prefer the
node harness.

See `RESULTS.md` for what has been measured, what shipped, and the four ideas
that were built and thrown away.
