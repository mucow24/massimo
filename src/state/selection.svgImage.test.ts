import { describe, it, expect, beforeEach } from 'vitest';
import { clearedSelections, soleSelection, useSelection } from './selection';

const sel = () => useSelection.getState();

describe('svg-image selection', () => {
  beforeEach(() => {
    useSelection.setState({
      ...clearedSelections(),
      uiMode: { kind: 'idle' },
      lineTagHoverPreview: null,
    });
  });

  it('selectSvgImage sets the id, clears other primaries, and forces idle mode', () => {
    useSelection.setState({ selectedStationIds: ['a'], uiMode: { kind: 'placing-label' } });
    sel().selectSvgImage('i0');
    expect(sel().selectedSvgImageIds).toEqual(['i0']);
    expect(sel().selectedStationIds).toEqual([]);
    expect(sel().uiMode.kind).toBe('idle');
    sel().selectSvgImage(null);
    expect(sel().selectedSvgImageIds).toEqual([]);
  });

  it('entering a foreign mode clears the svg-image selection', () => {
    sel().selectSvgImage('i0');
    sel().setUiMode({ kind: 'creating-polygon' });
    expect(sel().selectedSvgImageIds).toEqual([]);
  });

  it('toggle / set / add / xor behave like the other id lists', () => {
    sel().toggleSvgImageSelection('i0');
    sel().toggleSvgImageSelection('i1');
    expect(sel().selectedSvgImageIds).toEqual(['i0', 'i1']);
    sel().toggleSvgImageSelection('i0');
    expect(sel().selectedSvgImageIds).toEqual(['i1']);

    sel().setSvgImageSelection(['a', 'b', 'a']);
    expect(sel().selectedSvgImageIds).toEqual(['b', 'a']); // dedupe last-wins

    sel().addSvgImagesToSelection(['b', 'c']);
    expect(sel().selectedSvgImageIds).toEqual(['b', 'a', 'c']);

    sel().xorSvgImagesToSelection(['a', 'd']);
    expect(sel().selectedSvgImageIds).toEqual(['b', 'c', 'd']);
  });

  it('soleSelection routes a lone svg image and nulls a co-selection', () => {
    sel().selectSvgImage('i0');
    expect(soleSelection(sel())).toEqual({ type: 'svgImage', id: 'i0' });
    // Co-selecting a label must suppress the sole-svg-image routing.
    useSelection.setState({ selectedLabelIds: ['g0'] });
    expect(soleSelection(sel())).toBeNull();
  });
});
