import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { PolygonView } from './PolygonView';
import { makePolygon } from '../test/fixtures';
import { useViewportStore } from '../state/viewportStore';
import type { Polygon } from '../model/types';

const noop = () => {};

function renderBody(polygon: Polygon) {
  return render(
    <svg>
      <PolygonView
        polygon={polygon}
        layer="body"
        selected={false}
        selectedVertexIndex={null}
        interactive
        onPointerDown={noop}
        onClick={noop}
        onContextMenu={noop}
        onVertexPointerDown={noop}
        onVertexClick={noop}
        onEdgeAddPointerDown={noop}
      />
    </svg>,
  );
}

const body = (container: HTMLElement) =>
  container.querySelector('path[data-polygon-id="p0"]') as Element;

describe('<PolygonView /> dark-mode colors', () => {
  beforeEach(() => {
    useViewportStore.setState({ darkMode: false });
  });

  it('paints the light fill/stroke in light mode, ignoring dark overrides', () => {
    const { container } = renderBody(
      makePolygon({
        id: 'p0',
        fill: '#112233',
        stroke: '#445566',
        darkFill: '#778899',
        darkStroke: '#99aabb',
      }),
    );
    expect(body(container).getAttribute('fill')).toBe('#112233');
    expect(body(container).getAttribute('stroke')).toBe('#445566');
  });

  it('paints the dark fill/stroke when dark mode is on', () => {
    useViewportStore.setState({ darkMode: true });
    const { container } = renderBody(
      makePolygon({
        id: 'p0',
        fill: '#112233',
        stroke: '#445566',
        darkFill: '#778899',
        darkStroke: '#99aabb',
      }),
    );
    expect(body(container).getAttribute('fill')).toBe('#778899');
    expect(body(container).getAttribute('stroke')).toBe('#99aabb');
  });

  it('shows the light colors in dark mode when dark equals light (uncustomized)', () => {
    useViewportStore.setState({ darkMode: true });
    const { container } = renderBody(makePolygon({ id: 'p0', fill: '#112233', stroke: '#445566' }));
    expect(body(container).getAttribute('fill')).toBe('#112233');
    expect(body(container).getAttribute('stroke')).toBe('#445566');
  });
});

describe('<PolygonView /> overlay handles are a constant screen size', () => {
  beforeEach(() => {
    useViewportStore.setState({ darkMode: false, zoom: 1 });
  });

  function renderOverlay(zoom: number) {
    useViewportStore.setState({ zoom });
    return render(
      <svg>
        <PolygonView
          polygon={makePolygon({ id: 'p0' })}
          layer="overlay"
          selected
          selectedVertexIndex={null}
          interactive
          onPointerDown={noop}
          onClick={noop}
          onContextMenu={noop}
          onVertexPointerDown={noop}
          onVertexClick={noop}
          onEdgeAddPointerDown={noop}
        />
      </svg>,
    ).container;
  }

  // makePolygon's default square has vertex 0 at (-30,-30); edge 0's midpoint is
  // (0,-30). Authored sizes: VERTEX_HANDLE_HALF=5 (10×10 box), EDGE_ADD_R=7. On
  // screen these must stay constant, so each world dimension scales by 1/zoom and
  // `dimension × zoom` is invariant across zoom levels.
  it('vertex handle: width/stroke constant on screen, stays centered on the vertex', () => {
    for (const zoom of [1, 2]) {
      const c = renderOverlay(zoom);
      const rect = c.querySelector('rect[data-polygon-vertex="0"]')!;
      const w = Number(rect.getAttribute('width'));
      expect(w * zoom).toBeCloseTo(10);
      expect(Number(rect.getAttribute('height')) * zoom).toBeCloseTo(10);
      expect(Number(rect.getAttribute('stroke-width')) * zoom).toBeCloseTo(1.5);
      // Center (x + width/2) stays on the world vertex x = -30 at every zoom.
      expect(Number(rect.getAttribute('x')) + w / 2).toBeCloseTo(-30);
    }
  });

  it('edge "+" circle radius is constant on screen', () => {
    for (const zoom of [1, 2]) {
      const c = renderOverlay(zoom);
      const circle = c.querySelector('[data-polygon-edge-add="0"] circle')!;
      expect(Number(circle.getAttribute('r')) * zoom).toBeCloseTo(7);
      // Circle stays centered on edge 0's midpoint (0,-30).
      expect(Number(circle.getAttribute('cx'))).toBeCloseTo(0);
      expect(Number(circle.getAttribute('cy'))).toBeCloseTo(-30);
    }
  });

  it('dashed selection outline keeps a constant stroke width + dash spacing', () => {
    for (const zoom of [1, 2]) {
      const c = renderOverlay(zoom);
      const outline = c.querySelector('g[data-polygon-overlay] > polygon')!;
      expect(Number(outline.getAttribute('stroke-width')) * zoom).toBeCloseTo(1.5);
      expect(outline.getAttribute('stroke-dasharray')).toBe(`${4 / zoom} ${3 / zoom}`);
    }
  });
});

describe('<PolygonView /> corner rounding', () => {
  beforeEach(() => {
    useViewportStore.setState({ darkMode: false });
  });

  it('draws straight edges (no quadratic) when curveRadius is unset', () => {
    const { container } = renderBody(makePolygon({ id: 'p0' }));
    const d = body(container).getAttribute('d') ?? '';
    expect(d).not.toContain('Q');
  });

  it('rounds the corners (quadratics) when curveRadius > 0, keeping fill/stroke', () => {
    const { container } = renderBody(
      makePolygon({ id: 'p0', fill: '#112233', stroke: '#445566', curveRadius: 12 }),
    );
    const el = body(container);
    expect(el.getAttribute('d') ?? '').toContain('Q');
    expect(el.getAttribute('fill')).toBe('#112233');
    expect(el.getAttribute('stroke')).toBe('#445566');
  });
});
