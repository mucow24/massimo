import { describe, it, expect } from 'vitest';
import * as T from './transforms';
import {
  updateStyleProps,
  deleteStyle,
  renameStyle,
  setDefaultStyle,
  stylesOfKind,
} from './styles';
import { bakeStopDotLibrary, serialize, parse } from './serialize';
import {
  DEFAULT_STOP_DOT_STYLE_ID,
  NONE_STOP_DOT_STYLE_ID,
  STOP_DOT_FACTORY_STYLES,
  resolveDotRender,
} from './dotStyle';
import { makeDoc, makeLine, makeStation, makeStop } from '../test/fixtures';
import type { DotStyle } from './types';

const OPEN_WHITE = 'stop-open-white';
const DIAMOND = 'stop-filled-black-diamond';
const props = (id: string): DotStyle => STOP_DOT_FACTORY_STYLES[id].props;

describe('stopDot styles — restamp propagation (the headline)', () => {
  it('editing a stopDot style restamps every dot slot wearing it', () => {
    // L1's singleton default is open-white; a's stop tracks it (no override).
    // b's stop carries an explicit open-white override on L2.
    let doc = makeDoc({
      stations: [
        makeStation({ id: 'a', stops: [makeStop('L1')] }),
        makeStation({ id: 'b', stops: [makeStop('L2')] }),
      ],
      lines: [makeLine({ id: 'L1', singletonDotStyleId: OPEN_WHITE }), makeLine({ id: 'L2' })],
    });
    doc = T.setDotStyle(doc, 'b', 'L2', OPEN_WHITE);
    expect(doc.stations.b.stops[0].dotStyleId).toBe(OPEN_WHITE);

    // One edit to the open-white style — every wearer follows.
    const next = updateStyleProps(doc, OPEN_WHITE, { strokeWidth: 3 });
    expect((next.styles[OPEN_WHITE].props as DotStyle).strokeWidth).toBe(3);
    // Line default raw shadow restamped:
    expect(next.lines.L1.singletonDotStyle!.strokeWidth).toBe(3);
    // Per-stop override raw shadow restamped:
    expect(next.stations.b.stops[0].dotStyle!.strokeWidth).toBe(3);
    // The untagged stop tracking L1's default resolves to the new value:
    expect(T.resolveDotStyle(next.lines.L1, next.stations.a.stops[0], true).strokeWidth).toBe(3);
  });

  it('deleting a stopDot style untags its wearers (keeping their look) and re-points the default', () => {
    let doc = makeDoc({
      stations: [makeStation({ id: 'a', stops: [makeStop('L1')] })],
      lines: [makeLine({ id: 'L1', singletonDotStyleId: DIAMOND })],
    });
    // Make DIAMOND the default so deleting it also exercises re-pointing.
    doc = setDefaultStyle(doc, DIAMOND);
    const before = doc.lines.L1.singletonDotStyle;
    const next = deleteStyle(doc, DIAMOND);
    expect(next.styles[DIAMOND]).toBeUndefined();
    // Wearer keeps its raw look but loses the (now-dangling) tag:
    expect(next.lines.L1.singletonDotStyle).toEqual(before);
    expect(next.lines.L1.singletonDotStyleId).toBeUndefined();
    // Designation re-pointed to a surviving stopDot style:
    expect(next.styles[next.styleDefaults.stopDot]?.kind).toBe('stopDot');
  });
});

describe('stopDot styles — new stations follow the ⭐ default', () => {
  it('a new line adopts the designated default; re-designating changes only NEW lines', () => {
    let doc = makeDoc({ lines: [] });
    doc = T.applyDefaultStopDotToLine(T.addLine(doc, 'L1', 'A', '#000000'), 'L1');
    expect(doc.lines.L1.singletonDotStyleId).toBe(DEFAULT_STOP_DOT_STYLE_ID);
    expect(doc.lines.L1.multiDotStyleId).toBe(DEFAULT_STOP_DOT_STYLE_ID);

    doc = setDefaultStyle(doc, OPEN_WHITE);
    doc = T.applyDefaultStopDotToLine(T.addLine(doc, 'L2', 'B', '#000000'), 'L2');
    expect(doc.lines.L2.singletonDotStyleId).toBe(OPEN_WHITE);
    // The existing line is untouched by a re-designation.
    expect(doc.lines.L1.singletonDotStyleId).toBe(DEFAULT_STOP_DOT_STYLE_ID);
  });
});

describe('stopDot styles — v19 migration (bakeStopDotLibrary)', () => {
  // Build a pre-v19 doc: raw dot values on lines/stops, NO stopDot styles/tags.
  const legacyDoc = () => {
    const seeded = makeDoc({
      stations: [
        makeStation({ id: 'a', stops: [makeStop('L1', { dotStyle: props(OPEN_WHITE) })] }),
      ],
      lines: [makeLine({ id: 'L1', singletonDotStyle: props(DIAMOND) })],
    });
    // Strip the seeded library + designation to simulate an old save.
    const styles = Object.fromEntries(
      Object.entries(seeded.styles).filter(([, d]) => d.kind !== 'stopDot'),
    );
    const { stopDot: _drop, ...styleDefaults } = seeded.styleDefaults;
    return { ...seeded, styles, styleDefaults } as typeof seeded;
  };

  it('seeds the library, tags slots by value, sets the default, and is idempotent', () => {
    const baked = bakeStopDotLibrary(legacyDoc());
    expect(Object.values(baked.styles).some((d) => d.kind === 'stopDot')).toBe(true);
    expect(baked.lines.L1.singletonDotStyleId).toBe(DIAMOND);
    expect(baked.stations.a.stops[0].dotStyleId).toBe(OPEN_WHITE);
    expect(baked.styleDefaults.stopDot).toBe(DEFAULT_STOP_DOT_STYLE_ID);
    // Re-running on an already-migrated doc is a reference-stable no-op.
    expect(bakeStopDotLibrary(baked)).toBe(baked);
  });

  it('renders identically before and after migration (raw shadow preserved)', () => {
    const legacy = legacyDoc();
    const baked = bakeStopDotLibrary(legacy);
    const beforeStop = legacy.stations.a.stops[0];
    const afterStop = baked.stations.a.stops[0];
    // Same resolved dot render (the tag is additive; the raw value is unchanged).
    expect(
      resolveDotRender(T.resolveDotStyle(legacy.lines.L1, beforeStop, true), '#abc', 'A', false),
    ).toEqual(
      resolveDotRender(T.resolveDotStyle(baked.lines.L1, afterStop, true), '#abc', 'A', false),
    );
  });
});

describe('the reserved "None" stop-dot style', () => {
  it('is a real library style (so the picker always offers it) but cannot be renamed or deleted', () => {
    const doc = makeDoc({});
    // It IS in the library that drives the picker menu.
    expect(stylesOfKind(doc.styles, 'stopDot').some((d) => d.id === NONE_STOP_DOT_STYLE_ID)).toBe(
      true,
    );
    // But it's reserved: rename and delete are no-ops (reference-stable).
    expect(renameStyle(doc, NONE_STOP_DOT_STYLE_ID, 'Blank')).toBe(doc);
    expect(deleteStyle(doc, NONE_STOP_DOT_STYLE_ID)).toBe(doc);
  });
});

describe('stopDot styles — serviceCodeColor persistence', () => {
  it('an explicit service-code color round-trips through serialize/parse', () => {
    let doc = makeDoc({ lines: [makeLine({ id: 'L1' })] });
    doc = updateStyleProps(doc, DEFAULT_STOP_DOT_STYLE_ID, {
      showServiceCode: true,
      serviceCodeColor: { day: '#ff0000', night: '#00ff00' },
    });
    const parsed = parse(serialize(doc));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const p = parsed.doc.styles[DEFAULT_STOP_DOT_STYLE_ID].props as DotStyle;
      expect(p.serviceCodeColor).toEqual({ day: '#ff0000', night: '#00ff00' });
      expect(p.showServiceCode).toBe(true);
    }
  });

  it("a 'line' service-code color survives updateStyleProps and round-trips", () => {
    let doc = makeDoc({ lines: [makeLine({ id: 'L1' })] });
    // updateStyleProps canonicalizes the merged style — 'line' must pass through
    // without tripping the day/night lowercasing.
    doc = updateStyleProps(doc, DEFAULT_STOP_DOT_STYLE_ID, {
      showServiceCode: true,
      serviceCodeColor: 'line',
    });
    expect((doc.styles[DEFAULT_STOP_DOT_STYLE_ID].props as DotStyle).serviceCodeColor).toBe('line');
    // The code then paints in the line's color at render time.
    const style = doc.styles[DEFAULT_STOP_DOT_STYLE_ID].props as DotStyle;
    expect(resolveDotRender(style, '#0039a6', 'A', false)!.code!.color).toBe('#0039a6');

    const parsed = parse(serialize(doc));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const p = parsed.doc.styles[DEFAULT_STOP_DOT_STYLE_ID].props as DotStyle;
      expect(p.serviceCodeColor).toBe('line');
    }
  });
});
