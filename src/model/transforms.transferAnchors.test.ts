import { describe, expect, it } from 'vitest';
import * as T from './transforms';
import { makeDoc, makeLine, makeStation, makeTransfer, stationWithStop } from '../test/fixtures';
import type { MapDoc } from './types';

// Transfer anchors: the two homes, their CRUD, and — the part that actually
// carries risk — the cascades. A transfer whose end orphans must go with it,
// and a station-hosted anchor must survive every station-layout transform that
// rewrites cells, or the elbow it was placed to make tears apart.

const anchorCells = (doc: MapDoc, stationId: string) =>
  doc.stations[stationId].transferAnchors ?? [];

describe('free transfer anchors', () => {
  it('adds one at a world point', () => {
    const doc = T.addTransferAnchor(makeDoc({}), 'a1', 30, 40);
    expect(doc.transferAnchors.a1).toEqual({ id: 'a1', x: 30, y: 40 });
  });

  it('moves one to absolute world coords', () => {
    const doc = T.moveTransferAnchor(
      makeDoc({ transferAnchors: [{ id: 'a1', x: 0, y: 0 }] }),
      'a1',
      12,
      -5,
    );
    expect(doc.transferAnchors.a1).toEqual({ id: 'a1', x: 12, y: -5 });
  });

  it('returns the SAME doc reference when moving a missing anchor', () => {
    // The no-op-returns-same-reference invariant is what stops a stray action
    // from pushing an empty undo entry (docSnapshotsEqual is reference-based).
    const doc = makeDoc({});
    expect(T.moveTransferAnchor(doc, 'ghost', 1, 1)).toBe(doc);
  });

  it('returns the SAME doc reference when deleting a missing anchor', () => {
    const doc = makeDoc({});
    expect(T.deleteTransferAnchor(doc, 'ghost')).toBe(doc);
  });

  it('leaves doc.transfers by reference when the deleted anchor had none', () => {
    // pruneTransfers allocates a fresh record unconditionally; deleteAnchor
    // must not hand that back or every anchor delete dirties `transfers` too.
    const doc = makeDoc({
      transferAnchors: [{ id: 'a1', x: 0, y: 0 }],
      stations: [makeStation({ id: 's1' }), makeStation({ id: 's2' })],
      transfers: [makeTransfer({ id: 'x1' })],
    });
    const next = T.deleteTransferAnchor(doc, 'a1');
    expect(next.transferAnchors.a1).toBeUndefined();
    expect(next.transfers).toBe(doc.transfers);
  });

  it('cascade-deletes transfers bound to it', () => {
    const doc = makeDoc({
      transferAnchors: [{ id: 'a1', x: 0, y: 0 }],
      stations: [makeStation({ id: 's1' })],
      transfers: [
        makeTransfer({
          id: 'keep',
          a: { stationId: 's1', lineId: null },
          b: { anchorId: 'other' },
        }),
        makeTransfer({ id: 'drop', a: { stationId: 's1', lineId: null }, b: { anchorId: 'a1' } }),
      ],
    });
    const next = T.deleteTransferAnchor(doc, 'a1');
    expect(Object.keys(next.transfers)).toEqual(['keep']);
  });
});

describe('station-hosted transfer anchors', () => {
  it('adds a cell to the station and omits the array until one exists', () => {
    const base = makeDoc({ stations: [makeStation({ id: 's1' })] });
    expect(base.stations.s1.transferAnchors).toBeUndefined();
    const doc = T.addStationAnchor(base, 's1', 'a1', 2, -1);
    expect(anchorCells(doc, 's1')).toEqual([{ id: 'a1', row: 2, col: -1 }]);
  });

  it('moves a cell by a (dRow, dCol) delta, like moveStop', () => {
    let doc = T.addStationAnchor(
      makeDoc({ stations: [makeStation({ id: 's1' })] }),
      's1',
      'a1',
      0,
      0,
    );
    doc = T.moveStationAnchor(doc, 's1', 'a1', 1, 2);
    expect(anchorCells(doc, 's1')).toEqual([{ id: 'a1', row: 1, col: 2 }]);
  });

  it('drops the array entirely when the last anchor is deleted', () => {
    let doc = T.addStationAnchor(
      makeDoc({ stations: [makeStation({ id: 's1' })] }),
      's1',
      'a1',
      0,
      0,
    );
    doc = T.deleteStationAnchor(doc, 's1', 'a1');
    expect(doc.stations.s1.transferAnchors).toBeUndefined();
  });

  it('cascade-deletes transfers bound to the removed cell', () => {
    let doc = makeDoc({
      stations: [makeStation({ id: 's1' }), makeStation({ id: 's2' })],
      transfers: [
        makeTransfer({
          id: 'x1',
          a: { stationId: 's1', anchorId: 'a1' },
          b: { stationId: 's2', lineId: null },
        }),
      ],
    });
    doc = T.addStationAnchor(doc, 's1', 'a1', 1, 0);
    const next = T.deleteStationAnchor(doc, 's1', 'a1');
    expect(next.transfers).toEqual({});
  });

  it('rides the 90° layout rotation with the stops it was placed against', () => {
    // THE reason hosted anchors live on the Station instead of a doc-level
    // record. rotateStationLayoutBy90 rewrites every cell through a local
    // rotateGrid; an anchor held elsewhere would sit still while the layout
    // turned around it, tearing the elbow apart.
    let doc = makeDoc({
      stations: [stationWithStop('s1', 'l1', { x: 0, y: 0 }, { stopRow: 0, stopCol: 1 })],
    });
    doc = T.addStationAnchor(doc, 's1', 'a1', 0, 2);
    const rotated = T.rotateStationAndLayout(doc, 's1', 1);
    // dir=+1 maps (col,row) -> (-row, col), so (row 0, col 2) -> (row 2, col 0),
    // exactly the mapping the stop at (row 0, col 1) takes to (row 1, col 0).
    expect(rotated.stations.s1.stops[0]).toMatchObject({ row: 1, col: 0 });
    expect(anchorCells(rotated, 's1')).toEqual([{ id: 'a1', row: 2, col: 0 }]);
  });
});

describe('delete cascades reaching anchors', () => {
  it('deleteStation drops its hosted anchors AND their transfers', () => {
    let doc = makeDoc({
      stations: [makeStation({ id: 's1' }), makeStation({ id: 's2' })],
      transfers: [
        makeTransfer({ id: 'x1', a: { stationId: 's1', anchorId: 'a1' }, b: { anchorId: 'free' } }),
      ],
      transferAnchors: [{ id: 'free', x: 0, y: 0 }],
    });
    doc = T.addStationAnchor(doc, 's1', 'a1', 1, 0);
    const next = T.deleteStation(doc, 's1');
    expect(next.stations.s1).toBeUndefined();
    // The transfer's OTHER end was a live free anchor — it still goes, because
    // a transfer needs both ends.
    expect(next.transfers).toEqual({});
    expect(next.transferAnchors.free).toBeDefined();
  });

  it('deleteStation leaves a transfer between two free anchors alone', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 's1' })],
      transferAnchors: [
        { id: 'a1', x: 0, y: 0 },
        { id: 'a2', x: 10, y: 0 },
      ],
      transfers: [makeTransfer({ id: 'x1', a: { anchorId: 'a1' }, b: { anchorId: 'a2' } })],
    });
    expect(Object.keys(T.deleteStation(doc, 's1').transfers)).toEqual(['x1']);
  });

  it('deleteLine spares an anchor-ended transfer', () => {
    // The line cascade keys on lineId; an anchor end has none, so it must not
    // be swept up by a `e.lineId === id` predicate that forgot to narrow.
    const doc = makeDoc({
      stations: [makeStation({ id: 's1' })],
      lines: [makeLine({ id: 'l1' })],
      transferAnchors: [{ id: 'a1', x: 0, y: 0 }],
      transfers: [
        makeTransfer({ id: 'x1', a: { anchorId: 'a1' }, b: { stationId: 's1', lineId: null } }),
      ],
    });
    expect(Object.keys(T.deleteLine(doc, 'l1').transfers)).toEqual(['x1']);
  });
});

describe('addTransfer with anchor ends', () => {
  const base = () =>
    makeDoc({
      stations: [
        stationWithStop('s1', 'l1', { x: 0, y: 0 }),
        stationWithStop('s2', 'l1', { x: 100, y: 0 }),
      ],
      lines: [makeLine({ id: 'l1', stations: ['s1', 's2'] })],
      transferAnchors: [
        { id: 'a1', x: 0, y: 0 },
        { id: 'a2', x: 50, y: 0 },
      ],
    });

  it('joins a station stop to a free anchor', () => {
    const doc = T.addTransfer(base(), 'x1', { stationId: 's1', lineId: 'l1' }, { anchorId: 'a1' });
    expect(doc.transfers.x1.b).toEqual({ anchorId: 'a1' });
  });

  it('joins two free anchors', () => {
    const doc = T.addTransfer(base(), 'x1', { anchorId: 'a1' }, { anchorId: 'a2' });
    expect(doc.transfers.x1).toMatchObject({ a: { anchorId: 'a1' }, b: { anchorId: 'a2' } });
  });

  it('refuses an anchor to ITSELF', () => {
    const doc = base();
    expect(T.addTransfer(doc, 'x1', { anchorId: 'a1' }, { anchorId: 'a1' })).toBe(doc);
  });

  it('refuses an end whose anchor does not exist', () => {
    const doc = base();
    expect(T.addTransfer(doc, 'x1', { anchorId: 'ghost' }, { anchorId: 'a1' })).toBe(doc);
  });

  it('refuses an end whose hosted anchor is not on that station', () => {
    const doc = base();
    expect(
      T.addTransfer(doc, 'x1', { stationId: 's1', anchorId: 'nope' }, { anchorId: 'a1' }),
    ).toBe(doc);
  });

  it('still refuses the same station+line stop pair', () => {
    const doc = base();
    expect(
      T.addTransfer(
        doc,
        'x1',
        { stationId: 's1', lineId: 'l1' },
        { stationId: 's1', lineId: 'l1' },
      ),
    ).toBe(doc);
  });
});
