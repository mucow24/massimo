import { describe, it, expect, beforeEach } from 'vitest';
import {
  collectGroupSiblings,
  groupAlignExclude,
  hasGroupSiblings,
  movingStationIds,
  translateSiblings,
} from './groupDrag';
import { useDoc, useSelection } from '../../state/store';
import { DEFAULT_DOC } from '../../model/transforms';
import { makeLineCircle, makeStation, makeStop } from '../../test/fixtures';

// Line circles as group-drag members. A ring is a FRAME: it carries the stations
// bound to it (moveLineCircle), so the towing rules have to keep those
// passengers out of the plain station towing — the drag twin of
// rotateItemsAround's `carriedByCircle`.

// c1 at (100,100) r 70 with s1 seated on its east point; free at (500,500).
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
      free: makeStation({ id: 'free', x: 500, y: 500 }),
    },
    lineCircles: {
      c1: makeLineCircle({ id: 'c1', x: 100, y: 100, radius: 70, locked: circleLocked }),
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
  });
});

describe('a line circle towed by another kind', () => {
  it('rides along when a co-selected station is grabbed, carrying its passengers', () => {
    useSelection.setState({ selectedStationIds: ['free'], selectedLineCircleIds: ['c1'] });
    const siblings = collectGroupSiblings('station', 'free');
    expect(hasGroupSiblings(siblings)).toBe(true);
    expect(siblings.lineCircles).toEqual([{ id: 'c1', startX: 100, startY: 100 }]);
    translateSiblings(siblings, 10, -4);
    const doc = useDoc.getState();
    expect(doc.lineCircles.c1).toMatchObject({ x: 110, y: 96 });
    // s1 isn't selected — it rides because its ring does.
    expect(doc.stations.s1).toMatchObject({ x: 180, y: 96 });
  });

  it('moves a co-selected passenger exactly ONCE (the ring carries it)', () => {
    useSelection.setState({
      selectedStationIds: ['free', 's1'],
      selectedLineCircleIds: ['c1'],
    });
    const siblings = collectGroupSiblings('station', 'free');
    // s1 is NOT in the towed list: a bound station's move reseats it on its
    // ring, so towing it as well would drift it round the rim.
    expect(siblings.stations).toEqual([]);
    expect(siblings.carriedStations).toEqual(['s1']);
    translateSiblings(siblings, 10, 0);
    // 10, not 20, and still exactly on the (moved) rim.
    expect(useDoc.getState().stations.s1).toMatchObject({ x: 180, y: 100 });
  });

  it('keeps ring passengers out of the snap pool — they move with the drag', () => {
    useSelection.setState({
      selectedStationIds: ['free', 's1'],
      selectedLineCircleIds: ['c1'],
    });
    const siblings = collectGroupSiblings('station', 'free');
    expect(movingStationIds(siblings)).toEqual(new Set(['s1']));
    const ex = groupAlignExclude('station', 'free', siblings);
    // The grabbed station and the carried passenger are both unstable targets.
    expect(ex.stationIds).toEqual(new Set(['free', 's1']));
  });

  it('never tows a locked ring, and then its passenger tows normally', () => {
    seed(true);
    useSelection.setState({
      selectedStationIds: ['free', 's1'],
      selectedLineCircleIds: ['c1'],
    });
    const siblings = collectGroupSiblings('station', 'free');
    expect(siblings.lineCircles).toEqual([]);
    // The ring stays, so nobody carries s1: it tows on its own (and slides
    // along the stationary rim, as any bound station drag does).
    expect(siblings.carriedStations).toEqual([]);
    expect(siblings.stations).toEqual([{ id: 's1', startX: 170, startY: 100 }]);
    translateSiblings(siblings, 10, 0);
    expect(useDoc.getState().lineCircles.c1).toMatchObject({ x: 100, y: 100 });
  });
});

describe('a line circle as the grabbed master', () => {
  it('tows the rest of the selection, and carries its own passengers itself', () => {
    useSelection.setState({
      selectedStationIds: ['free', 's1'],
      selectedLineCircleIds: ['c1'],
    });
    const siblings = collectGroupSiblings('lineCircle', 'c1');
    expect(siblings.lineCircles).toEqual([]); // the grabbed ring is excluded
    expect(siblings.stations).toEqual([{ id: 'free', startX: 500, startY: 500 }]);
    expect(siblings.carriedStations).toEqual(['s1']);
    // The pool excludes the passenger even though nothing tows it.
    expect(groupAlignExclude('lineCircle', 'c1', siblings).stationIds).toEqual(
      new Set(['free', 's1']),
    );
  });

  it('tows nothing when the grabbed ring is not part of the selection', () => {
    useSelection.setState({ selectedStationIds: ['free'] });
    const siblings = collectGroupSiblings('lineCircle', 'c1');
    expect(hasGroupSiblings(siblings)).toBe(false);
    expect(siblings.stations).toEqual([]);
  });
});
