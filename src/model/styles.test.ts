import { describe, it, expect } from 'vitest';
import {
  applyDefaultStyle,
  applyStyleToItem,
  captureStyleProps,
  clearStyleTag,
  createStyle,
  defaultStyleProps,
  deleteStyle,
  renameStyle,
  saveStyleFromItem,
  stylesOfKind,
  updateStyleProps,
} from './styles';
import { DEFAULT_DOC, DEFAULT_STYLES } from './transforms';
import { DEFAULT_DOT_STYLE, DOT_SHAPE_PRESETS } from './dotStyle';
import { DOT_SIZE_DEFAULT } from './dotSize';
import { LINE_WIDTH_DEFAULT } from './lineWidth';
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
      defaultDotStyle: DEFAULT_DOT_STYLE,
      defaultDotSize: DOT_SIZE_DEFAULT,
      width: LINE_WIDTH_DEFAULT,
      strokeWidth: 0,
      strokeColor: '#ffffff',
    });
  });

  it('reads explicit line overrides verbatim', () => {
    const doc = makeDoc({
      lines: [
        makeLine({
          id: 'l1',
          defaultDotStyle: DOT_SHAPE_PRESETS['open-black'],
          defaultDotSize: 12,
          width: 10,
          strokeWidth: 1.5,
          strokeColor: '#123456',
        }),
      ],
    });
    expect(captureStyleProps(doc, 'line', 'l1')).toEqual({
      defaultDotStyle: DOT_SHAPE_PRESETS['open-black'],
      defaultDotSize: 12,
      width: 10,
      strokeWidth: 1.5,
      strokeColor: '#123456',
    });
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
      color: '#000000',
      strokeWidth: 0,
      strokeColor: '#ffffff',
    });
  });

  it('prefers per-transfer overrides over the constant defaults', () => {
    const doc = makeDoc({
      stations: [makeStation({ id: 's1' }), makeStation({ id: 's2' })],
      transfers: [makeTransfer({ id: 'x1', thickness: 7, color: '#ff0000' })],
    });
    expect(captureStyleProps(doc, 'transfer', 'x1')).toEqual({
      thickness: 7,
      color: '#ff0000',
      strokeWidth: 0,
      strokeColor: '#ffffff',
    });
  });

  it('returns null for a missing item', () => {
    const doc = makeDoc({});
    expect(captureStyleProps(doc, 'line', 'nope')).toBeNull();
  });
});

describe('applyStyleToItem', () => {
  it('stamps a line style through the canonical setters and tags the line', () => {
    const style = makeStyle('line', 'y1', {
      props: {
        defaultDotStyle: DOT_SHAPE_PRESETS['filled-white'],
        defaultDotSize: 12,
        width: 10,
        strokeWidth: 2,
        strokeColor: '#123456',
      },
    });
    const doc = makeDoc({ lines: [makeLine({ id: 'l1' })], styles: [style] });
    const next = applyStyleToItem(doc, 'y1', 'l1');
    const line = next.lines.l1;
    expect(line.styleId).toBe('y1');
    expect(line.width).toBe(10);
    expect(line.strokeWidth).toBe(2);
    expect(line.strokeColor).toBe('#123456');
    expect(line.defaultDotStyle).toEqual(DOT_SHAPE_PRESETS['filled-white']);
    expect(line.defaultDotSize).toBe(12);
  });

  it('stores nothing for line values that equal the global defaults (canonical collapse)', () => {
    const style = makeStyle('line', 'y1'); // all-default props
    const doc = makeDoc({ lines: [makeLine({ id: 'l1', width: 10 })], styles: [style] });
    const next = applyStyleToItem(doc, 'y1', 'l1');
    const line = next.lines.l1;
    expect(line.styleId).toBe('y1');
    expect(line.width).toBeUndefined();
    expect(line.strokeWidth).toBeUndefined();
    expect(line.strokeColor).toBeUndefined();
    expect(line.defaultDotStyle).toBeUndefined();
    expect(line.defaultDotSize).toBeUndefined();
  });

  it('applying a line style prunes now-redundant per-stop dot overrides', () => {
    const style = makeStyle('line', 'y1', {
      props: { defaultDotStyle: DOT_SHAPE_PRESETS['filled-white'], defaultDotSize: 12 },
    });
    const doc = makeDoc({
      lines: [makeLine({ id: 'l1' })],
      stations: [
        makeStation({
          id: 's1',
          stops: [makeStop('l1', { dotStyle: DOT_SHAPE_PRESETS['filled-white'], dotSize: 12 })],
        }),
      ],
      styles: [style],
    });
    const next = applyStyleToItem(doc, 'y1', 'l1');
    expect(next.stations.s1.stops[0].dotStyle).toBeUndefined();
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
    expect(poly.strokeWidth).toBe(2.5); // snapped to the 0.5 grid
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
      props: { thickness: 6, color: '#000000', strokeWidth: 2, strokeColor: '#ff00ff' },
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
    expect(t.color).toBeUndefined(); // equals doc setting → tracks it
    expect(t.strokeWidth).toBe(2);
    expect(t.strokeColor).toBe('#ff00ff');
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
      styles: [style],
    });
    const next = deleteStyle(doc, 'y1');
    expect(next.styles.y1).toBeUndefined();
    expect(next.routeBullets.b1.styleId).toBeUndefined();
    expect(next.routeBullets.b1.shape).toBe('square');
    expect(next.routeBullets.b1.size).toBe(20);
    expect(next.routeBullets.b2).toBe(doc.routeBullets.b2);
  });

  it('no-ops on an unknown id', () => {
    const doc = makeDoc({});
    expect(deleteStyle(doc, 'nope')).toBe(doc);
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
    expect((next.styles.y1.props as RouteBulletStyleProps).size).toBe(24); // rounded
    expect(next.routeBullets.b1.size).toBe(24); // live re-stamp
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
});

describe('DEFAULT_STYLES / applyDefaultStyle', () => {
  it('ships one factory "Default" per kind, and DEFAULT_DOC starts with exactly those', () => {
    const kinds = Object.values(DEFAULT_STYLES)
      .map((d) => d.kind)
      .sort();
    expect(kinds).toEqual(['line', 'polygon', 'routeBullet', 'textLabel', 'transfer']);
    for (const d of Object.values(DEFAULT_STYLES)) expect(d.name).toBe('Default');
    expect(DEFAULT_DOC.styles).toBe(DEFAULT_STYLES);
    // Factory props are the effective defaults a fresh item captures to —
    // spot-check one scalar per kind.
    expect(defaultStyleProps(DEFAULT_STYLES, 'line')).toMatchObject({ width: LINE_WIDTH_DEFAULT });
    expect(defaultStyleProps(DEFAULT_STYLES, 'textLabel')).toMatchObject({ fontSize: 16 });
    expect(defaultStyleProps(DEFAULT_STYLES, 'polygon')).toMatchObject({ fill: '#cfe3f2' });
    expect(defaultStyleProps(DEFAULT_STYLES, 'routeBullet')).toMatchObject({ size: 14 });
    expect(defaultStyleProps(DEFAULT_STYLES, 'transfer')).toMatchObject({ thickness: 2 });
  });

  it('stamps and tags the kind\'s style NAMED "Default", with its CURRENT props', () => {
    const doc = makeDoc({
      textLabels: [makeTextLabel({ id: 'g1' })],
      styles: [makeStyle('textLabel', 'y1', { name: 'Default', props: { fontSize: 24 } })],
    });
    const next = applyDefaultStyle(doc, 'textLabel', 'g1');
    expect(next.textLabels.g1.fontSize).toBe(24);
    expect(next.textLabels.g1.styleId).toBe('y1');
  });

  it('no-ops (same reference) when no style of the kind is named Default', () => {
    const doc = makeDoc({ textLabels: [makeTextLabel({ id: 'g1' })] });
    expect(applyDefaultStyle(doc, 'textLabel', 'g1')).toBe(doc);
    const renamed = makeDoc({
      textLabels: [makeTextLabel({ id: 'g1' })],
      styles: [makeStyle('textLabel', 'y1', { name: 'Base' })],
    });
    expect(applyDefaultStyle(renamed, 'textLabel', 'g1')).toBe(renamed);
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
