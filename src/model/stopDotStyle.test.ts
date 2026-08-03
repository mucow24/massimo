import { describe, it, expect } from 'vitest';
import * as T from './transforms';
import {
  applyStyleToItem,
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
  STOP_DOT_SEED_STYLES,
  resolveDotRender,
} from './dotStyle';
import { makeDoc, makeLine, makeStation, makeStop, makeStyle } from '../test/fixtures';
import type { DotStyle, LineStyleProps, StyleDef } from './types';

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

describe('dot TYPE as a covered LINE-style field', () => {
  // A line style with custom singleton/interchange stopDot references (custom so
  // the test is independent of which factory presets ship).
  const seed = () =>
    makeDoc({
      lines: [makeLine({ id: 'L1' })],
      styles: [
        makeStyle('stopDot', 'sd-square', { props: { shape: 'square' } }),
        makeStyle('stopDot', 'sd-x', { props: { shape: 'x' } }),
        makeStyle('line', 'ln', {
          props: { singletonDotStyleId: 'sd-square', multiDotStyleId: 'sd-square' },
        }),
      ],
    });

  it('stamping a line style points the line split defaults at its stopDot ids', () => {
    const doc = applyStyleToItem(seed(), 'ln', 'L1');
    expect(doc.lines.L1.styleId).toBe('ln');
    expect(doc.lines.L1.singletonDotStyleId).toBe('sd-square');
    expect(doc.lines.L1.multiDotStyleId).toBe('sd-square');
    expect(doc.lines.L1.singletonDotStyle!.shape).toBe('square');
  });

  it('editing a line style dot type restamps the tagged line (kept), on the edited case only', () => {
    let doc = applyStyleToItem(seed(), 'ln', 'L1');
    doc = updateStyleProps(doc, 'ln', { singletonDotStyleId: 'sd-x' });
    expect(doc.lines.L1.singletonDotStyleId).toBe('sd-x');
    expect(doc.lines.L1.singletonDotStyle!.shape).toBe('x');
    expect(doc.lines.L1.multiDotStyleId).toBe('sd-square'); // untouched case
    expect(doc.lines.L1.styleId).toBe('ln'); // restamp, not detach
  });

  it('deleting a referenced stopDot re-points the LINE style def to the fallback and restamps its wearer', () => {
    const doc = applyStyleToItem(seed(), 'ln', 'L1');
    const next = deleteStyle(doc, 'sd-square');
    const fallback = (next.styles.ln.props as LineStyleProps).singletonDotStyleId;
    // No dangle: the def points at a surviving stopDot style…
    expect(next.styles[fallback]?.kind).toBe('stopDot');
    expect((next.styles.ln.props as LineStyleProps).multiDotStyleId).toBe(fallback);
    // …and the wearer line follows it (tagged ⇒ matches), keeping its tag.
    expect(next.lines.L1.singletonDotStyleId).toBe(fallback);
    expect(next.lines.L1.multiDotStyleId).toBe(fallback);
    expect(next.lines.L1.styleId).toBe('ln');
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

  // …and being reserved means it is never the FALLBACK either. The delete
  // fallback used to be "the kind's first remaining style by name", which put
  // "None" ahead of anything sorting after it — making blank dots the kind's
  // default AND re-pointing every line style def that referenced the deleted
  // entry, after which the restamp blanked every dot on the map from one click.
  // A doc whose stop-dot library is exactly the fresh-map seed (Filled black +
  // None) plus whatever `extra` adds — makeDoc otherwise seeds the whole factory
  // library, which has plenty of names sorting ahead of "None" and hides this.
  const seedLibrary = (...extra: StyleDef[]) => {
    const base = makeDoc({});
    const styles: Record<string, StyleDef> = {};
    for (const d of Object.values(base.styles)) if (d.kind !== 'stopDot') styles[d.id] = d;
    for (const d of Object.values(STOP_DOT_SEED_STYLES)) styles[d.id] = d;
    for (const d of extra) styles[d.id] = d;
    return { ...base, styles };
  };

  const openWhite = makeStyle('stopDot', 'sd-open', {
    name: 'Open white',
    props: { shape: 'open-white' },
  });

  it('is never chosen as the fallback when the kind default is deleted', () => {
    // Library: "Filled black" (deleted), "None" (reserved), "Open white".
    // "None" sorts first of the two survivors.
    let doc = seedLibrary(openWhite);
    doc = setDefaultStyle(doc, DEFAULT_STOP_DOT_STYLE_ID);
    const next = deleteStyle(doc, DEFAULT_STOP_DOT_STYLE_ID);
    expect(next.styleDefaults.stopDot).not.toBe(NONE_STOP_DOT_STYLE_ID);
    expect(next.styleDefaults.stopDot).toBe('sd-open');
  });

  it('is never chosen as the fallback for a line style def either', () => {
    const doc = seedLibrary(
      openWhite,
      makeStyle('line', 'ln', {
        props: {
          singletonDotStyleId: DEFAULT_STOP_DOT_STYLE_ID,
          multiDotStyleId: DEFAULT_STOP_DOT_STYLE_ID,
        },
      }),
    );
    const next = deleteStyle(doc, DEFAULT_STOP_DOT_STYLE_ID);
    const props = next.styles.ln.props as LineStyleProps;
    expect(props.singletonDotStyleId).toBe('sd-open');
    expect(props.multiDotStyleId).toBe('sd-open');
  });

  it('does not disturb a fallback that legitimately sorts first', () => {
    let doc = seedLibrary(
      makeStyle('stopDot', 'sd-aaa', { name: 'AAA dots', props: { shape: 'square' } }),
    );
    doc = setDefaultStyle(doc, DEFAULT_STOP_DOT_STYLE_ID);
    expect(deleteStyle(doc, DEFAULT_STOP_DOT_STYLE_ID).styleDefaults.stopDot).toBe('sd-aaa');
  });

  it('refuses the delete when excluding it would leave the kind with nothing', () => {
    // A seed map's stop-dot library is exactly {Filled black, None}. Deleting
    // Filled black is the "last style of a kind" case the panel already greys
    // out — the model must agree rather than fall through to "None".
    const doc = seedLibrary();
    expect(deleteStyle(doc, DEFAULT_STOP_DOT_STYLE_ID)).toBe(doc);
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

describe('stopDot styles — first-letter-only service codes', () => {
  it('round-trips the flag, and turning it off drops the field entirely', () => {
    let doc = makeDoc({ lines: [makeLine({ id: 'L1' })] });
    doc = updateStyleProps(doc, DEFAULT_STOP_DOT_STYLE_ID, {
      showServiceCode: true,
      serviceCodeFirstLetterOnly: true,
    });
    const parsed = parse(serialize(doc));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const p = parsed.doc.styles[DEFAULT_STOP_DOT_STYLE_ID].props as DotStyle;
      expect(p.serviceCodeFirstLetterOnly).toBe(true);
      expect(resolveDotRender(p, '#0039a6', '6X', false)!.code!.text).toBe('6');
    }

    // Off ⇒ absent, never a stored `false` (canonical styles stay byte-clean).
    doc = updateStyleProps(doc, DEFAULT_STOP_DOT_STYLE_ID, { serviceCodeFirstLetterOnly: false });
    expect('serviceCodeFirstLetterOnly' in doc.styles[DEFAULT_STOP_DOT_STYLE_ID].props).toBe(false);
  });
});
