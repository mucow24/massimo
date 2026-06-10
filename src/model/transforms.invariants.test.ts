import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import * as T from './transforms';
import { LINE_WIDTH_DEFAULT, LINE_WIDTH_MIN } from './lineWidth';
import type { MapDoc } from './types';
import { counterIdFactory } from './ids';

// A single test action — a labeled discriminated union of transforms applied
// to whatever doc state currently exists. We don't generate raw arguments;
// the runner picks valid ids from the doc at apply time.
type Action =
  | { kind: 'addStation' }
  | { kind: 'addLine' }
  | { kind: 'deleteStation' }
  | { kind: 'deleteLine' }
  | { kind: 'toggleStationOnLine' }
  | { kind: 'rotateStation' }
  | { kind: 'moveLineInOrder'; dir: -1 | 1 }
  | { kind: 'setLineWidth'; w: number };

const actionArb = fc.oneof(
  fc.constant<Action>({ kind: 'addStation' }),
  fc.constant<Action>({ kind: 'addLine' }),
  fc.constant<Action>({ kind: 'deleteStation' }),
  fc.constant<Action>({ kind: 'deleteLine' }),
  fc.constant<Action>({ kind: 'toggleStationOnLine' }),
  fc.constant<Action>({ kind: 'rotateStation' }),
  fc.record({
    kind: fc.constant<'moveLineInOrder'>('moveLineInOrder'),
    dir: fc.constantFrom<-1 | 1>(-1, 1),
  }),
  fc.record({
    kind: fc.constant<'setLineWidth'>('setLineWidth'),
    // Exercise below-floor, fractional, default, above-slider-max, and
    // non-finite inputs.
    w: fc.oneof(
      fc.integer({ min: -5, max: 40 }),
      fc.double({ min: 0, max: 40, noNaN: true }),
      fc.constant(Number.NaN),
    ),
  }),
);

function pickKey<T>(rec: Record<string, T>): string | null {
  const ks = Object.keys(rec);
  return ks.length === 0 ? null : ks[0];
}

function applyOne(doc: MapDoc, action: Action, ids: ReturnType<typeof counterIdFactory>): MapDoc {
  switch (action.kind) {
    case 'addStation':
      return T.addStation(doc, 0, 0, ids.stationId(), 'Test');
    case 'addLine':
      return T.addLine(doc, ids.lineId(), 'X', '#000');
    case 'deleteStation': {
      const id = pickKey(doc.stations);
      return id ? T.deleteStation(doc, id) : doc;
    }
    case 'deleteLine': {
      const id = pickKey(doc.lines);
      return id ? T.deleteLine(doc, id) : doc;
    }
    case 'toggleStationOnLine': {
      const lineId = pickKey(doc.lines);
      const stationId = pickKey(doc.stations);
      return lineId && stationId ? T.toggleStationOnLine(doc, lineId, stationId) : doc;
    }
    case 'rotateStation': {
      const id = pickKey(doc.stations);
      return id ? T.rotateStation(doc, id) : doc;
    }
    case 'moveLineInOrder': {
      const id = pickKey(doc.lines);
      return id ? T.moveLineInOrder(doc, id, action.dir) : doc;
    }
    case 'setLineWidth': {
      const id = pickKey(doc.lines);
      return id ? T.setLineWidth(doc, id, action.w) : doc;
    }
  }
}

function applyAll(actions: Action[]): MapDoc {
  const ids = counterIdFactory();
  let doc: MapDoc = { ...T.DEFAULT_DOC };
  for (const a of actions) doc = applyOne(doc, a, ids);
  return doc;
}

describe('transforms invariants (property-based)', () => {
  it('lineOrder is always a permutation of Object.keys(lines) — modulo dead/missing', () => {
    fc.assert(
      fc.property(fc.array(actionArb, { maxLength: 30 }), (actions) => {
        const doc = applyAll(actions);
        const lineKeys = new Set(Object.keys(doc.lines));
        const orderSet = new Set(doc.lineOrder);
        // Every id in lineOrder must exist in lines (no dead ids).
        for (const id of orderSet) expect(lineKeys.has(id)).toBe(true);
        // Note: the *current* implementation lazily reconciles missing ids
        // through effectiveLineOrder rather than eagerly, so we don't assert
        // every line key is in lineOrder here.
      }),
    );
  });

  it('every line.stations[i] exists in doc.stations', () => {
    fc.assert(
      fc.property(fc.array(actionArb, { maxLength: 30 }), (actions) => {
        const doc = applyAll(actions);
        for (const lid of Object.keys(doc.lines)) {
          for (const sid of doc.lines[lid].stations) {
            expect(doc.stations[sid]).toBeDefined();
          }
        }
      }),
    );
  });

  it('every station.stops[i].lineId exists in doc.lines', () => {
    fc.assert(
      fc.property(fc.array(actionArb, { maxLength: 30 }), (actions) => {
        const doc = applyAll(actions);
        for (const sid of Object.keys(doc.stations)) {
          for (const stop of doc.stations[sid].stops) {
            expect(doc.lines[stop.lineId]).toBeDefined();
          }
        }
      }),
    );
  });

  it('line.width is always in canonical stored form (integer ≥ MIN, never the default)', () => {
    fc.assert(
      fc.property(fc.array(actionArb, { maxLength: 30 }), (actions) => {
        const doc = applyAll(actions);
        for (const lid of Object.keys(doc.lines)) {
          const w = doc.lines[lid].width;
          if (w === undefined) continue;
          expect(Number.isInteger(w)).toBe(true);
          expect(w).toBeGreaterThanOrEqual(LINE_WIDTH_MIN);
          expect(w).not.toBe(LINE_WIDTH_DEFAULT);
        }
      }),
    );
  });

  it('transforms are deterministic given the same inputs', () => {
    fc.assert(
      fc.property(fc.array(actionArb, { maxLength: 30 }), (actions) => {
        const a = applyAll(actions);
        const b = applyAll(actions);
        expect(a).toEqual(b);
      }),
    );
  });
});
