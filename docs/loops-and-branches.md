# Loop & branch lines — design & work log

Status: **in progress.** This doc is both the design record and the running work log for
the change that lets a line form loops and branches without hacks.

## The decision

A `Line` used to store its topology as an ordered node list, `stations: StationId[]`. An
ordered list structurally caps every interior node at **degree 2** (no Y-junctions) and
cannot close on itself. Yet every per-segment concern — `segmentStyles`,
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

`edges` is literally the key domain that `segmentStyles` / `lineTags`
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
- **Highlight overlay + branch UI + reactivity (iterations 2–3).**
  - `HighlightedLineLayer` arrowhead: it marked the APPEND direction, so it capped only the
    display-tail stop, and only when that stop was a genuine degree-1 end. A loop, or a
    junction at the tail, drew no false arrowhead (the earlier "both ends" attempt was
    reverted — the front stop stayed a plain forward chevron). **Removed since:** the
    on-canvas direction arrows (per-stop chevrons + terminus arrowhead) are gone; the
    highlighted line just re-paints stripes, markers, dots, and names.
  - **Loop/branch now renders immediately (bug fix):** `linesGeometrySig` (MapCanvas band
    memo) keyed on `stations`, but `toggleEdgeOnLine` changes only `edges` — so the new band
    didn't appear until another edit. Now keyed on `edges`. Regression test in
    `MapCanvas.stationsSig.test.tsx`.
  - `LineInspector`: the big `+` insert lozenges are now two small left-justified buttons per
    zone — **Insert after** (`+↓`, arms the linear cursor) and **Branch** (`+` railway
    junction, arms *draw mode* with the pen on that stop). New `draw` flag on the
    `appending-to-line` UiMode; in draw mode a plain click wires an edge (Alt+click still
    works everywhere). Off-chain edges (branch legs, loop wraps) are listed under a
    **"Branch / loop segments"** section so every segment's style is settable. Unit-tested.
- **Column/graph line-editor view (iteration 4).** The flat stop list read badly for
  branches/loops, so the inspector now shows a **git-graph-style column layout when viewing**
  a line: `inspector/lineGraphLayout.ts` (pure, tested) assigns each stop a row + lane via a
  DFS — trunk in lane 0, each branch splitting into a lane that runs alongside down to its
  stops, a loop closing with a back-edge bowed out in a side lane. `inspector/StationGraph.tsx`
  renders the gutter (connectors + dots) with clickable connectors to cycle a segment's style.
  Split for now: **view = graph, active editing (append) = the existing linear list**
  (insert/branch/remove/reorder), to keep that tested flow intact. Deferred: unify so editing
  also uses the graph; reorder + dot-shape picker are edit-list-only meanwhile; loop-arc
  visuals are best-effort.
- **Graph is now the ONE editor (iteration 5).** The flat band is deleted; `StationGraph`
  renders in both view and edit mode (no layout swap on Edit Stops). Additions:
  - **Orthogonal connectors** — vertical/horizontal segments with a constant `CORNER_R` 90°
    corner (`geometry/polygonUnion.openPolylinePath` on lane/row waypoints), replacing the
    wonky beziers. Route line 1px narrower (`BODY_W` 8→7).
  - **T-junction rows** — `lineGraphLayout` runs a cheap pass-1 tree-child count, then a branch
    point reserves a BLANK row one cell below the junction (`teeRow` on the cross-lane edge);
    the branch tees off there as a clean `├`, clear of every dot. New `rowCount` (rows incl.
    blanks); the row list renders blank spacers to stay gutter-aligned. A plain ring's root has
    one tree child (wrap = back-edge) so it is NOT a branch point — no blank row.
  - **Stop dots render their real type** via `StopGlyph` (shape/fill/stroke), 1px larger; click
    a dot in edit mode to open the restored dot-shape picker (`onSetDotStyle`).
  - **Right-click a connector removes that edge** (`toggleEdgeOnLine`) — how a loop/branch leg
    is deleted without dropping a stop.
  - **Insert-after fix:** `edgesAfterInsert` only splices into a real `prev–next` edge; on a
    branchy/looped line it no longer fabricates an edge to the display-next stop.
- **Full suite green (197 files / 3403 tests), `tsc`/lint/format/build all clean.**
- **Map-shaped tree layout (iteration 6).** The graph layout was rewritten so a complex line's
  tree maps back to the drawn line instead of exploding into columns and diagram-spanning
  brackets (`lineGraphLayout.ts`; renderer untouched except a `merge` edge kind):
  - **Drawn-direction trunk** — the trunk is the longest chain from the display-FIRST terminus
    (previously: global longest path, which could start at a branch tip and read the whole line
    backwards). A path found tip-first is reversed; a singleton **bypass cap** at the line's end
    (station whose only two neighbours are the last trunk edge's endpoints, drawn after both) is
    trimmed off the trunk so it renders between its neighbours — matching how the same bypass
    renders mid-line. Guards: pure rings and lasso shapes keep threading inline.
  - **Junction-local branches** — branch stops are emitted directly below their junction
    (before the trunk continues) and lanes are reused across disjoint row spans, so a
    two-branch line needs two columns, not three, and branch stops sit next to their junction.
    A branch's DFS may not wander into trunk stations (the skipped edge resolves as a
    back-edge from the far side).
  - **Merge closures** — a back-edge whose upper endpoint ends a side lane renders as a
    `merge`: down the lane, a jog in the blank row reserved ABOVE the target, into the target's
    dot — the tee's mirror image. A loop entered at one station and left at another reads as
    two parallel arms rejoining (like the map); same-lane closures and mid-run uppers keep the
    over-the-top arc, whose side lane is now the smallest free column over the arc's span
    instead of a globally-unique one.
  - Pinned by fixture tests (the three Jul 2026 test maps), an invariant zoo (theta, figure-8,
    chords, continuation-steal, multi-component…), and a StationGraph test that the merge jog
    sits in the blank row above its target.

Casing (the white stroke) is drawn per-band inline, so at a same-line junction/loop one
segment's casing paints over another segment's body, splitting the color. The clean fix is
to stroke the UNION of a line's bands (outer boundary only) or a carefully-verified per-line
casing reorder — deferred pending an approach decision (a naive reorder erased the inter-line
separators historically). NOT yet fixed.

## How to draw them (current UX — canvas-only line editing, Jul 2026)

The inspector tree view (`StationGraph` / `lineGraphLayout`) is **deleted**; all stop/topology
editing happens on the canvas in Edit Stops, driven by a CURSOR
(`components/canvas/appendGestures.ts` is the tested gesture matrix):

1. Place stations (place-station mode) or Alt-click them into existence while editing, then
   **Edit Stops** on the line.
2. **Connect:** click a stop to put the cursor on it; every next station click wires an edge
   from the cursor and advances it (click-click-click builds a path; clicking an existing
   member closes a loop; clicking from an interior stop grows a branch — no draw mode).
3. **Insert in-line:** click a **segment** to arm insertion into that edge (the end nearer
   your click is where stops enter, marching toward the far end); each station click splices
   in and keeps marching. This is what resolved the old "insert after an ambiguous junction
   stop" problem — the edge, not the stop, is the target.
4. **Create:** Alt-click empty canvas to mint a station as the second click of the pending
   connect/splice (station-engine snap; grouped into one undo entry with its wiring).
5. **Remove:** the armed stop/segment shows a clickable × chip, and Delete/Backspace removes
   it too; right-click removes a SEGMENT directly. Right-click on a STATION rotates it (as
   everywhere — the quick fix for a weird auto-orientation while laying out a line; deletion
   deliberately isn't one slip away from it). Edit Stops is a right-click passthrough mode —
   right-click never exits it.
6. **Style:** shift-click a segment cycles its per-segment style (also works with the line
   merely selected, outside Edit Stops).
7. **Back out:** Esc or a plain canvas click drops the cursor first; a second one exits.

Transforms: `connectStationsOnLine`, `spliceStationIntoEdge`, `toggleEdgeOnLine`,
`addStationToLine`, `removeStationFromLine`. `toggleStationOnLine`, `edgesAfterInsert`, and
`reorderLineStations` are gone — `Line.stations` is a pure membership list (order is
meaningless now that nothing displays it).

## Iterate-later (known gaps; correct for linear today, cosmetic/edge-case on non-linear)

- **`redistributeBetween`** (ctrl+click even-spacing) and **`snap.refineAlongAxis`** terminus
  extrapolation still read display order — correct for linear lines, approximate on
  branchy/looped ones.
- **Line-tag drag** now builds its candidate set from `line.edges` (fixed), so tags drag onto
  loop wrap-edges / branch legs. Remaining display-order bit: `lineTraversesForwardCanon` only
  sets the tag's tangent (text) direction and falls back to canonical-forward on a loop
  wrap-edge (no single traversal direction there) — a cosmetic orientation default, not a
  placement bug.
- **Visual confirmation** of a junction (three stripes converging) is architecturally sound
  and unit-reasoned but not yet eyeballed — the interlining golden snapshot only covers
  linear fixtures. Worth a preview eval.
- **Overlapping stations at low zoom:** the tree gave guaranteed-clickable rows; on canvas,
  coincident stops need a zoom-in to disambiguate. Accepted for single-user alpha.
