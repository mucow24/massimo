import { describe, it, expect, beforeEach } from 'vitest';
import { useDoc } from './store';

// Offset the paste/duplicate actions apply so a copy lands just off the source.
const OFFSET = 15;

beforeEach(() => {
  localStorage.clear();
  useDoc.getState().clearAll();
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

  it('pastePolygon offsets every vertex, preserves style, appends to polygonOrder', () => {
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
    expect(state.polygonOrder[state.polygonOrder.length - 1]).toBe(newId);
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
