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
