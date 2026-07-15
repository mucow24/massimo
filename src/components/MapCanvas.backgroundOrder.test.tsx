import { beforeEach, describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import App from '../App';
import { useDoc } from '../state/store';
import { useSelection } from '../state/selection';
import { DEFAULT_DOC } from '../model/transforms';
import { makePolygon, makeSvgImage } from '../test/fixtures';

// Polygons and imported images share ONE background stack (MapDoc.
// backgroundOrder): later in the array = painted later = on top, whatever the
// kind. Document order inside the canvas svg IS the paint order, so that is
// what these assert.

beforeEach(() => {
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
  useSelection.setState({
    ...useSelection.getState(),
    selectedPolygonIds: [],
    selectedSvgImageIds: [],
    uiMode: { kind: 'idle' },
  });
});

const seed = (backgroundOrder: string[]) => {
  act(() => {
    useDoc.setState({
      ...useDoc.getState(),
      polygons: { p0: makePolygon({ id: 'p0' }) },
      svgImages: { i0: makeSvgImage({ id: 'i0' }) },
      backgroundOrder,
    });
  });
};

const paintIndex = (selector: string) => {
  const svg = document.querySelector('[data-bg]')!.closest('svg')!;
  const els = Array.from(svg.querySelectorAll('*'));
  const i = els.findIndex((el) => el.matches(selector));
  expect(i, selector).toBeGreaterThanOrEqual(0);
  return i;
};

const polygonIdx = () => paintIndex('path[data-polygon-id="p0"]');
const imageIdx = () => paintIndex('g[data-svg-image-id="i0"]');

describe('MapCanvas — polygons and images share one background stack', () => {
  it('paints the polygon over the image when the polygon is later in backgroundOrder', () => {
    render(<App />);
    seed(['i0', 'p0']);
    expect(polygonIdx()).toBeGreaterThan(imageIdx());
  });

  it('paints the image over the polygon when the image is later in backgroundOrder', () => {
    render(<App />);
    seed(['p0', 'i0']);
    expect(imageIdx()).toBeGreaterThan(polygonIdx());
  });

  // The selected-item drag proxies re-assert footprints at top z, and their
  // own order is what breaks a tie between two overlapping SELECTED items. It
  // has to track the bodies' interleaved order, or the visually-LOWER item
  // steals the grab.
  it('emits the drag proxies in the same interleaved order as the bodies', () => {
    render(<App />);
    seed(['i0', 'p0']); // polygon on top of the image
    act(() => {
      useSelection.getState().setPolygonSelection(['p0']);
      useSelection.getState().setSvgImageSelection(['i0']);
    });
    expect(paintIndex('[data-polygon-hit="p0"]')).toBeGreaterThan(
      paintIndex('[data-svg-image-hit="i0"]'),
    );
  });
});
