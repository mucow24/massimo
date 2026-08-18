import { describe, it, expect, beforeEach } from 'vitest';
import { dispatchMirrored } from './mirrorDispatch';
import { beginHistoryGroup, useDoc } from './store';
import { useSelection } from './selection';
import { clearHistory, historyDepth } from './history';
import { DEFAULT_DOC } from '../model/transforms';
import { makeDoc, makeLine, makeStation, makeStop } from '../test/fixtures';

// Two stations that render identically and share line L1 — a genuine
// mirror-match pair, so captureMirrorTargets returns both when matching is on.
function loadMatchingPair() {
  const doc = makeDoc({
    stations: [
      makeStation({ id: 's1', stops: [makeStop('L1')] }),
      makeStation({ id: 's2', stops: [makeStop('L1')] }),
    ],
    lines: [makeLine({ id: 'L1', stations: ['s1', 's2'] })],
  });
  useDoc.getState().loadDoc(doc);
}

const setDotSize = (sid: string, n: number) => useDoc.getState().setDotSize(sid, 'L1', n);

describe('dispatchMirrored — history grouping', () => {
  beforeEach(() => {
    localStorage.clear();
    useDoc.setState({ ...DEFAULT_DOC });
    useSelection.setState({ mirrorMatching: false });
    clearHistory();
  });

  it('wraps a genuine fan-out in exactly ONE history entry', () => {
    loadMatchingPair();
    useSelection.getState().setMirrorMatching(true);
    clearHistory();

    dispatchMirrored('s1', (sid) => setDotSize(sid, 6));

    // Both stations changed, but the broadcast collapses into a single entry.
    expect(useDoc.getState().stations['s1'].stops[0].dotSize).toBe(6);
    expect(useDoc.getState().stations['s2'].stops[0].dotSize).toBe(6);
    expect(historyDepth()).toBe(1);
  });

  it('does NOT open a nested group when a group is already open (#146)', () => {
    // The #146 branch: a broadcast fired from inside an already-open group
    // (e.g. a focused numeric field's edit arc) must reuse that group, not
    // open a second one. Otherwise the outer group's pending write and the
    // broadcast land as two separate undo entries instead of one.
    loadMatchingPair();
    useSelection.getState().setMirrorMatching(true);
    clearHistory();

    const outer = beginHistoryGroup();
    // A pending change in the same arc, on something outside the matched pair
    // (so it doesn't dissolve the match before the broadcast captures it).
    useDoc.getState().addLine();
    dispatchMirrored('s1', (sid) => setDotSize(sid, 6));
    outer.commit();

    // One arc → one entry. A nested group would steal the outer and commit
    // twice, leaving depth 2.
    expect(historyDepth()).toBe(1);
  });

  it('does not fan out to the match when matching is off', () => {
    loadMatchingPair();
    // mirrorMatching stays off → captureMirrorTargets returns just the source.
    clearHistory();

    dispatchMirrored('s1', (sid) => setDotSize(sid, 6));

    expect(useDoc.getState().stations['s1'].stops[0].dotSize).toBe(6);
    expect(useDoc.getState().stations['s2'].stops[0].dotSize).toBeUndefined();
    expect(historyDepth()).toBe(1);
  });

  it('sees the rings: a seat between the octants does not receive the broadcast', () => {
    // Pins that THIS path hands lineCircles to the matcher. s2 is bound to a
    // ring at angle 100° — its octant rotation matches s1's, but its painted
    // frame sits 10° off, so it is only rejected when the rings reach
    // findMatchingStations. A two-field pick here would fan the edit out to a
    // station that renders differently (the pre-fix bug).
    const doc = makeDoc({
      stations: [
        makeStation({ id: 's1', x: 600, y: 600, rotation: 4, stops: [makeStop('L1')] }),
        makeStation({
          id: 's2',
          x: -34.73,
          y: 196.96,
          rotation: 4,
          circleId: 'c1',
          stops: [makeStop('L1')],
        }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1', 's2'] })],
      lineCircles: [{ id: 'c1', x: 0, y: 0, radius: 200 }],
    });
    useDoc.getState().loadDoc(doc);
    useSelection.getState().setMirrorMatching(true);
    clearHistory();

    dispatchMirrored('s1', (sid) => setDotSize(sid, 6));

    expect(useDoc.getState().stations['s1'].stops[0].dotSize).toBe(6);
    expect(useDoc.getState().stations['s2'].stops[0].dotSize).toBeUndefined();
  });
});
