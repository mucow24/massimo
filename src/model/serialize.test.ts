import { describe, it, expect } from 'vitest';
import { parse, serialize } from './serialize';
import { makeDoc, makeLine, makeStation, makeStop } from '../test/fixtures';

describe('serialize / parse round-trip', () => {
  it('round-trips a multi-line, multi-station fixture losslessly', () => {
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          name: 'Foo',
          x: 10,
          y: 20,
          rotation: 3,
          stops: [
            makeStop('L1', { row: 0, col: 0 }),
            makeStop('L2', { row: 0, col: 1, orientation: 'auto-horizontal' }),
          ],
          label: { row: 1, col: 2, rotation: 5, offset: 12, align: 'auto', valign: 'middle' },
        }),
        makeStation({ id: 's2', x: 100, y: 100 }),
      ],
      lines: [
        makeLine({ id: 'L1', service: 'A', color: '#0039A6', stations: ['s1', 's2'] }),
        makeLine({ id: 'L2', service: 'B', color: '#FF6319', stations: ['s1'] }),
      ],
      lineOrder: ['L2', 'L1'],
      curveRadius: 30,
    });
    const json = serialize(doc);
    const result = parse(json);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.doc).toEqual(doc);
  });
});

describe('parse — error cases', () => {
  it('rejects malformed JSON without throwing', () => {
    const r = parse('not json {');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/JSON/i);
  });

  it('rejects non-object JSON', () => {
    const r = parse('[]');
    expect(r.ok).toBe(false);
  });

  it('rejects files missing the format field', () => {
    const r = parse(JSON.stringify({ doc: {} }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/format/i);
  });

  it('rejects files with a foreign format field', () => {
    const r = parse(JSON.stringify({ format: 'something-else', doc: {} }));
    expect(r.ok).toBe(false);
  });
});

describe('serialize / parse — segmentStyles', () => {
  it('round-trips a line with non-solid segmentStyles', () => {
    const doc = makeDoc({
      stations: [
        makeStation({ id: 's1', stops: [makeStop('L1')] }),
        makeStation({ id: 's2', stops: [makeStop('L1')] }),
        makeStation({ id: 's3', stops: [makeStop('L1')] }),
      ],
      lines: [
        makeLine({
          id: 'L1',
          stations: ['s1', 's2', 's3'],
          segmentStyles: { 's1|s2': 'hatched', 's2|s3': 'dashed' },
        }),
      ],
    });
    const r = parse(serialize(doc));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.doc.lines.L1.segmentStyles).toEqual({
        's1|s2': 'hatched',
        's2|s3': 'dashed',
      });
    }
  });

  it("drops 'solid' entries and unknown style values on parse", () => {
    const json = JSON.stringify({
      format: 'massimo-map',
      doc: {
        ...makeDoc({
          stations: [
            makeStation({ id: 's1', stops: [makeStop('L1')] }),
            makeStation({ id: 's2', stops: [makeStop('L1')] }),
          ],
          lines: [
            makeLine({
              id: 'L1',
              stations: ['s1', 's2'],
              segmentStyles: {
                's1|s2': 'solid',
                'ghost|key': 'hatched' as never,
                's1|s2-bogus': 'frosted' as never,
              },
            }),
          ],
        }),
      },
    });
    const r = parse(json);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.lines.L1.segmentStyles).toEqual({});
  });

  it("drops entries whose pair-key isn't an adjacency on the line", () => {
    const doc = makeDoc({
      stations: [
        makeStation({ id: 's1', stops: [makeStop('L1')] }),
        makeStation({ id: 's2', stops: [makeStop('L1')] }),
        makeStation({ id: 's3', stops: [makeStop('L1')] }),
      ],
      lines: [
        makeLine({
          id: 'L1',
          stations: ['s1', 's2', 's3'],
          segmentStyles: {
            's1|s2': 'hatched',
            's1|s3': 'dashed', // not adjacent on the line
          },
        }),
      ],
    });
    const r = parse(serialize(doc));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.doc.lines.L1.segmentStyles).toEqual({ 's1|s2': 'hatched' });
    }
  });

  it('treats missing segmentStyles as undefined (older saves)', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 's1' })],
      lines: [makeLine({ id: 'L1', stations: ['s1'] })],
    });
    const r = parse(serialize(doc));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.lines.L1.segmentStyles).toBeUndefined();
  });
});

describe('parse — legacy stop orientation migration', () => {
  // Older docs (and any hand-written ones) may carry the vestigial
  // explicit cardinals `up`/`down`/`left`/`right` or unknown garbage in
  // `orientation`. parse() coerces them to the canonical auto-* axes;
  // re-serialization writes only the four canonical strings.
  const buildLegacyPayload = (orientations: string[]) =>
    JSON.stringify({
      format: 'massimo-map',
      doc: {
        stations: Object.fromEntries(
          orientations.map((o, i) => [
            `s${i}`,
            {
              id: `s${i}`,
              name: `S${i}`,
              x: 0,
              y: i * 50,
              rotation: 0,
              stops: [{ lineId: 'L1', row: 0, col: 0, orientation: o }],
              label: { row: 0, col: -1, rotation: 0, offset: 0, align: 'auto', valign: 'middle' },
            },
          ]),
        ),
        lines: {
          L1: {
            id: 'L1',
            service: 'A',
            name: 'A line',
            color: '#0039A6',
            stations: orientations.map((_, i) => `s${i}`),
          },
        },
        lineOrder: ['L1'],
        curveRadius: 20,
        lineCounter: 1,
        lineTags: {},
        routeBullets: {},
        transfers: {},
        textLabels: {},
        labelFontSize: 14,
        labelBold: false,
        labelItalic: false,
        activePalettes: ['mta'],
      },
    });

  it('coerces up/down to auto-vertical and left/right to auto-horizontal', () => {
    const r = parse(buildLegacyPayload(['up', 'down', 'left', 'right']));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.stations.s0.stops[0].orientation).toBe('auto-vertical');
    expect(r.doc.stations.s1.stops[0].orientation).toBe('auto-vertical');
    expect(r.doc.stations.s2.stops[0].orientation).toBe('auto-horizontal');
    expect(r.doc.stations.s3.stops[0].orientation).toBe('auto-horizontal');
  });

  it('falls back unknown orientation values to auto-vertical', () => {
    const r = parse(buildLegacyPayload(['nonsense', '', 'AUTO-VERTICAL']));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const id of ['s0', 's1', 's2']) {
      expect(r.doc.stations[id].stops[0].orientation).toBe('auto-vertical');
    }
  });

  it('leaves canonical auto-* values untouched', () => {
    const r = parse(
      buildLegacyPayload(['auto-vertical', 'auto-horizontal', 'auto-ne-sw', 'auto-nw-se']),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.stations.s0.stops[0].orientation).toBe('auto-vertical');
    expect(r.doc.stations.s1.stops[0].orientation).toBe('auto-horizontal');
    expect(r.doc.stations.s2.stops[0].orientation).toBe('auto-ne-sw');
    expect(r.doc.stations.s3.stops[0].orientation).toBe('auto-nw-se');
  });
});

describe('serialize / parse — dotShape', () => {
  it('round-trips a stop with dotShape', () => {
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          stops: [
            {
              lineId: 'L1',
              row: 0,
              col: 0,
              orientation: 'auto-vertical',
              dotShape: 'filled-black-diamond',
            },
          ],
        }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1'] })],
    });
    const json = serialize(doc);
    const result = parse(json);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.doc.stations.s1.stops[0].dotShape).toBe('filled-black-diamond');
  });
});
