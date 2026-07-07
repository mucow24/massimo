import { describe, it, expect, beforeEach } from 'vitest';
import { clearedSelections, useSelection } from './selection';

const sel = () => useSelection.getState();

describe('polygon selection', () => {
  beforeEach(() => {
    // Reset via the production full-wipe helper so the set of cleared fields
    // can't drift from clearedSelections().
    useSelection.setState({
      ...clearedSelections(),
      uiMode: { kind: 'idle' },
      lineTagHoverPreview: null,
    });
  });

  it('selectPolygon sets the id, clears other primaries, and forces idle mode', () => {
    useSelection.setState({ selectedStationIds: ['a'], uiMode: { kind: 'placing-label' } });
    sel().selectPolygon('p0');
    expect(sel().selectedPolygonIds).toEqual(['p0']);
    expect(sel().selectedStationIds).toEqual([]);
    expect(sel().uiMode.kind).toBe('idle');
    sel().selectPolygon(null);
    expect(sel().selectedPolygonIds).toEqual([]);
  });

  it('toggle / set / add / xor behave like the route-bullet lists', () => {
    sel().togglePolygonSelection('p0');
    sel().togglePolygonSelection('p1');
    expect(sel().selectedPolygonIds).toEqual(['p0', 'p1']);
    sel().togglePolygonSelection('p0');
    expect(sel().selectedPolygonIds).toEqual(['p1']);

    sel().setPolygonSelection(['a', 'b', 'a']);
    expect(sel().selectedPolygonIds).toEqual(['b', 'a']); // dedupe last-wins

    sel().addPolygonsToSelection(['b', 'c']);
    expect(sel().selectedPolygonIds).toEqual(['b', 'a', 'c']);

    sel().xorPolygonsToSelection(['a', 'd']);
    expect(sel().selectedPolygonIds).toEqual(['b', 'c', 'd']);
  });

  it('selectVertices sets the vertices WITHOUT clearing the polygon selection', () => {
    sel().selectPolygon('p0');
    sel().selectVertices({ polygonId: 'p0', indices: [2, 3] });
    expect(sel().selectedVertices).toEqual({ polygonId: 'p0', indices: [2, 3] });
    expect(sel().selectedPolygonIds).toEqual(['p0']); // popover stays open
    sel().selectVertices(null);
    expect(sel().selectedVertices).toBeNull();
    expect(sel().selectedPolygonIds).toEqual(['p0']);
  });

  it('toggleVertexSelection adds/removes vertices within one polygon', () => {
    sel().selectPolygon('p0');
    sel().toggleVertexSelection({ polygonId: 'p0', index: 2 });
    sel().toggleVertexSelection({ polygonId: 'p0', index: 4 });
    expect(sel().selectedVertices).toEqual({ polygonId: 'p0', indices: [2, 4] });
    // Re-toggling one removes just it.
    sel().toggleVertexSelection({ polygonId: 'p0', index: 2 });
    expect(sel().selectedVertices).toEqual({ polygonId: 'p0', indices: [4] });
    // Removing the last one clears the whole selection to null.
    sel().toggleVertexSelection({ polygonId: 'p0', index: 4 });
    expect(sel().selectedVertices).toBeNull();
  });

  it('toggleVertexSelection on a DIFFERENT polygon resets to just that vertex', () => {
    sel().selectVertices({ polygonId: 'p0', indices: [1, 2] });
    // Vertices are single-polygon: touching another polygon starts fresh.
    sel().toggleVertexSelection({ polygonId: 'p1', index: 0 });
    expect(sel().selectedVertices).toEqual({ polygonId: 'p1', indices: [0] });
  });

  it('a polygon-list change drops the active vertex selection', () => {
    sel().selectPolygon('p0');
    sel().selectVertices({ polygonId: 'p0', indices: [0, 1] });
    sel().togglePolygonSelection('p1'); // now multi-polygon; vertex set is stale
    expect(sel().selectedVertices).toBeNull();
  });

  it('entering creating-polygon mode wipes all selections', () => {
    sel().selectPolygon('p0');
    sel().selectVertices({ polygonId: 'p0', indices: [0, 1] });
    sel().setUiMode({ kind: 'creating-polygon' });
    expect(sel().uiMode.kind).toBe('creating-polygon');
    expect(sel().selectedPolygonIds).toEqual([]);
    expect(sel().selectedVertices).toBeNull();
  });
});
