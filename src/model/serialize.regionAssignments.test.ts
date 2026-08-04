import { describe, it, expect } from 'vitest';
import { serialize, parse } from './serialize';
import { DEFAULT_DOC } from './transforms';
import { makeLine, makeStation, makeStop } from '../test/fixtures';
import type { MapDoc, RegionAssignment } from './types';

const baseDoc = (): MapDoc => ({
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
  },
  lineOrder: ['l1', 'l2'],
});

const asg = (over: Partial<RegionAssignment> = {}): RegionAssignment => ({
  id: 'r1',
  lineId: 'l2',
  lines: ['l1', 'l2'],
  anchors: [
    { lineId: 'l1', pairKey: 's1|s2', anchorEnd: 'from', distance: 50 },
    { lineId: 'l2', pairKey: 's3|s4', anchorEnd: 'to', distance: 50 },
  ],
  ...over,
});

const roundTrip = (doc: MapDoc): MapDoc => {
  const res = parse(serialize(doc), []);
  if (!res.ok) throw new Error(`parse failed: ${res.error}`);
  return res.doc;
};

describe('serialize / parse — regionAssignments', () => {
  it('round-trips assignments verbatim', () => {
    const doc = { ...baseDoc(), regionAssignments: { r1: asg() } };
    expect(roundTrip(doc).regionAssignments).toEqual(doc.regionAssignments);
  });

  it('backfills the field for saves that predate it', () => {
    const raw = JSON.parse(serialize(baseDoc()));
    delete raw.doc.regionAssignments;
    const res = parse(JSON.stringify(raw), []);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.doc.regionAssignments).toEqual({});
  });

  it('drops assignments whose chosen line or cover lines dangle', () => {
    const doc = {
      ...baseDoc(),
      regionAssignments: {
        r1: asg({ id: 'r1', lineId: 'ghost' }),
        r2: asg({ id: 'r2', lines: ['l1', 'ghost'] }),
        r3: asg({ id: 'r3' }),
      },
    };
    const out = roundTrip(doc);
    expect(Object.keys(out.regionAssignments)).toEqual(['r3']);
  });

  it('drops anchors with non-finite distance or a dead line, keeps dangling pairKeys', () => {
    const doc = {
      ...baseDoc(),
      regionAssignments: {
        r1: asg({
          anchors: [
            // Dangling pairKey (edge no longer on l1): KEPT — reconcile's
            // topology-translation step needs it.
            { lineId: 'l1', pairKey: 's1|s9', anchorEnd: 'from' as const, distance: 50 },
            // Dead line: dropped.
            { lineId: 'ghost', pairKey: 's1|s2', anchorEnd: 'from' as const, distance: 50 },
            // Non-finite distance: dropped.
            { lineId: 'l2', pairKey: 's3|s4', anchorEnd: 'from' as const, distance: Infinity },
          ],
        }),
      },
    };
    const out = roundTrip(doc);
    expect(out.regionAssignments.r1.anchors).toEqual([
      { lineId: 'l1', pairKey: 's1|s9', anchorEnd: 'from', distance: 50 },
    ]);
  });

  it('drops an assignment with zero surviving anchors', () => {
    const doc = {
      ...baseDoc(),
      regionAssignments: {
        r1: asg({
          anchors: [{ lineId: 'ghost', pairKey: 's1|s2', anchorEnd: 'from' as const, distance: 1 }],
        }),
      },
    };
    expect(roundTrip(doc).regionAssignments).toEqual({});
  });

  it('the assignment cleaner is idempotent: a second parse changes nothing', () => {
    const doc = { ...baseDoc(), regionAssignments: { r1: asg() } };
    const out = roundTrip(doc);
    // Not the same object (JSON round-trip), but a second parse of the same
    // content must not re-clean anything: deep-equal is the contract.
    expect(roundTrip(out).regionAssignments).toEqual(out.regionAssignments);
  });
});
