import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  migrateDoc,
  beginHistoryGroup,
  cancelAppendMode,
  pickDocSnapshot,
  useDoc,
  useSelection,
} from './store';
import { historyDepth } from './history';
import {
  DEFAULT_DOC,
  DEFAULT_STYLES,
  FACTORY_STYLE_DEFAULTS,
  TEXT_LABEL_COLOR_DEFAULT,
  TEXT_LABEL_DARK_COLOR_DEFAULT,
} from '../model/transforms';
import { DOT_SHAPE_PRESETS } from '../model/dotStyle';
import {
  makeDoc,
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
    { name?: string; service?: string; defaultDotShape?: string; defaultDotStyle?: DotStyle }
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

    it("converts a line's defaultDotShape and strips the key", () => {
      const out = run(
        {
          lines: {
            L1: { service: 'A', name: 'A line', stations: [], defaultDotShape: 'open-white' },
          },
        },
        6,
      );
      expect(out.lines!.L1.defaultDotStyle).toEqual(DOT_SHAPE_PRESETS['open-white']);
      expect('defaultDotShape' in out.lines!.L1).toBe(false);
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
      expect(out.lines!.L1.defaultDotStyle).toBeUndefined();
      expect('defaultDotShape' in out.lines!.L1).toBe(false);
    });

    it('does not convert at version >= 7', () => {
      const out = run({ stations: { S: stationWithDotShape('filled-white') } }, 7);
      const stop = out.stations!.S.stops[0];
      expect(stop.dotShape).toBe('filled-white');
      expect(stop.dotStyle).toBeUndefined();
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

  describe('v9 → v10: style-def hygiene (round-1 docs)', () => {
    it('injects the factory Defaults into a round-1 doc with an explicit styles record', () => {
      const out = run({ styles: {} } as Record<string, unknown>, 9) as unknown as {
        styles: Record<string, StyleDef>;
      };
      const names = Object.values(out.styles).map((d) => d.name);
      expect(names).toEqual(['Default', 'Default', 'Default', 'Default', 'Default', 'Default']);
    });

    it('strips since-dropped width/leading/tracking keys from round-1 textLabel defs', () => {
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
          // Round-1 covered keys, dropped in round 2 — must not survive the
          // rehydrate or the stylePropsEqual no-op guards misfire forever.
          width: 0,
          leading: 1,
          tracking: 0,
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
      expect(Object.values(out.styles).map((d) => d.name)).toEqual([
        'Default',
        'Default',
        'Default',
        'Default',
        'Default',
        'Default',
      ]);
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
      // `width`, `defaultDotSize`, and per-stop `dotSize` ride along
      // untouched — each field is optional with a runtime default, so none
      // needs a migration (and adding one would break this
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
            defaultDotSize: 12,
          },
        },
      };
      const out = run(input, 14);
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

  describe('active-palette invariant (not version-gated)', () => {
    // parse() enforces "≥1 valid palette" on file import; the rehydrate path
    // used to skip it, so a persisted explicit-empty / all-unknown
    // `activePalettes` would rehydrate into the unreachable empty-palette state.
    it('replaces an explicit empty activePalettes with the default set', () => {
      expect(migrateDoc({ activePalettes: [] }, 7).activePalettes).toEqual(
        DEFAULT_DOC.activePalettes,
      );
    });

    it('drops unknown palette ids, keeping the valid ones', () => {
      expect(migrateDoc({ activePalettes: ['mta', 'bogus'] }, 7).activePalettes).toEqual(['mta']);
    });

    it('falls back to the default set when no id is valid', () => {
      expect(migrateDoc({ activePalettes: ['nope'] }, 7).activePalettes).toEqual(
        DEFAULT_DOC.activePalettes,
      );
    });

    it('leaves an ABSENT activePalettes untouched (persist merge fills it)', () => {
      expect(migrateDoc({ lines: {} }, 7).activePalettes).toBeUndefined();
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
    useDoc.setState({
      ...useDoc.getState(),
      lines: { L1: makeLine({ id: 'L1' as LineId, stations: [] }) },
      lineOrder: ['L1' as LineId],
    });
    useSelection.getState().setAppending('L1' as LineId);

    cancelAppendMode();

    expect(useDoc.getState().lines['L1' as LineId]).toBeUndefined();
    expect(useSelection.getState().uiMode.kind).toBe('idle');
  });

  it('rolls back lineCounter when discarding the empty placeholder line', () => {
    // addLine eagerly commits the placeholder AND advances lineCounter to pick
    // its color; cancelling before any station is placed must undo both so
    // repeated Add→Esc doesn't walk the color cycle forward.
    useDoc.setState({
      ...useDoc.getState(),
      lines: { L1: makeLine({ id: 'L1' as LineId, stations: [] }) },
      lineOrder: ['L1' as LineId],
      lineCounter: 3, // addLine bumped it (2 → 3) for this placeholder
    });
    useSelection.getState().setAppending('L1' as LineId);

    cancelAppendMode();

    expect(useDoc.getState().lines['L1' as LineId]).toBeUndefined();
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

// migrateDoc is version-gated by zustand: `migrate` runs ONLY on a version
// mismatch. The tests above call migrateDoc directly, so they can't see that a
// doc stamped at the current persist version bypasses migrate entirely. This
// exercises the REAL persist.rehydrate() path — the one that actually crashed —
// so the "stranded at the current version without edges" bug can't regress
// behind a green direct-migrateDoc test again.
describe('persist rehydration guarantees the line-edges invariant', () => {
  const KEY = 'vignelli-map-doc-v1';
  // zundo wraps persist, so the persist API isn't on the bound store's type;
  // it IS attached at runtime.
  const rehydrate = () =>
    (useDoc as unknown as { persist: { rehydrate: () => Promise<void> } }).persist.rehydrate();

  afterEach(() => {
    localStorage.clear();
    useDoc.setState({ ...DEFAULT_DOC });
  });

  it('backfills edges for a doc stranded at the persist version without them', async () => {
    // A doc stamped at the (then-current) version 14, saved before lines wrote
    // `edges`. The renderer crashes on `ln.edges.join(...)` unless the persist
    // version has moved past 14 so zustand re-runs migrate — the fix a direct
    // migrateDoc() call (versions equal) can never prove.
    const snapshot = pickDocSnapshot(
      makeDoc({
        stations: [
          makeStation({ id: 's1' as StationId, stops: [makeStop('L1' as LineId)] }),
          makeStation({ id: 's2' as StationId, stops: [makeStop('L1' as LineId)] }),
        ],
        lines: [makeLine({ id: 'L1' as LineId, stations: ['s1', 's2'] as StationId[] })],
      }),
    );
    // Drop the edges array makeLine synthesizes → the stranded shape.
    const { edges: _dropped, ...l1NoEdges } = snapshot.lines['L1' as LineId];
    const stranded = { ...snapshot, lines: { L1: l1NoEdges } };
    localStorage.setItem(KEY, JSON.stringify({ state: stranded, version: 14 }));

    await rehydrate();

    const line = useDoc.getState().lines['L1' as LineId];
    expect(Array.isArray(line.edges)).toBe(true);
    expect(line.edges).toEqual(['s1|s2']); // backfilled from the consecutive stations
  });
});
