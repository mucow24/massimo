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

  it('selectVertex sets the vertex WITHOUT clearing the polygon selection', () => {
    sel().selectPolygon('p0');
    sel().selectVertex({ polygonId: 'p0', index: 2 });
    expect(sel().selectedVertex).toEqual({ polygonId: 'p0', index: 2 });
    expect(sel().selectedPolygonIds).toEqual(['p0']); // popover stays open
    sel().selectVertex(null);
    expect(sel().selectedVertex).toBeNull();
    expect(sel().selectedPolygonIds).toEqual(['p0']);
  });

  it('entering creating-polygon mode wipes all selections', () => {
    sel().selectPolygon('p0');
    sel().selectVertex({ polygonId: 'p0', index: 0 });
    sel().setUiMode({ kind: 'creating-polygon' });
    expect(sel().uiMode.kind).toBe('creating-polygon');
    expect(sel().selectedPolygonIds).toEqual([]);
    expect(sel().selectedVertex).toBeNull();
  });
});
