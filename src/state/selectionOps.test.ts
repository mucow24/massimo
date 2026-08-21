import { describe, it, expect, beforeEach } from 'vitest';
import { stationsCarriedByCircles, unlockedSelectedItemIds } from './selectionOps';
import { useDoc, useSelection } from './store';
import { useViewportStore } from './viewportStore';
import { DEFAULT_DOC } from '../model/transforms';
import { collectGroupSiblings } from '../components/canvas/groupDrag';
import { makeLineCircle, makeStation, makeStop } from '../test/fixtures';

// The keyboard half of "a ring carries its passengers": arrow-nudging a
// selected line circle must not ALSO write the stations bound to it, because
// moveLineCircle already took them along and moveStation would reseat each one
// on a rim that has already moved. groupDrag's `carriedStations` is the drag
// half and has its own suite; these are the rules the keyboard path relies on,
// plus the agreement between the two that selectionOps' docstring claims.

// c1 at (100,100) r 70 with two seated stations (one locked, one not, neither
// selected) and one free station well away from the ring.
const seed = (circleLocked?: boolean) =>
  useDoc.setState({
    ...useDoc.getState(),
    ...DEFAULT_DOC,
    stations: {
      s1: makeStation({
        id: 's1',
        x: 170,
        y: 100,
        circleId: 'c1',
        stops: [makeStop('l1', { viaCircle: true })],
      }),
      s2: makeStation({
        id: 's2',
        x: 100,
        y: 170,
        circleId: 'c1',
        locked: true,
        stops: [makeStop('l1', { viaCircle: true })],
      }),
      free: makeStation({ id: 'free', x: 500, y: 500 }),
    },
    lineCircles: {
      c1: makeLineCircle({ id: 'c1', x: 100, y: 100, radius: 70, locked: circleLocked }),
      c2: makeLineCircle({ id: 'c2', x: 900, y: 900, radius: 40 }),
    },
  });

beforeEach(() => {
  seed();
  useSelection.setState({
    ...useSelection.getState(),
    selectedStationIds: [],
    selectedRouteBulletIds: [],
    selectedLabelIds: [],
    selectedPolygonIds: [],
    selectedSvgImageIds: [],
    selectedAnchorIds: [],
    selectedLineCircleIds: [],
    selectedGuideIds: [],
  });
  useViewportStore.setState({ showNetwork: true, showLineCircles: true });
});

describe('stationsCarriedByCircles', () => {
  it('carries every station bound to a moving ring, selected or not, locked or not', () => {
    // Neither s1 nor s2 is selected and s2 is locked: the ring takes both
    // regardless, because moveLineCircle does not consult either.
    expect(stationsCarriedByCircles(['c1'])).toEqual(new Set(['s1', 's2']));
  });

  it('leaves the passengers of a ring that is not moving alone', () => {
    expect(stationsCarriedByCircles(['c2'])).toEqual(new Set());
  });

  it('carries nothing when no ring moves', () => {
    expect(stationsCarriedByCircles([])).toEqual(new Set());
  });
});

describe('the ring passengers a nudge must skip', () => {
  it('files a bound station as carried when its ring is selected', () => {
    useSelection.setState({ selectedStationIds: ['s1', 'free'], selectedLineCircleIds: ['c1'] });
    const ids = unlockedSelectedItemIds();
    expect(ids.lineCircles).toEqual(['c1']);
    const carried = stationsCarriedByCircles(ids.lineCircles);
    // App.tsx skips these in its station loop, so s1 is written once (by the
    // ring) and `free` is nudged on its own.
    expect(carried.has('s1')).toBe(true);
    expect(carried.has('free')).toBe(false);
  });

  it('tows a passenger normally when its ring is LOCKED — the ring never moves', () => {
    seed(true);
    useSelection.setState({ selectedStationIds: ['s1'], selectedLineCircleIds: ['c1'] });
    const ids = unlockedSelectedItemIds();
    // The lock filter drops the ring, so nothing carries s1 and the station
    // loop nudges it itself (sliding along the stationary rim).
    expect(ids.lineCircles).toEqual([]);
    expect(stationsCarriedByCircles(ids.lineCircles).has('s1')).toBe(false);
    expect(ids.stations).toEqual(['s1']);
  });

  it('tows a passenger normally while the line-circle layer is hidden', () => {
    useViewportStore.setState({ showLineCircles: false });
    useSelection.setState({ selectedStationIds: ['s1'], selectedLineCircleIds: ['c1'] });
    const ids = unlockedSelectedItemIds();
    expect(ids.lineCircles).toEqual([]);
    expect(stationsCarriedByCircles(ids.lineCircles).has('s1')).toBe(false);
  });
});

describe('the keyboard twin agrees with the drag half', () => {
  // selectionOps calls itself "the keyboard twin of groupDrag's
  // carriedStations". The two read different filters to get there (the drag
  // half re-derives lock/visibility inline; the keyboard half inherits them
  // from unlockedSelectedItemIds), so the claim is worth pinning: a filter
  // added to one and not the other would file a passenger as carried by a ring
  // that never moves, and the group would arrive in pieces.
  const bothHalves = (): [ReadonlySet<string>, ReadonlySet<string>] => [
    stationsCarriedByCircles(unlockedSelectedItemIds().lineCircles),
    new Set(collectGroupSiblings('station', 'free').carriedStations),
  ];

  it('agrees for a selected, unlocked, visible ring', () => {
    useSelection.setState({ selectedStationIds: ['free', 's1'], selectedLineCircleIds: ['c1'] });
    const [keyboard, drag] = bothHalves();
    expect(keyboard).toEqual(new Set(['s1', 's2']));
    expect(keyboard).toEqual(drag);
  });

  it('agrees for a LOCKED ring', () => {
    seed(true);
    useSelection.setState({ selectedStationIds: ['free', 's1'], selectedLineCircleIds: ['c1'] });
    const [keyboard, drag] = bothHalves();
    expect(keyboard).toEqual(new Set());
    expect(keyboard).toEqual(drag);
  });

  it('agrees while the line-circle layer is hidden', () => {
    useViewportStore.setState({ showLineCircles: false });
    useSelection.setState({ selectedStationIds: ['free', 's1'], selectedLineCircleIds: ['c1'] });
    const [keyboard, drag] = bothHalves();
    expect(keyboard).toEqual(new Set());
    expect(keyboard).toEqual(drag);
  });
});
