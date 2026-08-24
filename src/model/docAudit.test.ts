import { describe, it, expect } from 'vitest';
import { auditDoc } from './docAudit';
import { parse } from './serialize';
import * as T from './transforms';
import {
  makeDoc,
  makeGuide,
  makeLine,
  makeLineCircle,
  makeLineTag,
  makePolygon,
  makeRouteBullet,
  makeStation,
  makeStop,
  makeSvgImage,
  makeTextLabel,
  makeTransfer,
} from '../test/fixtures';
import type { MapDoc } from './types';

// A small canonical two-station doc every mutation below corrupts from.
const cleanDoc = (): MapDoc =>
  makeDoc({
    stations: [
      makeStation({ id: 's1', stops: [makeStop('l1')] }),
      makeStation({ id: 's2', x: 100, stops: [makeStop('l1')] }),
    ],
    lines: [makeLine({ id: 'l1', stations: ['s1', 's2'] })],
    styles: Object.values(T.DEFAULT_STYLES),
  });

// The same doc carrying one record of EVERY id-keyed collection, so a test can
// ask each of them the same question.
const populatedDoc = (): MapDoc =>
  makeDoc({
    stations: [
      makeStation({ id: 's1', stops: [makeStop('l1')] }),
      makeStation({ id: 's2', x: 100, stops: [makeStop('l1')] }),
    ],
    lines: [makeLine({ id: 'l1', stations: ['s1', 's2'] })],
    lineTags: [makeLineTag({ id: 't1' })],
    routeBullets: [makeRouteBullet({ id: 'rb1' })],
    transferAnchors: [{ id: 'fa1', x: 40, y: 40 }],
    transfers: [makeTransfer({ id: 'x1' })],
    textLabels: [makeTextLabel({ id: 'g1' })],
    polygons: [makePolygon({ id: 'pg1' })],
    regionAssignments: [{ id: 'r1', lineId: 'l1', lines: ['l1'], anchors: [] }],
    svgImages: [makeSvgImage({ id: 'im1' })],
    lineCircles: [makeLineCircle({ id: 'lc1' })],
    guides: [makeGuide({ id: 'gd1' })],
    styles: Object.values(T.DEFAULT_STYLES),
  });

/**
 * Which of a doc's collections are keyed records whose records carry their own
 * `id` — read off the doc rather than restated as a list, so a collection added
 * to `MapDoc` joins the sweep below as soon as `populatedDoc` carries one.
 */
const idKeyedCollections = (doc: MapDoc): string[] =>
  Object.entries(doc)
    .filter(
      ([, value]) =>
        !!value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.values(value).length > 0 &&
        Object.values(value).every((r) => !!r && typeof (r as { id?: unknown }).id === 'string'),
    )
    .map(([key]) => key);

describe('auditDoc', () => {
  it('a canonical doc audits clean', () => {
    expect(auditDoc(cleanDoc())).toEqual([]);
  });

  it('a doc carrying one of everything audits clean', () => {
    expect(auditDoc(populatedDoc())).toEqual([]);
  });

  // A record's KEY is its identity: it is what every order array, every
  // `styleId` tag, every selection and every drag carries around, and what the
  // import path rewrites the inner `id` to (`sanitizeDocReferences`'s sweep,
  // `sanitizeStyles`). A record filed under a key its own `id` disagrees with
  // is therefore a writer bug the export door must catch — in EVERY collection,
  // not just the two that happened to be spelled out.
  it('flags an id/key mismatch in every id-keyed collection', () => {
    const collections = idKeyedCollections(populatedDoc());
    // Guards the sweep itself: a fixture that stopped populating a collection
    // would otherwise silently shrink this test to nothing.
    expect(collections.length).toBeGreaterThanOrEqual(13);
    const missed = collections.filter((collection) => {
      const doc = populatedDoc();
      const records = doc[collection as keyof MapDoc] as Record<string, { id: string }>;
      const key = Object.keys(records)[0];
      (doc as unknown as Record<string, Record<string, unknown>>)[collection] = {
        ...records,
        [key]: { ...records[key], id: 'wrong-id' },
      };
      return !auditDoc(doc).join('\n').includes('wrong-id');
    });
    expect(missed).toEqual([]);
  });

  it('states the app legitimately produces are not violations', () => {
    // deleteLine leaves stopless stations; a lone-stop line has a degree-0
    // member. Neither may trip the export-door toast.
    const doc = cleanDoc();
    doc.stations.orphan = makeStation({ id: 'orphan', x: 300, stops: [] });
    doc.lines.l1 = { ...doc.lines.l1, edges: [] }; // members now degree-0
    expect(auditDoc(doc)).toEqual([]);
  });

  const cases: Array<[string, (doc: MapDoc) => void, RegExp]> = [
    ['id/key mismatch', (d) => (d.stations.s1 = { ...d.stations.s1, id: 'x' }), /id reads/],
    [
      'member without a stop',
      (d) => (d.stations.s2 = { ...d.stations.s2, stops: [] }),
      /has no stop/,
    ],
    [
      'stop without membership',
      (d) => (d.lines.l1 = { ...d.lines.l1, stations: ['s1'], edges: [] }),
      /not a member/,
    ],
    [
      'non-canonical edge',
      (d) => (d.lines.l1 = { ...d.lines.l1, edges: ['s2|s1'] }),
      /non-canonical edge/,
    ],
    [
      'edge endpoint outside membership',
      (d) => (d.lines.l1 = { ...d.lines.l1, edges: ['s1|s2', 's2|s3'] }),
      /endpoint is not a member/,
    ],
    ['lineOrder missing a line', (d) => (d.lineOrder = []), /missing entry "l1"/],
    ['lineOrder dangling id', (d) => (d.lineOrder = ['l1', 'ghost']), /dangling entry "ghost"/],
    [
      'dangling transfer station',
      (d) =>
        (d.transfers = {
          x1: makeTransfer({ id: 'x1', a: { stationId: 'ghost', lineId: null } }),
        }),
      /dangling station/,
    ],
    [
      'dangling route-bullet line',
      (d) =>
        (d.routeBullets = {
          rb: { id: 'rb', x: 0, y: 0, rotation: 0, lineId: 'ghost', shape: 'circle', size: 12 },
        }),
      /dangling line/,
    ],
    [
      'unresolvable style default',
      (d) => (d.styleDefaults = { ...d.styleDefaults, line: 'ghost' }),
      /styleDefaults\.line/,
    ],
    [
      'dangling styleId tag',
      (d) => (d.lines.l1 = { ...d.lines.l1, styleId: 'ghost' }),
      /styleId "ghost"/,
    ],
    [
      'segment style keyed off a non-edge',
      (d) => (d.lines.l1 = { ...d.lines.l1, segmentStyles: { 'ghost|s1': 'dashed' } }),
      /segment style/,
    ],
    [
      'end-style pin for a non-member',
      (d) => (d.lines.l1 = { ...d.lines.l1, stationEndStyles: { ghost: 'round' } }),
      /end-style pin/,
    ],
    [
      'dangling circle binding',
      (d) => (d.stations.s1 = { ...d.stations.s1, circleId: 'ghost' }),
      /dangling circleId/,
    ],
    [
      'non-finite station position',
      (d) => (d.stations.s1 = { ...d.stations.s1, x: Number.NaN }),
      /non-finite position/,
    ],
    [
      'stop for a line that is gone',
      (d) => (d.stations.s1 = { ...d.stations.s1, stops: [makeStop('l1'), makeStop('ghost')] }),
      /stop for missing line "ghost"/,
    ],
    [
      'two stops for one line',
      (d) => (d.stations.s1 = { ...d.stations.s1, stops: [makeStop('l1'), makeStop('l1')] }),
      /duplicate stop for "l1"/,
    ],
    [
      'stop dot tag naming a non-stopDot style',
      (d) =>
        (d.stations.s1 = {
          ...d.stations.s1,
          stops: [makeStop('l1', { dotStyleId: 'default-line' })],
        }),
      /stop dotStyleId "default-line" is not a stopDot style/,
    ],
    [
      'line id/key mismatch',
      (d) => (d.lines.l1 = { ...d.lines.l1, id: 'x' }),
      /line "l1": id reads/,
    ],
    [
      'line listing a member twice',
      (d) => (d.lines.l1 = { ...d.lines.l1, stations: ['s1', 's2', 's1'] }),
      /duplicate members/,
    ],
    [
      'line member that is not a station',
      (d) => (d.lines.l1 = { ...d.lines.l1, stations: ['s1', 's2', 'ghost'] }),
      /member "ghost" is not a station/,
    ],
    [
      'the same edge twice',
      (d) => (d.lines.l1 = { ...d.lines.l1, edges: ['s1|s2', 's1|s2'] }),
      /duplicate edge/,
    ],
    [
      'line dot default naming a non-stopDot style',
      (d) => (d.lines.l1 = { ...d.lines.l1, multiDotStyleId: 'default-line' }),
      /dot style id "default-line" is not a stopDot style/,
    ],
    [
      'lineOrder listing a line twice',
      (d) => (d.lineOrder = ['l1', 'l1']),
      /lineOrder: duplicate entry "l1"/,
    ],
    [
      'backgroundOrder dangling id',
      (d) => (d.backgroundOrder = ['ghost']),
      /backgroundOrder: dangling entry "ghost"/,
    ],
    [
      'lineTag on a line that is gone',
      (d) => (d.lineTags = { t1: makeLineTag({ id: 't1', lineId: 'ghost' }) }),
      /lineTag "t1": dangling line "ghost"/,
    ],
    [
      'lineTag endpoints out of canonical order',
      (d) =>
        (d.lineTags = {
          t1: makeLineTag({ id: 't1', fromStationId: 's2', toStationId: 's1' }),
        }),
      /lineTag "t1": endpoints not canonical/,
    ],
    [
      'lineTag on a pair that is not an edge',
      (d) => {
        d.stations.s3 = makeStation({ id: 's3', x: 200, stops: [makeStop('l1')] });
        d.lines.l1 = { ...d.lines.l1, stations: ['s1', 's2', 's3'], edges: ['s1|s2', 's2|s3'] };
        d.lineTags = { t1: makeLineTag({ id: 't1', fromStationId: 's1', toStationId: 's3' }) };
      },
      /lineTag "t1": pair is not an edge of "l1"/,
    ],
    [
      'transfer to a hosted anchor its station never grew',
      (d) =>
        (d.transfers = {
          x1: makeTransfer({ id: 'x1', a: { stationId: 's1', anchorId: 'ghost' } }),
        }),
      /dangling hosted anchor "ghost"/,
    ],
    [
      'transfer end pinned to a line that is gone',
      (d) =>
        (d.transfers = {
          x1: makeTransfer({ id: 'x1', a: { stationId: 's1', lineId: 'ghost' } }),
        }),
      /transfer "x1": dangling line "ghost"/,
    ],
    [
      'transfer to a free anchor that is gone',
      (d) => (d.transfers = { x1: makeTransfer({ id: 'x1', a: { anchorId: 'ghost' } }) }),
      /dangling free anchor "ghost"/,
    ],
    [
      'regionAssignment on a line that is gone',
      (d) =>
        (d.regionAssignments = {
          r1: { id: 'r1', lineId: 'ghost', lines: ['ghost'], anchors: [] },
        }),
      /regionAssignment "r1": dangling line "ghost"/,
    ],
    [
      'regionAssignment whose winner is outside its own cover set',
      (d) => (d.regionAssignments = { r1: { id: 'r1', lineId: 'l1', lines: [], anchors: [] } }),
      /chosen line is not in its cover set/,
    ],
    [
      'regionAssignment covered by a line that is gone',
      (d) =>
        (d.regionAssignments = {
          r1: { id: 'r1', lineId: 'l1', lines: ['l1', 'ghost'], anchors: [] },
        }),
      /dangling cover line "ghost"/,
    ],
  ];
  for (const [label, corrupt, pattern] of cases) {
    it(`flags: ${label}`, () => {
      const doc = cleanDoc();
      corrupt(doc);
      const violations = auditDoc(doc);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations.join('\n')).toMatch(pattern);
    });
  }

  it('parse() output audits clean, even for heavily broken input', () => {
    // The repaired form of a generator-broken file must satisfy the same
    // invariants an app-written doc does — this is the contract the whole
    // hardening pathway exists to keep.
    const station = (id: string, x: number, lineIds: string[]) => ({
      id,
      name: '',
      x,
      y: 0,
      rotation: 0,
      stops: lineIds.map((lineId) => ({ lineId, row: 0, col: 0, orientation: 'auto-vertical' })),
      label: { row: 0, col: -1, rotation: 0, offset: 0, align: 'auto', valign: 'auto-down' },
    });
    const broken = JSON.stringify({
      format: 'massimo-map',
      version: 2,
      doc: {
        stations: {
          s1: station('s1', 0, ['T', 'ghost']),
          s2: { ...station('s2', 100, []), id: 'wrong' },
          s3: station('s3', 200, ['T']),
        },
        lines: {
          T: {
            id: 'T',
            service: 'T',
            name: 'T line',
            color: '#0039A6',
            stations: [],
            edges: ['s2|s1', 's1|s2', 's1|s1', 's1|dead'],
          },
        },
        lineOrder: ['ghost'],
        lineTags: { t1: { id: 't1', lineId: 'gone', fromStationId: 'a', toStationId: 'b' } },
        transfers: { x1: { id: 'x1', a: { stationId: 'nope', lineId: null }, b: 5 } },
        routeBullets: {
          rb: { id: 'rb', x: 0, y: 0, rotation: 99, lineId: 'gone', shape: 'blob', size: 12 },
        },
      },
    });
    const r = parse(broken);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(auditDoc(r.doc)).toEqual([]);
    // And the repair actually reconstructed the serving relation.
    expect(r.doc.lines.T.stations).toEqual(['s1', 's2', 's3']);
    expect(r.doc.lines.T.edges).toEqual(['s1|s2']);
    expect(r.doc.stations.s2.id).toBe('s2');
  });
});
