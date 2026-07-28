import { describe, it, expect } from 'vitest';
import { subdivideCells } from './lineRegions';
import type { Ring } from './clip';

/**
 * Pins subdivideCells over a component whose cells sit at two far-apart
 * crossings — the shape that lets the bbox fast path skip clipper calls for
 * cell/rings pairs that provably can't interact. The output must be exactly
 * what the unguarded intersect/subtract chain produces.
 */
const sq = (x: number, y: number, w: number): Ring => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + w },
  { x, y: y + w },
];

const area = (cells: ReturnType<typeof subdivideCells>) =>
  cells.map((c) => ({
    cover: c.cover.join('+'),
    area: c.rings.reduce((sum, ring) => {
      let a = 0;
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i];
        const q = ring[(i + 1) % ring.length];
        a += p.x * q.y - q.x * p.y;
      }
      return sum + Math.abs(a) / 2;
    }, 0),
    patches: c.rings.length,
  }));

describe('subdivideCells', () => {
  it('splits a two-crossing line against local overlappers exactly', () => {
    // A: one line whose restriction is two disjoint 10x10 squares (a line
    // crossing the component twice). B overlaps only the west square,
    // C only the east one — so when C arrives, the {A,B} cell is far away
    // and must pass through untouched.
    const restricted = [
      { id: 'A', rings: [sq(0, 0, 10), sq(100, 0, 10)] },
      { id: 'B', rings: [sq(5, 0, 10)] },
      { id: 'C', rings: [sq(105, 0, 10)] },
    ];
    const cells = area(subdivideCells(restricted));
    expect(cells).toEqual([
      { cover: 'A+B', area: 50, patches: 1 },
      { cover: 'A+C', area: 50, patches: 1 },
      // A minus both overlappers: two 5x10 leftovers in one composite cell.
      { cover: 'A', area: 100, patches: 2 },
      { cover: 'B', area: 50, patches: 1 },
      { cover: 'C', area: 50, patches: 1 },
    ]);
  });

  it('keeps a cell untouched when a later line is disjoint from it', () => {
    const restricted = [
      { id: 'A', rings: [sq(0, 0, 10)] },
      { id: 'B', rings: [sq(200, 0, 10)] },
    ];
    const cells = subdivideCells(restricted);
    expect(cells.map((c) => c.cover)).toEqual([['A'], ['B']]);
    // The disjoint pass must hand back the original rings, not a clipper
    // re-emission of them (the empty-intersection branch never touched them).
    expect(cells[0].rings).toBe(restricted[0].rings);
  });
});
