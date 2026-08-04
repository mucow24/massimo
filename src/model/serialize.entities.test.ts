import { describe, it, expect } from 'vitest';
import { serialize, parse } from './serialize';
import {
  makeDoc,
  makeLine,
  makeLineTag,
  makeRouteBullet,
  makeStation,
  makeStop,
  makeTransfer,
} from '../test/fixtures';

// Round-trip guards for the three entities that had no dedicated serialize
// coverage (Transfer / RouteBullet / LineTag). serialize is pure pass-through,
// so these pin that a persisted map carrying them reloads intact — a future
// change to serialize or DOC_FIELDS touching these fields is otherwise
// unguarded.

const roundTrip = (doc: ReturnType<typeof makeDoc>) => {
  const result = parse(serialize(doc));
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result.doc;
};

// Live scaffolding for the references the entity fixture defaults carry
// (l1 / s1 / s2): parse drops or heals entities whose references dangle, so a
// round-trip fixture must be as coherent as an app-written doc.
const liveRefs = {
  stations: [
    makeStation({ id: 's1', stops: [makeStop('l1')] }),
    makeStation({ id: 's2', x: 100, stops: [makeStop('l1')] }),
  ],
  lines: [makeLine({ id: 'l1', stations: ['s1', 's2'] })],
};

describe('LineTag serialization', () => {
  it('round-trips all fields, including the optional kind', () => {
    const tag = makeLineTag({
      id: 't1',
      lineId: 'l1',
      fromStationId: 's1',
      toStationId: 's2',
      anchorEnd: 'to',
      distance: 37.5,
      orientation: 3,
      kind: 'chevron',
    });
    const doc = roundTrip(makeDoc({ ...liveRefs, lineTags: [tag] }));
    expect(doc.lineTags['t1']).toEqual(tag);
  });

  it('preserves a text tag whose kind is omitted (legacy = text)', () => {
    const tag = makeLineTag({ id: 't1', anchorEnd: 'from', distance: 0 });
    const doc = roundTrip(makeDoc({ ...liveRefs, lineTags: [tag] }));
    expect(doc.lineTags['t1']).toEqual(tag);
    expect('kind' in doc.lineTags['t1']).toBe(false);
  });
});

describe('RouteBullet serialization', () => {
  it('round-trips shape, size, rotation, and a resolved lineId', () => {
    const rb = makeRouteBullet({
      id: 'rb1',
      x: 12,
      y: -8,
      rotation: 5,
      lineId: 'l1',
      shape: 'diamond',
      size: 20,
    });
    const doc = roundTrip(makeDoc({ ...liveRefs, routeBullets: [rb] }));
    expect(doc.routeBullets['rb1']).toEqual(rb);
  });

  it('preserves a null (unset) lineId', () => {
    const rb = makeRouteBullet({ id: 'rb1', lineId: null, shape: 'square' });
    const doc = roundTrip(makeDoc({ ...liveRefs, routeBullets: [rb] }));
    expect(doc.routeBullets['rb1'].lineId).toBeNull();
    expect(doc.routeBullets['rb1'].shape).toBe('square');
  });

  it('preserves the locked flag', () => {
    const rb = makeRouteBullet({ id: 'rb1', locked: true });
    const doc = roundTrip(makeDoc({ ...liveRefs, routeBullets: [rb] }));
    expect(doc.routeBullets['rb1'].locked).toBe(true);
  });
});

describe('Transfer serialization', () => {
  it('round-trips both ends, including each end nullable lineId', () => {
    const xfer = makeTransfer({
      id: 'x1',
      a: { stationId: 's1', lineId: 'l1' },
      b: { stationId: 's2', lineId: null },
    });
    const doc = roundTrip(makeDoc({ ...liveRefs, transfers: [xfer] }));
    expect(doc.transfers['x1']).toEqual(xfer);
  });

  it('round-trips per-transfer style overrides losslessly', () => {
    // Every value differs from the constant defaults, so none may be dropped.
    // Colors are day/night pairs (the app-written form), with both halves
    // diverging so neither collapses.
    const xfer = makeTransfer({
      id: 'x1',
      thickness: 5,
      color: { day: '#ff0080', night: '#333333' },
      strokeWidth: 3,
      strokeColor: { day: '#123456', night: '#654321' },
    });
    const doc = roundTrip(makeDoc({ ...liveRefs, transfers: [xfer] }));
    expect(doc.transfers['x1']).toEqual(xfer);
  });

  it('migrates a legacy single-color override to a day/night pair on load', () => {
    // A hand-edited / legacy file with string colors: parse wraps each into a
    // day/night pair (old colors are day colors, night matches).
    const json = JSON.stringify({
      format: 'massimo-map',
      doc: {
        ...makeDoc(liveRefs),
        transfers: {
          x1: {
            id: 'x1',
            a: { stationId: 's1', lineId: null },
            b: { stationId: 's2', lineId: null },
            color: '#ff0080',
            strokeColor: '#abcdef',
          },
        },
      },
    });
    const result = parse(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.transfers.x1.color).toEqual({ day: '#ff0080', night: '#ff0080' });
    expect(result.doc.transfers.x1.strokeColor).toEqual({ day: '#abcdef', night: '#abcdef' });
  });

  it('preserves absence of the style overrides (a tracking transfer stays tracking)', () => {
    const doc = roundTrip(makeDoc({ ...liveRefs, transfers: [makeTransfer({ id: 'x1' })] }));
    for (const field of ['thickness', 'color', 'strokeWidth', 'strokeColor']) {
      expect(field in doc.transfers['x1']).toBe(false);
    }
  });
});

describe('TransferAnchor serialization', () => {
  it('round-trips free anchors and every arm of the TransferEnd union', () => {
    const doc = roundTrip(
      makeDoc({
        stations: [makeStation({ id: 's1', transferAnchors: [{ id: 'h1', row: 1, col: -2 }] })],
        transferAnchors: [{ id: 'a1', x: 12.5, y: -30 }],
        transfers: [
          makeTransfer({ id: 'x1', a: { stationId: 's1', lineId: 'l1' }, b: { anchorId: 'a1' } }),
          makeTransfer({
            id: 'x2',
            a: { stationId: 's1', anchorId: 'h1' },
            b: { anchorId: 'a1' },
          }),
        ],
      }),
    );
    expect(doc.transferAnchors.a1).toEqual({ id: 'a1', x: 12.5, y: -30 });
    // Hosted anchors ride inside their station, so they survive the same way
    // stops do rather than needing a collection of their own.
    expect(doc.stations.s1.transferAnchors).toEqual([{ id: 'h1', row: 1, col: -2 }]);
    expect(doc.transfers.x1.b).toEqual({ anchorId: 'a1' });
    expect(doc.transfers.x2.a).toEqual({ stationId: 's1', anchorId: 'h1' });
  });

  it('loads a pre-anchors file with an empty collection and no hosted arrays', () => {
    // The whole migration story: absent fields fill from DEFAULT_DOC on the
    // merge. If this ever needs a migrateDoc step, the reference-identity pins
    // in storeMigrate.test.ts are what will break first.
    const legacy = JSON.stringify({
      format: 'massimo-map',
      doc: {
        stations: {
          s1: {
            id: 's1',
            name: 'A',
            x: 0,
            y: 0,
            rotation: 0,
            stops: [],
            label: { row: 0, col: 0, rotation: 0, offset: 0, align: 'auto', valign: 'auto-down' },
          },
        },
        lines: {},
        lineOrder: [],
      },
    });
    const result = parse(legacy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.transferAnchors).toEqual({});
    expect(result.doc.stations.s1.transferAnchors).toBeUndefined();
  });
});
