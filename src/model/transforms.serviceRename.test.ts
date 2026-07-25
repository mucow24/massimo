import { describe, expect, it } from 'vitest';
import * as T from '../model/transforms';
import { makeDoc, makeLine, makeStation, makeTextLabel } from '../test/fixtures';
import { parseLabelLine } from '../geometry/labelTokens';

// Probe: updateLine's inline-bullet rewrite when the OLD service code is ''.
describe('updateLine with an empty old service code', () => {
  it("leaves another line's unfilled bullet alone (typing after a full backspace)", () => {
    // Sanity: `||B||` really is ONE unfilled circle bullet for line B, and a
    // bare `||` is literal text (CODE requires >= 1 char).
    expect(parseLabelLine('Union Sq ||B||')).toEqual([
      { kind: 'text', value: 'Union Sq ' },
      { kind: 'bullet', code: 'B', shape: 'circle', filled: false },
    ]);

    const doc = makeDoc({
      stations: [makeStation({ id: 's1', name: 'Union Sq ||B||' })],
      lines: [makeLine({ id: 'L1', service: 'A' }), makeLine({ id: 'L2', service: 'B' })],
      textLabels: [makeTextLabel({ id: 't1', text: 'Depot []' })],
    });

    // Exactly what the Service-code input does: Backspace clears it (one
    // controlled onChange), then the next keystroke types the new code.
    const cleared = T.updateLine(doc, 'L1', { service: '' });
    const next = T.updateLine(cleared, 'L1', { service: 'C' });

    expect(next.lines.L1.service).toBe('C');
    // Literal punctuation in a text label must not become a route bullet.
    expect(next.textLabels.t1.text).toBe('Depot []');
    // Line B's bullet belongs to a different line — it must be untouched.
    expect(next.stations.s1.name).toBe('Union Sq ||B||');
  });

  it("does not mangle the line's OWN unfilled bullet across the same two keystrokes", () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 's1', name: '||A|| North' })],
      lines: [makeLine({ id: 'L1', service: 'A' })],
    });
    const next = T.updateLine(T.updateLine(doc, 'L1', { service: '' }), 'L1', { service: 'C' });
    // An empty code can neither be searched for nor written, so the migration
    // is SKIPPED rather than attempted — the bullet is left verbatim. (The
    // inspector no longer writes the empty intermediate at all, so the real
    // gesture migrates; see the LineInspector test. This pins that even a
    // direct model call can't corrupt.)
    expect(next.stations.s1.name).toBe('||A|| North');
  });

  it('still migrates the bullet on a single rename write', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 's1', name: '||A|| North' })],
      lines: [makeLine({ id: 'L1', service: 'A' })],
    });
    expect(T.updateLine(doc, 'L1', { service: 'C' }).stations.s1.name).toBe('||C|| North');
  });

  it('skips the migration when the NEW code is not a valid bullet code', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 's1', name: '|A| North' })],
      lines: [makeLine({ id: 'L1', service: 'A' })],
    });
    // `[` is a delimiter: `|[|` would be unparseable, so leave the text alone.
    const next = T.updateLine(doc, 'L1', { service: '[' });
    expect(next.lines.L1.service).toBe('[');
    expect(next.stations.s1.name).toBe('|A| North');
  });
});
