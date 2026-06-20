import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parse, serialize } from './serialize';
import { DEFAULT_DOT_STYLE, DOT_SHAPE_PRESETS } from './dotStyle';
import * as T from './transforms';
import { counterIdFactory } from './ids';
import { makeDoc, makeLine, makeStation, makeStop } from '../test/fixtures';
import type { MapDoc } from './types';

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

describe('parse — active palette invariant', () => {
  // Symmetric with the migrate-path coverage in storeMigrate.test.ts: both load
  // paths route through the shared validActivePalettes helper.
  const fileWith = (activePalettes: unknown): string =>
    JSON.stringify({ format: 'massimo-map', doc: { ...T.DEFAULT_DOC, activePalettes } });

  it('replaces an explicit empty activePalettes with the default set', () => {
    const r = parse(fileWith([]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.activePalettes).toEqual(T.DEFAULT_DOC.activePalettes);
  });

  it('falls back to the default set when no id is valid', () => {
    const r = parse(fileWith(['bogus']));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.activePalettes).toEqual(T.DEFAULT_DOC.activePalettes);
  });

  it('keeps the valid ids, dropping unknowns', () => {
    const r = parse(fileWith(['mta', 'bogus']));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.activePalettes).toEqual(['mta']);
  });
});

describe('parse — custom palettes', () => {
  const custom = [{ id: 'custom:frrf', name: 'frrf', swatches: [{ name: '1', color: '#c1272d' }] }];
  const fileWith = (activePalettes: unknown): string =>
    JSON.stringify({ format: 'massimo-map', doc: { ...T.DEFAULT_DOC, activePalettes } });

  it('keeps a custom active id when its palette is supplied', () => {
    const r = parse(fileWith(['mta', 'custom:frrf']), custom);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.activePalettes).toEqual(['mta', 'custom:frrf']);
  });

  it('drops a dangling custom id whose palette is not supplied', () => {
    const r = parse(fileWith(['mta', 'custom:gone']), custom);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.activePalettes).toEqual(['mta']);
  });

  it('falls back to the default set when only a dangling custom id is present', () => {
    const r = parse(fileWith(['custom:gone']), custom);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.activePalettes).toEqual(T.DEFAULT_DOC.activePalettes);
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

  it("round-trips the open styles ('dotted', 'dashed-open')", () => {
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
          segmentStyles: { 's1|s2': 'dotted', 's2|s3': 'dashed-open' },
        }),
      ],
    });
    const r = parse(serialize(doc));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.doc.lines.L1.segmentStyles).toEqual({
        's1|s2': 'dotted',
        's2|s3': 'dashed-open',
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
        labelWeight: 400,
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

describe('parse — labelBold → labelWeight migration', () => {
  // Older docs stored station-label boldness as a single boolean. The schema
  // now has a per-doc `labelWeight` (one of 100/200/300/400/500/700/800/900)
  // and an optional per-station `labelBold` flag that bumps two indices on
  // top of that. parse() must translate the legacy boolean so saves made
  // before the change still load correctly.
  const buildLegacy = (labelBold: boolean) =>
    JSON.stringify({
      format: 'massimo-map',
      doc: {
        stations: {},
        lines: {},
        lineOrder: [],
        curveRadius: 24,
        lineCounter: 0,
        lineTags: {},
        routeBullets: {},
        transfers: {},
        textLabels: {},
        labelFontSize: 12,
        labelBold,
        labelItalic: false,
        activePalettes: ['mta'],
      },
    });

  it('translates labelBold:true to labelWeight:700', () => {
    const r = parse(buildLegacy(true));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.labelWeight).toBe(700);
  });

  it('translates labelBold:false to labelWeight:400', () => {
    const r = parse(buildLegacy(false));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.labelWeight).toBe(400);
  });

  it('strips labelBold from the doc after migrating', () => {
    const r = parse(buildLegacy(true));
    expect(r.ok).toBe(true);
    if (r.ok) expect('labelBold' in r.doc).toBe(false);
  });

  it('prefers an explicit labelWeight over a legacy labelBold', () => {
    // If both fields are present, labelWeight wins — the writer knew about
    // the new field.
    const json = JSON.stringify({
      format: 'massimo-map',
      doc: {
        stations: {},
        lines: {},
        lineOrder: [],
        curveRadius: 24,
        lineCounter: 0,
        lineTags: {},
        routeBullets: {},
        transfers: {},
        textLabels: {},
        labelFontSize: 12,
        labelBold: false,
        labelWeight: 500,
        labelItalic: false,
        activePalettes: ['mta'],
      },
    });
    const r = parse(json);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.labelWeight).toBe(500);
  });
});

describe('serialize / parse — dot styles', () => {
  // Builds a file whose single stop and line carry arbitrary raw dot fields,
  // as a legacy or hand-edited file might.
  const buildDotPayload = (
    stopExtra: Record<string, unknown> = {},
    lineExtra: Record<string, unknown> = {},
  ) =>
    JSON.stringify({
      format: 'massimo-map',
      doc: {
        stations: {
          s1: {
            id: 's1',
            name: 'S1',
            x: 0,
            y: 0,
            rotation: 0,
            stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical', ...stopExtra }],
            label: { row: 0, col: -1, rotation: 0, offset: 0, align: 'auto', valign: 'middle' },
          },
        },
        lines: {
          L1: {
            id: 'L1',
            service: 'A',
            name: 'A line',
            color: '#0039a6',
            stations: ['s1'],
            ...lineExtra,
          },
        },
        lineOrder: ['L1'],
        curveRadius: 24,
        lineCounter: 1,
        lineTags: {},
        routeBullets: {},
        transfers: {},
        textLabels: {},
        labelFontSize: 12,
        labelWeight: 400,
        labelItalic: false,
        activePalettes: ['mta'],
      },
    });

  it('round-trips a stop dotStyle and a line defaultDotStyle losslessly', () => {
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          stops: [makeStop('L1', { dotStyle: DOT_SHAPE_PRESETS['open-black'] })],
        }),
      ],
      lines: [
        makeLine({
          id: 'L1',
          stations: ['s1'],
          defaultDotStyle: DOT_SHAPE_PRESETS['filled-line-color'],
        }),
      ],
    });
    const result = parse(serialize(doc));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.doc).toEqual(doc);
  });

  it('converts a legacy per-stop dotShape string to its preset style and strips the key', () => {
    const r = parse(buildDotPayload({ dotShape: 'filled-black-diamond' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const stop = r.doc.stations.s1.stops[0];
    expect(stop.dotStyle).toEqual(DOT_SHAPE_PRESETS['filled-black-diamond']);
    expect('dotShape' in stop).toBe(false);
  });

  it('converts a legacy line defaultDotShape string and strips the key', () => {
    const r = parse(buildDotPayload({}, { defaultDotShape: 'open-white' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.lines.L1.defaultDotStyle).toEqual(DOT_SHAPE_PRESETS['open-white']);
    expect('defaultDotShape' in r.doc.lines.L1).toBe(false);
  });

  it("drops a legacy defaultDotShape of 'filled-black' (the default is never stored)", () => {
    const r = parse(buildDotPayload({}, { defaultDotShape: 'filled-black' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect('defaultDotShape' in r.doc.lines.L1).toBe(false);
    expect('defaultDotStyle' in r.doc.lines.L1).toBe(false);
  });

  it("converts a legacy 'none' to the invisible preset", () => {
    const r = parse(buildDotPayload({ dotShape: 'none' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.stations.s1.stops[0].dotStyle).toEqual(DOT_SHAPE_PRESETS['none']);
  });

  it('drops unknown legacy dotShape strings — the default chain takes over', () => {
    const r = parse(buildDotPayload({ dotShape: 'gibberish' }, { defaultDotShape: 42 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const stop = r.doc.stations.s1.stops[0];
    expect('dotShape' in stop).toBe(false);
    expect(stop.dotStyle).toBeUndefined();
    expect('defaultDotShape' in r.doc.lines.L1).toBe(false);
    expect(r.doc.lines.L1.defaultDotStyle).toBeUndefined();
  });

  it('re-serializing a converted legacy doc emits dotStyle and never dotShape', () => {
    const r = parse(buildDotPayload({ dotShape: 'open-white' }, { defaultDotShape: 'open-black' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const json = serialize(r.doc);
    expect(json).toContain('"dotStyle"');
    expect(json).toContain('"defaultDotStyle"');
    expect(json).not.toContain('"dotShape"');
    expect(json).not.toContain('"defaultDotShape"');
    // …and parsing the re-serialized doc is a fixed point.
    const r2 = parse(json);
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.doc).toEqual(r.doc);
  });

  it('prefers a modern dotStyle over a stale legacy dotShape on the same stop', () => {
    const r = parse(
      buildDotPayload({ dotShape: 'filled-white', dotStyle: DOT_SHAPE_PRESETS['open-black'] }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const stop = r.doc.stations.s1.stops[0];
    expect(stop.dotStyle).toEqual(DOT_SHAPE_PRESETS['open-black']);
    expect('dotShape' in stop).toBe(false);
  });

  it('drops malformed dotStyle objects', () => {
    const junkStyles: unknown[] = [
      'filled-black', // a preset id where an object belongs
      { shape: 'blob', fill: 'none', strokeWidth: 0, strokeColor: 'line', showServiceCode: false },
      {
        shape: 'circle',
        fill: 'nope',
        strokeWidth: 0,
        strokeColor: 'line',
        showServiceCode: false,
      },
      {
        shape: 'circle',
        fill: 'none',
        strokeWidth: 'fat',
        strokeColor: 'line',
        showServiceCode: false,
      },
      {
        shape: 'circle',
        fill: 'none',
        strokeWidth: 0,
        strokeColor: 'none',
        showServiceCode: false,
      },
      { shape: 'circle', fill: 'none', strokeWidth: 0, strokeColor: 'line' }, // missing showServiceCode
      null,
      7,
    ];
    for (const junk of junkStyles) {
      const r = parse(buildDotPayload({ dotStyle: junk }, { defaultDotStyle: junk }));
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(r.doc.stations.s1.stops[0].dotStyle).toBeUndefined();
      expect(r.doc.lines.L1.defaultDotStyle).toBeUndefined();
    }
  });

  it('drops a modern defaultDotStyle equal to DEFAULT_DOT_STYLE (never stored)', () => {
    // The payload goes through JSON.stringify anyway, so passing the default
    // object itself already exercises by-value comparison on the other side.
    const r = parse(buildDotPayload({}, { defaultDotStyle: DEFAULT_DOT_STYLE }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect('defaultDotStyle' in r.doc.lines.L1).toBe(false);
  });

  it('normalizes color-pair hex casing and clamps negative stroke widths', () => {
    const r = parse(
      buildDotPayload({
        dotStyle: {
          shape: 'square',
          fill: { day: '#AABBCC', night: '#DDEEFF' },
          strokeWidth: -2,
          strokeColor: 'line',
          showServiceCode: false,
        },
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.stations.s1.stops[0].dotStyle).toEqual({
      shape: 'square',
      fill: { day: '#aabbcc', night: '#ddeeff' },
      strokeWidth: 0,
      strokeColor: 'line',
      showServiceCode: false,
    });
  });
});

describe('parse — line width sanitizing', () => {
  // Builds a file whose single line carries an arbitrary raw `width` value,
  // as a hand-edited or legacy file might.
  const buildWithWidth = (width: unknown) =>
    JSON.stringify({
      format: 'massimo-map',
      doc: {
        ...makeDoc({ lines: [makeLine({ id: 'L1' })] }),
        lines: { L1: { ...makeLine({ id: 'L1' }), width } },
      },
    });

  it('round-trips a non-default width losslessly (pin — relies only on the optional field)', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'L1', width: 21 })] });
    const result = parse(serialize(doc));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.doc).toEqual(doc);
  });

  it('drops an explicit default width on parse (the default is never stored)', () => {
    const result = parse(buildWithWidth(14));
    expect(result.ok).toBe(true);
    if (result.ok) expect('width' in result.doc.lines.L1).toBe(false);
  });

  it('drops non-numeric widths', () => {
    for (const junk of ['wide', null, true, {}]) {
      const result = parse(buildWithWidth(junk));
      expect(result.ok).toBe(true);
      if (result.ok) expect('width' in result.doc.lines.L1).toBe(false);
    }
  });

  it('clamps and rounds numeric widths to the canonical stored form', () => {
    const low = parse(buildWithWidth(-3));
    expect(low.ok).toBe(true);
    if (low.ok) expect(low.doc.lines.L1.width).toBe(1);
    const frac = parse(buildWithWidth(9.6));
    expect(frac.ok).toBe(true);
    if (frac.ok) expect(frac.doc.lines.L1.width).toBe(10);
    // Rounds-to-default is dropped like an exact 14.
    const nearDefault = parse(buildWithWidth(14.4));
    expect(nearDefault.ok).toBe(true);
    if (nearDefault.ok) expect('width' in nearDefault.doc.lines.L1).toBe(false);
  });

  it('drops non-finite widths', () => {
    // JSON.stringify can't emit a non-finite number, so splice the literal
    // into the raw text: 1e999 overflows to Infinity in JSON.parse.
    const json = buildWithWidth(0).replace('"width":0', '"width":1e999');
    const result = parse(json);
    expect(result.ok).toBe(true);
    if (result.ok) expect('width' in result.doc.lines.L1).toBe(false);
  });
});

describe('parse — dot size sanitizing', () => {
  // Builds a file whose single stop and line carry arbitrary raw dot-size
  // values, as a hand-edited or legacy file might.
  const buildDotSizePayload = (
    stopExtra: Record<string, unknown>,
    lineExtra: Record<string, unknown>,
  ) =>
    JSON.stringify({
      format: 'massimo-map',
      doc: {
        ...makeDoc({ lines: [makeLine({ id: 'L1', stations: ['s1'] })] }),
        stations: {
          s1: {
            id: 's1',
            name: 'S1',
            x: 0,
            y: 0,
            rotation: 0,
            stops: [{ lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical', ...stopExtra }],
            label: { row: 0, col: -1, rotation: 0, offset: 0, align: 'auto', valign: 'middle' },
          },
        },
        lines: { L1: { ...makeLine({ id: 'L1', stations: ['s1'] }), ...lineExtra } },
      },
    });

  it('round-trips non-default line and stop sizes losslessly (pin — relies only on the optional fields)', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 's1', stops: [makeStop('L1', { dotSize: 16 })] })],
      lines: [makeLine({ id: 'L1', stations: ['s1'], defaultDotSize: 12 })],
    });
    const result = parse(serialize(doc));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.doc).toEqual(doc);
  });

  it('drops an explicit default line size on parse (the default is never stored)', () => {
    const result = parse(buildDotSizePayload({}, { defaultDotSize: 8 }));
    expect(result.ok).toBe(true);
    if (result.ok) expect('defaultDotSize' in result.doc.lines.L1).toBe(false);
  });

  it("drops a stop override equal to the line's effective default (after line sanitizing)", () => {
    // The line's raw 10.4 rounds to 10 first; the stop's 10 must compare
    // against the SANITIZED default — catching a sanitizer-ordering bug.
    const result = parse(buildDotSizePayload({ dotSize: 10 }, { defaultDotSize: 10.4 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.lines.L1.defaultDotSize).toBe(10);
    expect('dotSize' in result.doc.stations.s1.stops[0]).toBe(false);
  });

  it('keeps a stop override of the global default when the line default differs', () => {
    const result = parse(buildDotSizePayload({ dotSize: 8 }, { defaultDotSize: 10 }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.doc.stations.s1.stops[0].dotSize).toBe(8);
  });

  it('drops non-numeric sizes on both fields', () => {
    for (const junk of ['big', null, true, {}]) {
      const result = parse(buildDotSizePayload({ dotSize: junk }, { defaultDotSize: junk }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect('defaultDotSize' in result.doc.lines.L1).toBe(false);
      expect('dotSize' in result.doc.stations.s1.stops[0]).toBe(false);
    }
  });

  it('clamps and rounds numeric sizes to the canonical stored form', () => {
    const low = parse(buildDotSizePayload({ dotSize: -3 }, { defaultDotSize: 9.6 }));
    expect(low.ok).toBe(true);
    if (!low.ok) return;
    expect(low.doc.lines.L1.defaultDotSize).toBe(10);
    expect(low.doc.stations.s1.stops[0].dotSize).toBe(0);
    // Rounds-to-default is dropped like an exact 8.
    const nearDefault = parse(buildDotSizePayload({}, { defaultDotSize: 8.4 }));
    expect(nearDefault.ok).toBe(true);
    if (nearDefault.ok) expect('defaultDotSize' in nearDefault.doc.lines.L1).toBe(false);
  });

  it('drops non-finite sizes', () => {
    // JSON.stringify can't emit a non-finite number, so splice the literal
    // into the raw text: 1e999 overflows to Infinity in JSON.parse.
    const json = buildDotSizePayload({ dotSize: 0 }, { defaultDotSize: 0 })
      .replace('"dotSize":0', '"dotSize":1e999')
      .replace('"defaultDotSize":0', '"defaultDotSize":1e999');
    const result = parse(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect('defaultDotSize' in result.doc.lines.L1).toBe(false);
    expect('dotSize' in result.doc.stations.s1.stops[0]).toBe(false);
  });
});

describe('parse — line stroke sanitizing', () => {
  // Builds a file whose single line carries arbitrary raw stroke fields, as
  // a hand-edited or legacy file might.
  const buildWithStroke = (fields: Record<string, unknown>) =>
    JSON.stringify({
      format: 'massimo-map',
      doc: {
        ...makeDoc({ lines: [makeLine({ id: 'L1' })] }),
        lines: { L1: { ...makeLine({ id: 'L1' }), ...fields } },
      },
    });

  it('round-trips a non-default stroke losslessly', () => {
    const doc = makeDoc({
      lines: [makeLine({ id: 'L1', strokeWidth: 4, strokeColor: '#ff0000' })],
    });
    const result = parse(serialize(doc));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.doc).toEqual(doc);
  });

  it('drops an explicit zero stroke width (the default is never stored)', () => {
    const result = parse(buildWithStroke({ strokeWidth: 0 }));
    expect(result.ok).toBe(true);
    if (result.ok) expect('strokeWidth' in result.doc.lines.L1).toBe(false);
  });

  it('drops non-numeric stroke widths', () => {
    for (const junk of ['thick', null, true, {}]) {
      const result = parse(buildWithStroke({ strokeWidth: junk }));
      expect(result.ok).toBe(true);
      if (result.ok) expect('strokeWidth' in result.doc.lines.L1).toBe(false);
    }
  });

  it('clamps and rounds numeric stroke widths to the canonical 0.5-grid form', () => {
    // Negative clamps to 0 = the default, so the field is dropped.
    const low = parse(buildWithStroke({ strokeWidth: -3 }));
    expect(low.ok).toBe(true);
    if (low.ok) expect('strokeWidth' in low.doc.lines.L1).toBe(false);
    const frac = parse(buildWithStroke({ strokeWidth: 3.6 }));
    expect(frac.ok).toBe(true);
    if (frac.ok) expect(frac.doc.lines.L1.strokeWidth).toBe(3.5);
    const half = parse(buildWithStroke({ strokeWidth: 1.5 }));
    expect(half.ok).toBe(true);
    if (half.ok) expect(half.doc.lines.L1.strokeWidth).toBe(1.5);
  });

  it('drops non-finite stroke widths', () => {
    const json = buildWithStroke({ strokeWidth: 0 }).replace(
      '"strokeWidth":0',
      '"strokeWidth":1e999',
    );
    const result = parse(json);
    expect(result.ok).toBe(true);
    if (result.ok) expect('strokeWidth' in result.doc.lines.L1).toBe(false);
  });

  it('lowercases stored stroke colors', () => {
    const result = parse(buildWithStroke({ strokeColor: '#AB12CD' }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.doc.lines.L1.strokeColor).toBe('#ab12cd');
  });

  it('drops the default stroke color in any case', () => {
    for (const def of ['#ffffff', '#FFFFFF']) {
      const result = parse(buildWithStroke({ strokeColor: def }));
      expect(result.ok).toBe(true);
      if (result.ok) expect('strokeColor' in result.doc.lines.L1).toBe(false);
    }
  });

  it('drops non-string stroke colors', () => {
    for (const junk of [5, null, true, {}]) {
      const result = parse(buildWithStroke({ strokeColor: junk }));
      expect(result.ok).toBe(true);
      if (result.ok) expect('strokeColor' in result.doc.lines.L1).toBe(false);
    }
  });
});

describe('serialize / parse — round-trip property', () => {
  // A "canonical" doc is anything the pure transforms can build from the empty
  // default doc: ids minted in order, lineOrder maintained, stops + auto
  // orientations only where the model put them. parse() must return such a doc
  // byte-for-byte equal — it only ever changes NON-canonical (legacy/hand-
  // edited) input, which the explicit cases above cover.
  type Action =
    | { kind: 'addStation' }
    | { kind: 'addLine' }
    | { kind: 'toggleStationOnLine' }
    | { kind: 'rotateStation' }
    | { kind: 'moveStation'; x: number; y: number }
    | { kind: 'deleteStation' }
    | { kind: 'deleteLine' }
    | { kind: 'moveLineInOrder'; dir: -1 | 1 }
    | { kind: 'setLineWidth'; w: number };

  const actionArb = fc.oneof(
    fc.constant<Action>({ kind: 'addStation' }),
    fc.constant<Action>({ kind: 'addLine' }),
    fc.constant<Action>({ kind: 'toggleStationOnLine' }),
    fc.constant<Action>({ kind: 'rotateStation' }),
    fc.record({
      kind: fc.constant<'moveStation'>('moveStation'),
      x: fc.integer({ min: -500, max: 500 }),
      y: fc.integer({ min: -500, max: 500 }),
    }),
    fc.constant<Action>({ kind: 'deleteStation' }),
    fc.constant<Action>({ kind: 'deleteLine' }),
    fc.record({
      kind: fc.constant<'moveLineInOrder'>('moveLineInOrder'),
      dir: fc.constantFrom<-1 | 1>(-1, 1),
    }),
    fc.record({
      kind: fc.constant<'setLineWidth'>('setLineWidth'),
      w: fc.integer({ min: -5, max: 40 }),
    }),
  );

  const firstKey = (rec: Record<string, unknown>): string | null => Object.keys(rec)[0] ?? null;
  const lastKey = (rec: Record<string, unknown>): string | null => {
    const ks = Object.keys(rec);
    return ks.length ? ks[ks.length - 1] : null;
  };

  const build = (actions: Action[]): MapDoc => {
    const ids = counterIdFactory();
    let doc: MapDoc = { ...T.DEFAULT_DOC };
    for (const a of actions) {
      switch (a.kind) {
        case 'addStation':
          doc = T.addStation(doc, 0, 0, ids.stationId(), 'S');
          break;
        case 'addLine':
          doc = T.addLine(doc, ids.lineId(), 'X', '#0039A6');
          break;
        case 'toggleStationOnLine': {
          const l = firstKey(doc.lines);
          const s = lastKey(doc.stations);
          if (l && s) doc = T.toggleStationOnLine(doc, l, s);
          break;
        }
        case 'rotateStation': {
          const s = firstKey(doc.stations);
          if (s) doc = T.rotateStation(doc, s);
          break;
        }
        case 'moveStation': {
          const s = firstKey(doc.stations);
          if (s) doc = T.moveStation(doc, s, a.x, a.y);
          break;
        }
        case 'deleteStation': {
          const s = firstKey(doc.stations);
          if (s) doc = T.deleteStation(doc, s);
          break;
        }
        case 'deleteLine': {
          const l = firstKey(doc.lines);
          if (l) doc = T.deleteLine(doc, l);
          break;
        }
        case 'moveLineInOrder': {
          const l = firstKey(doc.lines);
          if (l) doc = T.moveLineInOrder(doc, l, a.dir);
          break;
        }
        case 'setLineWidth': {
          const l = firstKey(doc.lines);
          if (l) doc = T.setLineWidth(doc, l, a.w);
          break;
        }
      }
    }
    return doc;
  };

  it('parse(serialize(doc)) deep-equals any transform-built doc', () => {
    fc.assert(
      fc.property(fc.array(actionArb, { maxLength: 40 }), (actions) => {
        const doc = build(actions);
        const result = parse(serialize(doc));
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.doc).toEqual(doc);
      }),
    );
  });
});
