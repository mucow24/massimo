import { describe, it, expect } from 'vitest';
import {
  addEdge,
  degreeOf,
  edgeEndpoints,
  edgesFromStations,
  edgesWithout,
  incidentEdges,
  lineHasEdge,
  neighborsOf,
  removeEdge,
  shortestPathOnLine,
} from './lineTopology';
import { pairKeyOf } from './pairKey';
import { makeLine } from '../test/fixtures';

describe('edgesFromStations', () => {
  it('turns a linear path into canonical consecutive-pair keys', () => {
    expect(edgesFromStations(['s1', 's2', 's3'])).toEqual([
      pairKeyOf('s1', 's2'),
      pairKeyOf('s2', 's3'),
    ]);
  });

  it('closes a loop when the list returns to its start', () => {
    // Only used as a migration helper for legacy repeated-endpoint saves.
    expect(new Set(edgesFromStations(['s1', 's2', 's3', 's1']))).toEqual(
      new Set([pairKeyOf('s1', 's2'), pairKeyOf('s2', 's3'), pairKeyOf('s3', 's1')]),
    );
  });

  it('dedupes and drops zero-length self pairs', () => {
    expect(edgesFromStations(['s1', 's1', 's2'])).toEqual([pairKeyOf('s1', 's2')]);
    expect(edgesFromStations(['s1'])).toEqual([]);
    expect(edgesFromStations([])).toEqual([]);
  });

  it('emits canonical keys regardless of traversal direction', () => {
    expect(edgesFromStations(['s2', 's1'])).toEqual([pairKeyOf('s1', 's2')]);
    expect(edgesFromStations(['s2', 's1'])).toEqual(['s1|s2']);
  });
});

describe('edgeEndpoints', () => {
  it('splits a canonical key on its first pipe', () => {
    expect(edgeEndpoints('s1|s2')).toEqual(['s1', 's2']);
  });
});

describe('adjacency over an edge set', () => {
  // A Y-junction: trunk s1-s2-J, branches J-s3 and J-s4.
  const y = makeLine({
    id: 'l1',
    stations: ['s1', 's2', 'J', 's3', 's4'],
    edges: [
      pairKeyOf('s1', 's2'),
      pairKeyOf('s2', 'J'),
      pairKeyOf('J', 's3'),
      pairKeyOf('J', 's4'),
    ],
  });

  it('lineHasEdge is order-independent', () => {
    expect(lineHasEdge(y, 's2', 'J')).toBe(true);
    expect(lineHasEdge(y, 'J', 's2')).toBe(true);
    expect(lineHasEdge(y, 's1', 'J')).toBe(false);
  });

  it('degreeOf sees a junction as degree 3 and a terminus as degree 1', () => {
    expect(degreeOf(y, 'J')).toBe(3);
    expect(degreeOf(y, 's1')).toBe(1);
    expect(degreeOf(y, 's2')).toBe(2);
  });

  it('neighborsOf returns every connected station', () => {
    expect(new Set(neighborsOf(y, 'J'))).toEqual(new Set(['s2', 's3', 's4']));
    expect(neighborsOf(y, 's1')).toEqual(['s2']);
  });

  it('incidentEdges returns the junction legs', () => {
    expect(new Set(incidentEdges(y, 'J'))).toEqual(
      new Set([pairKeyOf('s2', 'J'), pairKeyOf('J', 's3'), pairKeyOf('J', 's4')]),
    );
  });
});

describe('adjacency cache — identity-keyed on the edges array', () => {
  const y = makeLine({
    id: 'l1',
    stations: ['s1', 's2', 'J', 's3', 's4'],
    edges: [
      pairKeyOf('s1', 's2'),
      pairKeyOf('s2', 'J'),
      pairKeyOf('J', 's3'),
      pairKeyOf('J', 's4'),
    ],
  });

  it('returns the same array instances while the edges array identity holds', () => {
    expect(neighborsOf(y, 'J')).toBe(neighborsOf(y, 'J'));
    expect(incidentEdges(y, 'J')).toBe(incidentEdges(y, 'J'));
  });

  it('a line clone sharing its edges array hits the same cache', () => {
    const clone = { ...y, color: '#ff0000' };
    expect(neighborsOf(clone, 'J')).toBe(neighborsOf(y, 'J'));
    expect(incidentEdges(clone, 's2')).toBe(incidentEdges(y, 's2'));
  });

  it('a no-op transform keeps the same edges reference, so the cache holds', () => {
    const same = removeEdge(y.edges, 'nope', 'nada');
    expect(same).toBe(y.edges);
    expect(neighborsOf({ ...y, edges: same }, 'J')).toBe(neighborsOf(y, 'J'));
  });

  it('a changed edges array recomputes the adjacency', () => {
    const grown = addEdge(y.edges, 'J', 's5');
    const y2 = { ...y, edges: grown };
    expect(neighborsOf(y2, 'J')).not.toBe(neighborsOf(y, 'J'));
    expect(neighborsOf(y2, 'J')).toEqual([...neighborsOf(y, 'J'), 's5']);
    expect(lineHasEdge(y2, 'J', 's5')).toBe(true);
    expect(lineHasEdge(y, 'J', 's5')).toBe(false);
  });

  it('reproduces the old per-call scans element-for-element (edges order)', () => {
    expect(neighborsOf(y, 'J')).toEqual(['s2', 's3', 's4']);
    expect(incidentEdges(y, 'J')).toEqual([
      pairKeyOf('s2', 'J'),
      pairKeyOf('J', 's3'),
      pairKeyOf('J', 's4'),
    ]);
    expect(neighborsOf(y, 'zz')).toEqual([]);
    expect(incidentEdges(y, 'zz')).toEqual([]);
  });
});

describe('edge-set mutators', () => {
  it('addEdge appends a canonical key and is a no-op on duplicates / self-loops', () => {
    const start: string[] = [];
    const one = addEdge(start, 's2', 's1');
    expect(one).toEqual(['s1|s2']);
    expect(addEdge(one, 's1', 's2')).toBe(one); // same ref, already present
    expect(addEdge(one, 's3', 's3')).toBe(one); // same ref, self-loop
  });

  it('removeEdge drops the key and is a no-op when absent', () => {
    const edges = [pairKeyOf('s1', 's2'), pairKeyOf('s2', 's3')];
    expect(removeEdge(edges, 's2', 's1')).toEqual([pairKeyOf('s2', 's3')]);
    expect(removeEdge(edges, 's1', 's3')).toBe(edges); // same ref, absent
  });

  it('edgesWithout drops all edges touching a station, else same ref', () => {
    const edges = [pairKeyOf('s1', 's2'), pairKeyOf('s2', 's3'), pairKeyOf('s3', 's4')];
    expect(edgesWithout(edges, 's2')).toEqual([pairKeyOf('s3', 's4')]);
    expect(edgesWithout(edges, 'sX')).toBe(edges);
  });
});

describe('shortestPathOnLine', () => {
  it('walks the consecutive chain on a linear line, excluding the start', () => {
    const line = makeLine({ id: 'l1', stations: ['a', 'b', 'c', 'd'] });
    expect(shortestPathOnLine(line, 'a', 'd')).toEqual(['b', 'c', 'd']);
    // Direction-independent: the reverse walk drops its own start.
    expect(shortestPathOnLine(line, 'd', 'a')).toEqual(['c', 'b', 'a']);
  });

  it('returns a single hop for directly-linked stations', () => {
    const line = makeLine({ id: 'l1', stations: ['a', 'b', 'c'] });
    expect(shortestPathOnLine(line, 'b', 'c')).toEqual(['c']);
  });

  it('takes the shorter arc around a loop', () => {
    // 4-cycle a-b-c-d-a: a→c has two equal 2-hop arcs; either is fine, but it
    // must never take the 3-hop long way round.
    const loop = makeLine({
      id: 'l1',
      stations: ['a', 'b', 'c', 'd'],
      edges: [pairKeyOf('a', 'b'), pairKeyOf('b', 'c'), pairKeyOf('c', 'd'), pairKeyOf('a', 'd')],
    });
    const path = shortestPathOnLine(loop, 'a', 'c');
    expect(path).not.toBeNull();
    expect(path).toHaveLength(2); // shorter arc, not the 3-hop long way
    expect(path?.[path.length - 1]).toBe('c');

    // On a 5-cycle the short and long arcs differ in length: a→c is 2 hops
    // (via b), never 3 (via e, d).
    const five = makeLine({
      id: 'l2',
      stations: ['a', 'b', 'c', 'd', 'e'],
      edges: [
        pairKeyOf('a', 'b'),
        pairKeyOf('b', 'c'),
        pairKeyOf('c', 'd'),
        pairKeyOf('d', 'e'),
        pairKeyOf('a', 'e'),
      ],
    });
    expect(shortestPathOnLine(five, 'a', 'c')).toEqual(['b', 'c']);
  });

  it('walks the unique tree path across a branch junction', () => {
    // Y-junction: trunk s1-s2-J, branches J-s3 and J-s4.
    const y = makeLine({
      id: 'l1',
      stations: ['s1', 's2', 'J', 's3', 's4'],
      edges: [
        pairKeyOf('s1', 's2'),
        pairKeyOf('s2', 'J'),
        pairKeyOf('J', 's3'),
        pairKeyOf('J', 's4'),
      ],
    });
    expect(shortestPathOnLine(y, 's1', 's3')).toEqual(['s2', 'J', 's3']);
    // Between the two branch tips: through the junction, never onto the trunk.
    expect(shortestPathOnLine(y, 's3', 's4')).toEqual(['J', 's4']);
  });

  it('returns null for members in disconnected edge components', () => {
    // Two separate chains that happen to share one line's membership list.
    const split = makeLine({
      id: 'l1',
      stations: ['a', 'b', 'x', 'y'],
      edges: [pairKeyOf('a', 'b'), pairKeyOf('x', 'y')],
    });
    expect(shortestPathOnLine(split, 'a', 'x')).toBeNull();
  });

  it('returns null when either endpoint is not a member', () => {
    const line = makeLine({ id: 'l1', stations: ['a', 'b'] });
    expect(shortestPathOnLine(line, 'a', 'zzz')).toBeNull();
    expect(shortestPathOnLine(line, 'zzz', 'b')).toBeNull();
  });
});
