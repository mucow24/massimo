import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, render, fireEvent } from '@testing-library/react';
import App from '../App';
import { dragState, useDoc } from '../state/store';
import { useSelection } from '../state/selection';
import { useViewportStore } from '../state/viewportStore';
import { DEFAULT_DOC } from '../model/transforms';
import {
  makePolygon,
  makeSvgImage,
  makeStation,
  makeStop,
  makeLine,
  makeTextLabel,
} from '../test/fixtures';
import type { RouteBullet } from '../model/types';

// jsdom reports clientWidth/clientHeight as 0, which collapses the viewBox to
// 0×0. Give the canvas a real size for the duration of these tests (mirrors
// MapCanvas.dim.test.tsx).
const sizeProps = ['clientWidth', 'clientHeight'] as const;
const originals: Partial<Record<(typeof sizeProps)[number], PropertyDescriptor>> = {};
beforeEach(() => {
  for (const prop of sizeProps) {
    originals[prop] = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop);
  }
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 600 });
  useDoc.setState({ ...useDoc.getState(), ...DEFAULT_DOC });
  useDoc.temporal.getState().clear();
  useSelection.setState({ ...useSelection.getState(), ...clearSel() });
  useViewportStore.setState({ x: 0, y: 0, zoom: 1 });
});
afterEach(() => {
  for (const prop of sizeProps) {
    const d = originals[prop];
    if (d) Object.defineProperty(HTMLElement.prototype, prop, d);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop];
  }
});

const clearSel = () => ({
  selectedStationIds: [] as string[],
  selectedRouteBulletIds: [] as string[],
  selectedLabelIds: [] as string[],
  selectedPolygonIds: [] as string[],
  selectedSvgImageIds: [] as string[],
  uiMode: { kind: 'idle' as const },
});

const bullet: RouteBullet = {
  id: 'b1',
  x: 0,
  y: 0,
  rotation: 0,
  lineId: null,
  shape: 'circle',
  size: 14,
};

// Seed a polygon, svg image, station, bullet, and label all near the origin so
// any pair overlaps; document order — not geometry — is what the proxy
// guarantees, but overlap keeps the fixture honest.
function seedAll() {
  act(() => {
    useDoc.setState({
      ...useDoc.getState(),
      stations: { s1: makeStation({ id: 's1', name: 'S1', x: 0, y: 0, stops: [makeStop('L1')] }) },
      lines: { L1: makeLine({ id: 'L1', stations: ['s1'] }) },
      lineOrder: ['L1'],
      polygons: { p0: makePolygon({ id: 'p0' }) },
      svgImages: { i0: makeSvgImage({ id: 'i0' }) },
      backgroundOrder: ['p0', 'i0'],
      routeBullets: { b1: bullet },
      textLabels: { g1: makeTextLabel({ id: 'g1', text: 'Midtown' }) },
    });
  });
}

const svgEls = () => {
  const svg = document.querySelector('[data-bg]')!.closest('svg')!;
  return Array.from(svg.querySelectorAll('*'));
};
const idx = (sel: string) => svgEls().findIndex((el) => el.matches(sel));

describe('MapCanvas — selected-item hit proxies win pointer hit-testing', () => {
  it('a selected polygon paints its hit proxy AFTER an overlapping station (so it wins the drag)', () => {
    render(<App />);
    seedAll();
    act(() => useSelection.getState().setPolygonSelection(['p0']));
    const stationIdx = idx('[data-station-id="s1"]');
    const hitIdx = idx('[data-polygon-hit="p0"]');
    expect(stationIdx).toBeGreaterThanOrEqual(0);
    // The transparent proxy is later in document order than the station body →
    // paints on top → wins hit-testing despite the station outranking the
    // polygon body in normal paint order.
    expect(hitIdx).toBeGreaterThan(stationIdx);
  });

  it("a polygon's own vertex handles still out-paint its body proxy", () => {
    render(<App />);
    seedAll();
    act(() => useSelection.getState().setPolygonSelection(['p0']));
    const hitIdx = idx('[data-polygon-hit="p0"]');
    const vertexIdx = idx('[data-polygon-vertex]');
    expect(hitIdx).toBeGreaterThanOrEqual(0);
    expect(vertexIdx).toBeGreaterThan(hitIdx);
  });

  it("an svg image's own transform handles still out-paint its body proxy", () => {
    render(<App />);
    seedAll();
    act(() => useSelection.getState().setSvgImageSelection(['i0']));
    const hitIdx = idx('[data-svg-image-hit="i0"]');
    const handleIdx = idx('[data-svg-image-handle]');
    expect(hitIdx).toBeGreaterThanOrEqual(0);
    expect(handleIdx).toBeGreaterThan(hitIdx);
  });

  it('emits proxies in body paint order: polygon before svg image (visually-higher selected wins)', () => {
    render(<App />);
    seedAll();
    act(() => {
      useSelection.getState().setPolygonSelection(['p0']);
      useSelection.getState().setSvgImageSelection(['i0']);
    });
    const pHit = idx('[data-polygon-hit="p0"]');
    const iHit = idx('[data-svg-image-hit="i0"]');
    expect(pHit).toBeGreaterThanOrEqual(0);
    // svg image bodies paint above polygon bodies, so the svg proxy must paint
    // last to keep "visually on top among the selection also wins the grab".
    expect(iHit).toBeGreaterThan(pHit);
  });

  it('does not duplicate the body id: still exactly one [data-polygon-id] when selected', () => {
    render(<App />);
    seedAll();
    act(() => useSelection.getState().setPolygonSelection(['p0']));
    expect(document.querySelectorAll('[data-polygon-id]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-polygon-hit]')).toHaveLength(1);
  });

  it('renders the proxies inside a data-export-exclude subtree (kept out of exports)', () => {
    render(<App />);
    seedAll();
    act(() => useSelection.getState().setPolygonSelection(['p0']));
    const el = document.querySelector('[data-polygon-hit="p0"]')!;
    expect(el.closest('[data-export-exclude]')).not.toBeNull();
  });

  it('no proxy element carries data-locked or data-bg (would corrupt the rect-select gate)', () => {
    render(<App />);
    seedAll();
    act(() => {
      const s = useSelection.getState();
      s.setStationSelection(['s1']);
      s.setRouteBulletSelection(['b1']);
      s.setLabelSelection(['g1']);
      s.setPolygonSelection(['p0']);
      s.setSvgImageSelection(['i0']);
    });
    const proxies = document.querySelectorAll(
      '[data-polygon-hit],[data-svg-image-hit],[data-station-hit],[data-bullet-hit],[data-text-label-hit]',
    );
    expect(proxies).toHaveLength(5);
    proxies.forEach((el) => {
      expect(el.hasAttribute('data-locked')).toBe(false);
      expect(el.hasAttribute('data-bg')).toBe(false);
    });
  });

  it('renders no proxies when nothing is selected', () => {
    render(<App />);
    seedAll();
    expect(
      document.querySelectorAll(
        '[data-polygon-hit],[data-svg-image-hit],[data-station-hit],[data-bullet-hit],[data-text-label-hit]',
      ),
    ).toHaveLength(0);
  });

  it('a selected LOCKED polygon gets no proxy, and its body keeps data-locked for the marquee gate', () => {
    render(<App />);
    act(() => {
      useDoc.setState({
        ...useDoc.getState(),
        polygons: { p0: makePolygon({ id: 'p0', locked: true }) },
        backgroundOrder: ['p0'],
      });
    });
    act(() => useSelection.getState().setPolygonSelection(['p0']));
    // No top-z proxy: a locked polygon isn't draggable.
    expect(document.querySelectorAll('[data-polygon-hit]')).toHaveLength(0);
    // The body still carries data-locked, so a drag starting on it begins a
    // marquee (useRectSelect keys off closest('[data-locked]')) rather than
    // being swallowed by a proxy with no marker.
    const bodyDoc = document.querySelector('path[data-polygon-id="p0"]')!;
    expect(bodyDoc.getAttribute('data-locked')).toBe('true');
  });

  it('re-routes a click on a selected item proxy to the real element beneath (normal layer order)', () => {
    render(<App />);
    seedAll();
    act(() => useSelection.getState().setPolygonSelection(['p0']));
    expect(useSelection.getState().selectedPolygonIds).toEqual(['p0']);
    const proxyEl = document.querySelector('[data-polygon-hit="p0"]')!;
    // The "real element beneath" the proxy — jsdom can't hit-test, so stand in
    // the label's hit rect as what elementFromPoint would return. (jsdom doesn't
    // define elementFromPoint at all, so assign rather than spy.)
    const beneath = document.querySelector('[data-text-label-id="g1"] rect')!;
    (document as unknown as { elementFromPoint: () => Element }).elementFromPoint = () => beneath;
    act(() => {
      fireEvent.click(proxyEl, { button: 0, clientX: 10, clientY: 10 });
    });
    delete (document as unknown as { elementFromPoint?: unknown }).elementFromPoint;
    // The proxy's own (no-op) click is suppressed; the re-dispatched click hits
    // the label, so selection followed normal layer order: label in, polygon out.
    expect(useSelection.getState().selectedLabelIds).toEqual(['g1']);
    expect(useSelection.getState().selectedPolygonIds).toEqual([]);
  });

  it('does not re-route after a drag (suppressed click leaves selection alone)', () => {
    render(<App />);
    seedAll();
    act(() => useSelection.getState().setPolygonSelection(['p0']));
    const proxyEl = document.querySelector('[data-polygon-hit="p0"]')!;
    const beneath = document.querySelector('[data-text-label-id="g1"] rect')!;
    (document as unknown as { elementFromPoint: () => Element }).elementFromPoint = () => beneath;
    dragState.suppressClick = true; // a drag just ended
    act(() => {
      fireEvent.click(proxyEl, { button: 0, clientX: 10, clientY: 10 });
    });
    dragState.suppressClick = false;
    delete (document as unknown as { elementFromPoint?: unknown }).elementFromPoint;
    // No re-route: the polygon stays selected, the label is untouched.
    expect(useSelection.getState().selectedPolygonIds).toEqual(['p0']);
    expect(useSelection.getState().selectedLabelIds).toEqual([]);
  });

  it('tears the proxy down when the selection is cleared', () => {
    render(<App />);
    seedAll();
    act(() => useSelection.getState().setPolygonSelection(['p0']));
    expect(document.querySelectorAll('[data-polygon-hit]')).toHaveLength(1);
    act(() => useSelection.getState().setPolygonSelection([]));
    expect(document.querySelectorAll('[data-polygon-hit]')).toHaveLength(0);
  });
});
