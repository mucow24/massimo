import { describe, it, expect, beforeEach } from 'vitest';
import { useDoc } from './store';
import { DEFAULT_DOC } from '../model/transforms';

// Offset the paste/duplicate actions apply so a copy lands just off the source.
const OFFSET = 15;

beforeEach(() => {
  localStorage.clear();
  // Not clearAll() — that deliberately preserves the name, styles, palettes and
  // seam mode, so it would leak them between tests rather than reset the doc.
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
});

describe('pasteTextLabel / duplicateTextLabel', () => {
  it('pasteTextLabel offsets x/y by the drop offset and returns a new id', () => {
    const doc = useDoc.getState();
    const newId = doc.pasteTextLabel({
      x: 100,
      y: 200,
      rotation: 0,
      text: 'Hi',
      fontSize: 24,
      weight: 400,
      italic: false,
      align: 'left',
      color: '#ff0000',
      darkColor: '#00ff00',
    });
    const label = useDoc.getState().textLabels[newId];
    expect(label).toMatchObject({
      x: 100 + OFFSET,
      y: 200 + OFFSET,
      text: 'Hi',
      // Day/night colors carry through the paste path unchanged.
      color: '#ff0000',
      darkColor: '#00ff00',
    });
  });

  it('pasteTextLabel unlocks the copy even when the source was locked', () => {
    const newId = useDoc.getState().pasteTextLabel({
      x: 100,
      y: 200,
      rotation: 0,
      text: 'Hi',
      fontSize: 24,
      weight: 400,
      italic: false,
      align: 'left',
      color: '#ff0000',
      darkColor: '#00ff00',
      locked: true,
    });
    expect(useDoc.getState().textLabels[newId].locked).toBeFalsy();
  });

  it('duplicateTextLabel copies the source offset and leaves the source untouched', () => {
    const srcId = useDoc.getState().addTextLabel(50, 60);
    const before = { ...useDoc.getState().textLabels[srcId] };
    const dupId = useDoc.getState().duplicateTextLabel(srcId);
    expect(dupId).not.toBeNull();
    expect(dupId).not.toBe(srcId);
    const dup = useDoc.getState().textLabels[dupId!];
    expect(dup).toMatchObject({ x: before.x + OFFSET, y: before.y + OFFSET, text: before.text });
    // Source unchanged.
    expect(useDoc.getState().textLabels[srcId]).toEqual(before);
  });

  it('duplicateTextLabel returns null for a missing id', () => {
    expect(useDoc.getState().duplicateTextLabel('nope')).toBeNull();
  });
});

describe('pastePolygon / duplicatePolygon', () => {
  const polyData = {
    vertices: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ],
    fill: '#aabbcc',
    stroke: '#112233',
    darkFill: '#445566',
    darkStroke: '#778899',
    strokeWidth: 2,
    fillOpacity: 50,
    locked: true,
  };

  it('pastePolygon offsets every vertex, preserves style, appends to backgroundOrder', () => {
    const newId = useDoc.getState().pastePolygon(polyData);
    const state = useDoc.getState();
    const poly = state.polygons[newId];
    expect(poly.vertices).toEqual([
      { x: 0 + OFFSET, y: 0 + OFFSET },
      { x: 10 + OFFSET, y: 0 + OFFSET },
      { x: 10 + OFFSET, y: 10 + OFFSET },
    ]);
    expect(poly).toMatchObject({
      fill: '#aabbcc',
      stroke: '#112233',
      darkFill: '#445566',
      darkStroke: '#778899',
      strokeWidth: 2,
      fillOpacity: 50,
    });
    expect(state.backgroundOrder[state.backgroundOrder.length - 1]).toBe(newId);
  });

  it('pastePolygon unlocks the copy even when the source was locked', () => {
    // polyData has locked: true.
    const newId = useDoc.getState().pastePolygon(polyData);
    expect(useDoc.getState().polygons[newId].locked).toBeFalsy();
  });

  it('duplicatePolygon copies the source offset and leaves the source untouched', () => {
    const srcId = useDoc.getState().pastePolygon(polyData); // seed one polygon
    const before = useDoc.getState().polygons[srcId];
    const beforeVerts = before.vertices.map((v) => ({ ...v }));
    const dupId = useDoc.getState().duplicatePolygon(srcId);
    expect(dupId).not.toBeNull();
    const dup = useDoc.getState().polygons[dupId!];
    expect(dup.vertices).toEqual(beforeVerts.map((v) => ({ x: v.x + OFFSET, y: v.y + OFFSET })));
    expect(useDoc.getState().polygons[srcId].vertices).toEqual(beforeVerts);
  });

  it('duplicatePolygon returns null for a missing id', () => {
    expect(useDoc.getState().duplicatePolygon('nope')).toBeNull();
  });
});

describe('pasteRouteBullet / duplicateRouteBullet', () => {
  const bulletData = {
    x: 100,
    y: 200,
    rotation: 0 as const,
    lineId: 'L1',
    shape: 'square' as const,
    size: 12,
  };

  it('pasteRouteBullet offsets x/y by the drop offset, preserves fields, and returns a new id', () => {
    const newId = useDoc.getState().pasteRouteBullet(bulletData);
    const bullet = useDoc.getState().routeBullets[newId];
    expect(bullet).toMatchObject({
      x: 100 + OFFSET,
      y: 200 + OFFSET,
      // Non-position fields carry through the paste path unchanged.
      lineId: 'L1',
      shape: 'square',
      size: 12,
      rotation: 0,
    });
  });

  it('pasteRouteBullet unlocks the copy even when the source was locked', () => {
    const newId = useDoc.getState().pasteRouteBullet({ ...bulletData, locked: true });
    expect(useDoc.getState().routeBullets[newId].locked).toBeFalsy();
  });

  it('duplicateRouteBullet copies the source offset and leaves the source untouched', () => {
    const srcId = useDoc.getState().addRouteBullet(50, 60, 'L1');
    const before = { ...useDoc.getState().routeBullets[srcId] };
    const dupId = useDoc.getState().duplicateRouteBullet(srcId);
    expect(dupId).not.toBeNull();
    expect(dupId).not.toBe(srcId);
    const dup = useDoc.getState().routeBullets[dupId!];
    expect(dup).toMatchObject({
      x: before.x + OFFSET,
      y: before.y + OFFSET,
      lineId: before.lineId,
      shape: before.shape,
      size: before.size,
    });
    // Source unchanged.
    expect(useDoc.getState().routeBullets[srcId]).toEqual(before);
  });

  it('duplicateRouteBullet returns null for a missing id', () => {
    expect(useDoc.getState().duplicateRouteBullet('nope')).toBeNull();
  });
});
