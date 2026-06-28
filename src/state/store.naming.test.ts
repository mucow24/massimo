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

  it('rolls over from single- to double-letter codes after the 36-char alphabet', () => {
    // Add lines into a fresh document and read back the assigned service at
    // each transition. The sequence is A..Z, 0..9 (36 single chars), then the
    // double-letter block AA, AB, ... where the second char cycles through the
    // same alphabet (..AZ, A0, A1.. — '0' is the char that follows 'Z').
    const services: string[] = [];
    for (let i = 0; i < 63; i++) {
      const id = useDoc.getState().addLine();
      services.push(useDoc.getState().lines[id].service);
    }
    expect(services[25]).toBe('Z'); // last letter
    expect(services[26]).toBe('0'); // alphabet continues into digits
    expect(services[35]).toBe('9'); // last single char (index 35 = len-1)
    expect(services[36]).toBe('AA'); // rolls over into the double-letter block
    expect(services[61]).toBe('AZ'); // second char reaches end of letters
    expect(services[62]).toBe('A0'); // second char wraps into digits, first stays
  });
});
