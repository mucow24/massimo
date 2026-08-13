import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import * as T from './transforms';
import { LINE_WIDTH_DEFAULT, LINE_WIDTH_MIN } from './lineWidth';
import {
  LINE_OWN_COLOR,
  LINE_STROKE_COLOR_DEFAULT,
  LINE_STROKE_STEP,
  LINE_STROKE_WIDTH_DEFAULT,
  lineStrokeColorsEqual,
} from './lineStroke';
import type { LineStrokeColor, LineStyle, MapDoc, TransferEnd } from './types';
import { counterIdFactory } from './ids';
import { isStopEnd, transferEndResolves } from './transferAnchors';

// One transfer endpoint to fabricate: `endKind % 3` selects the arm — 0 a
// station stop, 1 a free anchor, 2 a station-hosted anchor — resolved against
// the current doc at apply time (null when the doc has nothing to bind).
type EndSpec = {
  endKind: number;
  stationIdx: number;
  lineIdx: number;
  lineNull: boolean;
  anchorIdx: number;
};

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
  | { kind: 'setLineStrokeColor'; idx: number; c: LineStrokeColor }
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
  | { kind: 'addRouteBullet'; lineIdx: number; lineNull: boolean }
  | { kind: 'addFreeAnchor' }
  | { kind: 'addStationAnchor'; stationIdx: number; row: number; col: number }
  | { kind: 'deleteFreeAnchor'; idx: number }
  | { kind: 'deleteStationAnchor'; stationIdx: number; anchorIdx: number }
  | { kind: 'moveStationAnchor'; stationIdx: number; anchorIdx: number; dRow: number; dCol: number }
  | { kind: 'addAnchorTransfer'; a: EndSpec; b: EndSpec };

// Small non-negative index used to pick an operand out of the current id list
// (taken `% list.length` at apply time). Drawn wide enough to reach beyond the
// first entry so multi-station lines and cross-pair segments can form.
const idxArb = fc.nat({ max: 12 });

const endSpecArb = fc.record({
  endKind: fc.nat({ max: 2 }),
  stationIdx: idxArb,
  lineIdx: idxArb,
  lineNull: fc.boolean(),
  anchorIdx: idxArb,
});

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
    // normalization + drop-at-default paths, plus a half-default pair (which
    // must NOT collapse) and the 'line' sentinel.
    c: fc.constantFrom<LineStrokeColor>(
      { day: '#ffffff', night: '#ffffff' },
      { day: '#FFFFFF', night: '#FFFFFF' },
      { day: '#ab12cd', night: '#AB12CD' },
      { day: '#ffffff', night: '#000000' },
      LINE_OWN_COLOR,
    ),
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
  fc.constant<Action>({ kind: 'addFreeAnchor' }),
  fc.record({
    kind: fc.constant<'addStationAnchor'>('addStationAnchor'),
    stationIdx: idxArb,
    row: fc.integer({ min: -3, max: 3 }),
    col: fc.integer({ min: -3, max: 3 }),
  }),
  fc.record({ kind: fc.constant<'deleteFreeAnchor'>('deleteFreeAnchor'), idx: idxArb }),
  fc.record({
    kind: fc.constant<'deleteStationAnchor'>('deleteStationAnchor'),
    stationIdx: idxArb,
    anchorIdx: idxArb,
  }),
  fc.record({
    kind: fc.constant<'moveStationAnchor'>('moveStationAnchor'),
    stationIdx: idxArb,
    anchorIdx: idxArb,
    dRow: fc.integer({ min: -2, max: 2 }),
    dCol: fc.integer({ min: -2, max: 2 }),
  }),
  fc.record({
    kind: fc.constant<'addAnchorTransfer'>('addAnchorTransfer'),
    a: endSpecArb,
    b: endSpecArb,
  }),
);

// Pick the id at `idx % keys.length`, or null when the collection is empty.
function pickAt<T>(rec: Record<string, T>, idx: number): string | null {
  const ks = Object.keys(rec);
  return ks.length === 0 ? null : ks[idx % ks.length];
}

// Pick a station-hosted anchor (its station id + anchor id) from the stations
// that currently own at least one, or null when none do.
function pickHostedAnchor(
  doc: MapDoc,
  stationIdx: number,
  anchorIdx: number,
): { stationId: string; anchorId: string } | null {
  const hosts = Object.keys(doc.stations).filter(
    (id) => (doc.stations[id].transferAnchors?.length ?? 0) > 0,
  );
  if (hosts.length === 0) return null;
  const stationId = hosts[stationIdx % hosts.length];
  const anchors = doc.stations[stationId].transferAnchors!;
  return { stationId, anchorId: anchors[anchorIdx % anchors.length].id };
}

// Resolve an EndSpec into a concrete TransferEnd against the current doc, or
// null when the chosen arm has nothing to bind to yet.
function resolveEnd(doc: MapDoc, spec: EndSpec): TransferEnd | null {
  const arm = spec.endKind % 3;
  if (arm === 0) {
    const stationId = pickAt(doc.stations, spec.stationIdx);
    if (!stationId) return null;
    return { stationId, lineId: spec.lineNull ? null : pickAt(doc.lines, spec.lineIdx) };
  }
  if (arm === 1) {
    const anchorId = pickAt(doc.transferAnchors, spec.anchorIdx);
    return anchorId ? { anchorId } : null;
  }
  return pickHostedAnchor(doc, spec.stationIdx, spec.anchorIdx);
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
    case 'addFreeAnchor':
      return T.addTransferAnchor(doc, ids.anchorId(), 0, 0);
    case 'addStationAnchor': {
      const stationId = pickAt(doc.stations, action.stationIdx);
      return stationId
        ? T.addStationAnchor(doc, stationId, ids.anchorId(), action.row, action.col)
        : doc;
    }
    case 'deleteFreeAnchor': {
      const id = pickAt(doc.transferAnchors, action.idx);
      return id ? T.deleteTransferAnchor(doc, id) : doc;
    }
    case 'deleteStationAnchor': {
      const h = pickHostedAnchor(doc, action.stationIdx, action.anchorIdx);
      return h ? T.deleteStationAnchor(doc, h.stationId, h.anchorId) : doc;
    }
    case 'moveStationAnchor': {
      const h = pickHostedAnchor(doc, action.stationIdx, action.anchorIdx);
      return h ? T.moveStationAnchor(doc, h.stationId, h.anchorId, action.dRow, action.dCol) : doc;
    }
    case 'addAnchorTransfer': {
      // Fabricate a transfer whose ends may be stops OR anchors (either home) —
      // the only path that gives the referential-integrity property a hosted-
      // or free-anchor end to resolve, and that fuzzes the anchor delete cascades.
      const a = resolveEnd(doc, action.a);
      const b = resolveEnd(doc, action.b);
      return a && b ? T.addTransfer(doc, ids.transferId(), a, b) : doc;
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

  it('line.width is always in canonical stored form (≥ MIN, never the default)', () => {
    // Deterministic coverage of the fractional path: a width is a free
    // world-unit measurement (the width step only moves the controls), so
    // 1.125 is stored verbatim — the case a naive Number.isInteger check
    // wrongly rejected. Injecting it as an example keeps this a reliable
    // regression guard instead of a seed-dependent flake (the original flaky
    // counterexample was exactly setLineWidth w:1.125).
    const fractionalWidth: Action[] = [
      { kind: 'addLine' },
      { kind: 'setLineWidth', idx: 0, w: 1.125 },
    ];
    fc.assert(
      fc.property(fc.array(actionArb, { maxLength: 30 }), (actions) => {
        const doc = applyAll(actions);
        for (const lid of Object.keys(doc.lines)) {
          const w = doc.lines[lid].width;
          if (w === undefined) continue;
          expect(Number.isFinite(w)).toBe(true);
          expect(w).toBeGreaterThanOrEqual(LINE_WIDTH_MIN);
          expect(w).not.toBe(LINE_WIDTH_DEFAULT);
        }
      }),
      { examples: [[fractionalWidth]] },
    );
  });

  it('line stroke fields are always in canonical stored form', () => {
    // Deterministic coverage of the fractional path. Stroke width moved onto
    // the same 0.25 grid in #276 (was 0.5, LINE_STROKE_STEP), so 0.75 stores as
    // 0.75 — a value the old half-pixel (× 2) check wrongly rejected.
    const fractionalStroke: Action[] = [
      { kind: 'addLine' },
      { kind: 'setLineStrokeWidth', idx: 0, w: 0.75 },
    ];
    fc.assert(
      fc.property(fc.array(actionArb, { maxLength: 30 }), (actions) => {
        const doc = applyAll(actions);
        for (const lid of Object.keys(doc.lines)) {
          const { strokeWidth, strokeColor } = doc.lines[lid];
          if (strokeWidth !== undefined) {
            // On the 0.25 grid, never the (dropped) default.
            expect(Number.isInteger(strokeWidth / LINE_STROKE_STEP)).toBe(true);
            expect(strokeWidth).toBeGreaterThan(LINE_STROKE_WIDTH_DEFAULT);
          }
          if (strokeColor !== undefined) {
            // The sentinel is storable as-is; a pair is lowercase in both
            // halves and never the (dropped) all-white default.
            if (strokeColor !== LINE_OWN_COLOR) {
              expect(strokeColor.day).toBe(strokeColor.day.toLowerCase());
              expect(strokeColor.night).toBe(strokeColor.night.toLowerCase());
              expect(lineStrokeColorsEqual(strokeColor, LINE_STROKE_COLOR_DEFAULT)).toBe(false);
            }
          }
        }
      }),
      { examples: [[fractionalStroke]] },
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

  it('every transfer endpoint resolves: a live stop, or a live anchor in either home', () => {
    fc.assert(
      fc.property(fc.array(actionArb, { maxLength: 30 }), (actions) => {
        const doc = applyAll(actions);
        for (const xid of Object.keys(doc.transfers)) {
          const t = doc.transfers[xid];
          for (const end of [t.a, t.b]) {
            // One predicate per arm of the union, rather than reading
            // .stationId/.lineId unconditionally: a stop end resolves in
            // `stations`, a hosted-anchor end in that station's own cell list,
            // and a free-anchor end in `transferAnchors`.
            expect(transferEndResolves(doc, end)).toBe(true);
            if (isStopEnd(end) && end.lineId !== null) {
              expect(doc.lines[end.lineId]).toBeDefined();
            }
          }
        }
      }),
      { numRuns: REFERENTIAL_RUNS },
    );
  });

  it('the anchor actions actually form (and cascade) anchor-ended transfers', () => {
    // Coverage guard: the referential property above only MEANS something for
    // anchors if the fuzzer can build an anchor-ended transfer. Pin that the
    // machinery does, deterministically — one free end and one hosted end.
    const build: Action[] = [
      { kind: 'addStation' }, // s0
      { kind: 'addFreeAnchor' }, // a0 (free)
      { kind: 'addStationAnchor', stationIdx: 0, row: 2, col: 0 }, // a1 hosted on s0
      {
        kind: 'addAnchorTransfer',
        a: { endKind: 1, stationIdx: 0, lineIdx: 0, lineNull: true, anchorIdx: 0 }, // free a0
        b: { endKind: 2, stationIdx: 0, lineIdx: 0, lineNull: true, anchorIdx: 0 }, // hosted a1
      },
    ];
    const doc = applyAll(build);
    const transfers = Object.values(doc.transfers);
    expect(transfers).toHaveLength(1);
    expect(isStopEnd(transfers[0].a)).toBe(false); // free-anchor arm exercised
    expect(isStopEnd(transfers[0].b)).toBe(false); // hosted-anchor arm exercised
    expect(transferEndResolves(doc, transfers[0].a)).toBe(true);
    expect(transferEndResolves(doc, transfers[0].b)).toBe(true);

    // Removing the free anchor cascades its transfer away.
    const afterDelete = applyAll([...build, { kind: 'deleteFreeAnchor', idx: 0 }]);
    expect(Object.keys(afterDelete.transfers)).toHaveLength(0);
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
