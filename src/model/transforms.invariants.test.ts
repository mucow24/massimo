import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import * as T from './transforms';
import { LINE_WIDTH_DEFAULT, LINE_WIDTH_MIN } from './lineWidth';
import { LINE_STROKE_COLOR_DEFAULT, LINE_STROKE_WIDTH_DEFAULT } from './lineStroke';
import type { LineStyle, MapDoc } from './types';
import { counterIdFactory } from './ids';

// A single test action — a labeled discriminated union of transforms applied
// to whatever doc state currently exists. We don't generate raw arguments;
// the runner picks valid ids from the doc at apply time, indexing into the
// current id lists with the action's `idx` field(s). Index-driven selection
// (rather than always-first) is what lets `toggleMembership` add DIFFERENT
// stations to the SAME line — so multi-station lines, and thus real segments,
// segment-style overrides, and line tags, actually form during a run.
type Action =
  | { kind: 'addStation' }
  | { kind: 'addLine' }
  | { kind: 'deleteStation'; idx: number }
  | { kind: 'deleteLine'; idx: number }
  | { kind: 'toggleMembership'; lineIdx: number; stationIdx: number }
  | { kind: 'rotateStation'; idx: number }
  | { kind: 'moveLineInOrder'; idx: number; dir: -1 | 1 }
  | { kind: 'setLineWidth'; idx: number; w: number }
  | { kind: 'setLineStrokeWidth'; idx: number; w: number }
  | { kind: 'setLineStrokeColor'; idx: number; c: string }
  | { kind: 'moveStop'; stationIdx: number; lineIdx: number; dRow: number; dCol: number }
  | {
      kind: 'setLineSegmentStyle';
      lineIdx: number;
      fromIdx: number;
      toIdx: number;
      style: LineStyle;
    }
  | { kind: 'addLineTag'; lineIdx: number; fromIdx: number; toIdx: number }
  | {
      kind: 'addTransfer';
      aStationIdx: number;
      aLineIdx: number;
      aLineNull: boolean;
      bStationIdx: number;
      bLineIdx: number;
      bLineNull: boolean;
    }
  | { kind: 'addRouteBullet'; lineIdx: number; lineNull: boolean };

// Small non-negative index used to pick an operand out of the current id list
// (taken `% list.length` at apply time). Drawn wide enough to reach beyond the
// first entry so multi-station lines and cross-pair segments can form.
const idxArb = fc.nat({ max: 12 });

const actionArb = fc.oneof(
  fc.constant<Action>({ kind: 'addStation' }),
  fc.constant<Action>({ kind: 'addLine' }),
  fc.record({ kind: fc.constant<'deleteStation'>('deleteStation'), idx: idxArb }),
  fc.record({ kind: fc.constant<'deleteLine'>('deleteLine'), idx: idxArb }),
  fc.record({
    kind: fc.constant<'toggleMembership'>('toggleMembership'),
    lineIdx: idxArb,
    stationIdx: idxArb,
  }),
  fc.record({ kind: fc.constant<'rotateStation'>('rotateStation'), idx: idxArb }),
  fc.record({
    kind: fc.constant<'moveLineInOrder'>('moveLineInOrder'),
    idx: idxArb,
    dir: fc.constantFrom<-1 | 1>(-1, 1),
  }),
  fc.record({
    kind: fc.constant<'setLineWidth'>('setLineWidth'),
    idx: idxArb,
    // Exercise below-floor, fractional, default, above-slider-max, and
    // non-finite inputs.
    w: fc.oneof(
      fc.integer({ min: -5, max: 40 }),
      fc.double({ min: 0, max: 40, noNaN: true }),
      fc.constant(Number.NaN),
    ),
  }),
  fc.record({
    kind: fc.constant<'setLineStrokeWidth'>('setLineStrokeWidth'),
    idx: idxArb,
    w: fc.oneof(
      fc.integer({ min: -5, max: 40 }),
      fc.double({ min: 0, max: 40, noNaN: true }),
      fc.constant(Number.NaN),
    ),
  }),
  fc.record({
    kind: fc.constant<'setLineStrokeColor'>('setLineStrokeColor'),
    idx: idxArb,
    // Mixed-case defaults and non-defaults to exercise the lowercase
    // normalization + drop-at-default paths.
    c: fc.constantFrom('#ffffff', '#FFFFFF', '#ab12cd', '#AB12CD', '#000000'),
  }),
  fc.record({
    kind: fc.constant<'moveStop'>('moveStop'),
    stationIdx: idxArb,
    lineIdx: idxArb,
    dRow: fc.integer({ min: -2, max: 2 }),
    dCol: fc.integer({ min: -2, max: 2 }),
  }),
  fc.record({
    kind: fc.constant<'setLineSegmentStyle'>('setLineSegmentStyle'),
    lineIdx: idxArb,
    fromIdx: idxArb,
    toIdx: idxArb,
    style: fc.constantFrom<LineStyle>('solid', 'dashed', 'hatched', 'dotted'),
  }),
  fc.record({
    kind: fc.constant<'addLineTag'>('addLineTag'),
    lineIdx: idxArb,
    fromIdx: idxArb,
    toIdx: idxArb,
  }),
  fc.record({
    kind: fc.constant<'addTransfer'>('addTransfer'),
    aStationIdx: idxArb,
    aLineIdx: idxArb,
    aLineNull: fc.boolean(),
    bStationIdx: idxArb,
    bLineIdx: idxArb,
    bLineNull: fc.boolean(),
  }),
  fc.record({
    kind: fc.constant<'addRouteBullet'>('addRouteBullet'),
    lineIdx: idxArb,
    lineNull: fc.boolean(),
  }),
);

// Pick the id at `idx % keys.length`, or null when the collection is empty.
function pickAt<T>(rec: Record<string, T>, idx: number): string | null {
  const ks = Object.keys(rec);
  return ks.length === 0 ? null : ks[idx % ks.length];
}

function applyOne(doc: MapDoc, action: Action, ids: ReturnType<typeof counterIdFactory>): MapDoc {
  switch (action.kind) {
    case 'addStation':
      return T.addStation(doc, 0, 0, ids.stationId(), 'Test');
    case 'addLine':
      return T.addLine(doc, ids.lineId(), 'X', '#000');
    case 'deleteStation': {
      const id = pickAt(doc.stations, action.idx);
      return id ? T.deleteStation(doc, id) : doc;
    }
    case 'deleteLine': {
      const id = pickAt(doc.lines, action.idx);
      return id ? T.deleteLine(doc, id) : doc;
    }
    case 'toggleMembership': {
      // Membership add/remove via the canvas primitives: a member is removed;
      // a non-member is connected from the line's last member (the old
      // toggle-append chain wiring), or seeds an empty line.
      const lineId = pickAt(doc.lines, action.lineIdx);
      const stationId = pickAt(doc.stations, action.stationIdx);
      if (!lineId || !stationId) return doc;
      const ln = doc.lines[lineId];
      if (ln.stations.includes(stationId))
        return T.removeStationFromLine(doc, lineId, ln.stations.indexOf(stationId));
      const from = ln.stations.length ? ln.stations[ln.stations.length - 1] : null;
      return from
        ? T.connectStationsOnLine(doc, lineId, from, stationId)
        : T.addStationToLine(doc, lineId, stationId);
    }
    case 'rotateStation': {
      const id = pickAt(doc.stations, action.idx);
      return id ? T.rotateStation(doc, id) : doc;
    }
    case 'moveLineInOrder': {
      const id = pickAt(doc.lines, action.idx);
      return id ? T.moveLineInOrder(doc, id, action.dir) : doc;
    }
    case 'setLineWidth': {
      const id = pickAt(doc.lines, action.idx);
      return id ? T.setLineWidth(doc, id, action.w) : doc;
    }
    case 'setLineStrokeWidth': {
      const id = pickAt(doc.lines, action.idx);
      return id ? T.setLineStrokeWidth(doc, id, action.w) : doc;
    }
    case 'setLineStrokeColor': {
      const id = pickAt(doc.lines, action.idx);
      return id ? T.setLineStrokeColor(doc, id, action.c) : doc;
    }
    case 'moveStop': {
      const stationId = pickAt(doc.stations, action.stationIdx);
      const lineId = pickAt(doc.lines, action.lineIdx);
      // moveStop early-returns if the station has no stop on the line, so an
      // off-line pick is a safe no-op.
      return stationId && lineId
        ? T.moveStop(doc, stationId, lineId, action.dRow, action.dCol)
        : doc;
    }
    case 'setLineSegmentStyle': {
      const lineId = pickAt(doc.lines, action.lineIdx);
      if (!lineId) return doc;
      const stations = doc.lines[lineId].stations;
      const from = pickAt2(stations, action.fromIdx);
      const to = pickAt2(stations, action.toIdx);
      // Only set a segment style for two DISTINCT stations actually on the line
      // (otherwise the override is keyed to a non-edge and would be meaningless).
      if (!from || !to || from === to) return doc;
      return T.setLineSegmentStyle(doc, lineId, from, to, action.style);
    }
    case 'addLineTag': {
      const lineId = pickAt(doc.lines, action.lineIdx);
      if (!lineId) return doc;
      const stations = doc.lines[lineId].stations;
      const from = pickAt2(stations, action.fromIdx);
      const to = pickAt2(stations, action.toIdx);
      // Tag both endpoints to real stations on the line; from/to may coincide
      // (a single-station "corridor") — that's still referentially valid.
      if (!from || !to) return doc;
      return T.addLineTag(doc, ids.lineTagId(), lineId, from, to, 'from', 10, 0);
    }
    case 'addTransfer': {
      const aStation = pickAt(doc.stations, action.aStationIdx);
      const bStation = pickAt(doc.stations, action.bStationIdx);
      if (!aStation || !bStation) return doc;
      const aLine = action.aLineNull ? null : pickAt(doc.lines, action.aLineIdx);
      const bLine = action.bLineNull ? null : pickAt(doc.lines, action.bLineIdx);
      return T.addTransfer(
        doc,
        ids.transferId(),
        { stationId: aStation, lineId: aLine },
        { stationId: bStation, lineId: bLine },
      );
    }
    case 'addRouteBullet': {
      const lineId = action.lineNull ? null : pickAt(doc.lines, action.lineIdx);
      return T.addRouteBullet(doc, ids.routeBulletId(), 0, 0, lineId);
    }
  }
}

// Like pickAt, but over a string[] (a line's station list). Used to pick
// segment/tag endpoints from the stations actually on the chosen line.
function pickAt2(list: string[], idx: number): string | null {
  return list.length === 0 ? null : list[idx % list.length];
}

function applyAll(actions: Action[]): MapDoc {
  const ids = counterIdFactory();
  let doc: MapDoc = { ...T.DEFAULT_DOC };
  for (const a of actions) doc = applyOne(doc, a, ids);
  return doc;
}

// Resolve a canonical pair-key (`a|b`, station ids sorted, joined with '|';
// counterIdFactory ids never contain '|') back into its two station ids.
function pairKeyStations(key: string): [string, string] {
  const [a, b] = key.split('|');
  return [a, b];
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

  it('line stroke fields are always in canonical stored form', () => {
    fc.assert(
      fc.property(fc.array(actionArb, { maxLength: 30 }), (actions) => {
        const doc = applyAll(actions);
        for (const lid of Object.keys(doc.lines)) {
          const { strokeWidth, strokeColor } = doc.lines[lid];
          if (strokeWidth !== undefined) {
            // On the half-pixel grid, never the (dropped) default.
            expect(Number.isInteger(strokeWidth * 2)).toBe(true);
            expect(strokeWidth).toBeGreaterThan(LINE_STROKE_WIDTH_DEFAULT);
          }
          if (strokeColor !== undefined) {
            expect(strokeColor).toBe(strokeColor.toLowerCase());
            expect(strokeColor).not.toBe(LINE_STROKE_COLOR_DEFAULT);
          }
        }
      }),
    );
  });

  // ---- Referential integrity: every stored cross-reference resolves to a live
  // entity, after ANY action sequence (including deletes). These are the
  // invariants that catch a prune-cascade omission: delete a line/station but
  // leave behind a segment override / tag / transfer / bullet that still points
  // at the gone id.
  //
  // The corrupting paths are NARROW (a reference must be created AND its target
  // later deleted), so the default 100 runs barely reaches them — e.g. skipping
  // `deleteLine`'s route-bullet null-out only dangles ~1.4% of random samples,
  // and the transfer cascade ~0.3%. We raise the run count on this block so the
  // reachable cascade omissions are caught reliably: at 2000 runs the bullet and
  // transfer skips fail with ≈100% / ≈99.8% probability.
  //
  // Two cascades stay out of reach even at this run count, so they are NOT relied
  // on here — they are guarded by deterministic unit tests in transforms.test.ts
  // instead: `deleteLine`'s line-tag drop (~0.05%-reachable by random search — see
  // 'deleteLine — line tag cascade'), and `deleteStation`'s segment-override prune
  // (see 'deleteStation — segment override cascade'). The latter was a real source
  // gap this suite first surfaced — `deleteStation` filtered the station out of
  // each line's `stations` but never pruned that line's `segmentStyles` — now
  // fixed (deleteStation calls pruneOrphanSegmentStyles). The invariants below
  // assert the correct property; the
  // deterministic tests are the regression guards for the narrow paths.
  const REFERENTIAL_RUNS = 2000;

  it('every segmentStyles key resolves to two existing stations and is non-default', () => {
    fc.assert(
      fc.property(fc.array(actionArb, { maxLength: 30 }), (actions) => {
        const doc = applyAll(actions);
        for (const lid of Object.keys(doc.lines)) {
          const styles = doc.lines[lid].segmentStyles;
          if (!styles) continue;
          for (const key of Object.keys(styles)) {
            const [a, b] = pairKeyStations(key);
            expect(doc.stations[a]).toBeDefined();
            expect(doc.stations[b]).toBeDefined();
            // 'solid' is the canonical default and must never be stored.
            expect(styles[key]).not.toBe('solid');
          }
        }
      }),
      { numRuns: REFERENTIAL_RUNS },
    );
  });

  it('every lineTag references a live line and live from/to stations', () => {
    fc.assert(
      fc.property(fc.array(actionArb, { maxLength: 30 }), (actions) => {
        const doc = applyAll(actions);
        for (const tid of Object.keys(doc.lineTags)) {
          const tag = doc.lineTags[tid];
          expect(doc.lines[tag.lineId]).toBeDefined();
          expect(doc.stations[tag.fromStationId]).toBeDefined();
          expect(doc.stations[tag.toStationId]).toBeDefined();
        }
      }),
      { numRuns: REFERENTIAL_RUNS },
    );
  });

  it('every transfer endpoint references a live station and a live line or null', () => {
    fc.assert(
      fc.property(fc.array(actionArb, { maxLength: 30 }), (actions) => {
        const doc = applyAll(actions);
        for (const xid of Object.keys(doc.transfers)) {
          const t = doc.transfers[xid];
          for (const end of [t.a, t.b]) {
            expect(doc.stations[end.stationId]).toBeDefined();
            if (end.lineId !== null) {
              expect(doc.lines[end.lineId]).toBeDefined();
            }
          }
        }
      }),
      { numRuns: REFERENTIAL_RUNS },
    );
  });

  it('every routeBullet references a live line or null', () => {
    fc.assert(
      fc.property(fc.array(actionArb, { maxLength: 30 }), (actions) => {
        const doc = applyAll(actions);
        for (const bid of Object.keys(doc.routeBullets)) {
          const lineId = doc.routeBullets[bid].lineId;
          if (lineId !== null) {
            expect(doc.lines[lineId]).toBeDefined();
          }
        }
      }),
      { numRuns: REFERENTIAL_RUNS },
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
