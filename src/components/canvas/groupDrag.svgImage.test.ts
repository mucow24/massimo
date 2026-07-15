import { describe, it, expect, beforeEach } from 'vitest';
import { collectGroupSiblings, hasGroupSiblings, translateSiblings } from './groupDrag';
import { useDoc, useSelection } from '../../state/store';
import { DEFAULT_DOC } from '../../model/transforms';
import { makeSvgImage, makeTextLabel } from '../../test/fixtures';

beforeEach(() => {
  useDoc.setState({
    ...useDoc.getState(),
    ...DEFAULT_DOC,
    textLabels: { g0: makeTextLabel({ id: 'g0', x: 5, y: 5 }) },
    svgImages: { i0: makeSvgImage({ id: 'i0', x: 0, y: 0 }) },
    backgroundOrder: ['i0'],
  });
  useSelection.setState({
    ...useSelection.getState(),
    selectedLabelIds: ['g0'],
    selectedSvgImageIds: ['i0'],
  });
});

describe('group drag with svg images', () => {
  it('tows a co-selected svg image when another selected item is dragged', () => {
    const siblings = collectGroupSiblings('label', 'g0');
    expect(siblings.svgImages).toEqual([{ id: 'i0', startX: 0, startY: 0 }]);
    expect(hasGroupSiblings(siblings)).toBe(true);
    translateSiblings(siblings, 40, -10);
    expect(useDoc.getState().svgImages.i0).toMatchObject({ x: 40, y: -10 });
  });

  it('does not tow a locked svg image', () => {
    useDoc.setState({
      ...useDoc.getState(),
      svgImages: { i0: makeSvgImage({ id: 'i0', x: 0, y: 0, locked: true }) },
    });
    const siblings = collectGroupSiblings('label', 'g0');
    expect(siblings.svgImages).toEqual([]);
    translateSiblings(siblings, 40, 0);
    expect(useDoc.getState().svgImages.i0.x).toBe(0);
  });

  it('tows other selected items when an svg image is the grabbed item', () => {
    const siblings = collectGroupSiblings('svgImage', 'i0');
    expect(siblings.labels).toEqual([{ id: 'g0', startX: 5, startY: 5 }]);
    expect(siblings.svgImages).toEqual([]); // the grabbed image is excluded
  });
});
