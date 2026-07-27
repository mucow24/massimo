import { describe, it, expect } from 'vitest';
import {
  endStationId,
  isAnchorEnd,
  isFreeAnchorEnd,
  isHostedAnchorEnd,
  isStopEnd,
  stationAnchorCell,
  transferEndResolves,
} from './transferAnchors';
import type { LineId, MapDoc, Station, StationId, TransferEnd } from './types';
import { makeStation } from '../test/fixtures';

// One value per arm of the structural union, named the way the module talks
// about them. The stop arm is the trap: it carries a stationId, so every guard
// below has to separate it from the HOSTED anchor arm on more than that.
const stop: TransferEnd = { stationId: 's1' as StationId, lineId: 'L1' as LineId };
const stopNoLine: TransferEnd = { stationId: 's1' as StationId, lineId: null };
const hosted: TransferEnd = { stationId: 's1' as StationId, anchorId: 'h1' };
const free: TransferEnd = { anchorId: 'f1' };

describe('TransferEnd narrowing guards', () => {
  it('isStopEnd / isAnchorEnd split the union on anchorId, not stationId', () => {
    expect([stop, stopNoLine, hosted, free].map(isStopEnd)).toEqual([true, true, false, false]);
    expect([stop, stopNoLine, hosted, free].map(isAnchorEnd)).toEqual([false, false, true, true]);
  });

  it('isHostedAnchorEnd rejects a STOP end, which also carries a stationId', () => {
    // The whole reason this guard exists. A bare `'stationId' in end` answers
    // true for a plain stop dot, so anything that used it to mean "hosted
    // anchor" was correct only by virtue of an earlier isStopEnd branch.
    expect(isHostedAnchorEnd(stop)).toBe(false);
    expect(isHostedAnchorEnd(stopNoLine)).toBe(false);
    expect(isHostedAnchorEnd(hosted)).toBe(true);
    expect(isHostedAnchorEnd(free)).toBe(false);
  });

  it('isFreeAnchorEnd rejects a stop end too, and is the exact complement within the anchor arms', () => {
    expect(isFreeAnchorEnd(stop)).toBe(false);
    expect(isFreeAnchorEnd(hosted)).toBe(false);
    expect(isFreeAnchorEnd(free)).toBe(true);
    // Total and non-overlapping across the anchor arms: every anchor end is
    // exactly one of hosted/free, so a caller can branch on one and trust the
    // other in the else.
    for (const end of [hosted, free]) {
      expect(isHostedAnchorEnd(end)).toBe(!isFreeAnchorEnd(end));
    }
  });

  it('endStationId is what makes the station delete-cascade one predicate', () => {
    // Both station-keyed arms answer, so `endStationId(e) === id` orphans a
    // station's stops AND its hosted anchors together.
    expect(endStationId(stop)).toBe('s1');
    expect(endStationId(hosted)).toBe('s1');
    expect(endStationId(free)).toBeNull();
  });
});

describe('transferEndResolves', () => {
  const host: Station = makeStation({
    id: 's1' as StationId,
    transferAnchors: [{ id: 'h1', row: 0, col: 1 }],
  });
  const doc: Pick<MapDoc, 'stations' | 'transferAnchors'> = {
    stations: { s1: host },
    transferAnchors: { f1: { id: 'f1', x: 10, y: 20 } },
  };

  it('resolves each live arm', () => {
    expect(transferEndResolves(doc, stop)).toBe(true);
    expect(transferEndResolves(doc, hosted)).toBe(true);
    expect(transferEndResolves(doc, free)).toBe(true);
  });

  it('drops a stop whose station is gone', () => {
    expect(transferEndResolves(doc, { stationId: 'gone' as StationId, lineId: null })).toBe(false);
  });

  it('drops a hosted anchor whose station lost the cell — not merely the station', () => {
    // The case the naive `'stationId' in end` version would still have got
    // right, kept here because it is the one that distinguishes a hosted
    // anchor from a stop: the station is alive, the CELL is not.
    expect(transferEndResolves(doc, { stationId: 's1' as StationId, anchorId: 'nope' })).toBe(
      false,
    );
  });

  it('does not mistake a stop end for a hosted anchor on a station with no anchors', () => {
    // A station carrying no anchors at all still hosts stops. Were the hosted
    // branch reached for a stop end, stationAnchorCell would return undefined
    // and a perfectly live transfer would be reported broken — which the
    // selection reconcile reads as "clear the armed first end".
    const bare: Pick<MapDoc, 'stations' | 'transferAnchors'> = {
      stations: { s1: makeStation({ id: 's1' as StationId }) },
      transferAnchors: {},
    };
    expect(transferEndResolves(bare, stop)).toBe(true);
  });

  it('drops a free anchor that was removed', () => {
    expect(transferEndResolves(doc, { anchorId: 'gone' })).toBe(false);
  });
});

describe('stationAnchorCell', () => {
  const host = makeStation({
    id: 's1' as StationId,
    transferAnchors: [
      { id: 'h1', row: 0, col: 1 },
      { id: 'h2', row: 2, col: -1 },
    ],
  });

  it('finds a cell by id and returns undefined for a miss or a missing station', () => {
    expect(stationAnchorCell(host, 'h2')).toEqual({ id: 'h2', row: 2, col: -1 });
    expect(stationAnchorCell(host, 'nope')).toBeUndefined();
    expect(stationAnchorCell(undefined, 'h1')).toBeUndefined();
    expect(stationAnchorCell(makeStation({ id: 's2' as StationId }), 'h1')).toBeUndefined();
  });
});
