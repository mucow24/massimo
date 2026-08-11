import { describe, it, expect } from 'vitest';
import * as T from './transforms';
import {
  applyStyleToItem,
  captureStyleProps,
  clearStyleTag,
  saveStyleFromItem,
  stylePropsEqual,
  updateStyleProps,
} from './styles';
import { parse, serialize } from './serialize';
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
import type { MapDoc, TextLabelStyleProps } from './types';

// Two tagged text labels wearing y1, before any divergence.
const twoLabels = (): MapDoc => {
  let doc = makeDoc({
    textLabels: [makeTextLabel({ id: 'a' }), makeTextLabel({ id: 'b' })],
    styles: [makeStyle('textLabel', 'y1')],
  });
  doc = applyStyleToItem(doc, 'y1', 'a');
  doc = applyStyleToItem(doc, 'y1', 'b');
  return doc;
};

describe('covered edits keep the style tag — divergence is a per-field override', () => {
  it('line: a width edit keeps the tag over diverged values', () => {
    const doc0 = makeDoc({
      lines: [makeLine({ id: 'l1', singletonDotSize: 8, multiDotSize: 8 })],
      styles: [makeStyle('line', 'y1')],
    });
    let doc = applyStyleToItem(doc0, 'y1', 'l1');
    expect(doc.lines.l1.styleId).toBe('y1');
    doc = T.setLineWidth(doc, 'l1', 21);
    expect(doc.lines.l1.styleId).toBe('y1');
    expect(doc.lines.l1.width).toBe(21);
    expect(
      stylePropsEqual('line', captureStyleProps(doc, 'line', 'l1')!, doc.styles.y1.props),
    ).toBe(false);
  });

  it('textLabel: a weight edit keeps the tag', () => {
    let doc = twoLabels();
    doc = T.updateTextLabel(doc, 'b', { weight: 700 });
    expect(doc.textLabels.b.styleId).toBe('y1');
    expect(doc.textLabels.b.weight).toBe(700);
  });

  it('station: a typography edit keeps the tag', () => {
    let doc = makeDoc({
      stations: [makeStation({ id: 's' })],
      styles: [makeStyle('station', 'y1')],
    });
    doc = applyStyleToItem(doc, 'y1', 's');
    expect(doc.stations.s.styleId).toBe('y1');
    doc = T.updateStationLabelStyle(doc, 's', { weight: 700 });
    expect(doc.stations.s.styleId).toBe('y1');
    expect(doc.stations.s.weight).toBe(700);
  });

  it('polygon: a fill edit keeps the tag', () => {
    let doc = makeDoc({
      polygons: [makePolygon({ id: 'p' })],
      styles: [makeStyle('polygon', 'y1')],
    });
    doc = applyStyleToItem(doc, 'y1', 'p');
    doc = T.updatePolygon(doc, 'p', { fill: '#ff0000' });
    expect(doc.polygons.p.styleId).toBe('y1');
  });

  it('routeBullet: a size edit keeps the tag', () => {
    let doc = makeDoc({
      routeBullets: [makeRouteBullet({ id: 'rb', shape: 'circle', size: 14 })],
      styles: [makeStyle('routeBullet', 'y1')],
    });
    doc = applyStyleToItem(doc, 'y1', 'rb');
    doc = T.updateRouteBullet(doc, 'rb', { size: 18 });
    expect(doc.routeBullets.rb.styleId).toBe('y1');
  });

  it('transfer: a thickness edit keeps the tag', () => {
    let doc = makeDoc({
      stations: [makeStation({ id: 's1' }), makeStation({ id: 's2' })],
      transfers: [makeTransfer({ id: 't' })],
      styles: [makeStyle('transfer', 'y1')],
    });
    doc = applyStyleToItem(doc, 'y1', 't');
    doc = T.updateTransferStyle(doc, 't', { thickness: 4 });
    expect(doc.transfers.t.styleId).toBe('y1');
  });

  it('choosing Custom in the dropdown still detaches (the explicit path survives)', () => {
    let doc = twoLabels();
    doc = clearStyleTag(doc, 'textLabel', 'a');
    expect(doc.textLabels.a.styleId).toBeUndefined();
  });
});

describe('style edits propagate per-field; overridden fields survive', () => {
  it('a non-overridden field follows the style onto every wearer', () => {
    let doc = twoLabels();
    doc = T.updateTextLabel(doc, 'b', { weight: 700 }); // override on b
    doc = updateStyleProps(doc, 'y1', { fontSize: 20 });
    expect(doc.textLabels.a.fontSize).toBe(20);
    expect(doc.textLabels.b.fontSize).toBe(20);
    expect(doc.textLabels.b.weight).toBe(700);
    expect(doc.textLabels.b.styleId).toBe('y1');
  });

  it("editing the overridden field itself leaves the wearer's override in place", () => {
    let doc = twoLabels();
    doc = T.updateTextLabel(doc, 'b', { weight: 700 });
    doc = updateStyleProps(doc, 'y1', { weight: 300 });
    expect(doc.textLabels.a.weight).toBe(300);
    expect(doc.textLabels.b.weight).toBe(700);
    expect(doc.textLabels.b.styleId).toBe('y1');
  });

  it('an override dissolves when the style moves to its exact value', () => {
    let doc = twoLabels();
    doc = T.updateTextLabel(doc, 'b', { weight: 700 });
    // The style catches up to b's value — equal values mean no override…
    doc = updateStyleProps(doc, 'y1', { weight: 700 });
    expect(doc.textLabels.b.weight).toBe(700);
    // …so the NEXT weight edit carries b along.
    doc = updateStyleProps(doc, 'y1', { weight: 300 });
    expect(doc.textLabels.b.weight).toBe(300);
  });

  it('re-applying the style clears every override (Revert to style)', () => {
    let doc = twoLabels();
    doc = T.updateTextLabel(doc, 'b', { weight: 700 });
    doc = applyStyleToItem(doc, 'y1', 'b');
    expect(doc.textLabels.b.weight).toBe(400);
    expect(doc.textLabels.b.styleId).toBe('y1');
  });

  it('line wearers: a def width edit respects a per-line width override', () => {
    let doc = makeDoc({
      lines: [
        makeLine({ id: 'l1', singletonDotSize: 8, multiDotSize: 8 }),
        makeLine({ id: 'l2', singletonDotSize: 8, multiDotSize: 8 }),
      ],
      styles: [makeStyle('line', 'y1')],
    });
    doc = applyStyleToItem(doc, 'y1', 'l1');
    doc = applyStyleToItem(doc, 'y1', 'l2');
    doc = T.setLineWidth(doc, 'l2', 21); // override
    doc = updateStyleProps(doc, 'y1', { width: 10, curveRadius: 40 });
    expect(doc.lines.l1.width).toBe(10);
    expect(doc.lines.l2.width).toBe(21); // override survives
    expect(doc.lines.l2.curveRadius).toBe(40); // non-overridden field followed
    expect(doc.lines.l2.styleId).toBe('y1');
  });
});

describe('propagation never moves a field its override snapshot excluded', () => {
  // The dot-TYPE setters carry a courtesy size write for DIRECT picks (a size
  // sitting at the old type's natural follows to the new type's). The styles
  // engine must NOT inherit it: its snapshot already decided the size is a
  // pin, and a courtesy jump would move it to a value neither the user nor
  // the style chose.
  const pinnedWearer = (): MapDoc => {
    let doc = makeDoc({
      lines: [makeLine({ id: 'l1', singletonDotSize: 8, multiDotSize: 8 })],
      styles: [
        makeStyle('line', 'y1', { props: { singletonDotSize: 10 } }),
        makeStyle('stopDot', 'svc', { props: { showServiceCode: true } }),
      ],
    });
    doc = applyStyleToItem(doc, 'y1', 'l1'); // stamps singleton size 10
    // Pin the size back to 8 — which HAPPENS to be the plain type's natural.
    doc = T.setLineSingletonDotSize(doc, 'l1', 8);
    expect(doc.lines.l1.styleId).toBe('y1');
    expect(doc.lines.l1.singletonDotSize).toBe(8);
    return doc;
  };

  it("a def dot-TYPE edit keeps the wearer's pinned size", () => {
    const doc = updateStyleProps(pinnedWearer(), 'y1', { singletonDotStyleId: 'svc' });
    expect(doc.lines.l1.singletonDotStyleId).toBe('svc'); // type followed
    expect(doc.lines.l1.singletonDotSize).toBe(8); // pin untouched (courtesy would say 12)
    expect(doc.lines.l1.styleId).toBe('y1');
  });

  it("Sync-to-style keeps the other wearer's pinned size too", () => {
    let doc = pinnedWearer();
    doc = {
      ...doc,
      lines: { ...doc.lines, l2: makeLine({ id: 'l2', singletonDotSize: 8, multiDotSize: 8 }) },
    };
    doc = applyStyleToItem(doc, 'y1', 'l2');
    doc = T.setLineSingletonDotSize(doc, 'l2', 8); // sit at the plain natural
    // l2 becomes the source: give it the service-code type (direct pick — the
    // courtesy write moving ITS size to 12 is the intended behavior here).
    doc = T.setLineSingletonDotStyle(doc, 'l2', 'svc');
    expect(doc.lines.l2.singletonDotSize).toBe(12);
    doc = saveStyleFromItem(doc, 'y1', 'line', 'y1', 'l2');
    // l1 follows the type but keeps its own pinned 8.
    expect(doc.lines.l1.singletonDotStyleId).toBe('svc');
    expect(doc.lines.l1.singletonDotSize).toBe(8);
  });
});

describe('Sync to style (saveStyleFromItem over the same name)', () => {
  it("pushes the source item's look into the def; other wearers keep their own overrides", () => {
    let doc = twoLabels();
    doc = T.updateTextLabel(doc, 'a', { fontSize: 20 }); // a's override → the new def value
    doc = T.updateTextLabel(doc, 'b', { weight: 700 }); // b's own override
    doc = saveStyleFromItem(doc, 'y1', 'textLabel', 'y1', 'a');
    const props = doc.styles.y1.props as TextLabelStyleProps;
    expect(props.fontSize).toBe(20);
    expect(props.weight).toBe(400);
    // a now matches its style exactly.
    expect(
      stylePropsEqual('textLabel', captureStyleProps(doc, 'textLabel', 'a')!, doc.styles.y1.props),
    ).toBe(true);
    // b followed the fontSize but kept its weight override.
    expect(doc.textLabels.b.fontSize).toBe(20);
    expect(doc.textLabels.b.weight).toBe(700);
    expect(doc.textLabels.b.styleId).toBe('y1');
  });
});

describe('serialize: diverged-but-tagged items survive the round-trip', () => {
  it('keeps the tag AND the diverged values', () => {
    const doc0 = makeDoc({
      lines: [makeLine({ id: 'l1', singletonDotSize: 8, multiDotSize: 8 })],
      styles: [makeStyle('line', 'y1'), ...Object.values(T.DEFAULT_STYLES)],
    });
    let doc = applyStyleToItem(doc0, 'y1', 'l1');
    doc = T.setLineWidth(doc, 'l1', 21);
    const r = parse(serialize(doc));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.lines.l1.styleId).toBe('y1');
    expect(r.doc.lines.l1.width).toBe(21);
  });

  it('still prunes a dangling tag', () => {
    const doc = makeDoc({
      lines: [makeLine({ id: 'l1', singletonDotSize: 8, multiDotSize: 8, styleId: 'ghost' })],
      styles: Object.values(T.DEFAULT_STYLES),
    });
    const r = parse(serialize(doc));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.lines.l1.styleId).toBeUndefined();
  });

  it('still prunes a wrong-kind tag', () => {
    const doc = makeDoc({
      lines: [makeLine({ id: 'l1', singletonDotSize: 8, multiDotSize: 8, styleId: 'y-label' })],
      styles: [makeStyle('textLabel', 'y-label'), ...Object.values(T.DEFAULT_STYLES)],
    });
    const r = parse(serialize(doc));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.lines.l1.styleId).toBeUndefined();
  });
});
