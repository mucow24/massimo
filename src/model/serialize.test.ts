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
        // s2 is a member of L1 and must carry its stop: parse rebuilds the
        // membership⇄stops closure, so a stopless member would come back with
        // a synthesized stop and break the lossless comparison.
        makeStation({ id: 's2', x: 100, y: 100, stops: [makeStop('L1')] }),
      ],
      lines: [
        // Non-default per-line curve radius must survive the round-trip. Dot
        // sizes are always stored (parse materializes absent ones), so the
        // lossless fixture carries them explicitly.
        makeLine({
          id: 'L1',
          service: 'A',
          color: '#0039A6',
          stations: ['s1', 's2'],
          curveRadius: 30,
          singletonDotSize: 8,
          multiDotSize: 8,
        }),
        makeLine({
          id: 'L2',
          service: 'B',
          color: '#FF6319',
          stations: ['s1'],
          singletonDotSize: 8,
          multiDotSize: 8,
        }),
      ],
      lineOrder: ['L2', 'L1'],
      // Round-trip pins compare parse(serialize(doc)) with toEqual, so the
      // fixture must satisfy the load-time style invariants (>= 1 per kind).
      styles: Object.values(T.DEFAULT_STYLES),
    });
    const json = serialize(doc);
    const result = parse(json);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.doc).toEqual(doc);
  });

  // A night map is a property of the map, not of the session that drew it: an
  // exported file has to carry the mode or it reopens in day.
  it('round-trips darkMode, so an exported night map reopens dark', () => {
    const doc = makeDoc({ darkMode: true, styles: Object.values(T.DEFAULT_STYLES) });
    const result = parse(serialize(doc));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.doc.darkMode).toBe(true);
  });

  // Absent in every save predating the field ⇒ day, via the DEFAULT_DOC merge.
  // No migration needed.
  it('defaults darkMode to false for a file saved before the field existed', () => {
    const { darkMode: _omitted, ...docWithoutDarkMode } = T.DEFAULT_DOC;
    const json = JSON.stringify({ format: 'massimo-map', doc: docWithoutDarkMode });
    const r = parse(json);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.darkMode).toBe(false);
  });

  // The size sanitizer drops a dot size that equals the effective default. For
  // a service-code line that default is 12, so an explicit 8 is a real size —
  // it must survive import, not collapse and snap the dot to 12.
  it('keeps an explicit 8px size on a service-code line default through import', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 's', stops: [makeStop('L1')] })],
      lines: [
        makeLine({
          id: 'L1',
          service: 'A',
          stations: ['s'],
          singletonDotStyle: DOT_SHAPE_PRESETS['filled-black-service-code'],
          singletonDotSize: 8,
        }),
      ],
      styles: Object.values(T.DEFAULT_STYLES),
    });
    const r = parse(serialize(doc));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.lines.L1.singletonDotSize).toBe(8);
  });
});

describe('parse — the map’s palettes', () => {
  const fileWith = (palettes: unknown): string =>
    JSON.stringify({ format: 'massimo-map', doc: { ...T.DEFAULT_DOC, palettes } });

  it('round-trips the palettes a map carries', () => {
    const frrf = { name: 'frrf', swatches: [{ name: '1', color: '#c1272d' }] };
    const r = parse(fileWith([frrf]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.palettes).toEqual([frrf]);
  });

  it('keeps an explicitly empty list — a map may carry no palettes', () => {
    const r = parse(fileWith([]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.palettes).toEqual([]);
  });

  it('a file predating the field gets the default seed', () => {
    const { palettes: _drop, ...doc } = T.DEFAULT_DOC;
    const r = parse(JSON.stringify({ format: 'massimo-map', doc }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.palettes).toEqual(T.DEFAULT_DOC.palettes);
  });

  it('drops malformed entries and de-duplicates by name', () => {
    const good = { name: 'a', swatches: [{ name: '1', color: '#111111' }] };
    const r = parse(
      fileWith([good, { name: '', swatches: [] }, { swatches: [] }, 'nope', { ...good }]),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.palettes).toEqual([good]);
  });

  it('round-trips a palette description and per-swatch night colors', () => {
    const p = {
      name: 'frrf',
      description: 'side-project reds',
      swatches: [{ name: '1', color: '#c1272d', night: '#7a1a1d' }],
    };
    const r = parse(fileWith([p]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.palettes).toEqual([p]);
  });

  // `night` is stored only when it differs from the day color (the collapse
  // invariant), and a description is either a real string or absent.
  it('collapses a night equal to its day color and drops malformed extras', () => {
    const r = parse(
      fileWith([
        {
          name: 'a',
          description: 7,
          swatches: [
            { name: '1', color: '#111111', night: '#111111' },
            { name: '2', color: '#222222', night: 5 },
          ],
        },
        { name: 'b', description: '', swatches: [{ name: '1', color: '#333333' }] },
        { name: 'c', description: '   ', swatches: [{ name: '1', color: '#444444' }] },
      ]),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.doc.palettes).toEqual([
        {
          name: 'a',
          swatches: [
            { name: '1', color: '#111111' },
            { name: '2', color: '#222222' },
          ],
        },
        { name: 'b', swatches: [{ name: '1', color: '#333333' }] },
        { name: 'c', swatches: [{ name: '1', color: '#444444' }] },
      ]);
    }
  });

  // A palette carries at least one color. A hand-edited file can still say
  // otherwise — with an empty list, or with entries that all clean away — and
  // what it describes is nothing, so nothing is what the map gets.
  it('drops a palette carrying no colors, and one whose colors all clean away', () => {
    const good = { name: 'a', swatches: [{ name: '1', color: '#111111' }] };
    const r = parse(
      fileWith([good, { name: 'b', swatches: [] }, { name: 'c', swatches: [{ color: 7 }] }]),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.palettes).toEqual([good]);
  });
});

describe('parse — legacy activePalettes', () => {
  // Symmetric with the migrate-path coverage in storeMigrate.test.ts: both load
  // paths route through the shared bakeActivePalettes helper.
  const library = [{ name: 'frrf', swatches: [{ name: '1', color: '#c1272d' }] }];
  const fileWith = (activePalettes: unknown): string => {
    const { palettes: _drop, ...doc } = T.DEFAULT_DOC;
    return JSON.stringify({ format: 'massimo-map', doc: { ...doc, activePalettes } });
  };

  it('resolves a built-in id to a COPY of that palette', () => {
    const r = parse(fileWith(['bart']));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.doc.palettes.map((p) => p.name)).toEqual(['BART']);
      expect(r.doc.palettes[0].swatches).toHaveLength(5);
    }
  });

  it('keeps the order the ids were stored in', () => {
    const r = parse(fileWith(['mta', 'bart']));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.palettes.map((p) => p.name)).toEqual(['MTA', 'BART']);
  });

  // A custom id was `custom:<slug-of-name>`, so the name it came from is what
  // matches it against the library.
  it('resolves a custom id against the library by slugged name', () => {
    const r = parse(fileWith(['mta', 'custom:frrf']), library);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.palettes.map((p) => p.name)).toEqual(['MTA', 'frrf']);
  });

  it('drops a custom id the library no longer holds', () => {
    const r = parse(fileWith(['mta', 'custom:gone']), library);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.palettes.map((p) => p.name)).toEqual(['MTA']);
  });

  it('drops unknown ids, and leaves the map with none if that empties it', () => {
    const r = parse(fileWith(['bogus']));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.palettes).toEqual([]);
  });

  it('retires the legacy field', () => {
    const r = parse(fileWith(['mta']));
    expect(r.ok).toBe(true);
    if (r.ok) expect('activePalettes' in r.doc).toBe(false);
  });

  // A file already holding `palettes` is current: its own list wins outright,
  // and a stale id list beside it is ignored rather than merged.
  it('ignores activePalettes when the file already carries palettes', () => {
    const frrf = { name: 'frrf', swatches: [{ name: '1', color: '#c1272d' }] };
    const r = parse(
      JSON.stringify({
        format: 'massimo-map',
        doc: { ...T.DEFAULT_DOC, palettes: [frrf], activePalettes: ['bart'] },
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.palettes).toEqual([frrf]);
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

  it('backfills line edges from the stations order for pre-edges files', () => {
    const raw = {
      format: 'massimo-map',
      doc: makeDoc({
        stations: [
          makeStation({ id: 's1', stops: [makeStop('L1')] }),
          makeStation({ id: 's2', stops: [makeStop('L1')] }),
          makeStation({ id: 's3', stops: [makeStop('L1')] }),
        ],
        lines: [makeLine({ id: 'L1', stations: ['s1', 's2', 's3'] })],
      }),
    };
    // Simulate a file saved BEFORE the `edges` field existed. Without the parse
    // backfill, `ln.edges` is undefined and the renderer white-screens on
    // `ln.edges.join(...)` — this path is distinct from the localStorage rehydrate.
    delete (raw.doc.lines.L1 as { edges?: unknown }).edges;
    const r = parse(JSON.stringify(raw));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.lines.L1.edges).toEqual(['s1|s2', 's2|s3']);
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

describe('parse — retired segmentLayers strip', () => {
  it('strips the retired per-segment layer field from loaded files', () => {
    const doc = makeDoc({
      stations: [
        makeStation({ id: 's1', stops: [makeStop('L1')] }),
        makeStation({ id: 's2', stops: [makeStop('L1')] }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['s1', 's2'] })],
    });
    // Files saved before the region rework carry segmentLayers on lines.
    const rawFile = JSON.parse(serialize(doc));
    rawFile.doc.lines.L1.segmentLayers = { 's1|s2': 2 };
    const r = parse(JSON.stringify(rawFile));
    expect(r.ok).toBe(true);
    if (r.ok) expect('segmentLayers' in r.doc.lines.L1).toBe(false);
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

describe('parse — legacy global labelBold → default station style weight', () => {
  // Two legacy layers compose here: the ancient global `labelBold: boolean`
  // first migrates to a global `labelWeight` (migrateLegacyLabelBold), which the
  // retired-settings bake then folds into the DESIGNATED default station style
  // (bakeLegacyLabelSettings). So the observable outcome moved from a doc field
  // to that style's `weight`.
  const defaultStationProps = (r: ReturnType<typeof parse>) => {
    if (!r.ok) throw new Error('parse failed');
    return r.doc.styles[r.doc.styleDefaults.station].props;
  };
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

  it('translates labelBold:true to a Bold (700) default station style', () => {
    expect(defaultStationProps(parse(buildLegacy(true)))).toMatchObject({ weight: 700 });
  });

  it('translates labelBold:false to a Regular (400) default station style', () => {
    expect(defaultStationProps(parse(buildLegacy(false)))).toMatchObject({ weight: 400 });
  });

  it('strips labelBold and the global label* fields from the doc after migrating', () => {
    const r = parse(buildLegacy(true));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect('labelBold' in r.doc).toBe(false);
      expect('labelWeight' in r.doc).toBe(false);
      expect('labelFontSize' in r.doc).toBe(false);
    }
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
    expect(defaultStationProps(parse(json))).toMatchObject({ weight: 500 });
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

  it('round-trips a stop dotStyle and the split line dot defaults losslessly', () => {
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
          // Distinct singleton/shared defaults, to prove they survive independently.
          singletonDotStyle: DOT_SHAPE_PRESETS['filled-line-color'],
          multiDotStyle: DOT_SHAPE_PRESETS['open-white'],
          singletonDotSize: 8,
          multiDotSize: 8,
        }),
      ],
      styles: Object.values(T.DEFAULT_STYLES),
    });
    const result = parse(serialize(doc));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.doc).toEqual(doc);
  });

  it('bakes a legacy line defaultDotStyle into BOTH split fields (renders identically)', () => {
    const r = parse(buildDotPayload({}, { defaultDotStyle: DOT_SHAPE_PRESETS['open-white'] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.lines.L1.singletonDotStyle).toEqual(DOT_SHAPE_PRESETS['open-white']);
    expect(r.doc.lines.L1.multiDotStyle).toEqual(DOT_SHAPE_PRESETS['open-white']);
    expect('defaultDotStyle' in r.doc.lines.L1).toBe(false);
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
    expect(r.doc.lines.L1.singletonDotStyle).toEqual(DOT_SHAPE_PRESETS['open-white']);
    expect(r.doc.lines.L1.multiDotStyle).toEqual(DOT_SHAPE_PRESETS['open-white']);
    expect('defaultDotShape' in r.doc.lines.L1).toBe(false);
    expect('defaultDotStyle' in r.doc.lines.L1).toBe(false);
  });

  it("drops a legacy defaultDotShape of 'filled-black' (the default is never stored)", () => {
    const r = parse(buildDotPayload({}, { defaultDotShape: 'filled-black' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect('defaultDotShape' in r.doc.lines.L1).toBe(false);
    expect('singletonDotStyle' in r.doc.lines.L1).toBe(false);
    expect('multiDotStyle' in r.doc.lines.L1).toBe(false);
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
    expect('singletonDotStyle' in r.doc.lines.L1).toBe(false);
    expect('multiDotStyle' in r.doc.lines.L1).toBe(false);
  });

  it('re-serializing a converted legacy doc emits split dot fields and never dotShape', () => {
    const r = parse(buildDotPayload({ dotShape: 'open-white' }, { defaultDotShape: 'open-black' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const json = serialize(r.doc);
    expect(json).toContain('"dotStyle"');
    expect(json).toContain('"singletonDotStyle"');
    expect(json).toContain('"multiDotStyle"');
    expect(json).not.toContain('"defaultDotStyle"');
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

  it("keeps a 'dash' stop style on load (the TfL tick shape)", () => {
    const dash = {
      shape: 'dash',
      fill: 'line',
      strokeWidth: 0,
      strokeColor: 'line',
      strokeAlign: 'center',
      showServiceCode: false,
    };
    const r = parse(buildDotPayload({ dotStyle: dash }, { defaultDotStyle: dash }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.stations.s1.stops[0].dotStyle).toEqual(dash);
    expect(r.doc.lines.L1.singletonDotStyle).toEqual(dash);
    expect(r.doc.lines.L1.multiDotStyle).toEqual(dash);
  });

  it('round-trips an explicit non-center stroke alignment', () => {
    const inside = {
      shape: 'circle',
      fill: { day: '#000000', night: '#000000' },
      strokeWidth: 2,
      strokeColor: { day: '#ffffff', night: '#ffffff' },
      strokeAlign: 'inside',
      showServiceCode: false,
    };
    const r = parse(buildDotPayload({ dotStyle: inside }, { defaultDotStyle: inside }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.stations.s1.stops[0].dotStyle!.strokeAlign).toBe('inside');
    expect(r.doc.lines.L1.singletonDotStyle!.strokeAlign).toBe('inside');
    expect(r.doc.lines.L1.multiDotStyle!.strokeAlign).toBe('inside');
  });

  it("keeps the 'bw' (auto-contrast) sentinel on load, for both fill and stroke", () => {
    const bw = {
      shape: 'circle',
      fill: 'bw',
      strokeWidth: 2,
      strokeColor: 'bw',
      strokeAlign: 'center',
      showServiceCode: false,
    };
    const r = parse(buildDotPayload({ dotStyle: bw }, { defaultDotStyle: bw }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.stations.s1.stops[0].dotStyle).toEqual(bw);
    expect(r.doc.lines.L1.singletonDotStyle).toEqual(bw);
    expect(r.doc.lines.L1.multiDotStyle).toEqual(bw);
  });

  it("drops a stray 'bw' serviceCodeColor to absent — which IS auto-contrast", () => {
    const r = parse(
      buildDotPayload({
        dotStyle: {
          shape: 'circle',
          fill: { day: '#000000', night: '#000000' },
          strokeWidth: 0,
          strokeColor: 'line',
          strokeAlign: 'center',
          showServiceCode: true,
          serviceCodeColor: 'bw',
        },
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const style = r.doc.stations.s1.stops[0].dotStyle!;
    expect('serviceCodeColor' in style).toBe(false);
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
      expect('singletonDotStyle' in r.doc.lines.L1).toBe(false);
      expect('multiDotStyle' in r.doc.lines.L1).toBe(false);
    }
  });

  it('drops a legacy defaultDotStyle equal to DEFAULT_DOT_STYLE (never stored, both sides)', () => {
    // The payload goes through JSON.stringify anyway, so passing the default
    // object itself already exercises by-value comparison on the other side.
    const r = parse(buildDotPayload({}, { defaultDotStyle: DEFAULT_DOT_STYLE }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect('singletonDotStyle' in r.doc.lines.L1).toBe(false);
    expect('multiDotStyle' in r.doc.lines.L1).toBe(false);
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
      strokeAlign: 'center',
      showServiceCode: false,
    });
  });
});

describe('parse — legacy line-STYLE-DEF dot defaults bake', () => {
  // A line style PRESET saved before the singleton/interchange split carried a
  // single `defaultDotStyle` / `defaultDotSize` in its props. The bake must fold
  // them into the four split props (concrete — no drop-at-default) so every line
  // wearing the preset keeps its dots. The curveRadius suite runs this branch
  // but only ever asserts the curveRadius output, so the dot split is unpinned.
  const lineDef = (props: Record<string, unknown>) => ({
    id: 'ln',
    name: 'Default',
    kind: 'line',
    props: { width: 14, strokeWidth: 0, strokeColor: '#ffffff', ...props },
  });
  const buildStyledFile = (styleProps: Record<string, unknown>) =>
    JSON.stringify({
      format: 'massimo-map',
      version: 2,
      doc: { stations: {}, lines: {}, lineOrder: [], styles: { ln: lineDef(styleProps) } },
    });

  it('folds a legacy defaultDotSize into both split sizes and DROPS all dot-style keys', () => {
    const r = parse(
      buildStyledFile({ defaultDotStyle: DOT_SHAPE_PRESETS['open-white'], defaultDotSize: 12 }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const props = r.doc.styles.ln.props as unknown as Record<string, unknown>;
    // Dot APPEARANCE is no longer a covered line-style field — it lives in the
    // stopDot library, so the legacy style key is stripped, not folded.
    expect('singletonDotStyle' in props).toBe(false);
    expect('multiDotStyle' in props).toBe(false);
    expect('defaultDotStyle' in props).toBe(false);
    // Dot SIZE still splits onto the def.
    expect(props.singletonDotSize).toBe(12);
    expect(props.multiDotSize).toBe(12);
    expect('defaultDotSize' in props).toBe(false);
  });

  it('drops dot-style keys but fills the missing SIZE side from the legacy default', () => {
    const r = parse(
      buildStyledFile({
        defaultDotStyle: DOT_SHAPE_PRESETS['open-white'],
        defaultDotSize: 12,
        singletonDotStyle: DOT_SHAPE_PRESETS['filled-black'],
        singletonDotSize: 20,
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const props = r.doc.styles.ln.props as unknown as Record<string, unknown>;
    // No dot-appearance keys survive on a line style, however they arrived.
    expect('singletonDotStyle' in props).toBe(false);
    expect('multiDotStyle' in props).toBe(false);
    // The explicit singleton size wins; the absent interchange size inherits.
    expect(props.singletonDotSize).toBe(20);
    expect(props.multiDotSize).toBe(12);
  });
});

describe('parse — line style-def interline gap sanitizing', () => {
  const buildStyledFile = (extra: Record<string, unknown>) =>
    JSON.stringify({
      format: 'massimo-map',
      version: 2,
      doc: {
        stations: {},
        lines: {},
        lineOrder: [],
        styles: {
          ln: {
            id: 'ln',
            name: 'Default',
            kind: 'line',
            props: {
              width: 14,
              strokeWidth: 0,
              strokeColor: '#ffffff',
              singletonDotSize: 8,
              multiDotSize: 8,
              curveRadius: 24,
              ...extra,
            },
          },
        },
      },
    });

  it('keeps the stored gap verbatim, collapses 0 to absent, drops junk', () => {
    const keep = parse(buildStyledFile({ interlineGap: 2.1 }));
    expect(keep.ok).toBe(true);
    if (keep.ok) {
      expect((keep.doc.styles.ln.props as unknown as Record<string, unknown>).interlineGap).toBe(
        2.1,
      );
    }
    for (const off of [{ interlineGap: 0 }, { interlineGap: 'wide' }, {}]) {
      const r = parse(buildStyledFile(off));
      expect(r.ok).toBe(true);
      if (r.ok) expect('interlineGap' in r.doc.styles.ln.props).toBe(false);
    }
  });

  it('labelGap props: kept verbatim (0 included), collapsed at the default 3, junk dropped', () => {
    const keep = parse(buildStyledFile({ labelGap: 2.1 }));
    expect(keep.ok).toBe(true);
    if (keep.ok) {
      expect((keep.doc.styles.ln.props as unknown as Record<string, unknown>).labelGap).toBe(2.1);
    }
    const butt = parse(buildStyledFile({ labelGap: 0 }));
    expect(butt.ok).toBe(true);
    if (butt.ok) {
      expect((butt.doc.styles.ln.props as unknown as Record<string, unknown>).labelGap).toBe(0);
    }
    for (const off of [{ labelGap: 3 }, { labelGap: 'wide' }, {}]) {
      const r = parse(buildStyledFile(off));
      expect(r.ok).toBe(true);
      if (r.ok) expect('labelGap' in r.doc.styles.ln.props).toBe(false);
    }
  });
});

describe('parse — dot size sanitizing at a shared (interchange) station', () => {
  // Every single-stop case above exercises only the singletonDotSize side of
  // the effective-default split. A stop at a SHARED station (≥2 visible stops)
  // must canonicalize against its line's multiDotSize instead — swapping the two
  // sides would silently resize interchange dots on load with no test to catch it.
  const buildShared = (l1StopExtra: Record<string, unknown>) =>
    JSON.stringify({
      format: 'massimo-map',
      doc: {
        ...makeDoc({
          lines: [
            makeLine({ id: 'L1', stations: ['s1'] }),
            makeLine({ id: 'L2', stations: ['s1'] }),
          ],
        }),
        stations: {
          s1: {
            id: 's1',
            name: 'S1',
            x: 0,
            y: 0,
            rotation: 0,
            stops: [
              { lineId: 'L1', row: 0, col: 0, orientation: 'auto-vertical', ...l1StopExtra },
              { lineId: 'L2', row: 0, col: 1, orientation: 'auto-vertical' },
            ],
            label: { row: 0, col: -1, rotation: 0, offset: 0, align: 'auto', valign: 'middle' },
          },
        },
        // Distinct split sizes so the two sides are distinguishable.
        lines: {
          L1: {
            ...makeLine({ id: 'L1', stations: ['s1'] }),
            singletonDotSize: 12,
            multiDotSize: 18,
          },
          L2: makeLine({ id: 'L2', stations: ['s1'] }),
        },
      },
    });

  it("drops a shared stop override equal to the line's multiDotSize", () => {
    const r = parse(buildShared({ dotSize: 18 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const l1stop = r.doc.stations.s1.stops.find((s) => s.lineId === 'L1')!;
    expect('dotSize' in l1stop).toBe(false);
  });

  it('keeps a shared stop override equal to singletonDotSize (the wrong side would drop it)', () => {
    const r = parse(buildShared({ dotSize: 12 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const l1stop = r.doc.stations.s1.stops.find((s) => s.lineId === 'L1')!;
    expect(l1stop.dotSize).toBe(12);
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
    const doc = makeDoc({
      lines: [makeLine({ id: 'L1', width: 21, singletonDotSize: 8, multiDotSize: 8 })],
      styles: Object.values(T.DEFAULT_STYLES),
    });
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

  it('clamps numeric widths to the canonical stored form, keeping fractions', () => {
    const low = parse(buildWithWidth(-3));
    expect(low.ok).toBe(true);
    if (low.ok) expect(low.doc.lines.L1.width).toBe(1);
    const frac = parse(buildWithWidth(9.6));
    expect(frac.ok).toBe(true);
    if (frac.ok) expect(frac.doc.lines.L1.width).toBe(9.6);
    // Only an EXACT default is dropped.
    const nearDefault = parse(buildWithWidth(14.1));
    expect(nearDefault.ok).toBe(true);
    if (nearDefault.ok) expect(nearDefault.doc.lines.L1.width).toBe(14.1);
    const atDefault = parse(buildWithWidth(14));
    expect(atDefault.ok).toBe(true);
    if (atDefault.ok) expect('width' in atDefault.doc.lines.L1).toBe(false);
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

  it('round-trips non-default split line sizes and a stop size losslessly', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 's1', stops: [makeStop('L1', { dotSize: 16 })] })],
      lines: [makeLine({ id: 'L1', stations: ['s1'], singletonDotSize: 12, multiDotSize: 18 })],
      styles: Object.values(T.DEFAULT_STYLES),
    });
    const result = parse(serialize(doc));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.doc).toEqual(doc);
  });

  it('bakes a legacy default line size into both split fields; the default is stored too', () => {
    const both = parse(buildDotSizePayload({}, { defaultDotSize: 12 }));
    expect(both.ok).toBe(true);
    if (both.ok) {
      expect(both.doc.lines.L1.singletonDotSize).toBe(12);
      expect(both.doc.lines.L1.multiDotSize).toBe(12);
    }
    // Sizes are always stored: the legacy split bake drops the flat default,
    // and the materializing bake writes it right back as a concrete value.
    const atDefault = parse(buildDotSizePayload({}, { defaultDotSize: 8 }));
    expect(atDefault.ok).toBe(true);
    if (atDefault.ok) {
      expect(atDefault.doc.lines.L1.singletonDotSize).toBe(8);
      expect(atDefault.doc.lines.L1.multiDotSize).toBe(8);
    }
  });

  it("drops a singleton stop override equal to the line's effective default (after bake + sanitizing)", () => {
    // The legacy default carries straight through to the line's singleton
    // default; the singleton stop's identical size must compare against THAT —
    // catching a bake/sanitize ordering bug.
    const result = parse(buildDotSizePayload({ dotSize: 10.1 }, { defaultDotSize: 10.1 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.lines.L1.singletonDotSize).toBe(10.1);
    expect(result.doc.lines.L1.multiDotSize).toBe(10.1);
    expect('dotSize' in result.doc.stations.s1.stops[0]).toBe(false);
  });

  it('keeps a stop override of the global default when the line default differs', () => {
    const result = parse(buildDotSizePayload({ dotSize: 8 }, { defaultDotSize: 10 }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.doc.stations.s1.stops[0].dotSize).toBe(8);
  });

  it('replaces non-numeric line sizes with the materialized natural; drops junk stop sizes', () => {
    for (const junk of ['big', null, true, {}]) {
      const result = parse(buildDotSizePayload({ dotSize: junk }, { defaultDotSize: junk }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Junk is dropped by the sanitizers, then the line fields (always
      // stored) are materialized at the dot type's natural.
      expect(result.doc.lines.L1.singletonDotSize).toBe(8);
      expect(result.doc.lines.L1.multiDotSize).toBe(8);
      expect('dotSize' in result.doc.stations.s1.stops[0]).toBe(false);
    }
  });

  it('clamps numeric sizes to the canonical stored form, keeping fractions', () => {
    const low = parse(buildDotSizePayload({ dotSize: -3 }, { defaultDotSize: 9.6 }));
    expect(low.ok).toBe(true);
    if (!low.ok) return;
    expect(low.doc.lines.L1.singletonDotSize).toBe(9.6); // kept, not pulled to 9.5
    expect(low.doc.lines.L1.multiDotSize).toBe(9.6);
    expect(low.doc.stations.s1.stops[0].dotSize).toBe(0);
    // A near-default size is its own value; line sizes are always stored.
    const nearDefault = parse(buildDotSizePayload({}, { defaultDotSize: 8.1 }));
    expect(nearDefault.ok).toBe(true);
    if (nearDefault.ok) {
      expect(nearDefault.doc.lines.L1.singletonDotSize).toBe(8.1);
      expect(nearDefault.doc.lines.L1.multiDotSize).toBe(8.1);
    }
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
    // A non-finite legacy default is dropped by the bake (not clamped), and
    // the always-stored line fields then materialize at the natural.
    expect(result.doc.lines.L1.singletonDotSize).toBe(8);
    expect(result.doc.lines.L1.multiDotSize).toBe(8);
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
      lines: [
        makeLine({
          id: 'L1',
          strokeWidth: 4,
          strokeColor: { day: '#ff0000', night: '#ff0000' },
          singletonDotSize: 8,
          multiDotSize: 8,
        }),
      ],
      styles: Object.values(T.DEFAULT_STYLES),
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

  it('clamps numeric stroke widths to the canonical stored form, keeping fractions', () => {
    // Negative clamps to 0 = the default, so the field is dropped.
    const low = parse(buildWithStroke({ strokeWidth: -3 }));
    expect(low.ok).toBe(true);
    if (low.ok) expect('strokeWidth' in low.doc.lines.L1).toBe(false);
    const frac = parse(buildWithStroke({ strokeWidth: 3.6 }));
    expect(frac.ok).toBe(true);
    if (frac.ok) expect(frac.doc.lines.L1.strokeWidth).toBe(3.6);
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

  it('lowercases both halves of a stored stroke color', () => {
    const result = parse(buildWithStroke({ strokeColor: { day: '#AB12CD', night: '#12AB34' } }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.lines.L1.strokeColor).toEqual({ day: '#ab12cd', night: '#12ab34' });
    }
  });

  // Casings from before the day/night split are single strings; they were day
  // colors, so both halves take them and the file paints as it always did.
  it('wraps a LEGACY single-color casing string into a day/night pair', () => {
    const result = parse(buildWithStroke({ strokeColor: '#AB12CD' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.lines.L1.strokeColor).toEqual({ day: '#ab12cd', night: '#ab12cd' });
    }
  });

  it('drops the default stroke color in any case, string or pair', () => {
    for (const def of [
      '#ffffff',
      '#FFFFFF',
      { day: '#ffffff', night: '#ffffff' },
      { day: '#FFFFFF', night: '#ffffff' },
    ]) {
      const result = parse(buildWithStroke({ strokeColor: def }));
      expect(result.ok).toBe(true);
      if (result.ok) expect('strokeColor' in result.doc.lines.L1).toBe(false);
    }
  });

  it('keeps a pair that is white on ONE side only (the collapse is all-or-nothing)', () => {
    const result = parse(buildWithStroke({ strokeColor: { day: '#ffffff', night: '#000000' } }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.lines.L1.strokeColor).toEqual({ day: '#ffffff', night: '#000000' });
    }
  });

  // 'none' and 'bw' are the DOT slots' sentinels — a casing has no fill of its
  // own to auto-contrast against, so neither means anything here. They must be
  // refused rather than wrapped like a legacy hex, or `stroke="bw"` reaches an
  // SVG paint attribute.
  it("refuses the dot slots' narrower sentinels instead of wrapping them", () => {
    for (const junk of ['none', 'bw']) {
      const result = parse(buildWithStroke({ strokeColor: junk }));
      expect(result.ok).toBe(true);
      if (result.ok) expect('strokeColor' in result.doc.lines.L1).toBe(false);
    }
  });

  it('drops malformed stroke colors', () => {
    for (const junk of [5, null, true, {}, { day: '#fff' }, { day: 1, night: 2 }]) {
      const result = parse(buildWithStroke({ strokeColor: junk }));
      expect(result.ok).toBe(true);
      if (result.ok) expect('strokeColor' in result.doc.lines.L1).toBe(false);
    }
  });

  // 'line' (LINE_OWN_COLOR) means "paint this in the line's own color". It is a
  // stored value like any other, so it must survive the file cleaner untouched
  // — it is already lowercase, and it matches neither the white-casing default
  // nor a junk value.
  it("round-trips the 'line' sentinel on the casing", () => {
    const result = parse(buildWithStroke({ strokeColor: 'line' }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.lines.L1.strokeColor).toBe('line');
    }
  });

  it('round-trips dash dimensions verbatim and drops them at 0 (unset ⇒ derive)', () => {
    const keep = parse(buildWithStroke({ dashLength: 3.6, dashWidth: 2.2 }));
    expect(keep.ok).toBe(true);
    if (keep.ok) {
      expect(keep.doc.lines.L1.dashLength).toBe(3.6);
      expect(keep.doc.lines.L1.dashWidth).toBe(2.2);
    }
    const off = parse(buildWithStroke({ dashLength: 0, dashWidth: 0 }));
    expect(off.ok).toBe(true);
    if (off.ok) {
      expect('dashLength' in off.doc.lines.L1).toBe(false);
      expect('dashWidth' in off.doc.lines.L1).toBe(false);
    }
  });

  it('drops non-numeric dash dimensions', () => {
    for (const junk of ['long', null, true, {}]) {
      const result = parse(buildWithStroke({ dashLength: junk, dashWidth: junk }));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect('dashLength' in result.doc.lines.L1).toBe(false);
        expect('dashWidth' in result.doc.lines.L1).toBe(false);
      }
    }
  });

  it('round-trips an interline gap verbatim and drops it at 0 (unset ⇒ tangent)', () => {
    const keep = parse(buildWithStroke({ interlineGap: 2.1 }));
    expect(keep.ok).toBe(true);
    if (keep.ok) expect(keep.doc.lines.L1.interlineGap).toBe(2.1);
    const off = parse(buildWithStroke({ interlineGap: 0 }));
    expect(off.ok).toBe(true);
    if (off.ok) expect('interlineGap' in off.doc.lines.L1).toBe(false);
  });

  it('drops non-numeric interline gaps', () => {
    for (const junk of ['wide', null, true, {}]) {
      const result = parse(buildWithStroke({ interlineGap: junk }));
      expect(result.ok).toBe(true);
      if (result.ok) expect('interlineGap' in result.doc.lines.L1).toBe(false);
    }
  });

  it('round-trips a label gap verbatim; the default 3 collapses, 0 is REAL', () => {
    const keep = parse(buildWithStroke({ labelGap: 2.1 }));
    expect(keep.ok).toBe(true);
    if (keep.ok) expect(keep.doc.lines.L1.labelGap).toBe(2.1);
    // Unlike interlineGap (0 = off = absent), labelGap collapses at its
    // default 3 and keeps an explicit 0 — text butted to the marker.
    const def = parse(buildWithStroke({ labelGap: 3 }));
    expect(def.ok).toBe(true);
    if (def.ok) expect('labelGap' in def.doc.lines.L1).toBe(false);
    const butt = parse(buildWithStroke({ labelGap: 0 }));
    expect(butt.ok).toBe(true);
    if (butt.ok) expect(butt.doc.lines.L1.labelGap).toBe(0);
    // Negative gaps are legal (ink deliberately into the marker), floored.
    const neg = parse(buildWithStroke({ labelGap: -2 }));
    expect(neg.ok).toBe(true);
    if (neg.ok) expect(neg.doc.lines.L1.labelGap).toBe(-2);
    const floor = parse(buildWithStroke({ labelGap: -99 }));
    expect(floor.ok).toBe(true);
    if (floor.ok) expect(floor.doc.lines.L1.labelGap).toBe(-10);
  });

  it('drops non-numeric label gaps', () => {
    for (const junk of ['wide', null, true, {}]) {
      const result = parse(buildWithStroke({ labelGap: junk }));
      expect(result.ok).toBe(true);
      if (result.ok) expect('labelGap' in result.doc.lines.L1).toBe(false);
    }
  });
});

describe('parse — transfer style sanitizing', () => {
  // Builds a file whose single transfer carries arbitrary raw override
  // fields, as a hand-edited or legacy file might. `docExtra` injects the
  // RETIRED doc-level transfer settings a pre-retirement save would carry.
  const buildWithTransfer = (
    fields: Record<string, unknown>,
    docExtra: Record<string, unknown> = {},
  ) =>
    JSON.stringify({
      format: 'massimo-map',
      doc: {
        // The endpoints must exist: parse drops a transfer whose station is
        // dangling (the load-time twin of the app's cascade-delete).
        ...makeDoc({
          stations: [makeStation({ id: 's1' }), makeStation({ id: 's2', x: 100 })],
        }),
        transfers: {
          x1: {
            id: 'x1',
            a: { stationId: 's1', lineId: null },
            b: { stationId: 's2', lineId: null },
            ...fields,
          },
        },
        ...docExtra,
      },
    });

  it('carries a lifted draw rung through, drops it at the default, and drops junk', () => {
    const drawOf = (fields: Record<string, unknown>) => {
      const r = parse(buildWithTransfer(fields));
      expect(r.ok).toBe(true);
      return r.ok ? r.doc.transfers.x1 : undefined;
    };
    expect(drawOf({ draw: 'over-code' })!.draw).toBe('over-code');
    // Absent IS 'under', so an explicit 'under' collapses rather than storing.
    expect('draw' in drawOf({ draw: 'under' })!).toBe(false);
    // A value off the ladder is dropped, which reads as 'under' — never
    // painted at a rung that doesn't exist.
    expect('draw' in drawOf({ draw: 'over-everything' })!).toBe(false);
    expect('draw' in drawOf({ draw: 7 })!).toBe(false);
  });

  it('drops explicit overrides equal to the constant defaults (never stored)', () => {
    const result = parse(
      buildWithTransfer({
        thickness: 2,
        color: '#000000',
        strokeWidth: 0,
        strokeColor: '#ffffff',
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const field of ['thickness', 'color', 'strokeWidth', 'strokeColor']) {
      expect(field in result.doc.transfers.x1).toBe(false);
    }
  });

  it('bakes RETIRED doc-level settings into overrides, preserving each transfer LOOK', () => {
    // Pre-retirement file, tracking transfer: the legacy setting 7 becomes a
    // per-transfer override so the transfer still renders at 7 — and the
    // legacy field itself is dropped from the parsed doc.
    const tracking = parse(buildWithTransfer({}, { transferThickness: 7 }));
    expect(tracking.ok).toBe(true);
    if (tracking.ok) {
      expect(tracking.doc.transfers.x1.thickness).toBe(7);
      expect('transferThickness' in tracking.doc).toBe(false);
    }
    // Explicit override 5 over legacy setting 5: still effective 5 ≠ the
    // constant 2, so the override survives.
    const redundant = parse(buildWithTransfer({ thickness: 5 }, { transferThickness: 5 }));
    expect(redundant.ok).toBe(true);
    if (redundant.ok) expect(redundant.doc.transfers.x1.thickness).toBe(5);
    // Override 2 over legacy setting 5: effective 2 == the constant default,
    // so the override collapses — the transfer falls back to the constant
    // with the same rendered look.
    const distinct = parse(buildWithTransfer({ thickness: 2 }, { transferThickness: 5 }));
    expect(distinct.ok).toBe(true);
    if (distinct.ok) expect('thickness' in distinct.doc.transfers.x1).toBe(false);
  });

  it('clamps numeric overrides to the canonical stored form, keeping fractions', () => {
    const frac = parse(buildWithTransfer({ thickness: 4.6, strokeWidth: 2.7 }));
    expect(frac.ok).toBe(true);
    if (frac.ok) {
      expect(frac.doc.transfers.x1.thickness).toBe(4.6);
      expect(frac.doc.transfers.x1.strokeWidth).toBe(2.7);
    }
    // Only an EXACT match with the setting is dropped.
    const nearDefault = parse(buildWithTransfer({ thickness: 2.1 }));
    expect(nearDefault.ok).toBe(true);
    if (nearDefault.ok) expect(nearDefault.doc.transfers.x1.thickness).toBe(2.1);
    const atDefault = parse(buildWithTransfer({ thickness: 2 }));
    expect(atDefault.ok).toBe(true);
    if (atDefault.ok) expect('thickness' in atDefault.doc.transfers.x1).toBe(false);
    // Negative thickness clamps to the floor 1 — distinct from the setting 2, kept.
    const low = parse(buildWithTransfer({ thickness: -3 }));
    expect(low.ok).toBe(true);
    if (low.ok) expect(low.doc.transfers.x1.thickness).toBe(1);
    // Negative stroke width clamps to 0 = the setting, so it is dropped.
    const lowStroke = parse(buildWithTransfer({ strokeWidth: -3 }));
    expect(lowStroke.ok).toBe(true);
    if (lowStroke.ok) expect('strokeWidth' in lowStroke.doc.transfers.x1).toBe(false);
  });

  it('drops non-numeric junk on the numeric fields', () => {
    for (const junk of ['thick', null, true, {}]) {
      const result = parse(buildWithTransfer({ thickness: junk, strokeWidth: junk }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect('thickness' in result.doc.transfers.x1).toBe(false);
      expect('strokeWidth' in result.doc.transfers.x1).toBe(false);
    }
  });

  it('drops non-string junk on the color fields', () => {
    for (const junk of [5, null, true, {}]) {
      const result = parse(buildWithTransfer({ color: junk, strokeColor: junk }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect('color' in result.doc.transfers.x1).toBe(false);
      expect('strokeColor' in result.doc.transfers.x1).toBe(false);
    }
  });

  it('drops non-finite numeric overrides', () => {
    const json = buildWithTransfer({ thickness: 0 }).replace('"thickness":0', '"thickness":1e999');
    const result = parse(json);
    expect(result.ok).toBe(true);
    if (result.ok) expect('thickness' in result.doc.transfers.x1).toBe(false);
  });

  it('leaves a settings-free (post-retirement) file alone apart from the constant collapse', () => {
    // No legacy settings keys → the bake is skipped entirely; overrides are
    // judged against the constant defaults only. A legacy single-color
    // strokeColor is wrapped to a day/night pair on the way in.
    const result = parse(buildWithTransfer({ thickness: 2, strokeColor: '#123456' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect('thickness' in result.doc.transfers.x1).toBe(false);
    expect(result.doc.transfers.x1.strokeColor).toEqual({ day: '#123456', night: '#123456' });
  });

  it('migrates a legacy single-color override to a day/night pair (old color = day = night)', () => {
    const result = parse(buildWithTransfer({ color: '#ff0080' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.transfers.x1.color).toEqual({ day: '#ff0080', night: '#ff0080' });
  });

  it('accepts an already-day/night override and collapses one equal to the default', () => {
    const kept = parse(buildWithTransfer({ color: { day: '#ff0080', night: '#003300' } }));
    expect(kept.ok).toBe(true);
    if (kept.ok) {
      expect(kept.doc.transfers.x1.color).toEqual({ day: '#ff0080', night: '#003300' });
    }
    // Both halves == the black default → the override collapses away.
    const collapsed = parse(buildWithTransfer({ color: { day: '#000000', night: '#000000' } }));
    expect(collapsed.ok).toBe(true);
    if (collapsed.ok) expect('color' in collapsed.doc.transfers.x1).toBe(false);
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
    | { kind: 'toggleMembership' }
    | { kind: 'rotateStation' }
    | { kind: 'moveStation'; x: number; y: number }
    | { kind: 'deleteStation' }
    | { kind: 'deleteLine' }
    | { kind: 'moveLineInOrder'; dir: -1 | 1 }
    | { kind: 'setLineWidth'; w: number };

  const actionArb = fc.oneof(
    fc.constant<Action>({ kind: 'addStation' }),
    fc.constant<Action>({ kind: 'addLine' }),
    fc.constant<Action>({ kind: 'toggleMembership' }),
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
        case 'toggleMembership': {
          // Membership add/remove via the canvas primitives (see the
          // invariants suite for the same shape).
          const l = firstKey(doc.lines);
          const s = lastKey(doc.stations);
          if (!l || !s) break;
          const ln = doc.lines[l];
          if (ln.stations.includes(s)) {
            doc = T.removeStationFromLine(doc, l, ln.stations.indexOf(s));
          } else {
            const from = ln.stations.length ? ln.stations[ln.stations.length - 1] : null;
            doc = from ? T.connectStationsOnLine(doc, l, from, s) : T.addStationToLine(doc, l, s);
          }
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

describe('parse — legacy doc-level curveRadius bake', () => {
  // Corner rounding moved from MapDoc.curveRadius (doc-global) to a per-line
  // style field. Legacy files carry the doc field; the bake stamps it onto
  // every line (and fills line style defs that predate the covered field),
  // then drops it — so old maps keep their exact rendered curves.
  const lineStyleDef = (props: Record<string, unknown>) => ({
    id: 'default-line',
    name: 'Default',
    kind: 'line',
    props: {
      defaultDotStyle: DEFAULT_DOT_STYLE,
      defaultDotSize: 14,
      width: 14,
      strokeWidth: 0,
      strokeColor: '#ffffff',
      ...props,
    },
  });
  const buildFile = (docExtra: Record<string, unknown>): string =>
    JSON.stringify({
      format: 'massimo-map',
      version: 2,
      doc: {
        stations: {
          s1: {
            id: 's1',
            name: 'A',
            x: 0,
            y: 0,
            rotation: 0,
            stops: [{ lineId: 'L1' }],
            label: { row: 0, col: 0, rotation: 0, offset: 8, align: 'auto', valign: 'middle' },
          },
          s2: {
            id: 's2',
            name: 'B',
            x: 100,
            y: 0,
            rotation: 0,
            stops: [{ lineId: 'L1' }],
            label: { row: 0, col: 0, rotation: 0, offset: 8, align: 'auto', valign: 'middle' },
          },
        },
        lines: {
          L1: { id: 'L1', service: '1', name: '1 line', color: '#ee352e', stations: ['s1', 's2'] },
        },
        lineOrder: ['L1'],
        ...docExtra,
      },
    });

  it('stamps a non-default legacy radius onto every line and drops the doc field', () => {
    const r = parse(buildFile({ curveRadius: 40 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.lines.L1.curveRadius).toBe(40);
    expect('curveRadius' in r.doc).toBe(false);
  });

  it('leaves lines unstamped for the legacy default 24 (never stored)', () => {
    const r = parse(buildFile({ curveRadius: 24 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect('curveRadius' in r.doc.lines.L1).toBe(false);
    expect('curveRadius' in r.doc).toBe(false);
  });

  it("a line's own curveRadius wins over the legacy doc value", () => {
    const withOwn = buildFile({ curveRadius: 40 }).replace(
      '"color":"#ee352e"',
      '"color":"#ee352e","curveRadius":12',
    );
    const r = parse(withOwn);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.lines.L1.curveRadius).toBe(12);
  });

  it('fills line style defs that predate the field from the legacy radius', () => {
    const r = parse(buildFile({ curveRadius: 40, styles: { 'default-line': lineStyleDef({}) } }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const def = r.doc.styles['default-line'];
    expect(def.kind).toBe('line');
    expect((def.props as { curveRadius?: number }).curveRadius).toBe(40);
  });

  it('fills a field-less line style def with the default 24 when no legacy doc field exists', () => {
    const r = parse(buildFile({ styles: { 'default-line': lineStyleDef({}) } }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.doc.styles['default-line'].props as { curveRadius?: number }).curveRadius).toBe(24);
  });

  it('keeps an explicit style-def curveRadius over the legacy doc value', () => {
    const r = parse(
      buildFile({ curveRadius: 40, styles: { 'default-line': lineStyleDef({ curveRadius: 30 }) } }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.doc.styles['default-line'].props as { curveRadius?: number }).curveRadius).toBe(30);
  });

  it('sanitizes per-line curveRadius: clamps to the floor, drops at the default', () => {
    const stamped = (v: string) => {
      const r = parse(
        buildFile({}).replace('"color":"#ee352e"', `"color":"#ee352e","curveRadius":${v}`),
      );
      expect(r.ok).toBe(true);
      return r.ok ? r.doc.lines.L1.curveRadius : undefined;
    };
    expect(stamped('39.6')).toBe(39.6);
    expect(stamped('1')).toBe(4); // clamps to LINE_CURVE_RADIUS_MIN
    expect(stamped('24')).toBe(undefined); // default is never stored
    expect(stamped('"junk"')).toBe(undefined); // garbage dropped
    expect(stamped('1e999')).toBe(undefined); // non-finite dropped
  });

  it('is idempotent: a re-serialized baked doc parses back unchanged', () => {
    const first = parse(buildFile({ curveRadius: 40 }));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = parse(serialize(first.doc));
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.doc).toEqual(first.doc);
  });

  // The retired branch-seam subsystem left seamColor/seamWidth/seamEdges on
  // lines and line style defs in old files. The cleaner strips all of them —
  // no key may survive onto any line or def.
  it('strips the retired seam fields from lines and line style defs', () => {
    const withSeams = buildFile({
      styles: {
        'default-line': lineStyleDef({
          seamEdges: 'curved',
          seamColor: '#abcdef80',
          seamWidth: 3,
        }),
      },
    })
      .replace(
        '"color":"#ee352e"',
        '"color":"#ee352e","seamColor":"#abcdef80","seamWidth":3,"seamEdges":"curved"',
      )
      // A pre-v23 doc that never got the v23 bake still carries the DOC-LEVEL
      // field at the root — the strip removes that remnant too.
      .replace('"format":', '"seamEdges":"straight","format":');
    const r = parse(withSeams);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect('seamEdges' in r.doc).toBe(false);
    for (const line of Object.values(r.doc.lines)) {
      expect('seamColor' in line).toBe(false);
      expect('seamWidth' in line).toBe(false);
      expect('seamEdges' in line).toBe(false);
    }
    for (const def of Object.values(r.doc.styles)) {
      expect('seamColor' in def.props).toBe(false);
      expect('seamWidth' in def.props).toBe(false);
      expect('seamEdges' in def.props).toBe(false);
    }
  });
});

// Line ends on disk: the line's own style is a plain drop-at-default field; the
// per-station pins are scoped to where the line ENDS, so the loader
// re-validates them against the shape the file actually carries (a hand-edited
// or concurrently-edited file can disagree with itself). That question is
// geometric, hence the real coordinates below — a—b—c running straight down.
describe('line ends — file hygiene', () => {
  const chain = (linePatch: object) =>
    makeDoc({
      stations: [
        makeStation({ id: 'a', x: 0, y: 0, stops: [makeStop('L1')] }),
        makeStation({ id: 'b', x: 0, y: 300, stops: [makeStop('L1')] }),
        makeStation({ id: 'c', x: 0, y: 600, stops: [makeStop('L1')] }),
      ],
      lines: [makeLine({ id: 'L1', stations: ['a', 'b', 'c'], ...linePatch })],
      styles: Object.values(T.DEFAULT_STYLES),
    });
  const load = (doc: MapDoc) => {
    const r = parse(serialize(doc));
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    return r.doc.lines.L1;
  };

  it('round-trips a line end and its terminus pins', () => {
    const line = load(chain({ endStyle: 'round', stationEndStyles: { a: 'short' } }));
    expect(line.endStyle).toBe('round');
    expect(line.stationEndStyles).toEqual({ a: 'short' });
  });

  it('drops a square end style — the default is never stored', () => {
    expect('endStyle' in load(chain({ endStyle: 'square' }))).toBe(false);
  });

  it('drops a garbage end style rather than rejecting the file', () => {
    const line = load(chain({ endStyle: 'bevelled' as never }));
    expect('endStyle' in line).toBe(false);
  });

  it('KEEPS a pin whose station is not currently an end — it may be one again', () => {
    // b is interior, so its pin paints nothing today. It is not garbage
    // though: where a line ends moves with the geometry, and dropping the pin
    // here would mean a save/reload silently ate what the user set the last
    // time b WAS an end. Inert, stored, revived when b ends again.
    const line = load(chain({ stationEndStyles: { b: 'round', c: 'round' } }));
    expect(line.stationEndStyles).toEqual({ b: 'round', c: 'round' });
  });

  it('drops a pin on a station that has left the line', () => {
    // Liveness is what the loader validates: `z` is not a member, so no edit
    // can ever bring its pin back into play.
    const line = load(chain({ stationEndStyles: { z: 'round', c: 'round' } }));
    expect(line.stationEndStyles).toEqual({ c: 'round' });
  });

  it('drops a pin that merely repeats the line’s own end', () => {
    const line = load(chain({ endStyle: 'round', stationEndStyles: { a: 'round' } }));
    expect('stationEndStyles' in line).toBe(false);
  });

  it('judges pin redundancy against the CLEANED line end', () => {
    // The garbage line end heals to square, so a square pin is redundant —
    // deciding that against the raw value would have kept it.
    const line = load(chain({ endStyle: 'nonsense' as never, stationEndStyles: { a: 'square' } }));
    expect('stationEndStyles' in line).toBe(false);
  });

  it('drops a garbage pin value and the whole map once it empties', () => {
    const line = load(chain({ stationEndStyles: { a: 'blobby' as never } }));
    expect('stationEndStyles' in line).toBe(false);
  });

  it('survives a pin map that is not an object at all', () => {
    const line = load(chain({ stationEndStyles: 'nope' as never }));
    expect('stationEndStyles' in line).toBe(false);
  });

  // "No overrides" has ONE representation — the field absent. Each of these
  // holds no usable pin, so none may reach the doc: `typeof null === 'object'`
  // and an array is an object too, so the non-object guard alone lets them by,
  // and an empty map has nothing to change and so was never rewritten.
  it('drops a null pin map', () => {
    const line = load(chain({ stationEndStyles: null as never }));
    expect('stationEndStyles' in line).toBe(false);
  });

  it('drops an empty pin map', () => {
    const line = load(chain({ stationEndStyles: {} }));
    expect('stationEndStyles' in line).toBe(false);
  });

  it('drops an array pin map', () => {
    const line = load(chain({ stationEndStyles: [] as never }));
    expect('stationEndStyles' in line).toBe(false);
  });
});
