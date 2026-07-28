import { describe, it, expect } from 'vitest';
import { stopMetricsOf } from './stopMetrics';
import { DEFAULT_DOT_STYLE, DOT_SHAPE_PRESETS, SERVICE_CODE_DOT_RADIUS } from './dotStyle';
import { makeLine, makeStation, makeStop, makeTransfer } from '../test/fixtures';
import type { DotStyle, Line, Station, StopCell, Transfer } from './types';

// The OTHER half of the label-clearance contract: labelLayout.autoAlign.test.ts
// pins what a given obstacle does to the pin, this pins that a real line, dot
// style and transfer resolve to the obstacle the canvas actually paints.

const dotStyle = (over: Partial<DotStyle> = {}): DotStyle => ({ ...DEFAULT_DOT_STYLE, ...over });

const station = (over: Partial<Station> = {}): Station =>
  makeStation({
    id: 's1',
    stops: [makeStop('L1')],
    ...over,
  });

const metricsFor = (
  lineOver: Partial<Line> = {},
  transfers: Record<string, Transfer> = {},
  st: Station = station(),
) =>
  stopMetricsOf({ lines: { L1: makeLine({ id: 'L1', ...lineOver }) }, transfers })(st, st.stops[0]);

describe('stopMetricsOf — stripe and gap', () => {
  it('halves the line width and reports its interline gap', () => {
    const m = metricsFor({ width: 13, interlineGap: 4.25 });
    expect(m.half).toBe(6.5);
    expect(m.gap).toBe(4.25);
  });
});

describe('stopMetricsOf — the dot', () => {
  it('a fully-tracking plain dot is the 8px default, halved', () => {
    expect(metricsFor().dot).toEqual({ r: 4, shape: 'circle' });
  });

  it('a fully-tracking SERVICE-CODE disc tracks its own larger radius, not the plain 8', () => {
    // The disc sizes itself for legibility; nothing clamps it to the line width,
    // which is exactly why the label has to clear it separately from the stripe.
    const m = metricsFor({ singletonDotStyle: dotStyle({ showServiceCode: true }) });
    expect(m.dot?.r).toBe(SERVICE_CODE_DOT_RADIUS);
    expect(m.dot!.r).toBeGreaterThan(metricsFor({ width: 8 }).half);
  });

  it('an explicit size override wins, at any size — there is no ceiling', () => {
    expect(metricsFor({ singletonDotSize: 40 }).dot?.r).toBe(20);
  });

  it('reports the shape, so the geometry can use the right support function', () => {
    expect(metricsFor({ singletonDotStyle: dotStyle({ shape: 'diamond' }) }).dot?.shape).toBe(
      'diamond',
    );
  });

  it('a blank style paints nothing, so there is no dot to clear', () => {
    const blank = dotStyle({ fill: 'none', strokeWidth: 0, showServiceCode: false });
    expect(metricsFor({ singletonDotStyle: blank }).dot).toBeNull();
  });

  it("a 'dash' style has no dot — its tick is reported as the dash instead", () => {
    const m = metricsFor({ singletonDotStyle: dotStyle({ shape: 'dash' }) });
    expect(m.dot).toBeNull();
    expect(m.dash).not.toBeNull();
  });
});

describe('stopMetricsOf — the dot stroke, per strokeAlign', () => {
  // Must mirror StopGlyph's silDelta: the painted OUTER silhouette, not the
  // nominal radius, is what a label has to clear.
  const withStroke = (strokeAlign: DotStyle['strokeAlign'], shape: DotStyle['shape'] = 'circle') =>
    metricsFor({
      singletonDotSize: 20,
      singletonDotStyle: dotStyle({ shape, strokeWidth: 3, strokeAlign }),
    }).dot!.r;

  it("'inside' pins the outer edge, so the stroke adds nothing", () => {
    expect(withStroke('inside')).toBe(10);
  });

  it("'center' straddles the edge, so half the stroke sits outside", () => {
    expect(withStroke('center')).toBe(11.5);
  });

  it("'outside' grows from the edge, so the whole stroke sits outside", () => {
    expect(withStroke('outside')).toBe(13);
  });

  it('a diamond needs √2× the RADIUS delta, because its edges sit r/√2 from the centre', () => {
    expect(withStroke('center', 'diamond')).toBeCloseTo(10 + 1.5 * Math.SQRT2, 6);
  });

  it("an 'x' is always stroked centred, whatever the style asks for", () => {
    // Concave: no single radius delta offsets a saltire uniformly, so StopGlyph
    // overrides the alignment and the clearance must agree.
    expect(withStroke('outside', 'x')).toBe(11.5);
  });
});

describe('stopMetricsOf — transfer caps', () => {
  const t = (over: Partial<Transfer> = {}): Transfer =>
    makeTransfer({
      id: 't1',
      a: { stationId: 's1', lineId: 'L1' },
      b: { stationId: 's2', lineId: 'L2' },
      ...over,
    });

  it('a cap is half the transfer’s full painted width, halo included', () => {
    // TransferLayer paints thickness over a thickness + 2*strokeWidth halo.
    expect(metricsFor({}, { t1: t({ thickness: 8, strokeWidth: 2 }) }).transferRadius).toBe(6);
  });

  it('takes the LARGEST of several transfers landing on the same stop', () => {
    const transfers = {
      t1: t({ thickness: 4, strokeWidth: 0 }),
      t2: t({ id: 't2', thickness: 10, strokeWidth: 0 }),
    };
    expect(metricsFor({}, transfers).transferRadius).toBe(5);
  });

  it('ignores a transfer landing on a DIFFERENT stop of the same station', () => {
    const other = t({ a: { stationId: 's1', lineId: 'L9' }, thickness: 20 });
    expect(metricsFor({}, { t1: other }).transferRadius).toBe(0);
  });

  it('ignores an end with no lineId — it sits on the station anchor, not a dot', () => {
    const anchored = t({ a: { stationId: 's1', lineId: null }, thickness: 20 });
    expect(metricsFor({}, { t1: anchored }).transferRadius).toBe(0);
  });

  it('ignores an end bound to a transfer ANCHOR rather than a stop', () => {
    const anchored = t({ a: { stationId: 's1', anchorId: 'a1' }, thickness: 20 });
    expect(metricsFor({}, { t1: anchored }).transferRadius).toBe(0);
  });

  it('counts BOTH ends, so a transfer between two stops of one station caps each', () => {
    const selfLink = t({
      a: { stationId: 's1', lineId: 'L1' },
      b: { stationId: 's1', lineId: 'L2' },
      thickness: 12,
      strokeWidth: 0,
    });
    const st = makeStation({ id: 's1', stops: [makeStop('L1'), makeStop('L2', { col: 1 })] });
    const fn = stopMetricsOf({
      lines: { L1: makeLine({ id: 'L1' }), L2: makeLine({ id: 'L2' }) },
      transfers: { t1: selfLink },
    });
    expect(fn(st, st.stops[0]).transferRadius).toBe(6);
    expect(fn(st, st.stops[1]).transferRadius).toBe(6);
  });
});

describe('stopMetricsOf — split singleton/interchange resolution', () => {
  // Ported from stopDashOf's own tests when the three separate lookups folded
  // into this bundle. The rule they pin lives here now: a stop's effective dot
  // style — and so whether it paints a TICK the label has to clear — depends on
  // whether its station is a singleton, which is a property of the whole stop
  // SET, not the cell. That is why the lookup takes the station.
  const dash = DOT_SHAPE_PRESETS['dash'];
  const circle = DOT_SHAPE_PRESETS['filled-black'];
  const blank = DOT_SHAPE_PRESETS['none'];
  // A default-width (14) line: the derived tick is 14 long × 7 thick.
  const TICK = { length: 14, width: 7 };

  const dashOf = (line: Line, stop: StopCell, stops: StopCell[]) =>
    stopMetricsOf({ lines: { [line.id]: line }, transfers: {} })(
      makeStation({ id: 's1', stops }),
      stop,
    ).dash;

  it('resolves a singleton stop against singletonDotStyle, a shared stop against multiDotStyle', () => {
    const line = makeLine({ id: 'L1', singletonDotStyle: dash, multiDotStyle: circle });
    const s = makeStop('L1');
    expect(dashOf(line, s, [s])).toEqual(TICK); // alone → singleton → dash → ticks
    expect(dashOf(line, s, [s, makeStop('L2', { col: 1 })])).toBeNull(); // shared → circle
  });

  it("an interchange-default change never flips a singleton stop's tick (the label-drift regression)", () => {
    const before = makeLine({ id: 'L1', singletonDotStyle: dash, multiDotStyle: dash });
    const after = makeLine({ id: 'L1', singletonDotStyle: dash, multiDotStyle: circle });
    const s = makeStop('L1');
    expect(dashOf(before, s, [s])).toEqual(dashOf(after, s, [s])); // singleton unaffected
    const shared = [s, makeStop('L2', { col: 1 })];
    expect(dashOf(after, s, shared)).toBeNull();
    expect(dashOf(before, s, shared)).toEqual(TICK);
  });

  it('ignores a blanked sibling stop when deciding singleton vs. interchange (express+local)', () => {
    const line = makeLine({ id: 'LOCAL', singletonDotStyle: dash, multiDotStyle: circle });
    const local = makeStop('LOCAL');
    const blanked = makeStop('EXPRESS', { col: 1, dotStyle: blank });
    expect(dashOf(line, local, [local, blanked])).toEqual(TICK); // still a singleton
    expect(dashOf(line, local, [local, makeStop('EXPRESS', { col: 1 })])).toBeNull();
  });

  it('a per-stop dotStyle override wins over either default', () => {
    const line = makeLine({ id: 'L1', singletonDotStyle: circle, multiDotStyle: circle });
    const pinned = makeStop('L1', { dotStyle: dash });
    expect(dashOf(line, pinned, [pinned])).toEqual(TICK);
    expect(dashOf(line, pinned, [pinned, makeStop('L2', { col: 1 })])).toEqual(TICK);
  });

  it('an orphan stop whose line is gone falls back to the default width and no gap', () => {
    const orphan = makeStop('GHOST');
    const m = stopMetricsOf({ lines: {}, transfers: {} })(
      makeStation({ id: 's1', stops: [orphan] }),
      orphan,
    );
    expect(m.half).toBe(7);
    expect(m.gap).toBe(0);
  });
});
