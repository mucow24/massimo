import { describe, it, expect } from 'vitest';
import { nearestNode, findDropTarget } from './stopGridDrag';

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
