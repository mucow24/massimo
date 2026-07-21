import { describe, it, expect } from 'vitest';
import {
  adoptDefaultStyles,
  applyDefaultStyle,
  applyStyleToItem,
  captureStyleProps,
  clearStyleTag,
  createStyle,
  defaultStyleProps,
  deleteStyle,
  duplicateStyle,
  renameStyle,
  saveStyleFromItem,
  setDefaultStyle,
  stylePropsEqual,
  stylesOfKind,
  updateStyleProps,
} from './styles';
import { DEFAULT_DOC, DEFAULT_STYLES, FACTORY_STYLE_DEFAULTS } from './transforms';
import {
  DEFAULT_STOP_DOT_STYLE_ID,
  NONE_STOP_DOT_STYLE_ID,
  STOP_DOT_SEED_STYLES,
} from './dotStyle';
import { DOT_SIZE_DEFAULT } from './dotSize';
import { LINE_WIDTH_DEFAULT } from './lineWidth';
import { LINE_CURVE_RADIUS_DEFAULT } from './lineCurve';
import type { RouteBulletStyleProps, TextLabelStyleProps, TransferStyleProps } from './types';
import {
  makeDoc,
  makeLine,
  makePolygon,
  makeRouteBullet,
  makeStation,
  makeStop,
  makeStyle,
  makeTextLabel,
  makeTransfer,
} from '../test/fixtures';

describe('captureStyleProps', () => {
  it('reads a fully-default line as the effective constants', () => {
    const doc = makeDoc({ lines: [makeLine({ id: 'l1' })] });
    expect(captureStyleProps(doc, 'line', 'l1')).toEqual({
      singletonDotStyleId: DEFAULT_STOP_DOT_STYLE_ID,
      multiDotStyleId: DEFAULT_STOP_DOT_STYLE_ID,
      singletonDotSize: DOT_SIZE_DEFAULT,
      multiDotSize: DOT_SIZE_DEFAULT,
      width: LINE_WIDTH_DEFAULT,
      curveRadius: LINE_CURVE_RADIUS_DEFAULT,
      strokeWidth: 0,
      strokeColor: '#ffffff',
    });
  });

  it('reads explicit line overrides verbatim, singleton and shared independently', () => {
    // Dot TYPE (the split stopDot ids) and dot SIZE are both covered; the ids
    // heal to the stopDot ⭐ default when a (fixture) line stores neither.
    const doc = makeDoc({
      lines: [
        makeLine({
          id: 'l1',
          singletonDotSize: 12,
          multiDotSize: 16,
          width: 10,
          curveRadius: 40,
          strokeWidth: 1.5,
          strokeColor: '#123456',
        }),
      ],
    });
    expect(captureStyleProps(doc, 'line', 'l1')).toEqual({
      singletonDotStyleId: DEFAULT_STOP_DOT_STYLE_ID,
      multiDotStyleId: DEFAULT_STOP_DOT_STYLE_ID,
      singletonDotSize: 12,
      multiDotSize: 16,
      width: 10,
      curveRadius: 40,
      strokeWidth: 1.5,
      strokeColor: '#123456',
    });
  });

  it('captures the seam color + width when set, and omits both keys when off', () => {
    const withSeam = makeDoc({
      lines: [makeLine({ id: 'l1', strokeWidth: 2, seamColor: '#abcdef80', seamWidth: 3 })],
    });
    expect(captureStyleProps(withSeam, 'line', 'l1')).toMatchObject({
      seamColor: '#abcdef80',
      seamWidth: 3,
    });
    // A seamless line captures NEITHER key (so it compares equal to a style that
    // never had one).
    const noSeam = captureStyleProps(makeDoc({ lines: [makeLine({ id: 'l1' })] }), 'line', 'l1');
    expect(noSeam).not.toHaveProperty('seamColor');
    expect(noSeam).not.toHaveProperty('seamWidth');
  });

  it('captures dash dimensions when set, and omits both keys when unset', () => {
    const withDash = makeDoc({
      lines: [makeLine({ id: 'l1', dashLength: 21, dashWidth: 3 })],
    });
    expect(captureStyleProps(withDash, 'line', 'l1')).toMatchObject({
      dashLength: 21,
      dashWidth: 3,
    });
    // A dash-dim-less line captures NEITHER key (so it compares equal to a
    // style that never had one).
    const plain = captureStyleProps(makeDoc({ lines: [makeLine({ id: 'l1' })] }), 'line', 'l1');
    expect(plain).not.toHaveProperty('dashLength');
    expect(plain).not.toHaveProperty('dashWidth');
  });

  it('captures only the covered label typography — width/leading/tracking stay per-label', () => {
    const doc = makeDoc({
      textLabels: [makeTextLabel({ id: 'g1', fontSize: 20, weight: 700, width: 200, leading: 2 })],
    });
    expect(captureStyleProps(doc, 'textLabel', 'g1')).toEqual({
      color: '#111111',
      darkColor: '#ffffff',
      fontSize: 20,
      weight: 700,
      italic: false,
      align: 'left',
    });
  });

  it('resolves absent polygon curveRadius/closed to 0/true', () => {
    const doc = makeDoc({ polygons: [makePolygon({ id: 'p1' })] });
    expect(captureStyleProps(doc, 'polygon', 'p1')).toEqual({
      fill: '#cfe3f2',
      stroke: '#000000',
      darkFill: '#cfe3f2',
      darkStroke: '#000000',
      strokeWidth: 1,
      curveRadius: 0,
      closed: true,
    });
  });

  it('reads a route bullet shape and size', () => {
    const doc = makeDoc({
      routeBullets: [makeRouteBullet({ id: 'b1', shape: 'diamond', size: 20 })],
    });
    expect(captureStyleProps(doc, 'routeBullet', 'b1')).toEqual({ shape: 'diamond', size: 20 });
  });

  it('resolves a transfer with no overrides to the constant defaults', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 's1' }), makeStation({ id: 's2' })],
      transfers: [makeTransfer({ id: 'x1' })],
    });
    expect(captureStyleProps(doc, 'transfer', 'x1')).toEqual({
      thickness: 2,
      color: { day: '#000000', night: '#000000' },
      strokeWidth: 0,
      strokeColor: { day: '#ffffff', night: '#ffffff' },
    });
  });

  it('prefers per-transfer overrides over the constant defaults', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 's1' }), makeStation({ id: 's2' })],
      transfers: [
        makeTransfer({ id: 'x1', thickness: 7, color: { day: '#ff0000', night: '#880000' } }),
      ],
    });
    expect(captureStyleProps(doc, 'transfer', 'x1')).toEqual({
      thickness: 7,
      color: { day: '#ff0000', night: '#880000' },
      strokeWidth: 0,
      strokeColor: { day: '#ffffff', night: '#ffffff' },
    });
  });

  it('reads a default-looking station as the factory typography', () => {
    const doc = makeDoc({ stations: [makeStation({ id: 's1' })] });
    expect(captureStyleProps(doc, 'station', 's1')).toEqual({
      fontSize: 12,
      weight: 400,
      italic: false,
      leading: 1,
      tracking: 0,
    });
  });

  it('reads explicit station typography, resolving absent fields to defaults', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 's1', fontSize: 20, weight: 700, tracking: 0.02 })],
    });
    expect(captureStyleProps(doc, 'station', 's1')).toEqual({
      fontSize: 20,
      weight: 700,
      italic: false,
      leading: 1,
      tracking: 0.02,
    });
  });

  it('returns null for a missing item', () => {
    const doc = makeDoc({});
    expect(captureStyleProps(doc, 'line', 'nope')).toBeNull();
  });
});

describe('stylePropsEqual — line covered fields', () => {
  it('distinguishes props differing only in curveRadius', () => {
    // The line branch compares an EXPLICIT field list — a covered field
    // missing from it makes curveRadius-only edits no-op in updateStyleProps
    // and invisible to the mismatched-tag pruning.
    const base = {
      singletonDotStyleId: DEFAULT_STOP_DOT_STYLE_ID,
      multiDotStyleId: DEFAULT_STOP_DOT_STYLE_ID,
      singletonDotSize: DOT_SIZE_DEFAULT,
      multiDotSize: DOT_SIZE_DEFAULT,
      width: LINE_WIDTH_DEFAULT,
      curveRadius: LINE_CURVE_RADIUS_DEFAULT,
      strokeWidth: 0,
      strokeColor: '#ffffff',
    };
    expect(stylePropsEqual('line', base, { ...base })).toBe(true);
    expect(stylePropsEqual('line', base, { ...base, curveRadius: 40 })).toBe(false);
    // The split dot SIZE fields are compared too — differing on either side is a
    // real difference (each is its own covered field).
    expect(stylePropsEqual('line', base, { ...base, multiDotSize: 12 })).toBe(false);
    expect(stylePropsEqual('line', base, { ...base, singletonDotSize: 12 })).toBe(false);
    // Dot TYPE (the split stopDot library ids) is covered now too, so differing
    // on either case is a real difference.
    expect(stylePropsEqual('line', base, { ...base, singletonDotStyleId: 'stop-none' })).toBe(
      false,
    );
    expect(stylePropsEqual('line', base, { ...base, multiDotStyleId: 'stop-none' })).toBe(false);
  });
});

describe('stylePropsEqual — transfer day/night colors', () => {
  const props = (
    color: { day: string; night: string },
    strokeColor: { day: string; night: string },
  ) => ({
    thickness: 2,
    color,
    strokeWidth: 0,
    strokeColor,
  });

  it('compares transfer colors STRUCTURALLY, not by reference', () => {
    // Distinct objects, equal values — the shape captureStyleProps vs a stored
    // def produces. A reference compare here would wrongly strip valid tags
    // (pruneDanglingStyleRefs) and block adoption (adoptDefaultStyles).
    const a = props({ day: '#000000', night: '#111111' }, { day: '#ffffff', night: '#eeeeee' });
    const b = props({ day: '#000000', night: '#111111' }, { day: '#ffffff', night: '#eeeeee' });
    expect(stylePropsEqual('transfer', a, b)).toBe(true);
  });

  it('is false when either color half diverges', () => {
    const base = props({ day: '#000000', night: '#111111' }, { day: '#ffffff', night: '#ffffff' });
    expect(
      stylePropsEqual(
        'transfer',
        base,
        props({ day: '#000000', night: '#999999' }, base.strokeColor),
      ),
    ).toBe(false);
    expect(
      stylePropsEqual('transfer', base, props(base.color, { day: '#ffffff', night: '#999999' })),
    ).toBe(false);
  });
});

describe('applyStyleToItem', () => {
  it('stamps a line style through the canonical setters and tags the line', () => {
    const style = makeStyle('line', 'y1', {
      props: {
        singletonDotSize: 12,
        multiDotSize: 16,
        width: 10,
        curveRadius: 40,
        strokeWidth: 2,
        strokeColor: '#123456',
      },
    });
    const doc = makeDoc({ lines: [makeLine({ id: 'l1' })], styles: [style] });
    const next = applyStyleToItem(doc, 'y1', 'l1');
    const line = next.lines.l1;
    expect(line.styleId).toBe('y1');
    expect(line.width).toBe(10);
    expect(line.curveRadius).toBe(40);
    expect(line.strokeWidth).toBe(2);
    expect(line.strokeColor).toBe('#123456');
    // Dot APPEARANCE is not a covered line-style field — only dot SIZE is stamped.
    expect(line.singletonDotSize).toBe(12);
    expect(line.multiDotSize).toBe(16);
  });

  it('stamps a style seam color + width, and stamping a seamless style clears both', () => {
    const seamStyle = makeStyle('line', 'y1', {
      props: { strokeWidth: 2, seamColor: '#abcdef80', seamWidth: 3 },
    });
    const doc = makeDoc({ lines: [makeLine({ id: 'l1' })], styles: [seamStyle] });
    const stamped = applyStyleToItem(doc, 'y1', 'l1').lines.l1;
    expect(stamped.seamColor).toBe('#abcdef80');
    expect(stamped.seamWidth).toBe(3);
    expect(stamped.styleId).toBe('y1');

    // A style with NO seam, stamped onto a line that HAS one, removes both.
    const plainStyle = makeStyle('line', 'y2', { props: { strokeWidth: 2 } });
    const doc2 = makeDoc({
      lines: [makeLine({ id: 'l1', seamColor: '#abcdef80', seamWidth: 3 })],
      styles: [plainStyle],
    });
    const cleared = applyStyleToItem(doc2, 'y2', 'l1').lines.l1;
    expect('seamColor' in cleared).toBe(false);
    expect('seamWidth' in cleared).toBe(false);
    expect(cleared.styleId).toBe('y2');
  });

  it('stamps dash dimensions, and stamping a style without them clears both', () => {
    const dashStyle = makeStyle('line', 'y1', {
      props: { dashLength: 21, dashWidth: 3 },
    });
    const doc = makeDoc({ lines: [makeLine({ id: 'l1' })], styles: [dashStyle] });
    const stamped = applyStyleToItem(doc, 'y1', 'l1').lines.l1;
    expect(stamped.dashLength).toBe(21);
    expect(stamped.dashWidth).toBe(3);
    expect(stamped.styleId).toBe('y1');

    // A style with NO dash dims, stamped onto a line that HAS them, removes
    // both (back to width-derived).
    const plainStyle = makeStyle('line', 'y2', { props: {} });
    const doc2 = makeDoc({
      lines: [makeLine({ id: 'l1', dashLength: 21, dashWidth: 3 })],
      styles: [plainStyle],
    });
    const cleared = applyStyleToItem(doc2, 'y2', 'l1').lines.l1;
    expect('dashLength' in cleared).toBe(false);
    expect('dashWidth' in cleared).toBe(false);
    expect(cleared.styleId).toBe('y2');
  });

  it('stores nothing for line values that equal the global defaults (canonical collapse)', () => {
    const style = makeStyle('line', 'y1'); // all-default props
    const doc = makeDoc({
      lines: [makeLine({ id: 'l1', width: 10, curveRadius: 40 })],
      styles: [style],
    });
    const next = applyStyleToItem(doc, 'y1', 'l1');
    const line = next.lines.l1;
    expect(line.styleId).toBe('y1');
    expect(line.width).toBeUndefined();
    expect(line.curveRadius).toBeUndefined();
    expect(line.strokeWidth).toBeUndefined();
    expect(line.strokeColor).toBeUndefined();
    // Dot SIZE collapses to absent at the default (never stored)…
    expect(line.singletonDotSize).toBeUndefined();
    expect(line.multiDotSize).toBeUndefined();
    // …but dot TYPE is a covered field whose split defaults are ALWAYS stored
    // (a default-tracking line stays tagged so editing the stopDot style
    // restamps it), so the ids + raw shadows are present, not collapsed.
    expect(line.singletonDotStyleId).toBe(DEFAULT_STOP_DOT_STYLE_ID);
    expect(line.multiDotStyleId).toBe(DEFAULT_STOP_DOT_STYLE_ID);
    expect(line.singletonDotStyle).toBeDefined();
    expect(line.multiDotStyle).toBeDefined();
  });

  it('applying a line style prunes now-redundant per-stop dot SIZE overrides', () => {
    // The station below is a singleton, so its dot-size override is pruned
    // against the style's SINGLETON dot size. (Dot APPEARANCE is not a covered
    // line-style field, so a line style never prunes per-stop dotStyle overrides.)
    const style = makeStyle('line', 'y1', {
      props: { singletonDotSize: 12 },
    });
    const doc = makeDoc({
      lines: [makeLine({ id: 'l1' })],
      stations: [
        makeStation({
          id: 's1',
          stops: [makeStop('l1', { dotSize: 12 })],
        }),
      ],
      styles: [style],
    });
    const next = applyStyleToItem(doc, 'y1', 'l1');
    expect(next.stations.s1.stops[0].dotSize).toBeUndefined();
  });

  it('stamps a text-label style and tags the label, leaving layout fields alone', () => {
    const style = makeStyle('textLabel', 'y1', {
      props: { fontSize: 24, weight: 700, italic: true, align: 'center' },
    });
    const doc = makeDoc({
      textLabels: [makeTextLabel({ id: 'g1', width: 200, leading: 1.5 })],
      styles: [style],
    });
    const next = applyStyleToItem(doc, 'y1', 'g1');
    const label = next.textLabels.g1;
    expect(label.styleId).toBe('y1');
    expect(label.fontSize).toBe(24);
    expect(label.weight).toBe(700);
    expect(label.italic).toBe(true);
    expect(label.align).toBe('center');
    expect(label.width).toBe(200); // per-label layout untouched
    expect(label.leading).toBe(1.5);
    expect(label.text).toBe('Label'); // content untouched
  });

  it('stamps a polygon style through the clamps and tags the polygon', () => {
    const style = makeStyle('polygon', 'y1', {
      props: { fill: '#00ff00', strokeWidth: 2.3, curveRadius: 8, closed: false },
    });
    const doc = makeDoc({ polygons: [makePolygon({ id: 'p1' })], styles: [style] });
    const next = applyStyleToItem(doc, 'y1', 'p1');
    const poly = next.polygons.p1;
    expect(poly.styleId).toBe('y1');
    expect(poly.fill).toBe('#00ff00');
    expect(poly.strokeWidth).toBe(2.25); // snapped to the 0.25 grid
    expect(poly.curveRadius).toBe(8);
    expect(poly.closed).toBe(false);
    expect(poly.vertices).toBe(doc.polygons.p1.vertices); // geometry untouched
  });

  it('stamps a route-bullet style with the size clamp and keeps lineId', () => {
    const style = makeStyle('routeBullet', 'y1', { props: { shape: 'square', size: 3 } });
    const doc = makeDoc({ routeBullets: [makeRouteBullet({ id: 'b1' })], styles: [style] });
    const next = applyStyleToItem(doc, 'y1', 'b1');
    const bullet = next.routeBullets.b1;
    expect(bullet.styleId).toBe('y1');
    expect(bullet.shape).toBe('square');
    expect(bullet.size).toBe(6); // clamped to ROUTE_BULLET_SIZE_MIN
    expect(bullet.lineId).toBe('l1');
  });

  it('stamps a transfer style as canonical overrides (collapsed at the constant defaults)', () => {
    const style = makeStyle('transfer', 'y1', {
      props: {
        thickness: 6,
        color: { day: '#000000', night: '#000000' },
        strokeWidth: 2,
        strokeColor: { day: '#ff00ff', night: '#ff00ff' },
      },
    });
    const doc = makeDoc({
      stations: [makeStation({ id: 's1' }), makeStation({ id: 's2' })],
      transfers: [makeTransfer({ id: 'x1' })],
      styles: [style],
    });
    const next = applyStyleToItem(doc, 'y1', 'x1');
    const t = next.transfers.x1;
    expect(t.styleId).toBe('y1');
    expect(t.thickness).toBe(6);
    expect(t.color).toBeUndefined(); // equals default (both halves) → tracks it
    expect(t.strokeWidth).toBe(2);
    expect(t.strokeColor).toEqual({ day: '#ff00ff', night: '#ff00ff' });
  });

  it('stamps a station style across all five typography fields and tags the station', () => {
    const style = makeStyle('station', 'y1', {
      props: { fontSize: 18, weight: 700, italic: true, leading: 1.2, tracking: 0.02 },
    });
    const doc = makeDoc({ stations: [makeStation({ id: 's1' })], styles: [style] });
    const next = applyStyleToItem(doc, 'y1', 's1');
    const st = next.stations.s1;
    expect(st.styleId).toBe('y1');
    expect(st.fontSize).toBe(18);
    expect(st.weight).toBe(700);
    expect(st.italic).toBe(true);
    expect(st.leading).toBe(1.2);
    expect(st.tracking).toBe(0.02);
    // tagged ⇒ matches: capture reproduces the style props exactly.
    expect(captureStyleProps(next, 'station', 's1')).toEqual(next.styles.y1.props);
  });

  it('stores nothing for station values that equal the LABEL_* defaults but still tags', () => {
    const style = makeStyle('station', 'y1'); // all-default props
    const doc = makeDoc({ stations: [makeStation({ id: 's1', fontSize: 20 })], styles: [style] });
    const next = applyStyleToItem(doc, 'y1', 's1');
    const st = next.stations.s1;
    expect(st.styleId).toBe('y1');
    expect(st.fontSize).toBeUndefined();
    expect(st.weight).toBeUndefined();
    expect(st.italic).toBeUndefined();
    expect(st.leading).toBeUndefined();
    expect(st.tracking).toBeUndefined();
  });

  it('no-ops (same reference) on unknown style, missing item, or a tagged MATCHING item', () => {
    const style = makeStyle('routeBullet', 'y1', { props: { shape: 'square', size: 14 } });
    const doc = makeDoc({
      routeBullets: [makeRouteBullet({ id: 'b1', shape: 'square', size: 14, styleId: 'y1' })],
      styles: [style],
    });
    expect(applyStyleToItem(doc, 'nope', 'b1')).toBe(doc);
    expect(applyStyleToItem(doc, 'y1', 'nope')).toBe(doc);
    expect(applyStyleToItem(doc, 'y1', 'b1')).toBe(doc);
  });

  it('re-stamps a tagged station whose typography drifted (invariant repair)', () => {
    const style = makeStyle('station', 'y1', { props: { fontSize: 20 } });
    const doc = makeDoc({
      stations: [makeStation({ id: 's1', fontSize: 14, styleId: 'y1' })],
      styles: [style],
    });
    const next = applyStyleToItem(doc, 'y1', 's1');
    expect(next.stations.s1.fontSize).toBe(20);
    expect(next.stations.s1.styleId).toBe('y1');
  });

  it('re-stamps a tagged item whose values drifted from the style (invariant repair)', () => {
    // Reachable via a stale clipboard paste: the payload froze the values
    // before the style was redefined. Re-applying the style must repair the
    // item, not early-out on the tag.
    const style = makeStyle('routeBullet', 'y1', { props: { shape: 'square', size: 20 } });
    const doc = makeDoc({
      routeBullets: [makeRouteBullet({ id: 'b1', shape: 'square', size: 12, styleId: 'y1' })],
      styles: [style],
    });
    const next = applyStyleToItem(doc, 'y1', 'b1');
    expect(next.routeBullets.b1.size).toBe(20);
    expect(next.routeBullets.b1.styleId).toBe('y1');
  });
});

describe('saveStyleFromItem', () => {
  it('captures effective props from the item, upserts the def, and tags the source', () => {
    const doc = makeDoc({
      textLabels: [makeTextLabel({ id: 'g1', fontSize: 24, weight: 700 })],
    });
    const next = saveStyleFromItem(doc, 'y1', 'textLabel', '  Heading  ', 'g1');
    const def = next.styles.y1;
    expect(def).toBeDefined();
    expect(def.name).toBe('Heading'); // trimmed
    expect(def.kind).toBe('textLabel');
    expect((def.props as TextLabelStyleProps).fontSize).toBe(24);
    expect(next.textLabels.g1.styleId).toBe('y1');
  });

  it('no-ops on an empty name, a missing item, or the reserved name "Custom"', () => {
    const doc = makeDoc({ textLabels: [makeTextLabel({ id: 'g1' })] });
    expect(saveStyleFromItem(doc, 'y1', 'textLabel', '   ', 'g1')).toBe(doc);
    expect(saveStyleFromItem(doc, 'y1', 'textLabel', 'Heading', 'nope')).toBe(doc);
    // "Custom" is the dropdown's detached sentinel — reserved in any case.
    expect(saveStyleFromItem(doc, 'y1', 'textLabel', 'Custom', 'g1')).toBe(doc);
    expect(saveStyleFromItem(doc, 'y1', 'textLabel', ' custom ', 'g1')).toBe(doc);
  });

  it('overwriting a style re-stamps every tagged user in the one returned doc', () => {
    const style = makeStyle('textLabel', 'y1', { name: 'Heading', props: { fontSize: 24 } });
    const doc = makeDoc({
      textLabels: [
        makeTextLabel({ id: 'g1', fontSize: 30, styleId: 'y1' }), // edited source (detached IRL, tag irrelevant)
        makeTextLabel({ id: 'g2', fontSize: 24, styleId: 'y1' }), // tagged user at old props
        makeTextLabel({ id: 'g3', fontSize: 11 }), // untagged bystander
      ],
      styles: [style],
    });
    const next = saveStyleFromItem(doc, 'y1', 'textLabel', 'Heading', 'g1');
    expect((next.styles.y1.props as TextLabelStyleProps).fontSize).toBe(30);
    expect(next.textLabels.g2.fontSize).toBe(30); // re-stamped
    expect(next.textLabels.g2.styleId).toBe('y1');
    expect(next.textLabels.g3).toBe(doc.textLabels.g3); // untouched, same reference
  });

  it('skips re-stamping users whose effective values already match (same reference)', () => {
    const style = makeStyle('textLabel', 'y1', { name: 'Heading', props: { fontSize: 24 } });
    const doc = makeDoc({
      textLabels: [
        makeTextLabel({ id: 'g1', fontSize: 24, styleId: 'y1' }),
        makeTextLabel({ id: 'g2', fontSize: 24, styleId: 'y1' }),
      ],
      styles: [style],
    });
    const next = saveStyleFromItem(doc, 'y1', 'textLabel', 'Heading', 'g1');
    expect(next.textLabels.g2).toBe(doc.textLabels.g2);
  });

  it('saving an unchanged style from an already-tagged matching item is a no-op', () => {
    const props = {
      color: '#111111',
      darkColor: '#ffffff',
      fontSize: 24,
      weight: 400,
      italic: false,
      align: 'left',
    } as const;
    const style = makeStyle('textLabel', 'y1', { name: 'Heading', props });
    const doc = makeDoc({
      textLabels: [makeTextLabel({ id: 'g1', fontSize: 24, styleId: 'y1' })],
      styles: [style],
    });
    expect(saveStyleFromItem(doc, 'y1', 'textLabel', 'Heading', 'g1')).toBe(doc);
  });

  it('re-stamps tagged transfers when a transfer style is redefined', () => {
    const style = makeStyle('transfer', 'y1', { name: 'Link', props: { thickness: 6 } });
    const doc = makeDoc({
      stations: [makeStation({ id: 's1' }), makeStation({ id: 's2' })],
      transfers: [
        makeTransfer({ id: 'x1', thickness: 9 }), // source, being saved from
        makeTransfer({ id: 'x2', thickness: 6, styleId: 'y1' }), // tagged user
      ],
      styles: [style],
    });
    const next = saveStyleFromItem(doc, 'y1', 'transfer', 'Link', 'x1');
    expect((next.styles.y1.props as TransferStyleProps).thickness).toBe(9);
    expect(next.transfers.x2.thickness).toBe(9);
    expect(next.transfers.x2.styleId).toBe('y1');
    expect(next.transfers.x1.styleId).toBe('y1');
  });
});

describe('renameStyle', () => {
  it('renames in place (id kept), trimming the name', () => {
    const doc = makeDoc({ styles: [makeStyle('line', 'y1', { name: 'Old' })] });
    const next = renameStyle(doc, 'y1', '  New  ');
    expect(next.styles.y1.name).toBe('New');
    expect(next.styles.y1.id).toBe('y1');
  });

  it('no-ops on empty, unknown id, or unchanged name', () => {
    const doc = makeDoc({ styles: [makeStyle('line', 'y1', { name: 'Old' })] });
    expect(renameStyle(doc, 'y1', '   ')).toBe(doc);
    expect(renameStyle(doc, 'nope', 'New')).toBe(doc);
    expect(renameStyle(doc, 'y1', 'Old')).toBe(doc);
  });

  it('refuses a name collision within the same kind, allows one across kinds', () => {
    const doc = makeDoc({
      styles: [
        makeStyle('line', 'y1', { name: 'A' }),
        makeStyle('line', 'y2', { name: 'B' }),
        makeStyle('polygon', 'y3', { name: 'C' }),
      ],
    });
    expect(renameStyle(doc, 'y2', 'A')).toBe(doc); // same-kind collision
    const next = renameStyle(doc, 'y2', 'C'); // cross-kind is fine
    expect(next.styles.y2.name).toBe('C');
  });

  it('refuses the reserved name "Custom" (the dropdown sentinel), any case', () => {
    const doc = makeDoc({ styles: [makeStyle('line', 'y1', { name: 'Old' })] });
    expect(renameStyle(doc, 'y1', 'Custom')).toBe(doc);
    expect(renameStyle(doc, 'y1', '  custom ')).toBe(doc);
  });
});

describe('deleteStyle', () => {
  it('removes the def and untags its users, keeping their values', () => {
    const style = makeStyle('routeBullet', 'y1', { props: { shape: 'square', size: 20 } });
    const doc = makeDoc({
      routeBullets: [
        makeRouteBullet({ id: 'b1', shape: 'square', size: 20, styleId: 'y1' }),
        makeRouteBullet({ id: 'b2' }),
      ],
      styles: [style, makeStyle('routeBullet', 'y2', { name: 'Other' })],
      styleDefaults: { routeBullet: 'y2' },
    });
    const next = deleteStyle(doc, 'y1');
    expect(next.styles.y1).toBeUndefined();
    expect(next.routeBullets.b1.styleId).toBeUndefined();
    expect(next.routeBullets.b1.shape).toBe('square');
    expect(next.routeBullets.b1.size).toBe(20);
    expect(next.routeBullets.b2).toBe(doc.routeBullets.b2);
    expect(next.styleDefaults).toBe(doc.styleDefaults); // default untouched
  });

  it('refuses (same reference) to delete the last style of a kind', () => {
    const doc = makeDoc({
      styles: [makeStyle('routeBullet', 'y1', { name: 'Only' })],
    });
    expect(deleteStyle(doc, 'y1')).toBe(doc);
  });

  it("re-points the kind's default at the first remaining style (name order) when deleting the default", () => {
    // Name order and record-insertion order deliberately DISAGREE (y3 'Alpha'
    // is inserted last), so this fails if the re-point ever reads unsorted.
    const doc = makeDoc({
      styles: [
        makeStyle('routeBullet', 'y1', { name: 'Zebra' }),
        makeStyle('routeBullet', 'y2', { name: 'Mid' }),
        makeStyle('routeBullet', 'y3', { name: 'Alpha' }),
      ],
      styleDefaults: { routeBullet: 'y1' },
    });
    const next = deleteStyle(doc, 'y1');
    expect(next.styleDefaults.routeBullet).toBe('y3'); // 'Alpha' sorts first
    // Other kinds' designations are untouched.
    expect(next.styleDefaults.line).toBe(doc.styleDefaults.line);
  });

  it('deleting the default with TAGGED USERS re-points AND untags in the same call', () => {
    // The common real case — the default is exactly the style most items
    // wear — must exercise the untagged=true return branch together with the
    // re-point (each alone passing is not enough).
    const doc = makeDoc({
      routeBullets: [makeRouteBullet({ id: 'b1', size: 20, styleId: 'y1' })],
      styles: [
        makeStyle('routeBullet', 'y1', { name: 'Big', props: { size: 20 } }),
        makeStyle('routeBullet', 'y2', { name: 'Other' }),
      ],
      styleDefaults: { routeBullet: 'y1' },
    });
    const next = deleteStyle(doc, 'y1');
    expect(next.routeBullets.b1.styleId).toBeUndefined();
    expect(next.routeBullets.b1.size).toBe(20); // values kept
    expect(next.styleDefaults.routeBullet).toBe('y2'); // re-pointed
  });

  it('no-ops on an unknown id', () => {
    const doc = makeDoc({});
    expect(deleteStyle(doc, 'nope')).toBe(doc);
  });
});

describe('setDefaultStyle', () => {
  it("designates the style as its kind's default", () => {
    const doc = makeDoc({
      styles: [
        makeStyle('textLabel', 'y1', { name: 'Default' }),
        makeStyle('textLabel', 'y2', { name: 'Heading' }),
      ],
    });
    expect(doc.styleDefaults.textLabel).toBe('y1');
    const next = setDefaultStyle(doc, 'y2');
    expect(next.styleDefaults.textLabel).toBe('y2');
    expect(next.styleDefaults.line).toBe(doc.styleDefaults.line);
    expect(next.styles).toBe(doc.styles); // defs untouched
  });

  it('no-ops (same reference) on an unknown id or the current default', () => {
    const doc = makeDoc({
      styles: [makeStyle('textLabel', 'y1', { name: 'Default' })],
    });
    expect(setDefaultStyle(doc, 'nope')).toBe(doc);
    expect(setDefaultStyle(doc, 'y1')).toBe(doc);
  });
});

describe('clearStyleTag', () => {
  it('drops the tag only', () => {
    const doc = makeDoc({
      textLabels: [makeTextLabel({ id: 'g1', fontSize: 24, styleId: 'y1' })],
      styles: [makeStyle('textLabel', 'y1')],
    });
    const next = clearStyleTag(doc, 'textLabel', 'g1');
    expect(next.textLabels.g1.styleId).toBeUndefined();
    expect(next.textLabels.g1.fontSize).toBe(24);
    expect(next.styles.y1).toBeDefined();
  });

  it('no-ops when the item is untagged or missing', () => {
    const doc = makeDoc({ textLabels: [makeTextLabel({ id: 'g1' })] });
    expect(clearStyleTag(doc, 'textLabel', 'g1')).toBe(doc);
    expect(clearStyleTag(doc, 'textLabel', 'nope')).toBe(doc);
  });
});

describe('createStyle', () => {
  it("adds a def with the kind's factory props under the given name", () => {
    const doc = makeDoc({});
    const next = createStyle(doc, 'y1', 'routeBullet', ' Big ');
    expect(next.styles.y1).toMatchObject({ id: 'y1', name: 'Big', kind: 'routeBullet' });
    expect(next.styles.y1.props).toEqual({ shape: 'circle', size: 14 });
  });

  it('refuses empty/reserved names, same-kind collisions, and taken ids', () => {
    const doc = makeDoc({ styles: [makeStyle('routeBullet', 'y1', { name: 'Big' })] });
    expect(createStyle(doc, 'y2', 'routeBullet', '  ')).toBe(doc);
    expect(createStyle(doc, 'y2', 'routeBullet', 'custom')).toBe(doc);
    expect(createStyle(doc, 'y2', 'routeBullet', 'Big')).toBe(doc);
    expect(createStyle(doc, 'y1', 'routeBullet', 'Other')).toBe(doc);
    // Cross-kind homonym is fine.
    expect(createStyle(doc, 'y2', 'polygon', 'Big').styles.y2.kind).toBe('polygon');
  });
});

describe('duplicateStyle', () => {
  it("copies the source's kind and props under a new id + name, not default, worn by nothing", () => {
    const doc = makeDoc({
      routeBullets: [makeRouteBullet({ id: 'b1', shape: 'square', size: 20, styleId: 'y1' })],
      styles: [
        makeStyle('routeBullet', 'y1', { name: 'Big', props: { shape: 'square', size: 20 } }),
      ],
      styleDefaults: { routeBullet: 'y1' },
    });
    const next = duplicateStyle(doc, 'y2', 'y1', 'Big copy');
    expect(next.styles.y2).toMatchObject({ id: 'y2', name: 'Big copy', kind: 'routeBullet' });
    // Props copied by value (deep-equal to the source's).
    expect(next.styles.y2.props).toEqual(doc.styles.y1.props);
    // The source def is untouched (same reference) and stays the default; the
    // copy does NOT steal the designation.
    expect(next.styles.y1).toBe(doc.styles.y1);
    expect(next.styleDefaults.routeBullet).toBe('y1');
    // Nothing is (re-)stamped: no item wears the new copy.
    expect(next.routeBullets.b1.styleId).toBe('y1');
  });

  it('trims the name', () => {
    const doc = makeDoc({ styles: [makeStyle('line', 'y1', { name: 'A' })] });
    expect(duplicateStyle(doc, 'y2', 'y1', '  B  ').styles.y2.name).toBe('B');
  });

  it('refuses a missing source, a taken id, empty/reserved names, and same-kind collisions', () => {
    const doc = makeDoc({
      styles: [
        makeStyle('routeBullet', 'y1', { name: 'Big' }),
        makeStyle('routeBullet', 'y2', { name: 'Small' }),
      ],
    });
    expect(duplicateStyle(doc, 'y3', 'nope', 'X')).toBe(doc); // missing source
    expect(duplicateStyle(doc, 'y2', 'y1', 'X')).toBe(doc); // taken id
    expect(duplicateStyle(doc, 'y3', 'y1', '  ')).toBe(doc); // empty name
    expect(duplicateStyle(doc, 'y3', 'y1', ' custom ')).toBe(doc); // reserved sentinel
    expect(duplicateStyle(doc, 'y3', 'y1', 'Small')).toBe(doc); // same-kind collision
    // A homonym across kinds is fine.
    expect(duplicateStyle(doc, 'y3', 'y1', 'Small').styles.y3).toBeUndefined();
    const withPoly = makeDoc({
      styles: [
        makeStyle('routeBullet', 'y1', { name: 'Big' }),
        makeStyle('polygon', 'p1', { name: 'Zone' }),
      ],
    });
    expect(duplicateStyle(withPoly, 'y3', 'y1', 'Zone').styles.y3.kind).toBe('routeBullet');
  });

  it('refuses to duplicate the reserved built-in stopDot "None"', () => {
    // makeDoc seeds the stopDot library, so both "None" and a normal entry exist.
    const doc = makeDoc({ styles: [makeStyle('stopDot', 'sd1', { name: 'Filled' })] });
    expect(duplicateStyle(doc, 'sd9', NONE_STOP_DOT_STYLE_ID, 'None copy')).toBe(doc);
    // A normal stopDot style CAN be duplicated (control for the guard above).
    expect(duplicateStyle(doc, 'sd9', 'sd1', 'Filled copy').styles.sd9).toMatchObject({
      kind: 'stopDot',
      name: 'Filled copy',
    });
  });
});

describe('updateStyleProps', () => {
  it('patches the def on the canonical grids and re-stamps its tagged users', () => {
    const doc = makeDoc({
      routeBullets: [
        makeRouteBullet({ id: 'b1', shape: 'square', size: 20, styleId: 'y1' }),
        makeRouteBullet({ id: 'b2', size: 9 }), // untagged bystander
      ],
      styles: [makeStyle('routeBullet', 'y1', { props: { shape: 'square', size: 20 } })],
    });
    const next = updateStyleProps(doc, 'y1', { size: 24.4 });
    expect((next.styles.y1.props as RouteBulletStyleProps).size).toBe(24.5); // snapped to 0.25
    expect(next.routeBullets.b1.size).toBe(24.5); // live re-stamp
    expect(next.routeBullets.b1.styleId).toBe('y1');
    expect(next.routeBullets.b2).toBe(doc.routeBullets.b2);
  });

  it('keeps id, name and unpatched props', () => {
    const doc = makeDoc({
      styles: [makeStyle('textLabel', 'y1', { name: 'Heading', props: { fontSize: 24 } })],
    });
    const next = updateStyleProps(doc, 'y1', { italic: true });
    expect(next.styles.y1).toMatchObject({ id: 'y1', name: 'Heading' });
    expect(next.styles.y1.props).toMatchObject({ fontSize: 24, italic: true });
  });

  it('no-ops (same reference) on unknown id or a value-identical patch', () => {
    const doc = makeDoc({
      styles: [makeStyle('routeBullet', 'y1', { props: { size: 20 } })],
    });
    expect(updateStyleProps(doc, 'nope', { size: 24 })).toBe(doc);
    expect(updateStyleProps(doc, 'y1', { size: 20 })).toBe(doc);
  });

  it('a detached (untagged) lookalike does NOT follow a style edit', () => {
    const doc = makeDoc({
      routeBullets: [makeRouteBullet({ id: 'b1', shape: 'square', size: 20 })], // matches y1 but untagged
      styles: [makeStyle('routeBullet', 'y1', { props: { shape: 'square', size: 20 } })],
    });
    const next = updateStyleProps(doc, 'y1', { size: 24 });
    expect(next.routeBullets.b1).toBe(doc.routeBullets.b1);
  });

  it('re-stamps tagged stations on a leading/tracking patch (station-only covered fields)', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 's1', styleId: 'y1' })], // all-default, tagged
      styles: [makeStyle('station', 'y1')],
    });
    const next = updateStyleProps(doc, 'y1', { leading: 1.5, fontSize: 20 });
    expect(next.styles.y1.props).toMatchObject({ leading: 1.5, fontSize: 20 });
    expect(next.stations.s1.leading).toBe(1.5); // live re-stamp
    expect(next.stations.s1.fontSize).toBe(20);
    expect(next.stations.s1.styleId).toBe('y1'); // stays tagged
  });
});

describe('DEFAULT_STYLES / applyDefaultStyle', () => {
  it('ships one factory "Default" per non-stopDot kind plus the pruned stopDot seed, and DEFAULT_DOC starts with exactly those designated', () => {
    // Every kind but stopDot ships exactly one style named "Default"; stopDot is
    // the outlier — it ships the pruned SEED (Filled black + reserved None), not
    // the whole known-preset catalog.
    const nonDot = Object.values(DEFAULT_STYLES).filter((d) => d.kind !== 'stopDot');
    const kinds = nonDot.map((d) => d.kind).sort();
    expect(kinds).toEqual(['line', 'polygon', 'routeBullet', 'station', 'textLabel', 'transfer']);
    for (const d of nonDot) expect(d.name).toBe('Default');
    // The stopDot entries are exactly the pruned seed, NOT every known preset.
    const dotStyles = Object.values(DEFAULT_STYLES).filter((d) => d.kind === 'stopDot');
    expect(dotStyles).toHaveLength(Object.keys(STOP_DOT_SEED_STYLES).length);
    expect(dotStyles.map((d) => d.id).sort()).toEqual(['stop-filled-black', 'stop-none']);
    expect(DEFAULT_DOC.styles).toBe(DEFAULT_STYLES);
    expect(DEFAULT_DOC.styleDefaults).toBe(FACTORY_STYLE_DEFAULTS);
    for (const [kind, id] of Object.entries(FACTORY_STYLE_DEFAULTS)) {
      expect(DEFAULT_STYLES[id]?.kind).toBe(kind);
    }
    // Factory props are the effective defaults a fresh item captures to —
    // spot-check one scalar per kind.
    expect(defaultStyleProps(DEFAULT_DOC, 'line')).toMatchObject({ width: LINE_WIDTH_DEFAULT });
    expect(defaultStyleProps(DEFAULT_DOC, 'textLabel')).toMatchObject({ fontSize: 16 });
    expect(defaultStyleProps(DEFAULT_DOC, 'polygon')).toMatchObject({ fill: '#cfe3f2' });
    expect(defaultStyleProps(DEFAULT_DOC, 'routeBullet')).toMatchObject({ size: 14 });
    expect(defaultStyleProps(DEFAULT_DOC, 'transfer')).toMatchObject({ thickness: 2 });
    expect(defaultStyleProps(DEFAULT_DOC, 'station')).toMatchObject({ fontSize: 12, weight: 400 });
  });

  it('stamps a customized default station style onto a new station', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 's1' })],
      styles: [
        makeStyle('station', 'default-station', { name: 'Default', props: { fontSize: 16 } }),
      ],
      styleDefaults: { station: 'default-station' },
    });
    const next = applyDefaultStyle(doc, 'station', 's1');
    expect(next.stations.s1.styleId).toBe('default-station');
    expect(next.stations.s1.fontSize).toBe(16);
  });

  it("stamps and tags the kind's DESIGNATED default, with its CURRENT props", () => {
    const doc = makeDoc({
      textLabels: [makeTextLabel({ id: 'g1' })],
      styles: [makeStyle('textLabel', 'y1', { name: 'Default', props: { fontSize: 24 } })],
    });
    const next = applyDefaultStyle(doc, 'textLabel', 'g1');
    expect(next.textLabels.g1.fontSize).toBe(24);
    expect(next.textLabels.g1.styleId).toBe('y1');
  });

  it('defaultness is id-keyed, not name-keyed: a renamed default still applies', () => {
    const doc = makeDoc({
      textLabels: [makeTextLabel({ id: 'g1' })],
      styles: [makeStyle('textLabel', 'y1', { name: 'Base', props: { fontSize: 24 } })],
      styleDefaults: { textLabel: 'y1' },
    });
    const next = applyDefaultStyle(doc, 'textLabel', 'g1');
    expect(next.textLabels.g1.fontSize).toBe(24);
    expect(next.textLabels.g1.styleId).toBe('y1');
  });

  it("no-ops (same reference) when the kind's designation doesn't resolve", () => {
    // No styles of the kind at all — the fixture's designation dangles.
    const doc = makeDoc({ textLabels: [makeTextLabel({ id: 'g1' })] });
    expect(applyDefaultStyle(doc, 'textLabel', 'g1')).toBe(doc);
    // A wrong-kind designation is guarded, not applied.
    const wrongKind = makeDoc({
      textLabels: [makeTextLabel({ id: 'g1' })],
      styles: [makeStyle('polygon', 'y1', { name: 'Zone' })],
      styleDefaults: { textLabel: 'y1' },
    });
    expect(applyDefaultStyle(wrongKind, 'textLabel', 'g1')).toBe(wrongKind);
  });
});

describe('adoptDefaultStyles', () => {
  it("tags untagged items whose values match their kind's Default, leaves the rest", () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 's1' }), makeStation({ id: 's2' })],
      lines: [makeLine({ id: 'l1' }), makeLine({ id: 'l2', width: 10 })],
      textLabels: [makeTextLabel({ id: 'g1' }), makeTextLabel({ id: 'g2', fontSize: 24 })],
      routeBullets: [makeRouteBullet({ id: 'b1', size: 14 })],
      transfers: [makeTransfer({ id: 'x1' })],
      polygons: [makePolygon({ id: 'p1', fill: '#123456' })],
      styles: Object.values(DEFAULT_STYLES),
    });
    const next = adoptDefaultStyles(doc);
    expect(next.lines.l1.styleId).toBe('default-line'); // factory look → adopted
    expect(next.lines.l2.styleId).toBeUndefined(); // width 10 ≠ Default
    expect(next.textLabels.g1.styleId).toBe('default-textLabel');
    expect(next.textLabels.g2.styleId).toBeUndefined();
    expect(next.routeBullets.b1.styleId).toBe('default-routeBullet');
    expect(next.transfers.x1.styleId).toBe('default-transfer');
    expect(next.polygons.p1.styleId).toBeUndefined();
  });

  it('never re-tags an already-tagged item and adopts values, not stored forms', () => {
    const doc = makeDoc({
      textLabels: [makeTextLabel({ id: 'g1', styleId: 'y1' })], // tagged elsewhere, values = factory
      styles: [...Object.values(DEFAULT_STYLES), makeStyle('textLabel', 'y1', { name: 'Mine' })],
    });
    expect(adoptDefaultStyles(doc).textLabels.g1.styleId).toBe('y1');
  });

  it('no-ops (same reference) when nothing adopts or no Default exists', () => {
    const noDefaults = makeDoc({ textLabels: [makeTextLabel({ id: 'g1' })] });
    expect(adoptDefaultStyles(noDefaults)).toBe(noDefaults);
    const nothingMatches = makeDoc({
      textLabels: [makeTextLabel({ id: 'g1', fontSize: 24 })],
      styles: Object.values(DEFAULT_STYLES),
    });
    expect(adoptDefaultStyles(nothingMatches)).toBe(nothingMatches);
  });
});

describe('stylesOfKind', () => {
  it('filters to the kind and sorts by name', () => {
    const styles = {
      y1: makeStyle('line', 'y1', { name: 'Zebra' }),
      y2: makeStyle('line', 'y2', { name: 'Alpha' }),
      y3: makeStyle('polygon', 'y3', { name: 'Middle' }),
    };
    expect(stylesOfKind(styles, 'line').map((d) => d.name)).toEqual(['Alpha', 'Zebra']);
    expect(stylesOfKind(styles, 'polygon').map((d) => d.name)).toEqual(['Middle']);
  });
});
