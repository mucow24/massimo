import { describe, it, expect, beforeEach } from 'vitest';
import { useDoc } from './store';
import { DEFAULT_DOC } from '../model/transforms';
import { makeLine } from '../test/fixtures';
import type { LineId } from '../model/types';

// pickNextLineName walks A..Z, 0..9, then AA.. and skips any service value
// already taken by an existing line. addLine() returns the new line's id and
// assigns `.service` from that sequence.

beforeEach(() => {
  localStorage.clear();
  useDoc.setState({ ...DEFAULT_DOC });
});

describe('addLine — auto-naming sequence', () => {
  it('names the first two lines A then B in a fresh document', () => {
    const id0 = useDoc.getState().addLine();
    expect(useDoc.getState().lines[id0].service).toBe('A');

    const id1 = useDoc.getState().addLine();
    expect(useDoc.getState().lines[id1].service).toBe('B');
  });

  it('skips service codes already taken by existing lines', () => {
    // Seed two lines already holding services A and C.
    useDoc.setState({
      ...DEFAULT_DOC,
      lines: {
        ['seedA' as LineId]: makeLine({ id: 'seedA' as LineId, service: 'A' }),
        ['seedC' as LineId]: makeLine({ id: 'seedC' as LineId, service: 'C' }),
      },
    });

    // A is taken => first free is B.
    const idB = useDoc.getState().addLine();
    expect(useDoc.getState().lines[idB].service).toBe('B');

    // Now A and B and C are taken => next free is D.
    const idD = useDoc.getState().addLine();
    expect(useDoc.getState().lines[idD].service).toBe('D');
  });
});
