import { describe, it, expect } from 'vitest';
import { parse, serialize } from './serialize';
import * as T from './transforms';

// Hand-broken files for the import-hardening pathway: a writer bug (ours or a
// generator's) must never escape parse() as a raw throw or a silently-wrong
// doc. Shape violations on map SUBSTANCE (stations/lines and their scalar
// fields) error with a message naming the entity; everything reference-shaped
// or decorative heals silently — those cases live in the linkage-repair
// describe blocks below.

const fileWith = (doc: unknown): string =>
  JSON.stringify({ format: 'massimo-map', version: 2, doc });

// A minimal well-formed station/line pair to corrupt from.
const goodStation = {
  id: 's1',
  name: 'Foo',
  x: 0,
  y: 0,
  rotation: 0,
  stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' }],
  label: { row: 0, col: -1, rotation: 0, offset: 0, align: 'auto', valign: 'auto-down' },
};
const goodLine = {
  id: 'L1',
  service: 'A',
  name: 'A line',
  color: '#0039A6',
  stations: ['s1'],
  edges: [],
};

const docWith = (patch: Record<string, unknown>): Record<string, unknown> => ({
  stations: { s1: goodStation },
  lines: { L1: goodLine },
  lineOrder: ['L1'],
  ...patch,
});

describe('parse — crash-proof shell (type-c errors, never a raw throw)', () => {
  it('errors, naming the station, when stops is present but not an array', () => {
    const r = parse(fileWith(docWith({ stations: { s1: { ...goodStation, stops: 'nope' } } })));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/s1/);
  });

  it('errors, naming the station, on a stop entry that is not an object', () => {
    const r = parse(fileWith(docWith({ stations: { s1: { ...goodStation, stops: [null] } } })));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/s1/);
  });

  it('errors, naming the station and field, on a non-finite coordinate', () => {
    const r = parse(fileWith(docWith({ stations: { s1: { ...goodStation, x: 'oops' } } })));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/s1/);
      expect(r.error).toMatch(/\bx\b/);
    }
  });

  it('errors on a station entry that is not an object', () => {
    const r = parse(fileWith(docWith({ stations: { s1: 42 } })));
    expect(r.ok).toBe(false);
  });

  it('errors on a lines collection that is an array', () => {
    const r = parse(fileWith(docWith({ lines: [goodLine] })));
    expect(r.ok).toBe(false);
  });

  it('errors, naming the line, when its stations field is present but not an array', () => {
    const r = parse(fileWith(docWith({ lines: { L1: { ...goodLine, stations: 'oops' } } })));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/L1/);
  });

  it('errors, naming the line, when edges is present but not an array', () => {
    const r = parse(fileWith(docWith({ lines: { L1: { ...goodLine, edges: {} } } })));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/L1/);
  });
});

describe('parse — absent core fields heal to defaults (type b)', () => {
  it('heals a station with no stops field to an empty stop list', () => {
    const { stops: _gone, ...stopless } = goodStation;
    const r = parse(
      fileWith(
        docWith({ stations: { s1: stopless }, lines: { L1: { ...goodLine, stations: [] } } }),
      ),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(Array.isArray(r.doc.stations.s1.stops)).toBe(true);
  });

  it('heals a station with no label to the plain legacy label', () => {
    const { label: _gone, ...unlabeled } = goodStation;
    const r = parse(fileWith(docWith({ stations: { s1: unlabeled } })));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.doc.stations.s1.label).toEqual({
        row: 0,
        col: -1,
        rotation: 0,
        offset: 0,
        align: 'auto',
        valign: 'auto-down',
      });
    }
  });

  it('heals a line with no stations field (membership rebuilds from its stops)', () => {
    const { stations: _gone, ...memberless } = goodLine;
    const r = parse(fileWith(docWith({ lines: { L1: memberless } })));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.lines.L1.stations).toEqual(['s1']);
  });

  it('a doc that is already canonical still parses clean (guard against over-rejecting)', () => {
    const r = parse(fileWith({ ...T.DEFAULT_DOC }));
    expect(r.ok).toBe(true);
  });
});

const okDoc = (json: string) => {
  const r = parse(json);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error(r.error);
  return r.doc;
};

describe('parse — membership/stops/edges closure (the Opus case)', () => {
  const st = (id: string, x: number, lineIds: string[] = ['L1']) => ({
    ...goodStation,
    id,
    x,
    stops: lineIds.map((lineId) => ({ lineId, row: 0, col: 0, orientation: 'auto-vertical' })),
  });

  it('rebuilds empty membership from edges + stops: renderable becomes editable', () => {
    // The motivating real-world failure: a generator wrote full edge sets but
    // `stations: []` on every line. Bands rendered off edges; the editors work
    // off membership, so there was nothing to select or delete.
    const doc = okDoc(
      fileWith({
        stations: { s1: st('s1', 0), s2: st('s2', 100), s3: st('s3', 200) },
        lines: { L1: { ...goodLine, stations: [], edges: ['s1|s2', 's2|s3'] } },
        lineOrder: ['L1'],
      }),
    );
    expect(doc.lines.L1.stations).toEqual(['s1', 's2', 's3']);
    expect(doc.lines.L1.edges).toEqual(['s1|s2', 's2|s3']);
  });

  it('a stop-bearing station joins membership even with no edges (degree-0 member)', () => {
    const doc = okDoc(
      fileWith({
        stations: { s1: st('s1', 0), lone: st('lone', 300) },
        lines: { L1: { ...goodLine, stations: ['s1'], edges: [] } },
        lineOrder: ['L1'],
      }),
    );
    expect(doc.lines.L1.stations).toEqual(['s1', 'lone']);
  });

  it('synthesizes the missing stop for an edge-endpoint member', () => {
    const doc = okDoc(
      fileWith({
        stations: { s1: st('s1', 0), s2: { ...st('s2', 100), stops: [] } },
        lines: { L1: { ...goodLine, stations: ['s1', 's2'], edges: ['s1|s2'] } },
        lineOrder: ['L1'],
      }),
    );
    expect(doc.stations.s2.stops).toEqual([
      { lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' },
    ]);
  });

  it('drops a stop naming a line that does not exist', () => {
    const doc = okDoc(
      fileWith({
        stations: { s1: st('s1', 0, ['L1', 'ghost']) },
        lines: { L1: goodLine },
        lineOrder: ['L1'],
      }),
    );
    expect(doc.stations.s1.stops.map((c) => c.lineId)).toEqual(['L1']);
  });

  it('collapses duplicate same-line stops, first wins', () => {
    const dupe = st('s1', 0);
    dupe.stops = [
      { lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' },
      { lineId: 'L1', row: 1, col: 0, orientation: 'auto-horizontal' },
    ];
    const doc = okDoc(
      fileWith({ stations: { s1: dupe }, lines: { L1: goodLine }, lineOrder: ['L1'] }),
    );
    expect(doc.stations.s1.stops).toEqual([
      { lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical' },
    ]);
  });

  it('drops an edge with a dead endpoint, and dead membership entries with it', () => {
    const doc = okDoc(
      fileWith({
        stations: { s1: st('s1', 0), s2: st('s2', 100) },
        lines: {
          L1: { ...goodLine, stations: ['s1', 's2', 'gone'], edges: ['s1|s2', 'gone|s2'] },
        },
        lineOrder: ['L1'],
      }),
    );
    expect(doc.lines.L1.stations).toEqual(['s1', 's2']);
    expect(doc.lines.L1.edges).toEqual(['s1|s2']);
  });

  it('canonicalizes reversed edge keys, and segment styles ride the rewrite', () => {
    const doc = okDoc(
      fileWith({
        stations: { s1: st('s1', 0), s2: st('s2', 100) },
        lines: {
          L1: {
            ...goodLine,
            stations: ['s1', 's2'],
            edges: ['s2|s1'],
            segmentStyles: { 's2|s1': 'dashed' },
          },
        },
        lineOrder: ['L1'],
      }),
    );
    expect(doc.lines.L1.edges).toEqual(['s1|s2']);
    expect(doc.lines.L1.segmentStyles).toEqual({ 's1|s2': 'dashed' });
  });

  it('drops self-edges and duplicate edges; dedupes membership', () => {
    const doc = okDoc(
      fileWith({
        stations: { s1: st('s1', 0), s2: st('s2', 100) },
        lines: {
          L1: {
            ...goodLine,
            stations: ['s1', 's2', 's1'],
            edges: ['s1|s2', 's1|s1', 's2|s1', 's1|s2'],
          },
        },
        lineOrder: ['L1'],
      }),
    );
    expect(doc.lines.L1.stations).toEqual(['s1', 's2']);
    expect(doc.lines.L1.edges).toEqual(['s1|s2']);
  });

  it('is idempotent: a repaired doc re-serializes and parses back unchanged', () => {
    const first = okDoc(
      fileWith({
        stations: { s1: st('s1', 0), s2: { ...st('s2', 100), stops: [] } },
        lines: { L1: { ...goodLine, stations: [], edges: ['s2|s1'] } },
        lineOrder: [],
      }),
    );
    const second = okDoc(serialize(first));
    expect(second).toEqual(first);
  });
});

describe('parse — doc-wide reference sweep', () => {
  it('rewrites inner ids to their record keys', () => {
    const doc = okDoc(
      fileWith(
        docWith({
          stations: { s1: { ...goodStation, id: 'other' } },
          lines: { L1: { ...goodLine, id: 'nope' } },
        }),
      ),
    );
    expect(doc.stations.s1.id).toBe('s1');
    expect(doc.lines.L1.id).toBe('L1');
  });

  it('reconciles lineOrder: dead ids drop, missed lines append, dupes collapse', () => {
    const doc = okDoc(fileWith(docWith({ lineOrder: ['ghost', 'L1', 'L1'] })));
    expect(doc.lineOrder).toEqual(['L1']);
  });

  it('reconciles backgroundOrder against polygons and images', () => {
    const poly = {
      id: 'p1',
      vertices: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 1,
      darkFill: '#ff0000',
      darkStroke: '#000000',
    };
    const doc = okDoc(
      fileWith(docWith({ polygons: { p1: poly }, backgroundOrder: ['dead', 'p1', 'p1'] })),
    );
    expect(doc.backgroundOrder).toEqual(['p1']);
  });

  it('drops a line tag whose pair is not an edge; canonicalizes a reversed pair', () => {
    const base = docWith({
      stations: {
        s1: goodStation,
        s2: { ...goodStation, id: 's2', x: 100 },
      },
      lines: {
        L1: {
          ...goodLine,
          stations: ['s1', 's2'],
          edges: ['s1|s2'],
        },
      },
    });
    const tag = (over: Record<string, unknown>) => ({
      id: 't1',
      lineId: 'L1',
      fromStationId: 's1',
      toStationId: 's2',
      anchorEnd: 'from',
      distance: 10,
      orientation: 0,
      ...over,
    });
    const dropped = okDoc(fileWith({ ...base, lineTags: { t1: tag({ toStationId: 'ghost' }) } }));
    expect(dropped.lineTags).toEqual({});
    const flipped = okDoc(
      fileWith({
        ...base,
        lineTags: { t1: tag({ fromStationId: 's2', toStationId: 's1', anchorEnd: 'from' }) },
      }),
    );
    expect(flipped.lineTags.t1.fromStationId).toBe('s1');
    expect(flipped.lineTags.t1.toStationId).toBe('s2');
    // The stored 'from' pointed at s2; after the canonical swap the same
    // physical station is the 'to' end.
    expect(flipped.lineTags.t1.anchorEnd).toBe('to');
  });

  it('drops a transfer with a dead station; heals a dead line on a stop end to null', () => {
    const two = docWith({
      stations: { s1: goodStation, s2: { ...goodStation, id: 's2', x: 100 } },
    });
    const dropped = okDoc(
      fileWith({
        ...two,
        transfers: {
          x1: {
            id: 'x1',
            a: { stationId: 'ghost', lineId: null },
            b: { stationId: 's1', lineId: null },
          },
        },
      }),
    );
    expect(dropped.transfers).toEqual({});
    const healed = okDoc(
      fileWith({
        ...two,
        transfers: {
          x1: {
            id: 'x1',
            a: { stationId: 's1', lineId: 'ghost' },
            b: { stationId: 's2', lineId: null },
          },
        },
      }),
    );
    expect(healed.transfers.x1.a).toEqual({ stationId: 's1', lineId: null });
  });

  it('heals a route bullet with a dead line to the unset state; drops one with no position', () => {
    const bullet = (over: Record<string, unknown>) => ({
      id: 'rb1',
      x: 0,
      y: 0,
      rotation: 0,
      lineId: 'ghost',
      shape: 'circle',
      size: 12,
      ...over,
    });
    const healed = okDoc(fileWith(docWith({ routeBullets: { rb1: bullet({}) } })));
    expect(healed.routeBullets.rb1.lineId).toBeNull();
    const dropped = okDoc(fileWith(docWith({ routeBullets: { rb1: bullet({ x: 'nan' }) } })));
    expect(dropped.routeBullets).toEqual({});
  });

  it('drops decorations whose substance cannot be honoured', () => {
    const doc = okDoc(
      fileWith(
        docWith({
          textLabels: {
            t1: { id: 't1', x: 'oops', y: 0, rotation: 0, text: 'hi', fontSize: 16 },
          },
          polygons: {
            p1: {
              id: 'p1',
              vertices: [{ x: 0, y: 0 }],
              fill: '#fff',
              stroke: '#000',
              strokeWidth: 1,
            },
          },
          transferAnchors: { a1: { id: 'a1', x: Infinity, y: 0 } },
        }),
      ),
    );
    expect(doc.textLabels).toEqual({});
    expect(doc.polygons).toEqual({});
    expect(doc.transferAnchors).toEqual({});
  });
});
