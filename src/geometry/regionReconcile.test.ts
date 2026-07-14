import { describe, it, expect } from 'vitest';
import { reconcileRegionAssignments } from './regionReconcile';
import { regionsFor, type GeometrySlice } from './regionCache';
import { mintAnchors, resolveRegionWinners } from './lineRegions';
import { makeLine, makeStation, makeStop } from '../test/fixtures';
import type { RegionAssignment, Station, Line } from '../model/types';

const geom = (stations: Station[], lines: Line[]): GeometrySlice => {
  const st: GeometrySlice['stations'] = {};
  for (const s of stations) st[s.id] = s;
  const ln: GeometrySlice['lines'] = {};
  for (const l of lines) ln[l.id] = l;
  return { stations: st, lines: ln };
};

const station = (id: string, x: number, y: number, lineIds: string[]): Station =>
  makeStation({ id, x, y, stops: lineIds.map((l) => makeStop(l)) });

/** l1 horizontal (0,0)→(400,0); l2 vertical at x crossing it. */
const crossGeom = (x: number, extraStations: Station[] = [], extraLines: Line[] = []) =>
  geom(
    [
      station('s1', 0, 0, ['l1']),
      station('s2', 400, 0, ['l1']),
      station('s3', x, -50, ['l2']),
      station('s4', x, 50, ['l2']),
      ...extraStations,
    ],
    [
      makeLine({ id: 'l1', stations: ['s1', 's2'] }),
      makeLine({ id: 'l2', stations: ['s3', 's4'] }),
      ...extraLines,
    ],
  );

/** A fresh assignment putting l2 on top of the (only) overlap face. */
const assignmentAt = (g: GeometrySlice, id = 'r1'): RegionAssignment => {
  const { bands, faces } = regionsFor(g);
  expect(faces.length).toBeGreaterThan(0);
  return { id, lineId: 'l2', lines: faces[0].lineIds, anchors: mintAnchors(faces[0], bands) };
};

let mintCounter = 0;
const mintId = () => `mint${mintCounter++}`;

const winnersOf = (g: GeometrySlice, assignments: Record<string, RegionAssignment>) => {
  const { bands, faces } = regionsFor(g);
  return resolveRegionWinners(faces, assignments, bands, Object.keys(g.lines)).map((w, i) => ({
    ...w,
    lineIds: faces[i].lineIds,
  }));
};

describe('reconcileRegionAssignments', () => {
  it('keeps the assignment across a small nudge (re-binds, winner intact)', () => {
    const before = crossGeom(50);
    const asg = assignmentAt(before);
    const after = crossGeom(60);
    const out = reconcileRegionAssignments(before, after, { r1: asg }, mintId);
    expect(Object.keys(out)).toEqual(['r1']);
    const winners = winnersOf(after, out);
    expect(winners[0].winner).toBe('l2');
    expect(winners[0].assignmentId).toBe('r1');
  });

  it('follows a crossing dragged far across the map (teleport-sized delta)', () => {
    const before = crossGeom(50);
    const asg = assignmentAt(before);
    const after = crossGeom(300);
    const out = reconcileRegionAssignments(before, after, { r1: asg }, mintId);
    expect(Object.keys(out)).toEqual(['r1']);
    expect(winnersOf(after, out)[0].winner).toBe('l2');
  });

  it('split: routing a third line through the region keeps BOTH halves painted', () => {
    const before = crossGeom(50);
    const asg = assignmentAt(before);
    const after = crossGeom(
      50,
      [station('s5', 30, -20, ['l3']), station('s6', 70, 20, ['l3'])],
      [makeLine({ id: 'l3', stations: ['s5', 's6'] })],
    );
    const out = reconcileRegionAssignments(before, after, { r1: asg }, mintId);
    expect(Object.keys(out).length).toBeGreaterThanOrEqual(2);
    for (const w of winnersOf(after, out)) {
      if (w.lineIds.includes('l1') && w.lineIds.includes('l2')) expect(w.winner).toBe('l2');
    }
  });

  it('move AND split in one gesture still covers every descendant half', () => {
    const before = crossGeom(50);
    const asg = assignmentAt(before);
    const after = crossGeom(
      300,
      [station('s5', 280, -20, ['l3']), station('s6', 320, 20, ['l3'])],
      [makeLine({ id: 'l3', stations: ['s5', 's6'] })],
    );
    const out = reconcileRegionAssignments(before, after, { r1: asg }, mintId);
    for (const w of winnersOf(after, out)) {
      if (w.lineIds.includes('l1') && w.lineIds.includes('l2')) expect(w.winner).toBe('l2');
    }
  });

  it('merge: removing the cutting line collapses duplicates to one assignment', () => {
    const split = crossGeom(
      50,
      [station('s5', 30, -20, ['l3']), station('s6', 70, 20, ['l3'])],
      [makeLine({ id: 'l3', stations: ['s5', 's6'] })],
    );
    const beforeSplit = crossGeom(50);
    const populated = reconcileRegionAssignments(
      beforeSplit,
      split,
      { r1: assignmentAt(beforeSplit) },
      mintId,
    );
    expect(Object.keys(populated).length).toBeGreaterThanOrEqual(2);
    // Now delete l3 (cover shrink is the transform cascade's job; reconcile
    // sees covers that still name only live lines).
    const healedInput: Record<string, RegionAssignment> = {};
    for (const id of Object.keys(populated)) {
      const a = populated[id];
      healedInput[id] = {
        ...a,
        lines: a.lines.filter((l) => l !== 'l3'),
        anchors: a.anchors.filter((x) => x.lineId !== 'l3'),
      };
    }
    const after = crossGeom(50);
    const out = reconcileRegionAssignments(split, after, healedInput, mintId);
    expect(Object.keys(out)).toHaveLength(1);
    expect(winnersOf(after, out)[0].winner).toBe('l2');
  });

  it('translates anchors across an edge split (station added mid-edge)', () => {
    const before = crossGeom(50);
    const asg = assignmentAt(before);
    expect(asg.anchors.some((a) => a.pairKey === 's1|s2')).toBe(true);
    // l1 gains s5 at (25,0): edge s1|s2 → s1|s5 + s2|s5.
    const after = geom(
      [
        station('s1', 0, 0, ['l1']),
        station('s5', 25, 0, ['l1']),
        station('s2', 400, 0, ['l1']),
        station('s3', 50, -50, ['l2']),
        station('s4', 50, 50, ['l2']),
      ],
      [
        makeLine({ id: 'l1', stations: ['s1', 's5', 's2'] }),
        makeLine({ id: 'l2', stations: ['s3', 's4'] }),
      ],
    );
    const out = reconcileRegionAssignments(before, after, { r1: asg }, mintId);
    expect(Object.keys(out)).toEqual(['r1']);
    expect(out.r1.anchors.every((a) => a.pairKey !== 's1|s2')).toBe(true);
    expect(winnersOf(after, out)[0].winner).toBe('l2');
  });

  it('translates anchors across an edge heal (through-station deleted)', () => {
    const withMid = geom(
      [
        station('s1', 0, 0, ['l1']),
        station('s5', 25, 0, ['l1']),
        station('s2', 400, 0, ['l1']),
        station('s3', 50, -50, ['l2']),
        station('s4', 50, 50, ['l2']),
      ],
      [
        makeLine({ id: 'l1', stations: ['s1', 's5', 's2'] }),
        makeLine({ id: 'l2', stations: ['s3', 's4'] }),
      ],
    );
    const asg = assignmentAt(withMid);
    const after = crossGeom(50);
    const out = reconcileRegionAssignments(withMid, after, { r1: asg }, mintId);
    expect(Object.keys(out)).toEqual(['r1']);
    expect(winnersOf(after, out)[0].winner).toBe('l2');
  });

  it('keeps a dormant assignment verbatim and rebinds when the overlap returns', () => {
    const before = crossGeom(50);
    const asg = assignmentAt(before);
    const apart = crossGeom(1000); // vertical line far off the horizontal
    const dormant = reconcileRegionAssignments(before, apart, { r1: asg }, mintId);
    expect(dormant.r1).toBeDefined();
    expect(regionsFor(apart).faces).toHaveLength(0);
    const back = crossGeom(55);
    const rebound = reconcileRegionAssignments(apart, back, dormant, mintId);
    expect(winnersOf(back, rebound)[0].winner).toBe('l2');
  });

  it('drops assignments whose chosen line no longer exists', () => {
    const before = crossGeom(50);
    const asg = assignmentAt(before);
    const after = geom(
      [station('s1', 0, 0, ['l1']), station('s2', 400, 0, ['l1'])],
      [makeLine({ id: 'l1', stations: ['s1', 's2'] })],
    );
    const out = reconcileRegionAssignments(before, after, { r1: asg }, mintId);
    expect(out).toEqual({});
  });

  it('resolves two assignments merging into one face deterministically (first id wins)', () => {
    const two = (x1: number, x2: number) =>
      geom(
        [
          station('s1', 0, 0, ['l1']),
          station('s2', 400, 0, ['l1']),
          station('s3', x1, -50, ['l2']),
          station('s4', x1, 50, ['l2']),
          station('s5', x2, -50, ['l2']),
          station('s6', x2, 50, ['l2']),
        ],
        [
          makeLine({ id: 'l1', stations: ['s1', 's2'] }),
          makeLine({ id: 'l2', stations: ['s3', 's4'], edges: ['s3|s4', 's5|s6'] }),
        ],
      );
    const before = two(100, 300);
    const { bands, faces } = regionsFor(before);
    expect(faces).toHaveLength(2);
    const assignments: Record<string, RegionAssignment> = {
      r1: {
        id: 'r1',
        lineId: 'l2',
        lines: faces[0].lineIds,
        anchors: mintAnchors(faces[0], bands),
      },
      r2: {
        id: 'r2',
        lineId: 'l2',
        lines: faces[1].lineIds,
        anchors: mintAnchors(faces[1], bands),
      },
    };
    const after = two(200, 200); // both corridors coincide → one face
    const out = reconcileRegionAssignments(before, after, assignments, mintId);
    expect(Object.keys(out)).toEqual(['r1']);
  });

  it('is idempotent and reference-stable', () => {
    const before = crossGeom(50);
    const asg = assignmentAt(before);
    const after = crossGeom(60);
    const out = reconcileRegionAssignments(before, after, { r1: asg }, mintId);
    expect(reconcileRegionAssignments(after, after, out, mintId)).toBe(out);
    const empty: Record<string, RegionAssignment> = {};
    expect(reconcileRegionAssignments(before, after, empty, mintId)).toBe(empty);
  });
});
