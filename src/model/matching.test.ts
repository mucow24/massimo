import { describe, it, expect } from 'vitest';
import { findMatchingStations } from './matching';
import * as T from './transforms';
import { makeDoc, makeLine, makeStation, makeStop } from '../test/fixtures';

describe('findMatchingStations', () => {
  it('returns every matching station on each line that includes the selected', () => {
    // s1 — s2 — s3 on line L1. All three have a single L1 stop at (0,0).
    const doc = makeDoc({
      stations: [
        makeStation({ id: 's1', stops: [makeStop('L1')] }),
        makeStation({ id: 's2', stops: [makeStop('L1')] }),
        makeStation({ id: 's3', stops: [makeStop('L1')] }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1', 's2', 's3'] })],
    });
    expect(findMatchingStations(doc, 's2').sort()).toEqual(['s1', 's3']);
  });

  it('excludes the selected station itself', () => {
    const doc = makeDoc({
      stations: [
        makeStation({ id: 's1', stops: [makeStop('L1')] }),
        makeStation({ id: 's2', stops: [makeStop('L1')] }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1', 's2'] })],
    });
    expect(findMatchingStations(doc, 's1')).toEqual(['s2']);
  });

  it('excludes connected stations whose stops differ', () => {
    const doc = makeDoc({
      stations: [
        // s1 has L1 at (0,0).
        makeStation({ id: 's1', stops: [makeStop('L1')] }),
        // s2 has L1 at (0,1) — same line but different cell.
        makeStation({ id: 's2', stops: [makeStop('L1', { col: 1 })] }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1', 's2'] })],
    });
    expect(findMatchingStations(doc, 's1')).toEqual([]);
  });

  it('excludes connected stations with extra or missing lines', () => {
    const doc = makeDoc({
      stations: [
        makeStation({ id: 's1', stops: [makeStop('L1'), makeStop('L2', { col: 1 })] }),
        // s2 only has L1; missing L2.
        makeStation({ id: 's2', stops: [makeStop('L1')] }),
      ],
      lines: [
        makeLine({ id: 'L1', stations: ['s1', 's2'] }),
        makeLine({ id: 'L2', stations: ['s1'] }),
      ],
    });
    expect(findMatchingStations(doc, 's1')).toEqual([]);
  });

  it('matches when stops are identical sets but in different array order', () => {
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          stops: [makeStop('L1'), makeStop('L2', { col: 1 })],
        }),
        makeStation({
          id: 's2',
          stops: [makeStop('L2', { col: 1 }), makeStop('L1')],
        }),
      ],
      lines: [
        makeLine({ id: 'L1', stations: ['s1', 's2'] }),
        makeLine({ id: 'L2', stations: ['s1', 's2'] }),
      ],
    });
    expect(findMatchingStations(doc, 's1')).toEqual(['s2']);
  });

  it('requires station rotation to match', () => {
    // s1 and s2 have identical unrotated stops but different rotations:
    // they look different in the world, so they should NOT match.
    const doc = makeDoc({
      stations: [
        makeStation({ id: 's1', stops: [makeStop('L1')], rotation: 0 }),
        makeStation({ id: 's2', stops: [makeStop('L1')], rotation: 3 }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1', 's2'] })],
    });
    expect(findMatchingStations(doc, 's1')).toEqual([]);
  });

  it('matches when rotation is equal alongside identical stops', () => {
    const doc = makeDoc({
      stations: [
        makeStation({ id: 's1', stops: [makeStop('L1')], rotation: 3 }),
        makeStation({ id: 's2', stops: [makeStop('L1')], rotation: 3 }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1', 's2'] })],
    });
    expect(findMatchingStations(doc, 's1')).toEqual(['s2']);
  });

  it('excludes connected stations with a different stop orientation', () => {
    const doc = makeDoc({
      stations: [
        makeStation({ id: 's1', stops: [makeStop('L1', { orientation: 'auto-vertical' })] }),
        makeStation({ id: 's2', stops: [makeStop('L1', { orientation: 'auto-horizontal' })] }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1', 's2'] })],
    });
    expect(findMatchingStations(doc, 's1')).toEqual([]);
  });

  it('includes matching stations across the whole line, not just neighbors', () => {
    // s1 — s2 — s3 — s4 — s5, all identical layouts. Querying s2 should
    // return s1, s3, s4, s5 — the whole line, not just the immediate
    // neighbors s1 and s3.
    const doc = makeDoc({
      stations: [
        makeStation({ id: 's1', stops: [makeStop('L1')] }),
        makeStation({ id: 's2', stops: [makeStop('L1')] }),
        makeStation({ id: 's3', stops: [makeStop('L1')] }),
        makeStation({ id: 's4', stops: [makeStop('L1')] }),
        makeStation({ id: 's5', stops: [makeStop('L1')] }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1', 's2', 's3', 's4', 's5'] })],
    });
    expect(findMatchingStations(doc, 's2').sort()).toEqual(['s1', 's3', 's4', 's5']);
  });

  it('skips non-matching stations on the line but keeps matching ones beyond them', () => {
    // s1 — s2 — s3 — s4. s1, s2, s4 share a layout; s3 differs. From s1 the
    // result still includes s4 — non-matching stations don't break the line.
    const doc = makeDoc({
      stations: [
        makeStation({ id: 's1', stops: [makeStop('L1')] }),
        makeStation({ id: 's2', stops: [makeStop('L1')] }),
        makeStation({ id: 's3', stops: [makeStop('L1', { col: 1 })] }),
        makeStation({ id: 's4', stops: [makeStop('L1')] }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1', 's2', 's3', 's4'] })],
    });
    expect(findMatchingStations(doc, 's1').sort()).toEqual(['s2', 's4']);
  });

  it('unions matches across every line containing the selected station', () => {
    // L1: s1 — s2 — s3
    // L2: s2 — s4 — s5
    // All five share the same 2-stop layout. From s1 (on L1 only): includes
    // s2 and s3 — but NOT s4/s5 since they're only on L2 and s1 isn't on L2.
    const stops = [makeStop('L1'), makeStop('L2', { col: 1 })];
    const doc = makeDoc({
      stations: [
        makeStation({ id: 's1', stops }),
        makeStation({ id: 's2', stops }),
        makeStation({ id: 's3', stops }),
        makeStation({ id: 's4', stops }),
        makeStation({ id: 's5', stops }),
      ],
      lines: [
        makeLine({ id: 'L1', stations: ['s1', 's2', 's3'] }),
        makeLine({ id: 'L2', stations: ['s2', 's4', 's5'] }),
      ],
    });
    // From s2 (on both lines): matches across both — s1, s3, s4, s5.
    expect(findMatchingStations(doc, 's2').sort()).toEqual(['s1', 's3', 's4', 's5']);
    // From s1 (on L1 only): only s2 and s3.
    expect(findMatchingStations(doc, 's1').sort()).toEqual(['s2', 's3']);
  });

  it('handles a line that visits the selected station twice without duplicates', () => {
    // s1 — s2 — s3 — s1 (a loop on L1). From s1 the line traversal lists
    // s2 and s3 (and s1 itself, which is excluded). No duplicates.
    const doc = makeDoc({
      stations: [
        makeStation({ id: 's1', stops: [makeStop('L1')] }),
        makeStation({ id: 's2', stops: [makeStop('L1')] }),
        makeStation({ id: 's3', stops: [makeStop('L1')] }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1', 's2', 's3', 's1'] })],
    });
    expect(findMatchingStations(doc, 's1').sort()).toEqual(['s2', 's3']);
  });

  it('considers adjacency on any shared line, not just one', () => {
    // s1 connected to s2 on L1, s1 connected to s3 on L2. Both s2 and s3
    // have identical layouts to s1 — both should match.
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          stops: [makeStop('L1'), makeStop('L2', { col: 1 })],
        }),
        makeStation({
          id: 's2',
          stops: [makeStop('L1'), makeStop('L2', { col: 1 })],
        }),
        makeStation({
          id: 's3',
          stops: [makeStop('L1'), makeStop('L2', { col: 1 })],
        }),
      ],
      lines: [
        makeLine({ id: 'L1', stations: ['s1', 's2'] }),
        makeLine({ id: 'L2', stations: ['s1', 's3'] }),
      ],
    });
    expect(findMatchingStations(doc, 's1').sort()).toEqual(['s2', 's3']);
  });

  it('returns empty for a missing station id', () => {
    const doc = makeDoc({});
    expect(findMatchingStations(doc, 'nope')).toEqual([]);
  });

  it('requires label cell to match (label position is part of the visual identity)', () => {
    // Same stops + rotation but the label sits on opposite sides of the dot.
    // The two stations look different in the world, so they should NOT match.
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          stops: [makeStop('L1')],
          label: { row: -1, col: -1, rotation: 1, offset: 0 },
        }),
        makeStation({
          id: 's2',
          stops: [makeStop('L1')],
          label: { row: 1, col: 1, rotation: 1, offset: 0 },
        }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1', 's2'] })],
    });
    expect(findMatchingStations(doc, 's1')).toEqual([]);
  });

  it('matches when label cell is identical', () => {
    const label = { row: 0, col: -1, rotation: 0 as const, offset: 4 };
    const doc = makeDoc({
      stations: [
        makeStation({ id: 's1', stops: [makeStop('L1')], label }),
        makeStation({ id: 's2', stops: [makeStop('L1')], label }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1', 's2'] })],
    });
    expect(findMatchingStations(doc, 's1')).toEqual(['s2']);
  });

  it('ignores orphan stops (whose lineId is no longer in doc.lines)', () => {
    // s1, s2, s3 all sit on L1 with identical layouts. s3 also carries a stop
    // tagged for a long-deleted line "Z" (not present in doc.lines). The user
    // sees three identical stations on L1 — the orphan is invisible because
    // its line doesn't render. Matching should not be broken by stale data.
    const doc = makeDoc({
      stations: [
        makeStation({ id: 's1', stops: [makeStop('L1')] }),
        makeStation({ id: 's2', stops: [makeStop('L1')] }),
        makeStation({
          id: 's3',
          stops: [makeStop('L1'), makeStop('Z', { col: 1 })],
        }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1', 's2', 's3'] })],
    });
    expect(findMatchingStations(doc, 's1').sort()).toEqual(['s2', 's3']);
    expect(findMatchingStations(doc, 's3').sort()).toEqual(['s1', 's2']);
  });

  it('treats two stations with matching orphan stops as identical', () => {
    // Both s1 and s2 carry an orphan "Z" stop; s3 doesn't. After ignoring the
    // orphan, all three render the same on L1, so all three should match.
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          stops: [makeStop('L1'), makeStop('Z', { col: 1 })],
        }),
        makeStation({
          id: 's2',
          stops: [makeStop('L1'), makeStop('Z', { col: 1 })],
        }),
        makeStation({ id: 's3', stops: [makeStop('L1')] }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1', 's2', 's3'] })],
    });
    expect(findMatchingStations(doc, 's1').sort()).toEqual(['s2', 's3']);
    expect(findMatchingStations(doc, 's3').sort()).toEqual(['s1', 's2']);
  });

  it('matching is symmetric: a in matches(b) iff b in matches(a)', () => {
    // Property check across a few representative configurations.
    const doc = makeDoc({
      stations: [
        makeStation({ id: 's1', stops: [makeStop('L1')] }),
        makeStation({ id: 's2', stops: [makeStop('L1')] }),
        makeStation({ id: 's3', stops: [makeStop('L1')] }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1', 's2', 's3'] })],
    });
    const ids = ['s1', 's2', 's3'];
    for (const a of ids) {
      const ma = new Set(findMatchingStations(doc, a));
      for (const b of ids) {
        if (a === b) continue;
        const mb = new Set(findMatchingStations(doc, b));
        expect(ma.has(b)).toBe(mb.has(a));
      }
    }
  });

  it('three stations added to a line via toggleStationOnLine all match each other', () => {
    // Integration check: build a doc the way the UI actually does, then
    // verify matching. Each toggle re-runs auto-orient on the line; the
    // stations end up with the same rotation because they're collinear.
    let doc = T.addLine(
      T.addStation(
        T.addStation(T.addStation(makeDoc({}), 0, 0, 's1', 'S1'), 0, 100, 's2', 'S2'),
        0,
        200,
        's3',
        'S3',
      ),
      'L1',
      'L1',
      '#000',
    );
    doc = T.toggleStationOnLine(doc, 'L1', 's1');
    doc = T.toggleStationOnLine(doc, 'L1', 's2');
    doc = T.toggleStationOnLine(doc, 'L1', 's3');
    expect(findMatchingStations(doc, 's1').sort()).toEqual(['s2', 's3']);
    expect(findMatchingStations(doc, 's2').sort()).toEqual(['s1', 's3']);
    expect(findMatchingStations(doc, 's3').sort()).toEqual(['s1', 's2']);
  });

  it('matching survives a line being deleted then re-added', () => {
    // Scenario: 3 identical stations on L1. User deletes L1 (which strips
    // every station's L1 stops). User re-adds L1 with the same id and re-
    // attaches the stations. Even if some intermediate state had left orphan
    // stops behind, matching should still see all three as identical.
    let doc = T.addLine(
      T.addStation(
        T.addStation(T.addStation(makeDoc({}), 0, 0, 's1', 'S1'), 0, 100, 's2', 'S2'),
        0,
        200,
        's3',
        'S3',
      ),
      'L1',
      'L1',
      '#000',
    );
    doc = T.toggleStationOnLine(doc, 'L1', 's1');
    doc = T.toggleStationOnLine(doc, 'L1', 's2');
    doc = T.toggleStationOnLine(doc, 'L1', 's3');
    doc = T.deleteLine(doc, 'L1');
    doc = T.addLine(doc, 'L1', 'L1', '#000');
    doc = T.toggleStationOnLine(doc, 'L1', 's1');
    doc = T.toggleStationOnLine(doc, 'L1', 's2');
    doc = T.toggleStationOnLine(doc, 'L1', 's3');
    expect(findMatchingStations(doc, 's2').sort()).toEqual(['s1', 's3']);
  });
});
