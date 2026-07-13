import { describe, it, expect } from 'vitest';
import { DEFAULT_DOC, assignRegion, deleteLine, setRegionAssignments } from './transforms';
import { makeLine, makeStation, makeStop } from '../test/fixtures';
import type { MapDoc, RegionAssignment } from './types';

const asg = (over: Partial<RegionAssignment> = {}): RegionAssignment => ({
  id: 'r1',
  lineId: 'l2',
  lines: ['l1', 'l2'],
  anchors: [
    { lineId: 'l1', pairKey: 's1|s2', anchorEnd: 'from', distance: 50 },
    { lineId: 'l2', pairKey: 's3|s4', anchorEnd: 'from', distance: 50 },
  ],
  ...over,
});

const docWithLines = (): MapDoc => ({
  ...DEFAULT_DOC,
  stations: {
    s1: makeStation({ id: 's1', stops: [makeStop('l1')] }),
    s2: makeStation({ id: 's2', x: 100, stops: [makeStop('l1')] }),
    s3: makeStation({ id: 's3', y: -50, stops: [makeStop('l2')] }),
    s4: makeStation({ id: 's4', y: 50, stops: [makeStop('l2')] }),
  },
  lines: {
    l1: makeLine({ id: 'l1', stations: ['s1', 's2'] }),
    l2: makeLine({ id: 'l2', stations: ['s3', 's4'] }),
    l3: makeLine({ id: 'l3' }),
  },
  lineOrder: ['l1', 'l2', 'l3'],
});

describe('setRegionAssignments', () => {
  it('replaces the record', () => {
    const doc = docWithLines();
    const next = { r1: asg() };
    const out = setRegionAssignments(doc, next);
    expect(out.regionAssignments).toEqual(next);
    expect(out).not.toBe(doc);
  });

  it('returns the same doc reference when nothing changed', () => {
    const a = asg();
    const doc = { ...docWithLines(), regionAssignments: { r1: a } };
    expect(setRegionAssignments(doc, { r1: a })).toBe(doc);
    const empty = docWithLines();
    expect(setRegionAssignments(empty, {})).toBe(empty);
  });
});

describe('assignRegion', () => {
  it('upserts an assignment by id', () => {
    const doc = docWithLines();
    const out = assignRegion(doc, 'r1', asg());
    expect(out.regionAssignments.r1.lineId).toBe('l2');
    const updated = assignRegion(out, 'r1', asg({ lineId: 'l1' }));
    expect(updated.regionAssignments.r1.lineId).toBe('l1');
  });

  it('deletes an assignment with null', () => {
    const doc = assignRegion(docWithLines(), 'r1', asg());
    const out = assignRegion(doc, 'r1', null);
    expect(out.regionAssignments).toEqual({});
  });

  it('no-ops (same reference) when deleting a missing id or re-writing the same value', () => {
    const doc = docWithLines();
    expect(assignRegion(doc, 'nope', null)).toBe(doc);
    const a = asg();
    const withA = assignRegion(doc, 'r1', a);
    expect(assignRegion(withA, 'r1', a)).toBe(withA);
  });
});

describe('deleteLine — regionAssignments cascade', () => {
  it('drops assignments whose chosen line died', () => {
    const doc = assignRegion(docWithLines(), 'r1', asg());
    const out = deleteLine(doc, 'l2');
    expect(out.regionAssignments).toEqual({});
  });

  it('drops assignments when any covering line died', () => {
    const doc = assignRegion(docWithLines(), 'r1', asg());
    const out = deleteLine(doc, 'l1'); // cover member, not the chosen line
    expect(out.regionAssignments).toEqual({});
  });

  it('keeps the record reference when no assignment is affected', () => {
    const doc = assignRegion(docWithLines(), 'r1', asg());
    const out = deleteLine(doc, 'l3');
    expect(out.regionAssignments).toBe(doc.regionAssignments);
    expect(out.regionAssignments.r1).toBeDefined();
  });
});
