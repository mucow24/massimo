import { describe, it, expect } from 'vitest';
import * as T from './transforms';
import { applyStyleToItem, captureStyleProps, styleFieldsDiff, updateStyleProps } from './styles';
import { parse, serialize } from './serialize';
import { migrateDoc } from '../state/store';
import { makeDoc, makeStyle, makeTextLabel } from '../test/fixtures';
import type { MapDoc, StyleDef, TextLabelStyleProps } from './types';

// Width / leading / tracking joined the covered textLabel style fields — a
// style can now set the layout defaults a label then pins per-item.

// A textLabel def as saves from BEFORE the coverage carried it: the six
// original fields only.
const legacyDef = (id: string, name: string, over: Partial<TextLabelStyleProps> = {}): StyleDef =>
  ({
    id,
    name,
    kind: 'textLabel',
    props: {
      color: '#111111',
      darkColor: '#ffffff',
      fontSize: 16,
      weight: 400,
      italic: false,
      align: 'left',
      ...over,
    },
  }) as StyleDef;

describe('width / leading / tracking are covered textLabel style fields', () => {
  it('capture reads the effective layout values (absent ⇒ auto/neutral)', () => {
    const doc = makeDoc({
      textLabels: [makeTextLabel({ id: 'a', width: 200, leading: 1.4 })],
    });
    const props = captureStyleProps(doc, 'textLabel', 'a')! as TextLabelStyleProps;
    expect(props.width).toBe(200);
    expect(props.leading).toBe(1.4);
    expect(props.tracking).toBe(T.TEXT_LABEL_TRACKING_DEFAULT);
  });

  it('a def edit propagates per-field; a per-label pin survives', () => {
    let doc = makeDoc({
      textLabels: [makeTextLabel({ id: 'a' }), makeTextLabel({ id: 'b' })],
      styles: [makeStyle('textLabel', 'y1')],
    });
    doc = applyStyleToItem(doc, 'y1', 'a');
    doc = applyStyleToItem(doc, 'y1', 'b');
    doc = T.updateTextLabel(doc, 'b', { leading: 1.5 }); // b pins leading
    doc = updateStyleProps(doc, 'y1', { leading: 1.3, tracking: 0.05 });
    expect(doc.textLabels.a.leading).toBe(1.3);
    expect(doc.textLabels.a.tracking).toBe(0.05);
    expect(doc.textLabels.b.leading).toBe(1.5); // pin survives
    expect(doc.textLabels.b.tracking).toBe(0.05);
    expect(doc.textLabels.b.styleId).toBe('y1');
  });

  it('applying a style stamps its layout fields onto the label', () => {
    let doc = makeDoc({
      textLabels: [makeTextLabel({ id: 'a' })],
      styles: [makeStyle('textLabel', 'y1', { props: { width: 150, leading: 1.3 } })],
    });
    doc = applyStyleToItem(doc, 'y1', 'a');
    expect(doc.textLabels.a.width).toBe(150);
    expect(doc.textLabels.a.leading).toBe(1.3);
  });

  it('a def from before the coverage compares absent ≡ auto/neutral (no phantom overrides)', () => {
    const doc = makeDoc({
      textLabels: [makeTextLabel({ id: 'a' })], // width/leading/tracking absent
    });
    const def = legacyDef('y1', 'Old');
    const props = captureStyleProps(doc, 'textLabel', 'a')!;
    expect(styleFieldsDiff('textLabel', props, def.props)).toEqual([]);
  });
});

describe('pre-coverage defs are backfilled with the AVERAGE of their wearers', () => {
  const legacyDoc = (): MapDoc => {
    const doc = makeDoc({
      textLabels: [
        // a: width 0 (auto), leading absent (⇒ 1), tracking absent (⇒ 0)
        makeTextLabel({ id: 'a', styleId: 'y1' }),
        // b: width 300, leading 1.5, tracking 0.02
        makeTextLabel({ id: 'b', styleId: 'y1', width: 300, leading: 1.5, tracking: 0.02 }),
        // c: untagged — never counted
        makeTextLabel({ id: 'c', width: 999 }),
      ],
    });
    return { ...doc, styles: { ...doc.styles, y1: legacyDef('y1', 'Heading') } };
  };

  it('migrateDoc averages wearers into the def and leaves the items alone', () => {
    const out = migrateDoc(legacyDoc(), 27);
    const props = out.styles!.y1.props as TextLabelStyleProps;
    expect(props.width).toBe(150); // (0 + 300) / 2
    expect(props.leading).toBe(1.25); // (1 + 1.5) / 2
    expect(props.tracking).toBe(0.01); // (0 + 0.02) / 2
    // Items keep their values — the halves that differ are overrides now.
    expect(out.textLabels!.a.width).toBeUndefined();
    expect(out.textLabels!.b.width).toBe(300);
    expect(out.textLabels!.a.styleId).toBe('y1');
    expect(out.textLabels!.b.styleId).toBe('y1');
  });

  it('a wearer-less def backfills at auto/neutral', () => {
    const doc = makeDoc({});
    const out = migrateDoc({ ...doc, styles: { y1: legacyDef('y1', 'Lonely') } }, 27);
    const props = out.styles!.y1.props as TextLabelStyleProps;
    expect(props.width).toBe(0);
    expect(props.leading).toBe(T.TEXT_LABEL_LEADING_DEFAULT);
    expect(props.tracking).toBe(T.TEXT_LABEL_TRACKING_DEFAULT);
  });

  it('a def already carrying the fields is left alone', () => {
    const doc = makeDoc({
      textLabels: [makeTextLabel({ id: 'a', styleId: 'y1', width: 300, tracking: 0.15 })],
    });
    const withFields = {
      ...doc,
      styles: { ...doc.styles, y1: legacyDef('y1', 'Kept', { width: 42, leading: 1.1 }) },
    };
    const out = migrateDoc(withFields, 27);
    const props = out.styles!.y1.props as TextLabelStyleProps;
    expect(props.width).toBe(42); // stored value wins over the average
    expect(props.leading).toBe(1.1);
    expect(props.tracking).toBe(0.15); // only the MISSING field averages: a's 0.15
  });

  it('parse runs the same backfill on file open', () => {
    const r = parse(serialize(legacyDoc()));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const props = r.doc.styles.y1.props as TextLabelStyleProps;
    expect(props.width).toBe(150);
    expect(props.leading).toBe(1.25);
    // Items untouched; the diff is now the override.
    expect(r.doc.textLabels.b.width).toBe(300);
    expect(r.doc.textLabels.b.styleId).toBe('y1');
    // Round-trip: baked once, stable thereafter.
    const r2 = parse(serialize(r.doc));
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.doc.styles.y1.props).toEqual(r.doc.styles.y1.props);
  });
});
