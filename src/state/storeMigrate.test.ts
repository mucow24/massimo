import { describe, it, expect, beforeEach } from 'vitest';
import {
  migrateDoc,
  beginHistoryGroup,
  cancelAppendMode,
  startNewLineAppend,
  useDoc,
  useSelection,
} from './store';
import { useCustomPalettes } from './customPalettes';
import { historyDepth } from './history';
import {
  DEFAULT_DOC,
  DEFAULT_STYLES,
  FACTORY_STYLE_DEFAULTS,
  TEXT_LABEL_COLOR_DEFAULT,
  TEXT_LABEL_DARK_COLOR_DEFAULT,
} from '../model/transforms';
import {
  DEFAULT_STOP_DOT_STYLE_ID,
  DOT_SHAPE_PRESETS,
  NONE_STOP_DOT_STYLE_ID,
  STOP_DOT_FACTORY_STYLES,
} from '../model/dotStyle';
import { captureStyleProps, stylePropsEqual } from '../model/styles';
import {
  makeLine,
  makeStation,
  makeStop,
  makeLabel,
  makeStyle,
  makeTextLabel,
  stationWithStop,
} from '../test/fixtures';
import type {
  DotStyle,
  LineId,
  LineStyleProps,
  MapDoc,
  StationId,
  StopOrientation,
  StyleDef,
  LabelValign,
  Polygon,
  TextLabel,
} from '../model/types';

// Loose view of the migrated doc so we can read fields without fighting the
// branded id types / partial-shape casts.
type AnyDoc = {
  lines?: Record<
    string,
    {
      name?: string;
      service?: string;
      defaultDotShape?: string;
      defaultDotStyle?: DotStyle;
      singletonDotStyle?: DotStyle;
      multiDotStyle?: DotStyle;
      singletonDotSize?: number;
      multiDotSize?: number;
    }
  >;
  stations?: Record<
    string,
    {
      name?: string;
      stops: { orientation: string; dotShape?: string; dotStyle?: DotStyle }[];
      label: { valign: string };
      fontSize?: number;
      weight?: number;
      styleId?: string;
    }
  >;
  polygons?: Record<string, Polygon>;
  backgroundOrder?: string[];
  polygonOrder?: string[];
  svgImageOrder?: string[];
  textLabels?: Record<string, TextLabel>;
  transfers?: Record<string, Record<string, unknown>>;
  styles?: Record<string, { kind?: string; name?: string; props: Record<string, unknown> }>;
  styleDefaults?: Record<string, string>;
  labelWeight?: number;
  labelBold?: boolean;
  labelFontSize?: number;
};
const run = (persisted: unknown, version: number): AnyDoc =>
  migrateDoc(persisted, version) as unknown as AnyDoc;

// The retired global label settings now live on the designated default station
// style (seeded by the v<13 bake).
const stationDefaultProps = (out: AnyDoc): Record<string, unknown> =>
  out.styles![out.styleDefaults!.station].props;

describe('migrateDoc', () => {
  describe('v16 → v17: polygonOrder + svgImageOrder → backgroundOrder', () => {
    const polygons = { p0: {}, p1: {} };
    // A real inline data URI: an image whose href is outside the allowlist is
    // DROPPED (sanitizeImageHrefs), which would take it out of the order these
    // cases are about.
    const svgImages = { i0: { href: 'data:image/svg+xml;base64,PHN2Zy8+' } };

    it('merges the two retired orders, polygons first, and drops the old keys', () => {
      const out = run(
        { polygons, polygonOrder: ['p1', 'p0'], svgImages, svgImageOrder: ['i0'] },
        16,
      );
      // Images sat above polygons before the merge; the concat preserves that,
      // so a rehydrated legacy map renders exactly as it did.
      expect(out.backgroundOrder).toEqual(['p1', 'p0', 'i0']);
      expect('polygonOrder' in out).toBe(false);
      expect('svgImageOrder' in out).toBe(false);
    });

    it('appends records the legacy orders never listed', () => {
      const out = run({ polygons, polygonOrder: [], svgImages, svgImageOrder: [] }, 16);
      expect(out.backgroundOrder).toEqual(['p0', 'p1', 'i0']);
    });

    it('does not run at version >= 17', () => {
      const out = run({ polygons, polygonOrder: ['p1', 'p0'] }, 17);
      // The gate held: the retired key survives untouched rather than merging.
      expect(out.backgroundOrder).toBeUndefined();
      expect(out.polygonOrder).toEqual(['p1', 'p0']);
    });
  });

  describe('v14 → v15: retired segmentLayers strip', () => {
    it('strips segmentLayers from persisted lines', () => {
      const out = run(
        {
          lines: {
            L1: {
              service: 'A',
              name: 'A line',
              stations: ['a', 'b'],
              edges: ['a|b'],
              segmentLayers: { 'a|b': 2 },
            },
          },
        },
        14,
      );
      expect('segmentLayers' in out.lines!.L1).toBe(false);
    });

    it('is reference-stable for lines without the field', () => {
      // Concrete dot sizes, so the unconditional materializing bake (which
      // runs at every version) has nothing to write either.
      const lines = {
        L1: {
          service: 'A',
          name: 'A line',
          stations: ['a', 'b'],
          edges: ['a|b'],
          singletonDotSize: 8,
          multiDotSize: 8,
        },
      };
      const out = run({ lines }, 14);
      expect(out.lines).toBe(lines);
    });
  });

  describe('v0 → v1: line.name backfill', () => {
    it('fills a missing name from the service letter', () => {
      const out = run({ lines: { L1: { service: 'A', stations: [] } } }, 0);
      expect(out.lines!.L1.name).toBe('A line');
    });

    it('leaves an existing name untouched', () => {
      const out = run({ lines: { L1: { service: 'A', name: 'Already', stations: [] } } }, 0);
      expect(out.lines!.L1.name).toBe('Already');
    });
  });

  describe('v1/v3 → v4: station sanitation (orientation + valign)', () => {
    const legacyStation = () => ({
      ...makeStation({ id: 'S' as StationId }),
      stops: [makeStop('L1' as LineId, { orientation: 'up' as unknown as StopOrientation })],
      label: makeLabel({ valign: 'auto' as unknown as LabelValign }),
    });

    it('migrates legacy cardinal orientations and the legacy auto valign', () => {
      const out = run({ stations: { S: legacyStation() } }, 0);
      expect(out.stations!.S.stops[0].orientation).toBe('auto-vertical');
      expect(out.stations!.S.label.valign).toBe('auto-down');
    });

    it('does not run station sanitation at version >= 4', () => {
      const out = run({ stations: { S: legacyStation() } }, 4);
      expect(out.stations!.S.stops[0].orientation).toBe('up');
    });
  });

  describe('v4 → v5: polygon dark colors', () => {
    it('backfills darkFill/darkStroke from the light colors', () => {
      const legacy = {
        vertices: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
        ],
        fill: '#cfe3f2',
        stroke: '#102030',
        strokeWidth: 2,
      } as unknown as Polygon;
      const out = run({ polygons: { P: legacy } }, 0);
      expect(out.polygons!.P.darkFill).toBe('#cfe3f2');
      expect(out.polygons!.P.darkStroke).toBe('#102030');
    });
  });

  describe('v5 → v6: text-label colors', () => {
    it('backfills color/darkColor to the theme defaults', () => {
      const legacy = {
        x: 0,
        y: 0,
        rotation: 0,
        text: 'Hi',
        fontSize: 16,
        weight: 400,
        italic: false,
        align: 'left',
      } as unknown as TextLabel;
      const out = run({ textLabels: { G: legacy } }, 0);
      expect(out.textLabels!.G.color).toBe(TEXT_LABEL_COLOR_DEFAULT);
      expect(out.textLabels!.G.darkColor).toBe(TEXT_LABEL_DARK_COLOR_DEFAULT);
    });
  });

  describe('v2 → v3: labelBold → labelWeight (folded into the default station style)', () => {
    // The v<3 step materializes a global labelWeight; the v<13 bake then folds
    // it into the seeded default station style and drops the doc field.
    it('translates labelBold:true to a Bold (700) default station style, dropping the field', () => {
      const out = run({ labelBold: true }, 0);
      expect(stationDefaultProps(out).weight).toBe(700);
      expect(out.labelWeight).toBeUndefined();
      expect(out.labelBold).toBeUndefined();
    });

    it('translates labelBold:false to a Regular (400) default station style', () => {
      expect(stationDefaultProps(run({ labelBold: false }, 0)).weight).toBe(400);
    });

    it('keeps an explicit labelWeight when both fields are present', () => {
      const out = run({ labelBold: true, labelWeight: 300 }, 0);
      expect(stationDefaultProps(out).weight).toBe(300);
      expect(out.labelWeight).toBeUndefined();
      expect(out.labelBold).toBeUndefined();
    });

    it('does not translate labelBold at version >= 3', () => {
      // At v>=3 the labelBold→labelWeight step is skipped; labelBold is not a
      // legacy label FONT field, so the v<13 bake leaves it untouched too.
      const out = run({ labelBold: true }, 3);
      expect(out.labelWeight).toBeUndefined();
      expect(out.labelBold).toBe(true);
    });
  });

  describe('v6 → v7: dotShape preset ids → DotStyle objects', () => {
    const stationWithDotShape = (dotShape?: string) => ({
      ...makeStation({ id: 'S' as StationId }),
      stops: [dotShape ? { ...makeStop('L1' as LineId), dotShape } : makeStop('L1' as LineId)],
    });

    it('converts a per-stop dotShape preset id to its style object and strips the key', () => {
      const out = run({ stations: { S: stationWithDotShape('filled-black-diamond') } }, 6);
      const stop = out.stations!.S.stops[0];
      expect(stop.dotStyle).toEqual(DOT_SHAPE_PRESETS['filled-black-diamond']);
      expect('dotShape' in stop).toBe(false);
    });

    it("converts a line's defaultDotShape and bakes it into both split fields", () => {
      const out = run(
        {
          lines: {
            L1: { service: 'A', name: 'A line', stations: [], defaultDotShape: 'open-white' },
          },
        },
        6,
      );
      // v<7 converts the preset id → defaultDotStyle; v<18 then splits it.
      expect(out.lines!.L1.singletonDotStyle).toEqual(DOT_SHAPE_PRESETS['open-white']);
      expect(out.lines!.L1.multiDotStyle).toEqual(DOT_SHAPE_PRESETS['open-white']);
      expect('defaultDotShape' in out.lines!.L1).toBe(false);
      expect('defaultDotStyle' in out.lines!.L1).toBe(false);
    });

    it("converts a legacy 'none' to the invisible style", () => {
      const out = run({ stations: { S: stationWithDotShape('none') } }, 6);
      expect(out.stations!.S.stops[0].dotStyle).toEqual(DOT_SHAPE_PRESETS['none']);
    });

    it('leaves the dot fields alone when no legacy dot fields exist', () => {
      // The v<11 default-adoption pass now tags default-looking STATIONS too (a
      // default station matches the factory 'station' style), so the whole-doc
      // reference pin no longer holds; this pins that the dot CONVERSION itself
      // is a no-op — the stops array is untouched.
      const input = {
        stations: { S: stationWithDotShape() },
        lines: { L1: { service: 'A', name: 'A line', stations: [] } },
      };
      const out = run(input, 6);
      expect(out.stations!.S.stops).toBe(input.stations.S.stops);
      expect('defaultDotShape' in out.lines!.L1).toBe(false);
      // The v<19 stopDot-library bake materializes + tags each line's split dot
      // defaults with the ⭐ default (dot appearance is per-line now).
      const l1 = out.lines!.L1 as { singletonDotStyleId?: string; multiDotStyleId?: string };
      expect(l1.singletonDotStyleId).toBe(DEFAULT_STOP_DOT_STYLE_ID);
      expect(l1.multiDotStyleId).toBe(DEFAULT_STOP_DOT_STYLE_ID);
    });

    it('does not convert at version >= 7', () => {
      const out = run({ stations: { S: stationWithDotShape('filled-white') } }, 7);
      const stop = out.stations!.S.stops[0];
      expect(stop.dotShape).toBe('filled-white');
      expect(stop.dotStyle).toBeUndefined();
    });
  });

  describe('v17 → v18: split the single default dot style/size', () => {
    it('bakes a modern-era line defaultDotStyle/defaultDotSize into both split fields', () => {
      const out = run(
        {
          lines: {
            L1: {
              service: 'A',
              name: 'A line',
              stations: [],
              edges: [],
              defaultDotStyle: DOT_SHAPE_PRESETS['open-white'],
              defaultDotSize: 12,
            },
          },
        },
        17,
      );
      expect(out.lines!.L1.singletonDotStyle).toEqual(DOT_SHAPE_PRESETS['open-white']);
      expect(out.lines!.L1.multiDotStyle).toEqual(DOT_SHAPE_PRESETS['open-white']);
      expect(out.lines!.L1.singletonDotSize).toBe(12);
      expect(out.lines!.L1.multiDotSize).toBe(12);
      expect('defaultDotStyle' in out.lines!.L1).toBe(false);
      expect('defaultDotSize' in out.lines!.L1).toBe(false);
    });

    it('does not touch the split fields at version >= 18', () => {
      const out = run(
        {
          lines: {
            L1: {
              service: 'A',
              name: 'A line',
              stations: [],
              edges: [],
              defaultDotStyle: DOT_SHAPE_PRESETS['open-white'],
            },
          },
        },
        18,
      );
      // The gate is closed: the legacy field rides along un-split (a v18 doc
      // never has it, so this only proves the gate, not a real scenario).
      expect('singletonDotStyle' in out.lines!.L1).toBe(false);
    });
  });

  describe('v20 → v21: backfill dot stroke alignment', () => {
    // A dot style as persisted BEFORE strokeAlign existed (the field omitted).
    const legacyDot = () => {
      const { strokeAlign: _drop, ...rest } = DOT_SHAPE_PRESETS['filled-black-white-stroke'];
      return rest;
    };
    // A pre-v19 styles record — the other kinds present, but NO stopDot library
    // yet — so bakeStopDotLibrary actually runs its value-match (it early-returns
    // when styles is absent or already carries a stopDot).
    const stylesNoStopDot = () =>
      Object.fromEntries(Object.entries(DEFAULT_STYLES).filter(([, d]) => d.kind !== 'stopDot'));

    it("backfills 'center' onto every dot-style home", () => {
      const out = run(
        {
          stations: {
            S: {
              ...makeStation({ id: 'S' as StationId }),
              stops: [{ ...makeStop('L1' as LineId), dotStyle: legacyDot() }],
            },
          },
          lines: {
            L1: {
              service: 'A',
              name: 'A line',
              stations: [],
              edges: [],
              singletonDotStyle: legacyDot(),
              multiDotStyle: legacyDot(),
            },
          },
          styles: { sd: { id: 'sd', name: 'Custom', kind: 'stopDot', props: legacyDot() } },
        },
        20,
      );
      expect(out.stations!.S.stops[0].dotStyle!.strokeAlign).toBe('center');
      expect(out.lines!.L1.singletonDotStyle!.strokeAlign).toBe('center');
      expect(out.lines!.L1.multiDotStyle!.strokeAlign).toBe('center');
      expect(out.styles!.sd.props.strokeAlign).toBe('center');
    });

    it('does not backfill at version >= 21', () => {
      const out = run(
        {
          lines: {
            L1: {
              service: 'A',
              name: 'A line',
              stations: [],
              edges: [],
              singletonDotStyle: legacyDot(),
            },
          },
        },
        21,
      );
      expect('strokeAlign' in out.lines!.L1.singletonDotStyle!).toBe(false);
    });

    // Regression: the earlier library/default bakes value-match RAW legacy dot
    // styles (no strokeAlign) against the factory presets (which now carry
    // strokeAlign). Those matches run BEFORE this change's v<21 backfill, so
    // dotStylesEqual must treat an absent strokeAlign as 'center' or a v7..18 doc's
    // dots get left untagged/Custom instead of linked to the stopDot library.
    it('tags a preset-matching legacy split dot style through the v19 library bake', () => {
      const out = run(
        {
          styles: stylesNoStopDot(),
          lines: {
            L1: {
              service: 'A',
              name: 'A line',
              stations: [],
              edges: [],
              singletonDotStyle: legacyDot(),
              multiDotStyle: legacyDot(),
            },
          },
        },
        18,
      );
      const l1 = out.lines!.L1 as { singletonDotStyleId?: string; multiDotStyleId?: string };
      expect(l1.singletonDotStyleId).toBe('stop-filled-black-white-stroke');
      expect(l1.multiDotStyleId).toBe('stop-filled-black-white-stroke');
    });

    it('drops a legacy defaultDotStyle at the filled-black default despite the added field', () => {
      // A v<18 line carries the retired single defaultDotStyle. If it equals the
      // filled-black default it must DROP (not materialize explicit split fields),
      // then the v19 bake tags it via the default fallback — so the drop-at-default
      // compare must ignore the absent strokeAlign.
      const { strokeAlign: _omit, ...rawFilledBlack } = DOT_SHAPE_PRESETS['filled-black'];
      const out = run(
        {
          styles: stylesNoStopDot(),
          lines: {
            L1: {
              service: 'A',
              name: 'A line',
              stations: [],
              edges: [],
              defaultDotStyle: rawFilledBlack,
            },
          },
        },
        17,
      );
      const l1 = out.lines!.L1 as { singletonDotStyleId?: string };
      expect(l1.singletonDotStyleId).toBe('stop-filled-black');
    });
  });

  describe('v21 → v22: heal line style defs that predate the covered line end', () => {
    // A line def as persisted BEFORE `endStyle` was a covered field: the file
    // loader heals this (sanitizeStyleProps), but the rehydrate path had no
    // gate, so a persisted def could keep arriving without it.
    const { endStyle: _drop, ...oldLineProps } = DEFAULT_STYLES['default-line']
      .props as LineStyleProps;
    // L1 wears the def and, like every pre-feature line, carries no end of its
    // own — so it paints the square the heal writes onto the def.
    const persisted = () => ({
      lines: { L1: { service: 'A', name: 'A line', stations: [], edges: [], styleId: 'ln' } },
      styles: {
        ...STOP_DOT_FACTORY_STYLES,
        ln: { id: 'ln', name: 'My line', kind: 'line', props: oldLineProps },
      },
      styleDefaults: { ...FACTORY_STYLE_DEFAULTS, line: 'ln' },
    });

    it("backfills 'square' onto a line def that predates the covered field", () => {
      const props = run(persisted(), 21).styles!.ln.props as unknown as LineStyleProps;
      expect(props.endStyle).toBe('square');
    });

    it('leaves the tagged wearer matching its healed style', () => {
      // The point of the heal: "tagged ⇒ matches" is what keeps the Styles
      // panel from reading every legacy wearer as detached.
      const out = migrateDoc(persisted(), 21) as unknown as MapDoc;
      const captured = captureStyleProps(out, 'line', 'L1' as LineId)!;
      expect(stylePropsEqual('line', captured, out.styles.ln.props)).toBe(true);
    });

    it('leaves a def that already carries an end style alone', () => {
      const doc = persisted();
      doc.styles.ln.props = { ...oldLineProps, endStyle: 'round' } as LineStyleProps;
      const props = run(doc, 21).styles!.ln.props as unknown as LineStyleProps;
      expect(props.endStyle).toBe('round');
    });

    it('does not backfill at version >= 22', () => {
      expect('endStyle' in run(persisted(), 22).styles!.ln.props).toBe(false);
    });
  });

  describe('v7 → v8: legacy inline bullet syntax', () => {
    const legacyDoc = () => ({
      stations: { S: { ...makeStation({ id: 'S' as StationId }), name: '<A> North |lit|' } },
      textLabels: { g1: makeTextLabel({ id: 'g1', text: 'Ride <B> or <<C>>' }) },
    });

    it('rewrites angle tokens and escapes literal pipes in names and label texts', () => {
      const out = run(legacyDoc(), 7);
      expect(out.stations!.S.name).toBe('|A| North \\|lit|');
      expect(out.textLabels!.g1.text).toBe('Ride |B| or ||C||');
    });

    it('does not rewrite at version >= 8', () => {
      const out = run(legacyDoc(), 8);
      expect(out.stations!.S.name).toBe('<A> North |lit|');
      expect(out.textLabels!.g1.text).toBe('Ride <B> or <<C>>');
    });
  });

  describe('v8 → v9: fold polygon fillOpacity into the fill alpha', () => {
    const legacyPoly = (extra: Partial<Polygon> & { fillOpacity?: number }) =>
      ({
        id: 'P',
        vertices: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
        ],
        fill: '#112233',
        stroke: '#000000',
        darkFill: '#445566',
        darkStroke: '#000000',
        strokeWidth: 1,
        ...extra,
      }) as unknown as Polygon;

    it('folds fillOpacity 50 into an 80 alpha on BOTH fill and darkFill, dropping the field', () => {
      const out = run({ polygons: { P: legacyPoly({ fillOpacity: 50 }) } }, 8);
      const p = out.polygons!.P;
      expect(p.fill).toBe('#11223380');
      expect(p.darkFill).toBe('#44556680');
      expect('fillOpacity' in p).toBe(false);
    });

    it('drops an opaque fillOpacity 100 without adding an alpha suffix', () => {
      const out = run({ polygons: { P: legacyPoly({ fillOpacity: 100 }) } }, 8);
      const p = out.polygons!.P;
      expect(p.fill).toBe('#112233');
      expect(p.darkFill).toBe('#445566');
      expect('fillOpacity' in p).toBe(false);
    });

    it('leaves a polygon without fillOpacity untouched (same collection reference)', () => {
      // Non-default colors, so the v<11 adoption skips it too — the polygons
      // record must pass through by reference.
      const input = { polygons: { P: legacyPoly({}) } };
      const out = run(input, 8);
      expect(out.polygons).toBe(input.polygons);
    });

    it('does not fold at version >= 9', () => {
      const out = run({ polygons: { P: legacyPoly({ fillOpacity: 50 }) } }, 9);
      const p = out.polygons!.P;
      // Field survives untouched — a v9 doc predates no fold.
      expect((p as unknown as { fillOpacity?: number }).fillOpacity).toBe(50);
      expect(p.fill).toBe('#112233');
    });
  });

  describe('v9 → v10: bake retired doc-level transfer settings into overrides', () => {
    const transfer = (extra: Record<string, unknown> = {}) => ({
      id: 'x1',
      a: { stationId: 's1', lineId: null },
      b: { stationId: 's2', lineId: null },
      ...extra,
    });

    it('materializes a legacy setting onto tracking transfers and drops the fields', () => {
      const out = run(
        {
          transfers: { x1: transfer() },
          transferThickness: 7,
          transferColor: '#abcdef',
          transferStrokeWidth: 0,
          transferStrokeColor: '#ffffff',
        } as Record<string, unknown>,
        9,
      );
      const t = (out.transfers as Record<string, Record<string, unknown>>).x1;
      expect(t.thickness).toBe(7);
      // The legacy single color becomes a day/night pair (both halves).
      expect(t.color).toEqual({ day: '#abcdef', night: '#abcdef' });
      // Settings equal to the constants leave no override behind.
      expect('strokeWidth' in t).toBe(false);
      expect('strokeColor' in t).toBe(false);
      for (const key of [
        'transferThickness',
        'transferColor',
        'transferStrokeWidth',
        'transferStrokeColor',
      ]) {
        expect(key in out).toBe(false);
      }
    });

    it('keeps explicit overrides over the legacy setting; collapses ones equal to the constants', () => {
      const out = run(
        {
          transfers: { x1: transfer({ thickness: 5 }), x2: transfer({ id: 'x2', thickness: 2 }) },
          transferThickness: 7,
        } as Record<string, unknown>,
        9,
      );
      const transfers = out.transfers as Record<string, Record<string, unknown>>;
      expect(transfers.x1.thickness).toBe(5); // explicit override wins
      expect('thickness' in transfers.x2).toBe(false); // 2 == constant → collapsed
    });

    it('materializes no overrides for docs that never persisted the settings', () => {
      const input = { transfers: { x1: transfer() } };
      const out = run(input, 9);
      const t = (out.transfers as Record<string, Record<string, unknown>>).x1;
      // The bake itself skipped (no legacy fields) — no override appears…
      expect('thickness' in t).toBe(false);
      // …and the only change is the v<11 adoption tag (factory-look transfer).
      expect(t.styleId).toBe('default-transfer');
    });

    it('does not bake at version >= 10', () => {
      const out = run(
        { transfers: { x1: transfer() }, transferThickness: 7 } as Record<string, unknown>,
        10,
      );
      const t = (out.transfers as Record<string, Record<string, unknown>>).x1;
      expect('thickness' in t).toBe(false);
    });

    it('seeds the factory Default transfer style from the legacy settings', () => {
      // Pre-styles docs get the factory Defaults materialized in the same
      // v<10 pass; the bake then retargets the transfer one so newly drawn
      // transfers keep the old map-wide look (existing transfers got theirs
      // as overrides).
      const out = run(
        { transfers: { x1: transfer() }, transferThickness: 7 } as Record<string, unknown>,
        9,
      ) as unknown as { styles: Record<string, StyleDef> };
      const def = Object.values(out.styles).find(
        (d) => d.kind === 'transfer' && d.name === 'Default',
      );
      expect(def?.props).toMatchObject({
        thickness: 7,
        color: { day: '#000000', night: '#000000' },
      });
    });

    it('seeds the designated default even under a non-factory id', () => {
      // A v9 doc whose only transfer style is the user's own 'Default' (id
      // 'mine', factory props): the invariant pass designates it by name, and
      // the bake must seed THAT def — not a hardcoded factory key.
      const styles = { mine: makeStyle('transfer', 'mine', { name: 'Default' }) };
      const out = run(
        { styles, transferThickness: 7 } as Record<string, unknown>,
        9,
      ) as unknown as { styles: Record<string, StyleDef> };
      expect((out.styles.mine.props as { thickness: number }).thickness).toBe(7);
    });

    it('leaves a user-customized Default transfer style alone', () => {
      const custom = makeStyle('transfer', 'default-transfer', {
        name: 'Default',
        props: { thickness: 9 },
      });
      const out = run(
        { styles: { 'default-transfer': custom }, transferThickness: 7 } as Record<string, unknown>,
        9,
      ) as unknown as { styles: Record<string, StyleDef> };
      expect((out.styles['default-transfer'].props as { thickness: number }).thickness).toBe(9);
    });
  });

  describe('v12 → v13: transfer colors gain day/night halves', () => {
    const xfer = (extra: Record<string, unknown> = {}) => ({
      id: 'x1',
      a: { stationId: 's1', lineId: null },
      b: { stationId: 's2', lineId: null },
      ...extra,
    });

    it('wraps legacy single-color per-transfer overrides into {day, night} pairs', () => {
      const out = run(
        {
          transfers: {
            x1: xfer({ color: '#ff0080', strokeColor: '#abcdef' }),
            x2: { ...xfer(), id: 'x2' }, // tracking — no color overrides
          },
        } as Record<string, unknown>,
        12,
      );
      const transfers = out.transfers as Record<string, Record<string, unknown>>;
      expect(transfers.x1.color).toEqual({ day: '#ff0080', night: '#ff0080' });
      expect(transfers.x1.strokeColor).toEqual({ day: '#abcdef', night: '#abcdef' });
      // A tracking transfer stays clean — no color key is materialized.
      expect('color' in transfers.x2).toBe(false);
      expect('strokeColor' in transfers.x2).toBe(false);
    });

    it('wraps transfer StyleDef props too, leaving them concrete pairs', () => {
      const styles = {
        t1: {
          id: 't1',
          name: 'Link',
          kind: 'transfer',
          props: { thickness: 6, color: '#111111', strokeWidth: 2, strokeColor: '#eeeeee' },
        },
      };
      const out = run({ styles } as Record<string, unknown>, 12) as unknown as {
        styles: Record<string, StyleDef>;
      };
      expect(out.styles.t1.props).toMatchObject({
        thickness: 6,
        color: { day: '#111111', night: '#111111' },
        strokeWidth: 2,
        strokeColor: { day: '#eeeeee', night: '#eeeeee' },
      });
    });

    it('leaves an already-day/night doc untouched at version >= 13', () => {
      const out = run(
        {
          transfers: { x1: xfer({ color: { day: '#ff0080', night: '#003300' } }) },
        } as Record<string, unknown>,
        13,
      );
      const t = (out.transfers as Record<string, Record<string, unknown>>).x1;
      expect(t.color).toEqual({ day: '#ff0080', night: '#003300' });
    });
  });

  describe('v25 → v26: line casing colors gain day/night halves', () => {
    // Values here are lowercase because the rehydrate path only ever sees
    // app-written data, which the setters already canonicalized — the same
    // reason the transfer conversion above copies its input verbatim rather
    // than re-normalizing it. Hand-edited case is the FILE path's problem, and
    // `sanitizeLineStroke` lowercases there.
    it('wraps a legacy single-color casing on lines AND line style defs together', () => {
      const out = run(
        {
          lines: {
            L1: { id: 'L1', service: '1', name: 'One', color: '#111111', stations: [], edges: [] },
            L2: {
              id: 'L2',
              service: '2',
              name: 'Two',
              color: '#222222',
              stations: [],
              edges: [],
              strokeWidth: 2,
              strokeColor: '#abcdef',
              styleId: 'y1',
            },
          },
          styles: {
            y1: {
              id: 'y1',
              name: 'Cased',
              kind: 'line',
              props: {
                singletonDotStyleId: 'stop-filled-black',
                multiDotStyleId: 'stop-filled-black',
                singletonDotSize: 8,
                multiDotSize: 8,
                width: 14,
                curveRadius: 24,
                endStyle: 'square',
                strokeWidth: 2,
                strokeColor: '#abcdef',
              },
            },
          },
        } as Record<string, unknown>,
        25,
      );
      const lines = out.lines as Record<string, Record<string, unknown>>;
      expect(lines.L2.strokeColor).toEqual({ day: '#abcdef', night: '#abcdef' });
      // A casing-less line stays clean — no key is materialized.
      expect('strokeColor' in lines.L1).toBe(false);
      const styles = out.styles as unknown as Record<string, StyleDef>;
      expect((styles.y1.props as { strokeColor: unknown }).strokeColor).toEqual({
        day: '#abcdef',
        night: '#abcdef',
      });
      // Line and def converted together, so the wearer is still tagged.
      expect(lines.L2.styleId).toBe('y1');
    });

    it("leaves the 'line' sentinel alone — it is not a color", () => {
      const out = run(
        {
          lines: {
            L1: {
              id: 'L1',
              service: '1',
              name: 'One',
              color: '#111111',
              stations: [],
              edges: [],
              strokeWidth: 2,
              strokeColor: 'line',
            },
          },
        } as Record<string, unknown>,
        25,
      );
      expect((out.lines as Record<string, Record<string, unknown>>).L1.strokeColor).toBe('line');
    });

    // Run INSIDE the gate (v25), not past it: at 26 the block never executes,
    // so the pass would prove nothing about the conversion — only that a
    // migration which never ran left the data alone. A pair reaching the
    // converter must come back untouched, including the half that equals the
    // white default (the collapse is the setter's job, not the migration's).
    it('is a no-op on a pair that is already converted', () => {
      const out = run(
        {
          lines: {
            L1: {
              id: 'L1',
              service: '1',
              name: 'One',
              color: '#111111',
              stations: [],
              edges: [],
              strokeWidth: 2,
              strokeColor: { day: '#ffffff', night: '#000000' },
            },
          },
        } as Record<string, unknown>,
        25,
      );
      expect((out.lines as Record<string, Record<string, unknown>>).L1.strokeColor).toEqual({
        day: '#ffffff',
        night: '#000000',
      });
    });
  });

  describe('v9 → v10: style-def hygiene (round-1 docs)', () => {
    it('injects the factory Defaults into a round-1 doc with an explicit styles record', () => {
      const out = run({ styles: {} } as Record<string, unknown>, 9) as unknown as {
        styles: Record<string, StyleDef>;
      };
      // The six per-kind item Defaults (the stopDot library is seeded separately
      // by the v<19 bake and asserted below).
      const names = Object.values(out.styles)
        .filter((d) => d.kind !== 'stopDot')
        .map((d) => d.name);
      expect(names).toEqual(['Default', 'Default', 'Default', 'Default', 'Default', 'Default']);
      expect(Object.values(out.styles).some((d) => d.kind === 'stopDot')).toBe(true);
    });

    it('keeps round-1 width/leading/tracking keys — the fields are covered again', () => {
      // Round 1 covered layout, round 2 dropped it, and it is covered once
      // more: values a round-1 def stored survive the rehydrate verbatim (and
      // pre-empt the wearer-average backfill for those fields).
      const staleDef = {
        id: 'y1',
        name: 'Heading',
        kind: 'textLabel',
        props: {
          color: '#111111',
          darkColor: '#ffffff',
          fontSize: 24,
          weight: 700,
          italic: false,
          align: 'left',
          width: 120,
          leading: 1.5,
          tracking: 0.05,
        },
      };
      const out = run({ styles: { y1: staleDef } } as Record<string, unknown>, 9) as unknown as {
        styles: Record<string, StyleDef>;
      };
      expect(out.styles.y1.props).toEqual({
        color: '#111111',
        darkColor: '#ffffff',
        fontSize: 24,
        weight: 700,
        italic: false,
        align: 'left',
        width: 120,
        leading: 1.5,
        tracking: 0.05,
      });
    });

    it('does not inject a Default for a kind that already has one (kept by id or name)', () => {
      const mine = makeStyle('textLabel', 'y1', { name: 'Default', props: { fontSize: 30 } });
      const out = run({ styles: { y1: mine } } as Record<string, unknown>, 9) as unknown as {
        styles: Record<string, StyleDef>;
      };
      const labelDefaults = Object.values(out.styles).filter(
        (d) => d.kind === 'textLabel' && d.name === 'Default',
      );
      expect(labelDefaults).toHaveLength(1);
      expect((labelDefaults[0].props as { fontSize: number }).fontSize).toBe(30);
    });

    it('does not touch canonical styles at version >= 10', () => {
      const input = { styles: DEFAULT_STYLES, styleDefaults: FACTORY_STYLE_DEFAULTS };
      const out = run(input as Record<string, unknown>, 12);
      expect(out).toBe(input);
    });

    it('refills an emptied styles record at ANY version (invariant, not migration)', () => {
      // ≥ 1 style per kind is a structural invariant like the palette check,
      // not a schema step — a tampered doc gets the factory set back even at
      // the current version.
      const out = run({ styles: {} } as Record<string, unknown>, 12) as unknown as {
        styles: Record<string, StyleDef>;
        styleDefaults: Record<string, string>;
      };
      expect(
        Object.values(out.styles)
          .filter((d) => d.kind !== 'stopDot')
          .map((d) => d.name),
      ).toEqual(['Default', 'Default', 'Default', 'Default', 'Default', 'Default']);
      expect(Object.values(out.styles).some((d) => d.kind === 'stopDot')).toBe(true);
      expect(out.styleDefaults).toEqual(FACTORY_STYLE_DEFAULTS);
    });
  });

  describe('v10 → v11: adopt default-looking items into the Default styles', () => {
    it('tags untagged matching items so the Default editors act on the whole legacy map', () => {
      const out = run(
        {
          textLabels: {
            g1: makeTextLabel({ id: 'g1' }), // factory look → adopted
            g2: makeTextLabel({ id: 'g2', fontSize: 24 }), // diverged → stays Custom
          },
        } as Record<string, unknown>,
        9,
      ) as unknown as { textLabels: Record<string, { styleId?: string }> };
      expect(out.textLabels.g1.styleId).toBe('default-textLabel');
      expect(out.textLabels.g2.styleId).toBeUndefined();
    });

    it('a legacy transfer baked from the doc settings adopts the SEEDED Default', () => {
      // transferThickness 7 → Default transfer style seeded to 7 AND the
      // tracking transfer baked to override 7 → they match → adopted. Editing
      // the Default's thickness afterwards moves every such transfer.
      const out = run(
        {
          transfers: {
            x1: {
              id: 'x1',
              a: { stationId: 's1', lineId: null },
              b: { stationId: 's2', lineId: null },
            },
          },
          transferThickness: 7,
        } as Record<string, unknown>,
        9,
      ) as unknown as { transfers: Record<string, Record<string, unknown>> };
      expect(out.transfers.x1.thickness).toBe(7);
      expect(out.transfers.x1.styleId).toBe('default-transfer');
    });

    it('adopts for v10 docs too (migrated before adoption shipped)', () => {
      const out = run(
        {
          styles: DEFAULT_STYLES,
          textLabels: { g1: makeTextLabel({ id: 'g1' }) },
        } as Record<string, unknown>,
        10,
      ) as unknown as { textLabels: Record<string, { styleId?: string }> };
      expect(out.textLabels.g1.styleId).toBe('default-textLabel');
    });

    it('does not adopt at version >= 11', () => {
      const input = {
        styles: DEFAULT_STYLES,
        styleDefaults: FACTORY_STYLE_DEFAULTS,
        textLabels: { g1: makeTextLabel({ id: 'g1' }) },
      };
      const out = run(input as Record<string, unknown>, 11);
      expect(out).toBe(input);
    });
  });

  describe('v11 → v12: explicit default designations (styleDefaults)', () => {
    it("backfills styleDefaults for pre-designation storage, preferring the kind's style named 'Default'", () => {
      // A v11 doc where the user redefined + upserted their own textLabel
      // "Default" (id y1) — the designation must land on IT, not on the
      // factory id the persist merge would have guessed.
      const { 'default-textLabel': _factory, ...rest } = DEFAULT_STYLES;
      const styles = {
        ...rest,
        y1: makeStyle('textLabel', 'y1', { name: 'Default', props: { fontSize: 30 } }),
        y2: makeStyle('textLabel', 'y2', { name: 'Alpha' }),
      };
      const out = run({ styles } as Record<string, unknown>, 11) as unknown as {
        styleDefaults: Record<string, string>;
      };
      expect(out.styleDefaults.textLabel).toBe('y1');
      expect(out.styleDefaults.line).toBe('default-line');
    });

    it('repairs a dangling designation without disturbing valid ones', () => {
      const styles = {
        ...DEFAULT_STYLES,
        y1: makeStyle('textLabel', 'y1', { name: 'Alpha' }),
      };
      const out = run(
        {
          styles,
          styleDefaults: { ...FACTORY_STYLE_DEFAULTS, textLabel: 'ghost', polygon: 'y1' },
        } as Record<string, unknown>,
        12,
      ) as unknown as { styleDefaults: Record<string, string> };
      // Dangling → the kind's 'Default'; wrong kind (y1 is a textLabel) → same.
      expect(out.styleDefaults.textLabel).toBe('default-textLabel');
      expect(out.styleDefaults.polygon).toBe('default-polygon');
      expect(out.styleDefaults.line).toBe('default-line');
    });
  });

  describe('version handling', () => {
    it('treats a missing/corrupt version as v0 so every migration runs', () => {
      const out = run(
        { lines: { L1: { service: 'A', stations: [] } } },
        undefined as unknown as number,
      );
      expect(out.lines!.L1.name).toBe('A line');
    });

    it('returns the input as-is when already at the current version', () => {
      // `width`, the split `singletonDotSize`/`multiDotSize`, and per-stop
      // `dotSize` ride along untouched — each is optional with a runtime
      // default, so none needs a migration (and adding one would break this
      // reference-equality pin).
      const input = {
        stations: {
          S: {
            ...makeStation({ id: 'S' as StationId }),
            stops: [{ ...makeStop('L1' as LineId), dotSize: 16 }],
          },
        },
        lines: {
          L1: {
            service: 'A',
            name: 'A line',
            stations: ['S'],
            edges: [],
            width: 21,
            singletonDotSize: 12,
            multiDotSize: 18,
          },
        },
      };
      // Read the live persist version — the original literal 18 was current
      // when this was written, and every bump since has meant this ran the
      // 19..N migrations rather than the no-migration path it names.
      const out = run(input, useDoc.persist.getOptions().version ?? -1);
      // No migration applies at the current version → same reference passes
      // straight through. (No `styles` key either, so the style-invariant
      // pass leaves it alone.)
      expect(out).toBe(input);
    });

    it('backfills line edges from the legacy consecutive-pairs order (v<14)', () => {
      const out = run(
        { lines: { L1: { service: 'A', name: 'A line', stations: ['s1', 's2', 's3'] } } },
        13,
      );
      const line = out.lines!.L1 as { edges?: string[]; stations?: string[] };
      expect(line.edges).toEqual(['s1|s2', 's2|s3']);
      // Membership order (display) is untouched by the backfill.
      expect(line.stations).toEqual(['s1', 's2', 's3']);
    });

    it('drops a style def whose props is a primitive, exactly as the file path does', () => {
      // Nothing catches a throw out of migrateDoc — zustand's `migrate` hook
      // has no shell of its own, so a raw TypeError here white-screens the app
      // on the persisted doc that caused it, with no way back in. And a def
      // that survives with primitive props is a slower version of the same
      // crash: every reader indexes into props. The file path drops such a def
      // in `sanitizeStyles` (which this path never runs), so the rehydrate
      // drops it in `ensureStyleInvariants` — where both paths meet — leaving
      // the emptied kind to be refilled with its factory Default.
      for (const props of ['oops', 7, true]) {
        const label = `props = ${JSON.stringify(props)}`;
        const out = run(
          {
            lines: { L1: { service: 'A', name: 'A line', stations: [], edges: [] } },
            styles: { y2: { id: 'y2', kind: 'line', name: 'Primitive', props } },
          },
          0,
        );
        expect(out.styles!.y2, label).toBeUndefined();
        const lineDefault = out.styles![out.styleDefaults!.line];
        expect(lineDefault.name, label).toBe('Default');
        expect(lineDefault.kind, label).toBe('line');
      }
    });

    it('backfills line edges even for a doc already stamped at the current version', () => {
      // Regression: an intermediate build bumped the persist version to 14 and
      // re-saved docs BEFORE lines were writing `edges`. Those docs are stranded
      // at v14 with no edges, and a `v < 14` gate can never recover them (14 is
      // not < 14) — the renderer then crashes on `ln.edges.join(...)`. The
      // backfill must therefore be a non-gated invariant, firing at v14 too.
      const out = run(
        { lines: { L1: { service: 'A', name: 'A line', stations: ['s1', 's2', 's3'] } } },
        14,
      );
      const line = out.lines!.L1 as { edges?: string[]; stations?: string[] };
      expect(line.edges).toEqual(['s1|s2', 's2|s3']);
      expect(line.stations).toEqual(['s1', 's2', 's3']);
    });
  });

  describe('v13 → v14: retire doc-level station-label font settings', () => {
    it('strips the premature v<11 Default tag so a bolded legacy station ends up Custom', () => {
      // At v<11 adoptDefaultStyles tags EVERY field-less station Default (its
      // effective props equal the factory). The v<13 bake must strip that tag
      // and re-evaluate — a bolded station (weight bumped +2) diverges from the
      // base-seeded Default, so it must NOT stay tagged. Deleting the strip
      // would silently leave it tagged-but-mismatched (breaks tagged ⇒ matches).
      const out = run(
        {
          stations: { S: { ...makeStation({ id: 'S' as StationId }), labelBold: true } },
          labelFontSize: 12,
          labelWeight: 400,
          labelItalic: false,
          labelLeading: 1,
          labelTracking: 0,
        } as Record<string, unknown>,
        0,
      );
      expect(out.stations!.S.weight).toBe(700); // 400 bumped two steps
      expect(out.stations!.S.styleId).toBeUndefined(); // NOT left tagged Default
      expect('labelFontSize' in out).toBe(false);
      expect('labelWeight' in out).toBe(false);
    });

    it('adopts a default-looking legacy station onto the seeded Default (weight un-bumped)', () => {
      const out = run(
        {
          stations: { S: makeStation({ id: 'S' as StationId }) }, // no bold → plain
          labelFontSize: 18,
          labelWeight: 400,
          labelItalic: false,
          labelLeading: 1,
          labelTracking: 0,
        } as Record<string, unknown>,
        0,
      );
      expect(out.stations!.S.fontSize).toBe(18);
      expect(out.stations!.S.styleId).toBe('default-station');
      expect(stationDefaultProps(out)).toMatchObject({ fontSize: 18, weight: 400 });
    });

    it('does not bake at version >= 14', () => {
      const out = run(
        {
          stations: { S: makeStation({ id: 'S' as StationId }) },
          labelFontSize: 18,
          styles: DEFAULT_STYLES,
          styleDefaults: FACTORY_STYLE_DEFAULTS,
        } as Record<string, unknown>,
        14,
      );
      expect(out.stations!.S.fontSize).toBeUndefined(); // not baked
    });
  });

  describe('v15 → v16: retire the doc-level curveRadius', () => {
    const linesIn = () => ({
      L1: { service: 'A', name: 'A line', stations: ['s1', 's2'], edges: ['s1|s2'] },
      L2: { service: 'B', name: 'B line', stations: ['s1'], edges: [] },
    });
    const radiusOf = (out: AnyDoc, id: string) =>
      (out.lines![id] as { curveRadius?: number }).curveRadius;

    it('stamps a non-default legacy radius onto every line and drops the doc field', () => {
      const out = run({ lines: linesIn(), curveRadius: 40 }, 15);
      expect(radiusOf(out, 'L1')).toBe(40);
      expect(radiusOf(out, 'L2')).toBe(40);
      expect('curveRadius' in out).toBe(false);
    });

    it('leaves lines unstamped for the legacy default 24 (never stored)', () => {
      const out = run({ lines: linesIn(), curveRadius: 24 }, 15);
      expect(radiusOf(out, 'L1')).toBeUndefined();
      expect('curveRadius' in out).toBe(false);
    });

    it('fills line style defs that predate the covered field from the legacy radius', () => {
      // Uses the factory line def (which predates curveRadius in this input:
      // strip the key to simulate an old persisted def).
      const { curveRadius: _c, ...oldProps } = DEFAULT_STYLES['default-line']
        .props as LineStyleProps;
      const out = run(
        {
          lines: {},
          curveRadius: 40,
          styles: { 'default-line': { ...DEFAULT_STYLES['default-line'], props: oldProps } },
          styleDefaults: FACTORY_STYLE_DEFAULTS,
        },
        15,
      );
      expect(out.styles!['default-line'].props.curveRadius).toBe(40);
    });

    it('runs BEFORE the v<10 style hygiene, so old defs heal to the doc value, not 24', () => {
      // A round-1 doc (v9): migrateV9Styles rebuilds defs through the
      // canonical grids. If the bake ran after it, the missing curveRadius
      // would heal to the constant default and lose the doc's 40.
      const { curveRadius: _c, ...oldProps } = DEFAULT_STYLES['default-line']
        .props as LineStyleProps;
      const out = run(
        {
          lines: {},
          curveRadius: 40,
          styles: { 'default-line': { ...DEFAULT_STYLES['default-line'], props: oldProps } },
          styleDefaults: FACTORY_STYLE_DEFAULTS,
        },
        9,
      );
      expect(out.styles!['default-line'].props.curveRadius).toBe(40);
    });

    it('does not bake at version >= 16', () => {
      const out = run({ lines: linesIn(), curveRadius: 40 }, 16);
      expect(radiusOf(out, 'L1')).toBeUndefined(); // not stamped
    });
  });

  describe('v<25: strip the retired seam fields', () => {
    // A v24 line style def still carrying the seam keys the model has since
    // retired.
    const oldDefProps = () => ({
      ...(DEFAULT_STYLES['default-line'].props as LineStyleProps),
      seamEdges: 'curved',
      seamColor: '#abcdef80',
      seamWidth: 3,
    });

    it('drops seamColor/seamWidth/seamEdges from lines, line style defs, AND the doc root', () => {
      const out = run(
        {
          // A pre-v23 doc that never got the v23 bake carries the retired
          // DOC-LEVEL field at the root — the strip removes that remnant too.
          seamEdges: 'straight',
          lines: {
            L1: {
              service: 'A',
              name: 'A line',
              stations: [],
              edges: [],
              seamColor: '#abcdef80',
              seamWidth: 3,
              seamEdges: 'curved',
            },
          },
          styles: { 'default-line': { ...DEFAULT_STYLES['default-line'], props: oldDefProps() } },
          styleDefaults: FACTORY_STYLE_DEFAULTS,
        },
        24,
      );
      expect('seamEdges' in out, 'doc-level seamEdges survived').toBe(false);
      for (const key of ['seamColor', 'seamWidth', 'seamEdges']) {
        expect(key in out.lines!.L1, `${key} survived on the line`).toBe(false);
        expect(key in out.styles!['default-line'].props, `${key} survived on the def`).toBe(false);
      }
    });

    it('keeps a tagged line tagged — both sides lose the fields, so equality holds', () => {
      const out = run(
        {
          lines: {
            L1: {
              service: 'A',
              name: 'A line',
              stations: [],
              edges: [],
              styleId: 'default-line',
              seamColor: '#abcdef80',
              seamWidth: 3,
              seamEdges: 'curved',
            },
          },
          styles: { 'default-line': { ...DEFAULT_STYLES['default-line'], props: oldDefProps() } },
          styleDefaults: FACTORY_STYLE_DEFAULTS,
        },
        24,
      );
      expect((out.lines!.L1 as { styleId?: string }).styleId).toBe('default-line');
      expect('seamEdges' in out.lines!.L1).toBe(false);
      expect('seamEdges' in out.styles!['default-line'].props).toBe(false);
    });
  });

  describe('v19 → v20: dot TYPE becomes a covered line-style field', () => {
    // A line style def that predates the covered dot-type ids (strip them off
    // the factory default to simulate an old persisted def).
    const {
      singletonDotStyleId: _s,
      multiDotStyleId: _m,
      ...oldLineProps
    } = DEFAULT_STYLES['default-line'].props as LineStyleProps;
    // A v19 persisted doc: the stopDot library is already baked; lines carry
    // their split dot-type ids; the line def does NOT yet.
    const persisted = () => ({
      lines: {
        // Tagged 'ln'; L1's dot type differs from the to-be-backfilled default,
        // L2's matches it.
        L1: {
          service: 'A',
          name: 'A line',
          stations: [],
          edges: [],
          styleId: 'ln',
          singletonDotStyleId: NONE_STOP_DOT_STYLE_ID,
          multiDotStyleId: NONE_STOP_DOT_STYLE_ID,
        },
        L2: {
          service: 'B',
          name: 'B line',
          stations: [],
          edges: [],
          styleId: 'ln',
          singletonDotStyleId: DEFAULT_STOP_DOT_STYLE_ID,
          multiDotStyleId: DEFAULT_STOP_DOT_STYLE_ID,
        },
      },
      styles: {
        ...STOP_DOT_FACTORY_STYLES,
        ln: { id: 'ln', name: 'My line', kind: 'line', props: oldLineProps },
      },
      styleDefaults: { ...FACTORY_STYLE_DEFAULTS, line: 'ln' },
    });
    const lineStyleId = (out: AnyDoc, id: string) =>
      (out.lines![id] as { styleId?: string }).styleId;

    it('backfills the split dot-type ids onto line defs that predate the field', () => {
      const props = run(persisted(), 19).styles!.ln.props as unknown as LineStyleProps;
      expect(props.singletonDotStyleId).toBe(DEFAULT_STOP_DOT_STYLE_ID);
      expect(props.multiDotStyleId).toBe(DEFAULT_STOP_DOT_STYLE_ID);
    });

    it('untags a line whose dot type no longer matches its now-fuller line style, keeps a match', () => {
      const out = run(persisted(), 19);
      expect(lineStyleId(out, 'L1')).toBeUndefined(); // dot type differs → detached
      expect(lineStyleId(out, 'L2')).toBe('ln'); // matches → tag kept
    });

    it('does not run at version >= 20', () => {
      const out = run(persisted(), 20);
      expect('singletonDotStyleId' in out.styles!.ln.props).toBe(false); // not backfilled
      expect(lineStyleId(out, 'L1')).toBe('ln'); // not pruned
    });
  });

  describe('v23 → v24: activePalettes ids become the palette copies a map carries', () => {
    // Symmetric with the file-import coverage in serialize.test.ts: both load
    // paths route through the shared bakeActivePalettes helper.
    beforeEach(() => {
      useCustomPalettes.setState({
        palettes: [{ name: 'frrf', swatches: [{ name: '1', color: '#c1272d' }] }],
        starred: [],
        sort: 'name',
      });
    });

    it('resolves built-in ids to copies, in the stored order', () => {
      const out = migrateDoc({ activePalettes: ['mta', 'bart'] }, 23);
      expect(out.palettes.map((p) => p.name)).toEqual(['MTA', 'BART']);
      expect(out.palettes[0].swatches).toHaveLength(11);
    });

    it('resolves a custom id against the library', () => {
      const out = migrateDoc({ activePalettes: ['custom:frrf'] }, 23);
      expect(out.palettes).toEqual([{ name: 'frrf', swatches: [{ name: '1', color: '#c1272d' }] }]);
    });

    it('drops a custom id the library no longer holds', () => {
      expect(migrateDoc({ activePalettes: ['custom:gone'] }, 23).palettes).toEqual([]);
    });

    it('drops unknown ids, and an empty list stays empty', () => {
      expect(migrateDoc({ activePalettes: ['nope'] }, 23).palettes).toEqual([]);
      expect(migrateDoc({ activePalettes: [] }, 23).palettes).toEqual([]);
    });

    it('retires the legacy field', () => {
      expect('activePalettes' in migrateDoc({ activePalettes: ['mta'] }, 23)).toBe(false);
    });

    it('leaves an ABSENT activePalettes alone (persist merge seeds it)', () => {
      expect(migrateDoc({ lines: {} }, 23).palettes).toBeUndefined();
    });

    it('does not run at v24 — a doc already carrying palettes keeps them', () => {
      const held = [{ name: 'kept', swatches: [{ name: '1', color: '#010101' }] }];
      expect(migrateDoc({ palettes: held, activePalettes: ['bart'] }, 24).palettes).toEqual(held);
    });
  });

  describe('v28 → v29: a stored palette carrying no colors is dropped', () => {
    // New… used to seed both destinations on the way into the editor, so every
    // "New palette N" backed out of left an empty one behind.
    const stored = [
      { name: 'kept', swatches: [{ name: '1', color: '#010101' }] },
      { name: 'New palette 2', swatches: [] },
    ];

    it('drops the empty one, leaving the rest in place', () => {
      expect(migrateDoc({ palettes: stored }, 28).palettes).toEqual([stored[0]]);
    });

    it('leaves an ABSENT palettes list alone (the persist merge seeds it)', () => {
      expect(migrateDoc({ lines: {} }, 28).palettes).toBeUndefined();
    });

    it('does not run at v29', () => {
      expect(migrateDoc({ palettes: stored }, 29).palettes).toEqual(stored);
    });
  });
});

describe('beginHistoryGroup', () => {
  beforeEach(() => {
    useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
    useDoc.temporal.getState().clear();
  });

  it('commit pushes exactly one history entry covering the grouped edit', () => {
    const before = historyDepth();
    const grp = beginHistoryGroup();
    useDoc.getState().addStation(10, 20);
    useDoc.getState().addStation(30, 40);
    grp.commit();
    expect(historyDepth()).toBe(before + 1);
  });

  it('commit is a no-op when nothing changed in the group', () => {
    const before = historyDepth();
    beginHistoryGroup().commit();
    expect(historyDepth()).toBe(before);
  });

  it('cancel never pushes, even after a change', () => {
    const before = historyDepth();
    const grp = beginHistoryGroup();
    useDoc.getState().addStation(0, 0);
    grp.cancel();
    expect(historyDepth()).toBe(before);
  });

  it('a second commit is a no-op (done flag)', () => {
    const before = historyDepth();
    const grp = beginHistoryGroup();
    useDoc.getState().addStation(0, 0);
    grp.commit();
    grp.commit();
    expect(historyDepth()).toBe(before + 1);
  });

  it('rollback restores the pre-group doc and pushes no history entry', () => {
    const before = historyDepth();
    const stationsBefore = useDoc.getState().stations;
    const grp = beginHistoryGroup();
    useDoc.getState().addStation(10, 20);
    useDoc.getState().addStation(30, 40);
    expect(Object.keys(useDoc.getState().stations).length).toBe(2);
    grp.rollback();
    // Mutations reverted...
    expect(useDoc.getState().stations).toEqual(stationsBefore);
    // ...and no undo entry left behind for the aborted gesture.
    expect(historyDepth()).toBe(before);
  });

  it('rollback resumes recording so the NEXT edit is undoable', () => {
    const grp = beginHistoryGroup();
    useDoc.getState().addStation(10, 20);
    grp.rollback();
    const after = historyDepth();
    // A normal edit after the aborted gesture records normally.
    useDoc.getState().addStation(50, 60);
    expect(historyDepth()).toBe(after + 1);
  });

  it('rollback skips the restore write when the group made no change', () => {
    const before = historyDepth();
    let writes = 0;
    const unsub = useDoc.subscribe(() => {
      writes += 1;
    });
    const grp = beginHistoryGroup();
    grp.rollback();
    unsub();
    // No doc write at all (not even a redundant setState back to the snapshot),
    // and recording still resumed cleanly.
    expect(writes).toBe(0);
    expect(historyDepth()).toBe(before);
  });

  it('a rollback after commit is a no-op (done flag)', () => {
    const grp = beginHistoryGroup();
    useDoc.getState().addStation(10, 20);
    grp.commit();
    const depthAfterCommit = historyDepth();
    grp.rollback();
    // The committed station and its history entry both survive.
    expect(Object.keys(useDoc.getState().stations).length).toBe(1);
    expect(historyDepth()).toBe(depthAfterCommit);
  });

  it('a second rollback is a no-op (done flag)', () => {
    const grp = beginHistoryGroup();
    useDoc.getState().addStation(10, 20);
    grp.rollback();
    const stationsAfter = useDoc.getState().stations;
    const depthAfter = historyDepth();
    grp.rollback();
    expect(useDoc.getState().stations).toEqual(stationsAfter);
    expect(historyDepth()).toBe(depthAfter);
  });
});

describe('cancelAppendMode', () => {
  beforeEach(() => {
    useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
    useSelection.setState({ ...useSelection.getState(), uiMode: { kind: 'idle' } });
  });

  it('deletes a freshly-created empty line and returns to idle', () => {
    const id = startNewLineAppend();

    cancelAppendMode();

    expect(useDoc.getState().lines[id]).toBeUndefined();
    expect(useSelection.getState().uiMode.kind).toBe('idle');
  });

  it('rolls back lineCounter when discarding the empty placeholder line', () => {
    // addLine eagerly commits the placeholder AND advances lineCounter to pick
    // its color; cancelling before any station is placed must undo both so
    // repeated Add→Esc doesn't walk the color cycle forward.
    useDoc.setState({ ...useDoc.getState(), lineCounter: 2 });
    const id = startNewLineAppend();
    expect(useDoc.getState().lineCounter).toBe(3);

    cancelAppendMode();

    expect(useDoc.getState().lines[id]).toBeUndefined();
    expect(useDoc.getState().lineCounter).toBe(2);
  });

  it('leaves lineCounter untouched when the line already has stations', () => {
    useDoc.setState({
      ...useDoc.getState(),
      lines: { L1: makeLine({ id: 'L1' as LineId, stations: ['A' as StationId] }) },
      lineOrder: ['L1' as LineId],
      stations: { A: stationWithStop('A' as StationId, 'L1' as LineId, { x: 0, y: 0 }) },
      lineCounter: 5,
    });
    useSelection.getState().setAppending('L1' as LineId);

    cancelAppendMode();

    expect(useDoc.getState().lineCounter).toBe(5);
  });

  it('keeps a line that already has stations', () => {
    useDoc.setState({
      ...useDoc.getState(),
      lines: { L1: makeLine({ id: 'L1' as LineId, stations: ['A' as StationId] }) },
      lineOrder: ['L1' as LineId],
      stations: { A: stationWithStop('A' as StationId, 'L1' as LineId, { x: 0, y: 0 }) },
    });
    useSelection.getState().setAppending('L1' as LineId);

    cancelAppendMode();

    expect(useDoc.getState().lines['L1' as LineId]).toBeDefined();
    expect(useSelection.getState().uiMode.kind).toBe('idle');
  });

  it('is a no-op (beyond clearing append) when not in appending mode', () => {
    expect(() => cancelAppendMode()).not.toThrow();
    expect(useSelection.getState().uiMode.kind).toBe('idle');
  });
});

// The GC used to live only inside cancelAppendMode, reachable from Esc and the
// canvas-background click — every OTHER exit (the T/L shortcuts, toolbar
// re-entry, clicking a free item / a foreign stripe) bypassed it and leaked
// the station-less placeholder into the doc. The GC now rides a mode-exit
// subscription, so ANY transition out of appending-to-line collects it.
describe('append-mode placeholder GC on bypass exits', () => {
  beforeEach(() => {
    useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
    useSelection.setState({ ...useSelection.getState(), uiMode: { kind: 'idle' } });
  });

  it('collects the empty placeholder when the mode exits WITHOUT cancelAppendMode', () => {
    useDoc.setState({ ...useDoc.getState(), lineCounter: 2 });
    const id = startNewLineAppend();

    // The T-shortcut path: setUiMode directly, no cancelAppendMode call.
    useSelection.getState().setUiMode({ kind: 'creating-transfer', firstEnd: null });

    expect(useDoc.getState().lines[id]).toBeUndefined();
    expect(useDoc.getState().lineCounter).toBe(2);
    expect(useSelection.getState().uiMode.kind).toBe('creating-transfer');
  });

  it('collects the elder placeholder when switching straight to editing another line', () => {
    useDoc.setState({
      ...useDoc.getState(),
      lines: { L2: makeLine({ id: 'L2' as LineId, stations: ['A' as StationId] }) },
      lineOrder: ['L2' as LineId],
      stations: { A: stationWithStop('A' as StationId, 'L2' as LineId, { x: 0, y: 0 }) },
      lineCounter: 2,
    });
    const id = startNewLineAppend();

    useSelection.getState().startAppend('L2' as LineId);

    expect(useDoc.getState().lines[id]).toBeUndefined();
    expect(useDoc.getState().lines['L2' as LineId]).toBeDefined();
    expect(useSelection.getState().uiMode).toMatchObject({
      kind: 'appending-to-line',
      lineId: 'L2',
    });
  });

  it('keeps a placeholder that gained stations, whatever the exit', () => {
    useDoc.setState({
      ...useDoc.getState(),
      stations: { A: stationWithStop('A' as StationId, 'L1' as LineId, { x: 0, y: 0 }) },
      lineCounter: 4,
    });
    const id = startNewLineAppend();
    useDoc.getState().addStationToLine(id, 'A' as StationId);

    useSelection.getState().setUiMode({ kind: 'layering' });

    expect(useDoc.getState().lines[id]).toBeDefined();
    expect(useDoc.getState().lineCounter).toBe(5);
  });
});

// An EMPTY line is no longer proof of an abandoned placeholder. toggleEdgeOnLine
// drops endpoints that fall to degree 0, so deleting a two-station line's only
// edge in Edit Stops empties its stations[] — and collecting that deletes a real
// line outright (its sidebar row, its tags, its region assignments, every route
// bullet pointing at it) with nothing on screen to say so.
describe('append-mode placeholder GC — only the line Add ▸ Line made', () => {
  const seedPair = () => {
    useDoc.setState({
      ...useDoc.getState(),
      ...DEFAULT_DOC,
      lines: {
        L1: makeLine({
          id: 'L1' as LineId,
          stations: ['A' as StationId, 'B' as StationId],
          edges: ['A|B'],
        }),
      },
      lineOrder: ['L1' as LineId],
      stations: {
        A: stationWithStop('A' as StationId, 'L1' as LineId, { x: 0, y: 0 }),
        B: stationWithStop('B' as StationId, 'L1' as LineId, { x: 100, y: 0 }),
      },
      lineCounter: 5,
    });
    useDoc.temporal.getState().clear();
  };

  beforeEach(() => {
    useSelection.setState({ ...useSelection.getState(), uiMode: { kind: 'idle' } });
  });

  it('keeps a pre-existing line emptied by deleting its only edge', () => {
    seedPair();
    useSelection.getState().startAppend('L1' as LineId);

    useDoc.getState().toggleEdgeOnLine('L1' as LineId, 'A' as StationId, 'B' as StationId);
    expect(useDoc.getState().lines['L1' as LineId].stations).toEqual([]);

    useSelection.getState().setUiMode({ kind: 'idle' });

    expect(useDoc.getState().lines['L1' as LineId]).toBeDefined();
    expect(useDoc.getState().lineOrder).toEqual(['L1']);
    expect(useDoc.getState().lineCounter).toBe(5);
  });

  it('keeps a line Add ▸ Line made that gained stations and was then emptied', () => {
    // Same session as the creation, so the id still matches the pending marker
    // — but it stopped being a placeholder the moment it held a station.
    seedPair();
    const id = startNewLineAppend();
    useDoc.getState().addStationToLine(id, 'A' as StationId);
    useDoc.getState().addStationToLine(id, 'B' as StationId);
    useDoc.getState().toggleEdgeOnLine(id, 'A' as StationId, 'B' as StationId);
    useDoc.getState().toggleEdgeOnLine(id, 'A' as StationId, 'B' as StationId);
    expect(useDoc.getState().lines[id].stations).toEqual([]);

    cancelAppendMode();

    expect(useDoc.getState().lines[id]).toBeDefined();
  });

  it('still collects the untouched placeholder Add ▸ Line just made', () => {
    seedPair();
    const id = startNewLineAppend();
    expect(useDoc.getState().lines[id]).toBeDefined();

    cancelAppendMode();

    expect(useDoc.getState().lines[id]).toBeUndefined();
    expect(useDoc.getState().lineCounter).toBe(5);
  });
});
