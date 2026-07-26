import { describe, it, expect, beforeEach } from 'vitest';
import { pickTransferEnd } from './transferPick';
import { useDoc, useSelection } from './store';
import { DEFAULT_DOC } from '../model/transforms';
import { makeDoc, makeLine, makeStation, stationWithStop } from '../test/fixtures';

// The two-click transfer flow, now that an end can be a stop OR an anchor.
// This is the payoff of the whole feature: a transfer that turns a corner is
// two segments meeting at one anchor.

const ends = (id: string) => {
  const t = useDoc.getState().transfers[id];
  return [t.a, t.b];
};

beforeEach(() => {
  useDoc.setState({
    ...useDoc.getState(),
    ...DEFAULT_DOC,
    ...makeDoc({
      stations: [
        stationWithStop('s1', 'l1', { x: 0, y: 0 }),
        stationWithStop('s2', 'l1', { x: 200, y: 200 }),
      ],
      lines: [makeLine({ id: 'l1', stations: ['s1', 's2'] })],
      transferAnchors: [
        { id: 'a1', x: 0, y: 200 },
        { id: 'a2', x: 200, y: 0 },
      ],
    }),
  });
  useSelection.setState({
    ...useSelection.getState(),
    uiMode: { kind: 'creating-transfer', firstEnd: null },
  });
});

const uiMode = () => useSelection.getState().uiMode;

describe('pickTransferEnd', () => {
  it('arms the mode on the first pick and commits on the second', () => {
    pickTransferEnd({ stationId: 's1', lineId: 'l1' });
    expect(uiMode()).toEqual({
      kind: 'creating-transfer',
      firstEnd: { stationId: 's1', lineId: 'l1' },
    });
    expect(Object.keys(useDoc.getState().transfers)).toHaveLength(0);

    pickTransferEnd({ anchorId: 'a1' });
    const ids = Object.keys(useDoc.getState().transfers);
    expect(ids).toHaveLength(1);
    expect(ends(ids[0])).toEqual([{ stationId: 's1', lineId: 'l1' }, { anchorId: 'a1' }]);
    // Committing exits the mode.
    expect(uiMode().kind).toBe('idle');
  });

  it('joins two anchors — the elbow of a 90-degree transfer', () => {
    // s1 → a1 → s2 is two segments meeting at a corner; this is the second one
    // in its purest form, anchor to anchor.
    pickTransferEnd({ anchorId: 'a1' });
    pickTransferEnd({ anchorId: 'a2' });
    const ids = Object.keys(useDoc.getState().transfers);
    expect(ends(ids[0])).toEqual([{ anchorId: 'a1' }, { anchorId: 'a2' }]);
  });

  it('builds a real elbow: two transfers sharing one anchor', () => {
    pickTransferEnd({ stationId: 's1', lineId: 'l1' });
    pickTransferEnd({ anchorId: 'a1' });
    useSelection.setState({
      ...useSelection.getState(),
      uiMode: { kind: 'creating-transfer', firstEnd: null },
    });
    pickTransferEnd({ anchorId: 'a1' });
    pickTransferEnd({ stationId: 's2', lineId: 'l1' });

    const all = Object.values(useDoc.getState().transfers);
    expect(all).toHaveLength(2);
    // Both segments name the same anchor, so dragging it moves the corner and
    // both legs follow.
    const anchorEnds = all.flatMap((t) => [t.a, t.b]).filter((e) => 'anchorId' in e);
    expect(anchorEnds).toEqual([{ anchorId: 'a1' }, { anchorId: 'a1' }]);
  });

  it('is inert on a repeat pick of the same anchor, staying in the mode', () => {
    // A zero-length transfer is refused; dropping out of the mode on a
    // mis-click would be worse than doing nothing.
    pickTransferEnd({ anchorId: 'a1' });
    pickTransferEnd({ anchorId: 'a1' });
    expect(Object.keys(useDoc.getState().transfers)).toHaveLength(0);
    expect(uiMode()).toEqual({ kind: 'creating-transfer', firstEnd: { anchorId: 'a1' } });
  });

  it('still allows the two dots of one interlined station', () => {
    useDoc.setState({
      ...useDoc.getState(),
      stations: {
        ...useDoc.getState().stations,
        s1: makeStation({
          id: 's1',
          stops: [
            { lineId: 'l1', row: 0, col: 0, orientation: 'auto-vertical' },
            { lineId: 'l2', row: 0, col: 1, orientation: 'auto-vertical' },
          ],
        }),
      },
    });
    pickTransferEnd({ stationId: 's1', lineId: 'l1' });
    pickTransferEnd({ stationId: 's1', lineId: 'l2' });
    expect(Object.keys(useDoc.getState().transfers)).toHaveLength(1);
  });

  it('does nothing at all outside creating-transfer mode', () => {
    useSelection.setState({ ...useSelection.getState(), uiMode: { kind: 'idle' } });
    pickTransferEnd({ anchorId: 'a1' });
    expect(uiMode()).toEqual({ kind: 'idle' });
    expect(Object.keys(useDoc.getState().transfers)).toHaveLength(0);
  });
});
