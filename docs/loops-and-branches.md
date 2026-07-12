# Loop & branch lines — design & work log

Status: **in progress.** This doc is both the design record and the running work log for
the change that lets a line form loops and branches without hacks.

## The decision

A `Line` used to store its topology as an ordered node list, `stations: StationId[]`. An
ordered list structurally caps every interior node at **degree 2** (no Y-junctions) and
cannot close on itself. Yet every per-segment concern — `segmentStyles`, `segmentLayers`,
line tags — and the whole interlining renderer are already keyed by the canonical
station-pair (`pairKeyOf`). The ordered list was a vestigial, over-restrictive encoding of
what is really an **edge set**.

**Model:** promote the edge set to be the topology.

```ts
interface Line {
  stations: StationId[]; // MEMBERS — one stop cell each. Order = DISPLAY ONLY, not topology.
  edges: string[];       // canonical pairKeys = the actual track. Unique. Endpoints ∈ stations.
}
```

- **Loop** = a cycle in the edge set (≥3 distinct stations; a 2-station "loop" would be a
  duplicate edge, which the set forbids by construction).
- **Branch** = a station with ≥3 incident edges.

`edges` is literally the key domain that `segmentStyles` / `segmentLayers` / `lineTags`
already live in. `stations` is kept as the member set so a line can hold a lone
degree-0 seed while being drawn, and so the huge fixture surface that passes `stations:
[...]` keeps working. Invariant: `endpoints(edges) ⊆ stations`.

### Locked decisions

1. `edges` stored as canonical pairKey `string[]` (congruent with the existing key space;
   pruning becomes a set intersection).
2. The dead `Line.waypoints` field (zero read/write sites in the repo) is deleted in this
   change.
3. Implement all three phases, then iterate.

### Why this is not a hack

- A branch faked as a linear walk-with-revisits (`A-B-J-C-J-D`) duplicates edge `J|C` →
  duplicate `bandKey` → silent data loss (colliding band/label/tag/React keys). The edge
  set emits only distinct pairKeys, so that never happens.
- Two overlapping lines render a shared trunk as two parallel stripes, not a Y.

## Phases

1. **Model foundation + enumerator switch.** `Line.edges` (required), delete `waypoints`,
   `model/lineTopology.ts` helpers, migration `backfillLineEdges` on both load paths
   (persist v13 → v14). Switch every "consecutive pairs of `stations`" enumerator to
   iterate `edges` (interlining, `pruneOrphanSegmentStyles`, `isLineEdge`, `sanitizeSegments`,
   terminus/marker/layer adjacency, tag traversal). Safety check: the byte-exact
   interlining golden snapshot stays identical (edges ≡ consecutive pairs for linear lines).
2. **Editing transforms + pen UX.** `addEdgeToLine` / `removeEdgeFromLine` / `splitEdge` /
   generalized `removeStationFromLine`; `reorderLineStations` becomes display-only. The
   append-mode linear cursor (`insertAfterIndex`) becomes a "pen tip" (`drawing-line`
   mode): each click draws an edge from the pen to the clicked station; loops close by
   clicking an existing member, branches start by relocating the pen to an interior member.
3. **Inspector + graph algorithms.** Edge-aware inspector (linear band kept as the
   degree-≤2 specialization); `pathBetweenStations` / redistribute become shortest-hop BFS
   over the line subgraph.

## Consumer inventory (verified against source)

Topology enumerators to switch from consecutive-pairs → `edges`:

| Site | File |
| --- | --- |
| interlining collect loop | `geometry/interlining.ts` |
| `pruneOrphanSegmentStyles`, `isLineEdge` | `model/transforms.ts` |
| `sanitizeSegments` | `model/serialize.ts` |
| `terminusOutwardFromBand`, `stationMarkerStyle` | `geometry/interlining.ts` |
| `incidentLayers` / adjacency | `model/layerPriority.ts` |
| `lineTraversesForwardCanon` | `geometry/lineTagGeometry.ts` |
| `alignmentPairs`, terminus extrapolation | `geometry/snap.ts` |
| `pathBetweenStations`, `redistributeBetween` | `model/pathSelect.ts`, `model/transforms.ts` |
| arrow tip / direction triangles | `components/canvas/HighlightedLineLayer.tsx` |
| inspector station band | `components/inspector/stationBandGeometry.ts` |

## Work log

- **Stages 1–3 complete and verified** — full unit suite green (195 files / 3387 tests),
  `tsc -b` clean, interlining golden snapshot byte-identical.
  - Stage 1: `Line.edges` (required), `Line.waypoints` deleted, `model/lineTopology.ts`
    (+ tests), `makeLine` auto-derives edges, `backfillLineEdges`/`backfillLinesEdges` on
    both load paths, persist v13 → v14 (+ migration test).
  - Stage 2: edge-set enumerators — interlining collect/terminus/markerStyle,
    `layerPriority` incidence, `snap.alignmentPairs` (now `lineHasEdge`, which also fixes
    loop wrap-edge snapping), `serialize.sanitizeSegments`. Golden snapshot unchanged.
  - Stage 3: edit transforms — `toggleStationOnLine` splices edges; removal (`toggle` /
    `removeStationFromLine` / `deleteStation`) heals degree-2 gaps; `reorderLineStations`
    is display-only (no longer prunes); new `toggleEdgeOnLine` (loop-close / branch);
    `pruneOrphanSegmentStyles` + `isLineEdge` read `edges`. 6 new loop/branch tests.
  - Deferred to iteration (correct for linear today, cosmetic on non-linear):
    `snap.refineAlongAxis` terminus extrapolation; line-tag traversal frame on branchy
    lines (`lineTraversesForwardCanon` reads display order, preserved for back-compat).
- **Stage 4 done — loops/branches are drawable.** New transforms `addStationToLine`
  (lone member, no edge) and `toggleEdgeOnLine` (add/remove a segment) + store actions.
  In line-edit (append) mode, **Alt/Option+click** draws a track edge from the pen (the
  station the cursor sits on) to the clicked station — closing loops and forming branches;
  plain click keeps the linear append/remove behavior. Unit-tested in
  `useStationInteraction.test.tsx` + transform tests.
- **Stage 5 (partial).** `pathBetweenStations` (ctrl+shift line-select) is now BFS over the
  edge graph — shorter loop arc, unique branch path; identical for linear lines (+ tests).
- **Full suite green (195 files / 3393 tests), `tsc`/lint/format/build all clean.**

## How to draw them (current UX)

1. Place the stations (place-station mode), then **Edit Stops** on the line.
2. Plain-click stations in order to build the path (unchanged).
3. **Close a loop:** with the pen on the last stop, **Alt+click the first stop** → wrap edge.
4. **Branch:** put the pen on the junction (the inspector's insert-cursor lozenge after it),
   then **Alt+click** the branch's next stop → a new leg without splicing the trunk.

## Iterate-later (known gaps; correct for linear today, cosmetic/edge-case on non-linear)

- **Selected-line highlight overlay** (`HighlightedLineLayer`) still assumes a single chain
  (first/last = ends, direction triangles by display order) → draws a misleading terminus
  arrow on a loop/junction. The map bands themselves render correctly.
- **LineInspector** shows a single vertical chain; per-segment style dividers are keyed by
  consecutive *display* pairs, so a loop's wrap edge / a branch leg isn't individually
  editable there yet. No crash. Needs an edge-list form.
- **On-canvas pen repositioning:** you currently move the pen to an interior junction via
  the inspector insert-cursor; an on-canvas "lift/relocate pen" gesture (or draw-to-empty
  to create+connect) would make multi-branch drawing smoother.
- **`redistributeBetween`** (ctrl+click even-spacing) and **line-tag traversal frame** and
  **`snap.refineAlongAxis`** terminus extrapolation still read display order — correct for
  linear lines, approximate on branchy/looped ones.
- **Visual confirmation** of a junction (three stripes converging) is architecturally sound
  and unit-reasoned but not yet eyeballed — the interlining golden snapshot only covers
  linear fixtures. Worth a preview eval.
