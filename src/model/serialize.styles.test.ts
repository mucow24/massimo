// File-import hygiene for the Styles feature: styles round-trip through
// serialize/parse, malformed defs are dropped, numerics land on the canonical
// grids, and dangling / wrong-kind styleId tags are pruned.
import { describe, it, expect } from 'vitest';
import { bakeLegacyLabelSettings, parse, serialize } from './serialize';
import { applyStyleToItem, captureStyleProps } from './styles';
import { DOT_BASE_SHAPES, STOP_DOT_FACTORY_STYLES } from './dotStyle';
import {
  DEFAULT_STYLES,
  FACTORY_STYLE_DEFAULTS,
  ROUTE_BULLET_SHAPES,
  TEXT_LABEL_ALIGNS,
} from './transforms';
import type { MapDoc, StyleDef, TextLabelStyleProps } from './types';
import {
  makeDoc,
  makeLine,
  makePolygon,
  makeRouteBullet,
  makeStation,
  makeStyle,
  makeTextLabel,
  makeTransfer,
} from '../test/fixtures';

const fileWith = (doc: unknown): string =>
  JSON.stringify({ format: 'massimo-map', version: 2, doc });

const parsed = (doc: unknown): MapDoc => {
  const result = parse(fileWith(doc));
  if (!result.ok) throw new Error(result.error);
  return result.doc;
};

describe('styles round-trip', () => {
  it('a doc with a def of every item-bearing kind survives serialize → parse (stopDot excluded — it has no item collection)', () => {
    let doc = makeDoc({
      stations: [makeStation({ id: 's1' }), makeStation({ id: 's2' })],
      lines: [makeLine({ id: 'l1' })],
      textLabels: [makeTextLabel({ id: 'g1' })],
      polygons: [makePolygon({ id: 'p1' })],
      routeBullets: [makeRouteBullet({ id: 'b1' })],
      transfers: [makeTransfer({ id: 'x1' })],
      styles: [
        makeStyle('line', 'y1', { name: 'Thick', props: { width: 10, strokeWidth: 1.5 } }),
        makeStyle('textLabel', 'y2', { name: 'Heading', props: { fontSize: 24, weight: 700 } }),
        makeStyle('polygon', 'y3', { name: 'Lake', props: { fill: '#00aaff', curveRadius: 8 } }),
        makeStyle('routeBullet', 'y4', { name: 'Big', props: { size: 20 } }),
        makeStyle('transfer', 'y5', { name: 'Bold link', props: { thickness: 6 } }),
        makeStyle('station', 'y6', { name: 'Big name', props: { fontSize: 20, weight: 700 } }),
      ],
    });
    doc = applyStyleToItem(doc, 'y1', 'l1');
    doc = applyStyleToItem(doc, 'y2', 'g1');
    doc = applyStyleToItem(doc, 'y3', 'p1');
    doc = applyStyleToItem(doc, 'y4', 'b1');
    doc = applyStyleToItem(doc, 'y5', 'x1');
    doc = applyStyleToItem(doc, 'y6', 's1');
    const result = parse(serialize(doc));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.doc).toEqual(doc);
  });

  it('an older file without a styles field parses with the factory Defaults', () => {
    const { styles: _gone, ...docWithout } = makeDoc({}) as MapDoc;
    expect(parsed(docWithout).styles).toEqual(DEFAULT_STYLES);
  });

  it('a pre-styles file adopts default-looking items into the backfilled Defaults', () => {
    // Old maps are full of untagged, default-valued items; adopting them at
    // load is what lets the Styles panel's Default editors act on the whole
    // map. Non-matching items stay Custom.
    const { styles: _gone, ...docWithout } = makeDoc({
      textLabels: [makeTextLabel({ id: 'g1' }), makeTextLabel({ id: 'g2', fontSize: 24 })],
    }) as MapDoc;
    const out = parsed(docWithout);
    expect(out.textLabels.g1.styleId).toBe('default-textLabel');
    expect(out.textLabels.g2.styleId).toBeUndefined();
  });

  it('a file WITH a styles record does NOT adopt — explicit Custom choices survive', () => {
    // An untagged item that happens to match a style stays untagged: the
    // user may have detached it deliberately, and parse(serialize(doc)) must
    // return the doc unchanged.
    const doc = makeDoc({
      textLabels: [makeTextLabel({ id: 'g1' })], // matches the factory Default
      styles: Object.values(DEFAULT_STYLES),
    });
    const result = parse(serialize(doc));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.textLabels.g1.styleId).toBeUndefined();
      expect(result.doc).toEqual(doc);
    }
  });

  it('the legacy-settings bake seeds the DESIGNATED default transfer style — not by id, not by name', () => {
    // The designated default sits under a non-factory id and a non-'Default'
    // name; a same-kind decoy NAMED 'Default' (also factory-looking) must be
    // left alone. Catches both regressions: hardcoding the factory id and
    // reverting to the old name scan.
    const doc = {
      ...makeDoc({
        styles: [
          makeStyle('transfer', 'my-transfer', { name: 'Chunky' }), // factory props
          makeStyle('transfer', 'y9', { name: 'Default' }), // decoy, factory props
        ],
        styleDefaults: { transfer: 'my-transfer' },
      }),
      transferThickness: 7,
    };
    const out = parsed(doc);
    expect(out.styles['my-transfer'].props).toMatchObject({ thickness: 7 });
    expect(out.styles.y9.props).toMatchObject({ thickness: 2 });
    expect(out.styleDefaults.transfer).toBe('my-transfer');
  });

  it('a pre-styles file with legacy transfer settings seeds the Default transfer style', () => {
    // The retired settings' map-wide role moves to the Default transfer
    // style, so a new transfer drawn into the loaded map keeps the old look.
    const { styles: _gone, ...docWithout } = makeDoc({
      stations: [makeStation({ id: 's1' }), makeStation({ id: 's2' })],
      transfers: [makeTransfer({ id: 'x1' })],
    }) as MapDoc;
    const out = parsed({ ...docWithout, transferThickness: 7 });
    const def = Object.values(out.styles).find(
      (d) => d.kind === 'transfer' && d.name === 'Default',
    );
    expect(def?.props).toMatchObject({ thickness: 7 });
    // …and the existing transfer got its look baked as an override.
    expect(out.transfers.x1.thickness).toBe(7);
    expect('transferThickness' in out).toBe(false);
  });
});

describe('sanitizeStyles via parse', () => {
  // The import gate REFUSES a def whose enum-valued prop it doesn't recognize,
  // and a refused def is dropped whole — so a value the app can write but the
  // gate doesn't know loses the user's entire style. Walk the model's own
  // ladders, not a list spelled here, so widening a union without teaching the
  // gate fails on this test instead of on a file.
  it('keeps a def at every value the model ladders name', () => {
    const defs: Record<string, StyleDef> = {};
    ROUTE_BULLET_SHAPES.forEach((shape, i) => {
      defs[`rb${i}`] = makeStyle('routeBullet', `rb${i}`, {
        name: `RB ${shape}`,
        props: { shape },
      });
    });
    TEXT_LABEL_ALIGNS.forEach((align, i) => {
      defs[`tl${i}`] = makeStyle('textLabel', `tl${i}`, { name: `TL ${align}`, props: { align } });
    });
    DOT_BASE_SHAPES.forEach((shape, i) => {
      defs[`sd${i}`] = makeStyle('stopDot', `sd${i}`, { name: `SD ${shape}`, props: { shape } });
    });
    const out = parsed({ ...makeDoc({}), styles: defs });
    for (const id of Object.keys(defs)) {
      expect(out.styles[id], `${id} (${defs[id].name})`).toBeTruthy();
    }
  });

  it('drops defs with unknown kind, empty name, or malformed props; keeps valid ones', () => {
    const good = makeStyle('routeBullet', 'y1', { name: 'Big', props: { size: 20 } });
    const doc = {
      ...makeDoc({}),
      styles: {
        y1: good,
        y2: { id: 'y2', name: 'Bad kind', kind: 'bogus', props: {} },
        y3: { id: 'y3', name: '   ', kind: 'routeBullet', props: { shape: 'circle', size: 10 } },
        y4: {
          id: 'y4',
          name: 'Bad props',
          kind: 'routeBullet',
          props: { shape: 'blob', size: 10 },
        },
        y5: { id: 'y5', name: 'No props', kind: 'polygon' },
      },
    };
    const out = parsed(doc);
    expect(out.styles.y1).toEqual(good);
    // The dropped defs' kinds end up empty, so the ≥1-per-kind invariant
    // injects their factory Defaults (routeBullet is covered by y1). The stopDot
    // library is seeded separately by the v19 bake — excluded here.
    expect(
      Object.values(out.styles)
        .filter((d) => d.kind !== 'stopDot')
        .map((d) => d.id)
        .sort(),
    ).toEqual([
      'default-line',
      'default-polygon',
      'default-station',
      'default-textLabel',
      'default-transfer',
      'y1',
    ]);
  });

  it('replaces a non-record styles value with the factory set (≥ 1 per kind)', () => {
    const out = parsed({ ...makeDoc({}), styles: [1, 2, 3] });
    expect(out.styles).toEqual(DEFAULT_STYLES);
    expect(out.styleDefaults).toEqual(FACTORY_STYLE_DEFAULTS);
  });

  // A def whose `props` is a PRIMITIVE rather than a record. It reaches the
  // legacy bakes — which run before sanitizeStyles — as a truthy non-object,
  // and every one of them probes it with `in`, which throws on a primitive.
  // Styles are deliberately outside the substance gate (their sanitizer heals
  // garbage wholesale), so this must drop the one def and load the map, not
  // refuse the file with a message about an operator.
  it('drops a LINE def whose props is a primitive, rather than refusing the file', () => {
    const good = makeStyle('routeBullet', 'y1', { name: 'Big', props: { size: 20 } });
    for (const props of ['oops', 7, true]) {
      const result = parse(
        fileWith({
          ...makeDoc({}),
          styles: { y1: good, y2: { id: 'y2', name: 'Primitive', kind: 'line', props } },
        }),
      );
      expect(result.ok, `props = ${JSON.stringify(props)}: ${result.ok ? '' : result.error}`).toBe(
        true,
      );
      if (!result.ok) continue;
      expect(result.doc.styles.y2).toBeUndefined();
      expect(result.doc.styles.y1).toEqual(good);
    }
  });

  it('clamps numerics onto the canonical grids and lowercases the line casing color', () => {
    const doc = {
      ...makeDoc({}),
      styles: {
        y1: makeStyle('line', 'y1', {
          name: 'L',
          props: {
            width: 9.6,
            strokeWidth: 1.3,
            strokeColor: { day: '#ABCDEF', night: '#ABCDEF' },
          },
        }),
        y2: makeStyle('textLabel', 'y2', { name: 'T', props: { fontSize: 12.129 } }),
        y3: makeStyle('polygon', 'y3', { name: 'P', props: { strokeWidth: 2.3, curveRadius: -4 } }),
        y4: makeStyle('routeBullet', 'y4', { name: 'B', props: { size: 3 } }),
        y5: makeStyle('transfer', 'y5', { name: 'X', props: { thickness: 5.4, strokeWidth: -1 } }),
      },
    };
    const out = parsed(doc);
    // Numbers survive exactly as the file states them; only the CLAMPS bite
    // (curveRadius floored at 0, strokeWidth at 0, size at its minimum).
    expect(out.styles.y1.props).toMatchObject({
      width: 9.6,
      strokeWidth: 1.3,
      strokeColor: { day: '#abcdef', night: '#abcdef' },
    });
    expect(out.styles.y2.props).toMatchObject({ fontSize: 12.129 });
    expect(out.styles.y3.props).toMatchObject({ strokeWidth: 2.3, curveRadius: 0 });
    expect(out.styles.y4.props).toMatchObject({ size: 6 });
    expect(out.styles.y5.props).toMatchObject({ thickness: 5.4, strokeWidth: 0 });
  });

  // The end of the chain the canonicalStyleProps omission test guards: a file
  // whose line def simply has no dash / gap keys must come back with no
  // dash / gap keys. Present-and-undefined would look harmless in the
  // debugger and then break tagging — `stylePropsEqual` compares ABSENCE, so
  // every line wearing the style would read as "Custom" the moment it loaded.
  // A malformed value takes the same route as an absent one (both arrive
  // undefined from asString/finiteNum), so one fixture covers both.
  it('leaves an absent — or malformed — optional out of the def entirely', () => {
    // A raw literal rather than makeStyle, like the malformed-props test above:
    // the point is untyped FILE data, which is the only place these values can
    // come from.
    const base = makeStyle('line', 'y1', { name: 'L' });
    const doc = {
      ...makeDoc({}),
      styles: { y1: { ...base, props: { ...base.props, dashLength: null } } },
    };
    const props = parsed(doc).styles.y1.props;
    for (const key of ['dashLength', 'dashWidth', 'interlineGap', 'labelGap']) {
      expect(props, `${key} came back as a present key`).not.toHaveProperty(key);
    }
  });

  it('rewrites a def id that disagrees with its record key', () => {
    const doc = {
      ...makeDoc({}),
      styles: { y1: { ...makeStyle('routeBullet', 'other', { name: 'B' }) } },
    };
    expect(parsed(doc).styles.y1.id).toBe('y1');
  });

  it('drops later same-kind name duplicates (first wins), keeps cross-kind homonyms', () => {
    const doc = {
      ...makeDoc({}),
      styles: {
        y1: makeStyle('routeBullet', 'y1', { name: 'Same' }),
        y2: makeStyle('routeBullet', 'y2', { name: 'Same' }),
        y3: makeStyle('polygon', 'y3', { name: 'Same' }),
      },
    };
    const out = parsed(doc);
    expect(
      Object.values(out.styles)
        .filter((d) => d.kind !== 'stopDot')
        .map((d) => d.id)
        .sort(),
    ).toEqual([
      'default-line',
      'default-station',
      'default-textLabel',
      'default-transfer',
      'y1',
      'y3',
    ]);
  });
});

describe('ensureStyleInvariants via parse', () => {
  it('keeps a valid designation verbatim (never "repaired" to another style)', () => {
    const doc = {
      ...makeDoc({
        styles: [
          makeStyle('textLabel', 'y1', { name: 'Zebra' }),
          makeStyle('textLabel', 'y2', { name: 'Alpha' }),
        ],
      }),
      styleDefaults: { textLabel: 'y1' },
    };
    expect(parsed(doc).styleDefaults.textLabel).toBe('y1');
  });

  it("repairs a dangling designation to the kind's style named 'Default', else its first by name", () => {
    const base = makeDoc({
      styles: [
        makeStyle('textLabel', 'y1', { name: 'Zebra' }),
        makeStyle('textLabel', 'y2', { name: 'Alpha' }),
      ],
    });
    expect(parsed({ ...base, styleDefaults: { textLabel: 'ghost' } }).styleDefaults.textLabel).toBe(
      'y2', // 'Alpha' sorts first
    );
    const withDefault = makeDoc({
      styles: [
        makeStyle('textLabel', 'y1', { name: 'Alpha' }),
        makeStyle('textLabel', 'y2', { name: 'Default' }),
      ],
    });
    expect(
      parsed({ ...withDefault, styleDefaults: { textLabel: 'ghost' } }).styleDefaults.textLabel,
    ).toBe('y2'); // name 'Default' beats sort order
  });

  it("a file with NO styleDefaults key designates by name 'Default', matching the rehydrate path", () => {
    // Files saved by the pre-designation build carry styles but no
    // styleDefaults. The DEFAULT_DOC merge must not fabricate a factory-id
    // designation for them — that build treated the style NAMED 'Default' as
    // the default (even under a non-factory id), and migrateDoc repairs by
    // name, so parse() has to agree or the two load paths diverge.
    // The factory-id def is still present but RENAMED — the old build's
    // default is the freshly saved 'Default' under y1. A fabricated factory-id
    // designation would resolve and stick to the wrong style.
    const { styleDefaults: _gone, ...docWithout } = makeDoc({
      styles: [
        makeStyle('textLabel', 'default-textLabel', { name: 'Base' }),
        makeStyle('textLabel', 'y1', { name: 'Default', props: { fontSize: 30 } }),
      ],
    }) as MapDoc;
    expect(parsed(docWithout).styleDefaults.textLabel).toBe('y1');
  });

  it('repairs a wrong-kind designation and fills kinds the record omits', () => {
    const doc = {
      ...makeDoc({
        styles: [
          makeStyle('polygon', 'y1', { name: 'Zone' }),
          makeStyle('textLabel', 'y2', { name: 'Heading' }),
        ],
      }),
      styleDefaults: { textLabel: 'y1' }, // polygon def on the textLabel slot
    };
    const out = parsed(doc);
    expect(out.styleDefaults.textLabel).toBe('y2');
    expect(out.styleDefaults.polygon).toBe('y1');
    // Kinds with no styles get their factory Default injected AND designated.
    expect(out.styles['default-line']).toEqual(DEFAULT_STYLES['default-line']);
    expect(out.styleDefaults.line).toBe('default-line');
    expect(out.styleDefaults.routeBullet).toBe('default-routeBullet');
    expect(out.styleDefaults.transfer).toBe('default-transfer');
  });
});

describe("ensureStyleInvariants via parse — a line style def's dot-TYPE refs", () => {
  // Dot type is a COVERED line-style field, so a def naming a stopDot style the
  // doc doesn't have is unmatchable: stampStyle's setters no-op on the dangling
  // id, leaving the line tagged over diverged values, and the next load prunes
  // the tag. The style reads "Custom" again after every single save/load, and
  // re-picking it never sticks. Repoint the def at the designated default dot.
  const LIVE = 'stop-filled-white-black-stroke';

  // A doc whose one line wears LIVE and matches its line style def in every
  // covered field — except the def's two dot-type ids, set to `defDotId`.
  const docWithDefDotId = (defDotId: string, extraStyles: StyleDef[] = []) => {
    const base = makeDoc({
      stations: [makeStation({ id: 's1' }), makeStation({ id: 's2' })],
      lines: [makeLine({ id: 'l1', singletonDotStyleId: LIVE, multiDotStyleId: LIVE })],
      styles: [
        STOP_DOT_FACTORY_STYLES[LIVE],
        makeStyle('line', 'ls', { name: 'Metro' }),
        ...extraStyles,
      ],
      styleDefaults: { stopDot: LIVE, line: 'ls' },
    });
    const props = captureStyleProps(base, 'line', 'l1')!;
    return {
      ...base,
      lines: { ...base.lines, l1: { ...base.lines.l1, styleId: 'ls' } },
      styles: {
        ...base.styles,
        ls: {
          ...base.styles.ls,
          props: { ...props, singletonDotStyleId: defDotId, multiDotStyleId: defDotId },
        },
      },
    };
  };

  it('keeps a line tagged when its style def named a since-deleted stop-dot style', () => {
    const out = parsed(docWithDefDotId('stop-gone'));
    expect(out.styles.ls.props).toMatchObject({
      singletonDotStyleId: LIVE,
      multiDotStyleId: LIVE,
    });
    // The whole point: the tag survives the load instead of reading "Custom".
    expect(out.lines.l1.styleId).toBe('ls');
  });

  it('repoints a ref that resolves to a def of the wrong kind', () => {
    const out = parsed(docWithDefDotId('y9', [makeStyle('polygon', 'y9', { name: 'Zone' })]));
    expect(out.styles.ls.props).toMatchObject({
      singletonDotStyleId: LIVE,
      multiDotStyleId: LIVE,
    });
    expect(out.lines.l1.styleId).toBe('ls');
  });

  it('leaves a ref that resolves alone — no gratuitous rewrite to the designation', () => {
    // The line wears LIVE but its style says "Filled black"; both resolve, so
    // the def keeps its own choice and the line's mismatch loads as a
    // per-field OVERRIDE — tag and values both survive.
    const doc = docWithDefDotId('stop-filled-black', [
      STOP_DOT_FACTORY_STYLES['stop-filled-black'],
    ]);
    const out = parsed(doc);
    expect(out.styles.ls.props).toMatchObject({
      singletonDotStyleId: 'stop-filled-black',
      multiDotStyleId: 'stop-filled-black',
    });
    expect(out.lines.l1.styleId).toBe('ls');
  });
});

describe('pruneDanglingStyleRefs via parse', () => {
  it('strips styleIds that resolve to nothing or to a def of the wrong kind, keeps good ones', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 's1' }), makeStation({ id: 's2' })],
      lines: [makeLine({ id: 'l1', styleId: 'ghost' })],
      textLabels: [makeTextLabel({ id: 'g1', fontSize: 24, styleId: 'y2' })],
      polygons: [makePolygon({ id: 'p1', styleId: 'y2' })], // textLabel style on a polygon
      routeBullets: [makeRouteBullet({ id: 'b1', styleId: 'ghost' })],
      transfers: [makeTransfer({ id: 'x1', styleId: 'ghost' })],
      styles: [
        makeStyle('textLabel', 'y2', {
          name: 'Heading',
          props: { fontSize: 24 } as Partial<TextLabelStyleProps>,
        }),
      ],
    });
    const out = parsed(doc);
    expect(out.lines.l1.styleId).toBeUndefined();
    expect(out.textLabels.g1.styleId).toBe('y2');
    expect(out.polygons.p1.styleId).toBeUndefined();
    expect(out.routeBullets.b1.styleId).toBeUndefined();
    expect(out.transfers.x1.styleId).toBeUndefined();
  });

  it('strips tags orphaned by a dropped malformed def', () => {
    const doc = {
      ...makeDoc({ textLabels: [makeTextLabel({ id: 'g1', styleId: 'y1' })] }),
      styles: { y1: { id: 'y1', name: '', kind: 'textLabel', props: {} } },
    };
    const out = parsed(doc);
    expect(out.styles).toEqual(DEFAULT_STYLES); // invariant refills the kinds
    expect(out.textLabels.g1.styleId).toBeUndefined();
  });

  it('keeps a tag whose item values diverge from the style (a per-field override)', () => {
    // Divergence is legal: the item pins fontSize against its style, the tag
    // stays, and edits to the style's OTHER fields still reach it.
    const doc = makeDoc({
      textLabels: [makeTextLabel({ id: 'g1', fontSize: 16, styleId: 'y1' })],
      styles: [makeStyle('textLabel', 'y1', { name: 'Heading', props: { fontSize: 24 } })],
    });
    const out = parsed(doc);
    expect(out.textLabels.g1.styleId).toBe('y1');
    expect(out.textLabels.g1.fontSize).toBe(16);
  });

  it("drops a def wearing the reserved name 'Custom' (the dropdown sentinel)", () => {
    const doc = {
      ...makeDoc({}),
      styles: { y1: makeStyle('routeBullet', 'y1', { name: 'Custom' }) },
    };
    expect(parsed(doc).styles).toEqual(DEFAULT_STYLES); // dropped, then refilled
  });
});

describe('bakeLegacyLabelSettings via parse — retired global station-label font', () => {
  // A pre-retirement doc still carrying the five global label* fields, with two
  // stations exercising the per-station relative flags.
  const legacyDoc = (extra: Record<string, unknown> = {}) => {
    const base = makeDoc({
      stations: [makeStation({ id: 's1' }), makeStation({ id: 's2' }), makeStation({ id: 's3' })],
    });
    return {
      ...base,
      stations: {
        s1: base.stations.s1, // plain → matches the seeded Default
        s2: { ...base.stations.s2, labelBold: true }, // +2 weight → Custom
        s3: { ...base.stations.s3, labelItalic: true }, // italic OR → Custom
      },
      labelFontSize: 18,
      labelWeight: 400,
      labelItalic: false,
      labelLeading: 1.5,
      labelTracking: 0,
      ...extra,
    };
  };

  it('bakes each station’s effective typography and drops the global + relative flags', () => {
    const out = parsed(legacyDoc());
    // The five global fields are gone.
    for (const k of [
      'labelFontSize',
      'labelWeight',
      'labelItalic',
      'labelLeading',
      'labelTracking',
    ]) {
      expect(k in out).toBe(false);
    }
    // s1 (plain): global size/leading baked; weight/italic/tracking stay default.
    expect(out.stations.s1.fontSize).toBe(18);
    expect(out.stations.s1.leading).toBe(1.5);
    expect(out.stations.s1.weight).toBeUndefined();
    expect(out.stations.s1.italic).toBeUndefined();
    // s2 (labelBold): weight bumped 400 → 700, flag consumed.
    expect(out.stations.s2.weight).toBe(700);
    expect(out.stations.s2.fontSize).toBe(18);
    expect('labelBold' in out.stations.s2).toBe(false);
    // s3 (labelItalic): italic OR'd true, flag consumed.
    expect(out.stations.s3.italic).toBe(true);
    expect('labelItalic' in out.stations.s3).toBe(false);
  });

  it('seeds the designated default station style from the legacy BASE settings', () => {
    const out = parsed(legacyDoc());
    // Weight is the BASE (un-bumped) 400, not any station's bolded 700.
    expect(out.styles['default-station'].props).toEqual({
      fontSize: 18,
      weight: 400,
      italic: false,
      leading: 1.5,
      tracking: 0,
    });
  });

  it('adopts default-looking stations onto the seeded Default, even on the styles-present path', () => {
    // makeDoc ships a styles record (hadStyles), so the general adoptDefaultStyles
    // is gated off — the bake does the station adoption itself.
    const out = parsed(legacyDoc());
    expect(out.stations.s1.styleId).toBe('default-station'); // matches the seed
    expect(out.stations.s2.styleId).toBeUndefined(); // bold → Custom
    expect(out.stations.s3.styleId).toBeUndefined(); // italic → Custom
  });

  it('bakes + seeds for a pre-styles file too (no styles record)', () => {
    const {
      styles: _s,
      styleDefaults: _sd,
      ...noStyles
    } = makeDoc({
      stations: [makeStation({ id: 's1' })],
    }) as MapDoc;
    const out = parsed({
      ...noStyles,
      labelFontSize: 16,
      labelWeight: 400,
      labelItalic: false,
      labelLeading: 1,
      labelTracking: 0,
    });
    expect(out.styles['default-station'].props).toMatchObject({ fontSize: 16 });
    expect(out.stations.s1.fontSize).toBe(16);
    expect(out.stations.s1.styleId).toBe('default-station');
  });

  it('is a no-op on a post-retirement save (round-trips value-identical)', () => {
    let doc = makeDoc({
      stations: [makeStation({ id: 's1' }), makeStation({ id: 's2' })],
      styles: [
        ...Object.values(DEFAULT_STYLES),
        makeStyle('station', 'big', { props: { fontSize: 20 } }),
      ],
    });
    doc = applyStyleToItem(doc, 'big', 's2'); // s2 tagged, fontSize 20
    const result = parse(serialize(doc));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.doc).toEqual(doc);
  });

  it('leaves an already-customized default station style un-seeded (no clobber)', () => {
    // The designated default station style wears NON-factory props (the user
    // edited the Default). Seeding it from the legacy base settings would erase
    // that customization — the guard must skip the seed and preserve the props.
    const custom = makeStyle('station', 'default-station', {
      name: 'Default',
      props: { fontSize: 30, weight: 700, italic: false, leading: 1.2, tracking: 0 },
    });
    const doc = {
      stations: {},
      styles: { 'default-station': custom },
      styleDefaults: { ...FACTORY_STYLE_DEFAULTS, station: 'default-station' },
      labelFontSize: 18, // a legacy field so the bake actually runs
    } as unknown as Parameters<typeof bakeLegacyLabelSettings>[0];
    const out = bakeLegacyLabelSettings(doc);
    expect(out.styles!['default-station'].props).toEqual(custom.props);
  });
});
