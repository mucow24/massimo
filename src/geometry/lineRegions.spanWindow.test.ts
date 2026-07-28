import { describe, it, expect } from 'vitest';
import { buildBandGeometry, buildStopMarkers } from './interlining';
import { buildOverlapRegions } from './lineRegions';
import { makeLine, makeStation, makeStop } from '../test/fixtures';
import type { GeometrySlice } from './regionCache';

/**
 * Equality pin for computeSpans' bbox-windowed sampling: span intervals are
 * arc positions that persisted RegionAnchors bind against, so the windowed
 * walk must reproduce the unwindowed walk EXACTLY — these goldens were
 * captured from the pre-windowing implementation and must never drift.
 *
 * The fixture exercises the windowing hazards: one long horizontal trunk
 * crossed by two verticals far from the trunk's arc start (two disjoint
 * windows, each mid-path), with a third crossing right at the trunk's start
 * (window at the d=0 boundary).
 */
const geom = (): GeometrySlice => ({
  stations: {
    hw: makeStation({ id: 'hw', x: 0, y: 500, stops: [makeStop('H')] }),
    he: makeStation({ id: 'he', x: 800, y: 500, stops: [makeStop('H')] }),
    an: makeStation({ id: 'an', x: 0, y: 400, stops: [makeStop('A')] }),
    as: makeStation({ id: 'as', x: 0, y: 600, stops: [makeStop('A')] }),
    bn: makeStation({ id: 'bn', x: 300, y: 400, stops: [makeStop('B')] }),
    bs: makeStation({ id: 'bs', x: 300, y: 600, stops: [makeStop('B')] }),
    cn: makeStation({ id: 'cn', x: 700, y: 400, stops: [makeStop('C')] }),
    cs: makeStation({ id: 'cs', x: 700, y: 600, stops: [makeStop('C')] }),
  },
  lines: {
    H: makeLine({ id: 'H', stations: ['hw', 'he'], width: 14 }),
    A: makeLine({ id: 'A', stations: ['an', 'as'], width: 14 }),
    B: makeLine({ id: 'B', stations: ['bn', 'bs'], width: 14 }),
    C: makeLine({ id: 'C', stations: ['cn', 'cs'], width: 14 }),
  },
});

const facesFor = (g: GeometrySlice) => {
  const bands = buildBandGeometry(g.stations, g.lines);
  const markers = buildStopMarkers(g.stations, g.lines, [], bands);
  return buildOverlapRegions(bands, markers, []);
};

/** Flatten one face's spans into a deterministic, diff-friendly shape. */
const spanShape = (faces: ReturnType<typeof facesFor>) =>
  faces
    .map((f) => ({
      cover: [...f.lineIds].sort().join('+'),
      cx: Math.round(f.bbox.x0),
      spans: [...f.spans.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, s]) => ({
          key,
          totalLen: Number(s.totalLen.toFixed(4)),
          intervals: s.intervals.map((iv) => [Number(iv.d0.toFixed(4)), Number(iv.d1.toFixed(4))]),
        })),
    }))
    .sort((a, b) => a.cx - b.cx || a.cover.localeCompare(b.cover));

describe('computeSpans windowed sampling', () => {
  it('reproduces the unwindowed goldens exactly (mid-path + start-boundary windows)', () => {
    const shaped = spanShape(facesFor(geom()));
    expect(shaped).toEqual([
      {
        cover: 'A+H',
        cx: -7,
        spans: [
          { key: 'A|an|as', totalLen: 200, intervals: [[85, 115]] },
          { key: 'H|he|hw', totalLen: 800, intervals: [[785, 800]] },
        ],
      },
      {
        cover: 'B+H',
        cx: 293,
        spans: [
          { key: 'B|bn|bs', totalLen: 200, intervals: [[85, 115]] },
          { key: 'H|he|hw', totalLen: 800, intervals: [[485, 515]] },
        ],
      },
      {
        cover: 'C+H',
        cx: 693,
        spans: [
          { key: 'C|cn|cs', totalLen: 200, intervals: [[85, 115]] },
          { key: 'H|he|hw', totalLen: 800, intervals: [[85, 115]] },
        ],
      },
    ]);
  });
});
