import { describe, it, expect } from 'vitest';
import { migrate, parse, SCHEMA_FORMAT, SCHEMA_VERSION, serialize } from './serialize';
import { makeDoc, makeLine, makeStation, makeStop } from '../test/fixtures';

describe('serialize / parse round-trip', () => {
  it('round-trips a multi-line, multi-station fixture losslessly', () => {
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          name: 'Foo',
          x: 10,
          y: 20,
          rotation: 3,
          stops: [
            makeStop('L1', { row: 0, col: 0 }),
            makeStop('L2', { row: 0, col: 1, orientation: 'left' }),
          ],
          label: { row: 1, col: 2, rotation: 5, offset: 12 },
        }),
        makeStation({ id: 's2', x: 100, y: 100 }),
      ],
      lines: [
        makeLine({ id: 'L1', service: 'A', color: '#0039A6', stations: ['s1', 's2'] }),
        makeLine({ id: 'L2', service: 'B', color: '#FF6319', stations: ['s1'] }),
      ],
      lineOrder: ['L2', 'L1'],
      curveRadius: 30,
    });
    const json = serialize(doc);
    const result = parse(json);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.doc).toEqual(doc);
  });
});

describe('parse — error cases', () => {
  it('rejects malformed JSON without throwing', () => {
    const r = parse('not json {');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/JSON/i);
  });

  it('rejects non-object JSON', () => {
    const r = parse('[]');
    expect(r.ok).toBe(false);
  });

  it('rejects files missing the format field', () => {
    const r = parse(JSON.stringify({ version: SCHEMA_VERSION, doc: {} }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/format/i);
  });

  it('rejects files with a foreign format field', () => {
    const r = parse(JSON.stringify({ format: 'something-else', version: 1, doc: {} }));
    expect(r.ok).toBe(false);
  });

  it('rejects files missing version', () => {
    const r = parse(JSON.stringify({ format: SCHEMA_FORMAT, doc: {} }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/version/i);
  });

  it('rejects files from a future version', () => {
    const r = parse(
      JSON.stringify({ format: SCHEMA_FORMAT, version: SCHEMA_VERSION + 5, doc: {} }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/newer/i);
  });
});

describe('migrate — historical versions', () => {
  it('v0 → current: stopOrder array becomes stops grid', () => {
    const v0 = {
      stations: {
        s1: {
          id: 's1',
          name: 'Old',
          x: 0,
          y: 0,
          rotation: 0,
          stopOrder: ['L1', 'L2'],
        },
      },
      lines: {
        L1: { id: 'L1', service: 'A', color: '#000', stations: ['s1'] },
        L2: { id: 'L2', service: 'B', color: '#fff', stations: ['s1'] },
      },
      lineOrder: ['L1', 'L2'],
      curveRadius: 24,
    };
    const doc = migrate(v0, 0);
    expect(doc.stations.s1.stops).toEqual([
      { lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' },
      { lineId: 'L2', row: 0, col: 1, orientation: 'auto-vertical' },
    ]);
    // v1 -> v2 also runs: label is added.
    expect(doc.stations.s1.label).toBeDefined();
  });

  it('v1 → current: every station gains a label', () => {
    const v1 = {
      stations: {
        s1: {
          id: 's1',
          name: 'X',
          x: 0,
          y: 0,
          rotation: 0,
          stops: [{ lineId: 'L1', row: 0, col: 3, orientation: 'auto-vertical' }],
        },
      },
      lines: { L1: { id: 'L1', service: 'A', color: '#000', stations: ['s1'] } },
      lineOrder: ['L1'],
      curveRadius: 24,
    };
    const doc = migrate(v1, 1);
    expect(doc.stations.s1.label).toEqual({ row: 0, col: 2, rotation: 0, offset: 0 });
  });

  it('v2 → current: label gains offset', () => {
    const v2 = {
      stations: {
        s1: {
          id: 's1',
          name: 'X',
          x: 0,
          y: 0,
          rotation: 0,
          stops: [],
          label: { row: 0, col: -1, rotation: 0 },
        },
      },
      lines: {},
      lineOrder: [],
      curveRadius: 24,
    };
    const doc = migrate(v2, 2);
    expect(doc.stations.s1.label.offset).toBe(0);
  });

  it('v4 → current: legacy vertical/horizontal map to auto-*', () => {
    const v4 = {
      stations: {
        s1: {
          id: 's1',
          name: 'X',
          x: 0,
          y: 0,
          rotation: 0,
          stops: [
            { lineId: 'L1', row: 0, col: 0, orientation: 'vertical' },
            { lineId: 'L2', row: 0, col: 1, orientation: 'horizontal' },
            { lineId: 'L3', row: 0, col: 2, orientation: 'up' },
          ],
          label: { row: 0, col: -1, rotation: 0, offset: 0 },
        },
      },
      lines: {
        L1: { id: 'L1', service: 'A', color: '#000', stations: ['s1'] },
        L2: { id: 'L2', service: 'B', color: '#000', stations: ['s1'] },
        L3: { id: 'L3', service: 'C', color: '#000', stations: ['s1'] },
      },
      lineOrder: ['L1', 'L2', 'L3'],
      curveRadius: 24,
    };
    const doc = migrate(v4, 4);
    const orientations = doc.stations.s1.stops.map((c) => c.orientation);
    expect(orientations).toEqual(['auto-vertical', 'auto-horizontal', 'up']);
  });

  it('v5 → current: viewport is dropped, lineCounter is added', () => {
    const v5 = {
      stations: {},
      lines: {
        L1: { id: 'L1', service: 'A', color: '#000', stations: [] },
        L2: { id: 'L2', service: 'B', color: '#fff', stations: [] },
      },
      lineOrder: ['L1', 'L2'],
      curveRadius: 24,
      viewport: { x: 50, y: 50, zoom: 2 },
    };
    const doc = migrate(v5, 5);
    expect(doc.lineCounter).toBe(2);
    expect((doc as unknown as { viewport?: unknown }).viewport).toBeUndefined();
  });

  it('current version is a no-op', () => {
    const cur = {
      stations: {},
      lines: {},
      lineOrder: [],
      curveRadius: 24,
      lineCounter: 0,
      lineTags: {},
    };
    const doc = migrate(cur, SCHEMA_VERSION);
    expect(doc).toMatchObject(cur);
  });

  it('v6 → current: lineTags defaults to {} for old files without the field', () => {
    const v6 = {
      stations: {},
      lines: {},
      lineOrder: [],
      curveRadius: 24,
      lineCounter: 0,
    };
    const doc = migrate(v6, 6);
    expect(doc.lineTags).toEqual({});
  });

  it('v7 → v8: tag with fractional t becomes (anchorEnd, distance)', () => {
    // Two stations 100 world units apart; one-line band; tag at t=0.3.
    // Stripe length = 100 (offset=0 since single-line band). Canonical-t=0.3
    // ⇒ arcLen=30 ⇒ closer to "from" ⇒ anchorEnd='from', distance=30.
    const v7 = {
      stations: {
        s1: {
          id: 's1',
          name: 's1',
          x: 0,
          y: 0,
          rotation: 0,
          stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' }],
          label: { row: 0, col: -1, rotation: 0, offset: 0 },
        },
        s2: {
          id: 's2',
          name: 's2',
          x: 100,
          y: 0,
          rotation: 0,
          stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' }],
          label: { row: 0, col: -1, rotation: 0, offset: 0 },
        },
      },
      lines: { L1: { id: 'L1', service: 'A', color: '#000', stations: ['s1', 's2'] } },
      lineOrder: ['L1'],
      curveRadius: 24,
      lineCounter: 1,
      lineTags: {
        t1: {
          id: 't1',
          lineId: 'L1',
          fromStationId: 's1',
          toStationId: 's2',
          t: 0.3,
          orientation: 0,
        },
      },
    };
    const doc = migrate(v7, 7);
    expect(doc.lineTags.t1).toMatchObject({
      id: 't1',
      lineId: 'L1',
      fromStationId: 's1',
      toStationId: 's2',
      anchorEnd: 'from',
      orientation: 0,
    });
    expect(doc.lineTags.t1.distance).toBeCloseTo(30, 1);
  });

  it('v7 → v8: tag past midpoint anchors at "to"', () => {
    const v7 = {
      stations: {
        s1: {
          id: 's1',
          name: 's1',
          x: 0,
          y: 0,
          rotation: 0,
          stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' }],
          label: { row: 0, col: -1, rotation: 0, offset: 0 },
        },
        s2: {
          id: 's2',
          name: 's2',
          x: 100,
          y: 0,
          rotation: 0,
          stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' }],
          label: { row: 0, col: -1, rotation: 0, offset: 0 },
        },
      },
      lines: { L1: { id: 'L1', service: 'A', color: '#000', stations: ['s1', 's2'] } },
      lineOrder: ['L1'],
      curveRadius: 24,
      lineCounter: 1,
      lineTags: {
        t1: {
          id: 't1',
          lineId: 'L1',
          fromStationId: 's1',
          toStationId: 's2',
          t: 0.8,
          orientation: 0,
        },
      },
    };
    const doc = migrate(v7, 7);
    expect(doc.lineTags.t1.anchorEnd).toBe('to');
    expect(doc.lineTags.t1.distance).toBeCloseTo(20, 1); // 100 - 80
  });

  it('v7 → v8: reverse-canon line t converts to correct canonical anchor', () => {
    // Line traverses s2→s1 (reverse-canon). Old t=0.3 in line-frame = canon-t=0.7.
    // arcLen=70 ⇒ closer to "to" ⇒ anchorEnd='to', distance=30.
    const v7 = {
      stations: {
        s1: {
          id: 's1',
          name: 's1',
          x: 0,
          y: 0,
          rotation: 0,
          stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' }],
          label: { row: 0, col: -1, rotation: 0, offset: 0 },
        },
        s2: {
          id: 's2',
          name: 's2',
          x: 100,
          y: 0,
          rotation: 0,
          stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' }],
          label: { row: 0, col: -1, rotation: 0, offset: 0 },
        },
      },
      lines: { L1: { id: 'L1', service: 'A', color: '#000', stations: ['s2', 's1'] } },
      lineOrder: ['L1'],
      curveRadius: 24,
      lineCounter: 1,
      lineTags: {
        t1: {
          id: 't1',
          lineId: 'L1',
          fromStationId: 's1',
          toStationId: 's2',
          t: 0.3,
          orientation: 0,
        },
      },
    };
    const doc = migrate(v7, 7);
    expect(doc.lineTags.t1.anchorEnd).toBe('to');
    expect(doc.lineTags.t1.distance).toBeCloseTo(30, 1);
  });

  it('v7 → v8: orphan tag (line missing) is dropped', () => {
    const v7 = {
      stations: {},
      lines: {},
      lineOrder: [],
      curveRadius: 24,
      lineCounter: 0,
      lineTags: {
        t1: {
          id: 't1',
          lineId: 'GONE',
          fromStationId: 's1',
          toStationId: 's2',
          t: 0.5,
          orientation: 0,
        },
      },
    };
    const doc = migrate(v7, 7);
    expect(doc.lineTags.t1).toBeUndefined();
  });
});
