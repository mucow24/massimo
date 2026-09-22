import { describe, it, expect } from 'vitest';
import { serialize, parse, SCHEMA_FORMAT } from './serialize';
import { TEXT_LABEL_DEFAULTS } from './transforms';
import { makeDoc, makeStation, makeStyle, makeTextLabel } from '../test/fixtures';
import type { TextLabelStyleProps } from './types';

describe('text-label color serialization', () => {
  it('round-trips day/night colors distinct from each other', () => {
    const doc = makeDoc({
      textLabels: [makeTextLabel({ id: 'g1', color: '#112233', darkColor: '#445566' })],
    });
    const result = parse(serialize(doc));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const g = result.doc.textLabels['g1'];
    expect(g.color).toBe('#112233');
    expect(g.darkColor).toBe('#445566');
  });

  it('backfills missing colors on load to the theme-matching defaults', () => {
    const legacy = JSON.stringify({
      format: SCHEMA_FORMAT,
      doc: {
        stations: {},
        lines: {},
        lineOrder: [],
        textLabels: {
          g1: {
            id: 'g1',
            x: 10,
            y: 20,
            rotation: 0,
            text: 'Old Label',
            fontSize: 16,
            weight: 400,
            italic: false,
            align: 'left',
            // no color / darkColor — saved before these fields existed
          },
        },
      },
    });
    const result = parse(legacy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.textLabels['g1'].color).toBe('#000000');
    expect(result.doc.textLabels['g1'].darkColor).toBe('#ffffff');
  });
});

describe('station label autoAlign serialization', () => {
  it('round-trips the flag and H/V overrides (sanitizeStations must not strip them)', () => {
    const doc = makeDoc({
      stations: [
        makeStation({
          id: 's1',
          label: {
            row: 0,
            col: -1,
            rotation: 0,
            offset: 0,
            align: 'auto',
            valign: 'middle',
            autoAlign: true,
            autoHAlign: 'end',
            autoVAlign: 'down',
          },
        }),
      ],
    });
    const result = parse(serialize(doc));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.stations['s1'].label.autoAlign).toBe(true);
    expect(result.doc.stations['s1'].label.autoHAlign).toBe('end');
    expect(result.doc.stations['s1'].label.autoVAlign).toBe('down');
  });

  it('legacy saves without the field load with it absent (off)', () => {
    const legacy = JSON.stringify({
      format: SCHEMA_FORMAT,
      doc: {
        stations: {
          s1: {
            id: 's1',
            name: 'Foo',
            x: 0,
            y: 0,
            rotation: 0,
            stops: [],
            label: { row: 0, col: -1, rotation: 0, offset: 0, align: 'auto', valign: 'middle' },
          },
        },
        lines: {},
        lineOrder: [],
      },
    });
    const result = parse(legacy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.doc.stations['s1'].label.autoAlign).toBeUndefined();
  });
});

// `align`/`valign` are STORED string unions with no schema bump behind them, so
// a hand-edited or foreign file can carry any string at all. Left standing, one
// falls through `labelLayout`'s valign ladder to the `middle` arm — the label
// silently lays out under an alignment the user never picked, and the picker
// shows no segment selected. The gate is by MEMBERSHIP and ungated on version,
// because a bad value is not tied to any schema era.
describe('station label align/valign membership gate', () => {
  const fileWithLabel = (label: Record<string, unknown>): string =>
    JSON.stringify({
      format: SCHEMA_FORMAT,
      doc: {
        stations: {
          s1: { id: 's1', name: 'Foo', x: 0, y: 0, rotation: 0, stops: [], label },
        },
        lines: {},
        lineOrder: [],
      },
    });

  const labelOf = (json: string) => {
    const r = parse(json);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    return r.doc.stations['s1'].label;
  };

  const plain = { row: 0, col: -1, rotation: 0, offset: 0 };

  it('heals a non-member align to auto', () => {
    const lab = labelOf(fileWithLabel({ ...plain, align: 'sideways', valign: 'auto-down' }));
    expect(lab.align).toBe('auto');
  });

  it('heals a non-member valign to auto-down', () => {
    const lab = labelOf(fileWithLabel({ ...plain, align: 'auto', valign: 'skew' }));
    expect(lab.valign).toBe('auto-down');
  });

  it('heals the legacy single "auto" valign to auto-down (it is not a member either)', () => {
    const lab = labelOf(fileWithLabel({ ...plain, align: 'auto', valign: 'auto' }));
    expect(lab.valign).toBe('auto-down');
  });

  it('heals a wrong-typed align/valign rather than letting it reach the layout', () => {
    const lab = labelOf(fileWithLabel({ ...plain, align: 7, valign: null }));
    expect(lab.align).toBe('auto');
    expect(lab.valign).toBe('auto-down');
  });

  it('leaves every ladder member untouched', () => {
    for (const align of ['auto', 'start', 'middle', 'end'] as const) {
      expect(labelOf(fileWithLabel({ ...plain, align, valign: 'auto-down' })).align).toBe(align);
    }
    for (const valign of ['auto-down', 'top', 'middle', 'bottom', 'auto-up'] as const) {
      expect(labelOf(fileWithLabel({ ...plain, align: 'auto', valign })).valign).toBe(valign);
    }
  });

  it('leaves the rest of the label alone while healing', () => {
    const lab = labelOf(
      fileWithLabel({ row: 2, col: 3, rotation: 5, offset: 4, align: 'nope', valign: 'nope' }),
    );
    expect(lab.row).toBe(2);
    expect(lab.col).toBe(3);
    expect(lab.rotation).toBe(5);
    expect(lab.offset).toBe(4);
  });

  // The wand's two multi-line tuning fields are stored unions just like
  // align/valign, and both are OPTIONAL — absent means "auto" (octant-derived),
  // so a non-member heals by being dropped rather than replaced. Left standing,
  // `autoHAlign` is written to the `<text>` element's `text-anchor` verbatim
  // (labelLayout's `textAnchor`), and `autoVAlign` decides which line of a
  // block anchors.
  it('drops a non-member autoHAlign / autoVAlign back to auto', () => {
    const lab = labelOf(
      fileWithLabel({
        ...plain,
        align: 'auto',
        valign: 'auto-down',
        autoHAlign: 'banana',
        autoVAlign: 'sideways',
      }),
    );
    expect(lab.autoHAlign).toBeUndefined();
    expect(lab.autoVAlign).toBeUndefined();
  });

  it('drops a wrong-typed autoHAlign / autoVAlign', () => {
    const lab = labelOf(
      fileWithLabel({
        ...plain,
        align: 'auto',
        valign: 'auto-down',
        autoHAlign: 7,
        autoVAlign: {},
      }),
    );
    expect(lab.autoHAlign).toBeUndefined();
    expect(lab.autoVAlign).toBeUndefined();
  });

  it('leaves every auto-tuning ladder member untouched', () => {
    for (const autoHAlign of ['start', 'middle', 'end'] as const) {
      expect(
        labelOf(fileWithLabel({ ...plain, align: 'auto', valign: 'auto-down', autoHAlign }))
          .autoHAlign,
      ).toBe(autoHAlign);
    }
    for (const autoVAlign of ['up', 'down'] as const) {
      expect(
        labelOf(fileWithLabel({ ...plain, align: 'auto', valign: 'auto-down', autoVAlign }))
          .autoVAlign,
      ).toBe(autoVAlign);
    }
  });
});

// '#111111' was the built-in text-label day default until it was retired for
// pure black (it prints as ~93% K, not 100% K). Files saved under the old
// default carry it in every label and textLabel def; version-3 files carry it
// only where it was picked on purpose, so the rewrite is gated on the file's
// own version — the same gate `migrateLegacyBulletSyntax` uses.
describe('near-black text-label default retired to pure black (file version < 3)', () => {
  const file = (version: number, color: string) =>
    JSON.stringify({
      format: SCHEMA_FORMAT,
      version,
      doc: {
        stations: {},
        lines: {},
        lineOrder: [],
        textLabels: { g1: makeTextLabel({ id: 'g1', color, darkColor: '#ffffff' }) },
        styles: { t: makeStyle('textLabel', 't', { props: { color } }) },
      },
    });
  const load = (json: string) => {
    const result = parse(json);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    return result.doc;
  };

  it('rewrites a version-2 file: stored labels and textLabel defs move together', () => {
    const doc = load(file(2, '#111111'));
    expect(doc.textLabels.g1.color).toBe('#000000');
    expect((doc.styles.t.props as TextLabelStyleProps).color).toBe('#000000');
  });

  it('leaves a picked color alone', () => {
    expect(load(file(2, '#123456')).textLabels.g1.color).toBe('#123456');
  });

  it('leaves version-3 files untouched (#111111 is a picked color there)', () => {
    const doc = load(file(3, '#111111'));
    expect(doc.textLabels.g1.color).toBe('#111111');
    expect((doc.styles.t.props as TextLabelStyleProps).color).toBe('#111111');
  });

  it('writes files at version 3', () => {
    expect(JSON.parse(serialize(makeDoc({}))).version).toBe(3);
  });

  it('leaves a swatch-linked slot alone — a ref is a pick, however the hex reads', () => {
    const ref = { palette: 'p', swatch: 's' };
    const raw = JSON.parse(file(2, '#111111'));
    raw.doc.palettes = [{ name: 'p', kind: 'design', swatches: [{ name: 's', color: '#111111' }] }];
    raw.doc.textLabels.g1.colorRef = ref;
    raw.doc.styles.t.props.colorRef = ref;
    const doc = load(JSON.stringify(raw));
    expect(doc.textLabels.g1.color).toBe('#111111');
    expect(doc.textLabels.g1.colorRef).toEqual(ref);
    expect((doc.styles.t.props as TextLabelStyleProps).color).toBe('#111111');
  });

  it('runs before adoption, so a legacy label in a pre-styles file lands on the Default def', () => {
    const preStyles = (color: string) =>
      JSON.stringify({
        format: SCHEMA_FORMAT,
        version: 2,
        doc: {
          stations: {},
          lines: {},
          lineOrder: [],
          textLabels: {
            g1: makeTextLabel({ id: 'g1', ...TEXT_LABEL_DEFAULTS, color, darkColor: '#ffffff' }),
          },
        },
      });
    const doc = load(preStyles('#111111'));
    expect(doc.textLabels.g1.color).toBe('#000000');
    const def = doc.styleDefaults.textLabel;
    expect(doc.textLabels.g1.styleId).toBe(def);
    expect((doc.styles[def].props as TextLabelStyleProps).color).toBe('#000000');
    // Any other color is no default and does not adopt: the pin above is the
    // rewrite landing first, not adoption being generous.
    expect(load(preStyles('#101010')).textLabels.g1.styleId).toBeUndefined();
  });
});
