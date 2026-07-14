import { describe, it, expect, beforeEach } from 'vitest';
import { beginHistoryGroup, useDoc } from './store';
import { undo, historyDepth } from './history';
import { DEFAULT_DOC } from '../model/transforms';
import { makeLine, makeStation, makeStop } from '../test/fixtures';
import { regionsFor } from '../geometry/regionCache';
import { mintAnchors, resolveRegionWinners } from '../geometry/lineRegions';
import type { RegionAssignment, Station } from '../model/types';

const station = (id: string, x: number, y: number, lineIds: string[]): Station =>
  makeStation({ id, x, y, stops: lineIds.map((l) => makeStop(l)) });

/** Seed the store with a horizontal l1 crossed by a vertical l2 at x=50. */
function seedCross(): RegionAssignment {
  const stations = {
    s1: station('s1', 0, 0, ['l1']),
    s2: station('s2', 400, 0, ['l1']),
    s3: station('s3', 50, -50, ['l2']),
    s4: station('s4', 50, 50, ['l2']),
  };
  const lines = {
    l1: makeLine({ id: 'l1', stations: ['s1', 's2'] }),
    l2: makeLine({ id: 'l2', stations: ['s3', 's4'] }),
  };
  const geom = { stations, lines };
  const { bands, faces } = regionsFor(geom);
  const asg: RegionAssignment = {
    id: 'r1',
    lineId: 'l2',
    lines: faces[0].lineIds,
    anchors: mintAnchors(faces[0], bands),
  };
  useDoc.setState({
    ...useDoc.getState(),
    ...DEFAULT_DOC,
    stations,
    lines,
    lineOrder: ['l1', 'l2'],
    regionAssignments: { r1: asg },
  });
  return asg;
}

/** Effective winner of every current overlap face, from live store state. */
function currentWinners(): string[] {
  const s = useDoc.getState();
  const { bands, faces } = regionsFor({ stations: s.stations, lines: s.lines });
  return resolveRegionWinners(faces, s.regionAssignments, bands, s.lineOrder).map((w) => w.winner);
}

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
});

describe('region reconcile — store wiring', () => {
  it('reconciles inline on an ungrouped one-shot geometry action', () => {
    const before = seedCross();
    // Teleport the whole vertical corridor: two one-shot moves.
    useDoc.getState().moveStation('s3', 300, -50);
    useDoc.getState().moveStation('s4', 300, 50);
    const after = useDoc.getState().regionAssignments.r1;
    expect(after).toBeDefined();
    expect(after.anchors).not.toEqual(before.anchors); // re-minted at the new spot
    expect(currentWinners()).toEqual(['l2']); // the choice followed the crossing
  });

  it('does NOT reconcile per streamed write inside a history group; once at commit', () => {
    const before = seedCross();
    const depth0 = historyDepth();
    const group = beginHistoryGroup();
    useDoc.getState().moveStation('s3', 200, -50);
    // Mid-gesture: assignments untouched (reconcile deferred to commit).
    expect(useDoc.getState().regionAssignments.r1.anchors).toEqual(before.anchors);
    useDoc.getState().moveStation('s3', 300, -50);
    useDoc.getState().moveStation('s4', 300, 50);
    group.commit();
    const after = useDoc.getState().regionAssignments.r1;
    expect(after.anchors).not.toEqual(before.anchors);
    expect(currentWinners()).toEqual(['l2']);
    // One entry for the whole gesture INCLUDING the reconcile write.
    expect(historyDepth()).toBe(depth0 + 1);
  });

  it('undo restores geometry and assignments as one consistent pair', () => {
    const before = seedCross();
    const group = beginHistoryGroup();
    useDoc.getState().moveStation('s3', 300, -50);
    useDoc.getState().moveStation('s4', 300, 50);
    group.commit();
    undo();
    expect(useDoc.getState().stations.s3.x).toBe(50);
    expect(useDoc.getState().regionAssignments.r1.anchors).toEqual(before.anchors);
    expect(currentWinners()).toEqual(['l2']);
  });

  it('leaves assignments untouched when a group changes no geometry', () => {
    seedCross();
    const ref = useDoc.getState().regionAssignments;
    const group = beginHistoryGroup();
    useDoc.getState().renameStation('s1', 'Renamed');
    group.commit();
    expect(useDoc.getState().regionAssignments).toBe(ref);
  });

  it('leaves assignments untouched on a non-geometry one-shot', () => {
    seedCross();
    const ref = useDoc.getState().regionAssignments;
    useDoc.getState().updateLine('l1', { color: '#ff0000' });
    expect(useDoc.getState().regionAssignments).toBe(ref);
  });

  it('reconciles on a width change (geometry) without losing the choice', () => {
    seedCross();
    useDoc.getState().setLineWidth('l1', 20);
    expect(useDoc.getState().regionAssignments.r1).toBeDefined();
    expect(currentWinners()).toEqual(['l2']);
  });
});
