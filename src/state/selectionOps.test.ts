import { describe, it, expect, beforeEach } from 'vitest';
import { stationsCarriedByCircles, unlockedSelectedItemIds } from './selectionOps';
import { useDoc, useSelection } from './store';
import { useViewportStore } from './viewportStore';
import { DEFAULT_DOC } from '../model/transforms';
import { collectGroupSiblings } from '../components/canvas/groupDrag';
import {
  makeGuide,
  makeLineCircle,
  makePolygon,
  makeRouteBullet,
  makeStation,
  makeStop,
  makeSvgImage,
  makeTextLabel,
} from '../test/fixtures';

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
  // carriedStations". They share the VISIBILITY answer (`visibleSelectionKinds`)
  // but not the rest — the drag half re-derives lock inline and works in start
  // positions, the keyboard half inherits lock from unlockedSelectedItemIds — so
  // the claim is worth pinning: a filter added to one and not the other would
  // file a passenger as carried by a ring that never moves, and the group would
  // arrive in pieces.
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

// The ring block above pins the two halves against ONE layer's toggle. The
// visibility gate itself is per kind, and both halves resolve it from the same
// table (`visibleSelectionKinds`) — this is that table's behavioural pin: for
// every selectable kind, switching its View-menu row off drops it from the
// keyboard half AND from the drag tow, and drops nothing else. Without it a kind
// gated on one side only looks right until the layer is hidden, and then a
// Delete removes something with nothing on screen, or a tow leaves one member
// standing where the rest of the group moved off.
describe('every selectable kind is gated identically on both halves', () => {
  // One selected item of each kind. Two stations because the drag grabs one and
  // `collectGroupSiblings` reports every OTHER selected item; the rings carry no
  // passengers, so `carriedStations` stays out of it.
  const seedAll = () => {
    useDoc.setState({
      ...useDoc.getState(),
      ...DEFAULT_DOC,
      stations: {
        grab: makeStation({ id: 'grab', x: 0, y: 0 }),
        s1: makeStation({ id: 's1', x: 50, y: 0 }),
      },
      routeBullets: { b1: makeRouteBullet({ id: 'b1' }) },
      textLabels: { t1: makeTextLabel({ id: 't1' }) },
      polygons: { p1: makePolygon({ id: 'p1' }) },
      svgImages: { i1: makeSvgImage({ id: 'i1' }) },
      transferAnchors: { a1: { id: 'a1', x: 10, y: 10 } },
      lineCircles: { c9: makeLineCircle({ id: 'c9', x: 900, y: 900, radius: 40 }) },
      guides: { g1: makeGuide({ id: 'g1' }) },
    });
    useSelection.setState({
      selectedStationIds: ['grab', 's1'],
      selectedRouteBulletIds: ['b1'],
      selectedLabelIds: ['t1'],
      selectedPolygonIds: ['p1'],
      selectedSvgImageIds: ['i1'],
      selectedAnchorIds: ['a1'],
      selectedLineCircleIds: ['c9'],
      selectedGuideIds: ['g1'],
    });
    // Every layer explicitly ON — the baseline each case switches ONE row off
    // from. Spelled out rather than left to the defaults because `showAnchors`
    // ships OFF, and because the store is shared: a case that hid a row would
    // otherwise leave it hidden for the next.
    useViewportStore.setState({
      showNetwork: true,
      showRouteBullets: true,
      showTextLabels: true,
      showPolygons: true,
      showSvgImages: true,
      showAnchors: true,
      showLineCircles: true,
      showGuides: true,
    });
  };

  // Both halves reduced to the same shape: kind → the ids it would act on. The
  // drag half never reports the grabbed station, so the keyboard half drops it
  // too — the comparison is about the GATE, not about that exclusion.
  const kindIds = (): { keyboard: Record<string, string[]>; drag: Record<string, string[]> } => {
    const k = unlockedSelectedItemIds();
    const d = collectGroupSiblings('station', 'grab');
    const kinds = ['stations', 'bullets', 'labels', 'polygons', 'svgImages', 'anchors', 'guides'];
    const pick = <T>(o: Record<string, T[]>, f: (v: T) => string) =>
      Object.fromEntries(
        kinds.map((n) => [
          n,
          o[n]
            .map(f)
            .filter((id) => id !== 'grab')
            .sort(),
        ]),
      );
    return {
      keyboard: pick(k as unknown as Record<string, string[]>, (id) => id),
      drag: pick(d as unknown as Record<string, { id: string }[]>, (s) => s.id),
    };
  };

  const cases: readonly [string, keyof ReturnType<typeof kindIds>['keyboard'], string][] = [
    ['showNetwork', 'stations', 's1'],
    ['showRouteBullets', 'bullets', 'b1'],
    ['showTextLabels', 'labels', 't1'],
    ['showPolygons', 'polygons', 'p1'],
    ['showSvgImages', 'svgImages', 'i1'],
    ['showAnchors', 'anchors', 'a1'],
    ['showGuides', 'guides', 'g1'],
  ];

  beforeEach(seedAll);

  it('shows every kind with every layer on', () => {
    const { keyboard, drag } = kindIds();
    for (const [, kind, id] of cases) expect(keyboard[kind]).toEqual([id]);
    expect(keyboard).toEqual(drag);
  });

  it.each(cases)('hiding %s empties %s on both halves, and nothing else', (flag, kind) => {
    useViewportStore.setState({ [flag]: false });
    const { keyboard, drag } = kindIds();
    expect(keyboard[kind]).toEqual([]);
    expect(keyboard).toEqual(drag);
    // Only the kinds the flag actually governs go: showNetwork also takes the
    // anchors with it (they nest under the master switch), and nothing else
    // nests, so every other kind is still there.
    const alsoGone = flag === 'showNetwork' ? [kind, 'anchors'] : [kind];
    for (const [, other, id] of cases) {
      if (!alsoGone.includes(other)) expect(keyboard[other]).toEqual([id]);
    }
  });
});
