import { describe, it, expect } from 'vitest';
import {
  nearestNode,
  findDropTarget,
  computeGhosts,
  dragLattice,
  nudgeTarget,
  sameCell,
  type WidthNode,
} from './stopGridDrag';
import { STOP_SIZE } from '../../geometry/orientation';

describe('nearestNode', () => {
  it('returns null for an empty list', () => {
    expect(nearestNode({ row: 0, col: 0 }, [])).toBeNull();
  });

  it('picks the Euclidean-closest node', () => {
    const nodes = [
      { id: 'a', row: 0, col: 5 },
      { id: 'b', row: 1, col: 1 }, // dist √2 from origin
      { id: 'c', row: 3, col: 0 },
    ];
    expect(nearestNode({ row: 0, col: 0 }, nodes)?.id).toBe('b');
  });

  it('breaks ties by first-seen order (stable iteration)', () => {
    const nodes = [
      { id: 'a', row: 0, col: 1 },
      { id: 'b', row: 1, col: 0 },
    ];
    // Both at distance 1 from origin. First wins.
    expect(nearestNode({ row: 0, col: 0 }, nodes)?.id).toBe('a');
  });
});

describe('findDropTarget — per-stop swap radius', () => {
  it('a wide stop accepts a swap from beyond the default radius via swapRadiusFor', () => {
    const stops = [{ lineId: 'A', row: 0, col: 0 }];
    const cursor = { row: 0.8, col: 0 }; // outside the 0.6 default, inside a width-28 node
    const base = { swapRadius: 0.6, snapRadius: 1.0 };
    expect(findDropTarget(cursor, { kind: 'stop', lineId: 'B' }, stops, [], base)).toBeNull();
    expect(
      findDropTarget(cursor, { kind: 'stop', lineId: 'B' }, stops, [], {
        ...base,
        // width-28 node in the editor: 28/(2·14) + 0.1 = 1.1 row/col units.
        swapRadiusFor: () => 1.1,
      }),
    ).toEqual({ kind: 'stop', row: 0, col: 0, lineId: 'A' });
  });
});

describe('findDropTarget', () => {
  const opts = { swapRadius: 0.6, snapRadius: 1.0 };
  const stops = [
    { lineId: 'L1', row: 0, col: 0 }, // source
    { lineId: 'L2', row: 0, col: 1 }, // potential swap target
  ];
  const ghosts = [
    { row: -1, col: -1 },
    { row: -1, col: 0 },
    { row: -1, col: 1 },
    { row: 0, col: -1 },
    { row: 1, col: -1 },
    { row: 1, col: 0 },
    { row: 1, col: 1 },
  ];

  it('snaps to a ghost when the cursor is near one and no stop is in swap range', () => {
    // Cursor at (-0.95, 0.05) — closest to ghost (-1, 0) at dist ~0.07.
    const target = findDropTarget(
      { row: -0.95, col: 0.05 },
      { kind: 'stop', lineId: 'L1' },
      stops,
      ghosts,
      opts,
    );
    expect(target?.kind).toBe('ghost');
    expect(target).toMatchObject({ row: -1, col: 0 });
  });

  it('prefers swap when cursor sits inside a non-source stop circle', () => {
    // Cursor at (0, 0.95) — inside L2's circle (within swapRadius=0.6 of (0,1)).
    const target = findDropTarget(
      { row: 0, col: 0.95 },
      { kind: 'stop', lineId: 'L1' },
      stops,
      ghosts,
      opts,
    );
    expect(target).toEqual({ kind: 'stop', row: 0, col: 1, lineId: 'L2' });
  });

  it('never returns a swap target for a label source, even on top of a stop', () => {
    const target = findDropTarget(
      { row: 0, col: 1 }, // dead center of L2
      { kind: 'label' },
      stops,
      ghosts,
      opts,
    );
    // L2 is not a swap option for label source. (1, 1) ghost is at distance 1
    // from (0, 1), beyond snapRadius=1.0, so no ghost wins either.
    expect(target).toBeNull();
  });

  it('ignores the source stop when computing swap', () => {
    // Cursor on top of L1's center; L1 is the source, so no self-swap.
    const target = findDropTarget(
      { row: 0, col: 0 },
      { kind: 'stop', lineId: 'L1' },
      stops,
      ghosts,
      opts,
    );
    // Nearest ghost is (-1, 0) at distance 1 — at the snapRadius boundary
    // (not < 1.0). So no target.
    expect(target).toBeNull();
  });

  it('returns null when cursor is beyond snapRadius of every ghost', () => {
    const target = findDropTarget(
      { row: 100, col: 100 },
      { kind: 'stop', lineId: 'L1' },
      stops,
      ghosts,
      opts,
    );
    expect(target).toBeNull();
  });
});

const W = STOP_SIZE; // default node width

describe('computeGhosts', () => {
  const anchor: WidthNode = { row: 0, col: 0, w: W };

  it('default widths: the full 24-slot unit lattice around the anchor', () => {
    const ghosts = computeGhosts({
      wSrc: W,
      anchor,
      otherNodes: [anchor],
      basis: 'orthogonal',
      stationRotation: 0,
      gridRadius: 2,
    });
    expect(ghosts).toHaveLength(24);
    expect(ghosts.some((g) => sameCell(g, { row: 0, col: 1 }))).toBe(true);
    expect(ghosts.some((g) => sameCell(g, { row: -2, col: 2 }))).toBe(true);
  });

  it('mixed widths scale ring-1 to the pair tangency distance', () => {
    // width-28 source against a default anchor: t = (28+14)/2/14 = 1.5.
    const ghosts = computeGhosts({
      wSrc: 28,
      anchor,
      otherNodes: [anchor],
      basis: 'orthogonal',
      stationRotation: 0,
      gridRadius: 2,
    });
    expect(ghosts.some((g) => sameCell(g, { row: 0, col: 1.5 }))).toBe(true);
    expect(ghosts.some((g) => sameCell(g, { row: 0, col: 1 }))).toBe(false);
  });

  it('interline gaps widen ring-1 to the packed pitch (max-of-pair) but not the clearance', () => {
    // Gapped anchor (g = 4) against a gap-less source:
    // t = ((14+14)/2 + max(0, 4)) / 14 = 18/14.
    const gapped: WidthNode = { row: 0, col: 0, w: W, g: 4 };
    const fromAnchor = computeGhosts({
      wSrc: W,
      anchor: gapped,
      otherNodes: [gapped],
      basis: 'orthogonal',
      stationRotation: 0,
      gridRadius: 2,
    });
    expect(fromAnchor.some((g) => sameCell(g, { row: 0, col: 18 / 14 }))).toBe(true);
    expect(fromAnchor.some((g) => sameCell(g, { row: 0, col: 1 }))).toBe(false);
    // gSrc drives the same pitch from the source side (max-of-pair).
    const fromSrc = computeGhosts({
      wSrc: W,
      gSrc: 4,
      anchor,
      otherNodes: [anchor],
      basis: 'orthogonal',
      stationRotation: 0,
      gridRadius: 2,
    });
    expect(fromSrc.some((g) => sameCell(g, { row: 0, col: 18 / 14 }))).toBe(true);
    // Clearance stays WIDTH-ONLY: a gapped neighbor exactly one width-tangency
    // (1 cell) from the slot does not repel it — bodies don't grow with the
    // gap. (A gap-aware clearance of 18/14 would drop the slot.)
    const neighbor: WidthNode = { row: 0, col: 18 / 14 + 1, w: W, g: 4 };
    const withNeighbor = computeGhosts({
      wSrc: W,
      gSrc: 4,
      anchor,
      otherNodes: [anchor, neighbor],
      basis: 'orthogonal',
      stationRotation: 0,
      gridRadius: 2,
    });
    expect(withNeighbor.some((g) => sameCell(g, { row: 0, col: 18 / 14 }))).toBe(true);
  });

  it('drops slots that would overlap another node, keeps tangent ones', () => {
    const other: WidthNode = { row: 0, col: 1, w: W };
    const ghosts = computeGhosts({
      wSrc: W,
      anchor,
      otherNodes: [anchor, other],
      basis: 'orthogonal',
      stationRotation: 0,
      gridRadius: 2,
    });
    // (0,1) sits ON the other node — dropped. (0,2) is exactly tangent — kept.
    expect(ghosts.some((g) => sameCell(g, { row: 0, col: 1 }))).toBe(false);
    expect(ghosts.some((g) => sameCell(g, { row: 0, col: 2 }))).toBe(true);
  });

  it('label source: keeps slots clear of dot bodies even inside label tangency', () => {
    // Width-12 stops pack at 12/14 pitch — tighter than the label's
    // body-tangency (13/14). The label has no body on the rendered map, so a
    // slot is only dropped when a dot would cover the label's anchor point.
    const anchor12: WidthNode = { row: 0, col: 0, w: 12 };
    const other12: WidthNode = { row: -12 / 14, col: 12 / 14, w: 12 };
    const ghosts = computeGhosts({
      wSrc: W,
      srcIsPoint: true,
      anchor: anchor12,
      otherNodes: [anchor12, other12],
      basis: 'orthogonal',
      stationRotation: 0,
      gridRadius: 2,
    });
    // (0, 13/14) is 0.860 from the other dot — inside label tangency (0.929)
    // but outside the dot's own body (radius 6/14) — kept.
    expect(ghosts.some((g) => sameCell(g, { row: 0, col: 13 / 14 }))).toBe(true);
    // (-13/14, 13/14) is 0.101 from the other dot — the dot would cover the
    // label point — dropped.
    expect(ghosts.some((g) => sameCell(g, { row: -13 / 14, col: 13 / 14 }))).toBe(false);
  });

  it('stop source: the label node repels only up to the dot radius', () => {
    const anchor: WidthNode = { row: 0, col: 0, w: W };
    const labelNode: WidthNode = { row: 0, col: 1.6, w: W, isPoint: true };
    const nearLabel: WidthNode = { row: 0, col: 1.45, w: W, isPoint: true };
    const kept = computeGhosts({
      wSrc: W,
      anchor,
      otherNodes: [anchor, labelNode],
      basis: 'orthogonal',
      stationRotation: 0,
      gridRadius: 2,
    });
    // (0,1) is 0.6 from the label point — outside the source dot's radius
    // (7/14 = 0.5) — kept, though inside the old body-tangency (1.0).
    expect(kept.some((g) => sameCell(g, { row: 0, col: 1 }))).toBe(true);
    const dropped = computeGhosts({
      wSrc: W,
      anchor,
      otherNodes: [anchor, nearLabel],
      basis: 'orthogonal',
      stationRotation: 0,
      gridRadius: 2,
    });
    // At 0.45 the source dot would cover the label point — dropped.
    expect(dropped.some((g) => sameCell(g, { row: 0, col: 1 }))).toBe(false);
  });

  it('projects the screen-frame lattice into rotated-station local frame', () => {
    // Diagonal basis on a 45°-rotated station: the screen-frame tangent
    // diagonals land on LOCAL integer cardinals.
    const ghosts = computeGhosts({
      wSrc: W,
      anchor,
      otherNodes: [anchor],
      basis: 'diagonal',
      stationRotation: 1,
      gridRadius: 2,
    });
    expect(ghosts.some((g) => sameCell(g, { row: 0, col: 1 }))).toBe(true);
  });
});

describe('dragLattice — stop drags anchor to stops, not the label', () => {
  // Live regression (Furdome Arena): width-12 stops at 12/14 pitch, station
  // rotation 6, label parked one cell from the stops. The label's tangency
  // pitch (13/14) is incommensurate with the stop lattice, so slots hung off
  // the label sit ~1 world unit off the line axes — dropping a stop there
  // kinks the line and splits its band (unrouteable 1-unit jog). The label
  // must never be the lattice ANCHOR for a stop drag; it still blocks
  // overlaps and still anchors when it's the only other node.
  const U: WidthNode = { row: 25 / 14, col: 43 / 14, w: 12 };
  const M: WidthNode = { row: 1 / 14, col: 55 / 14, w: 12 };
  const label: WidthNode = { row: 25 / 14, col: 56 / 14, w: W, isPoint: true };
  const stops = [
    { lineId: 'U', row: U.row, col: U.col },
    { lineId: 'M', row: M.row, col: M.col },
    { lineId: 'T', row: 13 / 14, col: 55 / 14 }, // drag source
  ];
  const dropOpts = { swapRadius: 0.6, snapRadius: 1.0 };

  it('dragging a stop up its line offers the on-axis slot even when the cursor is nearest the label', () => {
    // Cursor "one unit up" from the T stop: nearest node is the LABEL
    // (1.264 vs M's 1.317) — anchoring there loses the on-axis slot
    // (13/14, 67/14) and offers only off-axis 13/14-pitch slots.
    const cursor = { row: 13 / 14, col: 69 / 14 };
    const { ghosts } = dragLattice({
      cursor,
      wSrc: 12,
      otherNodes: [U, M, label],
      basis: 'orthogonal',
      stationRotation: 6,
    });
    expect(ghosts.some((g) => sameCell(g, { row: 13 / 14, col: 67 / 14 }))).toBe(true);
    const target = findDropTarget(cursor, { kind: 'stop', lineId: 'T' }, stops, ghosts, dropOpts);
    expect(target && sameCell(target, { row: 13 / 14, col: 67 / 14 })).toBe(true);
  });

  it('a stop stranded on an off-axis label slot can be dragged back onto its line', () => {
    // Source sits on the label-anchored slot (12/14, 69/14); the cursor near
    // the original cell is a hair closer to the label (0.857) than to M
    // (0.860), so the label-anchored lattice has NO slot at the original
    // cell — the "missing placement dot".
    const strandedStops = [
      { lineId: 'U', row: U.row, col: U.col },
      { lineId: 'M', row: M.row, col: M.col },
      { lineId: 'T', row: 12 / 14, col: 69 / 14 },
    ];
    const cursor = { row: 13 / 14, col: 56 / 14 };
    const { ghosts } = dragLattice({
      cursor,
      wSrc: 12,
      otherNodes: [U, M, label],
      basis: 'orthogonal',
      stationRotation: 6,
    });
    const target = findDropTarget(
      cursor,
      { kind: 'stop', lineId: 'T' },
      strandedStops,
      ghosts,
      dropOpts,
    );
    expect(target && sameCell(target, { row: 13 / 14, col: 55 / 14 })).toBe(true);
  });

  it('keyboard nudge matches: on-axis hop even when the label is nearest the source', () => {
    const nearLabel: WidthNode = { row: 24 / 14, col: 55 / 14, w: W, isPoint: true };
    const target = nudgeTarget({
      source: { row: 13 / 14, col: 55 / 14 },
      wSrc: 12,
      otherNodes: [M, nearLabel],
      basis: 'orthogonal',
      stationRotation: 6,
      arrow: { row: -1, col: 0 }, // screen up
    });
    expect(target && sameCell(target, { row: 13 / 14, col: 67 / 14 })).toBe(true);
  });

  it('the label still anchors a lone stop (no other stops to hang the lattice off)', () => {
    const target = nudgeTarget({
      source: { row: 0, col: 0 },
      wSrc: 12,
      otherNodes: [{ row: 0, col: 13 / 14, w: W, isPoint: true }],
      basis: 'orthogonal',
      stationRotation: 0,
      arrow: { row: 0, col: 1 },
    });
    // Label-anchored hop past the label to its far tangent slot.
    expect(target && sameCell(target, { row: 0, col: 26 / 14 })).toBe(true);
  });
});

describe('nudgeTarget', () => {
  const RIGHT = { row: 0, col: 1 };
  const UP = { row: -1, col: 0 };

  it('hops to the far tangent slot when the arrow points across the anchor', () => {
    // Source at (0,0), anchor at (0,1): pressing Right can't overlap the
    // anchor, so the slot on its far side wins.
    const target = nudgeTarget({
      source: { row: 0, col: 0 },
      wSrc: W,
      otherNodes: [{ row: 0, col: 1, w: W }],
      basis: 'orthogonal',
      stationRotation: 0,
      arrow: RIGHT,
    });
    expect(target && sameCell(target, { row: 0, col: 2 })).toBe(true);
  });

  it('prefers the straight slot over nearer diagonals', () => {
    // Pressing Up from (0,0) with anchor (0,1): (-1,0) [dot 1, d 1] must beat
    // (-1,1) [dot .707, d 1.41] — alignment outranks distance.
    const target = nudgeTarget({
      source: { row: 0, col: 0 },
      wSrc: W,
      otherNodes: [{ row: 0, col: 1, w: W }],
      basis: 'orthogonal',
      stationRotation: 0,
      arrow: UP,
    });
    expect(target && sameCell(target, { row: -1, col: 0 })).toBe(true);
  });

  it('scales the hop by mixed-width tangency', () => {
    // width-28 source tangent-left of a default label at (0, 1.5): Right hops
    // to (0, 3) — tangent on the far side, never overlapping.
    const target = nudgeTarget({
      source: { row: 0, col: 0 },
      wSrc: 28,
      otherNodes: [{ row: 0, col: 1.5, w: W }],
      basis: 'orthogonal',
      stationRotation: 0,
      arrow: RIGHT,
    });
    expect(target && sameCell(target, { row: 0, col: 3 })).toBe(true);
  });

  it('is screen-true on rotated stations', () => {
    // Station rotated 2 steps (90° CW): local "up" (-row) paints as screen
    // East. The anchor sits screen-East of the source; pressing Right hops
    // to the slot screen-East of the anchor = local (-2, 0).
    const target = nudgeTarget({
      source: { row: 0, col: 0 },
      wSrc: W,
      otherNodes: [{ row: -1, col: 0, w: W }],
      basis: 'orthogonal',
      stationRotation: 2,
      arrow: RIGHT,
    });
    expect(target && sameCell(target, { row: -2, col: 0 })).toBe(true);
  });

  it('moves a label one slot left between tightly-packed narrow stops (Furdome Arena)', () => {
    // Real map regression: three width-12 stops at 12/14 pitch, station
    // rotation 6, label parked on the U stop's diagonal label-tangent slot.
    // The slot one screen-left of the label clears every dot but sits
    // √145/14 ≈ 0.860 from the T stop — inside label body-tangency (13/14),
    // so the old filter dropped it and ← matched a far diagonal instead.
    const stops: WidthNode[] = [
      { row: 25 / 14, col: 43 / 14, w: 12 }, // U
      { row: 13 / 14, col: 55 / 14, w: 12 }, // T
      { row: 1 / 14, col: 55 / 14, w: 12 }, // M
    ];
    const target = nudgeTarget({
      source: { row: 38 / 14, col: 56 / 14 },
      wSrc: W,
      srcIsPoint: true,
      otherNodes: stops,
      basis: 'orthogonal',
      stationRotation: 6,
      arrow: { row: 0, col: -1 }, // screen left
    });
    // One label-lattice step screen-left: local -row at rotation 6.
    expect(target && sameCell(target, { row: 25 / 14, col: 56 / 14 })).toBe(true);
  });

  it('returns null when there is no anchor (lone node)', () => {
    const target = nudgeTarget({
      source: { row: 0, col: 0 },
      wSrc: W,
      otherNodes: [],
      basis: 'orthogonal',
      stationRotation: 0,
      arrow: RIGHT,
    });
    expect(target).toBeNull();
  });
});

// The cells these two produce are written into the doc verbatim (App's arrow
// handler and useStationLayoutDrag both commit `target - source` as a delta
// onto the stored cell), so a slot that is merely *near* the lattice becomes a
// permanent coordinate in a saved map. At a rotated station the whole candidate
// set is projected out of the screen frame, which is where the drift entered.
describe('ghost slots are exact at every station rotation', () => {
  const ANCHOR: WidthNode[] = [{ row: 0, col: 0, w: STOP_SIZE }];
  const SOURCE = { row: 0, col: 1 };
  const ARROWS = [
    { row: -1, col: 0 },
    { row: 1, col: 0 },
    { row: 0, col: -1 },
    { row: 0, col: 1 },
  ];

  // Exactly an integer, or exactly an integer multiple of √2/2 — the two
  // families `latticeOffsets` generates. Anything else is drift.
  const isExactCell = (v: number) => {
    if (Object.is(v, -0)) return false;
    return Number.isInteger(v) || Number.isInteger(v / Math.SQRT1_2);
  };

  it.each([0, 1, 2, 3, 4, 5, 6, 7] as const)('nudgeTarget at rotation %i', (stationRotation) => {
    for (const arrow of ARROWS) {
      const target = nudgeTarget({
        source: SOURCE,
        wSrc: STOP_SIZE,
        gSrc: 0,
        otherNodes: ANCHOR,
        basis: 'orthogonal',
        stationRotation,
        arrow,
      });
      if (!target) continue;
      expect({ rot: stationRotation, arrow, ...target, exact: true }).toEqual({
        rot: stationRotation,
        arrow,
        ...target,
        exact: isExactCell(target.row) && isExactCell(target.col),
      });
    }
  });

  it.each([0, 1, 2, 3, 4, 5, 6, 7] as const)('dragLattice at rotation %i', (stationRotation) => {
    for (const basis of ['orthogonal', 'diagonal'] as const) {
      const { ghosts } = dragLattice({
        cursor: SOURCE,
        wSrc: STOP_SIZE,
        gSrc: 0,
        otherNodes: ANCHOR,
        basis,
        stationRotation,
      });
      expect(ghosts.length).toBeGreaterThan(0);
      const drifted = ghosts.filter((g) => !isExactCell(g.row) || !isExactCell(g.col));
      expect(drifted).toEqual([]);
    }
  });

  it('a quarter-turned station keeps its cells on the integer lattice', () => {
    // The strongest form of the claim, and the one a user sees: at 90°/180°/270°
    // a screen-cardinal step is still a local-cardinal step, so nothing the
    // editor offers can take an integer layout off the integer lattice.
    for (const stationRotation of [0, 2, 4, 6] as const) {
      for (const arrow of ARROWS) {
        const target = nudgeTarget({
          source: SOURCE,
          wSrc: STOP_SIZE,
          gSrc: 0,
          otherNodes: ANCHOR,
          basis: 'orthogonal',
          stationRotation,
          arrow,
        });
        if (!target) continue;
        expect(Number.isInteger(target.row)).toBe(true);
        expect(Number.isInteger(target.col)).toBe(true);
      }
    }
  });
});
