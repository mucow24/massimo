import { describe, it, expect } from 'vitest';
import * as T from './transforms';
import { makeDoc, makeStation, makeStop, makeLine } from '../test/fixtures';

// Auto-orientation rule: the ONLY station that may be auto-rotated is one
// gaining its first line in this edit. A station already served by any line
// keeps the rotation the user gave it — adding, inserting, removing, or
// reordering must never disturb it.
describe('auto-orientation only touches a station gaining its first line', () => {
  it('appending a station does not re-rotate stations already on the line', () => {
    // L-bend: a (top) — b (below a). Appending c to the east of b would, under
    // the old whole-line pass, flip b from a vertical endpoint (0) to a corner
    // (7). b is already served by L1, so it must stay put.
    let doc = makeDoc({
      stations: [
        makeStation({ id: 'a', x: 0, y: 0, rotation: 0, stops: [makeStop('L1')] }),
        makeStation({ id: 'b', x: 0, y: 100, rotation: 0, stops: [makeStop('L1')] }),
        makeStation({ id: 'c', x: 100, y: 100, rotation: 0, stops: [] }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['a', 'b'] })],
    });
    doc = T.toggleStationOnLine(doc, 'L1', 'c'); // append at end → [a, b, c]
    expect(doc.stations.b.rotation).toBe(0); // RED on old code: becomes 7
    expect(doc.stations.a.rotation).toBe(0);
    expect(doc.stations.c.rotation).toBe(6); // the new station IS oriented
  });

  it('inserting a station mid-line does not re-rotate the flanking stations', () => {
    // a — c horizontal; insert b below the midpoint. Old code re-rotates both
    // a (0→7) and c (0→5) because their neighbour changed to b.
    let doc = makeDoc({
      stations: [
        makeStation({ id: 'a', x: 0, y: 0, rotation: 0, stops: [makeStop('L1')] }),
        makeStation({ id: 'c', x: 100, y: 0, rotation: 0, stops: [makeStop('L1')] }),
        makeStation({ id: 'b', x: 50, y: 50, rotation: 0, stops: [] }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['a', 'c'] })],
    });
    doc = T.toggleStationOnLine(doc, 'L1', 'b', 0); // insert after index 0 → [a, b, c]
    expect(doc.stations.a.rotation).toBe(0); // RED on old code: becomes 7
    expect(doc.stations.c.rotation).toBe(0); // RED on old code: becomes 5
    expect(doc.stations.b.rotation).toBe(6); // the new station IS oriented
  });

  it('orients the newly added station but leaves the first station untouched', () => {
    // The first station was placed when the line was too short to have a
    // tangent, so it keeps its rotation; only the new station orients.
    let doc = makeDoc({
      stations: [
        makeStation({ id: 'a', x: 0, y: 0, rotation: 0, stops: [makeStop('L1')] }),
        makeStation({ id: 'b', x: 100, y: 0, rotation: 0, stops: [] }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['a'] })],
    });
    doc = T.toggleStationOnLine(doc, 'L1', 'b'); // → [a, b]
    expect(doc.stations.b.rotation).toBe(6); // new station oriented to the tangent
    expect(doc.stations.a.rotation).toBe(0); // RED on old code: becomes 6
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

  it('reordering a line does not re-rotate its stations', () => {
    // Collinear vertical a — b — c. Reordering to a — c — b would, under the
    // old pass, make b a downward endpoint (0→4).
    let doc = makeDoc({
      stations: [
        makeStation({ id: 'a', x: 0, y: 0, rotation: 0, stops: [makeStop('L1')] }),
        makeStation({ id: 'b', x: 0, y: 100, rotation: 0, stops: [makeStop('L1')] }),
        makeStation({ id: 'c', x: 0, y: 200, rotation: 0, stops: [makeStop('L1')] }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['a', 'b', 'c'] })],
    });
    doc = T.reorderLineStations(doc, 'L1', ['a', 'c', 'b']);
    expect(doc.stations.b.rotation).toBe(0); // RED on old code: becomes 4
  });

  it('adding an already-served station to another line never rotates it', () => {
    // Requirement 1, multi-line case (green today via the transfer-hub guard,
    // must stay green): s already serves L1 with a user-set rotation of 5.
    let doc = makeDoc({
      stations: [
        makeStation({ id: 's', x: 0, y: 0, rotation: 5, stops: [makeStop('L1')] }),
        makeStation({ id: 't', x: 0, y: 100, rotation: 0, stops: [makeStop('L2')] }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s'] }), makeLine({ id: 'L2', stations: ['t'] })],
    });
    doc = T.toggleStationOnLine(doc, 'L2', 's'); // s joins L2 → [t, s]
    expect(doc.stations.s.rotation).toBe(5);
  });
});
