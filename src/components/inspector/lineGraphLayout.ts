import type { Line, StationId } from '../../model/types';
import { pairKeyOf } from '../../model/pairKey';
import { edgeEndpoints } from '../../model/lineTopology';

// Column-based ("git graph") layout for a line's topology in the inspector.
// Each member station gets a ROW (vertical order) and a LANE (column), laid out
// so the tree reads like the drawn line:
//
//   • The trunk (lane 0) is the longest chain FROM the display-first terminus,
//     so the list starts where the user started drawing and runs in drawn
//     direction. A path found tip-first is reversed, and a singleton "bypass
//     cap" at the line's end is trimmed off the trunk so it renders between
//     its neighbors instead of folding back past them.
//   • At a junction, branch stops are emitted DIRECTLY below it (before the
//     trunk continues), so a branch reads next to its junction rather than
//     after the whole trunk. Lanes are reused across disjoint row spans.
//   • A back-edge closing a cycle renders as a MERGE — the arm rejoins the
//     line with a jog above its target, mirroring the branch tee — when its
//     upper endpoint ends a side lane; otherwise as an arc bowed out in a side
//     lane over the top of the upper endpoint, so a lasso's junction stays
//     inside its loop.
//
// Pure: depends only on `line.stations` (members + display order, which is
// drawn order) and `line.edges` (topology).

export interface GraphNode {
  stationId: StationId;
  row: number;
  lane: number;
}

export interface GraphEdgeVis {
  pairKey: string;
  // Endpoints in graph space. `from` is the upper (smaller row) endpoint.
  fromRow: number;
  fromLane: number;
  toRow: number;
  toLane: number;
  // 'tree'  = a spanning-tree edge (straight vertical or a tee'd branch connector);
  // 'merge' = a back-edge from the end of a side lane into a later stop, drawn
  //           down the lane with a jog across just above its target;
  // 'loop'  = any other back-edge, routed out in `sideLane` as an arc.
  kind: 'tree' | 'merge' | 'loop';
  // Only for a cross-lane branch: the blank row one cell below the parent where
  // the branch tees off, so the horizontal sits below the stop, not through it.
  teeRow?: number;
  // Only for merges: the blank row above the target where the arm jogs across.
  jogRow?: number;
  // Only for loops: the column the arc bows into — the smallest lane free over
  // the arc's row span, so nearby columns are reused rather than accumulated.
  sideLane?: number;
  // Only for loops: the blank rows above the upper / below the lower endpoint
  // where the arc's horizontals sit (over the top of the upper stop).
  upperBlank?: number;
  lowerBlank?: number;
}

export interface LineGraphLayout {
  nodes: GraphNode[]; // one per stop (NOT one per row — junctions leave blanks)
  edges: GraphEdgeVis[];
  laneCount: number; // total columns incl. loop side-lanes
  rowCount: number; // total grid rows incl. the blank junction rows
}

// Total DFS steps the longest-path search may spend before falling back to the
// best chain found so far. Finding the longest simple path is NP-hard in
// general, but line graphs are tiny and near-tree; this only backstops a
// pathologically cyclic input (the layout stays correct with a merely-good
// trunk, just less column-optimal).
const LONGEST_PATH_STEP_BUDGET = 50000;

// Longest simple path starting at `start`, exploring neighbours in their given
// (display) order and keeping the first path found at each length so ties
// resolve deterministically. Decrements the shared `budget`.
function longestPathFrom(
  start: StationId,
  adj: Map<StationId, StationId[]>,
  budget: { steps: number },
): StationId[] {
  let best: StationId[] = [start];
  const path: StationId[] = [];
  const onPath = new Set<StationId>();
  const walk = (node: StationId) => {
    path.push(node);
    onPath.add(node);
    if (path.length > best.length) best = [...path];
    if (budget.steps > 0) {
      for (const nb of adj.get(node)!) {
        if (onPath.has(nb)) continue;
        budget.steps--;
        walk(nb);
        if (budget.steps <= 0) break;
      }
    }
    path.pop();
    onPath.delete(node);
  };
  walk(start);
  return best;
}

// Pick, per connected component, the trunk chain: the longest simple path from
// the component's display-FIRST terminus (its display-first member when a ring
// has no terminus), so the tree starts reading where the user started drawing.
// Records each trunk node's successor, the component start, and the full trunk
// membership (the DFS may only enter trunk stations along this chain).
function longestTrunk(
  members: StationId[],
  adj: Map<StationId, StationId[]>,
  order: Map<StationId, number>,
): { next: Map<StationId, StationId>; starts: StationId[]; trunkSet: Set<StationId> } {
  const next = new Map<StationId, StationId>();
  const starts: StationId[] = [];
  const trunkSet = new Set<StationId>();
  const budget = { steps: LONGEST_PATH_STEP_BUDGET };
  const byDisplay = (a: StationId, b: StationId) => order.get(a)! - order.get(b)!;
  const seen = new Set<StationId>();
  for (const m of [...members].sort(byDisplay)) {
    if (seen.has(m)) continue;
    // Flood m's whole component.
    const comp: StationId[] = [];
    const stack = [m];
    seen.add(m);
    while (stack.length) {
      const n = stack.pop()!;
      comp.push(n);
      for (const nb of adj.get(n)!) {
        if (!seen.has(nb)) {
          seen.add(nb);
          stack.push(nb);
        }
      }
    }
    const termini = comp.filter((c) => adj.get(c)!.length === 1).sort(byDisplay);
    const seed = termini[0] ?? [...comp].sort(byDisplay)[0];
    const path = longestPathFrom(seed, adj, budget);
    // Keep the drawn direction when the seed itself was drawn late: a component
    // drawn ring-first grows its only terminus at the tip of a LATER tail, and
    // reading from that tip would render the whole ring in reverse drawn order.
    if (order.get(path[path.length - 1])! < order.get(path[0])!) path.reverse();
    // Bypass-cap trim: a singleton bypass at the END of the line — a station
    // whose only two neighbours are the last trunk edge's endpoints, drawn
    // after both — should render BETWEEN them as a parallel arm (as the same
    // bypass already does mid-line), not extend the trunk past the mainline
    // and fold back. Guards: a pure ring keeps threading inline (T would be
    // the trunk start), and longer folded-back tails (e.g. a lasso) never
    // match a singleton.
    while (path.length >= 3) {
      const cap = path[path.length - 1];
      const before = path[path.length - 2];
      const anchor = path[path.length - 3];
      const nbrs = adj.get(cap)!;
      const isTriangleCap = nbrs.length === 2 && nbrs.includes(anchor) && nbrs.includes(before);
      const drawnAfterBoth =
        order.get(cap)! > order.get(anchor)! && order.get(cap)! > order.get(before)!;
      if (!isTriangleCap || !drawnAfterBoth || anchor === path[0]) break;
      path.pop();
    }
    starts.push(path[0]);
    for (let i = 0; i < path.length - 1; i++) next.set(path[i], path[i + 1]);
    for (const p of path) trunkSet.add(p);
  }
  return { next, starts, trunkSet };
}

export function lineGraphLayout(line: Line): LineGraphLayout {
  const members = line.stations;
  const order = new Map<StationId, number>();
  members.forEach((s, i) => order.set(s, i));
  const byDisplay = (a: StationId, b: StationId) => order.get(a)! - order.get(b)!;

  const adj = new Map<StationId, StationId[]>();
  for (const s of members) adj.set(s, []);
  for (const e of line.edges) {
    const [a, b] = edgeEndpoints(e);
    if (adj.has(a) && adj.has(b)) {
      adj.get(a)!.push(b);
      adj.get(b)!.push(a);
    }
  }
  // Visit neighbours in display order so the layout is deterministic and the
  // user's drawn order decides trunk ties and branch order.
  for (const list of adj.values()) list.sort(byDisplay);

  const { next: trunkNext, starts, trunkSet } = longestTrunk(members, adj, order);
  const startSet = new Set(starts);
  const roots = [...starts, ...members.filter((m) => !startSet.has(m)).sort(byDisplay)];

  // Phase A — one DFS producing the visit sequence, the RUN partition (a run =
  // a maximal same-lane chain: the trunk, or one branch arm), the spanning-tree
  // edges, and the back-edges. Rules:
  //   • a trunk station may only be ENTERED along the trunk walk (via
  //     trunkNext); other unvisited trunk neighbours are skipped here and
  //     resolve later as back-edges, when the later endpoint sees the earlier
  //     one visited;
  //   • children order: branches (display order) FIRST, the run continuation
  //     LAST — branch stops hug their junction and the run resumes below them;
  //   • the continuation (trunkNext on the trunk, the first eligible child off
  //     it) stays in the parent's run; every other child starts a new run.
  interface Run {
    parentRun: number | null;
    teeOf: StationId | null; // the junction this run tees off (null for roots)
    chain: StationId[]; // stations in this run, top to bottom
    lane: number;
  }
  const runs: Run[] = [];
  const runOf = new Map<StationId, number>();
  interface TreeE {
    pairKey: string;
    parent: StationId;
    child: StationId;
    sameRun: boolean;
  }
  interface BackE {
    pairKey: string;
    upper: StationId; // earlier-visited endpoint
    lower: StationId; // later-visited endpoint
  }
  const treeEdges: TreeE[] = [];
  const backEdges: BackE[] = [];
  const seqOf = new Map<StationId, number>();
  const visited = new Set<StationId>();
  let nextSeq = 0;

  const visit = (node: StationId, runId: number, parent: StationId | null) => {
    visited.add(node);
    seqOf.set(node, nextSeq++);
    runOf.set(node, runId);
    runs[runId].chain.push(node);
    let skippedParent = false;
    const tn = trunkNext.get(node);
    const eligible: StationId[] = [];
    for (const nb of adj.get(node)!) {
      if (nb === parent && !skippedParent) {
        skippedParent = true; // consume the tree edge back to the parent once
        continue;
      }
      if (visited.has(nb)) {
        // Back-edge → a cycle closes. Both endpoints see it; record once from
        // the LOWER (later-visited) node looking up at the placed upper one.
        if (seqOf.get(nb)! < seqOf.get(node)!) {
          backEdges.push({ pairKey: pairKeyOf(node, nb), upper: nb, lower: node });
        }
        continue;
      }
      // Trunk stations are only entered via the trunk walk; the skipped edge
      // returns as a back-edge once the trunk reaches the neighbour.
      if (trunkSet.has(nb) && nb !== tn) continue;
      eligible.push(nb);
    }
    const continuation = tn !== undefined && eligible.includes(tn) ? tn : eligible[0];
    const ordered = [...eligible.filter((c) => c !== continuation), continuation].filter(
      (c): c is StationId => c !== undefined,
    );
    for (const nb of ordered) {
      if (visited.has(nb)) continue; // a sibling subtree may have reached it
      const sameRun = nb === continuation;
      let childRun = runId;
      if (!sameRun) {
        childRun = runs.length;
        runs.push({ parentRun: runId, teeOf: node, chain: [], lane: -1 });
      }
      treeEdges.push({ pairKey: pairKeyOf(node, nb), parent: node, child: nb, sameRun });
      visit(nb, childRun, node);
    }
  };
  for (const r of roots) {
    if (visited.has(r)) continue;
    const rootRun = runs.length;
    runs.push({ parentRun: null, teeOf: null, chain: [], lane: 0 });
    visit(r, rootRun, null);
  }

  // Phase B — classify back-edges. Same run → an arc over the top of the upper
  // endpoint (a cycle closing onto its own lane, e.g. a lasso or ring). Across
  // runs, IF the upper endpoint is the bottom of its run (nothing below it in
  // that lane) → a merge: the arm reads as a parallel track rejoining the line.
  // Otherwise (upper has in-lane descendants the merge would cut through) fall
  // back to an arc.
  const chainBottom = new Map<number, StationId>();
  runs.forEach((r, i) => {
    if (r.chain.length) chainBottom.set(i, r.chain[r.chain.length - 1]);
  });
  interface Routed extends BackE {
    flavor: 'arc' | 'merge';
  }
  const routed: Routed[] = backEdges.map((be) => {
    const sameRun = runOf.get(be.upper)! === runOf.get(be.lower)!;
    const upperIsBottom = chainBottom.get(runOf.get(be.upper)!) === be.upper;
    return { ...be, flavor: !sameRun && upperIsBottom ? 'merge' : 'arc' };
  });

  // Phase C — which stops get a blank row, and on which side. A branch point
  // tees its cross-run children off in a blank BELOW it. An arc's UPPER
  // endpoint gets a blank ABOVE it (the arc comes over its top, keeping a
  // cycle's junction inside its loop) and its lower endpoint a blank below. A
  // merge target gets a blank ABOVE it, hosting the arm's jog.
  const blankAbove = new Set<StationId>();
  const blankBelow = new Set<StationId>();
  for (const te of treeEdges) if (!te.sameRun) blankBelow.add(te.parent);
  for (const be of routed) {
    if (be.flavor === 'arc') {
      blankAbove.add(be.upper);
      blankBelow.add(be.lower);
    } else {
      blankAbove.add(be.lower);
    }
  }

  // Phase D — assign final rows in visit order, inserting the reserved blanks.
  const inSeq = [...seqOf.keys()].sort((a, b) => seqOf.get(a)! - seqOf.get(b)!);
  const rowOf = new Map<StationId, number>();
  const aboveRowOf = new Map<StationId, number>();
  const belowRowOf = new Map<StationId, number>();
  let nextRow = 0;
  for (const node of inSeq) {
    if (blankAbove.has(node)) aboveRowOf.set(node, nextRow++);
    rowOf.set(node, nextRow++);
    if (blankBelow.has(node)) belowRowOf.set(node, nextRow++);
  }
  const rowCount = nextRow;

  // Phase E — lanes by interval reuse. Every run claims the row interval its
  // vertical actually occupies — tee row through chain bottom, extended down to
  // the jog row of any merge leaving its end — and branch runs, processed in
  // tee order (parents before their nested children), take the smallest lane
  // ≥ 1 that is free across the whole interval. Arcs claim their side lane the
  // same way afterwards. Two branches may share a lane when their spans don't
  // overlap, which is what keeps a many-branch line at two columns.
  const claims: { lane: number; top: number; bottom: number }[] = [];
  const isFree = (lane: number, top: number, bottom: number) =>
    !claims.some((c) => c.lane === lane && c.top <= bottom && top <= c.bottom);
  const smallestFree = (top: number, bottom: number) => {
    for (let lane = 1; ; lane++) if (isFree(lane, top, bottom)) return lane;
  };

  const mergesFrom = new Map<StationId, Routed[]>();
  for (const be of routed) {
    if (be.flavor !== 'merge') continue;
    const list = mergesFrom.get(be.upper) ?? [];
    list.push(be);
    mergesFrom.set(be.upper, list);
  }
  const runInterval = (r: Run): { top: number; bottom: number } => {
    const top = r.teeOf !== null ? belowRowOf.get(r.teeOf)! : rowOf.get(r.chain[0])!;
    let bottom = rowOf.get(r.chain[r.chain.length - 1])!;
    for (const m of mergesFrom.get(r.chain[r.chain.length - 1]) ?? []) {
      bottom = Math.max(bottom, aboveRowOf.get(m.lower)!);
    }
    return { top, bottom };
  };
  for (const r of runs) {
    if (r.parentRun === null && r.chain.length) {
      const { top, bottom } = runInterval(r);
      claims.push({ lane: 0, top, bottom });
    }
  }
  const branchRuns = runs
    .filter((r) => r.chain.length && r.parentRun !== null)
    .sort((a, b) => runInterval(a).top - runInterval(b).top);
  for (const r of branchRuns) {
    const { top, bottom } = runInterval(r);
    r.lane = smallestFree(top, bottom);
    claims.push({ lane: r.lane, top, bottom });
  }
  const laneOf = (s: StationId) => runs[runOf.get(s)!].lane;

  // Phase F — build renderable nodes + edges; arcs claim side lanes last, in
  // span order, so each bows into the nearest free column.
  const nodes: GraphNode[] = inSeq.map((s) => ({
    stationId: s,
    row: rowOf.get(s)!,
    lane: laneOf(s),
  }));
  const edges: GraphEdgeVis[] = [];
  for (const te of treeEdges) {
    edges.push({
      pairKey: te.pairKey,
      fromRow: rowOf.get(te.parent)!,
      fromLane: laneOf(te.parent),
      toRow: rowOf.get(te.child)!,
      toLane: laneOf(te.child),
      kind: 'tree',
      ...(te.sameRun ? {} : { teeRow: belowRowOf.get(te.parent)! }),
    });
  }
  for (const be of routed) {
    if (be.flavor !== 'merge') continue;
    edges.push({
      pairKey: be.pairKey,
      fromRow: rowOf.get(be.upper)!,
      fromLane: laneOf(be.upper),
      toRow: rowOf.get(be.lower)!,
      toLane: laneOf(be.lower),
      kind: 'merge',
      jogRow: aboveRowOf.get(be.lower)!,
    });
  }
  const arcs = routed
    .filter((be) => be.flavor === 'arc')
    .sort((a, b) => aboveRowOf.get(a.upper)! - aboveRowOf.get(b.upper)!);
  for (const be of arcs) {
    const top = aboveRowOf.get(be.upper)!;
    const bottom = belowRowOf.get(be.lower)!;
    const sideLane = smallestFree(top, bottom);
    claims.push({ lane: sideLane, top, bottom });
    edges.push({
      pairKey: be.pairKey,
      fromRow: rowOf.get(be.upper)!,
      fromLane: laneOf(be.upper),
      toRow: rowOf.get(be.lower)!,
      toLane: laneOf(be.lower),
      kind: 'loop',
      sideLane,
      upperBlank: top,
      lowerBlank: bottom,
    });
  }

  const laneCount = Math.max(0, ...nodes.map((n) => n.lane), ...claims.map((c) => c.lane)) + 1;
  return { nodes, edges, laneCount, rowCount };
}
