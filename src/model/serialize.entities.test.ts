import { describe, it, expect } from 'vitest';
import { serialize, parse } from './serialize';
import { makeDoc, makeLineTag, makeRouteBullet, makeTransfer } from '../test/fixtures';

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
    const doc = roundTrip(makeDoc({ lineTags: [tag] }));
    expect(doc.lineTags['t1']).toEqual(tag);
  });

  it('preserves a text tag whose kind is omitted (legacy = text)', () => {
    const tag = makeLineTag({ id: 't1', anchorEnd: 'from', distance: 0 });
    const doc = roundTrip(makeDoc({ lineTags: [tag] }));
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
    const doc = roundTrip(makeDoc({ routeBullets: [rb] }));
    expect(doc.routeBullets['rb1']).toEqual(rb);
  });

  it('preserves a null (unset) lineId', () => {
    const rb = makeRouteBullet({ id: 'rb1', lineId: null, shape: 'square' });
    const doc = roundTrip(makeDoc({ routeBullets: [rb] }));
    expect(doc.routeBullets['rb1'].lineId).toBeNull();
    expect(doc.routeBullets['rb1'].shape).toBe('square');
  });

  it('preserves the locked flag', () => {
    const rb = makeRouteBullet({ id: 'rb1', locked: true });
    const doc = roundTrip(makeDoc({ routeBullets: [rb] }));
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
    const doc = roundTrip(makeDoc({ transfers: [xfer] }));
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
    const doc = roundTrip(makeDoc({ transfers: [xfer] }));
    expect(doc.transfers['x1']).toEqual(xfer);
  });

  it('migrates a legacy single-color override to a day/night pair on load', () => {
    // A hand-edited / legacy file with string colors: parse wraps each into a
    // day/night pair (old colors are day colors, night matches).
    const json = JSON.stringify({
      format: 'massimo-map',
      doc: {
        ...makeDoc({}),
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
    const doc = roundTrip(makeDoc({ transfers: [makeTransfer({ id: 'x1' })] }));
    for (const field of ['thickness', 'color', 'strokeWidth', 'strokeColor']) {
      expect(field in doc.transfers['x1']).toBe(false);
    }
  });
});
