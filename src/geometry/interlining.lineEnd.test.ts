import { describe, it, expect } from 'vitest';
import { buildBands, buildStopMarkers } from './interlining';
import { makeDoc, makeLine, makeStation, makeStop } from '../test/fixtures';
import type { Line, MapDoc } from '../model/types';

// A—B—C running north to south: A and C are termini, B is interior.
const chain = (linePatch: Partial<Line> = {}): MapDoc =>
  makeDoc({
    stations: [
      makeStation({ id: 'A', x: 0, y: 0, stops: [makeStop('L1')] }),
      makeStation({ id: 'B', x: 0, y: 100, stops: [makeStop('L1')] }),
      makeStation({ id: 'C', x: 0, y: 200, stops: [makeStop('L1')] }),
    ],
    lines: [makeLine({ id: 'L1', stations: ['A', 'B', 'C'], ...linePatch })],
  });

const markers = (doc: MapDoc) => {
  const bands = buildBands(doc.stations, doc.lines, doc.lineOrder);
  return buildStopMarkers(doc.stations, doc.lines, doc.lineOrder, bands);
};
const endAt = (doc: MapDoc, stationId: string) =>
  markers(doc).find((m) => m.stationId === stationId)!.end;

describe('buildStopMarkers — baked line end', () => {
  it('defaults every stop to square', () => {
    const doc = chain();
    for (const m of markers(doc)) expect(m.end).toBe('square');
  });

  it('applies the line default at BOTH termini, never in the middle', () => {
    const doc = chain({ endStyle: 'round' });
    expect(endAt(doc, 'A')).toBe('round');
    expect(endAt(doc, 'C')).toBe('round');
    // The interior stop is not an end — it must keep the full square, or the
    // band would be sliced open where two corridors meet.
    expect(endAt(doc, 'B')).toBe('square');
  });

  it('lets one terminus override the line default', () => {
    const doc = chain({ endStyle: 'round', stationEndStyles: { C: 'short' } });
    expect(endAt(doc, 'A')).toBe('round');
    expect(endAt(doc, 'C')).toBe('short');
  });

  it('lets an override pin square where the line is round', () => {
    const doc = chain({ endStyle: 'round', stationEndStyles: { A: 'square' } });
    expect(endAt(doc, 'A')).toBe('square');
  });

  it('ignores an override on an interior station', () => {
    // Such a key is pruned on every topology change, but a hand-edited file
    // could still carry one — it must not halve a marker mid-line.
    const doc = chain({ stationEndStyles: { B: 'round' } });
    expect(endAt(doc, 'B')).toBe('square');
  });

  it('degrades round to short where the segment style cannot paint an arc', () => {
    // A's only edge is dashed, so its end has no shape to round; C's is solid.
    const doc = chain({ endStyle: 'round', segmentStyles: { 'A|B': 'dashed' } });
    expect(endAt(doc, 'A')).toBe('short');
    expect(endAt(doc, 'C')).toBe('round');
  });

  it('keeps the stored round through a dashed excursion', () => {
    // The degrade is render-time only: the doc still says round, so cycling
    // the segment back to solid brings the round end straight back.
    const dashed = chain({ endStyle: 'round', segmentStyles: { 'A|B': 'dashed' } });
    expect(dashed.lines.L1.endStyle).toBe('round');
    expect(endAt(chain({ endStyle: 'round' }), 'A')).toBe('round');
  });

  it('gives a loop no ends at all', () => {
    const doc = makeDoc({
      stations: [
        makeStation({ id: 'A', x: 0, y: 0, stops: [makeStop('L1')] }),
        makeStation({ id: 'B', x: 0, y: 100, stops: [makeStop('L1')] }),
        makeStation({ id: 'C', x: 100, y: 100, stops: [makeStop('L1')] }),
      ],
      lines: [
        makeLine({
          id: 'L1',
          stations: ['A', 'B', 'C'],
          edges: ['A|B', 'B|C', 'A|C'],
          endStyle: 'round',
        }),
      ],
    });
    for (const m of markers(doc)) {
      expect(m.outward).toBeNull();
      expect(m.end).toBe('square');
    }
  });

  it('gives a lone stop no end — it has no direction to end along', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 'A', x: 0, y: 0, stops: [makeStop('L1')] })],
      lines: [makeLine({ id: 'L1', stations: ['A'], endStyle: 'round' })],
    });
    expect(markers(doc)[0].end).toBe('square');
  });

  it('ends every tip of a branching line', () => {
    // B is the fork: A, C and D are all degree-1 and all get the end style.
    const doc = makeDoc({
      stations: [
        makeStation({ id: 'A', x: 0, y: 0, stops: [makeStop('L1')] }),
        makeStation({ id: 'B', x: 0, y: 100, stops: [makeStop('L1')] }),
        makeStation({ id: 'C', x: 0, y: 200, stops: [makeStop('L1')] }),
        makeStation({
          id: 'D',
          x: 100,
          y: 100,
          stops: [makeStop('L1', { orientation: 'auto-horizontal' })],
        }),
      ],
      lines: [
        makeLine({
          id: 'L1',
          stations: ['A', 'B', 'C', 'D'],
          edges: ['A|B', 'B|C', 'B|D'],
          endStyle: 'short',
        }),
      ],
    });
    expect(endAt(doc, 'A')).toBe('short');
    expect(endAt(doc, 'C')).toBe('short');
    expect(endAt(doc, 'D')).toBe('short');
    expect(endAt(doc, 'B')).toBe('square');
  });
});
