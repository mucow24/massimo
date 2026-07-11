// File-import hygiene for the Styles feature: styles round-trip through
// serialize/parse, malformed defs are dropped, numerics land on the canonical
// grids, and dangling / wrong-kind styleId tags are pruned.
import { describe, it, expect } from 'vitest';
import { parse, serialize } from './serialize';
import { applyStyleToItem } from './styles';
import type { MapDoc, TextLabelStyleProps } from './types';
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
  it('a doc with all five kinds of defs and tagged items survives serialize → parse', () => {
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
      ],
    });
    doc = applyStyleToItem(doc, 'y1', 'l1');
    doc = applyStyleToItem(doc, 'y2', 'g1');
    doc = applyStyleToItem(doc, 'y3', 'p1');
    doc = applyStyleToItem(doc, 'y4', 'b1');
    doc = applyStyleToItem(doc, 'y5', 'x1');
    const result = parse(serialize(doc));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.doc).toEqual(doc);
  });

  it('an older file without a styles field parses with an empty record', () => {
    const { styles: _gone, ...docWithout } = makeDoc({}) as MapDoc;
    expect(parsed(docWithout).styles).toEqual({});
  });
});

describe('sanitizeStyles via parse', () => {
  it('drops defs with unknown kind, empty name, or malformed props; keeps valid ones', () => {
    const good = makeStyle('routeBullet', 'y1', { name: 'Big', props: { size: 20 } });
    const doc = {
      ...makeDoc({}),
      styles: {
        y1: good,
        y2: { id: 'y2', name: 'Bad kind', kind: 'station', props: {} },
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
    expect(Object.keys(out.styles)).toEqual(['y1']);
    expect(out.styles.y1).toEqual(good);
  });

  it('replaces a non-record styles value with an empty record', () => {
    const out = parsed({ ...makeDoc({}), styles: [1, 2, 3] });
    expect(out.styles).toEqual({});
  });

  it('clamps numerics onto the canonical grids and lowercases the line casing color', () => {
    const doc = {
      ...makeDoc({}),
      styles: {
        y1: makeStyle('line', 'y1', {
          name: 'L',
          props: { width: 9.6, strokeWidth: 1.3, strokeColor: '#ABCDEF' },
        }),
        y2: makeStyle('textLabel', 'y2', {
          name: 'T',
          props: { fontSize: 12.1, width: 33.4, leading: 1.03, tracking: 0.0149 },
        }),
        y3: makeStyle('polygon', 'y3', { name: 'P', props: { strokeWidth: 2.3, curveRadius: -4 } }),
        y4: makeStyle('routeBullet', 'y4', { name: 'B', props: { size: 3 } }),
        y5: makeStyle('transfer', 'y5', { name: 'X', props: { thickness: 5.4, strokeWidth: -1 } }),
      },
    };
    const out = parsed(doc);
    expect(out.styles.y1.props).toMatchObject({
      width: 10,
      strokeWidth: 1.5,
      strokeColor: '#abcdef',
    });
    expect(out.styles.y2.props).toMatchObject({
      fontSize: 12,
      width: 33,
      leading: 1.05,
      tracking: 0.015,
    });
    expect(out.styles.y3.props).toMatchObject({ strokeWidth: 2.5, curveRadius: 0 });
    expect(out.styles.y4.props).toMatchObject({ size: 6 });
    expect(out.styles.y5.props).toMatchObject({ thickness: 5, strokeWidth: 0 });
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
    expect(Object.keys(out.styles).sort()).toEqual(['y1', 'y3']);
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
    expect(out.styles).toEqual({});
    expect(out.textLabels.g1.styleId).toBeUndefined();
  });

  it('strips a tag whose item values do not match the style (hand-edited file)', () => {
    // In-app the invariant is maintained by the transforms; only a hand-edited
    // file can carry a tagged-but-mismatched item. Loading one must not show a
    // style name over diverged values — the tag goes, the values stay.
    const doc = makeDoc({
      textLabels: [makeTextLabel({ id: 'g1', fontSize: 16, styleId: 'y1' })],
      styles: [makeStyle('textLabel', 'y1', { name: 'Heading', props: { fontSize: 24 } })],
    });
    const out = parsed(doc);
    expect(out.textLabels.g1.styleId).toBeUndefined();
    expect(out.textLabels.g1.fontSize).toBe(16);
  });

  it("drops a def wearing the reserved name 'Custom' (the dropdown sentinel)", () => {
    const doc = {
      ...makeDoc({}),
      styles: { y1: makeStyle('routeBullet', 'y1', { name: 'Custom' }) },
    };
    expect(parsed(doc).styles).toEqual({});
  });
});
