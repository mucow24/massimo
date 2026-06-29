import { describe, it, expect, beforeEach } from 'vitest';
import { collectGroupSiblings, hasGroupSiblings, translateSiblings } from './groupDrag';
import { useDoc, useSelection } from '../../state/store';
import { DEFAULT_DOC } from '../../model/transforms';
import { makeStation, makePolygon } from '../../test/fixtures';

// The existing groupDrag.svgImage.test.ts exercises the label + svgImage paths.
// This file covers the station and polygon paths (the polygon branch deep-copies
// and per-vertex translates a full vertex list) plus the cross-type guards.

beforeEach(() => {
  useDoc.setState({
    ...useDoc.getState(),
    ...DEFAULT_DOC,
    stations: { s0: makeStation({ id: 's0', x: 10, y: 20 }) },
    polygons: {
      p0: makePolygon({
        id: 'p0',
        vertices: [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
          { x: 4, y: 6 },
        ],
      }),
    },
  });
  useSelection.setState({
    ...useSelection.getState(),
    selectedStationIds: ['s0'],
    selectedPolygonIds: ['p0'],
    selectedRouteBulletIds: [],
    selectedLabelIds: [],
    selectedSvgImageIds: [],
  });
});

describe('group drag across stations and polygons', () => {
  it('tows a co-selected polygon when a station is grabbed, translating every vertex', () => {
    const siblings = collectGroupSiblings('station', 's0');
    expect(hasGroupSiblings(siblings)).toBe(true);
    expect(siblings.stations).toEqual([]); // the grabbed station is excluded
    expect(siblings.polygons).toEqual([
      {
        id: 'p0',
        startVerts: [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
          { x: 4, y: 6 },
        ],
      },
    ]);
    translateSiblings(siblings, 7, -3);
    expect(useDoc.getState().polygons.p0.vertices).toEqual([
      { x: 7, y: -3 },
      { x: 11, y: -3 },
      { x: 11, y: 3 },
    ]);
  });

  it('tows a co-selected station when a polygon is grabbed', () => {
    const siblings = collectGroupSiblings('polygon', 'p0');
    expect(siblings.polygons).toEqual([]); // the grabbed polygon is excluded
    expect(siblings.stations).toEqual([{ id: 's0', startX: 10, startY: 20 }]);
    translateSiblings(siblings, 5, 5);
    expect(useDoc.getState().stations.s0).toMatchObject({ x: 15, y: 25 });
  });

  it('snapshots start vertices independently of the live polygon (no aliasing)', () => {
    const siblings = collectGroupSiblings('station', 's0');
    // Mutating the captured snapshot must not bleed into the document, and a
    // later translate must still be based on the originals.
    siblings.polygons[0].startVerts[0].x = 999;
    expect(useDoc.getState().polygons.p0.vertices[0].x).toBe(0);
  });

  it('does not tow a locked station', () => {
    useDoc.setState({
      ...useDoc.getState(),
      stations: { s0: makeStation({ id: 's0', x: 10, y: 20, locked: true }) },
    });
    const siblings = collectGroupSiblings('polygon', 'p0');
    expect(siblings.stations).toEqual([]);
    translateSiblings(siblings, 5, 5);
    expect(useDoc.getState().stations.s0).toMatchObject({ x: 10, y: 20 });
  });

  it('tows nothing when the grabbed item is not part of the selection', () => {
    const siblings = collectGroupSiblings('station', 'not-selected');
    expect(hasGroupSiblings(siblings)).toBe(false);
    expect(siblings.polygons).toEqual([]);
  });
});
