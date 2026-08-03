// The station popover's transfer picker, at the store level: one self-transfer
// per stop, styled by preset, cleared by "None". The pure add/find transforms
// are covered in model/transforms.test.ts.
import { describe, it, expect, beforeEach } from 'vitest';
import { useDoc } from './store';
import { undo } from './history';
import { DEFAULT_DOC, selfTransferAt } from '../model/transforms';
import { resolveTransferStyle } from '../model/transferStyle';
import { makeLine, makeStation, makeStop, makeStyle } from '../test/fixtures';

const FAT = makeStyle('transfer', 'y-fat', { name: 'Fat', props: { thickness: 12 } });
const THIN = makeStyle('transfer', 'y-thin', { name: 'Thin', props: { thickness: 4 } });

const seed = (stops = [makeStop('L1')]) => {
  useDoc.setState({
    ...DEFAULT_DOC,
    stations: { s1: makeStation({ id: 's1', stops }) },
    lines: { L1: makeLine({ id: 'L1', stations: ['s1'] }) },
    lineOrder: ['L1'],
    styles: { ...DEFAULT_DOC.styles, 'y-fat': FAT, 'y-thin': THIN },
  });
  useDoc.temporal.getState().clear();
};

beforeEach(() => {
  localStorage.clear();
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
});

describe('setStopSelfTransfer', () => {
  it('creates the self-transfer, stamped AND tagged with the chosen style', () => {
    seed();
    useDoc.getState().setStopSelfTransfer('s1', 'L1', 'y-fat');
    const t = selfTransferAt(useDoc.getState(), 's1', 'L1');
    expect(t).toBeDefined();
    expect(t!.styleId).toBe('y-fat');
    expect(resolveTransferStyle(t!).thickness).toBe(12);
  });

  it('re-picking a different style restyles the SAME transfer — never a second one', () => {
    seed();
    useDoc.getState().setStopSelfTransfer('s1', 'L1', 'y-fat');
    const first = selfTransferAt(useDoc.getState(), 's1', 'L1')!.id;
    useDoc.getState().setStopSelfTransfer('s1', 'L1', 'y-thin');
    const after = Object.values(useDoc.getState().transfers);
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(first);
    expect(after[0].styleId).toBe('y-thin');
    expect(resolveTransferStyle(after[0]).thickness).toBe(4);
  });

  it('"None" (null) removes it', () => {
    seed();
    useDoc.getState().setStopSelfTransfer('s1', 'L1', 'y-fat');
    useDoc.getState().setStopSelfTransfer('s1', 'L1', null);
    expect(useDoc.getState().transfers).toEqual({});
  });

  it('"None" with nothing there is a no-op — no doc churn, no undo entry', () => {
    seed();
    const before = useDoc.getState().transfers;
    useDoc.getState().setStopSelfTransfer('s1', 'L1', null);
    expect(useDoc.getState().transfers).toBe(before);
    expect(useDoc.temporal.getState().pastStates).toHaveLength(0);
  });

  it('each pick is exactly one undo step', () => {
    seed();
    useDoc.getState().setStopSelfTransfer('s1', 'L1', 'y-fat');
    expect(Object.keys(useDoc.getState().transfers)).toHaveLength(1);
    undo();
    expect(useDoc.getState().transfers).toEqual({});
  });

  it('refuses a stop the station does not have', () => {
    seed([]);
    useDoc.getState().setStopSelfTransfer('s1', 'L1', 'y-fat');
    expect(useDoc.getState().transfers).toEqual({});
  });

  it('leaves an unrelated transfer between two DOTS of the station alone', () => {
    seed([makeStop('L1'), makeStop('L2', { col: 1 })]);
    const pair = {
      id: 'x1',
      a: { stationId: 's1', lineId: 'L1' },
      b: { stationId: 's1', lineId: 'L2' },
    };
    useDoc.setState({ transfers: { x1: pair } });
    useDoc.getState().setStopSelfTransfer('s1', 'L1', 'y-fat');
    expect(useDoc.getState().transfers.x1).toBe(pair);
    expect(Object.keys(useDoc.getState().transfers)).toHaveLength(2);
    useDoc.getState().setStopSelfTransfer('s1', 'L1', null);
    expect(useDoc.getState().transfers.x1).toBe(pair);
    expect(Object.keys(useDoc.getState().transfers)).toHaveLength(1);
  });
});
