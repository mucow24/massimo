import { describe, it, expect } from 'vitest';
import { buildBands } from './interlining';
import { makeDoc, makeLine, makeStation, makeStop } from '../test/fixtures';
import type { MapDoc } from '../model/types';

// ---------------------------------------------------------------------------
// Arm partition: `band.arms[k]` groups a LINE's bands into arms, glued by the
// junction through-run pairing (assignLineArms). A line with no branch
// junction is ONE arm end to end — that invariant is what keeps plain corners
// out of the self-overlap zone (lineRegions builds self parts from ARM PAIRS,
// so a single-arm line contributes none).
// ---------------------------------------------------------------------------

const line = (edges: string[]) => makeLine({ id: 'l1', color: '#c00', edges });
const hStop = (id = 'l1') => makeStop(id, { orientation: 'auto-horizontal' });
const vStop = (id = 'l1') => makeStop(id, { orientation: 'auto-vertical' });
const dStop = (id = 'l1') => makeStop(id, { orientation: 'auto-nw-se' });

/** pairKey → arm index of `lineId`'s stripe in that band. */
const armsByPair = (doc: MapDoc, lineId = 'l1'): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const b of buildBands(doc.stations, doc.lines, doc.lineOrder)) {
    const k = b.lines.findIndex((l) => l.id === lineId);
    if (k >= 0) out[b.pairKey] = b.arms[k];
  }
  return out;
};

describe('line arm partition (band.arms)', () => {
  it('a lone edge is one arm, index 0', () => {
    const doc = makeDoc({
      stations: [
        makeStation({ id: 's1', x: 0, y: 0, stops: [hStop()] }),
        makeStation({ id: 's2', x: 200, y: 0, stops: [hStop()] }),
      ],
      lines: [line(['s1|s2'])],
    });
    expect(armsByPair(doc)).toEqual({ 's1|s2': 0 });
  });

  it('a corner glues its two bands into one arm, however they bend', () => {
    const doc = makeDoc({
      stations: [
        makeStation({ id: 'b', x: 0, y: 0, stops: [hStop()] }),
        makeStation({ id: 'a', x: -120, y: 0, stops: [hStop()] }),
        makeStation({ id: 'c', x: 120, y: -120, stops: [vStop()] }),
      ],
      lines: [line(['a|b', 'b|c'])],
    });
    expect(armsByPair(doc)).toEqual({ 'a|b': 0, 'b|c': 0 });
  });

  it('a degree-3 junction: the through pair is one arm, the branch another', () => {
    const arms = armsByPair(
      makeDoc({
        stations: [
          makeStation({ id: 'j', x: 0, y: 0, stops: [hStop()] }),
          makeStation({ id: 'a', x: -120, y: 0, stops: [hStop()] }),
          makeStation({ id: 'c', x: 120, y: 0, stops: [hStop()] }),
          makeStation({ id: 'd', x: 120, y: -120, stops: [vStop()] }),
        ],
        lines: [line(['a|j', 'c|j', 'd|j'])],
      }),
    );
    expect(arms['a|j']).toBe(arms['c|j']);
    expect(arms['d|j']).not.toBe(arms['a|j']);
    expect(new Set(Object.values(arms)).size).toBe(2);
  });

  it('the through-run reaches PAST the junction: a trunk band beyond it stays in the through arm', () => {
    // Trunk a—j—c—e with the branch at j: the c|e band glues to c|j at the
    // plain joint c, which glues to a|j at the junction, so the whole trunk is
    // one arm and the branch alone is the other.
    const arms = armsByPair(
      makeDoc({
        stations: [
          makeStation({ id: 'j', x: 0, y: 0, stops: [hStop()] }),
          makeStation({ id: 'a', x: -120, y: 0, stops: [hStop()] }),
          makeStation({ id: 'c', x: 120, y: 0, stops: [hStop()] }),
          makeStation({ id: 'e', x: 240, y: 0, stops: [hStop()] }),
          makeStation({ id: 'd', x: 120, y: -120, stops: [vStop()] }),
        ],
        lines: [line(['a|j', 'c|j', 'c|e', 'd|j'])],
      }),
    );
    expect(arms['a|j']).toBe(arms['c|j']);
    expect(arms['c|e']).toBe(arms['c|j']);
    expect(arms['d|j']).not.toBe(arms['a|j']);
  });

  it('a station self-crossing splits into TWO arms, one per through-run', () => {
    const arms = armsByPair(
      makeDoc({
        stations: [
          makeStation({ id: 'j', x: 0, y: 0, stops: [hStop()] }),
          makeStation({ id: 'w', x: -200, y: 0, stops: [hStop()] }),
          makeStation({ id: 'e', x: 200, y: 0, stops: [hStop()] }),
          makeStation({ id: 'n', x: 0, y: -200, stops: [vStop()] }),
          makeStation({ id: 's', x: 0, y: 200, stops: [vStop()] }),
        ],
        lines: [line(['j|w', 'e|j', 'j|n', 'j|s'])],
      }),
    );
    expect(arms['j|w']).toBe(arms['e|j']);
    expect(arms['j|n']).toBe(arms['j|s']);
    expect(arms['j|w']).not.toBe(arms['j|n']);
    expect(new Set(Object.values(arms)).size).toBe(2);
  });

  it('two branches at one junction are two separate arms beside the through arm', () => {
    const arms = armsByPair(
      makeDoc({
        stations: [
          makeStation({ id: 'j', x: 0, y: 0, stops: [hStop()] }),
          makeStation({ id: 'a', x: -120, y: 0, stops: [hStop()] }),
          makeStation({ id: 'c', x: 120, y: 0, stops: [hStop()] }),
          makeStation({ id: 'd', x: 120, y: -120, stops: [vStop()] }),
          makeStation({ id: 'e', x: 120, y: 120, stops: [vStop()] }),
        ],
        lines: [line(['a|j', 'c|j', 'd|j', 'e|j'])],
      }),
    );
    expect(arms['a|j']).toBe(arms['c|j']);
    expect(arms['d|j']).not.toBe(arms['a|j']);
    expect(arms['e|j']).not.toBe(arms['a|j']);
    expect(arms['d|j']).not.toBe(arms['e|j']);
    expect(new Set(Object.values(arms)).size).toBe(3);
  });

  // The Broad Channel shape (the A train's same-axis fork): two arms leave the
  // junction on the SAME axis, and the through-run is decided by combined
  // straight length — so the arm partition must be identical whatever order
  // the edges are declared in.
  const broadChannel = (edges: string[]) =>
    makeDoc({
      stations: [
        makeStation({ id: 'j', x: 0, y: 0, stops: [dStop()] }),
        makeStation({ id: 'n', x: -200, y: -200, stops: [dStop()] }),
        makeStation({ id: 'm', x: 200, y: 260, stops: [vStop()] }),
        makeStation({ id: 'b', x: 140, y: 60, stops: [hStop()] }),
      ],
      lines: [line(edges)],
    });

  it('same-axis fork: the longer-running pair is the through arm, under every edge order', () => {
    const orders = [
      ['j|n', 'j|m', 'b|j'],
      ['j|n', 'b|j', 'j|m'],
      ['b|j', 'j|m', 'j|n'],
      ['j|m', 'b|j', 'j|n'],
    ];
    const first = armsByPair(broadChannel(orders[0]));
    expect(first['j|n']).toBe(first['j|m']);
    expect(first['b|j']).not.toBe(first['j|n']);
    for (const edges of orders.slice(1)) {
      expect(armsByPair(broadChannel(edges))).toEqual(first);
    }
  });

  it('a TANGENT branch never welds into the trunk, even when it out-runs a short trunk side', () => {
    // The curve departs dead opposite the far trunk too (tangent lead-in),
    // and its straight run (~250, radius-consumed) beats the short side's
    // 150 — so the run-sum tiebreak alone would glue curve+trunk as the
    // through arm, making "curve on top" unpaintable at the mouth. The
    // bend-free preference is what keeps the two straight-to-their-station
    // arms glued instead.
    const arms = armsByPair(
      makeDoc({
        stations: [
          makeStation({ id: 'a', x: -400, y: 0, stops: [hStop()] }),
          makeStation({ id: 'j', x: 0, y: 0, stops: [hStop()] }),
          makeStation({ id: 'c', x: 150, y: 0, stops: [hStop()] }),
          makeStation({ id: 'd', x: 500, y: -500, stops: [vStop()] }),
        ],
        lines: [
          makeLine({ id: 'l1', color: '#c00', edges: ['a|j', 'c|j', 'd|j'], curveRadius: 250 }),
        ],
      }),
    );
    expect(arms['a|j']).toBe(arms['c|j']);
    expect(arms['d|j']).not.toBe(arms['a|j']);
  });

  it('arms are per line: a branching line and a through line share a band without sharing verdicts', () => {
    // l1 branches at j; l2 rides the same two trunk corridors and does not.
    const doc = makeDoc({
      stations: [
        makeStation({ id: 'j', x: 0, y: 0, stops: [hStop(), hStop('l2')] }),
        makeStation({ id: 'a', x: -120, y: 0, stops: [hStop(), hStop('l2')] }),
        makeStation({ id: 'c', x: 120, y: 0, stops: [hStop(), hStop('l2')] }),
        makeStation({ id: 'd', x: 120, y: -120, stops: [vStop()] }),
      ],
      lines: [
        line(['a|j', 'c|j', 'd|j']),
        makeLine({ id: 'l2', color: '#00c', edges: ['a|j', 'c|j'] }),
      ],
    });
    const l1 = armsByPair(doc, 'l1');
    const l2 = armsByPair(doc, 'l2');
    expect(new Set(Object.values(l1)).size).toBe(2);
    expect(l2).toEqual({ 'a|j': 0, 'c|j': 0 });
  });
});
