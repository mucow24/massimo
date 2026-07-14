import { describe, it, expect } from 'vitest';
import * as T from './transforms';
import { makeDoc, makeStation, makeStop, makeLine } from '../test/fixtures';

// Auto-orientation rule: the ONLY station that may be auto-rotated is one
// gaining its first line in this edit. A station already served by any line
// keeps the rotation the user gave it — adding, inserting, removing, or
// reordering must never disturb it.
describe('auto-orientation only touches a station gaining its first line', () => {
  it('connecting a new station does not re-rotate stations already on the line', () => {
    // L-bend: a (top) — b (below a). Connecting c to the east of b would,
    // under the old whole-line pass, flip b from a vertical endpoint (0) to a
    // corner (7). b is already served by L1, so it must stay put.
    let doc = makeDoc({
      stations: [
        makeStation({ id: 'a', x: 0, y: 0, rotation: 0, stops: [makeStop('L1')] }),
        makeStation({ id: 'b', x: 0, y: 100, rotation: 0, stops: [makeStop('L1')] }),
        makeStation({ id: 'c', x: 100, y: 100, rotation: 0, stops: [] }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['a', 'b'] })],
    });
    doc = T.connectStationsOnLine(doc, 'L1', 'b', 'c'); // extend b → c
    expect(doc.stations.b.rotation).toBe(0);
    expect(doc.stations.a.rotation).toBe(0);
    expect(doc.stations.c.rotation).toBe(6); // the new station IS oriented
  });

  it('orients the newly connected station but leaves the first station untouched', () => {
    // The first station was placed when the line was too short to have a
    // tangent, so it keeps its rotation; only the new station orients.
    let doc = makeDoc({
      stations: [
        makeStation({ id: 'a', x: 0, y: 0, rotation: 0, stops: [makeStop('L1')] }),
        makeStation({ id: 'b', x: 100, y: 0, rotation: 0, stops: [] }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['a'] })],
    });
    doc = T.connectStationsOnLine(doc, 'L1', 'a', 'b'); // → a–b
    expect(doc.stations.b.rotation).toBe(6); // new station oriented to the tangent
    expect(doc.stations.a.rotation).toBe(0);
  });

  it('removing a station does not re-rotate the remaining stations', () => {
    // Seed the post-bend state directly (b is a corner at 7). Removing c must
    // not snap b back to a straight 0.
    let doc = makeDoc({
      stations: [
        makeStation({ id: 'a', x: 0, y: 0, rotation: 0, stops: [makeStop('L1')] }),
        makeStation({ id: 'b', x: 0, y: 100, rotation: 7, stops: [makeStop('L1')] }),
        makeStation({ id: 'c', x: 100, y: 100, rotation: 6, stops: [makeStop('L1')] }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['a', 'b', 'c'] })],
    });
    doc = T.removeStationFromLine(doc, 'L1', 2); // remove c → [a, b]
    expect(doc.stations.b.rotation).toBe(7); // RED on old code: becomes 0
    expect(doc.stations.a.rotation).toBe(0);
  });
});

// The canvas primitives orient from the WIRED chain, not the member array:
// connect passes [from, to]; splice passes [from, station, to]. The member
// array is display-only and its tail may be nowhere near the new edge.
describe('canvas connect/splice orientation', () => {
  it('connectStationsOnLine orients the new station along the wired edge, not the member array', () => {
    // Members [a, b] but the connection comes FROM a; c sits east of a.
    // Array-neighbor logic would orient c along b→c (a diagonal); the wired
    // edge a→c runs east.
    let doc = makeDoc({
      stations: [
        makeStation({ id: 'a', x: 0, y: 0, rotation: 0, stops: [makeStop('L1')] }),
        makeStation({ id: 'b', x: 0, y: 100, rotation: 0, stops: [makeStop('L1')] }),
        makeStation({ id: 'c', x: 100, y: 0, rotation: 0, stops: [] }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['a', 'b'] })],
    });
    doc = T.connectStationsOnLine(doc, 'L1', 'a', 'c');
    expect(doc.stations.c.rotation).toBe(6); // east tangent
    expect(doc.stations.a.rotation).toBe(0);
    expect(doc.stations.b.rotation).toBe(0);
  });

  it('connectStationsOnLine never rotates an already-served target', () => {
    let doc = makeDoc({
      stations: [
        makeStation({ id: 's', x: 100, y: 0, rotation: 5, stops: [makeStop('L1')] }),
        makeStation({ id: 't', x: 0, y: 0, rotation: 0, stops: [makeStop('L2')] }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s'] }), makeLine({ id: 'L2', stations: ['t'] })],
    });
    doc = T.connectStationsOnLine(doc, 'L2', 't', 's'); // s joins L2 by wire
    expect(doc.stations.s.rotation).toBe(5);
  });

  it('spliceStationIntoEdge bisector-orients a brand-new station; flanks untouched', () => {
    // a — c horizontal; splice b in below the midpoint. Same geometry as the
    // old insert-after mid-line case: b gets the bisector, a and c stay put.
    let doc = makeDoc({
      stations: [
        makeStation({ id: 'a', x: 0, y: 0, rotation: 0, stops: [makeStop('L1')] }),
        makeStation({ id: 'c', x: 100, y: 0, rotation: 0, stops: [makeStop('L1')] }),
        makeStation({ id: 'b', x: 50, y: 50, rotation: 0, stops: [] }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['a', 'c'] })],
    });
    doc = T.spliceStationIntoEdge(doc, 'L1', 'a', 'c', 'b');
    expect(doc.stations.b.rotation).toBe(6);
    expect(doc.stations.a.rotation).toBe(0);
    expect(doc.stations.c.rotation).toBe(0);
  });
});
