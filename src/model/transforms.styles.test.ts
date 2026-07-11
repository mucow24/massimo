// Detach-on-edit ("tagged ⇒ matches" upkeep) and paste hygiene for incoming
// styleIds. The styles transforms themselves are covered in styles.test.ts.
import { describe, it, expect } from 'vitest';
import {
  addPolygonWith,
  addRouteBulletWith,
  addTextLabelWith,
  setLineDefaultDotSize,
  setLineDefaultDotStyle,
  setLineStrokeColor,
  setLineStrokeWidth,
  setLineWidth,
  updatePolygon,
  updateRouteBullet,
  updateTextLabel,
  updateTransferStyle,
} from './transforms';
import { DOT_SHAPE_PRESETS } from './dotStyle';
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

describe('detach on covered-field edits — lines', () => {
  const tagged = () =>
    makeDoc({
      lines: [
        makeLine({ id: 'l1', width: 10, strokeWidth: 2, strokeColor: '#123456', styleId: 'y1' }),
      ],
      styles: [makeStyle('line', 'y1')],
    });

  it('setLineWidth detaches on a real change, keeps the tag on a no-op', () => {
    const doc = tagged();
    expect(setLineWidth(doc, 'l1', 10)).toBe(doc); // value-identical → same reference
    expect(setLineWidth(doc, 'l1', 14).lines.l1.styleId).toBeUndefined();
  });

  it('setLineStrokeWidth / setLineStrokeColor detach on change only', () => {
    const doc = tagged();
    expect(setLineStrokeWidth(doc, 'l1', 2)).toBe(doc);
    expect(setLineStrokeWidth(doc, 'l1', 3).lines.l1.styleId).toBeUndefined();
    expect(setLineStrokeColor(doc, 'l1', '#123456')).toBe(doc);
    expect(setLineStrokeColor(doc, 'l1', '#654321').lines.l1.styleId).toBeUndefined();
  });

  it('setLineDefaultDotStyle / setLineDefaultDotSize detach on change only', () => {
    const doc = tagged();
    expect(setLineDefaultDotStyle(doc, 'l1', DOT_SHAPE_PRESETS['filled-black'])).toBe(doc);
    expect(
      setLineDefaultDotStyle(doc, 'l1', DOT_SHAPE_PRESETS['open-black']).lines.l1.styleId,
    ).toBeUndefined();
    expect(setLineDefaultDotSize(doc, 'l1', 8)).toBe(doc); // 8 = DOT_SIZE_DEFAULT, already effective
    expect(setLineDefaultDotSize(doc, 'l1', 12).lines.l1.styleId).toBeUndefined();
  });
});

describe('detach on covered-field edits — text labels', () => {
  const tagged = () =>
    makeDoc({
      textLabels: [makeTextLabel({ id: 'g1', fontSize: 24, styleId: 'y1' })],
      styles: [makeStyle('textLabel', 'y1', { props: { fontSize: 24 } })],
    });

  it('detaches when a covered value actually changes', () => {
    expect(updateTextLabel(tagged(), 'g1', { fontSize: 30 }).textLabels.g1.styleId).toBeUndefined();
    expect(
      updateTextLabel(tagged(), 'g1', { align: 'center' }).textLabels.g1.styleId,
    ).toBeUndefined();
    expect(updateTextLabel(tagged(), 'g1', { italic: true }).textLabels.g1.styleId).toBeUndefined();
  });

  it('keeps the tag on non-covered edits (text, editorHeight, locked, position)', () => {
    expect(updateTextLabel(tagged(), 'g1', { text: 'Hi' }).textLabels.g1.styleId).toBe('y1');
    expect(updateTextLabel(tagged(), 'g1', { editorHeight: 80 }).textLabels.g1.styleId).toBe('y1');
    expect(updateTextLabel(tagged(), 'g1', { locked: true }).textLabels.g1.styleId).toBe('y1');
    expect(updateTextLabel(tagged(), 'g1', { x: 50, y: 50 }).textLabels.g1.styleId).toBe('y1');
  });

  it('width/leading/tracking are per-label layout, not style — real changes keep the tag', () => {
    expect(updateTextLabel(tagged(), 'g1', { width: 200 }).textLabels.g1.styleId).toBe('y1');
    expect(updateTextLabel(tagged(), 'g1', { leading: 1.5 }).textLabels.g1.styleId).toBe('y1');
    expect(updateTextLabel(tagged(), 'g1', { tracking: 0.05 }).textLabels.g1.styleId).toBe('y1');
  });

  it('keeps the tag on value-identical covered writes', () => {
    // fontSize re-fired with the current value.
    expect(updateTextLabel(tagged(), 'g1', { fontSize: 24 }).textLabels.g1.styleId).toBe('y1');
  });
});

describe('detach on covered-field edits — polygons', () => {
  const tagged = () =>
    makeDoc({
      polygons: [makePolygon({ id: 'p1', styleId: 'y1' })],
      styles: [makeStyle('polygon', 'y1')],
    });

  it('detaches when a covered value actually changes', () => {
    expect(updatePolygon(tagged(), 'p1', { fill: '#00ff00' }).polygons.p1.styleId).toBeUndefined();
    expect(updatePolygon(tagged(), 'p1', { strokeWidth: 3 }).polygons.p1.styleId).toBeUndefined();
    expect(updatePolygon(tagged(), 'p1', { closed: false }).polygons.p1.styleId).toBeUndefined();
  });

  it('keeps the tag on non-covered edits and value-identical covered writes', () => {
    const doc = tagged();
    const moved = updatePolygon(doc, 'p1', {
      vertices: doc.polygons.p1.vertices.map((v) => ({ x: v.x + 5, y: v.y })),
    });
    expect(moved.polygons.p1.styleId).toBe('y1');
    expect(updatePolygon(doc, 'p1', { locked: true }).polygons.p1.styleId).toBe('y1');
    expect(updatePolygon(doc, 'p1', { fill: '#cfe3f2' }).polygons.p1.styleId).toBe('y1');
    // curveRadius absent (effective 0) re-written as explicit 0.
    expect(updatePolygon(doc, 'p1', { curveRadius: 0 }).polygons.p1.styleId).toBe('y1');
    // closed absent (effective true) re-written as explicit true.
    expect(updatePolygon(doc, 'p1', { closed: true }).polygons.p1.styleId).toBe('y1');
  });
});

describe('detach on covered-field edits — route bullets', () => {
  const tagged = () =>
    makeDoc({
      routeBullets: [makeRouteBullet({ id: 'b1', size: 20, styleId: 'y1' })],
      styles: [makeStyle('routeBullet', 'y1', { props: { size: 20 } })],
    });

  it('detaches on shape/size changes, keeps the tag on lineId/locked/no-op writes', () => {
    expect(
      updateRouteBullet(tagged(), 'b1', { shape: 'diamond' }).routeBullets.b1.styleId,
    ).toBeUndefined();
    expect(updateRouteBullet(tagged(), 'b1', { size: 24 }).routeBullets.b1.styleId).toBeUndefined();
    expect(updateRouteBullet(tagged(), 'b1', { lineId: null }).routeBullets.b1.styleId).toBe('y1');
    expect(updateRouteBullet(tagged(), 'b1', { locked: true }).routeBullets.b1.styleId).toBe('y1');
    expect(updateRouteBullet(tagged(), 'b1', { size: 20 }).routeBullets.b1.styleId).toBe('y1');
  });
});

describe('detach on covered-field edits — transfers', () => {
  const base = () =>
    makeDoc({
      stations: [makeStation({ id: 's1' }), makeStation({ id: 's2' })],
      transfers: [makeTransfer({ id: 'x1', thickness: 6, styleId: 'y1' })],
      styles: [makeStyle('transfer', 'y1', { props: { thickness: 6 } })],
    });

  it('detaches when an override actually changes, keeps the tag on no-ops', () => {
    const doc = base();
    expect(updateTransferStyle(doc, 'x1', { thickness: 6 })).toBe(doc);
    expect(updateTransferStyle(doc, 'x1', { thickness: 9 }).transfers.x1.styleId).toBeUndefined();
    expect(
      updateTransferStyle(doc, 'x1', { color: '#ff0000' }).transfers.x1.styleId,
    ).toBeUndefined();
  });
});

describe('paste hygiene: add*With sanitizes incoming styleIds', () => {
  it('keeps a styleId that resolves to a style of the matching kind', () => {
    const doc = makeDoc({ styles: [makeStyle('textLabel', 'y1')] });
    const { id: _1, ...fields } = makeTextLabel({ id: 'tmp', styleId: 'y1' });
    expect(addTextLabelWith(doc, 'g1', fields).textLabels.g1.styleId).toBe('y1');
  });

  it('strips a dangling styleId (cross-document paste)', () => {
    const doc = makeDoc({});
    const { id: _1, ...label } = makeTextLabel({ id: 'tmp', styleId: 'foreign' });
    expect(addTextLabelWith(doc, 'g1', label).textLabels.g1.styleId).toBeUndefined();
    const { id: _2, ...bullet } = makeRouteBullet({ id: 'tmp', styleId: 'foreign' });
    expect(addRouteBulletWith(doc, 'b1', bullet).routeBullets.b1.styleId).toBeUndefined();
    const { id: _3, ...polygon } = makePolygon({ id: 'tmp', styleId: 'foreign' });
    expect(addPolygonWith(doc, 'p1', polygon).polygons.p1.styleId).toBeUndefined();
  });

  it('strips a styleId that resolves to a style of the WRONG kind', () => {
    const doc = makeDoc({ styles: [makeStyle('polygon', 'y1')] });
    const { id: _1, ...fields } = makeTextLabel({ id: 'tmp', styleId: 'y1' });
    expect(addTextLabelWith(doc, 'g1', fields).textLabels.g1.styleId).toBeUndefined();
  });
});
