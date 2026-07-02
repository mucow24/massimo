import { describe, it, expect } from 'vitest';
import {
  nearestNode,
  findDropTarget,
  computeGhosts,
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
